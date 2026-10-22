-- 읽기 전용. 5행 모두 ok가 정상이다. 실제 Storage HTTP 왕복은 별도로 확인한다.
WITH p AS (SELECT * FROM pg_proc WHERE oid=to_regprocedure('workhub_storage.object_readable(text)'))
SELECT 'S1-02-01' AS no, '보강 함수 원문' AS item,
 CASE WHEN (SELECT md5(replace(prosrc,chr(13),'')) FROM p)='082ef8d4160ba0577732deed0c6c2221' THEN 'ok' ELSE 'FAIL' END AS status
UNION ALL SELECT 'S1-02-02','소유자·권한 경계',CASE WHEN EXISTS(SELECT 1 FROM p WHERE pg_get_userbyid(proowner)='postgres'
 AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',oid,'EXECUTE')) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S1-02-03','수합 버킷 비공개',CASE WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='workhub-collection-files' AND NOT public) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S1-02-04','Storage 객체 RLS',CASE WHEN EXISTS(SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S1-02-05','인증 사용자 수합 SELECT 정책 유지',CASE WHEN EXISTS(SELECT 1 FROM pg_policies
 WHERE schemaname='storage' AND tablename='objects' AND policyname='workhub_collection_select'
 AND cmd='SELECT' AND roles=ARRAY['authenticated']::name[] AND qual LIKE '%workhub_storage.object_readable(name)%') THEN 'ok' ELSE 'FAIL' END
ORDER BY 1;
