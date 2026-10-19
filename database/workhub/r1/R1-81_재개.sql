-- ============================================================================
-- R1-81  수합 재개 — R1-80 으로 멈춘 것을 다시 연다.
--
-- ▣ 재개해도 준비 상태는 정책(R1-06)·검증 작업자 heartbeat·Storage 점검을 다시 따진다.
--   스위치만 열렸다고 "사용 가능"이 되지 않는다. 확인 SELECT 의 reason 이 null 이어야 실제로 열린 것이다.
-- ▣ 무엇을 바꾸나: r1_switch 1행의 state·reason 만. 기록은 r1_switch_log 에 남는다.
-- ▣ <...> 칸을 채워야 실행된다.
-- ============================================================================
DO $do$
DECLARE
  v_reason text := '<사유: 날짜와 이유>';
  v_old    text;
BEGIN
  IF v_reason LIKE '<%' THEN RAISE EXCEPTION 'R1-81 중단: 사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF length(btrim(v_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1-81 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub_private.r1_switch') IS NULL THEN RAISE EXCEPTION 'R1-81 중단: R1-01 이 적용되어 있지 않습니다(중지 스위치 없음).'; END IF;
  SELECT state INTO v_old FROM workhub_private.r1_switch FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'R1-81 중단: R1-01 이 적용되어 있지 않습니다(중지 스위치 없음).'; END IF;
  IF v_old = 'open' THEN RAISE EXCEPTION 'R1-81 중단: 이미 열려 있습니다. 아무것도 바꾸지 않았습니다.'; END IF;
  UPDATE workhub_private.r1_switch SET state = 'open', reason = btrim(v_reason);
  RAISE NOTICE 'R1-81: % → open 으로 바꿨습니다.', v_old;
END $do$;

-- 확인(읽기 전용): 스위치와 준비 상태 판단 재료
SELECT s.state, s.reason, s.changed_at, s.changed_by FROM workhub_private.r1_switch s;
SELECT (SELECT count(*) FROM workhub.policy_versions WHERE state = 'published') AS published_policies,
       (SELECT max(expires_at) FROM workhub.file_verifier_heartbeats) AS last_heartbeat_expires;
