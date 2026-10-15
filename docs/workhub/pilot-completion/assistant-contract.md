# W09 Claude 비서 — 구현 계약 및 Claude SQL 요청

작성 기준: 전체 시범 사용 통합 구현 / 2026-10-16. **이 문서는 SQL 실행문이 아니다.** SQL 확정·적용은 기존 역할 분담을 따른다. 현재 새 비서 RPC와 승인된 AI 이용 설정이 없으면 `NOT_READY`로 닫힌다. 기존 문서 AI의 인증·모델·max_tokens·템플릿·HWPX 엔진을 변경하지 않았다.

## 1. 구현한 범위와 연결점

- `apps/workhub/src/assistant/AssistantPanel.tsx`: 한 화면에서 학교 업무 안내 / 내 개인 비서, 이전 대화, 근거 확인, 질문 보존, 결과 미확정 복구, 개인 할 일 제안 검토·확정, 내용 초안 TXT 내려받기 및 작성 화면 전달.
- `contracts.ts`: 공개 응답과 학생 근거의 엄격한 판 검증. `http.ts` / `legacy-http.ts`: 기존 공용 로그인 세션 재사용. `server.ts`: 기존 `connection.rpcVerified`와 학교·소속·역할·유효기간·공식 관계 fingerprint 재검증.
- `apps/main/api/workhub-ai/chat.py`: JSON POST 전용 실제 서버 경로. 제한된 요청 읽기·시간 제한·오류 원문 비공개.
- `_assistant.py`: 기존 `collections/_hwpx_basic.py`의 Supabase URL 제한, 서비스 키 처리, `/auth/v1/user` 토큰 검증을 import하여 재사용한다. 기존 도우미를 변경하지 않는다. 서비스 전용 RPC → Anthropic 고정 host → 완료 접수증 경로를 구현했다.
- `_assets/assistant-policy.txt`, `assistant-limits.json`: 출력 원칙과 기술적 입력/응답 한도. **선택한 모델·출력 토큰 기본값·금액 기본값은 없다.** SQL에서 승인된 값만 받아 사용한다.
- 실사용 범위는 상담 기록 자동 접근·시간표·자동 메시지 발송·자동 문서 제출·공식 생기부 기재를 포함하지 않는다. 학생 기록 초안은 교사가 명시적으로 고른 관찰·확정 평가 근거만 사용한다.

### 화면 prop

```ts
AssistantPanel({
  connection, member, date, revision,
  onNavigationLockChange, onUpdated,
  contextRequest?: { id: string; request: AssistantContextRequest },
  onDraftReady?: (draft: AssistantDraftReady) => void,
  onComposeMessage?: (draft: {requestId:string;body:string}) => void,
  server?: AssistantServer // 합성 시험 주입
})
```

`contextRequest`는 자동 전송하지 않는다. 기존 질문·제안·미확정 요청이 없을 때 “전달받은 요청 사용”으로 불러온다. 초안 전달도 현재 입력과 제안이 없어야 한다. `onUpdated`는 개인 할 일 확정 접수증 뒤에만 호출한다.

```ts
type AssistantContextRequest = {
  mode: 'school' | 'personal';
  intent: 'school_advice' | 'personal_assistant' | 'document_draft'
    | 'student_record_draft' | 'guided_collection';
  prompt?: string;
  references: ResourceReference[];
  studentContext: StudentContext | null;
};
type AssistantDraftReady = {
  intent: AssistantContextRequest['intent'];
  segments: AnswerSegment[];
  requestKey: string; threadId: string;
  studentContext: StudentContext | null;
};
```

일반/개인 답변의 “메시지 초안으로 사용”은 메신저 작성란에 넣을 평문만 전달한다. 받는 사람을 선택하거나 전송하지 않는다. 현재 입력·제안·미확정 요청이 있으면 버튼을 막고 학생 기록 초안에는 버튼을 제공하지 않는다. 메신저는 현재 학교 범위 확인 → 기존 작성 중 입력 보존 → 교사가 초안 불러오기 → 서버 정책 길이 검사 → 수신자 선택 → 최종 미리보기/확인 후 전송 순서를 유지해야 한다. 본문 길이를 맞추려고 자동으로 자르지 않는다.

