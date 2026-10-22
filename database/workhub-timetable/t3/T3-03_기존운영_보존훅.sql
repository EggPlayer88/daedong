-- T3 기존 T2 보호 훅. 기존 적용 SQL은 변경하지 않는다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM workhub_private.t3_installs WHERE batch='T3-02') OR EXISTS(SELECT 1 FROM workhub_private.t3_installs WHERE batch='T3-03') THEN RAISE EXCEPTION 'T3-02 이후 한 번만 적용하세요.';END IF;END $$;
DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_lesson_busy';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'0d9204c50f7da7970bdbdb692a7ef495' THEN RAISE EXCEPTION 'T3: t2_lesson_busy 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
  SELECT EXISTS (SELECT 1 FROM workhub.timetable_exchange_lessons x JOIN workhub.timetable_exchange_requests r ON r.id = x.request_id
                  WHERE x.school_id = p_school AND x.lesson_id = p_lesson AND workhub_private.t2_req_live(r, p_at))
 OR EXISTS(SELECT 1 FROM workhub.timetable_interventions r WHERE r.school_id=p_school AND workhub_private.t3_live(r,p_at) AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') x WHERE x->>'id'=p_lesson))
$t3body$);
END $hook$;
DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_publish_plan';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'4a1f63480f564c9f700390e507a08aac' THEN RAISE EXCEPTION 'T3: t2_publish_plan 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
DECLARE v_range daterange := workhub_private.t2_publish_input(i); v_tz text := p_ctx.school_timezone; d workhub.timetable_drafts; t workhub.terms;
        b workhub.timetable_basis_revisions; v_excluded jsonb; v_rows jsonb; v_blockers jsonb := '[]'::jsonb; v_missing integer; v_busy jsonb; v_conf text[];
        v_partial jsonb; v_closed jsonb;
