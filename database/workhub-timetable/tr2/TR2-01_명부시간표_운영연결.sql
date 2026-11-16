-- TR2: TR1 기본표를 별도 계보로 T2 날짜별 운영에 연결한다. 기존 현재 기준판은 바꾸지 않는다.
BEGIN;
DO $$ BEGIN
 IF to_regnamespace('timetable_roster_bridge') IS NOT NULL THEN RAISE EXCEPTION 'TR2 already installed'; END IF;
 IF to_regprocedure('teacher_roster.actor(text,boolean)') IS NULL OR to_regprocedure('workhub_private.t2_publish_apply(workhub_private.actor_context,jsonb,text,text,timestamp with time zone)') IS NULL THEN RAISE EXCEPTION 'TR1 and T2 are required'; END IF;
END $$;
-- 확정 전신과 실제 운영 정의가 다르면 설치 전체를 되돌린다. CRLF만 정규화한다.
DO $tr2_predecessors$ DECLARE r jsonb;p pg_proc;actual jsonb;BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'TR2 requires postgres owner';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements($expected$[["teacher_roster.actor(text,boolean)", "aadce01e932089cb9c46a2e03d42f088", "postgres", false, ["search_path=\"\""]], ["teacher_roster.id(jsonb)", "3be84e4e8ac6b57588df57cf02ba347e", "postgres", false, ["search_path=\"\""]], ["teacher_roster.num(jsonb,integer,integer)", "9c1ed8530a3e2e9ed2ddc57b5b0e870f", "postgres", false, ["search_path=\"\""]], ["workhub_private.forbid_change()", "4bce1b90666f92d3df5daf6fdbb38638", "postgres", false, ["search_path=\"\""]], ["workhub_private.p5_manager(workhub_private.actor_context)", "dd3a554f5555be1cb6a4d1c5ca8cf2c6", "postgres", true, ["search_path=\"\""]], ["workhub_private.p8_eff_to(text,text,date,date)", "7fe33df233b5084b73592c908db2b025", "postgres", true, ["search_path=\"\""]], ["workhub_private.p9_teacher_assignable(text,text)", "266379270643355e63d47662caac8072", "postgres", true, ["search_path=\"\""]], ["workhub_private.t1_basis_issues(jsonb)", "814671f345f4632fb214886d1cb30b54", "postgres", false, ["search_path=\"\""]], ["workhub_private.t1_placement_issues(jsonb,jsonb)", "4b0fb0a73ff3822ae504aa072026e7a9", "postgres", false, ["search_path=\"\""]], ["workhub_private.t2_conflicts(text,jsonb,text[])", "43fad3639947a0c7faf1ac9f07c89a2d", "postgres", true, ["search_path=\"\""]], ["workhub_private.t2_limit(text)", "24eed66591759e3ceb7d3dedab73c27d", "postgres", false, ["search_path=\"\""]], ["workhub_private.t2_plan_changes(jsonb)", "a201a36abd7abcf5d76932f2aab0c535", "postgres", false, ["search_path=\"\""]], ["workhub_private.t2_publish_apply(workhub_private.actor_context,jsonb,text,text,timestamp with time zone)", "1c3de7957fbfe03a51cba3b9dcae1527", "postgres", true, ["search_path=\"\""]], ["workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone)", "eff183d698f7bdd1f0e09b0d0d5bd058", "postgres", true, ["search_path=\"\""]], ["workhub_private.t2_ready(text)", "a1f0c334e6a29f0ca608e09fa40c36b9", "postgres", true, ["search_path=\"\""]]]$expected$::jsonb) LOOP
  SELECT * INTO p FROM pg_proc WHERE oid=to_regprocedure(r->>0);
  IF p.oid IS NULL OR md5(replace(pg_get_functiondef(p.oid),E'\r\n',E'\n'))<>r->>1 OR pg_get_userbyid(p.proowner)<>r->>2 OR p.prosecdef<>(r->>3)::boolean OR to_jsonb(p.proconfig) IS DISTINCT FROM r->4 THEN RAISE EXCEPTION 'TR2 predecessor mismatch: %',r->>0;END IF;
 END LOOP;
 SELECT jsonb_agg(jsonb_build_array(conname,pg_get_constraintdef(oid)) ORDER BY conname) INTO actual FROM pg_constraint WHERE conrelid='workhub.timetable_basis_revisions'::regclass;
 IF actual IS DISTINCT FROM $constraints$[["timetable_basis_revisions_body_check", "CHECK (((jsonb_typeof(basis) = 'object'::text) AND ((basis ->> 'id'::text) = id) AND ((basis ->> 'schoolId'::text) = school_id) AND ((basis ->> 'termId'::text) = term_id) AND ((basis -> 'revision'::text) = to_jsonb(revision)) AND ((basis ->> 'sourceFingerprint'::text) = source_fingerprint) AND (source_fingerprint ~ '^[0-9a-f]{64}$'::text)))"], ["timetable_basis_revisions_id_check", "CHECK ((id ~ '^[A-Za-z0-9_-]{1,100}$'::text))"], ["timetable_basis_revisions_member_fkey", "FOREIGN KEY (school_id, created_by_membership_id) REFERENCES workhub.memberships(school_id, id)"], ["timetable_basis_revisions_pkey", "PRIMARY KEY (id)"], ["timetable_basis_revisions_prep_fkey", "FOREIGN KEY (prep_draft_id, prep_draft_revision) REFERENCES workhub.timetable_prep_draft_revisions(draft_id, revision)"], ["timetable_basis_revisions_revision_check", "CHECK ((revision > 0))"], ["timetable_basis_revisions_revision_key", "UNIQUE (school_id, term_id, revision)"], ["timetable_basis_revisions_scope_key", "UNIQUE (school_id, id, term_id)"], ["timetable_basis_revisions_term_fkey", "FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id)"]]$constraints$::jsonb OR (SELECT relowner::regrole::text FROM pg_class WHERE oid='workhub.timetable_basis_revisions'::regclass)<>'postgres' OR (SELECT count(*) FROM pg_attribute WHERE attrelid='workhub.timetable_basis_revisions'::regclass AND attname IN('prep_draft_id','prep_draft_revision') AND attnotnull AND NOT attisdropped)<>2 OR EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='workhub.timetable_basis_revisions'::regclass AND attname='roster_source_id' AND NOT attisdropped) THEN RAISE EXCEPTION 'TR2 basis provenance mismatch';END IF;
 IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid='workhub.timetable_basis_revisions'::regclass) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='workhub.timetable_basis_revisions'::regclass AND tgname='timetable_basis_revisions_immutable' AND tgenabled='O' AND tgfoid='workhub_private.forbid_change()'::regprocedure) THEN RAISE EXCEPTION 'TR2 basis protection mismatch';END IF;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_timetable_roster_bridge_%') THEN RAISE EXCEPTION 'TR2 public function collision';END IF;
