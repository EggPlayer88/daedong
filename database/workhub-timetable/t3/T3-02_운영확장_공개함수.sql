-- T3 원문 미리보기 → 교사 동의 → 별도 승인. 원장 우선 복구와 명시적 닫기를 포함한다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM workhub_private.t3_installs WHERE batch='T3-01') THEN RAISE EXCEPTION 'T3-01을 먼저 설치하세요.';END IF;
 IF EXISTS(SELECT 1 FROM workhub_private.t3_installs WHERE batch='T3-02') THEN RAISE EXCEPTION 'T3-02가 이미 설치됐습니다.';END IF;
END $$;
CREATE FUNCTION workhub_private.t3_input(i jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF i IS NULL OR jsonb_typeof(i)<>'object' OR NOT workhub_private.p7_text(i->'reason',500,true) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 CASE i->>'kind'
 WHEN 'substitute' THEN
 IF NOT workhub_private.p2_exact(i,ARRAY['kind','lessonId','expectedVersion','substituteTeacherId','reason']) OR NOT workhub_private.p7_id(i->'substituteTeacherId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 WHEN 'cancel' THEN
 IF NOT workhub_private.p2_exact(i,ARRAY['kind','lessonId','expectedVersion','reason']) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 WHEN 'makeup' THEN
 IF NOT workhub_private.p2_exact(i,ARRAY['kind','lessonId','expectedVersion','target','reason']) OR NOT workhub_private.t2_time_ok(i->'target') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 WHEN 'reopen' THEN
 IF NOT workhub_private.p2_exact(i,ARRAY['kind','schoolDayChangeId','reason']) OR NOT workhub_private.p7_id(i->'schoolDayChangeId') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSE RAISE EXCEPTION 'INVALID_INPUT';
 END CASE;
 IF i->>'kind'<>'reopen' AND (NOT workhub_private.p7_id(i->'lessonId') OR NOT workhub_private.p7_pos(i->'expectedVersion')) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
END $$;
CREATE FUNCTION workhub_private.t3_closed(p_school text,p_day date,p_groups jsonb,p_ignore text DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_array_length(workhub_private.t2_closed_days(p_school,p_day,p_day+1))>0 OR EXISTS(
 SELECT 1 FROM workhub.timetable_school_day_changes c WHERE c.school_id=p_school AND c.input->>'kind'='closure'
 AND (c.input->>'date')::date=p_day AND c.id IS DISTINCT FROM p_ignore
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_reopened_days r WHERE r.school_id=p_school AND r.school_day_change_id=c.id)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_groups) g WHERE c.input->'groupIds' ? (g->>'id')))
$$;
CREATE FUNCTION workhub_private.t3_plan(ctx workhub_private.actor_context,i jsonb,p_seed text,p_at timestamptz,p_ignore_request text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE l workhub.timetable_lessons;n workhub.timetable_lessons;c workhub.timetable_school_day_changes;
 ids text[];x jsonb;rows jsonb:='[]';sources jsonb:='[]';changes jsonb:='[]';participants text[]:='{}';blocks jsonb:='[]';
 removed bigint:=0;added bigint:=0;s timestamptz;e timestamptz;day date;k text:=i->>'kind';bad text;conf text[];
BEGIN
 PERFORM workhub_private.t3_input(i);
 IF k='reopen' THEN
 IF NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 SELECT * INTO c FROM workhub.timetable_school_day_changes WHERE school_id=ctx.school_id AND id=i->>'schoolDayChangeId' AND input->>'kind'='closure';
 IF c.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM workhub.timetable_reopened_days WHERE school_id=ctx.school_id AND school_day_change_id=c.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF jsonb_array_length(c.changed_lessons) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ids:=ARRAY(SELECT a->>'id' FROM jsonb_array_elements(c.changed_lessons) a ORDER BY a->>'id');
 ELSE
 ids:=ARRAY[i->>'lessonId'];
 END IF;
 FOREACH bad IN ARRAY ids LOOP
 SELECT * INTO l FROM workhub.timetable_lessons WHERE school_id=ctx.school_id AND id=bad;
 IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF EXISTS(SELECT 1 FROM workhub.terms tt WHERE tt.school_id=ctx.school_id AND tt.id=l.term_id AND tt.state='closed') THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF k<>'reopen' AND l.version<>(i->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF NOT(workhub_private.p5_manager(ctx) OR ctx.membership_id=ANY(l.teacher_ids)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF k='reopen' AND (l.state<>'cancelled' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(c.changed_lessons) a WHERE a->>'id'=l.id AND (a->>'version')::integer=l.version)
 OR NOT EXISTS(SELECT 1 FROM workhub.timetable_lesson_versions v WHERE v.school_id=l.school_id AND v.lesson_id=l.id AND v.version=l.version AND v.source_id=c.id AND v.change_kind='school_day')) THEN
 RAISE EXCEPTION 'CONFLICT';END IF;
 IF k IN('substitute','cancel') AND l.state<>'scheduled' OR k='makeup' AND (l.state<>'cancelled' OR l.changed_by NOT IN('school_day','intervention')) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF k IN('makeup','reopen') AND EXISTS(SELECT 1 FROM workhub.timetable_makeup_links z WHERE z.school_id=ctx.school_id AND z.original_lesson_id=l.id) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','ALREADY_MADE_UP','message','원수업에 연결된 보강이 이미 있습니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 IF EXISTS(SELECT 1 FROM workhub.timetable_execution_records z WHERE z.school_id=ctx.school_id AND z.lesson_id=l.id) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','EXECUTION_EXISTS','message','실시 기록이 있는 수업은 여기서 바꾸지 않습니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 IF EXISTS(SELECT 1 FROM workhub.timetable_exchange_lessons q JOIN workhub.timetable_exchange_requests r ON r.id=q.request_id
 WHERE q.school_id=ctx.school_id AND q.lesson_id=l.id AND workhub_private.t2_req_live(r,p_at))
 OR EXISTS(SELECT 1 FROM workhub.timetable_interventions r WHERE r.school_id=ctx.school_id AND r.id IS DISTINCT FROM p_ignore_request
 AND workhub_private.t3_live(r,p_at) AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') q WHERE q->>'id'=l.id)) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','EXISTING_REQUEST','message','이 수업에 진행 중인 변경 요청이 있습니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 sources:=sources||jsonb_build_array(to_jsonb(l));n:=l;n.version:=l.version+1;n.pinned:=true;n.changed_by:='intervention';
 IF k='substitute' THEN
 IF NOT workhub_private.t3_member(ctx.school_id,i->>'substituteTeacherId') THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF i->>'substituteTeacherId'=ANY(l.teacher_ids) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 n.teacher_ids:=ARRAY[i->>'substituteTeacherId'];
 n.uses:=COALESCE((SELECT jsonb_agg(u ORDER BY u->>'id') FROM jsonb_array_elements(l.uses) u WHERE u->>'kind'<>'teacher'),'[]'::jsonb)
 ||jsonb_build_array(jsonb_build_object('id',i->>'substituteTeacherId','kind','teacher','capacity',1));
 ELSIF k='cancel' THEN n.state:='cancelled';removed:=removed+extract(epoch FROM l.ends_at-l.starts_at)::bigint;
 ELSIF k='reopen' THEN n.state:='scheduled';added:=added+extract(epoch FROM l.ends_at-l.starts_at)::bigint;
 ELSE
 n.id:='t3-'||md5(p_seed||':'||l.id);n.activity_id:='t3-'||md5(p_seed||':activity:'||l.id);n.version:=1;n.state:='scheduled';
 n.starts_at:=workhub_private.t2_parse_ts(i#>'{target,startsAt}',true);n.ends_at:=workhub_private.t2_parse_ts(i#>'{target,endsAt}',true);
 day:=workhub_private.t2_day(n.starts_at,ctx.school_timezone);n.occurrence_date:=day;
 IF n.ends_at-n.starts_at<>l.ends_at-l.starts_at OR workhub_private.t2_day(n.ends_at-interval '1 second',ctx.school_timezone)<>day
 OR day<l.occurrence_date OR NOT EXISTS(SELECT 1 FROM workhub.terms t WHERE t.school_id=l.school_id AND t.id=l.term_id AND day>=t.starts_on AND day<t.ends_on)
 OR NOT EXISTS(SELECT 1 FROM workhub.timetable_basis_revisions b CROSS JOIN jsonb_array_elements(b.basis->'slots') sl
 WHERE b.school_id=l.school_id AND b.id=l.basis_id AND sl->>'id'=ANY(l.allowed_slot_ids) AND (sl->>'day')::integer=extract(isodow FROM day)::integer
 AND workhub_private.t2_at(day,(sl->>'startMinute')::integer,ctx.school_timezone)=n.starts_at
 AND workhub_private.t2_at(day,(sl->>'endMinute')::integer,ctx.school_timezone)=n.ends_at) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 added:=added+extract(epoch FROM n.ends_at-n.starts_at)::bigint;
 END IF;
 IF n.starts_at<=p_at OR (k<>'makeup' AND l.starts_at<=p_at) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','PAST_LESSON','message','이미 시작한 수업은 변경하지 않습니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 IF n.state<>'cancelled' AND NOT EXISTS(SELECT 1 FROM workhub.courses cc WHERE cc.school_id=ctx.school_id AND cc.id=n.course_id AND workhub_private.t2_day(n.starts_at,ctx.school_timezone)<@daterange(cc.valid_from,cc.valid_to,'[)')) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','COURSE_PERIOD','message','수업 운영 기간 밖입니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 participants:=participants||l.teacher_ids||n.teacher_ids;
 IF n.state<>'cancelled' AND (workhub_private.t3_closed(ctx.school_id,workhub_private.t2_day(n.starts_at,ctx.school_timezone),n.groups,CASE WHEN k='reopen' THEN c.id END)
 OR workhub_private.t2_unavailable(n.publication_id,n.uses,n.starts_at,n.ends_at,ctx.school_timezone)) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','UNAVAILABLE','message','휴업 또는 자원 사용 불가 시간입니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 -- 현재 자격과 변경일의 재직 기간을 함께 확인한다. 이름이 아니라 학교 소속 ID로 판단한다.
 IF EXISTS(SELECT 1 FROM unnest(l.teacher_ids||n.teacher_ids) m WHERE NOT workhub_private.t3_member(ctx.school_id,m)
 OR NOT EXISTS(SELECT 1 FROM workhub.memberships z WHERE z.school_id=ctx.school_id AND z.id=m
 AND workhub_private.t2_day(n.starts_at,ctx.school_timezone)<@daterange(z.valid_from,z.valid_to,'[)'))) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','PARTICIPANT_UNAVAILABLE','message','영향 교사 모두 현재 시범 자격과 변경일 재직 기간이 필요합니다.','lessonIds',jsonb_build_array(l.id)));END IF;
 rows:=rows||jsonb_build_array(to_jsonb(n));
 changes:=changes||jsonb_build_array(jsonb_build_object('before',CASE WHEN k='makeup' THEN NULL ELSE workhub_private.t2_lesson(l,false,'[]') END,'after',workhub_private.t2_lesson(n,false,'[]')));
 END LOOP;
 participants:=ARRAY(SELECT DISTINCT a FROM unnest(participants) a ORDER BY a);
 conf:=workhub_private.t2_conflicts(ctx.school_id,COALESCE((SELECT jsonb_agg(jsonb_build_object('id',a->>'id','s',a->>'starts_at','e',a->>'ends_at','uses',a->'uses'))
 FROM jsonb_array_elements(rows) a WHERE a->>'state'<>'cancelled'),'[]'),ids);
 IF cardinality(conf)>0 THEN blocks:=blocks||jsonb_build_array(jsonb_build_object('code','RESOURCE_CONFLICT','message','교사·학급·공간·수강집단의 사용 시간이 겹칩니다.','lessonIds',to_jsonb(conf)));END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub_private.t3_approvers(ctx.school_id,ctx.school_today) a WHERE a.account_id<>ctx.account_id
 AND NOT EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=ANY(participants) AND m.account_id=a.account_id)) THEN
 blocks:=blocks||jsonb_build_array(jsonb_build_object('code','APPROVER_MISSING','message','요청자·영향 교사와 다른 승인 담당자가 필요합니다.','lessonIds',to_jsonb(ids)));END IF;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('code',code,'message',message,'lessonIds',lids) ORDER BY code),'[]') INTO blocks
 FROM(SELECT b->>'code' code,min(b->>'message') message,jsonb_agg(DISTINCT lid ORDER BY lid) lids FROM jsonb_array_elements(blocks) b CROSS JOIN jsonb_array_elements(b->'lessonIds') lid GROUP BY b->>'code') grouped;
 RETURN jsonb_build_object('sources',sources,'rows',rows,'changes',changes,'participants',workhub_private.t2_teachers(participants),'blockers',blocks,
 'hours',jsonb_build_object('removedSeconds',removed,'addedSeconds',added),
 'policy',(SELECT to_jsonb(p) FROM workhub.timetable_intervention_policies p WHERE p.school_id=ctx.school_id),
 'memberships',(SELECT jsonb_agg(jsonb_build_array(m.id,m.version,m.permission_version,m.valid_from,m.valid_to,a.version,a.permission_version) ORDER BY m.id)
 FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE m.school_id=ctx.school_id AND m.id=ANY(participants)));
