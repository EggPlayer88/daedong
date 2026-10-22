-- 신규 증분. 기존 ID·기록은 보존하고 정정 전후 원장을 같은 트랜잭션에 남긴다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regclass('workhub_private.p9_installs') IS NULL OR to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'P10: P9와 T2 설치가 먼저입니다.'; END IF;
 IF to_regclass('workhub.school_data_policies') IS NOT NULL THEN RAISE EXCEPTION 'P10: 재실행 금지'; END IF;
END $$;
CREATE TABLE workhub_private.p10_installs(batch text PRIMARY KEY CHECK(batch IN('P10-01','P10-02')),release text NOT NULL,installed_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE workhub.school_data_policies(school_id text PRIMARY KEY REFERENCES workhub.schools(id),active boolean NOT NULL DEFAULT false,approval_ref text NOT NULL,app_deploy_ref text,approved_by text NOT NULL,FOREIGN KEY(school_id,approved_by) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.school_data_previews(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,membership_id text NOT NULL,intent jsonb NOT NULL,
 fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),plan jsonb NOT NULL,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.school_data_requests(
 school_id text NOT NULL,membership_id text NOT NULL,request_key text NOT NULL,command_hash text NOT NULL,preview_id text NOT NULL UNIQUE REFERENCES workhub.school_data_previews(id),
 outcome text NOT NULL CHECK(outcome IN('applied','closed')),receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(school_id,membership_id,request_key),FOREIGN KEY(school_id,membership_id) REFERENCES workhub.memberships(school_id,id),
 CHECK((outcome='applied' AND receipt IS NOT NULL) OR(outcome='closed' AND receipt IS NULL)));
CREATE TABLE workhub.school_data_revisions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,school_id text NOT NULL,entity_kind text NOT NULL CHECK(entity_kind IN('course','student','enrollment')),
 entity_id text NOT NULL,version integer NOT NULL CHECK(version>1),before_values jsonb NOT NULL,after_values jsonb NOT NULL,
 state_after text NOT NULL CHECK(state_after IN('active','archived','cancelled','voided')),reason text NOT NULL,membership_id text NOT NULL,request_key text NOT NULL,
 transaction_id bigint NOT NULL DEFAULT txid_current(),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(school_id,entity_kind,entity_id,version),FOREIGN KEY(school_id,membership_id,request_key) REFERENCES workhub.school_data_requests(school_id,membership_id,request_key) DEFERRABLE INITIALLY DEFERRED);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workhub_private.p10_installs','workhub.school_data_policies','workhub.school_data_previews','workhub.school_data_requests','workhub.school_data_revisions'] LOOP
 EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON %s FROM PUBLIC,anon,authenticated,service_role',t);
 IF t<>'workhub.school_data_policies' THEN EXECUTE format('CREATE TRIGGER p10_immutable BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change()',t);END IF;
 END LOOP;
END $$;
CREATE FUNCTION workhub_private.p10_env(ctx workhub_private.actor_context,d jsonb,code text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('contract','school-data-maintenance.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id)||CASE WHEN code IS NULL THEN jsonb_build_object('data',d) ELSE jsonb_build_object('error',jsonb_build_object('code',code)) END $$;
CREATE FUNCTION workhub_private.p10_state(s text,k text,i text) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT COALESCE((SELECT state_after FROM workhub.school_data_revisions WHERE school_id=s AND entity_kind=k AND entity_id=i ORDER BY version DESC LIMIT 1),'active') $$;
CREATE FUNCTION workhub_private.p10_version(s text,k text,i text) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT CASE k WHEN 'course' THEN (SELECT version FROM workhub.courses WHERE school_id=s AND id=i) WHEN 'student' THEN(SELECT version FROM workhub.students WHERE school_id=s AND id=i)
 ELSE (SELECT 1+count(*)::integer FROM workhub.school_data_revisions WHERE school_id=s AND entity_kind=k AND entity_id=i) END $$;
CREATE FUNCTION workhub_private.p10_ready(s text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT workhub_private.p5_ready(s) AND EXISTS(SELECT 1 FROM workhub.school_data_policies WHERE school_id=s AND active) $$;
CREATE FUNCTION workhub_private.p10_text(p jsonb,n integer) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT workhub_private.p5_text(p,n) AND (p #>> '{}') !~ E'[\\x7f\\u0080-\\u009f]' $$;
CREATE FUNCTION workhub_private.p10_shape(i jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE c jsonb;k text;
BEGIN
 IF i IS NULL OR jsonb_typeof(i)<>'object' OR NOT workhub_private.p2_exact(i,ARRAY['kind','courseId','entityId','expectedVersion','changes','reason']) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 k:=i->>'kind';c:=i->'changes';
 IF NOT workhub_private.p5_id(i->'courseId') OR NOT workhub_private.p5_id(i->'entityId') OR NOT workhub_private.p2_int(i->'expectedVersion')
 OR (i->>'expectedVersion')::numeric>2147483646 OR NOT workhub_private.p10_text(i->'reason',2000) OR jsonb_typeof(c) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF k='course_correct' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['label','validFrom','validThrough']) OR NOT workhub_private.p10_text(c->'label',120) OR NOT workhub_private.p5_date(c->'validFrom') OR NOT workhub_private.p5_date(c->'validThrough') OR c->>'validFrom'>c->>'validThrough' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSIF k='course_teacher_correct' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['teacherMemberIds']) OR jsonb_typeof(c->'teacherMemberIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF jsonb_array_length(c->'teacherMemberIds') NOT BETWEEN 1 AND 100 OR EXISTS(SELECT 1 FROM jsonb_array_elements(c->'teacherMemberIds') x WHERE NOT workhub_private.p5_id(x))
 OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(c->'teacherMemberIds') x)<>jsonb_array_length(c->'teacherMemberIds') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSIF k='student_correct' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['name','schoolStudentKey']) OR NOT workhub_private.p10_text(c->'name',120) OR NOT workhub_private.p10_text(c->'schoolStudentKey',120) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSIF k='enrollment_correct' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['grade','classLabel','seatNumber']) OR workhub_private.p1_int(c->'grade',1,20) IS NULL OR workhub_private.p1_int(c->'seatNumber',1,999) IS NULL OR NOT workhub_private.p10_text(c->'classLabel',40) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSIF k NOT IN('course_cancel','course_archive','course_restore','student_void','student_restore') OR c<>'{}'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT';
 END IF;
END $$;
-- 현재 값은 관리자에게만 반환한다. 기록 본문과 상담 내용은 반환하지 않는다.
CREATE FUNCTION workhub_private.p10_fields(s text,k text,i text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r jsonb;
BEGIN
 IF k='course' THEN SELECT jsonb_build_object('label',label,'validFrom',valid_from::text,'validThrough',(valid_to-1)::text) INTO r FROM workhub.courses WHERE school_id=s AND id=i;
 ELSIF k='student' THEN SELECT jsonb_build_object('name',name,'schoolStudentKey',school_student_key) INTO r FROM workhub.students WHERE school_id=s AND id=i;
 ELSE SELECT jsonb_build_object('grade',grade,'classLabel',class_label,'seatNumber',seat_number) INTO r FROM workhub.student_enrollments WHERE school_id=s AND id=i;END IF;
 RETURN r;
END $$;
CREATE FUNCTION workhub_private.p10_plan(ctx workhub_private.actor_context,i jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE co workhub.courses;st workhub.students;en workhub.student_enrollments;k text;ek text;eid text;v integer;cur_state text;ns text;c jsonb;b jsonb;a jsonb;
 impact jsonb;blockers jsonb:='[]';sources jsonb;n_records integer;n_pub integer;n_future integer;source_courses text[];tr workhub.terms;target text;
BEGIN
 PERFORM workhub_private.p10_shape(i);k:=i->>'kind';ek:=CASE WHEN k LIKE 'course_%' THEN 'course' WHEN k LIKE 'student_%' THEN 'student' ELSE 'enrollment' END;eid:=i->>'entityId';c:=i->'changes';
 SELECT * INTO co FROM workhub.courses WHERE school_id=ctx.school_id AND id=i->>'courseId';
 IF co.id IS NULL OR ek='course' AND eid<>co.id THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF ek='student' THEN
 SELECT * INTO st FROM workhub.students WHERE school_id=ctx.school_id AND id=eid AND EXISTS(SELECT 1 FROM workhub.course_memberships m WHERE m.school_id=ctx.school_id AND m.course_id=co.id AND m.student_id=eid);
 IF st.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 ELSIF ek='enrollment' THEN
 SELECT * INTO en FROM workhub.student_enrollments WHERE school_id=ctx.school_id AND id=eid AND EXISTS(SELECT 1 FROM workhub.course_memberships m WHERE m.school_id=ctx.school_id AND m.course_id=co.id AND m.enrollment_id=eid);
 IF en.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;SELECT * INTO st FROM workhub.students WHERE id=en.student_id;
 END IF;
 v:=workhub_private.p10_version(ctx.school_id,ek,eid);cur_state:=workhub_private.p10_state(ctx.school_id,ek,eid);ns:=cur_state;b:=workhub_private.p10_fields(ctx.school_id,ek,eid);a:=b;
 IF v<>(i->>'expectedVersion')::integer THEN blockers:=blockers||'"VERSION_CHANGED"';END IF;
 IF ek='course' THEN source_courses:=ARRAY[co.id];ELSE SELECT array_agg(DISTINCT course_id ORDER BY course_id) INTO source_courses FROM workhub.course_memberships WHERE school_id=ctx.school_id AND student_id=st.id;END IF;
 SELECT (SELECT count(*) FROM workhub.teaching_records WHERE school_id=ctx.school_id AND course_id=ANY(source_courses) AND(ek='course' OR student_id=st.id))
 +(SELECT count(*) FROM workhub.assessments WHERE school_id=ctx.school_id AND course_id=ANY(source_courses) AND(ek='course' OR student_id=st.id))
 +(SELECT count(*) FROM workhub.activity_item_revisions WHERE school_id=ctx.school_id AND(ek<>'course' AND student_id=st.id))
 +CASE WHEN ek='course' THEN (SELECT count(*) FROM workhub.rubrics WHERE school_id=ctx.school_id AND course_id=co.id)+(SELECT count(*) FROM workhub.activity_imports WHERE school_id=ctx.school_id AND course_id=co.id) ELSE 0 END INTO n_records;
 SELECT count(*),count(*) FILTER(WHERE l.state<>'cancelled' AND occurrence_date>=ctx.school_today) INTO n_pub,n_future FROM workhub.timetable_lessons l WHERE school_id=ctx.school_id AND course_id=ANY(source_courses);
 impact:=jsonb_build_object('assignments',(SELECT count(*) FROM workhub.course_assignments WHERE school_id=ctx.school_id AND course_id=ANY(source_courses)),
 'courseMemberships',(SELECT count(*) FROM workhub.course_memberships WHERE school_id=ctx.school_id AND course_id=ANY(source_courses) AND(ek='course' OR student_id=st.id)),
 'enrollments',CASE WHEN ek='course' THEN (SELECT count(DISTINCT enrollment_id) FROM workhub.course_memberships WHERE course_id=co.id) ELSE(SELECT count(*) FROM workhub.student_enrollments WHERE student_id=st.id) END,
 'records',n_records,'timetableLinks',(SELECT count(*) FROM workhub.timetable_course_links WHERE school_id=ctx.school_id AND course_id=ANY(source_courses)),'publishedLessons',n_pub,'futureLessons',n_future);
 IF k IN('course_restore','student_restore') THEN IF cur_state<>(CASE WHEN k='course_restore' THEN 'archived' ELSE 'voided' END) THEN blockers:=blockers||'"ALREADY_CLOSED"';END IF;ns:='active';
 ELSIF cur_state<>'active' OR ek<>'course' AND workhub_private.p10_state(ctx.school_id,'student',st.id)<>'active' THEN blockers:=blockers||'"ALREADY_CLOSED"';END IF;
 IF k='course_correct' THEN
 a:=c;SELECT * INTO tr FROM workhub.terms WHERE school_id=ctx.school_id AND id=co.term_id;
 IF (c->>'validFrom')::date<tr.starts_on OR (c->>'validThrough')::date>=tr.ends_on THEN blockers:=blockers||'"OUTSIDE_TERM"';END IF;
 IF EXISTS(SELECT 1 FROM workhub.course_assignments WHERE course_id=co.id AND(valid_from<(c->>'validFrom')::date OR workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)>(c->>'validThrough')::date+1))
 OR EXISTS(SELECT 1 FROM workhub.course_memberships WHERE course_id=co.id AND(valid_from<(c->>'validFrom')::date OR workhub_private.p8_eff_to('course_membership',id,valid_from,valid_to)>(c->>'validThrough')::date+1)) THEN blockers:=blockers||'"PERIOD_CUTS_RELATIONS"';END IF;
 IF n_pub>0 AND (b->>'validFrom'<>c->>'validFrom' OR b->>'validThrough'<>c->>'validThrough') THEN blockers:=blockers||'"IN_PUBLISHED_TIMETABLE"';END IF;
 ELSIF k='course_teacher_correct' THEN
 b:=jsonb_build_object('teacherMemberIds',COALESCE((SELECT jsonb_agg(membership_id ORDER BY membership_id) FROM workhub.course_assignments WHERE course_id=co.id AND valid_from<workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)),'[]'));
 a:=jsonb_build_object('teacherMemberIds',(SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements_text(c->'teacherMemberIds') x));
 IF co.valid_from<=ctx.school_today THEN blockers:=blockers||'"USE_RELATION_CHANGE"';END IF;
 IF n_records>0 THEN blockers:=blockers||'"HAS_CONTENT"';END IF;IF n_pub>0 THEN blockers:=blockers||'"IN_PUBLISHED_TIMETABLE"';END IF;
 FOR target IN SELECT jsonb_array_elements_text(c->'teacherMemberIds') LOOP
 IF NOT workhub_private.p9_teacher_assignable(ctx.school_id,target) OR NOT EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=target AND daterange(co.valid_from,co.valid_to,'[)')<@daterange(m.valid_from,m.valid_to,'[)')) THEN blockers:=blockers||'"TEACHER_UNAVAILABLE"';EXIT;END IF;END LOOP;
 ELSIF k='student_correct' THEN a:=c;IF EXISTS(SELECT 1 FROM workhub.students WHERE school_id=ctx.school_id AND school_student_key=c->>'schoolStudentKey' AND id<>st.id) THEN blockers:=blockers||'"KEY_TAKEN"';END IF;
 ELSIF k='enrollment_correct' THEN a:=c;IF (c->>'grade')::integer>(SELECT grade_count FROM workhub.schools WHERE id=ctx.school_id) THEN blockers:=blockers||'"GRADE_OUT_OF_RANGE"';END IF;
 IF EXISTS(SELECT 1 FROM workhub.student_enrollments WHERE school_id=ctx.school_id AND academic_year_id=en.academic_year_id AND grade=(c->>'grade')::integer AND class_label=c->>'classLabel' AND seat_number=(c->>'seatNumber')::integer AND id<>en.id) THEN blockers:=blockers||'"SEAT_TAKEN"';END IF;
 ELSIF k IN('course_cancel','student_void') THEN ns:=CASE WHEN ek='course' THEN 'cancelled' ELSE 'voided' END;
 IF n_records>0 THEN blockers:=blockers||'"HAS_CONTENT"';END IF;IF n_pub>0 THEN blockers:=blockers||'"IN_PUBLISHED_TIMETABLE"';END IF;
 ELSIF k='course_archive' THEN ns:='archived';IF n_future>0 THEN blockers:=blockers||'"FUTURE_LESSONS"';END IF;
 END IF;
 IF k IN('course_correct','course_teacher_correct','student_correct','enrollment_correct') AND a=b THEN blockers:=blockers||'"NO_CHANGE"';END IF;
 sources:=jsonb_build_object('course',to_jsonb(co),'student',to_jsonb(st),'enrollment',to_jsonb(en),'state',cur_state,'version',v,'impact',impact,
 'assignments',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM workhub.course_assignments x WHERE school_id=ctx.school_id AND course_id=ANY(source_courses)),
 'memberships',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM workhub.course_memberships x WHERE school_id=ctx.school_id AND course_id=ANY(source_courses)),
 'ends',(SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY id),'[]') FROM workhub.teaching_relation_ends x WHERE school_id=ctx.school_id),
 'lessons',(SELECT COALESCE(jsonb_agg(jsonb_build_array(id,version,state,starts_at,ends_at) ORDER BY id),'[]') FROM workhub.timetable_lessons WHERE school_id=ctx.school_id AND course_id=ANY(source_courses)));
 RETURN jsonb_build_object('allowed',jsonb_array_length(blockers)=0,'blockers',blockers,'impact',impact,'before',b,'after',a,'stateAfter',ns,'entityKind',ek,
 'fingerprint',workhub_private.request_sha256(jsonb_build_object('intent',i,'sources',sources,'after',a,'stateAfter',ns)));