END $tr2_predecessors$;
CREATE SCHEMA timetable_roster_bridge;
REVOKE ALL ON SCHEMA timetable_roster_bridge FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE timetable_roster_bridge.sources(
 id text PRIMARY KEY,school_id text NOT NULL,term_id text NOT NULL,plan_id text NOT NULL,plan_version integer NOT NULL,
 fingerprint text NOT NULL,body jsonb NOT NULL,from_date date NOT NULL,until_date date NOT NULL,created_by text NOT NULL,
 UNIQUE(school_id,id,term_id),UNIQUE(school_id,fingerprint),
 FOREIGN KEY(school_id,plan_id) REFERENCES teacher_roster.plans(school_id,id),
 FOREIGN KEY(school_id,created_by) REFERENCES workhub.memberships(school_id,id),CHECK(until_date>from_date));
CREATE TRIGGER tr2_sources_immutable BEFORE UPDATE OR DELETE ON timetable_roster_bridge.sources FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
-- 기존 T1 출처 FK는 유지한다. 명부 출처인 새 기준판만 별도의 불변 원본 FK를 사용한다.
ALTER TABLE workhub.timetable_basis_revisions ADD COLUMN roster_source_id text;
ALTER TABLE workhub.timetable_basis_revisions ALTER COLUMN prep_draft_id DROP NOT NULL,ALTER COLUMN prep_draft_revision DROP NOT NULL;
ALTER TABLE workhub.timetable_basis_revisions ADD CONSTRAINT timetable_basis_origin_check CHECK(
 (roster_source_id IS NULL AND prep_draft_id IS NOT NULL AND prep_draft_revision IS NOT NULL) OR
 (roster_source_id IS NOT NULL AND prep_draft_id IS NULL AND prep_draft_revision IS NULL));
