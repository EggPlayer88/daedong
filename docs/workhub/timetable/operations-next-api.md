# 시간표 운영 확장: 주간표·추천·학사 변경·분할 미리보기

작성일: 2026-10-17. 앱 계약 준비 문서이며 SQL 설치·기능 활성화 기록이 아니다.

## 구현 범위와 경계

- 기존 `timetable-operations.v1`의 확정·요청·동의·승인·원래 요청 번호 복구를 유지한다.
- 공유 화면은 내 시간표가 기본이며 교사별 주간표, 휴대폰 당일 목록, 수업 상세, 원본 회차 ID로 변경 요청 시작을 제공한다. 교사·학급·날짜 필터는 접힌 한 영역으로 묶고, 휴대폰의 기본 보기와 이동 단위는 하루로 맞춘다. 주간표를 직접 선택하면 휴대폰에서도 표 안에서 가로로 살펴볼 수 있다.
- 학급별 조회는 아래의 안정된 학급 ID 연결이 성공해야 제공한다. 이름만으로 같은 학급이라고 추정하지 않는다.
- 서버가 검사한 교환 후보는 최대 3개 비교한다. 선택 후 기존 v1 미리보기를 새로 받아야 제출할 수 있다. AI 문장이나 추천 응답만으로 전송하지 않는다.
- 행사·휴업은 담당자의 초안과 영향 조회까지 구현했다. 실제 수업을 바꾸는 승인·실행 명령은 아직 열지 않았다. 특별일과 입력 계약은 준비했지만 사용자 입력 화면은 후속 범위다.
- 큰 확정 목록은 전체 manifest와 상세 페이지의 해시를 각각 검사한다. 분할 목록의 실행·접수증 계약은 아직 구현하지 않았으며 기존 v1 확정으로 우회하지 않는다.
- 별도 Claude 호출·DB·Storage·외부 서비스·공개 범위는 변경하지 않는다.

## 기존 v1과의 관계

새 envelope의 `contract`는 **`timetable-operations.next.v1`**이다. 기존 v1의 exact parser를 느슨하게 만들거나 v1 응답에 임의 필드를 끼우지 않는다.

성공 envelope: `{contract, schoolId, memberId, data}`. 오류 envelope: `{contract, schoolId, memberId, error:{code}}`. 권한·학교·기존 승인 확인은 공통 `createScopedRpc`를 사용한다. 미구축 기능은 `NOT_READY`로 응답한다. 참조/추천 연결 실패가 기존 수업 조회·교환·원래 요청 복구를 막으면 안 된다.

앱은 공유 목록을 월요일부터 14일 범위로 조회한다. 이전/다음 주 이동이 기존 범위를 벗어날 때만 새 범위를 요청한다. 기존 v1의 최대 3,000회차 한도는 유지한다. 서버가 한도를 넘는 전체 자료를 잘라 반환해서는 안 되며 명확한 오류를 반환해야 한다. 전국 규모 확대에는 선택 교사/학급을 서버에서 범위 제한하는 조회와 목록별 페이지 계약이 추가로 필요하다.

`asOf`는 원래 조회 응답의 확인 시각과 자료 세대를 연결하는 값이다. 클라이언트가 이 값을 보냈다고 권한이나 현재 판이 증명되지는 않는다. 서버는 현재 학교·소속·회차 판을 재검사하고 바뀌었으면 `CONFLICT`를 반환해야 한다.

## 1. 학급·공간 참조

RPC: `workhub_timetable_operations_references`

인자: `p_member_id`, `p_source_as_of`, `p_from`, `p_until`.

응답: `OperationReferenceView` (`apps/workhub/src/timetable/operations-next-contracts.ts`).

```json
{
  "asOf": "2026-10-17T00:00:00.000Z",
  "from": "2026-10-12",
  "until": "2026-10-26",
  "lessons": [{
    "lessonId": "occurrence-id",
    "version": 1,
    "groups": [{"id": "class-id", "name": "1학년 1반"}],
    "rooms": [{"id": "room-id", "name": "본관 101"}]
  }]
}
```

원본 조회의 모든 회차를 빠짐없이 한 번씩 반환한다. ID·판·학급명/공간명 배열이 기존 v1 목록과 같아야 한다. 같은 ID의 이름이 응답 안에서 달라지면 앱이 거절한다. 동명 다른 ID는 별개로 보존한다. 학생 개인 식별자·개인 사유·공식 학생 기록 접근권은 포함하지 않는다.

