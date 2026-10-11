# DB 기반·학교 권한·안전한 전환 설계

> 작성 기준: 2026-10-11, `docs/workhub-database-design`의 저장소 코드와 로컬 기획서. **설계안이며 운영 DB를 조회·변경하지 않았다.** 이 문서는 신규 SQL 생성·실행, 인증·RLS 변경, 회원 승인, 공개 확대를 수행하지 않는다. SQL 확정본은 Claude Web, 실제 실행은 계란님이 맡는다. 기존 `migrations/*.sql`과 가입 트리거는 이번 설계에서 수정하지 않는다.

## 1. 권장안과 다른 문서와의 경계

**기존 Supabase 로그인과 회원 ID를 유지하고, 현재 추가형 학교·소속·일정·개인 업무 계약 위에 필요한 학교 권한을 단계적으로 보강한다.** 새 `accounts` 테이블을 만들어 회원을 복제하거나 이메일로 다시 연결하지 않는다. 기획서의 논리적 account는 현재 `auth.users`와 `public.users`가 함께 나타내는 계정이다. 검증 환경에는 합성 계정을 사용한다. 운영 DB를 초기화하거나 기존 회원을 재가입시키는 방식은 채택하지 않는다.

현재 코드가 가진 저장 계약과 전국 서비스에 필요한 추가 계약을 구분한다. 아래 표의 신규 이름은 SQL 검토를 위한 제안이며 이미 존재하는 표라는 뜻이 아니다. P1에 따라 실제 기능 전환에 필요한 묶음만 생성한다.

| 담당 범위 | 이 문서 | 다른 설계 문서에서 정의 |
|---|---|---|
| 신원·학교 | 기존 계정 보존, 학교, 소속, 가입 전 예외 | 순수 계정 개인 공간의 도메인 자료 |
| 권한 | 학교 역할·권한, 승인된 관계, 지원 접근, 공개 제어 | 기능별 작성·검토·제출·학생 담당 규칙 |
| 기준정보 | 학교별 부서·학년 기준 | 학년도·학기·교과·학적 학급·수업·담당/수강 기간 |
| 파일 | 버킷/접근 경로/권한 회수/실물 복원 계약 | `workhub_files` 및 문서·수합의 typed 파일 연결 |
| 운영 | 기존 경로 회수, 이관·회원 대조·배포/DB 되돌림 | 작업·outbox·보존/삭제 실행 원장·AI/지식 |

현재 시간표 구현은 보류 상태다. 시간표 재개나 별도 공개를 이 DB 설계의 실행으로 간주하지 않는다.

구현 우선 단계 이름은 통합 문서와 맞춘다. R0은 현재 일정·개인 업무와 기반 보강, R1은 업무·수합·파일·알림, R2는 학생·수업 앱, R3는 지식·Claude·문서·평가·생기부다. E는 학교와 무관한 순수 계정 개인 공간의 후속 확장이다. 이 단계는 내부 구현 순서이며 부분 공개를 자동 승인하는 일정이 아니다.

## 2. 소스에서 확인한 현재 상태

### 2.1 기존 운영 계열 — 원본 001~007

`migrations/README.md`에는 실행 완료 기록이 있다. 이는 저장소의 기록이며 이번에 원격 운영 상태를 재확인한 결과는 아니다.

| 실제 객체·경로 | 소스에 있는 계약 | 유지·보완 판단 |
|---|---|---|
| `auth.users`, `public.users` | `users.id TEXT`; 가입 트리거가 `auth.users.id::text`로 생성. 두 표 사이의 물리 FK는 현재 없다 | ID·계정·프로필·기존 참조 유지. 물리 FK 추가는 불일치와 삭제 전파를 조사한 뒤 별도 판단 |
| `handle_new_user`, `on_auth_user_created` | 003 이후 새 회원 `teacher`, `is_active=false`; `ON CONFLICT(id) DO NOTHING` | 삭제·재생성·재발동 금지. 누락 프로필은 기존 Auth ID에 대한 개별 보정안으로 처리 |
| `users_protect_privileged` | `role`, `extra_permissions`, `is_active` 변경을 기존 관리자에게 제한 | 신축 학교 관리자에게 이 전역 프로필 변경권을 주지 않음 |
| `users.role`, `extra_permissions`, `department_id` | 전역 역할 4종·추가 권한·부서 1개 | 기존 경로 호환용. 신축의 학교별 권한·겸임 배정을 대체할 수 없음 |
| `public.departments` | 전역 부서, `head_id`가 기존 사용자 참조 | 학교 기준표로 승인된 매핑 후 연결. 과거 seed 자동 재실행 금지 |
| `schedules`, `tasks` | 사용자/부서 참조, 학교 식별자 없음. legacy tasks는 배정자·관리자 접근이 포함됨 | 신축 개인 업무로 일괄 복사하지 않음. 원본 목적·작성자·배정자를 분류 |
| `doc_ai_conversations` | 작성자만 읽기·수정·삭제, 관리자 예외 없음. 새 INSERT에 승인 검사 | 작성자 전용을 유지. 학교 안 개인 자료로 분류하고 공용 지식으로 자동 등록하지 않음 |
| `doc_submissions`, `submissions` 버킷 | 사용자 폴더와 전역 관리자 정책. `submitted/replaced/deleted`, 물리 행 DELETE 없음 | 제출판·파일 실물을 대조하여 수합 모델에 연결. 취소와 실물 파기를 구분 |
| `academic_terms`, `calendar_events` | 전역 학기·공식/공유 일정. shared는 승인 교사 전원 편집. 학교 식별자 없음 | 새 학기/일정과 이름만 보고 합치지 않음. 소유 학교·날짜·공식 여부·취소를 매핑 |
| `chat.js`, `extract.py`, `generate.py` | Auth 사용자 확인 후 `public.users.is_active` 검사 | 현재 학교 소속을 검사하는 신축 API로 자동 바뀌지 않음. 별도 legacy 회수 게이트 필요 |

`packages/shared/src/permissions.js`는 UI 표시용이다. 실제 DB RLS와 다를 수 있는 오래된 주석을 운영 권한의 근거로 사용하지 않는다. `is_admin()` 같은 기존 헬퍼가 학교 경계를 대신한다고 가정하지 않는다.

### 2.2 신축 계열 — 검토안과 연결 코드

| 실제 파일 | 현재 객체·계약 | 상태 |
|---|---|---|
| `database/workhub/001-calendar-foundation.proposed.sql` | `workhub_settings`, `workhub_schools`, `workhub_memberships`, `workhub_calendar_events`, `workhub_calendar_receipts`, `workhub_calendar_audit` 및 RPC/RLS | 합성 DB 검증을 가진 적용 전 제안. 실제 적용 여부 미확인 |
| `002-account-preservation-dry-run.sql` | 읽기 전용 계정/프로필 수·고아 참조·함수 지문 등 | 회원 보존 사전 점검. 개수 일치만으로 모든 행의 보존을 증명하지 않음 |
| `003-bootstrap-school.proposed.sql` | 기존 승인 superadmin을 명시한 학교·기간의 `calendar_manager` 소속으로 연결 | 기존 계정 생성/승격 없음. 같은 입력 재실행·충돌 거부. 실제 학교 관리자 체계 전체를 구현한 것은 아님 |
| `004-personal-tasks.proposed.sql` | `workhub_personal_tasks`, `workhub_task_receipts`, `workhub_task_audit`; 본인 학교 소속 단위 RPC | 계정과 무관한 개인 공간이 아님. 재발령 새 소속에 자동 이전하지 않음 |
| `connection/legacy-client.ts` | `@daedong/shared`의 기존 세션·프로필·로그인·`supabase.rpc`만 사용 | 새 클라이언트·별도 회원 생성 없음 |
| `connection/supabase-connection.ts` | 엄격한 기존 승인 확인, 세션 세대/계정 확인, 권한 거부 시 컨텍스트 폐기 | 서버 RLS의 대체물이 아닌 응답·화면 보호 |
| `connection/supabase-calendar.ts`, `tasks/supabase-task-adapter.ts` | 기존 RPC 호출·학교/소유자/입력·응답 검증 | 현재 함수명·입출력을 먼저 보존 |