문서함은 `document`, 수합 요청은 `collection` 참조를 사용한다. 학생 화면의 `StudentDraftSource`는 root에서 현재 `schoolId/memberId`를 대조한 뒤 `studentContext`로 전달한다. 식별자만 보내고 본문을 콜백에 실어 보내지 않는다. 학생 초안의 문서함 저장은 별도 문서 계약에 따라 private 강제, 원 근거 검증, 일반 학교 문서로 유형 전환 금지가 필요하다.

## 2. 공통 JSON 형식

아래 모든 객체는 **기재한 키만 허용**한다. 알 수 없는 키를 버려서 통과시키지 않는다. `null`과 필드 생략은 다르다. 식별자는 `[A-Za-z0-9_-]{1,100}`, 요청 키는 같은 문자 범위의 8~100자. 정수는 JavaScript 안전 정수, 판 번호는 1 이상이다. 날짜는 실제 `YYYY-MM-DD`, 날짜/시간은 시간대 포함 ISO 형식이다. 제어 문자·고립 surrogate·중복 JSON 키·NaN/Infinity를 허용하지 않는다.

모든 정상 RPC 응답:

```json
{"contract":"assistant.v1","schoolId":"school-id","memberId":"member-id","data":{}}
```

업무 오류 RPC 응답:

```json
{"contract":"assistant.v1","schoolId":"school-id","memberId":"member-id","error":{"code":"CONFLICT"}}
```

인증·소속 자체가 유효하지 않아 안전한 범위를 확정할 수 없으면 기존 gate 방식의 `FORBIDDEN` / `INACTIVE_MEMBERSHIP` 거절을 사용한다. 원 DB 오류·키·쿼리·본문을 오류 메시지에 넣지 않는다. 업무 코드는 `NOT_READY`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `BUDGET_EXCEEDED`. RPC가 없으면 사용할 수 있는 척하지 않는다.

### 근거

```ts
type ResourceReference = {
  kind: 'knowledge' | 'calendar' | 'task' | 'collection' | 'document';
  id: string; version: number;
};
type EvidenceReference = {
  kind: 'observation' | 'assessment';
  id: string; revisionId: string; sourceHash: string; epoch: number;
  start: number; end: number;
};
type StudentContext = {
  studentId: string; courseId: string; evidence: EvidenceReference[];
};
type Citation = {
  reference: ResourceReference | EvidenceReference;
  title: string; locator: string;
};
type AnswerSegment = { text: string; citations: Citation[] };
```

학생 `sourceHash`는 `teaching` 원본의 현재 `contentHash`(소문자 SHA-256 64자리)다. **선택 문자열만 새로 해시해 대체하지 않는다.** `revisionId`는 불변 개정본 ID, `epoch`는 원본 무효화 세대, `[start,end)`는 Unicode 코드포인트 구간이다. 관찰의 원문은 `text`, 평가는 교사가 확정한 활성 평가의 `comment`. `0 <= start < end <= codepoint_length(source)`와 동일 학생·수업·학교·작성자·현재 판·해시·세대 모두 검증한다. 상담·건강·외부 CSV 원문은 종류 자체를 허용하지 않는다. 원문 정정·학생 연결 변경 후 `sourceReviewRequired=true`인 관찰·평가는 선택·prepare·start·finish·완료 답변 조회에서 거절한다. 현재 false인 기록만 사용할 수 있고, 이전 출력의 근거 revision/hash/epoch는 재검증한다.

`Citation`에는 임의 URL·HTML·모델이 만든 페이지 번호를 받지 않는다. `title/locator`는 SQL이 읽을 권한을 확인한 출처에서 발급한다. 모델은 불투명한 source key만 반환하고 서버가 위 정보로 바꾼다. 유효한 출처 ID가 답변 내용의 의미적 정확성까지 보장하지는 않으므로 교사 검토는 유지한다.

### 요청과 대화

