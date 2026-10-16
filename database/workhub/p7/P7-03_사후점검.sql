-- ============================================================================
-- P7-03  사후 점검 (읽기 전용). P7-02 뒤, P7-05 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 10 · 11 행은 정보(info):
--   P7-03-10 학교별 준비 상태 — P7-04 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드:모듈=준비 사유.
--   P7-03-11 R1 · P2 보강(P7-05) — '미적용'이면 마감 · 연장 · 수합/협업 인계는 NOT_READY(정상).
--   P7-03-12 — P7 함수 이름도 workhub_collection_ 으로 시작해 R1-04-03·04 의 값이 적용 전보다 2 커진다(FAIL 로 보여도 정상, 이 행이 ok 면).
-- ============================================================================
SELECT 'P7-03-01' AS no, '적용 기록 P7-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p7_installs') IS NOT NULL AND workhub_private.p7_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P7-03-02', '새 표 7개 + 적용 기록 · RLS 켜짐',
       CASE WHEN count(*) = 8 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p7_installs'), to_regclass('workhub.operation_requests'),
  to_regclass('workhub.collection_operations'), to_regclass('workhub.collection_operation_history'), to_regclass('workhub.collection_reminders'),
  to_regclass('workhub.transition_records'), to_regclass('workhub.transition_items'), to_regclass('workhub.transition_history'))
UNION ALL
SELECT 'P7-03-03', 'workhub·workhub_private 표에 API 역할 권한 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P7-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P7-03-05', '공개 함수 6개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 6 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
              AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('workhub_collection_operations_get','workhub_collection_operations_mutate',
  'workhub_home_overview','workhub_school_transition_list','workhub_school_transition_preview','workhub_school_transition_mutate')
UNION ALL
SELECT 'P7-03-06', '수합 운영: 판 = 2 + 이력 수 - 1 · 이력 판 2..n 빈칸 없음 · 마지막 이력의 단계 = 현재 단계', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.collection_operations o
WHERE o.version <> 1 + (SELECT count(*) FROM workhub.collection_operation_history h WHERE h.school_id = o.school_id AND h.collection_id = o.collection_id)
   OR (SELECT min(version) FROM workhub.collection_operation_history h WHERE h.school_id = o.school_id AND h.collection_id = o.collection_id) <> 2
   OR (SELECT phase_after FROM workhub.collection_operation_history h WHERE h.school_id = o.school_id AND h.collection_id = o.collection_id
        ORDER BY version DESC LIMIT 1) IS DISTINCT FROM o.phase
UNION ALL
SELECT 'P7-03-07', '수합 운영: 마지막 기한 이력 = R1 수합 기한(보강 전에는 기한 변경 0)', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.collection_operations o JOIN workhub.collections c ON c.school_id = o.school_id AND c.id = o.collection_id
WHERE (SELECT due_after FROM workhub.collection_operation_history h WHERE h.school_id = o.school_id AND h.collection_id = o.collection_id
        ORDER BY version DESC LIMIT 1) <> c.due_on
   OR (NOT workhub_private.p7_bridge() AND EXISTS (SELECT 1 FROM workhub.collection_operation_history h WHERE h.school_id = o.school_id
        AND h.collection_id = o.collection_id AND (h.due_before <> h.due_after OR h.kind <> 'remind')))
UNION ALL
SELECT 'P7-03-08', '인계 · 학년도 기록: 판 = 이력 수 · 첫 이력 apply · 인계 항목 1~200 · 새 학년도는 항목 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.transition_records t
WHERE t.version <> (SELECT count(*) FROM workhub.transition_history h WHERE h.record_id = t.id)
   OR NOT EXISTS (SELECT 1 FROM workhub.transition_history h WHERE h.record_id = t.id AND h.version = 1 AND h.action = 'apply'
                   AND h.actor_membership_id = t.requester_membership_id)
   OR (t.kind = 'handover' AND (SELECT count(*) FROM workhub.transition_items i WHERE i.record_id = t.id) NOT BETWEEN 1 AND 200)
   OR (t.kind = 'new_year' AND EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id))
UNION ALL
SELECT 'P7-03-09', '같은 자원이 대기 중인 인계 둘에 들어 있지 않음', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM (SELECT i.school_id, i.kind, i.resource_id FROM workhub.transition_items i JOIN workhub.transition_records t ON t.id = i.record_id
       WHERE t.state = 'pending' GROUP BY 1, 2, 3 HAVING count(*) > 1) d
UNION ALL
SELECT 'P7-03-10', '학교별 준비 상태', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.module || '=' || workhub_private.p7_reason(s.id, a.module), ', ' ORDER BY s.code, a.module)
                   FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
                  WHERE a.module IN ('collection_ops','home','transitions','duty_handover')), '(활성화 없음)')
UNION ALL
SELECT 'P7-03-11', 'R1 · P2 보강(P7-05)', 'info',
       CASE WHEN workhub_private.p7_bridge() THEN '적용됨(' || (SELECT installed_at::text FROM workhub_private.p7_installs WHERE batch = 'P7-05') || ')'
            ELSE '미적용 — 마감 · 보관 · 재개 · 연장 · 수합/협업 인계는 NOT_READY' END
UNION ALL
-- R1-04-03·04 는 이름이 workhub_collection_ 으로 시작하는 함수를 세는데, P7 공개 함수 2개(workhub_collection_operations_get · _mutate,
-- 이름은 앱 계약이 정함)도 그 이름이라 P7 뒤에는 그 두 행의 값이 적용 전보다 2 커서 FAIL 로 보인다(R1S 를 적용했다면 이미 FAIL 이었다).
-- 이 행은 그 2개가 P7 함수이고 R1 함수와 같은 규칙(authenticated 만 · SECURITY DEFINER · search_path 고정)인지 본다.
SELECT 'P7-03-12', 'R1-04-03·04 에 더해지는 P7 함수 2개(workhub_collection_operations_*) — 그 두 행 값 +2 는 정상',
       CASE WHEN count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                             AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('workhub_collection_operations_get', 'workhub_collection_operations_mutate')
ORDER BY 1;