BEGIN
  SELECT * INTO d FROM workhub.timetable_drafts WHERE school_id = p_ctx.school_id AND id = i ->> 'draftId';
  IF d.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF (i -> 'draftVersion') <> '1'::jsonb THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO t FROM workhub.terms WHERE school_id = d.school_id AND id = d.term_id;
  IF t.state = 'closed' OR t.ends_on <= p_ctx.school_today THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  -- 공개 기간은 그 편성 초안의 학기 안이어야 한다(학기 밖 날짜에 이 학기 배치를 펼치지 않는다)
  IF lower(v_range) < t.starts_on OR upper(v_range) > t.ends_on THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO b FROM workhub.timetable_basis_revisions WHERE school_id = d.school_id AND id = d.basis_id;
  v_excluded := workhub_private.t2_closed_days(p_ctx.school_id, lower(v_range), upper(v_range));

  WITH res AS (
    SELECT r ->> 'id' AS id, r ->> 'kind' AS kind, r ->> 'label' AS label, COALESCE((r ->> 'capacity')::integer, 1) AS cap FROM jsonb_array_elements(b.basis -> 'resources') r
  ), bl AS (
    SELECT l ->> 'id' AS act, l ->> 'courseId' AS course, l ->> 'label' AS label,
           ARRAY(SELECT x FROM jsonb_array_elements_text(l -> 'allowedSlotIds') x) AS allowed,
           ARRAY(SELECT rid FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o) JOIN res ON res.id = z.rid AND res.kind = 'teacher' ORDER BY z.o) AS teachers,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'name', res.label) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid AND res.kind IN ('class','student_group')), '[]'::jsonb) AS groups,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'name', res.label) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid AND res.kind = 'room'), '[]'::jsonb) AS rooms,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('id', res.id, 'kind', res.kind, 'capacity', res.cap) ORDER BY z.o) FROM jsonb_array_elements_text(l -> 'resourceIds') WITH ORDINALITY z(rid, o)
                      JOIN res ON res.id = z.rid), '[]'::jsonb) AS uses
      FROM jsonb_array_elements(b.basis -> 'lessons') l
  ), pl AS (   -- 기간의 날짜마다 펼친 배치(휴업일 제외)
    SELECT bl.*, dd::date AS occ, workhub_private.t2_at(dd::date, (s ->> 'startMinute')::integer, v_tz) AS s, workhub_private.t2_at(dd::date, (s ->> 'endMinute')::integer, v_tz) AS e
      FROM generate_series(lower(v_range)::timestamp, (upper(v_range) - 1)::timestamp, interval '1 day') dd
      CROSS JOIN jsonb_array_elements(d.placements) p
      JOIN bl ON bl.act = p ->> 'lessonId'
      JOIN jsonb_array_elements(b.basis -> 'slots') s ON s ->> 'id' = p ->> 'slotId' AND (s ->> 'day')::integer = extract(isodow FROM dd)::integer
     WHERE NOT (v_excluded @> jsonb_build_array(jsonb_build_object('date', to_char(dd::date, 'YYYY-MM-DD'))))
  ), ex AS (   -- 지금 살아 있는 수업 + 학사 변경으로 취소한 수업(이 학기 · 기간의 원래 날짜)
    -- 학사 변경(휴업)으로 취소한 occurrence 는 pinned 로 남아 재공개에서도 되살리지 않는다. 일반 재공개 취소 이력(changed_by='publish')은
    -- 넣지 않으므로 다시 배치하면 새로 만든다. 한 occurrence 에 행이 여럿이면 살아 있는 행 → 가장 최근 학사 변경 취소 하나만 맞춘다.
    SELECT DISTINCT ON (l.activity_id, l.occurrence_date) l AS r, l.activity_id AS act, l.occurrence_date AS occ FROM workhub.timetable_lessons l
     WHERE l.school_id = d.school_id AND l.term_id = d.term_id AND l.occurrence_date >= lower(v_range) AND l.occurrence_date < upper(v_range)
       AND (l.state <> 'cancelled' OR (l.pinned AND l.changed_by IN ('school_day','intervention')))
     ORDER BY l.activity_id, l.occurrence_date, (l.state = 'cancelled'), l.changed_at DESC, l.id COLLATE "C"
  ), cl AS (   -- 그 학교 · 날짜의 휴업 학급(휴업 기록 여러 건의 합집합)
    SELECT (c.input ->> 'date')::date AS day, array_agg(DISTINCT g.v) AS gids
      FROM workhub.timetable_school_day_changes c CROSS JOIN jsonb_array_elements_text(c.input -> 'groupIds') g(v)
     WHERE c.school_id = d.school_id AND c.input ->> 'kind' = 'closure'
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_reopened_days rd WHERE rd.school_id=c.school_id AND rd.school_day_change_id=c.id)
       AND (c.input ->> 'date')::date >= lower(v_range) AND (c.input ->> 'date')::date < upper(v_range)
     GROUP BY 1
  ), j AS (
    SELECT pl.act AS p_act, pl.course AS p_course, pl.label AS p_label, pl.allowed AS p_allowed, pl.teachers AS p_teachers, pl.groups AS p_groups, pl.rooms AS p_rooms,
           pl.uses AS p_uses, pl.occ AS p_occ, pl.s AS p_s, pl.e AS p_e, ex.r AS e_row,
           (SELECT count(*) FROM jsonb_array_elements(pl.groups) g JOIN cl ON cl.day = pl.occ AND (g ->> 'id') = ANY (cl.gids)) AS p_closed
      FROM pl FULL JOIN ex ON ex.act = pl.act AND ex.occ = pl.occ
  ), k AS (
    SELECT j.*, CASE
        WHEN (e_row).id IS NOT NULL AND (e_row).starts_at <= p_cutoff THEN NULL          -- 이미 시작한 수업: 그대로(지난 기록)
        WHEN p_act IS NOT NULL AND p_s <= p_cutoff THEN NULL                               -- 계획 시각이 이미 지남: 그대로
        WHEN (e_row).id IS NOT NULL AND (e_row).pinned THEN NULL                           -- 교환 · 학사 변경(휴업 취소 포함) 수업: 그대로(retained)
        WHEN (e_row).id IS NULL AND p_act IS NOT NULL AND jsonb_array_length(p_groups) > 0
             AND p_closed = jsonb_array_length(p_groups) THEN NULL                          -- 학급이 전부 휴업인 날: 새로 만들지 않음
        WHEN p_act IS NOT NULL AND cardinality(p_teachers) = 0 THEN 'skip'                 -- 담당 교사 없는 수업: 공개하지 않음(차단)
        WHEN (e_row).id IS NULL THEN 'new'
        WHEN p_act IS NULL THEN 'cancel'
        WHEN (e_row).label = p_label AND (e_row).starts_at = p_s AND (e_row).ends_at = p_e AND (e_row).teacher_ids = p_teachers AND (e_row).groups = p_groups
             AND (e_row).rooms = p_rooms AND (e_row).uses = p_uses AND (e_row).allowed_slot_ids = p_allowed AND (e_row).course_id = p_course THEN NULL
        ELSE 'update' END AS kind
      FROM j
  )
  SELECT (SELECT count(*) FROM k WHERE kind = 'skip'),
         COALESCE(jsonb_agg(CASE kind
           WHEN 'new' THEN jsonb_build_object('k', 'new', 'id', workhub_private.t2_new_id(p_preview, p_act, p_occ), 'version', 1, 'act', p_act, 'course', p_course,
             'occ', p_occ, 'label', p_label, 's', p_s, 'e', p_e, 'teachers', to_jsonb(p_teachers), 'groups', p_groups, 'rooms', p_rooms, 'uses', p_uses,
             'allowed', to_jsonb(p_allowed), 'before', NULL,
             'after', workhub_private.t2_plesson(workhub_private.t2_new_id(p_preview, p_act, p_occ), 1, p_label, p_s, p_e, p_teachers, p_groups, p_rooms, 'scheduled'))
           WHEN 'update' THEN jsonb_build_object('k', 'update', 'id', (e_row).id, 'version', (e_row).version + 1, 'act', p_act, 'course', p_course, 'occ', p_occ,
             'label', p_label, 's', p_s, 'e', p_e, 'teachers', to_jsonb(p_teachers), 'groups', p_groups, 'rooms', p_rooms, 'uses', p_uses, 'allowed', to_jsonb(p_allowed),
             'before', workhub_private.t2_lesson(e_row, false, '[]'::jsonb),
             'after', workhub_private.t2_plesson((e_row).id, (e_row).version + 1, p_label, p_s, p_e, p_teachers, p_groups, p_rooms, 'scheduled'))
           ELSE jsonb_build_object('k', 'cancel', 'id', (e_row).id, 'version', (e_row).version + 1, 's', (e_row).starts_at, 'e', (e_row).ends_at,
             'before', workhub_private.t2_lesson(e_row, false, '[]'::jsonb),
             'after', workhub_private.t2_plesson((e_row).id, (e_row).version + 1, (e_row).label, (e_row).starts_at, (e_row).ends_at, (e_row).teacher_ids,
                                                 (e_row).groups, (e_row).rooms, 'cancelled')) END
           ORDER BY CASE WHEN kind = 'cancel' THEN (e_row).starts_at ELSE p_s END,
                    CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END)
           FILTER (WHERE kind IN ('new','update','cancel')), '[]'::jsonb),
         jsonb_agg(CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END
                   ORDER BY CASE WHEN kind = 'new' THEN workhub_private.t2_new_id(p_preview, p_act, p_occ) ELSE (e_row).id END)
           FILTER (WHERE kind IN ('new','update') AND p_closed > 0 AND p_closed < jsonb_array_length(p_groups)),   -- 일부 학급만 휴업(합반)
         jsonb_agg((e_row).id ORDER BY (e_row).id)
           FILTER (WHERE kind = 'update' AND p_closed > 0 AND p_closed = jsonb_array_length(p_groups))             -- 바뀐 뒤 학급이 전부 휴업
    INTO v_missing, v_rows, v_partial, v_closed FROM k;

  -- 차단 사유(앱 blocker: code · message · lessonIds ⊆ 바뀌는 수업)
  IF d.basis_id IS DISTINCT FROM t.current_timetable_basis_id THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'BASIS_OUTDATED',
      'message', '이 편성 초안의 기준판이 학기의 현재 기준판이 아닙니다. 현재 기준판으로 편성 초안을 다시 저장해 주세요.', 'lessonIds', '[]'::jsonb));
  END IF;
  IF v_missing > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'TEACHER_MISSING',
      'message', format('담당 교사가 없는 수업 %s건은 공개할 수 없습니다. 수업 담당을 지정한 뒤 기준판을 다시 확정해 주세요.', v_missing), 'lessonIds', '[]'::jsonb));
  END IF;
  IF v_partial IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PARTIAL_GROUP_SCOPE',
      'message', '휴업한 학급과 수업하는 학급이 섞인 합반 수업이 있습니다. 휴업 범위나 배치를 먼저 정리해 주세요.', 'lessonIds', v_partial));
  END IF;
  IF v_closed IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'SCHOOL_CLOSED',
      'message', '휴업한 학급의 수업으로 바뀌는 수업이 있습니다. 그날 수업은 학사 변경에서 정리하거나 배치를 바꿔 주세요.', 'lessonIds', v_closed));
  END IF;
  SELECT jsonb_agg(x ->> 'id' ORDER BY x ->> 'id') INTO v_busy FROM jsonb_array_elements(v_rows) x
   WHERE x ->> 'k' <> 'new' AND workhub_private.t2_lesson_busy(p_ctx.school_id, x ->> 'id', p_cutoff);
  IF v_busy IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'EXISTING_REQUEST',
      'message', '진행 중인 교환 요청이 걸린 수업이 바뀝니다. 요청을 마무리(승인 · 거절 · 철회)한 뒤 다시 확인해 주세요.', 'lessonIds', v_busy));
  END IF;
  v_conf := workhub_private.t2_conflicts(p_ctx.school_id,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x ->> 'id', 's', x -> 's', 'e', x -> 'e', 'uses', x -> 'uses')) FROM jsonb_array_elements(v_rows) x
               WHERE x ->> 'k' <> 'cancel'), '[]'::jsonb),
    COALESCE(ARRAY(SELECT x ->> 'id' FROM jsonb_array_elements(v_rows) x WHERE x ->> 'k' = 'cancel'), ARRAY[]::text[]));
  IF cardinality(v_conf) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_CONFLICT',
      'message', '같은 시간에 교사 · 학급 · 공간이 겹치는 수업이 있습니다(교환 · 학사 변경으로 옮긴 수업이나 다른 공개 시간표와 겹침).', 'lessonIds', to_jsonb(v_conf)));
  END IF;
  IF jsonb_array_length(v_rows) = 0 AND jsonb_array_length(v_blockers) = 0 THEN
    v_blockers := jsonb_build_array(jsonb_build_object('code', 'NO_CHANGES', 'message', '이 기간에 새로 공개할 변경이 없습니다.', 'lessonIds', '[]'::jsonb));
  END IF;
  RETURN jsonb_build_object('rows', v_rows, 'blockers', v_blockers, 'excludedDays', v_excluded,
    'existingChanges', CASE WHEN v_busy IS NULL THEN 'retained' ELSE 'blocked' END,
    'termId', d.term_id, 'basisId', d.basis_id, 'draftId', d.id, 'unavailable', COALESCE(d.conditions -> 'unavailable', '[]'::jsonb),
    'title', d.title, 'from', lower(v_range), 'until', upper(v_range),
    'basisFingerprint', workhub_private.p2_sha(jsonb_build_object('basisId', b.id, 'basisRevision', b.revision, 'sourceFingerprint', b.source_fingerprint, 'draftId', d.id)));
