# 12. 교사 메신저: 대화·파일·AI 발송 구현 계약

> 2026-10-13 / 설계 보완판 1.1. 사용자 요구와 합의한 개선안을 구체화했다. **실제 DB 구축, SQL 작성·실행, 인증·RLS 변경, 서비스 공개는 하지 않았다.** 신규 구현은 기존 M05(전달·알림·문의)의 세부 기능으로 편성하며 AI는 M07과 연결한다. 기존 AI `conversations/messages`를 교사 대화에 재사용하지 않는다. 표·명령은 구현 목표이며 현재 서비스에 존재한다는 뜻이 아니다.

## 1. 사용자에게 보이는 완성 동작

1. 같은 학교 교사를 검색해 1:1 메시지와 파일을 보낸다.
2. 여러 교사에게 같은 안내를 보내려면 **각자에게 보내기**를 선택한다. 각 수신자는 자기 DM으로 받고 다른 수신자나 답변을 보지 않는다.
3. 함께 논의해야 하면 **단체 대화방**을 만든다. 보내기 전 참여자 목록을 확인하며 답변은 그 방의 현재 참여자에게 보인다.
4. Claude에게 “2학년 담임께 이 파일과 안내를 보내줘”라고 요청하면 AI는 등록·승인된 배정에서 대상자를 찾고 발송안을 만든다. 사용자가 받는 사람·본문·첨부를 확인한 뒤 보낸다.
5. 수합/시간표 요청을 카드로 받아 해당 업무를 열고 작성·동의·거절한다. **대화 읽음, 문서 제출, 시간표 동의, 시간표 반영은 다른 상태**다.
6. 일반 발송은 교사가 편집기에 표시된 정확한 상대·본문·첨부를 보고 누르는 ‘보내기’가 확인이다. 단순 DM마다 불필요한 팝업을 강제하지 않는다. AI/개별 일괄발송은 별도 확인 화면에서 실제 대상자와 영향을 보여 준다.

### 화면과 모바일 동선

| 화면 | 우선 정보·행동 | 숨기거나 분리할 정보 |
|---|---|---|
| 메시지 목록 | 내 현재 학교, 안 읽은 대화, 상대/방 이름, 마지막 활동, 새 메시지 | 그룹 수신 전체·AI 대화·업무 승인 대기 목록을 한 목록으로 섞지 않음 |
| 1:1 대화 | 상대의 이름·소속 표시, 최근 메시지, 파일, 답장 입력 | 온라인/마지막 접속 추적은 초기 필수 범위에 넣지 않음 |
| 단체 대화 | 방 이름, 참여자 수/열기, 본문, 초대·나가기 | 권한 없는 교사의 인사정보·이메일 노출 금지 |
| 여러 명에게 보내기 | 대상 선택, 정확한 명단·학교·대상 수, 본문/파일, 각자 DM임을 명시 | 실제 단체 대화방과 동일한 ‘단체’ 명칭만 쓰지 않음 |
| AI 발송 확인 | 받는 사람, 메시지, 파일, 관련 업무, 수정/보내기 | 프롬프트·tool JSON·내부 토큰·해시를 사용자에게 보여 주지 않음 |
| 보낸 결과 | 전달됨/실패/대상 변경으로 차단, 재시도할 대상 | 알림 실패를 메시지 실패로 표시하지 않음 |

모바일은 목록→대화의 한 화면 전환, 뒤로 가면 이전 목록 위치 복원, 입력 영역/파일 버튼을 소프트키보드 위에서 사용할 수 있게 한다. 키보드 접근, 읽기 순서, 파일 제거의 이름, 전송 중 상태, 오류 후 내용 보존을 검증한다. 빈 목록·조회 실패·권한 없음·로딩을 각각 표시한다. 실시간 연결이 끊기면 마지막 확정 순번 뒤를 재조회하고, 실시간 사건만으로 읽음을 자동 갱신하지 않는다.

## 2. 역할·학교·참여자의 경계

| 주체 | 허용 | 허용하지 않음 |
|---|---|---|
| 현재 활성 교사 | 같은 학교 현재 교사와 DM, 권한 있는 그룹 참여, 자기 발송·정정·회수 | 다른 학교 계정 검색·발송, 타인 대화 열람 |
| 그룹 manager | 현재 방 이름/참여자/관리 역할 변경·보관 | 학교 관리자라는 이유만으로 다른 방에 들어가기 |
| 학교 관리자 | 승인된 범위의 이용 상태·실패율 등 최소 운영 메타 | 교사의 DM 본문·첨부·AI 요청 열람 |
| Claude | 요청 교사의 현재 권한 안에서 대상 조회·초안·선택 대화 요약 | 확인 전 발송, 모든 교사 대화 일괄 수집 |
| 제한 worker | 고정 dispatch의 현재 허용 대상에 전달하고 상태 기록 | 서비스 역할로 새 수신자 추가·권한 우회 |
| 플랫폼 지원 | 허용된 장애 코드·ID·시각·메타 | 대화/첨부 원문을 지원 조회에 포함 |

- 학교 경계는 `school_id`, 실제 사람은 인증된 `account_id`, 현재 행동 자격은 `membership_id`로 분리한다. 겸임 교사는 학교별 별도 메시지함을 사용한다. 현재학교 UI만 바뀌고 요청 school 값이 남는 상황을 generation/cache 키로 차단한다.
- DM 유일성은 **같은 학교의 정렬한 소속 ID 두 개**다. 두 사람이 순서를 바꾸어 동시에 생성해도 한 방이다. 본인에게 보내기는 별도 개인 메모로 다루며 이 계약에서는 거부한다.
- 소속 종료는 즉시 그 학교 메시지/파일/검색/AI 근거 접근을 막는다. 재임용된 새 소속에 옛 대화 접근권을 자동 승계하지 않는다.
- 그룹 새 참여자와 재입장자는 참여 시점 이후부터 본다. 재입장은 새 episode이고 기존 episode를 되살리지 않는다. 초기에는 과거 대화 공개 기능을 제공하지 않는다.
- 기존 수신자가 떠나도 다른 적법한 참여자의 대화가 사라지지는 않는다. 화면에 “탈퇴한 참여자”를 표시하고 현재 인사정보를 과도하게 조회하지 않는다. 표시 이름 보존은 승인된 보존·최소정보 정책을 따른다.
- self leave는 일반 참여자도 본인의 현재 episode에 실행할 수 있다. 다른 교사 제거·초대·역할 변경은 manager만 가능하다.
- 마지막 manager가 나갈 때 다른 현재 참여자에게 인계하거나 방 보관을 선택한다. 보관은 삭제가 아니며 기존 참여자는 허용된 과거 메시지를 읽을 수 있으나 새 발송은 막는다.
- 소속/역할 변경이 아직 participant 행에 전파되지 않았어도 읽기 API의 현재 소속 검사가 먼저 막는다.

## 3. 본문·발송·대화방을 분리하는 이유

`messenger_dispatches`는 사용자가 확인한 **불변 발송내용과 정확한 대상 집합**이다. `messenger_messages`는 그 발송내용이 특정 대화방에 실제 도착했다는 기록이다. 개별 일괄발송은 여러 DM 메시지가 같은 dispatch 본문·첨부를 참조하되, 수신자는 자기 메시지 경로만 읽는다.

6개 표로 구성한다. 별도 대화 본문 복사·수신자별 첨부 복사·알림 본문 사본은 만들지 않는다. 기존 파일·멱등 접수·감사·outbox·AI 제안 표를 재사용한다.

