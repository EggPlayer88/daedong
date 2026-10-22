-- P10만 새 파일로 적용한다. 정정은 같은 트랜잭션의 전후 원장 없이는 불가능하다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM workhub_private.p10_installs WHERE batch='P10-01') OR EXISTS(SELECT 1 FROM workhub_private.p10_installs WHERE batch='P10-02') THEN RAISE EXCEPTION 'P10: 설치 순서를 확인하세요.';END IF;END $$;
CREATE FUNCTION workhub_private.p10_entity_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE k text;allowed text[];b jsonb;n jsonb;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 k:=CASE TG_TABLE_NAME WHEN 'courses' THEN 'course' WHEN 'students' THEN 'student' ELSE 'enrollment' END;b:=to_jsonb(OLD);n:=to_jsonb(NEW);
 allowed:=CASE k WHEN 'course' THEN ARRAY['label','valid_from','valid_to','version','updated_at'] WHEN 'student' THEN ARRAY['name','school_student_key','version'] ELSE ARRAY['grade','class_label','seat_number'] END;
 IF b-allowed<>n-allowed THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF k='course' AND b-ARRAY['version','updated_at']=n-ARRAY['version','updated_at'] AND workhub_private.p10_state(OLD.school_id,k,OLD.id)='active' THEN RETURN NEW;END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.school_data_revisions r WHERE r.school_id=OLD.school_id AND r.entity_kind=k AND r.entity_id=OLD.id AND r.transaction_id=txid_current() AND r.before_values=b AND r.after_values=n) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE r record;d text;BEGIN
 FOR r IN SELECT * FROM(VALUES('courses','courses_identity','b735e42e395ced4753a840e8be3da6f6'),('students','students_immutable','6d837545425235dc05fdaff352b2ef09'),('student_enrollments','student_enrollments_immutable','2fb357717bc944f120d90929891df594')) x(t,n,h) LOOP
 SELECT pg_get_triggerdef(oid) INTO d FROM pg_trigger WHERE tgrelid=('workhub.'||r.t)::regclass AND tgname=r.n AND NOT tgisinternal AND tgenabled='O';
 IF d IS NULL OR md5(d)<>r.h THEN RAISE EXCEPTION 'P10: 원래 보호 트리거가 다릅니다: %',r.n;END IF;
 EXECUTE format('DROP TRIGGER %I ON workhub.%I',r.n,r.t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON workhub.%I FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_entity_guard()',r.n,r.t);END LOOP;
END $$;
CREATE FUNCTION workhub_private.p10_assignment_overlap() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 PERFORM 1 FROM workhub.courses WHERE school_id=NEW.school_id AND id=NEW.course_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM workhub.course_assignments a WHERE a.course_id=NEW.course_id AND a.membership_id=NEW.membership_id AND daterange(a.valid_from,workhub_private.p8_eff_to('assignment',a.id,a.valid_from,a.valid_to),'[)')&&daterange(NEW.valid_from,NEW.valid_to,'[)')) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN NEW;END $$;
DO $$ DECLARE d text;BEGIN SELECT pg_get_constraintdef(oid) INTO d FROM pg_constraint WHERE conrelid='workhub.course_assignments'::regclass AND conname='course_assignments_no_overlap';
 IF d IS DISTINCT FROM 'EXCLUDE USING gist (course_id WITH =, membership_id WITH =, daterange(valid_from, valid_to, ''[)''::text) WITH &&)' THEN RAISE EXCEPTION 'P10: 담당 중복 제약이 원본과 다릅니다';END IF;
 ALTER TABLE workhub.course_assignments DROP CONSTRAINT course_assignments_no_overlap;
