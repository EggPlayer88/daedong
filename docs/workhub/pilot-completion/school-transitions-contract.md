# W14 업무 인계·새 학년도 — 증분 SQL 계약

2026-10-16 · 사용자 승인 정책 Q2·Q4를 반영한 앱 계약이다. SQL 확정본은 Claude가 작성하고 사용자가 적용한다. 이 작업에서는 DB·권한·인증·메뉴 공개 설정을 바꾸지 않았다. 기준 구현은 `administration/transitions.ts`, `SchoolTransitions.tsx`다.

## 적용 순서와 호환 범위

**앱 배포 → 아래 관리자 확인 계약의 SQL 작성·검증·사용자 적용 → 별도 기능 활성화** 순서다. 기존 SQL이 `awaiting_admin`을 반환하기 시작하면 이전 앱 파서가 거부하므로 새 앱을 먼저 준비한다. 실제 운영 SQL에 관리자 확인 기능이 설치됐다고 주장하는 문서가 아니다.

- 구 SQL의 목록은 계속 읽는다. 공식 담당 자원의 선택·미리보기·새 요청은 막고 준비 중으로 표시한다.
- 구 기록에는 공식 담당 포함 여부가 없어 **모든 구 인계 기록의 인수·반려를 막는다**. 일반 협업·수합 기록도 이 임시 제한에 포함된다. 공식 담당을 우회 수락하는 것보다 안전한 경계를 택했다. 기존 목록 조회, 요청 취소, 협업·수합의 새 요청 접수, 새 학년도 준비는 계속 사용할 수 있다.
- 새 계약이 준비됐는지 새 쓰기 직전 다시 조회한다. 구 SQL이나 `dutyApproval:null`에서는 공식 담당 apply, accept/reject, admin_confirm/admin_reject를 전송하지 않는다. 같은 키 복구도 새 계약 준비 전에는 키·입력을 남기고 기다린다. 서버 준비 조회 실패를 이미 보낸 명령의 확정 거절로 취급하지 않는다.
- 새 계약의 일부 필드만 넣거나 구/신 기록을 섞어 보내면 읽기를 거부한다. SQL은 읽을 수 있는 전체 기록을 새 형태로 일관되게 반환해야 한다. 숨겨진 관리자 단계가 화면에서 없는 것처럼 보이지 않게 하기 위함이다.
- 새 목록 계약과 접수증 복구는 구분한다. **기존 키로 이미 확정된 구 접수증은 그대로 보존**한다. 공식 담당 `apply`의 과거 `pending v1` 접수증은 앱의 원요청 복구에서만 읽고, 현재 승인/인수 완료라고 안내하지 않는다. 중립 안내 후 현재 목록을 다시 조회한다. 새 `apply`는 `awaiting_admin v1`만 성공으로 인정한다.
- 기존 공식 담당 pending 기록이 있을 경우 SQL 작성자가 안전한 전환 방안을 별도로 명시해야 한다. 관리자 확인 없이 `requiresAdminReview:false`로 내려 보내거나 확인 이력을 만들어 내면 안 된다. 현재 목록은 아래 불변식을 만족해야 하며 원접수증은 고치지 않는다. 현재 운영에서는 P7/Q2를 아직 적용하지 않아 이 전환을 수행하지 않았다.

## RPC와 공통 규칙

`services/scoped-rpc.ts` 봉투 `{contract:'school-transitions.v1',schoolId,memberId,data}` 또는 같은 범위의 `error:{code}`를 사용한다. 기존 승인·유효 소속·공식 권한 검사를 유지하며 표 직접 권한을 열지 않는다. **기존 RPC 인자 이름과 접수증 모양은 유지**한다.

- `workhub_school_transition_list(p_member_id,p_cursor)` → `{canManageYear,dutyApproval,years,recipients,resources,records,nextCursor}`.
- `workhub_school_transition_preview(p_member_id,p_plan)` → `{fingerprint,expiresAt,summary,excluded,affectedCount}`. 원본이나 권한을 변경하지 않는다.
- `workhub_school_transition_mutate(p_member_id,p_command,p_request_key)` → `{requestKey,recordId,version,state,recordedAt}`. 같은 사용자·학교·키·내용이면 원접수증을 반환한다. 다른 내용은 충돌한다. 원본 변경과 감사·접수증 저장은 원자적이어야 한다.

