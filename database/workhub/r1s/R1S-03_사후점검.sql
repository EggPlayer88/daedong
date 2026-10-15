-- ============================================================================
-- R1S-03  사후 점검 (읽기 전용 — 언제 실행해도 아무것도 바꾸지 않는다)
--
-- ▣ 언제: R1S-01·02 적용 직후(필수), 그리고 R1S-04(활성화)·R1S-80/81(중지·재개) 뒤 상태 확인용으로 아무 때나.
-- ▣ R1-04 와의 관계: R1S 를 적용하면 R1-04 의 03·04·09 행이 FAIL 로 보인다. 공개 함수가 3개 늘고(17 → 20)
--   작업 목록 CHECK 에 file.basic_check 가 더해졌기 때문이다(의도한 변경). R1S 적용 뒤에는 R1-04 대신 이 파일을 본다.
--   이 파일은 R1-04 의 나머지 행(01·02·05~08·10~14)을 같은 식으로 포함한다.
-- ▣ 읽는 법: status 가 FAIL 인 행이 없어야 한다. info 는 지금 단계의 상태를 보여 줄 뿐이다.
--   마지막 두 행이 학교별 사용 가능 여부다. R1S-04 전에는 둘 다 "준비 안 됨"이 정상이다.
-- ============================================================================
SELECT 'R1S-03-01' AS no, 'R1-01·02·03(2026-10-15.1) + R1S-01·02(2026-10-16.1) 적용 기록' AS item,
       CASE WHEN (SELECT count(*) FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03') AND release = '2026-10-15.1') = 3
             AND (SELECT count(*) FROM workhub_private.r1s_installs WHERE batch IN ('R1S-01','R1S-02') AND release = '2026-10-16.1') = 2
             AND (SELECT count(*) FROM workhub_private.r1s_installs) = 2 THEN 'ok' ELSE 'FAIL' END AS status,
       (SELECT string_agg(batch || '@' || release, ', ' ORDER BY batch) FROM workhub_private.r1s_installs) AS value
UNION ALL
SELECT 'R1S-03-02', '중지 스위치(R1-80/81)', CASE WHEN state = 'open' THEN 'ok' ELSE 'info' END, state || ' (' || reason || ')'
  FROM workhub_private.r1_switch
UNION ALL
SELECT 'R1S-03-03', '공개 함수 20개(R1 17 + R1S 3, SECURITY DEFINER, search_path 고정)',
       CASE WHEN count(*) = 20 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%')
   AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
UNION ALL
SELECT 'R1S-03-04', '앱 함수 10개: authenticated 만 / 서버 함수 10개(작업자 8 + 기본 확인 2): service_role 만',
       CASE WHEN count(*) FILTER (WHERE p.proname NOT LIKE 'workhub\_file\_worker\_%' AND p.proname NOT LIKE 'workhub\_file\_basic\_%'
                                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) = 10
             AND count(*) FILTER (WHERE (p.proname LIKE 'workhub\_file\_worker\_%' OR p.proname LIKE 'workhub\_file\_basic\_%')
                                    AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 10
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%')
UNION ALL
SELECT 'R1S-03-05', '내부 함수(workhub·workhub_private)는 API 역할 실행 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1S-03-06', 'workhub·workhub_private 표: RLS 켜짐, API 역할 표 권한 0',
       CASE WHEN count(*) FILTER (WHERE NOT c.relrowsecurity) = 0
             AND count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                    OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                    OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || '개 표'
  FROM pg_class c WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind = 'r'
UNION ALL
SELECT 'R1S-03-07', 'workhub·workhub_private 스키마 USAGE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM unnest(ARRAY['workhub','workhub_private']) s, unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE has_schema_privilege(r, s, 'USAGE')
UNION ALL
SELECT 'R1S-03-08', '수합 버킷 비공개 + Storage 정책 2개가 설치 지문과 같음 + 다른 정책이 열지 않음',
       CASE WHEN workhub_private.c_storage_ok() THEN 'ok' ELSE 'FAIL' END,
       (SELECT 'public=' || public::text FROM storage.buckets WHERE id = 'workhub-collection-files')
UNION ALL
SELECT 'R1S-03-09', '작업 목록 CHECK 가 R1S 판(R1 3종 + file.basic_check)',
       CASE WHEN pg_get_constraintdef(oid) = 'CHECK ((allowed_actions <@ ARRAY[''school.bootstrap''::text, ''file.verify''::text, ''file.cleanup''::text, ''file.basic_check''::text]))'
            THEN 'ok' ELSE 'FAIL' END, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid = 'workhub.service_principals'::regclass AND conname = 'service_principals_action_registry'
UNION ALL
SELECT 'R1S-03-10', '교체한 R1-03 함수 5개가 R1S 판과 같음',
       CASE WHEN count(*) = 5 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p JOIN (VALUES ('c_require','3011f8cc751a3793ff377c056cb93aca'),('c_file_problem','6a3270f2dfddc1010313576a1dda9727'),('c_parent_resolve','e24ae043bfc4dfc2d4e57fe092e407f0'),
                              ('c_prepare','d26f5611162451865ac8c7f636a87bd7'),('c_complete','0bf16800aa43ec7d880984f77defb8b0')) x(n, h)
    ON p.proname = x.n AND md5(replace(p.prosrc, chr(13), '')) = x.h
 WHERE p.pronamespace = 'workhub_private'::regnamespace
UNION ALL
SELECT 'R1S-03-11', '기본 확인 경로와 작업자 대기열의 배타 트리거 2개 + 확인 기록·임대 보호 트리거',
       CASE WHEN count(*) = 4 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_trigger WHERE NOT tgisinternal AND tgenabled = 'O'
   AND (tgrelid, tgname) IN (('workhub.file_verification_jobs'::regclass, 'file_verification_jobs_not_basic'),
                             ('workhub.file_basic_checks'::regclass, 'file_basic_checks_guard'),
                             ('workhub.file_basic_leases'::regclass, 'file_basic_leases_guard'),
                             ('workhub.file_check_profiles'::regclass, 'file_check_profiles_immutable'))
UNION ALL
SELECT 'R1S-03-12', '확인 프로필 hwpx_basic_v1 (HWPX · 30MiB · 악성 검사 없음 · 내용 검증 없음)',
       CASE WHEN count(*) = 1 AND bool_and(extensions = ARRAY['hwpx'] AND max_file_bytes = 31457280
                                           AND checks = ARRAY['size','sha256','hwpx'] AND NOT malware_scan AND NOT content_validation)
             AND (SELECT count(*) FROM workhub.file_check_profiles) = 1 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM workhub.file_check_profiles WHERE profile = 'hwpx_basic_v1'
UNION ALL
SELECT 'R1S-03-13', '확인 서버 주체 svc_hwpx_basic (있으면: file.basic_check 하나뿐 · service_role 연결 없음)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM workhub.service_principals WHERE id = 'svc_hwpx_basic') THEN 'info'
            WHEN EXISTS (SELECT 1 FROM workhub.service_principals WHERE id = 'svc_hwpx_basic' AND allowed_actions = ARRAY['file.basic_check']::text[])
             AND NOT EXISTS (SELECT 1 FROM workhub_private.api_role_principals WHERE service_principal_id = 'svc_hwpx_basic')
             AND NOT EXISTS (SELECT 1 FROM workhub_private.db_identity_principals WHERE service_principal_id = 'svc_hwpx_basic') THEN 'ok'
            ELSE 'FAIL' END,
       COALESCE((SELECT 'active=' || active::text || ', 학교 범위 ' || (SELECT count(*) FROM workhub.service_principal_scopes s
                   WHERE s.service_principal_id = p.id AND s.revoked_at IS NULL)::text FROM workhub.service_principals p WHERE p.id = 'svc_hwpx_basic'),
                '없음 — R1S-04 전')
UNION ALL
SELECT 'R1S-03-14', '다른 주체에 file.basic_check 가 섞이지 않음',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM workhub.service_principals WHERE 'file.basic_check' = ANY (allowed_actions) AND allowed_actions <> ARRAY['file.basic_check']::text[]
UNION ALL
SELECT 'R1S-03-15', '학교별 활성화(R1S-04)', 'info',
       COALESCE((SELECT string_agg(school_id || '=' || state || ' (' || deployment_ref || ', ' || deployment_checked_on || ')', ', ' ORDER BY school_id)
                   FROM workhub.basic_profile_activations), '없음 — R1S-04 전(기본값 꺼짐)')
UNION ALL
SELECT 'R1S-03-16', '게시된 정책판', 'info',
       COALESCE((SELECT string_agg(policy_key || ' v' || policy_version || ' ' || effective_from::text || ' ' || (value ->> 'extensions')
                                   || ' allowUnscanned=' || COALESCE(value ->> 'allowUnscanned', '-'), '; ' ORDER BY policy_key)
                   FROM workhub.policy_versions WHERE state = 'published'), '없음')
UNION ALL
SELECT 'R1S-03-17', '기본 확인 파일 규모(확인 대기 · ready · rejected · 열린 임대)', 'info',
       (SELECT count(*) FILTER (WHERE outcome IS NULL) || ' · ' || count(*) FILTER (WHERE outcome = 'ready') || ' · ' || count(*) FILTER (WHERE outcome = 'rejected')
          FROM workhub.file_basic_checks) || ' · ' || (SELECT count(*) FROM workhub.file_basic_leases WHERE state = 'issued' AND expires_at > clock_timestamp())
UNION ALL
SELECT 'R1S-03-18', '검증 작업자 경로(R1-05) — 연결 0 이 정상', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'info' END,
       count(*)::text || '건 · 검증 대기 ' || (SELECT count(*) FROM workhub.file_verification_jobs WHERE state IN ('queued','leased'))
  FROM workhub_private.api_role_principals WHERE revoked_at IS NULL
UNION ALL
SELECT 'R1S-03-19', '작업자 경로 준비 상태(R1 원래 판정 — 기본 확인을 켠 학교에서는 쓰지 않음)', 'info',
       string_agg(s.id || '=' || (workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason'), ', ')
  FROM workhub.schools s WHERE s.status = 'active'
UNION ALL
SELECT 'R1S-03-20', 'HWPX 기본 확인 사용 가능 여부(ready 일 때만 HWPX 업로드 가능)',
       CASE WHEN bool_and((workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'available')::boolean) THEN 'ready' ELSE 'info' END,
       string_agg(s.id || '=' || (workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason'), ', ')
  FROM workhub.schools s WHERE s.status = 'active'
ORDER BY 1;
