# W10 메신저·업무 알림 계약

작성: 2026-10-16 · Codex 구현 / SQL 확정본: Claude / 실제 적용·공개: 계란님

## 1. 이번 코드와 실제 연결의 경계

`apps/workhub/src/messaging/`에 기존 로그인 연결을 사용하는 실제 RPC 어댑터, 대화·수신자·알림 화면, HWPX 전용 파일 전송/기본 확인/다운로드 클라이언트를 구현했다. 미연결 RPC를 합성 데이터나 빈 목록으로 바꾸지 않는다. 이 문서는 **새 SQL 요청서**다. 메신저 DB·버킷·RLS·파일 검사 wrapper가 현재 Supabase/Vercel에 존재한다는 뜻이 아니다. 기존 R0/R1/R1S 확정 SQL과 수합 버킷은 수정하지 않았다.

1:1, 단체 대화, 개별 일괄 전송을 제공한다. 단체 대화는 참여자와 답장이 공유되며, 개별 일괄 전송은 수신자마다 별도 1:1 대화에 저장한다. 전송 전에 실제 받는 사람·본문·첨부 이름을 한 화면에서 확인한다. Claude가 만든 초안도 같은 확인 동선을 사용해야 하며 자동 전송 권한은 없다.

첨부 기본 확인은 `/api/messages/check-hwpx` 독립 wrapper를 사용한다. 이번 통합 브랜치에 `apps/main/api/messages/` wrapper 코드가 추가되었으며 **실제 활성화는 전용 SQL·Storage·배포 설정 확인 후**다. 기존 `_hwpx_basic.py`를 import해 활용하되 원본 수정, 별도 검사기 서버 배포, 악성코드 검사 완료 주장은 하지 않는다. 준비 상태가 갖춰지기 전 파일 선택기는 열리지 않는다.

## 2. 공통 응답·권한

RPC는 현재 로그인 JWT를 사용하는 기존 `SupabaseConnection.rpcVerified`로 호출한다. 호출자는 `p_member_id`를 보낼 수 있지만 `auth.uid()`를 대체할 사용자 ID는 보내지 않는다.

성공 응답:

```json
{
  "contractVersion": 1,
  "schoolId": "school-uuid",
  "memberId": "membership-uuid",
  "userId": "auth-user-uuid",
  "ok": true,
  "data": {}
}
```