## 2. 교환 후보 추천

RPC: `workhub_timetable_operations_recommend`

인자: `p_member_id`, `p_source_as_of`, `p_input`:

```json
{"lessonId":"occurrence-id","expectedVersion":1,"reason":"연수 참석","from":"2026-10-12","until":"2026-10-26"}
```

응답: `ExchangeRecommendations`. `input`은 요청과 동일하며 `coverage`는 요청한 날짜 전체와 `complete:true`를 반환한다. `sourceAsOf`는 조회 세대와 일치해야 한다.

- `status: candidates`: 1~3개 후보.
- `status: none_found`: 후보 0개, 설명 필수. 이 범위에서 못 찾았다는 의미이며 전체 불가능 증명이 아니다.
- `status: search_limited`: 탐색 한도 내 결과. 후보 0~3개, 후보 0개면 설명 필수.
- 후보 `{id, explanation, input, preview}`. `input`은 기존 `ExchangeInput`(move/swap), `preview`는 기존 `ExchangePreview`와 정확히 동일하다.

서버는 실제 날짜의 전체 자원·교사·학생집단 충돌을 독립 검증하고 blockers가 없는 후보만 반환한다. 원본 회차 ID·판·사유는 추천 요청과 같아야 한다. 앱은 후보의 before를 현재 수업 DTO와 전수 대조하고, after의 시간·시수·참여 교사·일과·기한을 기존 parser로 검사한다. 설명은 검사 결과에 근거해야 하며 Claude가 후보를 설명해도 실행 권한은 생기지 않는다.

추천 RPC는 실제 시간표나 교환 요청을 쓰지 않는다. 후보 선택은 입력 폼만 채우며, 기존 `workhub_timetable_operations_exchange_preview` 재검토 후 명시 확인과 execute를 거친다. 따라서 기존 접수증/원래 요청 번호 경로를 재사용한다.

## 3. 전체 확정 목록과 상세 페이지

RPC:

1. `workhub_timetable_operations_publish_manifest(p_member_id,p_input)`
2. `workhub_timetable_operations_publish_page(p_member_id,p_preview_id,p_manifest_hash,p_index)`

`p_input`은 기존 `PublishInput`. 응답 exact 타입은 `PublicationManifest` / `PublicationChangePage`.

manifest는 미리보기 ID·해시, 기준자료 fingerprint, 원래 입력, 학교 timeZone, 생성·만료 시각, 전체 변경 건수, 페이지 크기, 순서대로 고정된 페이지 해시, 전체 blockers 건수, 보존 약속을 포함한다. 전체 변경 최대 250,000건, 페이지 최대 200건, 페이지 수 최대 1,250개는 앱 보호 한도이며 계산 완료의 보장이 아니다.

해시 규칙:

- `pageHash = SHA256(UTF8(canonical(changes)))`.
- `manifestHash = SHA256(UTF8(canonical(manifest에서 manifestHash를 제외한 객체)))`.
- canonical은 객체 키 사전식 정렬, 배열 순서 유지, JSON 문자열 이스케이프, 공백 없음이다. 계약 대조는 앱 `canonical`의 실제 출력으로 한다.
- 전체 건수와 마지막 페이지 길이까지 정확히 일치해야 한다. 서로 다른 페이지에서 같은 회차가 중복되면 앱이 거부한다.
- 상세는 기존 수업 판 증가·상태 검사를 재사용하고, manifest의 시간대/적용 기간 밖 또는 이미 시작한 수업 변경을 거부한다.
- 서버는 조회 도중 원본이 바뀌어도 일부 페이지만 새 내용으로 교체하지 않는다. 같은 manifest의 고정 자료를 읽거나 `CONFLICT`로 중단한다.

현재 화면은 검사된 manifest 요약과 페이지를 읽고 모든 쪽의 자동 검증·명시 확인을 거쳐 별도 [학기 확정 실행 계약](publication-execution-api.md)으로 연결한다. 이 next.v1 조회 계약은 바꾸지 않는다. 새 실행 계약은 전체 manifestHash·basisFingerprint를 고정하며 SQL이 잠금 안의 최신 자료 재검사, 단일 접수증, 원키 조회 전용 복구를 보장해야 한다. 부분 상세를 v1 `complete:true`로 포장해서 실행하면 안 된다.

## 4. 행사·휴업·특별일과 영향 초안

RPC: `workhub_timetable_operations_school_day_preview(p_member_id,p_source_as_of,p_input)`

