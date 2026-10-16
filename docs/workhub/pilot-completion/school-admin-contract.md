# 학교 관리 · 실제 서버 연결 계약 v1

작성: 2026-10-16 · W02 · SQL 작성 요청 / 앱 구현 계약

이 문서는 Claude가 작성할 증분 SQL의 요청서다. SQL을 작성하거나 적용한 기록이 아니다. 현재 운영 R0·R1, 기존 로그인·가입 승인·회원·제출 자료는 그대로 보존한다. 학교 관리의 실제 저장 완료 조건은 아래 RPC 설치, 관리자 배정, 서버 시험, 실제 환경 연결 검증이다. 앱에서 함수가 없거나 준비 응답이 없으면 연결 준비가 필요하다고 표시한다.

## 1. 앱에서 만든 기능과 연결 지점

- `SchoolAdminPanel`: 학교 구성 / 교사 소속 / 공식 담당. 학교·학년도·학기·부서·학급·교과 구성, 새 학년도 준비, 기존 학교 소속 승인·중지·종료·반려, 기간이 있는 담당 배정·종료.
- 구성의 수정 전후를 모든 필드·행에 걸쳐 보여 준 다음 명시적으로 반영한다. 학기 날짜·반 번호·삭제 항목도 생략하지 않는다.
- 동시 수정 시 편집 전/내 입력/최신 자료를 3방향 비교한다. 서로 다른 칸은 함께 보존하고 같은 칸이나 삭제 대 수정의 충돌은 사용자가 선택한다. 비교 후 다시 검토하여 새 요청을 만든다.
- 쓰기 원문·기존 요청 번호는 `usePendingRequest(member, 'schoolAdmin')`에도 보관한다. 응답 단절, 잘못된 응답, 계정 전환, 멱등 충돌은 미확정 상태로 유지한다. 서버 접수증 또는 명확한 비변경 거절만 요청을 해제한다.
- 기존 `SchoolSetupPanel`의 초안 가져오기·내보내기 기능은 보존한다. 새 학교 관리 폼이 그 파일을 운영 적용됐다고 취급하지 않는다.
- 날짜 UI는 마지막 날 포함이다. 서버의 기간 저장 방식이 종료일 미포함이면 변환은 SQL이 수행한다.
- `SchoolAdminPanel` props: `connection`, `member`, `date`, `revision?`, `onNavigationLockChange?`, `onUpdated?`. `onUpdated`는 확인된 접수증 뒤 바깥 학교 문맥을 재조회하는 데 사용한다. 원본 공용 인증 연결을 바꾸지 않는다.
- 자신의 학교 소속 상태 변경은 화면에서 제공하지 않는다. 다른 관리자가 담당한다. SQL도 직접 호출을 거부해야 한다.

## 2. RPC 이름과 인자

모두 `connection.rpcVerified`로 호출하며 기존 가입 승인 확인을 재사용한다. 사용자 ID와 학교 ID는 클라이언트 입력으로 받지 않는다. `p_member_id`가 가리키는 기존 소속과 `auth.uid()`를 함께 확인해서 학교를 도출한다.

| 함수 | 인자 | data |
| --- | --- | --- |
| `workhub_school_admin_readiness` | `p_member_id text` | `SchoolAdminReadiness` |
| `workhub_school_admin_get` | `p_member_id text`, `p_school_year integer default null` | `SchoolAdminSnapshot` |
| `workhub_school_admin_mutate` | `p_member_id text`, `p_command jsonb`, `p_request_key text` | `SchoolAdminReceipt` |

DB ID가 UUID이면 인자 검증 후 안전하게 변환한다. 앱의 신규 행 임시 식별자는 `draft-<uuid>`다. 이를 운영 UUID로 착각하여 형변환하지 않는다. 신규 행만 서버가 새 영구 ID를 발급하며 멱등 요청 재전송 때 같은 행을 다시 만들지 않는다. 기존 행은 원래 ID로 갱신하고 다른 학교·학년도 ID 주입을 거부한다.

