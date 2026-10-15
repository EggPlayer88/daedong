-- ============================================================================
-- R1-05  파일 검증·정리 작업자 연결 (양식) — 인증·보안 경계 변경이므로 별도 승인 뒤에만 실행한다.
--
-- ▣ 언제: 서버 검증 작업자(R1_검증작업자_후속명세.md)를 구현·배포하고, 실제 Storage 실물로 시험한 뒤.
--   SQL 만으로는 준비 완료가 되지 않는다. 작업자가 heartbeat 를 보내야 verification 조건이 채워진다.
-- ▣ 무엇을: 서비스 주체 svc_file_worker(file.verify·file.cleanup) 1개, 이 학교 범위 승인 1개,
--   PostgREST service_role 경로 ↔ 주체 연결 1행(api_role_principals). 회원·자료·Storage 는 건드리지 않는다.
-- ▣ 의미: service_role 키를 가진 서버만 작업자 함수 6개를 부를 수 있고, 그 호출은 이 주체로 감사 기록된다.
--   service_role 키는 브라우저·앱 코드에 두지 않는다(Vercel 서버 환경 변수 등 서버 전용).
-- ▣ <...> 칸을 모두 채워야 실행된다. 이미 연결되어 있으면 멈춘다(다시 실행하지 않는다).
-- ▣ 끊기: R1_실행안내.md 의 "작업자 연결 끊기"(api_role_principals.revoked_at 기록 + 범위 승인 회수). 행을 지우지 않는다.
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거: 날짜 + 승인자 + 작업자 배포 확인>"
}
$json$::jsonb;
  a workhub.accounts; v_school text;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'R1-05 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.batch_installs') IS NULL THEN RAISE EXCEPTION 'R1-05 중단: R1-03(2026-10-15.1)이 적용되어 있지 않습니다.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.batch_installs WHERE batch = 'R1-03' AND release = '2026-10-15.1') THEN
    RAISE EXCEPTION 'R1-05 중단: R1-03(2026-10-15.1)이 적용되어 있지 않습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.service_principals WHERE id = 'svc_file_worker')
     OR EXISTS (SELECT 1 FROM workhub_private.api_role_principals WHERE revoked_at IS NULL) THEN
    RAISE EXCEPTION 'R1-05 중단: 작업자 주체 또는 service_role 연결이 이미 있습니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  -- 대상 학교 = 승인자가 현재 학교 관리자인 활성 학교. 정확히 1곳이어야 한다(여러 곳이면 어느 학교인지 모호하므로 멈춘다).
  IF a.id IS NOT NULL AND (SELECT count(DISTINCT m2.school_id) FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
        JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
       WHERE m2.account_id = a.id AND m2.status = 'active') > 1 THEN
    RAISE EXCEPTION 'R1-05 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.';
  END IF;
  SELECT m2.school_id INTO v_school FROM workhub.memberships m2 JOIN workhub.schools s2 ON s2.id = m2.school_id AND s2.status = 'active'
    JOIN workhub.membership_roles r2 ON r2.school_id = m2.school_id AND r2.membership_id = m2.id AND r2.role_code = 'school_admin' AND r2.revoked_at IS NULL
   WHERE m2.account_id = a.id AND m2.status = 'active';
  IF a.id IS NULL OR NOT EXISTS (SELECT 1 FROM workhub.memberships m JOIN workhub.membership_roles r ON r.school_id = m.school_id AND r.membership_id = m.id
       WHERE m.school_id = v_school AND m.account_id = a.id AND m.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL) THEN
    RAISE EXCEPTION 'R1-05 중단: 승인자가 이 학교의 현재 학교 관리자(school_admin)가 아닙니다.';
  END IF;
  IF length(btrim(p ->> 'approval_ref')) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1-05 중단: 승인 근거는 1~200자입니다.'; END IF;
  INSERT INTO workhub.service_principals (id, label, allowed_actions, active, approval_ref, approved_by_account_id, approved_at)
  VALUES ('svc_file_worker', '수합 파일 검증·정리 작업자', ARRAY['file.verify','file.cleanup'], true, p ->> 'approval_ref', a.id, clock_timestamp());
  INSERT INTO workhub.service_principal_scopes (service_principal_id, scope_type, school_id, valid_from, approved_by_account_id, approval_ref, approved_at)
  VALUES ('svc_file_worker', 'school', v_school, clock_timestamp(), a.id, p ->> 'approval_ref', clock_timestamp());
  INSERT INTO workhub_private.api_role_principals (api_role, service_principal_id, approval_ref, approved_by_account_id)
  VALUES ('service_role', 'svc_file_worker', p ->> 'approval_ref', a.id);
END $do$;

-- 확인(읽기 전용): 연결 상태와 heartbeat. heartbeat 0건이면 작업자가 아직 돌지 않는 것이다(준비 상태 verification_missing).
SELECT p.id, p.allowed_actions, p.active,
       (SELECT count(*) FROM workhub.service_principal_scopes s WHERE s.service_principal_id = p.id AND s.revoked_at IS NULL) AS scopes,
       (SELECT count(*) FROM workhub_private.api_role_principals r WHERE r.service_principal_id = p.id AND r.revoked_at IS NULL) AS service_role_links,
       (SELECT max(h.expires_at) FROM workhub.file_verifier_heartbeats h WHERE h.service_principal_id = p.id) AS last_heartbeat_expires
  FROM workhub.service_principals p WHERE p.id = 'svc_file_worker';
