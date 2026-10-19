-- ============================================================================
-- R1S-04  HWPX 기본 확인 — 학교 활성화 (양식) · 인증·보안 경계 변경이므로 계란님 승인 뒤에만 실행한다.
--
-- ▣ 언제: 아래가 모두 끝난 뒤에만.
--   1) R1S-00(전) → R1S-01 → R1S-02 → R1S-03 → R1S-00(후) 결과가 모두 정상
--   2) PR #45(서버 확인 API)와 R1S 를 쓰는 화면이 병합·배포되었고, Vercel 운영 배포에서
--      SUPABASE_SERVICE_ROLE_KEY 가 Production 범위에만 서버 환경 변수로 등록되어 있음을 확인
--   3) 그 배포 주소에서 실제 HWPX 파일 1개로 확인 API 가 응답하는 것을 확인(실행안내 6절)
-- ▣ 무엇을 쓰나
--   - 서비스 주체 svc_hwpx_basic(작업: file.basic_check 하나뿐 — 검증·정리 권한 없음) 1개와 이 학교 범위 승인 1개
--   - 이 학교의 활성화 1행(승인 근거·승인자·배포 확인값). 이 행이 생기는 순간부터 이 학교의 쓰기 판정은
--     "검증 작업자 heartbeat" 대신 "기본 확인 프로필"을 본다. 미검사 허용(allowUnscanned)은 켜지 않는다.
--   - policies 가 "existing" 이 아니면 정책 3종을 새로 게시한다(R1-06 과 같은 규칙 + HWPX 포함 · 미검사 불허).
-- ▣ 쓰지 않는 것: 회원·로그인·기존 자료·R0 일정/업무·수합 자료·파일 실물·Storage. R1-05 연결(api_role_principals)도 만들지 않는다.
-- ▣ <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다.
-- ▣ 끄기: R1S-80(학교별 중지) · 다시 켜기: R1S-81. 이 파일은 다시 실행하지 않는다(이미 활성화 행이 있으면 멈춤).
--
-- 칸 설명 — 값은 계란님이 정한다. 이 파일은 어떤 값도 정해 두지 않는다.
--   approver_user_id       승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교는 이 사람이 관리자인 학교 1곳.
--   approval_ref           승인 근거 1~200자 (예: "2026-10-20 교무회의, 악성코드 검사 없는 HWPX 기본 확인 운영 승인")
--   deployment_ref         확인 API 배포 확인값 1~200자 (예: "Vercel 운영 배포 <커밋 7자리>, Production 키 등록 확인")
--   deployment_checked_on  위 배포를 확인한 날 YYYY-MM-DD (오늘 또는 그 이전)
--   policies               "existing" = 이미 게시된 정책을 그대로 쓴다(HWPX 포함 · 미검사 불허여야 함)
--                          또는 R1-06 과 같은 모양의 객체 {effective_from, common_file_safety, school_file_upload, school_submission}
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "deployment_ref": "<배포 확인값>",
  "deployment_checked_on": "<YYYY-MM-DD>",
  "policies": "<existing 또는 R1-06 모양의 정책 3종>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_school text; v_today date; v_checked date; v_from date; k text;
  pol jsonb; sp workhub.service_principals; eff jsonb;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'R1S-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.r1s_installs') IS NULL THEN
    RAISE EXCEPTION 'R1S-04 중단: R1S-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF (SELECT count(*) FROM workhub_private.r1s_installs WHERE batch IN ('R1S-01','R1S-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'R1S-04 중단: R1S-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF a.id IS NOT NULL AND (SELECT count(DISTINCT m2.school_id) FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
        JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
       WHERE m2.account_id = a.id AND m2.status = 'active') > 1 THEN
    RAISE EXCEPTION 'R1S-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.';
  END IF;
  SELECT m2.school_id INTO v_school FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
    JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
   WHERE m2.account_id = a.id AND m2.status = 'active';
  SELECT * INTO m FROM workhub.memberships WHERE school_id = v_school AND account_id = a.id AND status = 'active';
  IF a.id IS NULL OR m.id IS NULL OR NOT EXISTS (SELECT 1 FROM workhub.membership_roles r WHERE r.school_id = v_school AND r.membership_id = m.id
       AND r.role_code = 'school_admin' AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'R1S-04 중단: 승인자가 이 학교의 현재 학교 관리자(school_admin)가 아닙니다.';
  END IF;
  SELECT * INTO s FROM workhub.schools WHERE id = v_school FOR UPDATE;
  v_today := workhub_private.today_in(s.timezone);
  IF EXISTS (SELECT 1 FROM workhub.basic_profile_activations WHERE school_id = v_school) THEN
    RAISE EXCEPTION 'R1S-04 중단: 이 학교는 이미 활성화 행이 있습니다. 껐다 켜기는 R1S-80·81 을 쓰세요.';
  END IF;
  IF length(btrim(p ->> 'approval_ref')) NOT BETWEEN 1 AND 200 OR length(btrim(p ->> 'deployment_ref')) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'R1S-04 중단: 승인 근거·배포 확인값은 각각 1~200자입니다.';
  END IF;
  BEGIN v_checked := (p ->> 'deployment_checked_on')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'R1S-04 중단: 배포 확인일 형식(YYYY-MM-DD)을 확인해 주세요.'; END;
  IF v_checked > v_today THEN RAISE EXCEPTION 'R1S-04 중단: 배포 확인일이 오늘보다 뒤입니다. 실제로 확인한 날을 적어 주세요.'; END IF;

  -- 정책: 기존 게시판을 쓰거나, 새로 3종을 게시한다. 어느 쪽이든 HWPX 포함 · 미검사 불허.
  IF jsonb_typeof(p -> 'policies') = 'string' AND p ->> 'policies' = 'existing' THEN
    eff := workhub_private.c_effective(v_school, v_today);
    IF eff IS NULL OR NOT ((eff -> 'file' -> 'extensions') ? 'hwpx') THEN
      RAISE EXCEPTION 'R1S-04 중단: 오늘 유효한 정책 3종이 없거나 학교∩공통 형식에 hwpx 가 없습니다. 정책을 함께 게시해 주세요.';
    END IF;
    IF EXISTS (SELECT 1 FROM workhub.policy_versions v WHERE v.id IN (eff ->> 'uploadPolicyId', eff ->> 'commonPolicyId')
                  AND (v.value ->> 'allowUnscanned')::boolean) THEN
      RAISE EXCEPTION 'R1S-04 중단: 현재 정책이 미검사 파일을 허용합니다(allowUnscanned=true). 기본 확인 프로필은 미검사 허용과 함께 켜지 않습니다.';
    END IF;
  ELSIF jsonb_typeof(p -> 'policies') = 'object' THEN
    pol := p -> 'policies';
    PERFORM workhub_private.c_keys(pol, ARRAY['effective_from','common_file_safety','school_file_upload','school_submission'], NULL);
    BEGIN v_from := (pol ->> 'effective_from')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'R1S-04 중단: 시행일 형식(YYYY-MM-DD)을 확인해 주세요.'; END;
    FOREACH k IN ARRAY ARRAY['common_file_safety:file.safety','school_file_upload:collection.file_upload','school_submission:collection.submission'] LOOP
      IF NOT workhub_private.policy_value_valid(split_part(k, ':', 2), pol -> split_part(k, ':', 1)) THEN
        RAISE EXCEPTION 'R1S-04 중단: % 값의 모양·범위가 맞지 않습니다(R1-06 칸 설명 참고).', split_part(k, ':', 1);
      END IF;
    END LOOP;
    IF NOT ((pol -> 'common_file_safety' -> 'extensions') ? 'hwpx') OR NOT ((pol -> 'school_file_upload' -> 'extensions') ? 'hwpx') THEN
      RAISE EXCEPTION 'R1S-04 중단: 공통·학교 업로드 정책 모두 hwpx 를 포함해야 합니다.';
    END IF;
    IF (pol -> 'common_file_safety' ->> 'allowUnscanned')::boolean OR (pol -> 'school_file_upload' ->> 'allowUnscanned')::boolean THEN
      RAISE EXCEPTION 'R1S-04 중단: allowUnscanned 는 false 여야 합니다(기본 확인은 악성코드 검사가 아니므로 미검사 허용으로 대신하지 않습니다).';
    END IF;
    INSERT INTO workhub.policy_versions (scope, school_id, policy_key, policy_version, applies_to_scopes, value, state, effective_from,
        approved_by_account_id, approved_by_membership_id, approved_at, approval_ref)
    VALUES
     ('common', NULL, 'file.safety',
      COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 'c' AND policy_key = 'file.safety'), 0) + 1,
      ARRAY['common'], pol -> 'common_file_safety', 'published', v_from, a.id, NULL, clock_timestamp(), p ->> 'approval_ref'),
     ('school', v_school, 'collection.file_upload',
      COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 's:' || v_school AND policy_key = 'collection.file_upload'), 0) + 1,
      ARRAY['school'], pol -> 'school_file_upload', 'published', v_from, a.id, m.id, clock_timestamp(), p ->> 'approval_ref'),
     ('school', v_school, 'collection.submission',
      COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 's:' || v_school AND policy_key = 'collection.submission'), 0) + 1,
      ARRAY['school'], pol -> 'school_submission', 'published', v_from, a.id, m.id, clock_timestamp(), p ->> 'approval_ref');
  ELSE
    RAISE EXCEPTION 'R1S-04 중단: policies 는 "existing" 또는 정책 3종 객체여야 합니다.';
  END IF;

  -- 서비스 주체: 처음이면 만든다. 이미 있으면 작업 목록이 정확히 file.basic_check 하나이고 활성이어야 한다(다른 학교에서 만든 경우).
  SELECT * INTO sp FROM workhub.service_principals WHERE id = 'svc_hwpx_basic' FOR UPDATE;
  IF sp.id IS NULL THEN
    INSERT INTO workhub.service_principals (id, label, allowed_actions, active, approval_ref, approved_by_account_id, approved_at)
    VALUES ('svc_hwpx_basic', 'HWPX 기본 확인 서버 API(악성코드 검사 없음)', ARRAY['file.basic_check'], true, p ->> 'approval_ref', a.id, clock_timestamp());
  ELSIF sp.allowed_actions <> ARRAY['file.basic_check']::text[] OR NOT sp.active THEN
    RAISE EXCEPTION 'R1S-04 중단: svc_hwpx_basic 주체의 작업 목록·활성 상태가 예상과 다릅니다. 결과를 알려 주세요.';
  END IF;
  INSERT INTO workhub.service_principal_scopes (service_principal_id, scope_type, school_id, valid_from, approved_by_account_id, approval_ref, approved_at)
  VALUES ('svc_hwpx_basic', 'school', v_school, clock_timestamp(), a.id, p ->> 'approval_ref', clock_timestamp());
  INSERT INTO workhub.basic_profile_activations (school_id, profile, service_principal_id, approval_ref, approved_by_account_id,
      approved_by_membership_id, approved_at, deployment_ref, deployment_checked_on, state, state_reason)
  VALUES (v_school, 'hwpx_basic_v1', 'svc_hwpx_basic', btrim(p ->> 'approval_ref'), a.id, m.id, clock_timestamp(), btrim(p ->> 'deployment_ref'),
      v_checked, 'active', 'R1S-04 활성화');
END $do$;

-- 확인(읽기 전용): 활성화 행과 학교별 기본 확인 준비 상태. reason 이 ready 여야 교사가 HWPX 를 올릴 수 있다.
-- 정책 시행일이 미래면 그날까지 policy_missing 이 정상이다.
SELECT a.school_id, a.profile, a.state, a.approval_ref, a.deployment_ref, a.deployment_checked_on,
       workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) AS basic_readiness
  FROM workhub.basic_profile_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY a.school_id;