```ts
type AssistantInput = {
  mode: 'school'|'personal'; intent: AssistantContextRequest['intent'];
  prompt: string;
  threadId: string|null; expectedVersion: number;
  references: ResourceReference[]; studentContext: StudentContext|null;
};
type TaskDraft = { title:string; notes:string; dueDate:string }; // dueDate '' 허용

type TaskProposal = {
  id:string; version:number; kind:'create_personal_task'; input:TaskDraft;
  status:'pending'|'applied'; resourceId:string|null;
};
type Exchange = {
  id:string; requestKey:string; intent:AssistantInput['intent']; prompt:string;
  segments:AnswerSegment[]; proposal:TaskProposal|null;
  createdAt:string; studentContext:StudentContext|null;
};
type AssistantThread = {
  id:string; mode:'school'|'personal'; version:number; title:string;
  exchanges:Exchange[]; nextCursor:string|null;
};
type AskResult =
  | { state:'completed'; requestKey:string; thread:AssistantThread }
  | { state:'pending'; requestKey:string; reason:'in_progress'|'provider_unknown' }
  | { state:'rejected'; requestKey:string;
      code:'OUTPUT_INVALID'|'PROVIDER_REJECTED'|'TRUNCATED' };
```

새 대화는 `threadId:null/expectedVersion:0`. 이어지는 요청은 현재 대화 ID/판을 함께 보낸다. 성공 접수증은 **원 요청의 대화 판 + 1**이며 요청 키가 일치하는 교환이 정확히 하나 있어야 한다. 모드·질문·intent·학생 context도 원 요청과 같아야 한다. 다른 요청의 답변을 재사용하지 않는다. 접수증 자체는 최초 결과 snapshot으로 보존하고 화면의 최신 대화 조회는 별도로 한다.

개인비서 intent와 학생 초안은 personal 모드만 허용한다. 학생 초안은 context 필수, 매 답변 문단에 해당 context에 정확히 포함된 학생 근거 1개 이상 필수. 일반 학교 안내에 개인 task source를 넣지 않는다. 개인 할 일 제안은 `personal_assistant` intent/personal 모드만 허용한다. applied 제안은 `resourceId` 필수, pending은 null이다.

기술 한도: prompt 4,000자, 명시 참조 20개(학생 근거도 20개), sources 30개/본문 각 16,000자, history 32개/각 8,000자, 문단 60개/각 4,000자/합계 40,000자. 공개 대화의 교환과 목록은 한 페이지 50개. 요청 JSON 32KiB/응답 JSON 1MiB. 한도는 자산이 기준이며 모델 비용 한도와 별개다. 상한 조합 전체를 항상 담을 수 있다는 의미는 아니며 SQL 응답은 직렬화 후 1MiB를 넘으면 축소하거나 명시적으로 거절해야 한다.

## 3. 실제 HTTP 경로

`POST /api/workhub-ai/chat`, 기존 로그인 Bearer 토큰. 사용자·학교 ID는 클라이언트에서 받지 않는다. memberId를 소속 선택자로 받되 서버가 기존 `/auth/v1/user`로 확인한 actor와 SQL에서 다시 대조한다.

```json
{"action":"readiness","memberId":"member-id"}
```

```json
{"action":"ask","memberId":"member-id","input":{},"requestKey":"original-key"}
```

200 응답은 공통 envelope. 오류 HTTP 본문은 `{"error":{"code":"NOT_READY"}}`처럼 공개 코드만. 클라이언트는 HTTP 55초·인증 재확인 포함 전체 60초 제한·읽기 크기 제한·호출 전후 세션 확인을 한다. 서버는 5초 요청 본문 읽기 제한, 기존 Supabase 전체 45초 예산 안에서 AI 호출 최대 30초(완료 기록용 최소 5초 확보), Vercel 함수 최대 60초다. 리디렉션·자동 네트워크 재시도·스트리밍은 사용하지 않는다.

필수 서버 환경은 기존 Supabase URL/service key와 `ANTHROPIC_API_KEY`. 이번 구현에서 값 확인·생성·설정·출력·배포·유료 호출을 하지 않았다. 공개 VITE 변수에 AI 키를 두면 안 된다. API 키가 없거나 승인 정책이 없으면 시작하지 않는다.

## 4. Claude가 작성할 SQL: 서비스 전용 RPC 4개

서버가 service-role로 호출한다. `anon/authenticated/PUBLIC`에는 EXECUTE가 없어야 한다. 입력 actor는 클라이언트 body가 아니라 토큰 검증 결과다. 내부 표는 RLS 켜짐·API 역할 직접 권한 0, 내부 함수 권한 회수·search_path 고정·타학교 FK 조합 검증을 기존 규칙대로 적용한다.

