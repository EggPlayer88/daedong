-- ============================================================================
-- P7-05  R1 · P2 보강 (별도 승인 — 정상 실행 순서에 넣지 않는다)
--
-- ▣ 무엇이 열리나: 수합 마감 · 보관 · 재개 · 기한 연장, 수합 관리자 인계, 협업 받는 사람 인계.
--   이 파일을 적용하기 전에는 그 명령이 모두 NOT_READY 다(화면만 막는 마감을 만들지 않는다).
-- ▣ 왜 별도 승인인가: "기존 R1 은 고치지 않는다"는 원칙의 예외다. R1 · P2 의 표 트리거 · 제약을 바꾼다.
--   계란님이 이 파일 적용을 승인한 경우에만 실행한다. 승인 근거를 아래 입력 칸에 적는다(기본값 없음).
-- ▣ 바꾸는 것(R1 · P2 원본 정의가 이 파일이 아는 판과 다르면 아무것도 바꾸지 않고 멈춘다):
--   R1  1) 쓰기 게이트 트리거 — 운영 단계가 closed · archived 인 수합에는 새 초안 저장 · 파일 의도 · 제출 · 철회 · 정정창을,
--          archived 인 수합에는 검토 · 보완 요청도 막는다(R1 함수를 직접 불러도 막힌다 → CONFLICT).
--          단, closed 에서도 "열린 보완 요청(R1 correction_requests, 기한 = 학교 오늘 이후)이 있는 단위"는 그 보완 기한까지
--          초안 저장 · 파일 올리기 · 그 보완 요청에 대한 제출만 할 수 있다(다른 단위의 새 제출 · 철회 · 정정창은 계속 막힘).
--          마감 뒤 검토자가 만든 보완 요청이 처리할 수 없는 요청이 되지 않게 하기 위해서다(2026-10-16 통합 검토 2번, 결정표 참고).
--       2) collections_guard 교체 — 게시된 수합은 여전히 바꿀 수 없고, P7 명령이 켠 표시(이 트랜잭션 한정)가 있을 때만
--          기한(due_on · due_at · due_change_revision) · 관리자(owner_*) · 판만 바뀐다.
--       3) collections_identity 다시 만들기 — 관리자 칸을 고정 목록에서 빼고(2)가 대신 지킨다).
--       4) collections_due_change_pending CHECK (= 1) → (>= 1)  (기한을 바꾸면 R1 제출판이 그 판 번호를 기록한다)
--   P2  5) cooperation_requests_identity 다시 만들기 — 받는 사람 칸을 빼고, 새 가드가 P7 표시가 있을 때만 받는 사람 · 판 변경을 받는다.
--       6) cooperation_history_action_check 에 'handover' 추가(P2-03-10 "이력 수 = 판" 규칙은 그대로 지켜진다).
-- ▣ 되돌리기: 이 파일에는 되돌리는 짝이 없다(R1 · P2 원본 정의는 P7_설계결정.md 부록에 그대로 남겼다).
--   운영 단계 기록이 남은 뒤 원래 정의로 돌리면 마감한 수합이 다시 열리므로, 되돌릴 일이 생기면 먼저 상의한다.
-- ============================================================================
BEGIN;

