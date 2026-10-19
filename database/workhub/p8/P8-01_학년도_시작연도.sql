-- ============================================================================
-- P8-01  정책 보강 1 — 새 학년도 시작 연도(Q4) + 정책 보강 적용 기록 (비활성 기능 없음, 바로 효력)
--
-- ▣ 확정 정책(2026-10-16 계란님): 새 학년도는 "시작일의 연도 = 학년도 숫자". 시작 월·일은 강제하지 않고, 끝은 다음 해여도 된다.
--   검사하는 곳은 새로 만드는 두 경로뿐이다.
--     P1 학교 관리  workhub_school_admin_mutate  save_configuration(mode = create_year)
--     P7 업무 전환  workhub_school_transition_preview · _mutate(apply, plan.kind = new_year)
--   기존 학년도 수정(mode = update) · 조회 · 이미 접수된 요청의 같은 키 재전송(원장 먼저)에는 적용하지 않는다.
-- ▣ 바꾸는 것: 함수 2개 본문(CREATE OR REPLACE — 이름 · 인자 · 권한 그대로)
--     workhub_private.p1_save_configuration   create_year 에서 "이미 있는 학년도(CONFLICT)" 확인 바로 뒤에 연도 검사 1개
--     workhub_private.p7_plan_eval            새 학년도에서 같은 자리에 연도 검사 1개
--                                             + 인계 자원이 "다른 진행 중 인계"에 들었는지 볼 때 관리자 확인 대기(awaiting_admin, P8-03)도 센다
--                                               (P8-03 전에는 그 상태가 없으므로 동작이 같다)
--   그 밖의 줄은 원본(P1-02 · P7-02, 2026-10-16.1)과 한 글자도 다르지 않다(시험 P8-B 가 원본과 비교한다).
-- ▣ 새로 만드는 것: workhub_private.p8_installs(정책 보강 P8-01~04 의 적용 기록)
-- ▣ 전제: R0 · R1 · P1 · P2 · P3 · P7(2026-10-16.1). 바꿀 두 함수가 원본 판이 아니면(누가 고쳤으면) 아무것도 하지 않고 멈춘다.
-- ▣ 한 트랜잭션. 중간에 ERROR 가 나면 아무것도 남지 않는다. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.p1_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p1_installs WHERE batch IN ('P1-01','P1-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P8 중단: P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p7_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P7-01·02(2026-10-16.1, 업무 전환)를 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p7_installs WHERE batch IN ('P7-01','P7-02') AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 2 THEN RAISE EXCEPTION 'P8 중단: P7-01·02(2026-10-16.1, 업무 전환)를 먼저 적용해 주세요.'; END IF;
  IF to_regclass('workhub_private.p8_installs') IS NOT NULL THEN
    RAISE EXCEPTION 'P8 중단: P8-01 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 'p8\_%' OR proname LIKE 'workhub\_teaching\_relation%') THEN
    RAISE EXCEPTION 'P8 중단: 같은 이름의 표·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
  -- 바꿀 함수가 원본 판인가(본문 md5 — INT-03 의 P1 · P7 기대값과 같다). 다르면 누가 고친 것이므로 덮어쓰지 않는다.
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)'::regprocedure)
       IS DISTINCT FROM '72fe77d4163a001db8ab874c681704e6'
     OR (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = 'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)'::regprocedure)
       IS DISTINCT FROM 'a36997815f0ed519be5b1adbf4fc66e1' THEN
    RAISE EXCEPTION 'P8 중단: 바꿀 함수(p1_save_configuration · p7_plan_eval)가 원본 판(2026-10-16.1)이 아닙니다. 누가 고쳤는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 적용 기록 (P8-01~04)