```ts
type Resource = {kind:'duty'|'cooperation'|'collection';id:string;version:number;label:string};
type Plan =
 | {kind:'handover';recipientMemberId:string;recipientVersion:number;resources:Resource[];note:string}
 | {kind:'new_year';sourceYearId:string;targetYear:number;firstDay:string;lastDay:string;
     term1First:string;term1Last:string;term2First:string;term2Last:string;copyStructure:boolean};
type Command =
 | {kind:'apply';plan:Plan;fingerprint:string}
 | {kind:'accept'|'reject'|'cancel'|'admin_confirm'|'admin_reject';
     recordId:string;expectedVersion:number;reason:string};

type AdminReview = {
 memberId:string;name:string;decision:'confirmed'|'rejected';reason:string;recordedAt:string
};
type Record = {
 id:string;kind:'handover'|'new_year';title:string;version:number;
 state:'awaiting_admin'|'pending'|'accepted'|'rejected'|'cancelled'|'completed';
 canAccept:boolean;canCancel:boolean;summary:string[];
 requesterMemberId:string;requiresAdminReview:boolean;canAdminReview:boolean;adminReview:AdminReview|null
};
```

### 목록 확장 필드

| 필드 | 정확한 의미 |
|---|---|
| `dutyApproval` | `'admin_review_v1'`이면 이 계약의 관리자 확인 구현과 호출 경로가 준비됨. `null`이면 준비/활성화 대기. 개인의 승인 권한을 뜻하지 않는다. 구 SQL에 필드가 없는 경우 앱 내부에서는 null로 읽는다. |
| `requesterMemberId` | 인계를 최초 요청한 학교 소속 ID. 현재 담당자로 소급 교체하지 않는다. 새 학년도 기록도 최초 요청자 ID를 반환한다. |
| `requiresAdminReview` | 원 요청 자원에 공식 담당(`duty`)이 하나라도 있었는지. 과거 원본을 현재 자원 목록으로 다시 추측하지 않는다. |
| `canAdminReview` | 현재 사용자가 이 기록의 관리자 확인/반려를 할 수 있는지. `year.manage` 권한, awaiting_admin 상태, 요청자와 다른 사람이라는 조건을 모두 만족해야 한다. |
| `adminReview` | 이 요청에 실제로 기록된 관리자 결정. 없으면 null. 확인자의 이름·소속 ID·결정·사유·시각을 반환하며 요청자와 확인자는 달라야 한다. `recordedAt`은 실재 날짜와 시간대가 포함된 ISO 시각이다. |

`years={id,label,year}[]` 최대100, `recipients={memberId,name,version}[]` 최대500, `resources` 최대200, `records` 최대50. 초과를 조용히 잘라내지 않는다. `nextCursor`는 기록의 안정 커서다. 서버는 접근 가능한 이름·ID·내용만 반환한다. `summary`에는 검토에 필요한 현재 담당, 인수 대상, 선택 자원과 범위를 담는다. 앱은 관리자 확인·반려·수신자 인수 폼에도 제목·현재 상태·판·요약과 기존 관리자 결정을 유지한다.

구 목록에는 확장 필드 다섯 가지(`dutyApproval`과 record 확장 네 가지)가 모두 없다. 앱이 추가하는 null/false 기본값은 **SQL 응답 예시가 아니다**. 새 SQL 응답에서는 위 네 record 필드를 반드시 모두 반환한다. `dutyApproval:null`이어도 이미 기록된 관리자 결정은 읽을 수 있어야 한다.

## 상태와 원자성

### 공식 담당이 포함된 인계

| 명령 | 이전 상태/판 | 결과 상태/판 | 효과 |
|---|---|---|---|
| `apply` | 없음 | `awaiting_admin`, 1 | 요청만 생성. 담당·열람 권한은 그대로 |
| `admin_confirm` | `awaiting_admin`, 1 | `pending`, 2 | 관리자 확인 기록. 아직 담당 변경 없음 |
| `admin_reject` | `awaiting_admin`, 1 | `rejected`, 2 | 관리자 반려 기록. 담당 변경 없음 |
| `cancel` | `awaiting_admin`, 1 | `cancelled`, 2 | 요청자가 철회. 관리자 결정은 null |
| `accept` | `pending`, 2 | `accepted`, 3 | 수신자 수락과 담당 변경을 한 트랜잭션으로 수행 |
| `reject` | `pending`, 2 | `rejected`, 3 | 수신자 반려. 기존 관리자 확인 기록 유지 |
| `cancel` | `pending`, 2 | `cancelled`, 3 | 요청자 철회. 기존 관리자 확인 기록 유지 |

