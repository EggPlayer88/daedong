-- ============================================================================
-- P1-03  사후 점검 (읽기 전용) — P1-01·02 적용 뒤, P1-04 뒤, 그리고 아무 때나
--
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 행(P1-03-12)은 학교별 학교 관리 상태:
--   P1-04 전에는 not_configured(정상), P1-04 뒤에는 active · 판(revision) 표시.
-- ============================================================================
SELECT 'P1-03-01' AS no, '적용 기록 P1-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p1_installs') IS NOT NULL AND workhub_private.p1_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P1-03-02', '새 표 7개 · RLS 켜짐',
       CASE WHEN count(*) = 7 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p1_installs'), to_regclass('workhub.school_admin_activations'),
  to_regclass('workhub.year_departments'), to_regclass('workhub.year_classes'), to_regclass('workhub.year_subjects'),
  to_regclass('workhub.staff_assignments'), to_regclass('workhub.school_admin_changes'))
UNION ALL
SELECT 'P1-03-03', 'workhub·workhub_private 표에 API 역할 권한 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind = 'r'
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P1-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P1-03-05', '학교 관리 공개 함수 3개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 3 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
             AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND p.prosecdef AND p.proconfig @> ARRAY['search_path=""']) THEN 'ok' ELSE 'FAIL' END,
       count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_school\_admin\_%'
UNION ALL
SELECT 'P1-03-06', '교체 함수 2개가 P1 판(member_relations · workhub_context)',
       CASE WHEN count(*) = 2 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p
WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname = 'member_relations' AND md5(replace(p.prosrc, chr(13), '')) = '2b7433625b40743abc55830a71d6be78')
   OR (p.pronamespace = 'public'::regnamespace AND p.proname = 'workhub_context' AND md5(replace(p.prosrc, chr(13), '')) = '0417b05eb1424b45f3f2eeda640b9c93')
UNION ALL
SELECT 'P1-03-07', 'R0 호환 함수 7개는 그대로 authenticated 만',
       CASE WHEN count(*) = 7 AND bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END,
       count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('workhub_context','workhub_calendar_list','workhub_calendar_get','workhub_calendar_save','workhub_task_list','workhub_task_get','workhub_task_mutate')
UNION ALL
SELECT 'P1-03-08', '넓힌 제약 3개',
       CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'schools_grade_count_check' AND conrelid = 'workhub.schools'::regclass) LIKE '%<= 20%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'terms_label_check' AND conrelid = 'workhub.terms'::regclass) LIKE '%<= 50%'
             AND (SELECT condeferrable AND NOT condeferred FROM pg_constraint WHERE conname = 'terms_no_overlap' AND conrelid = 'workhub.terms'::regclass)
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P1-03-09', '공식 담당이 소속·학년도 기간 안',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.staff_assignments a JOIN workhub.memberships m ON m.school_id = a.school_id AND m.id = a.membership_id
JOIN workhub.academic_years y ON y.school_id = a.school_id AND y.id = a.academic_year_id
WHERE a.valid_from < m.valid_from OR (m.valid_to IS NOT NULL AND a.valid_to > m.valid_to) OR a.valid_from < y.starts_on OR a.valid_to > y.ends_on
UNION ALL
SELECT 'P1-03-10', '변경 원장 판 = 활성화 판 - 1 (학교별)',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.school_admin_activations a
WHERE a.revision - 1 <> (SELECT count(*) FROM workhub.school_admin_changes c WHERE c.school_id = a.school_id)
UNION ALL
SELECT 'P1-03-11', '학교 관리 접수증 = 변경 원장 건수',
       CASE WHEN (SELECT count(*) FROM workhub.idempotency_receipts WHERE operation = 'school_admin.mutate')
               = (SELECT count(*) FROM workhub.school_admin_changes) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*) FROM workhub.school_admin_changes)::text
UNION ALL
SELECT 'P1-03-12', '학교별 학교 관리 상태', 'info',
       COALESCE((SELECT string_agg(s.code || '=' || COALESCE(a.state || '@' || a.revision, 'not_configured'), ', ' ORDER BY s.code)
                 FROM workhub.schools s LEFT JOIN workhub.school_admin_activations a ON a.school_id = s.id), '')
ORDER BY 1;