현재 `workhub_settings.rollout_mode='superadmin'`과 기존 `/workhub` 메뉴 제한을 유지한다. `members`로 바꾸는 것은 일반 교사와 타학교 공개를 완료했다는 뜻이 아니며 별도 승인·검증 사항이다.

## 3. 공통 키·계정·학교 기반

### 3.1 ID와 참조

이 문서의 제안 표는 별도 표기가 없으면 ID·필수 주체·상태·버전·생성 시각이 NOT NULL이며, `*_at`은 TIMESTAMPTZ(UTC 저장), 날짜 기간은 DATE다. `version`은 양수 정수다. 선택 열/미승인·미종료 시각은 NULL을 허용한다. 참조 삭제는 기본 RESTRICT/NO ACTION이며 회원·학교 삭제의 CASCADE로 업무 증거를 지우지 않는다. 실제 파기는 승인된 유형별 절차로 별도 처리한다.

- 사용자 참조는 기존 `public.users.id TEXT`, 도메인 ID는 `TEXT`를 계승한다. 이름·이메일·반 번호는 영구 키가 아니다.
- 신규 학교 자료에는 `school_id NOT NULL`과 `UNIQUE(school_id,id)`를 두고, 같은 학교 관계는 `(school_id, child_reference)` 복합 FK로 강제한다. 전역 PK `id`만으로 학교 일치까지 보장한다고 설명하지 않는다.
- `school_id`, 소유 소속, 작성자, 원본 ID의 의미를 구분한다. 사용자 입력으로 저장된 행의 학교·작성자를 바꾸지 못한다.
- 학교 자료에 계정 개인 자료를 뜻하는 NULL 학교 값을 섞지 않는다. 공통 파일 등 명시적으로 예외가 필요한 표만 scope CHECK를 사용한다.
- 현재 `workhub_memberships`에는 이미 `UNIQUE(school_id,id)`가 있다. 일정 표는 `id` PK만 있고 receipt/audit의 `event_id` FK는 단일 ID다. 후속 승인 SQL에서 일정의 `UNIQUE(school_id,id)` 및 해당 참조의 복합 FK를 보강한다. 원본 001 파일을 사후 수정하지 않는다.
- 현재 개인 업무는 `UNIQUE(school_id,owner_member_id,id)`와 receipt/audit의 동일 세 열 FK가 있다. 신규 관계가 `(school_id,id)`만 필요할 때 그 UNIQUE를 추가하되 기존 본인 범위 FK를 느슨하게 바꾸지 않는다.

### 3.2 학교와 조직 기준표 — 추가 제안

| 표 | 주요 열·제약 | 인덱스·접근 |
|---|---|---|
| `workhub_schools` 보강 | 기존 id/name 유지. `code TEXT NULL`, `school_type TEXT`, `timezone TEXT DEFAULT 'Asia/Seoul'`, `status TEXT CHECK(active/suspended/closed)`, `version INT >0`, `permission_version BIGINT >0`, 생성/수정 시각. 검증된 기관 코드만 부여 | code가 있을 때 UNIQUE. 같은 학교 현재 소속에 한정한 학교 정보. status 변경은 운영 승인 경로 |
| `workhub_departments` | id, school_id, `code`, `name`, `sort_order`, `active`, version. UNIQUE(school_id,id), UNIQUE(school_id,code) | (school_id,active,sort_order,id). 같은 학교 승인 소속 읽기, `organization.manage`만 변경 |
| `workhub_grade_levels` | id, school_id, code, name, sort_order, active, version. 동일 두 UNIQUE | (school_id,active,sort_order,id). 교과·학급과 별개인 학교 학년 기준 |

학교 유형·코드 체계는 확인된 기준과 지원 범위를 승인한 뒤 CHECK/참조표를 확정한다. 학교 이름이 같다고 같은 학교로 합치지 않는다. 학교 상태를 중지할 때도 계정·소속·자료를 삭제하지 않는다.

학년도·학기·교과·학급·수업은 학생 설계의 `workhub_academic_years`, `workhub_terms`, `workhub_subjects`, `workhub_academic_classes`, `workhub_courses`를 참조한다. 기존 전역 `academic_terms`와 신축 표는 다른 객체다.

## 4. 소속·가입·기간·전출

### 4.1 현재 소속 계약과 보강 순서

현재 열은 `id`, `school_id`, `user_id`, `role(teacher/calendar_manager)`, `active`, `valid_from`, `valid_through`, `department_ids`, `grade_ids`, `subject_ids`다. **valid_through는 마지막 유효일이며 양 끝 포함**이다. 서버 판정일은 서울 기준 `workhub_today()`다. 같은 학교·사용자의 활성 기간 중첩은 advisory lock과 트리거가 거부한다. id/school_id/user_id 변경도 거부한다.

최종 기획의 시작 포함·종료 제외 원칙은 새 기간 관계에 적용한다. 기존 필드를 몰래 종료 제외로 바꾸지 않는다. 날짜 변환은 `end_exclusive = valid_through + 1일`, 역변환은 하루 빼기이며 경계·범위 검사를 한다. API v1의 `validFrom/validThrough`는 기존 의미를 유지한다. 시간 단위 긴급 철회는 날짜를 조작하지 않고 active/status와 권한 버전 변경으로 처리한다.

| 보강 열 | 의미·검사 |
|---|---|
| `status TEXT` | active/suspended/left. pending은 아래 가입 신청 표로 나타낸다. 단계 전환 시 단일 권위로 도입. 기존 active=false를 created_at만 보고 pending/left로 자동 분류하지 않음 |
| `version INT >0` | 소속 수정의 낙관적 충돌 검사 |
| `permission_version BIGINT >0` | 역할·기간·관계·승인 상태 변경 시 증가. 캐시 무효화 키이며 그 자체가 접근 허가증은 아님 |
| `approved_by_member_id`, `approved_at` | 학교 승인 출처. 같은 학교 FK; 최초 플랫폼 지정은 별도 bootstrap 감사로 구분 |
| `suspended_at`, `ended_at`, `reason_code` | 정지/종료 사실. 이유는 제한된 코드와 필요한 최소 메모, 학생·상담 원문 금지 |

status 도입 전은 현재 active+기간이 권위다. 도입 후 active는 기존 클라이언트/RPC를 위한 호환 투영으로만 유지하며, 같은 상태 전이 트랜잭션에서 DB가 계산한다. 사용자에게 두 필드를 따로 수정하게 하지 않는다. 현재 RPC가 active만 읽는 기간 동안 status만 바꿔 철회했다고 표시하면 안 된다. 한 배포 묶음에서 쓰기 경로·호환 제약·회귀를 함께 적용한다.