-- ----------------------------------------------------------------------------
CREATE TABLE workhub_private.p8_installs (
  batch        text NOT NULL,
  release      text NOT NULL,
  installed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  installed_by name NOT NULL DEFAULT session_user,
  CONSTRAINT p8_installs_pkey PRIMARY KEY (batch),
  CONSTRAINT p8_installs_batch_check CHECK (batch IN ('P8-01','P8-02','P8-03','P8-04')),
  CONSTRAINT p8_installs_release_check CHECK (release ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$')
);
CREATE TRIGGER p8_installs_immutable BEFORE UPDATE OR DELETE ON workhub_private.p8_installs
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_change();
ALTER TABLE workhub_private.p8_installs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE workhub_private.p8_installs FROM PUBLIC, anon, authenticated, service_role;

-- 정책 보강 배치가 적용되었는가(P8-02~04 가 서로를 확인할 때 쓴다)
CREATE FUNCTION workhub_private.p8_installed(p_batch text) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub_private.p8_installs WHERE batch = p_batch AND release = '2026-10-16.1')
$$;
-- 화면 이름(앱 text(value, max)): 제어 문자 → 공백, UTF-16 길이 p_max 이내로 자름, 공백뿐이면 대체 문구. P8-03 · 04 가 쓴다.
CREATE FUNCTION workhub_private.p8_label(p text, p_max integer, p_fallback text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN workhub_private.js_trim(x) = '' THEN p_fallback ELSE x END
    FROM (SELECT left(y, p_max - regexp_count(left(y, p_max), '[\U00010000-\U0010FFFF]')) AS x
            FROM (SELECT regexp_replace(COALESCE(p, ''), '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]', ' ', 'g') AS y) a) b
$$;
REVOKE ALL ON FUNCTION workhub_private.p8_installed(text), workhub_private.p8_label(text, integer, text) FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. P1 학교 관리 — create_year 에 시작 연도 검사
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workhub_private.p1_save_configuration(p_ctx workhub_private.actor_context, c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  cfg jsonb := c -> 'configuration'; s workhub.schools; y workhub.academic_years;
  v_year smallint := (cfg ->> 'schoolYear')::smallint; v_start date := (cfg ->> 'startsOn')::date; v_end date := (cfg ->> 'lastDay')::date + 1;
  v_grades smallint := (cfg ->> 'gradeCount')::smallint; v_before jsonb; r jsonb; t workhub.terms; v_ids text[];
BEGIN
  SELECT * INTO s FROM workhub.schools WHERE id = p_ctx.school_id;
  -- 학교 코드는 바꾸지 않는다(새 학교 개설·병합·코드 변경은 이 API 범위 밖)
  IF workhub_private.js_trim(cfg ->> 'schoolCode') <> s.code THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF c ->> 'mode' = 'update' THEN
    SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id = cfg ->> 'draftId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF y.school_year <> v_year THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;   -- 학년도 변경 거부
    v_before := workhub_private.p1_configuration(p_ctx.school_id, y.id);
  ELSE
    IF EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = v_year) THEN
      RAISE EXCEPTION 'CONFLICT' USING DETAIL = '이미 있는 학년도입니다.';
    END IF;
    -- [P8-01 · Q4 2026-10-16 확정] 새 학년도는 시작일의 연도 = 학년도 숫자. 월·일은 강제하지 않고 끝은 다음 해여도 된다.
    -- 접수증(claim_receipt) 확인 뒤에만 오는 자리라 이미 접수된 요청의 재전송에는 적용되지 않는다. update(기존 학년도 수정)에는 적용하지 않는다.
    IF EXTRACT(year FROM v_start)::integer <> v_year THEN
      RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '학년도 숫자와 학년도 시작일의 연도가 같아야 합니다.';
    END IF;
  END IF;
  -- 다른 학년도와 기간이 겹치면 안 된다
  IF EXISTS (SELECT 1 FROM workhub.academic_years o WHERE o.school_id = p_ctx.school_id AND o.id IS DISTINCT FROM y.id
               AND daterange(o.starts_on, o.ends_on, '[)') && daterange(v_start, v_end, '[)')) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '다른 학년도와 기간이 겹칩니다.';
  END IF;
  -- 학년 수를 줄이면 다른 학년도의 학급도 그 안이어야 한다(학년 수는 학교 속성)
  IF EXISTS (SELECT 1 FROM workhub.year_classes k WHERE k.school_id = p_ctx.school_id AND k.removed_at IS NULL
               AND k.academic_year_id IS DISTINCT FROM y.id AND k.grade > v_grades) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '다른 학년도에 이 학년 수를 넘는 학급이 있습니다.';
  END IF;
  -- 학교 속성(이름·학교급·학년 수)
  IF (s.name, s.school_level, s.grade_count) IS DISTINCT FROM (workhub_private.js_trim(cfg ->> 'schoolName'), cfg ->> 'schoolType', v_grades) THEN
    UPDATE workhub.schools SET name = workhub_private.js_trim(cfg ->> 'schoolName'), school_level = cfg ->> 'schoolType',
           grade_count = v_grades, version = version + 1, updated_at = clock_timestamp()
     WHERE id = s.id;
  END IF;
  -- 학년도: 기간을 바꾸면 그 학년도의 공식 담당이 모두 새 기간 안이어야 한다
  IF y.id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM workhub.staff_assignments a WHERE a.school_id = p_ctx.school_id AND a.academic_year_id = y.id
                 AND (a.valid_from < v_start OR a.valid_to > v_end)) THEN
      RAISE EXCEPTION 'CONFLICT' USING DETAIL = '공식 담당 기간이 새 학년도 기간 밖으로 나갑니다.';
    END IF;
    IF (y.starts_on, y.ends_on) IS DISTINCT FROM (v_start, v_end) THEN
      UPDATE workhub.academic_years SET starts_on = v_start, ends_on = v_end, version = version + 1, updated_at = clock_timestamp()
       WHERE id = y.id RETURNING * INTO y;
    END IF;
  ELSE
    INSERT INTO workhub.academic_years (school_id, school_year, starts_on, ends_on, state)
    VALUES (p_ctx.school_id, v_year, v_start, v_end, 'planning') RETURNING * INTO y;
  END IF;

  -- 학기: 같은 번호·같은 ID 만 갱신(R0 가 학기 번호 변경을 막는다). 빠진 학기는 참조가 없을 때만 지운다(FK 가 지킨다).
  SET CONSTRAINTS workhub.terms_no_overlap DEFERRED;
  SELECT COALESCE(array_agg(x ->> 'id'), ARRAY[]::text[]) INTO v_ids FROM jsonb_array_elements(cfg -> 'terms') x;
  IF EXISTS (SELECT 1 FROM unnest(v_ids) x WHERE x NOT LIKE 'draft-%'
               AND NOT EXISTS (SELECT 1 FROM workhub.terms tm WHERE tm.school_id = p_ctx.school_id AND tm.academic_year_id = y.id AND tm.id = x)) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  DELETE FROM workhub.terms tm WHERE tm.school_id = p_ctx.school_id AND tm.academic_year_id = y.id AND NOT (tm.id = ANY (v_ids));
  FOR r IN SELECT value FROM jsonb_array_elements(cfg -> 'terms') LOOP
    IF r ->> 'id' LIKE 'draft-%' THEN
      INSERT INTO workhub.terms (school_id, academic_year_id, term_no, label, starts_on, ends_on, state)
      VALUES (p_ctx.school_id, y.id, (r ->> 'termNo')::smallint, workhub_private.js_trim(r ->> 'name'),
              (r ->> 'startsOn')::date, (r ->> 'lastDay')::date + 1, 'planning');
    ELSE
      SELECT * INTO t FROM workhub.terms WHERE id = r ->> 'id' FOR UPDATE;
      IF t.term_no <> (r ->> 'termNo')::smallint THEN RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '기존 학기의 번호는 바꿀 수 없습니다.'; END IF;
      IF (t.label, t.starts_on, t.ends_on) IS DISTINCT FROM (workhub_private.js_trim(r ->> 'name'), (r ->> 'startsOn')::date, (r ->> 'lastDay')::date + 1) THEN
        UPDATE workhub.terms SET label = workhub_private.js_trim(r ->> 'name'), starts_on = (r ->> 'startsOn')::date,
               ends_on = (r ->> 'lastDay')::date + 1, version = version + 1, updated_at = clock_timestamp()
         WHERE id = t.id;
      END IF;
    END IF;
  END LOOP;
  SET CONSTRAINTS workhub.terms_no_overlap IMMEDIATE;

  PERFORM workhub_private.p1_sync_rows(p_ctx, y.id, 'year_departments', cfg -> 'departments');
  PERFORM workhub_private.p1_sync_rows(p_ctx, y.id, 'year_classes', cfg -> 'classes');
  PERFORM workhub_private.p1_sync_rows(p_ctx, y.id, 'year_subjects', c -> 'subjects');
  RETURN jsonb_build_object('year_id', y.id, 'school_year', y.school_year, 'before', v_before,
                            'after', workhub_private.p1_configuration(p_ctx.school_id, y.id));
