# 시간표 확정·공유·교환 API 인계

작성: 2026-10-16. **구현한 것은 앱 계약·어댑터·화면·합성 서버 시험이다. 이 문서는 SQL 확정본이나 실제 DB 적용 완료 기록이 아니다.** SQL은 Claude가 작성하고 사용자가 검토 후 적용한다. 기존 `timetable.v1`의 readiness/get/save_draft 3개 RPC는 변경하지 않는다.

현재 운영 기능은 저장한 초안의 기간별 확정·학교 계정 안에서 조회, 날짜별 수업 이동·두 수업 교환, 본인 동의를 포함한 요청 제출, 관련 교사 동의·거절, 요청 철회, 담당자의 최종 승인·반려다. 대강·휴강·보강·다자 교환·외부 공개 링크는 이번 API에서 지원하지 않는다. 기존 `operations-domain.ts`의 검증 모델은 서버 구현 참고이며 일반 교사에게 그 전체 학생·자원 스냅샷을 반환하지 않는다.

## 1. 기준 파일과 공통 응답

- `apps/workhub/src/timetable/operations-contracts.ts`: 모든 DTO와 명령의 정확한 필드.
- `apps/workhub/src/timetable/operations-server.ts`: 입력/응답 parser, 상태·참조·시수 관련 경계 검사, RPC 인자.
- `apps/workhub/src/timetable/operations-api-limits.json`: 범위·목록 한도.
- `tests/test_workhub_timetable_service.mjs`: 바로 실행할 앱 대조용 합성 자료와 정상/오류 회귀.

계약 이름은 `timetable-operations.v1`. 성공 envelope의 필드는 아래 네 개만 허용한다.

```json
{"contract":"timetable-operations.v1","schoolId":"s1","memberId":"m1","data":{}}
```

실패는 `data` 대신 `error:{"code":"CONFLICT"}`를 넣는다. 허용 코드는 공통 `scoped-rpc.ts`의 `ServiceCode` 목록을 따른다. 서버 응답 형식 문제는 `INVALID_RESPONSE`, 로컬 명령 형식 오류는 `INVALID_INPUT`, 기준판 변경은 `CONFLICT`, 같은 요청 번호의 본문 변경은 `IDEMPOTENCY_CONFLICT`로 구분한다. 응답이 끊긴 쓰기는 실패가 증명된 것이 아니므로 앱에서 `RESULT_UNKNOWN`으로 보관한다.

모든 ID와 참조는 `^[A-Za-z0-9_-]{1,100}$`; 표시는 별도 한국어 `name`/`label`/`reason`이다. 지문은 소문자 SHA-256 64자리. 날짜는 `YYYY-MM-DD`다. 수업 `time`·`allowedTargets`·이동 `target`의 startsAt/endsAt은 정수 초인 `YYYY-MM-DDTHH:mm:ss.000Z`로 고정한다. 밀리초를 반올림하거나 버려 받지 않는다. 조회·접수·생성·만료·동의 등 메타 시각은 `YYYY-MM-DDTHH:mm:ss.sssZ`의 정확한 UTC 형식을 유지한다. 날짜 구간과 시각 구간은 모두 `[from, until)` / `[startsAt, endsAt)`이다. 학교의 실제 날짜는 `timeZone`으로 계산한다.

### 교사 ID의 기준 (K-4)

운영 계약의 `OperationLesson.teachers[].id`, 참여자 `participants[].id`, 요청자·동의자 교사 ID는 모두 **현재 학교의 소속(member) ID**다. 인증 계정 ID(`auth.users.id`), 인사 정보 ID, 교사 이름으로 대신하지 않는다. 동일 계정이 여러 학교에 소속되어 있다면 각 학교의 소속 ID를 사용한다. 편성 자원에서 별도 교사 자원 ID를 사용하는 경우 서버가 공식 관계로 해당 학교 소속에 연결하며, 이름으로 추정하지 않는다. 학급·공간 자원 ID까지 소속 ID라는 뜻은 아니다.

자기 승인 차단은 이 ID 약속만으로 대체하지 않는다. 아래의 `requesterIsViewer`는 기존과 같이 실제 계정의 동일성까지 서버가 확인한다.

## 2. RPC 이름·인자·응답

