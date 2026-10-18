-- ============================================================================
-- T1-04  시간표 1단계(T1) 사후 점검 (읽기 전용 — 아무것도 바꾸지 않는다. 언제 실행해도 된다)
--
-- ▣ 무엇을 보나: 적용한 T1 파일(T1-01~03)마다 만든 · 바꾼 것이 제자리에 있는지, 권한이 닫혀 있는지, 쌓인 기준판이 앱 검사를 통과하는지,
--   켜기 상태가 어떤지. 적용하지 않은 파일의 행은 info("미적용")로 나온다(T1-01 → 02 → 03 순서로 하나씩 적용해도 된다).
-- ▣ INT-03(1~8단계 통합 사후 점검)과의 관계: INT-03 은 R0 의 terms_timetable_basis_pending 정의를 원본 해시로 고정해 두었다.
--   T1-02 뒤에는 INT-03 의 그 한 행이 FAIL(없음)로 나온다 — T1-02 가 의도한 교체다. 이 파일의 T1-04-04 가 그 자리의 새 정의를 확인한다.
--   그 밖의 INT-03 행이 달라지면 T1 탓이 아니다(T1 은 기존 함수 · 표 · 다른 제약을 바꾸지 않는다 — T1-00 지문으로 확인).
-- ▣ 읽는 법: status 에 FAIL 이 없어야 한다. T1-04-09 는 켜기 상태(info) — 켜기는 입력 화면 배포 뒤 T1-05 로만.
--   T1-04-10 은 INT-03 의 03 · 09 · 10 행 FAIL 수와 맞춰 보는 수(info) — 같으면 INT-03 의 차이는 모두 T1 이 만든 것이다.
-- ============================================================================
WITH done AS (SELECT CASE WHEN to_regclass('workhub_private.t1_installs') IS NULL THEN ''
                          ELSE COALESCE((xpath('/row/v/text()', query_to_xml('SELECT string_agg(batch || ''@'' || release, '','' ORDER BY batch) AS v FROM workhub_private.t1_installs',
                                                                             false, true, '')))[1]::text, '') END AS v),
has AS (SELECT b, (',' || (SELECT v FROM done) || ',') LIKE ('%,' || b || '@2026-10-18.1,%') AS ok FROM unnest(ARRAY['T1-01','T1-02','T1-03']) b),
tt AS (SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%' AND c.relkind = 'r'),
tc AS (SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conrelid = 'workhub.terms'::regclass
        AND conname IN ('terms_timetable_basis_pending','terms_timetable_basis_fkey')),
api_exec AS (SELECT p.proname FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%'
               AND (has_function_privilege('anon', p.oid, 'EXECUTE') OR has_function_privilege('authenticated', p.oid, 'EXECUTE')
                    OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
SELECT 'T1-04-01' AS no, '적용 기록(판 2026-10-18.1, 순서대로)' AS item,
       CASE WHEN NOT EXISTS (SELECT 1 FROM has WHERE ok) THEN 'info'
            WHEN (SELECT ok FROM has WHERE b = 'T1-03') AND NOT (SELECT ok FROM has WHERE b = 'T1-02') THEN 'FAIL'
            WHEN (SELECT ok FROM has WHERE b = 'T1-02') AND NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'FAIL' ELSE 'ok' END AS status,
       COALESCE(NULLIF(replace((SELECT v FROM done), ',', ' · '), ''), '미적용') AS value
UNION ALL
SELECT 'T1-04-02', 'T1-01 새 표 11개: RLS 켜짐 · API 역할 직접 접근 0',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN 'info'
            WHEN (SELECT count(*) FROM tt JOIN pg_class c ON c.oid = tt.oid WHERE c.relrowsecurity) = 11 AND (SELECT count(*) FROM tt) = 11
             AND NOT EXISTS (SELECT 1 FROM tt, unnest(ARRAY['anon','authenticated','service_role']) r
                              WHERE has_table_privilege(r, tt.oid, 'SELECT') OR has_table_privilege(r, tt.oid, 'INSERT')
                                 OR has_table_privilege(r, tt.oid, 'UPDATE') OR has_table_privilege(r, tt.oid, 'DELETE')) THEN 'ok' ELSE 'FAIL' END,
       CASE WHEN (SELECT ok FROM has WHERE b = 'T1-01') THEN (SELECT count(*) FROM tt)::text || '개' ELSE '미적용' END
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
-- INT-03(통합 사후 점검)은 1~8단계 목록만 안다. T1 뒤 INT-03 의 03 · 09 · 10 행은 FAIL 로 나오고, 그 수가 아래 수와 같아야 한다(T1 밖 차이 없음).
SELECT 'T1-04-10', 'INT-03 과 맞춰 볼 수(info): INT-03-03 목록에 없는 함수 · 09 목록에 없는 트리거 · 10 빠진 제약 · 목록에 없는 제약', 'info',
       CASE WHEN NOT (SELECT ok FROM has WHERE b = 'T1-01') THEN '미적용'
            ELSE '함수 ' || (SELECT count(*) FROM pg_proc p WHERE (p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%')
                                                          OR (p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_%'))
              || ' · 트리거 ' || (SELECT count(*) FROM pg_trigger g JOIN pg_class c ON c.oid = g.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                                  WHERE NOT g.tgisinternal AND ((n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%') OR (n.nspname = 'workhub_private' AND c.relname = 't1_installs')))
              || ' · 빠진 제약 ' || (CASE WHEN EXISTS (SELECT 1 FROM tc WHERE conname = 'terms_timetable_basis_pending') THEN 0 ELSE 1 END)
              || ' · 목록에 없는 제약 ' || ((SELECT count(*) FROM pg_constraint k JOIN pg_class c ON c.oid = k.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace
                                          WHERE (n.nspname = 'workhub' AND c.relname LIKE 'timetable\_%') OR (n.nspname = 'workhub_private' AND c.relname = 't1_installs'))
                                       + (SELECT count(*) FROM tc WHERE conname = 'terms_timetable_basis_fkey'))
       END
ORDER BY 1;
