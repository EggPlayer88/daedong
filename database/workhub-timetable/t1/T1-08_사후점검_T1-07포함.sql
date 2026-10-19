-- ============================================================================
-- T1-08  시간표 1단계(T1-01~03 + T1-07) 사후 점검 (읽기 전용 — 아무것도 바꾸지 않는다. 언제 실행해도 된다)
--
-- ▣ T1-04 와 같은 점검에 T1-07(준비 대상 학기 고르기)을 더한 판이다. T1-07 을 적용하면 T1-04 는 표 개수(02) · 공개 함수(05 · 08) 행이
--   FAIL 로 나온다(T1-04 는 T1-07 을 모른다 — INT-03 이 T1 을 모르는 것과 같은 사정). T1-07 뒤에는 T1-04 대신 이 파일을 본다.
--   T1-07 전 DB 에서도 이 파일은 FAIL 0 이다(T1-07 행은 info "미적용"이고, 11 행은 T1-01 원본 그대로인지 본다).
-- ▣ 정확한 대조는 T1-09(1~8단계 + T1 + T1-07 통합 사후 점검)가 한다. T1-06 은 T1-07 뒤 FAIL 이 나므로 T1-09 를 본다.
-- ▣ 읽는 법: status 에 FAIL 이 없어야 한다. 09(켜기 상태) · 12(고른 준비 학기)는 info.
-- ============================================================================
WITH done AS (SELECT CASE WHEN to_regclass('workhub_private.t1_installs') IS NULL THEN ''
                          ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '','' ORDER BY batch) AS v FROM workhub_private.t1_installs',
                                                                             false, true, '')))[1]::text, '') END AS v),
has AS (SELECT b, (',' || (SELECT v FROM done) || ',') LIKE ('%,' || b || '@' || CASE b WHEN 'T1-07' THEN '2026-10-19.1' ELSE '2026-10-18.1' END || ',%') AS ok
          FROM unnest(ARRAY['T1-01','T1-02','T1-03','T1-07']) b),
pubs AS (SELECT p.oid, p.proname FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_%'),
pub_want(n, b) AS (VALUES ('workhub_timetable_readiness','T1-03'), ('workhub_timetable_get','T1-03'), ('workhub_timetable_save_draft','T1-03'),
  ('workhub_timetable_preparation_get','T1-03'), ('workhub_timetable_preparation_execute','T1-03'), ('workhub_timetable_setup_get','T1-03'),
  ('workhub_timetable_setup_execute','T1-03'), ('workhub_timetable_target_get','T1-07'), ('workhub_timetable_target_set','T1-07')),
pub_n AS (SELECT count(*) AS n FROM pub_want w JOIN has h ON h.b = w.b AND h.ok),
fn AS (SELECT p.proname, md5(replace(p.prosrc, chr(13), '')) AS body FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname IN ('t1_term','t1_term_auto')),
k7 AS (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE (conrelid = to_regclass('workhub_private.t1_installs') AND conname = 't1_installs_batch_check')
           OR (conrelid = to_regclass('workhub.timetable_requests') AND conname = 'timetable_requests_op_check')
           OR (conrelid = to_regclass('workhub.timetable_term_targets') AND conname = 'timetable_term_targets_term_fkey')),
tt AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r'),
tc AS (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass
        AND conname IN ('terms_timetable_basis_pending','terms_timetable_basis_fkey')),
want_tg(nsp, rel, tg) AS (VALUES ('workhub_private', 't1_installs', 't1_installs_immutable'),
  ('workhub', 'timetable_setup_history', 'timetable_setup_history_immutable'), ('workhub', 'timetable_source_marks', 'timetable_source_marks_immutable'),
  ('workhub', 'timetable_prep_draft_revisions', 'timetable_prep_draft_revisions_immutable'), ('workhub', 'timetable_basis_revisions', 'timetable_basis_revisions_immutable'),
  ('workhub', 'timetable_drafts', 'timetable_drafts_immutable'), ('workhub', 'timetable_requests', 'timetable_requests_immutable')),
api_roles AS (SELECT r.rolname, r.oid FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','service_role')),
api_priv AS (   -- T1 표(새 표 11개 + 적용 기록 표)에 API 역할 · PUBLIC 이 가진 권한: 표 단위 모든 종류 · 열 단위 · 직접 부여(ACL, MAINTAIN 포함)
  SELECT DISTINCT x.relname || ':' || x.who || ' ' || x.priv AS v FROM (
    SELECT t.relname, r.rolname AS who, k.priv FROM (SELECT oid, relname FROM tt UNION ALL SELECT to_regclass('workhub_private.t1_installs'), 't1_installs'
                                                      WHERE to_regclass('workhub_private.t1_installs') IS NOT NULL) t
      CROSS JOIN api_roles r CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) k(priv)
     WHERE has_table_privilege(r.oid, t.oid, k.priv)
        OR (k.priv IN ('SELECT','INSERT','UPDATE','REFERENCES') AND has_any_column_privilege(r.oid, t.oid, k.priv))
    UNION ALL
    SELECT c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE (SELECT rolname FROM api_roles WHERE oid = a.grantee) END, a.privilege_type
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
     WHERE c.oid IN (SELECT oid FROM tt UNION ALL SELECT to_regclass('workhub_private.t1_installs'))
       AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM api_roles))
    UNION ALL
    SELECT c.relname, CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE (SELECT rolname FROM api_roles WHERE oid = a.grantee) END, a.privilege_type || '(열 ' || att.attname || ')'
      FROM pg_attribute att JOIN pg_class c ON c.oid = att.attrelid CROSS JOIN LATERAL aclexplode(att.attacl) a
     WHERE c.oid IN (SELECT oid FROM tt UNION ALL SELECT to_regclass('workhub_private.t1_installs')) AND att.attacl IS NOT NULL
       AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM api_roles))) x),
