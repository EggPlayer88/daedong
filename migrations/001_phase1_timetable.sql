-- ═══════════════════════════════════════════════════════════════════
-- Phase 1: 시간표 시스템 기반 테이블
-- ═══════════════════════════════════════════════════════════════════
-- 실행 순서: Supabase SQL Editor에서 이 파일 전체를 한번에 실행
-- 안전성: 모든 테이블에 IF NOT EXISTS, 중복 실행해도 에러 없음
-- 롤백: 맨 아래 DROP 블록 주석 해제 후 실행
-- ═══════════════════════════════════════════════════════════════════

-- ─── 1. timetables: 기본 시간표 (학기당 active 1개) ───
CREATE TABLE IF NOT EXISTS timetables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  -- 발효 기간 (effective_from <= 오늘 < effective_until 인 row 가 active)
  effective_from  DATE NOT NULL,
  effective_until DATE,
  -- 영구 변경 이력
  parent_id       UUID REFERENCES timetables(id) ON DELETE SET NULL,
  edit_log        JSONB DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'superseded', 'rolled_back', 'draft')),
  is_active       BOOLEAN NOT NULL DEFAULT false,
  -- 시간표 본문 (학급별 주간 슬롯 데이터)
  -- 구조: { "c1": { "월-1": {sid, tid}, "월-2": {...}, ... }, "c2": {...}, ... }
  data            JSONB NOT NULL,
  -- 메타
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 동시에 active = true 인 시간표는 1개만
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_timetable
  ON timetables(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_timetables_effective
  ON timetables(effective_from, effective_until);


-- ─── 2. timetable_changes: 일회성 변동 (임시 변경) ───
CREATE TABLE IF NOT EXISTS timetable_changes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 변동 유형
  type                TEXT NOT NULL
                      CHECK (type IN ('swap', 'substitute', 'self_study', 'period_move')),
  -- 상태 머신: pending → awaiting_partners → awaiting_admin → approved
  --                 ↳ rejected (어디서든 분기)
  --                 ↳ cancelled (요청자가 직접)
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'awaiting_partners', 'awaiting_admin',
                                        'approved', 'rejected', 'cancelled')),
  -- 변동이 일어나는 날짜 (필수, 일회성 사건)
  source_date         DATE NOT NULL,
  -- 원본 수업 (요청자 본인 수업)
  source_class_id     TEXT NOT NULL,    -- c1~c9
  source_period       INT  NOT NULL,
  source_day          TEXT NOT NULL,    -- '월'~'금'
  source_teacher_id   TEXT NOT NULL,    -- t1~t22 (placeholder 포함)
  source_subject_id   TEXT NOT NULL,
  -- type별로 의미가 다른 변동 정보
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 다자간 승인 추적: { "t3": "approved", "t5": "pending" }
  partner_status      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- 요청자/처리자
  requester_id        UUID,
  approver_id         UUID,
  approved_at         TIMESTAMPTZ,
  rejected_by         UUID,
  rejection_reason    TEXT,
  -- 영구 변경에 의한 무효화 추적
  supersession_status TEXT
                      CHECK (supersession_status IN
                             ('compatible', 'superseded', 'needs_review', 'manually_resolved')),
  superseded_by       UUID REFERENCES timetables(id) ON DELETE SET NULL,
  -- AI 생성 안내문 캐시
  notification_text   TEXT,
  notification_sent_at TIMESTAMPTZ,
  -- 메타
  reason              TEXT,
  is_admin_direct     BOOLEAN NOT NULL DEFAULT false,  -- 관리자 직권 변경 여부
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_changes_date_status
  ON timetable_changes(source_date, status);
CREATE INDEX IF NOT EXISTS idx_changes_source_teacher
  ON timetable_changes(source_teacher_id);
CREATE INDEX IF NOT EXISTS idx_changes_requester
  ON timetable_changes(requester_id);


-- ─── 3. school_calendar: 학사 캘린더 (휴일/시험/행사) ───
CREATE TABLE IF NOT EXISTS school_calendar (
  date              DATE PRIMARY KEY,
  type              TEXT NOT NULL
                    CHECK (type IN ('normal', 'exam', 'holiday', 'event', 'no_school')),
  note              TEXT,
  -- 특정 학년/반만 영향받는 경우. NULL이면 전교 적용
  affected_classes  TEXT[],
  -- exam/event일 때 임시 시간표 (시험시간표 등). NULL이면 정규 수업 없음
  custom_schedule   JSONB,
  -- 메타
  created_by        UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── 4. notifications: 사용자 알림 ───
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  -- 시간표 관련 알림은 request_id 가 있고, 일반 시스템 알림은 NULL
  request_id      UUID REFERENCES timetable_changes(id) ON DELETE CASCADE,
  -- 알림 종류
  -- partner_request : 교환/보강/감독 요청을 받음 (응답 필요)
  -- admin_review    : 관리자 승인 대기 (관리자에게)
  -- approved        : 내가 낸 요청이 최종 승인됨
  -- rejected        : 내가 낸 요청이 반려됨
  -- admin_notice    : 관리자 직권 변경 통보 (응답 불필요)
  kind            TEXT NOT NULL
                  CHECK (kind IN ('partner_request', 'admin_review', 'approved',
                                  'rejected', 'admin_notice')),
  -- 표시 텍스트 (있으면 그대로 표시, 없으면 클라이언트가 request 정보로 생성)
  message         TEXT,
  read            BOOLEAN NOT NULL DEFAULT false,
  read_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read
  ON notifications(user_id, read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_request
  ON notifications(request_id);


-- ─── 5. updated_at 자동 갱신 트리거 ───
CREATE OR REPLACE FUNCTION trigger_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_updated_at ON timetables;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON timetables
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON timetable_changes;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON timetable_changes
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

DROP TRIGGER IF EXISTS set_updated_at ON school_calendar;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON school_calendar
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();


-- ─── 6. RLS (Row Level Security) ───
-- 일단 Phase 1 에서는 disable. Phase 4 에서 사용자 인증 통합할 때 재설계.
ALTER TABLE timetables DISABLE ROW LEVEL SECURITY;
ALTER TABLE timetable_changes DISABLE ROW LEVEL SECURITY;
ALTER TABLE school_calendar DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;


-- ═══════════════════════════════════════════════════════════════════
-- 롤백용 (필요 시 주석 해제하여 실행)
-- ═══════════════════════════════════════════════════════════════════
-- DROP TABLE IF EXISTS notifications CASCADE;
-- DROP TABLE IF EXISTS timetable_changes CASCADE;
-- DROP TABLE IF EXISTS school_calendar CASCADE;
-- DROP TABLE IF EXISTS timetables CASCADE;
-- DROP FUNCTION IF EXISTS trigger_set_updated_at();