업무 오류 응답은 같은 범위·계약 버전에 `ok:false,error:{code}`만 포함한다. 허용 코드: `NOT_READY`, `INVALID_INPUT`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`. 내부 SQL·이메일·버킷 경로·원시 예외를 섞지 않는다. 기존 연결의 인증 실패는 예외로 거절할 수 있다. 모듈 준비/Storage/서버키 오류를 사용자 권한 거절로 위장하지 않는다.

각 호출에서 기존 가입 승인, 현재 소속, 학교, 기간, 실제 대화 참여권을 재확인한다. 학교 관리자라는 이유만으로 교사 DM 본문을 열람할 수 없다. 브라우저는 호출 전후 계정과 학교·소속·역할·담당 변경을 대조하고 이전 응답을 폐기한다. 메뉴 숨김은 서버 권한을 대신하지 않는다.

프런트는 명시된 속성만 받는다. 실제 JSON 명칭과 null 가능성은 `contracts.ts`, `validation.ts`, `files.ts`가 기준이다. 이름/본문은 React 텍스트로 렌더하고 URL·HTML로 실행하지 않는다.

## 3. 메시지·알림 RPC 6개

| RPC | 인자 (`p_member_id` 공통) | data |
|---|---|---|
| `workhub_messaging_readiness` | 없음 | `{available,reason,limits,attachments}` |
| `workhub_message_recipients` | `p_query:text`, `p_cursor:text|null` | `{items:Recipient[],nextCursor}` |
| `workhub_message_threads` | `p_query:text`, `p_unread_only:boolean`, `p_cursor:text|null` | `{items:ThreadSummary[],nextCursor}` |
| `workhub_message_get` | `p_thread_id:uuid`, `p_before_cursor:text|null` | `{thread,items:Message[],nextCursor}` |
| `workhub_inbox_list` | `p_unread_only:boolean`, `p_cursor:text|null` | `{items:InboxNotice[],nextCursor}` |
| `workhub_message_mutate` | `p_command:jsonb`, `p_request_key:text`, `p_replay_only:boolean` | 아래 접수증 |

`readiness.reason`: `ready|database_missing|policy_missing|disabled`. `available`은 `reason==='ready'`와 정확히 같아야 한다. `limits`는 준비 전 null, 준비 후 `{bodyCharacters,titleCharacters,recipients}`다. 학교 정책의 실제 값은 SQL에 게시하고 화면이 그대로 적용한다. 브라우저 기술 상한은 본문 50,000자·제목 1,000자·수신자 500명이다. 이 상한이 학교 업무 정책이라는 뜻은 아니다. `attachments`는 `not_configured|hwpx_basic_v1`이며 메시지 첨부 서버·Storage·정책·실제 wrapper 준비 증거가 있어야 후자를 반환한다.

`Recipient`: `{memberId,schoolId,name,department,version}`. 본인 제외, 같은 학교의 현재 메시지 수신 가능 교사만 검색한다. `version`은 이름 문자열이 아니라 수신 자격·기간 변경을 검출하는 서버 버전이다. 부서 문자열은 표시용이다.

`ThreadSummary`: `{id,schoolId,kind:'direct'|'group',title,participants:Recipient[],version,latestSequence,readSequence,unreadCount,updatedAt,canSend}`. 현재 본인을 포함해야 한다. 1:1은 두 명, 그룹은 최소 세 명이다. `version`은 참여자/전송권 변경 버전으로 메시지가 하나 늘 때마다 답장이 충돌하지 않도록 한다. `unreadCount`는 본인이 받은 메시지 중 readSequence 이후 수의 정확한 값이다. 자기 전송은 자동으로 읽지 않은 수에 더하지 않는다.

`Message`: `{id,schoolId,threadId,senderMemberId,senderName,sequence,body,createdAt,attachments}`. 응답의 메시지는 sequence 오름차순이다. 첫 조회는 최신 페이지를 오름차순으로 반환하며 `nextCursor`는 그보다 이전 페이지를 뜻한다. 각 페이지 최대 100개, cursor는 소속·학교·필터·대화·정렬 기준을 서버에서 바인딩한다. 불변 순번을 쓰고 삭제/재정렬로 다른 메시지가 같은 순번을 가지지 않게 한다. 참여자가 나가더라도 허용된 기록에 대한 당시 작성자 식별 근거를 유지한다. 현 클라이언트는 `participants`에 없는 작성자의 본문을 거부하므로 과거 참여자도 기록 조회 범위에 포함하고 `canSend`로 현재 전송권을 구분하거나, 추후 계약을 명시적으로 버전 올린다.

대화 목록 검색은 **서버 전체 목록**의 제목·참여자 검색이다. 현재 로드한 일부 목록만 검색하지 않는다. 메시지 본문 전문 검색은 이 계약에 포함하지 않는다.

`InboxNotice`: `{id,schoolId,ownerMemberId,title,body,createdAt,readAt:null|timestamp,version,source:null|{module,id}}`. source.module은 `calendar|tasks|collections|messages|students|knowledge|cooperation`. 임의 URL은 허용하지 않는다. 원본 열기는 상위 화면의 `canOpenSource`가 정확한 자원 열기를 지원하는 경우만 표시한다. 연결 대상은 일정(eventId), 업무(taskId), 수합(requestId), 협업(cooperation requestId)이다. 알림 생성 시 민감한 학생/상담/DM 본문을 알림 제목에 복제하지 않는다.

### 협업 알림 출처 (C6)

협업 알림의 출처는 정확히 `{"module":"cooperation","id":"협업 요청 ID"}`다. `sourceType`이나 별도 상태·담당자 필드를 추가하지 않는다. 알림 봉투의 schoolId와 ownerMemberId는 현재 학교·소속과 같아야 하며, 출처 ID는 내부 식별자만 허용한다.

- 알림은 발생 당시 안내다. 현재 받는 사람·처리 상태·허용 동작은 원본 협업의 `workhub_cooperation_get` 응답과 이력 검증으로 다시 확인한다. 해당 요청 ID로 협업 화면을 열고, 원본 검증이 성공하기 전에는 상세와 상태 전환 동작을 표시하지 않는다.
- 원본을 열어도 읽음·수락·완료 요청·완료 확인을 자동 기록하지 않는다. 읽음 버튼은 기존 `read_notice` 명령만 보낸다.
- 이동 전 요청이 실패하면 알림함에, 협업 화면의 원본 조회가 실패하거나 현재 권한이 없으면 해당 협업 화면에 오류를 안내한다. 알림을 삭제하거나 완료 처리하지 않으며 임의로 비슷한 제목의 다른 협업을 열지 않는다. 같은 원본을 확인하는 중 중복 클릭은 한 번만 처리한다.
- 읽음 결과가 미상이면 기존 noticeId·expectedVersion·requestKey를 탭 메모리에 보존하고 같은 요청으로 확인한다. 명확한 버전 충돌이면 최신 알림을 다시 읽은 뒤 사용자가 새 읽음 요청을 한다. 읽음 복구는 메시지 새 전송이나 협업 전이를 만들지 않는다.
- 원본의 알림 생성·수신자 선택·중복 방지는 Claude가 작성할 P2/P3 증분 SQL의 책임이다. 앱은 협업 알림을 임의 생성하지 않는다. 원본 변경과 알림 생성은 같은 트랜잭션에서 처리하고, 원 명령 재전송으로 알림이 중복되지 않도록 해야 한다.
- 순서: cooperation 출처를 받는 앱 배포 → P2/P3 CHECK 및 생성 SQL 검토·적용 → 승인된 범위에서 활성화. 이번 앱 변경만으로 실제 알림이 생기지 않는다. 외부 메일·푸시·예약 작업과 공개 범위는 바꾸지 않는다.

## 4. 변경 명령과 원자성

새 대화/일괄 전송:

```json
{"kind":"start","mode":"direct|group|individual","recipients":[{"memberId":"uuid","expectedVersion":1}],"title":"","body":"내용","attachmentIds":[]}
```

- direct 수신자 1명, group 최소 2명과 제목, individual 1명 이상. 중복·본인 포함 금지.
- 그룹/개별 차이는 받는 사람 화면과 최종 확인에 명시한다. 개별 전송의 다른 수신자 목록을 수신자에게 노출하지 않는다.
- 받는 사람·첨부 중 하나라도 자격을 잃었으면 전체를 거절한다. 일부만 보낸 뒤 전체 실패로 응답하지 않는다.
- 개별 전송 전체는 하나의 transaction과 요청 원장으로 처리한다. 동일 학교의 정렬된 회원 ID 순서로 잠가 중복 DM 생성·교착을 줄인다. 1:1 조합의 유일성 제약을 둔다.
- 빈 본문은 첨부가 있을 때만 허용한다. 첨부는 전용 원장의 발신자 소유 ready 파일이며 위조된 수합 파일 ID는 거부한다.

답장:

```json
{"kind":"reply","threadId":"uuid","expectedVersion":3,"recipientMemberIds":["uuid"],"body":"답장","attachmentIds":[]}
```

화면에서 확인한 참여자·버전이 실제 현재 참여자와 모두 같을 때만 전송한다. 변경되었으면 CONFLICT, 본문 보존, 현재 참여자 재조회 후 별도 확인·새 요청 번호로 전송한다. 이미 성공했던 원래 요청은 이후 참여자 버전이 바뀌어도 멱등 접수증으로 확인할 수 있어야 한다. 현재 요청자 자격과 기존 접수증 열람권은 항상 재검증한다.

읽음:

```json
{"kind":"read_thread","threadId":"uuid","throughSequence":15}
{"kind":"read_notice","noticeId":"uuid","expectedVersion":1}
```

읽음은 명시적으로 누른다. 대화 열기 RPC는 쓰기를 하지 않는다. 화면에 반환된 최대 순번까지만 읽음으로 표시하고, 동시에 도착한 더 높은 순번은 남긴다. 서버 readSequence는 단조 증가하며 이전 창의 낮은 순번으로 내려가지 않는다. 접수증의 throughSequence는 요청한 순번이다. 이미 읽은 알림 재시도는 멱등 성공일 수 있다. **알림 읽음은 제출·검토 승인·업무 완료를 절대 변경하지 않는다.**

모든 변경의 성공 접수증:

```json
{
  "requestKey":"message-uuid",
  "kind":"start",
  "recordedAt":"2026-10-16T12:00:00+09:00",
  "deliveries":[{"threadId":"uuid","messageId":"uuid","recipientMemberIds":["uuid"],"sequence":1}],
  "threadId":null,"throughSequence":null,"noticeId":null,"version":null
}
```

start: deliveries의 수신자가 요청한 명단과 정확히 일치. individual이면 한 수신자당 한 delivery. reply: delivery 1개, threadId는 요청 threadId. read_thread: deliveries=[], threadId와 throughSequence만 값. read_notice: deliveries=[], noticeId와 version만 값. 명령과 관계없는 필드는 null이다. reply는 최상위 threadId와 deliveries[0].threadId가 모두 요청 대화와 같아야 한다. read_notice의 version은 expectedVersion 이상이며, 이미 읽은 알림의 멱등 결과는 반드시 +1일 필요가 없다.

멱등 키 범위는 `(school_id, actor_member_id, request_key)`. canonical payload hash와 동일 transaction의 접수증을 저장한다. 동일 키/동일 payload는 최초 접수증을 반환하고, 동일 키/다른 payload는 IDEMPOTENCY_CONFLICT. 처리 도중 응답이 끊겨도 새 메시지가 중복 생성되지 않는다. 승인된 현재 사용자 확인→기존 원장 확인→새 명령 입력/버전 검증→원자 변경 순서를 유지한다. NOT_READY/CONFLICT 같은 확정 거절은 해당 요청의 부작용이 없다는 보장이 있어야 한다.

UI는 입력과 원래 요청 번호를 탭 메모리의 `messaging` 복구 슬롯에 보관한다. 미확정 요청을 새 키로 보내거나 버리기를 허용하지 않는다. 입력 접기는 가능하며 새로고침하면 복구 메모리가 사라진다는 사실을 안내한다. 서버 원장이 최종 중복 방지 수단이다.

준비 상태가 일시 disabled/조회 실패로 바뀌어도 미확정 요청의 확인은 막지 않는다. `p_replay_only:true`는 **현재 권한으로 동일 키·동일 payload의 기존 접수증만 조회**하며 원장이 없으면 NOT_FOUND를 반환하고 새 쓰기는 하지 않는다. 기존 원장이 있으면 기능 활성화/현재 한도 변경보다 원장 대조를 먼저 수행한다. false의 새 요청만 현재 준비 상태와 게시 한도를 적용한다. 쓰기 RPC 호출 후 승인 재조회가 실패한 경우 클라이언트는 확정 거절로 입력을 지우지 않고 CANCELLED로 보관한다. 실제 사용자/학교가 바뀌면 상위 연결의 범위 폐기 규칙을 따른다.

메시지 RPC와 파일 처리 단계는 사전·사후 사용자 조회까지 하나의 제한시간으로 묶는다. 제한시간 뒤 사전 조회나 Storage 모듈 로딩이 끝나도 새 RPC·업로드·검사 요청은 시작하지 않는다. 이미 전송된 요청은 취소됐다고 단정하지 않고 RESULT_UNKNOWN으로 원래 키와 입력을 보존한다. 이 제한시간은 서버 트랜잭션의 취소를 보장하지 않는다.

## 5. 첨부용 RPC·Storage·서버 wrapper

메시지 파일은 수합 원장/ID/버킷과 공유하지 않는다. 버킷 **`workhub-message-files`**, private, 공개 URL 없음. 저장 경로는 정확히 `schoolId/ownerMemberId/fileId/original.hwpx`. 사용자 지정 경로·덮어쓰기·클라이언트 삭제는 없다. 다운로드는 기존 사용자 SDK + 현재 메시지 참여 권한으로 수행한다. 발신자의 미전송 파일은 본인만 읽고, 발송 후 해당 메시지의 권한으로만 받는다. 같은 파일을 individual 전송에서 여러 메시지에 연결할 때도 수신자별 권한 연결표를 따른다.

| RPC | 추가 인자 | data |
|---|---|---|
| `workhub_message_file_readiness` | 없음 | `{available,reason,policy:null|{extensions:['hwpx'],maxFileBytes,maxFiles}}` |
| `workhub_message_file_prepare` | `p_file:{name,claimedBytes,claimedSha256}`, `p_request_key`, `p_replay_only:boolean` | `{fileId,bucket,path,expiresAt,state}` |
| `workhub_message_file_complete` | `p_file_id`, `p_request_key` | FileStatus |
| `workhub_message_file_status` | `p_file_id` | FileStatus |
| `workhub_message_file_access` | `p_thread_id,p_message_id,p_file_id` | `{threadId,messageId,file,bucket,path,ownerMemberId,storageObjectId}` |

FileStatus = `{fileId,state:'awaiting_upload'|'pending_basic'|'ready'|'rejected',storageObjectId:null|uuid,file:null|Attachment}`. Attachment = `{id,name,bytes,sha256,profile:'hwpx_basic_v1'}`. ready만 file을 포함하며 실물 object ID가 반드시 있어야 한다. 파일 크기 정책은 최대 30MiB 기술 한도 안에서 학교 정책이 더 작게 정할 수 있다.

파일 readiness의 reason은 `ready|database_missing|storage_missing|verification_missing|disabled`다. `available === (reason === 'ready')`이며 available일 때 policy는 필수다. 미준비 상태는 policy=null 또는 기존 게시 정책을 반환할 수 있지만, 기존 정책이 있어도 새로운 쓰기를 활성화하지 않는다. prepare 응답 state는 `awaiting_upload|pending_basic|ready`만 허용한다. rejected는 FileStatus로 조회한다.

prepare는 본인 소속+동일 key/payload를 확인하고 같은 예약을 반환한다. 실물 업로드는 upsert:false. complete는 객체가 없으면 awaiting_upload를 반환하고, 실제 Storage 객체가 있으면 ID·메타데이터를 고정해 pending_basic으로 전이한다. **객체가 없던 complete 호출을 영구 성공 캐시해서 나중 업로드를 막지 않는다.** 동일 complete key는 같은 fileId의 확인 작업을 이어가며 ready/rejected 종결 결과는 고정된다. fileId 변경은 IDEMPOTENCY_CONFLICT다.

### 첨부 종료·결과 미상 복구 (2026-10-16, C5)

`messagingFile` 슬롯은 원본 File, prepareKey, completeKey, 원래 policy와 확인된 fileId를 현재 탭에 보존한다. 메시지 전송 요청 번호와 첨부 요청 번호는 서로 다르다. 첨부 결과가 미상인 동안 메시지 전송을 막는다.

- fileId가 있으면 먼저 status를 조회한다. ready 응답은 원본의 이름·크기·SHA-256과 대조하며, 조회 실패나 잘못된 메타데이터는 원 파일·번호를 지우는 근거가 아니다.
- 아직 fileId가 없으면 같은 prepareKey로 원 예약을 복구한다. ready/rejected 결과를 얻으면 종료를 표시하며, 미확정 결과를 새 예약으로 대체하지 않는다.
- status가 awaiting_upload이고 새 쓰기가 가능한 때만 기존 키의 prepare(replayOnly:true)로 검증된 예약 경로와 동일 fileId를 재확인하고 업로드를 재개한다. 덮어쓰기는 하지 않는다.
- 준비 상태가 중단되면 기존 예약·상태 조회만 한다. upload/complete/기본 검사 새 쓰기는 하지 않는다. 당시 policy는 원본 메타데이터 대조용이며 새 정책 게시가 아니다.

P3 prepare의 검증된 동일 범위 업무 응답에서 `CONFLICT`는 원 예약의 상태가 rejected(검사 거절 또는 기한 만료)라는 의미다. 이 경우에만 종료 전용 오류로 구분한다. 다른 단계의 CONFLICT, 예외에 든 문자열, timeout, RESULT_UNKNOWN을 종료로 간주하지 않는다. 현재 응답에는 상세 거절 사유가 없으므로 화면은 “확인 거절 또는 업로드 기한 만료”로 안내하고 원인을 단정하지 않는다.

종료가 확정된 뒤 사용자가 새 파일을 선택할 때만 새 prepareKey/completeKey를 발급한다. 본문·수신자·메시지 전송 키는 바꾸지 않는다. 계정/학교 전환이나 화면 종료 뒤 늦은 응답은 이전 첨부를 다시 추가하지 않는다. 원본과 입력 보관은 탭 메모리이며 새로고침 후 영구 복원을 약속하지 않는다.

### 별도 wrapper 요청

`POST /api/messages/check-hwpx`, JSON `{memberId,fileId,requestKey}`, 현재 사용자 Bearer JWT. 입력에 actor UID, 버킷·경로·서버키·파일 본문을 받지 않는다. 기존 공용 세션/사용자 검증을 재사용하며 다음 전용 RPC만 사용한다.

- `workhub_message_file_basic_claim(p_actor_user_id,p_member_id,p_file_id,p_request_key)` — 서버 전용 실행권. actor는 검증한 JWT에서 결정. 실제 현재 소속/소유권 재검증. lease token, 고정 storageObjectId, bucket/path, claimed metadata, 학교 정책/기술 상한, contract scope를 반환.
- `workhub_message_file_basic_finish(p_actor_user_id,p_member_id,p_file_id,p_request_key,p_lease_token,p_storage_object_id,p_result)` — 서버 전용 실행권. 같은 lease/원본 실물/현재 권한/정책을 재확인. 결과는 실제 기본 확인값 `{profile:'hwpx_basic_v1',accepted,actualBytes,actualSha256,reasonCode}`만 신뢰. 브라우저 주장만으로 ready 금지.
- 검사 wrapper는 claim이 발급한 경로로 private Storage 실물을 읽고 `_hwpx_basic.py`를 import해 HWPX ZIP 핵심 구조·크기·SHA만 검사한다. 기존 수합 claim/finish나 fileId를 사용하지 않는다.
- 서비스 키는 Vercel 서버에만. 브라우저는 사용자 JWT만 보내며 ready 증거를 직접 쓰지 않는다. scanner clean이나 악성코드 없음 필드를 만들지 않는다.
- lease 획득/완료/재시도는 실제 object ID에 묶는다. 완료 후 다른 실물 교체·재업로드 금지. 독립 정리 자동화는 보류, 사용자가 선택 해제한 파일을 즉시 삭제하지 않는다.
- HTTP200의 모듈 envelope에 FileStatus. 실제 사용자 JWT 거절만 401/403. wrapper 미배포/서버 설정/일시 실패는 전송 성공이나 사용자 거절로 해석하지 않는다.
- API 60초 이내 종료(기존 기본 검사 정책 상한 사용), 응답 16KiB 이내. 교사 파일의 본문을 로그에 쓰지 않는다.

### 서버 claim·finish의 정확한 JSON 계약

아래 RPC도 2절의 `contractVersion:1,schoolId,memberId,userId,ok,data/error` 봉투를 사용한다. userId는 서버가 검증한 JWT actor이며 claim과 finish의 범위가 같아야 한다. service 역할에서 호출한다고 임의 p_actor_user_id를 신뢰해서는 안 된다.

claim data는 다음 세 경우다. 필드명·상태를 다른 작업자 계약의 leased/completed로 바꾸지 않는다.

```ts
// 이미 검사 중이거나 끝난 원장의 상태: FileStatus 그대로
{fileId:string,state:'pending_basic'|'ready'|'rejected',
 storageObjectId:string|null,file:Attachment|null}
