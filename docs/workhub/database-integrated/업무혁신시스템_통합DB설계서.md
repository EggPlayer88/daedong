# 업무혁신시스템 통합 DB 설계서

2026-10-12 · GPT·Claude 통합 v1.0 · 설계 산출물 / 운영 미적용

## 핵심 결론

기존 인증과 회원을 보존하고, 완성될 사이트 전체의 공통 데이터 구조를 새로 정립한다. Claude의 구체적인 표·열·키를 기본으로 삼고 GPT의 권한·근거·업무 상태·이관·검증 계약을 결합했다. 현재 화면만을 위한 임시 DB를 먼저 만들지 않는다.

목표 구조는 175개 표, 2374개 열이다. 기존 160개 표 중 81개를 명시 보강하고 15개를 추가했다. 청사진의 16개 기능군·24개 API·12개 공통 계약·48개 수용 기준을 연결했으며, 중앙 필수 검증 51건과 도메인별 세부 시험을 정의했다. 이 수치는 구현 범위이며 운영 시험 통과 수가 아니다.

설계를 먼저 확정하는 방향이 적절하다. 다만 전체 화면의 세부 배치까지 기다릴 필요는 없다. 계정·학교·자료 범위·불변판·명령 입출력을 공통 기준으로 확정하고, SQL 배치별 검증과 사이트 어댑터 구현을 나란히 진행한다. 정책 수치와 실제 환경값은 승인 전까지 빈 값으로 유지하며 영향을 받는 기능만 준비 상태로 표시한다.

읽기 안내: [구조도와 표 탐색](overview.html) → 이 설계서 → [전체 열 사전](09-table-dictionary.md) → [SQL 작성 인계서](Claude_SQL작성_인계서.md). 이 합본은 아래 개별 정본에서 생성했다. 수정은 개별 문서/정형 목록에서 하고 생성기를 다시 실행한다.

## 구성

1. [README.md](README.md)
2. [01-foundation-security.md](01-foundation-security.md)
3. [02-workflows-documents.md](02-workflows-documents.md)
4. [03-students-timetable.md](03-students-timetable.md)
5. [04-ai-knowledge-jobs.md](04-ai-knowledge-jobs.md)
6. [05-api-site-contract.md](05-api-site-contract.md)
7. [06-validation-release.md](06-validation-release.md)
8. [07-migration-operations.md](07-migration-operations.md)
9. [08-coverage.md](08-coverage.md)
10. [10-decision-register.md](10-decision-register.md)
11. [11-review-and-verification.md](11-review-and-verification.md)
12. [Claude_SQL작성_인계서.md](Claude_SQL작성_인계서.md)


---

<!-- SOURCE: README.md -->

# 업무혁신시스템 통합 DB 설계

설계안 1.0 · 2026-10-12 · GPT·Claude 통합 · 상태: 구현 기준 제안, 운영 미적용

교사가 사이트에서 업무를 끝까지 처리하는 데 필요한 데이터·권한·기록의 관계를 정한다. 완성될 사이트의 M00~M15 전체를 대상으로 하며, 현재 구현된 화면의 한계에 DB를 맞추지 않는다. 기존 로그인·회원은 보존한다.

**목표는 “100점”이라는 자체 선언이 아니라, 구현자가 다르게 해석할 틈과 운영에서 잘못 연결될 여지를 최대한 없애는 것이다.** 설계 완성과 실제 DB 적용·운영 검증을 분리한다. 아래 계약을 만족하는 SQL과 화면 시험이 확보돼야 DB 확정·공개로 넘어간다.

## 먼저 읽을 내용

- [통합 설계서 합본](업무혁신시스템_통합DB설계서.md): 핵심 결론과 모든 상세 명세.
- [전체 구조도·테이블 탐색기](overview.html): 업무 흐름 3종, 12개 영역, 표·열 검색.
- [Claude SQL 작성 인계서](Claude_SQL작성_인계서.md): 재사용 기준과 SQL·사이트 연결 순서.

| 독자 | 문서 | 판단할 내용 |
|---|---|---|
| 사용자 | 이 문서, 구조도, 10-decision-register.md | 사이트가 어떻게 연결되고 무엇을 보존하는가 |
| SQL 작성자 | 01~04, 07, 09-table-dictionary.md, schema-contract.json | 표·열·키·권한·상태·잠금·이관 |
| 사이트 구현자 | 05-api-site-contract.md, 08-coverage.md | 화면의 읽기/쓰기 계약과 실제 연결 순서 |
| 검토자 | 06-validation-release.md, validation-result.json | 반례, 범위 누락, 확정 조건 |

원본 Claude 160표를 가능한 한 재사용하고, 기존 GPT의 엄격한 업무 규칙을 보강한다. 이름만 바꾸거나 같은 데이터를 다른 원장에 이중으로 저장하지 않는다. 최종 표 수와 전체 열 목록은 생성된 사전과 schema-contract.json이 제공한다.

## 교사가 경험할 여섯 연결

1. 로그인 → 승인된 학교 → 내 담당 → 오늘 홈. 학교 전환 시 조회·초안·AI 문맥을 함께 전환한다.
2. 학교 일정 등록 → 관련 교사의 홈 추천 → 준비 작업. 추천이 권한이나 의무를 자동 생성하지 않는다.
3. 문서팩·작년 자료 → 확인 질문 → 새 문서판 → 파일 검사 → 수합 제출 → 접수·검토·보완.
4. 수업 앱 활동 → 교사 확인 받은함 → 정확한 학생 연결판 → 관찰·평가 → 생기부 문장 근거 → 검토·출력.
5. 업무 인계 → 후임의 정확한 목록 수락 → 효력일에 원자 적용 → 진행 중 의무의 책임만 이동.
6. 시간표 입력·조건판 → 후보 검증 → 배포 → 교체·동의·확정 → 실제 수업 실시. 편성 결과와 실시 결과를 구분한다.

## 구조의 중심 결정

| 선택 | 이번 통합안 |
|---|---|
| 저장소 | 하나의 PostgreSQL/Supabase 프로젝트에서 다학교 논리 격리. 실제 운영 환경은 적용 전 확인 |
| 스키마 | workhub는 제한된 읽기/명령 API, workhub_private는 비공개 판정·작업·운영 함수 |
| 기존 회원 | auth.users와 기존 Google 로그인 유지. accounts의 auth_user_id UNIQUE FK와 명시적 legacy 연결 |
| 자료 범위 | school, account_private, common을 명시. service는 글로벌 운영 작업의 범위이며 교사 자료의 공개 분류가 아님 |
| 소유와 담당 | 계정은 사람의 연속성, membership은 해당 학교 재직/소속 기간, assignment는 승인된 담당 |
| 변경 | 현재 머리행의 version과 불변 revision을 구분. 제출·채택·근거·정책판은 정확한 판을 고정 |
| 관계 | 같은 학교/같은 부모/같은 작성자를 복합 FK나 동등한 제약으로 검사. 학교 ID만 같다고 유효한 참조는 아님 |
| 개인 정보 | 관리자에게 개인 초안·관찰·상담·AI 대화의 자동 열람권을 주지 않음 |
| AI | Claude를 전제로 한 실행·출처·도구 확인 계약. 공급자 호출로 DB 권한을 우회하지 않음 |
| 쓰기 | 브라우저 직접 DML 금지. 인증된 명령 경로가 권한·기대판·멱등·업무 전이를 한 트랜잭션에서 확정 |
| 긴 작업 | 실행 주체·요청자·시도·외부 호출을 분리. 결과 불명확은 자동 재시도와 구별 |
| 홈 | 별도 사실 원장을 만들지 않음. 권한을 통과한 원본과 명확한 상태를 조합 |
| 시간표 | 완성 사이트의 DB 접점까지 포함. 사용자가 보류한 알고리즘 구현·운영 적용은 재개하지 않음 |

## 공통 데이터 계약

- 내부 엔터티 ID는 서버가 생성하는 불투명 text 식별자를 유지한다. auth_user_id는 Auth UUID다. 외부 ID·학번·이름·이메일을 기본키로 쓰지 않는다. 기존 ID를 새로 발급해야 한다면 명시 매핑을 보존한다.
- 순간은 timestamptz/UTC로 저장하고 학교 timezone으로 표시한다. 학적·학년도 등 날짜는 date, 모든 새 기간은 [from,to)로 통일한다. 기존 inclusive 종료일은 “다음 날 exclusive”로 변환하며 timestamp에 하루를 무조건 더하지 않는다.
- current_version은 수정 충돌 검사, revision_no는 불변 본문판이다. 해시만 저장하고 당시 입력을 버리지 않는다. 문항·학생·원자료·루브릭·정책의 정확한 판을 함께 참조한다.
- JSONB는 답변·팩별 입력·외부 원문의 제한된 가변 구조에 사용한다. 권한 주체·부모 관계·원본판·학생 연결·책임·필수 상태는 정형 열과 FK로 다룬다.
- NOT NULL과 CHECK를 함께 설계한다. NULL 비교가 필수값 검사를 대신하지 않는다. 다중 행 조건은 UNIQUE/EXCLUDE/FK/트리거와 공통 명령으로 구분해 강제한다.
- 복합 FK의 일부가 NULL이면 검사에서 빠질 수 있는 관계는 XOR/필수값 조건으로 닫는다. school_id를 NULL로 바꿔 공통 자료로 승격할 수 없다.
- 삭제는 사용자 숨김, 사용 차단, 실제 파기, 파기 증거를 구분한다. 불변 자료의 파기는 일반 수정 권한과 별도의 승인된 서비스 경로다.
- 파일·검색색인·요약·이력 사본도 원본의 현재 권한과 파기 상태를 따른다. “이미 생성된 사본”은 권한 예외가 아니다.
- 실제 학생 원문·개인 대화·키·토큰은 로그/오류/일반 감사 내용에 넣지 않는다. 감사에는 식별자·행동·판·지문·결과 코드가 기본이다.

## 전체 연결도

~~~mermaid
flowchart TB
  AUTH["기존 Google 로그인 · auth.users"] --> ACCOUNT["accounts · 계정 연속성"]
  ACCOUNT --> MEMBER["memberships · 학교 소속 기간"]
  MEMBER --> DUTY["승인 역할 · 업무 · 수업 담당"]
  DUTY --> HOME["오늘 · 원본을 조합한 대시보드"]
  EVENT["학교/개인 일정 · 학사일정"] --> HOME
  COL["수합 단위 · 접수판 · 검토"] --> HOME
  LESSON["배포 시간표 · 실제 수업"] --> HOME
  TASK["개인 할 일 · 협조 요청"] --> HOME
  KNOW["규정 · 시행판 · 확인된 근거"] --> AI["Claude 비서 · 출처 · 도구 확인"]
  DUTY --> AI
  AI --> DOC["문서팩 · 초안판 · 검사"]
  DOC --> FILE["파일 실물 · 지문 · 현재 권한"]
  FILE --> COL
  APP["디지털윤리 등 수업 앱 원자료"] --> MAP["교사 확인 · 학생 연결판"]
  MAP --> OBS["관찰 · 평가 확정판"]
  OBS --> RECORD["문장별 근거 · 생기부 초안"]
  RECORD --> REVIEW["교사 검토 · 최신 근거 재검사"]
  REVIEW --> EXPORT["출력 기록 · 공식 입력 확인은 별도"]
  AI --> RECORD
  GATE["학교/소유/담당 권한 · 불변판 · 멱등 · 감사"] --- HOME
  GATE --- AI
  GATE --- REVIEW
~~~

## 전체 모델과 단계 구축

전체 구조를 먼저 정하고, 배치는 기반 → 업무 → 학생 → 지식/AI → 종단 검증 순서로 나눈다. 배치가 작다고 최종 기능을 빼지 않는다. 신규 메뉴 공개 기본값은 superadmin을 유지한다. 데이터 모델 완성도와 사용자에게 공개한 기능 수는 별개다.

전국 사용을 특정 테이블 수나 빠른 단건 조회로 증명하지 않는다. 학교별 분리, 큰 학교와 작은 학교, 다중 소속, 학년 전환, 권한 회수, 실패 후 복구를 시험하고 부하 측정 결과에 따라 인덱스·캐시·분할을 조정한다. 처음부터 학교별 스키마를 복제하거나 모든 표를 파티션으로 나누지 않는다.

## 정본과 변경 규칙

이 통합 폴더가 새 목표 설계의 기준이다. 이전 GPT 문서와 Claude DDL은 출처이며 충돌 시 통합 계약을 우선한다. source-baseline.json은 수정 전 원본의 증거이고 실행할 최종 DB 설계가 아니다. schema-contract.json은 원본 열과 명시적 변경을 합친 설계 카탈로그이며 SQL 마이그레이션이 아니다.

Claude Web이 이 계약에 맞는 확정 SQL과 실제 PostgreSQL 시험을 작성하고, Codex가 화면·어댑터·회귀를 연결하며, 사용자가 기존 절차에 따라 SQL을 적용한다. 기존 migrations·인증·보호 자산·DECISIONS.md는 이 문서 작성으로 변경하지 않았다.

확정 전 비어 있어야 하는 값은 보존기간·학교 규정 수치·모델/비용 승인값·실제 외부 서비스 설정이다. 해당 값의 저장 구조와 미정 처리 흐름까지 정해 두므로, 나머지 사이트 구현을 멈출 이유는 없다.

## 설계 산출물 재생성

Node.js에서 `node validate-design.cjs` 후 `node build-delivery.cjs`를 실행한다. 외부 패키지·네트워크·실제 DB 연결은 필요하지 않다. 표/열·연결의 형식과 청사진 추적 검사는 SQL의 보안·동시성 시험을 대신하지 않는다. 정형 변경 목록과 개별 문서를 수정하고 생성 결과를 갱신한다. source-baseline.json은 원본 증거이므로 변경하지 않는다.


---

<!-- SOURCE: 01-foundation-security.md -->

# 01. 계정·학교·권한의 통합 기반

> 2026-10-12 통합 설계안. 실제 DB·인증·RLS·확정 SQL을 변경하지 않았다. SQL 확정은 Claude Web, 검증·운영 실행은 계란님이 맡는다. 최종 사이트 기획의 C01~C12, 기존 회원 보존 요구, Claude 160표 초안, GPT 전환 계약 및 독립 비교검토 R01/R03을 결합한다. 아래 ‘채택’은 이번 설계의 권고 결정이며 기존 D번호나 운영 승인이 자동 변경됐다는 뜻이 아니다.

## 1. 채택할 구조와 자료의 권위

`workhub`에 업무 표와 제한된 공개 RPC, `workhub_private`에 내부 판정·실행 함수를 둔다. 기존 `auth.users`, Google 로그인, Auth UID, `public.users`, 기존 가입·보호 트리거는 보존한다. `workhub.accounts`는 새 로그인 계정을 만드는 표가 아니라 기존 Auth 주체와 신축 자료를 연결하는 앱 계정이다. 이름·이메일로 자동 연결하지 않는다.

첫 운영 배치는 기존 단일 학교와 제한된 관리자 범위에서 시작한다. 여러 학교를 지원하는 키와 정책은 처음부터 가지지만, 두 번째 실제 학교의 승인 계정을 연결하기 전에 public·기존 문서 API·Storage·직접 URL의 legacy 회수 시험을 통과해야 한다. 스키마 이름과 메뉴 숨김만으로 격리 완료를 주장하지 않는다.

신규 모듈은 기존 규칙대로 superadmin 기본 공개 범위를 유지한다. school_features와 pilot 명단은 메뉴·라우트뿐 아니라 해당 RPC·직접 읽기 경로·파일·작업 진입점에도 적용하며 기존 rollout 제한과 AND로 결합한다. 공통 service_switches의 쓰기/AI/전송 중지와 학교별 중지는 어느 한쪽이 중지하면 거부한다. 가입·읽기전용 진단·이미 발생한 접수 상태 확인처럼 필요한 예외는 명시된 경로만 허용하며 일반 쓰기 우회로 쓰지 않는다.

| 범위 | 저장·요청의 필수 맥락 | 허용되는 연결 |
|---|---|---|
| `school` | `school_id`, 현재 회원·행동 권한 또는 승인된 학교 서비스 주체 | 같은 학교의 원본·소속·파일. 명시적 공통 지식/팩 참조만 예외 |
| `account_private` | `owner_account_id`, 서비스 이용자격, 본인 | 학교 파일·학생·학교 근거 연결 금지. 학교 자료를 개인 공간으로 자동 승격하지 않음 |
| `common` | 공통 자료임을 명시, 게시/수정에는 플랫폼 행동별 권한 | 확인된 공통 규정·양식·서비스 정책. 학교의 비공개 자료 참조 금지 |
| `service` | 글로벌 운영 작업, 서비스 주체, 승인된 목적·자원 목록 | 복구 검증 등 운영 메타데이터. 학교 내용을 전부 읽는 포괄 공개 범위가 아님 |

scope key는 DB 생성값 `s:<school_id>`, `a:<owner_account_id>`, `c`, `svc`로 통일한다. 학교 삭제·색인은 `scope=school + service_principal`이며 `service`로 바꿔 학교 제약을 없애지 않는다. 개별 표는 필요한 scope만 허용한다. `school_id IS NULL`을 공통·개인·서비스 판정으로 사용하지 않는다.

ID는 기존 Claude 설계의 TEXT를 계승한다. Auth FK만 UUID다. 도메인 학교 관계는 `UNIQUE(school_id,id)`와 같은 두 열 FK, 공통/개인 혼합 관계는 `UNIQUE(scope_key,id)`와 `MATCH FULL` scope FK를 쓴다. 선택 참조의 scope/id는 둘 다 NULL 또는 둘 다 존재해야 한다. 참조 삭제 기본은 RESTRICT/NO ACTION이며 계정·학교 CASCADE로 업무 증거를 지우지 않는다.

## 2. 회원 보존과 legacy bridge

| 표 | 주요 계약 | 추가·변경 |
|---|---|---|
| `accounts` | `id` PK, `auth_user_id` UNIQUE NOT NULL FK Auth RESTRICT, `legacy_user_id` UNIQUE, 연결 방법/시각/이관실행, 표시 이름, 상태·version | `permission_version`, `legacy_approval_state(not_legacy/approved/hold)` 추가. 최초 승인된 연결 뒤 Auth/legacy 식별자 불변 |
| `account_settings` | 본인 설정·last_school_id | 마지막 학교는 권한이 아니다. 종료 학교를 선호값에 저장했다고 업무 접근을 열지 않음 |
| `memberships` | 계정 한 명의 학교별 소속·신청 | 기존 pending/active/suspended/left/rejected와 신청 메타데이터 재사용. 별도 중복 신청표를 만들지 않음 |

`auth_user_id`와 `accounts.id`를 동일 ID라고 가정하지 않는다. 구 API의 userId는 Auth/public ID, 신축 accountId는 앱 ID다. bridge 어댑터는 현재 Auth UID로 계정을 찾아 각각의 DTO를 명시적으로 변환한다. 클라이언트가 보낸 accountId로 로그인 주체를 대체하지 않는다.

**초기 bridge의 보수적 결정:** B00의 기존 사용자 집합을 기준으로 `is_active IS TRUE`가 확인된 기존 회원은 approved, false·의미 미확인·연결 불일치는 hold로 기록한다. hold는 가입/연결 확인용 최소 화면만 허용하고 학교 업무·개인 AI·파일 생성은 차단한다. 학교 가입 승인으로 hold를 자동 해제하지 않는다. 기존 대기와 퇴직이 한 값에 섞여 있으므로 분류·해제는 확인된 운영 절차로 처리한다. 가입 시각이나 이메일 도메인으로 추정하지 않는다.

전환 후 새 Auth 주체의 `not_legacy` 지정은 승인된 이관 기준시점과 신규 가입 경로로 입증한다. 사용자 인자·미존재 legacy 행만으로 지정하지 않는다. 신규 계정은 로그인→학교 신청→학교 승인 흐름을 사용할 수 있으며 별도 계정 생성/Google 재가입을 요구하지 않는다. 순수 개인 기능은 승인된 소속 이력 또는 별도 승인된 개인 이용자격과 기능/비용 게이트가 있어야 한다.

기존 전역 승인 체계가 권위인 병행 단계에는 approved 표식만 믿지 않고 현재 legacy `is_active IS TRUE`도 검사한다. 이 결합을 끊는 것은 07의 계정 권위 전환·legacy 접근 회수와 같은 승인 배치다. 전환 후에는 `accounts.status`가 신축 계정 차단의 권위이며 `public.users`는 신축 역할을 덮지 못한다. 이 두 단계는 배포 설정과 이관 증거에 명시하고 일부 API만 먼저 다르게 동작시키지 않는다.

## 3. 학교·소속·관계의 시간 계약

`schools`의 상태는 preparing/active/suspended/closed를 유지하고 `permission_version`을 추가한다. 일반 업무는 active 학교만 허용한다. preparing 학교는 플랫폼 초기 설정과 명시된 합성 시험 경로만 사용한다. school_level·지원 상태·grade_count·region·timezone은 등록된 학교 설정이다. ‘설계됨’과 현장 검증됨을 구분한다.

소속·역할·담임·부서·교과·수강 관계는 DATE의 시작 포함·종료 제외 `[valid_from, valid_to)`를 정본으로 쓴다. 현재 기준일은 학교 timezone으로 계산한다. 기존 신축 `valid_through`는 마지막 유효일이므로 이관/어댑터에서 +1일 하여 변환하며 기존 API 값을 몰래 재해석하지 않는다. 즉시 권한 회수는 상태/회수시각 변경으로 처리한다. 같은 날의 가입 승인과 취소를 표현할 때 기간 CHECK를 피하려고 과거 사실을 조작하지 않는다. 아직 효력이 시작되지 않은 승인은 취소/거절 처리하고, 시작된 관계의 철회는 상태와 시각을 함께 기록한다.

`memberships`에는 `(school_id,id,account_id)` UNIQUE를 보강한다. 작성 당시 소속과 계정을 함께 보존해야 하는 학교 개인자료는 이 복합 키로 묶는다. 같은 학교/계정의 승인 기간은 active/suspended/left를 포함해 중첩 금지, pending은 별도 조건부 UNIQUE로 한 건이다. 겸임은 서로 다른 학교 소속이다. 복귀는 새 소속 ID이며 과거 행의 작성 소속을 바꾸지 않는다. 본인 관찰·상담·평가·생기부 초안 및 본인 학교 개인 할 일·문서·일정은 **같은 account + 같은 학교의 현재 활성 소속 + 허용된 보존 상태**이면 과거 본인 자료를 읽을 수 있다. 전출·퇴직으로 해당 학교 소속이 없는 동안은 차단한다. 이 권한으로 새 학급 명부나 다른 교사의 기록을 읽지 못한다. 과거 학년도 정정은 원래 학교·대상·목적·기간과 정책상 필요한 승인을 따로 검사한다.

AI conversation/message/memory는 origin_membership에 고정해 재임용으로 자동 열람·재사용하지 않는다. 필요한 과거 본인 근거를 새 대화에서 선택할 때는 학생·문서 원본의 현재 허용 범위로 다시 검사한다. 수합 초안·제출·업무 의무는 현재 유효한 단위/담당 관계를 적용한다. 계정 소유, 작성 당시 소속, 현재 행동 자격을 하나의 member ID equality로 합치지 않는다.

역할 기간은 해당 소속 기간 안이어야 하고 실제 사용 시 계정·학교·소속·역할의 상태와 기간을 모두 검사한다. 미래 소속/구성원은 오늘의 초안이나 대상 명단에 들어오지 않는다. 본인 신고 `profile_claims`는 권한 자료가 아니며 승인된 `assignments`·관계표만 audience/명부에 사용한다. 권한을 넓히는 INSERT뿐 아니라 기간 변경·소속/역할 UPDATE와 관련 부모 UPDATE도 같은 무결성 검사를 한다.

주요 조회 인덱스는 memberships(account_id,status,school_id), memberships(school_id,status,valid_from,valid_to), membership_roles(school_id,membership_id,valid_from,valid_to) revoked NULL, assignments(school_id,membership_id,kind,valid_from,valid_to)다. 기간 중첩은 GiST exclusion 또는 독립 연결에서 동등성을 입증한 직렬화로 보장한다.

## 4. 학교 권한과 플랫폼·서비스 권한

학교 역할은 기존 `role_catalog`, `role_permissions`, `membership_roles`를 재사용한다. 교사·부서·학년 범위를 명시하고 학교 전체 범위로 확대 해석하지 않는다. `member_has_perm`류 함수는 계정 active, 학교 active, 소속 active/현재 기간, 역할 현재 기간·scope를 빠짐없이 검사한다. 학교 관리자에게 타인 private 자료 읽기 권한을 상속시키지 않는다. 최초 학교 관리자 지정과 마지막 관리자 회수는 별도 운영 경로·감사·경합 검사를 요구한다.

`service_operators`는 운영자 등록으로 유지한다. level=operator/support가 학교 본문 열람권이나 공통 게시권을 모두 뜻하지 않도록 다음 최소 표를 추가한다.

| 신규 표 | 필드·키 | 실행 조건 |
|---|---|---|
| `operator_grants` | id, account_id FK service_operators, permission_code, valid_from/valid_to TIMESTAMPTZ, approved_by_account_id, approval_ref, approved_at, revoked_at, version | 등록된 행동만 허용. school.bootstrap/common.publish/common.index/support.execute/policy.manage/service.manage/operations.restore/operations.migrate. 계정·운영자·grant 모두 현재 유효. 같은 계정/행동의 미회수 기간 중첩 금지 |
| `service_principal_scopes` | id, service_principal_id FK, scope_type(school/common/service), school_id?, 생성 scope_key, valid_from/valid_to TIMESTAMPTZ, approved_by_account_id, approved_at, approval_ref, revoked_at, version | scope와 school의 일치, 동일 principal/scope 기간 중첩 금지. 계정 개인 범위의 포괄 서비스 grant는 만들지 않음 |

기존 `service_principals`의 active/allowed_actions/approval_ref에 permission_version·승인자·승인시각을 추가한다. **서비스 허가 = 현재 활성 주체 AND 등록된 작업 종류가 allowed_actions에 포함 AND 정확한 scope의 현재 승인 grant AND 서비스/학교 스위치 허용**이다. ‘owner_account_id가 NULL이면 허용’은 금지한다. 실행자 문자열이나 임대 토큰이 서비스 신원을 대신하지 않는다. DB 실행 역할과 principal의 연결은 승인된 서버 배포 allowlist에서 고정하며 브라우저가 principal ID를 선택하지 못한다.

B01의 공통 주체 해석기는 검증된 사람 인증 또는 서버 DB 실행 identity에서 실제 actor를 파생한다. `write_audit(context)`의 context는 이 해석기가 만든 검증 결과이며 공개 함수 인자·클라이언트 GUC·worker_id 문자열·승인자가 적은 actor ID를 그대로 신뢰하지 않는다. bootstrap/migration도 현재 허용된 service principal과 scope로 기록하고 NULL actor 예외를 만들지 않는다. 최초 승인된 주체 시드와 기존 운영 함수 전환 순서는 07의 B01 계약을 따른다.

학교 업무 요청을 수행하는 worker는 원래 사람의 현재 자료 권한도 검사한다. 독립 보존·복구 작업은 사람 퇴직에 종속시키지 않고 승인 서비스 principal을 사용한다. 그 경우에도 대상 scope/목록/정책/hold를 확인한다. claim·재개·본문 재조회·외부 전송 직전·확정에서 반복 검사한다. 작업 상태/lease 계약은 04가 정본이다.

## 5. 적용일을 보존하는 정책

기존 `policy_catalog`와 `school_policies`를 유지하되, school_policies는 현재 학교값의 호환 투영이다. 미래 정책을 여기에 먼저 덮어쓰지 않는다. 신규 `policy_versions`가 정확한 시행판의 정본이다.

필드: id TEXT PK, scope(common/school), school_id?, 생성 scope_key, policy_key FK catalog, policy_version INT, applies_to_scopes TEXT[], value JSONB, state(draft/published/retired), effective_from/effective_to DATE `[)`, approved_by_account_id?, approved_by_membership_id?, approved_at?, approval_ref?, created_at. UNIQUE(scope_key,id), UNIQUE(scope_key,policy_key,policy_version), 학교 승인자는 `(school_id,member_id,account_id)` 복합 FK로 같은 사람을 보장한다. published/retired는 approved_by_account_id·approved_at·approval_ref가 필수다. approved_by_membership_id는 school 판에서만 필수이며 common 판에서는 반드시 NULL이다. 게시된 value·시작일·범위·적용대상은 불변이다. 종료일을 줄여 다음판을 게시하는 원자적 교체 외에는 과거 적용 구간을 임의 수정하지 않는다. published/retired의 유효 구간은 같은 scope/key에서 겹치지 않는다.

common 정책은 현재 operator_grants.policy.manage, school 정책은 현재 학교 policy.manage 권한과 catalog의 허용 범위를 필요로 한다. 계정 개인 자료의 안전·비용 정책은 common 판을 적용하며 계정별 완화판을 게시하지 않는다. applies_to_scopes는 적용 대상일 뿐 읽기 권한이 아니다. 학교가 공통 보안·자료보호 하한을 완화하지 못한다. 각 정책 키의 검사와 합성 규칙은 서버 registry에 고정하고 임의 JSON/SQL을 실행하지 않는다.

파일 안전 등 여러 정책이 함께 적용되면 적용한 모든 `(scope_key,policy_version_id)`를 명시적으로 고정한다. 단순히 가장 큰 version이나 최근 updated_at 한 개를 고르지 않는다. 수합/문서/파일의 확정판은 이 키와 지문을 보존한다. 보존기간·지원기한·외부 한도 미정이면 관련 기능만 POLICY_UNSET으로 차단하며 전체 사이트 사용 불가나 임의 기본값 승인으로 바꾸지 않는다.

## 6. 읽기 정책 행렬과 개정 사본 R01

모든 허용은 서비스 자격·학교 상태·현재 소속/기간·행동·원본 상태를 전제한다. public REST와 RPC에서 같은 결과가 나와야 한다.

| 자료 | 본인/정상 관계자 | 학교 관리자 | 플랫폼/지원 |
|---|---|---|---|
| 본인 프로필·신청 | 로그인 주체의 최소 정보 | 같은 학교 승인 업무에 필요한 최소 필드 | 승인된 연결/운영 메타만 |
| 공유 일정·전달사항·수합 | 현재 원본 visibility/audience/단위 권한 | 해당 관리 권한의 공개 범위만 | 제한된 지원 세션의 공유 자료만 |
| private 일정·학교 개인업무·본인 문서 | 같은 계정+같은 학교의 현재 활성 소속+보존 상태. 재임용 시 본인 과거 자료 읽기 허용 | 타인 본문 불가 | 불가 |
| 학생 관찰·상담·개인 대화·미제출 초안 | 해당 작성자/명시 공동작성자 계약 | 본문 기본 열람 불가 | 지원 대상으로도 등록 불가 |
| `object_revisions.snapshot` | 원본 종류별 현재 열람권을 검사한 RPC | audit.read만으로 본문 불가 | 지원 원본의 허용판만 |
| 감사·작업 현황 | 본인에게 필요한 최소 상태 | 해당 학교 최소 운영 메타 | 목적별 제한 메타; 비밀·본문 없음 |
| 공통 지식·팩 | 게시 상태·이용자격에 맞는 판 | 학교 역할로 공통 수정 불가 | 행동별 플랫폼 grant로 관리 |
| 파일·미리보기·ZIP | 정확한 연결 원본의 현재권한+검증된 실물 | 관리자 우회 없음 | 지원 세션의 허용 공유 파일만 |

**R01 차단:** object_revisions의 원문을 가진 표 전체 SELECT는 authenticated에서 회수한다. 감사용 RPC는 ID·판·변경종류·시각·최소 행위자만 반환한다. 본문은 `object_revision_read(school_id,type,id,version)`가 등록된 유형별 처리기로 원본과 요청판의 현재 권한을 검사한 뒤 반환한다. 사용자 입력 type으로 동적 SQL 표를 선택하지 않는다. 권한을 확인할 원본이 사라졌거나 파기/차단됐으면 거부한다. 공개 범위가 바뀌면 과거 사본도 자동 공개되지 않는다. 학년/부서 역할 범위도 원본 판정과 동일하다. 검색·변경 비교·지원·export가 이 RPC를 우회하지 않는다.

