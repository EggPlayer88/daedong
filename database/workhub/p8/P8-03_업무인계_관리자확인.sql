-- ============================================================================
-- P8-03  정책 보강 3 — 공식 담당 인계의 관리자 확인(Q2) (비활성 설치)
--
-- ▣ 확정 정책(2026-10-16 계란님): 공식 담당(duty)이 하나라도 든 인계는 "학교 관리자 확인 → 받는 사람 수락" 순서다.
--     apply          → awaiting_admin 판 1   요청만 생긴다. 담당 · 열람 권한은 그대로. 받는 사람은 아직 수락할 수 없다.
--     admin_confirm  → pending 판 2          관리자(year.manage, 요청자 · 받는 사람 본인이 아닌 사람)가 확인. 원본 판 · 기간 · 받는 사람을 다시 검사.
--     admin_reject   → rejected 판 2         관리자 반려. 아무것도 넘어가지 않는다.
--     cancel(대기 중) → cancelled 판 2        요청자 철회.
--     accept         → accepted 판 3         받는 사람 수락 — 원본을 다시 검사하고, 담당 이전을 같은 트랜잭션에서 한다(P7 그대로).
--     reject · cancel(확인 뒤) → 판 3        관리자 확인 기록은 그대로 남는다.
--   협업 · 수합만 든 인계와 새 학년도는 지금처럼(pending 1 → 판 2, completed 1)이다.
-- ▣ 목록(workhub_school_transition_list): 학교에 duty_admin_review 활성화 행이 생긴 뒤(켬 · 중지 모두)에는 새 모양
--   {..., dutyApproval} + 기록마다 requesterMemberId · requiresAdminReview · canAdminReview · adminReview 를 모든 기록에 함께 돌려준다.
--   dutyApproval = 'admin_review_v1'(켜져 있음) | null(중지). 활성화 행이 없으면(설치만 한 상태) 지금 모양 그대로 — 옛 앱(PR #48 · #59)이 그대로 읽는다.
--   관리자(year.manage)는 공식 담당이 든 인계 기록도 목록에서 본다(확인 · 반려하려면 보아야 하므로).
-- ▣ 켜기 전(설치만): 공식 담당 인계의 미리보기 · 신청 · 관리자 확인 · 수락은 NOT_READY. 할 수 있는 자원 목록에도 공식 담당이 나오지 않는다.
--   협업 · 수합 인계 · 새 학년도 · 대기 중 기록의 거절 · 취소는 지금과 같다(옛 앱 경로 보존). 켜기(P8-06)는 새 앱(PR #60) 배포 뒤에만.
-- ▣ 이미 접수된 요청(같은 요청 번호 + 같은 내용)은 언제나 원래 접수증을 먼저 돌려준다(원장 먼저) — 옛 접수증을 고치지 않는다.
-- ▣ 바꾸는 것: transition_records 의 shape · version CHECK, transition_history 의 action CHECK(이름 그대로, 넓히는 변경),
--   P7 함수 5개 본문(p7_record_guard · p7_resources · p7_tr_preview · p7_tr_list · p7_tr_mutate — 이름 · 인자 · 권한 그대로).
--   새 내부 함수 7개(p8_*). 공개 함수 · 다른 표는 바꾸지 않는다.
-- ▣ 설치를 거부하는 경우: 공식 담당이 든 인계 기록이 이미 하나라도 있으면(P7 의 옛 흐름으로 만든 것) 멈춘다. 관리자 확인 없이 만든 기록을
--   새 계약으로 바꾸려면 "확인 이력을 지어내거나" "확인이 필요 없다고 거짓으로 내려 보내야" 해서 둘 다 계약 위반이다 — 그런 기록이 있으면
--   먼저 계란님과 처리 방법(완료 · 취소 뒤 설치 등)을 정한다. 지금 운영 DB 에는 P7 이 없으므로 이 경우가 없다.
-- ▣ 전제: P8-01. P7 함수 5개가 원본 판(2026-10-16.1)이 아니면 멈춘다. 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.p8_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-01' AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 1 THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-03'$q$ INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'P8 중단: P8-03 이 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF EXISTS (SELECT 1 FROM (VALUES
       ('workhub_private.p7_record_guard()', 'b3eb3cc35c1fada8393783d6a34c9f92'),
       ('workhub_private.p7_resources(text,text,text,date,text)', '820fcc0a26e83ce2e7128e62bf7f45ac'),
       ('workhub_private.p7_tr_preview(workhub_private.actor_context,jsonb)', '2df8d66d0b780204e7f3ba19da08e410'),
       ('workhub_private.p7_tr_list(workhub_private.actor_context,text)', 'cc5d471a7281c60dfbc23350315653da'),
       ('workhub_private.p7_tr_mutate(workhub_private.actor_context,jsonb,text)', 'a116760b4751729d358168dac5ce41e2')) f(sig, body)
       WHERE (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(f.sig)) IS DISTINCT FROM f.body)
     OR (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'workhub.transition_records'::regclass AND conname = 'transition_records_shape_check')
          IS DISTINCT FROM '402c1fe9376d3d0c415bdb1c4b2a92c1'
     OR (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'workhub.transition_records'::regclass AND conname = 'transition_records_version_check')
          IS DISTINCT FROM 'd40113b207f58a25353c929cd7b613d3'
     OR (SELECT md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid = 'workhub.transition_history'::regclass AND conname = 'transition_history_action_check')
          IS DISTINCT FROM 'cc9b796d23382c462015dcdbebe77e60' THEN
    RAISE EXCEPTION 'P8 중단: 바꿀 P7 함수 · 제약이 원본 판(2026-10-16.1)이 아닙니다. 누가 고쳤는지 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub.transition_items WHERE kind = 'duty') THEN
    RAISE EXCEPTION 'P8 중단: 공식 담당이 든 인계 기록이 이미 있습니다(P7 의 관리자 확인 없는 흐름). 처리 방법을 먼저 정해 주세요 — 머리말 참고. 아무것도 바꾸지 않았습니다.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname IN ('p8_duty_review_active','p8_duty_review_known','p8_plan_has_duty','p8_tr_state',
               'p8_admin_review','p8_record_dto','p8_handover_recheck')) THEN
    RAISE EXCEPTION 'P8 중단: 같은 이름의 함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 상태 · 판 · 이력 CHECK 넓히기(기존 행은 모두 통과한다 — 기존 상태는 그대로 허용)