| RPC | 정확한 인자 | data |
|---|---|---|
| `workhub_timetable_operations_readiness` | `p_member_id` | `{available:true}` 또는 `{available:false,reason:'not_installed'|'not_allowed'|'basis_missing'}` |
| `workhub_timetable_operations_get` | `p_member_id,p_from,p_until` | `OperationsView` |
| `workhub_timetable_operations_publish_preview` | `p_member_id,p_input` = `PublishInput` | `PublishPreview` |
| `workhub_timetable_operations_exchange_preview` | `p_member_id,p_input` = `ExchangeInput` | `ExchangePreview` |
| `workhub_timetable_operations_execute` | `p_member_id,p_command,p_request_key,p_recover_only` | `OperationReceipt` |

`get`은 최대 31일, 공개 입력은 최대 366일이다. 31일 조회에서 선택한 초안을 더 긴 기간으로 공개할 수 있지만, 공개 미리보기는 **공개 기간 전체**를 다시 검사해야 한다. 미리보기는 최대 12,000개 변경 행과 15분 유효기간을 사용한다. 이를 넘으면 누락한 목록을 성공으로 반환하지 말고 범위 축소를 안내한다. 목록 최대값은 자산 파일을 기준으로 구현한다.

readiness가 미설치이면 앱은 준비 중으로 표시한다. 일반 교사 공개 범위를 넓히거나 인증 로직을 변경하는 요청이 아니다. 기존 `superadmin` 공개 제한을 유지한다.

## 3. 읽기 DTO와 최소 공개

`OperationsView`는 `asOf,timeZone,from,until,canPublish,canRequest,drafts,lessons,requests,publications`만 포함한다.

- `drafts`: `{id,version,title}`. 확정 권한이 없는 교사에게는 빈 배열.
- `lessons`: `OperationLesson` 배열. 현재 계정의 학교 소속·수업 관계와 학교의 조회 권한으로 제한한다. 전체 학생 자원·상담 기록·결근 상세 사유·다른 계정 식별자는 포함하지 않는다.
- `OperationLesson`: `id,version,label,time,teachers,groupNames,roomNames,state,canRequest,allowedTargets`. `teachers`는 `{id,name}` 배열이다. `allowedTargets`는 해당 수업이 옮겨 갈 수 있는 **공식 일과의 완전한 시각 구간**만 반환한다. 단순 빈 교시를 추정하지 않는다.
- `publications`: `{id,version,title,from,until,publishedAt}`. 조회 구간과 겹치는 확정판 요약이다. 조회와 공유는 로그인한 학교 계정 안에서만 한다.
- `requests`: 요청자·참여자·현재 승인 담당자처럼 열람 관계가 확인된 요청만 반환한다. `actions`는 현재 계정에 허용된 정확한 동작 목록이다.

`requesterIsViewer`는 **소속 ID가 아니라 같은 실제 계정인지** 서버에서 판단한다. 다른 소속 ID를 가진 같은 계정도 자기 요청을 승인할 수 없다. 앱은 자기 소속 ID와 동일한 요청자의 false 표기, 자기 요청의 approve 권한, 전원 동의 전 승인 권한을 거절하지만 이 검사가 서버 권한 검사를 대신하지 않는다.

## 4. 공개 미리보기와 확정

`PublishInput`:

```json
{"draftId":"d1","draftVersion":1,"from":"2026-10-19","until":"2026-12-01"}
```

`PublishPreview`의 정확한 필드:

- `previewId,previewHash,createdAt,expiresAt,input,complete:true`.
- `changes:[{before:OperationLesson|null,after:OperationLesson}]`.
- `participants:[{id,name}]`: before/after에 등장하는 모든 교사의 합집합과 정확히 일치.
- `blockers:[{code,message,lessonIds}]`: 확정을 막는 사항. 클라이언트가 알 수 없는 다른 학생·수업의 식별자를 유출하지 않고 현재 변경 대상 ID만 사용한다.
- `preserved:{outsideRange:true,pastRecords:true,existingChanges:'retained'|'blocked'}`.
- `excludedDays:[{date,reason}]`: 공개 기간 안의 휴업·미편성 날짜를 설명한다. 이 날짜에 정상 새 수업이 함께 생성되는 응답은 앱이 거절한다.