### 4.1 `workhub_ai_server_readiness(p_actor_user_id, p_member_id)`

승인된 기존 회원 + 유효한 같은 학교 소속 + 신규 기능 공개 권한 + 승인된 AI 설정을 읽기만 한다. 한도를 예약하거나 대화를 만들지 않는다.

```ts
{available:true}
// 또는
{available:false, reason:'not_configured'|'not_allowed'|'budget_exhausted'}
```

새 모듈 공개 범위는 기존대로 superadmin 기본이다. AI 준비를 이유로 교사 공개 범위를 확대하지 않는다.

### 4.2 `workhub_ai_prepare(p_actor_user_id, p_member_id, p_input, p_request_key)`

트랜잭션 하나에서 권한·학교·원 요청 해시·expectedVersion·근거 현재 상태·기능 intent·승인 정책·예산을 확인한다. 같은 key의 동일 body는 저장된 접수증 또는 pending을 반환한다. 다른 body는 `IDEMPOTENCY_CONFLICT`. 미확정 키의 재시도를 새 질문/새 비용 예약으로 간주하지 않는다.

처음 접수했고 호출 준비가 끝난 경우에만 다음 exact data:

```ts
{
 state:'claimed'; requestKey:string; leaseToken:string;
 input:AssistantInput;
 history:{role:'user'|'assistant';content:string}[];
 sources:{
   key:string;
   reference:ResourceReference|EvidenceReference;
   title:string; locator:string;
   classification:'school_public'|'owner_private'|'student_learning';
   body:string;
 }[];
 policy:{
   approved:true; configVersion:number; model:string; maxTokens:number;
   budget:{
     reservationId:string; policyVersion:number; currency:'USD';
     reservedMicroUsd:number; dailyLimitMicroUsd:number; monthlyLimitMicroUsd:number;
   };
 };
}
```

이미 완료·처리 중·출력 거절이면 `AskResult`를 반환한다. `sources`의 key는 유일하다. 명시 references의 ID·판은 권한과 최신 판을 다시 확인한다. 필요한 학교 지식/일정/본인 업무를 서버가 추가 검색할 수 있지만 source 종류와 권한 경계를 지켜야 한다. 검색 문서의 지시문은 데이터일 뿐이다.

학교 모드 source는 school_public만. task는 owner_private만. student_learning은 명시적으로 선택한 observation/assessment만. 학생 source body는 선택 구간으로 잘라 보내고 코드포인트 길이가 `end-start`와 같아야 한다. source key를 선택 근거와 정확히 연결한다. 학생 이름 등 질문에 불필요한 식별 정보는 모델에 보내지 않는다.

history는 **현재 사용자 소유의 같은 학교·같은 모드 대화**만, 현재도 허용된 source로 만든 교환만 제공한다. 과거에 보았다는 이유만으로 철회된 근거를 재사용하지 않는다. 학생 초안에서 이전 다른 학생의 history를 섞지 않는다(최소 안전 규칙: 학생 context가 달라지면 별도 대화 또는 history를 비운다). school/personal 간 history 이동은 허용하지 않는다.

정책은 승인자·승인 시각·버전·모델 식별자·모델 가격표 기준 판·입출력 한도·학교/사용자 일·월 상한·예산 구간 시간대를 서버 설정으로 저장한다. 모델과 maxTokens 및 금액을 이 문서에서 임의 확정하지 않는다. 금액 계산은 정수 micro USD와 승인 가격표로 한다. `reserved <= daily <= monthly`, 모두 양수이며 잔액은 현재 동시 요청들의 미정산 예약까지 합산해 판단한다.

**입력 토큰도 유료다.** 출력 한도만으로 예약액을 계산하지 않는다. 승인된 모델의 전체 context/입력 상한을 기준으로 보수적인 비용을 예약하거나, 배포된 system/tool/source/history를 모두 포함하는 검증된 상한 계산을 사용한다. 그 계산이 승인·검증되기 전에는 NOT_READY다. 모델별 토큰/가격·캐시/할인 추정치를 하드코딩하지 않는다. 현재 호출은 캐시 설정·추론 예산 옵션을 추가하지 않는다. 미확정 요청의 비용 예약을 성공 여부 불명확한 채 자동 환급하지 않는다.