DO $$
DECLARE p jsonb := $json$
{
  "approved_by": "<승인한 사람(예: 계란)>",
  "approval_ref": "<승인 근거(날짜 · 대화 · 문서)>"
}
$json$::jsonb;
BEGIN
  IF p::text LIKE '%<%' THEN RAISE EXCEPTION 'P7-05 중단: 입력 칸(<...>)을 모두 채워 주세요.'; END IF;
  IF length(btrim(COALESCE(p ->> 'approved_by', ''))) NOT BETWEEN 1 AND 100 OR length(btrim(COALESCE(p ->> 'approval_ref', ''))) NOT BETWEEN 1 AND 200 THEN
    RAISE EXCEPTION 'P7-05 중단: approved_by 는 1~100자, approval_ref 는 1~200자입니다.';
  END IF;
  IF to_regclass('workhub_private.p7_installs') IS NULL THEN RAISE EXCEPTION 'P7-05 중단: P7-01·02(2026-10-16.1)를 먼저 적용해 주세요.'; END IF;
  IF (SELECT count(*) FROM workhub_private.p7_installs WHERE batch IN ('P7-01','P7-02') AND release = '2026-10-16.1') <> 2 THEN
    RAISE EXCEPTION 'P7-05 중단: P7-01·02(2026-10-16.1)를 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.p7_installs WHERE batch = 'P7-05') THEN
    RAISE EXCEPTION 'P7-05 중단: 이미 적용되었습니다(다시 실행하지 않습니다).';
  END IF;
  -- R1 · P2 원본 지문: 이 파일이 아는 판일 때만 바꾼다
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid = 'workhub_private.collections_guard()'::regprocedure) IS DISTINCT FROM '192396592ea201a158dcadb4b92d7b33'
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'workhub.collections'::regclass AND tgname = 'collections_identity')
        IS DISTINCT FROM 'CREATE TRIGGER collections_identity BEFORE UPDATE ON workhub.collections FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change(''id'', ''school_id'', ''owner_membership_id'', ''owner_account_id'', ''academic_year_id'', ''unit_kind'', ''self_review'', ''created_at'')'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.collections'::regclass AND conname = 'collections_due_change_pending')
        IS DISTINCT FROM 'CHECK ((due_change_revision = 1))'
     OR (SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'workhub.cooperation_requests'::regclass AND tgname = 'cooperation_requests_identity')
        IS DISTINCT FROM 'CREATE TRIGGER cooperation_requests_identity BEFORE UPDATE ON workhub.cooperation_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change(''id'', ''school_id'', ''sender_membership_id'', ''sender_account_id'', ''recipient_membership_id'', ''recipient_account_id'', ''title'', ''description'', ''due_on'', ''created_at'')'
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.cooperation_history'::regclass AND conname = 'cooperation_history_action_check')
        IS DISTINCT FROM 'CHECK ((action = ANY (ARRAY[''create''::text, ''accept''::text, ''decline''::text, ''request_completion''::text, ''confirm_completion''::text, ''return_completion''::text, ''retract_completion''::text, ''cancel''::text])))'
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname IN ('p7_phase_gate','p7_coop_guard'))
     OR to_regprocedure('workhub_private.p7_phase_gate()') IS NOT NULL OR to_regprocedure('workhub_private.p7_coop_guard()') IS NOT NULL THEN
    RAISE EXCEPTION 'P7-05 중단: R1 · P2 원본 정의가 이 파일이 아는 판과 다릅니다. 누가 바꿨는지 먼저 확인해 주세요.';
  END IF;
  PERFORM set_config('workhub.p7_05_approval', (p ->> 'approved_by') || ' · ' || (p ->> 'approval_ref'), true);
END $$;