| 표 | 담당 사실 |
|---|---|
| messenger_threads | 학교별 direct/group 방, DM 쌍 유일성, 참여판·메시지 순번 |
| messenger_participants | 현재/과거 참여 episode, 보기 시작 순번, 역할·읽음 경계 |
| messenger_dispatches | 고정 발송안, 확인 지문, 본문·업무 카드, 확인/진행 상태 |
| messenger_dispatch_targets | 정확한 수신자 스냅숏, 대상별 결과, 정정할 이전 메시지 |
| messenger_messages | 방에 실제 커밋된 메시지, 순번, 회수 여부 |
| messenger_dispatch_files | 발송안과 검증된 파일의 연결·지문 |

**의존 순서:** threads → participants → dispatches → dispatch_files/messages → dispatch_targets. dispatch는 message를 FK로 참조하지 않는다. 정정 원메시지 FK는 targets에 두므로 서로가 반드시 먼저 존재해야 하는 순환 참조를 만들지 않는다. 그룹 참여 변경/메시지 생성은 선행 행을 생성한 뒤 같은 트랜잭션에서 무결성을 확인한다.

## 4. 명단 고정·확인·전달 상태 기계

### 4.1 발송 준비

1. 현재 학교/발신 소속/feature 및 서비스 스위치를 검사한다.
2. 승인된 부서·학년·교과·직접 선택 명단으로 대상 후보를 계산한다. 동명이인이나 미승인 배정은 추정하지 않고 선택을 요청한다.
3. 등록된 대상 조건의 AND/OR/제외 규칙을 사용하고 중복 소속은 제거한다. ‘학년 부장’과 ‘학년 담임’을 구분한다.
4. 파일 실물·안전검사·현재 원본 ACL, 업무카드 현재 열람권을 검사한다.
5. dispatch/targets/files를 원자 생성하고 정렬된 정확한 수신자 집합과 발송 확인 지문을 반환한다. 대상 조회 실패는 0명으로 반환하지 않는다.
6. 수정하면 새 prepared dispatch를 만든다. 이전 확인 지문은 재사용하지 않는다. 만료시간은 승인된 정책값이며 문서에 임의 분/시간을 고정하지 않는다.

### 4.2 발송 확인

`confirmation_sha256`는 본문·파일 ID와 실물지문·모드·카드 종류/ID/판·정정 원메시지·정확한 수신 소속/계정 집합·정책판·권한판·group 참여판·만료·tool registry 판을 결정적으로 정규화한 값이다. 해시가 존재한다는 것만으로 권한이 생기지 않으며 서버가 원본에서 다시 계산한다.

확인 당시 대상 명단/방 참여판/파일/권한/정책 등이 바뀌면 `CONFIRMATION_STALE`로 돌아가 새 명단을 보여 준다. 이미 사용자가 확인한 명단을 확인 후 부서 조회 결과로 몰래 바꾸지 않는다. 직접 입력과 AI 도구가 같은 domain 명령을 사용한다.

`prepared → confirmed → sending → completed | partial | failed`

- prepared → cancelled/expired: 효과 없음.
- confirmed/sending → cancelled: **아직 pending인 대상만 취소**한다. 이미 전달된 메시지는 별도 회수 절차이며 일괄 취소됐다고 표시하지 않는다.
- completed: 모든 고정 대상에 DB 메시지가 커밋됨. 푸시 성공/읽음/업무 완료 의미가 아니다.
- partial: 일부 delivered이고 나머지는 blocked/failed/cancelled.
- failed: delivered 0이며 모든 대상이 확정 실패/차단으로 종료.
- pending/sending: 현재 작업 중 또는 안전한 재시도 대기. 결과를 모르는 상태를 성공으로 만들지 않는다.
- 상태 집계는 targets의 투영이며 근거 없는 수동 ‘완료’ 변경은 금지한다.

### 4.3 그룹과 개별 일괄발송의 원자성

**그룹:** 고정한 참여판과 현재 참여자를 대조한 뒤 메시지 1개·전체 target delivered·방 순번·접수·감사·outbox를 한 트랜잭션으로 저장한다. 그룹 참여자 일부만 성공한 메시지를 만들지 않는다. 새 멤버가 확인 직후 들어오면 기존 확인안은 stale이다.

**개별 일괄발송:** 대상별로 DM 확보·메시지 1개·대상 delivered·접수·감사·outbox를 원자 처리한다. 다른 대상이 실패해도 성공한 메시지는 유지한다. 진행 중 전출한 대상은 blocked이며 다른 교사로 대체하지 않는다. 실제 최신 gate를 통과한 원래 대상만 전달한다.

재시도 키는 dispatch/recipient에 고정한다. DB 응답이 유실되어도 원접수와 `UNIQUE(dispatch_id,thread_id)`를 먼저 현재 권한으로 조회해 같은 성공을 반환한다. 성공행을 반복 삽입하지 않는다. 그룹은 메시지 1개 단위로 재시도한다.

푸시/이메일 등 외부 알림은 outbox 후속 작업이다. 메시지 저장이 성공하고 푸시만 실패했을 때 화면은 ‘전달됨’을 유지하고 알림만 재시도한다. 외부 채널의 불명확한 결과는 04의 외부 호출 계약을 따르며 DB 메시지를 다시 발송하지 않는다.

## 5. 읽음·정정·회수·보존

- 읽음은 현재 episode의 접근 가능한 메시지가 화면에 실제 표시된 뒤 `last_read_seq`를 단조 증가시킨다. 최신 페이지 일부만 보고 과거 미조회 구간까지 읽었다고 가정하지 않는다. 초기 진입 UI는 읽음 경계 이후부터 이어 보여주거나 ‘여기까지 읽음’ 행동을 명시한다.
- 소규모/대규모 그룹의 읽음 상세 공개 범위는 학교 정책으로 결정한다. 기본 DTO는 본인의 안 읽음과 표시 허용된 집계만 제공하며, 개인별 활동 감시용 접속 이력을 새로 수집하지 않는다.
- 정정은 원메시지를 참조하는 새 발송이다. 원본문을 덮어쓰지 않고 연결된 정정 표시를 제공한다. 일괄발송 정정은 수신자별 원메시지를 고정한다.
- 회수는 원메시지에 tombstone을 남기고 그 메시지 경로의 본문·첨부·검색·AI 재사용을 막는다. 이미 읽거나 PC에 저장한 내용을 원격 삭제했다고 주장하지 않는다.
- 한 dispatch의 일부 DM만 회수한 경우 다른 정상 DM의 공용 본문을 물리 삭제하지 않는다. 전체 파기는 모든 종속 메시지/보존 hold/정책을 계산하는 공통 lifecycle 명령이 수행한다.
- 일반 교사의 ‘대화방 나가기’는 전교 자료 삭제가 아니다. 삭제·파기 기한·회수 가능기간은 임의 값으로 정하지 않으며 승인된 보존 정책 확정이 운영 공개 전 필요하다.
- 최초에는 무제한 전체본문 검색/대화 export를 추가하지 않는다. 대화 내 검색을 제공할 경우 현재 participant episode·seq·원본 상태를 먼저 필터하고, 색인 누락/철회 지연에도 직접 서버 검사가 막아야 한다.

## 6. 파일과 업무 카드

### 파일 전달
파일은 공통 업로드 예약·실물 크기/MIME/hash·안전검사를 재사용한다. 업로드 중/검사 실패/정책 미정인 파일은 발송 확인이 불가능하다. 파일 크기·종류·압축 해제 상한·URL 수명은 승인된 정책으로 읽는다.

