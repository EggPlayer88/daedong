# P3 API 계약 (메신저 · 알림함 · 메시지 HWPX 첨부)

PR #48 앱(`5f3d40f`)의 `apps/workhub/src/messaging/*.ts` 와 `apps/main/api/messages/_message_hwpx.py` 가 받아들이는 형태입니다.
시험 V 에서 실제 응답 158건을 앱 코드(어댑터·parser·확인 API 연결)에 넣어 확인했고, 서버 확인 API 는 PR #48 의 실제 `check_file` 로 돌렸습니다.

## 봉투

| 경우 | 모양 |
|---|---|
| 성공 | `{contractVersion:1, schoolId, memberId, userId, ok:true, data}` |
| 업무 거절 | `{contractVersion:1, schoolId, memberId, userId, ok:false, error:{code}}` |
| 로그인·소속 실패 / 예상 밖 오류 | 봉투 없는 예외(`FORBIDDEN`·`INACTIVE_MEMBERSHIP`·기타). 앱: `FORBIDDEN`·`INACTIVE_MEMBERSHIP`·`CANCELLED`·`RESULT_UNKNOWN`·`QUERY_FAILED` |

`code`: `NOT_READY`(모듈 꺼짐·정책 없음) · `INVALID_INPUT` · `NOT_FOUND`(없거나 볼 수 없음) · `CONFLICT`(판·명단·상태가 다름) · `IDEMPOTENCY_CONFLICT`(같은 번호·다른 내용).
업무 거절은 원장에 남기지 않습니다(같은 번호로 고쳐 다시 보내면 새로 처리). 요청 번호는 `^[A-Za-z0-9_-]{8,200}$`.

## 메신저 (`authenticated`)

| 함수 | 인자 | data |
|---|---|---|
| `workhub_messaging_readiness` | `p_member_id` | `{available, reason: ready·database_missing·policy_missing·disabled, limits: {bodyCharacters, titleCharacters, recipients} \| null, attachments: not_configured·hwpx_basic_v1}` |
| `workhub_message_recipients` | `p_member_id, p_query(≤200, 공백 걷음), p_cursor` | `{items[≤50]: {memberId, schoolId, name, department, version}, nextCursor}` 이름 → id 순, 본인 제외 |
| `workhub_message_threads` | `p_member_id, p_query, p_unread_only, p_cursor` | `{items[≤50]: Thread, nextCursor}` 최근 순 |
| `workhub_message_get` | `p_member_id, p_thread_id, p_before_cursor` | `{thread: Thread, items[≤50]: Message(순번 오름차순, 최신 50개부터), nextCursor(더 앞)}` |
| `workhub_inbox_list` | `p_member_id, p_unread_only, p_cursor` | `{items[≤50]: Notice, nextCursor}` 최신 순 |
| `workhub_message_mutate` | `p_member_id, p_command, p_request_key, p_replay_only` | Receipt |

- Thread `{id, schoolId, kind: direct·group, title, participants[]: Recipient, version, latestSequence, readSequence, unreadCount, updatedAt, canSend}`
- Message `{id, schoolId, threadId, senderMemberId, senderName, sequence, body, createdAt, attachments[]: {id, name, bytes, sha256, profile:'hwpx_basic_v1'}}`
- Notice `{id, schoolId, ownerMemberId, title, body, createdAt, readAt, version, source: {module, id} \| null}`
- Receipt `{requestKey, kind, recordedAt, deliveries[]: {threadId, messageId, recipientMemberIds, sequence}, threadId, throughSequence, noticeId, version}`

| 명령 | 모양 | 접수증 | 거절 |
|---|---|---|---|
| `start` | `{kind, mode: direct·group·individual, recipients[]: {memberId, expectedVersion}, title, body, attachmentIds[]}` | direct·group: deliveries 1개 · individual: 받는 사람마다 1개(각 1명). 나머지 null | 학교 한도 초과·본인 포함·중복·빈 본문·단체 제목 없음 `INVALID_INPUT` · 모르는 사람·다른 학교 `NOT_FOUND` · 판 다름·받을 수 없는 사람 `CONFLICT`(**전체 미전송**) |
| `reply` | `{kind, threadId, expectedVersion, recipientMemberIds, body, attachmentIds}` | deliveries 1개, `threadId` = 요청 대화 | 참여자 아님 `NOT_FOUND` · 판·명단 다름, 참여자 자격 없음 `CONFLICT` |
| `read_thread` | `{kind, threadId, throughSequence}` | `threadId`·`throughSequence` 만(deliveries 빈 배열). 서버 읽은 순번은 내려가지 않음 | 최신보다 큼 `INVALID_INPUT` · 참여자 아님 `NOT_FOUND` |
| `read_notice` | `{kind, noticeId, expectedVersion}` | `noticeId`·`version` 만 | 판 다름 `CONFLICT` · 남의 알림 `NOT_FOUND` |

`p_replay_only=true`: 저장된 접수증만 돌려줌(없으면 `NOT_FOUND`). 모듈이 꺼져 있어도 됩니다.
첨부를 붙이려면 첨부 모듈도 켜져 있어야 합니다(아니면 `NOT_READY`). 파일은 본인 소유 · `ready` · 아직 안 붙은 것만(아니면 `NOT_FOUND`/`CONFLICT`).