-- ----------------------------------------------------------------------------
-- 1. R1 쓰기 게이트 — 운영 단계(P7 collection_operations)로 R1 쓰기 표의 새 행을 막는다.
--    수합 행을 FOR SHARE 로 잠근 뒤 단계를 읽는다: 마감 명령(수합 FOR UPDATE)과 한 줄로 선다.
--    제출은 "단위 → 수합" 순으로 잠그고, 마감은 단위를 잠그지 않으므로 교착하지 않는다.
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p7_phase_gate() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v jsonb := to_jsonb(NEW); v_school text; v_coll text; v_unit text; v_phase text; v_today date;
BEGIN
  v_school := v ->> 'school_id';
  v_coll := v ->> 'collection_id';
  v_unit := v ->> 'unit_id';
  IF v_coll IS NULL AND v ? 'draft_id' THEN
    SELECT collection_id, unit_id INTO v_coll, v_unit FROM workhub.unit_drafts WHERE school_id = v_school AND id = v ->> 'draft_id';
  END IF;
  IF v_coll IS NULL AND v_unit IS NOT NULL THEN
    SELECT collection_id INTO v_coll FROM workhub.collection_units WHERE school_id = v_school AND id = v_unit;
  END IF;
  IF v_coll IS NULL THEN RETURN NEW; END IF;
  PERFORM 1 FROM workhub.collections WHERE school_id = v_school AND id = v_coll FOR SHARE;
  v_phase := workhub_private.p7_phase(v_school, v_coll);
  IF v_phase = 'archived' THEN
    RAISE EXCEPTION 'CONFLICT' USING DETAIL = '보관된 수합에는 제출 · 저장 · 검토할 수 없습니다(수합 운영 단계).';
  END IF;
  IF v_phase = 'closed' AND TG_ARGV[0] IN ('closed', 'closed_supplement') THEN
    -- 마감 뒤 보완: 그 단위에 열린 보완 요청이 있고 보완 기한이 학교 오늘 이후일 때만. 제출은 그 보완 요청을 가리켜야 한다.
    SELECT workhub_private.today_in(s.timezone) INTO v_today FROM workhub.schools s WHERE s.id = v_school;
    IF TG_ARGV[0] = 'closed' OR v_unit IS NULL OR NOT EXISTS (
         SELECT 1 FROM workhub.correction_requests cr
          WHERE cr.school_id = v_school AND cr.unit_id = v_unit AND cr.state = 'open' AND cr.due_on >= v_today
            AND (TG_TABLE_NAME <> 'submission_versions' OR cr.id = v ->> 'correction_request_id')) THEN
      RAISE EXCEPTION 'CONFLICT' USING DETAIL = '마감된 수합에는 보완 요청을 받은 단위만 보완 기한까지 저장 · 제출할 수 있습니다(수합 운영 단계).';
    END IF;
  END IF;
  RETURN NEW;
END $$;
-- 마감(closed)부터 막는 것: 초안 저장 · 초안 파일 · 파일 업로드 의도 · 제출(보완 기한 안의 보완 대상 단위는 예외) · 철회 · 정정창
CREATE TRIGGER p7_phase_gate BEFORE INSERT OR UPDATE ON workhub.unit_drafts FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed_supplement');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.unit_draft_files FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed_supplement');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.collection_file_intents FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed_supplement');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.submission_versions FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed_supplement');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.submission_withdrawals FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.correction_windows FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('closed');
-- 보관(archived)부터 막는 것: 검토 · 보완 요청(마감 뒤에도 검토는 마칠 수 있다)
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.submission_reviews FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('archived');
CREATE TRIGGER p7_phase_gate BEFORE INSERT ON workhub.correction_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_phase_gate('archived');

-- ----------------------------------------------------------------------------
-- 2~4. R1 collections — 게시 뒤 기한 · 관리자 변경을 P7 명령에만 연다
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION workhub_private.collections_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE v_p7 boolean := COALESCE(current_setting('workhub.p7_change', true), '') = 'on';
        v_free text[] := ARRAY['due_on','due_at','due_change_revision','owner_membership_id','owner_account_id','version','updated_at','scope_key'];
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '수합은 지우지 않습니다.'; END IF;
  -- 관리자(owner)는 게시된 수합의 P7 인계로만 바뀐다(초안에서도 바꾸지 않는다 — R1 의 고정 규칙 유지)
  IF (NEW.owner_membership_id, NEW.owner_account_id) IS DISTINCT FROM (OLD.owner_membership_id, OLD.owner_account_id)
     AND NOT (v_p7 AND OLD.state = 'published') THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '수합 관리자는 업무 인계(P7)로만 바뀝니다.';
  END IF;
  IF OLD.state = 'published' THEN
    IF NOT v_p7 OR (to_jsonb(NEW) - v_free) IS DISTINCT FROM (to_jsonb(OLD) - v_free)
       OR NEW.version <> OLD.version + 1 OR NEW.due_change_revision < OLD.due_change_revision THEN
      RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '게시된 수합 요청은 바꿀 수 없습니다(기한 · 관리자 변경은 수합 운영 · 업무 인계 명령으로만).';
    END IF;
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;
DROP TRIGGER collections_identity ON workhub.collections;
CREATE TRIGGER collections_identity BEFORE UPDATE ON workhub.collections
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','academic_year_id','unit_kind','self_review','created_at');
ALTER TABLE workhub.collections DROP CONSTRAINT collections_due_change_pending;
ALTER TABLE workhub.collections ADD CONSTRAINT collections_due_change_pending CHECK (due_change_revision >= 1);

