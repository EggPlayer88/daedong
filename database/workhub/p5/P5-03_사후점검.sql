-- ============================================================================
-- P5-03  사후 점검 (읽기 전용). P5-02 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 행은 학교별 준비 상태(info):
--   P5-04 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드=준비 사유 · 상담 정책.
-- ============================================================================
SELECT 'P5-03-01' AS no, '적용 기록 P5-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p5_installs') IS NOT NULL AND workhub_private.p5_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P5-03-02', '새 표 17개 + 적용 기록 · RLS 켜짐',
       CASE WHEN count(*) = 18 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p5_installs'), to_regclass('workhub.teaching_policies'), to_regclass('workhub.teaching_requests'),
  to_regclass('workhub.courses'), to_regclass('workhub.course_assignments'), to_regclass('workhub.students'), to_regclass('workhub.student_enrollments'),
  to_regclass('workhub.course_memberships'), to_regclass('workhub.activity_imports'), to_regclass('workhub.activity_items'),
  to_regclass('workhub.activity_item_revisions'), to_regclass('workhub.activity_item_omissions'), to_regclass('workhub.teaching_records'),
  to_regclass('workhub.teaching_record_revisions'), to_regclass('workhub.rubrics'), to_regclass('workhub.rubric_revisions'),
  to_regclass('workhub.assessments'), to_regclass('workhub.assessment_revisions'))
UNION ALL
SELECT 'P5-03-03', 'workhub·workhub_private 표에 API 역할 권한 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P5-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P5-03-05', '앱 함수 7개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 7 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_teaching\_%'
UNION ALL
SELECT 'P5-03-06', '관찰·상담: 현재 판 = 판 기록 마지막 · 판 1..최신 빈칸 없음 · 상태 일치', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.teaching_records r
WHERE (SELECT count(*) FROM workhub.teaching_record_revisions v WHERE v.record_id = r.id) <> r.version
   OR NOT EXISTS (SELECT 1 FROM workhub.teaching_record_revisions v WHERE v.id = r.current_revision_id AND v.record_id = r.id AND v.version = r.version
                   AND v.state = r.state)
UNION ALL
SELECT 'P5-03-07', '평가: 현재 판 = 판 기록 마지막 · 기준판은 같은 기준의 판 · 미확인 있으면 확정 아님', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.assessments a
WHERE (SELECT count(*) FROM workhub.assessment_revisions v WHERE v.assessment_id = a.id) <> a.version
   OR NOT EXISTS (SELECT 1 FROM workhub.assessment_revisions v WHERE v.id = a.current_revision_id AND v.assessment_id = a.id AND v.version = a.version
                   AND v.state = a.state)
   OR NOT EXISTS (SELECT 1 FROM workhub.rubric_revisions rv WHERE rv.id = a.rubric_revision_id AND rv.rubric_id = a.rubric_id)
UNION ALL
SELECT 'P5-03-08', '평가 기준: 현재 판 = 판 기록 마지막', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.rubrics r
WHERE (SELECT count(*) FROM workhub.rubric_revisions v WHERE v.rubric_id = r.id) <> r.version
   OR NOT EXISTS (SELECT 1 FROM workhub.rubric_revisions v WHERE v.id = r.current_revision_id AND v.version = r.version)
UNION ALL
SELECT 'P5-03-09', '활동: 행 연결판 = 행 기록 마지막 · 정정 계보는 1:1 · 같은 활동 회차의 현재판 하나', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM (SELECT t.id FROM workhub.activity_items t
       WHERE (SELECT count(*) FROM workhub.activity_item_revisions v WHERE v.item_id = t.id) <> t.mapping_version
          OR NOT EXISTS (SELECT 1 FROM workhub.activity_item_revisions v WHERE v.id = t.current_revision_id AND v.item_id = t.id
                          AND v.mapping_version = t.mapping_version AND v.disposition = t.disposition
                          AND v.student_id IS NOT DISTINCT FROM t.student_id)
      UNION ALL
      SELECT i.id FROM workhub.activity_imports i
       WHERE i.state = 'superseded' AND NOT EXISTS (SELECT 1 FROM workhub.activity_imports n WHERE n.id = i.superseded_by_import_id
                                                      AND n.supersedes_import_id = i.id)) x
UNION ALL
SELECT 'P5-03-10', '학생 연결: 수강은 같은 학생의 학적 · 기록은 그 수업의 수강', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.course_memberships m JOIN workhub.student_enrollments e ON e.id = m.enrollment_id
JOIN workhub.courses c ON c.id = m.course_id
WHERE e.student_id <> m.student_id OR e.academic_year_id <> c.academic_year_id
UNION ALL
SELECT 'P5-03-11', '학교별 준비 상태', 'info',
       COALESCE((SELECT string_agg(s.code || '=' || workhub_private.p5_reason(s.id) || COALESCE('·상담:' || p.counseling_scope, ''), ', ' ORDER BY s.code)
                   FROM workhub.schools s LEFT JOIN workhub.teaching_policies p ON p.school_id = s.id
                  WHERE EXISTS (SELECT 1 FROM workhub.module_activations a WHERE a.school_id = s.id AND a.module = 'teaching')), '(활성화 없음)')
ORDER BY 1;