### 4.3 `workhub_ai_start(p_actor_user_id, p_member_id, p_request_key, p_lease_token)`

근거·멤버십·정책 유효성을 다시 확인하고 **외부 호출권을 영구적으로 한 번만 사용 처리**한다. DB 커밋이 확인된 `{"started":true}` 응답을 받은 호출만 Anthropic에 한 번 요청한다. 동일 키/lease의 반복 start는 `{"started":false}`. 단순한 임대 만료로 started=true가 다시 발급되면 안 된다.

prepare lease가 만료되고 **start 전임이 확실한 경우만** 재검증 후 재인수할 수 있다. start가 기록된 뒤에는 서버 종료·응답 유실·타임아웃 어떤 경우에도 자동 재인수로 provider를 재호출하지 않는다. 시작권 응답만 유실된 경우 실제 호출이 0회일 수도 있으나 이를 추측해 다시 호출하지 않는다.

### 4.4 `workhub_ai_finish(p_actor_user_id, p_member_id, p_request_key, p_lease_token, p_result)`

p_result는 다음 세 가지 중 하나다. 클라이언트가 직접 호출할 수 없다.

```ts
{state:'completed'; usage:{inputTokens:number;outputTokens:number};
 providerMessageId:string; segments:AnswerSegment[]; taskDraft:TaskDraft|null}
{state:'rejected'; code:'OUTPUT_INVALID'|'PROVIDER_REJECTED'|'TRUNCATED';
 usage:{inputTokens:number;outputTokens:number}|null; providerMessageId:string|null}
{state:'provider_unknown'; usage:null; providerMessageId:null}
```

finish는 lease·one-time start·원 입력·현재 소속·현재 source 판/철회·모델 정책을 다시 확인한다. 모델 결과에 source를 추가할 수 없다. 모든 citations의 ref/title/locator는 prepare snapshot source와 같아야 한다. 동일 finish 재전송은 동일 접수증, 다른 finish payload는 충돌이어야 한다. providerMessageId가 있으면 중복 정산을 막고, usage로 정수 비용을 한 번만 정산한다. 부족한 예약·미확인 청구를 임의 0원으로 처리하지 않는다.

권한이 사라졌어도 내부 시도/사용량/과금 기록은 소실시키지 않는다. 교사에게 답변을 공개하는 단계는 현재 권한 검증 뒤에만 한다. 완료 응답은 `AskResult`, 제안 ID는 DB가 배정한다. taskDraft가 있어도 **실제 task를 만들지 않는다.** 문서·학생·수합 초안도 본문/근거 저장만 하며 파일 변환·공식 기재·제출은 하지 않는다.

`provider_unknown`은 pending으로 남긴다. 관리자가 공급자 기록과 비용을 확인해 감사 이력이 남는 별도 관리 절차로 해소하기 전에는 started를 초기화하지 않는다. 자동 만료만으로 재호출/환급하지 않는다. 관리 절차의 접근권한·증거·허용 상태 전이도 SQL 인계에 포함해 달라. 미확정 결과를 없던 요청처럼 지우는 브라우저 취소 버튼은 만들지 않았다.

## 5. Claude가 작성할 SQL: 사용자 RPC 3개

기존 authenticated 승인 gate를 그대로 이용하고 `auth.uid()`→member→school을 검증한다. 타교·동료 개인 대화 조회는 차단한다. API 역할은 함수 EXECUTE만 가지며 내부 대화 표 직접 권한은 없다.

### `workhub_ai_threads_list(p_member_id, p_mode, p_cursor)`

```ts
{items:{id:string;mode:'school'|'personal';version:number;title:string;updatedAt:string}[],nextCursor:string|null}
```

페이지 최대 50, 안정 정렬 `(updatedAt,id)`, cursor는 학교·회원·모드에 묶는다. 다른 모드의 제목도 반환하지 않는다. cursor는 불투명하고 문자열 2,000자 이내. 사용자 전달 cursor를 임의 SQL 정렬/필터로 해석하지 않는다.

### `workhub_ai_thread_get(p_member_id, p_thread_id, p_cursor)`

