-- 읽기 전용. TP1-01·02 설치 뒤 및 등록·정지 뒤 같은 파일을 사용한다.
WITH checks(no,item,passed,value) AS (
 SELECT 'TP1-03-01','설치 기록',count(*)=2,jsonb_agg(batch ORDER BY batch)::text FROM teacher_pilot.installs WHERE batch IN('TP1-01','TP1-02')
 UNION ALL SELECT 'TP1-03-02','시험 표 RLS',count(*)=7 AND bool_and(c.relrowsecurity),count(*)::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='teacher_pilot' AND c.relkind='r'
 UNION ALL SELECT 'TP1-03-03','API 역할 내부 객체 권한 없음',NOT EXISTS(
 SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r
 WHERE n.nspname='teacher_pilot' AND c.relkind IN('r','v','S') AND (has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))),NULL
 UNION ALL SELECT 'TP1-03-04','내부 함수 호출 차단',NOT EXISTS(
 SELECT 1 FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','authenticated','service_role']) r WHERE p.pronamespace='teacher_pilot'::regnamespace AND has_function_privilege(r,p.oid,'EXECUTE')),NULL
 UNION ALL SELECT 'TP1-03-05','접근 확인 RPC만 로그인 역할 허용',has_function_privilege('authenticated','public.workhub_teacher_pilot_access()','EXECUTE') AND NOT has_function_privilege('anon','public.workhub_teacher_pilot_access()','EXECUTE') AND NOT has_function_privilege('service_role','public.workhub_teacher_pilot_access()','EXECUTE'),NULL
 UNION ALL SELECT 'TP1-03-06','기존 함수 9개 보강 원문 일치',count(*)=9 AND bool_and(coalesce(r.after_hash=md5(replace(p.prosrc,E'\r\n',E'\n')) AND p.proowner='postgres'::regrole,false)),count(*)::text FROM teacher_pilot.patch_receipts r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
 UNION ALL SELECT 'TP1-03-07','모든 배치 정확히 10명',NOT EXISTS(SELECT 1 FROM teacher_pilot.batches b LEFT JOIN teacher_pilot.members m ON m.batch_id=b.id GROUP BY b.id HAVING count(m.slot)<>10),NULL
 UNION ALL SELECT 'TP1-03-08','시험 계정 전역 교사 권한 보존',NOT EXISTS(SELECT 1 FROM teacher_pilot.members m LEFT JOIN public.users u ON u.id=m.auth_user_id::text WHERE u.role IS DISTINCT FROM 'teacher'),NULL
 UNION ALL SELECT 'TP1-03-09','종료 배치 추가 허용 없음',NOT EXISTS(SELECT 1 FROM teacher_pilot.members m JOIN teacher_pilot.batches b ON b.id=m.batch_id LEFT JOIN workhub.participant_grants g ON g.membership_id=m.member_id WHERE b.state='stopped' AND (g.active OR teacher_pilot.allowed(m.school_id,m.member_id))),NULL
 UNION ALL SELECT 'TP1-03-10','불변 이력·종료 보호 켜짐',count(*)=5 AND bool_and(tgenabled='O'),count(*)::text FROM pg_trigger WHERE NOT tgisinternal AND tgname IN('tp1_ends_immutable','tp1_changes_immutable','tp1_patches_immutable','tr1_links_immutable','tp1_staff_cancel_guard')
)
SELECT no,item,CASE WHEN passed THEN 'ok' ELSE 'FAIL' END status,value FROM checks
UNION ALL SELECT 'TP1-03-11','시험 배치 현황','info',jsonb_build_object('registered',(SELECT count(*) FROM teacher_pilot.members),'active',(SELECT count(*) FROM teacher_pilot.members m WHERE teacher_pilot.allowed(m.school_id,m.member_id)),'batches',(SELECT count(*) FROM teacher_pilot.batches))::text ORDER BY no;
