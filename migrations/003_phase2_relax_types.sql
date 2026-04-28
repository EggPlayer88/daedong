-- ═══════════════════════════════════════════════════════════════════
-- Phase 2 마이그레이션: 시뮬레이션 페르소나 호환을 위한 컬럼 타입 완화
-- ═══════════════════════════════════════════════════════════════════
-- 목적: Phase 1~3 동안 페르소나 't1', 'admin' 같은 문자열을
--       requester_id 등에 쓸 수 있도록 UUID → TEXT 로 변경
-- Phase 4 (실제 인증 통합) 때 다시 UUID 로 되돌리는 마이그레이션 작성 예정
-- ═══════════════════════════════════════════════════════════════════

-- 기존 인덱스 제거 (재생성 위해)
DROP INDEX IF EXISTS idx_changes_requester;
DROP INDEX IF EXISTS idx_notifications_user_read;

-- timetables
ALTER TABLE timetables ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- timetable_changes
ALTER TABLE timetable_changes ALTER COLUMN requester_id  TYPE TEXT USING requester_id::TEXT;
ALTER TABLE timetable_changes ALTER COLUMN approver_id   TYPE TEXT USING approver_id::TEXT;
ALTER TABLE timetable_changes ALTER COLUMN rejected_by   TYPE TEXT USING rejected_by::TEXT;

-- school_calendar
ALTER TABLE school_calendar ALTER COLUMN created_by TYPE TEXT USING created_by::TEXT;

-- notifications
ALTER TABLE notifications ALTER COLUMN user_id TYPE TEXT USING user_id::TEXT;

-- 인덱스 재생성
CREATE INDEX IF NOT EXISTS idx_changes_requester
  ON timetable_changes(requester_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read, created_at DESC);


-- ─── 페르소나 알림용 시뮬레이션 admin 등록 ───
-- changesAPI.notifyAdmins() 가 teachers 테이블에서 timetable_admin 을 찾는데
-- 시뮬레이션 페르소나는 그 테이블의 진짜 admin 에게 알림 보내야 함.
-- teachers 테이블 구조에 따라 이 부분은 환경별로 다를 수 있음 — 직접 확인 필요.

-- 만약 teachers 테이블에 이미 timetable_admin 계정이 있으면 그쪽으로 알림이 갑니다.
-- 시뮬레이션 페르소나 'admin' 으로 알림을 받으려면 changesAPI.js 의 notifyAdmins 를
-- 일시적으로 수정하여 'admin' 문자열에 직접 알림 발송하도록 변경해야 함 (Phase 2 SIM_NOTE).