신규 날짜별 수업은 before=null, after.version=1. 기존 수업 변경은 동일한 영구 ID를 보존하고 version을 정확히 1 올린다. 수업 삭제 대신 취소 상태로 이력을 보존한다. 이미 실시한 수업 변경, 적용 기간 밖 수정, 과거 시각 변경을 허용하지 않는다. 교사·학급·학생 기록이 참조하는 날짜별 수업 ID를 엔진 활동 ID로 대체하지 않는다.

전체 효과를 조회한 뒤 `complete:true`를 반환해야 한다. 페이지 한 쪽만 읽거나 권한 때문에 일부 효과를 누락하고 complete라고 쓰면 안 된다. 전체 목록이 한도를 넘으면 blocker 또는 오류로 중단한다. `changes=[]`는 blocker가 있을 때만 반환한다. blocker가 하나라도 있거나 existingChanges=blocked이면 앱에서 확정할 수 없다.

공개 명령:

```json
{"kind":"publish","preview":{"previewId":"pp1","previewHash":"...64 hex...","expiresAt":"2026-10-16T00:05:00.000Z","input":{"draftId":"d1","draftVersion":1,"from":"2026-10-19","until":"2026-12-01"}}}
```

서버는 미리보기 ID·학교·계정·권한·초안 판·입력 원문·기간·미리보기 지문·유효기간을 묶어 보관한다. `previewHash`는 호출자가 주장하는 신뢰 값이 아니다. 실제 초안, 일과, 휴업일, 기존 확정판, 미래 교환, 개인 실시 기록을 포함한 서버 기준판을 해시 구성에 포함하고 commit 직전에 동일한지를 확인한다. 미리보기에서 신규 수업 ID를 예약한다면 그 ID도 고정하여 commit 수신증의 전체 ID/판과 일치시킨다.

기간 중간을 새 버전으로 교체할 때 이전 버전의 앞뒤 구간을 보존한다. 이미 승인된 미래 교환을 조용히 덮어쓰지 않는다. 조정된 결과를 다시 확인할 수 없으면 blocker로 돌려 새 미리보기를 요구한다.

## 5. 이동·교환 요청

이동 입력:

```json
{"kind":"move","lessonId":"l1","expectedVersion":1,"target":{"startsAt":"2026-10-19T02:00:00.000Z","endsAt":"2026-10-19T02:45:00.000Z"},"reason":"학교 일정 조정"}
```

교환 입력:

```json
{"kind":"swap","lessonId":"l1","expectedVersion":1,"otherLessonId":"l2","otherExpectedVersion":1,"reason":"학교 일정 조정"}
```

reason은 참여자에게 공유하는 짧은 설명이다. 개인 복무·상담 상세를 요구하거나 자동으로 붙이지 않는다. 대상 수업 둘의 수업 길이가 같고 원래 시간이 다를 때만 2자 swap을 만든다. move/swap 모두 교사·학생 집단·공간·수업 제목·활동 정체성을 바꾸지 않는다. 날짜와 시각만 이동한다.

`ExchangePreview`는 공개 미리보기의 공통 필드와 changes/participants/blockers를 갖고 preserved/excludedDays는 갖지 않는다. move는 정확히 1행, swap은 정확히 2행이어야 한다. 모든 before는 사용자가 확인한 원본 전체와 일치한다. after는 version+1, 정확한 목적 시각, 나머지 메타데이터 동일이다. swap의 목적 시각 집합은 선택한 두 원래 시각 집합과 동일하다. 참여자는 변경 전후 교사 합집합과 정확히 같아야 한다.

원래 수업과 목적 수업 시간이 시작되지 않았고 수업 관계·학교·미실시 상태·공식 허용 시각이 맞는지 확인한다. 중간 점유, 다른 일과의 실제 시각, 학생 수강 중첩, 공간 수용량, 부재, 휴업일은 **서버의 완전한 자원 조회**로 검사한다. 일반 교사 화면에 없는 자원이 있다고 검사를 생략하지 않는다.

제출 명령은 공개 명령과 같은 preview 참조 구조에 `kind:'submit'`을 쓴다. 최종 제출 확인은 요청자의 본인 동의를 포함하며, 동일 proposalHash에 본인 동의 행을 원자적으로 기록한다. 다른 교사의 동의가 필요하면 `awaiting_consent`, 본인만 참여하면 `awaiting_approval`이다. 이 시점에는 실제 시간표를 바꾸지 않는다.

