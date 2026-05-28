-- ═══════════════════════════════════════════════════════════════════
-- 013 (M3) — teachers.id UUID→TEXT (D6) + 잔재 컬럼 정리 + 의존 FK 재생성
-- ═══════════════════════════════════════════════════════════════════
-- Phase 5-A 잔재 정비 4단계 중 3단계 — 가장 위험. 단독 실행 권장.
-- 선행: 011(이벤트 트리거 제거) → 012(잔재 테이블 DROP) 완료.
-- 후행: 014(RLS 비활성화) → 009 재실행(시드).
--
-- D6: 모든 사용자 ID 영구 TEXT. placeholder(t1~t22) + 실 사용자(UUID형식 TEXT) 공존.
-- ★ DEFAULT 를 gen_random_uuid()::text 로 교체 (010 누락분 보강):
--     handle_new_user() 트리거가 신규 구글 가입 시 id 를 지정하지 않고 DEFAULT 에 의존.
--     그냥 DROP DEFAULT 하면 다음 가입이 NOT NULL 위반으로 실패함.
-- 의존 FK 2개(documents.uploaded_by, events.created_by)만 처리
--   — teacher_constraints 는 012 에서 이미 제거됨.
--
-- ROLLBACK 범위: 이 트랜잭션(BEGIN/COMMIT) 실패 시 id 타입/DEFAULT/컬럼/FK 전부 원복.
--   기존 데이터(teachers 1행, events 1행)는 ::text 캐스트로 동일 값 보존.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 사전 검증 (M3 실행 전 별도로 먼저 돌릴 것)
--   기대: id = uuid, user_id = uuid.
--   ※ user_id 가 이미 'text' 로 나오면 DB 상태가 예상과 다름
--      → M3 진행 금지. 멈추고 재점검.
-- ───────────────────────────────────────────────────────────────
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_name='teachers' AND column_name IN ('id','user_id');

BEGIN;

-- (1) 의존 FK 임시 제거 (타입 변경 전 필수 — PostgreSQL 은 타입 불일치 FK 불허)
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_uploaded_by_fkey;
ALTER TABLE events    DROP CONSTRAINT IF EXISTS events_created_by_fkey;

-- (2) teachers.id : DEFAULT 제거 → 타입 변경 → DEFAULT 재설정(::text, D6 + 트리거 호환)
ALTER TABLE teachers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE teachers ALTER COLUMN id TYPE TEXT USING id::text;
ALTER TABLE teachers ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- (3) 참조 컬럼도 TEXT 로 (FK 재생성 위해 타입 일치)
ALTER TABLE documents ALTER COLUMN uploaded_by TYPE TEXT USING uploaded_by::text;
ALTER TABLE events    ALTER COLUMN created_by  TYPE TEXT USING created_by::text;

-- (4) 잔재 컬럼 DROP (코드 0참조, Phase 5-A 신규 컬럼과 의미 중복)
ALTER TABLE teachers DROP COLUMN IF EXISTS is_homeroom;
ALTER TABLE teachers DROP COLUMN IF EXISTS is_parttime;
ALTER TABLE teachers DROP COLUMN IF EXISTS allowed_days;

-- (5) FK 재생성 (TEXT ↔ TEXT, 원래 ON DELETE 정책 복원)
ALTER TABLE documents
  ADD CONSTRAINT documents_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES teachers(id) ON DELETE SET NULL;
ALTER TABLE events
  ADD CONSTRAINT events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES teachers(id) ON DELETE SET NULL;

COMMIT;

-- ───────────────────────────────────────────────────────────────
-- 검증 (COMMIT 후 실행)
--   기대: id_type=text / id_default=gen_random_uuid()::text / residue_cols=0 /
--         teachers_rows=1 / fks_to_teachers=2 / pk_index='teachers_pkey'
--   ※ teachers_rows 가 1이 아니면(계란님 행 누락) 009 재실행 전 멈추고 점검.
--   ※ pk_index 가 NULL 이면 PK 손상 → 멈추고 점검.
-- ───────────────────────────────────────────────────────────────
SELECT
  (SELECT data_type     FROM information_schema.columns
     WHERE table_name='teachers' AND column_name='id')               AS id_type,
  (SELECT column_default FROM information_schema.columns
     WHERE table_name='teachers' AND column_name='id')               AS id_default,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='teachers'
       AND column_name IN ('is_homeroom','is_parttime','allowed_days')) AS residue_cols,
  (SELECT count(*) FROM teachers)                                     AS teachers_rows,
  (SELECT count(*) FROM pg_constraint
     WHERE confrelid='teachers'::regclass AND contype='f')           AS fks_to_teachers,
  (SELECT indexname FROM pg_indexes
     WHERE tablename='teachers' AND indexname='teachers_pkey')        AS pk_index;

-- ═══════════════════════════════════════════════════════════════════
-- M3 직후 앱 동작 체크리스트 (브라우저에서 직접 확인)
--   □ 로그아웃 후 재로그인 가능
--   □ 대시보드 페이지 로딩
--   □ 시간표 페이지 로딩
--   □ 일정 페이지에서 자기 일정 1행 보임
--   □ 새 메모 작성/저장
--   □ 브라우저 콘솔에 에러 없음
-- 위 6개 모두 통과해야 014(RLS 비활성화) → 009 재실행 으로 진행.
-- 하나라도 실패하면 멈추고 점검 (013 은 트랜잭션이라 부분 적용 없음).
-- ═══════════════════════════════════════════════════════════════════
