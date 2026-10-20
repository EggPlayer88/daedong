-- ============================================================================
-- T1-07  시간표 1단계 보완 — 준비할 학기(대상 학기) 고르기 (비활성 설치 · 별도 승인)
--
-- ▣ 왜(2026-10-19 계란님 결정 G-1 = A)
--   T1 의 대상 학기(t1_term)는 "닫히지 않았고 아직 끝나지 않은 학기 중 오늘이 든 학기"다. 학기를 닫는(closed) 기능이 없어서
--   2학기(2026-08-13 ~ 2027-02-28)가 끝나기 전에는 2027학년도 1학기 시간표를 준비할 수 없었다.
--   이 파일은 시간표 담당자가 "준비할 학기"를 직접 고를 수 있게 한다. 고르지 않으면 지금과 똑같이 동작한다.
-- ▣ 새 계약 timetable.target.v1 (공개 함수 2개, authenticated 만, 첫 인자 p_member_id — 기존 7개 계약은 그대로)
--     workhub_timetable_target_get(p_member_id)
--       → {termId, automaticTermId, selectedTermId, version, terms:[{id, schoolYear, label, firstDay, lastDay, state, hasBasis, hasPreparationDraft}]}
--     workhub_timetable_target_set(p_member_id, p_input {termId: string|null, expectedVersion: 0 이상 정수}, p_request_key, p_recover_only)
--       → {requestKey, termId, version, effectiveTermId}
--   자세한 규칙은 T1_설계_계약.md 6절.
-- ▣ 바꾸는 것(T1 객체만 — 1~8단계 객체와 기존 표의 행은 건드리지 않는다. T1-00 지문 S1~S6 · D1 은 전후가 같아야 한다)
--   1. workhub_private.t1_term 의 본문: 고른 학기가 아직 고를 수 있는 학기(닫히지 않음 · 끝나지 않음)면 그 학기,
--      아니면 원래 규칙(t1_term_auto 로 옮김). 이름 · 인자 · 반환 · 권한 · 설정은 그대로. 이것을 부르는 T1 함수 8곳이 모두 따라온다.
--   2. 제약 2개를 넓힌다: t1_installs 의 단계(T1-07 추가) · timetable_requests 의 종류('target' 추가). 기존 값은 그대로 허용.
--   3. 새 표 workhub.timetable_term_targets(학교마다 1행) · 내부 함수 t1_target_* · t1_term_auto · 공개 함수 2개.
-- ▣ 이 파일 뒤 점검: T1-04 · T1-06 은 T1-07 을 몰라 표 · 공개 함수 · 제약 개수 행이 FAIL 로 나온다(INT-03 → T1-06 과 같은 사정).
--   T1-07 뒤에는 T1-08(사후 점검) · T1-09(통합 사후 점검)을 본다. 두 파일 모두 T1-07 전 DB 에서도 FAIL 0 이다.
-- ▣ 전제: T1-01 · T1-02 · T1-03(2026-10-18.1). 켜기(T1-05)와는 무관 — 켜기 전이든 뒤든 적용할 수 있다. 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t1_installs') IS NULL THEN RAISE EXCEPTION 'T1-07 중단: T1-01 · T1-02 · T1-03(2026-10-18.1)을 먼저 적용해 주세요.'; END IF;
  IF (SELECT count(*) FROM workhub_private.t1_installs WHERE batch IN ('T1-01','T1-02','T1-03') AND release = '2026-10-18.1') <> 3 THEN
    RAISE EXCEPTION 'T1-07 중단: T1-01 · T1-02 · T1-03(2026-10-18.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-07') THEN
    RAISE EXCEPTION 'T1-07 중단: T1-07 이 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  -- 바꿀 것이 T1-01 원본 그대로인가(누가 먼저 손댔으면 덮어쓰지 않는다)
  IF (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('workhub_private.t1_term(text, date)'))
       IS DISTINCT FROM 'f10433b8053c12ab1cb4686aa34b70ac' THEN
    RAISE EXCEPTION 'T1-07 중단: workhub_private.t1_term 이 T1-01 원본이 아닙니다. 누가 바꿨는지 먼저 확인해 주세요.';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub_private.t1_installs'::regclass AND conname = 't1_installs_batch_check')
       IS DISTINCT FROM 'CHECK ((batch = ANY (ARRAY[''T1-01''::text, ''T1-02''::text, ''T1-03''::text])))'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.timetable_requests'::regclass AND conname = 'timetable_requests_op_check')
       IS DISTINCT FROM 'CHECK ((op = ANY (ARRAY[''preparation''::text, ''save_draft''::text, ''setup''::text])))' THEN
    RAISE EXCEPTION 'T1-07 중단: t1_installs · timetable_requests 의 제약이 T1-01 원본이 아닙니다. 누가 바꿨는지 먼저 확인해 주세요.';
  END IF;
  IF to_regclass('workhub.timetable_term_targets') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_proc WHERE proname LIKE 't1\_target\_%' OR proname = 't1_term_auto' OR proname LIKE 'workhub\_timetable\_target\_%') THEN
    RAISE EXCEPTION 'T1-07 중단: 같은 이름의 표 · 함수(timetable_term_targets · t1_target_* · workhub_timetable_target_*)가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 제약 넓히기(기존 값은 그대로 허용 — 기존 행은 모두 통과한다)
