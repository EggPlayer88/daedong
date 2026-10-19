-- ============================================================================
-- P1-02  학교 관리 — 공개 함수 3개(준비 상태 · 조회 · 변경)와 권한
--
-- 앱 계약: apps/workhub/src/setup/school-admin-contract.ts (schoolAdminEnvelope · Readiness · Snapshot · Command · Receipt)
-- ▣ 함수
--   workhub_school_admin_readiness(p_member_id text)                                   → {available} 봉투
--   workhub_school_admin_get(p_member_id text, p_school_year integer DEFAULT NULL)     → 스냅샷 봉투
--   workhub_school_admin_mutate(p_member_id text, p_command jsonb, p_request_key text) → 접수증 봉투
-- ▣ 오류
--   - 로그인·가입 승인·소속 gate 실패는 R0 와 같이 봉투 없는 예외(FORBIDDEN · INACTIVE_MEMBERSHIP).
--   - 그 밖의 업무 오류는 봉투의 error.code. 오류 봉투를 돌려줄 때는 그 요청의 변경을 모두 되돌린 뒤다(하위 블록 롤백).
-- ▣ 실행: SQL Editor 에 전체를 붙여 넣고 Run. 한 트랜잭션. 마지막 결과의 status 가 모두 ok 여야 한다.
-- ▣ 선행: P1-01(2026-10-16.1).
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.p1_installs') IS NULL THEN
    RAISE EXCEPTION 'P1 중단: P1-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.p1_installs WHERE batch = 'P1-01' AND release = '2026-10-16.1') THEN
    RAISE EXCEPTION 'P1 중단: P1-01(2026-10-16.1)을 먼저 실행해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p1_installs WHERE batch = 'P1-02') THEN
    RAISE EXCEPTION 'P1 중단: P1-02 가 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  IF to_regprocedure('public.workhub_school_admin_readiness(text)') IS NOT NULL
     OR to_regprocedure('public.workhub_school_admin_get(text, integer)') IS NOT NULL
     OR to_regprocedure('public.workhub_school_admin_mutate(text, jsonb, text)') IS NOT NULL THEN
    RAISE EXCEPTION 'P1 중단: 같은 이름의 공개 함수가 이미 있습니다.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 입력 검사 — 앱 schoolAdminCommand · validateSetupDraft 와 같은 규칙. 어긋나면 INVALID_INPUT.
