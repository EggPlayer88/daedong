-- ============================================================================
-- R1-06  수합 정책 3종 게시 (양식) — 값은 계란님이 정한다. 이 파일은 값을 정하지 않는다.
--
-- ▣ 언제: R1-01~03 적용 뒤, 학교가 허용 형식·크기·개수, 미검사 파일 허용, 업로드 예약 시간,
--   직접 철회·정정 기간, 미첨부 파일 보존 일수를 정했을 때. 승인 근거(결재·협의록)가 있어야 한다.
-- ▣ 정책이 없으면 준비 상태는 policy_missing(또는 verification_missing) 이고 수합을 쓸 수 없다. 그것이 정상이다.
-- ▣ <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다.
-- ▣ 한 번에 3종을 같은 시작일로 게시한다. 같은 기간에 이미 게시된 판이 있으면 멈춘다(겹침 금지 제약).
--   값을 바꾸려면 기존 판에 종료일(effective_to)을 정하고 새 판을 게시하는 별도 SQL 이 필요하다(R1 범위 밖, 요청 시 작성).
--
-- 칸 설명
--   approver_user_id     승인한 관리자의 회원 id(Auth UID). R0-03 에서 연결한 학교 관리자(school_admin 역할)여야 한다.
--   approval_ref         승인 근거 1~200자 (예: "2026-10-20 교무회의 의결, 정보부장 확인")
--   effective_from       시행일 YYYY-MM-DD (학교 시간대 기준 그날부터)
--   common_file_safety   모든 학교 공통 하한: extensions(pdf,hwp,hwpx,docx,xlsx,pptx 중), maxFileBytes(≤104857600), maxFiles(≤512), allowUnscanned
--   school_file_upload   학교 업로드 정책: 위 4개 + uploadTtlMinutes(5~1440)
--   school_submission    학교 제출 정책: allowWithdrawal, allowCorrectionWindow, maxCorrectionDays(1~365), unattachedRetentionDays(1~365)
--   ※ 실제 사용 가능 범위 = 학교 정책 ∩ 공통 하한. 미검사 허용은 둘 다 true 여야 한다.
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "effective_from": "<YYYY-MM-DD>",
  "common_file_safety": {"extensions": "<예: [\"pdf\",\"hwpx\"]>", "maxFileBytes": "<바이트>", "maxFiles": "<개수>", "allowUnscanned": "<true|false>"},
  "school_file_upload": {"extensions": "<목록>", "maxFileBytes": "<바이트>", "maxFiles": "<개수>", "allowUnscanned": "<true|false>", "uploadTtlMinutes": "<분>"},
  "school_submission": {"allowWithdrawal": "<true|false>", "allowCorrectionWindow": "<true|false>", "maxCorrectionDays": "<일>", "unattachedRetentionDays": "<일>"}
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; v_school text; v_from date; k text;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'R1-06 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN RAISE EXCEPTION 'R1-06 중단: R1-03(2026-10-15.1)이 적용되어 있지 않습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-03' AND release = '2026-10-15.1') THEN
    RAISE EXCEPTION 'R1-06 중단: R1-03(2026-10-15.1)이 적용되어 있지 않습니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  -- 대상 학교 = 승인자가 현재 학교 관리자인 활성 학교. 정확히 1곳이어야 한다(여러 곳이면 어느 학교인지 모호하므로 멈춘다).
  IF a.id IS NOT NULL AND (SELECT count(DISTINCT m2.school_id) FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
        JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
       WHERE m2.account_id = a.id AND m2.status = 'active') > 1 THEN
    RAISE EXCEPTION 'R1-06 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.';
  END IF;
  SELECT m2.school_id INTO v_school FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
    JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
   WHERE m2.account_id = a.id AND m2.status = 'active';
  SELECT * INTO m FROM workhub.memberships WHERE school_id = v_school AND account_id = a.id AND status = 'active';
  IF a.id IS NULL OR m.id IS NULL OR NOT EXISTS (SELECT 1 FROM workhub.membership_roles r WHERE r.school_id = v_school AND r.membership_id = m.id
       AND r.role_code = 'school_admin' AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'R1-06 중단: 승인자가 이 학교의 현재 학교 관리자(school_admin)가 아닙니다.';
  END IF;
  IF length(btrim(p ->> 'approval_ref')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1-06 중단: 승인 근거는 1~200자입니다.'; END IF;
  BEGIN v_from := (p ->> 'effective_from')::date; EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'R1-06 중단: 시행일 형식(YYYY-MM-DD)을 확인해 주세요.'; END;
  FOREACH k IN ARRAY ARRAY['common_file_safety:file.safety','school_file_upload:collection.file_upload','school_submission:collection.submission'] LOOP
    IF NOT workhub_private.policy_value_valid(split_part(k, ':', 2), p -> split_part(k, ':', 1)) THEN
      RAISE EXCEPTION 'R1-06 중단: % 값의 모양·범위가 맞지 않습니다(칸 설명 참고).', split_part(k, ':', 1);
    END IF;
  END LOOP;
  INSERT INTO workhub.policy_versions (scope, school_id, policy_key, policy_version, applies_to_scopes, value, state, effective_from,
      approved_by_account_id, approved_by_membership_id, approved_at, approval_ref)
  VALUES
   ('common', NULL, 'file.safety',
    COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 'c' AND policy_key = 'file.safety'), 0) + 1,
    ARRAY['common'], p -> 'common_file_safety', 'published', v_from, a.id, NULL, clock_timestamp(), p ->> 'approval_ref'),
   ('school', v_school, 'collection.file_upload',
    COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 's:' || v_school AND policy_key = 'collection.file_upload'), 0) + 1,
    ARRAY['school'], p -> 'school_file_upload', 'published', v_from, a.id, m.id, clock_timestamp(), p ->> 'approval_ref'),
   ('school', v_school, 'collection.submission',
    COALESCE((SELECT max(policy_version) FROM workhub.policy_versions WHERE scope_key = 's:' || v_school AND policy_key = 'collection.submission'), 0) + 1,
    ARRAY['school'], p -> 'school_submission', 'published', v_from, a.id, m.id, clock_timestamp(), p ->> 'approval_ref');
END $do$;

-- 확인(읽기 전용): 게시된 정책판과 현재 준비 상태. 검증 작업자(R1-05·서버 배포) 전에는 verification_missing 이 정상이다.
SELECT v.policy_key, v.policy_version, v.state, v.effective_from, v.value, v.approval_ref FROM workhub.policy_versions v
 WHERE v.state = 'published' ORDER BY v.policy_key, v.policy_version;
