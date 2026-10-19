-- ============================================================================
-- P3-03  사후 점검 (읽기 전용). P3-02 뒤, 그리고 아무 때나.
-- ▣ status 가 FAIL 인 행이 없어야 한다. 마지막 두 행은 학교별 준비 상태(info):
--   P3-04·05 전에는 '(활성화 없음)'(정상), 뒤에는 학교코드:messaging=…, message_files=… 와 준비 사유.
-- ============================================================================
SELECT 'P3-03-01' AS no, '적용 기록 P3-01·02(2026-10-16.1)' AS item,
       CASE WHEN to_regclass('workhub_private.p3_installs') IS NOT NULL AND workhub_private.p3_installed() THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P3-03-02', '새 표 13개 · RLS 켜짐',
       CASE WHEN count(*) = 13 AND bool_and(c.relrowsecurity) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c WHERE c.oid IN (to_regclass('workhub_private.p3_installs'), to_regclass('workhub_private.p3_storage_policies'),
  to_regclass('workhub.messaging_policies'), to_regclass('workhub.message_file_policies'), to_regclass('workhub.message_threads'),
  to_regclass('workhub.message_thread_members'), to_regclass('workhub.messages'), to_regclass('workhub.message_files'),
  to_regclass('workhub.message_attachments'), to_regclass('workhub.message_file_leases'), to_regclass('workhub.message_requests'),
  to_regclass('workhub.message_file_requests'), to_regclass('workhub.notifications'))
UNION ALL
SELECT 'P3-03-03', 'workhub·workhub_private 표에 API 역할 권한 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_class c, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE c.relnamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND c.relkind IN ('r','p','v','m')
  AND has_table_privilege(r, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
UNION ALL
SELECT 'P3-03-04', '내부 함수 EXECUTE 를 가진 API 역할 0', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P3-03-05', '앱 함수 11개: authenticated 만 · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 11 AND bool_and(p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND (p.proname LIKE 'workhub\_messag%' OR p.proname = 'workhub_inbox_list')
  AND p.proname NOT LIKE 'workhub\_message\_file\_basic\_%'
UNION ALL
SELECT 'P3-03-06', '서버 확인 함수 2개: service_role 만(브라우저 authenticated 불가)',
       CASE WHEN count(*) = 2 AND bool_and(p.prosecdef AND has_function_privilege('service_role', p.oid, 'EXECUTE')
                          AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE'))
            THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_message\_file\_basic\_%'
UNION ALL
SELECT 'P3-03-07', '메시지 버킷 비공개 · 이 배치 정책 2개 그대로 · UPDATE·DELETE 정책 없음',
       CASE WHEN EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-message-files' AND public IS FALSE)
             AND (SELECT count(*) FROM pg_policy pol JOIN workhub_private.p3_storage_policies e ON e.policy_name = pol.polname
                   WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polcmd = e.cmd
                     AND md5(COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') || '|' || COALESCE(pg_get_expr(pol.polwithcheck, pol.polrelid), '')) = e.expr_md5) = 2
             AND NOT EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = 'storage.objects'::regclass AND pol.polcmd IN ('w','d','*')
                              AND COALESCE(pg_get_expr(pol.polqual, pol.polrelid), '') LIKE '%workhub-message-files%')
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P3-03-08', '수합 버킷 준비 판정(R1 c_storage_ok)이 P3 정책 때문에 바뀌지 않음',
       CASE WHEN workhub_private.c_storage_ok() = (EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'workhub-collection-files')) THEN 'ok' ELSE 'FAIL' END,
       workhub_private.c_storage_ok()::text
UNION ALL
SELECT 'P3-03-09', '메시지: 대화마다 순번 1..최신 빈칸 없음 · 보낸 사람은 참여자',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.message_threads t
WHERE (SELECT count(*) FROM workhub.messages x WHERE x.thread_id = t.id) <> t.latest_sequence
   OR EXISTS (SELECT 1 FROM workhub.messages x WHERE x.thread_id = t.id AND x.sequence > t.latest_sequence)
   OR EXISTS (SELECT 1 FROM workhub.messages x WHERE x.thread_id = t.id
               AND NOT EXISTS (SELECT 1 FROM workhub.message_thread_members mm WHERE mm.thread_id = t.id AND mm.membership_id = x.sender_membership_id))
UNION ALL
SELECT 'P3-03-10', '1:1 대화 참여자 2명 · 단체 대화 3명 이상', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.message_threads t
WHERE (t.kind = 'direct' AND (SELECT count(*) FROM workhub.message_thread_members m WHERE m.thread_id = t.id) <> 2)
   OR (t.kind = 'group' AND (SELECT count(*) FROM workhub.message_thread_members m WHERE m.thread_id = t.id) < 3)
UNION ALL
SELECT 'P3-03-11', '첨부: 메시지에 붙은 파일은 모두 ready · 보낸 사람 소유 · 붙은 시각 있음', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.message_attachments ma JOIN workhub.message_files f ON f.id = ma.file_id JOIN workhub.messages x ON x.id = ma.message_id
WHERE f.state <> 'ready' OR f.owner_membership_id <> x.sender_membership_id OR f.attached_at IS NULL
UNION ALL
SELECT 'P3-03-12', '반영 원장 수 = 보낸 요청(start·reply)의 메시지 묶음 수', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.message_requests r
WHERE r.command_kind IN ('start','reply')
  AND (SELECT count(*) FROM workhub.messages x WHERE x.school_id = r.school_id AND x.sender_membership_id = r.membership_id AND x.request_key = r.request_key)
      <> jsonb_array_length(r.response -> 'deliveries')
UNION ALL
SELECT 'P3-03-13', '학교 × 모듈 상태', 'info',
       COALESCE((SELECT string_agg(s.code || ':' || a.module || '=' || a.state, ', ' ORDER BY s.code, a.module)
                 FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
                WHERE a.module IN ('messaging','message_files')), '(활성화 없음)')
UNION ALL
SELECT 'P3-03-14', '학교별 준비 사유(메시지 / 첨부)', 'info',
       (SELECT string_agg(s.code || ':' || workhub_private.p3_messaging_reason(s.id) || '/' || workhub_private.p3_files_reason(s.id), ', ' ORDER BY s.code)
          FROM workhub.schools s)
ORDER BY 1;