-- ----------------------------------------------------------------------------
-- 이름: 앞뒤 공백을 뺀 길이 1~max, 제어 문자 없음. 원문 문자열 4000자 한도(앱 checkedDraft).
CREATE FUNCTION workhub_private.p1_name_ok(p jsonb, p_max integer) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p IS NOT NULL AND jsonb_typeof(p) = 'string' AND length(p #>> '{}') <= 4000
     AND length(workhub_private.js_trim(p #>> '{}')) BETWEEN 1 AND p_max
     AND workhub_private.js_trim(p #>> '{}') !~ '[\x01-\x1f\x7f]'
$$;

CREATE FUNCTION workhub_private.p1_check_configuration(p_cfg jsonb, p_subjects jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  k text; r jsonb; v_grades integer; v_limit integer; v_year integer; v_start date; v_last date; ts date; tl date;
  v_ids text[] := ARRAY[]::text[]; v_names text[]; v_coords text[] := ARRAY[]::text[]; v_termnos text[] := ARRAY[]::text[];
  v_periods daterange[] := ARRAY[]::daterange[]; v_range daterange;
BEGIN
  IF NOT workhub_private.p1_exact(p_cfg, ARRAY['draftId','schoolName','schoolCode','schoolType','gradeCount','schoolYear','startsOn','lastDay','terms','departments','classes']) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  FOREACH k IN ARRAY ARRAY['draftId','schoolName','schoolCode','schoolType','gradeCount','schoolYear','startsOn','lastDay'] LOOP
    IF jsonb_typeof(p_cfg -> k) <> 'string' OR length(p_cfg ->> k) > 4000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  END LOOP;
  IF NOT workhub_private.p1_id_ok(p_cfg -> 'draftId') OR NOT workhub_private.p1_name_ok(p_cfg -> 'schoolName', 100)
     OR workhub_private.js_trim(p_cfg ->> 'schoolCode') !~ '^[A-Za-z0-9_-]{2,40}$'
     OR p_cfg ->> 'schoolType' NOT IN ('elementary','middle','high','special','other')
     OR p_cfg ->> 'gradeCount' !~ '^[1-9][0-9]{0,2}$' OR p_cfg ->> 'schoolYear' !~ '^[1-9][0-9]{3}$' THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  v_ids := ARRAY[p_cfg ->> 'draftId'];
  v_limit := workhub_private.p1_grade_limit(p_cfg ->> 'schoolType');
  v_grades := (p_cfg ->> 'gradeCount')::integer;
  v_year := (p_cfg ->> 'schoolYear')::integer;
  v_start := workhub_private.p1_date(p_cfg ->> 'startsOn');
  v_last := workhub_private.p1_date(p_cfg ->> 'lastDay');
  IF v_grades NOT BETWEEN 1 AND v_limit OR v_year NOT BETWEEN 2020 AND 2100
     OR v_start IS NULL OR v_last IS NULL OR v_last = '9999-12-31' OR v_start > v_last THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 학기: 1~4개, 번호 1~4 서로 다름, 이름 1~50 서로 다름, 학년도 안, 마지막 날 포함 서로 겹치지 않음
  IF jsonb_typeof(p_cfg -> 'terms') <> 'array' OR jsonb_array_length(p_cfg -> 'terms') NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_names := ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_cfg -> 'terms') LOOP
    IF NOT workhub_private.p1_exact(r, ARRAY['id','termNo','name','startsOn','lastDay'])
       OR EXISTS (SELECT 1 FROM jsonb_each(r) e WHERE jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 4000)
       OR NOT workhub_private.p1_id_ok(r -> 'id') OR r ->> 'id' = ANY (v_ids)
       OR r ->> 'termNo' !~ '^[1-4]$' OR r ->> 'termNo' = ANY (v_termnos)
       OR NOT workhub_private.p1_name_ok(r -> 'name', 50) OR workhub_private.js_trim(r ->> 'name') = ANY (v_names) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    ts := workhub_private.p1_date(r ->> 'startsOn'); tl := workhub_private.p1_date(r ->> 'lastDay');
    IF ts IS NULL OR tl IS NULL OR tl = '9999-12-31' OR ts > tl OR ts < v_start OR tl > v_last THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_range := daterange(ts, tl, '[]');
    IF EXISTS (SELECT 1 FROM unnest(v_periods) x WHERE x && v_range) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_periods := v_periods || v_range;
    v_ids := v_ids || (r ->> 'id'); v_termnos := v_termnos || (r ->> 'termNo'); v_names := v_names || workhub_private.js_trim(r ->> 'name');
  END LOOP;

  -- 부서: 100개 이하, 이름 1~50 서로 다름
  IF jsonb_typeof(p_cfg -> 'departments') <> 'array' OR jsonb_array_length(p_cfg -> 'departments') > 100 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_names := ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_cfg -> 'departments') LOOP
    IF NOT workhub_private.p1_exact(r, ARRAY['id','name'])
       OR EXISTS (SELECT 1 FROM jsonb_each(r) e WHERE jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 4000)
       OR NOT workhub_private.p1_id_ok(r -> 'id') OR r ->> 'id' = ANY (v_ids)
       OR NOT workhub_private.p1_name_ok(r -> 'name', 50) OR workhub_private.js_trim(r ->> 'name') = ANY (v_names) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_ids := v_ids || (r ->> 'id'); v_names := v_names || workhub_private.js_trim(r ->> 'name');
  END LOOP;

  -- 학급: 2000개 이하, 이름 1~30 서로 다름, 학년 1~학년 수, 반 번호 '' 또는 1~99, (학년, 반 번호) 서로 다름, 유형 4종
  IF jsonb_typeof(p_cfg -> 'classes') <> 'array' OR jsonb_array_length(p_cfg -> 'classes') > 2000 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_names := ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_cfg -> 'classes') LOOP
    IF NOT workhub_private.p1_exact(r, ARRAY['id','grade','classNo','name','kind'])
       OR EXISTS (SELECT 1 FROM jsonb_each(r) e WHERE jsonb_typeof(e.value) <> 'string' OR length(e.value #>> '{}') > 4000)
       OR NOT workhub_private.p1_id_ok(r -> 'id') OR r ->> 'id' = ANY (v_ids)
       OR NOT workhub_private.p1_name_ok(r -> 'name', 30) OR workhub_private.js_trim(r ->> 'name') = ANY (v_names)
       OR r ->> 'grade' !~ '^[1-9][0-9]?$' OR (r ->> 'grade')::integer > v_grades
       OR (r ->> 'classNo' <> '' AND r ->> 'classNo' !~ '^[1-9][0-9]?$')
       OR r ->> 'kind' NOT IN ('regular','special','multigrade','other') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    IF r ->> 'classNo' <> '' THEN
      IF ((r ->> 'grade')::integer || ':' || (r ->> 'classNo')::integer) = ANY (v_coords) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
      v_coords := v_coords || ((r ->> 'grade')::integer || ':' || (r ->> 'classNo')::integer);
    END IF;
    v_ids := v_ids || (r ->> 'id'); v_names := v_names || workhub_private.js_trim(r ->> 'name');
  END LOOP;

  -- 교과: 200개 이하, 이름(앱 text: 원문 50자 이하·공백만 아님·제어 문자 없음) 앞뒤 공백 뺀 값 서로 다름
  IF jsonb_typeof(p_subjects) IS DISTINCT FROM 'array' OR jsonb_array_length(p_subjects) > 200 THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_names := ARRAY[]::text[];
  FOR r IN SELECT value FROM jsonb_array_elements(p_subjects) LOOP
    IF NOT workhub_private.p1_exact(r, ARRAY['id','name']) OR NOT workhub_private.p1_id_ok(r -> 'id') OR r ->> 'id' = ANY (v_ids)
       OR NOT workhub_private.p1_text_ok(r -> 'name', 50) OR workhub_private.js_trim(r ->> 'name') = ANY (v_names) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_ids := v_ids || (r ->> 'id'); v_names := v_names || workhub_private.js_trim(r ->> 'name');
  END LOOP;
END $$;

-- 명령 모양 전체 검사(앱 schoolAdminCommand). 통과하면 학년도를 돌려준다.
CREATE FUNCTION workhub_private.p1_check_command(c jsonb) RETURNS integer
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE v_kind text := c ->> 'kind'; v_year integer; s date; l date;
BEGIN
  IF workhub_private.p1_int(c -> 'expectedVersion', 1, 9007199254740991) IS NULL
     OR NOT workhub_private.p1_text_ok(c -> 'reason', 1000, true) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  IF v_kind = 'save_configuration' THEN
    IF NOT workhub_private.p1_exact(c, ARRAY['kind','expectedVersion','mode','configuration','subjects','reason'])
       OR jsonb_typeof(c -> 'mode') <> 'string' OR c ->> 'mode' NOT IN ('update','create_year') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    PERFORM workhub_private.p1_check_configuration(c -> 'configuration', c -> 'subjects');
    RETURN (c -> 'configuration' ->> 'schoolYear')::integer;
  END IF;
  v_year := workhub_private.p1_int(c -> 'schoolYear', 2020, 2100);
  IF v_year IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF v_kind = 'assign_duty' THEN
    IF NOT workhub_private.p1_exact(c, ARRAY['kind','expectedVersion','schoolYear','memberId','assignmentKind','targetId','label','startsOn','lastDay','reason'])
       OR NOT workhub_private.p1_id_ok(c -> 'memberId')
       OR jsonb_typeof(c -> 'assignmentKind') <> 'string' OR c ->> 'assignmentKind' NOT IN ('homeroom','department','subject','duty')
       OR (c ->> 'assignmentKind' = 'duty') <> (jsonb_typeof(c -> 'targetId') = 'null')
       OR (jsonb_typeof(c -> 'targetId') <> 'null' AND NOT workhub_private.p1_id_ok(c -> 'targetId'))
       OR NOT workhub_private.p1_text_ok(c -> 'label', 100) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSIF v_kind = 'end_assignment' THEN
    IF NOT workhub_private.p1_exact(c, ARRAY['kind','expectedVersion','schoolYear','assignmentId','lastDay','reason'])
       OR NOT workhub_private.p1_id_ok(c -> 'assignmentId') OR jsonb_typeof(c -> 'lastDay') <> 'string'
       OR workhub_private.p1_date(c ->> 'lastDay') IS NULL THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    RETURN v_year;
  ELSIF v_kind = 'review_membership' THEN
    IF NOT workhub_private.p1_exact(c, ARRAY['kind','expectedVersion','schoolYear','targetMemberId','decision','startsOn','lastDay','reason'])
       OR NOT workhub_private.p1_id_ok(c -> 'targetMemberId')
       OR jsonb_typeof(c -> 'decision') <> 'string' OR c ->> 'decision' NOT IN ('active','suspended','ended','rejected') THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- assign_duty · review_membership 의 기간
  IF jsonb_typeof(c -> 'startsOn') <> 'string' OR jsonb_typeof(c -> 'lastDay') <> 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  s := workhub_private.p1_date(c ->> 'startsOn'); l := workhub_private.p1_date(c ->> 'lastDay');
  IF s IS NULL OR l IS NULL OR s > l THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  RETURN v_year;
END $$;

-- 앱의 마지막 날(포함) → 저장의 종료 제외. 무기한(9999-12-31)은 NULL.
CREATE FUNCTION workhub_private.p1_end_exclusive(p_last date) RETURNS date
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_last = '9999-12-31' THEN NULL ELSE p_last + 1 END
$$;

-- ----------------------------------------------------------------------------
-- 2. 조회 — 한 트랜잭션 시점의 스냅샷
-- ----------------------------------------------------------------------------
-- 학년도 선택: 요청한 학년도, 없으면 오늘이 든 학년도 → 가장 가까운 미래 → 가장 최근 과거
CREATE FUNCTION workhub_private.p1_pick_year(p_ctx workhub_private.actor_context, p_school_year integer) RETURNS workhub.academic_years
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT y.* FROM workhub.academic_years y
  WHERE y.school_id = p_ctx.school_id AND (p_school_year IS NULL OR y.school_year = p_school_year)
  ORDER BY CASE WHEN p_ctx.school_today <@ daterange(y.starts_on, y.ends_on, '[)') THEN 0
                WHEN y.starts_on > p_ctx.school_today THEN 1 ELSE 2 END,
           CASE WHEN y.starts_on > p_ctx.school_today THEN y.starts_on - p_ctx.school_today ELSE p_ctx.school_today - y.starts_on END,
           y.school_year
  LIMIT 1
$$;

CREATE FUNCTION workhub_private.p1_snapshot(p_ctx workhub_private.actor_context, p_year_id text, p_revision bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cfg jsonb; v_members jsonb; v_assign jsonb; v_years jsonb; n bigint;
BEGIN
  SELECT count(*) INTO n FROM workhub.memberships WHERE school_id = p_ctx.school_id;
  IF n > 5000 THEN RAISE EXCEPTION 'SCHOOL_ADMIN_LIMIT' USING DETAIL = '소속 5000건 한도를 넘었습니다. 계약을 확장해야 합니다.'; END IF;
  SELECT count(*) INTO n FROM workhub.staff_assignments WHERE school_id = p_ctx.school_id AND academic_year_id = p_year_id;
  IF n > 10000 THEN RAISE EXCEPTION 'SCHOOL_ADMIN_LIMIT' USING DETAIL = '담당 10000건 한도를 넘었습니다.'; END IF;
  SELECT count(*) INTO n FROM workhub.academic_years WHERE school_id = p_ctx.school_id;
  IF n > 100 THEN RAISE EXCEPTION 'SCHOOL_ADMIN_LIMIT' USING DETAIL = '학년도 100개 한도를 넘었습니다.'; END IF;
  v_cfg := workhub_private.p1_configuration(p_ctx.school_id, p_year_id);
  SELECT COALESCE(jsonb_agg(y.school_year ORDER BY y.school_year), '[]'::jsonb) INTO v_years
    FROM workhub.academic_years y WHERE y.school_id = p_ctx.school_id;
  SELECT COALESCE(jsonb_agg(workhub_private.p1_member_dto(m, a.display_name, p_ctx.school_timezone) ORDER BY a.display_name, m.id), '[]'::jsonb)
    INTO v_members
    FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
   WHERE m.school_id = p_ctx.school_id;
  SELECT COALESCE(jsonb_agg(workhub_private.p1_assignment_dto(x) ORDER BY x.valid_from, x.kind, x.id), '[]'::jsonb) INTO v_assign
    FROM workhub.staff_assignments x WHERE x.school_id = p_ctx.school_id AND x.academic_year_id = p_year_id;
  RETURN jsonb_build_object(
    'version', p_revision,
    'asOfDate', to_char(p_ctx.school_today, 'YYYY-MM-DD'),
    'availableYears', v_years,
    'configuration', v_cfg -> 'configuration',
    'subjects', v_cfg -> 'subjects',
    'memberships', v_members,
    'assignments', v_assign,
    'capabilities', workhub_private.p1_capabilities(p_ctx));
END $$;

-- ----------------------------------------------------------------------------
-- 3. 변경 — 명령별. 모두 호출한 mutate 의 하위 블록 안에서 실행되므로, 오류면 이 요청의 변경이 전부 되돌아간다.
-- ----------------------------------------------------------------------------
-- 구성 행 동기화(부서·학급·교과 공통 규칙)
--   기존 행(같은 학교·학년도·살아 있음) = 갱신, 'draft-' 로 시작 = 새 행, 그 밖(다른 학교·학년도·지운 행) = INVALID_INPUT.
--   빠진 행은 공식 담당이 참조하면 CONFLICT, 아니면 removed_at 으로 닫는다(행·이름 이력 보존).
--   이름·번호를 서로 바꾸는 경우의 일시 중복을 피하려고, 바뀌는 행을 먼저 잠시 닫았다가 새 값으로 다시 연다.
CREATE FUNCTION workhub_private.p1_sync_rows(p_ctx workhub_private.actor_context, p_year_id text, p_table text, p_rows jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r jsonb; i integer := 0; v_now timestamptz := clock_timestamp(); v_ids text[]; v_ref text; v_bad text;
BEGIN
  SELECT COALESCE(array_agg(x ->> 'id'), ARRAY[]::text[]) INTO v_ids FROM jsonb_array_elements(p_rows) x;
  -- 알 수 없는 ID(draft- 아님 · 이 학년도의 살아 있는 행 아님)
  EXECUTE format('SELECT min(x) FROM unnest($1) x WHERE x NOT LIKE ''draft-%%'' AND NOT EXISTS (
                    SELECT 1 FROM workhub.%I t WHERE t.school_id = $2 AND t.academic_year_id = $3 AND t.id = x AND t.removed_at IS NULL)', p_table)
    INTO v_bad USING v_ids, p_ctx.school_id, p_year_id;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  -- 빠지는 행이 공식 담당에 쓰였으면 거부
  v_ref := CASE p_table WHEN 'year_departments' THEN 'department_id' WHEN 'year_classes' THEN 'class_id' ELSE 'subject_id' END;
  EXECUTE format('SELECT min(t.id) FROM workhub.%I t WHERE t.school_id = $1 AND t.academic_year_id = $2 AND t.removed_at IS NULL
                    AND NOT (t.id = ANY ($3)) AND EXISTS (SELECT 1 FROM workhub.staff_assignments a WHERE a.%I = t.id)', p_table, v_ref)
    INTO v_bad USING p_ctx.school_id, p_year_id, v_ids;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL = '공식 담당이 참조하는 구성 행은 뺄 수 없습니다.'; END IF;
  -- 빠지는 행 닫기 + 값이 바뀌는 행 잠시 닫기
  EXECUTE format('UPDATE workhub.%I t SET removed_at = $4, version = version + 1, updated_at = $4
                   WHERE t.school_id = $1 AND t.academic_year_id = $2 AND t.removed_at IS NULL AND NOT (t.id = ANY ($3))', p_table)
    USING p_ctx.school_id, p_year_id, v_ids, v_now;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    IF p_table = 'year_classes' THEN
      IF r ->> 'id' LIKE 'draft-%' THEN
        INSERT INTO workhub.year_classes (school_id, academic_year_id, grade, class_no, name, kind, sort_order)
        VALUES (p_ctx.school_id, p_year_id, (r ->> 'grade')::smallint, NULLIF(r ->> 'classNo', '')::smallint,
                workhub_private.js_trim(r ->> 'name'), r ->> 'kind', i);
      ELSE
        UPDATE workhub.year_classes SET removed_at = '-infinity'
         WHERE id = r ->> 'id' AND (grade, class_no, name, kind) IS DISTINCT FROM
               ((r ->> 'grade')::smallint, NULLIF(r ->> 'classNo', '')::smallint, workhub_private.js_trim(r ->> 'name'), r ->> 'kind');
        UPDATE workhub.year_classes SET sort_order = i, version = version + 1, updated_at = v_now
         WHERE id = r ->> 'id' AND removed_at IS NULL AND sort_order <> i;
      END IF;
    ELSE
      IF r ->> 'id' LIKE 'draft-%' THEN
        EXECUTE format('INSERT INTO workhub.%I (school_id, academic_year_id, name, sort_order) VALUES ($1, $2, $3, $4)', p_table)
          USING p_ctx.school_id, p_year_id, workhub_private.js_trim(r ->> 'name'), i;
      ELSE
        EXECUTE format('UPDATE workhub.%I SET removed_at = ''-infinity'' WHERE id = $1 AND name <> $2', p_table)
          USING r ->> 'id', workhub_private.js_trim(r ->> 'name');
        EXECUTE format('UPDATE workhub.%I SET sort_order = $2, version = version + 1, updated_at = $3 WHERE id = $1 AND removed_at IS NULL AND sort_order <> $2', p_table)
          USING r ->> 'id', i, v_now;
      END IF;
    END IF;
  END LOOP;
  -- 잠시 닫은 행을 새 값으로 다시 연다(최종 구성은 검사를 통과했으므로 서로 겹치지 않는다)
  i := 0;
  FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
    i := i + 1;
    IF p_table = 'year_classes' THEN
      UPDATE workhub.year_classes SET grade = (r ->> 'grade')::smallint, class_no = NULLIF(r ->> 'classNo', '')::smallint,
             name = workhub_private.js_trim(r ->> 'name'), kind = r ->> 'kind', sort_order = i, removed_at = NULL,
             version = version + 1, updated_at = v_now
       WHERE id = r ->> 'id' AND removed_at = '-infinity';
    ELSE
      EXECUTE format('UPDATE workhub.%I SET name = $2, sort_order = $3, removed_at = NULL, version = version + 1, updated_at = $4
                       WHERE id = $1 AND removed_at = ''-infinity''', p_table)
        USING r ->> 'id', workhub_private.js_trim(r ->> 'name'), i, v_now;
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION workhub_private.p1_save_configuration(p_ctx workhub_private.actor_context, c jsonb) RETURNS jsonb
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

CREATE FUNCTION workhub_private.p1_assign_duty(p_ctx workhub_private.actor_context, c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  y workhub.academic_years; m workhub.memberships; x workhub.staff_assignments;
  v_kind text := c ->> 'assignmentKind'; v_target text := c ->> 'targetId';
  v_from date := (c ->> 'startsOn')::date; v_to date := (c ->> 'lastDay')::date + 1;
BEGIN
  IF (c ->> 'lastDay') = '9999-12-31' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = (c ->> 'schoolYear')::smallint;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO m FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = c ->> 'memberId' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 대상 교사는 같은 학교의 재직(active) 소속, 담당 기간은 소속 기간과 학년도 안
  IF m.status <> 'active' THEN RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '재직 중인 소속에만 배정합니다.'; END IF;
  IF v_from < m.valid_from OR (m.valid_to IS NOT NULL AND v_to > m.valid_to) OR v_from < y.starts_on OR v_to > y.ends_on THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '담당 기간은 소속 기간과 학년도 안이어야 합니다.';
  END IF;
  -- 대상은 같은 학년도의 살아 있는 정의
  IF v_kind <> 'duty' AND NOT EXISTS (
       SELECT 1 FROM workhub.year_classes k WHERE v_kind = 'homeroom' AND k.school_id = p_ctx.school_id AND k.academic_year_id = y.id AND k.id = v_target AND k.removed_at IS NULL
       UNION ALL SELECT 1 FROM workhub.year_departments k WHERE v_kind = 'department' AND k.school_id = p_ctx.school_id AND k.academic_year_id = y.id AND k.id = v_target AND k.removed_at IS NULL
       UNION ALL SELECT 1 FROM workhub.year_subjects k WHERE v_kind = 'subject' AND k.school_id = p_ctx.school_id AND k.academic_year_id = y.id AND k.id = v_target AND k.removed_at IS NULL) THEN
    RAISE EXCEPTION 'NOT_FOUND';
  END IF;
  INSERT INTO workhub.staff_assignments (school_id, academic_year_id, membership_id, kind, class_id, department_id, subject_id,
                                         label, valid_from, valid_to, assigned_by_membership_id)
  VALUES (p_ctx.school_id, y.id, m.id, v_kind,
          CASE WHEN v_kind = 'homeroom' THEN v_target END, CASE WHEN v_kind = 'department' THEN v_target END,
          CASE WHEN v_kind = 'subject' THEN v_target END,
          workhub_private.js_trim(c ->> 'label'), v_from, v_to, p_ctx.membership_id)
  RETURNING * INTO x;   -- 주담임·같은 담당 기간 중복은 EXCLUDE 가 막는다 → CONFLICT
  RETURN jsonb_build_object('school_year', y.school_year, 'target_id', x.id, 'before', NULL, 'after', workhub_private.p1_assignment_dto(x));
END $$;

CREATE FUNCTION workhub_private.p1_end_assignment(p_ctx workhub_private.actor_context, c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE y workhub.academic_years; x workhub.staff_assignments; v_before jsonb; v_last date := (c ->> 'lastDay')::date;
BEGIN
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = (c ->> 'schoolYear')::smallint;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO x FROM workhub.staff_assignments WHERE school_id = p_ctx.school_id AND academic_year_id = y.id AND id = c ->> 'assignmentId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF x.status <> 'active' THEN RAISE EXCEPTION 'CONFLICT' USING DETAIL = '이미 종료일을 확정한 담당입니다.'; END IF;
  -- 시작일 ~ 기존 마지막 날 안에서만 줄인다(늘리지 않음). 과거 배정은 지우지 않는다.
  IF v_last < x.valid_from OR v_last + 1 > x.valid_to THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_before := workhub_private.p1_assignment_dto(x);
  UPDATE workhub.staff_assignments SET valid_to = v_last + 1, status = 'ended', ended_at = clock_timestamp(),
         ended_by_membership_id = p_ctx.membership_id, version = version + 1, updated_at = clock_timestamp()
   WHERE id = x.id RETURNING * INTO x;
  RETURN jsonb_build_object('school_year', y.school_year, 'target_id', x.id, 'before', v_before, 'after', workhub_private.p1_assignment_dto(x));
END $$;

CREATE FUNCTION workhub_private.p1_review_membership(p_ctx workhub_private.actor_context, c jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  y workhub.academic_years; m workhub.memberships; ac workhub.accounts; v_before jsonb;
  v_decision text := c ->> 'decision'; v_from date := (c ->> 'startsOn')::date;
  v_to date := workhub_private.p1_end_exclusive((c ->> 'lastDay')::date);
  v_status text; v_now timestamptz := clock_timestamp(); v_from_state text;
BEGIN
  SELECT * INTO y FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND school_year = (c ->> 'schoolYear')::smallint;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  SELECT * INTO m FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = c ->> 'targetMemberId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  -- 자기 소속은 바꾸지 않는다(같은 계정의 다른 소속 행도 포함)
  IF m.account_id = p_ctx.account_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO ac FROM workhub.accounts WHERE id = m.account_id;
  v_status := CASE v_decision WHEN 'ended' THEN 'left' ELSE v_decision END;
  v_from_state := m.status;
  -- 허용 전이: pending→active/rejected, active→suspended/ended(+기간 수정), suspended→active/ended(+기간 수정),
  --            left·rejected→active(새 기간). 그 밖은 INVALID_INPUT.
  IF NOT ((v_from_state = 'pending' AND v_status IN ('active','rejected'))
       OR (v_from_state = 'active' AND v_status IN ('active','suspended','left'))
       OR (v_from_state = 'suspended' AND v_status IN ('active','suspended','left'))
       OR (v_from_state IN ('left','rejected') AND v_status = 'active')) THEN
    RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '허용하지 않는 소속 상태 변경입니다.';
  END IF;
  -- 재직으로 바꿀 때: 그 사람의 기존 로그인 계정이 사용 가능하고 연결 확인이 끝나 있어야 한다(계정을 만들거나 고치지 않음)
  IF v_status = 'active' AND (ac.status <> 'active' OR ac.legacy_approval_state <> 'approved') THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '대상 계정이 사용 가능한 상태가 아닙니다.';
  END IF;
  IF v_status = 'left' AND v_to IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT' USING DETAIL = '소속 종료에는 마지막 날이 필요합니다.'; END IF;
  -- 진행 중 의무: 새 기간 밖으로 나가는 공식 담당, 중지·종료·반려 시 남은 수합 책임·검토
  IF v_status IN ('active','suspended','left') AND EXISTS (
       SELECT 1 FROM workhub.staff_assignments a WHERE a.school_id = m.school_id AND a.membership_id = m.id
         AND (a.valid_from < v_from OR (v_to IS NOT NULL AND a.valid_to > v_to)
              OR (v_status = 'suspended' AND a.valid_to > p_ctx.school_today))) THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '맡은 공식 담당을 먼저 종료하거나 인계해 주세요.';
  END IF;
  IF v_status IN ('suspended','left','rejected') AND (
       EXISTS (SELECT 1 FROM workhub.collections k WHERE k.school_id = m.school_id AND k.owner_membership_id = m.id AND k.state = 'published')
    OR EXISTS (SELECT 1 FROM workhub.collection_reviewers v JOIN workhub.collections k ON k.school_id = v.school_id AND k.id = v.collection_id
                WHERE v.school_id = m.school_id AND v.membership_id = m.id AND v.removed_at IS NULL AND k.state = 'published')) THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '게시된 수합의 책임·검토를 먼저 인계해 주세요.';
  END IF;
  -- 역할(membership_roles)은 소속 기간 안이어야 한다(R0 규칙). 새 기간이 역할 시작을 벗어나면 먼저 역할을 정리해야 한다.
  IF v_status <> 'rejected' AND EXISTS (
       SELECT 1 FROM workhub.membership_roles r WHERE r.school_id = m.school_id AND r.membership_id = m.id AND r.revoked_at IS NULL
         AND (r.valid_from < v_from OR (v_to IS NOT NULL AND r.valid_from >= v_to))) THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '새 소속 기간 밖에서 시작하는 역할이 있습니다.';
  END IF;
  -- 마지막 학교 관리자를 내보내지 않는다
  IF v_status IN ('suspended','left','rejected') AND EXISTS (
       SELECT 1 FROM workhub.membership_roles r WHERE r.school_id = m.school_id AND r.membership_id = m.id AND r.role_code = 'school_admin'
         AND r.revoked_at IS NULL AND r.scope_type = 'school' AND p_ctx.school_today <@ daterange(r.valid_from, r.valid_to, '[)'))
     AND NOT EXISTS (
       SELECT 1 FROM workhub.membership_roles r JOIN workhub.memberships o ON o.school_id = r.school_id AND o.id = r.membership_id
        WHERE r.school_id = m.school_id AND r.membership_id <> m.id AND r.role_code = 'school_admin' AND r.revoked_at IS NULL
          AND r.scope_type = 'school' AND p_ctx.school_today <@ daterange(r.valid_from, r.valid_to, '[)')
          AND o.status = 'active' AND p_ctx.school_today <@ daterange(o.valid_from, o.valid_to, '[)')) THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '마지막 학교 관리자입니다.';
  END IF;

  v_before := workhub_private.p1_member_dto(m, ac.display_name, p_ctx.school_timezone);
  IF v_status = 'rejected' THEN
    -- 반려는 기간을 쓰지 않는다(신청 기록 그대로)
    UPDATE workhub.memberships SET status = 'rejected', decided_by_membership_id = p_ctx.membership_id, decided_at = v_now,
           decision_note = c ->> 'reason', version = version + 1, updated_at = v_now
     WHERE id = m.id RETURNING * INTO m;
  ELSE
    -- 기간 중복은 R0 EXCLUDE(memberships_no_overlap)가 막는다 → CONFLICT
    UPDATE workhub.memberships SET status = v_status, valid_from = v_from, valid_to = v_to,
           left_reason = CASE WHEN v_status = 'left' THEN 'other' END,
           decided_by_membership_id = p_ctx.membership_id, decided_at = v_now,
           decision_note = c ->> 'reason', permission_version = permission_version + 1, version = version + 1, updated_at = v_now
     WHERE id = m.id RETURNING * INTO m;
    -- 기간을 줄이면 그 뒤로 남는 역할 기간도 소속 마지막 날까지로 줄인다(R0 규칙: 역할은 소속 기간 안).
    -- 종료 뒤 다시 재직이 되어도 관리 권한이 저절로 살아나지 않는다. 역할을 새로 주거나 늘리지 않는다.
    IF v_to IS NOT NULL THEN
      UPDATE workhub.membership_roles SET valid_to = v_to
       WHERE school_id = m.school_id AND membership_id = m.id AND revoked_at IS NULL AND (valid_to IS NULL OR valid_to > v_to);
    END IF;
  END IF;
  RETURN jsonb_build_object('school_year', y.school_year, 'target_id', m.id, 'before', v_before,
                            'after', workhub_private.p1_member_dto(m, ac.display_name, p_ctx.school_timezone));
END $$;

-- ----------------------------------------------------------------------------
-- 4. 공개 함수
-- ----------------------------------------------------------------------------
CREATE FUNCTION public.workhub_school_admin_readiness(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; act workhub.school_admin_activations; v jsonb;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  IF NOT workhub_private.p1_installed() THEN
    v := jsonb_build_object('available', false, 'reason', 'not_installed');
  ELSE
    SELECT * INTO act FROM workhub.school_admin_activations WHERE school_id = ctx.school_id;
    IF NOT FOUND OR act.state <> 'active' THEN
      v := jsonb_build_object('available', false, 'reason', 'not_configured');
    ELSIF NOT (workhub_private.member_has_perm(ctx, 'year.manage') OR workhub_private.member_has_perm(ctx, 'membership.approve')
               OR workhub_private.member_has_perm(ctx, 'role.grant')) THEN
      v := jsonb_build_object('available', false, 'reason', 'forbidden');
    ELSE
      v := jsonb_build_object('available', true);
    END IF;
  END IF;
  RETURN workhub_private.p1_envelope(ctx, p_member_id, v);
END $$;

CREATE FUNCTION public.workhub_school_admin_get(p_member_id text, p_school_year integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context; act workhub.school_admin_activations; y workhub.academic_years;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  SELECT * INTO act FROM workhub.school_admin_activations WHERE school_id = ctx.school_id;
  IF NOT FOUND OR act.state <> 'active' THEN RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, 'NOT_READY'); END IF;
  -- 관리 권한(구성·소속·담당 중 하나)이 없으면 학교 전체 소속 목록을 주지 않는다
  IF NOT (workhub_private.member_has_perm(ctx, 'year.manage') OR workhub_private.member_has_perm(ctx, 'membership.approve')
          OR workhub_private.member_has_perm(ctx, 'role.grant')) THEN
    RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, 'FORBIDDEN');
  END IF;
  IF p_school_year IS NOT NULL AND p_school_year NOT BETWEEN 2020 AND 2100 THEN
    RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, 'INVALID_INPUT');
  END IF;
  y := workhub_private.p1_pick_year(ctx, p_school_year);
  IF y.id IS NULL THEN RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, 'NOT_FOUND'); END IF;
  RETURN workhub_private.p1_envelope(ctx, p_member_id, workhub_private.p1_snapshot(ctx, y.id, act.revision));
END $$;

CREATE FUNCTION public.workhub_school_admin_mutate(p_member_id text, p_command jsonb, p_request_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ctx workhub_private.actor_context; act workhub.school_admin_activations; r workhub.idempotency_receipts;
  v_kind text; v_perm text; v_sha text; v_rev bigint; v_out jsonb; v_change bigint; v_school text;
BEGIN
  -- 같은 학교의 학교 관리 변경을 소속 잠금보다 먼저 줄 세운다(학교 행 갱신과 소속 공유 잠금의 교착 방지).
  SELECT school_id INTO v_school FROM workhub.memberships WHERE id = p_member_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('workhub.school_admin:' || COALESCE(v_school, '-'), 0));
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  BEGIN
    IF NOT workhub_private.p1_installed() THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    IF p_command IS NULL OR jsonb_typeof(p_command) <> 'object' OR octet_length(p_command::text) > 1500000
       OR jsonb_typeof(p_command -> 'kind') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_kind := p_command ->> 'kind';
    v_perm := CASE v_kind WHEN 'save_configuration' THEN 'year.manage' WHEN 'assign_duty' THEN 'role.grant'
                          WHEN 'end_assignment' THEN 'role.grant' WHEN 'review_membership' THEN 'membership.approve' END;
    IF v_perm IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    -- 매번 현재 권한을 먼저 본다(재전송도 권한이 회수됐으면 거부)
    IF NOT workhub_private.member_has_perm(ctx, v_perm) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
    v_sha := workhub_private.request_sha256(p_command);
    -- 같은 키 + 같은 원문 → 처음 접수증(현재 판보다 이전이어도, 활성화가 내려가 있어도). 같은 키 + 다른 원문 → IDEMPOTENCY_CONFLICT
    r := workhub_private.claim_receipt(ctx, 'school_admin.mutate', p_request_key, v_sha);
    IF r.idem_key IS NOT NULL THEN
      RETURN workhub_private.p1_envelope(ctx, p_member_id, jsonb_build_object('requestKey', p_request_key, 'kind', v_kind,
        'version', r.resource_version, 'schoolYear', r.resource_id::integer, 'recordedAt', r.result ->> 'recorded_at'));
    END IF;
    -- 새 실행: 활성화 · 모양 · 판(CAS)
    SELECT * INTO act FROM workhub.school_admin_activations WHERE school_id = ctx.school_id FOR UPDATE;
    IF NOT FOUND OR act.state <> 'active' THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    PERFORM workhub_private.p1_check_command(p_command);
    IF workhub_private.p1_int(p_command -> 'expectedVersion', 1, 9007199254740991) <> act.revision THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_rev := act.revision + 1;
    v_out := CASE v_kind
      WHEN 'save_configuration' THEN workhub_private.p1_save_configuration(ctx, p_command)
      WHEN 'assign_duty'        THEN workhub_private.p1_assign_duty(ctx, p_command)
      WHEN 'end_assignment'     THEN workhub_private.p1_end_assignment(ctx, p_command)
      ELSE                           workhub_private.p1_review_membership(ctx, p_command) END;
    UPDATE workhub.school_admin_activations SET revision = v_rev, updated_at = clock_timestamp() WHERE school_id = ctx.school_id;
    INSERT INTO workhub.school_admin_changes (school_id, revision, command_kind, school_year, target_type, target_id,
        actor_account_id, actor_membership_id, request_key, reason, before_state, after_state, school_date)
    VALUES (ctx.school_id, v_rev, v_kind, (v_out ->> 'school_year')::smallint,
        CASE v_kind WHEN 'save_configuration' THEN 'academic_year' WHEN 'review_membership' THEN 'membership' ELSE 'staff_assignment' END,
        COALESCE(v_out ->> 'target_id', v_out ->> 'year_id'), ctx.account_id, ctx.membership_id, p_request_key,
        workhub_private.js_trim(p_command ->> 'reason'), NULLIF(v_out -> 'before', 'null'::jsonb), v_out -> 'after', ctx.school_today)
    RETURNING id INTO v_change;
    PERFORM workhub_private.store_receipt(ctx, 'school_admin.mutate', p_request_key, v_sha, 'school_admin', v_out ->> 'school_year', v_rev::integer);
    PERFORM workhub_private.write_audit(ctx, 'school_admin.' || v_kind, 'school_admin', ctx.school_id, v_rev::integer, 'school', p_request_key,
      jsonb_build_object('school_year', (v_out ->> 'school_year')::integer, 'change_id', v_change));
    PERFORM workhub_private.emit_outbox(ctx, 'school_admin.changed', 'school_admin', ctx.school_id, v_rev::integer,
      jsonb_build_object('school_id', ctx.school_id, 'revision', v_rev, 'kind', v_kind));
    SELECT * INTO r FROM workhub.idempotency_receipts
     WHERE actor_key = 'a:' || ctx.account_id AND scope_key = ctx.scope_key AND operation = 'school_admin.mutate' AND idem_key = p_request_key;
    RETURN workhub_private.p1_envelope(ctx, p_member_id, jsonb_build_object('requestKey', p_request_key, 'kind', v_kind,
      'version', v_rev, 'schoolYear', (v_out ->> 'school_year')::integer, 'recordedAt', r.result ->> 'recorded_at'));
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM IN ('NOT_READY','INVALID_INPUT','FORBIDDEN','NOT_FOUND','CONFLICT','IDEMPOTENCY_CONFLICT') THEN
        RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, SQLERRM);
      END IF;
      RAISE;
    -- 동시 변경·기간 중복(EXCLUDE·UNIQUE) → 확정 거절. 하위 블록이 이미 이 요청의 변경을 되돌렸다.
    WHEN exclusion_violation OR unique_violation OR foreign_key_violation THEN
      RETURN workhub_private.p1_envelope(ctx, p_member_id, NULL, 'CONFLICT');
  END;
END $$;

COMMENT ON FUNCTION public.workhub_school_admin_readiness(text) IS '업무실 P1 학교 관리: 준비 상태(설치·학교 활성화·관리 권한).';
COMMENT ON FUNCTION public.workhub_school_admin_get(text, integer) IS '업무실 P1 학교 관리: 학년도 구성·소속·공식 담당 스냅샷.';
COMMENT ON FUNCTION public.workhub_school_admin_mutate(text, jsonb, text) IS '업무실 P1 학교 관리: 구성 저장·담당 배정/종료·소속 상태(요청 번호·학교 판·원장·감사 한 트랜잭션).';

-- ----------------------------------------------------------------------------
-- 5. 권한 — 공개 함수 3개만 authenticated 에. 내부 함수·표는 0.
-- ----------------------------------------------------------------------------
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA workhub, workhub_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.workhub_school_admin_readiness(text), public.workhub_school_admin_get(text, integer),
  public.workhub_school_admin_mutate(text, jsonb, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.workhub_school_admin_readiness(text), public.workhub_school_admin_get(text, integer),
  public.workhub_school_admin_mutate(text, jsonb, text) TO authenticated;

INSERT INTO workhub_private.p1_installs (batch, release) VALUES ('P1-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 6. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
WITH expected(name, args) AS (VALUES
  ('workhub_school_admin_readiness', 'p_member_id text'),
  ('workhub_school_admin_get', 'p_member_id text, p_school_year integer DEFAULT NULL::integer'),
  ('workhub_school_admin_mutate', 'p_member_id text, p_command jsonb, p_request_key text')),
fn AS (
  SELECT e.name, p.oid, pg_get_function_arguments(p.oid) AS args, e.args AS want, p.prosecdef, p.proconfig
  FROM expected e LEFT JOIN pg_proc p ON p.proname = e.name AND p.pronamespace = 'public'::regnamespace)
SELECT 'P1-02-1' AS no, '공개 함수 3개 · 인자 일치 · 오버로드 없음' AS item,
       CASE WHEN count(*) = 3 AND count(*) FILTER (WHERE args = want) = 3 THEN 'ok' ELSE 'FAIL' END AS status,
       count(*) FILTER (WHERE args = want)::text AS value
FROM fn
UNION ALL
SELECT 'P1-02-2', '3개 모두 SECURITY DEFINER + search_path 고정',
       CASE WHEN bool_and(prosecdef AND proconfig @> ARRAY['search_path=""']) THEN 'ok' ELSE 'FAIL' END, '' FROM fn
UNION ALL
SELECT 'P1-02-3', 'authenticated 만 실행(anon·service_role 불가)',
       CASE WHEN bool_and(has_function_privilege('authenticated', oid, 'EXECUTE') AND NOT has_function_privilege('anon', oid, 'EXECUTE')
                          AND NOT has_function_privilege('service_role', oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, '' FROM fn
UNION ALL
SELECT 'P1-02-4', '내부 함수 EXECUTE 를 가진 API 역할 0',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p, unnest(ARRAY['anon','authenticated','service_role']) r
WHERE p.pronamespace IN ('workhub'::regnamespace, 'workhub_private'::regnamespace) AND has_function_privilege(r, p.oid, 'EXECUTE')
UNION ALL
SELECT 'P1-02-5', '활성화 0개 — 모든 학교 준비 상태 not_configured',
       CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text FROM workhub.school_admin_activations
UNION ALL
SELECT 'P1-02-6', '적용 기록 P1-01·02',
       CASE WHEN workhub_private.p1_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