새 소속 관리 RPC는 변경 전 version, 기간, 역할, 현재 관리자 권한을 재검사한다. 활성 중첩 거부를 status 전환·기간 수정에도 유지한다. 재발령은 새로운 소속 ID이며 기존 자료의 작성자 ID를 일괄 변경하지 않는다.

### 4.2 가입 전 예외와 전역 승인 보존

기존 가입 트리거는 유지한다. 새 가입자는 여전히 `users.is_active=false`다. 따라서 현재의 `workhub_gate()`를 모든 가입 API에 그대로 적용하면 가입 신청 자체가 불가능하다. 다음 경로만 별도 최소 계약으로 만든다.

| 제안 경로 | 허용되는 일 | 허용되지 않는 일 |
|---|---|---|
| `workhub_joinable_schools` | 유효 세션 확인 후 가입 허용 학교의 최소 ID·이름·신청 가능 상태/초대 확인 결과 | 교사 명단·이메일·업무·내부 학교 설정·무제한 전체 검색 |
| `workhub_membership_request_create` | 본인 user_id를 서버에서 정해 pending 요청 생성, 동일 학교의 기존 요청 중복 방지 | role/active/permission 지정, 타인 요청, 업무 조회 |
| `workhub_membership_request_get` | 본인의 신청·대기·거부 상태 | 다른 신청자 목록 |
| 학교 승인 경로 | 현재 학교의 membership.approve 권한자가 자기 학교 신청을 결정 | 기존 users.role/extra_permissions/is_active의 자동 변경 |

제안 표 `workhub_membership_requests`: id, school_id, user_id, state(pending/approved/rejected/cancelled), requested_at, decided_at, decided_by_member_id, approved_membership_id, version, 최소 reason_code. UNIQUE(school_id,id), pending에 한정한 UNIQUE(school_id,user_id), 소속/결정자 복합 FK, (school_id,state,requested_at,id) 및 (user_id,requested_at,id) 인덱스. 직접 INSERT/UPDATE는 주지 않고 위 RPC만 허용한다. 학교 관리자는 해당 학교 신청 업무에 필요한 최소 프로필만 본다.

논리적 pending 소속은 이 신청이 나타낸다. 승인 후 확정 소속을 만들 때의 기간·역할을 같은 트랜잭션에 기록한다. 물리 membership.status=pending을 직접 쓰는 이중 신청 구조는 만들지 않는다. 기존 pending 소속을 이관해야 한다면 요청과의 1:1 대응을 먼저 정한다.

**초기 안전안은 전역 서비스 승인과 학교 승인을 별도 상태로 취급하는 것이다.** 학교 승인만으로 전역 is_active를 true로 만들지 않으며, 전역 미승인/정지이면 학교 승인 뒤에도 업무 접근은 차단된다. UI는 ‘학교 승인 완료 / 서비스 승인 확인 필요’를 구분한다. 전역 승인 변경은 기존 제한 경로와 별도 승인된 운영 절차를 사용한다. 향후 D20의 이중 의미를 풀어 서비스 자격과 학교 소속을 분리하려면 legacy 전부의 gate·트리거·관리 UI를 함께 검토한다. 본 설계가 D20 폐지나 일괄 활성화를 승인하지 않는다.

### 4.3 겸임·퇴직·개인 공간

- 겸임자는 계정 하나와 학교별 소속 여러 개를 가진다. 각 요청은 member_id 하나로 학교 범위를 고정한다. A학교 관리자 역할로 B학교 자료를 처리할 수 없다.
- 소속 종료는 인계 완료보다 우선한다. 미수락 업무 때문에 접근 기간을 연장하지 않는다. 업무 인계는 권한 있는 담당자가 원본 의무를 유지하여 재배정한다.
- `workhub_personal_tasks`는 학교 내 본인 자료다. 퇴직 뒤 계속 보는 순수 개인 공간으로 바꾸거나 학생/학교 파일을 붙여 계정 공간에 복사하지 않는다.
- 새 소속 ID가 같은 user_id를 가진다고 옛 개인 업무·대화·관찰 접근을 자동 복원하지 않는다. 필요한 과거 정정은 대상 원본·목적·기간이 확인된 별도 절차이며 관리자에게 본문을 기본 공개하지 않는다.
- 세션 갱신, 학교 전환, 소속 종료 시 현재권한 재검사와 클라이언트 캐시·대기 요청·다운로드·AI/검색/작업의 폐기를 함께 연결한다. 이미 교사가 다운로드한 파일까지 원격 삭제할 수 있다고 약속하지 않는다.

## 5. 학교 역할·관계·정책

### 5.1 역할은 학교 범위 권한 묶음이다

전역 users.role은 기존 앱의 호환 계약이다. 새 학교 최고관리자를 전역 admin으로 승격하면 기존 모든 학교 없는 자료까지 권한이 넓어질 수 있다. 신축 역할은 별도 표로 관리하고 private 작성자 조건을 역할 상속으로 덮지 않는다.

| 제안 표 | 필드·키·제약 | 접근 |
|---|---|---|
| `workhub_permission_catalog` | code TEXT PK, scope_kind(school/platform), description, module_key, action_kind, active. UNIQUE(scope_kind,code). 코드 배포와 함께 검증하는 허용 행동 목록 | 읽기용 카탈로그. 학교가 임의 코드나 SQL을 추가하지 못함 |
| `workhub_school_roles` | id, school_id, code, name, active, version. UNIQUE(school_id,id), UNIQUE(school_id,code) | 해당 학교 역할 관리 권한만 변경 |
| `workhub_role_permissions` | school_id, role_id, permission_code, permission_scope=school 고정 CHECK. PK(school_id,role_id,permission_code), 역할 복합 FK와 (permission_scope,permission_code) 카탈로그 FK | 학교 역할 편집 RPC. 플랫폼/개인자료 예외 권한을 학교 역할에 추가할 수 없음 |
| `workhub_role_grants` | id, school_id, member_id, role_id, valid_from DATE, valid_to DATE(종료 제외), revoked_at, granted_by_member_id, version | 같은 학교 세 종류 복합 FK. UNIQUE(school_id,id), 시작<종료, 부여 기간은 소속 유효기간 안. 현재 유효 중복 부여 방지 |

권한 예시는 membership.approve, organization.manage, calendar.manage_shared, collections.manage, documents.publish, support.approve다. 실제 권한 목록·자기검토/작성자 수정 정책은 기능 명세의 승인 결과와 묶어 확정한다. 관리자가 `private.read_all`을 추가하는 탈출구는 제공하지 않는다. 최초 학교 관리자 지정·마지막 유효 관리자 회수는 전용 승인 경로와 감사가 필요하며 잠금 안에서 관리자 수를 검사한다.

조회 인덱스는 grants `(school_id,member_id,valid_from,valid_to)`의 revoked_at NULL 대상과 역할별 `(school_id,role_id,member_id)`다. 기간 중복 검사는 동시 INSERT/활성화에도 적용한다. 권한 카탈로그/역할 변경 시 영향 소속의 permission_version 또는 학교 permission_version을 같은 트랜잭션에서 올린다. 함수는 현재 원본을 읽으며 브라우저가 보낸 역할·캐시된 권한을 사용하지 않는다.

현재의 `memberships.role=calendar_manager`는 아직 이 표를 읽지 않는다. 전환 시 해당 역할에서 검증된 grants를 만들고 새 함수의 결과를 대조한다. 기존 함수에서 새 권한 판정으로 바꾸기 전까지는 현재 열을 권위로 유지하며, 양쪽을 OR하여 어느 한쪽이 허용하면 통과시키는 이중 권한 체계는 금지한다.