-- ----------------------------------------------------------------------------
ALTER TABLE workhub_private.t1_installs DROP CONSTRAINT t1_installs_batch_check,
  ADD CONSTRAINT t1_installs_batch_check CHECK (batch IN ('T1-01','T1-02','T1-03','T1-07'));
ALTER TABLE workhub.timetable_requests DROP CONSTRAINT timetable_requests_op_check,
  ADD CONSTRAINT timetable_requests_op_check CHECK (op IN ('preparation','save_draft','setup','target'));

CREATE FUNCTION workhub_private.t1_target_installed() RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub_private.t1_installs WHERE batch = 'T1-07' AND release = '2026-10-19.1')
$$;

-- ----------------------------------------------------------------------------
-- 2. 고른 학기 — 학교마다 1행. term_id NULL = 고르지 않음(원래 규칙).
--    행을 지우지 않고 판(version)만 올린다(되돌렸다 다시 고른 것을 옛 화면이 덮어쓰지 못하게 — 판은 계속 오른다).
--    학교 관리에서 그 학기를 빼면(P1 · P8-01) 칸만 비운다(SET NULL) — 고른 학기 때문에 학기 빼기가 막히지 않는다.
-- ----------------------------------------------------------------------------
CREATE TABLE workhub.timetable_term_targets (
  school_id                text NOT NULL,
  term_id                  text,
  version                  integer NOT NULL DEFAULT 1,
  updated_by_membership_id text NOT NULL,
  updated_at               timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT timetable_term_targets_pkey PRIMARY KEY (school_id),
  CONSTRAINT timetable_term_targets_school_fkey FOREIGN KEY (school_id) REFERENCES workhub.schools(id),
  CONSTRAINT timetable_term_targets_term_fkey FOREIGN KEY (school_id, term_id) REFERENCES workhub.terms(school_id, id) ON DELETE SET NULL (term_id),
  CONSTRAINT timetable_term_targets_updater_fkey FOREIGN KEY (school_id, updated_by_membership_id) REFERENCES workhub.memberships(school_id, id),
  CONSTRAINT timetable_term_targets_version_check CHECK (version > 0)
);
ALTER TABLE workhub.timetable_term_targets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON workhub.timetable_term_targets FROM PUBLIC, anon, authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. 대상 학기
-- ----------------------------------------------------------------------------
-- 원래 규칙(T1-01 의 t1_term 본문 그대로): 닫히지 않았고 아직 끝나지 않은 학기 중 오늘이 든 학기, 없으면 가장 먼저 시작하는 다음 학기.
CREATE FUNCTION workhub_private.t1_term_auto(p_school text, p_today date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT t.id FROM workhub.terms t
   WHERE t.school_id = p_school AND t.state <> 'closed' AND t.ends_on > p_today
   ORDER BY (t.starts_on <= p_today) DESC, t.starts_on, t.id LIMIT 1
$$;

-- 대상 학기: 담당자가 고른 학기가 아직 고를 수 있으면(닫히지 않음 · 끝나지 않음) 그 학기, 아니면 원래 규칙.
--   시간표 준비 · 입력 · 기준판 · 편성 초안 함수 8곳이 이 함수 하나로 대상 학기를 정한다(T1-03 그대로).
--   ※ T2 의 공개 시간표(교사가 보는 "지금 학기")는 이 함수가 아니라 t1_term_auto 를 쓴다(준비 중인 다음 학기를 지금 시간표로 보이지 않게).
CREATE OR REPLACE FUNCTION workhub_private.t1_term(p_school text, p_today date) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT t.id FROM workhub.timetable_term_targets g JOIN workhub.terms t ON t.school_id = g.school_id AND t.id = g.term_id
      WHERE g.school_id = p_school AND t.state <> 'closed' AND t.ends_on > p_today),
    workhub_private.t1_term_auto(p_school, p_today))
