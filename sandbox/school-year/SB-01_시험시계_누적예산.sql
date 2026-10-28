-- 운영 설치용이 아니다. 전용 설치기가 만든 시험 환경 식별자가 반드시 있어야 한다.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM sandbox_private.environment WHERE project_ref='vfnemvoszjglfblsrzoh' AND run_id='daedong-year-20261028') THEN RAISE EXCEPTION 'SANDBOX_ONLY'; END IF;
END $$;
CREATE TABLE sandbox_private.cohort(
 user_id uuid PRIMARY KEY REFERENCES auth.users(id), teacher_id text UNIQUE NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('administrator_teacher','timetable_manager_teacher','teacher')),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '30 days'
);
CREATE TABLE sandbox_private.clock_state(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),revision integer NOT NULL DEFAULT 1,
 start_at timestamptz NOT NULL, end_at timestamptz NOT NULL, real_seconds integer NOT NULL CHECK(real_seconds=3600),
 CHECK(end_at>start_at)
);
CREATE TABLE sandbox_private.clock_segments(
 revision integer PRIMARY KEY,real_at timestamptz NOT NULL,virtual_at timestamptz NOT NULL,running boolean NOT NULL
);
CREATE TABLE sandbox_private.clock_commands(user_id uuid NOT NULL,request_key text NOT NULL,input jsonb NOT NULL,result jsonb NOT NULL,PRIMARY KEY(user_id,request_key));
INSERT INTO sandbox_private.clock_state VALUES(true,1,'2027-03-01 00:00:00+09','2028-03-01 00:00:00+09',3600);
INSERT INTO sandbox_private.clock_segments SELECT 1,clock_timestamp(),start_at,false FROM sandbox_private.clock_state;
CREATE TABLE sandbox_private.ai_limit(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),enabled boolean NOT NULL DEFAULT false,cap_micro_usd bigint NOT NULL DEFAULT 9000000 CHECK(cap_micro_usd=9000000),burned_micro_usd bigint NOT NULL DEFAULT 0 CHECK(burned_micro_usd BETWEEN 0 AND 9000000));
INSERT INTO sandbox_private.ai_limit(singleton) VALUES(true);
CREATE TABLE sandbox_private.ai_charges(request_id text PRIMARY KEY,ceiling_micro_usd bigint NOT NULL CHECK(ceiling_micro_usd>0),created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE sandbox_private.overrides(signature text PRIMARY KEY,before_sha256 text NOT NULL,after_sha256 text NOT NULL,reason text NOT NULL);
DO $$ DECLARE t record; BEGIN FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='sandbox_private' LOOP
 EXECUTE format('ALTER TABLE sandbox_private.%I ENABLE ROW LEVEL SECURITY',t.tablename);
END LOOP; END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA sandbox_private FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION sandbox_private.allowed() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM sandbox_private.cohort c JOIN public.users u ON u.id=c.user_id::text WHERE c.user_id=auth.uid() AND c.expires_at>statement_timestamp() AND u.is_active)
$$;
CREATE FUNCTION sandbox_private.domain_at(p_real timestamptz) RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT least(c.end_at,s.virtual_at + CASE WHEN s.running THEN greatest(interval '0',p_real-s.real_at)*extract(epoch FROM(c.end_at-c.start_at))/c.real_seconds ELSE interval '0' END)
 FROM sandbox_private.clock_state c CROSS JOIN LATERAL(SELECT * FROM sandbox_private.clock_segments WHERE real_at<=p_real ORDER BY revision DESC LIMIT 1)s
$$;
CREATE FUNCTION sandbox_private.domain_now() RETURNS timestamptz LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' AS $$ SELECT sandbox_private.domain_at(clock_timestamp()) $$;
CREATE FUNCTION public.workhub_sandbox_status() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE c sandbox_private.clock_state;s sandbox_private.clock_segments;b sandbox_private.ai_limit;
BEGIN
 IF NOT sandbox_private.allowed() THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO c FROM sandbox_private.clock_state; SELECT * INTO s FROM sandbox_private.clock_segments ORDER BY revision DESC LIMIT 1;SELECT * INTO b FROM sandbox_private.ai_limit;
 RETURN jsonb_build_object('contract','school-sandbox.v1','projectRef','vfnemvoszjglfblsrzoh','revision',c.revision,'realNow',clock_timestamp(),'virtualNow',sandbox_private.domain_now(),
 'startAt',c.start_at,'endAt',c.end_at,'speed',extract(epoch FROM(c.end_at-c.start_at))/c.real_seconds,'running',s.running AND sandbox_private.domain_now()<c.end_at,
 'segments',(SELECT jsonb_agg(jsonb_build_object('realAt',real_at,'virtualAt',virtual_at,'running',running) ORDER BY revision) FROM sandbox_private.clock_segments),
 'canControl',EXISTS(SELECT 1 FROM sandbox_private.cohort WHERE user_id=auth.uid() AND purpose='administrator_teacher'),
 'ai',jsonb_build_object('enabled',b.enabled,'capMicroUsd',b.cap_micro_usd,'reservedCeilingMicroUsd',b.burned_micro_usd,'availableCeilingMicroUsd',b.cap_micro_usd-b.burned_micro_usd));
