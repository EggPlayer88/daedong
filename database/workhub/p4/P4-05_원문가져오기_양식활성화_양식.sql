-- ============================================================================
-- P4-05  HWPX 원문 가져오기 / 질문형 양식 켜기 — 한 번에 모듈 하나(knowledge_import 또는 guided). 별도 승인 뒤에만.
--
-- ▣ 언제: 아래가 모두 확인된 뒤에만. 하나라도 없으면 실행하지 않는다(그 모듈은 계속 policy_missing).
--   (1) knowledge_import 는 P4-04 로 그 학교의 학교 자료(knowledge)가 켜져 있다. guided 는 수합(R1)이 쓰이고 있다.
--   (2) 서버 API 가 운영 Vercel 에 배포되었고, 서버 환경에 Supabase 서비스 키가 있다.
--       knowledge_import → POST /api/workhub-documents/extract-knowledge · guided → POST /api/workhub-documents/guided
--       확인 방법: 로그인 없이 POST 하면 401(UNAUTHENTICATED)이 오고(INVALID_INPUT·5xx 아님), Vercel 함수 로그에 오류가 없다.
--   실제 업로드 → 서버 추출·분석·생성 → 내려받기 왕복은 이 파일을 실행해야 처음 할 수 있다.
--   실행 직후 superadmin 두 사람이 한 번 해 보고, 안 되면 바로 P2-80(module = knowledge_import 또는 guided)으로 그 모듈만 끈다.
--   이 파일은 "서버가 있다"고 꾸미지 않는다: verification_ref 는 (2)를 확인한 기록을 적는 칸이다.
-- ▣ 아래 $json$ 의 <...> 칸을 모두 채워야 실행된다. 예시값을 넣어 두지 않았다.
--   module           : knowledge_import 또는 guided (따옴표 안 문자열)
--   approver_user_id : 승인한 학교 관리자(school_admin)의 회원 id(Auth UID)
--   approval_ref     : 승인 근거 1~200자
--   max_file_bytes   : HWPX 파일 1개 최대 바이트(1~31457280, 30MiB 기술 상한 안에서 학교 정책)
--   verification_ref : 배포 확인 기록 1~200자 (예: Vercel 배포 id · 확인 날짜 · 확인한 사람)
-- ▣ 쓰는 것: module_activations 1행 + 그 모듈의 정책 1행(knowledge_import_policies 또는 guided_policies) + 감사 1건.
-- ▣ 이 서버 처리는 HWPX 구조·크기·SHA 확인과 본문 추출·칸 채우기다. 악성코드 검사가 아니며, 그런 값을 기록하지 않는다.
-- ============================================================================
DO $do$
DECLARE
  p jsonb := $json$
{
  "module": "<knowledge_import 또는 guided>",
  "approver_user_id": "<승인한 관리자 회원 id>",
  "approval_ref": "<승인 근거>",
  "max_file_bytes": "<파일 1개 최대 바이트 1~31457280>",
  "verification_ref": "<배포 확인 기록>"
}
$json$::jsonb;
  a workhub.accounts; m workhub.memberships; s workhub.schools; v_n integer; v_mod text := p ->> 'module'; v_bucket text;
