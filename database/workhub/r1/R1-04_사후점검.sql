-- ============================================================================
-- R1-04  사후 점검 (읽기 전용 — 언제 실행해도 아무것도 바꾸지 않는다)
--
-- ▣ 언제: R1-01~03 적용 직후(필수), 그리고 R1-06(정책)·R1-05(작업자)·중지/재개 뒤 상태 확인용으로 아무 때나.
-- ▣ 읽는 법: status 가 FAIL 인 행이 없어야 한다. info 는 지금 단계의 상태를 보여 줄 뿐이다.
-- ▣ 마지막 행(R1-04-14)이 "수합 사용 가능 여부"다. ready 가 아니면 화면은 "준비 중"으로 보이는 것이 정상이다.
--   SQL 만 적용한 상태에서는 ready 가 될 수 없다(정책 게시 + 검증 작업자 heartbeat 가 있어야 함).
-- ============================================================================
SELECT 'R1-04-01' AS no, 'R1-01·02·03 적용 기록(판 2026-10-15.1)' AS item,
       CASE WHEN count(*) FILTER (WHERE release = '2026-10-15.1') = 3 AND count(*) = 3 THEN 'ok' ELSE 'FAIL' END AS status,
       string_agg(batch || '@' || release, ', ' ORDER BY batch) AS value
  FROM workhub_private.batch_installs WHERE batch IN ('R1-01','R1-02','R1-03')
UNION ALL
SELECT 'R1-04-02', '중지 스위치', CASE WHEN state = 'open' THEN 'ok' ELSE 'info' END, state || ' (' || reason || ')'
  FROM workhub_private.r1_switch
UNION ALL
SELECT 'R1-04-03', '앱 함수 9개·작업자 함수 8개(SECURITY DEFINER, search_path 고정)',
       CASE WHEN count(*) = 17 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
   AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%')
   AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']
UNION ALL
SELECT 'R1-04-04', '앱 함수: authenticated 만 / 작업자 함수: service_role 만',
       CASE WHEN count(*) FILTER (WHERE p.proname NOT LIKE 'workhub\_file\_worker\_%' AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')) = 9
             AND count(*) FILTER (WHERE p.proname LIKE 'workhub\_file\_worker\_%' AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                                    AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')) = 8
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_collection\_%' OR p.proname LIKE 'workhub\_file\_%')
UNION ALL
SELECT 'R1-04-05', '내부 함수(workhub·workhub_private)는 API 역할 실행 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'R1-04-06', 'workhub·workhub_private 표: RLS 켜짐, API 역할 표 권한 0',
       CASE WHEN count(*) FILTER (WHERE NOT c.relrowsecurity) = 0
             AND count(*) FILTER (WHERE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                    OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                                    OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) = 0 THEN 'ok' ELSE 'FAIL' END,
       count(*)::text || '개 표'
  FROM pg_class c WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind = 'r'
UNION ALL
SELECT 'R1-04-07', 'workhub·workhub_private 스키마 USAGE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
  FROM unnest(ARRAY['workhub','workhub_private']) s, unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE has_schema_privilege(r, s, 'USAGE')
UNION ALL
SELECT 'R1-04-08', '수합 버킷 비공개 + Storage 정책 2개가 설치 지문과 같음 + 다른 정책이 열지 않음',
       CASE WHEN workhub_private.c_storage_ok() THEN 'ok' ELSE 'FAIL' END,
       (SELECT 'public=' || public::text FROM storage.buckets WHERE id = 'workhub-collection-files')
UNION ALL
SELECT 'R1-04-09', 'R0 작업 목록 CHECK 가 R1 판(school.bootstrap·file.verify·file.cleanup)',
       CASE WHEN pg_get_constraintdef(oid) = 'CHECK ((allowed_actions <@ ARRAY[''school.bootstrap''::text, ''file.verify''::text, ''file.cleanup''::text]))'
            THEN 'ok' ELSE 'FAIL' END, pg_get_constraintdef(oid)
  FROM pg_constraint WHERE conrelid = 'workhub.service_principals'::regclass AND conname = 'service_principals_action_registry'
UNION ALL
SELECT 'R1-04-10', '게시된 정책판(R1-06)', 'info',
       COALESCE((SELECT string_agg(policy_key || ' v' || policy_version || ' ' || effective_from::text, ', ' ORDER BY policy_key)
                   FROM workhub.policy_versions WHERE state = 'published'), '없음 — R1-06 전')
UNION ALL
SELECT 'R1-04-11', '검증 작업자 연결(R1-05)', 'info',
       COALESCE((SELECT 'svc_file_worker active=' || p.active::text
                        || ', service_role 연결=' || (SELECT count(*) FROM workhub_private.api_role_principals a WHERE a.service_principal_id = p.id AND a.revoked_at IS NULL)::text
                        || ', 마지막 heartbeat 만료=' || COALESCE((SELECT max(h.expires_at)::text FROM workhub.file_verifier_heartbeats h WHERE h.service_principal_id = p.id), '없음')
                   FROM workhub.service_principals p WHERE p.id = 'svc_file_worker'), '없음 — R1-05 전')
UNION ALL
SELECT 'R1-04-12', '수합 자료 규모', 'info',
       '요청 ' || (SELECT count(*) FROM workhub.collections) || ' · 제출판 ' || (SELECT count(*) FROM workhub.submission_versions)
       || ' · 파일 ' || (SELECT count(*) FROM workhub.file_objects) || ' (검증 대기 ' || (SELECT count(*) FROM workhub.file_verification_jobs WHERE state IN ('queued','leased')) || ')'
UNION ALL
SELECT 'R1-04-13', '정리 원장(차단 중·완료·보존)', 'info',
       (SELECT count(*) FILTER (WHERE state = 'blocked') || ' · ' || count(*) FILTER (WHERE state = 'completed') || ' · ' || count(*) FILTER (WHERE state = 'retained')
          FROM workhub.deletion_ledger)
UNION ALL
SELECT 'R1-04-14', '수합 사용 가능 여부(ready 일 때만 사용 가능)',
       CASE WHEN bool_and((workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'available')::boolean) THEN 'ready' ELSE 'info' END,
       string_agg(s.id || '=' || (workhub_private.c_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason'), ', ')
  FROM workhub.schools s WHERE s.status = 'active'
ORDER BY 1;