`AssistantThread` 반환. 한 페이지 50 교환, 페이지 내 시간순. 첫 페이지는 최근 50개, nextCursor는 그 앞선 구간이며 이전 페이지와 교환 ID가 겹치지 않는다. cursor는 thread/소유자/학교/현재 대화 판에 묶고 바뀌면 CONFLICT. 열람할 때 source 권한·현재 판·학생 철회 세대를 다시 확인한다. 인용 본문을 공개할 수 없어진 교환은 현 계약에서 조용히 빈칸으로 바꾸지 말고 NOT_FOUND/CONFLICT 등으로 안전하게 거절한다. 화면은 재조회 실패 시 이전 답변을 숨기고 질문·원 요청만 유지한다.

### `workhub_ai_confirm_task(p_member_id, p_input, p_request_key)`

```ts
// p_input
{threadId:string;proposalId:string;expectedVersion:number;
 input:{title:string;notes:string;dueDate:string}}
// data
{requestKey:string;proposalId:string;proposalVersion:number;
 taskId:string;taskVersion:number;threadVersion:number}
```

확정 화면에서 확인한 내용만 보낸다. expectedVersion은 제안 판이다. 서버는 원 제안이 이 사용자/학교/personal_assistant 교환에서 생성됐는지, 미실행 상태인지 확인한다. 사용자 수정은 title/notes/dueDate만 허용한다. task 본문은 기존 개인 할 일 계약으로 매핑하고 본인 소유로 저장한다. 타사용자 할 일, 메시지, 일정, 파일, SQL 권한을 실행하는 범용 mutation으로 확대하지 않는다.

`proposalVersion = expectedVersion + 1`, taskVersion은 현재 생성된 개인 할 일 판, threadVersion은 제안 상태 변경을 포함한 대화의 최신 판. task 생성+제안 applied+접수증+감사 기록은 같은 트랜잭션. **제안 하나가 task 하나만 만들 수 있는 DB 유일성 제약**이 필요하다. 같은 request key/동일 입력은 같은 접수증, 다른 body는 IDEMPOTENCY_CONFLICT. 이미 적용된 제안을 새 key로 다시 실행하려 하면 기존 결과를 명확히 안내하거나 CONFLICT로 막고 새 task는 만들지 않는다.

## 6. 원장·동시성·보존 설계 요청

구체 표 이름은 기존 DB 통합 규칙에 맞춰 Claude가 결정하되 아래 관계를 빠뜨리지 않는다.

1. 사용자/학교/모드에 귀속된 대화 머리와 immutable 교환, 현재 판.
2. intent/원 요청 JSON canonical hash/request key/lease/start 시각/최종 상태/완료 접수증의 요청 원장. 학교·사용자·키 유일성, 입력 payload 불변.
3. request와 정확한 source ID/판/학생 revision/hash/epoch/구간을 묶는 근거 snapshot. 승인 당시 접근권한 snapshot은 현재 검증의 대체물이 아니다.
4. 승인된 모델·가격·일/월 한도 설정 판과 요청별 예약·실사용·미확정 비용 원장. 청구 기간 경계에서 동시에 접수해도 상한을 넘지 않도록 row lock/원자적 합계 검사.
5. 제안과 실행된 개인 task의 1:1 연결, 최초 요청 키·판, 원문과 사용자 확정 내용, 감사 기록.
6. FK에는 학교 범위 포함, 삭제 대신 정책에 맞는 철회/만료. 교사 계정·기존 가입 정보·R0/R1 자료 보존. 개발 편의를 위해 기존 표에 CASCADE DROP을 넣지 않는다.
7. 프롬프트·학교자료·학생기록을 서버 로그에 출력하지 않는다. 운영 추적은 request key, 공개 오류 코드, 모델 설정 판, 사용량, 상태 전이 위주다. 내용 보존 기간과 사용 기록 열람 주체는 별도 승인 설정이 필요하다.

## 7. 배포·적용 전 합격 기준

