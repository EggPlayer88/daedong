# P6 API 계약 (Claude 비서)

PR #48 의 `apps/workhub/src/assistant/contracts.ts`(`assistant.v1`)와 서버 API `apps/main/api/workhub-ai/_assistant.py` 가 받아들이는 형태입니다.
시험 V 에서 실제 응답 211건을 앱 `createAssistantServer` · `createAssistantHttp` 에 넣어 확인했고, 질문 · 준비 상태는 시험 III·IV 에서 **실제 서버 코드(`execute`)** 를 거쳤습니다.

## 봉투

| 경우 | 모양 |
|---|---|
| 성공 | `{contract:'assistant.v1', schoolId, memberId, data}` |
| 업무 거절 | `{contract:'assistant.v1', schoolId, memberId, error:{code}}` |
| 로그인 · 소속 실패 | 봉투 없는 예외 `FORBIDDEN` · `INACTIVE_MEMBERSHIP`(서버 API 는 403) |
| 예상 밖 오류 | 봉투 없는 예외. 서버 API: 질문 `RESULT_UNKNOWN`, 준비 상태 · 조회 `QUERY_FAILED` |

`code`: `NOT_READY`(모듈 꺼짐 · 설정 없음 · 중지) · `FORBIDDEN`(허용 범위 밖) · `INACTIVE_MEMBERSHIP` · `INVALID_INPUT` · `NOT_FOUND`(없거나 볼 수 없음) ·
`CONFLICT`(대화 · 근거 · 제안 판이 다름, 정정된 학생 근거) · `IDEMPOTENCY_CONFLICT`(같은 번호 · 다른 내용) · `BUDGET_EXCEEDED`.
업무 거절은 원장에 남기지 않습니다. 요청 번호는 앱 `identifier` 규칙.

## 서버 API 함수 4개 (`service_role` 만, 첫 두 인자 `p_actor_user_id uuid, p_member_id text`)

서버가 `/auth/v1/user` 로 확인한 UID 를 `p_actor_user_id` 로 넘깁니다. 사람 JWT 를 실은 호출은 `FORBIDDEN`.

| 함수 | 추가 인자 | `data` |
|---|---|---|
| `workhub_ai_server_readiness` | — | `{available:true}` 또는 `{available:false, reason:'not_configured'\|'not_allowed'\|'budget_exhausted'}` |
| `workhub_ai_prepare` | `p_input jsonb, p_request_key text` | 새 요청: `{state:'claimed', requestKey, leaseToken, input, history, sources, policy}`. 같은 번호 재전송: 앱 `AskResult`(아래) |
| `workhub_ai_start` | `p_request_key, p_lease_token` | `{started:true}` 한 번만. 임대 끝남 · 이미 시작 · 다른 토큰은 `{started:false}` |
| `workhub_ai_finish` | `p_request_key, p_lease_token, p_result jsonb` | 앱 `AskResult` |

- `policy` = `{approved:true, configVersion, model, maxTokens, budget:{reservationId, policyVersion, currency:'USD', reservedMicroUsd, dailyLimitMicroUsd, monthlyLimitMicroUsd}}`
- `sources[]` = `{key, reference:{kind, id, version}, title, locator, classification, body}` — `body` 는 모델에 보낼 본문(원장에는 남기지 않음). `classification`: `school_public` · `owner_private` · `student_learning`
- `history[]` = 같은 대화의 이전 질문 · 답(학생 근거가 정정된 교환은 뺌)
- `p_result` 세 모양(서버 `checked_output` 과 같음):
  - `{state:'completed', usage:{inputTokens, outputTokens}, providerMessageId, segments[1..60]:{text≤4000, citations[≤30]}, taskDraft|null}`
  - `{state:'rejected', code:'OUTPUT_INVALID'|'PROVIDER_REJECTED'|'TRUNCATED', usage|null, providerMessageId|null}`
  - `{state:'provider_unknown', usage:null, providerMessageId:null}`
- 인용은 시작한 임대의 `sources` 와 정확히 같아야 하고, 학생 기록 초안은 모든 문단이 학생 근거를 인용해야 합니다. 어기면 `rejected OUTPUT_INVALID`(사용량은 정산).

## 앱 함수 3개 (`authenticated` 만, 첫 인자 `p_member_id`)

| 함수 | 인자 | `data` |
|---|---|---|
| `workhub_ai_threads_list` | `p_mode text, p_cursor text` | `{items[≤50]: ThreadSummary, nextCursor}` |
| `workhub_ai_thread_get` | `p_thread_id text, p_cursor text` | `AssistantThread`(최근 50 교환, 오래된 → 새것, `nextCursor` 는 더 오래된 쪽) |
| `workhub_ai_confirm_task` | `p_input jsonb, p_request_key text` | `TaskReceipt {requestKey, proposalId, proposalVersion:2, taskId, taskVersion:1, threadVersion}` |

## 질문 결과 `AskResult`

| `state` | 모양 | 언제 |
|---|---|---|
| `completed` | `{state, requestKey, thread}` — `thread` 는 그 교환까지의 대화 한 쪽, `version = expectedVersion + 1` | 답 저장 |
| `pending` | `{state, requestKey, reason:'in_progress'\|'provider_unknown'}` | 호출 중 · 결과 모름(P6-05 전) |
| `rejected` | `{state, requestKey, code:'OUTPUT_INVALID'\|'PROVIDER_REJECTED'\|'TRUNCATED'}` | 서버 검사 실패 · 공급자 거절 · 출력 잘림 · 끝 기록 때 권한/근거/대화가 바뀜 |

## 시험한 응답 수 (시험 V)

| 종류 | 성공 · 거절 |
|---|---|
| readiness | ok 9 |
| ask | completed 125 · pending 4 · rejected 5 · NOT_READY 2 · FORBIDDEN 1 · INACTIVE_MEMBERSHIP 1 · INVALID_INPUT 12 · NOT_FOUND 11 · CONFLICT 8 · IDEMPOTENCY_CONFLICT 1 · BUDGET_EXCEEDED 1 |
| list | ok 5 · NOT_READY 2 · INVALID_INPUT 3 |
| get | ok 5 · NOT_READY 1 · CONFLICT 1 · NOT_FOUND 2 |
| confirm | ok 4 · INVALID_INPUT 4 · NOT_FOUND 1 · CONFLICT 2 · IDEMPOTENCY_CONFLICT 1 |

## 앱 쪽에서 확인할 것 (PR #48 — SQL 실패가 아님)

- 앱이 서버에 보내기 전에 입력을 거절할 때 `INVALID_INPUT` 이 아니라 `INVALID_RESPONSE` 를 냅니다(질문 7건 · 확정 2건). 교사에게는 "서버 응답이 이상함"으로 보입니다.
- 정지된 소속으로 질문하면 앱이 먼저 `FORBIDDEN` 을 냅니다(서버는 `INACTIVE_MEMBERSHIP`).
- 할 일 초안 한도: 앱 200/4000자, DB(R0 업무 규칙) 120/2000자 → 121~200자 제목은 확정에서 `INVALID_INPUT`.
