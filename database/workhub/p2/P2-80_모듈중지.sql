-- ============================================================================
-- P2-80  모듈 중지 — 학교 1곳의 모듈 하나를 중지한다. 자료를 지우지 않는다(DROP·DELETE 없음).
--
-- ▣ 중지하면 그 학교의 그 모듈은 조회·새 변경이 UNAVAILABLE 로 멈춘다. 이미 받은 요청의 접수증 재조회와 자료는 그대로다.
-- ▣ 무엇을 바꾸나: module_activations 1행의 state·state_note·state_changed_at 만(감사 1건).
-- ▣ <...> 칸 3개를 채워야 실행된다. 뒤 배치(3~7단계)의 모듈도 이 파일로 중지한다.
-- ============================================================================
DO $do$
DECLARE
  v_code text := '<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>';
  v_module text := '<모듈: calendar_batch · cooperation 등>';
  v_note text := '<사유: 날짜와 이유>';
  act record;
BEGIN
  IF v_code LIKE '<%' OR v_module LIKE '<%' OR v_note LIKE '<%' THEN RAISE EXCEPTION 'P2-80 중단: 학교 코드·모듈·사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF length(btrim(v_note)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P2-80 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub.module_activations') IS NULL THEN RAISE EXCEPTION 'P2-80 중단: P2-01 이 적용되어 있지 않습니다.'; END IF;
  SELECT a.* INTO act FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id
   WHERE s.code = v_code AND a.module = v_module FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'P2-80 중단: 이 학교·모듈의 활성화 행이 없습니다(P2-04 전이거나 코드·모듈 이름이 다름).'; END IF;
  IF act.state <> 'active' THEN RAISE EXCEPTION 'P2-80 중단: 이미 stopped 상태입니다. 아무것도 바꾸지 않았습니다.'; END IF;
  UPDATE workhub.module_activations SET state = 'stopped', state_note = btrim(v_note), state_changed_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE school_id = act.school_id AND module = act.module;
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id,
      sensitivity, details, scope_key)
  SELECT act.school_id, m.account_id, m.id, 'module.stopped', 'module_activation', act.school_id || ':' || act.module, 'school',
         jsonb_build_object('module', act.module, 'note', left(btrim(v_note), 200), 'by', session_user), 's:' || act.school_id
    FROM workhub.memberships m WHERE m.school_id = act.school_id AND m.id = act.approved_by_membership_id;
  RAISE NOTICE 'P2-80: % 학교의 % 모듈을 중지했습니다.', v_code, v_module;
END $do$;

-- 확인(읽기 전용)
SELECT s.code, a.module, a.state, a.state_note, a.state_changed_at
  FROM workhub.module_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY s.code, a.module;