END $$;
CREATE TRIGGER p10_assignment_overlap BEFORE INSERT ON workhub.course_assignments FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_assignment_overlap();
CREATE FUNCTION workhub_private.p10_active_write() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE j jsonb:=to_jsonb(NEW);cid text;sid text;s text:=j->>'school_id';
BEGIN
 cid:=j->>'course_id';sid:=j->>'student_id';
 IF TG_TABLE_NAME='timetable_lessons' AND j->>'state'='cancelled' THEN RETURN NEW;END IF;
 IF cid IS NULL THEN
 IF TG_TABLE_NAME='teaching_relation_ends' THEN
 IF j->>'kind'='assignment' THEN SELECT course_id INTO cid FROM workhub.course_assignments WHERE id=j->>'relation_id';
 ELSIF j->>'kind'='course_membership' THEN SELECT course_id,student_id INTO cid,sid FROM workhub.course_memberships WHERE id=j->>'relation_id';
 ELSE SELECT student_id INTO sid FROM workhub.student_enrollments WHERE id=j->>'relation_id';END IF;
 ELSIF TG_TABLE_NAME='teaching_record_revisions' THEN SELECT course_id,student_id INTO cid,sid FROM workhub.teaching_records WHERE id=j->>'record_id';
 ELSIF TG_TABLE_NAME='assessment_revisions' THEN SELECT course_id,student_id INTO cid,sid FROM workhub.assessments WHERE id=j->>'assessment_id';
 ELSIF TG_TABLE_NAME='rubric_revisions' THEN SELECT course_id INTO cid FROM workhub.rubrics WHERE id=j->>'rubric_id';
 ELSIF TG_TABLE_NAME IN('activity_item_revisions','activity_item_omissions') THEN SELECT course_id INTO cid FROM workhub.activity_items WHERE id=j->>'item_id';END IF;END IF;
 IF cid IS NOT NULL THEN PERFORM 1 FROM workhub.courses WHERE school_id=s AND id=cid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF workhub_private.p10_state(s,'course',cid)<>'active' THEN RAISE EXCEPTION 'CONFLICT';END IF;END IF;
 IF sid IS NOT NULL THEN PERFORM 1 FROM workhub.students WHERE school_id=s AND id=sid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF workhub_private.p10_state(s,'student',sid)<>'active' THEN RAISE EXCEPTION 'CONFLICT';END IF;END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text;BEGIN FOREACH t IN ARRAY ARRAY['course_assignments','course_memberships','activity_imports','activity_items','activity_item_revisions','activity_item_omissions','teaching_records','teaching_record_revisions','rubrics','rubric_revisions','assessments','assessment_revisions','timetable_course_links','timetable_lessons','student_enrollments','teaching_relation_ends'] LOOP
 EXECUTE format('CREATE TRIGGER p10_active_write BEFORE INSERT OR UPDATE ON workhub.%I FOR EACH ROW EXECUTE FUNCTION workhub_private.p10_active_write()',t);END LOOP;END $$;
DO $$ DECLARE r record;f oid;b text;src text;BEGIN
 FOR r IN SELECT * FROM(VALUES
 ('p5_roster_import','f667838187f9911314ca2541f2ef7230','    IF s.id IS NULL THEN',E'    IF s.id IS NOT NULL AND workhub_private.p10_state(s.school_id,''student'',s.id)<>''active'' THEN RAISE EXCEPTION ''CONFLICT'';END IF;\n    IF s.id IS NULL THEN'),
 ('p5_course_snapshot','6f1d70f7886ae1af469a50521517c0df','m.course_id = c.id;','m.course_id = c.id AND workhub_private.p10_state(s.school_id,''student'',s.id)=''active'';'),
 ('p5_course_get','03cc71ea039ce8e243033fc9a6f3e6a5','  RETURN c;',E'  IF p_lock <> ''none'' AND workhub_private.p10_state(c.school_id,''course'',c.id)<>''active'' THEN RAISE EXCEPTION ''CONFLICT'';END IF;\n  RETURN c;'),
 ('p5_course_dto','7937a39dd3acecfe588a117f0402ab65',E'''canRecord'', x.a IS NOT NULL',E'''canRecord'', x.a IS NOT NULL AND workhub_private.p10_state(c.school_id,''course'',c.id)=''active'''),
 ('t1_build','27aee1a4c9085c5ba449c8cdeb6b0112','c.term_id = t.id','c.term_id = t.id AND workhub_private.p10_state(c.school_id,''course'',c.id)=''active''')
 ) x(n,h,a,z) LOOP
 SELECT oid,prosrc INTO f,src FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname=r.n;
 IF md5(replace(src,chr(13),''))<>r.h OR position(r.a IN src)=0 THEN RAISE EXCEPTION 'P10: 교체 대상 원본과 다릅니다: %',r.n;END IF;
 b:=replace(pg_get_functiondef(f),r.a,r.z);
 IF r.n='p5_course_dto' THEN b:=replace(b,'''canManageRoster'', workhub_private.p5_manager(p_ctx) OR x.a IS NOT NULL','''canManageRoster'', (workhub_private.p5_manager(p_ctx) OR x.a IS NOT NULL) AND workhub_private.p10_state(c.school_id,''course'',c.id)=''active''');END IF;
 IF r.n='t1_build' THEN b:=replace(b,'cm.school_id = p_school AND','cm.school_id = p_school AND workhub_private.p10_state(cm.school_id,''student'',cm.student_id)=''active'' AND');END IF;
 EXECUTE b;END LOOP;END $$;
DO $$ DECLARE f regprocedure;BEGIN FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='workhub_private' AND p.proname LIKE 'p10_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END $$;
INSERT INTO workhub_private.p10_installs(batch,release) VALUES('P10-02','2026-10-20.1');
COMMIT;
