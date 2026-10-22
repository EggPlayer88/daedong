# P10 AI 운영 조회 계약

신규 설치 파일은 09 운영현황, 10 서버 진단, 11 읽기 전용 사후점검이다. 기존 01~08은 변경하지 않는다. 두 RPC는 service_role 전용이며 사람 JWT가 있으면 거부한다. 서버가 검증한 actor UID와 member ID로 기존 p10_admin(current membership·year.manage)을 확인한다. 학교를 입력받거나 추정하지 않는다. 정책·모듈이 꺼져 있어도 현재 관리자에게 조회를 허용한다. 조회는 원장·설정·감사 로그를 변경하지 않는다.

## 운영현황

`public.workhub_ai_school_operations(p_actor_user_id uuid,p_member_id text,p_cursor jsonb DEFAULT NULL)`

성공은 아래 직접 객체이며 실패는 `{error:{code}}`다. 예상 업무 오류만 좁은 코드로 반환한다.

```ts
type State = 'prepared'|'started'|'completed'|'rejected'|'unknown'|'failed'|'closed'|'resolved'
type Counts = Record<State, number>
type Aggregate = {
  requests: number
  settledMicroUsd: number
  reservedMicroUsd: number
  states: Counts
}
type Cursor = {month: string; asOf: string; afterId: string}
type Operations = {
  contract: 'assistant.operations.v1'
  schoolId: string
  memberId: string
  checkedAt: string
  month: string // YYYY-MM, 최초 요청 당시 학교 월
  timeZone: string
  asOf: string // 최초 페이지의 포함 상한 시각, UTC .SSSZ
  totals: Aggregate
  groups: (Aggregate & {feature: 'assistant'|'evaluation'; quality:'quick'|'review'|'legacy'})[]
  unresolved: {
    requests: number
    reservedMicroUsd: number
    previousMonthRequests: number
    previousMonthReservedMicroUsd: number
    oldestCreatedAt: string|null
    observedOverageRequests: number
  }
  items: {
    id: string
    requestKey: string
    feature: 'assistant'|'evaluation'
    quality: 'quick'|'review'|'legacy'
    state: State
    createdAt: string
    updatedAt: string
    model: string
    reservedMicroUsd: number
    settledMicroUsd: number|null
    usage: {inputTokens:number;outputTokens:number}|null
    errorCode: string|null
    observedOverage: boolean
  }[]
  nextCursor: Cursor|null
}
```

groups는 assistant/evaluation × quick/review/legacy의 6개를 고정 순서로 모두 반환하며 0건도 포함한다. totals 및 groups는 해당 budget_month이고 created_at <= asOf인 실제 공통 요청 원장을 집계한다. 미접수 닫힘 tombstone은 비용 요청이 아니므로 포함하지 않는다. states는 8개 키를 모두 포함하며 합계는 requests와 같다. settled는 알려진 실제 비용 합계, reserved는 실제 정산이 없고 현재 효력이 있는 예약만이다. 같은 비용을 두 칸에 세지 않는다.

unresolved는 현재 학교의 전체 월에서 미정산 prepared/started/unknown/rejected를 집계한다. previousMonth는 선택월보다 이전인 요청이다. 해당 월 목록 밖의 미상 비용도 확인할 수 있다. 원문·사용자 식별값 없이 집계만 반환한다.

items는 최대 25개이며 created_at DESC, id DESC로 정렬한다. 커서 month/asOf는 최초 페이지 값을 유지하고 afterId는 같은 학교·같은 월·상한 내 실제 row를 검증한다. SQL은 anchor의 정밀 원시 시각을 조회해 keyset 비교하므로 같은 밀리초 표시에도 중복·누락이 없다. 표시된 시각이 같은 항목의 ID 순서를 앱에서 다시 정렬하면 안 된다. asOf는 canonical UTC 밀리초 문자열이며 그 시각의 학교 현지 월과 month가 일치해야 한다. 학교 예약 잠금으로 선행 미커밋 요청이 끝난 뒤 최초 상한을 잡는다. 새 달이 되어도 이전 페이지의 월을 유지한다. 새 요청은 새로고침 후 포함한다. 상태와 비용은 각 조회 시점의 최신 값이므로 페이지 사이 정산은 반영될 수 있다.

errorCode는 원장의 자유 텍스트를 반환하지 않고 허용 코드만 반환한다. 고정 허용값은 FORBIDDEN, INACTIVE_MEMBERSHIP, INVALID_INPUT, NOT_FOUND, CONFLICT, IDEMPOTENCY_CONFLICT, BUDGET_EXCEEDED, NOT_READY, SCHOOL_NOT_LINKED, KEY_MISSING, POLICY_MISSING, DISABLED, OVER_RESERVATION, OUTPUT_INVALID, PROVIDER_REJECTED, TRUNCATED, COUNT_FAILED, INPUT_TOO_LARGE, CANCELLED, PROVIDER_UNKNOWN이다. 그 밖의 값은 null이다.

응답에 질문·답변·학생 자료·API 키·암호문·actor UID·lease·provider ID·근거·payload 해시는 넣지 않는다. checkedAt/asOf와 항목 시각은 UTC `.SSSZ`다.

## 서버 내부 무호출 진단

`public.workhub_ai_school_diagnostics(p_actor_user_id uuid,p_member_id text)`

```ts
type DiagnosticsInternal = {
  contract: 'assistant.school.diagnostics.v1'
  schoolId: string
  memberId: string
  policyVersion: number // 미등록이면 0
  enabled: boolean
  overageBlocked: boolean
  credential: null|{version:number;keyId:string;iv:string;ciphertext:string;tag:string}
}
```

오류는 같은 `{error:{code}}`다. 현재 학교의 최신 암호문만 service_role 서버가 받으며 일반 status/operations에는 섞지 않는다. 이 내부 객체를 HTTP로 그대로 돌려주면 안 된다. Python은 허용된 설정 존재·해당 판 복호화 성공 여부만 공개 진단 DTO로 만들어야 한다. DB 미설치는 RPC 자체가 없으므로 서버에서 명시적 미준비로 처리한다. 외부 공급자 호출, 키 변경, 비용 예약, 원장·감사 로그 변경을 하지 않는다.
