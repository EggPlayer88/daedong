-- ============================================================================
-- T2-02  시간표 2단계 — 알림 출처에 시간표(timetable) 추가 (따로 승인 · 선택)
--
-- ▣ 무엇을 바꾸나: workhub.notifications 의 출처 CHECK(P8-02 판)에 'timetable' 하나를 더한다. 넓히는 변경이라 기존 알림은 모두 통과한다.
--   앱(messaging/validation.ts)은 이미 출처 'timetable' 을 받는다.
-- ▣ 무엇이 달라지나: 교환 · 이동 요청의 동의 요청 · 승인 요청 · 결과 알림이 받는 사람의 알림함에 들어간다(T2-04 의 t2_notify).
--   이 파일을 적용하지 않으면 T2 는 알림 없이 동작한다(시간표 화면의 요청 목록으로만 보인다). 준비 조건에 넣지 않았다.
--   메신저 모듈이 꺼져 있으면 이 파일을 적용해도 알림을 만들지 않는다(p3_messaging_reason = ready 일 때만).
-- ▣ 확정본(P3-01 · P8-02)은 고치지 않는다. 이 CHECK 는 P8-02 다음 판으로 교체하며, 통합 사후 점검(T2-07)이 이 판으로 대조한다.
-- ▣ 전제: T2-01(2026-10-20.1) · P8-02 적용. 한 트랜잭션. 이미 적용됐으면 멈춘다.
-- ============================================================================
BEGIN;

DO $$
BEGIN
  IF to_regclass('workhub_private.t2_installs') IS NULL THEN RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-01' AND release = '2026-10-20.1') THEN
    RAISE EXCEPTION 'T2 중단: T2-01(2026-10-20.1)을 먼저 적용해 주세요.';
  END IF;
  IF EXISTS (SELECT 1 FROM workhub_private.t2_installs WHERE batch = 'T2-02') THEN RAISE EXCEPTION 'T2 중단: T2-02 가 이미 적용되었습니다(다시 실행하지 않습니다).'; END IF;
  -- 바꿀 CHECK 가 P8-02 판 그대로인가
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'workhub.notifications'::regclass AND conname = 'notifications_source_check')
       IS DISTINCT FROM 'CHECK ((((source_module IS NULL) = (source_id IS NULL)) AND ((source_module IS NULL) OR (source_module = ANY (ARRAY[''calendar''::text, ''tasks''::text, ''collections''::text, ''messages''::text, ''students''::text, ''knowledge''::text, ''cooperation''::text]))) AND ((source_id IS NULL) OR (source_id ~ ''^[a-zA-Z0-9_-]{1,100}$''::text))))' THEN
    RAISE EXCEPTION 'T2 중단: 알림 출처 CHECK 가 P8-02 판과 다릅니다. 누가 고쳤는지 먼저 확인해 주세요.';
  END IF;
END $$;

ALTER TABLE workhub.notifications DROP CONSTRAINT notifications_source_check;
ALTER TABLE workhub.notifications ADD CONSTRAINT notifications_source_check CHECK ((source_module IS NULL) = (source_id IS NULL)
  AND (source_module IS NULL OR source_module IN ('calendar','tasks','collections','messages','students','knowledge','cooperation','timetable'))
  AND (source_id IS NULL OR source_id ~ '^[a-zA-Z0-9_-]{1,100}$'));

INSERT INTO workhub_private.t2_installs (batch, release) VALUES ('T2-02', '2026-10-20.1');
COMMIT;

SELECT 'T2-02-1' AS no, '알림 출처 CHECK 에 timetable 추가(cooperation 유지)' AS item,
       CASE WHEN pg_get_constraintdef(oid) LIKE '%''timetable''::text%' AND pg_get_constraintdef(oid) LIKE '%''cooperation''::text%' THEN 'ok' ELSE 'FAIL' END AS status, '' AS value
FROM pg_constraint WHERE conrelid = 'workhub.notifications'::regclass AND conname = 'notifications_source_check'
UNION ALL
SELECT 'T2-02-2', '적용 기록 T2-02', CASE WHEN workhub_private.t2_installed('T2-02') THEN 'ok' ELSE 'FAIL' END, ''
ORDER BY 1;
