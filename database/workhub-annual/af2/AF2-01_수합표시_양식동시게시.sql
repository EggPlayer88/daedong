-- AF2: 기존 확정 SQL은 수정하지 않는다. 신규 조회와 두 게시의 원자 처리만 추가한다.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
DO $$ BEGIN
 IF to_regprocedure('workhub_private.p4_tpl_apply(workhub_private.actor_context,jsonb,text)') IS NULL
 OR to_regprocedure('workhub_private.p7_phase(text,text)') IS NULL
 OR to_regprocedure('workhub_private.c_mutate(workhub_private.actor_context,jsonb,text)') IS NULL THEN
  RAISE EXCEPTION 'AF2 중단: R1·P4·P7 설치를 먼저 확인해 주세요';
 END IF;
END $$;

CREATE FUNCTION workhub_private.af2_statuses(ctx workhub_private.actor_context, a jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ids text[]; cid text; rows jsonb := '[]'; c workhub.collections;
BEGIN
 IF NOT workhub_private.p2_exact(a,ARRAY['ids']) OR jsonb_typeof(a->'ids') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 IF jsonb_array_length(a->'ids')>50 OR EXISTS(SELECT 1 FROM jsonb_array_elements(a->'ids') x WHERE NOT workhub_private.p4_id(x)) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 SELECT array_agg(x) INTO ids FROM jsonb_array_elements_text(a->'ids') x;
 IF cardinality(ids)<>(SELECT count(DISTINCT x) FROM unnest(ids) x) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 PERFORM workhub_private.c_require(ctx,'read');
 FOREACH cid IN ARRAY COALESCE(ids,ARRAY[]::text[]) LOOP
  IF NOT workhub_private.c_reads(ctx,cid) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO STRICT c FROM workhub.collections WHERE school_id=ctx.school_id AND id=cid;
  rows:=rows || jsonb_build_array(jsonb_build_object('requestId',c.id,'version',c.version,'status',c.state,
   'phase',workhub_private.p7_phase(c.school_id,c.id),'dueDate',c.due_on::text));
 END LOOP;
 RETURN jsonb_build_object('today',ctx.school_today::text,'items',rows);
END $$;

CREATE FUNCTION workhub_private.af2_targets(ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT workhub_private.p4_ready(ctx.school_id,'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
 PERFORM workhub_private.c_require(ctx,'read');
 RETURN jsonb_build_object('items',COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'requestId',c.id,'title',c.title,'version',c.version,'publication',jsonb_build_object(
   'state',c.state,'dueDate',c.due_on::text,
   'unitLabels',(SELECT COALESCE(jsonb_agg(u.label ORDER BY u.ordinal),'[]'::jsonb) FROM workhub.collection_plan_units u WHERE u.school_id=c.school_id AND u.collection_id=c.id),
   'recipientCount',(SELECT count(DISTINCT mid) FROM (
    SELECT responsible_membership_id mid FROM workhub.collection_plan_units WHERE school_id=c.school_id AND collection_id=c.id
    UNION SELECT m.membership_id FROM workhub.collection_plan_unit_members m JOIN workhub.collection_plan_units u ON u.id=m.plan_unit_id AND u.school_id=m.school_id WHERE u.school_id=c.school_id AND u.collection_id=c.id
   ) recipients)
  )) ORDER BY c.updated_at DESC,c.id COLLATE "C") FROM (
   SELECT c.* FROM workhub.collections c WHERE c.school_id=ctx.school_id AND c.owner_membership_id=ctx.membership_id
    AND workhub_private.c_is_manager(ctx,c.id) AND workhub_private.p7_phase(c.school_id,c.id)='open'
    AND EXISTS(SELECT 1 FROM workhub.collection_fields f WHERE f.school_id=c.school_id AND f.schema_id=c.current_schema_id AND f.collection_id=c.id AND f.kind='file' AND 'hwpx'=ANY(f.file_accept))
    AND NOT EXISTS(SELECT 1 FROM workhub.guided_templates t WHERE t.collection_id=c.id AND t.state='published')
   ORDER BY c.updated_at DESC,c.id COLLATE "C" LIMIT 200
  ) c),'[]'::jsonb));
END $$;