### 공통 성공 응답

```json
{
  "kind": "workhub-school-admin",
  "schemaVersion": 1,
  "schoolId": "현재 학교 ID",
  "memberId": "요청한 소속 ID",
  "data": {}
}
```

### 공통 업무 오류 응답

```json
{
  "kind": "workhub-school-admin",
  "schemaVersion": 1,
  "schoolId": "현재 학교 ID",
  "memberId": "요청한 소속 ID",
  "error": { "code": "CONFLICT" }
}
```

성공은 `data`, 업무 오류는 `error` 중 하나만 쓴다. 필드 추가·삭제, 다른 학교·소속, 알 수 없는 버전을 앱이 거부한다. 상세 SQL 오류·개인정보·토큰은 응답에 넣지 않는다. 함수 준비 전 또는 호출 자체가 실패하면 앱은 QUERY_FAILED/RESULT_UNKNOWN으로 취급하고 저장을 가장하지 않는다.

오류 코드는 `NOT_READY`, `INVALID_INPUT`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`다. 모든 업무 오류 응답은 DB 변경이 없는 확정 거절이어야 한다. 변경 후 실패 가능성이 남는 경우 성공을 꾸미거나 확정 거절을 반환하지 말고 트랜잭션을 끝까지 원자적으로 보장한다.

## 3. 준비 상태와 스냅샷

준비 상태:

```ts
type SchoolAdminReadiness =
  | { available: true }
  | { available: false; reason: 'not_installed' | 'not_configured' | 'forbidden' }
```

함수 설치만으로 true를 만들지 않는다. 원자적 버전/멱등 원장/학교 단위 제약/관리자 권한과 초기 기존 소속 연결이 모두 준비되어야 한다. 신규 권한은 승인받은 관리자에게만 부여한다. 현재 전체 공개 또는 기존 인증 역할 승격은 이 요청에 포함하지 않는다.

정확한 타입 원본: `apps/workhub/src/setup/school-admin-contract.ts`.

```ts
interface SchoolAdminSnapshot {
  version: number
  asOfDate: string // 학교 시간대 YYYY-MM-DD
  availableYears: number[]
  configuration: SetupDraft
  subjects: { id: string; name: string }[]
  memberships: {
    id: string; name: string
    status: 'pending' | 'active' | 'suspended' | 'ended' | 'rejected'
    startsOn: string; lastDay: string; version: number
  }[]
  assignments: {
    id: string; memberId: string
    kind: 'homeroom' | 'department' | 'subject' | 'duty'
    targetId: string | null; label: string
    startsOn: string; lastDay: string
    status: 'active' | 'ended'; version: number
  }[]
  capabilities: { configuration: boolean; memberships: boolean; assignments: boolean }
}
```

`SetupDraft`는 다음 키를 정확히 쓴다. 이름은 초안이지만 응답에 실리는 내용은 검증된 현재 학교 구성이다. 파일 내보내기의 `deploymentState` 표시는 RPC 응답에 포함하지 않는다.

```ts
interface SetupDraft {
  draftId: string // 현재 학년도 구성의 영구 식별자
  schoolName: string; schoolCode: string; schoolType: string; gradeCount: string
  schoolYear: string; startsOn: string; lastDay: string
  terms: { id: string; termNo: string; name: string; startsOn: string; lastDay: string }[]
  departments: { id: string; name: string }[]
  classes: { id: string; grade: string; classNo: string; name: string; kind: string }[]
}
```

학년도는 `setup/assets/school-admin.json`의 `schoolYearBounds`(2020~2100, 양 끝 포함)를 따른다. 학교관리 초안·응답·명령과 새 학년도 생성/목록은 같은 범위다. `classes.kind`는 `regular|special|multigrade|other`만 허용한다.

숫자처럼 보이는 `SetupDraft` 값도 폼 초안 계약에서는 문자열이다. `SchoolAdminSnapshot.version`, 행 version, availableYears, 명령의 schoolYear, 접수증의 schoolYear는 숫자다. 반 번호가 없는 특수·복식 학급은 `classNo: ''`를 쓴다. terms·departments·classes·subjects ID는 구성 안에서 중복될 수 없다.

스냅샷은 선택 학년도 구성과 그 학년도 공식 배정, 현재 학교의 기존 소속 목록을 완전하게 반환한다. 임의 1,000행 제한으로 뒤를 잘라 성공처럼 응답하지 않는다. 기술 한도 초과는 명시적으로 실패시키고 계약을 확장한다. 현재 화면은 표시만 페이지를 나누며, 조회한 전체 목록을 검색한다.

`version`은 학교 관리 전체의 단일 revision이다. 어떤 학년도의 구성·소속·공식 담당이 바뀌어도 원자적으로 증가한다. 오래된 학년도 화면에서 현재 학교 소속을 덮어쓰는 것을 막는다. 각 행의 version은 감사/후속 확장용이며 명령의 expectedVersion을 대신하지 않는다.

`capabilities`는 서버가 현재 권한에서 계산한다. 화면 버튼 비노출은 보안 경계가 아니며 mutate에서 같은 권한을 다시 검사한다. 관리자 읽기 범위가 없는 사용자는 전체 소속 목록을 받을 수 없어야 한다. 이름 외 로그인 이메일·auth ID·역할 내부 정보는 이 응답에 포함하지 않는다.

## 4. 명령의 정확한 형태

각 명령은 아래 필드만 받는다. expectedVersion은 양의 안전 정수, reason은 비어 있지 않은 변경 사유다. 사유의 줄바꿈은 보존한다.

```ts
// 구성 수정 또는 새 학년도 생성
{ kind: 'save_configuration', expectedVersion: number,
  mode: 'update' | 'create_year', configuration: SetupDraft,
  subjects: {id: string; name: string}[], reason: string }

