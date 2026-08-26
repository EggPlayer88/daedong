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
| 004_doc_ai_conversations.sql | ✅ 완료 | 2026-08-18 | 계란 | **문서작성 AI 대화 저장 (이어서 작성)**. [검증] 통과: 정책 4개(select/insert/update/delete). RLS 는 **personal 패턴 — 본인 행만, admin 열람도 없다**. 작성 중인 평가계획서는 교사의 사적 공간이라 권한 상승으로도 열지 않는다. insert 만 `is_approved()` 를 함께 건다(D20) |
| 005_doc_submissions.sql | ✅ 완료 | 2026-08-19 | 계란 | **평가계획서 제출·수합**. Storage 비공개 버킷(submissions) + doc_submissions. RLS: 교사는 **본인 것만**, admin·superadmin 은 전체 열람(수합 담당자). insert 에 `is_approved()`(D20). ⚠ **DELETE 정책을 두지 않았다** — 제출 기록은 지우지 않고 재제출 시 `status='replaced'` 로 넘긴다 |
| 006_calendar.sql | ✅ 완료 | 2026-08-20 | 계란 | **모듈 C — 학사일정 + 공유 캘린더**. academic_terms + calendar_events(scope 2계층). official=학사일정(admin 만 쓰기, **파생 계산의 유일한 원천**) / shared=공유(승인 교사 전원 편집). ⚠ **물리 DELETE 정책이 없다** — 삭제는 `deleted_at` 갱신(soft delete), 복구는 admin 휴지통 |
| 007_submission_delete.sql | ✅ 완료 | 2026-08-26 | 계란 | **제출물 삭제 (행 보존·파일 실물만)**. status CHECK 에 `deleted` 추가 + `subm_update_admin`(담당자가 남의 행 갱신) + storage DELETE 정책 2개(본인 폴더·담당자). [검증] 통과: `doc_submissions` 정책 **5개**(005 의 4 + update_admin) / `subm_storage%` 정책 **5개**(005 의 3 + delete_own·delete_admin). ⚠ **제출 행은 여전히 물리 삭제 불가** — 취소는 `status='deleted'` UPDATE + `storage.remove` 다. 순서는 행 먼저·파일 나중(파일 삭제 실패해도 취소는 성립, 고아 파일은 화면에서 재시도) |
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