- `admin_confirm/admin_reject`는 `year.manage` 확인 권한이 있어야 한다. 요청자 본인은 자신의 요청을 관리자 자격으로 확인·반려하지 않는다. 필요한 경우 요청자 취소를 사용한다. 신규 권한이나 회원 승격을 앱에서 만들지 않는다.
- 관리자 확인 전에는 수신자의 `canAccept=false`. 수신자 대기함/홈 알림에도 아직 인수 가능한 것으로 세지 않는다. 관리자에게 필요한 확인 대기 건수는 SQL 홈 계약에서 별도로 제공해야 한다.
- `canAdminReview=true`는 awaiting_admin에서만 가능하고, 확인 이력은 null이어야 한다. 승인 이력이 없는데 pending/accepted인 공식 인계, 자기 확인, 반려 이력인데 pending/accepted인 기록, 상태와 판의 불일치는 응답 오류다.
- 관리자 확인에서 담당 원본 판·기간·수신자 유효성을 다시 검사하고, 수신자가 수락할 때도 다시 검사한다. 둘 사이에 원본이 바뀌면 전체 CONFLICT다. 부분 인계하지 않는다.
- `expectedVersion` 비교와 원본 잠금, 관리자 결정·감사 이력·접수증 저장은 같은 트랜잭션이다. 실제 이력에는 `admin_confirm/admin_reject`를 남긴다. 목록의 `adminReview`는 이 실제 이력에서 만든 요약이며 추정 값이 아니다.

### 협업·수합만 포함된 인계와 새 학년도

- 협업·수합만 있으면 기존처럼 `apply → pending v1`, 수신자 accept/reject 또는 요청자 cancel → v2다. `requiresAdminReview=false`, `canAdminReview=false`, `adminReview=null`이다.
- 공식 담당과 협업/수합을 함께 선택하면 전체 요청이 관리자 단계를 거친다. 수신자 수락까지 어느 자원도 부분 이전하지 않는다.
- 새 학년도는 `completed v1`. 관리자 인계 필드는 false/false/null이며 인수·취소 버튼은 없다. 인계 기록에 `completed` 상태를 쓰지 않는다.
- 수합의 담당자·공동책임자·검토자 충돌 금지 등 R1 규칙을 유지한다. 과거 작성자/접수증/감사 actor를 새 담당자로 바꾸지 않는다.

## 미리보기 지문

서버는 정규화된 plan, actor/school, 모든 원본 판, 수신자 판, 학교관리 snapshot 판, 학년도/날짜/구조 해시와 **관리자 확인 정책판**을 포함한 SHA256을 만든다. 요약·제외 항목·영향 개수를 함께 반환한다. `expiresAt`은 시간대 포함 ISO 시각이다. 권한·자료·정책 변경 또는 만료 뒤 새 apply는 CONFLICT다. 브라우저가 보내는 지문 문자열만 맞는다고 통과시키지 않는다.

같은 키로 이미 확정된 접수증을 읽을 때는 현재 미리보기 만료, 현재 원본 판, 새 학년도 의미검사로 과거 결과를 감추지 않는다. 먼저 기존 접수증과 명령 동일성을 검사하고, 처음 접수되는 명령에만 현재 정책과 원본 조건을 검사한다. 재확인은 자동 승인/자동 수락이 아니다.

관찰·상담·개인 DM·개인 할 일·개인 문서·학생기록 초안·개인 AI 대화는 인계 대상이 아니며 preview에도 섞지 않는다. 본인에게 인계할 수 없고, 요청/수락이 회원 생성이나 계정 승격을 일으켜서는 안 된다.

## 새 학년도 정책 Q4

