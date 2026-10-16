# W03 협업 요청: 구현 및 Claude SQL 요청 계약

상태: 화면·실제 RPC 어댑터 구현, 합성 전송 자동 검증 완료. 이 문서는 SQL 작성 요청이며 DB를 적용했다는 기록이 아니다. 기존 개인 업무 RPC·인증·RLS·SQL은 수정하지 않았다.

## 교사 흐름과 범위

1. 받은 요청/보낸 요청을 선택하고 전체 서버 목록에서 제목·내용과 상태로 검색한다. 40건 cursor 페이지를 더 불러올 수 있다.
2. 같은 학교의 현재 승인·활성 교사 한 명을 직접 지정한다. 제목·본문·선택 기한, 본인의 원본 업무를 선택한다. 원본 업무 선택은 본문 공개가 아니다. 실제 전달문과 상대를 확인한 뒤 전송한다.
3. 받는 사람은 수락 또는 사유를 적어 반려한다. 수락 후 결과 내용을 적어 완료 확인을 요청한다.
4. 보내는 사람이 결과를 확인해서 완료 확정하거나 사유와 함께 보완을 요청한다. 받는 사람은 미확인 완료 요청을 사유와 함께 철회할 수 있다. 발신자는 완료 확정 전 요청을 사유와 함께 취소할 수 있다.
5. 개인 업무 연결은 요청 당사자 중 현재 호출자가 소유한 업무만 반환한다. 상대의 개인 업무 본문·ID·상태는 공개하지 않는다. 협업 완료는 상대 개인 업무를 일방적으로 완료 처리하지 않는다.
6. 초안·처리 사유는 현재 탭 메모리에만 보관한다. 새로고침·로그아웃을 견디는 영속 초안이라고 안내하지 않는다. 저장이 불명확하면 공유 pending 원장에 원래 명령·요청 번호를 보관하고 같은 요청만 재조회한다.

상태 전이(그 외 전이 전부 거부):

| 현재 | 수행자 | action | 다음 | 사유 필수 |
|---|---|---|---|---|
| requested | 수신자 | accept | accepted | 아니오 |
| requested | 수신자 | decline | declined | 예 |
| accepted | 수신자 | request_completion | completion_requested | 예 |
| completion_requested | 발신자 | confirm_completion | completed | 아니오 |
| completion_requested | 발신자 | return_completion | accepted | 예 |
| completion_requested | 수신자 | retract_completion | accepted | 예 |
| requested/accepted/completion_requested | 발신자 | cancel | cancelled | 예 |

기능 진입점: `CooperationWorkspace({connection,member,date,revision?,onNavigationLockChange?,onOpenTask?})`. `onOpenTask(taskId)`는 검증된 본인 업무 ID 그대로 전달한다. 각 당사자는 같은 요청을 볼 수 있지만 관리자라는 이유로 개인 요청·개인 업무를 자동 열람하지 않는다.

## RPC 공통 규칙

기존 공유 인증 연결 `rpcVerified`로만 호출하며 p_member_id에서 school/user를 서버가 도출한다. 입력에서 school_id, owner_id를 받지 않는다. 모든 함수는 현재 승인, 계정 상태, 유효 학교 소속을 독립 검증한다. 클라이언트의 member, 버튼 표시, expectedVersion을 권한 증거로 삼지 않는다.

성공 봉투는 모든 RPC에서 필수:

```json
{"ok":true,"contractVersion":"cooperation.v1","schoolId":"...","memberId":"...","ownerUserId":"..."}
```

조회 거절: 같은 봉투 범위+`ok:false,code`. code는 UNAVAILABLE/INVALID_INPUT/FORBIDDEN/NOT_FOUND/CONFLICT/IDEMPOTENCY_CONFLICT/QUERY_FAILED. 준비 전에는 UNAVAILABLE. 예외나 함수 없음은 가짜 빈 목록으로 대체하지 않는다.

쓰기의 **확정 미적용 거절**은 추가로 `requestKey`, `commandHash`, `outcome:"rejected"`가 필수다. `commandHash`는 입력 p_command를 아래 canonical 규칙으로 해시한 값. 학교/계정/요청 번호/명령 지문 중 하나라도 다르면 클라이언트는 SAVE_UNCERTAIN으로 보관한다. `FORBIDDEN`·`CONFLICT`라는 문자열만으로 pending을 지우지 않는다. 동일 key 재시도는 원래 성공/거절 수신증을 우선 반환하고 새 변경을 하지 않는다. 결과 미확정 명령이 정확히 거절되었다는 증명을 받으면 입력을 유지한 채 pending만 해제한다.

