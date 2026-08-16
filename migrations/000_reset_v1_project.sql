-- ============================================================================
-- 000_reset_v1_project.sql
-- v1 Supabase 프로젝트 → v2 용 완전 초기화 (D18: 무료 한도로 신규 생성 불가 → 재사용)
--
-- ⚠⚠ 파괴적 스크립트. v1 의 모든 테이블/데이터/정책이 사라진다.
--     v1 사이트는 실행 즉시 영구적으로 깨진다 (운영 중단 결정 완료 상태에서만 실행).
--     v1 GitHub repo(코드)는 절대 삭제 금지 — 이제 v1 의 유일한 참조본이다.
--
-- 실행 방법: [A] → [B] → [C] → [D] → [검증] 을 "블록 단위로 나눠서" 실행.
--            한 번에 전체 Run 금지 ([A] 조사 결과를 보고 [B] 를 채워야 함).
--
-- 실행 완료: 2026-08-16 (계란). [검증] 전 항목 통과.
--            [B2] 는 storage.protect_delete() 때문에 대시보드 경유로 수정됨 (해당 구역 주석 참조).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- [A0] (선택, 30초) 시간표 테이블 정의 추출 — 백업이 아니라 Phase 2 재료.
--      010 이 "v1 실측 스키마 복제" 를 전제하므로, 지금 뽑아두면 Phase 2 에서
--      v1 코드를 역추적할 필요가 없어진다. 결과 4개를 CSV 로 받아 backup/ 에.
--      건너뛰어도 Phase 0~1 진행에는 지장 없음.
-- ----------------------------------------------------------------------------
-- SELECT table_name, column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name IN ('timetables','timetable_changes')
-- ORDER BY table_name, ordinal_position;

-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE schemaname='public' AND tablename IN ('timetables','timetable_changes');

-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid IN ('public.timetables'::regclass, 'public.timetable_changes'::regclass);

-- SELECT * FROM timetables;   -- 2026-2 시간표 데이터 (data JSONB). 재생성 가능하면 생략

-- ----------------------------------------------------------------------------
-- [A] 조사 — 지울 대상 확인 (교훈 3: 실측 우선)
-- ----------------------------------------------------------------------------
-- A1. 이벤트 트리거.
--     ⚠ 결과에 Supabase 시스템 것(graphql_watch_*, pgsodium_* 등)이 보일 수 있음
--       → 시스템 것은 절대 건드리지 말 것. v1 이 만든 것(rls_auto_enable 류)만 제거 대상.
SELECT evtname, evtevent FROM pg_event_trigger;

-- A2. auth.users 에 걸린 트리거 (v1 의 handle_new_user 류)
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;

-- A3. storage 버킷과 정책
SELECT id, name FROM storage.buckets;
SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects';

-- A4. public 에 설치된 확장 (있으면 [C] 이후 extensions 스키마로 재설치 필요)
SELECT e.extname, n.nspname AS schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE n.nspname = 'public';

-- A5. 예약 작업 (pg_cron 을 썼을 경우에만 결과 있음. 에러 나면 미사용이니 무시)
-- SELECT jobid, jobname, command FROM cron.job;

-- (대시보드에서 별도 확인: Edge Functions 목록, Database → Webhooks — 있으면 삭제)

-- ----------------------------------------------------------------------------
-- [B] 표적 제거 — A 결과에 나온 "v1 이 만든 것" 의 실명으로 주석 해제 후 실행
-- ----------------------------------------------------------------------------
-- B1. v1 이벤트 트리거 (A1 결과에서 v1 것만. 예시:)
-- DROP EVENT TRIGGER IF EXISTS rls_auto_enable;

-- B2. storage 비우기
--     ⚠ 실측 (2026-08-16 실행): storage.objects / storage.buckets 를 SQL 로 직접
--       DELETE 하면 Supabase 의 storage.protect_delete() 트리거가 차단한다.
--       → **정책 제거만 아래 DO 블록으로 하고, 버킷·파일 삭제는 대시보드 Storage 에서**
--         버킷을 지우는 방식으로 처리한다 (버킷 삭제 시 내부 objects 도 함께 사라짐).
--       protect_delete 는 Supabase 시스템 보호장치이므로 우회·해제하지 말 것.

-- B2-a. storage 정책 제거 (SQL 로 가능)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
           WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', p.policyname);
  END LOOP;
END $$;

-- B2-b. 버킷·파일 삭제 → 대시보드 Storage 에서 버킷 삭제 (아래 SQL 은 차단되므로 실행 불가)
-- DELETE FROM storage.objects;   -- ❌ storage.protect_delete() 로 차단됨
-- DELETE FROM storage.buckets;   -- ❌ storage.protect_delete() 로 차단됨

-- (참고: auth.users 위의 v1 트리거는 함수가 public 에 있었다면 [C] 에서 함수와 함께
--  연쇄 삭제됨. [검증] 에서 남아 있으면 그때 A2 의 이름으로 DROP TRIGGER.)

-- ----------------------------------------------------------------------------
-- [C] public 스키마 통째로 재생성 — v1 테이블/뷰/함수/정책 전부 소멸
-- ----------------------------------------------------------------------------
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Supabase 표준 권한 복구 (이 블록이 빠지면 API 가 아무것도 못 읽는다)
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL   ON SCHEMA public TO postgres, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES    TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
COMMENT ON SCHEMA public IS 'standard public schema';

-- PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';

-- ----------------------------------------------------------------------------
-- [D] auth 사용자 전부 삭제 — ⚠ 생략 금지. 대시보드에서 수행:
--     Authentication → Users → 각 사용자 ⋮ 메뉴 → Delete user
--
--     왜 필수인가: 001 의 handle_new_user 는 auth.users "INSERT 시" 에만 발동한다.
--     v1 때 로그인했던 계정이 auth.users 에 남아 있으면, v2 첫 로그인 때
--     INSERT 가 일어나지 않아 public.users 행이 안 생기고 → D17 승격 대상이 없어
--     "로그인은 되는데 사용자가 없는" 유령 상태가 된다.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- [검증] 전부 실행 후 확인. 이 결과가 나와야 001 진행 가능.
-- ----------------------------------------------------------------------------
SELECT count(*) AS public_tables FROM pg_tables  WHERE schemaname = 'public';   -- 0
SELECT count(*) AS buckets       FROM storage.buckets;                          -- 0
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;                    -- 0행
-- Authentication → Users 화면: 0 users

-- 여기까지 확인되면 → 001_users_departments.sql 실행 (기존 가이드 4단계로 복귀)