ALTER TABLE workhub.timetable_basis_revisions ADD CONSTRAINT timetable_basis_roster_origin_fkey FOREIGN KEY(school_id,roster_source_id,term_id) REFERENCES timetable_roster_bridge.sources(school_id,id,term_id);
CREATE TABLE timetable_roster_bridge.previews(
 id text PRIMARY KEY,school_id text NOT NULL,member_id text NOT NULL,input jsonb NOT NULL,source_id text,hash text NOT NULL,
 data jsonb NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),FOREIGN KEY(source_id) REFERENCES timetable_roster_bridge.sources(id));
CREATE TABLE timetable_roster_bridge.requests(
 school_id text NOT NULL,member_id text NOT NULL,request_key text NOT NULL,command_hash text NOT NULL,outcome text NOT NULL,result jsonb,
 PRIMARY KEY(school_id,member_id,request_key),FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id),
 CHECK(outcome IN('applied','closed')),CHECK((outcome='closed')=(result IS NULL)));
CREATE TRIGGER tr2_requests_immutable BEFORE UPDATE OR DELETE ON timetable_roster_bridge.requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE FUNCTION timetable_roster_bridge.actor(mid text,writing boolean) RETURNS workhub_private.actor_context LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=teacher_roster.actor(mid,writing);
 IF NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 RETURN ctx;