-- ----------------------------------------------------------------------------
ALTER TABLE workhub.transition_records DROP CONSTRAINT transition_records_shape_check;
ALTER TABLE workhub.transition_records ADD CONSTRAINT transition_records_shape_check CHECK (CASE kind
    WHEN 'handover' THEN recipient_membership_id IS NOT NULL AND recipient_account_id IS NOT NULL AND result_year_id IS NULL
                         AND recipient_account_id <> requester_account_id AND state IN ('awaiting_admin','pending','accepted','rejected','cancelled')
    WHEN 'new_year' THEN recipient_membership_id IS NULL AND recipient_account_id IS NULL AND result_year_id IS NOT NULL
                         AND state = 'completed' AND version = 1 END);
-- 판: 대기(awaiting_admin · 관리자 확인 없는 pending) · 완료(completed)는 1, 확인 뒤 pending 은 2, 끝난 상태는 2(관리자 단계 없음 · 관리자 반려 · 확인 전 철회) 또는 3
ALTER TABLE workhub.transition_records DROP CONSTRAINT transition_records_version_check;
ALTER TABLE workhub.transition_records ADD CONSTRAINT transition_records_version_check CHECK (CASE state
    WHEN 'awaiting_admin' THEN version = 1
    WHEN 'completed' THEN version = 1
    WHEN 'pending' THEN version IN (1, 2)
    ELSE version IN (2, 3) END);
ALTER TABLE workhub.transition_history DROP CONSTRAINT transition_history_action_check;
ALTER TABLE workhub.transition_history ADD CONSTRAINT transition_history_action_check
  CHECK (action IN ('apply','admin_confirm','admin_reject','accept','reject','cancel') AND ((version = 1) = (action = 'apply'))
         AND (action NOT IN ('admin_confirm','admin_reject') OR version = 2));

