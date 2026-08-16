# migrations 실행 기록

> 규칙 (DECISIONS.md P7): 모든 스키마 변경은 번호 붙은 SQL 파일로만.
> SQL Editor 에서 수동 실행 후 **반드시 이 표에 기록**. DROP 은 조사 → 백업 → 실행.

| 파일 | 상태 | 실행일 | 실행자 | 비고 |
|------|------|--------|--------|------|
| 000_reset_v1_project.sql | ⬜ 미실행 | | | **v1 프로젝트 초기화 (D18)**. ⚠ 파괴적 — 한 번에 Run 금지, `[A]→[B]→[C]→[D]→[검증]` **블록 단위 실행**. [A] 조사 결과에서 **Supabase 시스템 이벤트 트리거(graphql_watch_*, pgsodium_* 등)는 삭제 금지**, v1 것만 [B1] 에 실명 기입. **[D] auth 사용자 전부 삭제는 생략 금지** (남으면 첫 로그인 시 handle_new_user 트리거가 안 돌아 public.users 행이 생기지 않음) |
| 001_users_departments.sql | ⬜ 미실행 | | | 000 선행 필수. 실행 후 D17 부트스트랩(승격 UPDATE)은 **첫 로그인 뒤** 별도 1회 |
| 002_schedules_tasks.sql | ⬜ 미실행 | | | 001 선행 필수 |
| 009_seed.sql | ⬜ 미실행 | | | **Phase 1 말 실행** (001~008 선행). 부서 6개 + 2026-2 term. 1회만 실행 |
| (D17) superadmin 승격 UPDATE | ⬜ 미실행 | | | 001 파일 맨 아래 블록. 첫 Google 로그인 후 실행 |

## 실행 방법

1. Supabase Dashboard → SQL Editor → New query
2. 파일 내용 **전체** 붙여넣기 → Run
3. 파일 하단 [검증] 블록의 쿼리를 별도로 실행해 결과 확인
4. 위 표에 상태(✅)/실행일/실행자 기록 후 커밋

## 자주 나는 에러

- `relation "..." already exists` → 이미 실행된 파일. 표 기록 누락 여부 확인.
- `infinite recursion detected in policy` → 정책이 users 를 직접 조회한 것. 반드시 001 의 헬퍼 함수(is_admin 등) 경유 (D15).
- 승격 UPDATE 가 0 rows → 아직 첫 로그인을 안 했거나 email 오타. `SELECT * FROM users;` 로 확인.
