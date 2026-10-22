-- T4: 실제 학교 자료에 연결한 시간표 가져오기. 운영 실행은 사용자 승인 후.
-- T1 준비 확정과 편성 초안 저장을 같은 트랜잭션으로 처리한다. 공개 시간표는 별도 확인한다.
BEGIN;
DO $$ BEGIN
 IF to_regprocedure('workhub_private.t1_prep_execute(workhub_private.actor_context,jsonb,text,boolean)') IS NULL
 OR to_regprocedure('workhub_private.t1_save_draft(workhub_private.actor_context,jsonb,text,boolean)') IS NULL
 OR to_regprocedure('workhub_private.t1_term(text,date)') IS NULL
 OR to_regclass('workhub.timetable_term_targets') IS NULL THEN RAISE EXCEPTION 'T4 중단: T1과 대상 학기 선택을 먼저 설치해 주세요.';END IF;
 IF to_regclass('workhub.timetable_import_requests') IS NOT NULL THEN RAISE EXCEPTION 'T4 중단: 이미 설치되어 있습니다.';END IF;
END $$;
CREATE TABLE workhub_private.t4_installs(batch text PRIMARY KEY CHECK(batch='T4-01'),installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE workhub_private.t4_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub_private.t4_installs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER t4_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.t4_installs FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TABLE workhub.timetable_import_previews(
 id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
 school_id text NOT NULL REFERENCES workhub.schools(id),
 membership_id text NOT NULL REFERENCES workhub.memberships(id),
 input jsonb NOT NULL, fingerprint text NOT NULL CHECK(fingerprint~'^[0-9a-f]{64}$'),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(school_id,membership_id,id)
);
CREATE TABLE workhub.timetable_import_requests(
 school_id text NOT NULL REFERENCES workhub.schools(id),
 membership_id text NOT NULL REFERENCES workhub.memberships(id),
 request_key text NOT NULL, command_hash text NOT NULL CHECK(command_hash~'^[0-9a-f]{64}$'),
 preview_id text NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('applied','closed')),
 receipt jsonb, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(school_id,membership_id,request_key), UNIQUE(preview_id),
 FOREIGN KEY(school_id,membership_id,preview_id) REFERENCES workhub.timetable_import_previews(school_id,membership_id,id),
 CHECK((outcome='applied')=(receipt IS NOT NULL))
);
ALTER TABLE workhub.timetable_import_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE workhub.timetable_import_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub.timetable_import_previews,workhub.timetable_import_requests FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER timetable_import_preview_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_import_previews FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
CREATE TRIGGER timetable_import_request_immutable BEFORE UPDATE OR DELETE ON workhub.timetable_import_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

