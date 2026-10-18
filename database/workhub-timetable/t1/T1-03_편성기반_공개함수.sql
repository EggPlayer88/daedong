-- ============================================================================
-- T1-03  시간표 1단계 — 공개 함수 7개 (비활성 설치)
--
-- ▣ 공개 함수(authenticated 만, 첫 인자 p_member_id — 앱 createScopedRpc 가 붙인다). 봉투 {contract, schoolId, memberId, data | error:{code}}
--     timetable.v1             workhub_timetable_readiness · workhub_timetable_get · workhub_timetable_save_draft
--     timetable.preparation.v1 workhub_timetable_preparation_get · workhub_timetable_preparation_execute
--     timetable.setup.v1       workhub_timetable_setup_get · workhub_timetable_setup_execute   (새 계약 — 공간 정원 · 수업 연결 입력, T1_설계_계약.md 3절)
-- ▣ 켜는 조건: 학교에 수업(P5, teaching)이 준비(ready)이고 timetable 모듈이 켜져 있을 때만(T1-05). 그 전에는
--     readiness = {available:false, reason:'not_installed'}, 나머지는 NOT_READY(요청 원장 복구 조회만 예외).
-- ▣ 권한(정책 4): 담당자 · 확정자 = year.manage(P5 와 같은 기준). 그 밖의 사람은 readiness 'not_allowed', get 은 빈 화면 값,
--     준비 · 입력 조회와 쓰기는 FORBIDDEN. 새 권한을 만들지 않는다.
-- ▣ 이 단계의 get.lessons 는 항상 [] 이다(날짜별 수업은 T2). 일반 교사 공개도 T2 에서 정한다.
-- ▣ 전제: T1-01 · T1-02(2026-10-18.1). 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t1_installs') IS NULL THEN RAISE EXCEPTION 'T1 중단: T1-01 · T1-02(2026-10-18.1)를 먼저 적용해 주세요.'; END IF;
  IF (SELECT count(*) FROM workhub_private.t1_installs WHERE batch IN ('T1-01','T1-02') AND release = '2026-10-18.1') <> 2 THEN
    RAISE EXCEPTION 'T1 중단: T1-01 · T1-02(2026-10-18.1)를 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-03') THEN
    RAISE EXCEPTION 'T1 중단: T1-03 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_%') THEN
    RAISE EXCEPTION 'T1 중단: 같은 이름의 공개 함수(workhub_timetable_*)가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 공통 — 준비 상태 · 요청 원장 · 접수증
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_ready(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.t1_installed('T1-03') AND workhub_private.p2_module_active(p_school, 'timetable') AND workhub_private.p5_ready(p_school)
$$;

-- 같은 (학교, 소속, 종류, 요청 번호)를 한 줄로 세우고, 이미 반영된 요청이면 그 접수증을 돌려준다(내용이 다르면 IDEMPOTENCY_CONFLICT).
CREATE FUNCTION workhub_private.t1_claim(p_ctx workhub_private.actor_context, p_op text, p_key text, p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.timetable_requests;
BEGIN
  IF NOT workhub_private.p7_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('t1req' || chr(31) || p_ctx.school_id || chr(31) || p_ctx.membership_id || chr(31) || p_op
                                                 || chr(31) || p_key, 0));
  SELECT * INTO r FROM workhub.timetable_requests
   WHERE school_id = p_ctx.school_id AND membership_id = p_ctx.membership_id AND op = p_op AND request_key = p_key;
  IF r.request_key IS NULL THEN RETURN NULL; END IF;
  IF r.command_hash <> p_hash OR r.account_id <> p_ctx.account_id THEN RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT'; END IF;
  RETURN r.response;
END $$;

CREATE FUNCTION workhub_private.t1_record(p_ctx workhub_private.actor_context, p_op text, p_key text, p_hash text, p_response jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO workhub.timetable_requests (school_id, membership_id, account_id, op, request_key, command_hash, response)
  VALUES (p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_op, p_key, p_hash, p_response)
$$;

-- 준비 접수증: 원장에는 기준판 ID 만 두고, 돌려줄 때 고칠 수 없는 기준판 본문을 붙인다(재전송 · 복구도 같은 본문).
CREATE FUNCTION workhub_private.t1_prep_receipt(p jsonb) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (p - 'basisId') || jsonb_build_object('basis', COALESCE((SELECT b.basis FROM workhub.timetable_basis_revisions b WHERE b.id = p ->> 'basisId'), 'null'::jsonb))
$$;

-- 대상 학기의 원본 전체(앱 PreparationSource). 학교 잠금 안에서 원본 판을 매긴다.
CREATE FUNCTION workhub_private.t1_source(p_ctx workhub_private.actor_context, p_term text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE b jsonb; v_rev integer; d workhub.timetable_prep_drafts;
BEGIN
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  b := workhub_private.t1_build(p_ctx.school_id, p_term, p_ctx.school_today);
  -- 브라우저 편성 한도를 넘는 학교는 잘라서 보내지 않는다
  IF jsonb_array_length(b #> '{core,resources}') > workhub_private.t1_limit('maxResources')
     OR jsonb_array_length(b #> '{core,courses}') > workhub_private.t1_limit('maxLessons') THEN
    RAISE EXCEPTION 'QUERY_FAILED';
  END IF;
  -- 서로 다른 종류의 자원이 같은 ID 를 가지면(교사 소속 ID · 학급 ID · 공간 ID 가 우연히 같음) 앱이 원본을 읽지 못한다 → 잘못 합치지 않고 멈춘다
  IF (SELECT count(DISTINCT r ->> 'id') FROM jsonb_array_elements(b #> '{core,resources}') r) <> jsonb_array_length(b #> '{core,resources}') THEN
    RAISE EXCEPTION 'QUERY_FAILED';
  END IF;
  v_rev :=workhub_private.t1_mark(p_ctx.school_id, p_term, b ->> 'fingerprint');
  SELECT * INTO d FROM workhub.timetable_prep_drafts WHERE school_id = p_ctx.school_id AND term_id = p_term;
  RETURN jsonb_build_object('build', b, 'revision', v_rev, 'source', (b -> 'core') || jsonb_build_object(
    'sourceRevision', v_rev, 'sourceFingerprint', b ->> 'fingerprint', 'canEdit', true, 'canConfirm', true,
    'savedDraft', CASE WHEN d.id IS NULL THEN 'null'::jsonb
                       ELSE jsonb_build_object('id', d.id, 'revision', d.revision, 'sourceFingerprint', d.source_fingerprint, 'draft', d.draft) END));
END $$;

-- ----------------------------------------------------------------------------
-- 2. timetable.v1 — readiness · get · save_draft
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_readiness(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_term text;
BEGIN
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RETURN jsonb_build_object('available', false, 'reason', 'not_installed'); END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RETURN jsonb_build_object('available', false, 'reason', 'not_allowed'); END IF;
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  IF v_term IS NULL OR (SELECT current_timetable_basis_id FROM workhub.terms WHERE id = v_term) IS NULL THEN
    RETURN jsonb_build_object('available', false, 'reason', 'basis_missing');
  END IF;
  RETURN jsonb_build_object('available', true);
END $$;

CREATE FUNCTION workhub_private.t1_get(p_ctx workhub_private.actor_context, p_week date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_term text; b workhub.timetable_basis_revisions; v_empty jsonb;
BEGIN
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_week IS NULL OR extract(isodow FROM p_week) <> 1 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_empty := jsonb_build_object('basis', NULL, 'canDesign', false, 'canSave', false, 'drafts', '[]'::jsonb,
                                'weekStart', to_char(p_week, 'YYYY-MM-DD'), 'lessons', '[]'::jsonb);
  IF NOT workhub_private.p5_manager(p_ctx) THEN RETURN v_empty; END IF;
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  SELECT br.* INTO b FROM workhub.terms t JOIN workhub.timetable_basis_revisions br
      ON br.school_id = t.school_id AND br.id = t.current_timetable_basis_id AND br.term_id = t.id
   WHERE t.school_id = p_ctx.school_id AND t.id = v_term;
  IF b.id IS NULL THEN RETURN v_empty; END IF;
  RETURN jsonb_build_object('basis', b.basis, 'canDesign', true, 'canSave', true, 'weekStart', to_char(p_week, 'YYYY-MM-DD'), 'lessons', '[]'::jsonb,
    'drafts', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'version', 1, 'title', x.title, 'basisId', x.basis_id, 'basisRevision', x.basis_revision,
                                                            'sourceFingerprint', x.source_fingerprint, 'conditions', x.conditions, 'placements', x.placements)
                                         ORDER BY x.created_at DESC, x.id)
                          FROM (SELECT * FROM workhub.timetable_drafts d WHERE d.school_id = p_ctx.school_id AND d.basis_id = b.id
                                 ORDER BY d.created_at DESC, d.id LIMIT workhub_private.t1_limit('drafts')) x), '[]'::jsonb));
END $$;

-- 편성 초안 저장: 현재 기준판의 판 · 지문 그대로, 학교 필수조건(fixed · unavailable)을 빼지 않고, 배치가 모든 필수조건을 통과해야 한다(앱 timetableSaveInput).
CREATE FUNCTION workhub_private.t1_save_draft(p_ctx workhub_private.actor_context, i jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(i); v jsonb; v_term text; b workhub.timetable_basis_revisions; cand jsonb; v_id text;
BEGIN
  v := workhub_private.t1_claim(p_ctx, 'save_draft', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT workhub_private.p2_exact(i, ARRAY['basisId','basisRevision','sourceFingerprint','title','conditions','placements'])
     OR NOT workhub_private.p7_id(i -> 'basisId') OR NOT workhub_private.p7_pos(i -> 'basisRevision') OR NOT workhub_private.p5_hash(i -> 'sourceFingerprint')
     OR NOT workhub_private.p7_text(i -> 'title', 100, true) OR NOT workhub_private.p2_exact(i -> 'conditions', ARRAY['fixed','unavailable','preferences']) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  SELECT br.* INTO b FROM workhub.terms t JOIN workhub.timetable_basis_revisions br
      ON br.school_id = t.school_id AND br.id = t.current_timetable_basis_id AND br.term_id = t.id
   WHERE t.school_id = p_ctx.school_id AND t.id = v_term;
  IF b.id IS NULL OR b.id <> i ->> 'basisId' OR to_jsonb(b.revision) <> i -> 'basisRevision' OR b.source_fingerprint <> i ->> 'sourceFingerprint' THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  cand := b.basis || jsonb_build_object('fixed', i #> '{conditions,fixed}', 'unavailable', i #> '{conditions,unavailable}',
                                        'preferences', i #> '{conditions,preferences}');
  IF cardinality(workhub_private.t1_basis_issues(cand)) > 0
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(b.basis -> 'fixed') x WHERE NOT (cand -> 'fixed') @> jsonb_build_array(x))
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(b.basis -> 'unavailable') x WHERE NOT (cand -> 'unavailable') @> jsonb_build_array(x))
     OR cardinality(workhub_private.t1_placement_issues(cand, i -> 'placements')) > 0 THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  INSERT INTO workhub.timetable_drafts (school_id, term_id, basis_id, basis_revision, source_fingerprint, title, conditions, placements,
                                        created_by_membership_id, request_key)
  VALUES (p_ctx.school_id, b.term_id, b.id, b.revision, b.source_fingerprint, i ->> 'title', i -> 'conditions', i -> 'placements', p_ctx.membership_id, p_key)
  RETURNING id INTO v_id;
  PERFORM workhub_private.write_audit(p_ctx, 'timetable.draft_save', 'timetable_draft', v_id, 1, 'school', p_key,
    jsonb_build_object('basisId', b.id, 'basisRevision', b.revision, 'placements', jsonb_array_length(i -> 'placements')));
  v := jsonb_build_object('requestKey', p_key, 'draftId', v_id, 'version', 1, 'basisRevision', b.revision);
  PERFORM workhub_private.t1_record(p_ctx, 'save_draft', p_key, v_hash, v);
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 3. timetable.preparation.v1 — 원본 조회 · 준비 초안 저장 · 기준판 확정
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_prep_get(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_term text;
BEGIN
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  IF v_term IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  RETURN workhub_private.t1_source(p_ctx, v_term) -> 'source';
END $$;

-- 앱 preparationInput 의 모양(초안 본문은 원본과 대조하며 따로 본다)
CREATE FUNCTION workhub_private.t1_prep_input_ok(i jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT workhub_private.p2_exact(i, ARRAY['kind','sourceRevision','sourceFingerprint','termId','draftId','expectedDraftRevision','draft'])
     AND jsonb_typeof(i -> 'kind') = 'string' AND i ->> 'kind' IN ('save','confirm')
     AND workhub_private.p7_pos(i -> 'sourceRevision') AND workhub_private.p5_hash(i -> 'sourceFingerprint') AND workhub_private.p7_id(i -> 'termId')
     AND ((i -> 'draftId' = 'null'::jsonb AND i -> 'expectedDraftRevision' = 'null'::jsonb)
          OR (workhub_private.p7_id(i -> 'draftId') AND workhub_private.p7_pos(i -> 'expectedDraftRevision')))
$$;

CREATE FUNCTION workhub_private.t1_prep_execute(p_ctx workhub_private.actor_context, i jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(i); v jsonb; v_term text; t workhub.terms; s jsonb; src jsonb; d workhub.timetable_prep_drafts;
        v_draft_id text; v_rev integer; v_basis jsonb; v_bid text; v_brev integer;
BEGIN
  v := workhub_private.t1_claim(p_ctx, 'preparation', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN workhub_private.t1_prep_receipt(v); END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT workhub_private.t1_prep_input_ok(i) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 학교 잠금 → 대상 학기 잠금 → 원본을 다시 만들어 앱이 본 판 · 지문과 비교
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  IF v_term IS NULL OR v_term <> i ->> 'termId' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  SELECT * INTO t FROM workhub.terms WHERE school_id = p_ctx.school_id AND id = v_term FOR UPDATE;
  s := workhub_private.t1_source(p_ctx, v_term);
  src := s -> 'source';
  IF src ->> 'sourceFingerprint' <> i ->> 'sourceFingerprint' OR (s -> 'revision') <> (i -> 'sourceRevision') THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  IF NOT workhub_private.t1_draft_ok(i -> 'draft', src) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 준비 초안 판 비교(학기마다 1개)
  SELECT * INTO d FROM workhub.timetable_prep_drafts WHERE school_id = p_ctx.school_id AND term_id = v_term FOR UPDATE;
  IF i -> 'draftId' = 'null'::jsonb THEN
    IF d.id IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_draft_id := gen_random_uuid()::text; v_rev := 1;
  ELSE
    IF d.id IS NULL OR d.id <> i ->> 'draftId' OR to_jsonb(d.revision) <> i -> 'expectedDraftRevision' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    v_draft_id := d.id; v_rev := d.revision + 1;
  END IF;
  -- 확정: 앱 compilePreparation 과 같은 기준판 · 같은 확정 조건 6개
  IF i ->> 'kind' = 'confirm' THEN
    v_bid := gen_random_uuid()::text;
    SELECT COALESCE(max(revision), 0) + 1 INTO v_brev FROM workhub.timetable_basis_revisions WHERE school_id = p_ctx.school_id AND term_id = v_term;
    v_basis := workhub_private.t1_compile(src, i -> 'draft', v_bid, v_brev);
    IF v_basis IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END IF;
  IF d.id IS NULL THEN
    INSERT INTO workhub.timetable_prep_drafts (id, school_id, term_id, revision, source_fingerprint, draft, updated_by_membership_id)
    VALUES (v_draft_id, p_ctx.school_id, v_term, 1, i ->> 'sourceFingerprint', i -> 'draft', p_ctx.membership_id);
  ELSE
    UPDATE workhub.timetable_prep_drafts SET revision = v_rev, source_fingerprint = i ->> 'sourceFingerprint', draft = i -> 'draft',
           updated_by_membership_id = p_ctx.membership_id, updated_at = clock_timestamp()
     WHERE id = d.id;
  END IF;
  INSERT INTO workhub.timetable_prep_draft_revisions (school_id, draft_id, revision, kind, source_fingerprint, draft, membership_id, request_key)
  VALUES (p_ctx.school_id, v_draft_id, v_rev, i ->> 'kind', i ->> 'sourceFingerprint', i -> 'draft', p_ctx.membership_id, p_key);
  IF i ->> 'kind' = 'confirm' THEN
    INSERT INTO workhub.timetable_basis_revisions (id, school_id, term_id, revision, source_fingerprint, basis, prep_draft_id, prep_draft_revision,
                                                   created_by_membership_id, request_key)
    VALUES (v_bid, p_ctx.school_id, v_term, v_brev, i ->> 'sourceFingerprint', v_basis, v_draft_id, v_rev, p_ctx.membership_id, p_key);
    -- 학기의 현재 기준판(R0 처분표: 학기 잠금 + 판 증가). 공개 시간표 · 기존 편성 초안은 건드리지 않는다.
    UPDATE workhub.terms SET current_timetable_basis_id = v_bid, version = version + 1, updated_at = clock_timestamp() WHERE id = t.id;
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, CASE i ->> 'kind' WHEN 'confirm' THEN 'timetable.prep_confirm' ELSE 'timetable.prep_save' END,
    'timetable_prep_draft', v_draft_id, v_rev, 'school', p_key,
    jsonb_build_object('termId', v_term, 'sourceRevision', s -> 'revision', 'basisId', v_bid, 'basisRevision', v_brev,
                       'plans', jsonb_array_length(i #> '{draft,plans}'), 'slots', jsonb_array_length(i #> '{draft,slots}')));
  v := jsonb_build_object('requestKey', p_key, 'kind', i ->> 'kind', 'draftId', v_draft_id, 'draftRevision', v_rev,
                          'sourceFingerprint', i ->> 'sourceFingerprint', 'basisId', v_bid);
  PERFORM workhub_private.t1_record(p_ctx, 'preparation', p_key, v_hash, v);
  RETURN workhub_private.t1_prep_receipt(v);
END $$;

-- ----------------------------------------------------------------------------
-- 4. timetable.setup.v1 — 담당자 입력(공간 정원 · 수업 연결)과 미완성 조회
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_setup_get(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_term text; s jsonb; b jsonb; t workhub.terms;
BEGIN
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  IF v_term IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO t FROM workhub.terms WHERE id = v_term;
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  b := workhub_private.t1_build(p_ctx.school_id, v_term, p_ctx.school_today);
  RETURN jsonb_build_object(
    'termId', v_term, 'termLabel', b #> '{core,termLabel}', 'firstDay', b #> '{core,firstDay}', 'lastDay', b #> '{core,lastDay}', 'referenceDay', b -> 'refDay',
    'sourceRevision', workhub_private.t1_mark(p_ctx.school_id, v_term, b ->> 'fingerprint'), 'sourceFingerprint', b -> 'fingerprint', 'canEdit', true,
    'spaces', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'label', x.label, 'capacity', x.capacity, 'version', x.version)
                                         ORDER BY x.kind, x.label COLLATE "C", x.id)
                          FROM workhub.timetable_spaces x WHERE x.school_id = p_ctx.school_id AND x.removed_at IS NULL), '[]'::jsonb),
    'classes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', yc.id, 'label', yc.name, 'grade', yc.grade) ORDER BY yc.sort_order, yc.id)
                           FROM workhub.year_classes yc WHERE yc.school_id = p_ctx.school_id AND yc.academic_year_id = t.academic_year_id
                            AND yc.removed_at IS NULL), '[]'::jsonb),
    'courses', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                  'id', c ->> 'id', 'label', c ->> 'label', 'inTimetable', (c ->> 'active')::boolean AND (c ->> 'idOk')::boolean,
                                  'teacherLabels', COALESCE((SELECT jsonb_agg(k -> 'label' ORDER BY o) FROM jsonb_array_elements(c -> 'teachers') WITH ORDINALITY z(k, o)), '[]'::jsonb),
                                  'studentCount', c -> 'students',
                                  'link', CASE WHEN c -> 'link' = 'null'::jsonb THEN 'null'::jsonb ELSE jsonb_build_object(
                                            'version', c #> '{link,version}', 'studentGroup', c #> '{link,studentGroup}',
                                            'classIds', COALESCE((SELECT jsonb_agg(k -> 'id' ORDER BY o) FROM jsonb_array_elements(c -> 'classes') WITH ORDINALITY z(k, o)), '[]'::jsonb),
                                            'spaceIds', COALESCE((SELECT jsonb_agg(k -> 'id' ORDER BY o) FROM jsonb_array_elements(c -> 'spaces') WITH ORDINALITY z(k, o)), '[]'::jsonb)) END)
                                ORDER BY o)
                           FROM jsonb_array_elements(b -> 'courses') WITH ORDINALITY z(c, o)), '[]'::jsonb),
    'findings', COALESCE((SELECT jsonb_agg(f - 'blocking' || jsonb_build_object('blocksConfirm', f -> 'blocking') ORDER BY o)
                            FROM jsonb_array_elements(b -> 'findings') WITH ORDINALITY z(f, o)), '[]'::jsonb));
END $$;

-- 입력 명령 모양(앱 쪽 parser 가 생기기 전까지 이 함수가 계약의 기준이다 — T1_설계_계약.md 3절)
CREATE FUNCTION workhub_private.t1_setup_shape(c jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE c ->> 'kind'
    WHEN 'space_save' THEN workhub_private.p2_exact(c, ARRAY['kind','spaceId','expectedVersion','input'])
      AND ((c -> 'spaceId' = 'null'::jsonb AND c -> 'expectedVersion' = 'null'::jsonb)
           OR (workhub_private.p7_id(c -> 'spaceId') AND workhub_private.p7_pos(c -> 'expectedVersion')))
      AND workhub_private.p2_exact(c -> 'input', ARRAY['kind','label','capacity'])
      AND jsonb_typeof(c #> '{input,kind}') = 'string' AND c #>> '{input,kind}' IN ('room','equipment')
      AND workhub_private.p7_text(c #> '{input,label}', 100, true) AND (c #>> '{input,label}') !~ '[\x01-\x1f\x7f]'
      AND (c #> '{input,capacity}' = 'null'::jsonb OR workhub_private.p2_int(c #> '{input,capacity}', 1, 1000))
    WHEN 'space_remove' THEN workhub_private.p2_exact(c, ARRAY['kind','spaceId','expectedVersion'])
      AND workhub_private.p7_id(c -> 'spaceId') AND workhub_private.p7_pos(c -> 'expectedVersion')
    WHEN 'course_link' THEN workhub_private.p2_exact(c, ARRAY['kind','courseId','expectedVersion','input'])
      AND workhub_private.p7_id(c -> 'courseId') AND (c -> 'expectedVersion' = 'null'::jsonb OR workhub_private.p7_pos(c -> 'expectedVersion'))
      AND workhub_private.p2_exact(c -> 'input', ARRAY['classIds','studentGroup','spaceIds'])
      AND workhub_private.t1_ids(c #> '{input,classIds}', 20) AND jsonb_typeof(c #> '{input,studentGroup}') = 'boolean'
      AND workhub_private.t1_ids(c #> '{input,spaceIds}', 10)
      -- 학급과 수강집단은 함께 쓰지 않는다
      AND NOT (jsonb_array_length(c #> '{input,classIds}') > 0 AND (c #>> '{input,studentGroup}')::boolean)
    ELSE false END
$$;

CREATE FUNCTION workhub_private.t1_setup_execute(p_ctx workhub_private.actor_context, c jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(c); v jsonb; x workhub.timetable_spaces; l workhub.timetable_course_links; co workhub.courses;
        v_state text; v_target text; v_ver integer; v_term text; v_fp text; v_snap jsonb;
BEGIN
  v := workhub_private.t1_claim(p_ctx, 'setup', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF c IS NULL OR jsonb_typeof(c) <> 'object' OR jsonb_typeof(c -> 'kind') IS DISTINCT FROM 'string' OR NOT workhub_private.t1_setup_shape(c) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  IF c ->> 'kind' = 'space_save' THEN
    IF c -> 'spaceId' = 'null'::jsonb THEN
      INSERT INTO workhub.timetable_spaces (school_id, kind, label, capacity, created_by_membership_id, updated_by_membership_id)
      VALUES (p_ctx.school_id, c #>> '{input,kind}', workhub_private.js_trim(c #>> '{input,label}'), (c #>> '{input,capacity}')::integer,
              p_ctx.membership_id, p_ctx.membership_id)
      RETURNING * INTO x;
    ELSE
      SELECT * INTO x FROM workhub.timetable_spaces WHERE school_id = p_ctx.school_id AND id = c ->> 'spaceId' AND removed_at IS NULL FOR UPDATE;
      IF x.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
      IF to_jsonb(x.version) <> c -> 'expectedVersion' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      UPDATE workhub.timetable_spaces SET kind = c #>> '{input,kind}', label = workhub_private.js_trim(c #>> '{input,label}'),
             capacity = (c #>> '{input,capacity}')::integer, version = version + 1, updated_by_membership_id = p_ctx.membership_id, updated_at = clock_timestamp()
       WHERE id = x.id RETURNING * INTO x;
    END IF;
    v_target := x.id; v_ver := x.version;
    v_snap := jsonb_build_object('kind', x.kind, 'label', x.label, 'capacity', x.capacity, 'removed', false);
    PERFORM workhub_private.write_audit(p_ctx, 'timetable.space_save', 'timetable_space', x.id, x.version, 'school', p_key,
      jsonb_build_object('kind', x.kind, 'capacity', x.capacity));
    INSERT INTO workhub.timetable_setup_history (school_id, target_kind, target_id, version, state, membership_id, request_key)
    VALUES (p_ctx.school_id, 'space', x.id, x.version, v_snap, p_ctx.membership_id, p_key);
  ELSIF c ->> 'kind' = 'space_remove' THEN
    SELECT * INTO x FROM workhub.timetable_spaces WHERE school_id = p_ctx.school_id AND id = c ->> 'spaceId' AND removed_at IS NULL FOR UPDATE;
    IF x.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF to_jsonb(x.version) <> c -> 'expectedVersion' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    -- 닫히지 않은 학기의 수업에 연결된 공간은 지우지 않는다(연결을 먼저 바꾼다)
    IF EXISTS (SELECT 1 FROM workhub.timetable_course_link_spaces ls JOIN workhub.courses cc ON cc.school_id = ls.school_id AND cc.id = ls.course_id
                 JOIN workhub.terms tt ON tt.school_id = cc.school_id AND tt.id = cc.term_id
                WHERE ls.school_id = p_ctx.school_id AND ls.space_id = x.id AND tt.state <> 'closed') THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    UPDATE workhub.timetable_spaces SET removed_at = clock_timestamp(), version = version + 1, updated_by_membership_id = p_ctx.membership_id,
           updated_at = clock_timestamp() WHERE id = x.id RETURNING * INTO x;
    v_target := x.id; v_ver := x.version;
    PERFORM workhub_private.write_audit(p_ctx, 'timetable.space_remove', 'timetable_space', x.id, x.version, 'school', p_key, '{}'::jsonb);
    INSERT INTO workhub.timetable_setup_history (school_id, target_kind, target_id, version, state, membership_id, request_key)
    VALUES (p_ctx.school_id, 'space', x.id, x.version, jsonb_build_object('kind', x.kind, 'label', x.label, 'capacity', x.capacity, 'removed', true),
            p_ctx.membership_id, p_key);
  ELSE
    -- 수업: 같은 학교, 닫히지 않은 학기. 학급은 그 수업의 학년도 P1 학급(빠지지 않은 것), 공간은 지우지 않은 것 — ID 로만 고른다(이름 추정 없음).
    SELECT * INTO co FROM workhub.courses WHERE school_id = p_ctx.school_id AND id = c ->> 'courseId' FOR SHARE;
    IF co.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    SELECT state INTO v_state FROM workhub.terms WHERE school_id = co.school_id AND id = co.term_id;
    IF v_state = 'closed' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF (SELECT count(*) FROM workhub.year_classes yc WHERE yc.school_id = co.school_id AND yc.academic_year_id = co.academic_year_id
          AND yc.removed_at IS NULL AND yc.id IN (SELECT jsonb_array_elements_text(c #> '{input,classIds}'))) <> jsonb_array_length(c #> '{input,classIds}')
       OR (SELECT count(*) FROM workhub.timetable_spaces sx WHERE sx.school_id = co.school_id AND sx.removed_at IS NULL
             AND sx.id IN (SELECT jsonb_array_elements_text(c #> '{input,spaceIds}'))) <> jsonb_array_length(c #> '{input,spaceIds}') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO l FROM workhub.timetable_course_links WHERE school_id = co.school_id AND course_id = co.id FOR UPDATE;
    IF (l.course_id IS NULL) <> (c -> 'expectedVersion' = 'null'::jsonb) OR (l.course_id IS NOT NULL AND to_jsonb(l.version) <> c -> 'expectedVersion') THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    IF l.course_id IS NULL THEN
      INSERT INTO workhub.timetable_course_links (school_id, course_id, academic_year_id, student_group, updated_by_membership_id)
      VALUES (co.school_id, co.id, co.academic_year_id, (c #>> '{input,studentGroup}')::boolean, p_ctx.membership_id) RETURNING * INTO l;
    ELSE
      UPDATE workhub.timetable_course_links SET student_group = (c #>> '{input,studentGroup}')::boolean, version = version + 1,
             updated_by_membership_id = p_ctx.membership_id, updated_at = clock_timestamp()
       WHERE school_id = co.school_id AND course_id = co.id RETURNING * INTO l;
      DELETE FROM workhub.timetable_course_link_classes WHERE school_id = co.school_id AND course_id = co.id;
      DELETE FROM workhub.timetable_course_link_spaces WHERE school_id = co.school_id AND course_id = co.id;
    END IF;
    INSERT INTO workhub.timetable_course_link_classes (school_id, course_id, academic_year_id, class_id)
    SELECT co.school_id, co.id, co.academic_year_id, k FROM jsonb_array_elements_text(c #> '{input,classIds}') k;
    INSERT INTO workhub.timetable_course_link_spaces (school_id, course_id, space_id)
    SELECT co.school_id, co.id, k FROM jsonb_array_elements_text(c #> '{input,spaceIds}') k;
    v_target := co.id; v_ver := l.version;
    PERFORM workhub_private.write_audit(p_ctx, 'timetable.course_link', 'course', co.id, l.version, 'school', p_key,
      jsonb_build_object('classes', jsonb_array_length(c #> '{input,classIds}'), 'studentGroup', l.student_group,
                         'spaces', jsonb_array_length(c #> '{input,spaceIds}')));
    INSERT INTO workhub.timetable_setup_history (school_id, target_kind, target_id, version, state, membership_id, request_key)
    VALUES (p_ctx.school_id, 'course_link', co.id, l.version, c -> 'input', p_ctx.membership_id, p_key);
  END IF;
  -- 바뀐 뒤 대상 학기의 원본 지문(입력 화면이 준비 화면을 다시 읽을지 판단). 대상 학기가 없으면 null.
  v_term := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  IF v_term IS NOT NULL THEN v_fp := workhub_private.t1_build(p_ctx.school_id, v_term, p_ctx.school_today) ->> 'fingerprint'; END IF;
  v := jsonb_build_object('requestKey', p_key, 'kind', c ->> 'kind', 'targetId', v_target, 'version', v_ver, 'sourceFingerprint', v_fp);
  PERFORM workhub_private.t1_record(p_ctx, 'setup', p_key, v_hash, v);
  RETURN v;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 봉투 — 업무 코드는 {error:{code}}, 동시 실행 경합(유일 · 배제 · 교착 · 직렬화 · 참조)은 CONFLICT
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_run(p_ctx workhub_private.actor_context, p_contract text, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.t1_installed('T1-03') THEN RETURN workhub_private.p7_err(p_ctx, p_contract, 'NOT_READY'); END IF;
  BEGIN
    IF p_op = 'readiness' THEN v := workhub_private.t1_readiness(p_ctx);
    ELSIF p_op = 'get' THEN v := workhub_private.t1_get(p_ctx, (a ->> 'week')::date);
    ELSIF p_op = 'save_draft' THEN v := workhub_private.t1_save_draft(p_ctx, a -> 'input', a ->> 'key', (a ->> 'recover')::boolean);
    ELSIF p_op = 'prep_get' THEN v := workhub_private.t1_prep_get(p_ctx);
    ELSIF p_op = 'prep_execute' THEN v := workhub_private.t1_prep_execute(p_ctx, a -> 'input', a ->> 'key', (a ->> 'recover')::boolean);
    ELSIF p_op = 'setup_get' THEN v := workhub_private.t1_setup_get(p_ctx);
    ELSIF p_op = 'setup_execute' THEN v := workhub_private.t1_setup_execute(p_ctx, a -> 'command', a ->> 'key', (a ->> 'recover')::boolean);
    ELSE RAISE EXCEPTION 'T1_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p7_ok(p_ctx, p_contract, v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p7_business(SQLERRM) THEN RETURN workhub_private.p7_err(p_ctx, p_contract, SQLERRM); END IF;
      RAISE;
    WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure OR foreign_key_violation THEN
      RETURN workhub_private.p7_err(p_ctx, p_contract, 'CONFLICT');
  END;
END $$;

-- ----------------------------------------------------------------------------
-- 6. 공개 함수
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_timetable_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t1_run(ctx, 'timetable.v1', 'readiness', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_timetable_get(p_member_id text, p_week_start date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t1_run(ctx, 'timetable.v1', 'get', jsonb_build_object('week', p_week_start));
END $$;

CREATE FUNCTION public.workhub_timetable_save_draft(p_member_id text, p_input jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t1_run(ctx, 'timetable.v1', 'save_draft', jsonb_build_object('input', p_input, 'key', p_request_key, 'recover', p_recover_only));
END $$;

CREATE FUNCTION public.workhub_timetable_preparation_get(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t1_run(ctx, 'timetable.preparation.v1', 'prep_get', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_timetable_preparation_execute(p_member_id text, p_input jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t1_run(ctx, 'timetable.preparation.v1', 'prep_execute', jsonb_build_object('input', p_input, 'key', p_request_key, 'recover', p_recover_only));
END $$;

CREATE FUNCTION public.workhub_timetable_setup_get(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t1_run(ctx, 'timetable.setup.v1', 'setup_get', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_timetable_setup_execute(p_member_id text, p_command jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t1_run(ctx, 'timetable.setup.v1', 'setup_execute', jsonb_build_object('command', p_command, 'key', p_request_key, 'recover', p_recover_only));
END $$;

COMMENT ON FUNCTION public.workhub_timetable_readiness(text) IS '업무실 T1 시간표: 이 소속이 시간표 편성 화면을 쓸 수 있는가(not_installed · not_allowed · basis_missing).';
COMMENT ON FUNCTION public.workhub_timetable_get(text, date) IS '업무실 T1 시간표: 현재 기준판 · 편성 초안 40개(담당자). 날짜별 수업은 T2.';
COMMENT ON FUNCTION public.workhub_timetable_save_draft(text, jsonb, text, boolean) IS '업무실 T1 시간표: 필수조건을 통과한 편성 초안 저장(요청 번호 · 복구 조회).';
COMMENT ON FUNCTION public.workhub_timetable_preparation_get(text) IS '업무실 T1 시간표 준비: 공식 원본(교사 · 학급 · 수강집단 · 공간 · 수업)과 저장한 준비 초안.';
COMMENT ON FUNCTION public.workhub_timetable_preparation_execute(text, jsonb, text, boolean) IS '업무실 T1 시간표 준비: 준비 초안 저장 · 기준판 확정(원본 판 · 지문 · 초안 판 비교).';
COMMENT ON FUNCTION public.workhub_timetable_setup_get(text) IS '업무실 T1 시간표 준비 자료 입력: 공간 정원 · 수업 연결 상태와 미완성 목록.';
COMMENT ON FUNCTION public.workhub_timetable_setup_execute(text, jsonb, text, boolean) IS '업무실 T1 시간표 준비 자료 입력: 공간 저장 · 삭제, 수업 ↔ 학급 · 수강집단 · 공간 연결.';

-- ----------------------------------------------------------------------------
-- 7. 권한 — 공개 함수 7개만 authenticated 에. 새 내부 함수는 API 역할 실행 불가.
-- ----------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND p.proname LIKE 't1\_%') OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_timetable\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_readiness(text), public.workhub_timetable_get(text, date),
    public.workhub_timetable_save_draft(text, jsonb, text, boolean), public.workhub_timetable_preparation_get(text),
    public.workhub_timetable_preparation_execute(text, jsonb, text, boolean), public.workhub_timetable_setup_get(text),
    public.workhub_timetable_setup_execute(text, jsonb, text, boolean) TO authenticated;
END $$;

INSERT INTO workhub_private.t1_installs (batch, release) VALUES ('T1-03', '2026-10-18.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 8. 검증 — 모든 행의 status 가 ok 여야 한다. T1-03-3 은 "아직 켜지 않음"이 정상이다(T1-05 전).
-- ----------------------------------------------------------------------------
SELECT 'T1-03-1' AS no, '공개 함수 7개 authenticated 만(anon · service_role 불가)' AS item,
       CASE WHEN (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'workhub\_timetable\_%') = 7
             AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_%'
                               AND (NOT has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T1-03-2', '내부 함수 t1_* API 역할 실행 불가',
       CASE WHEN NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('service_role', p.oid, 'EXECUTE')))
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-03-3', '아직 어느 학교도 켜지 않음 · 기준판 0 · 요청 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'timetable') = 0
             AND (SELECT count(*) FROM workhub.timetable_basis_revisions) = 0 AND (SELECT count(*) FROM workhub.timetable_requests) = 0
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-03-4', '적용 기록 T1-03', CASE WHEN workhub_private.t1_installed('T1-03') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