감사와 개정 사본은 목적이 다르다. 감사에 원문을 복사하지 않으며, 개정 사본은 보존·파기 대상 원본의 종속 자료로 취급한다. ‘불변’은 일반 수정 금지를 뜻하며 승인된 비식별/파기 절차까지 영구 금지한다는 뜻이 아니다.

## 7. 지원 세션과 학교 전환

기존 support_sessions를 재사용한다. 요청자 확인+학교 승인+현재 support.execute grant+지정 운영자+목적+정확한 원본/판+행동+기한+미회수를 모두 요구한다. `target_version`, `scope_sha256`를 추가하고 확인 뒤 대상/판/기간/행동은 불변, 변경 시 새 세션으로 다시 확인한다. 초기 배치는 view_meta만 제공한다. view_content는 각 원본 처리기와 음성시험이 함께 배포된 공유 자료 유형만 연다. retry_job은 별도 지원 쓰기 계약이 검증되기 전 비활성이다.

지원 읽기마다 요청자도 현재 그 공유 원본을 읽을 수 있는지 확인한다. 학교 승인자가 본문을 못 읽더라도 승인 메타데이터만 처리할 수 있으며 그 승인이 새로운 본문 열람권을 만들지 않는다. 원본 private 전환, 요청자 전출, 운영자 grant 회수, 기한 만료 중 하나면 즉시 서버 거부다. 감사 actor는 실제 운영자이며 요청자 소속을 운영자의 소속으로 기록하지 않는다.

학교 전환 시 서버 요청은 명시적 school/member에 고정한다. cache 키에는 계정·학교·소속·권한판·원본판을 넣고 이전 요청 generation을 폐기한다. 명시적 화면 이동은 미저장 초안을 안내하지만 권한 회수·로그아웃을 편집 잠금으로 막지 않는다. 아직 권한이 있는 초안은 원래 학교에만 남기며 새 학교로 복사하지 않는다. 종료된 학교의 응답이 늦게 오면 UI에 반영하지 않는다.

## 8. 명령·직렬화·DB 실행 역할

공개 쓰기는 등록된 cmd_*만, 브라우저 직접 DML은 0이다. 공통 입력은 현재 세션, scope/member, 명령 schemaVersion, requestKey, expectedVersion과 정규화 입력이다. 생성은 기대판 대신 unique/idempotency를 사용한다. 모든 필수 인자의 NULL·형식·길이를 먼저 검사하며 SQL CHECK의 UNKNOWN을 성공 근거로 삼지 않는다.

로그인 주체를 찾는 `me()`와 업무 이용자격 판정을 분리한다. me()가 계정 ID를 돌려줬다는 사실만으로 legacy hold·계정 정지·개인 이용자격을 통과시키지 않는다. RLS가 부르는 my_membership/학교목록/개인공간 helper와 보안 정의자 RPC·파일·worker의 사람 대행 gate는 같은 현재 이용자격 함수를 적용한다. 가입 예외는 유효 Auth 세션으로 본인 최소 정보를 다루는 별도 경로이며 일반 RLS에서 OR 예외로 확장하지 않는다.

정본 잠금 순서는 **관련 accounts/서비스 principal ID 정렬 → schools·service_switches·operator/service scope grants → memberships ID 정렬 → membership_roles·정책 → 멱등 advisory key → 필요한 근거 owner gate → 원본 종류/ID 정렬 → files → receipt/audit/outbox INSERT**다. 권한 읽기는 FOR SHARE 등 실제로 상태 UPDATE와 충돌하는 잠금, 회수는 UPDATE/FOR UPDATE를 쓴다. FOR KEY SHARE만으로 non-key 상태 회수를 막았다고 하지 않는다. 선택 조건으로 행이 아직 없을 수 있는 권한 부여/새 원본은 해당 부모 gate와 advisory key를 잠근 뒤 재조회한다. 명령·운영 함수·worker·파기·인계가 같은 순서를 따른다.

잠금 뒤 현재권한 재검사→현재 원본 열람 확인→같은 키 접수증 검사→기대판→업무 제약→원본+판+접수증+최소 감사+outbox 같은 트랜잭션 순서다. 권한 회수 후 오래된 접수증으로 본문을 받지 못한다. 실패/0행은 성공이 아니다. 오류는 AUTH_REQUIRED/SCOPE_DENIED/VALIDATION_FAILED/VERSION_CONFLICT/IDEMPOTENCY_CONFLICT/POLICY_UNSET이며 구 어댑터의 기존 코드로는 명시적으로 변환한다.

| 경로 | 핵심 입력·결과 | 추가 불변 조건 |
|---|---|---|
| ensure_account / membership_request | 현재 UID, 최소 표시값·초대/학교 → 계정/신청 ID | role·active·계정 ID를 입력으로 받지 않음 |
| decide_membership / change_role | 대상 소속·결정·기간·기대판 → 새 소속/권한판 | 자기 승격 금지, 마지막 관리자·기간·현재 승인자 재검사 |
| end_membership / revoke_role | 대상·시각·사유·기대판 → 회수 결과 | 인계 대기 때문에 회수 지연 금지, 원장+무효화 사건 동시 기록 |
| publish_policy | 정확한 정책판·기간·승인 → 게시판 ID | 소급 덮어쓰기·기간 중첩·안전 하한 완화 금지 |
| object_revision_read | 원본 유형/ID/판 → 허용 본문 또는 거부 | audit.read는 본문 허가증이 아님 |
| support_read | 세션·대상판·행동 → 최소 DTO | 매번 요청자+지원자 현재권한 교집합 |

함수는 빈/고정 search_path와 schema 한정 객체명, 최소 owner, 명시적 서명별 EXECUTE allowlist를 쓴다. workhub_private는 Data API에 노출하지 않는다. 인증용 claim 하나를 장기 권한 캐시로 믿지 않는다. authenticated/anon/PUBLIC 및 상속·기본 privilege를 실제로 점검한다. service_role·table owner·DBA는 RLS 밖이므로 사용자 요청 처리의 기본 실행 역할로 쓰지 않는다. worker 전용 역할에는 필요한 함수 EXECUTE만 주고 표 DML·역할 생성·임의 SQL은 주지 않는다. 실제 역할 생성·외부 설정은 확정 SQL/배포 승인 대상이다.

## 9. 기반 수용시험

| ID | 시험 | 통과 조건 |
|---|---|---|
| FS01 | 기존 Auth/프로필·연결 보존 | UID/기존 값/트리거 변화 0, 재가입 0, 잘못된 이메일 연결 0 |
| FS02 | pending/hold/정지/새 계정 | 최소 신청만 허용, 본인 입력으로 hold·역할 해제 불가 |
| FS03 | A/B 학교·겸임·타인 member | URL/RPC/FK/직접 SELECT 모두 학교/본인 일치 |
| FS04 | 미래·만료·오늘 경계·재임용 | `[)` 경계 정확, 기존 포함 종료일 변환. 본인 기록·할 일/문서/일정은 같은 학교 복귀 후 허용, 타인·새 명부·이전 AI 대화/기억의 자동 접근 0 |
| FS05 | 관리자·감사·지원으로 private 접근 | 원본·사본·검색·conflict·파일·ZIP에 원문 0 |
| FS06 | R01 협조 요청 사본 | 관계없는 audit.read 관리자에게 원본0/본문사본0, 허용 메타만 |
| FS07 | 회수 선행 잠금 | 독립 연결에서 실제 대기 확인 후 저장·지원 읽기·worker 확정 거부 |
| FS08 | 같은 키·다른 입력·같은 expectedVersion | 1원본/1접수, 다른 입력 충돌, 1수정+1충돌, 감사 실패 전체 rollback |
| FS09 | 서비스 inactive/허용 action 밖/다른 scope | claim·재개·확정·출력 모두 거부, owner NULL 우회 0 |
| FS10 | 정책 미래판·NULL 승인·학교 완화 | 현재판 유지, 미확정 기능 차단, 과거 적용판 불변 |
| FS11 | 지원 확인 후 원본 private/전출/기간 변경 | 기존 세션·발급·캐시로 추가 본문 읽기 불가 |
| FS12 | 실제 PostgREST/Storage/worker 역할 | 표 권한·함수 EXECUTE·내부 스키마·우회키 비노출 확인 |

기존 762개 합성 시험은 회귀 기준으로 유지하고, 비교보고서 반례는 차단을 기대하는 시험으로 뒤집어 추가한다. 단일 세션 PGlite 통과와 실제 PostgreSQL 독립 연결·Supabase·브라우저·실물 파일 검증은 서로 다른 증거다.


---

<!-- SOURCE: 02-workflows-documents.md -->

# 업무·일정·수합·파일·문서 통합 DB 설계 v1

작성일: 2026-10-12. **실행 가능한 명세를 목표로 한 통합 설계 제안이다. SQL 확정본·마이그레이션·사용자 정책 승인·운영 적용 결과가 아니다.** 원본 Claude 최종 7개, GPT 기존 설계, 운영 코드와 확정 자산은 변경하지 않는다. SQL 확정은 Claude Web, 실행은 사용자라는 저장소 규칙을 따른다.

## 1. 기준과 선택한 해법

기준은 최종 `GPT작업/업무혁신시스템 기획서.md`의 M01~M05·M08 및 C02~C10, 기존 GPT DB02, Claude DB구조설계 최상위 최종본, 2026-10-12 비교 검토의 R02·R07~R10이다. Claude의 `workhub`·`workhub_private`, 기존 160개 표와 실행 가능한 제약을 기본으로 보존한다. 기존 공개 `public.workhub_*` RPC는 승인된 전환 어댑터가 준비되기 전까지 제거하지 않는다. 로그인·회원 보존 계약과 공통 실행/receipt/권한 게이트는 01·04의 정본을 따른다.

이 장의 변경 열·제약·인덱스·읽기 정책은 동반 `workflows-changes.json`에 담는다. `alter`의 누락 열은 기존 정의 유지이며, `drop_columns`는 최종 목표 스키마에서 제거할 중복 열이다. 실제 이관 때는 추가→백필→동등성 검사→읽기 전환→구 writer 폐쇄 뒤 별도 승인으로 제거한다. 원본 DDL을 덮어쓰라는 뜻이 아니다. 모든 신설 ID는 TEXT UUID 문자열, 학교 표는 `(school_id,id)` 유일키와 학교 복합 FK, 삭제는 기본 RESTRICT다. 아래 NN은 NOT NULL, ?는 NULL 허용이다.

선택한 원칙은 다음과 같다.

1. **안내 열람·결과 열람·제출 의무·홈 추천은 별도 축이다.** 학교 전체에 수합 안내를 공개해도 제출 답변을 자동 공개하지 않는다.
2. 답변 JSONB를 유지한다. 문항·선택지 정의는 `collection_schemas`의 불변 판에 묶고, JSON 객체의 키/형식/필수값/범위를 DB 검증 함수가 검사한다. 답변마다 EAV 행을 만들지 않는다. 파일은 기존 `submission_files`와 초안의 목적 고정 파일 연결을 사용한다.
3. 기존 제출·문서·일정 revision과 현재/완료 포인터를 유지한다. 형식이 다른 과거판을 현재 문항 정의로 해석하지 않는다.
4. 업무 책임 이전은 개인 메모·문서 소유권 이전이 아니다. 인계는 같은 학교의 허용된 관계만 하나의 트랜잭션으로 적용한다.
5. 파일의 실물 검사, 악성 검사, 내용 추출은 별도 상태다. 미검사는 `not_scanned`로 표시한다. 승인 정책이 없으면 민감한 제출·공유·다운로드·AI 입력에 사용하지 않는다.
6. 홈은 원본별 권한 있는 조회를 조합한다. 별도의 ‘오늘 업무 원장’이나 수동 수합 완료 행을 만들지 않는다.

## 2. 공통 명령·잠금·오류 계약

공개 쓰기는 전용 `workhub.cmd_*`만 사용하고 authenticated 직접 DML은 허용하지 않는다. 모든 명령은 명시 학교/소속, 명령 종류, `expected_version`, `request_key`를 받는다. actor 계정은 현재 인증에서 얻고 입력 계정 ID를 신뢰하지 않는다. 현재 계정·학교·소속·행동 권한을 잠금 후 다시 검사한다.

정본 순서는 **관련 accounts ID 정렬 → 학교/서비스 gate → memberships ID 정렬 → 역할·정책 행 → actor/scope/operation/request_key 멱등 잠금 → 필요한 근거 owner gate → 업무 원본(종류·ID 정렬) → file_objects ID 정렬 → receipt/audit/outbox INSERT**다. 권한 조회 FOR SHARE와 회수 FOR UPDATE가 실제로 충돌하게 한다. 같은 계열은 handover→collection→unit→schema→draft→submission→correction→file 순서로 잡는다. 인계와 단독 제출·검토·철회도 같은 순서를 사용한다. 다수 원본을 다룰 때 전체 잠금 목록을 먼저 정렬하며 반복문 안에서 새 잠금을 역순으로 추가하지 않는다.

한 명령은 원본 변경+파생 포인터+접수증+감사+outbox를 같은 트랜잭션으로 확정한다. 실패하면 모두 0건이다. 외부 푸시/ZIP/AI는 커밋 뒤 작업이며 실패해도 이미 접수한 제출을 취소하지 않는다. 동일 키/동일 정규화 본문은 같은 원본 ID, 동일 키/다른 본문은 IDEMPOTENCY_CONFLICT다. 재전송에도 현재 원본 읽기 권한을 검사하고 receipt에 저장한 과거 본문을 그대로 반환하지 않는다.

공통 오류는 AUTH_REQUIRED, SCOPE_DENIED, VALIDATION_FAILED, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, POLICY_UNSET을 유지한다. 업무 코드는 FIELD_SCHEMA_MISMATCH, REQUIRED_ANSWER_MISSING, SELF_REVIEW_FORBIDDEN, CORRECTION_WINDOW_REQUIRED, SUBMISSION_POINTER_INVALID, FILE_POLICY_BLOCKED, STALE_HANDOVER, IMPORT_BASELINE_STALE을 추가한다. 응답은 `{status,resource:{type,id,version},receipt,asOf}`이며 오류를 빈 결과/저장 성공으로 바꾸지 않는다. 충돌 current는 현재 읽기 가능한 교사용 DTO만 반환한다.

`object_revisions` 원문은 authenticated 직접 SELECT를 회수한다. 원본 유형별 현재 권한을 검사하는 RPC로만 과거판을 읽고 audit.read는 ID·판·시각·변경종류 DTO만 얻는다. 협조 요청·수합·문서의 과거 사본에서 원본 권한을 우회하지 않는다.

## 3. 일정·관련 대상·공식 확정판

`events`, `event_revisions`, `audience_*`, `calendar_days`, `calendar_day_grade_overrides`를 유지한다. 일반 공유 일정은 활성 교사가 생성하고 작성자 또는 공유 일정 관리 권한자가 수정·취소한다. 공식 확정은 school_admin/calendar_official 권한이 맡는다. private는 조건이 all이어도 작성자 외 읽기를 열지 않는다. 담당자는 책임 표시이며 그 자체가 수정·전체 열람 권한은 아니다.

관련 대상은 group 간 OR, 서로 다른 차원 AND, 같은 차원 값 OR, 직접 포함, 제외 우선이다. 승인된 기간별 관계만 사용한다. 미래 일정의 추천 기준일은 시작일, 진행 중은 현재일, 과거 조회는 명시 조회 기준일이다. 읽기는 요청 시각의 학교/소속/ACL을 따로 검사한다. 등록 화면은 ‘읽을 사람’과 ‘홈에 추천할 사람’을 따로 미리 보여 준다. 수합 게시 단위는 이 동적 추천과 달리 snapshot이다.

`events.official_effective_revision_no integer?`를 추가하고 `(scope_key,id,official_effective_revision_no) → event_revisions(scope_key,event_id,revision_no)` 지연 FK를 둔다. 공식 최신 편집안은 events/current_revision, 공식 효력은 이 포인터다. 일반 교사용 목록·학사 계산은 확정 포인터가 가리키는 날짜/본문을 사용한다. 작성자·공식 담당자는 현재안과 효력판을 함께 읽는다. 확정 전 처음 만든 공식안은 일반 교사에게 표시하지 않는다. 공식 일정의 날짜를 편집하면서 이전 효력판이 유지되는지 읽기 API까지 회귀한다.

`cmd_save_event`는 현재안만 갱신하며 공식 효력은 바꾸지 않는다. `cmd_confirm_official`은 학교 gate와 행사/해당 날짜를 잠근 뒤 현재판을 재검증하고 새 official_confirm revision·효력 포인터·calendar_days·담당자 표시·outbox를 한 번에 변경한다. `cmd_withdraw_official`은 사유와 영향 미리보기를 요구하고 별도 철회 revision 후 효력 포인터를 비운다. 취소/휴지통은 구별한다. official 일정의 직접 일반 save·삭제가 효력판을 우회해 바꾸지 못한다.

`calendar_days.source_event_revision_no`와 `calendar_day_grade_overrides.source_event_revision_no`를 추가하여 근거를 정확한 확정판에 묶는다. 두 표 모두 source_event_id/판번호의 동시 NULL 검사와 `(school_id,source_event_id,source_event_revision_no)` 복합 FK를 둔다. 날짜는 소속 학년도 범위 안, 해당 학년 예외도 같은 날짜 부모를 사용한다. 이미 확정한 문서의 계산값은 과거 근거판을 유지하고 자동 덮어쓰지 않는다. 반복 일정 고급 편집과 시간표 실행은 이 장의 신규 범위가 아니다.

조회 인덱스는 기존 기간 인덱스에 `(school_id,start_date,end_date,id)`·`(school_id,responsible_membership_id,start_date,id)`를 보강한다. 읽기 가능한 일정 ID 집합을 먼저 구하고 기간 겹침 `end_date >= from AND start_date <= to`를 적용한다. 제한/정렬 cursor를 사용하며 역할별 count도 같은 ACL이다. 검색어로 타인 private의 존재 여부를 추론할 수 없다.

## 4. 시트 병행·3방향 대조·기준 전환

`source_connections/mappings/records`, `import_runs/rows/candidates`를 유지한다. 안정 external_key는 원본 ID열 또는 최초 사람 확인 매핑이다. 행번호·제목·내용 hash는 영구 ID가 아니다. ID 없는 행의 변경은 후보를 사람에게 확인받는다. 원본 ID열 쓰기는 원본 담당의 명시 동의가 있어야 한다.

신설 `source_record_snapshots`는 I,S, source_record_id NN, mapping_version NN, source_revision?, normalized JSONB NN, source_sha256 NN, captured_at NN이다. INSERT 후 불변이며 정확한 connection/record/mapping을 복합 FK로 고정한다. source_records에는 `last_source_snapshot_id?`를 추가하고 기존 last_source_snapshot/hash는 해당 판의 호환 projection으로만 갱신한다. 마지막 대상 event revision도 정확한 event와 묶는다.

각 import_rows에는 **incoming_snapshot_id, baseline_source_snapshot_id, baseline_target_revision_no, expected_source_record_version, expected_target_version, result_target_revision_no**를 고정한다. 이벤트용 행은 target_event_id도 학교 복합 FK로 가진다. 다른 도메인 import는 그 도메인의 별도 typed resolver를 사용하며 일정을 학생 import처럼 해석하지 않는다. 같은 run의 같은 source_record/안정 external_key는 한 번만 나타난다. source 기준판과 target 기준판은 함께 존재하거나 신규 행에서 함께 NULL이다. baseline은 미리보기 생성 후 불변이다.

비교는 직전 원본 O0·직전 반영 사이트 T0·들어온 원본 O1·현재 사이트 T1의 필드별 정규화 결과로 한다. 원본만 바뀌면 source_only, 사이트만 바뀌면 site_only, 양쪽이 같은 값으로 바뀌면 no_change, 서로 다른 값이면 conflict다. mapping 판이 달라지면 이전 미리보기를 적용하지 않는다. raw 원문에는 필요한 파일/원본 참조만 유지하고 외부 키·비밀 자격을 넣지 않는다.

`cmd_import_preview`는 파일 지문·매핑판·입력 중복·각 baseline·기대판·해결 선택의 manifest 지문을 반환한다. `cmd_import_apply`는 source/record/event 순서의 공통 잠금을 잡고 그 지문과 기대판·현재 권한·쓰기 기준을 다시 검사한다. 바뀌면 IMPORT_BASELINE_STALE이며 서버가 최신 값을 덮어쓰지 않는다. 각 행은 독립된 원자 적용과 `operation/importRun/rowId` 멱등 키를 사용한다. 다른 행 실패는 partial로 표시하고 실패 행만 재시도한다. 한 행의 event/revision/source baseline/result receipt는 전부 성공하거나 전부 실패한다.

site_authoritative 전환은 관리자에게 대조 요약·미해결 0·원본 담당 확인을 보여 준 뒤 연결 기대판/검토 run 지문을 잠그고 기록한다. 모든 구 import 경로도 기준 위치를 검사한다. 전환 직전 만들어진 미리보기의 take_source는 전환 후 거부한다. 파일에서 빠진 행은 missing_in_source일 뿐 삭제가 아니다. 연결의 쓰기 기준을 source로 되돌리는 것은 새 대조·승인 사건이며 과거 cutover를 지우지 않는다.

## 5. 개인 업무·협조·업무 페이지

`tasks`의 5상태(todo/doing/waiting/done/cancelled), 계정+scope, 원본 중복 키를 유지한다. 제목·메모는 유니코드 코드포인트 한도, 날짜는 실제 달력 검사, trim은 서버/클라이언트 동일 규칙을 사용한다. 기존 DTO 120/2000을 받는 어댑터는 조용히 200/5000으로 확대하지 않고 API 판별 규칙을 명시한다.

직접/AI 개인 준비 업무만 본인이 체크·취소·재개한다. 수합/보완/공지 확인/인계 등 원본 의무형 task가 존재하더라도 **표시 projection**이며 완료 진실은 원본이다. read RPC는 원본 상태를 재계산해 반환하고 worker 지연 시 task.status를 믿지 않는다. `completed_by_ref`는 source_type별 실제 완료 사건을 DB resolver가 검증한다. 관리자 또는 AI가 개인 체크를 수합 접수로 바꾸지 못한다.

task의 owner_account_id와 private note는 생성 뒤 소유권 불변이다. 일정 담당 변경 시 기존 담당자의 원본 연결 카드를 종료하고 새 담당자에게 같은 원본의 새 카드를 만든다. 개인 메모·개인 진행상태는 넘기지 않는다. 현재 담당 카드의 유일 인덱스는 기존 것을 유지하며 두 변경은 같은 트랜잭션이다. 이전 담당이 다시 맡으면 본인 기존 카드의 재사용 여부를 명시하고 메모는 그 본인에게만 남는다. 인계 미리보기에도 개인 note를 넣지 않는다.

협조 요청 상태는 requested→accepted/declined/substitute_proposed/cancelled, accepted→completed/cancelled이다. 요청자는 작성/취소, 수신자는 수락/거절/대체 제안/완료를 한다. 대체자 제안은 자동 배정이 아니며 follow_up_of를 가진 새 요청과 그 사람의 수락이 필요하다. 수락·linked_task 생성·응답판·receipt/outbox는 원자 처리한다. task의 scope/school/owner가 수신자와 정확히 일치해야 한다. 요청자는 공유 요청 상태만 읽고 수신자의 개인 메모를 읽지 않는다. 과거 object_revisions도 동일하다.

업무 페이지는 duties/assignments의 승인된 duty_id를 기준으로 events.duty_id, collections.duty_id, documents.duty_id, cooperation_requests.duty_id를 연결한다. 규정은 지식 장의 명시 업무 링크를 사용한다. 제목 유사도는 후보 표시일 뿐 자동 권한·연결이 아니다. 페이지 목록은 객체마다 현재 ACL을 적용하므로 업무 담당이라는 이유로 미제출 초안·학생 기록이 섞이지 않는다.

## 6. 수합 안내·결과·의무·문항판

collections의 `visibility/view_audience_set_id`를 최종적으로 `request_visibility/request_audience_set_id`로 대체한다. 값은 school/audience/participants다. **`result_visibility`는 participants가 기본이며** audience/school은 제출 정보의 성격과 영향 목록을 명시 확인한 관리 명령에서만 설정한다. `result_audience_set_id`는 결과 audience일 때만 존재한다. result 공개로 얻는 것은 완료본의 허용 답변/첨부이며 초안·과거 철회판·검토 의견·보완 내역은 아니다. 별도 `results_published_by_membership_id/at`와 승인 receipt를 보존한다. 제목/안내 공개를 변경한다고 결과 공개 필드를 자동 갱신하지 않는다.

당사자는 요청 관리자(현재 관리 범위), 현재 유효한 단위 구성원, 현재 지정 검토자다. 관리자 역할만으로 당사자가 되지 않는다. 미제출 초안은 personal이면 작성자, shared이면 현재 유효한 공동 구성원만 읽는다. 관리자/검토자에게 존재 여부·건수·첨부명도 반환하지 않는다.

신설 `collection_schemas`: I,S; collection_id TEXT NN, schema_version INTEGER NN, state TEXT NN=draft(draft/published/retired), review_mode NN(none/required), self_review NN=forbid(forbid/allow_with_note), title NN, instructions?, definition_sha256?, created_by_membership_id NN, created_at NN, published_at?, policy_scope_key?/policy_version_id?이다. 정책은 정본 `workhub.policy_versions(scope_key,id)` MATCH FULL FK이며 본교 `collection.submission` 정책판을 고정한다. published에는 승인·유효한 정책판이 필수다. `(school_id,collection_id,schema_version)`와 `(school_id,collection_id,id)` 유일. 게시 뒤 정의·검토정책·지문 불변, retired는 신규 적용만 막고 과거판 해석을 유지한다.

collection_fields에 schema_id를 추가하고 `(school,collection,schema_id,schema_version)`를 collection_schemas의 정확한 부모에 묶는다. draft schema의 문항만 편집할 수 있고 published/retired schema의 문항 INSERT/UPDATE/DELETE 모두 거부한다. options JSON은 `{key,label}` 배열로 유지하되 key 중복·빈값·종류 외 options·잘못된 한도·숫자 NaN/Infinity를 DB 검증 함수가 거부한다. publish 시 정렬된 문항·옵션·정책의 canonical hash를 계산한다. hash는 동등성 증거이며 권한이 아니다.

collections.current_schema_id와 units.active_schema_id는 같은 collection의 published schema를 가리킨다. 기존 schema_version 열은 서버 projection이며 별도 writer가 없다. 모드/문항 변경은 새 schema를 만들고 영향 단위·누락 답변·기존 검토 대기/보완을 미리 보여 준다. pending 제출 또는 열린 보완이 있는 단위의 모드 변경은 처리 후 적용하도록 거부한다. 과거 submission.review_mode_snapshot은 바꾸지 않는다.

게시 명령은 collection/schema 기대판, 대상 목록 지문, 현재 승인 관계와 활성 소속을 검사하고 units와 members를 한 번 만든다. unit_key는 기준 ID의 정규 조합 또는 서버 발급 custom 키다. 사람 이름/부서명 변경으로 의무가 늘지 않는다. 공유 3인 한 단위는 의무 1개, 책임자 1인이 두 단위를 맡으면 의무 2개다. 게시 뒤 동적 대상 변화로 의무를 자동 재생성하지 않는다. 단위 추가/면제/취소/인계는 명시 명령이다.

## 7. 기간별 공동작성·초안·JSON 답변 검증

collection_unit_members에 valid_until?와 created_at을 추가한다. 읽기/쓰기 공통식은 **소속 승인·현재 유효 + valid_from <= statement_timestamp() + (valid_until IS NULL OR now < valid_until) + removed_at IS NULL**이다. removed_at은 실제 회수 시각이며 미래 종료 예약으로 쓰지 않는다. 미래 구성원도 시작 전에 취소할 수 있도록 기존 removed_at>=valid_from CHECK는 제거하고 created_at보다 이르지 않도록 검사한다. 예약 종료는 valid_until이다. 같은 단위/사람/역할의 유효 기간 중첩과 책임자 기간 중첩은 EXCLUDE로 막는다. 미래 기간·회수는 권한판/복원 원장에 반영한다. 책임 공백은 needs_owner로 표시하며 전임 소속을 연장하지 않는다.

unit_drafts에는 collection_id/schema_id를 추가하고 `(school,unit,collection)`·`(school,collection,schema)` 복합 FK를 둔다. unit/draft_kind/owner/schema는 불변이다. 공유 유일키는 `(unit_id,schema_id)`, 개인은 `(unit_id,schema_id,owner_account_id)`다. 새 문항판에는 새 draft ID를 만들고 허용 답변/파일만 명시 변환한다. 기존 초안의 schema_id를 바꾸지 않는다.

`validate_collection_answers(schema_id, answers, phase)`는 다음을 DB에서 검사한다. phase=draft에서는 필수 누락을 허용하고, submit에서는 필수값을 강제한다.

- JSON 최상위는 object. 정의되지 않은 key 거부. 정의된 key의 null은 미입력이며 빈 문자열/빈 배열의 필수 의미를 종류별로 고정한다.
- boolean은 실제 JSON boolean, number는 유한 numeric(문자열 숫자 불가), date는 YYYY-MM-DD의 실제 날짜, short_text는 문자열·문항 코드포인트 한도다. 숫자 0은 유효하고 NULL과 구별한다.
- single_choice는 옵션 key 하나, multi_choice는 중복 없는 옵션 key 배열이며 그 schema에 존재하는 값만 허용한다.
- file 답변 JSON에는 클라이언트 경로나 서명 URL을 넣지 않는다. 정확한 문항 key와 검증된 typed 파일관계에서 서버가 표시용 manifest를 만든다. 필수 파일 수·크기·형식·policy는 실제 관계를 기준으로 확인한다.

서버와 DB는 같은 canonical 형식의 시험 fixture를 공유한다. JSON Schema 라이브러리를 쓴다는 이유만으로 DB 핵심 검사나 학교/단위 FK를 생략하지 않는다. 초안 버전 충돌은 최신판을 반환하되 내 입력은 UI에서 보존하며 자동 병합/덮어쓰기를 하지 않는다.

## 8. 제출판·자기검토·모드별 포인터

submission_versions에 collection_id, schema_id, source_draft_id/version, submitted_by_account_id, responsible_membership_id_snapshot, responsible_account_id_snapshot, review_mode_snapshot, due_kind_snapshot(date/time), receipt_xid를 추가한다. source draft는 `(school,draft,unit,schema)` 복합 FK이며 submission도 unit/schema/collection이 일치한다. 실제 제출 계정은 submitted_by_membership_id의 계정과 일치해야 한다. 당시 책임자도 같은 방식으로 고정한다. 제출·대리 이력은 인계 후 바꾸지 않는다.

접수 시각은 잠금·검사 이후 서버 `clock_timestamp()`로 정한다. 날짜 마감은 학교 시간대의 다음 날 00:00을 저장하고 `receipt_at >= due_at`이면 지연, 시각 마감은 `receipt_at > due_at`이면 지연이다. due_kind와 당시 마감을 제출판에 고정한다. 클라이언트 시각은 접수/지연 근거가 아니다.

제출은 활성 책임자 또는 유효 delegate만 가능하다. 공동작성자는 초안 편집만 가능하다. 공유초안만 공동 제출하며 개인초안은 작성자 확인 후 명시 복사한다. cmd_submit은 현재 schema·unit/draft 기대판·필수값·마감/창·첨부를 검사한 뒤 제출판/파일 snapshot/current/effective/최초 제출/보완 충족/receipt/audit/outbox를 한 번에 확정한다. first_submission_id를 추가해 최초 시각·지연 projection의 실제 근거를 남긴다.

검토는 현재 지정 검토자가 현재 pending 제출판에 한 번만 한다. 검토자의 **account_id를 실제 제출자와 당시 책임자 account snapshot 및 현재 책임자 계정**에 대조한다. 인계·재임용으로 membership ID가 달라져도 자기검토 금지가 유지된다. allow_with_note는 승인된 schema 정책이 있어야 하며 공백 아닌 사유가 필요하다. 학교 관리자라는 이유로 지정 검토자를 우회하지 않는다. review는 불변이고 제출 review_state를 같은 트랜잭션에서 반영한다.