END $$;
CREATE FUNCTION timetable_roster_bridge.envelope(ctx workhub_private.actor_context,v jsonb) RETURNS jsonb LANGUAGE sql SET search_path='' AS $$
 SELECT jsonb_build_object('contract','timetable-roster-bridge.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'data',v)
$$;
CREATE FUNCTION timetable_roster_bridge.input(i jsonb) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a date;b date;BEGIN
 IF NOT workhub_private.p1_exact(i,ARRAY['planId','planVersion','from','until']) OR NOT teacher_roster.id(i->'planId') OR NOT teacher_roster.num(i->'planVersion',1,2147483646) OR NOT workhub_private.p5_date(i->'from') OR NOT workhub_private.p5_date(i->'until') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 a:=(i->>'from')::date;b:=(i->>'until')::date;IF a>=b OR b-a>366 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
END $$;

-- 전 기간에 같은 실제 담당 소속이 유효해야 한다. 명부 ID를 가짜 로그인 소속으로 쓰지 않는다.
CREATE FUNCTION timetable_roster_bridge.source(ctx workhub_private.actor_context,i jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p teacher_roster.plans;t workhub.terms;a date:=(i->>'from')::date;b date:=(i->>'until')::date;r jsonb;m text;members jsonb:='[]';classes jsonb:='[]';courses jsonb:='[]';issues jsonb:='[]';c workhub.courses;official text;counted integer;
BEGIN
 PERFORM timetable_roster_bridge.input(i);
 SELECT * INTO p FROM teacher_roster.plans WHERE school_id=ctx.school_id AND id=i->>'planId' FOR SHARE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.state<>'published' OR p.version<>(i->>'planVersion')::integer THEN RAISE EXCEPTION 'CONFLICT';END IF;
 SELECT * INTO t FROM workhub.terms WHERE school_id=ctx.school_id AND id=p.term_id FOR SHARE;
 -- 수업 담당 정정은 수업·소속 행의 쓰기 잠금과 직렬화한다.
 PERFORM 1 FROM workhub.courses co WHERE co.school_id=ctx.school_id AND co.id IN(SELECT x->>'id' FROM jsonb_array_elements(p.body->'courses') x) ORDER BY co.id FOR SHARE;
 PERFORM 1 FROM workhub.memberships ms WHERE ms.school_id=ctx.school_id AND ms.id IN(SELECT l.member_id FROM teacher_roster.links l WHERE l.school_id=ctx.school_id AND l.teacher_id IN(SELECT x->>'id' FROM jsonb_array_elements(p.body->'teachers') x)) ORDER BY ms.id FOR SHARE;
 IF t.state='closed' OR a<ctx.school_today OR a<(p.body->>'from')::date OR b>(p.body->>'until')::date OR a<t.starts_on OR b>t.ends_on THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p.body->'teachers') LOOP
  SELECT count(*),min(l.member_id) INTO counted,m FROM teacher_roster.links l JOIN workhub.memberships ms ON ms.school_id=l.school_id AND ms.id=l.member_id
   WHERE l.school_id=ctx.school_id AND l.teacher_id=r->>'id' AND l.from_date<=a AND l.until_date>=b AND ms.status='active' AND ms.valid_from<=a AND (ms.valid_to IS NULL OR ms.valid_to>=b) AND workhub_private.p9_teacher_assignable(ctx.school_id,ms.id);
  IF counted<>1 THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','TEACHER_UNLINKED','message',(r->>'name')||': 선택한 전체 기간의 담당 계정 연결이 필요합니다.','lessonIds','[]'::jsonb));
  ELSE members:=members||jsonb_build_array(jsonb_build_object('id',r->>'id','memberId',m,'name',r->>'name'));END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p.body->'classes') LOOP
  SELECT cm.official_id INTO official FROM teacher_roster.class_maps cm JOIN workhub.year_classes cl ON cl.school_id=cm.school_id AND cl.id=cm.official_id
   WHERE cm.school_id=ctx.school_id AND cm.plan_id=p.id AND cm.local_id=r->>'id' AND cl.academic_year_id=t.academic_year_id AND cl.removed_at IS NULL;
  IF official IS NULL THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','CLASS_UNLINKED','message',(r->>'name')||': 학급 연결을 확인해 주세요.','lessonIds','[]'::jsonb));
  ELSE classes:=classes||jsonb_build_array(jsonb_build_object('id',r->>'id','officialId',official,'name',r->>'name'));END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p.body->'courses') LOOP
  SELECT * INTO c FROM workhub.courses WHERE school_id=ctx.school_id AND id=r->>'id';
  IF to_regprocedure('workhub_private.p10_state(text,text,text)') IS NOT NULL AND c.id IS NOT NULL THEN
   IF workhub_private.p10_state(ctx.school_id,'course',c.id)<>'active' THEN issues:=issues||jsonb_build_array(jsonb_build_object('code','COURSE_INACTIVE','message',(r->>'name')||': 정정·종료 상태인 수업입니다.','lessonIds','[]'::jsonb));END IF;
  END IF;
  SELECT x->>'memberId' INTO m FROM jsonb_array_elements(members) x WHERE x->>'id'=r->>'teacherId';
  SELECT x->>'officialId' INTO official FROM jsonb_array_elements(classes) x WHERE x->>'id'=r->>'classId';
  IF c.id IS NULL OR c.term_id<>t.id OR c.valid_from>a OR c.valid_to<b OR m IS NULL OR official IS NULL OR NOT EXISTS(SELECT 1 FROM teacher_roster.course_maps cm WHERE cm.school_id=ctx.school_id AND cm.plan_id=p.id AND cm.course_id=c.id AND cm.teacher_id=r->>'teacherId' AND cm.class_id=official)
   OR NOT EXISTS(SELECT 1 FROM workhub.course_assignments ca WHERE ca.school_id=ctx.school_id AND ca.course_id=c.id AND ca.membership_id=m AND ca.valid_from<=a AND workhub_private.p8_eff_to('assignment',ca.id,ca.valid_from,ca.valid_to)>=b)
   OR EXISTS(SELECT 1 FROM workhub.course_assignments ca WHERE ca.school_id=ctx.school_id AND ca.course_id=c.id AND ca.membership_id<>m AND daterange(ca.valid_from,workhub_private.p8_eff_to('assignment',ca.id,ca.valid_from,ca.valid_to),'[)')&&daterange(a,b,'[)')) THEN
   issues:=issues||jsonb_build_array(jsonb_build_object('code','COURSE_UNLINKED','message',(r->>'name')||': 해당 기간의 수업·담당 교사 연결이 일치하지 않습니다.','lessonIds','[]'::jsonb));
  ELSE courses:=courses||jsonb_build_array(jsonb_build_object('id',c.id,'teacherId',m,'classId',official));END IF;
 END LOOP;
 RETURN jsonb_build_object('plan',p.body,'version',p.version,'members',members,'classes',classes,'courses',courses,'blockers',issues,'from',a,'until',b);
END $$;