BEGIN
  IF p::text LIKE '%"<%' THEN RAISE EXCEPTION 'P4-05 중단: 입력 칸(<...>)을 모두 채워 주세요. 아무것도 쓰지 않았습니다.'; END IF;
  IF to_regprocedure('workhub_private.p4_installed()') IS NULL THEN
    RAISE EXCEPTION 'P4-05 중단: P4-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF NOT workhub_private.p4_installed() THEN
    RAISE EXCEPTION 'P4-05 중단: P4-01·02(2026-10-16.1)가 적용되어 있지 않습니다.';
  END IF;
  IF jsonb_typeof(p -> 'module') IS DISTINCT FROM 'string' OR v_mod NOT IN ('knowledge_import','guided') THEN
    RAISE EXCEPTION 'P4-05 중단: module 은 knowledge_import 또는 guided 입니다.';
  END IF;
  v_bucket := CASE v_mod WHEN 'knowledge_import' THEN 'workhub-knowledge-files' ELSE 'workhub-document-files' END;
  IF length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P4-05 중단: 승인 근거는 1~200자입니다.'; END IF;
  IF length(btrim(COALESCE(p ->> 'verification_ref', ''))) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P4-05 중단: 배포 확인 기록은 1~200자입니다.'; END IF;
  IF NOT workhub_private.p2_int(p -> 'max_file_bytes', 1, 31457280) THEN
    RAISE EXCEPTION 'P4-05 중단: 파일 크기는 따옴표 없는 정수 1~31457280 입니다.';
  END IF;
  SELECT * INTO a FROM workhub.accounts WHERE auth_user_id::text = p ->> 'approver_user_id' AND status = 'active' AND legacy_approval_state = 'approved';
  IF NOT FOUND THEN RAISE EXCEPTION 'P4-05 중단: 승인자 계정이 없거나 활성·승인 상태가 아닙니다.'; END IF;
  SELECT count(DISTINCT m2.school_id) INTO v_n
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)');
  IF v_n = 0 THEN RAISE EXCEPTION 'P4-05 중단: 승인자가 지금 학교 관리자(school_admin)인 활성 학교가 없습니다.'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'P4-05 중단: 승인자가 여러 학교의 관리자입니다. 학교를 하나로 정할 수 없습니다.'; END IF;
  SELECT m2.* INTO m
    FROM workhub.memberships m2 JOIN workhub.membership_roles r ON r.membership_id = m2.id AND r.school_id = m2.school_id
    JOIN workhub.schools s2 ON s2.id = m2.school_id
   WHERE m2.account_id = a.id AND m2.status = 'active' AND r.role_code = 'school_admin' AND r.revoked_at IS NULL AND r.scope_type = 'school'
     AND workhub_private.today_in(s2.timezone) <@ daterange(m2.valid_from, m2.valid_to, '[)')
     AND workhub_private.today_in(s2.timezone) <@ daterange(r.valid_from, r.valid_to, '[)')
   LIMIT 1;
  SELECT * INTO s FROM workhub.schools WHERE id = m.school_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'P4-05 중단: 대상 학교가 활성 상태가 아닙니다.'; END IF;
  IF v_mod = 'knowledge_import' AND workhub_private.p4_reason(s.id, 'knowledge') <> 'ready' THEN
    RAISE EXCEPTION 'P4-05 중단: 이 학교의 학교 자료가 켜져 있지 않습니다(P4-04 먼저, 중지 중이면 재개 먼저).';
  END IF;
  IF NOT workhub_private.p4_storage_ok(v_bucket) THEN
    RAISE EXCEPTION 'P4-05 중단: % 버킷·Storage 정책이 P4-02 가 만든 그대로가 아닙니다. P4-03 결과를 알려 주세요.', v_bucket;
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = s.id AND module = v_mod)
     OR (v_mod = 'knowledge_import' AND EXISTS (SELECT 1 FROM workhub.knowledge_import_policies WHERE school_id = s.id))
     OR (v_mod = 'guided' AND EXISTS (SELECT 1 FROM workhub.guided_policies WHERE school_id = s.id)) THEN
    RAISE EXCEPTION 'P4-05 중단: 이 학교에 이미 % 활성화·정책이 있습니다(다시 켜려면 P2-81). 아무것도 쓰지 않았습니다.', v_mod;
  END IF;
  IF v_mod = 'knowledge_import' THEN
    INSERT INTO workhub.knowledge_import_policies (school_id, max_file_bytes, verification_ref, approved_by_membership_id, approval_ref)
    VALUES (s.id, (p ->> 'max_file_bytes')::bigint, btrim(p ->> 'verification_ref'), m.id, btrim(p ->> 'approval_ref'));
  ELSE
    INSERT INTO workhub.guided_policies (school_id, max_file_bytes, verification_ref, approved_by_membership_id, approval_ref)
    VALUES (s.id, (p ->> 'max_file_bytes')::bigint, btrim(p ->> 'verification_ref'), m.id, btrim(p ->> 'approval_ref'));
  END IF;
  INSERT INTO workhub.module_activations (school_id, module, state, approved_by_membership_id, approval_ref)
  VALUES (s.id, v_mod, 'active', m.id, btrim(p ->> 'approval_ref'));
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  VALUES (s.id, a.id, m.id, 'module.activate', 'module_activation', s.id || ':' || v_mod, 'school',
      jsonb_build_object('module', v_mod, 'approval_ref', left(btrim(p ->> 'approval_ref'), 200), 'by', session_user,
                         'verification_ref', left(btrim(p ->> 'verification_ref'), 200), 'max_file_bytes', p -> 'max_file_bytes',
                         'malware_scan', false), 's:' || s.id);
  RAISE NOTICE 'P4-05: % 학교의 % 를 켰습니다.', s.code, v_mod;
END $do$;

-- 확인(읽기 전용): 켠 모듈이 ready 여야 한다
SELECT s.code, workhub_private.p4_reason(s.id, 'knowledge') AS knowledge, workhub_private.p4_reason(s.id, 'knowledge_import') AS knowledge_import,
       workhub_private.p4_reason(s.id, 'documents') AS documents, workhub_private.p4_reason(s.id, 'guided') AS guided
  FROM workhub.schools s ORDER BY s.code;
