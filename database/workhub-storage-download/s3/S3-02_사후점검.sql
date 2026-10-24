-- 읽기 전용. 7행 모두 ok. 실제 원문 가져오기·다운로드 HTTP 왕복은 별도로 확인한다.
WITH p AS (SELECT * FROM pg_proc WHERE oid=to_regprocedure('workhub_storage.knowledge_readable(text,uuid)'))
SELECT 'S3-02-01' AS no, '학교 원문 읽기 함수 원문' AS item,
 CASE WHEN (SELECT md5(replace(prosrc,chr(13),'')) FROM p)='8bc5e3e6ef6762573f8230127b0dd70d' THEN 'ok' ELSE 'FAIL' END AS status
UNION ALL SELECT 'S3-02-02','소유자·권한 경계',CASE WHEN EXISTS(SELECT 1 FROM p WHERE pg_get_userbyid(proowner)='postgres'
 AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""']::text[]
 AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE')
 AND NOT has_function_privilege('service_role',oid,'EXECUTE')) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S3-02-03','학교 자료 버킷 비공개',CASE WHEN EXISTS(SELECT 1 FROM storage.buckets WHERE id='workhub-knowledge-files' AND NOT public) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S3-02-04','Storage 객체 RLS',CASE WHEN EXISTS(SELECT 1 FROM pg_class WHERE oid='storage.objects'::regclass AND relrowsecurity) THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S3-02-05','P4 Storage 정책 유지',CASE WHEN workhub_private.p4_storage_ok('workhub-knowledge-files') THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S3-02-06','S1 수합 다운로드 보강 유지',CASE WHEN EXISTS(SELECT 1 FROM pg_proc
 WHERE oid=to_regprocedure('workhub_storage.object_readable(text)')
 AND md5(replace(prosrc,chr(13),''))='082ef8d4160ba0577732deed0c6c2221') THEN 'ok' ELSE 'FAIL' END
UNION ALL SELECT 'S3-02-07','S2 생성 문서 다운로드 보강 유지',CASE WHEN EXISTS(SELECT 1 FROM pg_proc
 WHERE oid=to_regprocedure('workhub_storage.document_readable(text,uuid)')
 AND md5(replace(prosrc,chr(13),''))='626c7b65dca171d673cdea98db7e07a6') THEN 'ok' ELSE 'FAIL' END
ORDER BY 1;
