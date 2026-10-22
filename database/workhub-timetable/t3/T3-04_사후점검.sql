-- 읽기 전용. 최종 설치 후 전체 함수 지문은 통합 점검에서 확인한다.
WITH f AS (SELECT p.*,n.nspname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE(n.nspname='workhub_private' AND p.proname LIKE 't3\_%') OR(n.nspname='public' AND p.proname LIKE 'workhub_timetable_interventions\_%')),
checks(no,item,passed) AS (
 SELECT 'T3-04-01','T3 설치 3단계',count(*)=3 FROM workhub_private.t3_installs
 UNION ALL SELECT 'T3-04-02','표 10개 RLS 및 API 직접 접근 없음',count(*)=10 AND bool_and(c.relrowsecurity
 AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role',c.oid,'SELECT,INSERT,UPDATE,DELETE')) FROM pg_class c WHERE c.relkind='r' AND
 ((c.relnamespace='workhub'::regnamespace AND c.relname IN('timetable_intervention_policies','timetable_intervention_previews','timetable_interventions','timetable_intervention_participants','timetable_intervention_versions','timetable_intervention_commands','timetable_makeup_links','timetable_reopened_days','timetable_intervention_sources')) OR(c.relnamespace='workhub_private'::regnamespace AND c.relname='t3_installs'))
 UNION ALL SELECT 'T3-04-03','공개 RPC 7개 authenticated만 실행',count(*)=7 AND bool_and(prosecdef AND proconfig=ARRAY['search_path=""'] AND pg_get_userbyid(proowner)='postgres'
 AND has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE')) FROM f WHERE nspname='public'
 UNION ALL SELECT 'T3-04-04','내부 함수 API 실행 불가',count(*)>=20 AND bool_and(NOT has_function_privilege('authenticated',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE') AND NOT has_function_privilege('service_role',oid,'EXECUTE') AND proconfig=ARRAY['search_path=""']) FROM f WHERE nspname='workhub_private'
 UNION ALL SELECT 'T3-04-05','원문·접수·연결·버전 원장 불변 트리거 7개',count(*)=7 AND bool_and(tgenabled='O' AND tgfoid='workhub_private.forbid_change()'::regprocedure) FROM pg_trigger WHERE NOT tgisinternal AND tgname='t3_immutable'
 UNION ALL SELECT 'T3-04-06','기존 운영 수업 보호와 학사 알림 트리거',count(*)=2 AND bool_and(tgenabled='O') FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('t3_pending_lesson_guard','t3_school_day_notification')
 UNION ALL SELECT 'T3-04-07','기존 T2 재공개 보존 훅',position('timetable_reopened_days' in prosrc)>0 AND position('''intervention''' in prosrc)>0 FROM pg_proc WHERE oid='workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamptz)'::regprocedure
 UNION ALL SELECT 'T3-04-08','기존 T2 진행 요청 보호 훅',position('t3_live' in prosrc)>0 FROM pg_proc WHERE oid='workhub_private.t2_lesson_busy(text,text,timestamptz)'::regprocedure
 UNION ALL SELECT 'T3-04-10','T2 시범 제출·승인 현재 자격 잠금',count(*)=2 AND bool_and(position('t3_lock_members' in prosrc)>0) FROM pg_proc WHERE oid IN('workhub_private.t2_submit(workhub_private.actor_context,jsonb,text,text)'::regprocedure,'workhub_private.t2_action(workhub_private.actor_context,jsonb,text,text)'::regprocedure)
 UNION ALL SELECT 'T3-04-09','원키 범위 유일 제약과 닫기 결과 제약',count(*)=4 FROM pg_constraint WHERE conrelid='workhub.timetable_intervention_commands'::regclass AND contype IN('p','f','c') AND(contype IN('p','f') OR pg_get_constraintdef(oid) LIKE '%outcome%')
) SELECT no,item,CASE WHEN passed THEN 'ok' ELSE 'FAIL' END AS status FROM checks ORDER BY no;