api_exec AS (SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
SELECT 'T1-08-01' AS no, '적용 기록(T1-01~03 판 2026-10-18.1 · T1-07 판 2026-10-19.1, 순서대로)' AS item,
       CASE WHEN NOT EXISTS (SELECT 1 FROM has WHERE ok) THEN 'info'
            WHEN (SELECT ok FROM has WHERE b = 'T1-03') AND NOT (SELECT ok FROM has WHERE b = 'T1-02') THEN 'FAIL'
            WHEN (SELECT ok FROM has WHERE b = 'T1-02') AND NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'FAIL'
            WHEN (SELECT ok FROM has WHERE b = 'T1-07') AND NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'FAIL' ELSE 'ok' END AS status,
       COALESCE(NULLIF(replace((SELECT v FROM done), ',', ' · '), ''), '미적용') AS value
UNION ALL
SELECT 'T1-08-02', 'T1 표(새 표 11개 · T1-07 뒤 12개 · 적용 기록 표): RLS 켜짐 · API 역할 · PUBLIC 권한 0(표 · 열 단위 모든 종류 — SELECT~TRIGGER · TRUNCATE · MAINTAIN 포함)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            WHEN (SELECT count(*) FROM tt JOIN pg_class c ON c.oid = tt.oid WHERE c.relrowsecurity) = (SELECT count(*) FROM tt)
             AND (SELECT count(*) FROM tt) = CASE WHEN (SELECT ok FROM has WHERE b = 'T1-07') THEN 12 ELSE 11 END
             AND NOT EXISTS (SELECT 1 FROM api_priv) THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN '미적용'
            ELSE (SELECT count(*) FROM tt)::text || '개' || COALESCE(' — 권한 있음: ' || (SELECT string_agg(v, ', ' ORDER BY v) FROM (SELECT v FROM api_priv ORDER BY v LIMIT 5) z), '') END
UNION ALL
SELECT 'T1-08-03', 'T1 내부 함수 t1_* 는 API 역할이 실행할 수 없음',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info' WHEN NOT EXISTS (SELECT 1 FROM api_exec) THEN 'ok' ELSE 'FAIL' END,
       COALESCE((SELECT string_agg(proname, ', ') FROM api_exec), '')
UNION ALL
SELECT 'T1-08-04', 'T1-02 학기 기준판 칸: R0 CHECK 없음 · 같은 학교 · 같은 학기 복합 FK (INT-03 의 terms_timetable_basis_pending 행 차이는 이 교체)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-02')
              THEN CASE WHEN (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_pending') = 'CHECK ((current_timetable_basis_id IS NULL))'
                         AND NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_fkey') THEN 'info' ELSE 'FAIL' END
            WHEN NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_pending')
             AND (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_fkey')
                 = 'FOREIGN KEY (school_id, current_timetable_basis_id, id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id)'
            THEN 'ok' ELSE 'FAIL' END,
       COALESCE((SELECT string_agg(conname || ': ' || def, ' / ' ORDER BY conname) FROM tc), '')
UNION ALL
SELECT 'T1-08-05', '공개 함수(T1-03 7개 · T1-07 2개)는 승인된 이름만 · authenticated 만(anon · service_role 불가) · SECURITY DEFINER · search_path 비움',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'info'
            WHEN (SELECT count(*) FROM pubs) = (SELECT n FROM pub_n)
             AND NOT EXISTS (SELECT 1 FROM pubs WHERE proname NOT IN (SELECT w.n FROM pub_want w JOIN has h ON h.b = w.b AND h.ok))
             AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                                  AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND p.prosecdef
                                  AND p.proconfig = ARRAY['search_path=""'])
                    FROM pg_proc p WHERE p.oid IN (SELECT oid FROM pubs)) THEN 'ok' ELSE 'FAIL' END,
       (SELECT count(*) FROM pubs)::text || '개'
