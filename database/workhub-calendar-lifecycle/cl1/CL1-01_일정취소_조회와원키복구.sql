-- CL1-01: 일정 원본·판·접수 이력을 보존하는 명시적 취소.
-- 현재 INT-15 기준 위에 적용한다. 기존 자료/역할/비용은 바꾸지 않는다.
-- 기존 일정 목록에는 진행 일정만, 별도 조회에는 취소 내역을 반환한다.
BEGIN;
DO $$ DECLARE r record; actual text;
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'CL1: postgres 역할로 실행해 주세요.'; END IF;
 IF to_regclass('workhub_private.cl1_installs') IS NOT NULL THEN RAISE EXCEPTION 'CL1: 이미 설치되어 있습니다. CL1-02로 확인해 주세요.'; END IF;
 IF to_regclass('workhub_private.nt1_installs') IS NULL THEN RAISE EXCEPTION 'CL1: INT-15·NT1 설치 확인이 먼저입니다.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub_private.nt1_installs WHERE batch='NT1-01') THEN RAISE EXCEPTION 'CL1: NT1 설치 기록이 없습니다.'; END IF;
 FOR r IN SELECT * FROM (VALUES
 ('public.workhub_calendar_list(text)','047d740711ca093220c8a22ef253bace',true),
 ('public.workhub_calendar_get(text,text)','9baa280a5bdea5c4c5c6f921907a78c2',true),
 ('public.workhub_calendar_save(text,jsonb)','33baead7b95b44fe2c27e84c5fc84ded',true),
 ('workhub_private.event_dto(workhub.events,text)','cd19c73a7068c8ded756c8b4b140e8bc',false),
 ('workhub_private.event_readable(workhub.events,workhub_private.actor_context)','2a0725bcb58ba8f528139eca7654331b',true),
 ('workhub_private.op1_actor_calendar(text,boolean)','c8d4b6b47751dae3511d811f899bd6be',true)
 ) AS expected(signature,hash,security_definer) LOOP
  SELECT md5(replace(prosrc,E'\r\n',E'\n')) INTO actual FROM pg_proc WHERE oid=to_regprocedure(r.signature) AND proowner='postgres'::regrole AND prosecdef=r.security_definer AND proconfig=ARRAY['search_path=""']::text[];
  IF actual IS DISTINCT FROM r.hash THEN RAISE EXCEPTION 'CL1: 선행 함수 원문/소유자 불일치: %',r.signature; END IF;
 END LOOP;
 IF to_regprocedure('public.workhub_calendar_cancel(text,jsonb,text,boolean)') IS NOT NULL
 OR to_regprocedure('public.workhub_calendar_cancelled_list(text)') IS NOT NULL
 OR to_regprocedure('workhub_private.cl1_event_dto(workhub.events,text)') IS NOT NULL
 OR to_regprocedure('workhub_private.cl1_cancelled_guard()') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgname IN('cl1_cancelled_guard','cl1_install_immutable')) THEN
  RAISE EXCEPTION 'CL1: 같은 이름의 객체가 이미 있습니다.';
 END IF;
END $$;
CREATE TABLE workhub_private.cl1_installs(batch text PRIMARY KEY CHECK(batch='CL1-01'),installed_at timestamptz NOT NULL DEFAULT clock_timestamp());
ALTER TABLE workhub_private.cl1_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub_private.cl1_installs FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER cl1_install_immutable BEFORE UPDATE OR DELETE ON workhub_private.cl1_installs
 FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();

