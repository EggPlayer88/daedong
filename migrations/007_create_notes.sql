-- ═══════════════════════════════════════════════════════════════════
-- 정리 작업 2-B — notes 테이블 생성 (대시보드 메모장)
-- ═══════════════════════════════════════════════════════════════════
-- 한 사용자당 1개의 자유 메모 (대시보드 위젯의 텍스트 패드).
-- user_id 가 PRIMARY KEY — 사용자당 1행 보장. upsert 로 저장.
--
-- 컬럼 의미:
--   user_id    — teacher.id (TEXT — 003 마이그레이션 정책)
--   content    — 메모 본문 (plain text, 줄바꿈만 보존)
--   updated_at — 마지막 저장 시각 (UI 의 "✓ N분 전 저장됨" 에 사용)
--
-- RLS 는 Phase 6 인증 통합과 함께 설정. 현재는 비활성화.
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS notes (
  user_id    TEXT PRIMARY KEY,
  content    TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT now()
);