| 사건 | current | effective | 불변 조건 |
|---|---|---|---|
| none v1 제출 | v1 | v1 | not_required; 가짜 승인행 없음 |
| none v2 정정 | v2 | v2 | 사유/이전판/창 검사; 외부 처리 상태 승계 없음 |
| none 현재판 철회 | NULL | NULL | v1 자동 부활 금지 |
| required 첫 제출 | v1 | NULL | pending |
| required v1 승인 | v1 | v1 | 다른 지정 검토자 |
| required v2 제출/보완 | v2 | v1 | 완료 합계는 v1 |
| required 미승인 v2 철회 | 가장 최근 유효 이전판 또는 NULL | 기존 완료본 | 남은 보완 의무는 유지 |
| required v2 승인 | v2 | v2 | v1 역사 보존 |

DB 지연 제약은 포인터가 같은 unit의 유효 제출인지, effective가 accepted/not_required인지, none 활성 current=effective인지, 최초 포인터가 바뀌지 않는지 검사한다. 어떤 판을 자동 복원할지는 명령의 명시 전이로만 정한다. required의 accepted 또는 user_confirmed 판은 직접 철회 금지다. exported는 단순 내보낸 기록이며 공식 처리 확인과 구별하고 그 사실만으로 user_confirmed로 승격하지 않는다. pending/changes_requested인 최신 미승인판 및 none의 현재판은 마감 전·공식 처리 전 책임자/대리가 사유와 함께 철회할 수 있다. 마감 후나 closed 요청은 해당 단위의 withdrawal/both 창이 있어야 한다. 정책 미승인 환경에서는 이런 전이를 공개하지 않는다.

## 9. 보완·연체·면제와 보완 철회의 원자성

correction_requests는 대상판·검토판·기한·사유를 불변으로 보존한다. 기한 변경은 이전 요청 취소+supersedes_request_id를 가진 새 요청이다. 같은 단위 열린 요청 1개를 유지한다. 제출자는 어떤 correction_request를 충족하는지 명시하고, 무관한 제출이 전체 보완을 자동 충족시키지 않는다.

신설 `collection_correction_fulfillments`: I,S; request_id/unit_id/submission_id NN, fulfilled_at NN, due_kind_snapshot NN, due_at_snapshot NN, late NN, invalidated_at?, invalidation_reason?(submission_withdrawn/request_cancelled), invalidated_by_membership_id?다. 같은 단위 복합 FK, `(request_id,submission_id)` 유일, invalidated_at IS NULL인 request당 1개다. 충족 본문은 불변이며 무효 메타만 한 번 채울 수 있다.

요청의 fulfilled_by/at/late는 이 active fulfillment의 projection이다. `cmd_withdraw_submission`이 보완 제출판을 철회하면 **submission 상태·current/effective·fulfillment 무효·request의 fulfilled 포인터 해제·state=open·연체 projection·receipt/outbox**를 같은 트랜잭션에서 바꾼다. 요청이 이미 cancelled면 open으로 되살리지 않는다. 미승인 보완요청판 자체를 철회해 effective v1으로 돌아가더라도 열린 요청을 자동 취소하지 않는다. 더 이상 요구하지 않을 때는 관리자의 명시 취소가 필요하다.

집계는 세 축을 따로 반환한다: 최초 제출 지연(불변 first판), 현재 미제출 연체(현재마감 초과이고 current 없음), 미충족 보완 기한 초과(활성 fulfillment 없음). 면제/취소는 제출판 삭제가 아니며 분모·독촉에서 제외한다. 책임 공백도 운영 의무 합계에서는 누락시키지 않고 needs_owner로 분리한다. 숫자 합계는 현재 ACL로 허용된 unit의 effective판을 각각 한 번만 더하며 numeric 정밀도를 유지한다. NULL은 제외, 0은 포함한다.

## 10. 인계 수락·대상 고정·원자 적용

handovers/items를 유지한다. `handover_acceptances`를 신설하여 후임 membership/account, handover_id, manifest_version, items_sha256, effective_on, accepted_at을 불변 기록한다. handovers는 current_acceptance_id를 가리키고 기존 accepted_*는 그 projection이다. 수락 이후 항목·원본 기대판·후임·적용일이 바뀌면 manifest_version을 증가시키고 stale 처리, 현재 수락 포인터를 비운다. 과거 수락행은 지우지 않는다.

applied이면 current_acceptance_id/accepted_at/accepted_hash/items_hash/applied_at/applied_by가 전부 NN이고 수락한 후임·manifest_version·지문·적용일이 현재값과 같아야 한다. NULL 비교로 CHECK를 우회하지 못한다. 기존 handover_items.id를 유지하고 `target_key JSONB`에 대상의 정확한 복합 PK를 보존한다. 단일 ID 대상은 `{id}`만, reviewer는 `{collection_id,membership_id,added_at}`만 받으며 다른 키는 거부한다. object_type/object_id는 단순 문자열 ACL이 아니며 종류별 정해진 resolver가 같은 학교·실제 부모·기대판·변경 가능 필드를 INSERT와 적용 때 검사한다. 지원하지 않는 종류는 거부한다. version 열이 없는 관계는 target_fingerprint로 정확한 PK·기간·권한 내용을 고정하고 적용 때 대조한다.

초기 지원은 승인 배정·역할·수합 책임/검토자·수업 담당·업무 자료 관리/시트 연결 담당이다. source 개인 task·private note·개인 준비초안·학생 기록·대화·문서 소유권은 제외한다. 수합 공동초안은 후임의 공동 구성원 편입을 인계 manifest에서 명시 수락한 경우만 접근을 연다. 문서의 owner_account_id를 후임으로 바꾸는 편법은 허용하지 않는다. task 항목은 공식 원본 책임 변경에 따른 카드 종료/생성으로 변환하고 개인 task 자체를 이전하지 않는다.

cmd_handover_preview는 대상별 원본 기대판·허용 field delta·진행 의무/제외 항목·효력일을 계산한다. accept는 후임 본인만 현재 manifest를 수락한다. apply는 인계관리 권한자가 학교 시간대의 적용일 이후 실행하며 모든 관련 계정/소속/권한/원본/파일 잠금을 먼저 확보한다. 후임 활성·전임/후임 관계·모든 기대판을 다시 확인하고 하나라도 불일치하면 STALE_HANDOVER로 **전체 0건**이다. 성공 시 단위 ID·제출판·완료본을 유지한 채 책임/기간/권한판/카드/outbox/receipt를 원자 변경한다.

동시에 진행 중인 다른 인계가 같은 대상에 접근하지 못하도록 대상 정렬 advisory lock과 활성 item claim을 검사한다. 기존 `(handover_id,object_type,object_id)` 유일성은 `(handover_id,manifest_version,object_type,target_key)`로 교체하여 같은 대상의 새 미리보기판을 보존한다. claim은 진행 중인 인계의 현재 manifest_version만 사용하며 과거판이 대상을 계속 점유하지 않는다. 초안 인계의 재활성화/상태 변경에도 재검사한다. 적용 완료 후 재실행은 같은 결과를 반환한다. 수락 지연은 전임의 접근 종료를 늦추지 않는다. 전임 종료 후 담당 공백은 needs_owner, 후임이 종료되면 적용 중단 후 재지정이다.

## 11. 파일 실물·검사 정책·현재 다운로드 권한

기존 file_objects의 scope_key, 검증 후 path/hash/bytes/mime 불변, derived_from, state, extract_state를 유지한다. 새 파일은 항상 새 object ID와 서버 생성 경로다. init→업로드→실물 크기/형식/hash/압축 확장 검사→verified→ready의 증거를 서버 작업자가 만든다. 요청의 claimed 값을 검증된 값으로 복사하지 않는다. DB metadata의 ready만으로 Storage 실물이 존재한다고 주장하지 않는다.

scan_state는 pending/clean/rejected/error/not_scanned를 유지한다. file_objects에 safety_policy_scope_key?/safety_policy_version_id?, common_safety_policy_scope_key?/common_safety_policy_version_id?, sensitivity NN, verified_by_service_id?를 추가한다. clean은 실제 검사 성공만 뜻한다. 정책 정본은 `workhub.policy_versions(scope_key,id)`이며 각 쌍을 MATCH FULL 복합 FK로 고정한다. 학교 파일은 해당 학교의 file.safety 판과 scope_key='c'인 공통 하한 판을 **모두** 고정한다. common·account_private 파일은 applies_to_scopes에 해당 범위를 허용한 공통 판을 두 정책 쌍에 동일하게 기록한다. NULL school_id로 정책 FK를 건너뛰지 않는다. 개인 이용자가 정책을 완화할 수 없다. 승인 전 not_scanned는 개인 업로더의 안전한 상태 확인/삭제 요청만 허용하고 제출·공유·파일 내려받기·AI 추출 사용은 차단한다. 운영 정책이 해당 형식/목적을 명시 허용하면 not_scanned 그대로 사용하되 UI에 미검사 상태를 알리고 자동 실행/브라우저 inline render는 금지한다. 학생/민감 기록은 승인 정책이 별도로 허용하지 않으면 계속 차단한다. rejected/quarantined/deleted는 어떤 예외로도 사용하지 않는다. 검증 당시 적용한 공통/학교 정책판은 역사로 유지하고, 실제 사용은 당시 판과 현재 유효 공통 하한·학교 정책의 허용 교집합으로 판정한다. 정책 하나라도 현재 차단하면 옛 허용판으로 우회하지 못한다. submission_files에도 접수에 적용한 두 정책판을 고정한다.

file_links는 연결 정체성(scope/file/resource_type/id/version/role/linked_by/linked_at)을 불변으로 만든다. 제거는 unlinked_at만 기록하고 재연결은 새 행이다. 잘못된 부모의 UPDATE 우회를 닫는다. 부모 resolver는 허용 목록의 지원 표만 받으며 존재·정확한 판·같은 scope·현재 source 읽기·target 쓰기·공개 범위 상승 허용 여부를 검사한다. 임의 resource_classes 행을 파일 ACL로 사용하지 않는다. 초기 resolver 목록은 unit_drafts(정확 schema/file 문항), documents(정확 document revision), notices(정확 notice version), knowledge_revisions(정확 불변판), document_packs(정확 팩판), import_runs(입력 파일), export_manifests(출력 묶음)이다. 이 밖은 해당 도메인 typed 관계 구현·음성시험 뒤 allowlist에 추가한다. submission_files/document_inputs/document_revisions.output_file_id는 기존 typed 관계가 정본이며 generic link로 우회하지 않는다. 복합키 부모는 dedicated typed 관계 또는 명시 resolver를 요구하고 검증 불가능하면 거부한다. unlink·부모 차단/철회/삭제·권한 축소는 같은 transaction에서 grant를 회수하고, 물리 삭제는 ledger 이후에만 수행한다. 불변판의 파일 관계는 unlink로 내용 수정하지 않고 원본 전체 사용 차단과 새 정정판으로 처리한다.

file_links의 기존 전체 이력 유일성은 활성 연결만의 유일 인덱스로 교체한다. 키는 `(scope_key,resource_type,resource_id,resource_version,field_id,file_object_id,role)`이며 NULLS NOT DISTINCT와 `WHERE unlinked_at IS NULL`을 적용한다. 같은 초안에 같은 파일을 제거 후 다시 붙일 수 있고, 서로 다른 문항에 같은 파일을 선택해도 문항 관계는 구별된다. 완료판의 정정 금지와 현재 읽기 권한 검사는 그대로 적용한다.

수합 submission_files는 같은 unit/schema의 file 문항만 받는다. 파일 hash/bytes/검증정책 snapshot을 저장하며 본문 불변이다. 같은 트랜잭션 판정은 receipt_at=now()라는 시각 추정 대신 submission의 서버 생성 `receipt_xid xid8 = pg_current_xact_id()`를 사용한다. 제출판 INSERT와 첨부를 동일 transaction에서만 허용하고 실제 파일검사는 그 전에 완료해야 한다. 판이 finalized된 뒤 첨부 추가/수정/삭제는 항상 거부한다. 서버는 최종 관계를 검사한 뒤 접수 성공을 반환한다.

다운로드는 file_id 하나가 아니라 typed 부모/판/link ID를 받는다. 현재 계정·소속·원본 ACL·링크 생존·파일 상태·정책을 매번 검사한다. file_grant_valid도 원본 resolver를 다시 호출하며 학교 접근만으로 참을 반환하지 않는다. 민감 파일은 인증 proxy가 기준이고 서명 URL은 승인된 비민감 용도에 제한한다. issued URL을 실제 폐기하지 못하는 저장소에서는 TTL 동안의 잔여 접근을 숨기지 않으며 민감용 발급을 허용하지 않는다. 구성원 제거·private 전환·소속 종료 시 grant 회수는 원본 변경과 같은 transaction이며 실제 저장소 토큰 정책은 별도 승인 환경 시험 대상이다.

실물 삭제와 DB commit은 분리된다. deletion ledger 차단→작업자 물리 삭제→확인 후 purged 표기이며 파일 첨부와 동일 파일 잠금을 공유한다. 미첨부 고아 파일은 승인 보존정책에 따라만 정리한다. 백업 완료는 파일 bytes/hash 복구까지 별도로 증명한다.

## 12. 문서함·문서판·팩·근거

documents/revisions/inputs/validations/actions/document_packs를 유지한다. 기본 파일함은 AI 없이도 자신의 업로드·업무 파일·공용 팩을 현재 권한으로 구분한다. 문서 owner는 불변이며 shared_with는 명시 공유 범위다. 업무 담당은 duty 자료 중 허용 공유문서를 읽지만 개인 문서/미제출 초안은 읽지 않는다.

document_inputs는 목적 문서의 기존 `scope_key`를 유지하고 `file_scope_key TEXT NN`을 추가한다. 문서 FK는 `(scope_key,document_id) → documents(scope_key,id)`, 파일 FK는 `(file_scope_key,file_object_id) → file_objects(scope_key,id)`다. 기존 `(scope_key,file_object_id)` FK는 새 파일 FK로 교체한다. 기존 행은 확인된 같은 범위 값으로 백필한다. `file_scope_key = scope_key OR file_scope_key = 'c'`를 CHECK하여 학교 문서는 본교/common, 개인 문서는 본인/common, 공통 문서는 common만 입력으로 허용한다. 이 범위 검사는 읽기 권한을 대신하지 않으며 연결·생성·출력 시 현재 파일/원본 ACL, 허용 게시 상태, 안전 정책과 목적 문서 쓰기 권한을 별도로 검사한다. 학교 자료를 개인 입력으로 연결하거나 다른 개인의 파일을 연결하지 않는다. fact_source는 extract_state=ok와 교사의 명시 확인이 필요하다. 이 입력을 생성판에 채택할 때 document_revision_sources의 source_scope_key/source_file_id에 정확한 파일 범위를 고정한다. generic file_links의 같은 범위 규칙을 완화하지 않고 이 typed 관계에서만 공통 입력을 명시적으로 지원한다.

document_revisions에 pack_id/pack_scope_key/pack_version을 snapshot으로 고정한다. 문서 head의 팩 변경이 과거 생성판을 다시 해석하지 않게 한다. 새 생성판은 현재 활성 팩·허용 scope·정확 asset hash를 검사한다. 팩은 기존 검증된 manifest·template·token-map 자산을 참조하고 보호 자산을 다시 작성하지 않는다. 최종 재업로드는 새 file ID·새 revision·새 validation이며 pass를 복사하지 않는다. 문서 generated/validated/downloaded/submitted/officially_approved는 각각 사건이며 다운로드를 공식 결재로 표시하지 않는다.

신설 document_revision_sources는 scope_key/document_id/revision_no, source_kind, source_file_id?, source_event_id/revision_no?, source_document_id/revision_no?, source_knowledge_revision_id?, source_scope_key NN, source_sha256, purpose(form/fact/style), locator, confirmed_by_account_id/at을 가진다. 네 가지 선택형 원본 FK는 **MATCH SIMPLE**로 둔다: `(source_scope_key,source_file_id) → file_objects(scope_key,id)`, `(source_scope_key,source_event_id,source_event_revision_no) → event_revisions(scope_key,event_id,revision_no)`, `(source_scope_key,source_document_id,source_document_revision_no) → document_revisions(scope_key,document_id,revision_no)`, `(source_scope_key,source_knowledge_revision_id) → knowledge_revisions(scope_key,id)`. 공통 NN source_scope_key에 미선택 ID가 NULL이므로 네 FK 모두 MATCH FULL로 두면 정상 행도 거부된다. 대신 CHECK가 source_kind의 허용값과 정확한 ID 묶음을 강제한다. file은 file ID만, event_revision은 event ID+판번호만, document_revision은 document ID+판번호만, knowledge_revision은 knowledge revision ID만 NN이고, 선택되지 않은 나머지 ID·판번호는 전부 NULL이다. 선택한 묶음은 전 열이 NN이므로 MATCH SIMPLE도 실제 원본 FK 검사를 생략하지 못한다. 목적 문서 FK의 세 열은 모두 NN이며 기존 정확한 판 참조를 유지한다. source scope는 목적 school과 같거나 허용된 common, 개인 목적이면 본인/common만이며 개인 목적에 학교 자료를 복사하지 않는다. 입력 확인 당시 권한과 생성/출력 직전 현재 권한을 모두 검사한다. 기존 source_refs JSON은 이 관계의 표시 snapshot이며 독립 ACL/근거 원장이 아니다.

추출 ok인 파일도 자동으로 사실 확정하지 않는다. 교사가 확인한 현재 학교/연도에 맞는 사실과 표현 예시를 구분한다. 근거 정정/철회는 documents.stale_since/사유와 관련 생성판 재검토로 전달하고 이전 파일의 유효검사를 무조건 유지하지 않는다. 출력/제출 직전 정확 source revision/hash를 재확인한다. 일반 HWPX 내용 지원·검증 팩 원형 보존·스캔/암호화 불가를 별도 support_level로 표시한다.

## 13. ZIP 내보내기·공지·알림

export_manifests는 작업/선택 모드를 유지하고, 신설 export_manifest_items가 unit/submission/schema/file의 정확한 ID·판/hash·상태·오류 코드를 고정한다. 기존 items/failed_items JSON은 관계표의 읽기 projection이다. none은 latest_valid, required는 선택한 received판이 기본이고 effective만 묶을 때 명시 선택한다. 파일 없는 숫자/글 응답도 항목에 포함한다. ZIP 파일명은 단위·판·검토상태를 포함하고 경로를 서버 정규화한다.

작업자는 시작·각 항목 접근·최종 연결·다운로드 때 권한을 검사한다. 중간 권한 회수/파일 누락은 해당 항목 실패, 결과 partial을 명시한다. 현재 볼 수 없는 자료가 섞인 예전 ZIP을 재발급하지 않는다. 실패 항목만 고정 ID로 재시도하며 새 제출판으로 슬쩍 바꾸지 않는다. 파일 bytes·manifest hash 검증 전 ready 금지다.

notices/notice_receipts와 notification_*는 유지한다. 게시 근거는 현재 승인된 부서·업무·학급·학년 관계이고 중요 표시는 범위를 늘리지 않는다. 전달 확인 명단은 해당 요청자/명시 관리권한자에게만 반환한다. read_at와 acknowledged_at는 다른 사건이며 둘 다 다른 의무의 완료가 아니다. 의미 있는 본문 변경은 새 notice version으로 확인을 새로 받는다.

알림 제목은 안전한 템플릿(예: ‘수합 요청이 있습니다’)만 저장하고 학생 이름·본문·개인 메모를 넣지 않는다. 목록 DTO의 원본 제목은 현재 원본 ACL로 조회한 뒤 덧붙인다. notifications read 정책과 push 발송 때도 source 현재 권한을 확인하므로 revoke worker가 늦어도 제목/링크를 노출하지 않는다. 사건+수신자+kind+source_version 중복 키, 앱 알림 기준, 조용한 시간·아침 묶음·긴급 권한의 기존 계약을 유지한다. 알림 실패가 업무 commit을 되돌리지 않는다.

## 14. 홈·업무 조회와 파생 캐시

`workhub.dashboard_section(p_school,p_section,p_cursor,p_limit,p_as_of)`은 authenticated 현재 actor 기준으로 today_events, my_tasks, collection_obligations, reviews, notices, recent_documents를 각각 조회한다. 순수 개인 공간은 명시 scope로 따로 요청하며 학교 전환 응답에 섞지 않는다. 홈은 이 독립 호출을 병렬 조합해 `{section,status,data,asOf,nextCursor}`를 받는다. 하나의 실패는 해당 칸만 retry이며 전체를 비우지 않는다.

- 일정: 현재 열람 가능한 원본 중 오늘 겹침/다가오는 기간, 추천 이유와 원본 판 포함. 관련 여부가 읽기권한을 대신하지 않는다.
- 개인 업무: owner+scope의 미완료 마감순, 출처 원본 권한을 재검사. 개인 체크는 원본 의무를 완료하지 않는다.
- 수합: 현재 책임/유효 대리 단위, 요청·문항판·current/effective·지연 세 축을 반환. 완료본이 있어도 열린 보완이면 할 일이 남는다. 관리자 집계도 본문 열람 가능한 단위와 관리 전용 메타를 구분한다.
- 검토: 현재 지정 검토자이면서 self-review 정책을 통과하는 pending판만 표시한다.
- 전달/문서: 현재 source ACL 후 조회한다. 검색·건수·최근 목록에도 같은 식을 사용한다.

DB 조회는 Claude의 ‘내 소속/권한/단위 집합을 질의당 한 번 계산’ 방식을 유지한다. JSON 답변 전체 GIN은 기본 생성하지 않고 정확한 schema별 numeric 집계는 권한 제한 후 계산한다. 필요한 인덱스는 units(collection_id,obligation_state), current members(membership_id,valid_from,valid_until), submissions(unit_id,version_no DESC), corrections(unit_id,due_at) WHERE open, tasks(owner,school,status,due_on,id), notifications(recipient,created_at,id) WHERE revoked_at IS NULL이다.

최초는 캐시 없이 페이지 제한·집합 RLS로 측정한다. 도입하더라도 원본 ID/판·계산 결과만 가진 **파생 캐시**이며 별도 정본이 아니다. 캐시 키는 account/school/scope/permission_version/정책판/section/기준일이며 원본 변경·권한회수·기간 경계에 무효화한다. 원본 제목/본문을 저장해 ACL 재검사를 생략하지 않는다. stale 표시 캐시도 현재 권한 확인이 실패하면 폐기하고 개인정보 칸은 표시하지 않는다. 캐시 갱신이 늦어도 명령·다운로드는 항상 원본을 본다.

## 15. 생성 순서·명령별 완료 조건

| 묶음 | 선행 조건 | 명령/조회와 완료 기준 |
|---|---|---|
| W0 기본 호환 | 계정/학교/소속 gate·기존 DB 실측 | tasks/events 기존 입력·응답·종료일 변환, 소속 종료·충돌·응답 유실 회귀 |
| W1 일정/업무 | 승인 배정/대상·불변 event revision | save/confirm/withdraw/query, 협조 수락·개인 note 격리, 시트 preview/apply/cutover |
| W2 수합 글/숫자 | collection_schemas·members 기간·receipt | draft/publish/submit/review/withdraw/correct/exempt, current/effective/지연/인계 종단 |
| W3 파일/문서함 | Storage 승인 환경·file policy·실물 검증 | init/complete/download, typed 첨부·ZIP, 일반 파일함·새파일 새판 |
| W4 문서 생성 | 검증 팩·job/AI 권한·근거 판 | 문서 source→팩→산출물→검사→수합, 수정 최종본 재검사 |
| W5 운영 마감 | 알림·원자 인계·실제 복구 | 기존 회원 실제 로그인부터 모든 도입 기능 종단, 부분 실패/동시성/회수 검증 |

단계는 생성·검증 순서이지 사용자에게 일부만 조기 공개하자는 제안이 아니다. 최종 공개 게이트와 보류된 시간표 범위는 통합 총괄 문서를 따른다. 승인 미정 값은 POLICY_UNSET으로 막고 허위 기본값으로 운영하지 않는다.

## 16. 필수 수용 시험

| ID | 사례 | 반드시 확인할 결과 |
|---|---|---|
| WF01 | 미래 공동작성자·시작 직전/직후·시작 전 취소·예약 종료 | 초안/첨부/건수 현재 유효기간 일치, 미래 0행(R02) |
| WF02 | 제출자 인계·동일 계정 새 소속·대리 제출 후 책임자 검토 | 제출자/당시 책임자 계정의 자기검토 거부(R07) |
| WF03 | 게시 문항 INSERT/UPDATE/DELETE·schema999·타수합 schema·A단위/B초안 | 모두 거부, 과거 답변 해석 불변(R08) |
| WF04 | 수락 NULL/부분 NULL·지문 불일치·날짜/후임 변경·인계 재활성화 충돌 | 적용0·재수락 필요·동일 대상 중복0(R09) |
| WF05 | file_link 부모/type/version/file UPDATE·타학교·개인목적 연결 | 정체성 변경 거부·새 연결도 현재권한/범위 검사(R10) |
| WF06 | none v1/v2/철회·required v1승인/v2대기/철회·보완판 철회 | 명시 포인터, 옛 none판 부활0, 미충족 보완 유지 |
| WF07 | 보완 제출 후 철회·보완요청판 철회·기한 변경·면제 복원 | fulfillment 무효와 open 재계산 원자, 최초 지연 불변 |
| WF08 | 두 세션 같은 키/다른 키 동시 제출·응답 유실·검토/철회 경합 | 접수1판 또는 명시 충돌, 승인과 철회 동시 성공0 |
| WF09 | 파일 성공 후 DB 강제 실패·영수증 INSERT 강제 실패 | 제출/첨부/pointer/outbox/receipt 전부0, 미첨부 실물 상태는 정직하게 유지 |
| WF10 | 본인 파일 ID로 타인초안/공지 연결·구성원 제거 후 grant 재사용 | 현재 원본 ACL로 차단, 기존 issued URL 한계 별도 실측 |
| WF11 | not_scanned 정책 없음/승인/철회·quarantined·추출 실패 | 정책 없는 사용0, 미검사를 clean으로 표시0, AI입력 별도 판정 |
| WF12 | 행 정렬·중복 key·ID 소실·양쪽 변경·매핑 변경·적용 직전 기준 전환 | baseline 재현, 잘못된 덮어쓰기0, 원본 누락 삭제0 |
| WF13 | 공식 효력 v1 뒤 편집안 v2·구 save·확정·철회 | 일반 조회/학사계산 v1 유지, 확정 때만 v2, private 우회0 |
| WF14 | 담당 인계 도중 한 unit 기대판 충돌·후임 종료·동일 키 재실행 | 전체0 또는 전체1, 의무 ID/완료본 유지, 개인 note 이전0 |
| WF15 | 숫자0/NULL/큰수·false/빈선택·잘못된 날짜·추가key | schema별 정확한 거부/합계, 허용 단위만 집계 |
| WF16 | ZIP 도중 권한회수·파일 누락·새 제출·부분 재시도 | 고정 허용판만, partial/실패목록 명시, 옛 광범위 ZIP 재발급0 |
| WF17 | 문서 팩 교체·최종 재업로드·근거 정정/철회 | 과거 팩판 유지, 새 hash 재검사, stale 근거 출력/제출 차단 |
| WF18 | 원본 비공개 뒤 revision/알림/홈/검색/count/캐시 조회 | 직접경로와 같은 ACL, audit.read 원문 우회0 |
| WF19 | 일부 홈 RPC 실패·늦은 학교 A 응답·권한판 변경 | 해당칸 retry, 학교B에A자료0, 원본 없는 완료표시0 |
| WF20 | DB+파일 복원·삭제/회수 원장 재적용 | 실물/판/hash 일치, 폐기·회수 자료 재노출0 |

기존 762개는 유지하되 의미가 바뀐 정책 시험은 새 계약으로 명시 갱신한다. 이번 문서는 새 DDL 시험 통과를 주장하지 않는다. R02·R07~R10의 이전 재현 SQL을 차단을 기대하는 회귀로 바꾸고 PostgreSQL 두 연결, 실제 Supabase API/Storage, 화면 왕복은 별도 증거로 남긴다. 160표/RLS수·verify_security 0행은 개별 정책 정확성의 대체 증거가 아니다.

## 17. 판단해서 정한 것

불변 schema+JSONB 답변, 결과 기본 비공개, 계정 기준 과거 자기검토, 수락행 별도 보존, 보완 충족 이력, 파일 link 불변, 원본별 홈 조회를 선택했다. 관계·기간·역사 증거를 DB에서 재검증하면서 과도한 답변 EAV와 홈 원장 복제를 피하기 위해서다. 되돌리려면 해당 절과 workflows-changes.json의 동일 표·WF 시험을 함께 변경해야 한다. 해법의 채택 제안은 실제 DB·RLS·공개범위 변경 승인을 대신하지 않는다.


---

<!-- SOURCE: 03-students-timetable.md -->

# 03. 학생·수업·근거·생기부·시간표 통합 계약

> 2026-10-12 · 완성된 사이트를 위한 **설계 제안**. 실행 SQL·운영 적용본이 아니다. Claude 2차의 `workhub` 160표와 `workhub_private` 함수를 기준으로 이름과 검증된 구조를 계승한다. 이 문서가 명시한 변경은 동봉 `student-ai-changes.json`의 변경 목록이며 SQL 확정·실행·공개 승인을 대신하지 않는다. 시간표 구현 작업은 현재 보류다.

## 1. 기준과 완료 조건

학생 자료는 `학교 안 불변 학생 → 그날 학적/수강 → 원자료의 정확한 판 → 교사가 확인한 학생 연결판 → 채택 → 본인 관찰/평가의 불변 판 → 문장별 근거 → 해당 판 검토 → 출력` 순서로 이어진다. 받은함을 열거나 학생을 연결하는 것만으로 관찰·평가·생기부 근거가 확정되지 않는다. 공동 수업 자료 열람권한도 다른 교사의 개인 관찰을 가져올 권한이 아니다.

이 문서의 **반드시 유지할 조건**은 다음과 같다.

- R04: 관찰·상담·평가·초안의 학교·작성자·학생 정체성은 불변이다. 특히 검토한 초안의 학생만 바꾸는 UPDATE를 금지한다. 출력 직전에도 원본판·학생·작성자·유효 관계를 다시 검사한다.
- R05: 채택에는 원자료판뿐 아니라 **확정한 학생 연결의 ID와 revision**이 필요하다. A→B→A로 재연결되어도 이전 채택은 저절로 유효해지지 않는다.
- R06: `origin='classroom_adoption'`인 확정 관찰판은 유효한 채택 사슬을 반드시 가진다. 사슬 0개를 직접 기록으로 간주하지 않는다.
- 개인 관찰·상담·평가·초안·받은함은 작성자 전용이다. 관리자·superadmin·지원자도 본문, 건수, 기록 존재 여부를 우회 조회하지 못한다.
- AI 제안은 교사 확정을 대신하지 않는다. 점수 합계·바이트 계산·규칙 검사는 승인된 규칙판을 이용한 코드가 수행한다. NEIS 공식 입력 완료는 별도 사실이다.

기존 DDL의 단일 세션 시험이 통과해도 아래 새 반례와 두 연결 경합 시험을 통과한 것으로 표시하지 않는다. 원본 자료·관찰 본문·실명은 시험에 사용하지 않는다.

## 2. 표준 이름·키·기간

모든 표는 `workhub.<이름>`, 함수는 `workhub_private`의 서버 전용 검증 또는 제한된 공개 명령이다. 신규 ID는 `text DEFAULT gen_random_uuid()::text`, 시각은 `timestamptz`, 날짜는 `date`다. 기존 PK를 UUID형으로 바꾸지 않는다. 관계 기간은 학교 현지 날짜의 `[valid_from, valid_to)`이며 끝 NULL은 열려 있는 기간이다. 기존 legacy의 종료일 포함 값은 이관할 때 한 번 변환하고 원래 DTO 의미는 별도 어댑터로 보존한다.