CREATE FUNCTION timetable_roster_bridge.prepare(ctx workhub_private.actor_context,s jsonb) RETURNS text LANGUAGE plpgsql SET search_path='' AS $$
DECLARE fp text:=workhub_private.p2_sha(s);sid text:='tr2_'||fp;bid text:='tr2b_'||fp;did text:='tr2d_'||fp;b jsonb;p jsonb:=s->'plan';res jsonb;slots jsonb;lessons jsonb;placements jsonb;revision integer;
BEGIN
 IF jsonb_array_length(s->'blockers')>0 THEN RETURN NULL;END IF;
 IF EXISTS(SELECT 1 FROM timetable_roster_bridge.sources WHERE school_id=ctx.school_id AND id=sid) THEN RETURN sid;END IF;
 SELECT COALESCE(jsonb_agg(x),'[]') INTO res FROM (
  SELECT jsonb_build_object('id',m->>'memberId','kind','teacher','label',m->>'name','capacity',1) x FROM jsonb_array_elements(s->'members') m
  UNION ALL SELECT jsonb_build_object('id',c->>'officialId','kind','class','label',c->>'name','capacity',1) FROM jsonb_array_elements(s->'classes') c) r;
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','day',x->'day','label',(x->>'period')||'교시','startMinute',x->'start','endMinute',x->'end','periods',1) ORDER BY ord) INTO slots FROM jsonb_array_elements(p->'slots') WITH ORDINALITY z(x,ord);
 SELECT jsonb_agg(jsonb_build_object('id','tr2a_'||workhub_private.p2_sha(jsonb_build_array(p->>'id',x->>'id')),'courseId',x->>'courseId','label',c->>'name','periods',1,'resourceIds',jsonb_build_array(cm->>'teacherId',cm->>'classId'),'allowedSlotIds',(SELECT jsonb_agg(z->>'id' ORDER BY ord) FROM jsonb_array_elements(p->'slots') WITH ORDINALITY sl(z,ord) WHERE (z->>'end')::int-(z->>'start')::int=(SELECT (v->>'end')::int-(v->>'start')::int FROM jsonb_array_elements(p->'slots') v WHERE v->>'id'=x->>'slotId'))) ORDER BY ord),
  jsonb_agg(jsonb_build_object('lessonId','tr2a_'||workhub_private.p2_sha(jsonb_build_array(p->>'id',x->>'id')),'slotId',x->>'slotId') ORDER BY ord) INTO lessons,placements
  FROM jsonb_array_elements(p->'lessons') WITH ORDINALITY z(x,ord) JOIN jsonb_array_elements(p->'courses') c ON c->>'id'=x->>'courseId' JOIN jsonb_array_elements(s->'courses') cm ON cm->>'id'=x->>'courseId';
 SELECT COALESCE(max(br.revision),0)+1 INTO revision FROM workhub.timetable_basis_revisions br WHERE br.school_id=ctx.school_id AND br.term_id=p->>'termId';
 b:=jsonb_build_object('schemaVersion',1,'id',bid,'revision',revision,'schoolId',ctx.school_id,'termId',p->>'termId','sourceFingerprint',fp,'schoolLevel',(SELECT workhub_private.t1_level(s.school_level) FROM workhub.schools s WHERE s.id=ctx.school_id),'unsupportedFeatures','[]'::jsonb,'resources',res,'slots',slots,'lessons',lessons,
 'courseLoads',(SELECT jsonb_agg(jsonb_build_object('courseId',c->>'id','periods',c->'weeklyHours')) FROM jsonb_array_elements(p->'courses') c),'fixed','[]'::jsonb,'unavailable','[]'::jsonb,'preferences','[]'::jsonb);
 IF cardinality(workhub_private.t1_basis_issues(b))>0 OR cardinality(workhub_private.t1_placement_issues(b,placements))>0 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 INSERT INTO timetable_roster_bridge.sources VALUES(sid,ctx.school_id,p->>'termId',p->>'id',(s->>'version')::integer,fp,s,(s->>'from')::date,(s->>'until')::date,ctx.membership_id);
 INSERT INTO workhub.timetable_basis_revisions(id,school_id,term_id,revision,source_fingerprint,basis,prep_draft_id,prep_draft_revision,created_by_membership_id,request_key,roster_source_id)
 VALUES(bid,ctx.school_id,p->>'termId',revision,fp,b,NULL,NULL,ctx.membership_id,sid,sid);
 INSERT INTO workhub.timetable_drafts(id,school_id,term_id,basis_id,basis_revision,source_fingerprint,title,conditions,placements,created_by_membership_id,request_key)
 VALUES(did,ctx.school_id,p->>'termId',bid,revision,fp,left(p->>'title',100),jsonb_build_object('fixed','[]'::jsonb,'unavailable','[]'::jsonb,'preferences','[]'::jsonb),placements,ctx.membership_id,sid);
 RETURN sid;
