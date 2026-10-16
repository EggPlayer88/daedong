-- ============================================================================
-- P5-04  수업·학생 켜기 — 학교 1곳의 teaching 모듈을 켜고 수업 정책 1행을 쓴다. 별도 승인 뒤에만.
--
-- ▣ 언제: PR #48(앱) 병합·배포 뒤, 학교가 승인했을 때. P5-01·02 적용과 같은 날 실행하지 않는다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다. 예시값을 넣어 두지 않았다.
--   approver_user_id  : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref      : 승인 근거 1~200자 (예: 날짜·회의·결정 내용)
--   counseling_scope  : 상담 기록을 쓸 수 있는 사람. 둘 중 하나를 학교가 정한다.
--                       off(아무도 — 상담 탭 닫힘) · course_teachers(그 수업의 현재 담당 교사가 자기 상담만)
--                       관리자 역할은 어느 쪽이든 다른 교사의 상담을 볼 수 없다.
-- ▣ 쓰는 것: module_activations 의 teaching 1행 + teaching_policies 1행 + 감사 1건. 정책은 고칠 수 없다(바꾸려면 새 배치).
-- ▣ 수업 만들기·담당 지정 권한 = 학교 관리자(year.manage). 새 역할·권한을 만들지 않는다(P5_설계결정 D-P5-1).
-- ▣ 메뉴 공개 범위는 바꾸지 않는다(앱 modules.js 는 계란님 승인 사항).
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "counseling_scope": "<off · course_teachers 중 하나>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_n integer;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P5-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regprocedure('workhub_private.p5_installed()') IS NULL THEN
    RAISE EXCEPTION 'P5-04 중단: P5-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p5_installed() THEN
    RAISE EXCEPTION 'P5-04 중단: P5-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P5-04 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF jsonb_typeof(p -> 'counseling_scope') IS DISTINCT FROM 'string' OR p ->> 'counseling_scope' NOT IN ('off','course_teachers') THEN
    RAISE EXCEPTION 'P5-04 중단: counseling_scope 는 off · course_teachers 중 하나입니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P5-04 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P5-04 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P5-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P5-04 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = 'teaching')
     OR EXISTS (SELECT 1 FROM workhub.teaching_policies WHERE school_id = s.id) THEN
    RAISE EXCEPTION 'P5-04 중단: 이 학교에 이미 수업 모듈 활성화·정책이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.';
  END IF;
  INSERT INTO workhub.teaching_policies (school_id, counseling_scope, approved_by_membership_id, approval_ref)
  VALUES (s.id, p ->> 'counseling_scope', m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
  VALUES (s.id, 'teaching', 'active', m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':teaching', 'school',
      jsonb_build_object('module', 'teaching', 'approval_ref', left(btrim(p ->> 'approval_ref'), 200), 'by', session_user,
                         'counseling_scope', p ->> 'counseling_scope'), 's:' || s.id);
  RAISE NOTICE 'P5-04: % 학교의 수업·학생을 켰습니다(상담: %).', s.code, p ->> 'counseling_scope';
END $do$;

-- 확인(읽기 전용): ready 여야 한다
SELECT s.code, workhub_private.p5_reason(s.id) AS teaching, p.counseling_scope
  FROM workhub.schools s LEFT JOIN workhub.teaching_policies p ON p.school_id = s.id ORDER BY s.code;