새 업로드는 사용자가 이 메시지에 공유하려는 파일로 명확히 표시한다. 기존 학교 문서·학생 자료·다른 사람의 private 파일을 메신저에 붙였다는 이유로 ACL을 확장하지 않는다. 기존 업무 파일은 받는 사람의 원본 현재 열람권도 AND로 확인하는 링크로 전달하며, 권한이 없으면 담당 업무 화면에서 접근을 요청하게 한다.

다운로드 요청은 `messageId + fileId`를 요구한다. 서버는 현재 소속/참여 episode/seq/메시지 상태/같은 dispatch 첨부/파일 실물/원본 ACL을 검사한다. Storage 경로를 반환하거나 파일 ID만으로 서명 URL을 발급하지 않는다. 이전 URL 접근 회수 가능범위와 만료는 기존 파일 계약을 따르고, 다운로드된 사본까지 회수됐다고 표시하지 않는다.

### 수합·시간표 카드
카드는 `collection_id` 또는 `timetable_change_set_id`와 당시 판을 typed FK로 보존한다. 수신자별 수합 단위는 그 교사의 현재 단위 관계로 서버가 해석하며, 다른 교사 답변/단위 목록을 메시지 JSON에 복사하지 않는다.

- ‘작성하기’는 현재 작성/제출 권한의 수합 화면을 연다.
- ‘수락/거절’은 시간표 현재 영향판·본인 참여를 다시 읽어 전문 명령의 확인 UI로 이어진다.
- 카드의 예전 제목/마감/상태를 정본으로 취급하지 않는다. 현재 업무를 읽을 수 없으면 ‘현재 확인할 수 없는 업무’만 보여 준다.
- 메시지 회수는 수합/시간표 원본을 취소하지 않는다. 업무 취소도 별도 권한 명령으로 처리한다.
- 미제출 교사 재안내는 현재 미제출 명단을 새로 계산한 새 발송안을 확인한다. 과거 명단을 반복 재활용하지 않는다.

## 7. Claude 문맥과 개인정보

Claude 연결은 기존 M07 `tool_proposals/tool_runs/ai_runs`의 현재권한·확인·비용·실행 계약을 사용한다. 모델명·토큰 한도·가격·보존 수치를 이번 설계에서 새로 확정하지 않는다.

AI에 보내는 대화는 사용자가 명시 선택한 메시지 범위 또는 해당 대화에서 요청한 요약 범위로 제한한다. 개인 AI 대화와 교사 메신저는 다른 저장소·권한이다. 학교 전체 대화를 자동으로 학교 지식에 색인하거나, 다른 교사의 대화가 개인 비서 기억으로 들어가게 하지 않는다.

`ai_run_sources.kind=messenger_message` 분기는 정확한 메시지/불변 dispatch/선택 당시 상태판/locator/hash를 저장한다. 현재 read를 실행 직전과 결과 공개 직전에 다시 검사한다. 회수·소속종료·방 탈퇴·참여범위 변경 시 옛 요약을 정상 근거처럼 재사용하지 않는다. 로그·감사·outbox·push에는 본문·첨부 파일명·수신자 전체 명단·AI 프롬프트를 넣지 않고 안전한 사건 ID와 코드만 둔다. push는 ‘새 메시지가 있습니다’ 수준이며 구체 표시 정책은 별도 승인한다.

## 8. API 세부 계약과 예시

공통: 브라우저는 authenticated direct DML 대신 등록된 명령을 사용한다. 모든 변경은 명시적 school/origin membership, requestKey, 기대판을 받는다. actor는 Auth에서 파생하며 body에 actor를 적어도 대체하지 않는다. `operationId/status/serverRecordedAt` 공통 응답을 따르고 날짜는 서버 시각이다. 예시 ID·시각은 합성 데이터다.

### API-25 읽기·대화 운영

- `GET /schools/{schoolId}/messenger/threads?cursor=...`: 현재 참여방, 안 읽은 수, 다음 cursor. 마지막 본문 미리보기는 권한·표시정책이 허용한 경우만.
- `GET /schools/{schoolId}/messenger/threads/{threadId}/messages?beforeSeq=...`: `ORDER BY seq DESC` keyset. 동일 타임스탬프도 누락되지 않는다. 최대 page 크기는 등록된 서비스 설정, 사용자가 임의 무제한 지정 못함.
- `POST .../direct`: recipientMembershipId, requestKey. 역순 중복은 동일 thread 반환.
- `POST .../groups`: title, 정확한 recipientMembershipIds, requestKey. 활성 교사만 초대. 방생성은 메시지 발송과 별도.
- `POST .../threads/{id}/participants`: add/remove/leave/transfer_manager, expectedParticipantEpoch, requestKey. leave는 본인 현재 episode에 한해 일반 참여자도 허용하고, 나머지는 manager 권한을 검사한다.
- `POST .../threads/{id}/read`: participantId, throughSeq, requestKey.
- `POST .../messages/{id}/withdraw`: expectedVersion, requestKey. 현재 발신자만.
- `GET .../messages/{id}/files/{fileId}`: 현재 읽기권한을 검사하는 파일 API로 연결.
- `GET .../dispatches/{id}`: 발신자만 대상별 전달 현황. 수신자에게 전체 대상 명단 반환 금지.

```json
{
  "threadId": "thread-demo",
  "participantId": "participant-demo",
  "visibleFromSeq": 21,
  "lastReadSeq": 24,
  "messages": [
    {
      "id": "message-demo",
      "seq": 25,
      "sender": {"displayName": "예시 교사", "membershipStatus": "active"},
      "body": "자료를 확인해 주세요.",
      "state": "visible",
      "files": [],
      "workCard": {"kind": "collection", "id": "collection-demo", "action": "open"},
      "sentAt": "2026-10-13T03:00:00Z"
    }
  ],
  "nextCursor": null
}
```

### API-26 발송 준비·확정

```json
{
  "schoolId": "school-demo",
  "originMembershipId": "member-sender",
  "requestKey": "prepare-demo-001",
  "mode": "broadcast_direct",
  "recipientSelector": {"gradeIds": ["grade-demo"], "assignmentKind": "homeroom_teacher", "include": [], "exclude": []},
  "body": "수합 자료를 확인해 주세요.",
  "files": [{"id": "file-demo", "sha256": "<검증된 64자리 지문>"}],
  "workCard": {"kind": "collection", "id": "collection-demo", "expectedVersion": 3},
  "origin": "ai"
}
```

`POST /schools/{schoolId}/messenger/dispatches/prepare` 응답:
```json
{
  "operationId": "operation-demo",
  "status": "committed",
  "dispatchId": "dispatch-demo",
  "version": 1,
  "state": "prepared",
  "confirmationSha256": "<서버 계산 64자리 지문>",
  "recipientPreview": [{"membershipId": "member-a", "displayName": "예시 교사", "assignmentLabel": "2학년 담임"}],
  "targetCount": 1,
  "modeLabel": "각자에게 보내기",
  "nextAction": "confirm"
}
```

`POST .../dispatches/{id}/confirm` 입력은 `expectedVersion, confirmationSha256, requestKey`. AI는 tool_proposal도 같은 dispatch/actor/origin/해시를 가리켜야 한다. 단체발송 응답 `status=accepted, state=confirmed, operationId, dispatchId`는 접수이며 전달 완료가 아니다.