| 기존 표 | 역할·보존 계약 |
|---|---|
| `academic_years`, `terms` | 학교별 학년도·학기. 실제 시작/종료일과 확정 상태를 사용한다. 달력 연도로 학년도를 추정하지 않는다. |
| `subjects`, `academic_classes` | 교과 기준과 행정 학급. 반 이름·학년은 학생 ID가 아니다. 기존 학교급별 학년 범위는 확인된 학교 설정으로 검증한다. |
| `course_groups`, `course_group_classes`, `course_group_teachers` | 실제 수업 집단, 연결 행정학급, 기간별 승인 교사. 담임 배정인 `assignments`와 구별한다. |
| `students` | 학교 안 학생 ID. `school_student_code`는 선택 영구 코드이며 부여 후 재사용·변경하지 않는다. 이름·반·번호로 전국 통합 신원을 만들지 않는다. |
| `student_enrollments` | 행정 학급 재적 기간. 동일 학생 재적과 반/번호의 기간 중복을 기존 EXCLUDE로 차단한다. |
| `course_memberships` | 선택·분반·공동수업 수강 기간. 행정 학급과 별개다. 같은 수업 집단/학생의 기간 중복을 차단한다. |
| `assignments` | 담임·업무·교과 등 승인 배정. 자기 신고는 `profile_claims`에 두며 바로 권한에 사용하지 않는다. |

같은 학교 관계는 `(school_id,id)` 복합 FK를 사용한다. 학적·수강은 `(school_id,id,student_id)` UNIQUE와 동일 열의 FK를 유지한다. 행정 학급은 학년도까지 포함한 기존 FK를 유지한다. 학생·교사·학급·공간 공유는 같은 학교 내에서도 승인된 관계만 허용한다.

전입 시 대상 학교에 새 학교 내 학생 ID를 생성한다. 두 학교의 이름·생년·번호로 자동 동일인 연결하지 않는다. 전출은 기존 학적·수강을 효력일에 종료하고 미래 담당 접근을 닫는다. **동일 account가 같은 학교에 재임용되어 현재 활성 소속과 보존 정책을 충족하면 본인 과거 관찰·상담·평가·초안을 읽을 수 있다.** 과거 학년도 정정 승인은 별도이며 새 학급·타인 명부 권한은 늘어나지 않는다. 다른 학교 또는 다른 교사의 기록은 열지 않는다. AI 대화·기억의 생성 소속 고정은 별도 계약이다.

## 3. 관찰·상담·평가·초안의 정체성과 판

### 3.1 변경 가능한 정보와 바꿀 수 없는 정보

| 표 | 불변 정체성 | 새 판으로 정정할 정보 |
|---|---|---|
| `observations` | id, school_id, author_account_id, author_membership_id, student_id, academic_year_id | 같은 학생의 날짜·학적·수업·사실·분류. 당시 관계를 새로 검사하고 현재 머리와 불변 판을 한 트랜잭션으로 갱신한다. |
| `counselling_records` | id, school_id, author_account_id, author_membership_id, student_id, academic_year_id | 상담 날짜·유형·본문·후속 내용. 상담 원문은 일반 AI·근거·인계 대상이 아니다. |
| `assessments` | id, school_id, author_account_id, student_id, activity_id | 동일 평가 활동에서 루브릭에 맞는 항목 점수·상태·확인. 다른 활동/학생으로 정정하려면 원기록 철회 후 새 기록이다. |
| `record_drafts` | id, school_id, author_account_id, student_id, academic_year_id, area, subject_id, course_group_id | 문장·질문·근거·규칙 검사. 다른 학생·학년도·영역으로 UPDATE/복사 명령을 만들지 않는다. |

원래 다른 학생에게 잘못 기록한 경우 `철회(원학생)+새 기록(정확한 학생)`을 하나의 명시적 정정 명령으로 처리한다. 두 기록 모두 같은 작성자이고 각각 당시 관계가 확인돼야 한다. 감사에는 두 ID·사유 코드만 남기고 본문을 복제하지 않는다. 이전 원기록을 새 학생의 이력처럼 재귀속하지 않는다.

`observation_revisions`는 기존 student/enrollment/course/date 사본을 유지하고 `course_membership_id`, `teacher_assignment_id`(course_group_teachers), `ai_run_id`를 추가한다. 교과 수업 관찰이면 수강·승인 수업 담당이 필수이며 같은 학생·수업·날짜다. 담임 관찰이면 승인 담임 배정으로 검사하고 수강을 억지로 만들지 않는다. `counselling_revisions`와 `assessment_revisions`에도 학생·학적·기준일 사본을 두어 머리만으로 과거 사실을 재구성하지 않는다. 평가판에는 서버가 정규화된 판 내용에서 계산한 `body_sha256`를 추가한다.

모든 개정은 부모 잠금 아래 `max(revision)+1`을 할당한다. `current_revision_no`만 믿지 않고 최신 불변판도 검사한다. 철회는 끝 상태이며 같은 머리를 부활시키지 않는다. 본문 UPDATE는 전용 삭제 작업의 가림/파기 예외만 허용한다. 일괄 관찰의 최초판은 `fact_scope=common_activity`; 학생별 수행·태도는 개별 교사 확인 후 별도 판으로 작성한다.

### 3.2 평가와 기재규칙

기존 `rubrics/rubric_revisions`, `assessment_activities`, `assessments/assessment_revisions`, `record_rule_sets`를 재사용한다. 루브릭은 활동이 선택한 정확한 판에 고정된다. 기준이 바뀌면 새 활동/명시적 새 기준판 적용 절차이며 과거 점수를 자동 환산하지 않는다.

- `result_status=scored`일 때만 점수/항목 값이 존재한다. 0점은 실제 0이고, 미제출·결시·연결오류·미확인은 NULL이다.
- item_scores의 키는 해당 루브릭 항목과 정확히 대응한다. 각 값의 형식·범위·합계는 승인된 기준으로 서버가 계산한다. AI 총점을 그대로 저장하지 않는다.
- 확정자는 작성 교사 본인이다. AI 제안·교사 검토·확정 시각을 구분한다. 수정은 새 판이고 기존 확정판은 그대로 남는다.
- 생기부 바이트/문자 계산은 `record_rule_sets`의 학교급·학년도·영역·근거·계산식 판에 따른다. 규칙 미확정은 `not_checked`이며 임의의 바이트 한도를 채우지 않는다.
- `record_sentences.kind=sentence/question`을 유지한다. 질문은 최종 문장처럼 출력하지 않는다. 문장별 유효 근거가 없는 경우 완료 표시를 막는다.

## 4. 실제 수업 앱: 수신·학생 확인·교사 채택

### 4.1 CSV 최소 경로

현 디지털윤리 앱의 CSV는 불변 학생 ID·수신 이벤트 revision·확정 활동시각을 보장하지 않는다. 자리번호·별명·행순서는 식별 힌트다. `dilemmas`와 `grading`의 실제 헤더 프로필을 parser_version별로 고정하고 파일 형식을 추정하지 않는다. BOM, 인용부호, 여러 줄, 빈 셀, 수식 보호 작은따옴표를 보존한다. `심화 (평가 제외)` 항목은 점수 근거에서 제외한다.

1. 교사가 학교·수업 집단·학기·활동일·질문판을 선택해 `activity_instances`를 만든다. 질문판의 원문/선택지 해시와 보관 참조를 고정한다.
2. 안전하게 검사된 `file_objects`에 CSV를 올리고 `classroom_imports` 미리보기를 만든다. 동일 `(학교,작성자,활동,파일 SHA256)`이면 기존 결과를 돌려준다. 다른 활동의 같은 파일은 자동 중복 취급하지 않는다.
3. `source_items`의 논리 키는 활동·참가자·항목종류·문항이다. 원문은 `source_item_revisions`에 불변 저장한다. 정정 CSV는 기존 논리 항목과의 연결을 교사가 확인해야 새 판으로 반영한다. 누락 행을 철회로 추정하지 않는다.
4. `participant_mappings`는 현재 상태 projection이며 `participant_mapping_revisions`가 원장이다. confirmed 판에는 학생·활동일 학적·해당 수업 수강이 모두 필요하다. 승인된 교사 담당도 같은 날짜에 검사한다. 다른 참가자를 같은 학생에게 중복 연결하면 보류한다.
5. 받은함에서 원문판·질문판·학생/당시 학급·수업을 확인한다. 교사는 원문을 단순 복사한 성취/인성 추정을 승인하는 대신 직접 확인한 사실 또는 평가 근거로 채택한다.
6. 관찰판/평가판 생성과 `adoptions` 생성, inbox 상태, gate epoch, 접수증·감사·outbox를 한 트랜잭션에서 확정한다. 중간 실패면 모두 롤백한다.

### 4.2 R05: 정확한 연결판을 저장한다

`adoptions`에 `mapping_id text NOT NULL`, `mapping_revision integer NOT NULL`, `student_id text NOT NULL`을 추가한다. `participant_mapping_revisions`에는 `UNIQUE(school_id,mapping_id,revision,student_id)`를 둔다. FK는 `(school_id,mapping_id,mapping_revision,student_id)` 전체다. 기존 원자료판 FK와 받은함의 owner 복합 FK도 유지한다.

추가 제약 트리거는 mapping 부모와 source_item의 **같은 활동·참가자·작성자**, mapping판의 학생과 대상 관찰/평가판 학생, 학적·수강·활동 날짜를 대조한다. 현재 유효 연결은 `max(revision)`을 먼저 선택한 뒤 confirmed 여부를 판단한다. current pointer가 늦거나 최신판이 held/changed/rejected이면 예전 confirmed판으로 돌아가지 않는다.

`adoption_chain_stale()`는 원자료 최신판·삭제/철회·정확한 mapping 최신판·원문과 활동 질문판·target의 학생/owner를 검사한다. 현재 학생 ID가 우연히 같아도 mapping_revision이 바뀌면 stale다. 재검토는 기존 불변 관찰판을 다시 valid로 켜는 행동이 아니다. 새 관찰/평가판과 새 채택을 만들고 기존 연결은 이력으로 남긴다.

### 4.3 R06: 사슬 누락은 거부한다

`origin=classroom_adoption`인 가림/파기되지 않은 관찰판은 최소 한 개의 adoptions 이력을 반드시 가진다. 그중 현재판이 confirmed이고 needs_review=false여서 근거로 사용할 수 있다면 최소 한 개의 활성·유효 사슬이 필요하다. 아직 초안을 만드는 트랜잭션 중간에는 잠시 없을 수 있지만 **DEFERRABLE INITIALLY DEFERRED 제약 트리거가 커밋 때 확인**한다. 관찰판·adoption INSERT/UPDATE/DELETE 양쪽에서 영향 target을 검사한다. 명시적 철회/원자료 정정으로 무효화된 과거판과 채택 이력은 보존하고, 현재판도 needs_review=true로 차단하여 남길 수 있다. 이를 검토·출력 가능으로 취급하지 않는다.

`origin_ref`는 화면용 호환 정보이며 권한·근거 판정에 쓰지 않는다. AI 다듬기는 ai_run_sources를 통해 입력 원문과 전후 판을 확인하며 classroom 원본을 지닌 사실을 direct로 세탁하지 않는다. `adoption_chain_stale()`는 classroom origin인데 사슬이 0개이면 true/`ADOPTION_CHAIN_MISSING`을 반환한다. 평가 활동의 자료 채택도 같은 target 판 사슬을 적용한다.

### 4.4 후속 서버 자동 연계

신규 `classroom_connections`는 `(school_id,owner_account_id,id)`, external_app, endpoint_id, credential_ref(비밀 아님), state, permission_version, 허용 수업 범위를 가진다. 연결 권한은 소유자의 현재 학교·수업 담당으로 제한한다. 실제 비밀은 서버 비밀 저장소에만 둔다.

`classroom_event_receipts`는 connection_id, event_id, external_revision, event_kind, payload_sha256, activity_instance_id, source_item_id?, local_revision?, state, received_at, safe_error_code를 저장한다. UNIQUE(connection_id,event_id,external_revision). 같은 키·다른 지문은 `IDEMPOTENCY_CONFLICT`, 같은 키·같은 지문은 현재 권한 재검사 후 기존 결과다. 원문은 receipt에 복사하지 않는다.

서버가 인증된 connection에서 school/owner를 결정한다. 외부 payload의 school_id/교사 ID는 권한 근거가 아니다. envelope는 `schema_version,event_id,external_revision,event_kind,external_activity_key,participant_key,question_set_version,item_key,occurred_at,content`의 제한 스키마다. 외부순서가 역전되면 보류/옛판 이력으로 남기고 최신 포인터를 되돌리지 않는다. revision 없는 공급자는 자동 최신판 덮어쓰기를 지원하지 않고 CSV와 같은 교사 확인 흐름을 사용한다. 원자료 수신 성공은 학생 연결·점수 확정·관찰 채택 성공이 아니다.

취소·삭제 사건도 버전이 있는 사건으로 처리한다. 원문 재전송은 활동·논리키·내용 해시와 삭제 원장을 먼저 대조한다. 삭제 후 같은 event/내용을 새 ID로 포장해도 자동 재생성하지 않는다. 복원 승인은 별도 권한·사유·범위를 가진 명령이며 임의 문자열 override만으로 우회하지 않는다.

## 5. 문장별 근거·동시 정정·출력

기존 `evidence_links`를 재사용한다. record_sentence는 confirmed observation_revision 또는 assessment_revision만 참조한다. 상담·받은함·원자료·다른 생기부 초안을 직접 근거로 연결하지 않는다. 평가판 해시도 비교한다. `span`은 원문 Unicode code point의 [start,end)와 원본 해시에 묶고 범위 밖/분리 surrogate/원문 불일치를 거부한다.

다형 type/id 링크를 유지하더라도 FK와 동등한 target 존재·학교·owner·학생·불변 판 검사를 제약 트리거로 강제한다. 미래 새 type은 검증기와 삭제 영향 처리·시험이 먼저 도입된 뒤 CHECK 목록에 추가한다. 원본 삭제는 RESTRICT/전용 파기 절차이며 dangling 링크를 만들지 않는다.

### 5.1 작성자 근거 gate

신규 `student_evidence_gates(school_id text, owner_account_id text, epoch bigint DEFAULT 0, updated_at timestamptz)`의 PK는 `(school_id,owner_account_id)`다. 학교·계정 FK가 있고 브라우저에 직접 열지 않는다. epoch는 단조 증가하며 학생 신원이나 본문을 담지 않는다.

공통 잠금은 `accounts/서비스 principal 정렬 → 학교·서비스 gate/grant → memberships 정렬 → 역할·정책 → 멱등 advisory → student_evidence_gates → 원본 종류/ID 정렬 → 파일 → receipt/audit/outbox`다. 권한 검사 행은 FOR SHARE, 회수는 FOR UPDATE/UPDATE로 실제 충돌시킨다. gate는 근거 변경/확정/출력 모두 FOR UPDATE로 획득하며 같은 소유자의 재검사와 변경을 직렬화한다. 여러 작성자·학교를 순회하는 파기 작업은 키 정렬을 지키고 한 소유자의 원자 작업으로 분할한다.

원자료 정정/철회·mapping 새판·관찰/평가 정정·삭제 차단은 gate 아래서 원본판/current pointer/epoch와 직접 파생 `impact_items`·needs_review·접수증·outbox를 함께 커밋한다. 파생이 많아 비동기 전파하더라도 gate epoch와 동기 원본판 검사가 즉시 출력을 막아야 한다. 전파 완료 전 기존 텍스트를 정상 결과로 노출하지 않는다.

AI 생성은 gate 아래 입력판/epoch를 읽어 실행 출처를 저장한 뒤 트랜잭션을 종료하고 외부 호출한다. `record_draft_revisions`에는 ai_run_id(교사 직접 작성은 NULL)와 evidence_epoch를 고정하여 생성 당시 사슬을 찾는다. 돌아오면 동일 gate와 현재 권한을 다시 획득한다. source hash/revision/mapping/epoch 중 하나라도 달라졌으면 결과를 `needs_review`로 보관하거나 폐기하며 reviewed로 승격하지 않는다. 외부 호출 동안 DB 잠금을 유지하지 않는다.

### 5.2 검토·출력 트랜잭션

1. 현재 계정·소속·학교·본인 소유·보존/과거 정정 정책 확인, gate와 초안/원본 잠금.
2. 초안 현재판=max판, identity tuple, 문장 종류·근거 수, 원본의 학교/owner/학생, 최신 확정판, adoption 사슬, 해시·구간, 기재규칙판을 **다시** 검사.
3. 서버가 정렬된 문장/근거판/구간/mapping판/규칙판으로 evidence_set_sha256를 계산한다. 클라이언트가 보낸 지문끼리 일치한다는 이유로 검사를 생략하지 않는다.
4. reviewed는 정확한 draft revision·evidence hash·gate epoch에 묶는다. 새 초안판은 draft로 되돌린다. 출력은 같은 검사를 반복하고 `record_exports`에 그 revision·학생·학년도·영역·지문·epoch를 불변 사본으로 저장한다.
5. 파일 출력은 서버 작업의 임시 결과를 최종 검사 후 공개한다. 다운로드 URL 발급 때도 현재 권한/차단 상태를 재확인한다. 동시 정정이 먼저 커밋하면 출력은 `EVIDENCE_CHANGED`; 출력이 먼저 커밋하면 이후 정정은 영향 목록으로 해당 출력의 최신성 상실을 표시한다. 이미 내려받은 파일을 회수했다고 표시하지 않는다.

## 6. 과거 정정·개인정보·삭제

본인 과거 기록을 정정할 때 현재 학교 소속, 작성 당시 학생 관계, 보존 상태와 정책을 검사한다. 필요한 절차 승인에는 기존 `record_correction_approvals`를 사용한다. 승인자는 본문 없이 ID·종류·사유 코드·결재번호·범위·기한만 보고, 소유자와 다른 현재 유효 승인권자여야 한다. 새 담당자에게 원본문을 넘기는 명령으로 사용하지 않는다. 승인 당시 revision이 달라졌거나 기한이 끝나면 새 승인이 필요하다.

명부 관리자는 명부·배정만 관리한다. 개인 본문뿐 아니라 기록 수·상담 유무·점수·검색 추천·알림·AI trace·파일 링크에도 동일한 owner 규칙이 적용된다. 지원 세션과 서비스 principal에 포괄적 개인 원문 열람을 부여하지 않는다. 삭제 worker는 승인된 manifest의 최소 대상만 처리하며 결과에 본문을 싣지 않는다.

삭제는 gate 아래 사용 차단·epoch 증가·직접 파생 stale·삭제 원장/outbox를 먼저 원자 커밋한다. 별도 작업이 원자료판 raw_text/parsed, CSV 파일, AI 입력/출력 메시지, 추출본, 검색색인, 캐시, 파생 문장/내보낸 파일을 manifest별로 가림·파기한다. FK를 유지할 최소 tombstone과 필요한 법정 보존 대상은 분리한다. 일부 잔존은 partial/retained이며 completed가 아니다. 사용자의 PC 원본 CSV와 외부 수업 앱 자료는 자동 삭제됐다고 말하지 않으며 첫 도입부터 수동 삭제 안내/사용자 확인/확인 불가 상태를 기록한다.

학기 전환의 최소 기능은 새 기간·행정학급·수업·승인 담당·학적/수강을 미리보기 후 생성하는 것이다. 관찰/평가/상담/받은함/초안은 복사하지 않는다. 고급 일괄 전환 마법사도 같은 명령을 묶어 호출하며 원자 범위·부분 실패·재시도 receipt를 유지한다.

## 7. 시간표 26표: 완성 사이트의 접점 계약

알고리즘을 새로 설계하지 않는다. 현재 주간 편성 엔진은 별도 검증된 입력/후보 계약을 통해 연결하고, 날짜별 실제 변경·수업 실시·시수 원장은 아래 DB가 맡는다. 지금 구현 작업은 보류하지만 완성 목표에서 기본 자동편성·검사·배포·교체를 삭제하지 않는다.

| 기존 표 묶음(26표 전부) | 유지할 불변식 |
|---|---|
| `spaces`, `bell_schedules`, `bell_periods`, `term_day_templates` | 실제 시각·학교/학기·공간 용도. 교시 번호만 같다고 시각이 같은 것으로 보지 않는다. 일과 변경은 이후 확정 수업 영향 검사가 필요하다. |
| `course_groups`, `course_group_classes`, `course_group_teachers` | 행정학급과 수업집단 분리, 팀티칭·기간 담당. 초등 학급 중심/중등 교과 중심/고교 선택분반을 같은 관계로 표현한다. |
| `constraint_sets`, `timetable_constraints`, `teacher_unavailability` | hard/soft와 출처·승인 상태·설정판 고정. 확정 출장·복무 불가시간은 hard이고 AI가 묵시 완화하지 않는다. |
| `timetable_compositions`, `timetable_candidates` | 입력판·엔진판·seed/실행한도·결과검사·미해결 상태. timeout/해 없음/미검증 후보를 구분한다. 후보는 불변이며 수동편집도 새 후보로 재검사한다. |
| `timetable_versions`, `timetable_placements`, `timetable_version_impacts` | 배포판의 효력기간·직전판·변경영향. 과거 실시수업과 승인된 미래 변경을 덮어쓰지 않고 영향별 유지/재검토를 결정한다. |
| `lesson_instances`, `lesson_instance_teachers`, `space_reservations`, `resource_occupancy` | 날짜별 예정 수업 및 실제 시각 자원 점유. 교사·공간·학급·집단·선택수강 학생 충돌을 동기 검사하고 EXCLUDE를 최종 방어로 둔다. |
| `timetable_change_sets`, `timetable_change_items`, `timetable_change_participants` | 교체/대체/휴강/보강 종류와 대상 수업판·동의 지문. 동의 후 교사·시각·원판·영향이 바뀌면 재동의. 자기 요청의 최종 승인 금지. |
| `lesson_executions`, `lesson_execution_teachers`, `cover_ledger` | 예정과 실시 분리. 실제 실시판·담당을 근거로 보강/대체 시수 누계를 계산하며 정정은 보상행/새 실시판으로 남긴다. |
| `school_timetable_types` | 검증된 학교 운영형만 지원됨으로 표시한다. 복잡한 선택분반·특수/공동교육과정 미검증 조합을 지원 완료로 주장하지 않는다. |

고교 선택분반은 승인 수강명단으로 충돌 학생을 결정한다. 공동교육과정 외부 교사는 승인된 외부 자원 식별자로 취급하되 다른 학교 학생 원문을 공유하거나 전국 학생 ID를 만들지 않는다. 특수학급·통합수업의 학생 이동은 실제 참여 집단과 기간으로 표현하며 행정학급 중복 금지를 수업 참여 중복 금지로 잘못 확장하지 않는다. 상세 학교별 제약은 확인된 설정판이며 모르는 제약은 미해결로 남긴다.

편성 경로는 `입력판 확정 → 기본 자동편성 → 후보 검사 → 수동 수정/새 후보 → 영향 검토 → 승인 배포`다. 필수 입력은 수업·시수·담당·공간·불가시간·고정칸·수강/학급 관계다. soft 최적화보다 hard 충족을 먼저 판정한다. AI는 사용자 의도와 설명/요청 초안을 맡고 solver와 검증기가 타당성을 판정한다.

확정 변경은 공통 권한 잠금 뒤 관련 teacher/space/class/group/student 자원키를 정렬해 `lock_resources()`로 획득한다. 불가시간 등록·수강명단 변경·공간 예약·배포·교체가 같은 키를 사용한다. READ COMMITTED에서 잠금 뒤 최신판·권한·시간 겹침을 다시 읽고 모든 대상 lesson의 기대판을 한 트랜잭션에서 비교한다. 일부만 교체하지 않는다. rollback은 과거 상태 덮어쓰기가 아니라 현재판 기준 역변경 요청이며 이후 동의·보강·실시·다른 교체 영향이 있으면 재검토한다.

## 8. 명령·오류·인덱스·수용시험

| 명령 | 원자 단위 / 실패 |
|---|---|
| `cmd_roster_import_apply` | 승인된 import manifest+명부/기간/담당+receipt. 후보 누락=전출 아님. 이름만 같은 자동 병합 금지. |
| `cmd_save_observation/cmd_correct_observation/cmd_withdraw_observation` | owner/학생 identity+당시 관계+불변판+gate+파생 영향. `IDENTITY_FROZEN`, `RELATION_NOT_VALID`, `VERSION_CONFLICT`. 최종 API 이름·입력은 05가 정본이다. |
| `cmd_classroom_import_apply/remap/adopt` | 정확한 원자료판·mapping판·교사 확정·채택·target판을 함께 저장. `MAPPING_CHANGED`, `ADOPTION_CHAIN_MISSING`, `SOURCE_BLOCKED`. |
| `cmd_assessment_confirm` | 루브릭판/항목/근거 검사+교사 확정 새판. `RUBRIC_MISMATCH`, `EVIDENCE_NOT_CONFIRMED`. |
| `cmd_record_review/export` | 위 5.2 전체 재검사, 출력 manifest/receipt. `EVIDENCE_CHANGED`, `RULE_SET_UNCONFIRMED`. |
| `cmd_timetable_publish/change_confirm/execution_record` | 자원 잠금·최신판·승인/동의·점유·실시/원장+outbox. 충돌은 해당 자원/시각만 반환하고 다른 교사 개인 사유는 비공개. |

새 인덱스는 `adoptions(mapping_id,mapping_revision)`, `source_item_revisions(school_id,source_item_id,local_revision DESC)`, `participant_mapping_revisions(mapping_id,revision DESC)`, `evidence_links(source_type,source_id,source_revision_no)`, `record_exports(school_id,draft_id,revision_no)`, 미해결 impact `(owner_account_id,state)`를 기본으로 한다. 실제 EXPLAIN과 최소/최대 학교 합성자료로 확인하고 본문 전체 공용 인덱스를 만들지 않는다.

| 시험 ID | 반드시 관측할 결과 |
|---|---|
| SI01 / R04 | A 근거로 검토한 초안을 B로 UPDATE하면 즉시 거부. 방어적으로 오염된 fixture를 만들어도 출력에서 거부. |
| SI02 / R05 | mapping A→B→A 후 기존 채택은 stale. 동일 학생의 새 연결판도 재확인 전 자동 복귀하지 않음. |
| SI03 / R06 | classroom origin+문자열 origin_ref만 있고 adoptions 0개이면 확정 커밋/출력 거부. 원자료 철회 후도 동일. |
| SI04 | 같은 학교 다른 owner, 다른 학교 같은 owner, 다른 학생의 학적/수강/평가판 모두 FK/검증기에서 거부. 관리자 COUNT도 0. |
| SI05 | 원문 v2 또는 최신 mapping판을 먼저 넣고 머리 pointer 갱신이 늦어도 v1을 새 근거로 사용하지 못함. |
| SI06 | 독립 두 연결: 정정이 먼저 gate 획득 후 commit하면 검토/출력 실패. 반대 순서에서는 정정이 기존 출력의 영향 상태를 남김. |
| SI07 | CSV 같은 파일 같은 활동 멱등, 다른 활동 독립, 행 순서 변경/동명이인/누락/빈답/다중줄/BOM/수식문자 보존. |
| SI08 | 자동 사건 중복·역전·취소·삭제 뒤 재전송·다른 school payload 거부. 원문판/학생 확인 없이 점수 확정 0. |
| SI09 | 전출·재임용·담당 종료·작년 기록 정정에서 본인 허용 범위만. 후임 인계 manifest에 개인 기록 0. |
| SI10 | 미제출은 NULL, 실제 0은 scored; 미확인 규칙은 not_checked; 질문은 문장으로 출력하지 않음. |
| SI11 | 파기 후 DB/파일/AI/색인/출력 잔존 중 하나라도 있으면 partial. 외부 PC 파일은 별도 확인 불가 표시. |
| TT01 | 확정 출장 등록과 교체의 두 연결 경합에서 하나만 충돌 없이 커밋. 잠금 없는 사전 검사만으로 통과하지 않음. |
| TT02 | 선택분반 학생/팀티칭/변칙 교시 겹침 탐지. 미검증 학교형은 배포 불가 사유를 제시. |
| TT03 | 배포/교체/원복/실시 정정 후 보강 누계 이중 계상 0, 원판 이후 변경은 조용히 소실되지 않음. |

완료 순서는 기반 권한/파일/원장 → 명부·관계·개인 관찰 → CSV·정확 채택 → AI 출처/평가/생기부 → 시간표 별도 승인 재개다. 표 생성만으로 기능 완료라고 판정하지 않는다. 이 문서의 새 FK를 포함하는 표/검증 함수/정책/시험은 같은 구축 묶음에서 배포한다.


---

<!-- SOURCE: 04-ai-knowledge-jobs.md -->

# 04. 지식·Claude·개인 비서·긴 작업 통합 계약

> 2026-10-12 · 완성 사이트용 **DB 설계 제안**. 실행 SQL과 운영 보안·모델·비용 설정을 변경하지 않는다. `workhub.knowledge_documents/knowledge_revisions/knowledge_chunks/conversations/ai_runs/messages/tool_proposals/tool_runs/memories/usage_events/jobs/job_attempts/outbox` 등 Claude 2차의 실제 이름을 유지한다. GPT의 typed 근거와 권한·동시 정정 계약을 결합한다. 변경 열·표 목록은 `student-ai-changes.json`, 공통 주체와 권한은 01, 학생 사슬은 03이 기준이다.

## 1. 무엇을 분리하는가

학교 지식, 교사의 대화, AI의 한 번 실행, 사용자 확인 카드, 실제 업무 명령, 외부 공급자 호출, 비용 계측은 서로 다른 기록이다. AI 응답·확인 카드·job 성공은 학교 업무의 실제 확정 사실을 대신하지 않는다. 작업자 재시도나 대화 재접속이 쓰기 권한을 새로 만들지 않는다.

R11은 서비스 주체의 active·허용 action·현재 scope grant를 실제 실행마다 확인하는 계약이다. R12는 외부 호출 뒤 결과가 불명확한 상태를 임대 만료로 숨겨 다시 실행하지 못하게 하는 계약이다. 두 계약은 DB 함수·domain command·worker를 함께 묶어 수용시험으로 검증한다.

## 2. 학교 지식의 원본·판·검색

| 기존 표 | 유지/보강 사항 |
|---|---|
| `knowledge_documents` | 문서 정체성, school/common scope, authority, 책임자, 대상. 학교 자료를 common으로 UPDATE하지 않는다. 공통화는 원학교/원문서/권리·승인과 새 common 문서를 만든다. |
| `knowledge_revisions` | 원문 해시·파일·등록/검토/게시·시행기간·색인 상태를 분리. 원문 내용·파일을 바꾸면 새 revision. 효력기간이 겹치는 published판은 기존 EXCLUDE로 차단한다. |
| `knowledge_chunks` | 정확한 revision과 location(쪽/조/항/표/행), body, 본문 해시. chunk를 다른 판으로 이동하거나 본문만 UPDATE하지 않는다. 재추출은 새 추출판/명시적 교체 절차다. |
| `knowledge_conflicts` | 상충 문서의 관계와 해소 사실. authority 숫자 하나로 모든 특례·시행일 우열을 자동 판정하지 않는다. |

학교 지식에도 `visibility=school/audience/private`를 명시한다. 기존 audience_set_id가 있으면 audience, 없으면 school로 이관 후보를 만들되 private 원문을 조용히 공개하지 않는다. private는 proposed_by_account_id 본인만 읽고, 관리자는 게시 절차의 메타데이터만 받는다. 공통 범위는 visibility=common이며 service_operators 등록만으로 게시할 수 없고 현재 `operator_grants`의 common 게시 권한이 필요하다.

검색은 현재 주체·범위·학교/소속·ACL·기준일 → 검토/게시·시행판 → 적용 학교급/지역/학년도 → 검색 후보 순서다. 본문 검색 뒤 학교를 거르는 구현을 금지한다. 반환 직전에 원본 철회/파기/권한을 다시 확인한다. 미색인·추출실패·표 누락·근거 없음은 정상 답변과 구분한다. 미래 시행판이 있어도 현재 질의는 현행판을 사용한다. 문서·학생 답변 속 명령은 데이터이며 권한 또는 도구 사용 지시로 실행하지 않는다.

