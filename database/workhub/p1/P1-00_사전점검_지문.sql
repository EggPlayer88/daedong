-- ============================================================================
-- P1-00  사전 점검 · 전후 지문 (읽기 전용 — 아무것도 만들거나 바꾸지 않는다)
--
-- ▣ 언제: (1) P1-01 실행 "전" 한 번, (2) P1-03(사후 점검) 실행 "후" 한 번. 결과를 각각 저장해 둔다.
-- ▣ 읽는 법
--   kind = '점검'  지금 상태. 실행 전에는 status 가 모두 ok·info 여야 P1-01 로 넘어간다. FAIL 이면 멈추고 note 를 알려 주세요.
--   kind = '변경'  P1 이 의도적으로 바꾸는 것. 실행 전·후 값이 달라지는 것이 정상이다(note 에 기대값).
--   kind = '지문'  P1 이 건드리면 안 되는 것의 요약값. 실행 전·후 두 결과의 '지문' 행이 모두 같아야 한다.
-- ▣ 지문 범위 — public · auth · storage · workhub · workhub_private · workhub_storage 전체에서 P1 이 만들거나 바꾸는 것만 뺀 나머지
--   S1 열 · S2 제약(넓히는 3개 제외) · S3 트리거 · S4 함수 본문·설정·권한(교체 2개·새 함수 제외) · S5 표 권한 · S6 RLS 정책
--   D1 기존 표 전부의 행 수·행 해시(P1 새 표 제외). P1-01·02 는 기존 표에 행을 쓰지 않는다.
--   ※ P1-04(활성화)는 감사 1건을 쓰므로 D1 비교는 P1-03 까지. 실제 운영 DB 에서 두 번 실행하는 사이에 교사가 쓰면
--     D1 이 달라질 수 있다 — 그때는 S1~S6(구조)만 반드시 같아야 한다.
-- ▣ R1-00 · R1S-00 의 R0 함수 지문(member_relations · workhub_context 포함)은 P1 적용 뒤 달라진다(의도한 교체).
-- ============================================================================
WITH
sch AS (SELECT oid, nspname FROM pg_namespace WHERE nspname IN ('public','auth','storage','workhub','workhub_private','workhub_storage')),
p1_tables(t) AS (VALUES ('workhub_private.p1_installs'),('workhub.school_admin_activations'),('workhub.year_departments'),
  ('workhub.year_classes'),('workhub.year_subjects'),('workhub.staff_assignments'),('workhub.school_admin_changes')),
p1_rel AS (SELECT to_regclass(t) AS oid FROM p1_tables WHERE to_regclass(t) IS NOT NULL),
widened(c) AS (VALUES ('schools_grade_count_check'),('terms_label_check'),('terms_no_overlap')),
replaced(n) AS (VALUES ('member_relations'),('workhub_context')),
rels AS (SELECT c.oid, c.relname, n.nspname FROM pg_class c JOIN sch n ON n.oid = c.relnamespace
          WHERE c.relkind IN ('r','p','v','m') AND c.oid NOT IN (SELECT oid FROM p1_rel)),
fns AS (SELECT p.oid, p.proname, n.nspname FROM pg_proc p JOIN sch n ON n.oid = p.pronamespace
         WHERE NOT (p.proname LIKE 'p1\_%' OR p.proname LIKE 'workhub\_school\_admin\_%' OR p.proname IN (SELECT n FROM replaced))),
cur_md5 AS (SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS h FROM pg_proc p
             WHERE (p.pronamespace = to_regnamespace('workhub_private') AND p.proname = 'member_relations')
                OR (p.pronamespace = 'public'::regnamespace AND p.proname = 'workhub_context')),