### 5.2 플랫폼 권한은 공통 게시·운영 행동만

공통 규정/문서팩 게시·색인, 학교 최초 관리자 연결, 승인된 지원 수행은 학교 관리 권한과 별도다. 제안 `workhub_platform_grants`는 id TEXT PK, user_id→기존 users, permission_key, permission_scope=platform 고정 CHECK, valid_from/valid_to TIMESTAMPTZ(종료 제외), approved_by_user_id, approved_at, revoked_at, reason_code, version을 가진다. (permission_scope,permission_key)는 위 카탈로그의 복합 FK이며 시작<종료, 승인자/승인시각 필수, 같은 사용자·권한의 겹친 유효 부여를 막는다. 인덱스는 (user_id,permission_key,valid_from,valid_to)의 revoked_at NULL 대상이다.

`common_knowledge.publish`, `common_assets.publish`, `school.bootstrap`, `support.execute`처럼 서버에 등록된 플랫폼 행동만 부여한다. 학교 역할로 이 권한을 얻을 수 없다. 승인된 서비스 계정의 현재 플랫폼 grant를 검사하되 공통 작업에는 학교 소속을 억지로 만들지 않는다. 반대로 플랫폼 grant는 학교의 공유/개인 자료를 상시 읽는 권한이 아니다. support.execute도 아래 지원 세션의 모든 조건을 통과해야 한다.

초기 지정은 승인된 내부 bootstrap으로만 수행하며 기존 superadmin 전원을 자동 등록하지 않는다. 표를 도입하기 전에는 공통 게시를 비활성 상태로 두거나 승인된 기존 superadmin+명시적 내부 allowlist에만 제한하는 전환안을 별도 검토한다. 브라우저 role 검사만으로 공통 게시를 열지 않는다. 플랫폼 권한 변경은 학교 관리자 경로와 AI 도구에 노출하지 않는다. grant 승인/철회, 관련 작업의 claim/결과 확정도 같은 사용자·grant 잠금 순서를 정해 경합 검증한다.
### 5.3 승인된 관계와 본인 신고를 분리한다

현재 department_ids/grade_ids/subject_ids와 schools.relation_labels는 TEXT 배열/JSON이므로 기준표에 대한 FK가 없다. 신축 관계의 제안은 다음과 같다.

- `workhub_member_departments(id,school_id,member_id,department_id,valid_from,valid_to,approved_by_member_id,version)`.
- `workhub_member_grades(id,school_id,member_id,grade_level_id,valid_from,valid_to,approved_by_member_id,version)`.
- 교과·수업·담임 담당은 학생 문서의 승인된 기간 관계를 사용한다. 같은 의미의 교과 담당 표를 별도로 중복 생성하지 않는다.
- 위 두 표의 ID·회원·대상·승인자에는 학교 복합 FK, 기간에는 시작<종료와 동일 관계의 겹친 유효 배정 거부를 둔다. 조회 인덱스 `(school_id,member_id,valid_from,valid_to)` 및 대상별 역조회 인덱스를 둔다.
- 본인 신고는 별도 `workhub_profile_claims(id,school_id,member_id,claim_type,proposed_value,state,reviewed_by_member_id,version)`의 pending 요청이다. 관계 FK 검사·승인 후에만 공식 관계에 반영한다. 이 요청 표를 audience 판정에 직접 사용하지 않는다.

현재 값 ‘math’, ‘2’ 등을 새 TEXT ID로 그대로 해석하지 않는다. 학교별 코드→기준 ID 매핑을 사람이 확인한다. 미매핑·중복·기간 충돌을 격리하고, 모두 해결된 관계만 호환 배열/`schoolLabels`로 서버가 투영한다. 화면과 SQL audience는 같은 승인 관계·기준일·제외 우선 규칙을 사용한다. 추천은 발생일 관계, 접근은 현재권한이라는 차이도 유지한다.

### 5.4 정책과 공개 제어

제안 `workhub_school_policy_versions`: id, school_id, policy_key, version, value JSONB, state(draft/published/retired), valid_from/valid_to(종료 제외), approved_by_member_id, approved_at, created_at. UNIQUE(school_id,id), UNIQUE(school_id,policy_key,version), 현재 게시판의 적용기간 중첩 거부. value는 등록된 policy_key의 형식으로 검증하고 게시판은 불변이다. 보존 기간을 임의 기본값으로 채우거나 학교 설정으로 작성자 전용 원칙·tenant 경계를 약화할 수 없다. 보존·삭제 실행은 운영 설계가 담당한다.

제안 `workhub_school_features`: school_id, feature_key, state(hidden/pilot/enabled), version, approved_by_member_id, approved_at. PK(school_id,feature_key). 기능 목록은 코드에 등록하며 메뉴와 API 모두 같은 상태를 확인한다. 이 표는 전역 rollout gate와 AND 결합한다. 기존 `superadmin` gate가 유지되는 동안 school feature=enabled라도 일반 교사를 허용하지 않는다. 실제 파일럿 대상 제한이 필요할 때 명시적 소속 allowlist를 추가하며 역할 이름을 파일럿 권한 대신 쓰지 않는다.

## 6. 접근 정책과 서버 실행 계약

### 6.1 최소 정책 행렬

모든 ‘허용’은 현재 서비스 자격, 해당 학교 현재 소속, 자료 상태·기간·행동 조건을 통과한 경우다. 학교 관리자와 서비스 운영자는 다른 주체다.

| 자료/행동 | 본인 교사 | 같은 학교 타인 | 학교 관리자 | 플랫폼 지원자 |
|---|---|---|---|---|
| 최소 학교 검색·본인 가입 신청 | 가입 전 전용 경로 | 타인 신청 불가 | 해당 학교 신청 업무만 | 승인된 bootstrap 메타데이터 |
| 계정 본인 프로필 | 기존 본인 읽기·허용 필드 | 학교 roster의 최소 필드만 | 학교 승인용 최소 필드, 전역 권한 변경 불가 | 운영 목적별 최소 메타데이터 |
| 학교 공유 자료 | visibility·대상·행동에 따라 | 같은 조건 | 해당 관리 권한과 열람 가능 범위 | 유효한 지원 세션의 공유 자료만 |
| private 일정·개인 업무 | 현재 소속+작성자/소유자 | 불가 | 타인 자료 불가 | 내용 접근 불가 |
| 관찰·상담·개인 대화·미제출 초안 | 작성자/명시 협업자 등 해당 계약 | 해당 계약이 허용하는 공동 초안 외 불가 | 본문 기본 열람 불가 | 내용 접근 불가 |
| 수합 제출판 | 해당 단위·판의 권한 | 임의 열람 불가 | 지정 수합 검토/관리 권한 | 승인된 공유 접수자료 중 허용분만 |
| receipt 재조회 | 현재 원본 열람권한 재검사 | 불가 | 타인 개인 receipt 불가 | 별도 최소 상태 진단만 |
| 감사·지원 기록 | 본인에게 필요한 접수 결과 | 불가 | 해당 학교 최소 관리 메타데이터 | 승인된 운영 메타데이터 |
| 파일/미리보기/ZIP | 원본 현재 관계+실물 검증 | 동일 원칙 | 관리자 우회 없음 | 세션에 포함된 공유 파일만 |
| 소속 종료 뒤 학교 자료 | 기본 거부 | 해당 없음 | 종료 계정 대신 본문을 승계하지 않음 | 지원 예외로 복원하지 않음 |

