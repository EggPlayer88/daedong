-- 기간 전체를 재검증한 뒤 한 트랜잭션에서 반영한다. 기존 휴업·수업·실시 기록은 삭제하지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM workhub_private.af1_installs WHERE batch='AF1-02') THEN RAISE EXCEPTION 'AF1-02가 필요합니다.';END IF;END $$;
CREATE TABLE workhub.annual_closure_previews(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text, school_id text NOT NULL, member_id text NOT NULL,account_id text NOT NULL,
 input jsonb NOT NULL, plan jsonb NOT NULL, fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 assessed_at timestamptz NOT NULL,created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL CHECK(expires_at>created_at AND expires_at-created_at<=interval '15 minutes'),
 FOREIGN KEY(school_id,member_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id));
CREATE TABLE workhub.annual_closure_days(
 school_id text NOT NULL,change_id text PRIMARY KEY REFERENCES workhub.timetable_school_day_changes(id),
 period_id text NOT NULL REFERENCES workhub.annual_closure_previews(id),
 classification text NOT NULL CHECK(classification IN('vacation','statutory_holiday','school_trip','temporary')));
CREATE TABLE workhub.annual_empty_releases(
 school_id text NOT NULL,change_id text PRIMARY KEY REFERENCES workhub.timetable_school_day_changes(id),
 member_id text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.annual_makeup_resolutions(
 school_id text NOT NULL,lesson_id text NOT NULL,lesson_version integer NOT NULL CHECK(lesson_version>0),
 member_id text NOT NULL,reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 500),recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,lesson_id,lesson_version),FOREIGN KEY(school_id,lesson_id) REFERENCES workhub.timetable_lessons(school_id,id),
 FOREIGN KEY(school_id,member_id) REFERENCES workhub.memberships(school_id,id));
CREATE TABLE workhub.annual_commands(
 school_id text NOT NULL,member_id text NOT NULL,account_id text NOT NULL,key text NOT NULL CHECK(length(key) BETWEEN 8 AND 200),
 command_hash text NOT NULL CHECK(command_hash ~ '^[0-9a-f]{64}$'),receipt jsonb NOT NULL,
 PRIMARY KEY(school_id,member_id,key),FOREIGN KEY(school_id,member_id,account_id) REFERENCES workhub.memberships(school_id,id,account_id));
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['annual_closure_previews','annual_closure_days','annual_empty_releases','annual_makeup_resolutions','annual_commands'] LOOP
 EXECUTE format('ALTER TABLE workhub.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON workhub.%I FROM PUBLIC,anon,authenticated,service_role',t);
 EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON workhub.%I FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change()',t||'_immutable',t);
 END LOOP;END $$;
-- 예정 수업이 없는 날도 휴업 범위를 보존한다. AF1 원본을 가진 휴업만 빈 수업 배열을 허용한다.
DO $$ BEGIN IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='workhub.timetable_school_day_changes'::regclass AND conname='timetable_school_day_changes_shape_check')
 IS DISTINCT FROM 'CHECK (((jsonb_typeof(input) = ''object''::text) AND (jsonb_typeof(changed_lessons) = ''array''::text) AND (jsonb_array_length(changed_lessons) > 0) AND (lost_lesson_count >= 0)))'
 THEN RAISE EXCEPTION 'AF1: 학사 변경 제약 원문 불일치';END IF;END $$;
ALTER TABLE workhub.timetable_school_day_changes DROP CONSTRAINT timetable_school_day_changes_shape_check;
ALTER TABLE workhub.timetable_school_day_changes ADD CONSTRAINT timetable_school_day_changes_shape_check CHECK(jsonb_typeof(input)='object' AND jsonb_typeof(changed_lessons)='array' AND (jsonb_array_length(changed_lessons)>0 OR (input->>'kind'='closure' AND input ? 'annualPeriodId')) AND lost_lesson_count>=0);