data AS (SELECT r.nspname || '.' || r.relname AS t,
                (xpath('/row/v/text()', query_to_xml(format(
                   'SELECT count(*) || '':'' || md5(COALESCE(string_agg(x::text, chr(10) ORDER BY x::text), '''')) AS v FROM %I.%I x', r.nspname, r.relname),
                   false, true, '')))[1]::text AS v
           FROM rels r JOIN pg_class c ON c.oid = r.oid WHERE c.relkind IN ('r','p'))
SELECT '점검' AS kind, 'C1 R0·R1(2026-10-15.1) 적용' AS part,
       CASE WHEN to_regclass('workhub_private.batch_installs') IS NOT NULL AND to_regclass('workhub.schools') IS NOT NULL
             AND (xpath('/row/v/text()', query_to_xml('SELECT count(*) AS v FROM workhub_private.batch_installs WHERE batch IN (''R1-01'',''R1-02'',''R1-03'') AND release = ''2026-10-15.1''', false, true, '')))[1]::text = '3'
            THEN 'ok' ELSE 'FAIL' END AS status, NULL::text AS fingerprint, NULL::bigint AS items,
       'FAIL 이면 R0·R1 이 덜 적용된 것. 다시 실행하지 말고 결과를 알려 주세요.' AS note
UNION ALL
SELECT '점검', 'C2 활성 학교', CASE WHEN (SELECT count(*) FROM workhub.schools WHERE status = 'active') >= 1 THEN 'ok' ELSE 'FAIL' END,
       NULL, (SELECT count(*) FROM workhub.schools WHERE status = 'active'), '활성 학교가 1개 이상(대동여중)'
UNION ALL
SELECT '점검', 'C3 학교급별 학년 수(앱 범위: 초 6 · 중고 3 · 특수/기타 20)',
       CASE WHEN EXISTS (SELECT 1 FROM workhub.schools WHERE grade_count > CASE school_level WHEN 'elementary' THEN 6 WHEN 'middle' THEN 3 WHEN 'high' THEN 3 ELSE 20 END)
            THEN 'WARN' ELSE 'ok' END, NULL, NULL,
       'WARN 이면 설치는 되지만 그 학교는 P1-04(활성화)가 멈춘다. 학년 수를 먼저 확인해야 한다.'
UNION ALL
SELECT '점검', 'C4 학년도마다 학기 1~4개',
       CASE WHEN EXISTS (SELECT 1 FROM workhub.academic_years y WHERE (SELECT count(*) FROM workhub.terms t WHERE t.academic_year_id = y.id) NOT BETWEEN 1 AND 4)
            THEN 'WARN' ELSE 'ok' END, NULL, (SELECT count(*) FROM workhub.academic_years),
       'WARN 이면 그 학교는 P1-04(활성화)가 멈춘다(앱 화면이 학기 0개 구성을 받지 않음).'
UNION ALL
SELECT '점검', 'C5 P1 적용 단계', 'info', NULL, NULL,
       CASE WHEN to_regclass('workhub_private.p1_installs') IS NULL THEN '미적용(P1-01 전)'
            ELSE (xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '', '' ORDER BY batch) AS v FROM workhub_private.p1_installs', false, true, '')))[1]::text END
UNION ALL
SELECT '변경', 'V1 member_relations · workhub_context 본문', 'info',
       (SELECT string_agg(proname || '=' || h, ' ' ORDER BY proname) FROM cur_md5), NULL,
       '전: member_relations=076c9721… workhub_context=05f07d50… / 후: member_relations=2b743362… workhub_context=0417b05e…'
UNION ALL
SELECT '변경', 'V2 넓히는 제약 3개', 'info',
       (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ' | ' ORDER BY k.conname) FROM pg_constraint k WHERE k.conname IN (SELECT c FROM widened)), NULL,
       '전: 학년 <= 6 · 학기 이름 <= 30 · 학기 중첩(즉시) / 후: <= 20 · <= 50 · DEFERRABLE'
UNION ALL
SELECT '변경', 'V3 P1 새 표', 'info', NULL, (SELECT count(*) FROM p1_rel), '전 0 / 후 7'
UNION ALL
SELECT '지문', 'S1 열', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull
                     || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), chr(10) ORDER BY r.nspname, r.relname, a.attnum)
                     FROM rels r JOIN pg_attribute a ON a.attrelid = r.oid AND a.attnum > 0 AND NOT a.attisdropped
                     LEFT JOIN pg_attrdef d ON d.adrelid = r.oid AND d.adnum = a.attnum), '')),
       (SELECT count(*) FROM rels), '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S2 제약(넓히는 3개 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || k.conname || ':' || pg_get_constraintdef(k.oid), chr(10) ORDER BY r.nspname, r.relname, k.conname)
                     FROM rels r JOIN pg_constraint k ON k.conrelid = r.oid WHERE k.conname NOT IN (SELECT c FROM widened)), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S3 트리거', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || g.tgname || ':' || pg_get_triggerdef(g.oid), chr(10) ORDER BY r.nspname, r.relname, g.tgname)
                     FROM rels r JOIN pg_trigger g ON g.tgrelid = r.oid AND NOT g.tgisinternal), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S4 함수(교체 2개·P1 새 함수 제외)', 'ok',
       md5(COALESCE((SELECT string_agg(f.nspname || '.' || f.proname || '(' || pg_get_function_identity_arguments(p.oid) || '):'
                     || md5(replace(p.prosrc, chr(13), '')) || ':' || p.prosecdef || ':' || COALESCE(array_to_string(p.proconfig, ','), '')
                     || ':' || COALESCE(array_to_string(p.proacl, ','), ''), chr(10) ORDER BY f.nspname, f.proname, pg_get_function_identity_arguments(p.oid))
                     FROM fns f JOIN pg_proc p ON p.oid = f.oid), '')),
       (SELECT count(*) FROM fns), '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S5 표 권한', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || ':' || COALESCE(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity, chr(10) ORDER BY r.nspname, r.relname)
                     FROM rels r JOIN pg_class c ON c.oid = r.oid), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'S6 RLS 정책', 'ok',
       md5(COALESCE((SELECT string_agg(r.nspname || '.' || r.relname || '.' || pol.polname || ':' || pol.polcmd::text || ':' || COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '')
                     || ':' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), ''), chr(10) ORDER BY r.nspname, r.relname, pol.polname)
                     FROM rels r JOIN pg_policy pol ON pol.polrelid = r.oid), '')),
       NULL, '실행 전·후 같아야 한다'
UNION ALL
SELECT '지문', 'D1 기존 표 행 수·행 해시', 'ok',
       md5(COALESCE((SELECT string_agg(t || '=' || v, chr(10) ORDER BY t) FROM data), '')),
       (SELECT count(*) FROM data), '실행 전·후 같아야 한다(그사이 사용이 있었다면 달라질 수 있음 — 위 머리말)'
ORDER BY 1 DESC, 2;