END $$;


-- ----------------------------------------------------------------------------
-- 3. P7 업무 전환 — 새 학년도 계획에 시작 연도 검사 (+ 관리자 확인 대기도 진행 중 인계로)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workhub_private.p7_plan_eval(p_ctx workhub_private.actor_context, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  m workhub.memberships; v_name text; r jsonb; x record; y workhub.academic_years;
  v_items jsonb := '[]'::jsonb; v_lines jsonb := '[]'::jsonb; v_excl jsonb := '[]'::jsonb; v_state jsonb;
  v_first date; v_last date; v_dep integer := 0; v_cls integer := 0; v_sub integer := 0; v_rev bigint;
BEGIN
  PERFORM workhub_private.p7_plan_check(p);
  IF p ->> 'kind' = 'handover' THEN
    -- 받는 사람: 같은 학교 · 오늘 유효 · 업무실 사용자(P2 규칙), 나 · 같은 계정의 다른 소속 아님
    SELECT * INTO m FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = p ->> 'recipientMemberId';
    IF NOT FOUND OR NOT workhub_private.p7_recipient_ok(p_ctx, m.id) THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF m.version <> (p ->> 'recipientVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    SELECT left(a.display_name, 100) INTO v_name FROM workhub.accounts a WHERE a.id = m.account_id;
    -- 종류별 준비: 꺼진 종류가 하나라도 있으면 NOT_READY(조용히 빼지 않는다)
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'duty')
       AND NOT (workhub_private.p7_ready(p_ctx.school_id, 'duty_handover') AND workhub_private.p7_admin_active(p_ctx.school_id)) THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' IN ('cooperation','collection'))
       AND NOT workhub_private.p7_bridge() THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'cooperation')
       AND NOT workhub_private.p2_module_active(p_ctx.school_id, 'cooperation') THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'collection')
       AND NOT workhub_private.p7_r1_readable() THEN
      RAISE EXCEPTION 'NOT_READY';
    END IF;
    v_lines := v_lines || to_jsonb('받는 사람: ' || v_name);
    FOR r IN SELECT e FROM jsonb_array_elements(p -> 'resources') e ORDER BY CASE e ->> 'kind' WHEN 'duty' THEN 1 WHEN 'cooperation' THEN 2 ELSE 3 END, e ->> 'id' LOOP
      SELECT * INTO x FROM workhub_private.p7_resources(p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_ctx.school_today) s
       WHERE s.kind = r ->> 'kind' AND s.id = r ->> 'id';
      IF NOT FOUND THEN
        -- 다른 대기 인계에 이미 들어 있으면 CONFLICT, 그 밖(남의 자원 · 끝난 자원 · 없는 자원)은 NOT_FOUND
        IF EXISTS (SELECT 1 FROM workhub.transition_items i JOIN workhub.transition_records t ON t.id = i.record_id
                    WHERE i.school_id = p_ctx.school_id AND i.kind = r ->> 'kind' AND i.resource_id = r ->> 'id' AND t.state IN ('pending','awaiting_admin')  -- [P8-01] 관리자 확인 대기도 진행 중
                      AND t.requester_membership_id = p_ctx.membership_id) THEN
          RAISE EXCEPTION 'CONFLICT';
        END IF;
        RAISE EXCEPTION 'NOT_FOUND';
      END IF;
      IF x.version <> (r ->> 'version')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
      -- 협업 요청을 그 요청을 보낸 사람에게 넘길 수는 없다(P2: 보낸 사람 ≠ 받는 사람). 수락 때 막히기 전에 미리보기에서 알린다.
      IF x.kind = 'cooperation' AND EXISTS (SELECT 1 FROM workhub.cooperation_requests cr WHERE cr.school_id = p_ctx.school_id AND cr.id = x.id
                                              AND (cr.sender_membership_id = m.id OR cr.sender_account_id = m.account_id)) THEN
        RAISE EXCEPTION 'INVALID_INPUT';
      END IF;
      v_items := v_items || jsonb_build_object('kind', x.kind, 'id', x.id, 'version', x.version, 'label', x.label);
      v_lines := v_lines || to_jsonb(x.label);
    END LOOP;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'duty') THEN
      v_excl := v_excl || to_jsonb('공식 담당은 수락한 날부터 받는 사람에게 넘어가고, 내 담당은 그 전날까지로 끝납니다.'::text);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'collection') THEN
      v_excl := v_excl || to_jsonb('수합의 제출 단위 담당 교사와 이미 받은 제출물은 그대로입니다(수합 관리자만 바뀝니다).'::text);
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE e ->> 'kind' = 'cooperation') THEN
      v_excl := v_excl || to_jsonb('협업에 연결해 둔 내 개인 업무(할 일)는 넘어가지 않습니다.'::text);
    END IF;
    v_excl := v_excl || to_jsonb('받는 사람이 수락하기 전까지는 아무것도 넘어가지 않습니다.'::text);
    v_state := jsonb_build_object('recipient', m.id, 'recipientVersion', m.version, 'items', v_items);
    RETURN jsonb_build_object('state', v_state, 'summary', v_lines, 'excluded', v_excl, 'affectedCount', jsonb_array_length(v_items),
      'title', left('업무 인계: ' || v_name || ' (' || jsonb_array_length(v_items) || '건)', 200), 'items', v_items,
      'recipient', m.id, 'recipientAccount', m.account_id);
  END IF;

  -- 새 학년도
  IF NOT workhub_private.p7_admin_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.member_has_perm(p_ctx, 'year.manage') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id = p ->> 'sourceYearId';
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = (p ->> 'targetYear')::smallint) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  -- [P8-01 · Q4] 시작일의 연도 = 학년도 숫자(월·일 강제 없음, 끝은 다음 해 가능). 미리보기와 새 적용에만 — 적용은 원장 확인 뒤에 이 함수를 부른다.
  IF EXTRACT(year FROM (p ->> 'firstDay')::date)::integer <> (p ->> 'targetYear')::integer THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_first := (p ->> 'firstDay')::date;
  v_last := (p ->> 'lastDay')::date;
  IF EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = p_ctx.school_id
               AND daterange(starts_on, ends_on, '[)') && daterange(v_first, v_last + 1, '[)'))
     OR EXISTS (SELECT 1 FROM workhub.terms WHERE school_id = p_ctx.school_id
               AND daterange(starts_on, ends_on, '[)') && daterange(v_first, v_last + 1, '[)')) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF (p -> 'copyStructure')::boolean THEN
    SELECT count(*) INTO v_dep FROM workhub.year_departments WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
    SELECT count(*) INTO v_cls FROM workhub.year_classes WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
    SELECT count(*) INTO v_sub FROM workhub.year_subjects WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL;
  END IF;
  SELECT revision INTO v_rev FROM workhub.school_admin_activations WHERE school_id = p_ctx.school_id;
  v_lines := jsonb_build_array(
    (p ->> 'targetYear') || '학년도: ' || (p ->> 'firstDay') || ' ~ ' || (p ->> 'lastDay'),
    '1학기: ' || (p ->> 'term1First') || ' ~ ' || (p ->> 'term1Last'),
    '2학기: ' || (p ->> 'term2First') || ' ~ ' || (p ->> 'term2Last'),
    CASE WHEN (p -> 'copyStructure')::boolean
         THEN y.school_year || '학년도 구성 복사: 부서 ' || v_dep || '개 · 학급 ' || v_cls || '개 · 교과 ' || v_sub || '개'
         ELSE '구성(부서 · 학급 · 교과)은 복사하지 않습니다.' END);
  v_excl := jsonb_build_array('공식 담당 · 소속 · 수업 · 학생 명단은 복사하지 않습니다.',
                              '새 학년도는 준비 상태로 만들며, 현재 학년도는 바꾸지 않습니다.');
  -- 지문 재료: 원본 학년도의 판과 살아 있는 구성(ID · 판), 학교 관리 판
  v_state := jsonb_build_object('revision', v_rev, 'sourceVersion', y.version,
    'structure', CASE WHEN (p -> 'copyStructure')::boolean THEN jsonb_build_array(
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_departments WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL),
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_classes WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL),
       (SELECT COALESCE(jsonb_agg(jsonb_build_array(id, version) ORDER BY id), '[]'::jsonb) FROM workhub.year_subjects WHERE school_id = y.school_id AND academic_year_id = y.id AND removed_at IS NULL))
       ELSE '[]'::jsonb END);
  RETURN jsonb_build_object('state', v_state, 'summary', v_lines, 'excluded', v_excl, 'affectedCount', 3 + v_dep + v_cls + v_sub,
    'title', (p ->> 'targetYear') || '학년도 만들기', 'items', '[]'::jsonb, 'recipient', NULL, 'recipientAccount', NULL);
