-- ============================================================================
-- T2-08  시간표 운영 켜기 — 학교 1곳의 시간표 운영(timetable_operations: 공개 시간표 · 교환 요청 · 학사 변경 · 실시 기록)을 켠다.
--        별도 승인 뒤에만. T2-01~06 적용과 같은 날 실행하지 않는다.
--
-- ▣ 언제: 아래 넷이 모두 갖춰진 "뒤", 학교가 승인했을 때.
--   1) 시간표 운영 앱(PR #72 이후 판: 운영 화면 · 공유 시간표 · 실시 기록 패널)이 운영에 배포됨
--   2) 그 학교의 시간표(T1, timetable)가 켜져 있음(T1-05) — 공개할 기준판 · 편성 초안을 만드는 곳
--   3) T2-01 · T2-03 · T2-04 · T2-05 · T2-06(2026-10-20.1) 적용 · T2-07 통합 사후 점검 FAIL 없음
--   4) 공개 범위 결정: 켜면 그 학교의 모든 활성 교사가 공개된 시간표를 보고 자기 수업의 교환 · 이동을 요청할 수 있다.
--      앱 메뉴 공개 범위(modules.js visibility)는 이 양식이 바꾸지 않는다 — 넓히는 것은 따로 계란님 승인.
-- ▣ 알림(T2-02)은 이 양식과 별개다. T2-02 를 적용하지 않았으면 교환 요청 알림 없이 동작한다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다. 기본값은 없다.
--   approver_user_id : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref     : 승인 근거 1~200자
--   app_deploy_ref   : 시간표 운영 앱이 운영에 배포되었음을 확인한 근거 1~200자(배포 주소 · 커밋 · 확인한 날).
--                      실행하는 사람이 적는 확인 기록이다. 서버는 길이만 검사하고 실제 배포 내용을 증명하지 않는다.
-- ▣ 쓰는 것: module_activations 의 timetable_operations 1행 + 감사 1건(배포 확인 근거 포함). 이미 행이 있으면 멈춘다(다시 켜려면 P2-81).
-- ▣ 끄기 · 다시 켜기는 P2-80 · P2-81 을 그대로 쓴다(모듈 이름 timetable_operations). 자료는 지우지 않는다.
--   끄면 조회 · 쓰기가 NOT_READY, readiness 는 not_installed. 이미 반영된 요청의 복구 조회(같은 요청 번호)는 계속 된다.
--   시간표(timetable)를 끄면 운영도 함께 NOT_READY 가 된다(준비 조건에 T1 이 들어 있다).
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "app_deploy_ref": "<시간표 운영 앱(PR #72 이후) 운영 배포 확인 근거>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_n integer;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'T2-08 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regclass('workhub_private.t2_installs') IS NULL OR to_regprocedure('workhub_private.t2_installed_all()') IS NULL THEN
    RAISE EXCEPTION 'T2-08 중단: T2-01 · T2-03 · T2-04 · T2-05 · T2-06(2026-10-20.1)이 모두 적용되어 있지 않습니다.';
  END IF;
  -- 함수가 없을 때 이 식을 준비하지 않도록 위와 나눈다. 문자열 질의로 불러 계획 시점 오류를 피한다.
  EXECUTE $q$SELECT count(*) FROM workhub_private.t2_installs WHERE batch IN ('T2-01','T2-03','T2-04','T2-05','T2-06') AND release = '2026-10-20.1'$q$ INTO v_n;
  IF v_n <> 5 THEN RAISE EXCEPTION 'T2-08 중단: T2-01 · T2-03 · T2-04 · T2-05 · T2-06(2026-10-20.1)이 모두 적용되어 있지 않습니다.'; END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'T2-08 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF length(btrim(COALESCE(p ->> 'app_deploy_ref', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'T2-08 중단: 앱 배포 확인 근거(app_deploy_ref)는 1~200자입니다. 시간표 운영 앱 배포를 확인하지 않았으면 켜지 않습니다.';
  END IF;
  IF NOT workhub_private.p2_exact(p, ARRAY['approver_user_id','approval_ref','app_deploy_ref']) THEN
    RAISE EXCEPTION 'T2-08 중단: 입력 칸은 approver_user_id · approval_ref · app_deploy_ref 세 개입니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'T2-08 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'T2-08 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'T2-08 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'T2-08 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  IF NOT workhub_private.t1_ready(s.id) THEN
    RAISE EXCEPTION 'T2-08 중단: % 학교의 시간표(T1, timetable)가 준비 상태가 아닙니다(T1-05 먼저). 아무것도 쓰지 않았습니다.', s.code;
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = 'timetable_operations') THEN
    RAISE EXCEPTION 'T2-08 중단: timetable_operations 모듈은 이 학교에 이미 활성화 행이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.';
  END IF;
  INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
  VALUES (s.id, 'timetable_operations', 'active', m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':timetable_operations', 'school',
      jsonb_build_object('module', 'timetable_operations', 'approval_ref', left(btrim(p ->> 'approval_ref'), 200),
                         'app_deploy_ref', left(btrim(p ->> 'app_deploy_ref'), 200), 'by', session_user), 's:' || s.id);
  RAISE NOTICE 'T2-08: % 학교에 timetable_operations 를 켰습니다.', s.code;
END $do$;

-- 확인(읽기 전용)
SELECT s.code, a.module, a.state, a.activated_at FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
 WHERE a.module IN ('timetable','timetable_operations') ORDER BY s.code;