END $$;

-- 공개 명령의 필드와 원래 요청을 닫을 때의 내용도 동일하게 검사한다.
CREATE FUNCTION workhub_private.p10_command(c jsonb,k text) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' OR NOT workhub_private.p2_exact(c,ARRAY['previewId','fingerprint','intent']) OR NOT workhub_private.p5_id(c->'previewId') OR jsonb_typeof(c->'fingerprint') IS DISTINCT FROM 'string' OR c->>'fingerprint'!~'^[0-9a-f]{64}$' OR k IS NULL OR k!~'^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.p10_shape(c->'intent');
END $$;
CREATE FUNCTION workhub_private.p10_apply(ctx workhub_private.actor_context,i jsonb,p jsonb,rk text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE co workhub.courses;st workhub.students;en workhub.student_enrollments;a workhub.course_assignments;m workhub.course_memberships;rid text;k text:=i->>'kind';ek text:=p->>'entityKind';eid text:=i->>'entityId';b jsonb;n jsonb;v integer;tm text;acct text;
BEGIN
 SELECT * INTO co FROM workhub.courses WHERE school_id=ctx.school_id AND id=i->>'courseId';
 v:=workhub_private.p10_version(ctx.school_id,ek,eid)+1;
 IF ek='course' THEN b:=to_jsonb(co);n:=b||jsonb_build_object('version',v,'updated_at',clock_timestamp());
 IF k='course_correct' THEN n:=n||jsonb_build_object('label',i->'changes'->>'label','valid_from',i->'changes'->>'validFrom','valid_to',((i->'changes'->>'validThrough')::date+1)::text);END IF;
 ELSIF ek='student' THEN SELECT * INTO st FROM workhub.students WHERE id=eid;b:=to_jsonb(st);n:=b||jsonb_build_object('version',v);
 IF k='student_correct' THEN n:=n||jsonb_build_object('name',i->'changes'->>'name','school_student_key',i->'changes'->>'schoolStudentKey');END IF;
 ELSE SELECT * INTO en FROM workhub.student_enrollments WHERE id=eid;b:=to_jsonb(en);n:=b||jsonb_build_object('grade',(i->'changes'->>'grade')::integer,'class_label',i->'changes'->>'classLabel','seat_number',(i->'changes'->>'seatNumber')::integer);END IF;
 INSERT INTO workhub.school_data_revisions(school_id,entity_kind,entity_id,version,before_values,after_values,state_after,reason,membership_id,request_key)
 VALUES(ctx.school_id,ek,eid,v,b,n,p->>'stateAfter',i->>'reason',ctx.membership_id,rk);
 -- 계획 수업 담당 정정은 원행을 지우지 않고 시작 전 취소 사건과 새 담당을 남긴다.
 IF k='course_teacher_correct' THEN
 FOR a IN SELECT * FROM workhub.course_assignments WHERE school_id=ctx.school_id AND course_id=co.id AND valid_from<workhub_private.p8_eff_to('assignment',id,valid_from,valid_to) AND NOT(i->'changes'->'teacherMemberIds' ? membership_id) ORDER BY id LOOP
 INSERT INTO workhub.teaching_relation_ends(school_id,kind,relation_id,version,last_day,reason,request_key,recorded_by_membership_id)
 VALUES(ctx.school_id,'assignment',a.id,workhub_private.p8_rel_version('assignment',a.id)+1,NULL,i->>'reason',rk,ctx.membership_id);END LOOP;
 FOR tm IN SELECT jsonb_array_elements_text(i->'changes'->'teacherMemberIds') LOOP
 IF NOT EXISTS(SELECT 1 FROM workhub.course_assignments WHERE school_id=ctx.school_id AND course_id=co.id AND membership_id=tm AND valid_from<workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)) THEN
 SELECT account_id INTO acct FROM workhub.memberships WHERE school_id=ctx.school_id AND id=tm;
 INSERT INTO workhub.course_assignments(school_id,course_id,membership_id,account_id,valid_from,valid_to,created_by_membership_id)
 VALUES(ctx.school_id,co.id,tm,acct,co.valid_from,co.valid_to,ctx.membership_id);END IF;END LOOP;
 END IF;
 IF ek='course' THEN UPDATE workhub.courses SET label=n->>'label',valid_from=(n->>'valid_from')::date,valid_to=(n->>'valid_to')::date,version=v,updated_at=(n->>'updated_at')::timestamptz WHERE id=eid;
 ELSIF ek='student' THEN UPDATE workhub.students SET name=n->>'name',school_student_key=n->>'school_student_key',version=v WHERE id=eid;
 ELSE UPDATE workhub.student_enrollments SET grade=(n->>'grade')::integer,class_label=n->>'class_label',seat_number=(n->>'seat_number')::integer WHERE id=eid;END IF;
 RETURN jsonb_build_object('requestKey',rk,'kind',k,'entityId',eid,'version',v,'recordedAt',clock_timestamp());
