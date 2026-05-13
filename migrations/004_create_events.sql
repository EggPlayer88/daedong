-- ═══════════════════════════════════════════════════════════════════
-- 정리 작업 1 — events 테이블 생성
-- ═══════════════════════════════════════════════════════════════════
-- 목적: SchedulePage / DashboardView / MyScheduleView / api/chat.js 가
--       의존하는 일정 테이블 누락(404) 해결.
--
-- 배경:
--   기존에는 일정 관리 페이지(SchedulePage) 가 `events` 테이블을,
--   대시보드/나의 할 일/AI 비서가 `schedules` 테이블을 호출하는
--   불일치가 있었음 (둘 다 실제로는 미존재).
--   본 마이그레이션은 `events` 로 통일하기 위해 컬럼을 통합 설계.
--
-- 통합 매핑:
--   schedules.date         → events.start_date
--   schedules.visibility   → events.scope        ('personal' | 'all')
--   schedules.title/category/created_by → events 의 동일 이름
--   schedules 에만 있던 priority / tags / dept 는 events 에 추가 (nullable)
--   events 에만 있던 description / end_date / start_time / end_time /
--     is_allday / created_by_name 은 그대로 유지
--
-- 데이터 입력 UI 는 Phase 5 (임시교사) + 데이터 입력 UI 작업과 함께.
-- 본 마이그레이션은 "빈 테이블" 운영을 전제로 함 (시범운영 직전 청소 작업).
--
-- 003 마이그레이션 정책에 따라 사용자 식별자(created_by) 는 TEXT.
-- Phase 6 인증 통합 시 UUID 복원 + RLS 정책 부착 예정.
-- RLS 는 현재 비활성화.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 기본
  title           TEXT NOT NULL,
  description     TEXT,

  -- 기간 (단일 일정이면 end_date = start_date 또는 NULL)
  start_date      DATE NOT NULL,
  end_date        DATE,

  -- 종일 여부 / 시간 (is_allday=true 면 start_time/end_time NULL)
  is_allday       BOOLEAN DEFAULT TRUE,
  start_time      TIME,
  end_time        TIME,

  -- 분류 / 공개 범위
  category        TEXT,                  -- 수업/행사/연수/회의/평가/행정/기타 (UI 에서 선택)
  scope           TEXT DEFAULT 'all',    -- 'all' | 'personal'

  -- 구 schedules 잔존 필드 (DashboardView / MyScheduleView / api/chat.js 가 사용)
  -- 현재 SchedulePage 폼에서는 입력 UI 가 없음. Phase 5 단계의 데이터 입력 UI 와 함께
  -- 입력/필터 UI 정비 예정.
  priority        TEXT,                  -- '높음' | '중간' | '낮음'
  tags            TEXT[] DEFAULT '{}',   -- 예: '{전체,담임,교과}'
  dept            TEXT,                  -- 부서명 (DEPT_LIST)

  -- 메타
  created_by      TEXT,                  -- 사용자 식별자 (UUID 또는 페르소나 ID)
  created_by_name TEXT,                  -- 표시용 (SchedulePage 가 직접 저장)
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- 조회 패턴 기반 인덱스
CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date);
CREATE INDEX IF NOT EXISTS idx_events_created_by ON events(created_by);

-- RLS — Phase 6 인증 통합 시 정책 부착 예정
ALTER TABLE events DISABLE ROW LEVEL SECURITY;