$$;

-- 고를 수 있는 학기: 같은 학교 · 닫히지 않음 · 아직 끝나지 않음(진행 중 학기 + 앞으로 올 학기). 시작일 순, 20개까지.
CREATE FUNCTION workhub_private.t1_target_terms(p_school text, p_today date) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', t.id, 'schoolYear', y.school_year, 'label', t.label,
           'firstDay', workhub_private.p5_day(t.starts_on), 'lastDay', workhub_private.p5_last(t.ends_on), 'state', t.state,
           'hasBasis', t.current_timetable_basis_id IS NOT NULL,
           'hasPreparationDraft', EXISTS (SELECT 1 FROM workhub.timetable_prep_drafts d WHERE d.school_id = t.school_id AND d.term_id = t.id))
         ORDER BY t.starts_on, t.id), '[]'::jsonb)
    FROM (SELECT * FROM workhub.terms x WHERE x.school_id = p_school AND x.state <> 'closed' AND x.ends_on > p_today
           ORDER BY x.starts_on, x.id LIMIT 20) t
    JOIN workhub.academic_years y ON y.school_id = t.school_id AND y.id = t.academic_year_id
$$;

-- ----------------------------------------------------------------------------
-- 4. timetable.target.v1 — 조회 · 고르기
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.t1_target_get(p_ctx workhub_private.actor_context) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE g workhub.timetable_term_targets;
BEGIN
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO g FROM workhub.timetable_term_targets WHERE school_id = p_ctx.school_id;
  RETURN jsonb_build_object(
    'termId', workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today),
    'automaticTermId', workhub_private.t1_term_auto(p_ctx.school_id, p_ctx.school_today),
    'selectedTermId', g.term_id,
    'version', COALESCE(g.version, 0),
    'terms', workhub_private.t1_target_terms(p_ctx.school_id, p_ctx.school_today));
END $$;