상태 조회:
```json
{
  "dispatchId": "dispatch-partial-demo",
  "state": "partial",
  "summary": {"targetCount": 3, "delivered": 2, "blocked": 1, "failed": 0, "pending": 0},
  "targets": [
    {"membershipId": "member-a", "state": "delivered", "notificationState": "retrying"},
    {"membershipId": "member-b", "state": "delivered", "notificationState": "sent"},
    {"membershipId": "member-c", "state": "blocked", "code": "RECIPIENT_UNAVAILABLE"}
  ]
}
```

### 오류·사용자 회복 경로

| 코드 | HTTP | 재시도/화면 행동 |
|---|---:|---|
| RESOURCE_UNAVAILABLE | 404 | 존재 여부 숨김. 목록 새로고침, 다른 학교/타인 객체 정보 미표시 |
| ORIGIN_MEMBERSHIP_ENDED | 403 | 현재 학교 접근 잠금, 옛 초안 새 학교로 복사하지 않음 |
| CONFIRMATION_STALE | 409 | 수신자/첨부/본문 다시 확인. 자동 발송 금지 |
| PARTICIPANTS_CHANGED | 409 | 그룹 참여명단 새로 읽고 새 발송안 |
| IDEMPOTENCY_CONFLICT | 409 | 같은 키 다른 의도. 기존 결과 확인 후 명시적 새 요청 |
| RECIPIENT_UNAVAILABLE | 409 | 확인 전이면 명단 조정, 확인 후에는 대상 blocked |
| FILE_NOT_READY / FILE_UNAVAILABLE | 409 | 검사 진행/파일 거부 구분, 준비 완료 전 발송 금지 |
| POLICY_UNSET | 409 | 필요한 정책명을 안전한 설명으로 안내; 임의 한도 적용 금지 |
| TEMPORARILY_UNAVAILABLE | 503 | 내용 보존, 같은 요청키로 접수 조회 후 안전한 재시도 |
| VALIDATION_FAILED | 422 | 빈 본문+첨부없음, 잘못된 모드/대상/혼합 카드 필드 표시 |

오류는 `code,retryable,correlationId,message,nextAction`을 반환한다. 예외 stack·SQL·다른 학교 ID·본문·파일 원문은 반환하지 않는다. 개별 수신 실패는 전체 HTTP 요청실패와 구분하고 대상 상태 DTO로 표현한다.

## 9. 동시성·조회·보존 구현 요구

01의 공통 잠금 순서(주체→학교/스위치→소속→역할/정책→멱등→원본→파일→접수/감사/outbox)를 따른다. 여러 소속/방은 정렬된 ID 순서로 잠근다. 읽음 cursor의 감소·message seq 경쟁·그룹 마지막 manager 경쟁을 독립 DB 두 연결로 시험한다. 외부 AI/Storage/알림 호출 동안 DB 잠금을 잡고 기다리지 않는다.

직접 SELECT 허용 여부보다 중요한 것은 모든 경로에서 동일한 현재권한 결과다. 특히 dispatch 본문과 고정 수신명단을 한 번에 노출하는 REST SELECT는 허용하지 않고, 메시지 DTO가 현재 참여자에게 본문만 투영한다. 원본 처리가 가능한 registry에 새 typed handler를 추가하고 임의 테이블 문자열로 동적 조회하지 않는다.

전체 대화가 아닌 본인 active participants로 먼저 범위를 줄인 후 방/메시지를 찾는다. 읽음 수는 본인 episode 경계 이후의 실제 visible 메시지로 계산하며 방의 last_seq 차이를 그대로 개수로 쓰지 않는다. 회수/숨김/본인발송이 존재하기 때문이다. 최종 p50/p95 목표와 실제 학교 규모는 성능 시험에서 측정하며 근거 없는 숫자를 완료 기준으로 만들지 않는다.

메신저 보존 규칙, 첨부 제한, 읽음 상세 공개, 알림 표시·조용한 시간은 정책 등록 항목으로 남긴다. 이 문서가 운영 정책 승인이나 실제 DB 보안 변경을 대신하지 않는다.

## 10. 테이블별 핵심 열·무결성

아래 열은 전체 구현 목표의 핵심 사전이다. 기존 공통 정책/불변/삭제 원장 규칙은 그대로 적용한다. 각 references의 단일열 표시는 관계 설명이며, 실제 학교 범위는 아래 복합 FK로 강제한다. SQL은 별도 승인 절차에서 작성한다.

### workhub.messenger_threads (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `kind` | text | 불가 | direct/group; 생성 후 불변 |
| `title` | text | 허용 | group 제목; direct는 NULL. 상대 이름은 현재 표시자료로 조립 |
| `direct_low_membership_id` | text | 허용 | direct의 정렬상 작은 소속 ID · 참조: `workhub.memberships.id` |
| `direct_high_membership_id` | text | 허용 | direct의 정렬상 큰 소속 ID · 참조: `workhub.memberships.id` |
| `created_by_membership_id` | text | 불가 | 방 생성 당시 소속 · 참조: `workhub.memberships.id` |
| `created_by_account_id` | text | 불가 | 방 생성 당시 계정 · 참조: `workhub.accounts.id` |
| `state` | text | 불가 | active/archived; 보관은 삭제/권한회수가 아님 |
| `participant_epoch` | bigint | 불가 | 참여/탈퇴/역할변경마다 증가; 발송 확인 지문에 포함 |
| `last_seq` | bigint | 불가 | 0부터 시작. 이 방 마지막 커밋 메시지 순번; 순번 배정은 방 잠금 아래 실행 |
| `version` | integer | 불가 | 1부터 시작하는 낙관적 동시성 판 |
| `created_at` | timestamptz | 불가 | 서버 생성 시각 |
| `updated_at` | timestamptz | 불가 | 서버 최신 활동 시각 |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- kind=direct iff 두 direct membership 존재 AND low<high; group이면 두 열 모두 NULL
- UNIQUE(school_id,direct_low_membership_id,direct_high_membership_id) WHERE kind=direct
- (school_id,direct_low_membership_id)/(school_id,direct_high_membership_id) FK memberships(school_id,id); 서로 다른 현재 소속, 계정도 서로 달라야 함
- (school_id,created_by_membership_id,created_by_account_id) FK memberships(school_id,id,account_id)
- last_seq>=0, participant_epoch>=1, version>=1; direct 방은 정확히 두 지정 소속만 참여 가능
- group title은 공백제거 후 비어있지 않음; 직접 DM에는 title 없음. 길이 한도는 승인된 입력 규격에서 조회

**인덱스**

- `(school_id,updated_at DESC,id)`
- `(school_id,state,id)`

**명령·불변 규칙**

- 같은 학교 두 소속의 역순 동시 DM 생성은 UNIQUE와 멱등 명령으로 한 방으로 수렴한다.
- 전출 뒤 새 소속으로 돌아온 사용자는 새 membership이므로 옛 DM이 자동 재개되지 않는다.
- group에서 현재 manager가 0명이 되는 변경은 현재 참여자에게 역할 인계하거나 방 archived 처리와 원자 결합한다. 학교 관리자 자동 manager 승격 금지.
- 나가기/멤버 추가/재입장은 participant_epoch 증가. 재입장은 새 참여 행과 새 visible_from_seq를 만든다.

**읽기:** 현재 학교 소속이 활성이고 현재 참여 episode가 active인 사람만. 퇴직·탈퇴 시 목록/검색/본문/파일 즉시 차단. 관리자·플랫폼 자동 열람 불가.

**수용시험:** MSG01, MSG02, MSG03, MSG04

