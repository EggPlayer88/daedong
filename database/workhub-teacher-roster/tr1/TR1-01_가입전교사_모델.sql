-- TR1: 가입 전 편성 교사와 로그인 소속을 분리한다. 기존 계정·권한·시간표 표는 고치지 않는다.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('teacher_roster') IS NOT NULL THEN RAISE EXCEPTION 'TR1 already installed'; END IF;
 IF to_regprocedure('workhub_private.p9_teacher_assignable(text,text)') IS NULL
 OR to_regclass('workhub.course_assignments') IS NULL OR to_regclass('workhub.staff_assignments') IS NULL
 THEN RAISE EXCEPTION 'TR1 requires P1/P5/P9'; END IF;
END $$;
CREATE SCHEMA teacher_roster;
REVOKE ALL ON SCHEMA teacher_roster FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE teacher_roster.installs(batch text PRIMARY KEY,installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE teacher_roster.schools(
 school_id text PRIMARY KEY REFERENCES workhub.schools(id),revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),enabled boolean NOT NULL DEFAULT true);
CREATE TABLE teacher_roster.teachers(
 school_id text NOT NULL REFERENCES workhub.schools(id),id text NOT NULL,name text NOT NULL,kind text NOT NULL,
 PRIMARY KEY(school_id,id),CHECK(id~'^[A-Za-z0-9_-]{1,80}$'),CHECK(length(name) BETWEEN 1 AND 100 AND name=btrim(name)),CHECK(kind IN('person','vacancy')));
CREATE TABLE teacher_roster.plans(
 school_id text NOT NULL REFERENCES workhub.schools(id),id text NOT NULL,term_id text NOT NULL,version integer NOT NULL,
 state text NOT NULL DEFAULT 'draft',body jsonb NOT NULL,created_by text NOT NULL,updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,id),FOREIGN KEY(school_id,term_id) REFERENCES workhub.terms(school_id,id),
 FOREIGN KEY(school_id,created_by) REFERENCES workhub.memberships(school_id,id),CHECK(state IN('draft','published')),CHECK(version>0),CHECK(jsonb_typeof(body)='object'));
CREATE TABLE teacher_roster.links(
 school_id text NOT NULL,teacher_id text NOT NULL,member_id text NOT NULL,from_date date NOT NULL,until_date date NOT NULL,
 linked_by text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,teacher_id,from_date),FOREIGN KEY(school_id,teacher_id) REFERENCES teacher_roster.teachers(school_id,id),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),FOREIGN KEY(school_id,linked_by) REFERENCES workhub.memberships(school_id,id),
 CHECK(until_date>from_date),
 EXCLUDE USING gist(school_id WITH =,teacher_id WITH =,daterange(from_date,until_date,'[)') WITH &&),
 EXCLUDE USING gist(school_id WITH =,member_id WITH =,daterange(from_date,until_date,'[)') WITH &&));
CREATE TABLE teacher_roster.course_maps(
 school_id text NOT NULL,plan_id text NOT NULL,course_id text NOT NULL,teacher_id text NOT NULL,class_id text NOT NULL,
 PRIMARY KEY(school_id,plan_id,course_id),FOREIGN KEY(school_id,plan_id) REFERENCES teacher_roster.plans(school_id,id),
 FOREIGN KEY(school_id,course_id) REFERENCES workhub.courses(school_id,id),FOREIGN KEY(school_id,teacher_id) REFERENCES teacher_roster.teachers(school_id,id));
CREATE TABLE teacher_roster.class_maps(
 school_id text NOT NULL,plan_id text NOT NULL,local_id text NOT NULL,official_id text NOT NULL,
 PRIMARY KEY(school_id,plan_id,local_id),FOREIGN KEY(school_id,plan_id) REFERENCES teacher_roster.plans(school_id,id),FOREIGN KEY(official_id) REFERENCES workhub.year_classes(id));
CREATE TABLE teacher_roster.previews(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,school_id text NOT NULL,member_id text NOT NULL,
 intent jsonb NOT NULL,fingerprint text NOT NULL,findings jsonb NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE teacher_roster.requests(
 school_id text NOT NULL,member_id text NOT NULL,request_key text NOT NULL,command_hash text NOT NULL,preview_id text NOT NULL UNIQUE,
 outcome text NOT NULL,result jsonb,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,member_id,request_key),FOREIGN KEY(preview_id) REFERENCES teacher_roster.previews(id),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),CHECK(outcome IN('applied','closed')),CHECK((outcome='closed')=(result IS NULL)));
CREATE TABLE teacher_roster.history(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,school_id text NOT NULL,member_id text NOT NULL,request_key text NOT NULL,intent jsonb NOT NULL,
 before_value jsonb,after_value jsonb,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id));
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='teacher_roster' LOOP
 EXECUTE format('ALTER TABLE teacher_roster.%I ENABLE ROW LEVEL SECURITY',r.tablename);
 EXECUTE format('REVOKE ALL ON TABLE teacher_roster.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);
 END LOOP;
END $$;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA teacher_roster FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER tr1_requests_immutable BEFORE UPDATE OR DELETE ON teacher_roster.requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER tr1_history_immutable BEFORE UPDATE OR DELETE ON teacher_roster.history FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER tr1_links_immutable BEFORE UPDATE OR DELETE ON teacher_roster.links FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
INSERT INTO teacher_roster.installs(batch) VALUES('TR1-01');
COMMIT;
SELECT 'TR1-01' AS no,'ok' AS status;
