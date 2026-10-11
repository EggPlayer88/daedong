-- 회원 보존 dry-run. 읽기 전용이며 식별자·이메일·이름·토큰을 출력하지 않는다.
BEGIN TRANSACTION READ ONLY;
SELECT count(*) AS auth_user_count FROM auth.users;
SELECT count(*) AS profile_count,
       count(*) FILTER (WHERE is_active IS TRUE) AS approved_count,
       count(*) FILTER (WHERE is_active IS FALSE) AS inactive_or_pending_count FROM public.users;
SELECT role,is_active,count(*) AS count FROM public.users GROUP BY role,is_active ORDER BY role,is_active;
SELECT count(*) AS missing_profile_count FROM auth.users a LEFT JOIN public.users u ON u.id=a.id::text WHERE u.id IS NULL;
SELECT count(*) AS orphan_profile_count FROM public.users u LEFT JOIN auth.users a ON a.id::text=u.id WHERE a.id IS NULL;
SELECT count(*) AS conversation_count,count(*) FILTER (WHERE u.id IS NULL) AS broken_owner_count
  FROM public.doc_ai_conversations c LEFT JOIN public.users u ON u.id=c.user_id;
SELECT count(*) AS submission_count,count(*) FILTER (WHERE u.id IS NULL) AS broken_owner_count
  FROM public.doc_submissions s LEFT JOIN public.users u ON u.id=s.user_id;
SELECT count(*) AS submission_object_count FROM storage.objects WHERE bucket_id='submissions';
SELECT md5(pg_get_functiondef('public.handle_new_user()'::regprocedure)) AS signup_trigger_function_fingerprint;
SELECT count(*) AS signup_trigger_count FROM pg_trigger
WHERE tgrelid='auth.users'::regclass AND tgname='on_auth_user_created' AND NOT tgisinternal;
SELECT to_regclass('public.workhub_schools') IS NOT NULL AS foundation_present;
ROLLBACK;