기본 검색은 실제 한국어 질의 표본으로 검증한 문자·제목·조문·메타데이터 검색이다. embedding은 Claude 채택과 별도 공급자·비용·학생자료 전송 승인 대상이다. 이 설계는 모델명·차원·단가를 임의 확정하지 않는다. 향후 embedding을 도입하면 모델/차원/입력정책판별 색인을 분리하고 ACL 및 삭제 전파를 똑같이 적용한다.

## 3. 대화와 재임용·학교 전환

`conversations`에 `origin_membership_id text?`를 추가한다. scope=school이면 NOT NULL이고 `(school_id,origin_membership_id,owner_account_id)`가 memberships의 같은 학교·계정 복합키를 참조한다. scope=account_private이면 NULL이다. scope, school, owner, origin_membership는 불변이다.

학교 대화 열람은 본인 계정 AND 생성 소속이 현재 유효 AND 학교 유효 AND 자료 차단 아님이다. 같은 계정의 새 소속으로 재임용돼도 과거 대화가 자동으로 열리지 않는다. 학교를 바꾸면 새 대화이며 이전 첨부·질문·학생 목록·기억을 자동 주입하지 않는다. 반면 학생 개인 기록의 소유는 03의 owner account를 유지하며, 새 대화에서 과거 본인 근거를 참조하려면 현재 접근·담당/과거 정정·보존 정책을 별도로 통과해야 한다.

개인 대화는 순수 개인 이용 자격이 있는 계정만 사용한다. school_id/학생/학교 문서/학교 파일을 연결하지 않는다. common 지식의 허용된 게시판은 사용할 수 있지만 학교 대화 메시지를 개인 기억으로 복사하지 않는다. 학교 자료가 섞인 입력은 거부/학교 대화로 명시적 이동 안내 대상이며 자동 이관하지 않는다.

`ai_runs`에도 origin_membership_id를 추가한다. conversation이 있으면 scope/owner/origin이 정확히 일치하고, 브리핑처럼 conversation이 없으면 서버가 현재 소속을 고정한다. 학교 실행은 origin 소속에 묶이며 권한 회수 후 기존 실행 결과를 새 membership에 전달하지 않는다. `messages`는 같은 conversation의 run만 참조하는 기존 복합 FK를 유지한다. 메시지 원문은 주인만 읽고 로그/지원용 JSON에 포함하지 않는다.

## 4. typed AI 실행 근거

신규 `ai_run_sources`는 자유 JSON의 출처 목록을 권한/정정 원장으로 사용하지 않기 위한 표다. 표시용 메시지 인용과 별개이며 다음 구조를 사용한다.

| 열 | 형식 / NULL / 제약 |
|---|---|
| id | text PK DEFAULT UUID text |
| scope_key, run_id, owner_account_id | text NOT NULL. `(scope_key,run_id,owner_account_id)` → ai_runs의 기존 UNIQUE. |
| school_id | text NULL. school 실행이면 run.school_id와 같고 개인 실행이면 NULL. |
| kind | text NOT NULL: knowledge_revision/knowledge_chunk/document_revision/observation_revision/assessment_revision/source_item_revision |
| knowledge_revision_scope_key, knowledge_revision_id / knowledge_chunk_scope_key, knowledge_chunk_id | text NULL. revision 또는 chunk **하나의 쌍**만 선택하며 각각 scope+ID MATCH FULL FK. 선택하지 않은 쌍은 둘 다 NULL이다. chunk에서 revision을 파생해 서로 다른 판을 섞지 못한다. |
| document_id, document_revision_no | text/integer NULL. 선택 시 둘 다 필수, `(scope_key,document_id,revision_no)`로 정확한 문서판 참조. 해당 공유/개인 문서 ACL을 별도 검사한다. |
| observation_id, observation_revision_no | text/integer NULL. 학생 근거는 `(school_id,owner_account_id,observation_id,revision_no)` → observation_revisions의 작성자 포함 UNIQUE. |
| assessment_id, assessment_revision_no | text/integer NULL. 같은 owner·학교의 정확 평가판 복합 FK. |
| source_item_id, source_local_revision | text/integer NULL. 같은 owner·학교의 원자료판 FK. 원자료는 활동 정리/채택 보조에만 쓰며 생기부 생성 purpose에는 직접 허용하지 않는다. |
| source_sha256, locator, locator_sha256, authority_version, evidence_epoch | text/jsonb/text/bigint/bigint?. 해시·원문위치·위치의 정규화 지문·권한판·학생 gate epoch. 본문 복제 필드 없음. |
| state, invalidated_at, invalid_reason | active/stale/withdrawn/blocked 및 시각/코드. 한 번 무효화한 근거행을 재활성화하지 않고 새 run을 만든다. |

kind에 대응하는 원본 ID 묶음 정확히 하나만 존재하도록 CHECK한다. 모든 복합 FK에서 부분 NULL이 검사를 건너뛰지 않도록 쌍 존재 CHECK 또는 MATCH FULL을 사용한다. 지식 출처는 실행 scope가 허용하는 common 또는 본교만, 개인 실행은 common만 허용한다. 학생 근거는 school scope 전용이고 상담은 kind에 없다. 본인 shared 문서 외 다른 교사 공개 문서도 현재 ACL이 허용하면 인용할 수 있으므로 문서 저자와 run owner의 동일성은 강제하지 않는다.

source_item_revisions의 created_by_account_id를 owner로 해석하기 전에 부모 source_items.owner와 일치를 DB 제약으로 보장한다. 학생 원본판의 owner 포함 UNIQUE도 해당 부모 owner와 일치하는 작성자 FK가 전제다. run→conversation.owner/origin, source→원본.owner/학교/판 모두 동시에 맞아야 한다.

원본 정정·철회·파기는 원본의 scope gate 또는 03의 student_evidence_gates 아래 수행하고 ai_run_sources를 통해 영향 run/messages/memories/document/record를 찾는다. 직접 영향은 동기 차단하고 대량 텍스트 가림·삭제는 outbox 작업으로 전파한다. 오래된 메시지를 다시 읽거나 후속 질문 맥락에 넣을 때 현재 원본권한/차단을 검사한다. `needs_review` 표시만 늦게 갱신된다는 이유로 금지된 원문을 다시 AI에 보내지 않는다.

## 5. Claude 정책판·프롬프트·비용 사실

신규 `ai_policy_versions`는 provider='anthropic', model_identifier, prompt_template_ref, prompt_sha256, tool_registry_version, allowed_data_categories, limits jsonb, cache_policy_ref, pricing_reference, approved_by_account_id, approval_ref, approved_at, effective_from/to, state를 가진다. 본문·비밀키를 저장하지 않는다. limits는 승인된 max_tokens/도구호출/동시실행/예산 등이며 이 문서는 숫자를 채우지 않는다. 승인·효력 조건이 없는 정책판은 실행 불가다. 정책 내용은 불변이고 중단·새판 도입만 가능하다.

`ai_runs.policy_version_id`는 정책판 FK이고 기존 model_config_version/prompt_version/tool_contract_version은 정책판과 일치하는 당시 사본이다. 서버가 선택하며 모델이 넘긴 이름·수준을 믿지 않는다. 실제 조립한 시스템 프롬프트와 검색 원문은 브라우저·작업 상세·지원 화면·감사에 노출하지 않는다. 내부 진단에 원문이 꼭 필요하면 별도 승인된 제한 저장소/기간을 사용하며 기본 DB 계약에는 넣지 않는다. 사용자가 쓴 자기 메시지와 숨겨야 할 시스템 프롬프트를 혼동하지 않는다.

`usage_events`의 토큰 DEFAULT 0을 제거하고 NULL=미확인, 0=공급자가 보고한 실제 0으로 구분한다. input/output/cache read/cache write는 bigint NULL이고 음수 금지다. metering_state는 unknown/estimated/reported, provider_request_id, external_call_id, attempt_no, pricing_reference, currency, cost_amount를 기록한다. 단가·통화·예산 귀속은 승인된 정책판에서 온다. 모델 응답 timeout을 비용 0으로 적지 않는다.

외부 호출당 측정은 고유 키로 중복 생성하지 않는다. 미확인 측정의 늦은 보고는 같은 행을 서버 계측 명령으로 unknown/estimated→reported 한 방향 갱신하고 원래/정정 측정 이력은 audit의 값 없는 사건 또는 별도 명시적 adjustment로 남긴다. reported 수정을 숨겨 덮어쓰지 않는다. 조정 이벤트는 원측정 ID와 요청키를 고정하고 집계는 원측정+조정의 계약을 따른다. 학교 관리자는 비용·실패율 합계만, 교사는 자기 실행 요약만 보며 학생 본문·프롬프트가 비용 원장에 들어가지 않는다.

## 6. 확인 카드와 실제 도구 명령

기존 tool_proposals의 normalized payload/hash·object_versions·영향·만료를 유지하고 origin_membership_id, permission_version, affected_subjects_sha256, tool_registry_version을 추가한다. 도구 수준은 승인된 서버 registry에서 결정한다. 표시한 영향과 실행할 영향이 같아야 하며 대상 version/권한/원자료판/명단/설정이 바뀌면 stale로 만들고 재확인한다.

`cmd_confirm_proposal`은 공통 잠금→현재 계정·origin 소속·정책·만료→registry/schema→정규화 payload 및 영향 재계산→기대판 비교→tool_runs claimed 유일 선점→해당 domain command와 동일 멱등 키→receipt/result/outbox를 묶는다. 확인자는 실행자이며 다른 관리자 확인을 필요한 전문 승인으로 대체하지 않는다. 고위험 최종 확정은 전문 화면, 대량 삭제·권한 변경은 일반 AI 도구에 제공하지 않는다.

기존 부분 UNIQUE `tool_runs_one_exec`와 claimed→succeeded/failed/indeterminate 전이를 유지한다. failed는 아무 효과도 반영되지 않았다는 확인이 있을 때만이다. 불명확은 재실행 금지이며 실제 원장·공급자 결과를 조사해 사후 확정한다. 내부 DB 도구는 domain write와 receipt가 같은 트랜잭션에서 성공하고 외부 도구는 아래 job_external_calls가 추가 경계다.

## 7. R11: 작업 주체의 현재 권한

01이 정의하는 `service_principals` 및 신규 `service_principal_scopes`를 참조한다. 사람 작업은 owner_account_id만, 서비스 작업은 service_principal_id만 존재한다. `owner_account_id IS NULL ⇒ 접근 허용` 분기를 제거한다.

| 작업 scope | 필수 주체·범위 |
|---|---|
| school / `s:<school_id>` | 현재 학교에 유효한 요청자 origin_membership 또는 해당 학교 scope grant를 가진 서비스 principal. 학교·서비스 기능 gate도 유효. |
| account_private / `a:<owner>` | 개인 이용 자격이 있는 요청 계정만. 서비스 principal scope grant를 만들지 않는다. 학교 자료 참조 금지. |
| common / `c` | common action이 허용된 active 서비스 principal 또는 승인된 플랫폼 권한의 사람. 학교 관리자 자격만으로 불가. |
| service / `svc` | 전역 복구/운영의 명시적 active principal+service grant. 학교 파기 작업은 service scope로 우회하지 않고 school scope. 순수 개인자료의 승인 파기만 아래 제한 예외를 적용한다. |

jobs는 기존 CHECK를 scope 네 종류로 보강한다. `scope_key`는 NOT NULL 저장 생성 열이며 최종 생성식은 `CASE scope WHEN 'school' THEN 's:' || school_id WHEN 'account_private' THEN 'a:' || owner_account_id WHEN 'common' THEN 'c' WHEN 'service' THEN 'svc' ELSE NULL END`다. 원본의 `ELSE 'c'` 식을 계승하지 않는다. 허용 scope CHECK와 생성 열 NOT NULL이 알 수 없는 범위·필수 ID 누락을 함께 거부한다. 서비스 scope와 common의 key를 구분하며 school_id NULL이라는 사실로 추정하지 않는다. `origin_membership_id`는 학교 사람 작업에 필수, 그 밖에 NULL이다. scope/주체/종류/입력 해시/원요청 ID는 생성 후 불변이다.

순수 개인자료의 승인 파기는 퇴직·계정 종료와 독립적으로 완료해야 한다. 따라서 account_private에 포괄 서비스 grant를 주는 대신, **scope=service·kind=deletion_process·현재 service grant의 허용 action**을 가진 전용 명령만 정확히 한 계정의 승인된 deletion_ledger와 불변 manifest를 처리할 수 있다. 실행 scope와 자료 scope/account를 모두 기록하며 manifest 범위 밖 읽기/쓰기·AI 전송·결과 공개는 금지한다. 일반 job의 scope 일치 검사에서 이 승인 파기 경로 하나만 명시적으로 예외 처리하고, 학교 자료 파기는 항상 school scope에 둔다. 원장 ID만 전달하면 통과하는 예외가 아니라 승인 상태·대상계정·manifest hash·현재 principal 권한을 모두 잠금 뒤 재검사한다.

`job_actor_allowed(job,action)`는 principal.active, action=ANY(allowed_actions), 현재 기간·미회수 scope grant, 학교/서비스 gate, 사람 계정·origin 소속·현재 역할/정책을 검사한다. 작업 생성뿐 아니라 **claim·heartbeat·외부 호출 시작·finish·domain 결과 공개** 때 다시 검사한다. 사람 역할이 필요한 작업은 단순 학교 소속만 보지 않고 kind registry의 현재 permission을 검사한다. 요청자와 실제 worker ID를 분리한다.

**B01 선행조건:** 서버가 검증한 DB 실행 identity를 승인된 service_principal로 해석하는 01의 공통 주체 경계를 worker 도입 전에 마련한다. 요청자가 넘긴 principal ID, 임의로 설정 가능한 GUC, worker_id 문자열 자체는 주체 증명이 아니다. 실제 서비스 주체를 확인할 수 없으면 claim·heartbeat·외부 호출 시작·finish·감사 쓰기를 모두 거부한다. 사람 요청 작업을 worker가 수행할 때도 원요청자 권한과 실제 worker의 허용 action·현재 실행 범위를 각각 검사한다. DB 연결이 service role이라는 이유만으로 특정 principal이나 모든 학교 권한을 부여하지 않는다.

서비스 principal 및 scope grant 읽기는 FOR SHARE, 회수는 FOR UPDATE/UPDATE를 사용한다. 공통 잠금 순서는 01과 동일하다: `accounts/서비스 principal(정렬) → schools/service_switches/platform·service grant → memberships → 역할/정책 → 멱등 advisory → 근거 owner gate → 원본 종류/ID → files → receipt/audit/outbox`. 기존 job_claim/job_finish가 job 행부터 잠그는 순서를 바꿔야 한다. 사전 무잠금 조회는 잠금할 주체 ID를 찾는 용도뿐이며 immutable identity를 잠금 뒤 재확인한다.

권한을 잃으면 cancel 또는 pause 정책을 적용하고 결과를 공개하지 않는다. 이미 시작한 외부 호출은 비용·실행 여부를 사실대로 남기되 결과물을 요청자에게 반환하지 않는다. 권한 회수 후 재임용된 다른 membership으로 자동 재개하지 않는다. 사람이 새 요청을 명시적으로 생성해야 한다.

## 8. R12: 외부 호출과 임대는 서로 다른 상태다

기존 jobs/job_attempts의 lease_token fencing, heartbeat, checkpoint, attempt 원장을 유지한다. 임대 만료는 작업자가 응답하지 않는다는 사실이며 외부 호출 미실행의 증거가 아니다.

신규 `job_external_calls`의 필수 열은 id, scope_key, job_id, attempt_no, lease_token, call_key, provider, operation, request_sha256, state, started_at?, provider_request_id?, safe_result_ref?, result_sha256?, result_bytes?, finished_at?, safe_error_code?, resolution_ref?, resolved_by_account_id?다. FK `(scope_key,job_id)` 및 `(job_id,attempt_no,lease_token)`으로 정확한 시도를 참조한다. UNIQUE(job_id,call_key), provider_request_id가 있으면 provider/operation과 함께 고유하다. safe_result_ref는 operation registry가 정의한 kind·scope_key·불변 대상 ID/판 또는 최소 receipt만 받는 검증된 제한 결과 참조이며 임시 서명 URL을 포함하지 않는다. 요청 원문·응답 원문·credential은 넣지 않는다.

`state='response_received'`는 **safe_result_ref, result_sha256, finished_at이 모두 존재하고 같은 트랜잭션에서 검증·저장된 경우에만** 허용한다. 참조 scope는 external call/job의 실행 scope와 같아야 하며 등록된 kind 처리기가 실제 대상 존재·정확한 불변판·읽기/쓰기 허용·hash 일치를 검사한다. 파일 등 실물이 필요한 operation은 영속 실물의 보관·hash·bytes 확인을 먼저 마치고, NOT NULL·0 이상의 result_bytes와 DB 참조·상태를 함께 커밋한다. DB 원자 커밋 전에 안전하게 보관한 고아 실물은 정리 대상이며 그 자체를 외부 호출 재실행 허가로 보지 않는다. 결과 본문이 없는 operation도 registry가 정한 최소 완료 receipt를 같은 scope로 저장하고 그 정규화 지문을 result_sha256에 남긴다. 순수 개인자료 파기 예외의 receipt는 실행 scope=svc에 속하며 승인 manifest를 가리키는 제한 메타만 갖는다.

결과 참조·hash·bytes는 첫 보관 뒤 불변이며 일반 갱신으로 다른 결과를 끼워 넣을 수 없다. 보존 정책에 따른 결과 파기·차단은 전용 lifecycle 경로로 공개/재개를 막고 최소 tombstone을 유지하며, 과거 외부 효과를 새로 실행해도 된다는 상태로 되돌리지 않는다. 응답을 실제로 수신했더라도 결과 보관 트랜잭션 전에 종료되면 request_started가 남고 이후 unknown으로 조사한다. 응답을 받았다는 메모리상의 사실만으로 response_received를 먼저 커밋하는 경로는 없다.

상태 전이는 다음과 같다.

```text
prepared → request_started → response_received
         ↘ cancelled       ↘ unknown → confirmed_succeeded
                                      ↘ confirmed_not_run
```

`prepared`는 안전한 요청 지문을 기록한 상태이고 실제 호출 전에 `request_started`를 별도 트랜잭션으로 커밋한다. 정확히 이 이후 프로세스가 죽으면 외부에 요청이 전달됐는지 모를 수 있으므로 unknown이다. 공급자가 응답을 보내기 전에 request ID를 알 수 없는 경우에도 call_key/request hash로 외부 시작 사실을 남긴다. 공급자의 멱등 기능은 공식 계약과 실제 검증이 있는 경우에만 사용하며 존재한다고 가정하지 않는다.

| 상황 | claim/reap/재시도 정책 |
|---|---|
| 만료된 running, 외부 단계 없음 또는 prepared만 있음 | 기존 작업의 안전한 checkpoint에서 재인수 가능. attempt/lease를 증가시킨다. |
| request_started 또는 unknown인 외부 단계가 있음 | `job_claim`은 토큰을 새로 주지 않고 `EXTERNAL_OUTCOME_UNKNOWN`; reap은 indeterminate. 단순 attempts 여유로 queued에 넣지 않는다. |
| 응답 수신 후 결과 참조·hash 원자 보관 전 worker 종료 | request_started→unknown으로 조사하며 자동 재호출 0회. 실제 수신 여부만으로 완료 상태를 만들지 않는다. |
| response_received, 업무 결과 공개 전 worker 종료 | 영속 결과 참조·hash가 이미 원자 보관된 상태다. 공급자 재호출 없이 해당 결과를 재검증해 domain finalize만 재개한다. 공개 직전 현재 권한·근거를 재검사하고 실물이 없거나 파기됐으면 결과 불가로 차단한다. |
| confirmed_not_run | 사후 확인 근거/권한/승인된 재시도 정책에 따라 새 attempt와 새 call_key를 만든다. 예전 호출 기록을 지우지 않는다. |
| confirmed_succeeded | 기존 효과를 조사·연결한다. 같은 효과를 다시 실행하지 않는다. |

기존 job_note_external은 열린 호출 행의 provider_request_id를 한 번 채우는 경로로 제한한다. 호출 사실을 그 함수 하나만으로 표현하지 않는다. `job_reap('failed')` 기본값만으로 불명확 외부 단계를 확정 실패로 바꿀 수 없으며 현재 외부 단계로 결과를 계산한다. 관리자·worker가 outcome 문자열만 선택해서 unknown을 지우지 못한다. job_attempts의 lease_lost는 외부 효과의 failed와 다르며 external call의 unknown 상태를 보존한다.

옛 worker의 token은 jobs, job_attempts, external call, 문서/생기부 결과 공개 어디에서도 유효하지 않다. 외부 공급자의 늦은 응답은 제한된 수신 경로에서 해당 call_key에 연결해 사실을 보완할 수 있으나 예전 lease로 domain 성공을 확정하지 않는다. DB 트랜잭션 잠금은 외부 네트워크 호출 동안 유지하지 않는다.

## 9. 접수증·감사·outbox·기억

idempotency_receipts는 actor+scope+operation+request_key+payload_hash를 묶는다. 재조회 때 현재 권한·원본 차단을 검사하고 예전 성공 JSON에 민감본문·명단·서명 URL을 저장하지 않는다. 다른 payload를 같은 키로 보내면 conflict다. receipt는 domain write와 같은 트랜잭션이며 job 예약도 같은 범위에서 커밋한다.

audit_events는 실제 actor_account_id 또는 actor_service_principal_id XOR이며, support_session이 있으면 그 실제 지원자와 일치한다. job 요청자와 worker는 별도 필드다. 변경 전후 원문 snapshot은 금지하고 ID·판·action·사유 코드·요청 ID만 저장한다. service_principals의 allowed_actions를 감사 action 전체 문자열과 무조건 동일시하지 않고 kind→필요 action registry로 검증한다.

모든 명령·worker는 B01에서 먼저 제공하는 공통 `write_audit(context)`를 사용한다. context는 검증된 DB identity와 서버가 확인한 현재 요청/worker 범위에서 만든 내부 구조이며 브라우저가 actor를 지정하는 공개 API가 아니다. 함수는 실제 사람/서비스 actor, 필요한 현재 membership, support_session의 실제 지원자, job의 원요청자와 실제 worker를 구분해 검증하고 기록한다. 서비스 actor는 §7의 DB identity→principal 결합을 재사용하며 actor 누락·임의 principal 대입·두 actor 동시 입력을 거부한다. domain 변경·정확한 판·접수증·필수 audit·outbox를 한 트랜잭션에서 처리하고 감사 검증/INSERT 실패는 전체 실패다. 각 기능이 빈 actor 감사 INSERT를 따로 구현하거나 감사 실패만 무시하는 fallback을 두지 않는다.

outbox는 원본 변경과 함께 INSERT, event/aggregate/version으로 중복 방지한다. 본문·학생 명단을 payload에 넣지 않는다. 전송 worker도 lease token으로 선점하고 소비자는 사건 키로 멱등 처리한다. 접근 회수·원본 삭제 뒤 도착한 사건은 더 넓은 데이터를 재조회하거나 알림 본문을 복원하지 않는다. 실패는 지수 지연/최대 정책판과 dead 상태로 노출하되 실패 메시지에 원문을 담지 않는다.

memories에 origin_membership_id를 추가하고 대화와 같은 scope/생성 소속 불변 규칙을 적용한다. candidate→사용자 확인 active→paused/revoked/expired/invalidated/deleted, 역방향 자동 부활 금지다. 기존 usable_memories가 만료·출처 최신판을 검사하는 구조를 유지하되 현재 origin 소속·현재 원본 ACL까지 확인한다. 원자료 정정·철회·대화 종료·소속 종료는 즉시 재사용 차단과 파생 가림/파기 대상으로 이어진다. 학생 성향/위험등급의 추정을 장기 기억으로 자동 저장하지 않는다.

## 10. 인덱스·오류·수용시험

추가 인덱스는 ai_run_sources(run_id), 종류별 정확 원본 ID/판 partial index, (scope_key,owner_account_id,state), conversations(owner_account_id,origin_membership_id,updated_at DESC), jobs(state,next_attempt_at) queued partial, job_external_calls(job_id,state), unknown 외부 호출 partial, usage_events(external_call_id), outbox(state/기존 전송상태,available_at)이다. 실제 기존 열 이름에 맞춰 SQL을 확정하고 인덱스 추가만으로 권한 필터를 대신하지 않는다.

표준 오류는 ACTOR_INACTIVE, PRINCIPAL_ACTION_DENIED, PRINCIPAL_SCOPE_DENIED, ORIGIN_MEMBERSHIP_ENDED, SOURCE_UNAVAILABLE, EVIDENCE_CHANGED, CONFIRMATION_STALE, LEASE_LOST, EXTERNAL_OUTCOME_UNKNOWN, POLICY_UNSET, IDEMPOTENCY_CONFLICT다. 외부에는 존재 여부를 드러내지 않는 RESOURCE_UNAVAILABLE 계열로 필요시 매핑하며 내부 코드에도 학생본문/키를 담지 않는다.

| 시험 | 관측 기준 |
|---|---|
| AI01 | 같은 학교 다른 교사의 관찰, 다른 학교 본인 기록, knowledge chunk와 다른 revision 혼합은 FK/명령 양쪽 거부. |
| AI02 | 개인 run에 학교 파일·학생 근거·학교 대화 인용 불가; 허용 common 지식만 가능. |
| AI03 | 생성 membership 종료 후 새 membership으로 재임용해도 과거 conversation/run/memory 0건. 새 대화에서 정책상 허용된 본인 과거 학생 근거만 별도 사용. |
| AI04 | 원본 정정과 AI 결과 확정의 두 연결 경합에서 gate 순서에 따라 새 결과는 미검토/거부. 비동기 전파 지연에도 정상 공개 0. |
| AI05 | 확인 뒤 payload/권한판/영향명단/대상판/도구 registry/만료 중 하나 변경 시 기존 proposal 쓰기 0회. 동시 claim 2개에서 domain write·receipt 1개. |
| AI06 / R11 | inactive principal, allowed_action 불일치, 다른 학교/common grant, 만료/회수 grant 모두 생성·claim·heartbeat·finish·publish 거부. |
| AI07 / R11 | 실제 두 연결: 권한 회수가 먼저 커밋하면 worker 성공 공개 실패; worker 확정이 먼저면 회수 이후 모든 조회/다운로드 차단. 같은 gate 충돌을 barrier로 관측. |
| AI08 / R12 | request_started+외부 request ID+임대 만료에서 즉시 claim token 증가 0. indeterminate/unknown 사실 유지. |
| AI09 / R12 | request ID가 아직 없는 호출 전송 직후 crash도 자동 재호출 0. prepared만 있으면 안전한 재인수 가능. |
| AI10 | worker A 만료→B 인수 후 A의 heartbeat/결과/문서 공개 전부 거부. 늦은 응답은 외부 사실 확인으로만 수신. |
| AI11 | timeout 계측은 tokens/cost NULL+unknown, 실제 0은 reported 0. 같은 공급자 보고 두 번 수신해도 비용 중복 0. |
| AI12 | 삭제 뒤 messages/memories/chunks/파일/캐시/출력 중 하나 잔존하면 완료 불가. 이미 사용자 PC에 내려간 파일은 회수됐다고 표시하지 않음. |
| AI13 | 로그·지원 JSON·job progress/result·audit·outbox·usage에 시스템 prompt/학생원문/키 없음. |
| AI14 | 운영자등록만 있고 common 게시 grant가 없는 계정은 게시·공통 파기·복구 실행 불가. |

기존 762 시험은 회귀 기반이며 새 R04~R06/R11/R12 시험을 추가해야 한다. 실제 PostgreSQL 목표 버전의 독립 두 연결 시험, Supabase Auth/PostgREST/Storage/RLS, 실제 worker 재시작/응답유실, UI 권한회수와 다운로드를 별도 확인한다. 외부 공급자 테스트는 승인된 키·비용 정책이 있는 환경에서만 하고, 설계 문서 작성 단계에서 실행하지 않는다.


---

<!-- SOURCE: 05-api-site-contract.md -->

# 사이트와 DB 명령 계약

목표 사이트 M00~M15의 화면은 DB 표를 임의로 조합해 쓰지 않고 아래 읽기 모델과 명령을 사용한다. API 번호는 기능군이며 거대한 단일 RPC를 뜻하지 않는다. 실제 세부 route와 JSON Schema는 이 계약을 구체화한 구현 산출물이다.

## 공통 요청과 결과

변경 요청은 인증 JWT, 명시적 scope, idempotency_key, expected_version 또는 정확한 revision을 받는다. account_id·role·approved 같은 클라이언트 주장으로 주체를 결정하지 않는다. 서버는 auth.uid()→accounts→현재 membership을 해석한다. 명령 수신과 실행 권한을 별도로 검사하며 서비스 요청은 제한된 principal 자격을 사용한다.

request_sha256은 클라이언트 의도를 결정적으로 정규화한 지문이다. 명시적으로 확인한 대상판·파일지문·정책판은 포함하되 서버가 첫 실행에서 선택한 정책/근거판은 별도의 고정 실행 맥락으로 보존한다. 동일 키 재시도에서 현재 정책판을 끼워 넣어 원래 의도를 다시 해시하지 않는다. 같은 실행자/범위/명령/키와 같은 요청 지문은 기존 결과, 다른 요청 지문은 IDEMPOTENCY_CONFLICT다. 기존 접수증은 현재 조회 권한 확인 후 원래 요청 지문과 비교해 반환하며, 새 실행만 현재 정책을 평가한다. UNIQUE 충돌을 이용해 접수의 소유권을 선점하고 동시 중복 실행을 막는다. 먼저 SELECT한 결과가 없다는 이유만으로 접수 소유권 없이 실행하지 않는다.

권한 gate와 원본을 01의 동일 잠금 순서로 확보한 뒤 재검사한다. 업무 변경·정확한 판·접수증·필수 감사·outbox는 한 트랜잭션이다. 실패하면 이 묶음은 모두 롤백한다. 외부 API/파일 전송은 잠금을 잡고 기다리지 않는다. outbox 소비는 적어도 한 번 전달을 전제로 수신측 dedup과 job fencing을 사용한다.

성공 결과는 operation_id, status=committed 또는 accepted, resource(type/id/version), server_recorded_at, next_action을 반환한다. accepted+job_id는 최종 업무 완료가 아니다. 오류는 code, retryable, correlation_id, 안전한 사용자 설명을 제공하며 다른 학교 객체의 존재·본문을 노출하지 않는다.

## 기능군별 계약

### API-01 · M00

- 명령: cmd_ensure_account, cmd_request_membership
- 읽기: my_context / school_directory / join_code_preview / membership_requests
- 표: accounts, schools, memberships, school_join_codes
- 입력: join_code 또는 school_id, request_id, 신청 expected_version
- 권한: 로그인 계정, 최소 학교 찾기, 본인 신청만. 승인 전 업무 조회 불가
- 결과: 계정 맥락·신청 ID·pending/active를 구분
- 필수 시험: 첫 로그인/기존 회원/대기/중복 신청/자기승인 차단

### API-02 · M00 / M15

- 명령: cmd_decide_membership, cmd_grant_role, cmd_end_membership, cmd_set_feature_visibility
- 읽기: school_members / feature_status
- 표: memberships, membership_roles, school_features, school_feature_pilots
- 입력: membership_id, 결정·사유·기간, expected_version, 공개 변경 승인 근거
- 권한: 현재 학교의 해당 관리 권한. 자신을 승인/승격하지 못함
- 결과: 새 membership/permission version, 영향받은 접근·작업
- 필수 시험: 회수와 저장 경합/마지막 관리자 보호/타학교/공개 확대

### API-03 · M01

- 명령: cmd_assign, cmd_submit_profile_claim, cmd_review_claim, cmd_save_duty_note
- 읽기: duty_page / approved_profile / pending_claims
- 표: duties, assignments, profile_claims, duty_notes
- 입력: duty/subject/department/class/course, valid_from/to, expected_version
- 권한: 본인 신고와 공식 배정 분리. 지정 업무/인사 범위의 승인권자
- 결과: 승인 관계와 신고 상태를 별도 반환
- 필수 시험: 중복 기간/미승인 프로필 권한상승/학급·수업 다른학교

