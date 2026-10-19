# 수업 실제 실시 기록 — 앱 계약 및 Claude SQL 요청

2026-10-19. `timetable.execution-records.v1`. 앱 구현 및 합성 시험 기준 계약이며 확정 SQL이나 운영 설치 완료를 뜻하지 않는다. 기존 T1/T2 계약을 수정하지 않는 증분 모듈을 요청한다.

## 범위와 불변 규칙

- 시간표의 예정 수업과 교사가 확인한 실시 결과를 분리한다. 종료 시각이 지났다고 자동 완료하지 않는다.
- 결과는 `completed`(실시 완료), `not_performed`(미실시), `needs_review`(확인 필요) 세 가지. 원장이 없으면 **아직 확인하지 않음**으로 표시한다.
- 명시 확인한 수업 ID/시간표 판과 별도 실시 원장 ID/판을 고정한다. 실제 시작·종료 시각을 추정해 만들지 않는다.
- 예정 수업·교환·담당 교사·학생 명부 권한·실제 시수 합계를 이 명령으로 자동 변경하지 않는다. 대강 담당의 자동 승격, 보강 수업 생성은 미지원이다.
- 최초 기록도 수업 종료 이후만 허용한다. 과거 자료의 기록 기한과 수정 권한은 기존 학교·학기 정책 및 SQL의 현재 권한 판정이 최종 기준이다. 앱은 서버가 반환한 `allowedOutcomes` 밖의 결과를 보내지 않는다.
- 실시 기록은 수업을 다르게 편성하거나 삭제할 수 있는 근거가 아니다. T2 재확정·학사 변경 SQL은 이 원장이 존재하는 수업을 잠금/보호 대상으로 함께 검토해야 한다. 시간표 변경 후 원장을 새로운 판에 자동 이관하지 않는다.
- 모든 쓰기는 원장 접수증을 먼저 조회하여 동일 번호·동일 명령이면 원결과를 반환한다. 원장 없음일 때만 현재 모듈·권한·판·수업 종료 여부를 판단한다.

## 공통 envelope와 권한

기존 `createScopedRpc` 사용. 인자에 `p_member_id`가 추가된다. 성공 응답은 다음 네 필드만 허용한다.

```json
{"contract":"timetable.execution-records.v1","schoolId":"school","memberId":"member","data":{}}
```