END $t3body$);
END $hook$;

CREATE FUNCTION workhub_private.t3_exchange_guard(ctx workhub_private.actor_context,p_changes jsonb,p_approve boolean DEFAULT false,p_requester text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ids text[];
BEGIN
 -- 정책 행이 없는 학교의 기존 T2 동작은 유지한다. 시범 행은 담당자가 직접 작성한다.
 IF NOT EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=ctx.school_id) THEN RETURN;END IF;
 IF workhub_private.t3_ready(ctx) IS NOT NULL THEN RAISE EXCEPTION 'NOT_READY';END IF;
 ids:=ARRAY(SELECT DISTINCT t->>'id' FROM jsonb_array_elements(p_changes) c CROSS JOIN jsonb_array_elements(c#>'{after,teachers}') t);
 IF EXISTS(SELECT 1 FROM unnest(ids) id WHERE NOT workhub_private.t3_member(ctx.school_id,id))
 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c CROSS JOIN jsonb_array_elements(c#>'{after,teachers}') t JOIN workhub.memberships m ON m.school_id=ctx.school_id AND m.id=t->>'id'
 WHERE NOT(workhub_private.t2_day((c#>>'{after,time,startsAt}')::timestamptz,ctx.school_timezone)<@daterange(m.valid_from,m.valid_to,'[)')))
 THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF p_approve AND (ctx.account_id=p_requester OR EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=ANY(ids) AND m.account_id=ctx.account_id)) THEN RAISE EXCEPTION 'FORBIDDEN';END IF;
 IF NOT EXISTS(SELECT 1 FROM workhub_private.t3_approvers(ctx.school_id,ctx.school_today) a WHERE a.account_id<>COALESCE(p_requester,ctx.account_id)
 AND NOT EXISTS(SELECT 1 FROM workhub.memberships m WHERE m.school_id=ctx.school_id AND m.id=ANY(ids) AND m.account_id=a.account_id)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_changes) c JOIN workhub.timetable_lessons l ON l.school_id=ctx.school_id AND l.id=c#>>'{after,id}'
 WHERE workhub_private.t3_closed(ctx.school_id,workhub_private.t2_day((c#>>'{after,time,startsAt}')::timestamptz,ctx.school_timezone),l.groups)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
END $$;
DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_exchange_calc';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'576a8a374c3f11295b8355f3d4933ce5' THEN RAISE EXCEPTION 'T3: t2_exchange_calc 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
DECLARE a workhub.timetable_lessons; o workhub.timetable_lessons; va jsonb; vo jsonb; v_changes jsonb; v_blockers jsonb := '[]'::jsonb; v_ids text[]; v_c text[];
        v_bad jsonb; v_closed jsonb; v_tz text := p_ctx.school_timezone;
BEGIN
  PERFORM workhub_private.t2_exchange_input(i);
  SELECT * INTO a FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = i ->> 'lessonId';
  IF a.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT (p_ctx.membership_id = ANY (a.teacher_ids)) OR a.changed_by = 'school_day' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF to_jsonb(a.version) <> i -> 'expectedVersion' OR a.state <> 'scheduled' OR a.starts_at <= p_at THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  va := workhub_private.t2_vlesson(a, p_ctx, p_at);
  IF i ->> 'kind' = 'move' THEN
    IF NOT ((va -> 'allowedTargets') @> jsonb_build_array(i -> 'target')) OR i -> 'target' = va -> 'time'
       OR workhub_private.t2_parse_ts(i #> '{target,startsAt}', true) <= p_at THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_changes := jsonb_build_array(jsonb_build_object('before', va, 'after', va || jsonb_build_object('version', a.version + 1, 'time', i -> 'target')));
  ELSE
    SELECT * INTO o FROM workhub.timetable_lessons WHERE school_id = p_ctx.school_id AND id = i ->> 'otherLessonId';
    IF o.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF to_jsonb(o.version) <> i -> 'otherExpectedVersion' OR o.state <> 'scheduled' OR o.starts_at <= p_at THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    vo := workhub_private.t2_vlesson(o, p_ctx, p_at);
    IF NOT ((va -> 'allowedTargets') @> jsonb_build_array(vo -> 'time')) OR NOT ((vo -> 'allowedTargets') @> jsonb_build_array(va -> 'time'))
       OR va -> 'time' = vo -> 'time' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_changes := jsonb_build_array(jsonb_build_object('before', va, 'after', va || jsonb_build_object('version', a.version + 1, 'time', vo -> 'time')),
                                   jsonb_build_object('before', vo, 'after', vo || jsonb_build_object('version', o.version + 1, 'time', va -> 'time')));
  END IF;
  v_ids := ARRAY(SELECT c #>> '{after,id}' FROM jsonb_array_elements(v_changes) c);
  -- 내가 담당한 수업에 그 사이 다른 요청이 걸렸으면 화면이 본 수업(요청 가능)과 달라졌다 → CONFLICT(앱이 다시 조회).
  --   앱은 before 가 화면의 수업과 같아야 받으므로, 차단 사유로 돌려주면 응답 오류(INVALID_RESPONSE)로 보인다.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_changes) c
              WHERE c #> '{before,teachers}' @> jsonb_build_array(jsonb_build_object('id', p_ctx.membership_id))
                AND workhub_private.t2_lesson_busy(p_ctx.school_id, c #>> '{after,id}', p_at)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 차단: 진행 중 요청(상대 수업) · 자원 겹침 · 공개판 불가 조건 · 휴업일
  v_bad := (SELECT jsonb_agg(x ORDER BY x) FROM unnest(v_ids) x WHERE workhub_private.t2_lesson_busy(p_ctx.school_id, x, p_at));
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'PENDING_REQUEST',
      'message', '이 수업에 진행 중인 다른 교환 요청이 있습니다. 그 요청이 끝난 뒤 다시 확인해 주세요.', 'lessonIds', v_bad));
  END IF;
  v_c := workhub_private.t2_conflicts(p_ctx.school_id, (
    SELECT jsonb_agg(jsonb_build_object('id', l.id, 's', c #>> '{after,time,startsAt}', 'e', c #>> '{after,time,endsAt}', 'uses', l.uses))
      FROM jsonb_array_elements(v_changes) c JOIN workhub.timetable_lessons l ON l.school_id = p_ctx.school_id AND l.id = c #>> '{after,id}'), ARRAY[]::text[]);
  IF cardinality(v_c) > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_CONFLICT',
      'message', '옮길 시간에 같은 교사 · 학급 · 공간을 쓰는 다른 수업이 있습니다.', 'lessonIds', to_jsonb(v_c)));
  END IF;
  v_bad := (SELECT jsonb_agg(l.id ORDER BY l.id) FROM jsonb_array_elements(v_changes) c JOIN workhub.timetable_lessons l ON l.school_id = p_ctx.school_id AND l.id = c #>> '{after,id}'
             WHERE workhub_private.t2_unavailable(l.publication_id, l.uses, (c #>> '{after,time,startsAt}')::timestamptz, (c #>> '{after,time,endsAt}')::timestamptz, v_tz));
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'RESOURCE_UNAVAILABLE',
      'message', '옮길 시간은 교사 · 공간의 수업 불가 시간입니다.', 'lessonIds', v_bad));
  END IF;
  v_bad := (SELECT jsonb_agg(c #>> '{after,id}' ORDER BY c #>> '{after,id}') FROM jsonb_array_elements(v_changes) c
             WHERE jsonb_array_length(workhub_private.t2_closed_days(p_ctx.school_id, workhub_private.t2_day((c #>> '{after,time,startsAt}')::timestamptz, v_tz),
                                                                     workhub_private.t2_day((c #>> '{after,time,startsAt}')::timestamptz, v_tz) + 1)) > 0);
  IF v_bad IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object('code', 'SCHOOL_CLOSED', 'message', '옮길 날짜가 휴업일입니다.', 'lessonIds', v_bad));
  END IF;
  PERFORM workhub_private.t3_exchange_guard(p_ctx,v_changes);
  RETURN jsonb_build_object('changes', v_changes, 'blockers', v_blockers, 'participants', workhub_private.t2_participants(v_changes));
END $t3body$);
END $hook$;
DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_action';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'3678a4ca207035a5497b19da88503295' THEN RAISE EXCEPTION 'T3: t2_action 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
DECLARE rq workhub.timetable_exchange_requests; v_at timestamptz; v_act text := c ->> 'action'; v_status text; v_changed jsonb := '[]'::jsonb; v_c text[];
        v_tz text := p_ctx.school_timezone; v_others text[];
BEGIN
  IF NOT workhub_private.p2_exact(c, ARRAY['kind','requestId','expectedVersion','proposalHash','action']) OR NOT workhub_private.p7_id(c -> 'requestId')
     OR NOT workhub_private.p7_pos(c -> 'expectedVersion') OR NOT workhub_private.p5_hash(c -> 'proposalHash') OR jsonb_typeof(c -> 'action') <> 'string'
     OR v_act NOT IN ('accept','reject','withdraw','approve','rejectApproval') THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  SELECT * INTO rq FROM workhub.timetable_exchange_requests WHERE school_id = p_ctx.school_id AND id = c ->> 'requestId' FOR UPDATE;
  IF rq.id IS NULL OR NOT workhub_private.t2_req_visible(rq, p_ctx) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF to_jsonb(rq.version) <> c -> 'expectedVersion' OR rq.proposal_hash <> c ->> 'proposalHash' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=p_ctx.school_id) THEN PERFORM workhub_private.t3_lock_members(p_ctx.school_id);END IF;
  PERFORM workhub_private.t3_exchange_guard(p_ctx,rq.changes,v_act IN ('approve','rejectApproval'),rq.requester_account_id);
  v_at := workhub_private.t2_now();
  -- 끝났거나 · 기한이 지났거나 · 수업 판이 바뀐 요청은 응답할 수 없다
  IF rq.state NOT IN ('awaiting_consent','awaiting_approval') OR rq.expires_at <= v_at OR workhub_private.t2_req_stale(rq.id) THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_others := ARRAY(SELECT membership_id FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND membership_id <> rq.requester_membership_id
                     ORDER BY membership_id);
  IF v_act IN ('accept','reject') THEN
    IF rq.state <> 'awaiting_consent' OR NOT EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants
                                                     WHERE request_id = rq.id AND membership_id = p_ctx.membership_id AND response = 'pending') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    UPDATE workhub.timetable_exchange_participants SET response = CASE WHEN v_act = 'accept' THEN 'accepted' ELSE 'rejected' END, responded_at = v_at
     WHERE request_id = rq.id AND membership_id = p_ctx.membership_id;
    IF v_act = 'reject' THEN v_status := 'rejected';
    ELSIF NOT EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND response <> 'accepted') THEN v_status := 'awaiting_approval';
    ELSE v_status := 'awaiting_consent'; END IF;
  ELSIF v_act = 'withdraw' THEN
    IF rq.requester_account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    v_status := 'withdrawn';
  ELSE
    IF rq.state <> 'awaiting_approval' OR NOT workhub_private.p5_manager(p_ctx) OR rq.requester_account_id = p_ctx.account_id
       OR EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants WHERE request_id = rq.id AND response <> 'accepted') THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF v_act = 'rejectApproval' THEN
      v_status := 'rejected';
    ELSE
      -- 반영 직전 다시 확인: 시작 전 · 자원 겹침 · 불가 조건 · 휴업일
      IF EXISTS (SELECT 1 FROM jsonb_array_elements(rq.changes) ch WHERE (ch #>> '{before,time,startsAt}')::timestamptz <= v_at
                                                                     OR (ch #>> '{after,time,startsAt}')::timestamptz <= v_at) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      v_c := workhub_private.t2_conflicts(p_ctx.school_id, (
        SELECT jsonb_agg(jsonb_build_object('id', l.id, 's', ch #>> '{after,time,startsAt}', 'e', ch #>> '{after,time,endsAt}', 'uses', l.uses))
          FROM jsonb_array_elements(rq.changes) ch JOIN workhub.timetable_lessons l ON l.school_id = rq.school_id AND l.id = ch #>> '{after,id}'), ARRAY[]::text[]);
      IF cardinality(v_c) > 0 OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(rq.changes) ch JOIN workhub.timetable_lessons l ON l.school_id = rq.school_id AND l.id = ch #>> '{after,id}'
            WHERE workhub_private.t2_unavailable(l.publication_id, l.uses, (ch #>> '{after,time,startsAt}')::timestamptz, (ch #>> '{after,time,endsAt}')::timestamptz, v_tz)
               OR jsonb_array_length(workhub_private.t2_closed_days(rq.school_id, workhub_private.t2_day((ch #>> '{after,time,startsAt}')::timestamptz, v_tz),
                                                                    workhub_private.t2_day((ch #>> '{after,time,startsAt}')::timestamptz, v_tz) + 1)) > 0) THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
      UPDATE workhub.timetable_lessons l SET starts_at = (ch #>> '{after,time,startsAt}')::timestamptz, ends_at = (ch #>> '{after,time,endsAt}')::timestamptz,
             version = (ch #>> '{after,version}')::integer, pinned = true, changed_by = 'exchange', changed_at = v_at
        FROM jsonb_array_elements(rq.changes) ch WHERE l.school_id = rq.school_id AND l.id = ch #>> '{after,id}';
      INSERT INTO workhub.timetable_lesson_versions (school_id, lesson_id, version, change_kind, source_id, snapshot)
      SELECT l.school_id, l.id, l.version, 'exchange', rq.id, to_jsonb(l) - 'school_id'
        FROM workhub.timetable_lessons l JOIN jsonb_array_elements(rq.changes) ch ON ch #>> '{after,id}' = l.id WHERE l.school_id = rq.school_id;
      v_changed := (SELECT jsonb_agg(jsonb_build_object('id', ch #>> '{after,id}', 'version', ch #> '{after,version}') ORDER BY o)
                      FROM jsonb_array_elements(rq.changes) WITH ORDINALITY z(ch, o));
      v_status := 'applied';
    END IF;
  END IF;
  UPDATE workhub.timetable_exchange_requests SET state = v_status, version = version + 1, updated_at = v_at,
         decided_by_membership_id = CASE WHEN v_act IN ('approve','rejectApproval') THEN p_ctx.membership_id ELSE decided_by_membership_id END
   WHERE id = rq.id RETURNING * INTO rq;
  -- 알림(같은 트랜잭션)
  IF v_act = 'accept' AND v_status = 'awaiting_approval' THEN
    PERFORM workhub_private.t2_notify(rq, workhub_private.t2_approver_ids(rq, p_ctx.school_today), 'approval', '시간표 변경 승인 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 관련 교사가 모두 동의했습니다. 승인 또는 반려해 주세요.');
  ELSIF v_status = 'rejected' THEN
    PERFORM workhub_private.t2_notify(rq, ARRAY[rq.requester_membership_id], 'rejected', '시간표 변경 요청이 거절되었습니다',
                                      workhub_private.t2_req_summary(rq, v_tz) || CASE WHEN v_act = 'reject' THEN '. 관련 교사가 거절했습니다.' ELSE '. 승인 담당이 반려했습니다.' END);
  ELSIF v_status = 'withdrawn' THEN
    PERFORM workhub_private.t2_notify(rq, v_others, 'withdrawn', '시간표 변경 요청이 철회되었습니다', workhub_private.t2_req_summary(rq, v_tz) || '. 요청한 선생님이 철회했습니다.');
  ELSIF v_status = 'applied' THEN
    PERFORM workhub_private.t2_notify(rq, ARRAY[rq.requester_membership_id] || v_others, 'applied', '시간표 변경이 반영되었습니다',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 공개 시간표에 반영했습니다.');
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.exchange_' || lower(v_act), 'timetable_exchange_request', rq.id, rq.version, 'school', p_key,
    jsonb_build_object('state', v_status));
  RETURN jsonb_build_object('requestKey', p_key, 'commandHash', p_hash, 'kind', 'action', 'entityId', rq.id, 'version', rq.version, 'status', v_status,
                            'recordedAt', workhub_private.t2_ts(v_at), 'changedLessons', v_changed);
END $t3body$);
END $hook$;
DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_req_view';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'c66b0e3a5f991e765af5c4ad7a6b2e89' THEN RAISE EXCEPTION 'T3: t2_req_view 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
DECLARE v_state text; v_parts jsonb; v_all boolean; v_viewer boolean := r.requester_account_id = p_ctx.account_id; v_actions jsonb := '[]'::jsonb;
BEGIN
  v_state := CASE WHEN r.state NOT IN ('awaiting_consent','awaiting_approval') THEN r.state WHEN r.expires_at <= p_at THEN 'expired'
                  WHEN workhub_private.t2_req_stale(r.id) THEN 'stale' ELSE r.state END;
  SELECT jsonb_agg(jsonb_build_object('id', p.membership_id, 'name', p.name, 'response', p.response,
                                      'respondedAt', CASE WHEN p.responded_at IS NULL THEN 'null'::jsonb ELSE to_jsonb(workhub_private.t2_ts(p.responded_at)) END)
                   ORDER BY p.membership_id), bool_and(p.response = 'accepted')
    INTO v_parts, v_all FROM workhub.timetable_exchange_participants p WHERE p.request_id = r.id;
  IF v_state = 'awaiting_consent' AND EXISTS (SELECT 1 FROM workhub.timetable_exchange_participants p
                                              WHERE p.request_id = r.id AND p.membership_id = p_ctx.membership_id AND p.response = 'pending') THEN
    v_actions := v_actions || '["accept","reject"]'::jsonb;
  END IF;
  IF v_state IN ('awaiting_consent','awaiting_approval') AND v_viewer THEN v_actions := v_actions || '["withdraw"]'::jsonb; END IF;
  IF v_state = 'awaiting_approval' AND v_all AND NOT v_viewer AND workhub_private.p5_manager(p_ctx) THEN
    v_actions := v_actions || '["approve","rejectApproval"]'::jsonb;
  END IF;
  IF EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=p_ctx.school_id) THEN
    IF workhub_private.t3_ready(p_ctx) IS NOT NULL THEN v_actions:='[]';
    ELSIF EXISTS(SELECT 1 FROM workhub.timetable_exchange_participants p JOIN workhub.memberships m ON m.school_id=p.school_id AND m.id=p.membership_id WHERE p.request_id=r.id AND m.account_id=p_ctx.account_id) THEN v_actions:=v_actions-'approve'-'rejectApproval';END IF;
  END IF;
  RETURN jsonb_build_object('id', r.id, 'version', r.version, 'proposalHash', r.proposal_hash, 'state', v_state, 'kind', r.kind,
    'requester', jsonb_build_object('id', r.requester_membership_id, 'name', r.requester_name), 'requesterIsViewer', v_viewer,
    'createdAt', workhub_private.t2_ts(r.created_at), 'expiresAt', workhub_private.t2_ts(r.expires_at), 'reason', r.reason,
    'changes', r.changes, 'participants', COALESCE(v_parts, '[]'::jsonb), 'actions', v_actions);
END $t3body$);
END $hook$;

DO $hook$ DECLARE f regprocedure;body text;definition text;BEGIN
 SELECT oid::regprocedure,prosrc,pg_get_functiondef(oid) INTO f,body,definition FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname='t2_submit';
 IF f IS NULL OR md5(replace(body,chr(13),''))<>'2db484151e35b4a087f4cb45b2e04a35' THEN RAISE EXCEPTION 'T3: t2_submit 원문이 확정 T2와 다릅니다.';END IF;
 EXECUTE replace(definition,body,$t3body$
DECLARE p workhub.timetable_previews; x jsonb; v_at timestamptz; rq workhub.timetable_exchange_requests; v_changes jsonb; v_all text[]; v_tz text := p_ctx.school_timezone;
BEGIN
  PERFORM workhub_private.t2_exchange_input(c #> '{preview,input}');
  SELECT * INTO p FROM workhub.timetable_previews WHERE id = c #>> '{preview,previewId}' AND school_id = p_ctx.school_id
     AND membership_id = p_ctx.membership_id AND account_id = p_ctx.account_id AND kind = 'exchange';
  IF p.id IS NULL OR p.preview_hash <> c #>> '{preview,previewHash}' OR to_jsonb(workhub_private.t2_ts(p.expires_at)) <> c #> '{preview,expiresAt}'
     OR p.input <> c #> '{preview,input}' THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  IF p.expires_at <= clock_timestamp() THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  PERFORM workhub_private.t2_lock(p_ctx.school_id);
  IF EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=p_ctx.school_id) THEN PERFORM workhub_private.t3_lock_members(p_ctx.school_id);END IF;
  x := workhub_private.t2_exchange_calc(p_ctx, p.input, p.created_at);
  IF workhub_private.p2_sha(workhub_private.t2_exchange_body(p.input, x)) <> p.preview_hash THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF jsonb_array_length(x -> 'blockers') > 0 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_at := workhub_private.t2_now();
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'changes') ch WHERE (ch #>> '{before,time,startsAt}')::timestamptz <= v_at
                                                                     OR (ch #>> '{after,time,startsAt}')::timestamptz <= v_at)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(x -> 'changes') ch WHERE workhub_private.t2_lesson_busy(p_ctx.school_id, ch #>> '{after,id}', v_at)) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- 요청에 고정하는 값: 요청 버튼은 끈다(전후 같은 값). 동의는 이 값의 지문(proposalHash)에 묶인다.
  v_changes := (SELECT jsonb_agg(jsonb_build_object('before', ch -> 'before' || '{"canRequest":false}'::jsonb,
                                                    'after', ch -> 'after' || '{"canRequest":false}'::jsonb) ORDER BY o)
                  FROM jsonb_array_elements(x -> 'changes') WITH ORDINALITY z(ch, o));
  v_all := ARRAY(SELECT t ->> 'id' FROM jsonb_array_elements(x -> 'participants') t);
  rq.id := gen_random_uuid()::text; rq.school_id := p_ctx.school_id; rq.kind := p.input ->> 'kind';
  rq.requester_membership_id := p_ctx.membership_id; rq.requester_account_id := p_ctx.account_id;
  rq.requester_name := (SELECT t ->> 'name' FROM jsonb_array_elements(x -> 'participants') t WHERE t ->> 'id' = p_ctx.membership_id);
  rq.reason := p.input ->> 'reason'; rq.changes := v_changes;
  rq.proposal_hash := workhub_private.p2_sha(jsonb_build_object('kind', rq.kind, 'reason', rq.reason, 'changes', v_changes));
  SELECT min(workhub_private.t2_day(t, v_tz)), max(workhub_private.t2_day(t, v_tz)), min(t) INTO rq.first_day, rq.last_day, rq.expires_at
    FROM (SELECT (ch #>> '{before,time,startsAt}')::timestamptz AS t FROM jsonb_array_elements(v_changes) ch
          UNION ALL SELECT (ch #>> '{after,time,startsAt}')::timestamptz FROM jsonb_array_elements(v_changes) ch) z;
  rq.state := CASE WHEN v_all <@ ARRAY[p_ctx.membership_id] THEN 'awaiting_approval' ELSE 'awaiting_consent' END;
  rq.version := 1; rq.preview_id := p.id; rq.created_at := v_at; rq.updated_at := v_at;
  INSERT INTO workhub.timetable_exchange_requests SELECT rq.*;
  INSERT INTO workhub.timetable_exchange_lessons (school_id, request_id, lesson_id, before_version)
  SELECT p_ctx.school_id, rq.id, ch #>> '{before,id}', (ch #>> '{before,version}')::integer FROM jsonb_array_elements(v_changes) ch;
  INSERT INTO workhub.timetable_exchange_participants (school_id, request_id, membership_id, name, response, responded_at)
  SELECT p_ctx.school_id, rq.id, t ->> 'id', t ->> 'name', CASE WHEN t ->> 'id' = p_ctx.membership_id THEN 'accepted' ELSE 'pending' END,
         CASE WHEN t ->> 'id' = p_ctx.membership_id THEN v_at END
    FROM jsonb_array_elements(x -> 'participants') t;
  IF rq.state = 'awaiting_consent' THEN
    PERFORM workhub_private.t2_notify(rq, array_remove(v_all, p_ctx.membership_id), 'consent', '시간표 변경 동의 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 동의 또는 거절해 주세요.');
  ELSE
    PERFORM workhub_private.t2_notify(rq, workhub_private.t2_approver_ids(rq, p_ctx.school_today), 'approval', '시간표 변경 승인 요청',
                                      workhub_private.t2_req_summary(rq, v_tz) || '. 승인 또는 반려해 주세요.');
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.exchange_submit', 'timetable_exchange_request', rq.id, 1, 'school', p_key,
    jsonb_build_object('kind', rq.kind, 'lessons', (SELECT jsonb_agg(ch #>> '{before,id}') FROM jsonb_array_elements(v_changes) ch), 'state', rq.state));
  RETURN jsonb_build_object('requestKey', p_key, 'commandHash', p_hash, 'kind', 'submit', 'entityId', rq.id, 'version', 1, 'status', rq.state,
                            'recordedAt', workhub_private.t2_ts(v_at), 'changedLessons', '[]'::jsonb);
END $t3body$);
END $hook$;
CREATE FUNCTION workhub_private.t3_lesson_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN
 -- 기존 T2 공개/교환/학사 변경도 진행 중 T3 요청을 몰래 덮어쓸 수 없다.
 IF EXISTS(SELECT 1 FROM workhub.timetable_interventions r WHERE r.school_id=OLD.school_id AND workhub_private.t3_live(r,workhub_private.t2_now())
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.plan->'sources') x WHERE x->>'id'=OLD.id)) THEN RAISE EXCEPTION 'CONFLICT';END IF;
 RETURN NEW;END $$;
CREATE TRIGGER t3_pending_lesson_guard BEFORE UPDATE ON workhub.timetable_lessons FOR EACH ROW
 WHEN(OLD IS DISTINCT FROM NEW) EXECUTE FUNCTION workhub_private.t3_lesson_guard();
CREATE FUNCTION workhub_private.t3_school_day_notify() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE sid text;m text;lid text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM workhub.timetable_intervention_policies WHERE school_id=NEW.school_id AND active) THEN RETURN NEW;END IF;
 SELECT x->>'id' INTO lid FROM jsonb_array_elements(NEW.changed_lessons) x ORDER BY x->>'id' LIMIT 1;
 INSERT INTO workhub.timetable_intervention_sources(school_id,kind,entity_id,date,lesson_id) VALUES(NEW.school_id,'school_day',NEW.id,(NEW.input->>'date')::date,lid) RETURNING id INTO sid;
 IF NOT workhub_private.t2_installed('T2-02') OR workhub_private.p3_messaging_reason(NEW.school_id)<>'ready' THEN RETURN NEW;END IF;
 FOR m IN SELECT DISTINCT t FROM jsonb_array_elements(NEW.changed_lessons) x JOIN workhub.timetable_lessons l ON l.school_id=NEW.school_id AND l.id=x->>'id' CROSS JOIN unnest(l.teacher_ids) t LOOP
 IF workhub_private.t3_member(NEW.school_id,m) THEN PERFORM workhub_private.p3_notify(NEW.school_id,m,'학사 변경 알림',
 (NEW.input->>'date')||' '||CASE WHEN NEW.input->>'kind'='closure' THEN '휴업' ELSE '특별 일과' END||': '||(NEW.input->>'reason'),'timetable',sid,'t3-day:'||NEW.id);END IF;END LOOP;
 RETURN NEW;END $$;
CREATE TRIGGER t3_school_day_notification AFTER INSERT ON workhub.timetable_school_day_changes FOR EACH ROW EXECUTE FUNCTION workhub_private.t3_school_day_notify();
DO $$ DECLARE f regprocedure;BEGIN
 FOR f IN SELECT oid::regprocedure FROM pg_proc WHERE pronamespace='workhub_private'::regnamespace AND proname LIKE 't3\_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f);END LOOP;END $$;
INSERT INTO workhub_private.t3_installs(batch,release) VALUES('T3-03','2026-10-20.1');
COMMIT;