END $$;
CREATE FUNCTION public.workhub_sandbox_clock_control(p_action text,p_expected_version integer,p_request_key text,p_advance_to timestamptz DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c sandbox_private.clock_state;s sandbox_private.clock_segments;old sandbox_private.clock_commands;inp jsonb;r jsonb;v timestamptz;at timestamptz;
BEGIN
 IF NOT sandbox_private.allowed() OR NOT EXISTS(SELECT 1 FROM sandbox_private.cohort WHERE user_id=auth.uid() AND purpose='administrator_teacher') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF p_action IS NULL OR p_action NOT IN('resume','pause','advance') OR p_expected_version IS NULL OR p_expected_version<1 OR p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9_-]{8,100}$' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 inp:=jsonb_build_array(p_action,p_expected_version,p_advance_to);
 SELECT * INTO c FROM sandbox_private.clock_state FOR UPDATE;
 SELECT * INTO old FROM sandbox_private.clock_commands WHERE user_id=auth.uid() AND request_key=p_request_key;
 IF FOUND THEN IF old.input<>inp THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF; RETURN old.result;END IF;
 IF c.revision<>p_expected_version THEN RAISE EXCEPTION 'CONFLICT';END IF;
 at:=clock_timestamp();v:=sandbox_private.domain_at(at);
 SELECT * INTO s FROM sandbox_private.clock_segments ORDER BY revision DESC LIMIT 1;
 IF p_action='advance' THEN
  IF s.running OR p_advance_to IS NULL OR p_advance_to<v OR p_advance_to>c.end_at THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;v:=p_advance_to;
 ELSIF p_advance_to IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 UPDATE sandbox_private.clock_state SET revision=revision+1 RETURNING * INTO c;
 INSERT INTO sandbox_private.clock_segments VALUES(c.revision,at,v,p_action='resume' AND v<c.end_at);
 r:=public.workhub_sandbox_status();INSERT INTO sandbox_private.clock_commands VALUES(auth.uid(),p_request_key,inp,r);RETURN r;
END $$;

-- 모든 계정·기능·실제 월을 합친 누적 상한. 호출 시작 시 최대 예약액의 두 배를
-- 차감하고 실패·응답 유실·월 변경·키 교체에도 돌려주지 않아 재시도로 한도가 늘지 않는다.
CREATE FUNCTION sandbox_private.charge_ai() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE b sandbox_private.ai_limit;amount bigint;
BEGIN
 IF NEW.state='started' AND (TG_OP='INSERT' OR OLD.state IS DISTINCT FROM 'started') THEN
  SELECT * INTO b FROM sandbox_private.ai_limit FOR UPDATE;
  IF NOT b.enabled THEN RAISE EXCEPTION 'NOT_READY';END IF;
  IF NOT EXISTS(SELECT 1 FROM sandbox_private.cohort WHERE user_id=NEW.actor_user_id AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
  IF EXISTS(SELECT 1 FROM sandbox_private.ai_charges WHERE request_id=NEW.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
  amount:=greatest(NEW.reserved_micro_usd,20000)*2;
  IF NEW.reserved_micro_usd<=0 OR b.burned_micro_usd+amount>b.cap_micro_usd THEN RAISE EXCEPTION 'BUDGET_EXCEEDED';END IF;
  UPDATE sandbox_private.ai_limit SET burned_micro_usd=burned_micro_usd+amount;
  INSERT INTO sandbox_private.ai_charges(request_id,ceiling_micro_usd) VALUES(NEW.id,amount);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER sandbox_ai_budget BEFORE INSERT OR UPDATE ON workhub.ai_gateway_requests FOR EACH ROW EXECUTE FUNCTION sandbox_private.charge_ai();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA sandbox_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_sandbox_status(),public.workhub_sandbox_clock_control(text,integer,text,timestamptz) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_sandbox_status(),public.workhub_sandbox_clock_control(text,integer,text,timestamptz) TO authenticated;
COMMIT;
