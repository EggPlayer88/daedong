# P2 API 계약 (calendar-batch.v1 · cooperation.v1)

PR #48 앱(`5f3d40f`)의 어댑터·parser 가 받아들이는 형태입니다. 시험 V 에서 실제 응답 193건을 앱 코드에 넣어 확인했습니다.

## 봉투

| 경우 | 모양 |
|---|---|
| 성공 | `{ok:true, contractVersion, schoolId, memberId, ownerUserId, ...본문}` |
| 조회 거절 | `{ok:false, contractVersion, schoolId, memberId, ownerUserId, code}` |
| 쓰기 거절 | 위 + `requestKey`, `commandHash = sha256(canonical(p_command))`, `outcome:'rejected'` |
| 로그인·소속 실패 / 예상 밖 오류 | 봉투 없는 예외(`FORBIDDEN`·`INACTIVE_MEMBERSHIP`·기타). 앱: `CANCELLED` · `SAVE_UNCERTAIN` · `QUERY_FAILED` |

`code`: `UNAVAILABLE`(모듈 꺼짐) · `INVALID_INPUT` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `IDEMPOTENCY_CONFLICT`(같은 번호·다른 내용, 남기지 않음).

## 일정 일괄 (calendar-batch.v1)

**`workhub_calendar_batch_prepare(p_member_id text, p_input jsonb)`** — 일정을 쓰지 않음

- 입력: `{sourceKey, sourceLabel, fileHash, omittedColumns[≤30], rows[1..50]: {key, line(2..1000), sourceId(≤160, 제어문자 없음), sourceHash = sha256(canonical(draft)), draft}}`.
  draft 는 R0 일정 저장 규칙(`normalize_event_draft`)을 통과해야 함
- 본문: `{prepareId, sourceKey, fileHash, expiresAt(30분), rows[], previewHash = sha256(canonical({prepareId, sourceKey, fileHash, expiresAt, rows}))}`
- 행: `{key, line, sourceId, sourceHash, state, reason, incoming(보낸 원문 그대로), eventId, expectedVersion, baseline, current}`

| state | 뜻 | eventId·판·baseline·current |
|---|---|---|
| `new` | 이 원본 행을 처음 봄 | null |
| `duplicate` | 원문 = 기준선 = 현재 일정 | 채움 |
| `changed` | 원문 ≠ 기준선, 현재 일정 = 기준선 | 채움 |
| `conflict` | 마지막 가져오기 뒤 사이트에서 바뀜 | 채움 |
| `held` | 적용할 수 없음(남의 원본 묶음, 지운·취소된 일정, 수정·열람 권한 없음, 남의 일정을 나만 보기로) — `reason` 필수 | null |

**`workhub_calendar_batch_commit(p_member_id, p_command jsonb, p_request_key text)`**

- 명령: `{kind:'calendar_batch_commit', prepareId, previewHash, selections[1..50]: {key, sourceId, sourceHash, eventId, expectedVersion, decision}}`.
  `decision`: new→`create`(eventId·판 null), changed→`update`, conflict→`replace_conflict`. 미리보기 행과 정확히 같아야 함
- 본문: `{requestKey, prepareId, previewHash, appliedAt, items[]: {key, sourceId, eventId, version}, outcome: applied|replayed}`. create 는 판 1, 나머지는 `expectedVersion+1`
- 거절: 만료·이미 적용·그사이 변경 `CONFLICT`, 남의 미리보기 `NOT_FOUND`, 선택 위조 `INVALID_INPUT`, 역할 회수 `FORBIDDEN`. 하나라도 거절이면 전체 미적용

## 협업 (cooperation.v1)

| 함수 | 입력 | 본문 |
|---|---|---|
| `workhub_cooperation_catalog(p_member_id, p_task_cursor text = null)` | 위치 값(16진, ≤1024) | `{recipients[≤500]: {memberId, name, description}, sourceTasks[≤40]: {id, title, version}, nextTaskCursor}` |
| `workhub_cooperation_list(p_member_id, p_filter jsonb)` | `{box: received|sent, status: all|요청 상태, query(≤200), cursor}` | `{items[≤40]: 요청, nextCursor}` 최신순 |
| `workhub_cooperation_get(p_member_id, p_request_id text)` | | `{request, history[]: {id, action, actorMemberId, actorName, recipientMemberId, previousRecipientMemberId, comment, recordedAt, version}}` 이력 수 = 판. `actorMemberId` 는 그때 처리한 사람 그대로(인계 뒤에도 고치지 않음), `recipientMemberId` 는 그 행이 적용된 뒤의 받는 사람, `previousRecipientMemberId` 는 인계(`handover`, P7-05 뒤) 행에서만 넘겨준 사람 |
| `workhub_cooperation_mutate(p_member_id, p_command jsonb, p_request_key text)` | create / transition | `{requestKey, commandKind, entityId, version, appliedAt, outcome}` |

요청: `{id, schoolId, version, senderMemberId, recipientMemberId, senderName, recipientName, title, description, dueDate('' 또는 YYYY-MM-DD), status, createdAt, updatedAt, taskLink}`.
`taskLink` 는 보낸 사람 본인에게만 `{taskId, ownerUserId}`, 그 밖에는 null.

- create: `{kind:'create', recipientMemberId, title(≤160), description(≤8000, 빈 값 허용), dueDate, sourceTask: null | {id, expectedVersion}}`
- transition: `{kind:'transition', requestId, expectedVersion, action, comment(≤2000; accept·confirm_completion 만 빈 값 허용)}`

| 지금 상태 | 받는 사람 | 보낸 사람 |
|---|---|---|
| requested | accept → accepted, decline → declined | cancel → cancelled |
| accepted | request_completion → completion_requested | cancel → cancelled |
| completion_requested | retract_completion → accepted | confirm_completion → completed, return_completion → accepted, cancel → cancelled |
| declined · completed · cancelled | — | — |

역할에 없는 동작 `FORBIDDEN`, 지금 상태에서 안 되는 동작·옛 판 `CONFLICT`, 당사자 아님 `NOT_FOUND`,
받을 수 없는 사람(다른 학교·대기·거절·정지·끝남) `NOT_FOUND`, 본인 `INVALID_INPUT`, 원본 업무 판 다름·끝난 업무 `CONFLICT`.