### workhub.messenger_participants (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `thread_id` | text | 불가 | 대화방 · 참조: `workhub.messenger_threads.id` |
| `membership_id` | text | 불가 | 참여 당시 고정 소속 · 참조: `workhub.memberships.id` |
| `account_id` | text | 불가 | 참여자 계정 · 참조: `workhub.accounts.id` |
| `role` | text | 불가 | manager/member; direct는 member |
| `state` | text | 불가 | active/left/removed; 종료 후 같은 행을 active로 되돌리지 않음 |
| `visible_from_seq` | bigint | 불가 | 참여 직후 볼 수 있는 첫 순번; 기본 last_seq+1 |
| `last_read_seq` | bigint | 불가 | 실제 화면에 표시한 연속 읽음 경계; visible_from_seq-1 이상, 단조 증가 |
| `joined_at` | timestamptz | 불가 | 참여 시작 |
| `ended_at` | timestamptz | 허용 | left/removed이면 필수 |
| `ended_by_membership_id` | text | 허용 | 자발적 나가기/제거 수행자; 소속 종료 worker는 NULL · 참조: `workhub.memberships.id` |
| `version` | integer | 불가 | 1부터 시작하는 낙관적 동시성 판 |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- UNIQUE(school_id,thread_id,id)
- UNIQUE(school_id,thread_id,id,membership_id,account_id)
- (school_id,thread_id) FK messenger_threads(school_id,id)
- (school_id,membership_id,account_id) FK memberships(school_id,id,account_id)
- (school_id,ended_by_membership_id) FK memberships(school_id,id)
- UNIQUE(thread_id,membership_id) WHERE state=active
- state=active iff ended_at IS NULL; visible_from_seq>=1; last_read_seq>=visible_from_seq-1
- 동일 thread/membership episode 기간은 중첩 금지. 종료 시점은 joined_at 이상; 새 episode는 ended_at 뒤 생성
- joined_at/visible_from_seq와 thread/member/account 정체성 불변; ended 상태에서 active로 역전 금지

**인덱스**

- `(school_id,membership_id,thread_id) WHERE state=active`
- `(school_id,thread_id,state,id)`

**명령·불변 규칙**

- 읽음 명령은 해당 episode의 접근 가능 메시지 순번만 허용하고 max(기존,입력)로 갱신한다.
- 페이지가 뒤에서 열리면 현재 화면 이전을 읽음으로 처리할지 UI에서 명시해 자동 과장하지 않는다. 미조회 앞부분이 있으면 연속 경계 이전까지만 갱신한다.
- 새 참여자/재입장자는 새 visible_from_seq 이후만 본다. 과거 파일/검색/인용/AI 문맥도 같은 경계 적용.
- 메시지를 읽어도 수합 제출/시간표 동의/공지 확인 상태는 바뀌지 않는다.

**읽기:** 본인 episode와 현재 방의 최소 참여자 정보만. 다른 학교/관계없는 관리자 불가. 종료 참여자도 기존 메시지 발신 표시용 최소 탈퇴 표식만 반환.

**수용시험:** MSG02, MSG03, MSG05, MSG14

### workhub.messenger_dispatches (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `sender_membership_id` | text | 불가 | 발송 주체의 고정 소속 · 참조: `workhub.memberships.id` |
| `sender_account_id` | text | 불가 | 인증에서 파생한 발송 계정 · 참조: `workhub.accounts.id` |
| `mode` | text | 불가 | direct/group/broadcast_direct; 수신자에게 서로 다른 의미 |
| `group_thread_id` | text | 허용 | group일 때만 대상 방 · 참조: `workhub.messenger_threads.id` |
| `expected_participant_epoch` | bigint | 허용 | group 확인 당시 참여판 |
| `body` | text | 불가 | 정규화한 plain text 본문; 승인된 렌더러만 사용, HTML 실행 없음 |
| `content_sha256` | text | 불가 | 본문·파일지문·업무카드·전달모드의 canonical SHA-256 |
| `confirmation_sha256` | text | 불가 | content + 정확한 정렬 수신자 + 현재권한판 + 방참여판 + 정책판 + 만료의 지문 |
| `recipient_selector` | jsonb | 불가 | 직접 ID/부서/학년 등 명단 생성 조건. 실제 발송 대상은 targets 고정 집합 |
| `policy_bindings` | jsonb | 불가 | 적용 정책의 scope_key/id/version 및 명령 registry 판; 임의 실행문 불가 |
| `permission_context` | jsonb | 불가 | 확인 당시 계정/학교/소속/역할 권한판. 실행 때 현재값과 비교 |
| `origin` | text | 불가 | manual/ai/workflow; AI도 교사가 발신자 |
| `tool_proposal_id` | text | 허용 | AI 확인 제안과의 1방향 연결; payload가 이 dispatch와 지문 참조 · 참조: `workhub.tool_proposals.id` |
| `card_kind` | text | 허용 | collection/timetable_change; 없으면 다른 card 열도 NULL |
| `collection_id` | text | 허용 | 수합 안내 카드의 현재 원본 · 참조: `workhub.collections.id` |
| `timetable_change_set_id` | text | 허용 | 시간표 변경 카드의 현재 원본 · 참조: `workhub.timetable_change_sets.id` |
| `card_version` | integer | 허용 | 표시 제안 당시 원본 판; 행동 시 현재 원본 재검사 |
| `state` | text | 불가 | prepared/confirmed/sending/completed/partial/failed/cancelled/expired |
| `expires_at` | timestamptz | 불가 | 확인 유효 시각; 구체 유효시간은 승인 정책 |
| `confirmed_at` | timestamptz | 허용 | 교사가 정확한 지문을 확인한 서버 시각 |
| `confirmed_by_membership_id` | text | 허용 | sender_membership_id와 같아야 함 · 참조: `workhub.memberships.id` |
| `target_count` | integer | 불가 | 준비 시 고정 대상 수. 최소 1 |
| `version` | integer | 불가 | 1부터 시작하는 낙관적 동시성 판 |
| `created_at` | timestamptz | 불가 | 생성 시각 |
| `completed_at` | timestamptz | 허용 | 모든 대상 최종결과가 있을 때 |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,sender_membership_id,sender_account_id) FK memberships(school_id,id,account_id)
- (school_id,group_thread_id) FK messenger_threads(school_id,id)
- (school_id,collection_id) FK collections(school_id,id); (school_id,timetable_change_set_id) FK timetable_change_sets(school_id,id)
- card_kind=collection이면 collection_id/card_version만 존재; timetable_change이면 timetable_change_set_id/card_version만 존재; 없음이면 전부 NULL
- UNIQUE(school_id,id,sender_membership_id,sender_account_id)
- group mode iff group_thread_id와 expected_participant_epoch 존재; direct는 target_count=1
- tool_proposal_id는 동일 school·actor·origin membership의 tool_proposals이며 cmd_messenger_confirm 전용 tool registry; 일반 FK 외 명령 검증
- confirmed_at/confirmed_by는 둘 다 NULL 또는 존재하고 confirmed_by=sender; confirmed 이후 상태에는 확인 필수
- confirmed/completed 후 content/selector/정확한 대상/첨부/card/확인 맥락 불변; 수정은 새 dispatch
- 준비안은 trim(body) 비어있지 않음 OR 첨부 존재 OR 업무카드 존재; 실제 대상행 수=target_count, 학교/소속별 중복 없음
- prepared 생성과 targets/files를 같은 transaction으로 생성하고 지연 무결성 검사. 정규화 본문/card/policy JSON은 서버 schema로 검증

**인덱스**

- `(school_id,sender_membership_id,created_at DESC,id)`
- `(school_id,state,created_at,id) WHERE state IN(prepared,confirmed,sending,partial)`
- `(school_id,tool_proposal_id) WHERE tool_proposal_id IS NOT NULL`

