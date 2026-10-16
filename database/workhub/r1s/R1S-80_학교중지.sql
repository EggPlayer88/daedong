-- ============================================================================
-- R1S-80  HWPX 기본 확인 — 학교별 중지. 자료를 지우지 않고 이 학교의 기본 확인 경로만 끈다. 되돌리기는 R1S-81.
--
-- ▣ 언제: 확인 API·화면에서 문제가 보였을 때(잘못된 판정, 키 노출 의심, 배포 이상 등).
-- ▣ 끄면
--   - 확인 API(claim/finish)가 NOT_READY 로 멈추고, 이 학교의 쓰기 판정은 R1 원래 판정(검증 작업자 heartbeat)으로 돌아간다.
--     지금은 검증 작업자가 없으므로(R1-05 미실행) 새 쓰기(만들기·게시·임시저장·제출·검토·업로드 준비/완료)도 NOT_READY 로 멈춘다.
--   - 목록·상세·내려받기·이미 확정된 HWPX 파일 읽기는 그대로 된다(읽기 판정은 프로필 상태를 보지 않는다).
--   - 확인 중이던 파일은 "검증 대기"로 남는다. 다시 켜면(R1S-81) 임대가 끝난 뒤 다시 확인할 수 있다.
-- ▣ 무엇을 바꾸나: basic_profile_activations 1행의 state·state_reason 만. 바꾼 사람·시각은 activation_log 에 남는다.
--   R1 전체 중지(R1-80)와는 별개다. 학교 전체 수합을 멈추려면 R1-80 을 쓴다.
-- ▣ <...> 칸 2개를 채워야 실행된다.
-- ============================================================================
DO $do$
DECLARE
  v_code   text := '<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>';
  v_reason text := '<사유: 날짜와 이유>';
  act workhub.basic_profile_activations;
BEGIN
  IF v_code LIKE '<%' OR v_reason LIKE '<%' THEN RAISE EXCEPTION 'R1S-80 중단: 학교 코드와 사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF length(btrim(v_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1S-80 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub.basic_profile_activations') IS NULL THEN RAISE EXCEPTION 'R1S-80 중단: R1S-01 이 적용되어 있지 않습니다.'; END IF;
  SELECT a.* INTO act FROM workhub.basic_profile_activations a JOIN workhub.schools s ON s.id = a.school_id
   WHERE s.code = v_code AND a.profile = 'hwpx_basic_v1' FOR UPDATE OF a;
  IF act.id IS NULL THEN RAISE EXCEPTION 'R1S-80 중단: 이 학교 코드의 활성화 행이 없습니다(R1S-04 전이거나 코드가 다름).'; END IF;
  IF act.state = 'stopped' THEN RAISE EXCEPTION 'R1S-80 중단: 이미 꺼져 있습니다. 아무것도 바꾸지 않았습니다.'; END IF;
  UPDATE workhub.basic_profile_activations SET state = 'stopped', state_reason = btrim(v_reason) WHERE id = act.id;
  RAISE NOTICE 'R1S-80: % 학교의 HWPX 기본 확인을 껐습니다.', v_code;
END $do$;

-- 확인(읽기 전용)
SELECT a.school_id, a.state, a.state_reason, a.state_changed_at, a.state_changed_by,
       workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason' AS basic_reason
  FROM workhub.basic_profile_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY a.school_id;
SELECT l.activation_id, l.old_state, l.new_state, l.reason, l.changed_at, l.changed_by
  FROM workhub.basic_profile_activation_log l ORDER BY l.id DESC LIMIT 5;
