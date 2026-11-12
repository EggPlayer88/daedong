-- 원래 연결 기간과 이력은 보존하고 시험 배치의 끝만 별도 기록한다.
ALTER TABLE teacher_roster.links ADD COLUMN tp1_end_date date;
ALTER TABLE teacher_roster.links ADD CONSTRAINT tp1_link_end_check CHECK(tp1_end_date IS NULL OR tp1_end_date BETWEEN from_date AND until_date);
ALTER TABLE teacher_roster.links DROP CONSTRAINT links_pkey;
ALTER TABLE teacher_roster.links ADD CONSTRAINT links_pkey PRIMARY KEY(school_id,teacher_id,member_id,from_date);
ALTER TABLE teacher_roster.links DROP CONSTRAINT links_school_id_teacher_id_daterange_excl;
ALTER TABLE teacher_roster.links DROP CONSTRAINT links_school_id_member_id_daterange_excl;
ALTER TABLE teacher_roster.links ADD CONSTRAINT links_school_id_teacher_id_daterange_excl EXCLUDE USING gist(school_id WITH =,teacher_id WITH =,daterange(from_date,coalesce(tp1_end_date,until_date),'[)') WITH &&);
ALTER TABLE teacher_roster.links ADD CONSTRAINT links_school_id_member_id_daterange_excl EXCLUDE USING gist(school_id WITH =,member_id WITH =,daterange(from_date,coalesce(tp1_end_date,until_date),'[)') WITH &&);
CREATE FUNCTION teacher_pilot.link_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP<>'UPDATE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW';END IF;
 IF OLD.tp1_end_date IS NOT NULL OR NEW.tp1_end_date IS NULL
 OR (to_jsonb(OLD)-'tp1_end_date') IS DISTINCT FROM (to_jsonb(NEW)-'tp1_end_date')
 OR NOT EXISTS(SELECT 1 FROM teacher_pilot.members m JOIN teacher_pilot.ends e ON e.batch_id=m.batch_id
 WHERE m.school_id=OLD.school_id AND m.member_id=OLD.member_id AND m.teacher_id=OLD.teacher_id AND m.link_from=OLD.from_date AND m.link_until=OLD.until_date
 AND NEW.tp1_end_date=greatest(OLD.from_date,least(OLD.until_date,e.end_date))) THEN RAISE EXCEPTION 'IMMUTABLE_ROW';END IF;
 RETURN NEW;
END $$;
DROP TRIGGER tr1_links_immutable ON teacher_roster.links;
CREATE TRIGGER tr1_links_immutable BEFORE UPDATE OR DELETE ON teacher_roster.links FOR EACH ROW EXECUTE FUNCTION teacher_pilot.link_guard();
-- 종료한 시험 연결은 bridge가 다시 담당을 만들지 않는다. 원본은 links와 종료 원장에 남는다.
CREATE VIEW teacher_pilot.effective_links AS SELECT school_id,teacher_id,member_id,from_date,coalesce(tp1_end_date,until_date) until_date,linked_by,created_at FROM teacher_roster.links WHERE coalesce(tp1_end_date,until_date)>from_date;
CREATE VIEW teacher_pilot.bridge_links AS SELECT school_id,teacher_id,member_id,from_date,until_date,linked_by,created_at FROM teacher_roster.links WHERE tp1_end_date IS NULL;
REVOKE ALL ON teacher_pilot.effective_links FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON teacher_pilot.bridge_links FROM PUBLIC,anon,authenticated,service_role;

ALTER TABLE workhub.staff_assignments ADD COLUMN tp1_cancelled boolean NOT NULL DEFAULT false;
ALTER TABLE workhub.staff_assignments DROP CONSTRAINT staff_assignments_one_homeroom;
ALTER TABLE workhub.staff_assignments ADD CONSTRAINT staff_assignments_one_homeroom EXCLUDE USING gist(class_id WITH =,daterange(valid_from,valid_to,'[)') WITH &&) WHERE(kind='homeroom' AND NOT tp1_cancelled);
ALTER TABLE workhub.staff_assignments DROP CONSTRAINT staff_assignments_no_duplicate;
ALTER TABLE workhub.staff_assignments ADD CONSTRAINT staff_assignments_no_duplicate EXCLUDE USING gist(membership_id WITH =,kind WITH =,(coalesce(class_id,department_id,subject_id,'duty:'||label)) WITH =,daterange(valid_from,valid_to,'[)') WITH &&) WHERE(NOT tp1_cancelled);
CREATE FUNCTION teacher_pilot.staff_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_OP='INSERT' THEN
 IF NEW.tp1_cancelled THEN RAISE EXCEPTION 'IMMUTABLE_ROW'; END IF;RETURN NEW;END IF;
 IF NEW.tp1_cancelled IS DISTINCT FROM OLD.tp1_cancelled THEN
 IF OLD.tp1_cancelled OR NOT NEW.tp1_cancelled OR NEW.status<>'ended'
 OR NOT EXISTS(SELECT 1 FROM teacher_pilot.assignment_links a JOIN teacher_pilot.ends e ON e.batch_id=a.batch_id
 WHERE a.kind='staff' AND a.assignment_id=OLD.id AND a.member_id=OLD.membership_id AND e.end_date<=OLD.valid_from) THEN RAISE EXCEPTION 'IMMUTABLE_ROW';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER tp1_staff_cancel_guard BEFORE INSERT OR UPDATE ON workhub.staff_assignments FOR EACH ROW EXECUTE FUNCTION teacher_pilot.staff_guard();