### API-04 · M01 / M14

- 명령: cmd_handover_preview, cmd_handover_accept, cmd_handover_apply, cmd_handover_cancel
- 읽기: handover_detail / handover_impact
- 표: handovers, handover_items, handover_acceptances, assignments, collection_units
- 입력: scope, 후임 membership, effective_on, manifest_hash, acceptance_id, expected_versions
- 권한: 원책임자·후임·적용권자 역할을 나누고 활성 후임과 정확한 수락판 확인
- 결과: 기존 의무 ID를 유지한 책임 이동·제외 항목·접수증
- 필수 시험: NULL 수락/내용 바뀐 수락/개인자료 제외/경합/부분적용 0건

### API-05 · M02

- 명령: cmd_save_event, cmd_confirm_official, cmd_cancel_event, cmd_delete_event
- 읽기: events_in_range / event_detail / audience_preview
- 표: events, event_revisions, audience_sets, calendar_days
- 입력: 제목·시간·공개범위·대상판·kind·expected_version·변경사유
- 권한: 공유 일정은 활성 교사 등록. 공식 확정은 별도 권한. 개인 일정 관리자 자동열람 금지
- 결과: 불변 일정판·원본 ID·추천 이유·공식 여부
- 필수 시험: 공식 초안 비노출/학교전환/개인범위/수업일 영향

### API-06 · M02

- 명령: cmd_import_preview, cmd_import_apply, cmd_cutover_source
- 읽기: import_diff / import_result
- 표: source_connections, source_records, source_record_snapshots, import_runs, import_rows
- 입력: connection_id, mapping_version, file_id, baseline_ids, row decisions, expected_versions
- 권한: 연결 담당자만. 사이트 기준으로 전환한 원본을 시트가 덮지 못함
- 결과: 행별 applied/conflict/skipped/error와 기준 위치
- 필수 시험: 3방향 충돌/안정ID없음/미리보기후변경/파일누락삭제 금지

### API-07 · M03

- 명령: cmd_save_task, cmd_set_task_state, cmd_cooperation_create, cmd_cooperation_respond
- 읽기: home_snapshot / my_tasks / assigned_task_status
- 표: tasks, cooperation_requests, events, collection_units, lesson_instances
- 입력: scope·title·task_id·expected_version 또는 협조 응답·대체자
- 권한: 개인 작업은 본인. 배정자는 협조 상태만, 개인 메모 본문은 제외
- 결과: 원본이 연결된 홈 카드·개인 할 일·협조 상태
- 필수 시험: 수합 수동완료 금지/원본-사본 열람 동일/중복 카드/부분조회 실패

### API-08 · M04

- 명령: cmd_open_collection, cmd_publish_collection, cmd_change_collection_schema, cmd_exempt_unit
- 읽기: collection_detail / collection_units_status / publish_preview
- 표: collections, collection_schemas, collection_fields, collection_units, collection_unit_members
- 입력: schema_id/hash·unit definitions·responsible membership·due_at·request/result_visibility·policy_version
- 권한: 게시 권한·대상·정책판. 단위별 하나의 의무. 결과 공개 별도
- 결과: 게시판·고정 의무·단위 ID·면제 이력
- 필수 시험: 같은단위중복/정의판불변/다른수합schema FK/결과공개기본차단

### API-09 · M04

- 명령: cmd_save_draft, cmd_submit, cmd_withdraw_submission
- 읽기: unit_draft / submission_receipt / operation_result
- 표: unit_drafts, submission_versions, submission_files, collection_units
- 입력: unit_id·schema_id·answers·검증 file IDs·expected unit/draft version·idempotency_key
- 권한: 초안은 유효 구성원. 제출/철회는 책임자 또는 유효 대리
- 결과: 불변 제출판·서버 접수시각·review state·완료본 포인터
- 필수 시험: 미래구성원/RLS/동시제출/응답유실/철회후과거본무단복원금지

### API-10 · M04

- 명령: cmd_review_submission, cmd_request_correction, cmd_open_correction_window, cmd_collection_export
- 읽기: submission_review / correction_status / export_status
- 표: submission_reviews, correction_requests, collection_correction_fulfillments, export_manifests, export_manifest_items
- 입력: submission_id/revision·review decision·due_at·reason·selected version IDs
- 권한: 지정 검토자·요청관리자. 과거 제출자/책임자 계정 기준 자기검토 금지
- 결과: 검토 결과·보완 의무·검사된 선택판의 출력 작업 ID
- 필수 시험: 인계후자기검토/충족판철회/보완연체/ZIP부분실패/출력중권한회수

### API-11 · M05 / M15

- 명령: cmd_publish_notice, cmd_ack_notice, cmd_feedback_create, cmd_support_session_grant, cmd_support_session_revoke
- 읽기: notices_for_me / notifications / feedback_status / support_scope
- 표: notices, notice_receipts, notifications, feedback, support_sessions
- 입력: notice revision·수신대상·확인 요청 또는 feedback·지원범위·만료
- 권한: 게시 범위·현재 원본 권한·승인 지원 목적/기간. 읽음≠명시확인
- 결과: 게시판·중복없는수신목록·확인판·문의번호
- 필수 시험: 수신범위회수/수정후확인판/조용한시간/문의민감첨부기본없음

### API-12 · M06

- 명령: cmd_knowledge_upload, cmd_knowledge_create_revision, cmd_knowledge_publish, cmd_knowledge_withdraw
- 읽기: knowledge_revision / extraction_status / publication_preview
- 표: knowledge_documents, knowledge_revisions, knowledge_chunks, knowledge_conflicts
- 입력: file_id·scope·effective interval·school_level/region·verified_text·source locator
- 권한: 제안과 게시 권한 분리. 공통 승격 별도. 원문확인과 시행범위 필수
- 결과: 확인된 게시판·색인 상태·충돌 후보
- 필수 시험: 미확인추출게시불가/시행전후정확판/철회/학교규정공통화금지

### API-13 · M06

- 명령: query_knowledge
- 읽기: search_knowledge / knowledge_index_status
- 표: knowledge_documents, knowledge_revisions, knowledge_chunks
- 입력: scope·query·as_of_date·filters·cursor
- 권한: 검색 전에 범위·학교·시행·대상 필터, 인용 직전 원본 재검사
- 결과: 근거 구간·원문판·쪽/조항·기준일·색인준비상태
- 필수 시험: 권한없는벡터후보유출/현행판미색인/상충자료/전출후캐시

### API-14 · M07

- 명령: cmd_assistant_run, cmd_confirm_proposal, cmd_cancel_assistant_run
- 읽기: conversation / assistant_run_status / proposal_detail
- 표: conversations, messages, ai_runs, ai_run_sources, tool_proposals, tool_runs, jobs
- 입력: scope·conversation_id·message·proposal/hash·expected target versions·confirmation
- 권한: 본인·현재소속·생성소속·도구별 현재권한. 모델이 행동 수준을 바꾸지 못함
- 결과: 근거답변 또는 확인가능한 작업안·실행접수증
- 필수 시험: 재임용/확인후대상변경/중복확인/원문명령주입/외부결과불명확

### API-15 · M07

- 명령: cmd_memory_propose, cmd_memory_confirm, cmd_memory_revoke, cmd_memory_correct
- 읽기: usable_memories / memory_history
- 표: memories, ai_run_sources, conversations
- 입력: memory_id·source refs·content·scope·expires_at·expected_version
- 권한: 본인 확인과 범위·만료·원본 권한. 학교정보를 개인기억으로 자동복사 금지
- 결과: 확인 상태·재사용 가능 여부·정정/중단 이력
- 필수 시험: 미확인기억재사용/근거파기/학교전출/동일교재임용

### API-16 · M08

- 명령: cmd_document_job, cmd_document_validate, cmd_document_export
- 읽기: document_detail / validation_report / job_status
- 표: document_packs, documents, document_revisions, document_revision_sources, document_validations, jobs
- 입력: pack_id/version·input role refs·structured fields·expected_revision
- 권한: 서버가 허용팩판·자산을 선택. 생성/검사/제출은 별도행동
- 결과: 초안판·누락목록·지원수준·검사결과·검증 file ref
- 필수 시험: 기존6양식회귀/작년사실자동승계금지/수정파일재검사/원형보존과내용지원구분

### API-17 · M08

- 명령: cmd_file_init, cmd_file_complete, cmd_file_download, cmd_file_delete_request
- 읽기: file_status / file_grant_status
- 표: file_objects, file_links, file_access_grants, deletion_ledger
- 입력: 원본 종류/ID·media type·size·hash·intent·expected_version
- 권한: 실물과 요청객체 일치·소유관계/원본권한·정책판·사용시점 재검사
- 결과: 검증 상태·현재 권한 다운로드 경로·삭제 접수
- 필수 시험: 경로바꾸기/타학교부모/부모UPDATE/미검사/회수후링크/실물없는ready

### API-18 · M09

- 명령: cmd_timetable_import_preview, cmd_timetable_import_apply
- 읽기: my_lessons / timetable_grid / import_mapping
- 표: bell_schedules, timetable_versions, timetable_placements, lesson_instances
- 입력: school/term·source_file·mapping·기대입력판
- 권한: 지정 담당자. 학교 일과·학기·교사/학급/공간 매핑 확인
- 결과: 명시적으로 구분한 후보/배포판·미매핑 목록
- 필수 시험: 초중고일과/다중학급선택분반/미매핑보류/기존실시보존

### API-19 · M09

- 명령: cmd_start_composition, cmd_validate_candidate, cmd_publish_timetable
- 읽기: composition_status / candidate_diff / publish_impact
- 표: constraint_sets, timetable_constraints, timetable_compositions, timetable_candidates, timetable_version_impacts
- 입력: 조건판/시수/배정·input hash·candidate version·publish confirmation
- 권한: 담당자·확인된 조건판. AI는 필수조건을 임의 완화하지 못함
- 결과: 계산결과/미해결·검증보고·영향명세·배포판
- 필수 시험: 조건변경후후보재검사/수동수정/교사학생공간충돌/실시판보존

### API-20 · M10

- 명령: cmd_change_propose, cmd_change_respond, cmd_change_apply, cmd_change_revert, cmd_confirm_execution
- 읽기: change_candidates / consent_status / execution_ledger
- 표: timetable_change_sets, timetable_change_items, timetable_change_participants, resource_occupancy, lesson_executions, cover_ledger
- 입력: 원수업판·변경항목판·동의hash·승인·expected_versions·실시결과
- 권한: 관련자 동의·지정 승인·실제 담당. 빈 자원도 동시에 두 번 배정 불가
- 결과: 원자변경·이전판관계·실시판·보강원장
- 필수 시험: 교체경합/동의후수정/전출후동의/원복영향/시간경과자동실시금지

### API-21 · M11

- 명령: cmd_roster_import_preview, cmd_roster_import_apply
- 읽기: course_roster / student_context / roster_diff
- 표: students, student_enrollments, course_groups, course_memberships, course_group_teachers
- 입력: 명부 file·기간·학급/수강 매핑·stable external IDs·expected versions
- 권한: 명부담당/현재수업담당 범위. 동명이인은 사람 확인
- 결과: 불변학생ID·기간별학적/수강·행별결과
- 필수 시험: 동명이인/전학/복수학교/선택과목/학년전환ID유지

### API-22 · M11

- 명령: cmd_save_observation, cmd_correct_observation, cmd_withdraw_observation, cmd_save_counselling
- 읽기: my_observations / my_counselling / revision_history
- 표: observations, observation_revisions, counselling_records, counselling_revisions, student_evidence_gates
- 입력: student_id·enrollment/course·occurred_at·facts·origin·expected_revision
- 권한: 본인과 현재 학교·당시 담당 관계. 과거학년도 정정 절차
- 결과: 확인된사실판·정정사유·근거영향·재검토상태
- 필수 시험: 타교사비공개/학생정체성변경거부/과거정정/근거출력경합

### API-23 · M12

- 명령: cmd_confirm_assessment, cmd_save_record_draft, cmd_link_evidence, cmd_review_record, cmd_export_record
- 읽기: assessment_detail / record_evidence_graph / export_check
- 표: assessments, assessment_revisions, rubric_revisions, record_drafts, record_draft_revisions, evidence_links, record_exports
- 입력: student/context·rubric revision·evidence refs·draft revision·reviewed hash
- 권한: 작성자·현재소속·정확학생/원본판·기재규칙판·교사검토
- 결과: 평가확정판·문장근거·검토지문·출력기록
- 필수 시험: A학생근거B초안/근거철회/실제0점vs미평가/규칙미정/원문파기

### API-24 · M13

- 명령: cmd_classroom_import_preview, cmd_classroom_import_apply, cmd_classroom_remap, cmd_classroom_adopt, cmd_classroom_source_withdraw
- 읽기: activity_inbox / mapping_review / adoption_impact
- 표: activity_instances, classroom_imports, source_items, source_item_revisions, participant_mappings, participant_mapping_revisions, adoptions, inbox_items
- 입력: activity/question revision·file/event receipt·source revision·mapping revision·target revision
- 권한: 활동담당교사 확인. 학생자동확정/자동평가 금지
- 결과: 확인받은함·정확연결판에고정된채택·관찰/평가후속판
- 필수 시험: A→B→A/채택없는출처/중복역순/질문판변경/삭제후재수입차단


## 대시보드 응답

home_snapshot은 school/account scope와 basis_at, permission_version, sections를 반환한다. 각 section은 ready/empty/error/forbidden/disabled를 구분한다. 각 카드는 source_type/id/revision, relevance_reason, obligation_kind, due_at, responsible_label, next_action을 포함한다. 원본 없는 AI 의무 카드를 만들지 않는다.

한 원본의 여러 추천 이유는 한 카드에 병합한다. 수합은 unit_id, 교체는 change_set_id, 수업은 instance_id, task는 task_id를 dedup key로 쓴다. 마감은 수합/의무 원본의 서버 기준 값을 읽는다. 부분 조회 실패를 “할 일 없음”으로 바꾸지 않는다.

비공개 본문을 홈 집계에 복제하지 않는다. 캐시가 필요하면 학교·계정·소속·권한판·기준일·조회조건을 키로 삼고, 원본 변경/권한회수 시 무효화한다. 알림과 AI 브리핑도 읽는 순간 원본 권한을 재검사한다. 조회 결과가 오래됐으면 표시하고 확정 행동은 최신 상태를 확인한다.

## 기존 화면 연결 어댑터

| 현재 계약 | 통합 DB 연결 | 보존/변경 기준 |
|---|---|---|
| LegacyServices.getSession / signInWithGoogle | 기존 Google/Auth 세션 유지 | 인증 코드 변경 없이 기존 UID를 accounts에 연결 |
| LegacyIdentity.userId | Auth UID | 신규 account.id나 membership.id로 혼용하지 않음 |
| LegacyProfile.is_active / role | 이관 미리보기 입력과 legacy 승인 보존 | 새 학교 역할의 영구 권위가 아니며 회수된 역할 복구 금지 |
| CalendarAdapter.list/get/save(memberId, …) | events_in_range/명시 scope + cmd_save_event | memberId는 요청 맥락, 실제 실행자는 JWT. 조회에 날짜범위·cursor 추가 |
| TaskAdapter.create/update/setStatus | cmd_save_task / cmd_set_task_state | requestKey·expectedVersion 유지, 의무형 task의 수동완료 차단 |
| 기존 validThrough | 새 valid_to exclusive | date인 경우만 하루 증가. NULL은 무기한. 원본값과 변환판 보존 |
| fixture / preview store | 합성 데이터 모드 | 운영 연결 결과와 혼합하거나 미리보기 성공을 DB 성공으로 표시하지 않음 |
| 기존 수합/학생 UI state | 새로운 불변판·검토 상태·정확 ID | adapter에서 상태를 버리거나 모두 done으로 단순화하지 않음 |

기존 프론트 오류를 바꾸지 않아야 하는 과도기에는 MEMBERSHIP_INACTIVE→INACTIVE_MEMBERSHIP, VERSION_CONFLICT→CONFLICT, SCOPE_DENIED→FORBIDDEN, RESOURCE_UNAVAILABLE→NOT_FOUND로 명시 매핑한다. 원래 코드와 correlation_id는 안전한 진단 정보로 보존한다. 변환할 수 없는 새 상태는 숨기지 말고 화면에 대응 상태를 추가한다.

전환 중 각 엔터티 종류의 기준 쓰기 위치는 data_write_authority 하나로 결정한다. 같은 버튼이 옛 RPC와 새 RPC를 모두 호출하는 이중 쓰기를 만들지 않는다. 구 RPC를 유지해야 하면 호환 facade가 새 명령 하나에 위임한다. 기준을 바꾼 뒤에는 rollback도 데이터 대조와 차단 절차를 따른다.

## API 구현 완료의 기준

명령마다 입력 JSON Schema, 권한 검사, DB 원자성, 오류 코드, 현재권한 결과 재조회, 화면 종단 시험이 있어야 구현 완료다. 이 파일의 함수명이 존재한다는 이유만으로 구현·노출·운영 완료로 계산하지 않는다. 24개 기능군 모두 현재 status는 target_contract_not_implemented이며, 기존 일부 함수의 존재는 별도 실측 목록으로 관리한다.


---

<!-- SOURCE: 06-validation-release.md -->

# 검증과 DB 확정 기준

이 문서는 통합 SQL을 검증할 시험 계약이다. 기존 Claude DDL의 762개 통과와 수정 전 12개 반례는 비교 검토의 증거다. 통합 설계에서 반례를 막는 규칙을 정했다고 수정된 SQL이 시험을 통과한 것은 아니다.

## 세 층의 완료

| 층 | 완료의 의미 | 현재 상태 |
|---|---|---|
| 설계 정합성 | 사이트16모듈/24API가 표·명령·권한·시험에 대응, 모든 추가참조가 실제표/열을 가리킴 | validator 결과로 확인 |
| DB 구현 | 확정 DDL/트리거/RLS/명령과 원본762·추가반례·경합시험 통과 | 미실행, Claude SQL 작성 단계 |
| 실제 운영 | Auth·Storage·worker·화면·이관·복구·교사 업무 종단 성공 | 미실행, 적용 후 확인 |

schema-contract.json은 설계 명세다. validate-design.cjs가 성공해도 RLS 보안이나 동시성의 실행 증거로 바꾸지 않는다.

## 반드시 통과할 사례

### R01 협조 원본과 개정 사본

- 상황: 관계없는 audit.read 관리자로 동일 요청의 원본·사본·검색·내보내기 조회
- 기대 결과: 모든 경로에서 보호된 본문 0건
- 시험 층: RLS/캐시/파일
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### R02 미래 공동작성자

- 상황: unit member valid_from=내일, 현재 JWT로 초안·첨부 조회
- 기대 결과: 시작 전 0건, 시작 후 허용 범위만
- 시험 층: RLS/파일
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### R03 권한 회수 후 재이관

- 상황: 최초 이관→admin 회수→다른 legacy 회원 추가→변경분 이관
- 기대 결과: 회수된 역할 0개 유지, 종료 소속 자동 복구 0개
- 시험 층: 운영 함수/이관
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### R04 학생 정체성

- 상황: A근거 검토→초안 student_id=B 변경, 오염 자료의 출력 검사
- 기대 결과: 정체성 변경 거부, 오염된 자료도 출력 거부
- 시험 층: 제약/출력
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### R05 학생 연결판

- 상황: A→B→A 매핑판 변경 후 기존 채택 검사
- 기대 결과: 재확인 전 과거 채택 계속 stale
- 시험 층: 근거/명령
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### R06 채택 사슬 누락

- 상황: classroom_adoption 출처 문자열만 있고 채택행 0개인 판 확정
- 기대 결과: 커밋·근거 연결·출력 거부
- 시험 층: 지연 제약/출력
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### R07 인계 후 자기 검토

- 상황: 자신 제출→담당 인계→지정 검토자로 과거판 승인
- 기대 결과: 금지 정책에서 같은 계정 자기 검토 거부
- 시험 층: 명령/트리거
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### R08 게시 문항판

- 상황: 제출 존재 schema에 문항 추가·종류변경·삭제, 다른수합 schema 연결
- 기대 결과: 게시판 변경과 다른부모 참조 거부, 새판만 허용
- 시험 층: 제약/입력검사
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### R09 수락 없는 인계

- 상황: accepted_at/hash NULL, 부분NULL, 다른 manifest 수락으로 apply
- 기대 결과: 필수값·정확판·수락주체 없으면 거부
- 시험 층: CHECK/명령
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### R10 파일 부모 UPDATE

- 상황: 학교파일 연결을 개인문서/타학교/다른종류로 바꿈
- 기대 결과: 정체성 불변 또는 전체 부모 검사로 거부
- 시험 층: 제약/다운로드
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### R11 서비스 자격

- 상황: 비활성·미허용행동·미승인학교 principal로 claim/finish
- 기대 결과: 각 단계 실행 거부/규정된 중단, 권한회수와 직렬화
- 시험 층: worker/두 세션
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### R12 불명확 외부 요청

- 상황: external_request_sent→lease 만료→두 번째 worker claim; provider 응답 수신 뒤 결과 저장 전 crash
- 기대 결과: 자동 재전송·중복 도구 실행 0, 불명확 상태 조사; durable 결과 참조 없이 response_received 확정 거부
- 시험 층: worker/장애주입
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### IT01 기존 로그인

- 상황: 실제 기존 Google 계정 로그인과 재로그인
- 기대 결과: Auth UID 유지·재가입 불필요·기존승인 정확히보존
- 시험 층: 실제 Supabase
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### IT02 테넌트 모든 경로

- 상황: 학교A JWT로 B의 API·RLS·검색·스토리지·알림·지원·내보내기
- 기대 결과: 본문·식별자·건수·존재추정 유출 0
- 시험 층: 실제 Supabase
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### IT03 다중 소속 학교전환

- 상황: A초안·캐시·AI 열린 상태에서B선택, 네트워크응답순서반전
- 기대 결과: 응답/초안은범위별분리, A응답이B화면오염하지않음
- 시험 층: 브라우저 종단
- 명세: 05-api-site-contract.md
- 상태: 통합 SQL에서 미실행

### IT04 권한 회수 경쟁

- 상황: 세션A=저장/출력, 세션B=소속/역할회수, 양순서 실행
- 기대 결과: 회수 먼저면거부, 작업먼저면이력남고후속접근회수
- 시험 층: 독립 DB 두 연결
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### IT05 멱등 경쟁

- 상황: 같은주체/범위/명령/키 동일본문 동시요청 후 응답유실재시도
- 기대 결과: 업무변경·접수증 각1개, 같은결과, 다른본문 충돌
- 시험 층: 독립 DB 두 연결
- 명세: 05-api-site-contract.md
- 상태: 통합 SQL에서 미실행

### IT06 원자성 장애

- 상황: 업무변경 후 receipt/audit/outbox 전후에 오류주입
- 기대 결과: 완료표시 없는부분업무 0, 함께커밋하거나모두롤백
- 시험 층: DB 장애주입
- 명세: 05-api-site-contract.md
- 상태: 통합 SQL에서 미실행

### IT07 수합 상태축

- 상황: none/required 각각 v1승인·v2제출·철회·보완충족판철회
- 기대 결과: 현재제출/완료본/검토/보완·연체가 명세와일치
- 시험 층: DB+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT08 수합 공개 분리

- 상황: 안내 school 공개·결과관계자 공개, 무관교사조회
- 기대 결과: 안내만열림, 제출본문/첨부/결과건수정책일치
- 시험 층: RLS+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT09 파일 전이

- 상황: 실물없음·해시/형식불일치·미검사정책미정·접근회수
- 기대 결과: ready/제출/AI입력/다운로드가각각정책대로차단
- 시험 층: 실제 Storage
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT10 시트 기준 전환

- 상황: base→시트수정·사이트수정동시, 미리보기후또수정, cutover
- 기대 결과: 충돌표시/기대판거부, 기준전환후원본덮어쓰기0
- 시험 층: DB+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT11 인계 원자성

- 상황: 후임수락후단위책임변경·개인문서혼합·효력일미래
- 기대 결과: 정확한수락판만적용, 의무ID유지, 개인자료이동0
- 시험 층: DB+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT12 담당 신고

- 상황: 본인profile_claim으로부서/담임/교과수정
- 기대 결과: 승인전권한증가0, 미리보기후정식승인만반영
- 시험 층: DB+화면
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### IT13 학생 정정 출력 경쟁

- 상황: 원자료/매핑/관찰정정과record review/export를양순서실행
- 기대 결과: 최신근거검사/epoch로낡은정상출력0
- 시험 층: 독립 DB 두 연결
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT14 학생 CSV

- 상황: 동명이인·이름변경·반이동·중복파일·다중줄·행순서변경
- 기대 결과: 학생자동병합0, 정확활동/원문판/채택관계
- 시험 층: 파서+DB
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT15 자동 수업앱 사건

- 상황: 동일키다른본문·역순·취소·삭제뒤재전송
- 기대 결과: 명시충돌/보류/삭제원장유지, 자동점수확정0
- 시험 층: 연동 대역+DB
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT16 실제 0점

- 상황: 미평가·결시·미제출과점수0입력
- 기대 결과: scored=0만0, 다른상태는NULL과명시상태
- 시험 층: DB+화면
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT17 규정 시행판

- 상황: 미래게시판·과거질문·현재미색인·상충자료·철회
- 기대 결과: 기준일유효판만인용, 미확인을정답으로표시0
- 시험 층: 검색+AI 평가
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### IT18 AI 도구 확인

- 상황: 확인후대상변경·만료·전출·중복확인·원문명령주입
- 기대 결과: 새검사통과시만1회실행, 조회권한으로쓰기불가
- 시험 층: DB+도구 대역
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### IT19 AI 기억과 재임용

- 상황: 학교종료·같은학교새소속·근거파기·미확인기억
- 기대 결과: 기억재사용/옛대화자동접근차단, 개인영역유입0
- 시험 층: DB+AI 대역
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### IT20 외부 호출 경계

- 상황: intent전후·전송직전·전송후응답전·정산전프로세스종료
- 기대 결과: 결과모름을구분, 중복비용/외부효과반복을확정하지않음
- 시험 층: worker 장애주입
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

### IT21 시간표 빈 자원 경쟁

- 상황: 교체/출장/예약/분반수강변경이같은빈자원을점유
- 기대 결과: 하드충돌동시확정0, 동의지문변경재확인
- 시험 층: 독립 DB 두 연결
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT22 실시와 보강

- 상황: 배포후교체·실시정정·역변경·늦은재시도
- 기대 결과: 실시자료보존, 보강이중계상0
- 시험 층: DB+시간표 검증기
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT23 초중고 차이

- 상황: 초등학급/중등교과/고교선택/팀티칭/변칙일과
- 기대 결과: 검증된유형만지원표시, 미지원배포0
- 시험 층: 학교유형 합성+현장
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT24 파일 포함 복구

- 상황: DB복원+파일검사+삭제·회수원장재적용+옛경로검사
- 기대 결과: 파기/회수자료부활0, 부분복구를완료표시0
- 시험 층: 실제 복원 리허설
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### IT25 legacy 경로

- 상황: 옛public표/API/스토리지URL/도메인으로새권한우회시도
- 기대 결과: 기준전환후우회0, 기존허용평가계획서회귀없음
- 시험 층: 실제 종단
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### IT26 지원 관리자

- 상황: 기한만료·목적밖·다른학교·개인원문·로그조회
- 기대 결과: 최소승인범위만, 원문·비밀자동수집0
- 시험 층: RLS+지원 API
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### IT27 목록 성능

- 상황: 권한있는대형학교목록·권한없음·홈복합조회·차가운캐시·동시부하
- 기대 결과: 목표p50/p95/오류율을운영환경측정하고병목설명
- 시험 층: 실제 PostgreSQL 부하
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### IT28 학년도 전환

- 상황: 새학년도/학급/수강/담당미리보기·부분실패재시도
- 기대 결과: 학생ID유지, 개인본문복사0, 관계기간정합
- 시험 층: DB+화면
- 명세: 03-students-timetable.md
- 상태: 통합 SQL에서 미실행

### IT29 기존 문서 엔진

- 상황: 6양식일반/최대/누락/표넘침·수정파일재업로드
- 기대 결과: 보호자산회귀통과, 파일지문새검사, 실제한글열기
- 시험 층: 문서 생성·실물
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT30 교사 하루

- 상황: 출근홈→일정→간단수합→관찰→문서→인계
- 기대 결과: 오류/빈목록/오래됨구분, 도움없이완료·시간측정
- 시험 층: 역할별 교사 파일럿
- 명세: 05-api-site-contract.md
- 상태: 통합 SQL에서 미실행

### IT31 일정 대상과 기간

- 상황: 부서 AND 교과·같은값 OR·직접추가·제외·미래담당·private+audience
- 기대 결과: SQL/화면 선정 동등, 추천과 현재열람분리, 제외우선, 실패≠0명
- 시험 층: SQL+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT32 공식 일정 효력판

- 상황: 공식확정v1 후 날짜편집v2미확정, 학년예외 계산, v2철회
- 기대 결과: 일반교사/학사계산은v1유지, 확정명령만효력변경, 과거문서불변
- 시험 층: DB+읽기 RPC
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT33 알림과 확인

- 상황: 동일사건재전송·공지개정·권한회수·조용한시간·원본삭제
- 기대 결과: 수신자별중복0, 판별확인분리, 금지원문없음, 긴급예외범위고정
- 시험 층: outbox+화면
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT34 정책 시행과 하한

- 상황: 미래정책게시·학교완화시도·부분NULL승인·current pointer지연
- 기대 결과: 정확한시행판/공통하한, 미정기능차단, 과거적용판보존
- 시험 층: DB+정책 registry
- 명세: 01-foundation-security.md
- 상태: 통합 SQL에서 미실행

### IT35 문서 근거 사슬

- 상황: 공통양식+학교지식+작년파일로초안생성, 원문정정·파일재업로드
- 기대 결과: 팩/근거판/목적고정, 사실자동승계0, 검사결과재사용0
- 시험 층: DB+문서 worker
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT36 응답 유실 후 정책 변경과 재시도

- 상황: 명령 commit 후 응답 유실→정책판 교체→동일 주체/키/입력 재전송
- 기대 결과: 현재 조회 권한 검사 후 기존 접수 반환, 원본·감사·outbox 각각 1개; 입력 변경만 conflict, 새로운 키는 현재 정책 검사
- 시험 층: 명령/멱등/정책
- 명세: 05-api-site-contract.md
- 상태: 통합 SQL에서 미실행

### IT37 학교 부트스트랩과 감사 주체

- 상황: B01 실제 운영 DB identity로 학교 생성/관리자 부여/이관 실행; 미등록 identity와 임의 actor 입력도 시도
- 기대 결과: 검증된 bootstrap/migration principal과 정확한 scope의 감사 1개; 주체 양쪽 NULL·임의 위조 모두 거부; 기존 운영 함수도 공통 감사 경로 이용
- 시험 층: 운영 명령/감사
- 명세: 07-migration-operations.md
- 상태: 통합 SQL에서 미실행

### IT38 선택형 출처 FK와 공통 파일 입력

- 상황: 학교 문서에 본교/common 파일 정상 연결; 다른 학교·다른 개인 파일 연결; 선택 kind만 채운 출처와 미선택 잔여 ID 삽입
- 기대 결과: 두 정상 경로 성공, 타인/타학교 거부, 선택하지 않은 FK의 NULL 때문에 정상행 실패하지 않으며 kind 불일치·판 일부 누락 거부
- 시험 층: 복합 FK/CHECK/명령
- 명세: 02-workflows-documents.md
- 상태: 통합 SQL에서 미실행

### IT39 외부 응답 보관 경계 장애

- 상황: provider 응답 수신 직후 결과 저장 전 crash, response_received만 저장 시도, 참조+지문 저장 후 finalize 전 crash
- 기대 결과: 보관 전은 unknown으로 자동 재호출 차단; 참조 없는 response_received 거부; 원자 저장 후에는 동일 결과로 복구, 본문 없는 작업도 최소 receipt 필수
- 시험 층: worker/작업 상태/DB
- 명세: 04-ai-knowledge-jobs.md
- 상태: 통합 SQL에서 미실행