## 6. 동의·승인 상태와 명령

`ExchangeRequestView`의 정확한 필드는 타입 파일을 따른다. `participants`는 `{id,name,response:'pending'|'accepted'|'rejected',respondedAt:null|timestamp}`다. 동의는 해당 요청의 정확한 proposalHash·기준판에 귀속되어야 한다. 현재 계약은 수락한 동의를 임의로 번복하는 별도 동작을 제공하지 않는다. 변경안이 달라지면 새로운 확인과 동의가 필요하다.

```json
{"kind":"action","requestId":"r1","expectedVersion":3,"proposalHash":"...64 hex...","action":"approve"}
```

| action | 사전 조건 | 결과 상태 | 실제 수업 변경 |
|---|---|---|---|
| accept | awaiting_consent의 본인 pending 참여 | 다른 pending이 있으면 awaiting_consent, 없으면 awaiting_approval | 없음 |
| reject | awaiting_consent의 본인 pending 참여 | rejected | 없음 |
| withdraw | 진행 중인 요청의 요청자 실제 계정 | withdrawn | 없음 |
| approve | awaiting_approval, 전원 accepted, 현재 승인자, 요청자와 다른 계정 | applied | 전부 원자 반영 |
| rejectApproval | awaiting_approval, 현재 승인자, 요청자와 다른 계정 | rejected | 없음 |

모든 동작은 요청 판을 정확히 1 올린다. 만료·기준판 변경은 expired/stale로 닫거나 CONFLICT로 새 조회를 요구하며, 이전 동의로 바뀐 요청을 승인하지 않는다. 승인 직전에 원래/목적 수업이 이미 시작했다면 중단한다. 역할 변경·참여자 비활성·부재·다른 요청의 선행 반영도 최신 잠금 안에서 재검사한다.

## 7. 쓰기 원장·복구·동시성

모든 쓰기는 `workhub_timetable_operations_execute` 하나로 수행하고, 명령 종류는 엄격한 분기 계약으로 제한한다. 임의 SQL 도구나 DB 표 이름을 명령으로 받지 않는다.

1. 인증 계정과 학교 소속을 확인한다. `p_member_id`만 신뢰하지 않는다.
2. `(school_id, actor_account_id, request_key)`에 대한 같은 잠금을 잡는다. 진행 중 요청과 완료 원장을 동일한 직렬화 범위에서 확인한다.
3. 같은 key의 원장이 있으면 원래 commandHash와 정확한 본문이 같은지 비교한다. 다르면 IDEMPOTENCY_CONFLICT. 같으면 기록된 수신증을 그대로 반환한다. 현재 초안/미리보기 유효기간 검사보다 **원장 확인이 먼저**다.
4. `p_recover_only:true`이면 신규 실행·재실행·미리보기 재작성·새 원장 생성을 하지 않는다. 진행 중 작업이 없는지 잠금 안에서 확인하고, 완료 원장도 없을 때만 NOT_FOUND를 반환한다. 잠금 대기 실패·중단·서버 오류를 NOT_FOUND로 포장하지 않는다. 진행 중이면 기다리거나 RESULT_UNKNOWN을 반환한다.
5. 신규 쓰기에서 권한·미리보기·판·동의·시간·충돌을 최신 DB 자료로 재검증한다. 관련 수업/자원/기간을 일관된 순서로 잠그고, 잠금 뒤 최신 상태를 다시 읽는다. 분리된 teacher/class 표만 각각 갱신하는 부분 반영은 금지한다.
6. 모든 변경과 감사 이력·요청 상태·동의 원장·알림 outbox·정확한 수신증을 같은 트랜잭션으로 저장한다. 전체 성공하거나 전체 취소한다. 알림 발송 실패는 확정 상태를 되돌리거나 수업을 다시 변경하는 이유가 아니다.

`recover`는 미리보기 만료·현재 snapshot 없음·최신 초안 판 변경이 있어도 원래 명령 그대로 결과만 읽을 수 있다. 단, 현재 계정/학교 접근 권한은 확인한다. 권한이 사라졌다고 다른 사람에게 원장 내용을 보여주지 않는다. 앱은 읽기 실패만으로 원래 쓰기가 없었다고 단정하거나 기존 요청 번호를 버리지 않는다.

