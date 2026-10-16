-- ============================================================================
-- P2-03  사후 점검 (읽기 전용). P2-02 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 행(P2-03-11)은 학교 × 모듈 상태:
--   P2-04 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드:모듈=active|stopped.
-- ============================================================================
SELECT 'P2-03-01' AS no, '적용 기록 P2-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p2_installs') IS NOT NULL AND workhub_private.p2_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P2-03-02', '새 표 11개 · RLS 켜짐',
       CASE WHEN count(*) = 11 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p2_installs'), to_regclass('workhub.module_activations'), to_regclass('workhub.request_receipts'),
  to_regclass('workhub.calendar_import_sources'), to_regclass('workhub.calendar_import_source_editors'), to_regclass('workhub.calendar_import_rows'),
  to_regclass('workhub.calendar_import_prepares'), to_regclass('workhub.calendar_import_batches'), to_regclass('workhub.cooperation_requests'),
  to_regclass('workhub.cooperation_history'), to_regclass('workhub.cooperation_task_links'))
UNION ALL
SELECT 'P2-03-03', 'workhub·workhub_private 표에 API 역할 권한 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P2-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P2-03-05', '공개 함수 6개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 6 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_calendar\_batch\_%' OR p.proname LIKE 'workhub\_cooperation\_%')
UNION ALL
SELECT 'P2-03-06', 'P1 학교 관리 함수 3개 그대로(authenticated 만)',
       CASE WHEN count(*) = 3 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_school\_admin\_%'
UNION ALL
SELECT 'P2-03-07', 'canonical JSON = 앱 canonical',
       CASE WHEN workhub_private.p2_canonical('{"b":[2,1,{"z":"\"줄\n","a":null}],"a":true,"A":"\u0001/"}'::jsonb)
                 = '{"A":"\u0001/","a":true,"b":[2,1,{"a":null,"z":"\"줄\n"}]}' THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P2-03-08', '일정 일괄: 반영 접수증 수 = 적용 묶음 수',
       CASE WHEN (SELECT count(*) FROM workhub.request_receipts WHERE module = 'calendar_batch' AND outcome = 'applied')
               = (SELECT count(*) FROM workhub.calendar_import_batches) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*) FROM workhub.calendar_import_batches)::text
UNION ALL
SELECT 'P2-03-09', '일정 일괄: 계보가 가리키는 일정이 같은 학교에 있고 적용 판 ≤ 현재 판',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.calendar_import_rows l LEFT JOIN workhub.events e ON e.id = l.event_id AND e.school_id = l.school_id
WHERE e.id IS NULL OR l.applied_event_version > e.version
UNION ALL
SELECT 'P2-03-10', '협업: 요청마다 이력 수 = 판, 첫 이력 = 발신자 create, 행마다 처리자 = 그때의 당사자(인계 포함)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.cooperation_requests r
WHERE (SELECT count(*) FROM workhub.cooperation_history h WHERE h.request_id = r.id) <> r.version
   OR NOT EXISTS (SELECT 1 FROM workhub.cooperation_history h WHERE h.request_id = r.id AND h.version = 1 AND h.action = 'create'
                   AND h.actor_membership_id = r.sender_membership_id)
   -- 행 h 직전의 받는 사람 = h 이상 판의 첫 인계 행이 넘겨준 사람, 없으면 지금 받는 사람
   OR EXISTS (SELECT 1 FROM workhub.cooperation_history h
               CROSS JOIN LATERAL (SELECT COALESCE((SELECT n.previous_recipient_membership_id FROM workhub.cooperation_history n
                                                     WHERE n.request_id = r.id AND n.action = 'handover' AND n.version >= h.version
                                                     ORDER BY n.version LIMIT 1), r.recipient_membership_id) AS before_recipient,
                                          COALESCE((SELECT n.previous_recipient_membership_id FROM workhub.cooperation_history n
                                                     WHERE n.request_id = r.id AND n.action = 'handover' AND n.version > h.version
                                                     ORDER BY n.version LIMIT 1), r.recipient_membership_id) AS after_recipient) x
               WHERE h.request_id = r.id AND h.version > 1
                 AND CASE WHEN h.action = 'handover'
                          THEN h.actor_membership_id <> x.after_recipient OR h.actor_membership_id = r.sender_membership_id
                          ELSE h.actor_membership_id NOT IN (r.sender_membership_id, x.before_recipient) END)
UNION ALL
SELECT 'P2-03-11', '학교 × 모듈 상태', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.module || '=' || a.state, ', ' ORDER BY s.code, a.module)
                 FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id), '(활성화 없음)')
ORDER BY 1;
