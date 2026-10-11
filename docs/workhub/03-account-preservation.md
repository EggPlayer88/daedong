# 신축 연결과 기존 회원 보존

이 문서는 적용 전 제안과 로컬 검증 기록이다. 실제 운영 DB·회원·인증 설정은 조회하거나 변경하지 않았다. 기존 회원의 재가입, Auth 사용자 삭제, 프로필 재생성, 기존 역할·승인값 초기화를 하지 않는다.

## 1. 기존 로그인과 회원 ID 보존

기존 Supabase 프로젝트·Google 로그인·공용 인스턴스를 그대로 사용한다. connection은 @daedong/shared의 getSession, fetchMyProfile, onAuthStateChange, signInWithGoogle, signOut, supabase.rpc만 호출한다. 새 createClient나 회원 생성 API가 없다. 실제 신축 화면은 기존 앱의 같은 origin에서 기존 AuthProvider를 통과하는 최고관리자 경로로 연결한다. 별도 개발 서버 origin의 OAuth 설정은 필요하지 않다.

auth.users.id를 문자열로 사용한 public.users.id가 보존 기준이다. 이메일·이름으로 재매칭하지 않는다. public.users.id는 TEXT이며 기존 DDL에 auth.users를 향한 물리 FK가 있는 것은 아니다. 두 ID의 일치를 가입 트리거가 만들어 왔다. 기존 대화·제출물·일정·할 일·부서장 참조는 이 TEXT ID를 사용한다. 새 workhub_memberships.user_id도 public.users(id)를 참조하므로 원본 ID 타입 변경이나 기존 FK 재연결이 필요하지 않다.

003_signup_approval.sql 이후 가입 트리거는 새 프로필을 teacher, is_active=false로 만들고 ON CONFLICT(id) DO NOTHING으로 기존 프로필을 보존한다. 트리거를 교체하거나 기존 사용자에 대해 재발동시키지 않는다. **옛 000_reset_v1_project.sql과 과거 오류 안내의 사용자 삭제·재가입 절차는 이번 신축에 적용하지 않는다.** 현재 AuthContext 안내도 기존 계정의 프로필 연결을 확인하도록 수정했다. 프로필 누락은 기존 Auth ID에 대한 비파괴 보정안을 별도 검토한다.

## 2. 현재 연결의 권한 계약

모든 신규 RPC/RLS는 기존 프로필 is_active IS TRUE, 공개 범위, 현재 학교 소속을 함께 검사한다. workhub_settings.rollout_mode의 기본값 superadmin에서는 기존 role=superadmin만 진입할 수 있다. 요청한 소속의 user_id=auth.uid()::text, active=true, 유효기간을 서버에서 확인한다. 클라이언트가 보내는 소속·학교 ID만으로 권한을 부여하지 않는다.

같은 학교·사용자의 활성 소속 기간은 중첩할 수 없다. INSERT·UPDATE 트리거가 학교·계정별 트랜잭션 advisory lock 후 포함 구간 중첩을 거부한다. 비겹친 미래 소속과 비활성 기록은 보존할 수 있다. 소속의 id·school_id·user_id 변경은 금지하며 새 소속으로 연결한다. 이 트리거는 users나 다른 소속 행을 추가 잠그지 않아 일정 저장의 잠금 순서와 교차시키지 않는다. 실제 다중 연결 경합 검증은 후속 게이트다.

새 teacher/calendar_manager는 학교 소속 역할이다. 기존 role·extra_permissions·department_id·is_active를 덮어쓰지 않는다. 기존 is_active=false에는 승인 대기와 퇴직·전출이 섞여 있으므로 임의 분류·일괄 활성화하지 않는다. 기존 superadmin을 전국 플랫폼 운영자로 자동 승격하지 않는다.

현재 valid_from과 valid_through는 **양 끝 포함 날짜**이며 valid_through는 마지막 유효일이다. 판정일은 서울 기준 statement_timestamp의 날짜다. 최종 전체 설계의 종료 시각 제외 구간과 표현이 다르므로 후속 DB 확정과 API 변환에서 이를 명시적으로 처리해야 한다. 필드의 의미를 몰래 바꾸지 않는다.

context.memberships는 현재 연결 가능한 학교의 대상 선택용 roster다. 이메일은 제외하고 active는 소속 active와 해당 회원의 기존 승인 true를 모두 반영한다. 학교 선택기는 userId가 본인인 유효 소속만 표시한다. 관계 라벨은 학교별 schoolLabels[schoolId] 배열을 사용한다.

## 3. 추가 구조와 저장

[001 제안](../../database/workhub/001-calendar-foundation.proposed.sql)은 새 학교·소속·일정·멱등 접수·감사 테이블과 전용 RPC만 추가한다. 기존 테이블·원본 마이그레이션·인증 트리거·구형 RLS는 변경하지 않는다.