END $$;

CREATE FUNCTION timetable_roster_bridge.plan(ctx workhub_private.actor_context,sid text,i jsonb,pid text,cutoff timestamptz) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE src timetable_roster_bridge.sources;p jsonb;rows jsonb;blocked jsonb;conf text[];d text;
BEGIN
 SELECT * INTO src FROM timetable_roster_bridge.sources WHERE school_id=ctx.school_id AND id=sid;
 IF src.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 d:='tr2d_'||src.fingerprint;
 p:=workhub_private.t2_publish_plan(ctx,jsonb_build_object('draftId',d,'draftVersion',1,'from',i->>'from','until',i->>'until'),pid,cutoff);
 -- 다른 기본표/기존 시험 자료의 취소 행은 변경 대상에서 뺀다. 같은 계보의 휴업·교환 pinned 처리는 T2를 그대로 따른다.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p->'rows') x WHERE x->>'k'='update' AND NOT EXISTS(SELECT 1 FROM workhub.timetable_lessons l JOIN workhub.timetable_basis_revisions b ON b.school_id=l.school_id AND b.id=l.basis_id JOIN timetable_roster_bridge.sources s ON s.school_id=b.school_id AND s.id=b.roster_source_id WHERE l.school_id=ctx.school_id AND l.id=x->>'id' AND s.plan_id=src.plan_id)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 SELECT COALESCE(jsonb_agg(x ORDER BY ord),'[]') INTO rows FROM jsonb_array_elements(p->'rows') WITH ORDINALITY z(x,ord)
 WHERE x->>'k'<>'cancel' OR EXISTS(SELECT 1 FROM workhub.timetable_lessons l JOIN workhub.timetable_basis_revisions b ON b.id=l.basis_id JOIN timetable_roster_bridge.sources s ON s.id=b.roster_source_id WHERE l.school_id=ctx.school_id AND l.id=x->>'id' AND s.plan_id=src.plan_id);
 SELECT COALESCE(jsonb_agg(x),'[]') INTO blocked FROM jsonb_array_elements(p->'blockers') x WHERE x->>'code' NOT IN('BASIS_OUTDATED','RESOURCE_CONFLICT','NO_CHANGES');
 conf:=workhub_private.t2_conflicts(ctx.school_id,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',x->>'id','s',x->'s','e',x->'e','uses',x->'uses')) FROM jsonb_array_elements(rows) x WHERE x->>'k'<>'cancel'),'[]'),COALESCE(ARRAY(SELECT x->>'id' FROM jsonb_array_elements(rows) x WHERE x->>'k'='cancel'),ARRAY[]::text[]));
 IF cardinality(conf)>0 THEN blocked:=blocked||jsonb_build_array(jsonb_build_object('code','RESOURCE_CONFLICT','message','기존 운영·시험 수업과 교사 또는 학급 시간이 겹칩니다. 기존 자료를 덮어쓰지 않습니다.','lessonIds',to_jsonb(conf)));END IF;
 IF jsonb_array_length(rows)>workhub_private.t2_limit('changes') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN p||jsonb_build_object('rows',rows,'blockers',blocked);
END $$;

CREATE FUNCTION public.workhub_timetable_roster_bridge_get(p_member_id text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;v jsonb;BEGIN
 ctx:=timetable_roster_bridge.actor(p_member_id,false);
 IF NOT workhub_private.t2_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',id,'version',version,'title',body->>'title','from',body->>'from','until',body->>'until','teachers',jsonb_array_length(body->'teachers'),'classes',jsonb_array_length(body->'classes'),'weeklyLessons',jsonb_array_length(body->'lessons')) ORDER BY updated_at DESC,id),'[]') INTO v FROM (SELECT * FROM teacher_roster.plans WHERE school_id=ctx.school_id AND state='published' ORDER BY updated_at DESC,id LIMIT workhub_private.t2_limit('drafts')) recent;
 RETURN timetable_roster_bridge.envelope(ctx,jsonb_build_object('plans',v));

EXCEPTION WHEN OTHERS THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','timetable-roster-bridge.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
END $$;
CREATE FUNCTION public.workhub_timetable_roster_bridge_preview(p_member_id text,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;s jsonb;sid text;pid text:=gen_random_uuid()::text;p jsonb;v jsonb;h text;at_time timestamptz:=workhub_private.t2_now();exp timestamptz:=at_time+workhub_private.t2_limit('previewLifetimeMs')*interval '1 millisecond';BEGIN
 ctx:=timetable_roster_bridge.actor(p_member_id,true);
 IF NOT workhub_private.t2_ready(ctx.school_id) OR NOT EXISTS(SELECT 1 FROM teacher_roster.schools WHERE school_id=ctx.school_id AND enabled) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 PERFORM timetable_roster_bridge.input(p_input);
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||ctx.school_id,0));PERFORM pg_advisory_xact_lock(hashtextextended('teacher_roster:'||ctx.school_id,0));
 PERFORM workhub_private.t1_lock(ctx.school_id);PERFORM workhub_private.t2_lock(ctx.school_id);
 s:=timetable_roster_bridge.source(ctx,p_input);sid:=timetable_roster_bridge.prepare(ctx,s);
 IF sid IS NULL THEN p:=jsonb_build_object('rows','[]'::jsonb,'blockers',s->'blockers','excludedDays','[]'::jsonb);
 ELSE p:=timetable_roster_bridge.plan(ctx,sid,p_input,pid,at_time);END IF;
 h:=workhub_private.p2_sha(jsonb_build_object('source',s,'plan',p));
 v:=jsonb_build_object('id',pid,'hash',h,'expiresAt',workhub_private.t2_ts(exp),'input',p_input,'timeZone',ctx.school_timezone,
 'summary',jsonb_build_object('teachers',jsonb_array_length(s#>'{plan,teachers}'),'classes',jsonb_array_length(s#>'{plan,classes}'),'weeklyLessons',jsonb_array_length(s#>'{plan,lessons}'),'changedLessons',jsonb_array_length(p->'rows')),
 'blockers',p->'blockers','changes',workhub_private.t2_plan_changes(p),'excludedDays',p->'excludedDays');
 INSERT INTO timetable_roster_bridge.previews VALUES(pid,ctx.school_id,ctx.membership_id,p_input,sid,h,v,at_time,exp);
 RETURN timetable_roster_bridge.envelope(ctx,v);

EXCEPTION WHEN OTHERS THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','timetable-roster-bridge.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
END $$;

CREATE FUNCTION timetable_roster_bridge.execute(ctx workhub_private.actor_context,c jsonb,k text,recover_only boolean,closing boolean) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r timetable_roster_bridge.requests;v timetable_roster_bridge.previews;s jsonb;p jsonb;h text;pub text;result jsonb;now_at timestamptz;
BEGIN
 IF NOT workhub_private.p1_exact(c,ARRAY['previewId','hash','input']) OR NOT teacher_roster.id(c->'previewId') OR NOT workhub_private.p5_hash(c->'hash') OR k IS NULL OR k!~'^[A-Za-z0-9_-]{8,80}$' OR recover_only IS NULL OR closing IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM timetable_roster_bridge.input(c->'input');h:=workhub_private.p2_sha(c);
 PERFORM pg_advisory_xact_lock(hashtextextended('tr2:'||ctx.school_id||':'||ctx.membership_id||':'||k,0));
 SELECT * INTO r FROM timetable_roster_bridge.requests WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND request_key=k;
 IF r.request_key IS NOT NULL THEN
  IF r.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
  IF closing THEN RETURN jsonb_build_object('outcome',r.outcome,'receipt',r.result);END IF;
  IF r.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;RETURN r.result;
 END IF;
 SELECT * INTO v FROM timetable_roster_bridge.previews WHERE id=c->>'previewId' AND school_id=ctx.school_id AND member_id=ctx.membership_id;
 IF v.id IS NULL OR v.hash<>c->>'hash' OR v.input<>c->'input' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF closing THEN INSERT INTO timetable_roster_bridge.requests VALUES(ctx.school_id,ctx.membership_id,k,h,'closed',NULL);RETURN jsonb_build_object('outcome','closed','receipt',NULL);END IF;
 IF recover_only THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF NOT workhub_private.t2_ready(ctx.school_id) OR NOT EXISTS(SELECT 1 FROM teacher_roster.schools WHERE school_id=ctx.school_id AND enabled) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 IF v.expires_at<=clock_timestamp() OR v.source_id IS NULL THEN RAISE EXCEPTION 'CONFLICT';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:'||ctx.school_id,0));PERFORM pg_advisory_xact_lock(hashtextextended('teacher_roster:'||ctx.school_id,0));
 PERFORM workhub_private.t1_lock(ctx.school_id);PERFORM workhub_private.t2_lock(ctx.school_id);
 s:=timetable_roster_bridge.source(ctx,v.input);p:=timetable_roster_bridge.plan(ctx,v.source_id,v.input,v.id,v.created_at);
 IF workhub_private.p2_sha(jsonb_build_object('source',s,'plan',p))<>v.hash THEN RAISE EXCEPTION 'CONFLICT';END IF;
 now_at:=workhub_private.t2_now();
 IF jsonb_array_length(p->'blockers')>0 OR jsonb_array_length(p->'rows')=0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p->'rows') x WHERE (x->>'s')::timestamptz<=now_at OR (x#>>'{before,time,startsAt}')::timestamptz<=now_at) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 pub:=workhub_private.t2_publish_apply(ctx,p,v.id,k,now_at);
 result:=jsonb_build_object('requestKey',k,'publicationId',pub,'changedLessons',jsonb_array_length(p->'rows'),'recordedAt',workhub_private.t2_ts(now_at),'planId',v.input->>'planId','from',v.input->>'from','until',v.input->>'until');
 INSERT INTO timetable_roster_bridge.requests VALUES(ctx.school_id,ctx.membership_id,k,h,'applied',result);
 PERFORM workhub_private.write_audit(ctx,'timetable.roster_publish','timetable_publication',pub,1,'school',k,jsonb_build_object('planId',v.input->>'planId','sourceId',v.source_id,'changedLessons',jsonb_array_length(p->'rows')));
 RETURN result;
END $$;
CREATE FUNCTION public.workhub_timetable_roster_bridge_commit(p_member_id text,p_command jsonb,p_request_key text,p_recover_only boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN ctx:=timetable_roster_bridge.actor(p_member_id,true);RETURN timetable_roster_bridge.envelope(ctx,timetable_roster_bridge.execute(ctx,p_command,p_request_key,p_recover_only,false));
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','timetable-roster-bridge.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
END $$;
CREATE FUNCTION public.workhub_timetable_roster_bridge_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;BEGIN ctx:=timetable_roster_bridge.actor(p_member_id,true);RETURN timetable_roster_bridge.envelope(ctx,timetable_roster_bridge.execute(ctx,p_command,p_request_key,false,true));
EXCEPTION WHEN OTHERS THEN
 IF SQLERRM IN('FORBIDDEN','NOT_READY','INVALID_INPUT','CONFLICT','NOT_FOUND','IDEMPOTENCY_CONFLICT') AND ctx.school_id IS NOT NULL THEN RETURN jsonb_build_object('contract','timetable-roster-bridge.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));END IF;RAISE;
END $$;
DO $$ DECLARE r record;BEGIN
 FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='timetable_roster_bridge' LOOP
 EXECUTE format('ALTER TABLE timetable_roster_bridge.%I ENABLE ROW LEVEL SECURITY',r.tablename);EXECUTE format('REVOKE ALL ON TABLE timetable_roster_bridge.%I FROM PUBLIC,anon,authenticated,service_role',r.tablename);END LOOP;
 FOR r IN SELECT oid::regprocedure AS f FROM pg_proc WHERE pronamespace='timetable_roster_bridge'::regnamespace LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.f);END LOOP;
 FOR r IN SELECT oid::regprocedure AS f FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_timetable_roster_bridge_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',r.f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',r.f);END LOOP;
END $$;
COMMIT;