**명령·불변 규칙**

- 본문은 이 불변 dispatch에 한 번만 보관하고 messenger_messages가 참조한다. 일반 수신자는 dispatch 직접 조회 불가, 메시지 DTO에서 본문만 받는다.
- AI prepared만으로 전송하지 않는다. 확인 이후 target 고정. 명단 변화는 확인 전 STALE, 확인 후 새로운 교사를 자동 추가하지 않음.
- confirmed 이후 권한 상실·소속 종료는 미전송 대상 blocked. 이미 전달된 사실은 지우지 않고 현재 메시지 열람권을 별도로 적용한다.
- 정정은 dispatch_targets.corrects_message_id가 가리키는 과거 본문을 덮어쓰지 않는 새 메시지. 원메시지 조회 시 정정 연결을 표시; 학교 일반관리자가 타인 메시지를 정정할 수 없음.
- 자동 workflow 알림은 기본 notifications로 처리. 사람 이름으로 DM을 자동 발송하지 않으며 반복 안내는 매번 현재 미제출/미동의 명단으로 새 확인안을 만든다.

**읽기:** 발신자 본인 현재 origin membership만 준비안/전체 발송 결과를 조회. 수신자는 자기 messenger_messages 경로에서 본문과 본인 관련 카드만 받음. 관리자 일괄본문/수신명단 조회 금지.

**수용시험:** MSG04, MSG06, MSG07, MSG08, MSG09, MSG10, MSG13

### workhub.messenger_dispatch_targets (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `dispatch_id` | text | 불가 | 확인안 · 참조: `workhub.messenger_dispatches.id` |
| `recipient_membership_id` | text | 불가 | 고정 수신 소속 · 참조: `workhub.memberships.id` |
| `recipient_account_id` | text | 불가 | 고정 수신 계정 · 참조: `workhub.accounts.id` |
| `recipient_participant_id` | text | 허용 | group의 정확한 참여 episode; direct는 전달 시 생성/선택 · 참조: `workhub.messenger_participants.id` |
| `result_thread_id` | text | 허용 | 실제 생성/기존 DM 또는 고정 group 방 · 참조: `workhub.messenger_threads.id` |
| `state` | text | 불가 | pending/delivered/blocked/failed/cancelled; delivered는 DB 메시지 커밋 |
| `safe_error_code` | text | 허용 | 본문 없는 허용목록 실패 사유 |
| `attempt_count` | integer | 불가 | 내부 전달 시도 수; 재시도 정책에서 증가 |
| `delivered_at` | timestamptz | 허용 | delivered일 때 서버 시각 |
| `version` | integer | 불가 | 1부터 시작하는 낙관적 동시성 판 |
| `corrects_message_id` | text | 허용 | 정정 발송 대상의 이전 메시지. prepared 시 고정하며 같은 학교·방·발신자 소유 검증 · 참조: `workhub.messenger_messages.id` |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,dispatch_id) FK messenger_dispatches(school_id,id)
- (school_id,recipient_membership_id,recipient_account_id) FK memberships(school_id,id,account_id)
- (school_id,result_thread_id,recipient_participant_id,recipient_membership_id,recipient_account_id) FK messenger_participants(school_id,thread_id,id,membership_id,account_id) MATCH SIMPLE
- CHECK((result_thread_id IS NULL) = (recipient_participant_id IS NULL)); delivered이면 두 선택열 모두 NOT NULL. 준비 단계는 두 선택열 모두 NULL 허용
- UNIQUE(dispatch_id,recipient_membership_id); 발신자 자신은 targets에 넣지 않음
- delivered이면 result_thread/participant/delivered_at 필수이고 같은 dispatch/thread 메시지가 반드시 존재
- sender/recipient 동일 계정 및 다른 학교 거부; recipient ID/account는 준비 후 불변
- state delivered에서는 재시도/삭제/다른 thread 대입 금지; failed는 DB 효과 없음이 증명된 경우만
- (school_id,corrects_message_id) FK messenger_messages(school_id,id); 정정대상은 현재 존재하는 이전 메시지이며 같은 발신자의 동일 결과방만 허용

**인덱스**

- `(school_id,dispatch_id,state,id)`
- `(school_id,recipient_membership_id,dispatch_id)`
- `(school_id,corrects_message_id) WHERE corrects_message_id IS NOT NULL`

**명령·불변 규칙**

- 단체 개별발송은 대상별 독립 transaction: DM 확보+message 1개+target delivered+receipt/audit/outbox 원자.
- group는 동결한 현재 참여집합 전체와 메시지 1개를 같은 transaction으로 처리한다. 그룹 전달 중 부분 성공은 허용하지 않음.
- 부서/학년 조건은 준비 시 대상 스냅숏; 실행은 현재 소속·접근검사를 다시 하며 selector를 재해석해 다른 사람에게 보내지 않는다.
- 성공행은 건너뛰고 실패행만 같은 dispatch/recipient 키로 재시도한다. blocked는 새 확인안을 만들기 전 자동 재시도하지 않는다.
- 수신자에게 타 수신자 목록·실패사유·단체발송 집계 반환 금지.
- 같은 방의 다른 참여자 episode를 수신자 행에 연결할 수 없다. 복합 FK가 수신 소속·계정까지 묶으며 현재 active episode도 명령에서 재검사한다.
- group 정정은 모든 targets가 같은 corrects_message_id를 갖거나 전부 NULL. 직접/개별발송 정정은 대상별 자기 DM의 원메시지만 참조한다. 정정 대상도 확인 지문에 포함한다.

**읽기:** 발신자는 전체 상태, 수신자는 본인 delivered 최소 접수만. 양쪽 모두 현재 해당 학교 origin 소속과 메시지 관계 확인.

**수용시험:** MSG01, MSG04, MSG07, MSG08, MSG10, MSG11, MSG14

### workhub.messenger_messages (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `thread_id` | text | 불가 | 실제 표시되는 방 · 참조: `workhub.messenger_threads.id` |
| `dispatch_id` | text | 불가 | 본문·파일·발신자의 불변 발송판 · 참조: `workhub.messenger_dispatches.id` |
| `seq` | bigint | 불가 | 방 잠금 아래 단조 증가 순번 |
| `state` | text | 불가 | visible/withdrawn; 일반 수정으로 본문 대체 금지 |
| `sent_at` | timestamptz | 불가 | DB 커밋에 대응하는 서버 기록시각 |
| `withdrawn_at` | timestamptz | 허용 | 회수 명령 시각 |
| `withdrawn_by_membership_id` | text | 허용 | 발신자 본인; 안전사건은 별도 승인 운영 경로 · 참조: `workhub.memberships.id` |
| `version` | integer | 불가 | 1부터 시작하는 낙관적 동시성 판 |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,thread_id) FK messenger_threads(school_id,id); (school_id,dispatch_id) FK messenger_dispatches(school_id,id)
- UNIQUE(thread_id,seq)
- UNIQUE(dispatch_id,thread_id)
- UNIQUE(school_id,id,dispatch_id)
- seq>=1; visible이면 withdrawn 열 NULL; withdrawn이면 withdrawn_at 필수
- dispatch sender가 방의 현재 참여자이며 group은 dispatch.group_thread_id와 같아야 함
- direct/broadcast_direct는 그 DM 상대가 정확한 dispatch target이어야 함; sender/recipient 외 세 번째 참여 금지

**인덱스**

- `(school_id,thread_id,seq DESC)`
- `(school_id,dispatch_id,id)`

