-- ============================================================================
-- P1-80  학교 관리 — 학교별 중지. 자료를 지우지 않는다.
--
-- ▣ 끄면 이 학교의 학교 관리 조회·새 변경이 NOT_READY 로 멈춘다. 이미 받은 요청의 접수증 재조회와 학년도·소속·담당 자료는 그대로다.
-- ▣ 무엇을 바꾸나: school_admin_activations 1행의 state·state_note·state_changed_at 만(감사 1건).
--   공식 담당이 업무실 관계(member_relations)에 쓰이는 것은 켜짐 여부와 상관없이 그대로다.
-- ▣ <...> 칸 2개를 채워야 실행된다.
-- ============================================================================
DO $do$
DECLARE
  v_code text := '<학교 코드: R0-03 에서 정한 code, 예 daedong-ms>';
  v_note text := '<사유: 날짜와 이유>';
  act record;   -- 표 형식으로 선언하면 P1-01 전에는 안내 대신 '없는 형식' 오류가 난다
BEGIN
  IF v_code LIKE '<%' OR v_note LIKE '<%' THEN RAISE EXCEPTION 'P1-80 중단: 학교 코드와 사유 칸을 채워 주세요. 아무것도 바꾸지 않았습니다.'; END IF;
  IF length(btrim(v_note)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'P1-80 중단: 사유는 1~200자입니다.'; END IF;
  IF to_regclass('workhub.school_admin_activations') IS NULL THEN RAISE EXCEPTION 'P1-80 중단: P1-01 이 적용되어 있지 않습니다.'; END IF;
  SELECT a.* INTO act FROM workhub.school_admin_activations a JOIN workhub.schools s ON s.id = a.school_id WHERE s.code = v_code FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'P1-80 중단: 이 학교 코드의 활성화 행이 없습니다(P1-04 전이거나 코드가 다름).'; END IF;
  IF act.state <> 'active' THEN RAISE EXCEPTION 'P1-80 중단: 이미 stopped 상태입니다. 아무것도 바꾸지 않았습니다.'; END IF;
  UPDATE workhub.school_admin_activations SET state = 'stopped', state_note = btrim(v_note), state_changed_at = clock_timestamp(), updated_at = clock_timestamp()
   WHERE school_id = act.school_id;
  INSERT INTO workhub.audit_events (school_id, actor_account_id, actor_membership_id, operation, resource_type, resource_id, resource_version,
      sensitivity, details, scope_key)
  SELECT act.school_id, m.account_id, m.id, 'school_admin.stopped', 'school_admin', act.school_id, act.revision::integer, 'school',
         jsonb_build_object('note', left(btrim(v_note), 200), 'by', session_user), 's:' || act.school_id
    FROM workhub.memberships m WHERE m.school_id = act.school_id AND m.id = act.approved_by_membership_id;
  RAISE NOTICE 'P1-80: % 학교의 학교 관리를 중지했습니다.', v_code;
END $do$;

-- 확인(읽기 전용)
SELECT s.code, a.state, a.revision, a.state_note, a.state_changed_at
  FROM workhub.school_admin_activations a JOIN workhub.schools s ON s.id = a.school_id ORDER BY s.code;