audience는 private에 OR로 붙지 않는다. 학교 범위 일정은 현재 소속 AND (작성자 OR school공개 OR audience공개이면서대상)다. 제외 우선·묶음 OR/차원 AND·직접 포함을 공유 합성 사례로 검증한다. 실제 일정관리자는 비공개 타인 일정을 수정할 수 없고, 자신이 소유하지 않은 공유 일정을 private로 바꿔 소유권처럼 가져올 수도 없다.

### 6.2 RLS·함수·service_role

1. 앱 역할에는 필요한 SELECT와 RPC EXECUTE만 부여한다. 현재처럼 원본 쓰기·receipt·감사는 RPC로 한정한다. 신규 표 생성 트랜잭션에서 RLS·REVOKE·정책·필요 GRANT를 함께 적용한다.
2. 보안 함수는 `SECURITY DEFINER`, 고정/빈 search_path, schema로 한정된 객체명을 사용한다. 정책이 users를 재귀 조회하지 않도록 검증된 헬퍼를 사용한다. 함수 소유자·실행권한도 검토 대상이다.
3. 넓은 `workhub_%` 함수 일괄 REVOKE 패턴을 후속 마이그레이션에서 무심코 반복하면 기존 RPC 실행권한을 지울 수 있다. 후속 SQL은 대상 함수 서명을 명시한다.
4. 호출자의 school_id/member_id는 권한 증거가 아니다. auth.uid에서 계정을 확인하고 소속의 user_id·학교·유효기간·자료 참조를 검사한다. 오류/조회 실패를 허용·빈 배열로 바꾸지 않는다.
5. service_role, 테이블 소유자, DBA는 앱 RLS의 보호 경계 밖이다. 이 키를 브라우저에 두지 않는다. 서버·작업자는 검증된 주체/학교/행동을 명시하고 대상 자료량을 제한한다. RLS만으로 DB 운영자의 기술적 본문 접근까지 불가능하다고 표현하지 않는다.
6. 사용자 작업은 시작·단계 재개·결과 확정 때 현재권한을 재검사한다. 권한이 사라지면 새 읽기·생성·다운로드를 중단한다. 독립 보존/복구 작업은 별도 서비스 주체와 승인 범위를 기록한다.
7. 캐시/색인/작업/파일 키는 학교·소유범위·권한 버전·자료 버전과 결합한다. 다른 학교 ID를 URL·RPC 인자·파일 경로·검색 필터에서 바꿔도 결과가 나오지 않아야 한다. 토큰 claim 하나만 오래 믿고 역할 변경을 무시하지 않는다.

### 6.3 기존 RPC 호환과 변경 원자성

| 유지할 RPC | 현재 입력 | 현재 결과 |
|---|---|---|
| `workhub_context` | 없음 | basisDate, schools, memberships, schoolLabels. 현재 visible 학교의 대상선택 roster이며 본인 소속만 담긴 배열이 아님 |
| `workhub_calendar_list/get` | p_member_id / 추가 p_event_id | CalendarEvent 배열/단건 |
| `workhub_calendar_save` | p_member_id, p_command | 저장 원본 또는 동일 요청의 이전 결과. requestKey는 command 안 |
| `workhub_task_list/get` | p_member_id / 추가 p_task_id | PersonalTask 배열/단건 |
| `workhub_task_mutate` | p_member_id, p_command, p_request_key | create/update/status 원본 또는 동일 요청 결과 |

현재 CONFLICT, IDEMPOTENCY_CONFLICT, INVALID_INPUT, FORBIDDEN, INACTIVE_MEMBERSHIP, NOT_FOUND를 유지한다. 기획서의 VERSION_CONFLICT 명칭을 이유로 기존 어댑터를 깨지 않는다. 통합 오류 봉투를 도입하면 명시적 변환 계층을 둔다. 충돌 details의 본문도 현재 열람권한과 학교/소유자/ID를 검사한다.

기존 저장 순서는 **users 승인 행 FOR SHARE → 본인 membership FOR UPDATE → 대상 원본 FOR UPDATE → 잠금 뒤 현재권한·version 재검사 → 원본+receipt+audit 동일 트랜잭션**이다. 재시도에서도 현재 원본 열람을 먼저 확인한다. 같은 키·다른 정규화 본문은 거부하고 응답 유실만으로 새 키를 만들지 않는다. receipt에는 개인 원문이 포함될 수 있으므로 일반 로그·운영 대시보드와 분리한다.

학교 상태·새 역할·정책 철회까지 직렬화하려면 후속 SQL에서 공통 잠금 순서를 확장해야 한다. 신규 도메인의 정본 순서는 **관련 users ID 정렬 → school gate(공통 작업은 platform grant) → memberships ID 정렬 → 권한/정책 행 → 멱등 advisory key → 근거 owner gate(학생/AI 필요 시) → 업무 원본(종류/ID 정렬) → 파일 ID 정렬 → receipt/audit/outbox INSERT**다. 승인·철회·인계·작업 확정도 같은 순서를 사용한다. 현재권한 읽기는 FOR SHARE, 회수 변경은 FOR UPDATE처럼 실제 충돌하는 잠금을 사용하며 FOR KEY SHARE만으로 non-key 승인/상태 변경을 막았다고 하지 않는다. create에는 아직 원본 행이 없어도 멱등 키 잠금을 먼저 확보한다. 모듈 간 원본 종류 순서를 등록하고 실제 독립 연결에서 회수·인계·재시도 경합을 시험한다. 현재 001·004가 이 확장을 이미 제공한다고 보지 않는다. 같은 사용자의 요청 직렬화가 큰 학교 부하에서 병목인지 측정한 뒤에만 잠금을 줄인다.

현재 목록 RPC는 전체 배열이다. 다음 규모 단계에서 학교·기간·상태·cursor 제한 RPC를 별도 버전으로 추가하고 어댑터를 함께 전환한다. 검색 입력 길이/페이지 상한을 서버에서 제한한다. 전체 배열 인터페이스에 몰래 일부만 반환하여 ‘업무가 사라진 것’처럼 보이게 하지 않는다.

## 7. 지원 접근과 파일 경계

### 7.1 지원은 기존 열람권한 안의 제한된 공유 자료만

제안 `workhub_support_sessions`: id, school_id, requester_member_id, support_user_id, approved_by_member_id, purpose_code, requested_at, requester_confirmed_at, approved_at, expires_at, revoked_at, state(requested/approved/closed/revoked), allowed_actions(서버 allowlist), scope_hash, version. 요청자·학교 승인자는 소속 복합 FK, 지원 주체는 기존 users 참조이며 현재 support.execute 플랫폼 grant가 필요하다. 인덱스는 `(school_id,state,expires_at)` 및 `(support_user_id,state,expires_at)`다.

학교 승인만으로 모든 자료를 허용하지 않는다. 요청자 확인+학교 지원 승인+지원자 지정+목적+자료 목록/판+행동+만료가 모두 필요하다. scope_hash와 허용 행동을 변경하면 요청자 확인·학교 승인을 무효화하고 다시 확인한다. 실제 읽기마다 요청자도 지금 그 공유 자료를 읽을 수 있는지 검사한다. 승인 뒤 private로 바뀌거나 요청자 소속이 종료되면 지원 세션이 남아 있어도 거부한다.