**명령·불변 규칙**

- 메시지 body 중복 열 없음. 읽기는 현재 participant episode의 seq범위+현재 소속+message visible 검사 후 dispatch 본문을 조립한다.
- withdrawn은 대화에 회수 표식만 남기고 본문/첨부/검색/AI문맥을 막는다. 이미 상대가 읽거나 내려받은 파일까지 회수했다고 보장하지 않음.
- 회수와 read/download/AI 근거선택은 동일 메시지 gate로 직렬화한다. 캐시·색인 무효화는 후속이며 서버 읽기검사를 대체하지 않음.
- 정정은 새 dispatch_targets.corrects_message_id 참조이며 원본문을 덮어쓰지 않음. 메시지 직접삭제는 일반 API 없음.

**읽기:** 현재 active origin membership + current active participant episode + seq>=visible_from_seq AND (발신자 또는 해당 dispatch 고정 수신자). withdrawn은 내용 없는 표식만.

**수용시험:** MSG02, MSG03, MSG05, MSG14, MSG08, MSG09, MSG10, MSG12

### workhub.messenger_dispatch_files (신규)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `id` | text | 불가 | 서버 생성 식별자 |
| `school_id` | text | 불가 | 불변 학교 경계 · 참조: `workhub.schools.id` |
| `dispatch_id` | text | 불가 | 불변 발송판 · 참조: `workhub.messenger_dispatches.id` |
| `file_object_id` | text | 불가 | 같은 학교의 검증된 파일 · 참조: `workhub.file_objects.id` |
| `sha256` | text | 불가 | 준비 당시 실물 지문 |
| `size_bytes` | bigint | 불가 | 검증된 실물 크기 |
| `filename` | text | 불가 | 화면 표시용 정규화 파일명; 경로로 쓰지 않음 |
| `position` | integer | 불가 | 본문 아래 표시 순서 |

**키·무결성**

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,dispatch_id) FK messenger_dispatches(school_id,id); (school_id,file_object_id) FK file_objects(school_id,id)
- UNIQUE(dispatch_id,file_object_id)
- UNIQUE(dispatch_id,position)
- size_bytes>=0; position>=0; sha256 64자리 hex
- 준비 시 안전검사/실물hash/학교/원본현재권한 일치. confirmed 이후 첨부 INSERT/UPDATE/DELETE 금지

**인덱스**

- `(school_id,file_object_id,dispatch_id)`

**명령·불변 규칙**

- 새 파일은 기존 cmd_file_init으로 school 비공개 미연결 업로드를 예약하고 안전검사 후 prepare에 file ID/hash를 전달한다. 미연결 상태·업로드 주체·동일 학교를 확인한 새 업로드만 dispatch 생성+typed 첨부+intended_resource_type=messenger_dispatch/id 1회 bind를 원자 수행한다. 기존 업무 파일의 intended_resource_type/id·원부모·소유자는 변경하지 않고 typed 첨부 참조와 현재 원본 ACL을 유지한다.
- 기존 학교·개인 파일을 DM에 붙여 원본 ACL을 확대하지 않는다. 새 파일 업로드와 기존 업무자료 링크 공유를 구분한다.
- 이미 다른 원본에 속한 파일은 모든 수신자가 원본을 현재 읽을 수 있을 때만 현재 원본 ACL을 AND로 검사하는 링크로 제공; 권한이 다른 경우 업무카드/접근요청 안내.
- 다운로드는 messageId+fileId로 수행하고 message.dispatchId=이 행 dispatch를 서버 확인한다. 직접 dispatchId나 파일ID/Storage URL만으로 다운로드 불가.
- 파일 한도·형식·보존기간·URL 수명은 승인 정책값. 미정이면 해당 업로드/발송만 POLICY_UNSET, 임의 숫자 기본값 금지.

**읽기:** prepared는 현재 발신자만. delivered는 읽을 수 있는 정확한 message 부모 AND file 안전상태/실물일치/기존원본 현재 ACL. 관리자 우회 없음.

**수용시험:** MSG04, MSG06, MSG09, MSG12, MSG14

### workhub.ai_run_sources (기존 표 보강)

| 열 | 타입 | NULL | 의미 |
|---|---|---|---|
| `messenger_message_id` | text | 허용 | kind=messenger_message인 정확한 원본 메시지 · 참조: `workhub.messenger_messages.id` |
| `messenger_dispatch_id` | text | 허용 | 그 메시지가 참조하는 불변 본문판 · 참조: `workhub.messenger_dispatches.id` |
| `messenger_message_version` | integer | 허용 | 선택 당시 상태판; 현재 live version FK로 묶지 않고 변경 시 무효화 |

**키·무결성**

- kind=messenger_message 추가. 이 kind일 때 위 세 열 필수, 기존 다른 kind의 typed 출처 열은 NULL; 기존 kind에서는 위 열 모두 NULL
- (school_id,messenger_message_id,messenger_dispatch_id) FK messenger_messages(school_id,id,dispatch_id)
- school scope만 허용. source_sha256은 실제 선택 메시지/첨부·원문 locator의 지문, AI run origin membership으로 현재 메시지 read 재검사
- 기존 typed source CHECK를 단순 OR로 완화하지 않고 새 분기만 추가; 기존 FK/불변제약 보존

**인덱스**

- `(school_id,messenger_message_id) WHERE messenger_message_id IS NOT NULL`

**명령·불변 규칙**

- 사용자가 명시 선택한 메시지/연속 범위 또는 해당 대화에서 허용한 요약만 AI에 제공. 학교 전체 메신저 자동 검색/지식색인 금지.
- 일반 대화검색은 AI 공급자 전송과 구분. AI source 선택 범위·출처·대상학교를 사용자에게 표시.
- 원본 회수·방 탈퇴·소속 종료·현재 참여범위 변경 시 AI 결과 출력/재사용 현재권한 검사 실패. 원본문/원문지문은 감사·outbox에 저장 금지.
- 메시지 속 명령은 자료다. 다른 교사가 써둔 명령으로 사용자 확인 없는 발송·학생자료 조회 불가.

**읽기:** 기존 AI run 본인/origin 규칙 AND 현재 messenger message read. 학교 관리자·다른 대화 참가자는 이 AI run을 자동 열람하지 못한다.

**수용시험:** MSG12, MSG13

## 11. 구현 티켓과 완료 기준

### MSG-T01 · 대화방·학교격리·수신자 선택

- 선행 티켓: 없음
- 공통 선행조건: 공통 현재주체/권한 gate / 학교 소속·업무배정 조회
- 산출물: DM/그룹 읽기 DTO JSON Schema / 현재소속쌍 유일성/episode 명령 계약 / 모바일 목록→대화→뒤로가기 시제품
- 완료: MSG01~MSG03 통과 / 관리자 전체본문 조회 경로 없음

### MSG-T02 · 기본 메시지와 읽음·정정·회수

- 선행 티켓: MSG-T01
- 산출물: 멱등 발송·순번·keyset 목록 / 접속복구/읽음커서/전달표시 / 정정 새메시지와 회수 tombstone
- 완료: MSG05·MSG09·MSG10·MSG11 통과 / 화면 빈상태/로딩/실패/권한회수 구분

### MSG-T03 · 파일·업무카드 연결