CREATE FUNCTION workhub_private.t4_envelope(c workhub_private.actor_context,d jsonb,e text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object('contract','timetable-import.v1','schoolId',c.school_id,'memberId',c.membership_id)
 ||CASE WHEN e IS NULL THEN jsonb_build_object('data',d) ELSE jsonb_build_object('error',jsonb_build_object('code',e)) END
$$;
CREATE FUNCTION workhub_private.t4_input(i jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF NOT workhub_private.p2_exact(i,ARRAY['preparation','placements','title','fileHash'])
 OR NOT workhub_private.t1_prep_input_ok(i->'preparation') OR i#>>'{preparation,kind}'<>'confirm'
 OR NOT workhub_private.p7_text(i->'title',100,true) OR NOT workhub_private.p5_hash(i->'fileHash')
 OR jsonb_typeof(i->'placements') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF jsonb_array_length(i->'placements') NOT BETWEEN 1 AND workhub_private.t1_limit('maxLessons') THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 IF pg_column_size(i)>1048576 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
END $$;
CREATE FUNCTION workhub_private.t4_plan(c workhub_private.actor_context,i jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE src jsonb;b jsonb;old_basis jsonb;term text;expected jsonb;v_fingerprint text;
BEGIN
 PERFORM workhub_private.t4_input(i);
 IF NOT workhub_private.t1_ready(c.school_id) THEN RAISE EXCEPTION 'NOT_READY';END IF;
 IF NOT workhub_private.p5_manager(c) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 PERFORM workhub_private.t1_lock(c.school_id);
 term:=workhub_private.t1_term(c.school_id,c.school_today);
 IF term IS NULL OR term<>i#>>'{preparation,termId}' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 src:=workhub_private.t1_source(c,term)->'source';
 IF src->'sourceRevision'<>i#>'{preparation,sourceRevision}'
 OR src->'sourceFingerprint'<>i#>'{preparation,sourceFingerprint}' THEN RAISE EXCEPTION 'CONFLICT';END IF;
 expected:=src->'savedDraft';
 IF (expected='null'::jsonb AND (i#>'{preparation,draftId}'<>'null'::jsonb OR i#>'{preparation,expectedDraftRevision}'<>'null'::jsonb))
 OR (expected<>'null'::jsonb AND (expected->'id'<>i#>'{preparation,draftId}' OR expected->'revision'<>i#>'{preparation,expectedDraftRevision}')) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF NOT workhub_private.t1_draft_ok(i#>'{preparation,draft}',src) THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 b:=workhub_private.t1_compile(src,i#>'{preparation,draft}','import-preview',1);
 IF b IS NULL OR cardinality(workhub_private.t1_placement_issues(b,i->'placements'))>0 THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 -- 현재 기준판의 필수 조건을 가져오기가 조용히 없애지 못한다.
 SELECT br.basis INTO old_basis FROM workhub.terms t JOIN workhub.timetable_basis_revisions br ON br.id=t.current_timetable_basis_id AND br.school_id=t.school_id WHERE t.id=term AND t.school_id=c.school_id;
 IF old_basis IS NOT NULL AND (jsonb_array_length(old_basis->'fixed')>0 OR jsonb_array_length(old_basis->'unavailable')>0) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 v_fingerprint:=workhub_private.p2_sha(jsonb_build_object('schoolId',c.school_id,'memberId',c.membership_id,'input',i,'source',src,'currentBasis',old_basis));
 RETURN jsonb_build_object('fingerprint',v_fingerprint,'termId',term,'lessonCount',jsonb_array_length(i->'placements'),
 'courseCount',jsonb_array_length(i#>'{preparation,draft,plans}'),'existingPublicationsPreserved',true);
END $$;
CREATE FUNCTION public.workhub_timetable_import_get(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context;v jsonb;
BEGIN
 c:=workhub_private.member_actor(p_member_id,false);
 BEGIN v:=workhub_private.t1_prep_get(c);RETURN workhub_private.t4_envelope(c,v);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('NOT_READY','FORBIDDEN','NOT_FOUND','CONFLICT','INVALID_INPUT','QUERY_FAILED') THEN RETURN workhub_private.t4_envelope(c,NULL,SQLERRM);END IF;RAISE;END;
END $$;
CREATE FUNCTION public.workhub_timetable_import_preview(p_member_id text,p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context;p workhub.timetable_import_previews;plan jsonb;
BEGIN
 c:=workhub_private.member_actor(p_member_id,false);
 BEGIN
 plan:=workhub_private.t4_plan(c,p_input);
 INSERT INTO workhub.timetable_import_previews(school_id,membership_id,input,fingerprint) VALUES(c.school_id,c.membership_id,p_input,plan->>'fingerprint') RETURNING * INTO p;
 RETURN workhub_private.t4_envelope(c,plan||jsonb_build_object('previewId',p.id,'expiresAt',p.expires_at,'input',p.input));
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('NOT_READY','FORBIDDEN','NOT_FOUND','CONFLICT','INVALID_INPUT','QUERY_FAILED') THEN RETURN workhub_private.t4_envelope(c,NULL,SQLERRM);END IF;RAISE;END;
END $$;
-- 같은 학교 잠금에서 적용 또는 닫힘 중 하나로만 끝난다.
CREATE FUNCTION workhub_private.t4_mutate(c workhub_private.actor_context,cmd jsonb,k text,closing boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p workhub.timetable_import_previews;r workhub.timetable_import_requests;h text;plan jsonb;prep jsonb;draft jsonb;receipt jsonb;innerkey text;
BEGIN
 IF NOT workhub_private.p5_manager(c) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT workhub_private.p2_exact(cmd,ARRAY['previewId','fingerprint','input']) OR NOT workhub_private.p7_id(cmd->'previewId')
 OR NOT workhub_private.p5_hash(cmd->'fingerprint') OR k IS NULL OR k!~'^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$' OR closing IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT';END IF;
 PERFORM workhub_private.t4_input(cmd->'input');h:=workhub_private.p2_sha(cmd);
 PERFORM workhub_private.t1_lock(c.school_id);
 SELECT * INTO r FROM workhub.timetable_import_requests WHERE school_id=c.school_id AND membership_id=c.membership_id AND request_key=k;
 IF FOUND THEN
 IF r.command_hash<>h THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT';END IF;
 IF closing THEN RETURN jsonb_build_object('requestKey',k,'outcome',r.outcome,'receipt',r.receipt);END IF;
 IF r.outcome='closed' THEN RAISE EXCEPTION 'CONFLICT';END IF;RETURN r.receipt;
 END IF;
 SELECT * INTO p FROM workhub.timetable_import_previews WHERE id=cmd->>'previewId' AND school_id=c.school_id AND membership_id=c.membership_id FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND';END IF;
 IF p.fingerprint<>cmd->>'fingerprint' OR p.input<>cmd->'input' OR EXISTS(SELECT 1 FROM workhub.timetable_import_requests WHERE preview_id=p.id) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF closing THEN
 INSERT INTO workhub.timetable_import_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome) VALUES(c.school_id,c.membership_id,k,h,p.id,'closed');
 PERFORM workhub_private.write_audit(c,'timetable.import_close','timetable_import',p.id,NULL,'school',k,jsonb_build_object('previewId',p.id));
 RETURN jsonb_build_object('requestKey',k,'outcome','closed','receipt',NULL);END IF;
 IF p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT';END IF;
 plan:=workhub_private.t4_plan(c,p.input);
 IF plan->>'fingerprint'<>p.fingerprint THEN RAISE EXCEPTION 'CONFLICT';END IF;
 -- 브라우저 키와 내부 T1 키가 우연히 겹치지 않게 매번 새 UUID를 쓴다. 외부 멱등성은 T4 원장이 보장한다.
 innerkey:=gen_random_uuid()::text;
 prep:=workhub_private.t1_prep_execute(c,p.input->'preparation',innerkey,false);
 draft:=workhub_private.t1_save_draft(c,jsonb_build_object('basisId',prep#>'{basis,id}','basisRevision',prep#>'{basis,revision}',
 'sourceFingerprint',prep#>'{basis,sourceFingerprint}','title',p.input->'title','conditions',jsonb_build_object('fixed',prep#>'{basis,fixed}',
 'unavailable',prep#>'{basis,unavailable}','preferences',prep#>'{basis,preferences}'),'placements',p.input->'placements'),innerkey,false);
 receipt:=jsonb_build_object('requestKey',k,'previewId',p.id,'termId',plan->'termId','basisId',prep#>'{basis,id}',
 'basisRevision',prep#>'{basis,revision}','draftId',draft->'draftId','draftVersion',1,'lessonCount',plan->'lessonCount','recordedAt',clock_timestamp(),'published',false);
 INSERT INTO workhub.timetable_import_requests(school_id,membership_id,request_key,command_hash,preview_id,outcome,receipt) VALUES(c.school_id,c.membership_id,k,h,p.id,'applied',receipt);
 PERFORM workhub_private.write_audit(c,'timetable.import_save','timetable_import',p.id,1,'school',k,jsonb_build_object('draftId',draft->'draftId','fileHash',p.input->'fileHash','published',false));
 RETURN receipt;
END $$;
CREATE FUNCTION public.workhub_timetable_import_commit(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context;s text;v jsonb;
BEGIN
 SELECT school_id INTO s FROM workhub.memberships WHERE id=p_member_id;PERFORM workhub_private.t1_lock(COALESCE(s,'-'));
 c:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(c);
 BEGIN v:=workhub_private.t4_mutate(c,p_command,p_request_key,false);RETURN workhub_private.t4_envelope(c,v);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('NOT_READY','FORBIDDEN','NOT_FOUND','CONFLICT','INVALID_INPUT','QUERY_FAILED','IDEMPOTENCY_CONFLICT') THEN RETURN workhub_private.t4_envelope(c,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR foreign_key_violation OR exclusion_violation THEN RETURN workhub_private.t4_envelope(c,NULL,'CONFLICT');END;
END $$;
CREATE FUNCTION public.workhub_timetable_import_close(p_member_id text,p_command jsonb,p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c workhub_private.actor_context;s text;v jsonb;
BEGIN
 SELECT school_id INTO s FROM workhub.memberships WHERE id=p_member_id;PERFORM workhub_private.t1_lock(COALESCE(s,'-'));
 c:=workhub_private.member_actor(p_member_id,true);PERFORM workhub_private.lock_member_roles(c);
 BEGIN v:=workhub_private.t4_mutate(c,p_command,p_request_key,true);RETURN workhub_private.t4_envelope(c,v);
 EXCEPTION WHEN raise_exception THEN IF SQLERRM IN('NOT_READY','FORBIDDEN','NOT_FOUND','CONFLICT','INVALID_INPUT','QUERY_FAILED','IDEMPOTENCY_CONFLICT') THEN RETURN workhub_private.t4_envelope(c,NULL,SQLERRM);END IF;RAISE;
 WHEN unique_violation OR foreign_key_violation OR exclusion_violation THEN RETURN workhub_private.t4_envelope(c,NULL,'CONFLICT');END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.t4_envelope(workhub_private.actor_context,jsonb,text),workhub_private.t4_input(jsonb),
 workhub_private.t4_plan(workhub_private.actor_context,jsonb),workhub_private.t4_mutate(workhub_private.actor_context,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_timetable_import_get(text),public.workhub_timetable_import_preview(text,jsonb),
 public.workhub_timetable_import_commit(text,jsonb,text),public.workhub_timetable_import_close(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_timetable_import_get(text),public.workhub_timetable_import_preview(text,jsonb),
 public.workhub_timetable_import_commit(text,jsonb,text),public.workhub_timetable_import_close(text,jsonb,text) TO authenticated;
INSERT INTO workhub_private.t4_installs(batch) VALUES('T4-01');
COMMIT;