CREATE FUNCTION workhub_private.af1_makeup_needed(l workhub.timetable_lessons) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM workhub.annual_makeup_resolutions r WHERE r.school_id=l.school_id AND r.lesson_id=l.id AND r.lesson_version=l.version)
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_lesson_versions v JOIN workhub.annual_closure_days d ON d.school_id=v.school_id AND d.change_id=v.source_id
 WHERE v.school_id=l.school_id AND v.lesson_id=l.id AND v.version=l.version AND v.change_kind='school_day' AND d.classification IN('vacation','statutory_holiday'))
$$;
CREATE FUNCTION workhub_private.af1_period_plan(ctx workhub_private.actor_context,i jsonb,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE span daterange; day date; groups jsonb; daily jsonb; days jsonb:='[]'; blocks jsonb:='[]'; count_ int:=0; originals jsonb; selected text[];
BEGIN
 IF NOT workhub_private.p2_exact(i,ARRAY['from','until','groupIds','classification','reason'])
 OR NOT workhub_private.p7_text(i->'reason',500,true) OR i->>'classification' NOT IN('vacation','statutory_holiday','school_trip','temporary')
 OR jsonb_typeof(i->'classification')<>'string' OR jsonb_typeof(i->'groupIds')<>'array' OR jsonb_array_length(i->'groupIds') NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 span:=workhub_private.t2_range(i->>'from',i->>'until',62);
 IF lower(span)<ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(i->'groupIds') g WHERE NOT workhub_private.p7_id(g)) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 selected:=ARRAY(SELECT jsonb_array_elements_text(i->'groupIds'));
 IF cardinality(selected)<>(SELECT count(DISTINCT g) FROM unnest(selected) g) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub.terms t JOIN workhub.timetable_basis_revisions b ON b.school_id=t.school_id AND b.term_id=t.id
 WHERE t.school_id=ctx.school_id AND t.state<>'closed' AND daterange(t.starts_on,t.ends_on,'[)') @> span
 AND NOT EXISTS(SELECT 1 FROM unnest(selected) g WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(b.basis->'resources') r WHERE r->>'id'=g AND r->>'kind' IN('class','student_group')))) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF (SELECT count(*) FROM workhub.timetable_lessons l WHERE l.school_id=ctx.school_id AND l.starts_at>=(lower(span)::timestamp AT TIME ZONE ctx.school_timezone)-interval '1 day' AND l.starts_at<(upper(span)::timestamp AT TIME ZONE ctx.school_timezone))>3000 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 FOR day IN SELECT d::date FROM generate_series(lower(span)::timestamp,(upper(span)-1)::timestamp,interval '1 day') d LOOP
  SELECT COALESCE(jsonb_agg(DISTINCT g->>'id'),'[]') INTO groups FROM workhub.timetable_lessons l CROSS JOIN jsonb_array_elements(l.groups) g
  WHERE l.school_id=ctx.school_id AND g->>'id'=ANY(selected) AND workhub_private.t2_day(l.starts_at,ctx.school_timezone)<=day AND workhub_private.t2_day(l.ends_at-interval '1 millisecond',ctx.school_timezone)>=day;
  IF jsonb_array_length(groups)>0 THEN
   daily:=workhub_private.t2_school_day_calc(ctx,jsonb_build_object('kind','closure','date',day,'groupIds',groups,'reason',i->>'reason','bells','[]'::jsonb),p_at,daterange(day,day+1,'[)'), 'annual-preview',p_at,p_at+interval '15 minutes');
   blocks:=blocks||COALESCE((SELECT jsonb_agg(b||jsonb_build_object('date',day)) FROM jsonb_array_elements(daily->'blockers') b WHERE b->>'code'<>'NO_LESSONS'),'[]');
  ELSE daily:=jsonb_build_object('changes','[]'::jsonb); END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(daily->'changes') x JOIN workhub.timetable_execution_records r ON r.school_id=ctx.school_id AND r.lesson_id=x#>>'{before,id}')
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(daily->'changes') x JOIN workhub.timetable_interventions r ON r.school_id=ctx.school_id AND workhub_private.t3_live(r,p_at) WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') s WHERE s->>'id'=x#>>'{before,id}')) THEN
   blocks:=blocks||jsonb_build_array(jsonb_build_object('date',day,'code','EXISTING_RECORD','message','실시 기록 또는 진행 중인 변경 요청을 먼저 확인해 주세요.'));
  END IF;
  count_:=count_+jsonb_array_length(daily->'changes');
  days:=days||jsonb_build_array(jsonb_build_object('date',day,'changes',daily->'changes'));
 END LOOP;
 SELECT COALESCE(jsonb_agg(to_jsonb(l) ORDER BY l.id),'[]') INTO originals FROM workhub.timetable_lessons l WHERE l.school_id=ctx.school_id AND l.starts_at>=(lower(span)::timestamp AT TIME ZONE ctx.school_timezone)-interval '1 day' AND l.starts_at<(upper(span)::timestamp AT TIME ZONE ctx.school_timezone);
 RETURN jsonb_build_object('days',days,'blockers',blocks,'changedCount',count_,'sourceHash',workhub_private.p2_sha(originals));
