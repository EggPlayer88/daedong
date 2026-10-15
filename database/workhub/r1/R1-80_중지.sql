-- ============================================================================
-- R1-80  수합 중지 — 자료를 지우지 않고 기능만 멈춘다. 되돌리기는 R1-81(재개).
--
-- ▣ 언제: 수합 화면·파일 처리에서 문제가 보였을 때, 원인 확인 전까지 피해가 늘지 않게.
-- ▣ 단계
--   writes_stopped  새 쓰기(만들기·게시·임시저장·제출·검토·철회·정정·업로드 준비/완료)와 Storage 업로드를 막는다.
--                   목록·상세·이미 제출된 파일 내려받기는 그대로 된다. 작업자 함수는 빈 결과만 돌려준다.
--   all_stopped     위에 더해 읽기·내려받기 허가 발급·Storage 읽기까지 막는다. 화면은 "준비 중"으로 보인다.
-- ▣ 무엇을 바꾸나: workhub_private.r1_switch 1행의 state·reason 만. 바꾼 사람·시각은 r1_switch_log 에 남는다.
--   회원·로그인·기존 자료·R0·수합 자료·파일 실물은 그대로다. DROP·DELETE 없음.
-- ▣ <...> 칸 2개를 채워야 실행된다(예: 'writes_stopped', '2026-10-20 업로드 오류 확인 중').
-- ============================================================================
DO $do$
DECLARE
  v_state  text := '<중지 단계: writes_stopped 또는 all_stopped>';
  v_reason text := '<사유: 날짜와 이유>';
  v_old    text;
BEGIN
  IF v_state LIKE '<%' OR v_reason LIKE '<%' THEN RAISE EXCEPTION 'R1-80 중단: 중지 단계와 사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF v_state NOT IN ('writes_stopped', 'all_stopped') THEN RAISE EXCEPTION 'R1-80 중단: 중지 단계는 writes_stopped 또는 all_stopped 입니다.'; END IF;
  IF length(btrim(v_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1-80 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub_private.r1_switch') IS NULL THEN RAISE EXCEPTION 'R1-80 중단: R1-01 이 적용되어 있지 않습니다(중지 스위치 없음).'; END IF;
  SELECT state INTO v_old FROM workhub_private.r1_switch FOR UPDATE;
  IF v_old IS NULL THEN RAISE EXCEPTION 'R1-80 중단: R1-01 이 적용되어 있지 않습니다(중지 스위치 없음).'; END IF;
  UPDATE workhub_private.r1_switch SET state = v_state, reason = btrim(v_reason);
  RAISE NOTICE 'R1-80: % → % 로 바꿨습니다.', v_old, v_state;
END $do$;

-- 확인(읽기 전용)
SELECT s.state, s.reason, s.changed_at, s.changed_by FROM workhub_private.r1_switch s;
SELECT l.old_state, l.new_state, l.reason, l.changed_at, l.changed_by FROM workhub_private.r1_switch_log l ORDER BY l.id DESC LIMIT 5;
