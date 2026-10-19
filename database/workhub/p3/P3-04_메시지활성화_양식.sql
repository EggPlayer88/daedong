-- ============================================================================
-- P3-04  메시지·알림 켜기 — 학교 1곳의 messaging 모듈을 켜고 메시지 정책(한도) 1행을 쓴다. 별도 승인 뒤에만.
--
-- ▣ 언제: PR #48(앱) 병합·배포 뒤, 학교가 승인했을 때. P3-01·02 적용과 같은 날 실행하지 않는다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 칸이 남아 있으면 아무것도 쓰지 않고 멈춘다. 예시값을 넣어 두지 않았다.
--   approver_user_id : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID). 대상 학교 = 그 사람이 지금 관리자인 학교 1곳.
--   approval_ref     : 승인 근거 1~200자 (예: 날짜·회의·결정 내용)
--   body_characters  : 메시지 본문 최대 글자 수(1~50000). 학교 업무 정책으로 정한 값.
--   title_characters : 단체 대화 제목 최대 글자 수(1~1000).
--   recipients       : 한 번에 보낼 수 있는 받는 사람 수(1~500). 개별 일괄 전송도 이 수를 넘지 못한다.
-- ▣ 쓰는 것: module_activations 의 messaging 1행 + messaging_policies 1행 + 감사 1건. 정책은 고칠 수 없다(바꾸려면 새 배치).
-- ▣ 첨부는 이 파일로 켜지지 않는다(attachments = not_configured 유지). 첨부는 P3-05.
-- ▣ 메뉴 공개 범위는 바꾸지 않는다. 받는 사람은 지금 업무실에 들어올 수 있는 사람만이다(2026-10-16 결정).
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "body_characters": "<본문 최대 글자 수 1~50000>",
  "title_characters": "<제목 최대 글자 수 1~1000>",
  "recipients": "<받는 사람 최대 수 1~500>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_n integer;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P3-04 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regprocedure('workhub_private.p3_installed()') IS NULL THEN
    RAISE EXCEPTION 'P3-04 중단: P3-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p3_installed() THEN
    RAISE EXCEPTION 'P3-04 중단: P3-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P3-04 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF NOT workhub_private.p2_int(p -> 'body_characters', 1, 50000) OR NOT workhub_private.p2_int(p -> 'title_characters', 1, 1000)
     OR NOT workhub_private.p2_int(p -> 'recipients', 1, 500) THEN
    RAISE EXCEPTION 'P3-04 중단: 한도는 따옴표 없는 정수로, 본문 1~50000 · 제목 1~1000 · 받는 사람 1~500 입니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P3-04 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P3-04 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P3-04 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P3-04 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = 'messaging')
     OR EXISTS (SELECT 1 FROM workhub.messaging_policies WHERE school_id = s.id) THEN
    RAISE EXCEPTION 'P3-04 중단: 이 학교에 이미 메시지 활성화·정책이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.';
  END IF;
  INSERT INTO workhub.messaging_policies (school_id, body_characters, title_characters, recipients, approved_by_membership_id, approval_ref)
  VALUES (s.id, (p ->> 'body_characters')::integer, (p ->> 'title_characters')::integer, (p ->> 'recipients')::integer, m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
  VALUES (s.id, 'messaging', 'active', m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':messaging', 'school',
      jsonb_build_object('module', 'messaging', 'approval_ref', left(btrim(p ->> 'approval_ref'), 200), 'by', session_user,
                         'limits', jsonb_build_object('body', p -> 'body_characters', 'title', p -> 'title_characters', 'recipients', p -> 'recipients')),
      's:' || s.id);
  RAISE NOTICE 'P3-04: % 학교의 메시지·알림을 켰습니다.', s.code;
END $do$;

-- 확인(읽기 전용): 메시지 준비 사유가 ready, 첨부는 아직 verification_missing 이어야 한다
SELECT s.code, workhub_private.p3_messaging_reason(s.id) AS messaging, workhub_private.p3_files_reason(s.id) AS files,
       p.body_characters, p.title_characters, p.recipients
  FROM workhub.schools s LEFT JOIN workhub.messaging_policies p ON p.school_id = s.id ORDER BY s.code;