지원 대상은 모듈별 typed 연결표로 두고 `(school_id,session_id)`와 `(school_id,resource_id)`의 복합 FK를 사용한다. 초기에는 오류 메타데이터만 지원한다. 공유 일정 지원을 실제 제공할 때 그 연결표를 추가하고, 문서/제출 지원은 해당 표와 권한 함수가 생긴 뒤 추가한다. 검사되지 않은 resource_type/resource_id 문자열을 받아 임의 표를 조회하는 범용 도구를 만들지 않는다.

작성자 전용 관찰·상담·대화·미제출 초안은 세션 대상 등록 자체를 거부한다. 감사에는 지원자·요청자·학교·목적·대상 ID·행동·시각·결과를 남기고 본문을 복사하지 않는다. 플랫폼 운영자의 사용자 가장 로그인을 기본 지원 수단으로 삼지 않는다.

### 7.2 파일 메타데이터와 실제 객체

업무 문서에서 정의하는 `workhub_files`를 사용한다. 이 문서는 같은 파일 표를 다시 만들지 않는다. 학교 파일은 school_id·owner_member_id 필수, 공통 파일은 명시적 scope_type=common으로 분리한다. DB 생성 scope_key(common 또는 school/학교ID)와 UNIQUE(scope_key,id)를 사용해 common의 NULL school FK 우회를 막는다. 공통 양식/지식 연결은 (scope_key,file_id) 복합 FK와 MATCH FULL, 학교 전용 연결은 NOT NULL school 복합 FK를 사용한다. `(bucket,object_path)` UNIQUE, 학교 복합 FK, ready 이후 path/hash/size 불변, scan_state·access_revoked_at·purged_at 분리 계약을 계승한다.

권장 새 비공개 버킷 이름은 운영 확인 후 정한다. 객체 키는 학교/파일 ID/불변 판으로 구성할 수 있지만 경로 문자열만 권한으로 사용하지 않는다. Storage SELECT·서명/다운로드·미리보기·ZIP은 **현재 도메인 연결 권한 AND ready/clean AND 접근 미회수 AND 실물 일치**를 확인한다. 하나의 파일이 여러 자료와 연결되면 어떤 연결을 근거로 접근하는지 명시하고 그 연결의 권한을 검사한다.

업로드 허가는 파일 ID·학교·소유자·예상 크기/형식·만료에 묶는다. 최종 바이트의 hash/size/형식 검사 후 ready로 전환한다. overwrite/재업로드는 검증된 기존 파일을 바꾸지 않고 새 파일 ID를 만든다. 사용자에게 버킷 임의 경로 쓰기·삭제를 주지 않는다. 버킷 시스템 보호 트리거를 해제하거나 storage.objects 행 삭제를 파일 삭제와 같다고 보지 않는다.

legacy `submissions/{user_id}/...` 객체는 기존 경로를 즉시 일괄 이동하지 않는다. 원본 파일 매핑→실물 대조→새 접근 경로 검증→옛 접근 차단을 순서대로 한다. public 여부와 각 정책은 실제 버킷에서 확인해야 하며, 005의 private 설정 문구만으로 현재 상태를 인증하지 않는다.

민감 파일의 즉시 권한 회수가 필요하면 매 요청 권한을 확인하는 전달 경로를 우선 검토한다. 서명 URL 방식은 발급 중단과 이미 발급된 URL의 만료/회수 한계를 별도로 확인한다. URL에 부여한 만료를 캐시 무효화로 즉시 없앴다고 주장하지 않는다. 학교 전환·소속 종료·지원 철회·파일 차단 후 직접 링크/Range 요청/기존 캐시를 시험한다.

## 8. legacy 접근 회수 — 타학교 공개 전 독립 게이트

현재 새 RLS를 추가해도 아래 경로는 그대로 남는다. 이는 소스의 설계 경계 분석이며 실제 운영 데이터가 유출됐다는 주장은 아니다.

| 경로 | 소스에서 드러나는 차이 | 공개 전 완료할 일 |
|---|---|---|
| `users_select` | 승인 사용자는 전체 legacy 프로필 읽기. 학교 없음 | 본인 프로필 예외 유지, 학교 roster는 최소 필드 전용 경로. 타학교 프로필/이메일 노출 차단 |
| global admin·department helpers | 역할과 부서가 전역이며 다수 함수가 is_active를 포함하지 않음 | legacy 학교 바인딩과 현재 소속을 명시하거나 종료. 새 학교 admin을 전역 admin으로 매핑 금지 |
| `schedules`, `tasks` | 학교 없는 기존 정책. 003은 일부 INSERT/SELECT만 보강 | 승인 철회한 과거 작성자·배정자·관리자의 READ/UPDATE/DELETE 모두 시험 |
| `doc_ai_conversations` | owner SELECT/UPDATE/DELETE는 현재 학교 소속을 모름 | 작성자 전용 유지+현재 legacy 학교 범위 검사 또는 승인된 이관 후 옛 경로 종료 |
| `doc_submissions`·Storage | owner 폴더/전역 admin, 기존 SELECT는 학교 소속을 모름 | 제출판/파일 매핑과 같은 학교 검토권한 연결. 목록·다운로드·삭제 경로 함께 회수 |
| `calendar_events`, `academic_terms` | 전역 공식/공유 권한 | legacy 학교에 한정. 새 공식/공유 정책과 차이 승인 |
| doc-ai 채팅/추출/생성 URL | 전역 승인만으로 기존 학교 자산·생성 경로 사용 | 실제 URL별 학교 맥락 검증/레거시 종료. 파일·모델 비용 경로도 함께 차단 |
| receipt·내보내기·검색·캐시·대기 작업 | 과거 결과를 통한 우회 가능성 | 현재 원본 권한 재검사·권한 버전 폐기·작업 재개 거부 시험 |

신축이 같은 Supabase public에 공존하는 동안, 아직 학교가 없는 legacy 표는 ‘현재 요청의 학교가 곧 소유 학교’라고 추정하지 않는다. 기존 자료가 어느 학교 소유인지 승인된 고정 바인딩/매핑으로 검증한다. 복수 학교 자료가 섞였다면 자료별 매핑이 끝날 때까지 해당 경로를 격리한다.

초기에는 대동 1개 실제 학교·기존 superadmin 범위를 유지하고 합성 2학교로 격리를 시험한다. **두 번째 실제 학교의 승인 계정을 연결하기 전에** 위 레거시 게이트가 통과해야 한다. 메뉴 숨김, 신규 RPC만의 성공, 학교 하나의 정상 화면은 대체 증거가 아니다. 승인 SQL/코드는 새 번호·새 PR로 만들고 기존 migrations 확정본의 내용을 바꾸지 않는다.

## 9. 회원 보존·이관·복구 실행 순서

### 9.1 적용 전 증거와 생성 순서