-- 기록 갱신 규칙: 상태 · 판만, 정해진 길로만
CREATE OR REPLACE FUNCTION workhub_private.p7_record_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '인계 · 학년도 기록은 지우지 않습니다.'; END IF;
  -- [P8-03] awaiting_admin 1 → pending · rejected · cancelled 2, pending n → accepted · rejected · cancelled n+1
  IF (to_jsonb(NEW) - ARRAY['state','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['state','version','updated_at'])
     OR NOT ((OLD.state = 'awaiting_admin' AND OLD.version = 1 AND NEW.version = 2 AND NEW.state IN ('pending','rejected','cancelled'))
          OR (OLD.state = 'pending' AND NEW.version = OLD.version + 1 AND NEW.state IN ('accepted','rejected','cancelled'))) THEN
    RAISE EXCEPTION 'IMMUTABLE_ROW' USING DETAIL = '대기 중인 인계만 정해진 순서로 한 번씩 바뀝니다.';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END $$;

-- ----------------------------------------------------------------------------
-- 2. 공통
-- ----------------------------------------------------------------------------
-- 관리자 확인 계약이 켜져 있는가(학교별 duty_admin_review 활성)
CREATE FUNCTION workhub_private.p8_duty_review_active(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT workhub_private.p2_module_active(p_school, 'duty_admin_review')
$$;
-- 새 목록 모양을 쓸 학교인가(켬 · 중지 상관없이 활성화 행이 있으면). 행이 없으면 옛 모양 그대로.
CREATE FUNCTION workhub_private.p8_duty_review_known(p_school text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM workhub.module_activations WHERE school_id = p_school AND module = 'duty_admin_review')
$$;
-- 계획에 공식 담당이 들었는가(모양 검사 뒤에만 부른다)
CREATE FUNCTION workhub_private.p8_plan_has_duty(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p ->> 'kind' = 'handover' AND EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'resources') e WHERE e ->> 'kind' = 'duty')
$$;
-- 지문 재료에 관리자 확인 정책판을 넣는다(공식 담당이 든 계획만). 정책이 바뀌면 이전 미리보기로 적용할 수 없다.
CREATE FUNCTION workhub_private.p8_tr_state(p_state jsonb, p jsonb, p_school text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN workhub_private.p8_plan_has_duty(p)
              THEN p_state || jsonb_build_object('dutyPolicy', CASE WHEN workhub_private.p8_duty_review_active(p_school) THEN 'admin_review_v1' END)
              ELSE p_state END
$$;

-- 실제 이력에서 만든 관리자 결정(없으면 NULL)
CREATE FUNCTION workhub_private.p8_admin_review(p_record text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('memberId', h.actor_membership_id, 'name', workhub_private.p8_label(a.display_name, 100, '이름 없음'),
           'decision', CASE h.action WHEN 'admin_confirm' THEN 'confirmed' ELSE 'rejected' END,
           'reason', h.reason, 'recordedAt', workhub_private.p2_ts(h.recorded_at))
    FROM workhub.transition_history h JOIN workhub.accounts a ON a.id = h.actor_account_id
   WHERE h.record_id = p_record AND h.action IN ('admin_confirm','admin_reject')
$$;

-- 새 모양 기록 DTO
CREATE FUNCTION workhub_private.p8_record_dto(t workhub.transition_records, p_ctx workhub_private.actor_context, p_manage boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT jsonb_build_object('id', t.id, 'kind', t.kind, 'title', t.title, 'version', t.version, 'state', t.state,
    'canAccept', t.state = 'pending' AND t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id,
    'canCancel', t.state IN ('pending','awaiting_admin') AND t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id,
    'summary', t.summary,
    'requesterMemberId', t.requester_membership_id,
    'requiresAdminReview', x.duty,
    -- 확인 · 반려: 연도 관리 권한 + 확인 대기 + 켜져 있음 + 요청자도 받는 사람도 아님(같은 계정의 다른 소속도 아님)
    'canAdminReview', x.duty AND t.state = 'awaiting_admin' AND p_manage AND workhub_private.p8_duty_review_active(t.school_id)
                      AND t.requester_membership_id <> p_ctx.membership_id AND t.requester_account_id <> p_ctx.account_id
                      AND t.recipient_membership_id IS DISTINCT FROM p_ctx.membership_id AND t.recipient_account_id IS DISTINCT FROM p_ctx.account_id,
    'adminReview', workhub_private.p8_admin_review(t.id))
  FROM (SELECT EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty') AS duty) x
$$;

-- 관리자 확인 때 다시 보는 것: 모든 항목의 원본 판 · 소유 · 기간, 받는 사람 유효성. 하나라도 다르면 CONFLICT(부분 확인 없음).
-- 원본 행은 공유 잠금(이 트랜잭션 동안 다른 변경과 줄 세움). 바꾸지는 않는다 — 실제 이전은 받는 사람 수락(p7_accept_items) 때.
CREATE FUNCTION workhub_private.p8_handover_recheck(p_ctx workhub_private.actor_context, t workhub.transition_records) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE i workhub.transition_items; a workhub.staff_assignments; r workhub.cooperation_requests; c workhub.collections; me workhub.memberships;
BEGIN
  IF NOT workhub_private.p2_member_reachable(p_ctx.school_id, t.recipient_membership_id)
     OR NOT EXISTS (SELECT 1 FROM workhub.memberships m WHERE m.school_id = p_ctx.school_id AND m.id = t.recipient_membership_id
                     AND m.account_id = t.recipient_account_id) THEN
    RAISE EXCEPTION 'CONFLICT';
  END IF;
  SELECT * INTO me FROM workhub.memberships WHERE school_id = p_ctx.school_id AND id = t.requester_membership_id FOR SHARE;
  FOR i IN SELECT * FROM workhub.transition_items WHERE record_id = t.id ORDER BY kind, resource_id LOOP
    IF i.kind = 'duty' THEN
      IF NOT (workhub_private.p7_ready(p_ctx.school_id, 'duty_handover') AND workhub_private.p7_admin_active(p_ctx.school_id)) THEN
        RAISE EXCEPTION 'NOT_READY';
      END IF;
      SELECT * INTO a FROM workhub.staff_assignments WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR SHARE;
      IF NOT FOUND OR a.membership_id <> t.requester_membership_id OR a.kind <> 'duty' OR a.status <> 'active' OR a.version <> i.resource_version
         OR NOT (a.valid_from < p_ctx.school_today AND p_ctx.school_today < a.valid_to)
         OR LEAST(a.valid_to, COALESCE(me.valid_to, a.valid_to)) <= p_ctx.school_today THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    ELSIF i.kind = 'cooperation' THEN
      IF NOT workhub_private.p7_bridge() OR NOT workhub_private.p2_module_active(p_ctx.school_id, 'cooperation') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      SELECT * INTO r FROM workhub.cooperation_requests WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR SHARE;
      IF NOT FOUND OR r.recipient_membership_id <> t.requester_membership_id OR r.recipient_account_id <> t.requester_account_id
         OR r.version <> i.resource_version OR r.status NOT IN ('requested','accepted','completion_requested')
         OR r.sender_account_id = t.recipient_account_id OR r.sender_membership_id = t.recipient_membership_id THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    ELSE
      IF NOT workhub_private.p7_bridge() OR NOT workhub_private.p7_r1_readable() THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      SELECT * INTO c FROM workhub.collections WHERE school_id = p_ctx.school_id AND id = i.resource_id FOR SHARE;
      IF c.id IS NULL OR c.owner_membership_id <> t.requester_membership_id OR c.owner_account_id <> t.requester_account_id
         OR c.state <> 'published' OR workhub_private.p7_phase(c.school_id, c.id) = 'archived'
         OR workhub_private.p7_ops_version(c.school_id, c.id) <> i.resource_version THEN
        RAISE EXCEPTION 'CONFLICT';
      END IF;
    END IF;
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. P7 함수 보강
-- ----------------------------------------------------------------------------
-- 인계할 수 있는 내 자원: [P8-03] 공식 담당은 관리자 확인 계약이 켜진 학교에서만, 관리자 확인 대기 인계에 든 자원도 뺀다
CREATE OR REPLACE FUNCTION workhub_private.p7_resources(p_school text, p_membership text, p_account text, p_today date, p_except_record text DEFAULT NULL)
RETURNS TABLE (kind text, id text, version integer, label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x.kind, x.id, x.version, x.label FROM (
    SELECT 'duty'::text AS kind, a.id, a.version, left('공식 담당: ' || a.label, 200) AS label, 1 AS ord, a.created_at AS created
      FROM workhub.staff_assignments a
     WHERE workhub_private.p7_ready(p_school, 'duty_handover') AND workhub_private.p7_admin_active(p_school)
       AND workhub_private.p8_duty_review_active(p_school)
       AND a.school_id = p_school AND a.membership_id = p_membership AND a.kind = 'duty' AND a.status = 'active'
       AND a.valid_from < p_today AND p_today < a.valid_to
    UNION ALL
    SELECT 'cooperation', r.id, r.version, left('협업: ' || r.title, 200), 2, r.created_at
      FROM workhub.cooperation_requests r
     WHERE workhub_private.p7_bridge() AND workhub_private.p2_module_active(p_school, 'cooperation')
       AND r.school_id = p_school AND r.recipient_membership_id = p_membership AND r.recipient_account_id = p_account
       AND r.status IN ('requested','accepted','completion_requested') AND r.id ~ '^[a-zA-Z0-9_-]{1,100}$'
    UNION ALL
    SELECT 'collection', c.id, workhub_private.p7_ops_version(c.school_id, c.id), left('수합: ' || c.title, 200), 3, c.created_at
      FROM workhub.collections c
     WHERE workhub_private.p7_bridge() AND workhub_private.p7_r1_readable()
       AND c.school_id = p_school AND c.owner_membership_id = p_membership AND c.owner_account_id = p_account
       AND c.state = 'published' AND workhub_private.p7_phase(c.school_id, c.id) <> 'archived') x
  WHERE NOT EXISTS (SELECT 1 FROM workhub.transition_items i JOIN workhub.transition_records t ON t.id = i.record_id
                     WHERE i.school_id = p_school AND i.kind = x.kind AND i.resource_id = x.id AND t.state IN ('pending','awaiting_admin')
                       AND t.id IS DISTINCT FROM p_except_record)
  ORDER BY x.ord, x.created, x.id
$$;

-- 미리보기: [P8-03] 공식 담당이 든 계획은 관리자 확인 계약이 켜져 있어야 하고, 지문에 정책판이 들어간다
CREATE OR REPLACE FUNCTION workhub_private.p7_tr_preview(p_ctx workhub_private.actor_context, p jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE e jsonb; v_bucket bigint := workhub_private.p7_bucket(clock_timestamp()); v_excl jsonb;
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  PERFORM workhub_private.p7_plan_check(p);
  IF workhub_private.p8_plan_has_duty(p) AND NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  e := workhub_private.p7_plan_eval(p_ctx, p);
  v_excl := e -> 'excluded';
  IF workhub_private.p8_plan_has_duty(p) THEN
    v_excl := v_excl || to_jsonb('공식 담당이 들어 있어 학교 관리자가 먼저 확인합니다. 확인 뒤에 받는 사람이 수락할 수 있습니다.'::text);
  END IF;
  RETURN jsonb_build_object('fingerprint', workhub_private.p7_fingerprint(p_ctx, p, workhub_private.p8_tr_state(e -> 'state', p, p_ctx.school_id), v_bucket),
    'expiresAt', workhub_private.p2_ts(to_timestamp((v_bucket + 2) * 600)),
    'summary', e -> 'summary', 'excluded', v_excl, 'affectedCount', e -> 'affectedCount');
END $$;

-- 목록: [P8-03] 활성화 행이 있는 학교는 새 모양(dutyApproval + 기록 확장 4필드), 관리자는 공식 담당 인계도 본다
CREATE OR REPLACE FUNCTION workhub_private.p7_tr_list(p_ctx workhub_private.actor_context, p_cursor text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_cur jsonb; v_manage boolean; v_page jsonb; v_records jsonb; v_next text; v_modern boolean; v_out jsonb;
BEGIN
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  v_cur := workhub_private.p7_cursor_in(p_cursor, p_ctx.membership_id);
  v_manage := workhub_private.p7_can_manage_year(p_ctx);
  v_modern := workhub_private.p8_duty_review_known(p_ctx.school_id);
  -- 내가 요청했거나 받는 기록 + (연도 관리자면) 새 학년도 기록 + (새 모양 · 연도 관리자면) 공식 담당이 든 인계. 새 것부터 50건씩.
  SELECT COALESCE(jsonb_agg(jsonb_build_object('t', to_char(s.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
                                               'i', s.id, 'dto', s.dto) ORDER BY s.created_at DESC, s.id DESC), '[]'::jsonb)
    INTO v_page
    FROM (SELECT t.created_at, t.id,
                 CASE WHEN v_modern THEN workhub_private.p8_record_dto(t, p_ctx, v_manage) ELSE workhub_private.p7_record_dto(t, p_ctx) END AS dto
            FROM workhub.transition_records t
           WHERE t.school_id = p_ctx.school_id
             AND ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
               OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)
               OR (t.kind = 'new_year' AND v_manage)
               OR (v_modern AND v_manage AND t.kind = 'handover'
                   AND EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty')))
             AND (v_cur IS NULL OR (t.created_at, t.id) < ((v_cur ->> 't')::timestamptz, v_cur ->> 'i'))
           ORDER BY t.created_at DESC, t.id DESC
           LIMIT 51) s;
  SELECT COALESCE(jsonb_agg(x -> 'dto' ORDER BY n), '[]'::jsonb) INTO v_records
    FROM jsonb_array_elements(v_page) WITH ORDINALITY e(x, n) WHERE n <= 50;
  IF jsonb_array_length(v_page) > 50 THEN
    v_next := workhub_private.p7_cursor_out(jsonb_build_object('o', p_ctx.membership_id, 't', v_page -> 49 ->> 't', 'i', v_page -> 49 ->> 'i'));
  END IF;
  v_out := jsonb_build_object(
    'canManageYear', v_manage,
    'years', CASE WHEN v_manage THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', y.id, 'label', y.school_year || '학년도', 'year', y.school_year)
                                                           ORDER BY y.school_year DESC), '[]'::jsonb)
                                        FROM (SELECT * FROM workhub.academic_years WHERE school_id = p_ctx.school_id AND id ~ '^[a-zA-Z0-9_-]{1,100}$'
                                               ORDER BY school_year DESC LIMIT 100) y)
                  ELSE '[]'::jsonb END,
    'recipients', (SELECT COALESCE(jsonb_agg(jsonb_build_object('memberId', z.id, 'name', z.name, 'version', z.version) ORDER BY z.name, z.id), '[]'::jsonb)
                     FROM (SELECT m.id, left(a.display_name, 100) AS name, m.version
                             FROM workhub.memberships m JOIN workhub.accounts a ON a.id = m.account_id
                            WHERE m.school_id = p_ctx.school_id AND m.id ~ '^[a-zA-Z0-9_-]{1,100}$'
                              AND workhub_private.p7_recipient_ok(p_ctx, m.id)
                            ORDER BY left(a.display_name, 100), m.id LIMIT 500) z),
    'resources', (SELECT COALESCE(jsonb_agg(jsonb_build_object('kind', s.kind, 'id', s.id, 'version', s.version, 'label', s.label)), '[]'::jsonb)
                    FROM (SELECT * FROM workhub_private.p7_resources(p_ctx.school_id, p_ctx.membership_id, p_ctx.account_id, p_ctx.school_today) LIMIT 200) s),
    'records', v_records,
    'nextCursor', v_next);
  IF v_modern THEN
    v_out := v_out || jsonb_build_object('dutyApproval', CASE WHEN workhub_private.p8_duty_review_active(p_ctx.school_id) THEN 'admin_review_v1' END);
  END IF;
  RETURN v_out;
END $$;

-- 명령: [P8-03] 공식 담당 인계 = 관리자 확인 → 받는 사람 수락. 원장(같은 키 재전송) 확인이 언제나 먼저.
CREATE OR REPLACE FUNCTION workhub_private.p7_tr_mutate(p_ctx workhub_private.actor_context, p_cmd jsonb, p_key text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  q workhub.operation_requests; t workhub.transition_records; e jsonb; y workhub.academic_years; v_hash text; v_kind text;
  v_bucket bigint := workhub_private.p7_bucket(clock_timestamp()); v_now timestamptz := clock_timestamp(); v_resp jsonb;
  v_state text; v_plan jsonb; v_ord integer := 0; it jsonb; v_rev bigint; v_from text; v_duty boolean; v_tstate jsonb;
  v_notify text[] := ARRAY[]::text[]; v_title text[] := ARRAY[]::text[]; k integer;
BEGIN
  IF NOT workhub_private.p7_key(p_key) THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_hash := workhub_private.p2_sha(p_cmd);
  PERFORM workhub_private.p7_lock(p_ctx, 'transitions', p_key);
  q := workhub_private.p7_ledger(p_ctx, 'transitions', p_key, v_hash);
  IF q.request_key IS NOT NULL THEN RETURN q.response; END IF;
  IF NOT workhub_private.p7_ready(p_ctx.school_id, 'transitions') THEN RAISE EXCEPTION 'NOT_READY'; END IF;
  IF p_cmd IS NULL OR jsonb_typeof(p_cmd) <> 'object' OR jsonb_typeof(p_cmd -> 'kind') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'INVALID_INPUT'; END IF;
  v_kind := p_cmd ->> 'kind';

  IF v_kind = 'apply' THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','plan','fingerprint']) OR jsonb_typeof(p_cmd -> 'fingerprint') IS DISTINCT FROM 'string'
       OR (p_cmd ->> 'fingerprint') !~ '^[a-f0-9]{64}$' THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    v_plan := p_cmd -> 'plan';
    PERFORM workhub_private.p7_plan_check(v_plan);
    v_duty := workhub_private.p8_plan_has_duty(v_plan);
    IF v_duty AND NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    e := workhub_private.p7_plan_eval(p_ctx, v_plan);
    v_tstate := workhub_private.p8_tr_state(e -> 'state', v_plan, p_ctx.school_id);
    -- 미리보기 뒤 상태 · 정책이 바뀌었거나 지문이 만료(10~20분)되면 CONFLICT → 다시 미리보기
    IF (p_cmd ->> 'fingerprint') NOT IN (workhub_private.p7_fingerprint(p_ctx, v_plan, v_tstate, v_bucket),
                                         workhub_private.p7_fingerprint(p_ctx, v_plan, v_tstate, v_bucket - 1)) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    IF v_plan ->> 'kind' = 'handover' THEN
      INSERT INTO workhub.transition_records (school_id, kind, title, requester_membership_id, requester_account_id, recipient_membership_id,
          recipient_account_id, state, version, note, plan, summary)
      VALUES (p_ctx.school_id, 'handover', e ->> 'title', p_ctx.membership_id, p_ctx.account_id, e ->> 'recipient', e ->> 'recipientAccount',
              CASE WHEN v_duty THEN 'awaiting_admin' ELSE 'pending' END, 1, v_plan ->> 'note', v_plan,
              (e -> 'summary') || (e -> 'excluded')
              || CASE WHEN v_duty THEN jsonb_build_array('공식 담당이 들어 있어 학교 관리자가 먼저 확인합니다. 확인 뒤에 받는 사람이 수락할 수 있습니다.')
                      ELSE '[]'::jsonb END
              || jsonb_build_array('메모: ' || left(v_plan ->> 'note', 990)))
      RETURNING * INTO t;
      FOR it IN SELECT x FROM jsonb_array_elements(e -> 'items') x LOOP
        v_ord := v_ord + 1;
        INSERT INTO workhub.transition_items (record_id, school_id, ordinal, kind, resource_id, resource_version, label)
        VALUES (t.id, t.school_id, v_ord, it ->> 'kind', it ->> 'id', (it ->> 'version')::integer, it ->> 'label');
      END LOOP;
      -- 관리자 확인 전에는 받는 사람에게 알리지 않는다(아직 수락할 수 없으므로)
      IF NOT v_duty THEN v_notify := ARRAY[t.recipient_membership_id]; v_title := ARRAY['업무 인계 요청이 왔습니다']; END IF;
    ELSE
      INSERT INTO workhub.academic_years (school_id, school_year, starts_on, ends_on, state)
      VALUES (p_ctx.school_id, (v_plan ->> 'targetYear')::smallint, (v_plan ->> 'firstDay')::date, (v_plan ->> 'lastDay')::date + 1, 'planning')
      RETURNING * INTO y;
      INSERT INTO workhub.terms (school_id, academic_year_id, term_no, label, starts_on, ends_on)
      VALUES (y.school_id, y.id, 1, '1학기', (v_plan ->> 'term1First')::date, (v_plan ->> 'term1Last')::date + 1),
             (y.school_id, y.id, 2, '2학기', (v_plan ->> 'term2First')::date, (v_plan ->> 'term2Last')::date + 1);
      IF (v_plan -> 'copyStructure')::boolean THEN
        INSERT INTO workhub.year_departments (school_id, academic_year_id, name, sort_order)
        SELECT school_id, y.id, name, sort_order FROM workhub.year_departments
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
        INSERT INTO workhub.year_classes (school_id, academic_year_id, grade, class_no, name, kind, sort_order)
        SELECT school_id, y.id, grade, class_no, name, kind, sort_order FROM workhub.year_classes
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
        INSERT INTO workhub.year_subjects (school_id, academic_year_id, name, sort_order)
        SELECT school_id, y.id, name, sort_order FROM workhub.year_subjects
         WHERE school_id = y.school_id AND academic_year_id = v_plan ->> 'sourceYearId' AND removed_at IS NULL ORDER BY sort_order, id;
      END IF;
      v_rev := workhub_private.p7_admin_change(p_ctx, 'save_configuration', y.school_year, 'academic_year', y.id, p_key,
        '새 학년도 만들기(업무 전환)', NULL,
        jsonb_build_object('year_id', y.id, 'school_year', y.school_year, 'starts_on', y.starts_on, 'ends_on', y.ends_on, 'state', y.state,
                           'copied_from', v_plan ->> 'sourceYearId', 'copy_structure', (v_plan -> 'copyStructure')::boolean,
                           'affected', (e -> 'affectedCount')::integer));
      INSERT INTO workhub.transition_records (school_id, kind, title, requester_membership_id, requester_account_id, state, version, plan, summary, result_year_id)
      VALUES (p_ctx.school_id, 'new_year', e ->> 'title', p_ctx.membership_id, p_ctx.account_id, 'completed', 1, v_plan,
              (e -> 'summary') || (e -> 'excluded'), y.id)
      RETURNING * INTO t;
    END IF;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, request_key)
    VALUES (t.id, t.school_id, 1, 'apply', p_ctx.membership_id, p_ctx.account_id, p_key);

  ELSIF v_kind IN ('admin_confirm','admin_reject') THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','recordId','expectedVersion','reason']) OR NOT workhub_private.p7_id(p_cmd -> 'recordId')
       OR NOT workhub_private.p7_pos(p_cmd -> 'expectedVersion') OR NOT workhub_private.p7_text(p_cmd -> 'reason', 1000) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.transition_records WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'recordId' FOR UPDATE;
    v_duty := t.id IS NOT NULL AND EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty');
    -- 관리자가 볼 수 있는 기록(공식 담당이 든 인계)이 아니면, 당사자에게는 FORBIDDEN · 그 밖에는 NOT_FOUND(있는지 알리지 않는다)
    IF NOT v_duty OR NOT workhub_private.p7_can_manage_year(p_ctx) THEN
      IF t.id IS NOT NULL AND ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
                               OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)) THEN
        RAISE EXCEPTION 'FORBIDDEN';
      END IF;
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    IF NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    -- 자기 확인 금지: 요청자 · 받는 사람(같은 계정의 다른 소속 포함)은 관리자 자격으로 확인 · 반려하지 않는다
    IF t.requester_membership_id = p_ctx.membership_id OR t.requester_account_id = p_ctx.account_id
       OR t.recipient_membership_id = p_ctx.membership_id OR t.recipient_account_id = p_ctx.account_id THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    IF t.version <> (p_cmd ->> 'expectedVersion')::integer OR t.state <> 'awaiting_admin' THEN RAISE EXCEPTION 'CONFLICT'; END IF;
    IF v_kind = 'admin_confirm' THEN
      PERFORM workhub_private.p8_handover_recheck(p_ctx, t);
      v_from := t.state;
      UPDATE workhub.transition_records SET state = 'pending', version = 2 WHERE id = t.id RETURNING * INTO t;
      v_notify := ARRAY[t.recipient_membership_id, t.requester_membership_id];
      v_title := ARRAY['업무 인계 요청이 왔습니다', '업무 인계를 학교 관리자가 확인했습니다'];
    ELSE
      UPDATE workhub.transition_records SET state = 'rejected', version = 2 WHERE id = t.id RETURNING * INTO t;
      v_notify := ARRAY[t.requester_membership_id];
      v_title := ARRAY['업무 인계가 학교 관리자 확인에서 반려되었습니다'];
    END IF;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, reason, request_key)
    VALUES (t.id, t.school_id, 2, v_kind, p_ctx.membership_id, p_ctx.account_id, p_cmd ->> 'reason', p_key);

  ELSIF v_kind IN ('accept','reject','cancel') THEN
    IF NOT workhub_private.p2_exact(p_cmd, ARRAY['kind','recordId','expectedVersion','reason']) OR NOT workhub_private.p7_id(p_cmd -> 'recordId')
       OR NOT workhub_private.p7_pos(p_cmd -> 'expectedVersion') OR NOT workhub_private.p7_text(p_cmd -> 'reason', 1000) THEN
      RAISE EXCEPTION 'INVALID_INPUT';
    END IF;
    SELECT * INTO t FROM workhub.transition_records WHERE school_id = p_ctx.school_id AND id = p_cmd ->> 'recordId' FOR UPDATE;
    IF NOT FOUND OR NOT ((t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)
                         OR (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id)) THEN
      RAISE EXCEPTION 'NOT_FOUND';
    END IF;
    -- 수락 · 거절은 받는 사람, 취소는 요청한 사람
    IF (v_kind IN ('accept','reject') AND NOT (t.recipient_membership_id = p_ctx.membership_id AND t.recipient_account_id = p_ctx.account_id))
       OR (v_kind = 'cancel' AND NOT (t.requester_membership_id = p_ctx.membership_id AND t.requester_account_id = p_ctx.account_id)) THEN
      RAISE EXCEPTION 'FORBIDDEN';
    END IF;
    -- 수락 · 거절은 pending(관리자 확인 대기 중에는 받는 사람이 처리할 수 없다), 취소는 pending · awaiting_admin
    IF t.version <> (p_cmd ->> 'expectedVersion')::integer
       OR (v_kind IN ('accept','reject') AND t.state <> 'pending') OR (v_kind = 'cancel' AND t.state NOT IN ('pending','awaiting_admin')) THEN
      RAISE EXCEPTION 'CONFLICT';
    END IF;
    v_duty := EXISTS (SELECT 1 FROM workhub.transition_items i WHERE i.record_id = t.id AND i.kind = 'duty');
    -- 공식 담당 수락은 관리자 확인 계약이 켜져 있을 때만(관리자 확인 기록이 있는 pending 2 — 판 규칙이 보장)
    IF v_kind = 'accept' AND v_duty AND NOT workhub_private.p8_duty_review_active(p_ctx.school_id) THEN RAISE EXCEPTION 'NOT_READY'; END IF;
    -- 수락하는 사람은 지금도 받을 수 있는 사람이어야 한다(업무실 사용자 범위 · 오늘 유효)
    IF v_kind = 'accept' AND NOT workhub_private.p2_member_reachable(p_ctx.school_id, p_ctx.membership_id) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
    IF v_kind = 'accept' THEN PERFORM workhub_private.p7_accept_items(p_ctx, t, p_key); END IF;
    v_from := t.state;
    v_state := CASE v_kind WHEN 'accept' THEN 'accepted' WHEN 'reject' THEN 'rejected' ELSE 'cancelled' END;
    UPDATE workhub.transition_records SET state = v_state, version = t.version + 1 WHERE id = t.id RETURNING * INTO t;
    INSERT INTO workhub.transition_history (record_id, school_id, version, action, actor_membership_id, actor_account_id, reason, request_key)
    VALUES (t.id, t.school_id, t.version, v_kind, p_ctx.membership_id, p_ctx.account_id, p_cmd ->> 'reason', p_key);
    IF v_kind = 'cancel' THEN
      -- 관리자 확인 전에 철회하면 받는 사람은 요청을 받은 적이 없으므로 알리지 않는다
      IF v_from = 'pending' THEN v_notify := ARRAY[t.recipient_membership_id]; v_title := ARRAY['업무 인계 요청이 취소되었습니다']; END IF;
    ELSE
      v_notify := ARRAY[t.requester_membership_id];
      v_title := ARRAY[CASE v_kind WHEN 'accept' THEN '업무 인계가 수락되었습니다' ELSE '업무 인계가 거절되었습니다' END];
    END IF;
  ELSE
    RAISE EXCEPTION 'INVALID_INPUT';
  END IF;

  -- 사이트 알림(메신저가 준비된 학교만, 실패하면 명령 전체를 되돌린다). 중복 방지 키 = 기록 · 판(받는 사람마다 1건)
  IF workhub_private.p3_messaging_reason(p_ctx.school_id) = 'ready' THEN
    FOR k IN 1 .. COALESCE(array_length(v_notify, 1), 0) LOOP
      PERFORM workhub_private.p3_notify(t.school_id, v_notify[k], v_title[k], t.title, NULL, NULL, 'p7:transition:' || t.id || ':' || t.version);
    END LOOP;
  END IF;
  PERFORM workhub_private.write_audit(p_ctx, 'transitions.' || CASE WHEN v_kind = 'apply' THEN 'apply_' || t.kind ELSE v_kind END,
    'transition', t.id, t.version, 'school', p_key,
    jsonb_build_object('kind', t.kind, 'state', t.state, 'items', (SELECT count(*) FROM workhub.transition_items WHERE record_id = t.id),
                       'year_id', t.result_year_id));
  v_resp := jsonb_build_object('requestKey', p_key, 'recordId', t.id, 'version', t.version, 'state', t.state, 'recordedAt', workhub_private.p2_ts(v_now));
  PERFORM workhub_private.p7_record(p_ctx, 'transitions', p_key, v_hash, t.id, v_resp);
  RETURN v_resp;
END $$;

-- ----------------------------------------------------------------------------
-- 4. 권한 — 새 내부 함수는 API 역할 실행 불가(바꾼 P7 함수는 CREATE OR REPLACE 라 원래 권한 그대로)
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION workhub_private.p8_duty_review_active(text), workhub_private.p8_duty_review_known(text), workhub_private.p8_plan_has_duty(jsonb),
  workhub_private.p8_tr_state(jsonb, jsonb, text), workhub_private.p8_admin_review(text),
  workhub_private.p8_record_dto(workhub.transition_records, workhub_private.actor_context, boolean),
  workhub_private.p8_handover_recheck(workhub_private.actor_context, workhub.transition_records) FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO workhub_private.p8_installs (batch, release) VALUES ('P8-03', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 5. 검증 — 모든 행의 status 가 ok 여야 한다. P8-03-4 는 "아직 켜지 않음"이 정상이다(P8-06 전).
-- ----------------------------------------------------------------------------
SELECT 'P8-03-1' AS no, '상태 · 판 · 이력 CHECK 넓힘(awaiting_admin · admin_confirm · admin_reject)' AS item,
       CASE WHEN (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'transition_records_shape_check') LIKE '%awaiting_admin%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'transition_records_version_check') LIKE '%awaiting_admin%'
             AND (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'transition_history_action_check') LIKE '%admin_confirm%'
            THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
UNION ALL
SELECT 'P8-03-2', '바꾼 P7 함수 4개 · 새 함수 7개: API 역할 실행 불가 · SECURITY DEFINER(트리거 함수 제외) · search_path 고정',
       CASE WHEN count(*) = 11 AND bool_and(p.proconfig = ARRAY['search_path=""']
              AND (p.prosecdef OR p.proname = 'p8_plan_has_duty')
              AND NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
              AND NOT has_function_privilege('service_role', p.oid, 'EXECUTE')) THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM pg_proc p WHERE p.pronamespace = 'workhub_private'::regnamespace
  AND p.proname IN ('p7_resources','p7_tr_preview','p7_tr_list','p7_tr_mutate','p8_duty_review_active','p8_duty_review_known','p8_plan_has_duty',
                    'p8_tr_state','p8_admin_review','p8_record_dto','p8_handover_recheck')
UNION ALL
SELECT 'P8-03-3', '공식 담당이 든 인계 기록 0(설치 직후)', CASE WHEN count(*) = 0 THEN 'ok' ELSE 'FAIL' END, count(*)::text
FROM workhub.transition_items WHERE kind = 'duty'
UNION ALL
SELECT 'P8-03-4', '아직 어느 학교도 관리자 확인 계약을 켜지 않음(목록은 옛 모양 그대로)',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'duty_admin_review') = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-03-5', '적용 기록 P8-03', CASE WHEN workhub_private.p8_installed('P8-03') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
