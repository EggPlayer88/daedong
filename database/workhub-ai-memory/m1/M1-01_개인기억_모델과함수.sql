-- 개인 기억만 추가한다. 기존 회원·AI 원장·비용·대화·권한 함수는 변경하지 않는다.
-- 학교별 쓰기는 기본 꺼짐이며 M1-03의 별도 승인 뒤에만 켜진다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF to_regprocedure('workhub_private.p6_installed()') IS NULL THEN RAISE EXCEPTION 'M1: P6 설치를 먼저 확인하세요.'; END IF;
 IF NOT workhub_private.p6_installed() THEN RAISE EXCEPTION 'M1: P6 설치 미완료'; END IF;
 IF to_regclass('workhub_private.m1_installs') IS NOT NULL OR to_regclass('workhub.ai_memories') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_proc WHERE proname LIKE 'm1\_%' OR proname LIKE 'workhub_ai_memory_%') THEN
  RAISE EXCEPTION 'M1: 이미 설치되었거나 같은 이름이 있습니다. 재실행하지 마세요.';
 END IF;
END $$;
CREATE TABLE workhub_private.m1_installs(
 batch text PRIMARY KEY CHECK(batch='M1-01'),release text NOT NULL,installed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER m1_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.m1_installs FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TABLE workhub.ai_memory_controls(
 school_id text PRIMARY KEY REFERENCES workhub.schools(id),enabled boolean NOT NULL DEFAULT false,
 approved_by_membership_id text NOT NULL,approval_ref text NOT NULL CHECK(length(btrim(approval_ref)) BETWEEN 1 AND 200),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(school_id,approved_by_membership_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TABLE workhub.ai_memories(
 school_id text NOT NULL,member_id text NOT NULL,id text NOT NULL CHECK(id ~ '^[A-Za-z0-9_-]{1,100}$'),
 version integer NOT NULL CHECK(version>0),title text,body text,
 category text NOT NULL CHECK(category IN('preference','routine')),enabled boolean NOT NULL,
 expires_on date,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),deleted_at timestamptz,
 PRIMARY KEY(school_id,member_id,id),FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),
 CHECK((deleted_at IS NULL AND title IS NOT NULL AND body IS NOT NULL AND length(title) BETWEEN 1 AND 80 AND length(body) BETWEEN 1 AND 1000)
 OR(deleted_at IS NOT NULL AND title IS NULL AND body IS NULL AND NOT enabled AND expires_on IS NULL))
);
CREATE TABLE workhub.ai_memory_requests(
 school_id text NOT NULL,member_id text NOT NULL,request_key text NOT NULL CHECK(request_key ~ '^[A-Za-z0-9_-]{8,100}$'),
 command_sha256 text NOT NULL CHECK(command_sha256 ~ '^[0-9a-f]{64}$'),receipt jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(school_id,member_id,request_key),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id)
);
CREATE TRIGGER ai_memory_requests_immutable BEFORE UPDATE OR DELETE ON workhub.ai_memory_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE FUNCTION workhub_private.m1_entry_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
 IF (NEW.school_id,NEW.member_id,NEW.id,NEW.created_at) IS DISTINCT FROM (OLD.school_id,OLD.member_id,OLD.id,OLD.created_at)
 OR OLD.deleted_at IS NOT NULL OR NEW.version::bigint<>OLD.version::bigint+1 THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_memories_guard BEFORE UPDATE OR DELETE ON workhub.ai_memories FOR EACH ROW EXECUTE FUNCTION workhub_private.m1_entry_guard();
CREATE FUNCTION workhub_private.m1_lock(ctx workhub_private.actor_context) RETURNS void LANGUAGE sql SET search_path='' AS $$
 SELECT pg_advisory_xact_lock(hashtextextended('m1-memory'||chr(31)||ctx.school_id||chr(31)||ctx.membership_id,0))