## 8. commandHash의 정확한 직렬화

`commandHash = lower_hex(SHA256(UTF8(canonical(command))))`. key와 school/member는 해시 본문 밖의 원장 범위에 묶이고, command는 type 파일의 정확한 명령 전체다. `canonical`은 `scoped-rpc.ts`와 동일하다.

- 객체 키를 코드 단위 오름차순으로 정렬한다(현재 계약의 키는 ASCII).
- 객체는 `{` + 각 `JSON.stringify(key) + ':' + canonical(value)`를 쉼표로 연결 + `}`.
- 배열은 원래 순서를 유지하고 각 항목을 쉼표로 연결한다.
- 문자열/숫자/불리언/null은 JavaScript `JSON.stringify`의 JSON 표현을 사용한다. 명령의 숫자는 안전한 정수이며 undefined/NaN/Infinity는 입력 계약에서 거부한다.
- 부가 공백·들여쓰기·개행은 넣지 않는다. 한국어는 UTF-8 원문을 사용한다.

PostgreSQL `jsonb::text`는 공백·키 직렬화 방식이 달라 그대로 해시하면 안 된다. JSON 문자열 내부 공백까지 지우는 정규식 치환도 금지한다. SQL 구현은 이 명령 계약에 대한 정규 직렬화 함수를 만들고 JS `operationCommandHash`와 한국어·공백·따옴표·역슬래시·중첩 객체·move/swap/action 골든 벡터를 대조한다. 해시는 인증 서명이 아니므로 서버 권한·원장 검사를 대신하지 않는다.

## 9. 정확한 수신증

```json
{"requestKey":"original-key","commandHash":"...64 hex...","kind":"action","entityId":"r1","version":4,"status":"applied","recordedAt":"2026-10-16T00:03:00.000Z","changedLessons":[{"id":"l1","version":2},{"id":"l2","version":2}]}
```

recordedAt은 **명령 기록 시각**이다. 동의 기록과 수업 반영을 같은 의미로 설명하지 않는다. publish/submit의 entity version은 1, action의 request version은 expectedVersion+1. action의 entityId는 원래 requestId와 같아야 한다. kind/key/commandHash/status 모두 원래 명령과 맞아야 한다.

공개·최종 승인만 changedLessons가 비어 있지 않으며, 미리보기의 after ID/판 전체와 정확히 일치한다. 제출·동의·거절·철회·반려는 빈 배열이다. 일부 행만 성공한 수신증은 허용하지 않는다. 재진입 복구에서는 앱에 이전 전체 미리보기가 없을 수 있으므로 서버의 원장에 완전한 결과를 고정하고 반환해야 한다.

## 10. Claude SQL 검증 요청

- 앱 합성 fixture를 실제 SQL 결과로 대체하여 `parseOperationsView`, 각 preview parser, `parseOperationReceipt`를 그대로 통과시키기.
- 기간 중간 공개의 앞뒤 기간 보존, 과거 실시·학생 기록 불변, 휴업일 제외, 기존 미래 변경 처리.
- preview 생성 후 원본 수정, 시간 경과, 역할 변경, 참여자 변경, 동의 이후 다른 교환과 경합하는 실제 2세션 시험.
- 같은 key 동시 전송/응답 유실/서버 재시작/원장만 복구, recover-only와 신규 쓰기 경합에서 허위 NOT_FOUND 없음.
- 이동·교환에서 학생 집단·실제 일과 시각·공간 용량을 포함한 전체 충돌 재검사.
- requesterIsViewer의 같은 계정 다른 소속, 자기 승인 우회, 타 학교·비승인 계정·숨겨진 요청 거부.
- 권한 없는 일반 교사 DTO에 전체 자원·학생 ID·개인 복무 사유가 나오지 않음.
- 모든 조회/명령의 기존 R0/R1/R1S 및 기존 로그인·회원 자료 보존.

앱 자동 시험 통과는 실제 PostgREST·DB 잠금·권한·Storage·알림 발송 성공을 의미하지 않는다. 이 API에는 파일/Storage 변경이 없고, 실제 DB 적용 및 실사용 확인은 별도 단계다.