## 첨부 (`authenticated`)

| 함수 | 인자 | data |
|---|---|---|
| `workhub_message_file_readiness` | `p_member_id` | `{available, reason: ready·database_missing·storage_missing·verification_missing·disabled, policy: {extensions:['hwpx'], maxFileBytes, maxFiles} \| null}` |
| `workhub_message_file_prepare` | `p_member_id, p_file: {name, claimedBytes, claimedSha256}, p_request_key, p_replay_only` | `{fileId, bucket:'workhub-message-files', path: 학교/소속/파일/original.hwpx, expiresAt(30분), state}` |
| `workhub_message_file_complete` | `p_member_id, p_file_id, p_request_key` | FileStatus |
| `workhub_message_file_status` | `p_member_id, p_file_id` | FileStatus |
| `workhub_message_file_access` | `p_member_id, p_thread_id, p_message_id, p_file_id` | `{threadId, messageId, file, bucket, path, ownerMemberId, storageObjectId}` — URL 없음 |

- FileStatus `{fileId, state: awaiting_upload·pending_basic·ready·rejected, storageObjectId, file}`(`file` 은 ready 일 때만)

### `workhub_message_file_prepare` 의 `CONFLICT` = 끝난 첨부 예약 (앱 C5)

`prepare` 가 `CONFLICT` 를 돌려주는 경우는 **하나뿐**입니다: 같은 소속 · 같은 `p_request_key` · **같은 내용**(`name` · `claimedBytes` · `claimedSha256`)으로 이미 만든 예약이 있고,
그 파일의 지금 상태(`status` 와 같은 계산)가 `rejected` 일 때. `p_replay_only` 가 참이든 거짓이든 같습니다. 새 예약 · 기록은 만들지 않습니다.

| 끝난 이유(`reject_code`, 앱에는 안 보임) | 언제 |
|---|---|
| 기본 확인 거절(`FILE_STRUCTURE_INVALID` 등) | 서버 확인이 거절 |
| `object_changed` · `object_owner_mismatch` · `object_size_mismatch` | 확인 전 · 중에 실물이 바뀜, 주인 · 크기 다름 |
| `upload_expired` | 30분 안에 올리지 않음(`complete` 전이어도 상태는 `rejected` 로 보임) |

앱이 할 일: 파일 ID 를 알면 `status(fileId)` 로 `rejected` 를 확인해 "이 파일은 확인을 통과하지 못했습니다. 새로 첨부해 주세요", 모르면(응답 유실) 같은 문구.
다시 첨부는 **새 요청 번호**로(같은 번호는 계속 `CONFLICT`).

**이 뜻을 다른 데 쓰지 않습니다.**
- 같은 번호 · **다른 내용** → `IDEMPOTENCY_CONFLICT`(먼저 검사). 끝난 예약이라는 뜻이 아님.
- `complete` · `status` 는 끝난 파일에 `CONFLICT` 가 아니라 FileStatus `rejected` 를 돌려줌.
- `workhub_message_mutate` 의 `CONFLICT`(판 · 명단 다름, 붙인 파일이 `ready` 아님 · 이미 다른 전송에 붙음)는 다른 뜻 — 첨부를 새로 하라는 신호로 읽지 않음.
- **시간 초과 · 연결 끊김 · 응답 없음은 `CONFLICT` 가 아님** → 결과를 모름(`RESULT_UNKNOWN`). 같은 번호로 `p_replay_only=true` 재조회해서 판단.

시험: `run_p3.py` O45c(거절 4종 × replay 참 · 거짓) · O45d(다른 내용 → `IDEMPOTENCY_CONFLICT`) · O45e(새 번호 → 새 예약) · O49(전송의 `CONFLICT` 는 별개).
- 이름 규칙(앱과 같음): `.hwpx`, 앞뒤 공백·제어·방향 제어·`<>:"/\|?*`·예약 이름 없음, 240바이트 이하
- 업로드는 Storage 로 직접(`upsert:false`). 정책이 예약된 경로 · 본인 · 기한 안 · 아직 없는 객체만 허용합니다
- 내려받기는 Storage 로 직접. 정책이 대화 참여자 · 지금 자격 · 첨부 모듈 켜짐을 다시 확인합니다

## 서버 확인 API (`service_role` 만, `/api/messages/check-hwpx`)

| 함수 | 인자 | data |
|---|---|---|
| `workhub_message_file_basic_claim` | `p_actor_user_id uuid, p_member_id, p_file_id, p_request_key(= complete 번호)` | 임대 `{fileId, state:'checking', leaseToken, leaseExpiresAt(90초), bucket, path, name, claimedBytes, claimedSha256, maxFileBytes, storageObjectId}` · 임대 중 `{fileId, state:'checking', leaseToken:null}` · 이미 끝남/한도 초과 FileStatus |
| `workhub_message_file_basic_finish` | 위 + `p_lease_token, p_storage_object_id uuid, p_result: {profile:'hwpx_basic_v1', accepted, actualBytes, actualSha256, reasonCode}` | FileStatus(ready 또는 rejected) |

`p_result` 에 다른 항목이 있으면 `INVALID_INPUT` 입니다. **악성코드 검사 결과를 받는 칸은 없습니다.**