CREATE FUNCTION workhub_private.af2_publish(ctx workhub_private.actor_context,c jsonb,k text,replay boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q workhub.content_requests; h text; t workhub.guided_templates; col workhub.collections; result jsonb; cmd jsonb;
BEGIN
 IF NOT workhub_private.p4_key(k) OR NOT workhub_private.p2_exact(c,ARRAY['kind','templateId','expectedVersion','previewArtifactId','collectionRequestId','collectionVersion'])
 OR c->>'kind' IS DISTINCT FROM 'publish_collection' OR NOT workhub_private.p4_id(c->'templateId') OR NOT workhub_private.p4_id(c->'previewArtifactId')
 OR NOT workhub_private.p4_id(c->'collectionRequestId') OR NOT workhub_private.p4_pos(c->'expectedVersion') OR NOT workhub_private.p4_pos(c->'collectionVersion') THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
 h:=workhub_private.p2_sha(c);
 -- 기존 양식 명령과 같은 원장·잠금 범위를 사용해 다른 명령으로 같은 번호를 재사용하지 못한다.
 PERFORM workhub_private.p4_replay_gate(ctx,'guided:mutate',k,replay);
 q:=workhub_private.p4_ledger(ctx,'guided','mutate',k,h);
 IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
 IF replay THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT workhub_private.p4_ready(ctx.school_id,'guided') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
 -- 기존 P4와 같은 잠금 순서: 양식 → 수합. 원본 판과 소유권은 게시 순간 다시 검사한다.
 SELECT * INTO t FROM workhub.guided_templates WHERE school_id=ctx.school_id AND id=c->>'templateId' FOR UPDATE;
 IF NOT workhub_private.p4_tpl_sees(ctx,t) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF NOT workhub_private.p4_tpl_owner(ctx,t) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 SELECT * INTO col FROM workhub.collections WHERE school_id=ctx.school_id AND id=c->>'collectionRequestId' FOR UPDATE;
 IF col.id IS NULL OR col.owner_membership_id<>ctx.membership_id OR NOT workhub_private.c_is_manager(ctx,col.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 IF t.state<>'draft' OR t.version<>(c->>'expectedVersion')::int OR col.state<>'draft' OR col.version<>(c->>'collectionVersion')::int
 OR workhub_private.p7_phase(col.school_id,col.id)<>'open' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
 -- 기존 수합 게시 검증·접수증·알림을 그대로 실행한다. 이어지는 양식 검사가 실패하면 전부 롤백된다.
 PERFORM workhub_private.c_mutate(ctx,jsonb_build_object('kind','publish','requestId',col.id,'expectedVersion',col.version),
  'guided-publish-'||md5(ctx.school_id||':'||ctx.membership_id||':'||k));
 cmd:=(c-'kind')||jsonb_build_object('kind','publish','collectionVersion',col.version+1);
 result:=workhub_private.p4_tpl_apply(ctx,cmd,k);
 PERFORM workhub_private.p4_record(ctx,'guided','mutate',k,h,t.id,result);
 RETURN result;
END $$;

CREATE FUNCTION public.workhub_collection_presentation(p_member_id text,p_operation text,p_input jsonb,p_request_key text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx workhub_private.actor_context; result jsonb;
BEGIN
 -- 상태 조회만 기존 수합 참여 범위를 따른다. 양식 제작·게시는 기존 관리자 제한을 유지한다.
 IF p_operation='statuses' AND to_regprocedure('workhub_private.op1_actor(text,boolean,text)') IS NOT NULL THEN
  ctx:=workhub_private.op1_actor(p_member_id,false,'collections');
 ELSE
  ctx:=workhub_private.member_actor(p_member_id,p_operation='publish');
 END IF;
 IF p_operation='publish' THEN PERFORM workhub_private.lock_member_roles(ctx); END IF;
 BEGIN
  IF NOT workhub_private.p4_installed() THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_operation='statuses' AND p_request_key IS NULL THEN result:=workhub_private.af2_statuses(ctx,p_input);
  ELSIF p_operation='targets' AND p_request_key IS NULL AND p_input='{}'::jsonb THEN result:=workhub_private.af2_targets(ctx);
  ELSIF p_operation IN ('publish','recover') THEN result:=workhub_private.af2_publish(ctx,p_input,p_request_key,p_operation='recover');
  ELSE RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN workhub_private.p4_ok(ctx,'collection.presentation.v1',result);
 EXCEPTION WHEN raise_exception THEN
  IF workhub_private.p4_business(SQLERRM) THEN RETURN workhub_private.p4_err(ctx,'collection.presentation.v1',SQLERRM); END IF; RAISE;
 WHEN unique_violation THEN RETURN workhub_private.p4_err(ctx,'collection.presentation.v1','CONFLICT');
 END;
END $$;
REVOKE ALL ON FUNCTION workhub_private.af2_statuses(workhub_private.actor_context,jsonb),workhub_private.af2_targets(workhub_private.actor_context),workhub_private.af2_publish(workhub_private.actor_context,jsonb,text,boolean) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.workhub_collection_presentation(text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_collection_presentation(text,text,jsonb,text) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