- 조회 RPC: workhub_context, workhub_calendar_list, workhub_calendar_get.
- 저장 RPC: workhub_calendar_save. 현재 회원·소속, 입력, 작성자·담당자 수정 권한과 버전을 확인한다.
- 일정 변경·receipt·감사 기록은 같은 트랜잭션이다. receipt 저장 실패 시 일정도 롤백된다.
- 회원 승인 행과 소속 행을 잠그고 같은 소속 요청을 직렬화한다. 수정 대상 행도 잠근 뒤 버전을 확인한다. 권한 함수는 잠금 후 최신 상태를 읽도록 VOLATILE로 둔다.
- 같은 멱등 키/같은 정규화 입력은 최초 결과를 반환하고 다른 입력은 거부한다. 기존 receipt도 현재 소속과 현재 원본 열람 가능 여부를 다시 검사한다.
- private은 작성 소속만 열람한다. 관리자·담당자 역할은 타인의 private을 열어 주지 않는다. 그룹의 차원은 AND, 그룹 사이는 OR, 직접 제외는 포함·전체보다 우선한다. 작성자는 자기 원본을 볼 수 있다.
- authenticated에는 제한된 SELECT와 RPC 실행만 허용한다. 직접 INSERT/UPDATE/DELETE, receipt·감사 직접 열람, anon RPC 실행은 금지한다.
- 기술적 입력 한도: 요청 256 KiB, 대상 그룹 50개, 그룹 차원당 100개, 직접 포함·제외 각각 1,000개, 멱등 키 200자. 학교 규정 수치가 아닌 요청 방어 한도다.
- 날짜·필드·배열·학교 범위·관계 라벨·일정 응답도 클라이언트에서 검사한다. 계정이 바뀌면 이전 응답을 폐기하고 연결 캐시를 비운다. 동일 UID의 토큰 갱신은 캐시·초안을 유지하면서 승인을 재검증하고, 권한 변화나 조회 실패 때만 폐기한다. subscribeInvalidation은 로그인 변화·현재 계정 조회 실패·서버의 권한/소속 종료 거부를 화면에 즉시 통지한다. UI는 목록·상세·편집 입력을 닫고 명시적 재시도를 제공한다.

기존 문서 API 인증이나 AI 모델·토큰·비용 구조는 수정하지 않는다. 개인 업무·학생·수합의 운영 저장은 이 일정 기반 SQL에 포함하지 않는다.

## 4. 적용 순서와 되돌리기

1. SQL 확정·적용은 기존 역할을 유지한다. Claude Web 검토·확정, 계란님 실행 전까지 .proposed.sql은 제안본이다. 기존 회원 이관·재가입은 필요하지 않다.
2. 백업·복원 절차 확인 후 [읽기 전용 dry-run](../../database/workhub/002-account-preservation-dry-run.sql)으로 회원·승인·역할 집계, 프로필 누락, 고아 참조, 제출 파일 수, 가입 트리거 지문을 보관한다. 출력에는 이름·이메일·토큰·회원 ID가 없다.
3. 복제된 검증 환경에 적용하고 같은 집계를 비교한다. 운영 중 자연 증가를 구분해야 하므로 숫자 일치만으로 보존을 단정하지 않는다. 정밀 행 대조는 권한 있는 환경 안에서 수행하며 개인정보를 채팅에 붙이지 않는다.
4. [초기 소속 연결 제안](../../database/workhub/003-bootstrap-school.proposed.sql)의 기존 승인 superadmin ID·실제 학교·기간을 확인한다. 자리표시자나 빈 기간이면 쓰기 전에 중단한다. 신규 학교·소속만 만들고 기존 회원은 수정하지 않는다. 충돌하는 기존 소속도 덮어쓰지 않는다.
5. 같은 origin에서 기존 로그인으로 진입해 학교 조회·일정 저장·재조회·private·소속 종료를 확인한다. 운영 공개 범위는 기본 superadmin을 유지한다.
6. 실패하면 신축 진입을 닫고 기존 앱을 유지한다. 계정 삭제나 신규 테이블 DROP을 기본 복구 수단으로 삼지 않는다. 이미 저장된 업무·receipt·감사 기록을 보존하고 별도 복구 절차를 따른다.

**타학교 실제 가입·전국 공개는 아직 허용할 단계가 아니다.** 기존 users_select는 승인 사용자에게 전체 프로필을 보여 주고, 구형 관리자·일정·제출·버킷 정책에는 학교 구분이 없다. 새 RLS만으로 구형 REST·Storage·문서 API까지 격리되지 않는다. 공개 확대 전에 기존 경로의 학교 제한·전출 회수·학교 관리자 분리·직접 URL 접근을 별도 승인과 테스트로 완료해야 한다. members 모드는 그 이후 옵션이며 이번 운영 기본값이 아니다.

## 5. 실행 검증과 한계

tests/test_workhub_database.mjs는 PGlite의 실제 PostgreSQL에 원본 001~007 SQL을 읽어 적용한 뒤 신규 제안을 적용한다. 합성 계정만 사용하며 운영 DB에 연결하지 않는다. 회원 값·가입 트리거·기존 RLS 보존, 최고관리자 기본 제한, 익명/미승인/타인 소속 차단, 다학교 격리, private, 대상 조건, 버전 충돌, 멱등·종료 소속·전체 롤백, 기존 신규 가입 동작, 연결 계정 전환 취소를 실행 검증한다.

이 검사는 단일 연결이다. 잠금 문법·트랜잭션 롤백을 실행했지만 **두 독립 연결의 실제 동시 경쟁을 실측한 것은 아니다.** 별도 PostgreSQL/Supabase 검증 환경에서 동시 저장·승인 해제와 저장 경합, PostgREST 오류 변환, 실제 JWT·OAuth·RLS·배포 번들을 확인해야 한다. 원격 회원 수나 실제 운영 데이터 보존을 확인했다고 주장하지 않는다.

후속 PostgreSQL 독립 연결 검증은 [07 검증 문서](07-postgres-verification.md)를 기준으로 확인한다. 위 문단은 PGlite 시험 자체의 한계이며, 실제 Supabase·JWT·OAuth 검증과는 별개다.

보관 기간, 감사·receipt 정리 주기, 전체 백업·복원 성능과 전국 공개 정책은 여기서 확정하지 않는다. 로컬 검사 통과는 실제 DB 적용·설정 변경·회원 권한 변경의 자동 실행이 아니다.