// 공식 담당 배정
{ kind: 'assign_duty', expectedVersion: number, schoolYear: number,
  memberId: string, assignmentKind: 'homeroom' | 'department' | 'subject' | 'duty',
  targetId: string | null, label: string,
  startsOn: string, lastDay: string, reason: string }

// 담당 종료일 확정: 과거 배정을 삭제하지 않음
{ kind: 'end_assignment', expectedVersion: number, schoolYear: number,
  assignmentId: string, lastDay: string, reason: string }

// 기존 로그인 회원의 학교 소속 상태만 관리
{ kind: 'review_membership', expectedVersion: number, schoolYear: number,
  targetMemberId: string, decision: 'active' | 'suspended' | 'ended' | 'rejected',
  startsOn: string, lastDay: string, reason: string }
```

### 학교 구성

- `update`는 같은 학교의 같은 기존 학년도·구성 ID만 갱신한다. schoolCode 변경과 schoolYear 변경은 거부한다. 새 학교 개설/학교 병합/코드 변경은 이 API 범위가 아니다.
- `create_year`는 아직 존재하지 않는 학교+학년도만 만든다. 기존 학년도를 덮어쓰지 않는다. 화면은 학교 기본값과 구성 이름만 복사하며 새 기간은 공란으로 확인받는다. 교사 담당·학생·제출·개인 자료는 복사하지 않는다.
- 새 구성에서 빠진 행은 참조가 없을 때만 제외한다. 학생, 수합, 공식 담당, 이력에서 참조하는 행을 삭제하거나 CASCADE로 지우지 않는다. 이력 보존을 위한 종료/버전 처리 또는 명확한 거절이 필요하다.
- 이 RPC의 부서·교과·학급 구성은 학년도별 구성 정의다. 새 학년도의 임시 행을 같은 이름이라는 이유만으로 다른 학년도의 기존 행에 병합하지 않는다. DB에서 학교 공통 조직 식별자를 재사용하더라도 학년도별 유효 관계/이름 이력을 별도로 보존해야 한다. 기존 R0 테이블과의 실제 매핑을 SQL 설계결정 문서에 명시한다.
- 학기 중첩 금지, 학년도 범위 안, 실제 날짜, 시작≤마지막 날. 학기 간 공백은 허용한다. 방학 포함 여부나 법정 학년도를 임의로 덮어쓰지 않는다.
- 학교급 elementary/middle/high/special/other. 일반 초등은 1~6, 중·고는 1~3 범위의 실제 운영 학년 수. 특수·기타는 현재 기술 한도 1~20이며 법정 학제 규정이라는 뜻이 아니다. 최종 값은 학교가 확인한다.
- 학급 학년은 운영 학년 수 안. 비어 있지 않은 `(학년도, 학년, 반 번호)`는 중복 금지. 표시 이름도 해당 학년도 안에서 고유하게 검증한다. 빈 반 번호의 특수/복식 등은 이름으로 구분한다.

### 공식 담당

- 담임 targetId는 같은 학년도 학급, 부서는 같은 학년도 부서 정의, 교과는 같은 학년도 교과 정의다. 일반 업무는 targetId=null과 사람이 확인한 label을 사용한다.
- 대상 회원이 같은 학교의 active 소속이어야 하고, 담당 기간은 소속 기간과 해당 학년도 범위 안이다. 미래 배정도 정확한 기간을 저장한다.
- 1차 계약의 담임은 단일 주담임이다. 같은 학급의 주담임 기간 중복은 거부한다. 공동담임을 도입할 때는 역할 종류/선택 화면/시험을 함께 확장한다. 부서·교과 담당은 여러 교사가 가능하지만 같은 교사의 같은 대상 중복 기간은 거부한다.
- `end_assignment`는 해당 배정의 시작일~기존 마지막 날 안에서 종료일을 줄인다. 동일 날짜 포함 의미를 지킨다. status=ended는 종료일을 확정한 기록이며 현재 날짜 전에 즉시 효력을 없앤다는 뜻이 아니다. 효력은 기간으로 계산한다.
- 직접 배정은 시간표 생성/교시 배치가 아니다. 시간표 보류는 유지한다.
- `workhub_context`가 공식 배정의 유효 기간을 기준으로 학년/부서/교과 관계를 제공하도록 후속 연결이 필요하다. 클라이언트가 승인 전 자기 입력을 공식 관계로 승격하지 않는다. 기존 컨텍스트 호환 계약과 회귀 시험을 유지한다.

### 교사 소속

- 이미 존재하는 승인된 로그인 회원과 학교 소속 신청/기록을 대상으로 한다. 새로운 auth.users/public.users 생성·수정, 기존 가입 승인 변경, 최고관리자 승격을 하지 않는다.
- pending→active/rejected, active→suspended/ended, suspended→active/ended의 명시적 전이. ended/rejected→active 복구는 같은 기존 회원의 새 유효 기간과 권한을 서버가 확인할 때만 허용하고 감사 기록을 남긴다. 날짜·소속 중복·이전 기록 보존을 검증한다.
- 상태는 트랜잭션 반영 시 바뀐다. startsOn/lastDay는 소속 기간이며 미래의 상태 변경 예약 API가 아니다. UI 검토에도 이 차이를 표시한다.
- 자기 소속 상태 변경, 마지막 관리자 제거, 관리자가 자기보다 높은 범위의 권한을 부여하는 작업은 거부한다. 이 명령에는 권한 부여 필드 자체가 없다.
- 소속 중지/종료 시 이미 맡은 수합·검토·담임 등 진행 중 의무의 처리 규칙이 필요하다. 후임 인계 없이 미완료 의무를 유실시키는 변경은 CONFLICT 또는 INVALID_INPUT으로 거부하고, 인계 기능과 연결한다. 자료 삭제로 해결하지 않는다.
- 아직 소속 없는 사용자의 학교 검색/연결 신청은 별도 승인 경로다. 이 관리자 RPC로 전 학교 가입자를 검색하거나 학교 연결을 우회하지 않는다.

## 5. 접수증·멱등·동시성·감사

```ts
{ requestKey: string, kind: SchoolAdminCommand['kind'], version: number,
  schoolYear: number, recordedAt: string /* ISO 8601 timezone 포함 */ }