-- 원래 DTO는 일정 가져오기·다른 계약에서도 쓰므로 수정하지 않는다.
CREATE FUNCTION workhub_private.cl1_event_dto(e workhub.events,p_timezone text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT workhub_private.event_dto(e,p_timezone)||jsonb_build_object(
  'status',e.status,
  'cancelledAt',CASE WHEN e.cancelled_at IS NULL THEN NULL ELSE to_char(e.cancelled_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
  'cancelReason',e.cancel_reason)
$$;

CREATE OR REPLACE FUNCTION public.workhub_calendar_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.op1_actor_calendar(p_member_id,false);
 RETURN COALESCE((SELECT jsonb_agg(workhub_private.cl1_event_dto(e,ctx.school_timezone)
  ORDER BY e.start_date,(e.starts_at AT TIME ZONE ctx.school_timezone)::time NULLS FIRST,e.id)
  FROM workhub.events e WHERE e.school_id=ctx.school_id AND e.status='active' AND workhub_private.event_readable(e,ctx)),'[]'::jsonb);
END $$;
CREATE OR REPLACE FUNCTION public.workhub_calendar_get(p_member_id text,p_event_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; e workhub.events;
BEGIN
 ctx:=workhub_private.op1_actor_calendar(p_member_id,false);
 SELECT * INTO e FROM workhub.events WHERE id=p_event_id AND school_id=ctx.school_id;
 IF NOT FOUND OR NOT workhub_private.event_readable(e,ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 RETURN workhub_private.cl1_event_dto(e,ctx.school_timezone);
END $$;
CREATE FUNCTION public.workhub_calendar_cancelled_list(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
 ctx:=workhub_private.op1_actor_calendar(p_member_id,false);
 RETURN COALESCE((SELECT jsonb_agg(workhub_private.cl1_event_dto(e,ctx.school_timezone)
  ORDER BY e.cancelled_at DESC,e.id)
  FROM workhub.events e WHERE e.school_id=ctx.school_id AND e.status='cancelled' AND workhub_private.event_readable(e,ctx)),'[]'::jsonb);
END $$;

-- 취소된 원본을 옛 편집기·일괄 가져오기·나이스 재반영으로 되살리거나 고치지 않는다.
-- 취소 전 저장 접수증 재조회는 UPDATE를 하지 않으므로 종전대로 가능하다.
CREATE FUNCTION workhub_private.cl1_cancelled_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text;
BEGIN
 IF OLD.status='cancelled' THEN
  SELECT timezone INTO tz FROM workhub.schools WHERE id=OLD.school_id;
  RAISE EXCEPTION 'CONFLICT' USING DETAIL=workhub_private.cl1_event_dto(OLD,COALESCE(tz,'Asia/Seoul'))::text;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cl1_cancelled_guard BEFORE UPDATE ON workhub.events
 FOR EACH ROW WHEN (OLD.status='cancelled') EXECUTE FUNCTION workhub_private.cl1_cancelled_guard();

-- 취소 전 저장 원키 복구도 현재 취소 상태를 정확히 반환한다.
DO $$ DECLARE source text;
BEGIN
 SELECT pg_get_functiondef('public.workhub_calendar_save(text,jsonb)'::regprocedure) INTO source;
 IF (length(source)-length(replace(source,'workhub_private.event_dto(e, ctx.school_timezone)','')))/length('workhub_private.event_dto(e, ctx.school_timezone)')<>3 THEN
  RAISE EXCEPTION 'CL1: 일정 저장 DTO 교체 위치가 다릅니다.';
 END IF;
 EXECUTE replace(source,'workhub_private.event_dto(e, ctx.school_timezone)','workhub_private.cl1_event_dto(e, ctx.school_timezone)');
END $$;

CREATE FUNCTION public.workhub_calendar_cancel(p_member_id text,p_command jsonb,p_request_key text,p_recover_only boolean DEFAULT false) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; e workhub.events; r workhub.idempotency_receipts;
 v_id text; v_expected jsonb; v_reason text; v_sha text; v_env jsonb; v_snapshot jsonb; v_now timestamptz;
BEGIN
 IF p_recover_only IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 ctx:=workhub_private.op1_actor_calendar(p_member_id,NOT p_recover_only);
 PERFORM workhub_private.lock_member_roles(ctx);
 v_env:=jsonb_build_object('contractVersion','calendar.lifecycle.v1','schoolId',ctx.school_id,'memberId',ctx.membership_id,
  'ownerUserId',ctx.auth_user_id::text,'requestKey',p_request_key);
 v_sha:=workhub_private.p2_sha(p_command);
 -- 신원·소속 확인 이후의 업무 거절만 확정 응답으로 보낸다.
 BEGIN
 IF p_command IS NULL OR jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>8192
 OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE k NOT IN('eventId','expectedVersion','reason'))
 OR jsonb_typeof(p_command->'eventId') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_command->'reason') IS DISTINCT FROM 'string'
 OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 v_id:=p_command->>'eventId';v_expected:=p_command->'expectedVersion';v_reason:=workhub_private.js_trim(p_command->>'reason');
 IF length(v_id) NOT BETWEEN 1 AND 200 OR v_expected::text !~ '^[1-9][0-9]{0,8}$'
 OR length(v_reason) NOT BETWEEN 1 AND 500
 OR v_reason ~ '[\x01-\x08\x0b\x0c\x0e-\x1f]' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 r:=workhub_private.claim_receipt(ctx,'calendar.cancel',p_request_key,v_sha);
 IF r.idem_key IS NOT NULL THEN
  SELECT * INTO e FROM workhub.events WHERE id=r.resource_id AND school_id=ctx.school_id;
  -- 이미 접수된 요청은 가시성이 바뀌어도 실패로 바꾸지 않는다.
  -- 원문은 숨기되 원키를 유지해 현재 권한으로 결과를 다시 확인하도록 한다.
  IF NOT FOUND OR NOT workhub_private.event_readable(e,ctx) THEN
   RETURN v_env||jsonb_build_object('ok',false,'code','SAVE_UNCERTAIN','commandHash',v_sha,'outcome','unknown');
  END IF;
  RETURN v_env||jsonb_build_object('ok',true,'event',workhub_private.cl1_event_dto(e,ctx.school_timezone),'recordedAt',r.result->>'recorded_at');
 END IF;
 -- 복구 호출은 접수된 결과만 읽는다. 번호가 없으면 취소를 새로 실행하지 않는다.
 IF p_recover_only THEN
  RETURN v_env||jsonb_build_object('ok',false,'code','SAVE_UNCERTAIN','commandHash',v_sha,'outcome','unknown');
 END IF;
 SELECT * INTO e FROM workhub.events WHERE id=v_id AND school_id=ctx.school_id FOR UPDATE;
 IF NOT FOUND OR NOT workhub_private.event_readable(e,ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF e.kind='official' OR (e.author_account_id<>ctx.account_id AND (e.visibility='private' OR NOT workhub_private.member_has_perm(ctx,'calendar.shared_manage'))) THEN
  RAISE EXCEPTION 'FORBIDDEN';
 END IF;
 IF e.status<>'active' OR to_jsonb(e.version)<>v_expected THEN
  RAISE EXCEPTION 'CONFLICT' USING DETAIL=workhub_private.cl1_event_dto(e,ctx.school_timezone)::text;
 END IF;
 v_snapshot:=workhub_private.p2_event_draft(e,ctx.school_timezone);
 v_now:=clock_timestamp();
 UPDATE workhub.events SET status='cancelled',cancelled_at=v_now,cancel_reason=v_reason,
  current_revision_no=current_revision_no+1,version=version+1,updated_at=v_now WHERE id=e.id RETURNING * INTO e;
 INSERT INTO workhub.event_revisions(event_id,revision_no,scope_key,school_id,event_version,snapshot,change_kind,change_reason,changed_by_account_id)
 VALUES(e.id,e.current_revision_no,e.scope_key,e.school_id,e.version,v_snapshot,'cancel',v_reason,ctx.account_id);
 PERFORM workhub_private.store_receipt(ctx,'calendar.cancel',p_request_key,v_sha,'event',e.id,e.version);
 PERFORM workhub_private.write_audit(ctx,'event.cancel','event',e.id,e.version,CASE WHEN e.visibility='private' THEN 'owner_only' ELSE 'school' END,p_request_key,'{}');
 PERFORM workhub_private.emit_outbox(ctx,'event.cancelled','event',e.id,e.version,jsonb_build_object('event_id',e.id,'version',e.version));
 r:=workhub_private.claim_receipt(ctx,'calendar.cancel',p_request_key,v_sha);
 RETURN v_env||jsonb_build_object('ok',true,'event',workhub_private.cl1_event_dto(e,ctx.school_timezone),'recordedAt',r.result->>'recorded_at');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM=ANY(ARRAY['INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT']) THEN
   RETURN v_env||jsonb_build_object('ok',false,'code',SQLERRM,'commandHash',v_sha,'outcome','rejected');
  END IF;
  RAISE;
 WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure THEN
  RETURN v_env||jsonb_build_object('ok',false,'code','CONFLICT','commandHash',v_sha,'outcome','rejected');
 END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.cl1_event_dto(workhub.events,text),workhub_private.cl1_cancelled_guard() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_calendar_cancelled_list(text),public.workhub_calendar_cancel(text,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_calendar_cancelled_list(text),public.workhub_calendar_cancel(text,jsonb,text,boolean) TO authenticated;
INSERT INTO workhub_private.cl1_installs(batch) VALUES('CL1-01');
COMMIT;
SELECT 'CL1-01' AS no,'ok' AS status,'일정 취소와 취소 내역·원래 요청 결과 확인을 설치했습니다.' AS detail;
