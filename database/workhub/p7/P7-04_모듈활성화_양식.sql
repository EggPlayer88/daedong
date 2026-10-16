-- ============================================================================
-- P7-04  모듈 활성화 — 학교 1곳의 수합 운영 · 홈 요약 · 업무 전환(인계 · 새 학년도) · 공식 담당 인계를 켠다. 별도 승인 뒤에만.
--
-- ▣ 언제: PR #48(앱) 병합·배포 뒤, 학교가 승인했을 때. P7-01·02 적용과 같은 날 실행하지 않는다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다.
--   approver_user_id : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref     : 승인 근거 1~200자
--   modules          : 켤 모듈 목록(1~4개, 중복 없이). 기본값은 없다.
--                      "collection_ops" 수합 운영(제출 현황 · 제출 알림. 마감 · 연장은 P7-05 뒤)
--                      "home"           홈 요약
--                      "transitions"    업무 인계 · 새 학년도 기록
--                      "duty_handover"  교사끼리 공식 담당(일반 업무)을 넘기는 것 — 받는 사람이 수락하면 학교 관리 판이 바뀐다.
--                                       학교 관리자 승인 없이 교사가 공식 담당을 넘기는 것을 허용할지 학교가 정해야 한다.
-- ▣ 쓰는 것: module_activations 의 모듈별 1행 + 감사 1건씩. 이미 행이 있는 모듈은 멈춘다(다시 켜려면 P2-81).
-- ▣ 끄기 · 다시 켜기는 P2-80 · P2-81 을 그대로 쓴다(모듈 이름만 위 넷 중 하나). 자료는 지우지 않는다.
-- ▣ 메뉴 공개 범위는 바꾸지 않는다(지금처럼 superadmin 만 업무실에 들어온다).
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "modules": ["<collection_ops · home · transitions · duty_handover 중 켤 것>"]
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_mod text; v_n integer;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P7-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.p7_installs') IS NULL OR to_regprocedure('workhub_private.p7_installed()') IS NULL THEN
    RAISE EXCEPTION 'P7-04 중단: P7-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p7_installed() THEN RAISE EXCEPTION 'P7-04 중단: P7-01·02(2026-10-16.1)가 적용되어 있지 않습니다.'; END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P7-04 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF jsonb_typeof(p -> 'modules') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'modules') NOT BETWEEN 1 AND 4
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'modules') x WHERE jsonb_typeof(x) <> 'string' OR x #>> '{}' NOT IN ('collection_ops','home','transitions','duty_handover'))
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p -> 'modules') x) <> jsonb_array_length(p -> 'modules') THEN
    RAISE EXCEPTION 'P7-04 중단: modules 는 "collection_ops" · "home" · "transitions" · "duty_handover" 중 1~4개(중복 없이)입니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P7-04 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P7-04 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P7-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P7-04 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  FOR v_mod IN SELECT x FROM jsonb_array_elements_text(p -> 'modules') x LOOP
    IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = v_mod) THEN
      RAISE EXCEPTION 'P7-04 중단: % 모듈은 이 학교에 이미 활성화 행이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.', v_mod;
    END IF;
    INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
    VALUES (s.id, v_mod, 'active', m.id, btrim(p ->> 'approval_ref'));
    INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
        sensitivity, details, scope_key)
    VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':' || v_mod, 'school',
        jsonb_build_object('module', v_mod, 'approval_ref', left(btrim(p ->> 'approval_ref'), 200), 'by', session_user), 's:' || s.id);
  END LOOP;
  RAISE NOTICE 'P7-04: % 학교에 % 를 켰습니다.', s.code, p -> 'modules';
END $do$;

-- 확인(읽기 전용)
SELECT s.code, a.module, a.state, a.activated_at FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY s.code, a.module;