1. 운영 적용 파일·함수·트리거·RLS·GRANT·버킷 공개 설정·기존 API/Root를 권한 있는 환경에서 읽기 확인한다. 이번 문서에 실제 확인 완료라고 표시하지 않는다.
2. 계정/프로필을 같은 기준 시점으로 대조한다. ID 집합, 누락/고아, 역할·승인·extra_permissions·부서·이름/이메일의 원본 일치, 가입/보호 트리거 정의·수, 기존 대화/제출/파일 소유 참조를 확인한다. 개인정보 원문과 토큰은 채팅/CI 산출물에 넣지 않는다. 안전한 환경 안의 행 비교와 지문/차이 건수만 증거로 낸다.
3. 자연 가입·정상 프로필 수정을 오류 차이와 구분한다. 원본 스냅샷 시각/변경분을 기록하고, 추적이 불가능하면 승인된 짧은 쓰기 정지 구간을 사용한다.
4. DB와 파일 본체의 백업을 먼저 확보하고 합성/허용 표본으로 격리 복원한다. 새 DB 구조만 만든 뒤 백업을 생각하지 않는다.
5. 빈 합성 검증 DB에서 원본 001~007→신축 001→004를 적용해 현재 계약을 확인한다. 002는 읽기 사전 점검, 003은 승인된 초기 학교 연결 작업이며 일반 기능 migration이 아니다. **운영에는 원본 001~007이나 000 초기화를 재실행하지 않는다.** 실제 적용 상태를 조사해 승인된 추가분만 실행한다.
6. 새 기준정보·권한 표→기존 배열/역할의 승인 매핑→새 함수/정책과 호환 출력 대조→기능별 표/FK→legacy 회수 순으로 진행한다. 파일 최소 메타/검증 계약은 수합 제출표보다 선행한다. 교과/학기/학생 선행 표는 해당 설계의 생성 순서를 따른다.
7. SQL 확정본의 내용 지문, 적용 전후 검사, 실행자/시간, 실패 시 중단 지점을 기록한다. 도중 수동 ‘대충 수정’으로 계속 진행하지 않는다. 기존 확정본은 유지하고 후속 번호를 사용한다.

### 9.2 이관 대장과 단일 쓰기 기준

이관은 운영 도메인 권한을 부여하는 표가 아니라 검증된 자료 연결 작업이다. 제안 `workhub_migration_runs`에는 id, school_id, source_kind, source_snapshot_at, source_fingerprint, mapping_version, state(prepared/validated/applied/failed), expected_counts, actual_counts, approved_by, applied_at를 기록한다. 실행행에는 run_id·학교·원본 종류/ID·대상 종류/ID·원본/대상 지문·매핑 상태·오류 코드를 기록한다. 원문을 운영 로그에 복제하지 않는다.

원본 종류별 허용 처리기로 대상의 실제 존재·학교·소유자·상태를 검사한다. 일반 문자열 target_table/target_id를 저장했다는 사실만으로 FK 무결성이나 열람권한을 보장한다고 설명하지 않는다. 확정 도메인 연결에는 각 기능의 typed FK를 사용한다. 같은 원본·판·매핑 버전의 재실행은 중복 0이며 변경된 원본은 새 비교/승인 대상이다.

| 대상 | 매핑 기준 | 반드시 남길 예외 |
|---|---|---|
| 회원→소속 | 기존 user ID+확인된 학교+실제 기간 | 미승인/전출 혼재, 누락 프로필, 겸임, 같은 학교 기간 겹침 |
| 부서/교과/학년 | 학교별 코드/이름의 승인 대응표 | 동명이름, 없는 코드, 임의 배열 문자열, 기간 미확인 |
| 일정·시트 | 안정 원본 ID+마지막 원본/대상 판 | ID 없는 행 연결, 삭제/누락 구별, 양쪽 수정 충돌 |
| 기존 tasks | 원본 소유·배정자·공유 목적 | 개인 업무/협조 요청 분류가 불확실한 행 |
| 대화 | 원본 ID+작성자+소유 학교 | 학교 판정 불가, 첨부 권한 불명. 공통 지식 자동 승격 금지 |
| 제출·파일 | 원본 제출 ID+단위+판+실물 hash/size | replaced/deleted, 실물 없음, 판 순서/완료본 불명 |

자료 종류별 authority를 legacy/시트/site 중 하나로 정한다. 병행 기간은 확인형 가져오기이며 양쪽 자동 덮어쓰기가 아니다. 전환 후 옛 경로의 쓰기를 먼저 제한하고 신규 데이터의 ID·버전·접수·파일 매핑을 유지한다. 미해결 행은 격리해 보여 주고 ‘이관 완료’에 포함하지 않는다.

### 9.3 실물 복원과 되돌림

복구 세트는 같은 기준의 DB, 실제 파일 바이트, object 목록·hash·size, 문서팩/검증자산 버전, 계정 매핑, 적용 SQL/앱 버전, 삭제·권한 회수 원장이다. DB 백업이나 파일 목록만으로 실물 제출본 복원을 완료했다고 보지 않는다. 업로드 중인 파일은 snapshot 경계에서 별도 대조하며 DB 참조만 있고 파일이 없는 건을 검출한다.

복원 환경은 외부 이메일·알림·AI·웹훅을 끄고 접근을 제한한다. 기존 Auth ID와 앱 프로필의 대응을 확인하되 제공자의 관리 Auth 자료/암호화 설정까지 아무 환경에 그대로 복원할 수 있다고 가정하지 않는다. 현재 서비스 조건과 승인된 복구 수단을 검증한다. 파일 실물을 열고 지문을 비교한 뒤 현재 삭제/회수 원장을 재적용한다. 오래된 백업에 있는 전출 회원 권한·철회 파일·파기 원자료를 부활시키지 않는다.

| 실패 시점 | 되돌림 계약 |
|---|---|
| 새 쓰기 전 | 신축 경로를 닫고 기존 기준 유지. 기존 회원/인증/자료를 되돌릴 이유 없음 |
| 새 쓰기 후 UI 오류 | 해당 새 쓰기를 제한하고 신축 자료를 보존한 채 정상 버전 복구 우선 |
| 저장 무결성 의심 | 학교·기능 범위 격리, 원본/receipt/audit/파일 대조, 동일 키로 확인 후 복구 |
| legacy 복귀 필요 | 신규 발생분과 접수·판·파일을 검증한 역이관. 변환 불가 자료는 처리함에 보존. 배포만 되돌려 자료를 숨기지 않음 |
| 한 학교 사고 | 관련 부모/자식·권한·파일을 논리 복구. 다른 학교 운영 DB를 전체 과거 시점으로 덮지 않음 |

자동 영구 삭제·감사/receipt 청소·백업 만료는 자료별 근거와 운영 승인이 정해진 뒤 가동한다. receipt 보관 종료 뒤 오래된 키의 재요청을 새 생성으로 실행하지 않도록 요청 유효기간/최소 tombstone 정책도 함께 확정한다. 근거 없이 보존 연수를 정하지 않는다. 복구 목표 RPO/RTO는 최종 기획의 제안치이며 실물 복원 실측과 학교 허용 손실 범위 승인 전 SLA가 아니다.

## 10. 수용시험과 공개 게이트

이번 문서 작성 중에는 DB/로그인/운영 시험을 실행하지 않았다. 기존 검증 근거는 `PROGRESS.md`, `07-postgres-verification.md`, `09-task-persistence.md`다. 현재 기록상 PGlite 회귀와 PostgreSQL 16 독립 연결 11경쟁을 확인했지만, Supabase Auth·PostgREST·Storage·실제 운영 자료 검증을 대체하지 않는다.