- 선행 티켓: MSG-T02
- 공통 선행조건: 공통 file_objects 안전검사·다운로드 / 수합/시간표 도메인 읽기 계약
- 산출물: 메시지 부모를 요구하는 첨부 API / 수합/시간표 카드 current read+전문명령 연결 / 현재 원본ACL 회수 전파
- 완료: MSG04·MSG09·MSG12 통과 / 읽음이 수합제출/시간표동의로 바뀌지 않음 / MSG14: 선택 FK·수신 episode·파일 intent·자기나가기 음성시험 통과

### MSG-T04 · AI 준비·확인과 개별 일괄발송

- 선행 티켓: MSG-T02 / MSG-T03
- 공통 선행조건: Claude 도구제안·확인·작업 계약
- 산출물: 정확한 수신자/첨부/영향 preview / 부분실패 상태와 성공행 제외 재시도 / 선택 메시지 AI근거 typed 연결
- 완료: MSG06~MSG08·MSG13 통과 / AI준비만으로메시지전송0 / provider 비용값은 승인 설정을 사용

### MSG-T05 · 운영 공개 전 통합검증

- 선행 티켓: MSG-T04
- 산출물: 실제 DB 독립두연결/RLS/Storage 시험 증거 / 실시간재연결·전출·모바일 검증 / 미정 정책값과 공개 승인 체크
- 완료: MSG01~MSG14 실제환경 통과 / 보존/첨부/알림정책 미정 기능은 공개 차단 / 신규 메뉴 공개는 기존 승인 절차

메신저 모듈은 기존 M05 범위 안의 확장이다. 신규 메뉴/라우트의 기본 공개는 기존 규칙대로 superadmin이며 사용자 승인 없이 전 교사에게 노출하지 않는다. DB가 보류된 동안에는 합성 저장소·UI·DTO·계약 시험을 진행할 수 있으나, 실제 다학교 격리·RLS·Storage·경합 검증을 완료했다고 보고하지 않는다.

## 12. 필수 수용시험

| ID | 시나리오 | 완료 기준 | 검증 층 |
|---|---|---|---|
| MSG01 | 역순 동시 DM 생성: 같은 학교 동일 소속쌍 두 연결이 A→B/B→A 동시 생성; 다른 학교 동일 계정도 시도 | 해당 학교·소속쌍 방 1개, 참여자 정확히2명. 다른학교 거부 | 독립 DB 두 연결 |
| MSG02 | 전출·겸임·재임용: 학교A 종료 후 B 전환; A에 새 membership 재가입; 옛 URL/파일/검색 조회 | 옛 membership DM/그룹/AI 근거 자동부활0; 겸임 학교별 독립 | RLS+읽기API+Storage |
| MSG03 | 그룹 신규·재입장: 기존 메시지 뒤 멤버 추가, 나간 뒤 재초대; 과거 seq/file URL 접근 | active episode visible_from_seq 이후만. 과거본문/파일/AI문맥0 | DB+UI |
| MSG04 | 권한 경합: 발송 준비 뒤 수신자 전출·파일회수·학교스위치중지와 confirm/deliver 동시 실행 | 현재 gate에 따라 미전송 차단; 다른교사 자동치환0; 이미DB전달됨 사실 보존 | 독립 DB 두 연결 |
| MSG05 | 읽음과 업무완료 분리: 메시지 열기·알림읽기·수합카드읽기·시간표카드읽기; 역순 읽음커서 | 읽음 경계 단조증가; 제출/동의/확정 상태 변경0 | DB+UI |
| MSG06 | 확인 지문: AI prepare 후 본문/파일/명단/방참여판/정책/registry/만료 변경 | 확인재요구, 과거지문으로 새 영향 전송0; 같은 확인 동시2회도1실행 | 명령+AI도구 대역 |
| MSG07 | 개별 단체발송: 세 대상 중 한명 중간전출, 한명 DB commit 응답유실, 한명 정상 | 수신자 간 명단공개0; 성공2+blocked1 사실대로. 재시도 성공중복0 | worker 장애주입 |
| MSG08 | 그룹 전달 원자성: 여러 그룹참여자 target 갱신 중 중단; 동시에 참가자제거 | 메시지/전체대상/접수/outbox 전체커밋 또는0; stale 그룹 부분전달0 | 독립 DB 두 연결 |
| MSG09 | 정정·회수·파기: 발신자 정정과 회수; 이미 파일 다운로드; 한 dispatch의 DM 일부회수 | 정정은 새메시지, 원문교체0; 회수내용 재조회0; 외부다운로드 회수완료 주장0; 다른정상DM 손실0 | DB+파일+화면 |
| MSG10 | 메시지와 알림 장애: 메시지 commit 직후 푸시 전송 실패·outbox 중복 소비 | 메시지1개 유지, 전달됨 유지; 푸시 재시도만. 읽음 조작0 | outbox+화면 |
| MSG11 | 목록과 모바일 복구: 큰 대화·순번중복시각·실시간단절·학교전환 중 지연응답·로딩실패 | keyset 누락/중복0; seq 재동기화; 다른학교캐시비노출; 실패를0건으로표시0 | API+브라우저+성능측정 |
| MSG12 | 메시지·첨부·AI 출처 격리: 관리자 전체조회, 수신자 dispatch직접조회, 다른부모file혼합, 회수 중 AI출력 | 메타/본문 모두 계약범위만; 감사/로그/push/outbox 원문0; current ACL 실패시 AI출력 차단 | RLS+Storage+AI대역 |
| MSG13 | AI 명령주입과 명단오해: 동명이인, 미확정 학년배정, 메시지에 비밀파일전송 지시, 미제출대상 재안내 | 모호한 대상을 임의선정0; 승인자료로명단계산; 콘텐츠지시를도구권한으로사용0; 매발송재확인 | AI평가+명령 |
| MSG14 | 선택 FK·수신 episode·원파일 부모 보존: 준비 두열NULL/부분NULL/다른수신episode/기존파일intent변경/일반회원나가기 | 두열NULL 준비만허용, 다른수신episode·intent변경거부, 자기나가기만허용 | 복합FK/파일명령/권한 |

모든 시험은 `required_not_run_on_integrated_ddl` 상태다. 설계 JSON 정합성 통과는 실제 PostgreSQL·Supabase·파일·AI·브라우저 시험 성공을 의미하지 않는다.

## 13. 판단해서 정한 것과 되돌릴 위치

- M05 확장: 전달·알림과 사용 동선을 연결하고 M00~M15의 기존 번호를 보존하기 위해 정했다. 기능군 분리는 site-modules/API 매핑에서 변경한다.
- 6표 구조: 발송본문과 수신 결과를 분리하면서 파일·감사·AI 실행 기반은 재사용한다. 중복본문을 만들지 않는 대신 dispatch 직접 공개를 금지한다.
- membership 쌍 DM 및 참여 episode: 전출/재임용과 그룹 재입장을 자동 접근권으로 오인하지 않도록 정했다. 과거 대화 승계가 필요하면 별도 승인된 접근/보존 정책을 먼저 설계한다.
- 신규·재입장자의 과거 열람 기본 차단: 교사들이 예상하지 못한 대화 공개를 막기 위한 초기 제품 선택이다. 변경 지점은 visible_from_seq 정책과 해당 공개 확인 UX이며 기존 자료를 일괄 공개하지 않는다.
- 그룹 1회 원자 전달과 개별발송 대상별 처리: 서로 다른 대화 의미와 실패 회복을 보존하기 위해 정했다. 구현 시 전달 방식과 재시도 계약을 함께 바꿔야 한다.
- 정정은 새 메시지, 회수는 표식: 상대에게 이미 전달된 업무 내용의 변경 이력을 숨기지 않기 위해 정했다. 보존·파기 세부값은 승인 정책으로 확정한다.