```

- 완료 version은 해당 요청 expectedVersion보다 커야 한다. 클라이언트가 보낸 requestKey/kind/학년도와 일치해야 한다.
- `(school_id, actor_member_id, request_key)` 원장에 canonical 입력 지문과 접수증을 저장한다. 같은 키+같은 원문은 처음 접수증을 반환하고 두 번 변경하지 않는다. 같은 키+다른 원문은 IDEMPOTENCY_CONFLICT다.
- 매번 현재 로그인 승인·소속·권한을 먼저 확인한다. 그 뒤 원장에 완결된 같은 요청이 있으면 현재 version보다 이전이어도 기존 접수증을 반환한다. 새 요청만 expectedVersion 비교와 학교 revision 잠금/CAS를 거친다.
- 읽기 snapshot도 일관된 한 트랜잭션 시점으로 구성한다. 표를 서로 다른 시점에 읽어 없는 참조나 섞인 version을 만들지 않는다.
- 명령, 대상, 변경 전/후, 사유, 학교 시간, actor, requestKey, 결과 version을 감사 원장에 남긴다. 일반 사용자 응답에는 다른 사람의 사적인 정보나 원문 오류를 노출하지 않는다.
- 행 삭제·CASCADE·로그인 회원 재생성·소속 ID 재발급으로 동시성 문제를 해결하지 않는다.

## 6. Claude SQL 구현·시험 요청

기존 적용본을 수정하지 말고 증분 배치로 작성한다. 신규 표/제약/권한은 앱 타입과 기존 R0 컨텍스트·학교 회원 식별자에 맞춘다. 권한 주체와 학교/학년도 참조는 복합 FK 등 DB 제약으로 보강하고 SECURITY DEFINER의 search_path를 고정한다. authenticated가 내부 표를 직접 조작하지 못하게 한다.

필수 SQL 시험:

1. 다른 학교 회원/학급/부서/교과 ID 주입, 승인 대기·중지 계정, 만료 소속, 위조 actor 차단.
2. readiness 설치 전/설정 전/권한 없음과 실제 준비 상태 구분.
3. 정확한 JSON 키/타입, 비정상 배열·숫자·날짜·버전·제어 문자 거부.
4. 학교급 학년 범위, 같은 학년·반 중복, 학기 마지막 날 포함 중첩/윤년/경계.
5. 기존 학년도 ID 유지, 새 학년도 중복 생성 방지, 다른 학교/연도 ID 차단.
6. 현재 자료가 참조하는 구성 행 제외 거부, 과거 이름·기간·제출·배정 이력 보존.
7. 공식 담당 기간/대상/소속 검증, 주담임 기간 중복, 동일 담당 중복.
8. 소속 상태 전이, 자기 변경·마지막 관리자 제거 방지, 미완료 의무 인계 전 변경 거부.
9. 동시 version CAS 한 명만 성공, 성공 후 응답 단절 재전송 한 번만 반영, 동일 키 다른 내용 거부.
10. 트랜잭션 중간 강제 실패 뒤 학교 구성·revision·원장·감사 모두 원상태.
11. 실제 SQL 응답을 `schoolAdminEnvelope/schoolAdminSnapshot/schoolAdminReceipt`에 넣어 검증.
12. R0/R1 기존 함수·회원·제출·Storage 지문 보존과 기존 앱 회귀.
13. 공식 담당 변경 이후 `workhub_context` 관계가 기간별로 맞고 다른 학교의 관계가 섞이지 않는지.

자동 앱 검증:

- `node tests/test_workhub_school_admin.mjs` — 계약·어댑터·3방향 병합·렌더.
- `node tests/test_workhub_school_setup.mjs` — 기존 초안 가져오기/내보내기 호환.
- `node tests/browser/workhub-school-admin.mjs` — 실제 컴포넌트 입력·확인·미확정 재전송·충돌 선택·모바일.
- `npm run check:workhub` — 타입 검사.

이 시험은 합성 서버로 앱 경로를 검증한다. SQL/실제 Supabase 적용·RLS·동시 트랜잭션·실제 PostgREST 왕복을 완료했다는 뜻은 아니다. 기술 연결 시험은 SQL 검토/사용자 적용 뒤 별도로 수행한다. 교사 실사용 피드백은 사용자의 요청대로 마지막에 모아서 진행한다.

## 7. 판단해서 정한 것

- 전체 학교 관리 version을 써서 학년도별 화면에서 소속/담당을 동시에 바꿀 때 충돌이 빠지지 않게 했다. 세밀한 독립 revision 최적화는 실제 경합 근거가 생기면 계약 버전을 높여 변경한다.
- 이름이 같다고 다른 학년도 조직/학급을 자동 병합하지 않는다. 명시적 인계·기간 관계가 없는데 자료가 섞이는 것을 막기 위함이다.
- 모든 입력을 서버 저장 전 임시 탭 메모리에 두고, 결과 불명 요청은 별도 공통 원장 메모리에 남긴다. 브라우저를 닫은 뒤 자동 복구가 된다고 주장하지 않는다.
- 신규 학교 개설, 소속 없는 회원의 연결 신청, 최고관리자 권한 변경은 현재 관리자 RPC에 합치지 않는다. 별도의 권한·승인 경로로 연결해야 한다.
- 시간표 생성/수정은 넣지 않고 공식 수업·업무 담당 정보만 만든다.

최근 추가 자동검증: 학교관리 34건 통과. 승인 조회가 제한시간 뒤 늦게 성공해도 새 저장 RPC를 시작하지 않으며, 이미 보낸 저장의 지연 응답은 미확정 상태와 원래 key/payload를 보존한다. 학교관리/새 학년도 공통 학년도 경계 2020·2100과 범위 밖 입력을 별도 전환 회귀에서 검사했다.


## 2026-10-16 확정 정책: 새 학년도 시작 연도

사용자가 학년도 숫자와 시작일 연도가 다르면 거부하는 Q4 권장안을 확정했다. 학교관리 `save_configuration / create_year`와 전환의 새 학년도 계획에 동일하게 적용한다. 예: 2027학년도 + 2026-03-02는 거부, 2027-03-02~2028-02-29는 허용한다. 시작 월·일이나 방학 기간을 임의로 정하지 않는다.

- 공통 `setup/academic-year.ts`의 `academicYearStartMatches`로 실제 날짜와 시작 연도를 대조한다. 새 입력은 화면 검토 및 전송 어댑터에서 검사하며 오류에 해당 필드의 의미를 설명한다.
- 기존 스냅샷 조회와 기존 구성 `update`에는 소급 적용하지 않는다. 학년도 번호가 다른 과거 자료를 숨기거나 고쳐 저장하지 않는다.
- 정책 전에 이미 전송한 결과 미상 요청은 원문·번호를 그대로 보존한다. 클라이언트 내부의 `existingRequest` 옵션은 그 복구 경로에만 사용하고 RPC 인자나 명령 JSON을 변경하지 않는다. 새 요청을 만들 때는 항상 새 정책으로 검사한다.
- SQL은 같은 원문·번호의 기존 접수증을 먼저 반환한 뒤 새 생성에만 Q4를 검사해야 한다. 접수된 요청을 새 정책 때문에 미저장으로 판단하거나 새 번호로 복제하지 않는다. P1/P7의 새 학년도 경로에 같은 검사를 넣고 INT-03을 재생성하는 작업은 Claude 담당이다.
- 기존 가입·인증·학교 소속 승인·공개 범위는 변경하지 않는다.

추가 회귀: 학교관리 계약·어댑터 39건, 화면 13개 시나리오. 잘못된 연도에서 RPC 0, 입력 유지 후 날짜 수정, 이듬해 윤년 종료, 과거 스냅샷·미확정 원문 복구를 확인했다. 실제 DB 적용 결과가 아니다.
