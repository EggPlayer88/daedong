-- ============================================================================
-- P4-03  사후 점검 (읽기 전용). P4-02 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 두 행은 학교별 준비 상태(info):
--   P4-04·05 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드:모듈=상태 와 준비 사유.
-- ============================================================================
SELECT 'P4-03-01' AS no, '적용 기록 P4-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p4_installs') IS NOT NULL AND workhub_private.p4_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P4-03-02', '새 표 19개 + 적용 기록 · RLS 켜짐',
       CASE WHEN count(*) = 20 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p4_installs'), to_regclass('workhub_private.p4_storage_policies'),
  to_regclass('workhub.document_policies'), to_regclass('workhub.knowledge_import_policies'), to_regclass('workhub.guided_policies'),
  to_regclass('workhub.content_requests'), to_regclass('workhub.knowledge_files'), to_regclass('workhub.knowledge_file_leases'),
  to_regclass('workhub.knowledge_extractions'), to_regclass('workhub.knowledge_sources'), to_regclass('workhub.knowledge_source_revisions'),
  to_regclass('workhub.documents'), to_regclass('workhub.document_versions'), to_regclass('workhub.guided_templates'),
  to_regclass('workhub.guided_template_versions'), to_regclass('workhub.guided_responses'), to_regclass('workhub.guided_response_versions'),
  to_regclass('workhub.guided_operations'), to_regclass('workhub.guided_leases'), to_regclass('workhub.guided_artifacts'))
UNION ALL
SELECT 'P4-03-03', 'workhub·workhub_private 표에 API 역할 권한 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P4-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P4-03-05', '앱 함수 23개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 23 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'workhub\_knowledge\_%' OR p.proname LIKE 'workhub\_document\_%' OR p.proname LIKE 'workhub\_template\_%')
  AND p.proname NOT LIKE '%\_claim' AND p.proname NOT LIKE '%\_finish'
UNION ALL
SELECT 'P4-03-06', '서버 API 함수 6개: service_role 만(브라우저 authenticated 불가)',
       CASE WHEN count(*) = 6 AND bool_and(p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
  AND (p.proname LIKE 'workhub\_knowledge\_%' OR p.proname LIKE 'workhub\_template\_%') AND (p.proname LIKE '%\_claim' OR p.proname LIKE '%\_finish')
UNION ALL
SELECT 'P4-03-07', '두 버킷 비공개 · 이 배치 정책 4개 그대로 · 두 버킷을 여는 다른 정책 없음(UPDATE·DELETE 포함)',
       CASE WHEN workhub_private.p4_storage_ok('workhub-knowledge-files') AND workhub_private.p4_storage_ok('workhub-document-files') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P4-03-08', '수합 버킷 준비 판정(R1 c_storage_ok)이 P4 정책 때문에 바뀌지 않음',
       CASE WHEN workhub_private.c_storage_ok() = (EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-collection-files')) THEN 'ok' ELSE 'FAIL' END,
       workhub_private.c_storage_ok()::text
UNION ALL
SELECT 'P4-03-09', '학교 자료: 현재 판 = 판 기록의 마지막 판 · 판 1..최신 빈칸 없음', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.knowledge_sources s
WHERE (SELECT count(*) FROM workhub.knowledge_source_revisions r WHERE r.source_id = s.id) <> s.version
   OR NOT EXISTS (SELECT 1 FROM workhub.knowledge_source_revisions r WHERE r.source_id = s.id AND r.version = s.version
                   AND r.status = s.status AND r.title = s.title AND r.body = s.body)
UNION ALL
SELECT 'P4-03-10', '원문 가져오기: 추출된 파일은 고정 실물·추출문 1건 · 자료는 원본 파일 1개당 1건', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.knowledge_files f
WHERE (f.state = 'extracted') <> EXISTS (SELECT 1 FROM workhub.knowledge_extractions x WHERE x.file_id = f.id AND x.storage_object_id = f.storage_object_id)
   OR (SELECT count(*) FROM workhub.knowledge_sources s WHERE s.origin_file_id = f.id) > 1
UNION ALL
SELECT 'P4-03-11', '문서함: 최신 판 = 판 기록 마지막 · 상태·공개 범위 일치 · 학생 기록은 나만 보기', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.documents d
WHERE (SELECT count(*) FROM workhub.document_versions v WHERE v.document_id = d.id) <> d.latest_version
   OR NOT EXISTS (SELECT 1 FROM workhub.document_versions v WHERE v.document_id = d.id AND v.version = d.latest_version
                   AND v.status = d.status AND v.visibility = d.visibility)
   OR EXISTS (SELECT 1 FROM workhub.document_versions v WHERE v.document_id = d.id AND v.kind = 'student_record' AND v.visibility <> 'private')
UNION ALL
SELECT 'P4-03-12', '질문형 양식: 게시판 기록 있음 · 수합 1건당 게시 양식 1개 · 생성 파일은 완료된 render 작업과 1:1', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM (SELECT t.id FROM workhub.guided_templates t
       WHERE t.state = 'published' AND NOT EXISTS (SELECT 1 FROM workhub.guided_template_versions v WHERE v.template_id = t.id AND v.version = t.version
                                                     AND v.action = 'publish' AND v.mapping = t.mapping)
      UNION ALL
      SELECT a.id FROM workhub.guided_artifacts a JOIN workhub.guided_operations o ON o.id = a.operation_id
       WHERE o.action <> 'render' OR o.state <> 'completed' OR o.artifact_id <> a.id OR o.result ->> 'sha256' <> a.sha256
      UNION ALL
      SELECT o.id FROM workhub.guided_operations o
       WHERE o.action = 'render' AND o.state = 'completed' AND NOT EXISTS (SELECT 1 FROM workhub.guided_artifacts a WHERE a.operation_id = o.id)) x
UNION ALL
SELECT 'P4-03-13', '학교 × 모듈 상태', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.module || '=' || a.state, ', ' ORDER BY s.code, a.module)
                 FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
                WHERE a.module IN ('knowledge','knowledge_import','documents','guided')), '(활성화 없음)')
UNION ALL
SELECT 'P4-03-14', '학교별 준비 사유(자료 / 원문 가져오기 / 문서함 / 질문형 양식)', 'info',
       (SELECT string_agg(s.code || ':' || workhub_private.p4_reason(s.id, 'knowledge') || '/' || workhub_private.p4_reason(s.id, 'knowledge_import')
                          || '/' || workhub_private.p4_reason(s.id, 'documents') || '/' || workhub_private.p4_reason(s.id, 'guided'), ', ' ORDER BY s.code)
          FROM workhub.schools s)
ORDER BY 1;