END $$;


INSERT INTO workhub_private.p8_installs (batch, release) VALUES ('P8-01', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 4. 검증 — 모든 행의 status 가 ok 여야 한다.
-- ----------------------------------------------------------------------------
SELECT 'P8-01-1' AS no, '적용 기록 P8-01 · 표 RLS 켜짐 · API 역할 권한 0' AS item,
       CASE WHEN workhub_private.p8_installed('P8-01') AND c.relrowsecurity
             AND NOT (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                      OR has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE')) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
FROM pg_class c WHERE c.oid = 'workhub_private.p8_installs'::regclass
UNION ALL
SELECT 'P8-01-2', '바꾼 함수 2개: 원본과 같은 권한(API 역할 실행 불가) · SECURITY DEFINER · search_path 고정',
       CASE WHEN count(*) = 2 AND bool_and(p.prosecdef AND p.proconfig = ARRAY['search_path=""']
              AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.oid IN ('workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)'::regprocedure,
                               'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)'::regprocedure)
UNION ALL
SELECT 'P8-01-3', '두 함수에 시작 연도 검사가 들어감',
       CASE WHEN (SELECT prosrc FROM pg_proc WHERE oid = 'workhub_private.p1_save_configuration(workhub_private.actor_context,jsonb)'::regprocedure) LIKE '%EXTRACT(year FROM v_start)%'
             AND (SELECT prosrc FROM pg_proc WHERE oid = 'workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)'::regprocedure) LIKE '%EXTRACT(year FROM (p ->> ''firstDay'')::date)%'
            THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