END $$;
CREATE FUNCTION public.workhub_school_data_get(p_member_id text,p_course_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;cs jsonb;co jsonb;ss jsonb;ts jsonb;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RETURN workhub_private.p10_env(ctx,jsonb_build_object('available',false,'reason','forbidden','courses','[]'::jsonb,'course',NULL,'students','[]'::jsonb,'teachers','[]'::jsonb));END IF;
 IF NOT workhub_private.p10_ready(ctx.school_id) THEN RETURN workhub_private.p10_env(ctx,jsonb_build_object('available',false,'reason','not_configured','courses','[]'::jsonb,'course',NULL,'students','[]'::jsonb,'teachers','[]'::jsonb));END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'label',label,'version',version,'state',workhub_private.p10_state(school_id,'course',id)) ORDER BY label COLLATE "C",id),'[]') INTO cs FROM workhub.courses WHERE school_id=ctx.school_id;
 IF jsonb_array_length(cs)>2000 THEN RETURN workhub_private.p10_env(ctx,NULL,'CONFLICT');END IF;
 IF p_course_id IS NOT NULL THEN
 SELECT jsonb_build_object('id',id,'version',version,'state',workhub_private.p10_state(school_id,'course',id),'fields',workhub_private.p10_fields(school_id,'course',id),'teacherMemberIds',COALESCE((SELECT jsonb_agg(membership_id ORDER BY membership_id) FROM workhub.course_assignments WHERE course_id=c.id AND valid_from<workhub_private.p8_eff_to('assignment',id,valid_from,valid_to)),'[]')) INTO co FROM workhub.courses c WHERE school_id=ctx.school_id AND id=p_course_id;
 IF co IS NULL THEN RETURN workhub_private.p10_env(ctx,NULL,'NOT_FOUND');END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version,'state',workhub_private.p10_state(s.school_id,'student',s.id),'fields',workhub_private.p10_fields(s.school_id,'student',s.id),'enrollment',jsonb_build_object('id',e.id,'version',workhub_private.p10_version(e.school_id,'enrollment',e.id),'fields',workhub_private.p10_fields(e.school_id,'enrollment',e.id))) ORDER BY e.grade,e.class_label COLLATE "C",e.seat_number,s.id),'[]') INTO ss
 FROM workhub.course_memberships m JOIN workhub.students s ON s.id=m.student_id JOIN workhub.student_enrollments e ON e.id=m.enrollment_id WHERE m.school_id=ctx.school_id AND m.course_id=p_course_id;
 END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',m.id,'label',a.display_name,'validFrom',m.valid_from::text,'validThrough',CASE WHEN m.valid_to IS NULL THEN NULL ELSE(m.valid_to-1)::text END) ORDER BY a.display_name COLLATE "C",m.id),'[]') INTO ts FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.school_id=ctx.school_id AND workhub_private.p9_teacher_assignable(ctx.school_id,m.id);
 IF jsonb_array_length(COALESCE(ss,'[]'))>2000 OR jsonb_array_length(ts)>300 THEN RETURN workhub_private.p10_env(ctx,NULL,'CONFLICT');END IF;
 RETURN workhub_private.p10_env(ctx,jsonb_build_object('available',true,'reason',NULL,'courses',cs,'course',co,'students',COALESCE(ss,'[]'),'teachers',ts));