END $$;

CREATE FUNCTION workhub_private.af1_period_execute(ctx workhub_private.actor_context,c jsonb,k text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE h text:=workhub_private.p2_sha(c); old workhub.annual_commands; p workhub.annual_closure_previews; x jsonb; d jsonb; ids jsonb; change_id text; v jsonb; at timestamptz; l workhub.timetable_lessons; dayrow workhub.timetable_school_day_changes;
BEGIN
 IF k IS NULL OR length(k) NOT BETWEEN 8 AND 200 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.t2_lock(ctx.school_id);
 SELECT * INTO old FROM workhub.annual_commands WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND key=k;
 IF FOUND THEN IF old.account_id<>ctx.account_id OR old.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;RETURN old.receipt;END IF;
 IF NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT workhub_private.t2_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 at:=workhub_private.t2_now();
 IF c->>'kind'='apply_period' THEN
  IF NOT workhub_private.p2_exact(c,ARRAY['kind','previewId','fingerprint']) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  SELECT * INTO p FROM workhub.annual_closure_previews WHERE school_id=ctx.school_id AND member_id=ctx.membership_id AND account_id=ctx.account_id AND id=c->>'previewId';
  IF p.id IS NULL OR p.expires_at<=clock_timestamp() OR p.fingerprint IS DISTINCT FROM c->>'fingerprint' THEN RAISE EXCEPTION 'CONFLICT';END IF;
  IF EXISTS(SELECT 1 FROM workhub.annual_closure_days WHERE period_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
  x:=workhub_private.af1_period_plan(ctx,p.input,p.assessed_at);
  IF workhub_private.p2_sha(x)<>p.fingerprint THEN RAISE EXCEPTION 'CONFLICT';END IF;
  IF jsonb_array_length(x->'blockers')>0 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(x->'days') z CROSS JOIN jsonb_array_elements(z->'changes') ch WHERE (ch#>>'{before,time,startsAt}')::timestamptz<=at) THEN RAISE EXCEPTION 'CONFLICT';END IF;
  FOR d IN SELECT value FROM jsonb_array_elements(x->'days') LOOP
   ids:=COALESCE((SELECT jsonb_agg(jsonb_build_object('id',ch#>>'{after,id}','version',ch#>'{after,version}') ORDER BY ch#>>'{after,id}') FROM jsonb_array_elements(d->'changes') ch),'[]');
   INSERT INTO workhub.timetable_school_day_changes(school_id,preview_id,input,changed_lessons,lost_lesson_count,membership_id,request_key,recorded_at)
   VALUES(ctx.school_id,gen_random_uuid()::text,jsonb_build_object('kind','closure','date',d->>'date','groupIds',p.input->'groupIds','reason',p.input->>'reason','bells','[]'::jsonb,'annualPeriodId',p.id),ids,jsonb_array_length(ids),ctx.membership_id,k,at) RETURNING id INTO change_id;
   INSERT INTO workhub.annual_closure_days VALUES(ctx.school_id,change_id,p.id,p.input->>'classification');
   UPDATE workhub.timetable_lessons z SET state='cancelled',version=(ch#>>'{after,version}')::integer,pinned=true,changed_by='school_day',changed_at=at FROM jsonb_array_elements(d->'changes') ch WHERE z.school_id=ctx.school_id AND z.id=ch#>>'{after,id}';
   INSERT INTO workhub.timetable_lesson_versions(school_id,lesson_id,version,change_kind,source_id,snapshot)
   SELECT z.school_id,z.id,z.version,'school_day',change_id,to_jsonb(z)-'school_id' FROM workhub.timetable_lessons z JOIN jsonb_array_elements(d->'changes') ch ON z.id=ch#>>'{after,id}' WHERE z.school_id=ctx.school_id;
  END LOOP;
  v:=jsonb_build_object('requestKey',k,'kind',c->>'kind','id',p.id,'changedCount',x->'changedCount');
 ELSIF c->>'kind'='close_makeup' THEN
  IF NOT workhub_private.p2_exact(c,ARRAY['kind','lessonId','expectedVersion','reason']) OR NOT workhub_private.p7_text(c->'reason',500,true) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  SELECT * INTO l FROM workhub.timetable_lessons WHERE school_id=ctx.school_id AND id=c->>'lessonId' FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF l.state<>'cancelled' OR l.changed_by NOT IN('school_day','intervention') OR to_jsonb(l.version) IS DISTINCT FROM c->'expectedVersion'
  OR EXISTS(SELECT 1 FROM workhub.timetable_interventions r WHERE r.school_id=ctx.school_id AND workhub_private.t3_live(r,at) AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') src WHERE src->>'id'=l.id))
  OR NOT workhub_private.af1_makeup_needed(l) OR EXISTS(SELECT 1 FROM workhub.timetable_makeup_links WHERE school_id=ctx.school_id AND original_lesson_id=l.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
  INSERT INTO workhub.annual_makeup_resolutions VALUES(ctx.school_id,l.id,l.version,ctx.membership_id,c->>'reason',at);
  v:=jsonb_build_object('requestKey',k,'kind',c->>'kind','id',l.id,'changedCount',1);
 ELSIF c->>'kind'='release_empty_day' THEN
  IF NOT workhub_private.p2_exact(c,ARRAY['kind','changeId','reason']) OR NOT workhub_private.p7_text(c->'reason',500,true) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  SELECT c1.* INTO dayrow FROM workhub.timetable_school_day_changes c1 JOIN workhub.annual_closure_days a ON a.school_id=c1.school_id AND a.change_id=c1.id WHERE c1.school_id=ctx.school_id AND c1.id=c->>'changeId';
  IF dayrow.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
  IF jsonb_array_length(dayrow.changed_lessons)<>0 OR (dayrow.input->>'date')::date<ctx.school_today THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  INSERT INTO workhub.annual_empty_releases VALUES(ctx.school_id,dayrow.id,ctx.membership_id,c->>'reason',at);
  v:=jsonb_build_object('requestKey',k,'kind',c->>'kind','id',dayrow.id,'changedCount',0);
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.write_audit(ctx,'annual.'||(c->>'kind'),'annual_operation',v->>'id',1,'school',k,jsonb_build_object('command',c,'result',v));
 INSERT INTO workhub.annual_commands VALUES(ctx.school_id,ctx.membership_id,ctx.account_id,k,h,v);
 RETURN v;
END $$;

CREATE FUNCTION public.workhub_annual_operations(p_member_id text,p_operation text,p_input jsonb,p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; p workhub.annual_closure_previews; v jsonb; at timestamptz;
BEGIN
 ctx:=workhub_private.member_actor(p_member_id,p_operation='execute');
 IF p_operation='execute' THEN PERFORM workhub_private.lock_member_roles(ctx);END IF;
 BEGIN
 IF p_operation='execute' THEN v:=workhub_private.af1_period_execute(ctx,p_input,p_request_key);
 ELSE
 IF NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT workhub_private.t2_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 IF p_operation='preview' THEN
  PERFORM workhub_private.t2_lock(ctx.school_id);at:=workhub_private.t2_now();
  p.plan:=workhub_private.af1_period_plan(ctx,p_input,at);
  INSERT INTO workhub.annual_closure_previews(school_id,member_id,account_id,input,plan,fingerprint,assessed_at,created_at,expires_at)
  VALUES(ctx.school_id,ctx.membership_id,ctx.account_id,p_input,p.plan,workhub_private.p2_sha(p.plan),at,statement_timestamp(),statement_timestamp()+interval '15 minutes') RETURNING * INTO p;
  v:=jsonb_build_object('id',p.id,'fingerprint',p.fingerprint,'expiresAt',workhub_private.t2_ts(p.expires_at),'plan',p.plan);
 ELSIF p_operation='review' THEN
  IF NOT workhub_private.p2_exact(p_input,ARRAY['from','until']) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
  PERFORM workhub_private.t2_range(p_input->>'from',p_input->>'until',62);
  v:=jsonb_build_object('makeup',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'version',l.version,'label',l.label,'date',workhub_private.t2_day(l.starts_at,ctx.school_timezone),'closedReason',r.reason) ORDER BY l.starts_at,l.id)
  FROM workhub.timetable_lessons l LEFT JOIN workhub.annual_makeup_resolutions r ON r.school_id=l.school_id AND r.lesson_id=l.id AND r.lesson_version=l.version
  WHERE l.school_id=ctx.school_id AND l.state='cancelled' AND l.changed_by IN('school_day','intervention') AND (workhub_private.af1_makeup_needed(l) OR r.lesson_id IS NOT NULL)
  AND workhub_private.t2_day(l.starts_at,ctx.school_timezone)>=(p_input->>'from')::date AND workhub_private.t2_day(l.starts_at,ctx.school_timezone)<(p_input->>'until')::date
  AND NOT EXISTS(SELECT 1 FROM workhub.timetable_makeup_links m WHERE m.school_id=l.school_id AND m.original_lesson_id=l.id)),'[]'::jsonb),
  'days',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'date',c.input->>'date','classification',d.classification,'changedCount',jsonb_array_length(c.changed_lessons),'released',EXISTS(SELECT 1 FROM workhub.annual_empty_releases r WHERE r.change_id=c.id) OR EXISTS(SELECT 1 FROM workhub.timetable_reopened_days r WHERE r.school_day_change_id=c.id)) ORDER BY c.input->>'date',c.id)
  FROM workhub.annual_closure_days d JOIN workhub.timetable_school_day_changes c ON c.school_id=d.school_id AND c.id=d.change_id WHERE d.school_id=ctx.school_id AND (c.input->>'date')::date>=(p_input->>'from')::date AND (c.input->>'date')::date<(p_input->>'until')::date),'[]'::jsonb));
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;END IF;
 IF p_operation='review' AND (jsonb_array_length(v->'makeup')>3000 OR jsonb_array_length(v->'days')>3000) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN jsonb_build_object('contract','annual-operations.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'data',v);
 EXCEPTION WHEN raise_exception THEN IF NOT workhub_private.p7_business(SQLERRM) THEN RAISE;END IF;
 RETURN jsonb_build_object('contract','annual-operations.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code',SQLERRM));
 WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure THEN
 RETURN jsonb_build_object('contract','annual-operations.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,'error',jsonb_build_object('code','CONFLICT'));END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.af1_makeup_needed(workhub.timetable_lessons),workhub_private.af1_period_plan(workhub_private.actor_context,jsonb,timestamptz),workhub_private.af1_period_execute(workhub_private.actor_context,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_annual_operations(text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_annual_operations(text,text,jsonb,text) TO authenticated;
INSERT INTO workhub_private.af1_installs(batch) VALUES('AF1-03');
COMMIT;