$$;
CREATE FUNCTION workhub_private.m1_envelope(ctx workhub_private.actor_context,p_data jsonb,p_code text DEFAULT NULL) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('contract','memory.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id)||
 CASE WHEN p_code IS NULL THEN jsonb_build_object('data',p_data) ELSE jsonb_build_object('error',jsonb_build_object('code',p_code)) END
$$;
CREATE FUNCTION workhub_private.m1_business(p text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT p=ANY(ARRAY['NOT_READY','FORBIDDEN','INACTIVE_MEMBERSHIP','INVALID_INPUT','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT'])
$$;
CREATE FUNCTION workhub_private.m1_enabled(p_school text,p_lock boolean DEFAULT false) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e boolean;
BEGIN
 IF p_lock THEN SELECT enabled INTO e FROM workhub.ai_memory_controls WHERE school_id=p_school FOR SHARE;
 ELSE SELECT enabled INTO e FROM workhub.ai_memory_controls WHERE school_id=p_school; END IF;
 RETURN coalesce(e,false);
END $$;
CREATE FUNCTION workhub_private.m1_entry(r workhub.ai_memories) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',r.id,'schoolId',r.school_id,'memberId',r.member_id,'version',r.version,'title',r.title,'body',r.body,
  'category',r.category,'enabled',r.enabled,'expiresOn',r.expires_on::text,'createdAt',workhub_private.p2_ts(r.created_at),'updatedAt',workhub_private.p2_ts(r.updated_at))
$$;
CREATE FUNCTION workhub_private.m1_version(p jsonb) RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'number' OR p::text !~ '^[0-9]{1,10}$' THEN RETURN NULL; END IF;
 IF p::text::numeric NOT BETWEEN 1 AND 2147483647 THEN RETURN NULL; END IF;
 RETURN p::text::integer;
END $$;
CREATE FUNCTION workhub_private.m1_command(c jsonb) RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE k text; fields text[];
BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 k:=c->>'kind';
 IF k='create' THEN fields:=ARRAY['kind','id','title','body','category','enabled','expiresOn','confirmed'];
 ELSIF k='update' THEN fields:=ARRAY['kind','id','title','body','category','enabled','expiresOn','confirmed','expectedVersion'];
 ELSIF k='delete' THEN fields:=ARRAY['kind','id','expectedVersion','confirmed'];
 ELSE RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF NOT workhub_private.p2_exact(c,fields) OR NOT workhub_private.p6_id(c->'id') OR c->'confirmed' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF k<>'create' AND workhub_private.m1_version(c->'expectedVersion') IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF k<>'delete' THEN
  IF NOT workhub_private.p6_text(c->'title',80) OR NOT workhub_private.p6_text(c->'body',1000)
  OR jsonb_typeof(c->'category') IS DISTINCT FROM 'string' OR c->>'category' NOT IN('preference','routine')
  OR jsonb_typeof(c->'enabled') IS DISTINCT FROM 'boolean'
  OR (c->'expiresOn'<>'null'::jsonb AND (jsonb_typeof(c->'expiresOn') IS DISTINCT FROM 'string' OR workhub_private.p1_date(c->>'expiresOn') IS NULL)) THEN
   RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
 END IF;
END $$;
CREATE FUNCTION workhub_private.m1_request(ctx workhub_private.actor_context,c jsonb,k text,action text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r workhub.ai_memories;old workhub.ai_memory_requests;h text;out jsonb;d date;
BEGIN
 PERFORM workhub_private.m1_command(c);
 IF k IS NULL OR k !~ '^[A-Za-z0-9_-]{8,100}$' OR action NOT IN('mutate','recover','close') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 h:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
 PERFORM workhub_private.m1_lock(ctx);
 SELECT * INTO old FROM workhub.ai_memory_requests WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND request_key=k;
 IF old.request_key IS NOT NULL THEN
  IF old.command_sha256<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  IF action='mutate' AND old.receipt->>'state'='closed' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  RETURN old.receipt;
 END IF;
 IF action='recover' THEN RETURN jsonb_build_object('state','missing','requestKey',k); END IF;
 IF action='close' THEN out:=jsonb_build_object('state','closed','requestKey',k);
 ELSE
  -- 삭제와 원번호 복구는 비용·AI 모듈·학교 쓰기 중지와 별개다.
  IF c->>'kind'<>'delete' AND NOT workhub_private.m1_enabled(ctx.school_id,true) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  SELECT * INTO r FROM workhub.ai_memories WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND id=c->>'id' FOR UPDATE;
  IF c->>'kind'='create' THEN
   -- 삭제한 ID도 재사용하지 않아 늦은 예전 쓰기가 새 항목에 적용되지 않는다.
   IF r.id IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   IF (SELECT count(*) FROM workhub.ai_memories WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND deleted_at IS NULL)>=50 THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   d:=workhub_private.p1_date(c->>'expiresOn');
   IF d<ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   INSERT INTO workhub.ai_memories(school_id,member_id,id,version,title,body,category,enabled,expires_on)
    VALUES(ctx.school_id,ctx.membership_id,c->>'id',1,c->>'title',c->>'body',c->>'category',(c->>'enabled')::boolean,d) RETURNING * INTO r;
  ELSE
   IF r.id IS NULL OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF r.version<>(c->>'expectedVersion')::integer OR r.version=2147483647 THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   IF c->>'kind'='delete' THEN
    UPDATE workhub.ai_memories SET title=NULL,body=NULL,enabled=false,expires_on=NULL,deleted_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
     WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND id=r.id RETURNING * INTO r;
   ELSE
    d:=workhub_private.p1_date(c->>'expiresOn');
    -- 이미 만료된 날짜를 그대로 두는 정정·중지는 허용하지만 과거 날짜로 새로 바꾸지는 않는다.
    IF d<ctx.school_today AND d IS DISTINCT FROM r.expires_on THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    UPDATE workhub.ai_memories SET title=c->>'title',body=c->>'body',category=c->>'category',enabled=(c->>'enabled')::boolean,expires_on=d,version=version+1,updated_at=clock_timestamp()
     WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND id=r.id RETURNING * INTO r;
   END IF;
  END IF;
  out:=jsonb_build_object('state','applied','requestKey',k,'kind',c->>'kind','entryId',r.id,'version',r.version);
  PERFORM workhub_private.write_audit(ctx,'memory.'||(c->>'kind'),'memory',r.id,r.version,'owner_only',k,'{}'::jsonb);
 END IF;
 -- 명령 원문·이전 본문·제목은 접수증이나 감사 이력에 복제하지 않는다.
 INSERT INTO workhub.ai_memory_requests(school_id,member_id,request_key,command_sha256,receipt) VALUES(ctx.school_id,ctx.membership_id,k,h,out);
 RETURN out;
END $$;
CREATE FUNCTION public.workhub_ai_memory_list(p_member_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;items jsonb;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);
 SELECT coalesce(jsonb_agg(workhub_private.m1_entry(r) ORDER BY r.id COLLATE "C"),'[]'::jsonb) INTO items
 FROM workhub.ai_memories r WHERE r.school_id=ctx.school_id AND r.member_id=ctx.membership_id AND r.deleted_at IS NULL;
 RETURN workhub_private.m1_envelope(ctx,jsonb_build_object('items',items,'today',ctx.school_today::text,'canWrite',workhub_private.m1_enabled(ctx.school_id)));
END $$;
CREATE FUNCTION public.workhub_ai_memory_select(p_member_id text,p_references jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;x jsonb;r workhub.ai_memories;items jsonb:='[]'::jsonb;seen text[]:='{}';
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);
 BEGIN
  IF p_references IS NULL OR jsonb_typeof(p_references)<>'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF jsonb_array_length(p_references) NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF NOT workhub_private.m1_enabled(ctx.school_id,true) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.m1_lock(ctx);
  FOR x IN SELECT value FROM jsonb_array_elements(p_references) LOOP
   IF NOT workhub_private.p2_exact(x,ARRAY['id','version']) OR NOT workhub_private.p6_id(x->'id') OR workhub_private.m1_version(x->'version') IS NULL
   OR x->>'id'=ANY(seen) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
   seen:=array_append(seen,x->>'id');
   SELECT * INTO r FROM workhub.ai_memories WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND id=x->>'id' FOR SHARE;
   IF r.id IS NULL OR r.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   IF r.version<>(x->>'version')::integer OR NOT r.enabled OR r.expires_on<ctx.school_today THEN RAISE EXCEPTION 'CONFLICT'; END IF;
   items:=items||jsonb_build_array(workhub_private.m1_entry(r));
  END LOOP;
  RETURN workhub_private.m1_envelope(ctx,jsonb_build_object('items',items,'today',ctx.school_today::text));
 EXCEPTION WHEN raise_exception THEN
  IF workhub_private.m1_business(SQLERRM) THEN RETURN workhub_private.m1_envelope(ctx,NULL,SQLERRM); END IF;RAISE;
 END;
END $$;
CREATE FUNCTION public.workhub_ai_memory_mutate(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);
 BEGIN RETURN workhub_private.m1_envelope(ctx,workhub_private.m1_request(ctx,p_command,p_request_key,'mutate'));
 EXCEPTION WHEN raise_exception THEN IF workhub_private.m1_business(SQLERRM) THEN RETURN workhub_private.m1_envelope(ctx,NULL,SQLERRM); END IF;RAISE;END;
END $$;
CREATE FUNCTION public.workhub_ai_memory_recover(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);
 BEGIN RETURN workhub_private.m1_envelope(ctx,workhub_private.m1_request(ctx,p_command,p_request_key,'recover'));
 EXCEPTION WHEN raise_exception THEN IF workhub_private.m1_business(SQLERRM) THEN RETURN workhub_private.m1_envelope(ctx,NULL,SQLERRM); END IF;RAISE;END;
END $$;
CREATE FUNCTION public.workhub_ai_memory_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);
 BEGIN RETURN workhub_private.m1_envelope(ctx,workhub_private.m1_request(ctx,p_command,p_request_key,'close'));
 EXCEPTION WHEN raise_exception THEN IF workhub_private.m1_business(SQLERRM) THEN RETURN workhub_private.m1_envelope(ctx,NULL,SQLERRM); END IF;RAISE;END;
END $$;
DO $$ DECLARE t text;f text;BEGIN
 FOREACH t IN ARRAY ARRAY['workhub_private.m1_installs','workhub.ai_memory_controls','workhub.ai_memories','workhub.ai_memory_requests'] LOOP
  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',t);EXECUTE format('REVOKE ALL ON TABLE %s FROM PUBLIC,anon,authenticated,service_role',t);
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 'm1\_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);
 END LOOP;
 FOR f IN SELECT oid::regprocedure::text FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_ai_memory_%' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);
 END LOOP;
END $$;
INSERT INTO workhub_private.m1_installs(batch,release) VALUES('M1-01','2026-10-21.1');
COMMIT;