실패 응답은 `data` 대신 `error:{"code":"CONFLICT"}`. 기존 ServiceCode 사용: `NOT_READY`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`. 새 오류 코드 없음. 인증/소속 확인과 자료 범위는 SQL에서 다시 확인하며, 오류 응답에 다른 학교·학생·개인 사유를 넣지 않는다.

첫 설치는 비활성. 서버가 NOT_READY를 반환하거나 어댑터까지 정확한 PostgREST PGRST202가 전달되면 접이식 기록 영역에 준비 중 안내를 표시한다. 공통 연결이 QUERY_FAILED로 정규화한 경우에는 설치 누락으로 단정하지 않고 조회 오류로 남긴다. 어느 경우든 기존 시간표 기능을 가리지 않는다.

## 자료 형식

`execution-records-policy.json`의 한도: 메모 1,000 유니코드 코드 포인트, 정정사유 500, 표시 이름 200, 동시 담당 ID 100개, 이력 페이지 20개. 시간표/기록 판은 1..2,147,483,647, 미기록의 기대 판만 0. 판 overflow는 새 기록 거절. 시각은 `YYYY-MM-DDTHH:mm:ss.SSSZ`, 수업 시각의 소수초는 `.000Z`, 기록시각의 밀리초는 보존. 수업 길이는 기존 운영 계약과 같이 1초 이상 4시간 이하.

수업 DTO에는 학생·개인 사유를 넣지 않는다.

```json
{"id":"lesson","version":1,"label":"국어 1반","startsAt":"2026-10-19T00:00:00.000Z","endsAt":"2026-10-19T00:45:00.000Z","state":"scheduled","teacherIds":["member"]}
```

`state`는 기존 `scheduled|performed|cancelled` 표시 상태. 이 UI는 서버의 기존 상태를 읽지만 자체 쓰기로 state를 바꾸지 않는다. 교사 ID는 기존 시간표 계약대로 소속 member ID.

실시 기록 DTO:

```json
{"id":"record","version":1,"lessonId":"lesson","lessonVersion":1,"outcome":"completed","note":"직접 확인","correctionReason":null,"recordedBy":{"id":"member","name":"담당 교사"},"recordedAt":"2026-10-19T09:00:00.000Z"}
```

- 한 수업의 원장 ID는 정정해도 같다. 각 판의 이력은 불변이다.
- 초판의 correctionReason은 null, 2판 이후는 공백 아닌 정정 사유가 필수.
- 미실시/확인 필요는 공백 아닌 note가 필수. 완료 메모는 빈 문자열 허용.
- recordedBy는 실제 기록 요청 member, 날짜·이름은 서버가 채운다. 앱이 직접 보내지 않는다.
- 예전 판 이력의 lessonVersion과 recordedAt은 최신으로 덮어쓰지 않는다.

## 1. `workhub_timetable_execution_get`

인자: `{p_member_id, p_lesson_id}`.

반환 data exact:

```json
{"asOf":"2026-10-19T09:00:00.000Z","timeZone":"Asia/Seoul","lesson":{"id":"lesson","version":1,"label":"국어 1반","startsAt":"2026-10-19T00:00:00.000Z","endsAt":"2026-10-19T00:45:00.000Z","state":"scheduled","teacherIds":["member"]},"allowedOutcomes":["completed","not_performed","needs_review"],"current":null,"history":[],"nextCursor":null}
```

- allowedOutcomes 빈 배열은 조회만 가능. 교사·담당자 이름이나 화면 role로 쓰기 권한을 추정하지 않는다.
- 끝나지 않은 수업에는 allowedOutcomes가 반드시 빈 배열이다.
- current는 현재 원장 또는 null. history는 최신 판부터 내림차순, **현재 판을 포함하여** 최대 20개. current와 history[0]은 완전히 같아야 한다.
- history의 판은 빠짐없이 연속, 원장 ID는 동일. 기록시각과 수업 판은 내림차순에서 증가하지 않는다.
- 원장 21판이면 첫 페이지 21..2, nextCursor nonnull. 원장 20판이면 20..1, nextCursor null. 미기록은 빈 이력과 null cursor.
- 서버의 선택 수업과 판이 공유 화면보다 최신이면 표시하고, 원장 입력은 새로 조회한 수업 판에 고정한다. 다른 학교 수업은 거부한다.

## 2. `workhub_timetable_execution_history`

인자: `{p_member_id, p_lesson_id, p_anchor_version, p_cursor, p_page_size:20}`.

응답:

```json
{"lessonId":"lesson","anchorRecordVersion":21,"history":[{"id":"record","version":1,"lessonId":"lesson","lessonVersion":1,"outcome":"completed","note":"직접 확인","correctionReason":null,"recordedBy":{"id":"member","name":"담당 교사"},"recordedAt":"2026-10-19T09:00:00.000Z"}],"nextCursor":null}
```

서버 cursor는 학교·member·수업·원장 ID·anchor 판·다음 판과 묶는다. `[A-Za-z0-9_-]{1,200}`의 opaque 문자열. 클라이언트 숫자 offset을 신뢰하지 않는다. 새 정정이 생겨도 처음 get에서 읽은 anchor 이하의 불변 이력을 이어 읽는다. 조회 사이 권한 취소는 거부한다. 페이지 크기는 20 고정이고 마지막 페이지를 제외하고 정확히 20개다.

앱도 받은 cursor와 같은 범위/세대만 허용한다. 새 get을 수행하면 이전 cursor는 앱에서 무효화된다. 계속해서 같은 cursor를 반환하는 응답, 다른 원장/판/수업 또는 누락/중복 판을 거부한다.

## 3. `workhub_timetable_execution_record`

인자: `{p_member_id, p_command, p_request_key, p_recover_only}`.

초기 명령 exact:

```json
{"lessonId":"lesson","expectedLessonVersion":1,"expectedRecordVersion":0,"expectedRecordId":null,"outcome":"completed","note":"직접 확인","correctionReason":null}
```

정정은 expectedRecordVersion >=1, expectedRecordId=현재 원장 ID, correctionReason 필수. SQL은 다음을 한 트랜잭션에서 처리한다.

1. 접수 키를 학교·요청 member와 결합하고 원명령 hash를 비교. 같은 키/같은 명령의 접수증이 있으면 원결과 반환.
2. recover_only=true이고 접수증이 없으면 NOT_FOUND. 새 기록·시수·알림 등 부수 쓰기 금지.
3. 접수증 없는 새 실행은 모듈 활성화, 현재 소속과 조회/기록권한, 선택 수업의 학교·학기·판, 종료 여부, 원장 ID/판을 잠금 안에서 재검사.
4. 최초는 수업당 한 원장(경합 유일성), 정정은 같은 원장 판+1. 그 판의 원문과 사유를 불변 이력으로 보존.
5. 아래 접수증을 명령과 같은 트랜잭션에 기록. 실패 시 기록과 접수증 모두 롤백.

성공 data exact:

```json
{"requestKey":"request-1","commandHash":"64자리 소문자 sha256","record":{"id":"record","version":1,"lessonId":"lesson","lessonVersion":1,"outcome":"completed","note":"직접 확인","correctionReason":null,"recordedBy":{"id":"member","name":"담당 교사"},"recordedAt":"2026-10-19T09:00:00.000Z"}}
```

앱에서 한 번 확인한 접수증은 동일 범위·요청 번호로 다시 받은 원장 ID·기록시각을 포함한 전체 canonical 값과 같아야 한다. 다르면 조회는 INVALID_RESPONSE, 쓰기 응답은 RESULT_UNKNOWN으로 남긴다.

해시는 앱 `executionRecordCommandHash`와 동일: object 키를 오름차순 정렬하고 배열 순서를 보존한 공백 없는 canonical JSON의 UTF-8 SHA-256. null을 생략하지 않는다. 시수/부동소수 필드 없음.

NOT_FOUND는 늦은 최초 요청이 도착할 가능성을 없애지 않는다. 앱은 번호와 원문을 보존하고, 원장 확인 후 명시 확인을 받은 경우에만 `p_recover_only:false`로 **같은 번호·같은 원문**을 다시 보낸다. 최신 판으로 재구성하거나 새 번호로 바꾸지 않는다. 서버는 이 경우도 원장 우선 처리한다.

## 화면과 복구

- 기존 공유 시간표에서 선택한 수업에 접이식 실시 기록 패널 하나를 붙인다. 새 상위 메뉴 없음.
- 저장 전 직접 확인 체크. 미실시/확인 필요의 메모, 정정 사유를 앱과 서버가 함께 검사한다.
- CONFLICT는 내 입력을 보존하고 최신 기록/수업 판과 비교한다. 명시 최신 기준 채택 및 새 확인 뒤에만 확정적으로 거절된 명령을 새 키로 보낸다.
- 결과 미상은 pending registry(`timetableExecutionRecords`)에 원키·명령을 현재 탭 메모리로 보존한다. 브라우저 종료 뒤 복구를 약속하지 않는다.
- 목록 재조회 중 선택 수업 prop이 undefined여도 원수업 ID·입력·요청을 보존하고 복구할 수 있다.
- 성공 접수증 뒤 재조회 실패는 저장 실패로 바꾸지 않는다. 접수증을 보존하고 새 쓰기를 막은 채 조회만 다시 한다.
- 학교·소속·역할 범위가 바뀌면 이전 자료와 늦은 응답을 표시하지 않는다. 원장 조회 자체는 기존 인증 경로에 위임한다.

## Claude 검토 및 시험 요청

- 실제 SQL 응답으로 parser/adapter 대조. 교사·시간표 담당·읽기만 가능한 계정의 allowedOutcomes, 원키 복구 후 모듈중지, 소속 중지와 다른 학교 접근.
- 수업 재확정/교환/학사 변경과 실시 원장 쓰기의 경합, 원장 보존 및 수업 판 고정.
- 기록 21판 이상 페이지 경계, 새 정정 중 이전 anchor 페이지 조회, 누락/중복/변조 cursor.
- 늦은 최초 저장→NOT_FOUND→동일키 재전송 순서의 최종 원장 1개 보장.
- T2 계약과 겹치는 `performed` 표현의 책임을 문서에서 분명히 구분. 이번 명령이 scheduled/cancelled를 자동 변경하지 않는 계약 유지.
- 실제 SQL·Supabase·Storage 시험은 이 앱 작업에서 실행하지 않았다. 정책/권한 확장은 별도 확정하지 않았으며 현재 권한 내에서만 서버가 결과를 허용하도록 작성한다.

## 앱 자동 검증 결과

- 단위/계약 54건 통과: exact 필드·기록 ID/판·해시·변조·미래 수업 쓰기 차단·원키 복구·지연 저장·21판 이력 경계.
- 실제 React+parser+전송 어댑터, 합성 RPC 브라우저 14건 통과: 최초 기록·필수 메모·정정·충돌 비교·원키 재전송·lesson undefined·범위 변경·접수증 후 조회 실패·이력 두 쪽·320px 및 200% 확대.
- 전체 TimetableWorkspace·운영·공유 보드 연결 브라우저 5건 통과: 자기 입력 잠금 제외, 다른 수업/상위 탭/필터 잠금, 운영 조회 실패 및 재마운트 뒤 원키 복구, 선택 수업 복원, 320px.
- 타입 검사 통과. 운영 DB/SQL/실제 Supabase 왕복은 실행하지 않음.