CREATE FUNCTION teacher_pilot.cleanup_manifest(p_school text,p_admin text,p_batch text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;b teacher_pilot.batches;result jsonb;
BEGIN
 ctx:=teacher_pilot.manage(p_school,p_admin);
 SELECT * INTO b FROM teacher_pilot.batches WHERE id=p_batch AND school_id=p_school;
 IF b.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 SELECT jsonb_build_object('contract','teacher-pilot-cleanup.v1','batchId',b.id,'state',b.state,'revision',b.revision,'generatedAt',workhub_private.p2_ts(clock_timestamp()),
 'accounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('slot',x.slot,'authUserId',x.auth_user_id,'memberId',x.member_id,'teacherId',x.teacher_id,'email',x.email) ORDER BY x.slot),'[]') FROM teacher_pilot.members x WHERE x.batch_id=b.id),
 'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('kind',kind,'id',assignment_id,'memberId',member_id) ORDER BY kind,assignment_id),'[]') FROM teacher_pilot.assignment_links WHERE batch_id=b.id),
 'resources',(SELECT coalesce(jsonb_agg(jsonb_build_object('type',r.resource_type,'id',r.resource_id,'operations',r.operations) ORDER BY r.resource_type,r.resource_id),'[]') FROM
 (SELECT a.resource_type,a.resource_id,jsonb_agg(DISTINCT a.operation) operations FROM workhub.audit_events a JOIN teacher_pilot.members m ON m.account_id=a.actor_account_id
 WHERE m.batch_id=b.id AND a.school_id=b.school_id AND a.occurred_at>=b.created_at GROUP BY a.resource_type,a.resource_id) r),
 'aiRequests',(SELECT count(*) FROM workhub.ai_gateway_requests a JOIN teacher_pilot.members m ON m.auth_user_id=a.actor_user_id WHERE m.batch_id=b.id),
 'unsettledAi',(SELECT count(*) FROM workhub.ai_gateway_requests a JOIN teacher_pilot.members m ON m.auth_user_id=a.actor_user_id WHERE m.batch_id=b.id AND (a.state IN('prepared','started','unknown') OR a.state='rejected' AND a.actual_micro_usd IS NULL)),
 'deletionAllowed',false,'preserve',jsonb_build_array('real_accounts','published_roster','courses','audit_events','ai_cost_ledger','request_receipts'),
 'note','조회 전용 목록입니다. 공유 자료·관리자 작성 자료·Storage 실물을 따로 대조한 뒤 필요한 별도 정리안을 검토합니다. 계정과 원장을 삭제하지 않습니다.') INTO result;
 RETURN result;
END $$;
CREATE FUNCTION teacher_pilot.stop(p_school text,p_admin text,p_batch text,p_expected_revision integer,p_reason text) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;b teacher_pilot.batches;x teacher_pilot.members;owned record;end_day date;new_to date;receipt jsonb;rev integer;
BEGIN
 ctx:=teacher_pilot.manage(p_school,p_admin);
 PERFORM pg_advisory_xact_lock(hashtextextended('teacher-pilot:'||p_school,0));
 -- 쓰기에서 잡는 users/accounts/소속 잠금을 먼저 잡아 정지와 새 작업을 직렬화한다.
 PERFORM 1 FROM public.users u JOIN teacher_pilot.members m ON u.id=m.auth_user_id::text WHERE m.batch_id=p_batch ORDER BY u.id FOR UPDATE OF u;
 PERFORM 1 FROM workhub.accounts a JOIN teacher_pilot.members m ON a.id=m.account_id WHERE m.batch_id=p_batch ORDER BY a.id FOR UPDATE OF a;
 PERFORM 1 FROM workhub.memberships a JOIN teacher_pilot.members m ON a.id=m.member_id WHERE m.batch_id=p_batch ORDER BY a.id FOR UPDATE OF a;
 PERFORM 1 FROM workhub.participant_grants a JOIN teacher_pilot.members m ON a.membership_id=m.member_id WHERE m.batch_id=p_batch ORDER BY a.membership_id FOR UPDATE OF a;
 SELECT * INTO b FROM teacher_pilot.batches WHERE id=p_batch AND school_id=p_school FOR UPDATE;
 IF b.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF b.state='stopped' THEN SELECT e.receipt INTO receipt FROM teacher_pilot.ends e WHERE e.batch_id=p_batch;RETURN receipt;END IF;
 IF b.revision IS DISTINCT FROM p_expected_revision OR p_reason IS NULL OR length(btrim(p_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CONFLICT'; END IF;
 end_day:=ctx.school_today+1;
 receipt:=jsonb_build_object('batchId',b.id,'state','stopped','count',10,'revision',b.revision+1,'accessStoppedAt',workhub_private.p2_ts(clock_timestamp()),'assignmentEndBoundary',end_day,'deletionAllowed',false);
 INSERT INTO teacher_pilot.ends(batch_id,admin_member_id,end_date,reason,receipt) VALUES(b.id,p_admin,end_day,p_reason,receipt);
 PERFORM 1 FROM teacher_roster.schools WHERE school_id=p_school FOR UPDATE;
 FOR x IN SELECT * FROM teacher_pilot.members WHERE batch_id=b.id ORDER BY slot LOOP
 UPDATE workhub.participant_grants SET active=false,revision=revision+1,updated_at=clock_timestamp() WHERE school_id=p_school AND membership_id=x.member_id;
 UPDATE public.users SET is_active=false WHERE id=x.auth_user_id::text AND role='teacher';
 UPDATE workhub.accounts SET status='suspended',permission_version=permission_version+1,version=version+1,updated_at=clock_timestamp() WHERE id=x.account_id;
 UPDATE workhub.memberships SET status='suspended',permission_version=permission_version+1,version=version+1,updated_at=clock_timestamp() WHERE id=x.member_id;
 UPDATE teacher_roster.links SET tp1_end_date=greatest(from_date,least(until_date,end_day)) WHERE school_id=p_school AND teacher_id=x.teacher_id AND member_id=x.member_id AND tp1_end_date IS NULL;
 FOR owned IN SELECT ca.* FROM workhub.course_assignments ca JOIN teacher_pilot.assignment_links al ON al.kind='course' AND al.assignment_id=ca.id WHERE al.batch_id=b.id AND al.member_id=x.member_id LOOP
 new_to:=greatest(owned.valid_from,least(workhub_private.p8_eff_to('assignment',owned.id,owned.valid_from,owned.valid_to),end_day));
 IF new_to<workhub_private.p8_eff_to('assignment',owned.id,owned.valid_from,owned.valid_to) THEN
 SELECT 2+count(*) INTO rev FROM workhub.teaching_relation_ends WHERE kind='assignment' AND relation_id=owned.id;
 INSERT INTO workhub.teaching_relation_ends(school_id,kind,relation_id,version,last_day,reason,request_key,recorded_by_membership_id)
 VALUES(p_school,'assignment',owned.id,rev,CASE WHEN new_to>owned.valid_from THEN new_to-1 END,p_reason,b.id||':stop',p_admin);END IF;
 END LOOP;
 FOR owned IN SELECT sa.* FROM workhub.staff_assignments sa JOIN teacher_pilot.assignment_links al ON al.kind='staff' AND al.assignment_id=sa.id WHERE al.batch_id=b.id AND al.member_id=x.member_id AND sa.status='active' LOOP
 UPDATE workhub.staff_assignments SET status='ended',ended_by_membership_id=p_admin,ended_at=clock_timestamp(),updated_at=clock_timestamp(),version=version+1,
 valid_to=CASE WHEN end_day>valid_from THEN least(valid_to,end_day) ELSE valid_to END,tp1_cancelled=end_day<=valid_from WHERE id=owned.id;
 END LOOP;
 END LOOP;
 UPDATE teacher_roster.schools SET revision=revision+1 WHERE school_id=p_school;
 UPDATE teacher_pilot.batches SET state='stopped',revision=revision+1,stopped_at=clock_timestamp() WHERE id=b.id;
 INSERT INTO teacher_pilot.changes(batch_id,operation,details) VALUES(b.id,'stop',receipt||jsonb_build_object('reason',p_reason));
 PERFORM workhub_private.write_audit(ctx,'teacher_pilot.stop','teacher_pilot',b.id,b.revision+1,'school',b.id||':stop',receipt);
 RETURN receipt;
END $$;