`SchoolDayChangeInput`:

- `kind: closure | special_bells`, 학교 현지 `date`, 안정된 `groupIds`, `reason`, `bells`.
- closure는 bells 빈 배열, special_bells는 `{periodId,time:{startsAt,endsAt}}` 1~30개. 중복 교시·겹친 시간·현지 날짜 밖 시간을 거부한다.
- 일반 일정 제목으로 자동 취소하지 않는다. 승인된 담당자가 명시적으로 대상 학급을 선택한다.

응답 `SchoolDayChangePreview`는 입력·조회 세대·previewID/hash/만료시각, `complete:true`, 영향 회차 ID/판, blockers, 처리 중 요청 수, **`changesActualSchedule:false`**를 반환한다. 앱은 참조에서 선택 학급에 속한 당일 scheduled 회차 전체와 응답을 대조해 누락·추가를 거부한다.

이 RPC로 교환·동의·시간표를 변경하지 않는다. 실제 반영 UI는 별도 [학사 변경 실행 계약](school-day-execution-api.md)에 연결한다. 새 계약은 참조에 없는 교시 ID를 추정하지 않고 현재 수업의 실제 시각으로 특별일과를 지정한다. 과거 실시 기록과 공동 수업을 보호하고 기존 교환과 충돌하면 중단하며, 대강·보강과 학생권한 변경은 자동으로 실행하지 않는다. 기존 조회 RPC의 입력 모양은 그대로 유지한다.

## 5. 일정 연결

`operations-calendar.ts`의 `projectTimetableCalendar(view,memberId)`는 원본을 수정하지 않고 현재 조회에서 본인의 수업만 읽기 전용 DTO로 변환한다.

- `sourceModule:'timetable'`, `lessonId`, `version`, `readOnly:true` 고정.
- 학교 시간대로 날짜/시각 표시. 취소/실시 상태 보존.
- 일반 CalendarEvent 저장 함수에 넣지 않는다. 달력에 별도 표시하고 수정은 시간표 원본으로 이동한다.
- `TimetableAgendaWorkspace`는 실제 읽기 전용 readiness/get 어댑터로 하루 범위를 조회하여 홈·일정 화면에 최대 5개 수업과 전체 보기 링크를 제공한다. `onOpen(lessonId,date)`는 원본 회차와 선택 날짜를 시간표에 전달하며, 전체 보기는 빈 lessonId를 전달한다. `date`(현재 소속 검사 기준)와 `initialDate`(표시할 날짜)는 분리한다.
- 미준비·조회 실패·확인된 빈 목록을 구분한다. 취소·진행 완료 상태를 유지하며, 날짜/학교 변경 뒤 늦은 응답은 새 화면을 덮지 않는다. 일반 CalendarEvent로 저장하는 호출은 없다.

## 검증

- `tests/test_workhub_timetable_next.mjs`: 참조 누락/판·이름 불일치, 추천 변조·만료·범위, manifest/page hash·길이·기간, 학사 변경 영향 전체 대조, 읽기 전용 projection, SSR.
- `tests/browser/workhub-timetable-board.mjs`: 주간표/모바일, 동명 학급 ID 구분, 원본 수업 연결, 입력 보존, 추천 선택의 무전송, 지연 추천 폐기, 참조 실패 격리, 학사 변경 무반영.
- `tests/test_workhub_timetable_agenda.mjs`, `tests/browser/workhub-timetable-agenda.mjs`: 홈·일정 요약의 최대 5개, 내 수업 한정, 실제 회차·날짜 연결, 미준비/오류/빈 목록, 지연 응답 폐기.
- 기존 publication/exchanges 브라우저 시험의 확정·동의·승인·원키복구 유지.
- `tests/browser/workhub-timetable-appearance.mjs`: 실제 `workspace-shell.css`의 화이트·웜·차콜 스킨과 편성·교환·수업 요약을 함께 렌더한다. 글자/주 버튼/폼/오류 안내 대비 4.5:1 이상, 320px 화면, 200% 콘텐츠 확대, 스킨 즉시 변경과 재조회 실패 후 입력 보존을 검사한다. 200%는 CSS 콘텐츠 확대이며 브라우저 메뉴 배율이나 교사 PC 인쇄 검증으로 대신하지 않는다.

모두 실제 React·공통 전송 어댑터와 합성 RPC 응답으로 검증하며, 실제 Supabase·Claude·교사 동의 발송을 검증한 결과로 해석하면 안 된다.