- 학교관리 권한만 생성한다. 기준 학년도는 현재 학교 원본 ID. `targetYear` 범위는 `setup/assets/school-admin.json`의 `schoolYearBounds`이며 현재 2020~2100이다.
- 실제 날짜 검증 후 **`targetYear === Number(firstDay.slice(0,4))`**를 새 미리보기와 새 명령에서 검사한다. 학교관리 create_year 경로와 `setup/academic-year.ts`의 함수를 공유한다.
- 시작 월·일을 강제하지 않는다. 종료일은 다음 해여도 된다. 공식 날짜6개는 빈칸에서 사용자가 직접 입력한다. 불일치 안내는 “학년도 숫자와 학년도 시작일의 연도가 같아야 합니다.”이며 입력을 자동 보정하지 않는다.
- 날짜는 마지막 날 포함, `firstDay <= term1First <= term1Last < term2First <= term2Last <= lastDay`. 빈칸·역전·겹침·존재하지 않는 날짜는 거부한다.
- **기존 조회 결과에는 새 연도 의미검사를 적용하지 않는다.** 이미 전송된 명령은 원 command/key를 복구하며 이 새 조건 때문에 키를 버리지 않는다. 서버는 위 접수증 우선 확인 규칙을 지켜야 한다. 새로 편집하거나 새 미리보기를 요청하면 현재 조건을 다시 검사한다.
- `copyStructure=true`는 부서·학년·반·교과 구조만 새 ID로 복제한다. 학생 진급·반배정·교사배정·관찰/평가/상담·개인메시지·AI 대화·수합제출·파일은 복사하지 않는다.
- 학년도와 구조 생성은 원자적이다. 기존 학년도 강제 종료·기본 선택 변경·기존 구조 덮어쓰기는 하지 않는다. 공식 담당 기간 연장은 별도 학교관리 확인을 거친다.

## 입력과 결과 미상 복구

- 목록 재조회 실패 시 기록 원문과 입력을 숨겨 보존한다. 다시 연결하면 확인된 범위 안에서 복원한다. 계정·학교·역할 범위가 바뀌면 기존 화면과 상태를 격리한다.
- 자료/판 변경 시 기존 미리보기와 확인 체크를 무효화한다. 관리자/인수 명령은 화면에서 확인한 `expectedVersion`과 최신 기록 판이 같아야 새로 전송할 수 있다.
- 실행 중에는 사유·체크·새 제출을 잠근다. 결과 미상은 명령과 요청 번호를 함께 보존한다. 편집 메모리가 없어져도 공통 pending에서 같은 명령/키를 복원한다. 준비 상태 재조회 실패도 그 요청의 실패를 뜻하지 않는다.
- 화면을 다시 열어도 이전 화면의 늦은 응답이 새 화면의 입력이나 pending을 지우지 않는다. 보관 범위는 현재 탭 메모리이며 브라우저 종료/새로고침 후 영속 복구를 약속하지 않는다.

## 검증과 남은 서버 작업

앱 단위 시험 `tests/test_workhub_school_transitions.mjs`와 브라우저 시험 `tests/browser/workhub-school-transitions.mjs`는 구/신 계약, 부분 필드·자기 확인·확인 없는 수락·판/시각 손상, 관리자 확인/반려, 실제 인수와의 분리, 과거 접수증 복구, 배경 조회 실패, 늦은 응답, 학년도 불일치와 원요청 복구를 다룬다. 브라우저는 실제 React·어댑터와 합성 서버 응답을 사용하며 실제 Supabase 권한·동시성 확인은 아니다.

Claude SQL 후속 시험에는 다음을 포함한다.

1. 일반 교사 관리자 확인 거부, 요청자 자기 확인/반려 거부, 확인 전 수신자 수락 거부.
2. 관리자 확인과 수신자 수락 각각의 원본 판·담당 기간·수신자 상태 검사 및 동시성 충돌.
3. 동일 키 반복, 전송 후 끊김, 응답 유실, 원접수증 우선 조회, 모든 부분 변경 롤백.
4. 관리자·요청자·수신자 각각의 목록/홈/이력 범위, 비활성화 후 기존 결정 조회.
5. 새 학년도 두 경로(P1·P7)의 시작 연도 일치, 시작월 제한 없음, 다음 해 종료 허용, 과거 접수증 재조회.
6. 실제 SQL 응답을 현재 앱 parser와 대조. 관리자 확인 필드가 없는 상태를 준비 완료로 표기하지 않는다.