END $$;
CREATE FUNCTION public.workhub_school_data_preview(p_member_id text,p_intent jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;p jsonb;r workhub.school_data_previews;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RETURN workhub_private.p10_env(ctx,NULL,'FORBIDDEN');END IF;
 BEGIN
 IF NOT workhub_private.p10_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 p:=workhub_private.p10_plan(ctx,p_intent);
 INSERT INTO workhub.school_data_previews(school_id,membership_id,intent,fingerprint,plan,expires_at) VALUES(ctx.school_id,ctx.membership_id,p_intent,p->>'fingerprint',p,clock_timestamp()+interval '10 minutes') RETURNING * INTO r;
 RETURN workhub_private.p10_env(ctx,jsonb_build_object('previewId',r.id,'fingerprint',r.fingerprint,'expiresAt',r.expires_at,'intent',r.intent)|| (p-ARRAY['fingerprint','stateAfter','entityKind']));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('INVALID_INPUT','NOT_READY','NOT_FOUND','CONFLICT') THEN RETURN workhub_private.p10_env(ctx,NULL,SQLERRM);END IF;RAISE;END;
END $$;
-- 적용과 닫기는 같은 학교 잠금에서 원 요청의 최종 결과를 먼저 확인한다.
CREATE FUNCTION workhub_private.p10_write(p_member text,c jsonb,rk text,closing boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;s text;p workhub.school_data_previews;r workhub.school_data_requests;plan jsonb;h text;receipt jsonb;
BEGIN
 SELECT school_id INTO s FROM workhub.memberships WHERE id=p_member;PERFORM workhub_private.t1_lock(COALESCE(s,'-'));
 ctx:=workhub_private.member_actor(p_member,true);PERFORM workhub_private.lock_member_roles(ctx);
 IF NOT workhub_private.member_has_perm(ctx,'year.manage') THEN RETURN workhub_private.p10_env(ctx,NULL,'FORBIDDEN');END IF;
 BEGIN
 PERFORM workhub_private.p10_command(c,rk);h:=workhub_private.request_sha256(c);
 SELECT * INTO r FROM workhub.school_data_requests WHERE school_id=ctx.school_id AND membership_id=ctx.membership_id AND request_key=rk;
 IF FOUND THEN
 IF r.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF closing THEN RETURN workhub_private.p10_env(ctx,jsonb_build_object('requestKey',rk,'outcome',r.outcome,'receipt',r.receipt));END IF;
 IF r.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;RETURN workhub_private.p10_env(ctx,r.receipt);END IF;
 SELECT * INTO p FROM workhub.school_data_previews WHERE school_id=ctx.school_id AND membership_id=ctx.membership_id AND id=c->>'previewId' FOR SHARE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.intent<>c->'intent' OR p.fingerprint<>c->>'fingerprint' OR EXISTS(SELECT 1 FROM workhub.school_data_requests WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF closing THEN
 INSERT INTO workhub.school_data_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome) VALUES(ctx.school_id,ctx.membership_id,rk,h,p.id,'closed');
 RETURN workhub_private.p10_env(ctx,jsonb_build_object('requestKey',rk,'outcome','closed','receipt',NULL));END IF;
 IF NOT workhub_private.p10_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 IF p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT';END IF;
 -- 학생 정정은 그 학생이 속한 수업 전체를 같은 순서로 잠근다.
 PERFORM 1 FROM workhub.courses WHERE school_id=ctx.school_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM workhub.students WHERE school_id=ctx.school_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM workhub.student_enrollments WHERE school_id=ctx.school_id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM workhub.memberships WHERE school_id=ctx.school_id ORDER BY id FOR SHARE;
 plan:=workhub_private.p10_plan(ctx,p.intent);
 IF plan->>'fingerprint'<>p.fingerprint OR NOT(plan->>'allowed')::boolean THEN RAISE EXCEPTION 'CONFLICT';END IF;
 receipt:=workhub_private.p10_apply(ctx,p.intent,plan,rk);
 INSERT INTO workhub.school_data_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome,receipt) VALUES(ctx.school_id,ctx.membership_id,rk,h,p.id,'applied',receipt);
 PERFORM workhub_private.write_audit(ctx,'school_data.'||(p.intent->>'kind'),'school_data',p.intent->>'entityId',(receipt->>'version')::integer,'school',rk,jsonb_build_object('preview_id',p.id,'impact',plan->'impact'));
 RETURN workhub_private.p10_env(ctx,receipt);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('INVALID_INPUT','NOT_READY','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT') THEN RETURN workhub_private.p10_env(ctx,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR exclusion_violation OR foreign_key_violation THEN RETURN workhub_private.p10_env(ctx,NULL,'CONFLICT');END;
END $$;
CREATE FUNCTION public.workhub_school_data_commit(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT workhub_private.p10_write(p_member_id,p_command,p_request_key,false) $$;
CREATE FUNCTION public.workhub_school_data_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT workhub_private.p10_write(p_member_id,p_command,p_request_key,true) $$;
DO $$ DECLARE f regprocedure;BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='workhub_private' AND p.proname LIKE 'p10_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END $$;
REVOKE ALL ON FUNCTION public.workhub_school_data_get(text,text),public.workhub_school_data_preview(text,jsonb),public.workhub_school_data_commit(text,jsonb,text),public.workhub_school_data_close(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_school_data_get(text,text),public.workhub_school_data_preview(text,jsonb),public.workhub_school_data_commit(text,jsonb,text),public.workhub_school_data_close(text,jsonb,text) TO authenticated;
INSERT INTO workhub_private.p10_installs(batch,release) VALUES('P10-01','2026-10-20.1');
COMMIT;
