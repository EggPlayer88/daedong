-- ============================================================================
-- P1-04  학교 관리 — 학교 활성화 (양식) · 관리 권한 경계를 여는 일이므로 계란님 승인 뒤에만 실행한다.
--
-- ▣ 언제: 아래가 모두 끝난 뒤에만.
--   1) P1-00(전) → P1-01 → P1-02 → P1-03 → P1-00(후) 결과가 모두 정상
--   2) 학교 관리 화면(PR #48)이 병합·배포되었고 그 배포에서 화면이 "연결 준비 필요"로 보이는 것을 확인
-- ▣ 무엇을 쓰나: 이 학교의 활성화 1행(판 1 · 승인자 · 승인 근거)과 감사 1건. 이 행이 생기면 이 학교의 학교 관리자가
--   학년도 구성·교사 소속·공식 담당을 이 화면에서 바꿀 수 있다. 관리자 역할 자체는 새로 주지 않는다(R0 역할 그대로).
-- ▣ 쓰지 않는 것: 회원·로그인·가입 승인·역할·기존 학년도/학기/소속 자료.
-- ▣ 시작 전 확인: 학교 상태·학년 수(학교급 범위)·학년도·학기가 앱이 받을 수 있는 모양인지. 아니면 아무것도 쓰지 않고 멈춘다.
-- ▣ <...> 칸을 모두 채워야 실행된다. 끄기: P1-80 · 다시 켜기: P1-81. 이 파일은 다시 실행하지 않는다.
--
-- 칸 설명 — 값은 계란님이 정한다.
--   approver_user_id   승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교는 이 사람이 지금 관리자인 학교 1곳.
--   approval_ref       승인 근거 1~200자 (예: "2026-10-20 교무회의, 학교 관리 화면 운영 승인")
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_school text; v_today date; v_bad text; ctx workhub_private.actor_context;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P1-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.p1_installs') IS NULL OR to_regprocedure('workhub_private.p1_installed()') IS NULL THEN
    RAISE EXCEPTION 'P1-04 중단: P1-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p1_installed() THEN
    RAISE EXCEPTION 'P1-04 중단: P1-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P1-04 중단: 승인 근거는 1~200자입니다.'; END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  -- 승인자가 오늘 학교 관리자(school_admin, 학교 범위)인 활성 학교. 둘 이상이면 고를 수 없으므로 멈춘다.
  IF a.id IS NOT NULL AND (SELECT count(DISTINCT m2.school_id) FROM workhub.memberships m2
        JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
        JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin'
         AND r2.scope_type = 'school' AND r2.revoked_at IS NULL AND workhub_private.today_in(s2.timezone) <@ daterange(r2.valid_from, r2.valid_to, '[)')
       WHERE m2.account_id = a.id AND m2.status = 'active' AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')) > 1 THEN
    RAISE EXCEPTION 'P1-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.';
  END IF;
  SELECT m2.* INTO m FROM workhub.memberships m2
    JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
    JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin'
     AND r2.scope_type = 'school' AND r2.revoked_at IS NULL AND workhub_private.today_in(s2.timezone) <@ daterange(r2.valid_from, r2.valid_to, '[)')
   WHERE m2.account_id = a.id AND m2.status = 'active' AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
   LIMIT 1;
  IF a.id IS NULL OR m.id IS NULL THEN RAISE EXCEPTION 'P1-04 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id FOR UPDATE;
  v_today := workhub_private.today_in(s.timezone);
  IF EXISTS (SELECT 1 FROM workhub.school_admin_activations WHERE school_id = s.id) THEN
    RAISE EXCEPTION 'P1-04 중단: 이 학교는 이미 활성화 행이 있습니다(다시 켜려면 P1-81).';
  END IF;
  -- 앱이 받을 수 있는 모양인지(school-admin-contract.ts schoolAdminSnapshot · validateSetupDraft)
  IF s.grade_count > workhub_private.p1_grade_limit(s.school_level) THEN
    RAISE EXCEPTION 'P1-04 중단: 학년 수(%)가 학교급(%) 범위를 넘습니다.', s.grade_count, s.school_level;
  END IF;
  IF length(btrim(s.name)) > 100 OR s.name ~ '[\x01-\x1f\x7f]' OR s.code !~ '^[A-Za-z0-9_-]{2,40}$' THEN
    RAISE EXCEPTION 'P1-04 중단: 학교 이름·코드가 앱 형식과 맞지 않습니다.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub.academic_years WHERE school_id = s.id) THEN RAISE EXCEPTION 'P1-04 중단: 학년도가 없습니다.'; END IF;
  IF (SELECT count(*) FROM workhub.academic_years WHERE school_id = s.id) > 100 THEN RAISE EXCEPTION 'P1-04 중단: 학년도가 100개를 넘습니다.'; END IF;
  SELECT string_agg(y.school_year::text, ', ' ORDER BY y.school_year) INTO v_bad FROM workhub.academic_years y
   WHERE y.school_id = s.id AND (SELECT count(*) FROM workhub.terms t WHERE t.academic_year_id = y.id) NOT BETWEEN 1 AND 4;
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'P1-04 중단: 학기가 1~4개가 아닌 학년도가 있습니다(%).', v_bad; END IF;
  SELECT string_agg(t.id, ', ') INTO v_bad FROM workhub.terms t
   WHERE t.school_id = s.id AND (t.label <> btrim(t.label) OR t.label ~ '[\x01-\x1f\x7f]'
      OR (SELECT count(*) FROM workhub.terms o WHERE o.academic_year_id = t.academic_year_id AND btrim(o.label) = btrim(t.label)) > 1);
  IF v_bad IS NOT NULL THEN RAISE EXCEPTION 'P1-04 중단: 학기 이름이 앱 형식과 맞지 않습니다(%).', v_bad; END IF;
  IF (SELECT count(*) FROM workhub.memberships WHERE school_id = s.id) > 5000 THEN RAISE EXCEPTION 'P1-04 중단: 소속이 5000건을 넘습니다.'; END IF;

  INSERT INTO workhub.school_admin_activations (school_id, state, revision, approved_by_membership_id, approval_ref)
  VALUES (s.id, 'active', 1, m.id, btrim(p ->> 'approval_ref'));
  ctx := ROW('member', a.id, m.id, NULL, s.id, 's:' || s.id, a.auth_user_id, v_today, s.timezone)::workhub_private.actor_context;
  PERFORM workhub_private.write_audit(ctx, 'school_admin.activate', 'school_admin', s.id, 1, 'school', NULL,
    jsonb_build_object('approval_ref', left(btrim(p ->> 'approval_ref'), 200)));
  RAISE NOTICE 'P1-04: % 학교의 학교 관리를 켰습니다(판 1).', s.code;
END $do$;

-- 확인(읽기 전용) — state = active, revision = 1
SELECT s.code, a.state, a.revision, a.approval_ref, a.activated_at
  FROM workhub.school_admin_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY s.code;