| ID | 시험 | 합격 기준/증거 |
|---|---|---|
| F01 | 계정 보존 | 같은 스냅샷 기준 Auth ID/프로필 ID·기존 값·트리거·FK 차이 0. 정상 신규 가입은 분리 집계. 재가입 0 |
| F02 | 가입 전 예외 | 승인 대기 세션은 최소 학교/본인 신청만 가능. 학교명 검색으로 roster·메일·자료가 나오지 않음. role/active 주입 거부 |
| F03 | 현재 권한 | 익명·미승인·정지·만료·타인 member_id·타학교 object_id의 REST/RPC/파일 요청 모두 거부 |
| F04 | 겸임과 자기 신고 | A 관리자+B교사 권한 분리. profile claim의 교과/부서 변경만으로 audience 자료 접근이 늘지 않음 |
| F05 | 기간 | 첫날/마지막 포함일/다음날 및 새 종료 제외 관계 경계 일치. 중첩 INSERT·기간 수정·동시 활성화 거부 |
| F06 | 작성자 전용 | 같은 학교 관리자·플랫폼 지원자가 private 일정/개인 업무/관찰/상담/대화/미제출 초안을 읽지 못함 |
| F07 | 철회 경합 | 승인/소속/학교/역할 회수가 먼저 잠금을 잡으면 저장·지원 읽기/작업 확정이 거부. 실제 독립 연결과 lock 대기 증거 |
| F08 | 원자성과 중복 | 같은 키 같은 입력 1원본/1버전/1receipt/1감사, 다른 입력 거부. 예상 버전 동시 수정은 1성공+1충돌. 감사 실패 주입은 전체 rollback |
| F09 | 이전 결과 | 소속 종료·visibility 변경 후 receipt/충돌details/ZIP/캐시에서 과거 본문을 다시 받지 못함 |
| F10 | 직접 경로 | 새 API가 막아도 Supabase REST 직접 INSERT/UPDATE/SELECT와 기존 doc-ai URL/Storage가 우회하지 못함 |
| F11 | 지원 | 요청자 확인/학교 승인/유효기간/대상판/행동 중 하나라도 변하면 거부. 요청자가 더 이상 읽지 못하는 자료는 지원도 거부 |
| F12 | 파일 | 타학교 경로·미완료·검사 실패·overwrite·실물 누락 거부. 최종 바이트 재검증. 이미 발급된 URL 한계를 결과에 명시 |
| F13 | 이관 | 동일 원본 재실행 중복 0. 소유자·기간·상태·판·file hash 대조, 수정/취소/삭제 변경분 누락 0. 미매핑 있으면 전환 불가 |
| F14 | 복구 | DB+파일 실물 격리 복원, 개수/지문/열기·권한·receipt 대조. 삭제/회수 재적용, 외부 전송 0 |
| F15 | 앱/DB 호환 | 기존 로그인·문서작성·제출은 보존. v1 context/일정/task 계약 회귀와 신규 페이지 제한 시험. 부분 목록을 전체인 것처럼 표시하지 않음 |
| F16 | 학교별 장애 | A학교 격리·복구 중 B학교 자료/권한 불변. 실패를 전교 0명·미제출 0건으로 표시하지 않음 |

현재 superadmin 제한 검증→승인된 단일 학교 실제 세션 검증→legacy 회수+두 학교 실제 격리→공개 범위 승인 순서다. SQL 확정·실행, 테스트 통과, 운영 공개는 각각 다른 상태로 기록한다. 사용자 목표인 핵심 전체 공개와 필수 무결성/보안/복구 100% 게이트를 낮추지 않는다.

## 11. 기존 결정과의 충돌·남은 승인

| 기존 결정 | 적용/차이 | 처리 |
|---|---|---|
| D2/D3/D17/D18 | 과거 백지 초기화·폐기·첫 회원 승격은 당시 작업의 기록 | 이번은 실사용 회원 보존. 000 reset·일괄 삭제·재가입·역할 초기화 재사용 금지 |
| D6/P2 | TEXT ID, TEXT+CHECK | 유지. 학교 복합 FK 추가는 새 SQL 확정 대상 |
| D7/P3 | 전역 계층·extra_permissions | legacy 유지, 신축 학교별 역할은 추가 제안. 전역 관리자 자동 복제 금지 |
| D8/P4 | 전체 조회/관리자 쓰기 및 RLS 3패턴 | ‘전체’는 허용 학교 안의 공유로 재해석하는 승인 필요. private·대상·기간·지원 예외를 명시한 확장 정책안 |
| D12 | 작성자 개인 기록 | 유지. 관리자·지원·과거 정정·복구에서도 본문 자동 승계 금지 |
| D15/D16 | 보안 헬퍼·권한 열 보호 | 원칙 유지. 새 학교 헬퍼/역할 변경 경로는 승인 뒤 구현 |
| D20 | is_active에 대기/퇴직 이중 의미 | 기존 값 보존. 신청·학교 소속 분리와 서비스 승인 분리의 단계 전환은 제안이며 폐지 확정 아님 |
| P1/P7 | 필요한 표만, 새 번호 SQL·실행 기록 | 문서의 전체 논리 표를 한 번에 생성하지 않음. 기존 확정 SQL 수정 없음 |
| P6/P8 | 파일/메타 분리·공용 Supabase | 유지. 새 연결도 shared 인스턴스를 사용 |

적용 직전 제시할 구체 승인 묶음은 다음과 같다.

1. **DB/권한(AP02):** 실제 인벤토리, 상태 매핑, 가입 예외, 학교 역할/기간/복합 FK, legacy 차단 경로, 회원 보존 전후 대조, 확정 SQL/중단 조건.
2. **업무 정책(AP04):** 작성자 수정·수합 검토/인계·학교 관리자 범위. 아직 미확정인 정책을 SQL로 조용히 확정하지 않는다.
3. **실자료/보존/지원(AP06/AP09):** 자료 분류·정정·전출·지원 대상·권한 회수·파기/백업 잔존 정책. 기간과 법적 적합성을 이 문서가 인증하지 않는다.
4. **환경/전환(AP07/AP08):** 격리 환경·백업 위치/비용·실물 복구·단일 쓰기 기준·쓰기 정지/변경분·역이관·공개 게이트 증거.

이미 승인된 동일 범위를 다시 묻기 위한 목록은 아니다. 현재 요청인 설계 문서 작성은 완료하고, 보호 영역의 실제 변경에 앞서 실행 가능한 SQL·시험·되돌림안을 검토할 자료로 사용한다.

## 12. 근거 파일과 판단해서 정한 것

직접 확인한 근거: `CLAUDE.md` 전체, `docs/DECISIONS.md`, `migrations/001~007` 및 README, `database/workhub/001~004`, `packages/shared/src/auth.js·supabase.js·permissions.js`, 신축 connection/tasks 계약과 어댑터, 기존 doc-ai의 인증/승인 경로, `docs/workhub/03·07·08·09·PROGRESS`, 바탕화면 `GPT작업/업무혁신시스템 기획서.md`의 C01~C12·7~11·15~16절. 원격 운영 상태·최신 법률·서비스 요금은 조회하지 않았다.

- **계정 복제 대신 기존 ID 유지:** 기존 사용자 참조와 로그인 연속성을 보존하기 위해서다. 달라져야 하면 계정 이관 전체 계약을 별도 재검토한다.
- **현재 소속 날짜 표현 보존:** 이미 구현·검증한 포함 종료일을 새 설계와 혼동하지 않기 위해서다. 변환은 명시적 어댑터/후속 SQL에 둔다.
- **학교 역할을 전역 role과 분리:** 새 학교의 관리 권한이 기존 전역 경로로 번지는 것을 막기 위해서다. 변경 대상은 새 역할 표·헬퍼와 legacy 회수 계획이다.
- **새 RLS와 legacy 차단을 별도 게이트:** 같은 DB의 옛 URL·버킷이 남으면 신축 권한만으로 전국 격리가 완성되지 않기 때문이다.
- **최초 백업부터 파일 실물 포함:** DB 행과 제출 파일은 함께 업무 증거다. 복구 계획을 바꾸려면 파일 본체·삭제 원장·권한 복원 시험을 함께 바꾼다.