UNION ALL
-- 아래 두 행은 T1-01 의 표 · 함수를 쓰므로 문자열 질의로 읽는다(미적용이면 실행하지 않음)
SELECT 'T1-08-06', '기준판 본문: 행과 같은 학교 · 학기 · 판 · 지문, 앱 validateBasis 검산 통과, 학기 칸은 그 학기의 기준판만',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            WHEN (xpath('/row/v/text()', query_to_xml($q$SELECT (SELECT count(*) FROM workhub.timetable_basis_revisions b
                    WHERE cardinality(workhub_private.t1_basis_issues(b.basis)) > 0 OR b.basis ->> 'schoolId' <> b.school_id OR b.basis ->> 'termId' <> b.term_id)
                  + (SELECT count(*) FROM workhub.terms t WHERE t.current_timetable_basis_id IS NOT NULL
                      AND NOT EXISTS (SELECT 1 FROM workhub.timetable_basis_revisions b WHERE b.id = t.current_timetable_basis_id
                                        AND b.school_id = t.school_id AND b.term_id = t.id)) AS v$q$,
                    false, true, '')))[1]::text = '0'
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'T1-01')
            THEN (xpath('/row/v/text()', query_to_xml($q$SELECT '기준판 ' || (SELECT count(*) FROM workhub.timetable_basis_revisions) || '개 · 현재로 걸린 학기 '
                    || (SELECT count(*) FROM workhub.terms WHERE current_timetable_basis_id IS NOT NULL) || '개 · 편성 초안 '
                    || (SELECT count(*) FROM workhub.timetable_drafts) || '개' AS v$q$, false, true, '')))[1]::text
            ELSE '미적용' END
UNION ALL
SELECT 'T1-08-07', '담당자 입력: 정원 없는 공간이 기준판 자원에 들어가지 않음(정책 2 — 1 로 채우지 않음)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            -- 기준판의 공간 자원마다: 그 공간의 입력 이력에 같은 정원(숫자)이 있어야 한다 — 정원은 담당자 입력에서만 온다
            WHEN (xpath('/row/v/text()', query_to_xml($q$SELECT count(*) AS v FROM workhub.timetable_basis_revisions b, jsonb_array_elements(b.basis -> 'resources') r
                   WHERE r ->> 'kind' IN ('room','equipment')
                     AND NOT EXISTS (SELECT 1 FROM workhub.timetable_setup_history h WHERE h.school_id = b.school_id AND h.target_kind = 'space'
                                       AND h.target_id = r ->> 'id' AND jsonb_typeof(h.state -> 'capacity') = 'number'
                                       AND h.state -> 'capacity' = r -> 'capacity')$q$, false, true, '')))[1]::text = '0'
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'T1-01')
            THEN (xpath('/row/v/text()', query_to_xml($q$SELECT '공간 ' || (SELECT count(*) FROM workhub.timetable_spaces WHERE removed_at IS NULL) || '개(정원 미입력 '
                    || (SELECT count(*) FROM workhub.timetable_spaces WHERE removed_at IS NULL AND capacity IS NULL) || ') · 수업 연결 '
                    || (SELECT count(*) FROM workhub.timetable_course_links) || '개' AS v$q$, false, true, '')))[1]::text
            ELSE '미적용' END
UNION ALL
SELECT 'T1-08-08', 'T1 은 기존 함수를 바꾸지 않음(공개 함수는 05 의 승인된 이름뿐 · 기존 함수 본문은 T1-00 지문 S4)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'info'
            WHEN NOT EXISTS (SELECT 1 FROM pubs WHERE proname NOT IN (SELECT n FROM pub_want)) THEN 'ok' ELSE 'FAIL' END,
       '기존 함수 본문은 T1-00 지문 S4 로 확인'
UNION ALL
SELECT 'T1-08-09', '켜기 상태(info) — 켜기는 입력 화면 배포 뒤 T1-05 로만', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.state, ', ' ORDER BY s.code)
                   FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id WHERE a.module = 'timetable'), '(활성화 없음)')