-- ----------------------------------------------------------------------------
-- 5~6. P2 협업 — 받는 사람 인계
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p7_coop_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.recipient_membership_id, NEW.recipient_account_id) IS DISTINCT FROM (OLD.recipient_membership_id, OLD.recipient_account_id)
     AND (COALESCE(current_setting('workhub.p7_change', true), '') <> 'on'
          OR (to_jsonb(NEW) - ARRAY['recipient_membership_id','recipient_account_id','version','updated_at'])
             IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['recipient_membership_id','recipient_account_id','version','updated_at'])
          OR NEW.version <> OLD.version + 1) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '협업 받는 사람은 업무 인계(P7)로만 바뀝니다.';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER cooperation_requests_identity ON workhub.cooperation_requests;
CREATE TRIGGER cooperation_requests_identity BEFORE UPDATE ON workhub.cooperation_requests
  FOR EACH ROW EXECUTE FUNCTION workhub_private.forbid_identity_change('id','school_id','sender_membership_id','sender_account_id',
    'title','description','due_on','created_at');
CREATE TRIGGER p7_coop_guard BEFORE UPDATE ON workhub.cooperation_requests FOR EACH ROW EXECUTE FUNCTION workhub_private.p7_coop_guard();
ALTER TABLE workhub.cooperation_history DROP CONSTRAINT cooperation_history_action_check;
ALTER TABLE workhub.cooperation_history ADD CONSTRAINT cooperation_history_action_check CHECK (action IN ('create','accept','decline',
  'request_completion','confirm_completion','return_completion','retract_completion','cancel','handover'));

REVOKE ALL ON FUNCTION workhub_private.p7_phase_gate(), workhub_private.p7_coop_guard() FROM PUBLIC, anon, authenticated, service_role;

-- 적용 기록 + 감사(서비스 주체가 아니라 DB 관리자 실행이므로 승인 근거는 적용 기록 이름에 남긴다)
INSERT INTO workhub_private.p7_installs (batch, release, installed_by)
VALUES ('P7-05', '2026-10-16.1', left(session_user || ' / ' || current_setting('workhub.p7_05_approval'), 63)::name);
COMMIT;

-- ----------------------------------------------------------------------------
-- 7. 검증 — 모든 행의 status 가 ok 여야 한다
-- ----------------------------------------------------------------------------
SELECT 'P7-05-1' AS no, 'R1 쓰기 게이트 트리거 8개' AS item,
       CASE WHEN count(*) = 8 THEN 'ok' ELSE 'FAIL' END AS status, count(*)::text AS value
FROM pg_trigger WHERE tgname = 'p7_phase_gate' AND NOT tgisinternal
UNION ALL
SELECT 'P7-05-2', '수합 기한 판 CHECK (>= 1)',
       CASE WHEN pg_get_constraintdef(oid) = 'CHECK ((due_change_revision >= 1))' THEN 'ok' ELSE 'FAIL' END, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'workhub.collections'::regclass AND conname = 'collections_due_change_pending'
UNION ALL
SELECT 'P7-05-3', '협업 받는 사람 가드 + 이력 handover',
       CASE WHEN EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'p7_coop_guard')
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'cooperation_history_action_check') LIKE '%handover%'
            THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P7-05-4', '적용 기록 P7-05', CASE WHEN workhub_private.p7_bridge() THEN 'ok' ELSE 'FAIL' END,
       (SELECT installed_by::text FROM workhub_private.p7_installs WHERE batch = 'P7-05')
ORDER BY 1;