SHA-256: UTF-8; JSON 객체 키를 재귀적으로 ASCII 순서 정렬, 배열 순서 유지, 불필요 공백 없음, JS JSON.stringify와 같은 문자열 escaping. 허용 명령에는 부동소수·undefined·비유한수 없음. `cooperation/protocol.ts`의 `canonical`/`sha256`와 실제 SQL 대조 시험 필요. DB의 기본 jsonb::text 공백 포함 출력에 바로 해시를 계산하면 불일치한다.

클라이언트도 요청 전/후 승인·user/profile role·extra_permissions·department_id 및 학교 membership의 역할/담당/유효기간을 다시 비교한다. 전체 30초 제한에는 응답 뒤 승인 조회가 포함된다. 응답 후 접근 변경은 이미 저장됐을 가능성이 있으므로 성공으로 표시하거나 pending을 삭제하지 않는다. 이것은 DB 권한 검사를 대신하지 않는다.

## 정확한 함수·응답

### workhub_cooperation_catalog(p_member_id text/uuid, p_task_cursor text default null)

추가 응답:

```ts
{ recipients: {memberId:string,name:string,description:string}[],
  sourceTasks: {id:string,title:string,version:number}[],
  nextTaskCursor:string|null }
```

recipients 최대 500, 본인 제외·중복 없음. sourceTasks는 본인이 소유하고 연결 가능한 미삭제 업무만 40개, opaque cursor. 제목 최대 160자; 수신자 이름 120, 설명 160. 전체 교직원이 500명을 넘는 경우 목록을 조용히 자르지 말고 명시적 제한/차기 검색 API를 반환한다. sourceTasks는 원본 업무 이름만 보여 주며 요청 송신 시 재조회·version 일치 확인.

### workhub_cooperation_list(p_member_id, p_filter jsonb)

```ts
p_filter={box:'received'|'sent',status:'all'|'requested'|'accepted'|'declined'|'completion_requested'|'completed'|'cancelled',query:string,cursor:string|null}
result={...envelope,items:CooperationRequest[],nextCursor:string|null}
```

query 200자, SQL 파라미터 처리. 전체 허용 집합에 필터 적용 후 정렬·페이지 분할한다. cursor에는 필터·학교·당사자 범위와 stable ordering을 결합한다. 클라이언트가 받은 몇십 건만 검색하는 것이 아니다. 응답당 최대 40.

```ts
CooperationRequest={
 id,schoolId,version,senderMemberId,recipientMemberId,senderName,recipientName,
 title,description,dueDate,status,createdAt,updatedAt,
 taskLink:null|{taskId,ownerUserId}
}
```

version 양수, 당사자 서로 다름. dueDate는 빈 문자열 또는 실제 YYYY-MM-DD. 날짜를 학교 달력의 실제 날짜로 검증한다. title 최대 160, description 최대 8000. 서버 타임스탬프는 ISO 8601. taskLink.ownerUserId는 현재 호출자와 같아야 한다. 타인의 개인 taskLink는 null.

### workhub_cooperation_get(p_member_id, p_request_id)

```ts
{...envelope,request:CooperationRequest,
 history:{id,action,actorMemberId,actorName,recipientMemberId,previousRecipientMemberId,comment,recordedAt,version}[]}
```

각 상태 변경마다 version+1, 원자 이력 1건. 첫 이력 version=1/action=create/actor=발신자. 그 뒤는 위 상태 전이와 actor에 일치, 마지막 상태가 request.status와 일치해야 한다. 클라이언트도 재구성해 검사한다. 이력 1000건까지 전체 반환. 상한을 넘으면 조용히 생략하지 말고 기능 한계를 명시하며, 이력을 무한 축약하는 기능은 이번 구현에 없다.

### P7 인계 이력 계약 보완 (2026-10-16, C1)

SQL 통합 #58 `7877840`의 P2/P7 응답에 맞춘다. `history.action`의 `handover`는 읽기 이력이며 협업 mutate 명령이 아니다. 인계는 기존 학년도·인계 서비스가 처리한다.

새 이력의 모든 행은 다음 세 필드를 포함한다.

- `actorName`: 그 행을 처리한 교사의 표시명(비어 있지 않은 최대 120자 문자열). 요청 본문의 현재 담당자 이름으로 대신 표시하지 않는다.
- `recipientMemberId`: 해당 행 처리 **이후**의 수신자 ID.
- `previousRecipientMemberId`: handover 행에서만 직전 수신자 ID, 다른 행에서는 명시적 `null`.

처음 create의 수신자부터 각 행의 담당자와 상태를 버전 순서로 재생한다. handover의 actor는 수락한 새 담당자이며 previousRecipientMemberId는 직전 담당자, recipientMemberId는 새 담당자와 일치해야 한다. 같은 담당자·발신자로의 인계, 종료 상태에서의 인계, 과거 구간의 행동자나 수신자 변경, 끊긴 버전과 최종 요청 상태/담당자 불일치를 거절한다. 기존 학교·현재 당사자·본인 업무 링크 검증도 유지한다.