## 실제 두 연결 시험 방법

하나의 연결에서 순서대로 실행한 시험을 경합 시험이라고 부르지 않는다. A·B 독립 세션과 관측용 연결을 사용한다. A가 gate/행 잠금을 획득한 지점에 barrier를 두고 B를 시작한다. B가 실제로 기다리는지 확인한 뒤 A를 commit/rollback하고 결과·판·접수증·outbox를 검사한다. 획득 순서를 뒤집어 다시 실행한다. sleep 시간만으로 충돌을 추측하지 않는다.

권한 게이트는 소속·역할회수의 UPDATE와 충돌해야 한다. FOR KEY SHARE만으로 비키 권한 열 UPDATE를 막는다고 가정하지 않는다. 공통 순서와 FOR SHARE/UPDATE 계약은 01을 따른다. [PostgreSQL 행 잠금 공식 문서](https://www.postgresql.org/docs/current/explicit-locking.html)

## 실패 시험의 판정

의도한 오류 코드·제약 이름까지 확인한다. 권한 오류를 SQL 문법오류·fixture 중복 오류로 대체해 통과시키지 않는다. NOT NULL/NULL 조합, INSERT뿐 아니라 UPDATE/DELETE, 현재권한→회수→재임용, 정상→변경→원래값 복귀를 포함한다. deferred 제약은 COMMIT 또는 SET CONSTRAINTS ALL IMMEDIATE 시점에서 확인한다.

읽기 시험은 일반 교사·담당·요청자·공동작성자·검토자·학교관리자·서비스운영자·지원자·익명·worker를 구별한다. 직접 표 SELECT뿐 아니라 읽기 RPC·개정사본·집계·파일·검색·알림·AI출처·캐시를 포함한다. RLS가 활성화됐다는 검사와 올바른 행만 보이는 동작 시험을 별도로 둔다. [PostgreSQL RLS 공식 문서](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## 100점 목표의 판정표

| 축 | 배점 | 만점 근거 |
|---|---:|---|
| 요구 범위와 관계 | 20 | M00~M15/API01~24 누락·타학교/타학생/타부모 참조 0 |
| 권한과 개인 원문 | 25 | 역할별 모든 접근경로·회수·지원·서비스자격 시험 통과 |
| 업무 상태와 근거 | 25 | 수합·인계·학생·AI·시간표의 반례와 양방향경합 통과 |
| 이관과 복구 | 15 | 기존로그인/회원대조·legacy우회폐쇄·파일포함복원 성공 |
| 성능과 교사 종단 경험 | 15 | 실제목표환경부하와역할별업무완료 증거 |

점수는 실행 증거가 있는 항목에만 부여한다. 치명적 권한/학생오연결/허위접수/회원유실이 1건이라도 있으면 평균과 무관하게 공개 불가다. 현재 문서에 자가100점을 적지 않는다. 설계는 이 만점 조건을 충족하도록 작성했으며 구현 단계의 미검증 항목을 숨기지 않는다.


---

<!-- SOURCE: 07-migration-operations.md -->

# 07. 회원 보존·이관·회수·파기·복구 실행 계약

> 2026-10-12 설계안. 운영 DB를 읽거나 변경하지 않았다. 기존 migrations·인증 코드·문서 엔진·확정 자산은 그대로다. 이 문서는 SQL 확정본의 요구사항과 중단 조건이며 실행 지시가 아니다. 실제 SQL은 Claude Web이 검토·확정하고 계란님이 검증 환경부터 실행한다.

## 1. 전환의 완료 기준

기존 로그인/회원/실사용 평가계획서/제출 파일을 유지하면서 새 사이트가 학교별 원본의 유일한 쓰기 위치가 되도록 전환한다. 기존 public 계열과 신축 workhub_* 제안/실제 존재 여부는 B00에서 구별한다. 원래 SQL이 저장소에 있다는 사실을 운영 적용 증거로 사용하지 않는다. 원본 000 초기화나 001~007을 운영에 재실행하지 않는다.

사용자 목표는 핵심 전체 기능을 약 90% 이상 완성하여 공개하는 것이며 내부 배치 순서가 부분 공개 승인을 뜻하지 않는다. 권한·접수·회원 보존·복구 필수 게이트는 100% 통과해야 한다. 날짜 목표 때문에 그 항목을 미완성 10%에 넣지 않는다. 시간표 구현은 별도 재개 결정까지 보류하되 데이터 접점과 후속 생성 순서를 보존한다.

## 2. B00 증거와 최초 적용 경계

| 항목 | 확보할 증거 | 중단 조건 |
|---|---|---|
| 환경 | 프로젝트·운영/검증 표시, PostgreSQL/확장, API 노출 schema, 역할/기본 privilege | 대상이 불명확하거나 운영과 검증을 구분 못함 |
| 계정 | 같은 기준시점 Auth UID/public ID 집합, 기존 role/active/부서/extra_permissions·참조·트리거의 안전한 행 대조 | 고아/다중 연결·변경 추적 미확인. 개수만 맞고 행은 다름 |
| 실제 schema | 표·열·키·정책·함수 signature/owner/grant·trigger·적용 기록 | 문서와 다른 drift를 IF NOT EXISTS로 숨김 |
| 파일 | 버킷 공개/정책·객체 수·원본 바이트·해시/크기·DB 참조 | DB만 있고 본체 없음, 링크가 사실상 공개 |
| 보호 자산 | 엔진·6종 HWPX·manifest 계약·token-map·규정 지문 | 수정 여부·출력 동등성 설명 불가 |
| 운영 기준 | 학교 소유 바인딩·현재 승인 상태·최초 관리자·자료 분류·미결 예외 | 이름/학교명/날짜 추측으로 자동 매핑 |

비밀·실제 학생 원문·회원 이메일 목록을 채팅·CI 산출물에 남기지 않는다. 안전한 환경에서 행을 대조하고 지문/차이 건수만 보고한다. 자연 가입과 정상 수정은 오류 차이와 분리한다. 변경분 추적을 입증할 수 없으면 승인된 짧은 쓰기 정지 구간으로 기준점을 맞춘다.

## 3. 회원 연결과 R03 권한 부활 차단

Auth UID는 그대로, accounts.id는 신축 참조용 내부 키다. 자동 연결은 같은 Auth 주체가 입증된 경우뿐이다. admin_confirmed는 원본/대상·확인자·근거·시각·이관실행을 기록한 명시적 예외다. 기존 소속·역할의 결정권은 승인된 최초 연결 이후 신축으로 넘어가며 legacy 역할을 계속 복사하지 않는다.

기존 migration_runs/items/checks를 재사용한다. 별도 범용 이관 프레임워크는 만들지 않는다.

| 표 | 보강 필드 | 불변 조건 |
|---|---|---|
| `migration_runs` | apply_mode(initial_link/delta_compare), approval_manifest_sha256, target_snapshot_at | 원본 전체 지문뿐 아니라 승인한 효과 목록과 대상 기준점 고정. 같은 입력 재실행 결과 재사용 |
| `migration_items` | intent(first_link/compare_only), target_version_at_review, target_permission_version_at_review | 이미 최초 applied 연결이 있으면 compare_only. 연결·계정 ID·학교는 몰래 재지정하지 않음 |
| `migration_checks` | 기존 체크코드·expected/actual/passed 재사용 | 필수 시험코드 집합이 모두 있어야 validated/applied. 임의 체크 한 행으로 통과 금지 |

처리 순서는 다음과 같다.

1. 원본별 최초 applied 연결을 **어떤 계정/소속/역할 변경보다 먼저** 찾는다.
2. 이미 연결됐다면 현재 대상 상태·판·회수원장을 비교해 unchanged 또는 conflict를 기록한다. legacy의 admin·active 값으로 회수 역할/종료 소속을 재생성하지 않는다.
3. 신규 원본만 최초 연결 후보로 만든다. 기존 승인·학교·기간·역할 매핑이 확인된 후보와 제외 사유 목록을 사람이 검토한다. 대기·퇴직을 같은 false 값에서 자동 분류하지 않는다.
4. 원본 개인별 지문·대상판·권한판·승인 효과 목록을 고정한다. applying 시 01 잠금 순서로 현재 상태를 다시 대조하고 달라졌으면 승인 무효·중단한다.
5. 최초 연결·접수·감사·이관항목을 같은 트랜잭션에 반영한다. 부서/추가 권한 미해결은 needs_mapping/conflict로 원장에 남기거나 **승인된 제외**로 기록한다. 콘솔에 unresolved를 출력하고 적용 완료로 숨기지 않는다.
6. 최초 연결 이후 변경된 role/상태를 반영할 필요가 있으면 이관 함수를 사용하지 않고 현재 신축 역할·소속 변경 명령으로 별도 승인한다. 기존 source_sha가 바뀌었다는 사실은 권한 재부여 승인이 아니다.

`delta_compare`에는 계정·소속·역할 생성/활성화 권한이 없다. 새 legacy 회원이 추가되면 그 회원에 대한 별도 initial_link 후보를 만들 수 있지만 이미 연결한 다른 회원은 그대로다. 자동 재가입·권한 승격·회수 취소를 금지한다. `migration_items_applied`의 원본별 최초 연결 UNIQUE를 유지하며 이관 결과는 권한 판정 테이블로 사용하지 않는다.

## 4. 계정 권위와 실제 legacy 경로 회수

병행 단계에는 01의 legacy bridge를 사용한다. 기존 승인 값과 연결 상태를 확인하며 원래 public.users를 신축 가입 승인으로 변경하지 않는다. 신축이 계정 상태의 권위가 되는 시점은 환경·배포·실측·접근 회수 증거를 가진 **단일 전환 배치**로 기록한다. 전환 전후의 인가 함수를 혼용하지 않는다. 현재 권한이 아닌 과거 migration 시점의 true 값을 영구 허가증으로 쓰지 않는다.

`data_write_authority`는 학교/자료종류별 legacy/sheet/site를 유지한다. 관계/업무/일정의 원본 권위를 한 곳으로 정하며 양방향 자동 덮어쓰기를 하지 않는다. 계정 수준의 권위 전환은 학교 한 행으로 표현하지 않고 승인된 전역 적용본·환경 설정·legacy gate 증거로 관리한다. 이 설정은 클라이언트가 바꾸지 못한다.

| legacy_access_gates 항목 | 실제 차단/전환 시험 |
|---|---|
| users_select | 다른 학교 최소 roster 밖의 프로필·이메일 조회 거부, 본인 가입 예외 보존 |
| global_admin_helpers | 신축 학교 관리자가 전역 admin으로 승격되지 않음. 기존 전역 helper는 확인된 legacy 학교에 한정 |
| schedules_tasks | 철회된 작성자/배정자/admin의 SELECT·INSERT·UPDATE·DELETE 모두 검사 |
| doc_ai_conversations | 과거 대화 owner만으로 종료 학교 본문을 읽지 못함 |
| doc_submissions_storage | 기존 제출행·객체 경로·다운로드·Range·오래된 URL까지 현재 학교/접수 권한 검사 |
| calendar_academic_terms | 학교 없는 전역 일정에 타학교가 접근하지 못함 |
| doc_ai_urls | 채팅·추출·생성 직접 URL에 현재 학교/팩 권한 적용 또는 승인된 종료 |
| receipts_exports_caches | 오래된 접수증·ZIP·검색·캐시·worker 결과로 권한 회수 우회 불가 |

점검표는 ‘존재하는 행 모두 verified’만 보지 않는다. 배포본에 등록된 **필수 path_code 집합이 빠짐없이 존재하고 검증된 경우**에만 통과한다. synthetic 예외는 승인된 합성 환경 표시와 감사로 제한하며 운영자가 임의 인자로 실제 학교를 합성이라고 부르는 우회 경로를 제공하지 않는다. 학교 preparing 상태에서도 일반 업무 API가 열리지 않도록 01의 학교 gate를 적용한다.

새 스키마 API 노출, 함수 owner/grant, 클라이언트 `.schema('workhub')`/RPC, 구 DTO 변환, 서버 handler의 소속 검증을 같은 배치로 검증한다. 평가계획서 엔진의 순수 생성·검사 부분을 보존하고 기존 HTTP 인증 게이트를 무수정으로 새 학교 권한 경계라고 부르지 않는다.

## 5. 내부 구축·전환 순서

| 배치 | 생성/연결 | 종료 증거 |
|---|---|---|
| B00 | 실측·회원/파일 보존 기준·격리 환경·최소 복구 | 계정과 실제 파일 원본 복원, 접근 제한 |
| B01 | accounts/학교/소속/역할·플랫폼/서비스 grant·정책판·가입 예외·공통 write_audit(context), 검증된 운영 주체 연결과 기존 운영 함수 전환 | 기존 로그인, 미승인/타학교/회수, 실제 감사 주체·부트스트랩 시험 |
| B02 | 일정/개인 업무·bridge/새 DTO, 최초 회원 연결 | 기존 사용자 흐름, 응답 유실, R03 회귀, 두 연결 경합 |
| B03 | 파일·job/outbox·삭제/회수/복구 원장 | 실제 객체/DB 불일치·worker/서비스 권한 시험 |
| B04~06 | 업무·조직/학기·수업 공통 기반(spaces, course_groups, course_group_classes, course_group_teachers)·일반 수합·알림/인계 | 수업 기반 FK 선행, 원본 의무·불변판·마감·자기검토·수락/NULL 시험 |
| B07~08 | 학생·담당·관찰·수업자료 연동 | 작성자 경계·정확한 학생/매핑/채택판 |
| B09~10 | 지식·문서·AI·평가/생기부 | 검색 권한·시행판·문서 실물·도구 확인·비용 게이트 |
| B11 | 실자료 이관·legacy 회수·통합복구·현장 RC | 아래 필수 게이트+가중 업무 시나리오 90% 이상 |

B01의 공통 `write_audit(context)`는 실제 인증 계정 또는 검증된 DB 실행 identity에 연결된 bootstrap/migration service principal을 기록한다. actor 둘 중 정확히 하나와 정확한 scope를 보장하며, 호출자가 전달한 actor ID·임의 세션 변수·승인자가 입력한 이름을 신뢰하지 않는다. 서버 전용 허용목록과 현재 principal/grant를 검증한 실행 문맥을 사용한다. 초기 주체·grant의 최초 시드는 사용자 승인된 배포 절차에서 준비하고, 최초 감사가 불가능한 순환 의존을 만들지 않는다. 기존 op_grant_operator/op_create_school/op_grant_school_admin/op_activate_school/op_import_legacy_users 및 감사행을 쓰는 운영 함수·트리거는 이 계약으로 먼저 전환한다. actor가 모두 NULL인 기존 INSERT를 그대로 계승하지 않는다. 일반 업무·이관을 열기 전에 실제 운영 주체 기록, 임의 actor 가장 거부, 감사 실패 시 전체 롤백을 확인한다.

별도 재개 이후로 보류하는 것은 solver·편성안/시간표판·시간슬롯·교체 처리 등 시간표 전용 표와 기능이다. `spaces`, `course_groups`, `course_group_classes`, `course_group_teachers`는 시간표 분류에 있어도 학생 수강·담당과 일반 업무가 공유하는 기반이므로 B04~06에서 선행 생성한다. 선행 학교·학기·교과·행정학급·소속 관계를 먼저 만들고, 그 뒤 B07~08의 `course_memberships` 등 학생 FK를 연결한다. 다른 배치에서 존재하지 않는 시간표 전용 표를 예비 FK로 참조하지 않는다. 여러 파일로 나눌 때 각 배치는 필요한 RLS/GRANT/함수 allowlist/resource_classes/검증을 함께 가진다. ‘나중 파일에서 보안을 걸 예정’인 표를 운영에 먼저 만들지 않는다. FK 생성 순환은 기본 객체→종속 객체→검증 가능한 지연 FK 순서로 풀고, 명령 commit 전에 모든 필수 관계가 성립해야 한다.

## 6. 보존·파기·회수 원장

기존 retention_rules/resource_classes/retention_holds/deletion_ledger/restoration_ledger를 재사용한다. common 보존 정책은 순수개인·서비스 메타의 기준도 될 수 있지만 학교가 공통 정책을 수정하지 못한다. 보존 분류는 자료의 실제 scope와 도메인 목적을 함께 판정한다. 공유 자료 사본을 모두 ops_metadata로 분류해 원본보다 오래 무제한 남기는 방식을 금지한다.

| 표 | 보강 계약 |
|---|---|
| `retention_rules` | 승인 전 기간/근거/백업 만료 미정 유지. 승인된 적용판 불변. 학교/공통 권한과 적용 대상 분리. 파기 실행은 사람이 아닌 승인된 서비스 주체, 인간 책임/승인 권한은 별도 |
| `retention_holds` | scope/scope_key/owner_account_id 명시, 대상 처리기가 실제 원본과 일치 검증. 학교 hold로 공통·다른 계정 자료를 지정하지 못함 |
| `deletion_ledger` | scope/scope_key/owner_account_id, 승인 manifest 지문과 도메인별 처리 결과. job_scope_key를 상수 c로 만들지 않고 정확한 승인 실행 범위로 연결 |
| `restoration_ledger` | scope/scope_key/owner_account_id, 안전한 구조화 subject_key JSONB 추가. 복합키를 ':' 문자열 결합으로만 해석하지 않음 |
| `resource_classes` | 신규 표 등록 필수, 원본/사본·현재/임시/학교/개인 분류 검사. 권한을 결정하는 테이블이 아님 |

삭제 요청→사용 차단→승인 영향목록/hold 확인→원본·파생 본문·파일·색인·캐시·출력 처리→결과 대조 순서다. 권한 있는 작성자/담당자의 요청 사실만으로 임의 전체 학교 파기를 허용하지 않는다. 도메인 처리기는 입력 type과 ID를 allowlist로 검증하며 임의 SQL을 받지 않는다.

manifest에는 정확한 대상 종류/ID/판/파일 지문을 고정한다. 범위가 달라지면 새 승인이다. 일부 실패는 partial로 표시하고 완료로 집계하지 않는다. partial 이후 잔여 목록만 같은 승인·멱등 키로 재개할 수 있도록 설계한다. completed는 대상별 실물/파생 처리 결과가 모두 확인된 경우만 가능하다. 보존 hold는 일반 본문 접근을 다시 여는 근거가 아니다.

학교 파기는 school 범위의 승인 서비스 principal job으로 수행한다. 순수개인 파기는 account_private 자료를 대상으로 하되 포괄 개인 읽기 grant를 만들지 않고, service 범위의 deletion_process 전용 작업이 정확히 한 계정의 승인 삭제 요청/불변 manifest만 실행하도록 한다. 이 경우 실행 scope=service와 자료 scope=account_private를 모두 기록하며, 일반 작업의 scope 일치 규칙에 대한 등록된 단일 예외다. 임의 계정 ID/자료 목록을 입력하는 범용 작업으로 확대하지 않는다. 요청자의 퇴직 때문에 이미 승인된 필수 파기가 취소되지 않는다. common 파기는 common grant, 글로벌 복구 검증은 service grant다. 그 차이를 job 및 파기 원장에 기록한다.

소속 종료·역할 회수·담당 기간 축소·수합 구성원 제거·지원 종료·계정/학교 정지·서비스 grant 회수는 같은 트랜잭션에서 최소 회수 원장을 남긴다. 원장에 본문이나 credential을 복사하지 않는다. 원장은 운영 DB와 같은 사고로 함께 사라지지 않도록 승인된 별도 장애 경계에 복제하고, 실패·지연을 관측한다. 영구 삭제/백업 만료를 자동 가동할 기간·법적 근거는 이 문서가 정하지 않는다. 미정인 자료 유형은 파기 기능을 차단하고 게시/수집 여부도 해당 기능 게이트에서 결정한다.

## 7. DB와 파일을 함께 복원하는 계약

recovery_sets에는 scope(school/service), school_id, 기준시각, DB snapshot, 실제 Storage 바이트, 객체 manifest/지문/크기, 문서팩/자산판, 계정 연결, 앱/SQL 배포판, deletion/restoration high-water를 보존한다. 링크·목록만 있고 원본 바이트가 없으면 complete가 아니다. school set의 모든 객체는 그 학교 범위여야 하며 공통 의존 팩은 정확한 불변판으로 명시한다.

restore_runs는 해당 recovery_set FK, 격리 환경, 외부 전송 차단, 복원→파일 검사→원장 재적용→접근 검사→성공 순서를 유지한다. 필수값의 NOT NULL과 상태 선행 조건을 함께 검사하고 NULL 비교가 체크를 통과하지 않게 한다. 파일 누락/불일치가 1개라도 있거나 원장 기준점이 부족하면 성공할 수 없다. recovery_sets.verified는 성공한 자기 세트의 복원 실행으로만 올린다.

1. 별도 격리 환경을 만들고 AI·이메일·푸시·웹훅·외부 가져오기/전송을 차단한다. 운영 credential을 복원본에 그대로 활성화하지 않는다.
2. DB와 해당 시점 파일 바이트를 복원하고 해시/크기·접수/문서/파일 참조를 대조한다. Auth의 제공자 관리자료를 다른 프로젝트에 완전히 복제할 수 있다고 가정하지 않으며 승인된 UID 연결/로그인 복구 수단을 리허설한다.
3. 백업 이후 삭제·권한 회수 원장을 최신 안전 기준점까지 재적용한다. 회수된 관리자 역할·종료 소속·폐기 학생 근거·파일 발급이 부활하지 않아야 한다.
4. old worker lease·outbox·외부 호출 추적을 확인한다. 성공 여부가 불명확한 외부 호출을 새로 자동 재실행하지 않는다. 접수증·원본판·파일을 대조한 뒤 재개한다.
5. 실제 파일을 열고 현재/종료 사용자·다른 학교로 음성시험한다. 결과와 지연·누락·격리 조치를 기록한 뒤 재개 승인을 받는다.

한 학교 사고로 운영 DB 전체를 과거로 덮지 않는다. 학교별 논리 복구는 참조 부모/자식·공통 의존판·파일·현재 권한·후속 변경을 비교하여 재반영한다. 충돌은 조용히 덮지 않고 격리 처리한다. 초기 B00/B01에서 최소 DB+합성 실물 복구를 먼저 통과하고 완성 시 전체 수합/학생/문서/AI의 RC 복구를 다시 검증한다.

## 8. 실패와 되돌림

| 상황 | 안전한 조치 |
|---|---|
| 아직 신규 쓰기 전 | 적용 트랜잭션 실패는 rollback. 필수 객체·권한·원본 보존 다시 대조 |
| 신규 쓰기 후 UI 장애 | 기능별 쓰기 스위치/공개 범위 제한, 새 원본·접수·파일을 보존하고 호환 정상 배포 복구 |
| 자료 무결성 의심 | 해당 학교/도메인만 격리, 원본+판+receipt+audit+파일 대조, 같은 키로 상태 확인 |
| legacy 복귀 필요 | 신규 발생분을 승인된 역이관/보존 처리. 변환 불가 자료는 처리함에 남기고 코드만 되돌려 숨기지 않음 |
| 권한/개인정보 회수 | 서버 gate 먼저 차단, 세션/캐시/작업/발급 회수; 이미 기기에 내려간 사본까지 회수됐다고 표시하지 않음 |

각 배포는 적용본 SHA, 환경, 실행자, 선행 적용본, 변경객체/함수서명, 예외·백필, 전후 합계·행 대조, 성공 시험 ID, rollback/recovery 경계가 들어간다. `CREATE TABLE IF NOT EXISTS`로 다른 schema를 정상으로 가장하지 않는다. 승인 없이 원래 확정 SQL을 사후 편집하지 않는다.

## 9. 운영 측정과 단계별 게이트

기획의 p95 홈 2초/API 1초/작업접수 2초, RPO 24시간·RTO 4시간은 **초기 목표 제안**이다. 실제 학교망·기기·자료량·동시 사용과 복구 리허설 전 SLA가 아니다. 제출/마감 직전에는 최신 백업과 접수 대조를 별도 수행하며 24시간 제출 손실을 허용한다는 뜻이 아니다.

관측 항목: 권한 거부/회수지연, 학교별 저장 실패·충돌·접수 재시도, DB p95/p99·lock wait/deadlock, job queue age/lease 만료·indeterminate, Storage 참조 누락, outbox 중복/재시도, 파기 partial/hold, 원장 복제 지연, 복구 누락·걸린 시간이다. 본문·학생 답변·키를 로그 label에 넣지 않는다. 학교별 용량/보존/최대 페이지 조회를 제한하고 실제 병목에만 인덱스·배치·큐/연결 풀을 조정한다. 전국 규모 수치를 합성 두 학교의 예열 중앙값으로 보증하지 않는다.

원가표는 DB/컴퓨팅+Storage 원본/백업+전송+작업자+관측+AI 실제 사용량의 합으로 분리한다. 학교별 고정분·사용량·공통비 배부 기준과 미확인 값을 표시한다. 현재 모델/단가를 임의 입력하지 않는다. AI 비용 예약·확정·불명확 처리는 04가 정본이며 월 경보가 하드 상한을 대체하지 않는다.

| 게이트 | 필수 결과 |
|---|---|
| MIG01 회원 | 기존 Auth/프로필/참조·트리거 보존, 재가입0, hold/승인 상태 분류 증거 |
| MIG02 R03 | 관리자 회수 뒤 다른 legacy 사용자 추가+재이관에도 역할0 유지, 종료 소속 재활성0 |
| MIG03 변경분 | 같은 원본 멱등, 다른 지문은 비교·승인, 대상판 변경 시 중단, unresolved 완료 집계0 |
| MIG04 legacy | 필수 경로 목록 누락0, 두 번째 실제 학교/종료회원/직접URL·Storage 우회0 |
| MIG05 회수 | 독립 PostgreSQL 연결에서 회수 선행 잠금 뒤 저장/파일/작업 확정 거부 |
| MIG06 파기 | 원본·사본·추출·색인·캐시·결과파일 잔존을 각각 확인, partial은 완료아님 |
| MIG07 복구 | 실제 파일 지문/열기, 회원 대응, 최신 회수 원장 재적용, 외부 재전송0 |
| MIG08 무결성 | 접수증 원본 누락/중복0, 재시도 1반영, 수합/학생 반례 R02~R10 차단 |
| MIG09 실제 접속 | Supabase Auth/PostgREST/Storage/worker role/브라우저 왕복. 로컬 합성시험과 구분 |
| MIG10 공개 | 필수 보안·접수·복구100% + 합의된 가중 업무시나리오90% 이상, 사용자 공개 승인 |

아직 확정하지 않은 것은 실제 운영 인벤토리, 최초 학교·관리자 연결, 승인 상태 예외 매핑, 보존기간·법적 근거·백업 저장위치/만료, 지원기한, 외부 기능 한도/비용, 실제 공개 범위다. 이는 구체적인 적용본과 검증 증거를 갖춘 승인 게이트로 관리한다. 현재 설계 문서 작성과 보호된 운영 변경을 혼동하지 않는다.


---

<!-- SOURCE: 08-coverage.md -->

# 사이트 청사진과 통합 DB 대응표

정확한 대상은 최종 업무혁신시스템 기획서의 M00~M15와 API-01~24다. 연결됨은 설계의 추적 가능성을 뜻하며 기능 구현 완료가 아니다.

| 모듈 | 화면 | 주요 원본 | API | 보장할 규칙 |
|---|---|---|---|---|
| M00 계정·학교·소속 | 오늘 진입/학교 전환/가입 승인 | accounts, schools, memberships, membership_roles, school_features | API-01, API-02 | 기존 Auth UID 보존, 승인 대기와 업무 접근 분리 |
| M01 프로필·업무분장·인계 | 업무/내 담당 | duties, assignments, profile_claims, handovers | API-03, API-04 | 신고는 권한이 아니며 의무 ID는 인계 때 유지 |
| M02 일정·학사·시트 전환 | 일정 월/주/목록 | events, event_revisions, calendar_days, source_connections | API-05, API-06 | 원본 하나, 공식 확정과 공유 등록 분리 |
| M03 오늘·개인 업무·협조 | 오늘/개인 할 일 | tasks, cooperation_requests, membership_home_layouts | API-07 | 홈은 권한 있는 원본 조합, 의무를 수동 체크로 완료하지 않음 |
| M04 수합 | 업무/받은·보낸 수합 | collections, collection_schemas, collection_units, submission_versions | API-08, API-09, API-10 | 안내 공개와 완료본 공개 분리, 문항판·접수판 불변 |
| M05 전달·알림·문의 | 알림함/전달사항/문의 | notices, notice_receipts, notifications, feedback | API-11 | 읽음·확인·완료를 구분 |
| M06 학교 지식 | 문서·학교 자료/규정 검색 | knowledge_documents, knowledge_revisions, knowledge_chunks | API-12, API-13 | 학교·시행일·확인판·정확 인용 |
| M07 Claude 비서·기억 | 상주 AI/전문 화면 연결 | conversations, ai_runs, ai_run_sources, tool_proposals, memories | API-14, API-15 | 한 입구와 역할별 도구, 현재권한·명시확인 |
| M08 문서·팩·파일함 | 내 초안/공용문서/양식 | documents, document_revisions, document_packs, file_objects | API-16, API-17 | AI 내용과 코드 서식/계산 분리, 파일지문마다 검사 |
| M09 시간표 조회·편성 | 시간표/담당자 편성 | timetable_versions, timetable_compositions, timetable_candidates | API-18, API-19 | 최종 구조 포함, 알고리즘·실제 구현은 사용자 보류 유지 |
| M10 시간표 교체·실시 | 교체 요청/대강·보강 | timetable_change_sets, lesson_instances, lesson_executions, cover_ledger | API-20 | 동의·변경확정·실시·원장 분리, 구현 보류 |
| M11 학생·수업·관찰 | 나의 수업/학생 | students, student_enrollments, observations, counselling_records | API-21, API-22 | 학적 기간과 불변 학생ID, 개인 관찰은 작성자 소유 |
| M12 평가·생기부 초안 | 평가/문장별 근거 검토 | assessments, record_drafts, record_sentences, evidence_links | API-23 | 교사 확인 사실만 사용, 근거 바뀌면 출력 차단 |
| M13 수업 사이트 연동 | 활동 받은함/디지털윤리 수업 | activity_instances, source_items, participant_mappings, adoptions | API-24 | 수동 CSV부터 자동 사건까지 같은 불변 원자료/채택 계약 |
| M14 학년도 전환·연속성 | 관리/학년도·인계 | academic_years, terms, student_enrollments, handovers | API-03, API-04, API-21 | 새해에는 관계 새로, 학생ID·이력은 유지 |
| M15 학교 운영·지원 | 관리/설정·작업·복구 | school_policies, policy_versions, jobs, support_sessions, restore_runs, legacy_access_gates | API-02, API-11 | 역할·정책·복구·옛 경로 폐쇄를 검증한 뒤 공개 |

## 전체 표의 도메인 소유

한 표의 정본은 하나다. 여러 화면에서 참조해도 복제 원장을 만들지 않는다. course_groups 등 공통 수업 기준은 시간표 구현 보류와 관계없이 학생/수합 FK의 선행 기준으로 먼저 생성한다.

| 도메인 | 표 수 | 전체 표 |
|---|---:|---|
| 계정·학교·권한 | 23 | accounts, account_settings, schools, memberships, membership_roles, role_catalog, role_permissions, school_join_codes, departments, profile_claims, school_features, school_feature_pilots, service_features, service_switches, service_operators, operator_grants, service_principals, service_principal_scopes, policy_catalog, school_policies, policy_versions, support_sessions, membership_home_layouts |
| 일정·시트 | 15 | events, event_revisions, calendar_days, calendar_day_grade_overrides, audience_sets, audience_groups, audience_conditions, audience_members, source_connections, source_connection_mappings, source_records, source_record_snapshots, import_runs, import_rows, import_row_candidates |
| 업무·인계 | 8 | tasks, duties, assignments, duty_notes, cooperation_requests, handovers, handover_items, handover_acceptances |
| 수합 | 16 | collections, collection_schemas, collection_fields, collection_reviewers, collection_units, collection_unit_members, collection_due_changes, unit_drafts, submission_versions, submission_files, submission_reviews, correction_requests, correction_windows, collection_correction_fulfillments, export_manifests, export_manifest_items |
| 파일·문서 | 10 | file_objects, file_links, file_access_grants, documents, document_packs, document_revisions, document_inputs, document_actions, document_validations, document_revision_sources |
| 전달·알림 | 9 | notices, notice_receipts, notifications, notification_kinds, notification_preferences, quiet_hours, push_subscriptions, feedback, feedback_events |
| 학교 지식 | 4 | knowledge_documents, knowledge_revisions, knowledge_chunks, knowledge_conflicts |
| Claude·기억 | 9 | conversations, messages, ai_runs, ai_run_sources, ai_policy_versions, tool_proposals, tool_runs, memories, usage_events |
| 학생·평가·생기부 | 24 | academic_years, terms, subjects, academic_classes, students, student_enrollments, course_memberships, observations, observation_revisions, counselling_records, counselling_revisions, rubrics, rubric_revisions, assessment_activities, assessments, assessment_revisions, record_rule_sets, record_drafts, record_draft_revisions, record_sentences, evidence_links, record_exports, record_correction_approvals, student_evidence_gates |
| 수업 앱 연결 | 12 | activity_instances, classroom_imports, classroom_connections, classroom_event_receipts, source_items, source_item_revisions, participant_mappings, participant_mapping_revisions, inbox_items, adoptions, source_actions, impact_items |
| 시간표 | 26 | spaces, bell_schedules, bell_periods, term_day_templates, course_groups, course_group_classes, course_group_teachers, constraint_sets, timetable_constraints, teacher_unavailability, timetable_compositions, timetable_candidates, timetable_versions, timetable_placements, timetable_version_impacts, lesson_instances, lesson_instance_teachers, space_reservations, resource_occupancy, timetable_change_sets, timetable_change_items, timetable_change_participants, lesson_executions, lesson_execution_teachers, cover_ledger, school_timetable_types |
| 작업·이관·복구 | 19 | jobs, job_attempts, job_external_calls, idempotency_receipts, audit_events, outbox, object_revisions, migration_runs, migration_items, migration_checks, data_write_authority, legacy_access_gates, retention_rules, retention_holds, resource_classes, deletion_ledger, restoration_ledger, recovery_sets, restore_runs |

## 검토 범위와 수치

원본 160표 중 81표를 명시 보강하고 15표를 추가한 목표 175표, 2374열이다. 표 수 자체를 완성도 지표로 삼지 않는다. 신규 표는 정확한 정책/문항/채택 근거, 인계 수락, 외부 호출 경계 등 기존 반례를 닫거나 이미 기획된 기능의 최소 관계를 구현하기 위한 것이다.

각 표의 최종 열은 09-table-dictionary.md, 기계 판독형 카탈로그는 schema-contract.json이다. 변경 JSON에 없는 원본 함수·정책도 통합 공통 계약을 따르도록 SQL 작성 단계에서 재검토한다.

## 청사진 공통 계약 C01~C12

| ID | 계약 | 상세 명세 | 검증 |
|---|---|---|---|
| C01 | 인증·자료 범위·학교 경계 | 01-foundation-security.md | IT01, IT02, IT04 |
| C02 | 열람·추천·의무 분리 | 02-workflows-documents.md, 05-api-site-contract.md | IT08, IT31 |
| C03 | 상태·버전·접수 | 02-workflows-documents.md, 03-students-timetable.md | IT06, IT07, IT22 |
| C04 | 멱등·경합·확정 | 01-foundation-security.md, 05-api-site-contract.md | IT04, IT05, IT06, IT13, IT21 |
| C05 | 파일·긴작업·취소 | 02-workflows-documents.md, 04-ai-knowledge-jobs.md | R10, R11, R12, IT09, IT20 |
| C06 | 마감·연체·재제출 | 02-workflows-documents.md | IT07 |
| C07 | 가져오기·안정원본ID | 02-workflows-documents.md, 03-students-timetable.md | IT10, IT14, IT15 |
| C08 | 인계·전출·학년도 정정 | 01-foundation-security.md, 02-workflows-documents.md, 03-students-timetable.md | IT04, IT11, IT28 |
| C09 | 근거·정정전파 | 03-students-timetable.md, 04-ai-knowledge-jobs.md | R04, R05, R06, IT13 |
| C10 | 알림·캐시·학교전환 | 02-workflows-documents.md, 05-api-site-contract.md | IT03, IT33 |
| C11 | AI행동·기억·비용 | 04-ai-knowledge-jobs.md | IT18, IT19, IT20 |
| C12 | 보존·지원·복구 | 01-foundation-security.md, 07-migration-operations.md | IT24, IT25, IT26 |

## 청사진 수용 기준 V01~V48

아래는 원문을 추적한 설계 연결이며 실제 기능 시험 통과를 뜻하지 않는다. 원문 지문은 blueprint-contracts.json에 기록했다.

| ID | 상황 | 기대 결과 | 통합 시험 |
|---|---|---|---|
| V01 | 신규 계정·소속 없음·pending으로 가입/업무 접근 | 최소 학교/본인 신청만 가능, 업무·자기 승인 차단 | IT01, IT12 |
| V02 | 한 계정이 A학교 관리자/B학교 교사, 같은 이름 자료 | 학교별 권한 분리·다른 학교 역할/객체 사용 거부 | IT02 |
| V03 | 열어 둔 세션·작업·옛 URL 상태에서 소속 종료 | 새/옛 API·DB·파일·AI·캐시·작업 접근/실행 회수 | IT04, IT25 |
| V04 | 관리자·담임·운영자가 타인 기록/대화/건수 요청 | 본문·집계·검색·알림·내보내기 모두 차단 | R01, IT02, IT26 |
| V05 | 프로필 교과 자가 변경·담당 시작/종료 경계 | 추천 요청만 변화, 공식 권한 불변·기간 정확 | IT12, IT31 |
| V06 | 인계 수락·효력일·중복 요청·중간 실패 | 원자 한 번 적용·의무 ID/수 유지·실패 전체 취소 | R09, IT11 |
| V07 | private 일정에 audience가 남음·0명·제외 조건 | private 작성자만, 대상 규칙·접근 분리 정확 | IT31 |
| V08 | 부서 AND 교과 OR 직접추가, 제외·발생일/현재시점 | 승인 관계로 정확 선정, 조회 실패를 0명 처리 안 함 | IT31 |
| V09 | 일반 교사의 공식 일정 수정·공유 취소·시수 재계산 | 공식 확정 권한 보호·개정 보존·문서 소급 변경 없음 | IT32 |
| V10 | 시트 정렬·행 삽입·내용 수정·ID 소실·동시 수정 | 안정 ID 유지, ID 소실 확인, 기준 전환 뒤 덮어쓰기 차단 | IT10 |
| V11 | 초보 교사·360px·느린 카드·학교 전환·미저장 | 오늘 할 일 설명 가능·수평 막힘 없음·학교 자료 혼합 없음 | IT03, IT30 |
| V12 | 개인 체크·수합 의무 체크·중복 AI 요청 | 개인 할 일만 완료, 원본 의무는 실제 접수·확정으로 완료 | IT30, IT07 |
| V13 | 숫자 수합/파일 없음·검토 없음·내보내기·공동 3명 1단위 | 정상 접수·완료본/집계/출력·의무 수 1·불필요 승인 없음 | IT07 |
| V14 | 공동 작성자 초안 편집/제출 시도·구성원 제거·요청자 초안 조회 | 구성원 편집 가능·지정 책임자만 제출, 제거 즉시 차단, 미제출 비공개 | R02, IT07 |
| V15 | 접수 v1→정정 v2→보완·철회, 외부 처리 있음 | 판별 상태·완료본 정확, v1 외부 처리 v2로 복사 안 함 | IT07 |
| V16 | 검토 없음 v2 정정·철회, ZIP 대기 중 권한 종료 | 유효판 정확·과거판 자동 부활 없음·다운로드 권한 차단 | IT07, IT09 |
| V17 | 동시 제출/검토·더블클릭·응답 유실·같은키 다른본문 | 중복 0·지정판 충돌·동일 접수 재조회 또는 명확한 거부 | IT05, IT06, IT07 |
| V18 | 미제출 마감 초과·기한 전/후 보완 제출·면제·마감 변경·none 철회 후 옛판 존재 | 지연 3축 구별·재제출로 보완 연체 해제·현재 포인터 기준·분모/독촉 정확·과거 판정 유지 | IT07 |
| V19 | 같은 사건 재전송·권한 밖 알림·조용한 시간 | 중복 0·정보 비노출·묶음/긴급 정책 정확 | IT33 |
| V20 | 키보드·200% 확대·읽음/확인 요청·문의 | 핵심 조작·상태 이해 가능, 읽음이 승인으로 처리 안 됨 | IT30, IT33 |
| V21 | HWPX/텍스트 PDF/직접입력·스캔/암호화/잘림·미래판·색인 지연·철회 | 원문/쪽 위치 대조·추출 오류 보류·게시/시행/색인 분리·유효판만 사용 | IT17 |
| V22 | 학교 규정 질문·출처 없음·타학교 유사 문서 | 적용판/출처 정확, 없으면 확인 필요, 타학교 근거 0 | IT02, IT17 |
| V23 | 규정 상충·과거/미래 기준일·문서 속 도구 지시 | 범위/시점 구별·확정 과장 없음·권한 변경 없음 | IT17, IT18 |
| V24 | 파일 성공 후 DB 실패·작업 중단·알림 실패·복구 | 허위 접수 0·실패 단계 재개·중복 0·실물 대조 | IT06, IT09, IT24 |
| V25 | 기존 6양식·최대길이·누락·실제 한글 열기 | 자산 지문 보존·필수 회귀 0 skip·동등 출력/오류 | IT29 |
| V26 | 최종 파일 재업로드·형식 위장·해제 과다·추출 잘림 | 새 검사·실물 확인·한도 거부·잘림 안내·이전 검사 승계 안 함 | IT09, IT29, IT35 |
| V27 | 전임 전출이 수락보다 먼저·새 의무 발생·학기 변경 | 권한 종료 우선·담당 공백 표시·낡은 목록 적용 거부 | IT04, IT11 |
| V28 | 시간표 미매핑·일과 중복·기간/학급코드 혼동 | 기존표 유지·오류 행 안내·학생 명부 자동 연결 없음 | IT23 |
| V29 | 동의 뒤 출장 확정·예약·수강 변경·동시 교체 | 확정 잠금 안 재검사, 충돌 후보 반영 0 | IT21 |
| V30 | 교체 후 추가 교체/예약/실시가 있는 원복 | 후속 자료 덮지 않음·새 후보/동의·실시 정정 구분 | IT22 |
| V31 | L0 읽기 질문·모델이 높은 도구 수준 요청 | 허용 읽기만·서버 수준 고정·전문 승인 이동 | IT18 |
| V32 | 확인 뒤 입력/판/대상 변경·만료·중복 확인 | 낡은 승인 거부·한 번 실행·새 영향 재확인 | IT18 |
| V33 | 악성 문서·학생 답변·다른 학교 문서팩·규칙 누락 | 외부 지시 무시·자산 격리·누락 검사 통과 표시 없음 | IT18, IT29, IT35 |
| V34 | 감사/오류 로그·지원 세션 만료·AI 무한 반복 | 민감 본문 비기록·지원 종료 차단·반복 중지·추적 가능 | IT20, IT26 |
| V35 | AI/알림/일부 조회 장애·느린 학교망 | 수동 핵심 업무 유지·오류≠빈 자료·기준시각·재개 | IT30, IT33 |
| V36 | 기억 미확인·수정·삭제·원자료 정정·전출 | 확인 전 장기 사용 없음·철회/만료/무효화 즉시 반영 | IT19 |
| V37 | 기본 편성 고정칸·요구량·출장·모순·시간 초과 | 필수조건 준수·불가능/미해결 구별·자동 완화 없음 | IT23 |
| V38 | 후보 수동 충돌·새 기본표와 기존 교체/보강 | 재검사 전 배포 차단·미해결 영향 보류·과거 실시 보존 | IT21, IT22, IT23 |
| V39 | 예정→미실시→정정→취소/원복 재시도 | 예정/실시 누계 정확·원인당 한 번·학교 산식 표시 | IT22 |
| V40 | 동명이인·번호 재사용·전입/반 이동·CSV 누락 | 확인 없는 병합/전출 없음·당시 관계 보존 | IT14, IT28 |
| V41 | 본인의 작년 기록 정정·타인/관리자 정정 | 작성자 개정 가능·절차 승인과 본문권한 분리 | IT13, IT28 |
| V42 | 생성/검토/내보내기 중 근거·학생 매핑 정정 | 불변 근거 유지·동기 검사·재검토·낡은 정상 출력 차단 | R04, R05, R06, IT13 |
| V43 | 미제출·결시·0점·루브릭 개정·AI 점수 | 상태 정확·코드 계산·교사 확정·기존 점수 자동 변경 없음 | IT16 |
| V44 | 미확정/철회 근거·규칙 없음·과장 문장·공식입력 구분 | 생성 제외/확인 필요·not_checked·문장 근거·공식 입력 오표시 없음 | R06, IT16, IT17, IT35 |
| V45 | 두 CSV 실제 형식·BOM·따옴표·줄바꿈·수식보호 | 원문 보존·정확 질문 매칭·실행 방지·심화 평가 제외 | IT14 |
| V46 | 같은 활동/다른 활동 동일 파일·행 정렬·중복학생 | 범위별 중복 정확·확인형 연결·누락=삭제 아님 | IT14, IT15 |
| V47 | 미채택 외부 답변·채택 후 원문 정정/철회 | 근거 사용 차단/허용 구별·관련 관찰/평가/초안 재검토 | R05, R06, IT13, IT15 |
| V48 | 일부학생 원본 삭제·재수입·복구·이미 내보낸 문안 | 파일 실물 처리 범위 표시·삭제 부활 방지·외부 정정 안내 | IT15, IT24 |


---

<!-- SOURCE: 10-decision-register.md -->

# 통합 설계 결정과 변경 기준

이 파일의 IDB 번호는 이번 설계안의 제안 기록이며 저장소 DECISIONS.md의 확정 D번호를 신설·수정하지 않는다. 사용자 요구로 확정된 방향과 구현 전 검토할 구체 정책을 구분한다.

| ID | 선택 | 왜 | 변경하려면 |
|---|---|---|---|
| IDB-01 | 최종 사이트 M00~M15 전체를 설계 | 현재 화면만 따라가면 향후 학생·AI·문서 연결 재설계가 생김 | 08의 요구 추적과 도메인 계약 동시 변경 |
| IDB-02 | workhub/workhub_private, 기존160표 기반 보강 | 실제SQL/시험 자산 활용, 이름만 바꾸는 재작성 방지 | 카탈로그·API·이관·기존어댑터를 함께 변경 |
| IDB-03 | 기존Auth UID와 로그인·회원 보존 | 사용자가 명시한 필수 조건 | 삭제·재가입 방식으로 바꾸지 않음 |
| IDB-04 | 계정과 학교 소속 기간을 분리 | 여러학교·전출·재임용을 한 사용자 연속성으로 처리 | 01의 권한행렬/07 이관을 함께 검토 |
| IDB-05 | 안내와 수합 결과 공개를 분리, 결과 기본 관계자 | 학교 안내 공개가 제출 원문 공개로 번지는 것 방지 | 결과 공개 승인과 민감항목 정책을 별도 명세 |
| IDB-06 | 학교 AI 대화는 생성 소속을 보존, 재임용 자동 재개 금지 | 과거 업무 문맥의 권한을 현재 소속만으로 부활시키지 않음 | 명시적 재접근/이관 정책·시험을 추가 |
| IDB-07 | 수합 JSONB 답변+불변 schema, 관계는 정형열/FK | 문항 다양성과 엄격한 판 해석을 함께 확보 | 문항종류·검증판·과거제출 변환 규칙이 필요 |
| IDB-08 | 학생·작성자·초안 정체성 불변 | 근거 연결 후 대상 바꾸기로 잘못된 학생 기록을 만들지 않음 | 새초안/새관계로 이동하고 새검토, 기존행 UPDATE 금지 |
| IDB-09 | 정확한 매핑판·채택·원본판을 고정 | A→B→A와 출처문자열만 있는 관찰의 허위 유효성 차단 | 03의 근거사슬과 영향전파 전체 검토 |
| IDB-10 | 내부서비스 요청자와 worker 분리 | 교사의 퇴직과 독립된 복구·파기, 비활성서비스 실행 방지 | 01 principal scope와 04 claim/finish검사 동시 변경 |
| IDB-11 | 외부 결과 불명확은 별도 상태와 대조 | 만료된 임대를 새 실행으로 단순 처리하지 않음 | 공급자별 idempotency/조회 증거가 있는 경우만 자동 재개 |
| IDB-12 | 정책 실제 수치·모델 비용값 미정은 임의 채우지 않음 | 규정과 사용자가 결정할 사항을 개발편의로 확정하지 않음 | 승인된 policy_versions/ai_policy_versions와 근거를 입력 |
| IDB-13 | 시간표 전체 DB 접점 유지, 알고리즘·운영 구현 보류 | 사용자의 보류를 지키며 최종 사이트 연결을 설계 | 재개 요청 후 API18~20·경합·초중고 시험 수행 |
| IDB-14 | DB와 파일·색인·외부 호출은 별도 커밋 경계 | PostgreSQL 트랜잭션이 외부서비스까지 원자적으로 만들지 못함 | outbox/시도원장/확정전실물검사/복구대조를 설계 |

## 정책과 구현을 구분하는 법

권한 없는 원문 차단, 같은 학교/학생/부모 참조, 멱등 접수, 검토판 고정은 구현 시 반드시 지킬 불변 조건이다. 학교 규정의 보존기간·출력 기준·자기 검토 예외·파일 미검사 허용은 승인된 정책판 없이는 확정 업무를 진행하지 않는 값이다.

설계 기준을 먼저 고정한 뒤 정책 값을 넣는 구조이므로 모든 화면 구현을 기다리게 하지 않는다. 합성 데이터로 입력·대기·정책미정·오류 화면을 구현하고, 운영 적용 전 해당 기능의 게이트만 통과시킨다.


---

<!-- SOURCE: 11-review-and-verification.md -->

# 통합 검토와 검증 결과

2026-10-12 · 설계 v1.0

## 이번 작업으로 완료한 것

- 완성될 사이트를 기준으로 16개 기능군·24개 API·12개 공통 계약·48개 수용 기준을 DB와 연결했다.
- Claude 원본 160표를 추출하고, 81개 표를 명시 보강하고 15개를 추가하여 175표·2,374열의 목표 카탈로그를 작성했다.
- 계정/학교/권한, 업무/수합/문서, 학생/수업/시간표, 지식/Claude/작업의 네 경계에서 상세 명세와 정형 변경 목록을 대조했다.
- 과거 비교 검토의 12개 반례에 대한 차단 조건을 설계하고 중앙 수용 시험 총 51건을 정의했다. 각 도메인 문서의 세부 시험은 이 51건에 추가된다.
- 사용자용 합본, 구조도와 표 검색, 전체 열 사전, 사이트/API 계약, SQL 인계서를 작성했다.

## 교차 검토 후 수정한 연결 문제

| 발견한 문제 | 반영한 수정 | 실제 SQL에서 확인할 시험 |
|---|---|---|
| 시간표 전체 보류로 학생 수강의 선행 표가 없음 | 공간·수업그룹·학급·교사 연결 4표는 B04~06 선행 생성 | 학생 수강·담당 정상 생성 |
| 강화된 감사 주체 제약이 기존 운영 함수와 충돌 | B01 공통 감사 함수와 검증된 bootstrap/migration 주체, 운영 함수 전환 | IT37 |
| 공통 승인자의 membership NULL과 승인 필수 문구 충돌 | 학교 승인만 membership 필수, 공통 승인은 account/at/ref 필수 | 정책판·공통 승인 |
| 정책이 바뀌면 동일 접수 재시도의 요청 지문도 바뀜 | 요청 의도와 첫 실행 맥락을 분리해 원래 접수 반환 | IT36 |
| 선택형 출처 모두에 MATCH FULL을 쓰면 정상행 거부 | MATCH SIMPLE + kind별 필수값/미사용값 CHECK | IT38 |
| 학교 문서가 공통 파일을 입력으로 참조할 수 없음 | 목적 scope와 file_scope_key를 분리하고 허용 조합·원본 ACL 검사 | IT38 |
| 외부 응답 직후 장애 시 재호출도 복구도 불가능 | 불변 결과 참조·지문과 response_received를 원자 저장 | R12, IT39 |
| 생성열 원본 메타가 변경 규칙과 불일치 | jobs의 svc 생성식과 deletion_ledger 일반 열 메타까지 교체 | 카탈로그 대조·서비스 파기 |

## 실제 실행한 검사

| 검사 | 결과 | 의미 |
|---|---|---|
| `node validate-design.cjs` | 오류 0, 경고 0 | 표/열/참조/신규 제약/청사진 연결의 정적 일치 |
| 실제 Chrome 구조도 확인 | 검색·영역·업무 탭·키보드·1440/390 화면 모두 통과 | 로컬 HTML이 정상 동작하며 외부 요청·브라우저 오류 없음 |
| 저장소 `npm test` | 962건 모두 통과 | 기존 사이트 코드 회귀 없음; 새 통합 DB 시험을 의미하지 않음 |

실행 결과 원본은 validation-result.json, overview-qa.json, 로컬 repository-tests.log에 있다. source-manifest.json에는 검토에 사용한 18개 원본의 지문을 남겼다. 원본의 수정 시점이 바뀌면 같은 이름이라도 다시 대조한다.

## 다음 단계의 완료 조건

1. Claude가 통합 계약에 맞는 SQL과 세부 RPC 입출력을 작성한다.
2. Codex가 카탈로그 차이와 R01~R12, 중앙 51건, 도메인별 정상/실패 경로를 검토한다.
3. 실제 PostgreSQL 두 연결, Supabase Auth/Storage, Claude worker 장애 경계, 파일 포함 복원과 부하 시험을 수행한다.
4. 기존 로그인·회원 대조와 쓰기 권위 전환을 검증한 뒤 사용자가 확정 SQL을 적용한다.
5. API 계약에 맞춰 사이트 어댑터를 연결하고 교사 역할별 업무 완주를 확인한다.

이번 산출물은 상세 설계를 완성한 것이다. 실제 운영 DB 적용, 신축 SQL의 보안 입증, 사이트 전체 구현 완료를 선언하지 않는다. 구현과 실증을 통해 06의 만점 조건을 충족시키는 것이 다음 단계다.


---

<!-- SOURCE: Claude_SQL작성_인계서.md -->

# Claude Web SQL 작성 인계서

2026-10-12 · 목표: 업무혁신시스템 통합 DB 설계 v1.0을 검증 가능한 SQL로 전환

## 맡길 범위와 기준

기존 Claude 최종 7개 파일은 좋은 출발점이지만 그대로 운영에 적용하지 않는다. 이 폴더의 통합 계약에 맞춰 DDL·권한·명령·시험을 함께 작성한다. SQL 확정본 작성은 Claude Web, 검토와 사이트 연결은 Codex, 실제 적용은 사용자라는 저장소 규칙을 유지한다. 이 인계서는 작업 지시 제안이며 Claude에게 메시지를 전송한 것은 아니다.

정본 우선순위는 01~07의 동작 계약과 schema-contract.json의 mandatory_* → 통합 열 목록 → 충돌하지 않는 원본 관계다. 원본 정책/함수는 검토 근거이며 자동 승인 대상이 아니다. 특히 source_policies_not_target과 inherited_*는 최종 실행 코드가 아니다.

SQL 작성 중 충돌을 발견하면 임의 선택으로 조용히 바꾸지 않는다. 충돌한 계약과 이유, 최소 수정안을 변경 목록으로 작성하고 관련 문서·정형 목록·수용 시험을 함께 맞춘다. 최종 SQL에서 열의 형식·NULL·생성식·FK·정책을 역추출하여 schema-contract.json과 비교하고 승인된 차이만 남긴다.

## GPT와 Claude에서 각각 가져온 것

| 원천 | 유지·강화한 장점 | 최종 구현 기준 |
|---|---|---|
| Claude | 기존 160표의 구체적인 열·키와 업무 분해 | 실제 카탈로그를 추출해 열 이름을 보존하고 필요한 변경만 명시 |
| Claude | 수합 단위, 시트 연계, 작업 시도, 이관·복원 표의 실행 가능한 출발점 | 권한·상태·원자성 계약을 통과하는 부분을 재사용 |
| GPT | 계정과 학교 소속 기간, 소유와 담당의 구분 | 재임용·전근·다중 소속·개인 원문 접근 규칙을 분리 |
| GPT | 교사의 전체 업무 여정과 화면/API 연결 | M00~M15, C01~C12, API01~24, V01~V48을 전부 추적 |
| GPT | 근거판·정책판·멱등·권한 회수·동시성 검토 | R01~R12 반례와 통합 시험으로 SQL의 완료 조건을 명시 |
| 통합 검토 | 공통 파일 입력, 선택형 FK, 감사 부트스트랩, 외부 응답 보관 경계 | 정상 경로도 막히지 않는지와 실패 경로 차단을 함께 시험 |

## 산출물 세트

1. 배치별 DDL·인덱스·RLS·grant와 명령 SQL. 테이블만 만드는 배치를 ‘기능 완료’로 표시하지 않는다.
2. 읽기 API 및 명령 입출력 JSON Schema. API-01~24는 기능군이므로 각 세부 RPC의 명칭·권한·오류·반환형을 확정한다.
3. 단일 연결 무결성/권한 시험, 실제 두 연결 경합 시험, worker 장애 시험을 분리한 실행기.
4. 기존 회원 이관 dry-run, 차이 대조 보고서, 컷오버 절차, 실패 시 쓰기 권위 복구 절차.
5. DB+Storage 실물 포함 복원 실습 결과, 부하 결과, 알려진 제한.
6. 통합 설계 대비 SQL 카탈로그 차이 목록과 각 차이의 승인 근거.

## 단계와 선행 관계

| 배치 | 먼저 완성할 것 | 종료 증거 |
|---|---|---|
| B00 | 실제 PostgreSQL/Supabase 버전·확장·기존 Auth/회원·버킷·백업 현황 | 기존 UID 보존 대조 기준, 적용 전 백업·복구 방법 |
| B01 | 스키마·형식·accounts·schools·membership·역할·운영 principal, 공통 감사/접수 골격 | 학교 생성·관리자 지정·이관 함수의 감사 주체 검증, 위조 거부 |
| B02 | 일정/개인 업무·기존 연결·새 DTO·최초 회원 연결 | 응답 유실·R03·회수와 재임용·두 연결 충돌 |
| B03 | 파일·job/outbox·삭제/회수/복구 원장 | DB/실물 불일치·worker 서비스 권한·명령 멱등/잠금 |
| B04~06 | 학년도/학기/과목/학급·공간·수업그룹/학급/교사 연결, 일정·업무·문서·파일·수합 | 정상 작성→접수→보완→검토, 공통 자료 입력, 인계 |
| B07~08 | 학생 학적/수강·담당·누가기록·수업 앱 채택 | 학생/원자료/연결판이 바뀔 때 오연결 차단 |
| B09~10 | 규정/지식·문서 생성·Claude 실행·도구·기억·평가/생기부 | 현재 ACL·근거·정책·사용량, 결과 불명확·재시도·응답 복구 |
| B11 | 이관 리허설·단일 쓰기 전환·파일 포함 복원·성능·종단 | 사용자·관리자 업무 완주와 권한/학생 무결성 필수 시험 |
| 시간표 재개 후 | 편성 제약·후보·배포판·교체·실시 원장 | 교사/학급/공간 중복과 변경 동의·동시 확정 시험 |

상세 배치 범위는 07을 따른다. B04~06에서 수업 공통 표인 spaces, course_groups, course_group_classes, course_group_teachers를 먼저 생성한다. 사용자가 보류한 시간표 알고리즘 구현과 이 공통 기반 생성을 혼동하지 않는다.

DDL의 물리 생성은 도메인 문서 순서와 다를 수 있다. 전체 표/키 정의를 먼저 생성하고 순환 참조의 FK를 후속 ALTER로 추가할 수 있지만 **하나의 배치 종료 시점에는 그 배치의 모든 제약이 활성화·검증돼 있어야 한다.** NOT VALID를 남겨 운영으로 넘어가지 않는다. 정책가드가 준비되지 않은 표는 API 노출·권한 부여를 닫아 둔다. 단순히 FK를 없애거나 NOT NULL을 풀어 순서를 해결하지 않는다.

## 구현 전에 반드시 반영할 변경

- 기존 Auth UID·Google 로그인·회원 데이터는 유지한다. 새 accounts.id와 기존 public.users.id를 혼동하지 않는다. 이관 재실행이 회수된 역할이나 종료 소속을 복구하지 않게 한다.
- 수합 공지 열람과 제출물 열람, 추천과 제출 의무를 분리한다. 문항판·제출판·파일지문·검사 정책판을 고정한다.
- 인계는 정확한 품목 목록에 대한 후임 수락이 있어야 하며 일부 실패하면 책임 이전 전체가 롤백된다. 전임자가 자신이 제출한 결과를 후임 검토자 권한으로 승인하는 경로도 막는다.
- document_inputs는 목적 범위와 파일 범위를 구분한다. 선택형 출처는 종류별 필수값 CHECK와 올바른 복합 FK 조합을 사용한다. MATCH FULL을 모든 선택형 참조에 일괄 적용하지 않는다.
- 원본 ACL을 사본·검색·파일·알림·AI 입력에도 적용한다. 감사 권한이 개인 업무 본문 열람권이 되지 않는다.
- 학생 정체성·채택·연결판·원자료판·초안판을 불변 관계로 연결한다. A→B→A도 새 연결판이며 과거 채택을 자동 복원하지 않는다.
- request_sha256은 요청 의도, 최초 실행의 정책/근거판은 보존한 실행 맥락이다. 정책 변경 후 동일 키 재시도가 새 업무를 만들거나 거짓 충돌을 일으키지 않는다.
- 서비스 principal의 범위·허용 행동·기한을 claim부터 finish까지 검사한다. 권한 gate와 업무 변경을 같은 잠금 계약으로 묶는다.
- 외부 요청 전송 이후의 결과 불명확을 자동 재시도로 덮지 않는다. response_received는 검증된 불변 결과 참조와 지문을 같은 commit에 저장한 상태만 뜻한다.
- 공통 write_audit(context)를 먼저 만든다. 서버 실행 DB identity를 검증한 주체만 bootstrap/migration principal로 해석하고 기존 운영 함수도 전환한다. actor NULL 또는 클라이언트 전달 actor로 회피하지 않는다.
- 파기 명령은 삭제 대상 manifest·보류·원본/사본/실물·재수입 방지·복원 후 삭제 재적용을 처리한다. 불변 규칙을 무력화하는 임의 DELETE 권한을 배포하지 않는다.

## 검증 인수 조건

`node validate-design.cjs`는 구조 및 문서 연결 검사다. 이것으로 운영 DB 시험을 대체하지 않는다. `acceptance-tests.json` 전 항목과 각 표/도메인의 세부 시험을 SQL·worker·화면 계층으로 배정한다. R01~R12 원래 반례가 각각 의도한 이유로 차단되는 것과 관련 정상 작업의 성공을 함께 기록한다.

시험 결과에는 코드 commit, DB 버전, 적용한 SQL 지문, 테스트 ID, 역할/범위, 결과, 실제 오류 또는 응답, 경합 관측을 남긴다. fixture 실패·문법오류를 권한 차단 성공으로 판정하지 않는다. 실제 두 연결, Supabase JWT/Storage, 외부 호출 경계, 복원은 각각 그 환경에서 입증한다.

통합 정본을 먼저 확정하고 SQL·API 계약을 연결하면 사이트 구현을 병렬로 진행할 수 있다. 다만 로그인/회원 보존·학교 경계·학생 근거·접수 원자성이 미검증인 상태에서는 ‘90% 완성’이라는 평균으로 공개를 허용하지 않는다.
