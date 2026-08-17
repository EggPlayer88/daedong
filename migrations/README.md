# migrations 실행 기록

> 규칙 (DECISIONS.md P7): 모든 스키마 변경은 번호 붙은 SQL 파일로만.
> ⚠ 2026-08-18: 003 이 가입 승인제(D20)로 확정되며 이후 계획 번호가 한 칸씩 밀렸다
>   (documents 004 / handover 005 / students 006 / observations 007 / academic 008 /
>    dashboard 009 / seed 010 / timetable 011). 기존 009_seed.sql → 010_seed.sql 로 개명.
> SQL Editor 에서 수동 실행 후 **반드시 이 표에 기록**. DROP 은 조사 → 백업 → 실행.

| 파일 | 상태 | 실행일 | 실행자 | 비고 |
|------|------|--------|--------|------|
| 000_reset_v1_project.sql | ✅ 완료 | 2026-08-16 | 계란 | **v1 프로젝트 초기화 (D18)**. [검증] 전 항목 통과: public_tables 0 / buckets 0 / storage 정책 0 / auth.users 트리거 0행 / Users 0명.<br>⚠ **실행 중 발견**: `storage.objects`·`storage.buckets` 를 SQL 로 직접 DELETE 하면 Supabase 의 `storage.protect_delete()` 트리거가 차단 → **정책만 DO 블록으로 제거하고, 버킷·파일은 대시보드 Storage 에서 버킷 삭제로 처리**. 000 파일 [B2] 구역에 반영 완료 (protect_delete 는 시스템 보호장치이므로 해제 금지) |
| 001_users_departments.sql | ✅ 완료 | 2026-08-16 | 계란 | [검증] 통과: users·departments `rowsecurity = t`, 정책 users 2 + departments 4, 함수 8개. D17 부트스트랩(승격 UPDATE)은 **첫 로그인 뒤** 별도 1회 — 아래 행 참조 |
| 002_schedules_tasks.sql | ✅ 완료 | 2026-08-16 | 계란 | [검증] 통과: 정책 schedules 4 + tasks 4 |
| 003_signup_approval.sql | ✅ 완료 | 2026-08-18 | 계란 | **가입 승인제 (D20, 임시)**. [검증] 통과: `is_approved` 함수 1행 + 정책 5개 재생성(users_select / departments_select / schedules_select·insert / tasks_insert). 이후 신규 가입은 `is_active=false`(승인 대기)로 생성되고 admin+ 가 `/admin/users` 에서 승인해야 사용 가능. 기존 승인 사용자는 영향 없음 |
| 010_seed.sql | ⬜ 미실행 | | | **Phase 1 말 실행** (001~009 선행). 부서 6개 + 2026-2 term. 1회만 실행 |
| (D17) superadmin 승격 UPDATE | ✅ 완료 | 2026-08-16 | 계란 | 001 파일 맨 아래 블록. 첫 Google 로그인 후 1회 실행. 배포 사이트(https://daedong-school.vercel.app)에서 superadmin 확인 완료 = **Phase 0 완료 기준 충족** |

## 실행 방법

1. Supabase Dashboard → SQL Editor → New query
2. 파일 내용 **전체** 붙여넣기 → Run
3. 파일 하단 [검증] 블록의 쿼리를 별도로 실행해 결과 확인
4. 위 표에 상태(✅)/실행일/실행자 기록 후 커밋

## 자주 나는 에러

- `relation "..." already exists` → 이미 실행된 파일. 표 기록 누락 여부 확인.
- `infinite recursion detected in policy` → 정책이 users 를 직접 조회한 것. 반드시 001 의 헬퍼 함수(is_admin 등) 경유 (D15).
- 승격 UPDATE 가 0 rows → 아직 첫 로그인을 안 했거나 email 오타. `SELECT * FROM users;` 로 확인.
- `DELETE FROM storage.objects/buckets` 가 막힘 → Supabase 시스템 트리거 `storage.protect_delete()`. **정상 동작이니 우회하지 말고** 대시보드 Storage 에서 버킷을 삭제한다 (000 [B2]).