배포 호환: 새 세 필드가 전혀 없고 인계도 없는 구형 P2 응답만 기존 방식으로 읽는다. 필드가 하나라도 등장하면 모든 행에 완전한 세 필드가 있어야 한다. 구형 handover, 일부 누락, 신·구 혼합을 추론으로 통과시키지 않는다. 중간 P7 계약만 설치된 환경은 최신 SQL 계약으로 맞춘 뒤 인계를 활성화해야 한다. 이 앱 수정이 SQL 적용을 수행하는 것은 아니다.

상세를 열린 뒤 다시 조회한 응답이 손상되면 과거 상세로 새 처리를 진행하지 않는다. 작성하던 사유와 미확정 원 요청은 보존하고, 자료 재확인 후 복구한다. 브라우저 종료 후 복원은 제공하지 않는다.

`test_workhub_cooperation.mjs`와 `workhub-cooperation-handover.mjs`에서 정상·연속·완료확인 대기 인계, 필드 변조/누락, 구형 무인계 호환, 당시 처리자 표시와 복구를 검증한다. 실제 SQL/PostgREST 권한·동시성 시험은 Claude의 최종 SQL과 별도 대조해야 한다.

### workhub_cooperation_mutate(p_member_id, p_command jsonb, p_request_key text/uuid)

```ts
// 생성
{kind:'create',recipientMemberId,title,description,dueDate,
 sourceTask:null|{id,expectedVersion}}
// 상태 변경
{kind:'transition',requestId,expectedVersion,action,comment}
```

정의되지 않은 속성은 거부. 생성에서는 수신자의 같은 학교·활성·승인 및 본인 여부를 검증. 원본 업무는 호출자의 현재 소유·버전과 연결 권한 재검사. 상태변경 comment 최대 2000. action별 역할·사유·version을 트랜잭션 안에서 확인하며 `expectedVersion` 누락·0·낡은 값 모두 거절.

```ts
{...envelope,requestKey,commandKind:'create'|'transition',entityId,version,
 outcome:'applied'|'replayed',appliedAt}
```

create version=1; transition entityId=requestId, version=expectedVersion+1. 멱등성 범위는 (학교, 호출자 user, member, requestKey). 다른 명령으로 같은 키를 사용하면 IDEMPOTENCY_CONFLICT. 수신증 재생은 후속 상태가 이미 바뀌어도 원래 버전·응답을 돌려준다. 새 상태는 별도 get으로 확인한다.

## Claude에게 요청하는 DB 설계·시험

- 요청 본체, 당사자별 본인 task link, append-only 상태 이력, immutable 요청 수신증. 기존 개인 tasks 의미를 재정의하지 말 것.
- 호출자/학교 경계, private task join, 수신자 변경·탈퇴·담당 종료·승인 취소에 대한 접근 거절. 처리 중 소속 변경도 트랜잭션에서 확인.
- 동시 수락/취소·완료/철회: row lock + expectedVersion. 한 명만 성공. 이력/version/수신증 함께 commit.
- 권한 검사 이전에는 비공개 수신증·내용을 노출하지 않는다. 다만 현재 유효한 동일 당사자가 재요청하면 원본 수신증을 먼저 복원.
- 알림은 요청 수신/수락/반려/완료요청/보완/완료/취소별 outbox event를 같은 트랜잭션으로 기록하는 계약을 제안한다. 업무 상태 확인은 알림 전송 성공에 의존하지 않는다. 메신저 자동 전송으로 간주하지 않는다. 이 화면은 아직 별도 알림 서버 전달 완료를 주장하지 않는다.
- 실제 PostgREST 응답을 `catalogResponse/listResponse/detailResponse/receiptResponse`로 대조할 것. canonical commandHash, 그 결과를 가진 확정 거절까지 대조.

## 자동 검증·잔여

`node tests/test_workhub_cooperation.mjs`: 43건. `tests/browser/workhub-cooperation-handover.mjs`: 인계·재인계·입력 보존·같은 요청 복구 15개. `tests/browser/workhub-cooperation-batch.mjs`: 협업·일괄 가져오기 13개. 브라우저는 실제 React와 실제 어댑터 + 합성 RPC를 사용하며 외부 네트워크는 차단한다.

남은 일: Claude 최신 SQL과 최종 앱 parser 재대조, 사용자 SQL 직접 적용, 실제 PostgREST 권한/경합/수신증·알림 연결 검증, 교사 실사용 피드백. 신규 메뉴 공개 범위와 실제 DB 적용은 이번 코드에서 바꾸지 않았다. 전체 결과와 C1~C7 상태는 [앱 보완 인계](app-contract-fixes.md)를 참고한다.