END $$;
CREATE FUNCTION workhub_private.t3_notify(r workhub.timetable_interventions,p_members text[],p_event text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text;m text;v_date date;v_lesson text;
BEGIN
 SELECT workhub_private.t2_day((x->>'starts_at')::timestamptz,(SELECT timezone FROM workhub.schools WHERE id=r.school_id)),x->>'id' INTO v_date,v_lesson FROM jsonb_array_elements(r.plan->'rows') x ORDER BY x->>'starts_at' LIMIT 1;
 INSERT INTO workhub.timetable_intervention_sources(school_id,kind,entity_id,date,lesson_id)
 VALUES(r.school_id,'intervention',r.id,COALESCE(v_date,current_date),NULL) ON CONFLICT(school_id,kind,entity_id) DO NOTHING;
 SELECT id INTO sid FROM workhub.timetable_intervention_sources WHERE school_id=r.school_id AND kind='intervention' AND entity_id=r.id;
 IF NOT workhub_private.t2_installed('T2-02') OR workhub_private.p3_messaging_reason(r.school_id)<>'ready' THEN RETURN;END IF;
 FOREACH m IN ARRAY p_members LOOP
 IF workhub_private.t3_member(r.school_id,m) THEN
 PERFORM workhub_private.p3_notify(r.school_id,m,'시간표 운영 변경 알림',
 workhub_private.t2_member_name(r.requester_membership_id)||' 선생님의 '||CASE r.kind WHEN 'substitute' THEN '대강' WHEN 'cancel' THEN '휴강' WHEN 'makeup' THEN '보강' ELSE '휴업 취소' END||
 ' 요청 상태: '||CASE r.state WHEN 'awaiting_consent' THEN '관련 교사 동의 대기' WHEN 'awaiting_approval' THEN '담당자 승인 대기' WHEN 'applied' THEN '반영 완료' WHEN 'rejected' THEN '거절' ELSE '철회' END,
 'timetable',sid,'t3:'||r.id||':'||r.version||':'||p_event);END IF;
 END LOOP;
END $$;
CREATE FUNCTION workhub_private.t3_command(c jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$ BEGIN
 IF c IS NULL OR jsonb_typeof(c)<>'object' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF c->>'kind'='submit' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['kind','preview']) OR NOT workhub_private.p2_exact(c->'preview',ARRAY['previewId','previewHash','expiresAt','input'])
 OR NOT workhub_private.p7_id(c#>'{preview,previewId}') OR NOT workhub_private.p5_hash(c#>'{preview,previewHash}')
 OR workhub_private.t2_parse_ts(c#>'{preview,expiresAt}',false) IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.t3_input(c#>'{preview,input}');
 ELSIF c->>'kind'='action' THEN
 IF NOT workhub_private.p2_exact(c,ARRAY['kind','requestId','expectedVersion','proposalHash','action']) OR NOT workhub_private.p7_id(c->'requestId')
 OR NOT workhub_private.p7_pos(c->'expectedVersion') OR NOT workhub_private.p5_hash(c->'proposalHash')
 OR c->>'action' NOT IN('accept','reject','withdraw','approve','rejectApproval') OR jsonb_typeof(c->'action')<>'string' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 ELSE RAISE EXCEPTION 'INVALID_INPUT';END IF;
END $$;
CREATE FUNCTION workhub_private.t3_apply(ctx workhub_private.actor_context,r workhub.timetable_interventions,p_at timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE x jsonb;n workhub.timetable_lessons;changed jsonb:='[]';
BEGIN
 FOR x IN SELECT value FROM jsonb_array_elements(r.plan->'rows') LOOP
 n:=jsonb_populate_record(NULL::workhub.timetable_lessons,x);n.changed_at:=p_at;
 IF r.kind='makeup' THEN n.created_at:=p_at;INSERT INTO workhub.timetable_lessons SELECT n.*;
 ELSE
 UPDATE workhub.timetable_lessons SET starts_at=n.starts_at,ends_at=n.ends_at,state=n.state,version=n.version,teacher_ids=n.teacher_ids,uses=n.uses,
 pinned=true,changed_by='intervention',changed_at=p_at WHERE school_id=ctx.school_id AND id=n.id;
 END IF;
 INSERT INTO workhub.timetable_lesson_versions(school_id,lesson_id,version,change_kind,source_id,snapshot)
 SELECT school_id,id,version,'intervention',r.id,to_jsonb(l)-'school_id' FROM workhub.timetable_lessons l WHERE l.school_id=ctx.school_id AND l.id=n.id;
 changed:=changed||jsonb_build_array(jsonb_build_object('id',n.id,'version',n.version));
 IF r.kind='makeup' THEN INSERT INTO workhub.timetable_makeup_links VALUES(ctx.school_id,r.input->>'lessonId',n.id,r.id);END IF;
 END LOOP;
 IF r.kind='reopen' THEN INSERT INTO workhub.timetable_reopened_days(school_id,school_day_change_id,intervention_id) VALUES(ctx.school_id,r.input->>'schoolDayChangeId',r.id);END IF;
 RETURN changed;
END $$;
CREATE FUNCTION workhub_private.t3_lock_members(p_school text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 -- 승인 직전 소속·기존 회원 승인·역할·정책을 함께 잠가 철회 경합을 직렬화한다.
 PERFORM 1 FROM workhub.timetable_intervention_policies WHERE school_id=p_school FOR SHARE;
 PERFORM 1 FROM workhub.module_activations WHERE school_id=p_school ORDER BY module FOR SHARE;
 PERFORM 1 FROM workhub.school_admin_activations WHERE school_id=p_school FOR SHARE;
 PERFORM 1 FROM workhub.terms WHERE school_id=p_school ORDER BY id FOR SHARE;
 PERFORM 1 FROM workhub.memberships m WHERE m.school_id=p_school ORDER BY m.id FOR SHARE;
 PERFORM 1 FROM workhub.accounts a WHERE EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=p_school AND m.account_id=a.id) ORDER BY a.id FOR SHARE;
 PERFORM 1 FROM public.users u WHERE EXISTS(SELECT 1 FROM workhub.accounts a JOIN workhub.memberships m ON m.account_id=a.id WHERE m.school_id=p_school AND a.auth_user_id::text=u.id) ORDER BY u.id FOR SHARE;
 PERFORM 1 FROM workhub.membership_roles WHERE school_id=p_school ORDER BY id FOR SHARE;
END $$;
CREATE FUNCTION workhub_private.t3_execute(ctx workhub_private.actor_context,c jsonb,p_key text,p_recover boolean,p_close boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE old workhub.timetable_intervention_commands;p workhub.timetable_intervention_previews;r workhub.timetable_interventions;
 h text;x jsonb;receipt jsonb;at timestamptz;changed jsonb:='[]';action text;cstate text;ids text[];
BEGIN
 PERFORM workhub_private.t3_command(c);
 IF NOT workhub_private.p7_key(p_key) OR p_recover IS NULL OR p_close IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 h:=workhub_private.p2_sha(c);
 -- 닫기와 실행은 같은 학교 잠금 안에서 원키를 확인한다. 모듈 중지·미리보기 만료보다 접수증이 먼저다.
 PERFORM workhub_private.t2_lock(ctx.school_id);
 SELECT * INTO old FROM workhub.timetable_intervention_commands WHERE school_id=ctx.school_id AND membership_id=ctx.membership_id AND request_key=p_key;
 IF old.request_key IS NOT NULL THEN
 IF old.account_id<>ctx.account_id OR old.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF p_close THEN RETURN jsonb_build_object('requestKey',p_key,'commandHash',h,'outcome',old.outcome,'receipt',old.receipt,'decidedAt',workhub_private.t2_ts(old.recorded_at));END IF;
 IF old.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN old.receipt;END IF;
 IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 -- 현재 본인 소속을 통과한 사람의 자기 명령만 닫는다. 새 동의·승인은 수행하지 않는다.
 IF p_close THEN
 IF ((c#>>'{preview,input,kind}')='reopen' OR (c->>'kind'='action' AND c->>'action' IN('approve','rejectApproval'))) AND NOT workhub_private.p5_manager(ctx) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF c->>'kind'='submit' THEN
 SELECT * INTO p FROM workhub.timetable_intervention_previews WHERE id=c#>>'{preview,previewId}' AND school_id=ctx.school_id AND membership_id=ctx.membership_id AND account_id=ctx.account_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.preview_hash<>c#>>'{preview,previewHash}' OR p.input<>c#>'{preview,input}' OR workhub_private.t2_ts(p.expires_at)<>c#>>'{preview,expiresAt}' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM workhub.timetable_interventions WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 ELSE
 SELECT * INTO r FROM workhub.timetable_interventions WHERE school_id=ctx.school_id AND id=c->>'requestId';
 IF r.id IS NULL OR NOT workhub_private.t3_visible(r,ctx) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 END IF;
 INSERT INTO workhub.timetable_intervention_commands(school_id,membership_id,account_id,request_key,command_hash,outcome)
 VALUES(ctx.school_id,ctx.membership_id,ctx.account_id,p_key,h,'closed') RETURNING * INTO old;
 PERFORM workhub_private.write_audit(ctx,'timetable.intervention_close','timetable_intervention_command',p_key,NULL,'school',p_key,'{}');
 RETURN jsonb_build_object('requestKey',p_key,'commandHash',h,'outcome','closed','receipt',NULL,'decidedAt',workhub_private.t2_ts(old.recorded_at));END IF;
 IF workhub_private.t3_ready(ctx) IS NOT NULL THEN RAISE EXCEPTION 'NOT_READY';END IF;
 PERFORM workhub_private.t3_lock_members(ctx.school_id);
 IF workhub_private.t3_ready(ctx) IS NOT NULL THEN RAISE EXCEPTION 'NOT_READY';END IF;
 at:=workhub_private.t2_now();
 IF c->>'kind'='submit' THEN
 SELECT * INTO p FROM workhub.timetable_intervention_previews WHERE id=c#>>'{preview,previewId}' AND school_id=ctx.school_id AND membership_id=ctx.membership_id AND account_id=ctx.account_id;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.preview_hash<>c#>>'{preview,previewHash}' OR p.input<>c#>'{preview,input}' OR workhub_private.t2_ts(p.expires_at)<>c#>>'{preview,expiresAt}' OR p.expires_at<=at
 OR EXISTS(SELECT 1 FROM workhub.timetable_interventions z WHERE z.preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 x:=workhub_private.t3_plan(ctx,p.input,p.id,p.created_at);
 IF x<>p.plan THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF jsonb_array_length(x->'blockers')>0 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 -- 시작 직전에 오래된 미리보기를 제출할 수 없다.
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(x->'rows') a WHERE (a->>'starts_at')::timestamptz<=at) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 ids:=ARRAY(SELECT a->>'id' FROM jsonb_array_elements(x->'participants') a);
 r.id:=gen_random_uuid()::text;r.school_id:=ctx.school_id;r.kind:=p.input->>'kind';r.requester_membership_id:=ctx.membership_id;r.requester_account_id:=ctx.account_id;
 r.input:=p.input;r.plan:=x;r.proposal_hash:=workhub_private.p2_sha(jsonb_build_object('input',p.input,'plan',x));r.preview_id:=p.id;
 r.state:=CASE WHEN ids<@ARRAY[ctx.membership_id] THEN 'awaiting_approval' ELSE 'awaiting_consent' END;
 r.version:=1;r.created_at:=at;r.updated_at:=at;
 SELECT min((a->>'starts_at')::timestamptz) INTO r.expires_at FROM jsonb_array_elements(x->'rows') a;
 INSERT INTO workhub.timetable_interventions SELECT r.*;
 INSERT INTO workhub.timetable_intervention_participants(school_id,intervention_id,membership_id,response,responded_at)
 SELECT ctx.school_id,r.id,id,CASE WHEN id=ctx.membership_id THEN 'accepted' ELSE 'pending' END,CASE WHEN id=ctx.membership_id THEN at END FROM unnest(ids) id;
 ELSE
 SELECT * INTO r FROM workhub.timetable_interventions WHERE school_id=ctx.school_id AND id=c->>'requestId' FOR UPDATE;
 IF r.id IS NULL OR NOT workhub_private.t3_visible(r,ctx) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF r.version<>(c->>'expectedVersion')::integer OR r.proposal_hash<>c->>'proposalHash' OR NOT workhub_private.t3_live(r,at) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 action:=c->>'action';
 IF NOT(workhub_private.t3_actions(r,ctx,at) ? action) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF action IN('accept','reject') THEN
 UPDATE workhub.timetable_intervention_participants SET response=CASE WHEN action='accept' THEN 'accepted' ELSE 'rejected' END,responded_at=at
 WHERE intervention_id=r.id AND membership_id=ctx.membership_id;
 cstate:=CASE WHEN action='reject' THEN 'rejected' WHEN NOT EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants z WHERE z.intervention_id=r.id AND z.response<>'accepted') THEN 'awaiting_approval' ELSE 'awaiting_consent' END;
 ELSIF action='withdraw' THEN cstate:='withdrawn';
 ELSIF action='rejectApproval' THEN cstate:='rejected';
 ELSE
 IF EXISTS(SELECT 1 FROM workhub.timetable_intervention_participants z WHERE z.intervention_id=r.id AND z.response<>'accepted') THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 -- 원요청자 맥락으로 다시 계산하되 현재 권한은 승인자도 확인한 상태다.
 DECLARE requester workhub_private.actor_context;BEGIN
 requester:=ctx;requester.membership_id:=r.requester_membership_id;requester.account_id:=r.requester_account_id;
 IF NOT workhub_private.t3_member(r.school_id,r.requester_membership_id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 x:=workhub_private.t3_plan(requester,r.input,r.preview_id,at,r.id);
 END;
 IF jsonb_array_length(x->'blockers')>0 OR x->'sources'<>r.plan->'sources' OR x->'rows'<>r.plan->'rows'
 OR x->'participants'<>r.plan->'participants' OR x->'memberships'<>r.plan->'memberships' OR x->'policy'<>r.plan->'policy' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 cstate:='applied';
 END IF;
 UPDATE workhub.timetable_interventions SET state=cstate,version=version+1,updated_at=at,
 decided_by_membership_id=CASE WHEN action IN('approve','rejectApproval') THEN ctx.membership_id ELSE decided_by_membership_id END WHERE id=r.id RETURNING * INTO r;
 IF cstate='applied' THEN changed:=workhub_private.t3_apply(ctx,r,at);END IF;
 END IF;
 PERFORM workhub_private.t3_record_version(r);
 ids:=ARRAY(SELECT membership_id FROM workhub.timetable_intervention_participants WHERE intervention_id=r.id);
 IF r.state='awaiting_approval' THEN ids:=ids||ARRAY(SELECT membership_id FROM workhub_private.t3_approvers(ctx.school_id,ctx.school_today));END IF;
 ids:=ARRAY(SELECT DISTINCT a FROM unnest(ids||r.requester_membership_id) a);
 PERFORM workhub_private.t3_notify(r,ids,COALESCE(action,'submit'));
 PERFORM workhub_private.write_audit(ctx,'timetable.intervention_'||COALESCE(action,'submit'),'timetable_intervention',r.id,r.version,'school',p_key,jsonb_build_object('kind',r.kind,'state',r.state));
 receipt:=jsonb_build_object('requestKey',p_key,'commandHash',h,'kind',c->>'kind','entityId',r.id,'version',r.version,'status',r.state,'recordedAt',workhub_private.t2_ts(at),'changedLessons',changed);
 INSERT INTO workhub.timetable_intervention_commands(school_id,membership_id,account_id,request_key,command_hash,outcome,receipt,recorded_at)
 VALUES(ctx.school_id,ctx.membership_id,ctx.account_id,p_key,h,'applied',receipt,at);
 RETURN receipt;
END $$;
CREATE FUNCTION workhub_private.t3_preview(ctx workhub_private.actor_context,i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p workhub.timetable_intervention_previews;x jsonb;
BEGIN
 IF workhub_private.t3_ready(ctx) IS NOT NULL THEN RAISE EXCEPTION 'NOT_READY';END IF;
 PERFORM workhub_private.t2_lock(ctx.school_id);
 p.id:=gen_random_uuid()::text;p.school_id:=ctx.school_id;p.membership_id:=ctx.membership_id;p.account_id:=ctx.account_id;p.input:=i;
 p.created_at:=workhub_private.t2_now();p.expires_at:=p.created_at+interval '15 minutes';
 x:=workhub_private.t3_plan(ctx,i,p.id,p.created_at);p.plan:=x;
 p.preview_hash:=workhub_private.p2_sha(jsonb_build_object('id',p.id,'input',i,'plan',x,'expiresAt',workhub_private.t2_ts(p.expires_at)));
 INSERT INTO workhub.timetable_intervention_previews SELECT p.*;
 RETURN jsonb_build_object('previewId',p.id,'previewHash',p.preview_hash,'createdAt',workhub_private.t2_ts(p.created_at),'expiresAt',workhub_private.t2_ts(p.expires_at),
 'input',i,'complete',true,'changes',x->'changes','participants',x->'participants','blockers',x->'blockers','hours',x->'hours');
END $$;
CREATE FUNCTION workhub_private.t3_get(ctx workhub_private.actor_context,f text,u text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE span daterange;at timestamptz:=workhub_private.t2_now();lessons jsonb;people jsonb;closures jsonb;requests jsonb;
BEGIN
 IF workhub_private.t3_ready(ctx) IS NOT NULL THEN RAISE EXCEPTION 'NOT_READY';END IF;
 span:=workhub_private.t2_range(f,u,workhub_private.t2_limit('listDays'));
 SELECT COALESCE(jsonb_agg(workhub_private.t2_vlesson(l,ctx,at) ORDER BY l.starts_at,l.id),'[]') INTO lessons
 FROM workhub.timetable_lessons l WHERE l.school_id=ctx.school_id AND workhub_private.t2_day(l.starts_at,ctx.school_timezone)<@span
 AND(workhub_private.p5_manager(ctx) OR ctx.membership_id=ANY(l.teacher_ids));
 SELECT workhub_private.t2_teachers(ARRAY(SELECT m.id FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND workhub_private.t3_member(ctx.school_id,m.id))) INTO people;
 SELECT COALESCE(jsonb_agg(jsonb_build_object('id',c.id,'date',c.input->>'date','reason',c.input->>'reason',
 'lessonIds',(SELECT jsonb_agg(x->>'id' ORDER BY x->>'id') FROM jsonb_array_elements(c.changed_lessons) x),
 'reopened',EXISTS(SELECT 1 FROM workhub.timetable_reopened_days rd WHERE rd.school_id=ctx.school_id AND rd.school_day_change_id=c.id)) ORDER BY c.recorded_at,c.id),'[]') INTO closures
 FROM workhub.timetable_school_day_changes c WHERE c.school_id=ctx.school_id AND c.input->>'kind'='closure' AND(c.input->>'date')::date<@span
 AND jsonb_array_length(c.changed_lessons) BETWEEN 1 AND 500 AND workhub_private.p5_manager(ctx);
 SELECT COALESCE(jsonb_agg(workhub_private.t3_view(r,ctx,at) ORDER BY r.created_at,r.id),'[]') INTO requests
 FROM workhub.timetable_interventions r WHERE r.school_id=ctx.school_id AND workhub_private.t3_visible(r,ctx)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'rows') x WHERE workhub_private.t2_day((x->>'starts_at')::timestamptz,ctx.school_timezone)<@span);
 IF jsonb_array_length(lessons)>workhub_private.t2_limit('lessons') OR jsonb_array_length(people)>workhub_private.t2_limit('teachers')
 OR jsonb_array_length(closures)>workhub_private.t2_limit('changes') OR jsonb_array_length(requests)>workhub_private.t2_limit('requests') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 RETURN jsonb_build_object('asOf',workhub_private.t2_ts(at),'timeZone',ctx.school_timezone,'from',f,'until',u,'lessons',lessons,'teachers',people,'closures',closures,'requests',requests);
END $$;
CREATE FUNCTION workhub_private.t3_resolve(ctx workhub_private.actor_context,p_id text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE s workhub.timetable_intervention_sources;r workhub.timetable_interventions;e workhub.timetable_exchange_requests;c workhub.timetable_school_day_changes;day date;lid text;
BEGIN
 IF NOT workhub_private.p7_id(to_jsonb(p_id)) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF NOT workhub_private.t2_ready(ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 SELECT * INTO s FROM workhub.timetable_intervention_sources WHERE school_id=ctx.school_id AND id=p_id;
 IF s.id IS NOT NULL THEN
 IF s.kind='intervention' THEN
 SELECT * INTO r FROM workhub.timetable_interventions WHERE school_id=ctx.school_id AND id=s.entity_id;
 IF NOT workhub_private.t3_member(ctx.school_id,ctx.membership_id) OR r.id IS NULL OR NOT workhub_private.t3_visible(r,ctx) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN jsonb_build_object('kind','intervention','requestId',r.id,'schoolDayChangeId',NULL,'date',s.date,'lessonId',r.plan#>>'{sources,0,id}');
 ELSE
 SELECT * INTO c FROM workhub.timetable_school_day_changes WHERE school_id=ctx.school_id AND id=s.entity_id;
 IF c.id IS NULL OR NOT(workhub_private.p5_manager(ctx) OR EXISTS(SELECT 1 FROM jsonb_array_elements(c.changed_lessons) x JOIN workhub.timetable_lessons l ON l.school_id=ctx.school_id AND l.id=x->>'id' WHERE ctx.membership_id=ANY(l.teacher_ids))) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 RETURN jsonb_build_object('kind','school_day','requestId',NULL,'schoolDayChangeId',c.id,'date',s.date,'lessonId',s.lesson_id);
 END IF;
 END IF;
 -- 기존 T2 교환 알림도 같은 학교의 현재 가시성으로 해결한다.
 SELECT * INTO e FROM workhub.timetable_exchange_requests WHERE school_id=ctx.school_id AND id=p_id;
 IF e.id IS NULL OR NOT workhub_private.t2_req_visible(e,ctx) THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT l.id,workhub_private.t2_day(l.starts_at,ctx.school_timezone) INTO lid,day FROM workhub.timetable_exchange_lessons x JOIN workhub.timetable_lessons l ON l.id=x.lesson_id AND l.school_id=ctx.school_id WHERE x.request_id=e.id ORDER BY l.starts_at,l.id LIMIT 1;
 RETURN jsonb_build_object('kind','exchange','requestId',e.id,'schoolDayChangeId',NULL,'date',day,'lessonId',lid);
END $$;
CREATE FUNCTION workhub_private.t3_summary(ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE at timestamptz:=workhub_private.t2_now();items jsonb:='[]';r workhub.timetable_interventions;e workhub.timetable_exchange_requests;l workhub.timetable_lessons;a jsonb;k text;day date;
BEGIN
 IF workhub_private.t3_ready(ctx) IS NULL THEN
 FOR r IN SELECT * FROM workhub.timetable_interventions z WHERE z.school_id=ctx.school_id AND workhub_private.t3_visible(z,ctx) AND workhub_private.t3_live(z,at) LOOP
 a:=workhub_private.t3_actions(r,ctx,at);k:=CASE WHEN a?'accept' THEN 'consent' WHEN a?'approve' THEN 'approval' END;
 IF k IS NOT NULL THEN items:=items||jsonb_build_array(jsonb_build_object('id','t3-'||r.id,'kind',k,'label',r.plan#>>'{changes,0,after,label}',
 'date',workhub_private.t2_day((r.plan#>>'{rows,0,starts_at}')::timestamptz,ctx.school_timezone),'lessonId',r.plan#>>'{sources,0,id}','requestId',r.id));END IF;END LOOP;
 FOR l IN SELECT * FROM workhub.timetable_lessons z WHERE z.school_id=ctx.school_id AND z.state='cancelled' AND z.changed_by IN('school_day','intervention')
 AND(workhub_private.p5_manager(ctx) OR ctx.membership_id=ANY(z.teacher_ids)) AND NOT EXISTS(SELECT 1 FROM workhub.timetable_makeup_links m WHERE m.school_id=ctx.school_id AND m.original_lesson_id=z.id)
 AND EXISTS(SELECT 1 FROM workhub.terms t WHERE t.school_id=z.school_id AND t.id=z.term_id AND t.ends_on>ctx.school_today)
 LOOP items:=items||jsonb_build_array(jsonb_build_object('id','makeup-'||l.id,'kind','makeup','label',l.label,'date',workhub_private.t2_day(l.starts_at,ctx.school_timezone),'lessonId',l.id,'requestId',NULL));END LOOP;
 END IF;
 IF workhub_private.t2_ready(ctx.school_id) THEN
 FOR e IN SELECT * FROM workhub.timetable_exchange_requests z WHERE z.school_id=ctx.school_id AND workhub_private.t2_req_visible(z,ctx) AND workhub_private.t2_req_live(z,at) LOOP
 a:=workhub_private.t2_req_view(e,ctx,at)->'actions';k:=CASE WHEN a?'accept' THEN 'consent' WHEN a?'approve' THEN 'approval' END;
 IF k IS NOT NULL THEN SELECT z.* INTO l FROM workhub.timetable_exchange_lessons x JOIN workhub.timetable_lessons z ON z.id=x.lesson_id WHERE x.request_id=e.id ORDER BY z.starts_at,z.id LIMIT 1;
 items:=items||jsonb_build_array(jsonb_build_object('id','t2-'||e.id,'kind',k,'label',l.label,'date',workhub_private.t2_day(l.starts_at,ctx.school_timezone),'lessonId',l.id,'requestId',e.id));END IF;END LOOP;
 END IF;
 RETURN jsonb_build_object('asOf',workhub_private.t2_ts(at),'pendingConsent',(SELECT count(*) FROM jsonb_array_elements(items) x WHERE x->>'kind'='consent'),
 'pendingApproval',(SELECT count(*) FROM jsonb_array_elements(items) x WHERE x->>'kind'='approval'),'makeupNeeded',(SELECT count(*) FROM jsonb_array_elements(items) x WHERE x->>'kind'='makeup'),
 'items',COALESCE((SELECT jsonb_agg(x ORDER BY x->>'date',x->>'id') FROM(SELECT value x FROM jsonb_array_elements(items) ORDER BY value->>'date',value->>'id' LIMIT 20) a),'[]'));
END $$;
CREATE FUNCTION workhub_private.t3_run(ctx workhub_private.actor_context,op text,a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v jsonb;reason text;
BEGIN
 BEGIN
 CASE op
 WHEN 'readiness' THEN reason:=workhub_private.t3_ready(ctx);v:=jsonb_build_object('available',reason IS NULL,'reason',reason);
 WHEN 'get' THEN v:=workhub_private.t3_get(ctx,a->>'from',a->>'until');
 WHEN 'preview' THEN v:=workhub_private.t3_preview(ctx,a->'input');
 WHEN 'execute' THEN v:=workhub_private.t3_execute(ctx,a->'command',a->>'key',(a->>'recover')::boolean,false);
 WHEN 'close' THEN v:=workhub_private.t3_execute(ctx,a->'command',a->>'key',false,true);
 WHEN 'summary' THEN v:=workhub_private.t3_summary(ctx);
 WHEN 'resolve' THEN v:=workhub_private.t3_resolve(ctx,a->>'sourceId');
 ELSE RAISE EXCEPTION 'T3_UNKNOWN_OPERATION';END CASE;
 RETURN workhub_private.t3_envelope(ctx,v);
 EXCEPTION WHEN raise_exception THEN IF workhub_private.p7_business(SQLERRM) THEN RETURN workhub_private.t3_envelope(ctx,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure OR foreign_key_violation THEN RETURN workhub_private.t3_envelope(ctx,NULL,'CONFLICT');END;
END $$;
CREATE FUNCTION public.workhub_timetable_interventions_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);RETURN workhub_private.t3_run(ctx,'readiness','{}');END $$;
CREATE FUNCTION public.workhub_timetable_interventions_get(p_member_id text,p_from text,p_until text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);RETURN workhub_private.t3_run(ctx,'get',jsonb_build_object('from',p_from,'until',p_until));END $$;
CREATE FUNCTION public.workhub_timetable_interventions_preview(p_member_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(ctx);RETURN workhub_private.t3_run(ctx,'preview',jsonb_build_object('input',p_input));END $$;
CREATE FUNCTION public.workhub_timetable_interventions_execute(p_member_id text,p_command jsonb,p_request_key text,p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(ctx);RETURN workhub_private.t3_run(ctx,'execute',jsonb_build_object('command',p_command,'key',p_request_key,'recover',p_recover_only));END $$;
CREATE FUNCTION public.workhub_timetable_interventions_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(ctx);RETURN workhub_private.t3_run(ctx,'close',jsonb_build_object('command',p_command,'key',p_request_key));END $$;
CREATE FUNCTION public.workhub_timetable_interventions_resolve(p_member_id text,p_source_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);RETURN workhub_private.t3_run(ctx,'resolve',jsonb_build_object('sourceId',p_source_id));END $$;
CREATE FUNCTION public.workhub_timetable_interventions_summary(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ DECLARE ctx workhub_private.actor_context;BEGIN
 ctx:=workhub_private.member_actor(p_member_id,false);RETURN workhub_private.t3_run(ctx,'summary','{}');END $$;
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 't3\_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'workhub_timetable_interventions\_%' LOOP
 EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',f);END LOOP;
END $$;
INSERT INTO workhub_private.t3_installs(batch,release) VALUES('T3-02','2026-10-20.1');
COMMIT;