- 서비스 전용 4 RPC에 anon/authenticated/PUBLIC 접근 불가. 사용자 3 RPC는 인증·가입 승인·현재 소속·공개 권한·본인 대화만. 다른 학교/동료 개인 자료/중단 회원 모두 거절.
- 설정 없음·미승인 모델/가격·일월 예산 없음·API key 없음에서 호출 0, NOT_READY.
- 중복 prepare/start/finish, 같은 키 다른 내용, started 응답 유실, provider timeout, finish 응답 유실, 프로세스 종료 후 lease 만료를 주입해 **external call 최대 1회와 단일 정산** 확인.
- 실제 DB 두 동시 요청이 마지막 예산과 같은 thread expectedVersion을 다툴 때 둘 다 성공하지 않음.
- 학습 근거의 다른 학생/교사/수업/학교/개정/해시/세대/코드포인트 범위, 상담/미확정 평가/원문 재확인 필요(sourceReviewRequired), 철회 이후 finish/get/문서함 저장 거절.
- 권한/근거가 prepare→start→finish 사이에 바뀌면 비공개 처리. 생성된 비용 기록은 남음.
- 모드 전환/다른 학생 context에서 이전 민감 history를 가져오지 않음.
- output에 임의 URL/가짜 source key/추가 field/잘린 답변/학교 모드 쓰기 제안이 오면 거절. 제안 검토 버튼 이전에는 task 생성 0.
- 제안의 확정 응답 유실 뒤 같은 요청으로 복구해 task 1개, 같은 제안에 다른 키 재실행도 task 1개.
- 실제 PostgREST JSON을 앱/Python 검증 함수에 넣어 exact 계약 대조. 운영 AI 호출은 승인된 모델·한도·키 배포 이후 별도 확인 단계로 모아서 시행.

자동 검증 명령:

```text
node tests/test_workhub_assistant.mjs
python tests/test_workhub_assistant_api.py
node tests/browser/workhub-assistant.mjs
npx tsc -p apps/workhub/tsconfig.json --noEmit
```

작성 시 검증: 앱 23, Python 서버 31, 실제 브라우저 15 통과. 학교 관리의 역할/유효기간/공식 관계 변경 보호 회귀는 별도 `test_workhub_school_admin.mjs` 34 통과. 합성 DB/provider 응답을 사용했으므로 SQL 권한·원자성·실제 Anthropic 과금/생성 품질이 입증된 것은 아니다. 이 구분을 PR 설명과 사용자 안내에도 유지한다.

제안 검토를 아직 서버에 보내지 않았다면 준비 안 됨·조회 실패 중에도 닫아서 메뉴 잠금을 해제할 수 있다. 진행 중 쓰기나 결과 미확정 요청이 있으면 닫기와 입력 버리기는 차단하며 수정한 내용·원 요청 번호를 보존한다. 준비 실패 2종과 저장 응답 유실을 함께 브라우저로 확인했다.

## 8. 판단해서 정한 것

- 기존 Python 인증 helper를 import해 재사용했다. 변경 위치는 새 `workhub-ai`뿐이며 기존 doc-ai 경로와 가격을 손대지 않았다. 독립 배포에서 includeFiles에 `api/collections/**`가 필요하다.
- 모델이 도구를 호출하는 자유 실행 루프 대신 `deliver_workhub_answer` 단일 출력 도구를 강제했다. 모델은 읽기 근거를 받아 답변/제안만 만들고, 실제 쓰기는 확인된 전용 RPC가 수행한다. 새 도구를 추가하려면 intent/제안 타입/서버 permission/receipt 시험을 함께 확장한다.
- start 기록 뒤 자동 재호출을 하지 않는다. 공급자 응답이 사라진 요청은 당장 완료되지 않을 수 있으나 중복 생성·중복 비용을 조용히 만들지 않는다. 이를 풀려면 검증된 공급자 멱등 수단 또는 감사 가능한 관리 화해 절차가 먼저 필요하다.
- 문서/수합/학생 초안은 같은 engine의 intent로 분기한다. HWPX 보호 엔진은 변경하지 않고, 형식 적용·계산·최종 파일 검사는 각 원래 흐름에 맡긴다.
- 학교 안내와 개인비서는 같은 UI지만 별도 mode/소유자/자료경계를 가진다. 학교 안내 대화도 기본적으로 작성자 개인 대화이며 자동 전교 공개되지 않는다.

공식 API 근거: [Messages API](https://platform.claude.com/docs/en/api/messages/create), [도구 정의](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools), [중단 사유](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons), [API 오류](https://platform.claude.com/docs/en/api/errors). 구현은 고정 `https://api.anthropic.com/v1/messages`, `anthropic-version: 2023-06-01`, top-level system, 승인 model/max_tokens, tool_choice를 사용한다. SDK 기본 재시도를 사용하지 않는다.
