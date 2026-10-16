-- ============================================================================
-- P8-02  정책 보강 2 — 협업 사이트 알림(C6) (비활성 설치)
--
-- ▣ 확정 정책(2026-10-16 계란님): 협업 알림은 사이트 안 알림만(메일 · 푸시 · 예약 작업 없음).
-- ▣ 무엇을 하나: 협업 상태 이력(workhub.cooperation_history)에 행이 생길 때 — 곧 협업 원본이 바뀌는 바로 그 트랜잭션 안에서 —
--   상대 당사자 1명에게 알림 1건을 만든다. 원본 변경이 되돌려지면 알림도 함께 사라진다(같은 트랜잭션).
--   출처는 정확히 {module:'cooperation', id:<협업 요청 ID>} 이다(앱 InboxNotice.source).
-- ▣ 누구에게(행동 × 받는 사람 × 중복 방지 키) — 받는 사람 = 그 행동을 한 사람의 상대 당사자
--     create                                   보낸 사람이 함 → 받는 사람
--     accept · decline · request_completion · retract_completion   받는 사람이 함 → 보낸 사람
--     confirm_completion · return_completion · cancel             보낸 사람이 함 → 받는 사람
--     handover(P7 업무 인계로 받는 사람이 바뀜)   새 받는 사람이 함 → 보낸 사람
--   중복 방지 키 = 'p8:coop:' || 요청 ID || ':' || 이력 판. 이력 (요청, 판)은 유일하고, 같은 요청 번호의 재전송은 원장 재생이라
--   이력이 새로 생기지 않는다 → 같은 행동으로 알림이 두 번 생기지 않는다(notifications 의 유일 키도 한 번 더 막는다).
-- ▣ 알림 내용: 제목 = 행동별 고정 문구, 본문 = 협업 제목(최대 120자). 협업 설명 · 의견(comment) · 학생 · 상담 · DM 본문은 복사하지 않는다.
--   알림은 "그때의 안내"다. 알림을 읽는 것(read_notice)은 수락 · 완료가 아니다. 원본을 열 때는 앱이 workhub_cooperation_get 으로
--   현재 받는 사람 · 상태 · 권한을 다시 확인한다(권한을 잃었으면 원본이 열리지 않는다 — P2 의 기존 조회 규칙 그대로).
-- ▣ 켜는 조건: 학교에 cooperation_notices 모듈이 켜져 있고(P8-06) 메신저(P3)가 준비(ready)일 때만. 켜기 전에는 알림을 만들지 않으므로
--   cooperation 출처를 모르는 옛 앱(PR #59 이전)의 알림함이 이 출처 때문에 깨지지 않는다. 켜기는 새 앱(PR #60) 배포 뒤에만.
-- ▣ 바꾸는 것: workhub.notifications 의 출처 CHECK 에 'cooperation' 추가(이름 그대로). 새 트리거 1개 · 새 내부 함수 1개.
--   P2 · P3 · P7 함수 본문은 바꾸지 않는다.
-- ▣ 전제: P8-01. 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
DECLARE v_n bigint;
BEGIN
  IF to_regclass('workhub_private.p8_installs') IS NULL THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-01' AND release = '2026-10-16.1'$q$ INTO v_n;
  IF v_n <> 1 THEN RAISE EXCEPTION 'P8 중단: P8-01(2026-10-16.1)을 먼저 적용해 주세요.'; END IF;
  EXECUTE $q$SELECT count(*) FROM workhub_private.p8_installs WHERE batch = 'P8-02'$q$ INTO v_n;
  IF v_n <> 0 THEN RAISE EXCEPTION 'P8 중단: P8-02 가 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  IF to_regclass('workhub_private.p2_installs') IS NULL OR to_regclass('workhub_private.p3_installs') IS NULL THEN
    RAISE EXCEPTION 'P8 중단: P2 · P3(2026-10-16.1)이 적용되어 있어야 합니다.';
  END IF;
  -- 바꿀 CHECK 가 원본(P3-01) 그대로인가
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.notifications'::regclass AND conname = 'notifications_source_check')
       IS DISTINCT FROM 'CHECK ((((source_module IS NULL) = (source_id IS NULL)) AND ((source_module IS NULL) OR (source_module = ANY (ARRAY[''calendar''::text, ''tasks''::text, ''collections''::text, ''messages''::text, ''students''::text, ''knowledge''::text]))) AND ((source_id IS NULL) OR (source_id ~ ''^[a-zA-Z0-9_-]{1,100}$''::text))))' THEN
    RAISE EXCEPTION 'P8 중단: 알림 출처 CHECK 가 P3-01 원본과 다릅니다. 누가 고쳤는지 먼저 확인해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'p8_coop_notice') OR to_regprocedure('workhub_private.p8_coop_notice()') IS NOT NULL THEN
    RAISE EXCEPTION 'P8 중단: 같은 이름의 트리거·함수가 이미 있습니다. 누가 만들었는지 먼저 확인해 주세요.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. 알림 출처에 협업 추가 (기존 행은 그대로 — 넓히는 변경이라 기존 행이 모두 통과한다)
-- ----------------------------------------------------------------------------
ALTER TABLE workhub.notifications DROP CONSTRAINT notifications_source_check;
ALTER TABLE workhub.notifications ADD CONSTRAINT notifications_source_check CHECK ((source_module IS NULL) = (source_id IS NULL)
  AND (source_module IS NULL OR source_module IN ('calendar','tasks','collections','messages','students','knowledge','cooperation'))
  AND (source_id IS NULL OR source_id ~ '^[a-zA-Z0-9_-]{1,100}$'));

-- ----------------------------------------------------------------------------
-- 2. 협업 이력 → 상대 당사자 알림 (같은 트랜잭션)
-- ----------------------------------------------------------------------------
CREATE FUNCTION workhub_private.p8_coop_notice() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r workhub.cooperation_requests; v_to text; v_title text;
BEGIN
  -- 꺼져 있으면(모듈 없음 · 중지 · 메신저 준비 전) 아무것도 하지 않는다. 협업 원본 변경은 그대로 진행된다.
  IF NOT workhub_private.p2_module_active(NEW.school_id, 'cooperation_notices')
     OR workhub_private.p3_messaging_reason(NEW.school_id) <> 'ready' THEN
    RETURN NULL;
  END IF;
  SELECT * INTO r FROM workhub.cooperation_requests WHERE school_id = NEW.school_id AND id = NEW.request_id;
  -- 출처 ID 는 앱 identifier() 가 받는 모양만(알림 CHECK 와 같은 규칙). 아니면 알림 없이 넘어간다(원본 변경을 막지 않는다).
  IF r.id IS NULL OR r.id !~ '^[a-zA-Z0-9_-]{1,100}$' THEN RETURN NULL; END IF;
  v_to := CASE WHEN NEW.actor_membership_id = r.sender_membership_id THEN r.recipient_membership_id ELSE r.sender_membership_id END;
  v_title := CASE NEW.action
    WHEN 'create'             THEN '협업 요청이 왔습니다'
    WHEN 'accept'             THEN '협업 요청이 수락되었습니다'
    WHEN 'decline'            THEN '협업 요청이 거절되었습니다'
    WHEN 'request_completion' THEN '협업 완료 확인 요청이 왔습니다'
    WHEN 'retract_completion' THEN '협업 완료 확인 요청이 철회되었습니다'
    WHEN 'confirm_completion' THEN '협업 완료가 확인되었습니다'
    WHEN 'return_completion'  THEN '협업 완료 확인이 반려되었습니다'
    WHEN 'cancel'             THEN '협업 요청이 취소되었습니다'
    WHEN 'handover'           THEN '협업 받는 사람이 바뀌었습니다'
  END;
  IF v_title IS NULL OR v_to IS NULL THEN RETURN NULL; END IF;
  PERFORM workhub_private.p3_notify(NEW.school_id, v_to, v_title, left(r.title, 120), 'cooperation', r.id,
                                    'p8:coop:' || r.id || ':' || NEW.version);
  RETURN NULL;
END $$;
CREATE TRIGGER p8_coop_notice AFTER INSERT ON workhub.cooperation_history
  FOR EACH ROW EXECUTE FUNCTION workhub_private.p8_coop_notice();
REVOKE ALL ON FUNCTION workhub_private.p8_coop_notice() FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO workhub_private.p8_installs (batch, release) VALUES ('P8-02', '2026-10-16.1');
COMMIT;

-- ----------------------------------------------------------------------------
-- 3. 검증 — 모든 행의 status 가 ok 여야 한다. P8-02-3 은 "아직 켜지 않음"이 정상이다(P8-06 전).
-- ----------------------------------------------------------------------------
SELECT 'P8-02-1' AS no, '알림 출처 CHECK 에 cooperation 추가' AS item,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%''cooperation''::text%' THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
FROM pg_constraint WHERE conrelid = 'workhub.notifications'::regclass AND conname = 'notifications_source_check'
UNION ALL
SELECT 'P8-02-2', '협업 이력 트리거 1개 · 내부 함수 API 역할 실행 불가',
       CASE WHEN (SELECT count(*) FROM pg_trigger WHERE tgname = 'p8_coop_notice' AND tgrelid = 'workhub.cooperation_history'::regclass) = 1
             AND NOT has_function_privilege('authenticated', 'workhub_private.p8_coop_notice()'::regprocedure, 'EXECUTE')
             AND NOT has_function_privilege('anon', 'workhub_private.p8_coop_notice()'::regprocedure, 'EXECUTE')
             AND NOT has_function_privilege('service_role', 'workhub_private.p8_coop_notice()'::regprocedure, 'EXECUTE') THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-02-3', '아직 어느 학교도 협업 알림을 켜지 않음 · 협업 출처 알림 0',
       CASE WHEN (SELECT count(*) FROM workhub.module_activations WHERE module = 'cooperation_notices') = 0
             AND (SELECT count(*) FROM workhub.notifications WHERE source_module = 'cooperation') = 0 THEN 'ok' ELSE 'FAIL' END, ''
UNION ALL
SELECT 'P8-02-4', '적용 기록 P8-02', CASE WHEN workhub_private.p8_installed('P8-02') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