UNION ALL
-- 보호 트리거는 이름으로 하나씩 본다(접두어 · 개수가 아니라). 꺼 둔(tgenabled <> 'O') 트리거는 고칠 수 없다는 보장을 잃으므로 FAIL.
SELECT 'T1-08-10', 'T1 보호 트리거 7개: 승인된 이름 그대로 있고 켜져 있음(그 밖의 트리거 없음) — 정의 대조는 T1-09',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            WHEN (SELECT count(*) FROM want_tg w JOIN pg_trigger g ON g.tgname = w.tg AND NOT g.tgisinternal AND g.tgenabled = 'O'
                    JOIN pg_class c ON c.oid = g.tgrelid AND c.relname = w.rel JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = w.nsp) = 7
             AND (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                   WHERE NOT g.tgisinternal AND ((n.nspname = 'workhub' AND c.relname IN (SELECT relname FROM tt)) OR (n.nspname = 'workhub_private' AND c.relname = 't1_installs'))) = 7
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN '미적용'
            ELSE COALESCE((SELECT string_agg(w.rel || '.' || w.tg || CASE WHEN g.oid IS NULL THEN '(없음)' ELSE '(꺼짐 ' || g.tgenabled::text || ')' END, ', ' ORDER BY w.rel)
                             FROM want_tg w LEFT JOIN (pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace)
                               ON g.tgname = w.tg AND c.relname = w.rel AND n.nspname = w.nsp AND NOT g.tgisinternal
                            WHERE g.oid IS NULL OR g.tgenabled <> 'O'), '7개 켜짐') END
UNION ALL
-- T1-07: 대상 학기 함수 · 넓힌 제약. 적용 전에는 T1-01 원본(t1_term 본문 · 제약 2개)이어야 한다.
SELECT 'T1-08-11', 'T1-07 대상 학기: t1_term = 고른 학기 우선 · t1_term_auto = T1-01 원래 규칙 그대로 · 넓힌 제약 2개 · 학기 빼기는 고른 칸만 비움(SET NULL)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'info'
            WHEN NOT (SELECT ok FROM has WHERE b = 'T1-07')
              THEN CASE WHEN (SELECT body FROM fn WHERE proname = 't1_term') = 'f10433b8053c12ab1cb4686aa34b70ac' AND NOT EXISTS (SELECT 1 FROM fn WHERE proname = 't1_term_auto')
                         AND (SELECT def FROM k7 WHERE conname = 't1_installs_batch_check') = 'CHECK ((batch = ANY (ARRAY[''T1-01''::text, ''T1-02''::text, ''T1-03''::text])))'
                         AND (SELECT def FROM k7 WHERE conname = 'timetable_requests_op_check') = 'CHECK ((op = ANY (ARRAY[''preparation''::text, ''save_draft''::text, ''setup''::text])))'
                         AND to_regclass('workhub.timetable_term_targets') IS NULL THEN 'info' ELSE 'FAIL' END
            WHEN (SELECT body FROM fn WHERE proname = 't1_term') = '72c8068496d66420f71f21bb3d24796f'
             AND (SELECT body FROM fn WHERE proname = 't1_term_auto') = 'f10433b8053c12ab1cb4686aa34b70ac'
             AND (SELECT def FROM k7 WHERE conname = 't1_installs_batch_check') = 'CHECK ((batch = ANY (ARRAY[''T1-01''::text, ''T1-02''::text, ''T1-03''::text, ''T1-07''::text])))'
             AND (SELECT def FROM k7 WHERE conname = 'timetable_requests_op_check') = 'CHECK ((op = ANY (ARRAY[''preparation''::text, ''save_draft''::text, ''setup''::text, ''target''::text])))'
             AND (SELECT def FROM k7 WHERE conname = 'timetable_term_targets_term_fkey') = 'FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id) ON DELETE SET NULL (term_id)'
            THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'T1-07') THEN '적용' ELSE '미적용(T1-01 원본 확인)' END
UNION ALL
SELECT 'T1-08-12', '고른 준비 학기(info) — 학교: 고른 학기 → 지금 대상 학기. 고르지 않았으면 원래 규칙(오늘이 든 학기)', 'info',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-07') THEN '미적용'
            ELSE COALESCE((xpath('/row/v/text()', query_to_xml($q$SELECT string_agg(s.code || ': ' || COALESCE(ts.label || '(' || y.school_year || ')', '고르지 않음')
                    || ' → ' || COALESCE((SELECT t2.label || '(' || y2.school_year || ')' FROM workhub.terms t2 JOIN workhub.academic_years y2 ON y2.id = t2.academic_year_id
                                           WHERE t2.id = workhub_private.t1_term(s.id, workhub_private.today_in(s.timezone))), '없음') || ' · 판 ' || g.version, ', ' ORDER BY s.code) AS v
                    FROM workhub.timetable_term_targets g JOIN workhub.schools s ON s.id = g.school_id
                    LEFT JOIN workhub.terms ts ON ts.id = g.term_id LEFT JOIN workhub.academic_years y ON y.id = ts.academic_year_id$q$,
                    false, true, '')))[1]::text, '(고른 학교 없음 — 모두 원래 규칙)') END
ORDER BY 1;
