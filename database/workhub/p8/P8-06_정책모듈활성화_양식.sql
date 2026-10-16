-- ============================================================================
-- P8-06  정책 보강 모듈 켜기 — 학교 1곳의 협업 알림 · 업무 인계 관리자 확인 · 수업 담당/수강 변경을 켠다. 별도 승인 뒤에만.
--
-- ▣ 언제: PR #60(앱) 이 병합 · 배포된 "뒤", 학교가 승인했을 때. P8-01~04 적용과 같은 날 실행하지 않는다.
--   옛 앱(PR #48 · #59)은 이 세 기능의 새 응답(cooperation 출처 알림 · 업무 인계 새 목록 모양 · 관계 변경)을 읽지 못한다 →
--   옛 앱이 운영 중이면 켜지 않는다. 그래서 배포 확인 칸(app_deploy_ref)을 비워 둘 수 없게 했다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다. 기본값은 없다.
--   approver_user_id : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref     : 승인 근거 1~200자
--   app_deploy_ref   : PR #60 이상이 운영에 배포되었음을 확인한 근거 1~200자(배포 주소 · 커밋 · 확인한 날). 확인하지 않았으면 실행하지 않는다.
--   modules          : 켤 모듈(1~3개, 중복 없이)
--                      "cooperation_notices" 협업 요청 상태가 바뀔 때 상대 교사에게 사이트 안 알림(P8-02 필요, 메신저 P3 준비 상태에서만 동작)
--                      "duty_admin_review"   공식 담당이 든 업무 인계를 학교 관리자 확인 → 받는 사람 수락 순서로(P8-03 필요).
--                                            켜기 전에는 공식 담당 인계가 막혀 있다(NOT_READY). 켜면 업무 인계 목록이 새 모양이 된다.
--                      "teaching_relations"  수업 담당 교체 · 종료, 수강 종료 · 전출(P8-04 필요, 수업 P5 가 준비 상태에서만 동작)
-- ▣ 쓰는 것: module_activations 의 모듈별 1행 + 감사 1건씩(배포 확인 근거 포함). 이미 행이 있는 모듈은 멈춘다(다시 켜려면 P2-81).
-- ▣ 끄기 · 다시 켜기는 P2-80 · P2-81 을 그대로 쓴다(모듈 이름만 위 셋 중 하나). 자료는 지우지 않는다.
--   duty_admin_review 를 끄면(중지) 확인 · 공식 담당 수락이 NOT_READY 가 되고 목록은 새 모양(dutyApproval null)을 유지한다.
-- ▣ 메뉴 공개 범위는 바꾸지 않는다(지금처럼 superadmin 만 업무실에 들어온다). 비서(P6) 켜기와 무관하다.
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "app_deploy_ref": "<PR #60 이상 운영 배포 확인 근거>",
  "modules": ["<cooperation_notices · duty_admin_review · teaching_relations 중 켤 것>"]
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_mod text; v_n integer;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P8-06 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.p8_installs') IS NULL OR to_regprocedure('workhub_private.p8_installed(text)') IS NULL THEN
    RAISE EXCEPTION 'P8-06 중단: P8-01(2026-10-16.1)이 적용되어 있지 않습니다.';
  END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P8-06 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF length(btrim(COALESCE(p ->> 'app_deploy_ref', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'P8-06 중단: 앱 배포 확인 근거(app_deploy_ref)는 1~200자입니다. PR #60 배포를 확인하지 않았으면 켜지 않습니다.';
  END IF;
  IF jsonb_typeof(p -> 'modules') IS DISTINCT FROM 'array' OR jsonb_array_length(p -> 'modules') NOT BETWEEN 1 AND 3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'modules') x WHERE jsonb_typeof(x) <> 'string'
                  OR x #>> '{}' NOT IN ('cooperation_notices','duty_admin_review','teaching_relations'))
     OR (SELECT count(DISTINCT x) FROM jsonb_array_elements_text(p -> 'modules') x) <> jsonb_array_length(p -> 'modules') THEN
    RAISE EXCEPTION 'P8-06 중단: modules 는 "cooperation_notices" · "duty_admin_review" · "teaching_relations" 중 1~3개(중복 없이)입니다.';
  END IF;
  FOR v_mod IN SELECT x FROM jsonb_array_elements_text(p -> 'modules') x LOOP
    IF NOT workhub_private.p8_installed(CASE v_mod WHEN 'cooperation_notices' THEN 'P8-02' WHEN 'duty_admin_review' THEN 'P8-03' ELSE 'P8-04' END) THEN
      RAISE EXCEPTION 'P8-06 중단: % 모듈의 SQL(%)이 적용되어 있지 않습니다. 아무것도 쓰지 않았습니다.', v_mod,
        CASE v_mod WHEN 'cooperation_notices' THEN 'P8-02' WHEN 'duty_admin_review' THEN 'P8-03' ELSE 'P8-04' END;
    END IF;
  END LOOP;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P8-06 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P8-06 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P8-06 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P8-06 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  FOR v_mod IN SELECT x FROM jsonb_array_elements_text(p -> 'modules') x LOOP
    IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = v_mod) THEN
      RAISE EXCEPTION 'P8-06 중단: % 모듈은 이 학교에 이미 활성화 행이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.', v_mod;
    END IF;
    INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
    VALUES (s.id, v_mod, 'active', m.id, btrim(p ->> 'approval_ref'));
    INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
        sensitivity, details, scope_key)
    VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':' || v_mod, 'school',
        jsonb_build_object('module', v_mod, 'approval_ref', left(btrim(p ->> 'approval_ref'), 200),
                           'app_deploy_ref', left(btrim(p ->> 'app_deploy_ref'), 200), 'by', session_user), 's:' || s.id);
  END LOOP;
  RAISE NOTICE 'P8-06: % 학교에 % 를 켰습니다.', s.code, p -> 'modules';
END $do$;

-- 확인(읽기 전용)
SELECT s.code, a.module, a.state, a.activated_at FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY s.code, a.module;
