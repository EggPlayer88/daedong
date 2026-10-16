-- ============================================================================
-- R1S-81  HWPX 기본 확인 — 학교별 재개. R1S-80 으로 끈 것을 다시 켠다.
--
-- ▣ 켜도 준비 상태는 다시 따진다: R1·R1S 적용 기록 · 전체 스위치(R1-80) · Storage · 확인 서버 주체(활성·작업 목록·학교 범위 승인)
--   · 오늘 유효한 정책(HWPX 포함). 확인 SELECT 의 basic_reason 이 ready 여야 실제로 열린 것이다.
-- ▣ 승인 근거·배포 확인값은 R1S-04 때 값 그대로다. 확인 API 를 다시 배포했다면 그 사실을 사유에 적는다.
-- ▣ 무엇을 바꾸나: basic_profile_activations 1행의 state·state_reason 만. 기록은 activation_log 에 남는다.
-- ▣ <...> 칸 2개를 채워야 실행된다.
-- ============================================================================
DO $do$
DECLARE
  v_code   text := '<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>';
  v_reason text := '<사유: 날짜와 이유(재배포했다면 그 확인값도)>';
  act workhub.basic_profile_activations;
BEGIN
  IF v_code LIKE '<%' OR v_reason LIKE '<%' THEN RAISE EXCEPTION 'R1S-81 중단: 학교 코드와 사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF length(btrim(v_reason)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'R1S-81 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub.basic_profile_activations') IS NULL THEN RAISE EXCEPTION 'R1S-81 중단: R1S-01 이 적용되어 있지 않습니다.'; END IF;
  SELECT a.* INTO act FROM workhub.basic_profile_activations a JOIN workhub.schools s ON s.id = a.school_id
   WHERE s.code = v_code AND a.profile = 'hwpx_basic_v1' FOR UPDATE OF a;
  IF act.id IS NULL THEN RAISE EXCEPTION 'R1S-81 중단: 이 학교 코드의 활성화 행이 없습니다. 처음 켜는 것은 R1S-04 입니다.'; END IF;
  IF act.state = 'active' THEN RAISE EXCEPTION 'R1S-81 중단: 이미 켜져 있습니다. 아무것도 바꾸지 않았습니다.'; END IF;
  UPDATE workhub.basic_profile_activations SET state = 'active', state_reason = btrim(v_reason) WHERE id = act.id;
  RAISE NOTICE 'R1S-81: % 학교의 HWPX 기본 확인을 다시 켰습니다.', v_code;
END $do$;

-- 확인(읽기 전용)
SELECT a.school_id, a.state, a.state_reason, a.state_changed_at,
       workhub_private.c_basic_readiness(s.id, workhub_private.today_in(s.timezone)) ->> 'reason' AS basic_reason
  FROM workhub.basic_profile_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY a.school_id;
