-- ═══════════════════════════════════════════════════════════════════
-- DB 전수 조사 SQL — Phase 5-A 전면 재설계 준비
-- ═══════════════════════════════════════════════════════════════════
-- 새 채팅에서 클로드 코드의 분석을 위해 사용.
-- Supabase SQL Editor 에서 각 섹션 차례로 실행 후 결과 캡처.
-- 전 섹션 읽기 전용(SELECT) — 실행해도 DB 변경 없음.
-- ═══════════════════════════════════════════════════════════════════

-- ─── 섹션 1: public 스키마의 모든 테이블 (table_type 으로 테이블/뷰 구분) ───
SELECT t.table_name,
       t.table_type,                    -- 'BASE TABLE' | 'VIEW' (DROP CASCADE 영향 판단)
       (SELECT count(*) FROM information_schema.columns
        WHERE table_name=t.table_name AND table_schema='public') AS col_count
FROM information_schema.tables t
WHERE t.table_schema='public'
ORDER BY t.table_type, t.table_name;

-- ─── 섹션 2: 모든 테이블 근사 행 수 (백업 필요 여부 판단) ───
-- 근사치(통계 기반). 잔재 테이블에 행이 잡히면 그 테이블만 정확 COUNT(*) 추가 확인.
SELECT relname AS table_name, n_live_tup AS approx_rows
FROM pg_stat_user_tables
WHERE schemaname='public'
ORDER BY n_live_tup DESC, relname;

-- ─── 섹션 3: 모든 컬럼 정보 (column_default 포함) ───
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public'
ORDER BY table_name, ordinal_position;

-- ─── 섹션 3-B: teachers 컬럼 DEFAULT 집중 확인 ───
-- teachers.id 의 DEFAULT 가 gen_random_uuid() 면 UUID→TEXT 변환 시
-- ALTER COLUMN ... DROP DEFAULT 도 함께 해야 함 (정비 마이그레이션에 반영).
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema='public' AND table_name='teachers'
ORDER BY ordinal_position;

-- ─── 섹션 4: 모든 FK 제약 ───
SELECT
  tc.table_name AS dependent_table,
  kcu.column_name AS dependent_column,
  ccu.table_name AS references_table,
  ccu.column_name AS references_column,
  pg_get_constraintdef(c.oid) AS definition
FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON ccu.constraint_name = tc.constraint_name
  JOIN pg_constraint c
    ON c.conname = tc.constraint_name
WHERE tc.constraint_type='FOREIGN KEY'
  AND tc.table_schema='public'
ORDER BY tc.table_name, kcu.column_name;

-- ─── 섹션 5: 모든 RLS 정책 ───
SELECT schemaname, tablename, policyname, cmd,
       qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname IN ('public', 'storage')
ORDER BY schemaname, tablename, policyname;

-- ─── 섹션 6: RLS 활성화된 테이블 ───
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname='public'
ORDER BY tablename;

-- ─── 섹션 7: 사용자 정의 함수 (pg_proc, 본문 포함) ───
-- information_schema.routines 는 plpgsql 본문이 NULL 로 나올 수 있어 pg_proc 사용.
SELECT p.proname AS function_name,
       pg_get_function_identity_arguments(p.oid) AS args,
       l.lanname AS language,
       pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  JOIN pg_language  l ON l.oid = p.prolang
WHERE n.nspname = 'public'
ORDER BY p.proname;

-- ─── 섹션 8: 트리거 (pg_trigger, 호출 함수명 + 활성 상태 포함) ───
-- information_schema.triggers 의 한계(시스템 트리거 혼입/이벤트 중복/함수명 누락) 회피.
SELECT c.relname AS table_name,
       t.tgname  AS trigger_name,
       p.proname AS function_called,
       t.tgenabled AS enabled,          -- 'O'=활성, 'D'=비활성
       pg_get_triggerdef(t.oid) AS definition
FROM pg_trigger t
  JOIN pg_class     c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_proc      p ON p.oid = t.tgfoid
WHERE n.nspname = 'public'
  AND NOT t.tgisinternal               -- FK 등 내부 시스템 트리거 제외
ORDER BY c.relname, t.tgname;

-- ─── 섹션 9: 인덱스 ───
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname='public'
ORDER BY tablename, indexname;

-- ─── 섹션 10: 의도된 테이블 (코드에서 쓰는 것) 의 데이터 샘플 ───
SELECT count(*) AS teachers FROM teachers;
SELECT count(*) AS timetables FROM timetables;
SELECT count(*) AS timetable_changes FROM timetable_changes;
SELECT count(*) AS events FROM events;
SELECT count(*) AS notes FROM notes;
SELECT count(*) AS school_calendar FROM school_calendar;

-- ─── 섹션 11: RLS 정책이 참조하는 함수/테이블 추적 (의존성 그래프) ───
-- get_my_role() 또는 teachers 를 참조하는 정책 식별 → DROP 순서 판단.
-- 의심 키워드는 섹션 7/8 결과 본 뒤 필요 시 ARRAY 에 추가.
SELECT schemaname, tablename, policyname, cmd,
       qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname IN ('public','storage')
  AND (COALESCE(qual,'') || COALESCE(with_check,'')) ILIKE ANY (ARRAY[
        '%get_my_role%', '%teachers%'
      ])
ORDER BY schemaname, tablename, policyname;

-- ─── 섹션 12: 모든 제약 (FK뿐 아니라 PK/UNIQUE/CHECK까지) ───
SELECT conrelid::regclass AS table_name,
       conname,
       CASE contype WHEN 'p' THEN 'PK'    WHEN 'u' THEN 'UNIQUE'
                    WHEN 'c' THEN 'CHECK'  WHEN 'f' THEN 'FK'
                    ELSE contype::text END AS kind,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, contype;

-- ─── 섹션 13: 마이그레이션 추적 상태 (supabase_migrations.schema_migrations) ───
-- 010 등록 여부 + 이전 작업자 잔재 버전 식별용.
-- ※ 이 프로젝트는 마이그레이션을 SQL Editor 에서 수동 실행해 왔으므로
--   (docs/CLAUDE.md 참조) 이 테이블이 비어있거나 CLI 적용분만 있을 수 있음.
--   비어있으면 "CLI 추적 없음" 자체가 유의미한 결과.
-- ※ 'name' 컬럼 없다는 오류가 나면 구버전 스키마이므로 → SELECT version 만 실행.
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