// 다른 실행이 인수 중이라 이번 실행에 lease를 주지 않는 경우
{fileId:string,state:'checking',leaseToken:null}
// 이번 실행이 실제 확인할 때만 발급
{fileId:string,state:'checking',leaseToken:string,leaseExpiresAt:string,
 bucket:'workhub-message-files',path:string,name:string,
 claimedBytes:number,claimedSha256:string,maxFileBytes:number,storageObjectId:string}
```

- `checking + leaseToken:null`은 wrapper가 `pending_basic,storageObjectId:null,file:null`로 바꿔 브라우저에 돌려준다. 이 실행은 Storage를 읽거나 finish를 호출하지 않는다.
- 발급된 leaseToken은 `[A-Za-z0-9_-]{16,200}`, leaseExpiresAt은 타임존을 포함한 미래 ISO 시각이다. storageObjectId는 정규 소문자 UUID 문자열이다.
- path는 정확히 `${schoolId}/${memberId}/${fileId}/original.hwpx`. name은 `.hwpx` 파일명, claimedBytes와 maxFileBytes는 양의 정수, claimedSha256은 소문자 64자리 SHA256이다. maxFileBytes는 서버가 조회한 학교 정책이며 wrapper는 기존 HWPX 기술 상한과 작은 값을 적용한다.
- awaiting_upload는 이 wrapper claim의 성공 상태가 아니다. 공개 complete에서 업로드 존재를 확인한 뒤 호출해야 한다. ready에는 file과 실물 ID가 필수이고, pending_basic/rejected의 file은 null이다.

finish의 p_result는 **다음 다섯 필드를 모두** 포함한다.

```ts
{profile:'hwpx_basic_v1',accepted:boolean,
 actualBytes:number|null,actualSha256:string|null,reasonCode:string|null}