-- 고르기: termId = 고를 학기(null 이면 고르지 않음 = 원래 규칙으로), expectedVersion = 조회한 version(처음이면 0).
--   다른 담당자가 그사이 바꿨으면 CONFLICT. 없는 학기 · 다른 학교 학기 NOT_FOUND, 닫혔거나 끝난 학기 CONFLICT.
--   대상 학기가 바뀌면 다른 화면이 들고 있던 준비 원본 · 기준판은 기존 검사(termId · 지문 · 기준판 판 대조)로 CONFLICT 가 된다.
CREATE FUNCTION workhub_private.t1_target_set(p_ctx workhub_private.actor_context, i jsonb, p_key text, p_recover boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_hash text := workhub_private.p2_sha(i); v jsonb; g workhub.timetable_term_targets; t workhub.terms; v_new text; v_eff text;
BEGIN
  v := workhub_private.t1_claim(p_ctx, 'target', p_key, v_hash);
  IF v IS NOT NULL THEN RETURN v; END IF;
  IF p_recover IS NULL THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  IF p_recover THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF NOT workhub_private.t1_ready(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF NOT workhub_private.p5_manager(p_ctx) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT workhub_private.p2_exact(i, ARRAY['termId','expectedVersion'])
     OR NOT (i -> 'termId' = 'null'::jsonb OR workhub_private.p7_id(i -> 'termId'))
     OR NOT workhub_private.p2_int(i -> 'expectedVersion', 0, 2147483647) THEN
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;
  -- 준비 저장 · 확정 · 입력과 같은 학교 잠금 안에서 바꾼다(그사이 대상 학기가 바뀐 채 저장되지 않게)
  PERFORM workhub_private.t1_lock(p_ctx.school_id);
  SELECT * INTO g FROM workhub.timetable_term_targets WHERE school_id = p_ctx.school_id FOR UPDATE;
  IF COALESCE(g.version, 0) <> (i ->> 'expectedVersion')::integer THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  v_new := i ->> 'termId';
  IF v_new IS NOT NULL THEN
    SELECT * INTO t FROM workhub.terms WHERE school_id = p_ctx.school_id AND id = v_new FOR SHARE;
    IF t.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
    IF t.state = 'closed' OR t.ends_on <= p_ctx.school_today THEN RAISE EXCEPTION 'CONFLICT'; END IF;
  END IF;
  IF g.school_id IS NULL AND v_new IS NOT NULL THEN
    INSERT INTO workhub.timetable_term_targets (school_id, term_id, updated_by_membership_id) VALUES (p_ctx.school_id, v_new, p_ctx.membership_id)
    RETURNING * INTO g;
    PERFORM workhub_private.write_audit(p_ctx, 'timetable.target_set', 'timetable_term_target', p_ctx.school_id, g.version, 'school', p_key,
      jsonb_build_object('termId', v_new, 'previousTermId', NULL));
  ELSIF g.school_id IS NOT NULL AND g.term_id IS DISTINCT FROM v_new THEN
    v_eff := g.term_id;   -- 바꾸기 전 학기(감사 기록용)
    UPDATE workhub.timetable_term_targets SET term_id = v_new, version = version + 1, updated_by_membership_id = p_ctx.membership_id,
           updated_at = clock_timestamp()
     WHERE school_id = p_ctx.school_id RETURNING * INTO g;
    PERFORM workhub_private.write_audit(p_ctx, 'timetable.target_set', 'timetable_term_target', p_ctx.school_id, g.version, 'school', p_key,
      jsonb_build_object('termId', v_new, 'previousTermId', v_eff));
  END IF;
  -- 같은 학기를 다시 고르면 아무것도 바꾸지 않는다(판도 그대로)
  v_eff := workhub_private.t1_term(p_ctx.school_id, p_ctx.school_today);
  v := jsonb_build_object('requestKey', p_key, 'termId', g.term_id, 'version', COALESCE(g.version, 0), 'effectiveTermId', v_eff);
  PERFORM workhub_private.t1_record(p_ctx, 'target', p_key, v_hash, v);
  RETURN v;
END $$;

-- 봉투 — T1-03 의 t1_run 과 같은 규칙(업무 코드는 {error:{code}}, 동시 실행 경합은 CONFLICT)
CREATE FUNCTION workhub_private.t1_target_run(p_ctx workhub_private.actor_context, p_op text, a jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb;
BEGIN
  IF NOT workhub_private.t1_target_installed() THEN RETURN workhub_private.p7_err(p_ctx, 'timetable.target.v1', 'NOT_READY'); END IF;
  BEGIN
    IF p_op = 'get' THEN v := workhub_private.t1_target_get(p_ctx);
    ELSIF p_op = 'set' THEN v := workhub_private.t1_target_set(p_ctx, a -> 'input', a ->> 'key', (a ->> 'recover')::boolean);
    ELSE RAISE EXCEPTION 'T1_UNKNOWN_OPERATION';
    END IF;
    RETURN workhub_private.p7_ok(p_ctx, 'timetable.target.v1', v);
  EXCEPTION
    WHEN raise_exception THEN
      IF workhub_private.p7_business(SQLERRM) THEN RETURN workhub_private.p7_err(p_ctx, 'timetable.target.v1', SQLERRM); END IF;
      RAISE;
    WHEN unique_violation OR exclusion_violation OR deadlock_detected OR serialization_failure OR foreign_key_violation THEN
      RETURN workhub_private.p7_err(p_ctx, 'timetable.target.v1', 'CONFLICT');
  END;
END $$;

CREATE FUNCTION public.workhub_timetable_target_get(p_member_id text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, false);
  RETURN workhub_private.t1_target_run(ctx, 'get', '{}'::jsonb);
END $$;

CREATE FUNCTION public.workhub_timetable_target_set(p_member_id text, p_input jsonb, p_request_key text, p_recover_only boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ctx workhub_private.actor_context;
BEGIN
  ctx := workhub_private.member_actor(p_member_id, true);
  PERFORM workhub_private.lock_member_roles(ctx);
  RETURN workhub_private.t1_target_run(ctx, 'set', jsonb_build_object('input', p_input, 'key', p_request_key, 'recover', p_recover_only));
END $$;

COMMENT ON TABLE workhub.timetable_term_targets IS '업무실 T1-07 시간표: 담당자가 고른 준비 대상 학기(학교마다 1행, term_id NULL = 고르지 않음).';
COMMENT ON FUNCTION public.workhub_timetable_target_get(text) IS '업무실 T1-07 시간표: 준비 대상 학기(고른 학기 · 원래 규칙 학기)와 고를 수 있는 학기 목록(담당자).';
COMMENT ON FUNCTION public.workhub_timetable_target_set(text, jsonb, text, boolean) IS '업무실 T1-07 시간표: 준비 대상 학기 고르기 · 되돌리기(판 비교 · 요청 번호 · 복구 조회).';

-- ----------------------------------------------------------------------------
-- 5. 권한 — 새 공개 함수 2개만 authenticated 에. 새 내부 함수는 API 역할 실행 불가. t1_term 은 바꾼 뒤에도 원래 권한 그대로(CREATE OR REPLACE).
-- ----------------------------------------------------------------------------
DO $$
DECLARE f regprocedure;
BEGIN
  FOR f IN SELECT p.oid::regprocedure FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE (n.nspname = 'workhub_private' AND (p.proname LIKE 't1\_target\_%' OR p.proname = 't1_term_auto'))
               OR (n.nspname = 'public' AND p.proname LIKE 'workhub\_timetable\_target\_%') LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', f);
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.workhub_timetable_target_get(text), public.workhub_timetable_target_set(text, jsonb, text, boolean) TO authenticated;
END $$;

INSERT INTO workhub_private.t1_installs (batch, release) VALUES ('T1-07', '2026-10-19.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 6. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'T1-07-1' AS no, '새 표 timetable_term_targets: RLS 켜짐 · API 역할 · PUBLIC 권한 0' AS item,
       CASE WHEN (SELECT relrowsecurity FROM pg_class WHERE oid = 'workhub.timetable_term_targets'::regclass)
             AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) k
                              WHERE has_table_privilege(r, 'workhub.timetable_term_targets'::regclass, k))
             AND NOT EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid = 'workhub.timetable_term_targets'::regclass
                              AND (a.grantee = 0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))) THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'T1-07-2', '공개 함수 2개 authenticated 만 · 내부 함수(t1_*) API 역할 실행 불가',
       CASE WHEN (SELECT count(*) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'workhub\_timetable\_target\_%'
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE') AND NOT has_function_privilege('anon', p.oid, 'EXECUTE')
                    AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) = 2
             AND NOT EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace AND p.proname LIKE 't1\_%'
                               AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE')
                                    OR has_function_privilege('service_role', p.oid, 'EXECUTE'))) THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-07-3', '아직 고른 학기 없음(모든 학교가 원래 규칙)',
       CASE WHEN NOT EXISTS (SELECT 1 FROM workhub.timetable_term_targets) THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'T1-07-4', '적용 기록 T1-07', CASE WHEN workhub_private.t1_target_installed() THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
