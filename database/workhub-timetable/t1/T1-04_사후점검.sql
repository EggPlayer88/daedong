-- ============================================================================
-- T1-04  시간표 1단계(T1) 사후 점검 (읽기 전용 — 아무것도 바꾸지 않는다. 언제 실행해도 된다)
--
-- ▣ 무엇을 보나: 적용한 T1 파일(T1-01~03)마다 만든 · 바꾼 것이 제자리에 있는지, 권한이 닫혀 있는지, 쌓인 기준판이 앱 검사를 통과하는지,
--   켜기 상태가 어떤지. 적용하지 않은 파일의 행은 info("미적용")로 나온다(T1-01 → 02 → 03 순서로 하나씩 적용해도 된다).
-- ▣ 정확한 대조는 T1-06(1~8단계 + T1 통합 사후 점검)이 한다: T1 객체의 이름 · 정의 · 권한 · 트리거 켜짐 상태와,
--   기존 객체가 "T1-02 의 학기 제약 교체" 외에는 1~8단계 목록과 같은지. 이 파일은 T1 이 제자리에 있고 쓸 만한지를 빠르게 본다.
--   INT-03(1~8단계)은 T1 을 몰라 03 · 09 · 10 행이 FAIL 로 나온다 — T1 뒤에는 INT-03 대신 T1-06 을 본다.
-- ▣ 읽는 법: status 에 FAIL 이 없어야 한다. T1-04-09 는 켜기 상태(info) — 켜기는 입력 화면 배포 뒤 T1-05 로만.
-- ============================================================================
WITH done AS (SELECT CASE WHEN to_regclass('workhub_private.t1_installs') IS NULL THEN ''
                          ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '','' ORDER BY batch) AS v FROM workhub_private.t1_installs',
                                                                             false, true, '')))[1]::text, '') END AS v),
has AS (SELECT b, (',' || (SELECT v FROM done) || ',') LIKE ('%,' || b || '@2026-10-18.1,%') AS ok FROM unnest(ARRAY['T1-01','T1-02','T1-03']) b),
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
SELECT 'T1-04-01' AS no, '적용 기록(판 2026-10-18.1, 순서대로)' AS item,
       CASE WHEN NOT EXISTS (SELECT 1 FROM has WHERE ok) THEN 'info'
            WHEN (SELECT ok FROM has WHERE b = 'T1-03') AND NOT (SELECT ok FROM has WHERE b = 'T1-02') THEN 'FAIL'
            WHEN (SELECT ok FROM has WHERE b = 'T1-02') AND NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'FAIL' ELSE 'ok' END AS status,
       COALESCE(NULLIF(replace((SELECT v FROM done), ',', ' · '), ''), '미적용') AS value
UNION ALL
SELECT 'T1-04-02', 'T1 표(새 표 11개 · 적용 기록 표): RLS 켜짐 · API 역할 · PUBLIC 권한 0(표 · 열 단위 모든 종류 — SELECT~TRIGGER · TRUNCATE · MAINTAIN 포함)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            WHEN (SELECT count(*) FROM tt JOIN pg_class c ON c.oid = tt.oid WHERE c.relrowsecurity) = 11 AND (SELECT count(*) FROM tt) = 11
             AND NOT EXISTS (SELECT 1 FROM api_priv) THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN '미적용'
            ELSE (SELECT count(*) FROM tt)::text || '개' || COALESCE(' — 권한 있음: ' || (SELECT string_agg(v, ', ' ORDER BY v) FROM (SELECT v FROM api_priv ORDER BY v LIMIT 5) z), '') END
UNION ALL
SELECT 'T1-04-03', 'T1 내부 함수 t1_* 는 API 역할이 실행할 수 없음',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info' WHEN NOT EXISTS (SELECT 1 FROM api_exec) THEN 'ok' ELSE 'FAIL' END,
       COALESCE((SELECT string_agg(proname, ', ') FROM api_exec), '')
UNION ALL
SELECT 'T1-04-04', 'T1-02 학기 기준판 칸: R0 CHECK 없음 · 같은 학교 · 같은 학기 복합 FK (INT-03 의 terms_timetable_basis_pending 행 차이는 이 교체)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-02')
              THEN CASE WHEN (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_pending') = 'CHECK ((current_timetable_basis_id IS NULL))'
                         AND NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_fkey') THEN 'info' ELSE 'FAIL' END
            WHEN NOT EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_pending')
             AND (SELECT def FROM tc WHERE conname = 'terms_timetable_basis_fkey')
                 = 'FOREIGN KEY (school_id, current_timetable_basis_id, id) REFERENCES workhub.timetable_basis_revisions(school_id, id, term_id)'
            THEN 'ok' ELSE 'FAIL' END,
       COALESCE((SELECT string_agg(conname || ': ' || def, ' / ' ORDER BY conname) FROM tc), '')
UNION ALL
SELECT 'T1-04-05', 'T1-03 공개 함수 7개는 authenticated 만(anon · service_role 불가)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'info'
            WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_%') = 7
             AND (SELECT bool_and(has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                                  AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE') AND p.prosecdef
                                  AND p.proconfig = ARRAY['search_path=""'])
                    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_%') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
-- 아래 두 행은 T1-01 의 표 · 함수를 쓰므로 문자열 질의로 읽는다(미적용이면 실행하지 않음)
SELECT 'T1-04-06', '기준판 본문: 행과 같은 학교 · 학기 · 판 · 지문, 앱 validateBasis 검산 통과, 학기 칸은 그 학기의 기준판만',
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
SELECT 'T1-04-07', '담당자 입력: 정원 없는 공간이 기준판 자원에 들어가지 않음(정책 2 — 1 로 채우지 않음)',
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
SELECT 'T1-04-08', 'T1 은 기존 함수를 바꾸지 않음(같은 이름 공개 함수 7개 외 workhub_timetable_* 없음)',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-03') THEN 'info'
            WHEN NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_%'
                               AND proname NOT IN ('workhub_timetable_readiness','workhub_timetable_get','workhub_timetable_save_draft',
                                                   'workhub_timetable_preparation_get','workhub_timetable_preparation_execute',
                                                   'workhub_timetable_setup_get','workhub_timetable_setup_execute')) THEN 'ok' ELSE 'FAIL' END,
       '기존 함수 본문은 T1-00 지문 S4 로 확인'
UNION ALL
SELECT 'T1-04-09', '켜기 상태(info) — 켜기는 입력 화면 배포 뒤 T1-05 로만', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.state, ', ' ORDER BY s.code)
                   FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id WHERE a.module = 'timetable'), '(활성화 없음)')
UNION ALL
-- 보호 트리거는 이름으로 하나씩 본다(접두어 · 개수가 아니라). 꺼 둔(tgenabled <> 'O') 트리거는 고칠 수 없다는 보장을 잃으므로 FAIL.
SELECT 'T1-04-10', 'T1 보호 트리거 7개: 승인된 이름 그대로 있고 켜져 있음(그 밖의 트리거 없음) — 정의 대조는 T1-06',
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
ORDER BY 1;
