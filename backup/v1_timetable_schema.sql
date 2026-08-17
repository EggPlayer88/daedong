-- ============================================================================
-- v1_timetable_schema.sql — v1 시간표 도메인 실측 DDL 재구성본
--
-- 출처: 2026-08-16, v1 프로젝트 초기화(000) 직전 실측
--       (v1_timetable_columns.csv + v1_timetable_indexes.csv + v1_timetable_constraints.csv)
-- 용도: Phase 2 의 011_timetable_domain.sql 작성 재료. ⚠ 지금 실행하는 파일 아님.
--
-- 참고 사항:
--   - PK 가 uuid 타입 — v2 P2(TEXT PK) 와 다르지만, "v1 스키마 그대로 복제" 결정
--     (SCHEMA.md 15~16절)에 따라 010 에서도 uuid 유지 (격리된 도메인이라 무해)
--   - RLS 정책은 이 파일에 없음 — v2 에서 P4 3패턴 + has_extra_permission('timetable_manage')
--     로 새로 설계한다 (v1 정책을 복제하지 않음)
--   - updated_at 자동 갱신 트리거의 v1 존재 여부는 미확인 — 010 에서는 001 의
--     set_updated_at() 트리거를 두 테이블에 부착할 것을 권장
--   - 데이터 백업: v1_timetables_data.csv (4행 — 1학기 활성본 1 + 2학기 초안 3.
--     최신 초안 '2026학년도 시간표 (2026. 7. 29.)' 의 data JSONB 를 Phase 2 에서
--     재주입하면 솔버 재실행 불필요). timetable_changes 데이터는 1학기 운영 기록이라
--     D3 에 따라 백업하지 않음
-- ============================================================================

CREATE TABLE public.timetables (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  effective_from  DATE NOT NULL,
  effective_until DATE,
  parent_id       UUID REFERENCES public.timetables(id) ON DELETE SET NULL,
  edit_log        JSONB DEFAULT '{}'::jsonb,
  status          TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','superseded','rolled_back','draft')),
  is_active       BOOLEAN NOT NULL DEFAULT false,
  data            JSONB NOT NULL,          -- 시간표 본체. 최상위 키 c1~c8 (학급 코드)
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 활성 시간표는 전체에서 단 1개만 허용 (부분 유니크 인덱스)
CREATE UNIQUE INDEX idx_one_active_timetable
  ON public.timetables (is_active) WHERE (is_active = true);
CREATE INDEX idx_timetables_effective
  ON public.timetables (effective_from, effective_until);

CREATE TABLE public.timetable_changes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type                 TEXT NOT NULL
                       CHECK (type IN ('swap','substitute','self_study','period_move')),
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','awaiting_partners','awaiting_admin',
                                         'approved','rejected','cancelled')),
  source_date          DATE NOT NULL,
  source_class_id      TEXT NOT NULL,       -- 'c1' 등 (timetableData.js 의 클래스 코드)
  source_period        INTEGER NOT NULL,
  source_day           TEXT NOT NULL,
  source_teacher_id    TEXT NOT NULL,
  source_subject_id    TEXT NOT NULL,
  payload              JSONB NOT NULL DEFAULT '{}'::jsonb,
  partner_status       JSONB NOT NULL DEFAULT '{}'::jsonb,
  requester_id         TEXT,
  approver_id          TEXT,
  approved_at          TIMESTAMPTZ,
  rejected_by          TEXT,
  rejection_reason     TEXT,
  supersession_status  TEXT
                       CHECK (supersession_status IN ('compatible','superseded',
                                                      'needs_review','manually_resolved')),
  superseded_by        UUID REFERENCES public.timetables(id) ON DELETE SET NULL,
  notification_text    TEXT,
  notification_sent_at TIMESTAMPTZ,
  reason               TEXT,
  is_admin_direct      BOOLEAN NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_changes_date_status     ON public.timetable_changes (source_date, status);
CREATE INDEX idx_changes_source_teacher  ON public.timetable_changes (source_teacher_id);
CREATE INDEX idx_changes_requester       ON public.timetable_changes (requester_id);
