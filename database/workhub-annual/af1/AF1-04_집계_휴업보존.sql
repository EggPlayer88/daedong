-- AF1-04: 공식 휴업 보강 집계 제외와 빈 날 휴업 해제 연결. 기존 확정본은 보존한다.
BEGIN;
SET LOCAL lock_timeout='5s';
DO $af$ DECLARE f regprocedure:='workhub_private.t3_summary(workhub_private.actor_context)'::regprocedure; b text; d text; BEGIN SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f; IF md5(b)<>'7352b781c95fd6e3995de28ef5b3a2ff' THEN RAISE EXCEPTION 'AF1: t3_summary 원문 불일치';END IF; EXECUTE replace(d,b,$body$
DECLARE at timestamptz:=workhub_private.t2_now();items jsonb:='[]';r workhub.timetable_interventions;e workhub.timetable_exchange_requests;l workhub.timetable_lessons;a jsonb;k text;day date;
BEGIN
 IF workhub_private.t3_ready(ctx) IS NULL THEN
 FOR r IN SELECT * FROM workhub.timetable_interventions z WHERE z.school_id=ctx.school_id AND workhub_private.t3_visible(z,ctx) AND workhub_private.t3_live(z,at) LOOP
 a:=workhub_private.t3_actions(r,ctx,at);k:=CASE WHEN a?'accept' THEN 'consent' WHEN a?'approve' THEN 'approval' END;
 IF k IS NOT NULL THEN items:=items||jsonb_build_array(jsonb_build_object('id','t3-'||r.id,'kind',k,'label',r.plan#>>'{changes,0,after,label}',
 'date',workhub_private.t2_day((r.plan#>>'{rows,0,starts_at}')::timestamptz,ctx.school_timezone),'lessonId',r.plan#>>'{sources,0,id}','requestId',r.id));END IF;END LOOP;
 FOR l IN SELECT * FROM workhub.timetable_lessons z WHERE z.school_id=ctx.school_id AND z.state='cancelled' AND z.changed_by IN('school_day','intervention')
 AND workhub_private.af1_makeup_needed(z) AND(workhub_private.p5_manager(ctx) OR ctx.membership_id=ANY(z.teacher_ids)) AND NOT EXISTS(SELECT 1 FROM workhub.timetable_makeup_links m WHERE m.school_id=ctx.school_id AND m.original_lesson_id=z.id)
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
END $body$);END $af$;
DO $af$ DECLARE f regprocedure:='workhub_private.t3_closed(text,date,jsonb,text)'::regprocedure; b text; d text; BEGIN SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f; IF md5(b)<>'8e84785623fe7e6f55f8d6276aa8328c' THEN RAISE EXCEPTION 'AF1: t3_closed 원문 불일치';END IF; EXECUTE replace(d,b,$body$
 SELECT jsonb_array_length(workhub_private.t2_closed_days(p_school,p_day,p_day+1))>0 OR EXISTS(
 SELECT 1 FROM workhub.timetable_school_day_changes c WHERE c.school_id=p_school AND c.input->>'kind'='closure'
 AND (c.input->>'date')::date=p_day AND c.id IS DISTINCT FROM p_ignore
 AND NOT EXISTS(SELECT 1 FROM workhub.annual_empty_releases ar WHERE ar.school_id=c.school_id AND ar.change_id=c.id)
 AND NOT EXISTS(SELECT 1 FROM workhub.timetable_reopened_days r WHERE r.school_id=p_school AND r.school_day_change_id=c.id)
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_groups) g WHERE c.input->'groupIds' ? (g->>'id')))
$body$);END $af$;
DO $af$ DECLARE f regprocedure:='workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone)'::regprocedure; b text; d text; BEGIN SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f; IF md5(b)<>'4075cb7e7e842b9141d24b329a642e97' THEN RAISE EXCEPTION 'AF1: t2_publish_plan 원문 불일치';END IF; EXECUTE replace(d,b,$body$
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
 AND NOT EXISTS(SELECT 1 FROM workhub.annual_empty_releases ar WHERE ar.school_id=c.school_id AND ar.change_id=c.id)
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
END $body$);END $af$;
DO $af$ DECLARE f regprocedure:='workhub_private.t3_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone,text)'::regprocedure; b text; d text; BEGIN SELECT replace(prosrc,chr(13),''),replace(pg_get_functiondef(oid),chr(13),'') INTO b,d FROM pg_proc WHERE oid=f; IF md5(b)<>'d1ab6c40637ff5280267e6173da51210' THEN RAISE EXCEPTION 'AF1: t3_plan 원문 불일치';END IF; EXECUTE replace(d,b,$body$
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
 IF k='makeup' AND NOT workhub_private.af1_makeup_needed(l) THEN RAISE EXCEPTION 'CONFLICT';END IF;
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
END $body$);END $af$;
INSERT INTO workhub_private.af1_installs(batch) VALUES('AF1-04');
COMMIT;
