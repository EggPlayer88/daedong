-- 학교 자료 불변 판 조회. 기존 P4 권한·모듈 상태를 그대로 사용한다.
-- 운영 적용은 별도 승인. 표·기존 함수·정책·활성화 값은 변경하지 않는다.
BEGIN;
DO $$
BEGIN
  IF to_regprocedure('workhub_private.p4_installed()') IS NULL THEN RAISE EXCEPTION 'K1 중단: P4 설치를 먼저 확인해 주세요.'; END IF;
  IF NOT workhub_private.p4_installed() THEN RAISE EXCEPTION 'K1 중단: P4 설치를 먼저 확인해 주세요.'; END IF;
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'K1 중단: postgres 역할에서 실행해 주세요.'; END IF;
  IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('workhub_knowledge_get','workhub_knowledge_history')) THEN
    RAISE EXCEPTION 'K1 중단: 같은 이름의 함수가 이미 있습니다. 덮어쓰지 않습니다.';
  END IF;
END $$;

CREATE FUNCTION public.workhub_knowledge_get(p_member_id text,p_source_id text,p_source_version integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; s workhub.knowledge_sources; r workhub.knowledge_source_revisions; manager boolean; data jsonb;
BEGIN
  ctx:=workhub_private.member_actor(p_member_id,false);
  IF NOT workhub_private.p4_installed() THEN RETURN workhub_private.p4_err(ctx,'knowledge.v1','NOT_READY'); END IF;
  BEGIN
    IF NOT workhub_private.p4_ready(ctx.school_id,'knowledge') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF NOT workhub_private.p4_id(to_jsonb(p_source_id)) OR p_source_version IS NULL OR p_source_version<1 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO s FROM workhub.knowledge_sources WHERE school_id=ctx.school_id AND id=p_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    manager:=workhub_private.p4_knowledge_manager(ctx);
    SELECT * INTO r FROM workhub.knowledge_source_revisions WHERE school_id=ctx.school_id AND source_id=s.id AND version=p_source_version;
    IF NOT FOUND OR NOT workhub_private.p4_kn_rev_sees(ctx,s,r.status,manager) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    data:=jsonb_build_object('source',jsonb_build_object(
      'id',s.id,'schoolId',r.school_id,'authorMemberId',s.author_membership_id,'version',r.version,
      'status',r.status,'updatedAt',workhub_private.p4_ts(r.recorded_at),
      'title',r.title,'kind',r.kind,'body',r.body,'locator',r.locator,
      'effectiveFrom',workhub_private.p4_day(r.effective_from),'effectiveThrough',COALESCE(workhub_private.p4_day(r.effective_through),'')
    ),'isCurrent',r.version=s.version,'canManage',manager);
    RETURN workhub_private.p4_ok(ctx,'knowledge.v1',data);
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p4_business(SQLERRM) THEN RETURN workhub_private.p4_err(ctx,'knowledge.v1',SQLERRM); END IF;
    RAISE;
  END;
END $$;

CREATE FUNCTION public.workhub_knowledge_history(p_member_id text,p_source_id text,p_before_version integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; s workhub.knowledge_sources; manager boolean; entries jsonb; more boolean; last_version integer;
BEGIN
  ctx:=workhub_private.member_actor(p_member_id,false);
  IF NOT workhub_private.p4_installed() THEN RETURN workhub_private.p4_err(ctx,'knowledge.v1','NOT_READY'); END IF;
  BEGIN
    IF NOT workhub_private.p4_ready(ctx.school_id,'knowledge') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF NOT workhub_private.p4_id(to_jsonb(p_source_id)) OR (p_before_version IS NOT NULL AND p_before_version<1) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    SELECT * INTO s FROM workhub.knowledge_sources WHERE school_id=ctx.school_id AND id=p_source_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    manager:=workhub_private.p4_knowledge_manager(ctx);
    IF NOT EXISTS(SELECT 1 FROM workhub.knowledge_source_revisions r WHERE r.school_id=ctx.school_id AND r.source_id=s.id AND workhub_private.p4_kn_rev_sees(ctx,s,r.status,manager)) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    WITH candidates AS (
      SELECT r.version,r.status,r.title,r.recorded_at FROM workhub.knowledge_source_revisions r
      WHERE r.school_id=ctx.school_id AND r.source_id=s.id AND (p_before_version IS NULL OR r.version<p_before_version)
        AND workhub_private.p4_kn_rev_sees(ctx,s,r.status,manager)
      ORDER BY r.version DESC LIMIT 51
    ), page AS (SELECT * FROM candidates ORDER BY version DESC LIMIT 50)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('version',version,'status',status,'title',title,
      'recordedAt',workhub_private.p4_ts(recorded_at),'isCurrent',version=s.version) ORDER BY version DESC),'[]'::jsonb),
      min(version),(SELECT count(*)>50 FROM candidates)
    INTO entries,last_version,more FROM page;
    RETURN workhub_private.p4_ok(ctx,'knowledge.v1',jsonb_build_object('sourceId',s.id,'authorMemberId',s.author_membership_id,
      'items',entries,'nextBeforeVersion',CASE WHEN more THEN last_version ELSE NULL END,'canManage',manager));
  EXCEPTION WHEN raise_exception THEN
    IF workhub_private.p4_business(SQLERRM) THEN RETURN workhub_private.p4_err(ctx,'knowledge.v1',SQLERRM); END IF;
    RAISE;
  END;
END $$;
REVOKE ALL ON FUNCTION public.workhub_knowledge_get(text,text,integer),public.workhub_knowledge_history(text,text,integer) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.workhub_knowledge_get(text,text,integer),public.workhub_knowledge_history(text,text,integer) TO authenticated;
COMMIT;
