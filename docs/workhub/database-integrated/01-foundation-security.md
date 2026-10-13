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
