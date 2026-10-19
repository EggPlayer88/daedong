-- ============================================================================
-- P6-03  사후 점검 (읽기 전용). P6-02 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 두 행은 정보(info):
--   P6-03-09 학교별 준비 상태 — P6-04 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드=준비 사유 · 설정 판.
--   P6-03-10 관리 확인이 필요한 요청 — 결과 불명 · 청구 미확인 · 10분 넘게 끝나지 않은 호출의 수(P6-05 대상).
-- ============================================================================
SELECT 'P6-03-01' AS no, '적용 기록 P6-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p6_installs') IS NOT NULL AND workhub_private.p6_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P6-03-02', '새 표 7개 + 적용 기록 · RLS 켜짐',
       CASE WHEN count(*) = 8 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p6_installs'), to_regclass('workhub.assistant_policies'), to_regclass('workhub.assistant_threads'),
  to_regclass('workhub.assistant_requests'), to_regclass('workhub.assistant_request_sources'), to_regclass('workhub.assistant_exchanges'),
  to_regclass('workhub.assistant_proposals'), to_regclass('workhub.assistant_task_requests'))
UNION ALL
SELECT 'P6-03-03', 'workhub·workhub_private 표에 API 역할 권한 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P6-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P6-03-05', '공개 함수 7개: 서버 4 = service_role 만 · 앱 3 = authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 7 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
              AND CASE WHEN p.proname IN ('workhub_ai_server_readiness','workhub_ai_prepare','workhub_ai_start','workhub_ai_finish')
                       THEN has_function_privilege('service_role', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                       ELSE has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') END)
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_ai\_%'
UNION ALL
SELECT 'P6-03-06', '요청: 완료 = 교환 1개 · 교환이 있으면 완료 · 시작한 요청의 근거 snapshot 은 시작한 임대 것', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.assistant_requests r
WHERE (r.state = 'completed') <> (r.exchange_id IS NOT NULL)
   OR (r.exchange_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workhub.assistant_exchanges x WHERE x.id = r.exchange_id AND x.request_id = r.id))
   OR (r.started_lease IS NOT NULL AND r.started_lease <> r.lease_token)
UNION ALL
SELECT 'P6-03-07', '대화: 판 = 1 + (교환 수 - 1) + 확정된 제안 수 · 교환 순번 1..n 빈칸 없음', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.assistant_threads t
WHERE t.version <> (SELECT count(*) FROM workhub.assistant_exchanges x WHERE x.thread_id = t.id)
                 + (SELECT count(*) FROM workhub.assistant_proposals p WHERE p.thread_id = t.id AND p.status = 'applied')
   OR (SELECT COALESCE(max(seq), 0) FROM workhub.assistant_exchanges x WHERE x.thread_id = t.id)
      <> (SELECT count(*) FROM workhub.assistant_exchanges x WHERE x.thread_id = t.id)
UNION ALL
SELECT 'P6-03-08', '제안: 확정된 제안의 할 일은 제안 주인의 할 일 · 확정 접수증과 짝', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.assistant_proposals p
WHERE p.status = 'applied' AND (NOT EXISTS (SELECT 1 FROM workhub.tasks t WHERE t.id = p.task_id AND t.owner_account_id = p.owner_account_id)
   OR NOT EXISTS (SELECT 1 FROM workhub.assistant_task_requests q WHERE q.school_id = p.school_id AND q.owner_account_id = p.owner_account_id
                   AND q.request_key = p.applied_request_key AND q.receipt ->> 'taskId' = p.task_id))
UNION ALL
SELECT 'P6-03-09', '학교별 준비 상태', 'info',
       COALESCE((SELECT string_agg(s.code || '=' || workhub_private.p6_reason(s.id) || COALESCE('·설정 ' || (workhub_private.p6_policy(s.id)).version || '판', ''), ', ' ORDER BY s.code)
                   FROM workhub.schools s
                  WHERE EXISTS (SELECT 1 FROM workhub.module_activations a WHERE a.school_id = s.id AND a.module = 'assistant')), '(활성화 없음)')
UNION ALL
SELECT 'P6-03-10', '관리 확인이 필요한 요청(P6-05 대상)', 'info',
       'provider_unknown ' || count(*) FILTER (WHERE r.state = 'provider_unknown')
       || ' · 청구 미확인 ' || count(*) FILTER (WHERE r.cost_state = 'unknown')
       || ' · 10분 넘게 끝나지 않음 ' || count(*) FILTER (WHERE r.state = 'started' AND r.started_at < clock_timestamp() - interval '10 minutes')
FROM workhub.assistant_requests r
ORDER BY 1;