```

성공은 accepted=true, 실제 bytes/hash, reasonCode=null이다. 크기 사전 거절이나 내려받기 한도 거절은 실제 본문을 끝까지 읽지 않았으므로 bytes/hash가 null일 수 있다. 본문을 읽은 뒤 형식/해시가 거절되면 측정값과 reasonCode를 보낸다. 현재 reasonCode는 `FILE_SIZE_LIMIT|FILE_SIZE_MISMATCH|FILE_HASH_MISMATCH|FILE_SIGNATURE_MISMATCH|FILE_STRUCTURE_INVALID|FILE_STRUCTURE_UNSUPPORTED|FILE_STRUCTURE_LIMIT|FILE_ENCRYPTED|FILE_HWPX_REQUIRED_PART`다. 이는 저장 성공이나 악성코드 검사 결과를 뜻하지 않는다. 네트워크 오류나 claimedBytes보다 짧은 응답은 결과 미확정으로 유지하며 finish를 호출하지 않는다.

finish data는 FileStatus이며 accepted=true이면 ready, false이면 rejected여야 한다. storageObjectId는 claim의 고정 실물 ID와 같아야 한다. ready의 Attachment.id는 fileId, name은 claim.name, bytes/sha256은 실제 측정값과 같다. finish가 pending_basic이나 checking을 반환하면 wrapper는 완료로 표시하지 않는다. 동일 key/lease/실물의 재전송은 기존 종결 결과를 반환하며 새 검사 원장이나 새 파일을 만들지 않는다. 이것은 별도 검사기 서버의 claim/result DTO와 호환된다는 뜻이 아니다.

다운로드는 메시지/파일 권한 조회→SDK download→크기/SHA→권한과 실물 ID 재조회가 모두 같아야 브라우저 Blob을 내보낸다. 임시 서명 URL은 현재 클라이언트에서 쓰지 않는다.

## 6. SQL 데이터와 제약 요청

최소 관계: threads, thread_members(기간·현재/과거 참가), messages(불변 sequence), deliveries/일괄 원장, member_reads, notifications, message_requests, message_files, message_file_links, file_requests/basic_leases, school_messaging_policy. 명칭은 Claude가 기존 통합 설계와 대조해 확정한다.

- 모든 학교 간 참조는 `(school_id, resource_id)` 복합 FK 또는 동일 효력 제약으로 묶는다.
- sender/user는 서버에서 결정. 서로 다른 학교의 교사·파일·알림으로 연결 불가.
- DM 두 명 조합 유일, thread sequence 유일, notification owner 범위 유일.
- notification 생성은 업무 원본 변경과 같은 transaction/outbox 기반으로 중복 방지. 단순 브라우저 호출에 의존하지 않는다. 외부 메일/푸시 발송이나 보류한 운영 자동화를 재개하지 않는다.
- 메시지 파일 객체 교체 방지, 본인 준비 파일에 대한 INSERT만 허용, UPDATE/DELETE 금지, 비공개 SELECT는 현 권한·현재 파일 상태를 확인한다.
- SQL 함수/정책 테스트는 승인 대기·종료 소속·타 학교·남의 DM·남의 미전송 파일·다른 수신자 명단 노출을 모두 거절해야 한다.
- 사용자 탈퇴/학교 이동 시 개인 초안 메모리는 지우고 학교 기록 보존/열람 정책은 확정 규칙에 따른다. 임의로 전체 삭제하지 않는다.

## 7. 자동 검증과 실제 활성화 순서

현재 코드 단위/SSR 시험: scope/role/identity 변경, malformed envelope, 개인 일괄 접수증 정확한 수신자, 같은 키 재시도, payload 변조, 읽음 순번, 서버 검색/커서, 준비 안 됨, 첨부 기본 검사 미완료·위조 위치·내용 해시·전후 권한 확인. 브라우저는 실제 React 화면에 합성 RPC 응답을 연결해 전송 확인/응답 유실 복구/알림/모바일을 검사한다. 합성 시험 통과는 실제 Supabase 권한과 Storage 성공 증거가 아니다.

1. Claude가 기존 R0/R1/R1S와 충돌하지 않는 증분 SQL+전후 보존 지문+회귀를 작성.
2. Codex가 실제 앱 검증 함수와 응답을 대조하고 검토. 사용자가 SQL 적용.
3. 독립 메시지 basic wrapper 구현/배포, 서버 설정 점검. 아직 `attachments=not_configured` 유지.
4. 실제 사용자 PostgREST/Storage/RLS/기본확인 왕복을 자동 검증 가능한 범위에서 실행. 증거가 갖춰져야 정책 게시/첨부 ready.
5. 새 모듈은 기존 superadmin 공개 범위를 유지하고 사용자가 일반 교사 공개를 결정.
6. 교사 실사용 확인은 사이트 전체 확인 때 한꺼번에 진행.

## 판단해서 정한 것

- 개별 일괄 전송은 원자 처리로 선택했다. 누군가에게만 전달되고 재시도 때 중복되는 문제를 피한다. 나중에 대규모 분할 전송을 도입하려면 전용 배치 상태/부분 접수증 계약이 먼저 필요하다.
- 읽음은 자동 추정하지 않았다. 최신 메시지의 실제 렌더 범위와 업무 완료를 혼동하지 않기 위해 명시 버튼을 둔다. 자동 읽음 도입 시 교사 동작과 표시 범위를 검증한 뒤 이 UI와 순번 계약을 수정한다.
- 파일은 전용 권한 원장을 쓴다. 수합 문서와 메시지의 수신자가 다르므로 수합 파일 ID 재사용을 차단한다. 공용 파일 기반으로 합칠 경우 먼저 권한/객체 불변성 계약을 통합 검증해야 한다.
- 브라우저에는 service_role·공개 파일 URL·AI 자동전송이 없다. 연결 실패 시 기능 상태를 솔직하게 보여 준다.
