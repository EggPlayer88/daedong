# P7 API 계약 — 실제 입출력

2026-10-16 · Claude Code. 6개 공개 함수 모두 `authenticated` 만 실행(anon · service_role 불가), `SECURITY DEFINER`, `search_path=''`.
아래 예시는 시험(`test/run_p7.py`)이 실제로 받은 응답에서 ID 만 줄인 것입니다. 앱 서비스 · parser 대조는 `test/app_contract_p7.ts`(시험 V).

## 공통

- 봉투: 성공 `{contract, schoolId, memberId, data}`, 업무 거절 `{contract, schoolId, memberId, error:{code}}`. 두 키를 같이 보내지 않습니다.
- 업무 거절 코드: `NOT_READY` · `INVALID_INPUT` · `FORBIDDEN` · `NOT_FOUND` · `CONFLICT` · `IDEMPOTENCY_CONFLICT`.
- 봉투 없는 예외: 로그인 · 업무실 자격 · 소속 문제만(`FORBIDDEN` · `INACTIVE_MEMBERSHIP`). 그 밖의 예외(중간 실패)는 앱이 `RESULT_UNKNOWN` 으로 받고 같은 번호로 다시 확인합니다.
- 쓰기의 요청 번호 `p_request_key` 는 `^[A-Za-z0-9_-]{8,200}$`. 같은 사람 · 같은 모듈 · 같은 번호 · 같은 내용 → 처음 응답 그대로(모듈이 꺼져 있어도), 다른 내용 → `IDEMPOTENCY_CONFLICT`.

## 수합 운영 `collection-operations.v1` (모듈 `collection_ops`)

`workhub_collection_operations_get(p_member_id text, p_request_id text)`

```json
{"contract":"collection-operations.v1","schoolId":"8566…","memberId":"5289…","data":{
  "requestId":"f3e5…","version":1,"phase":"open","dueDate":"2026-10-17","canManage":true,
  "totals":{"total":2,"missing":1,"submitted":1,"accepted":0,"changesRequested":0},
  "units":[{"id":"4425…","label":"1학년","responsibleMemberId":"m-21","version":2,"state":"submitted"},
           {"id":"0f4b…","label":"2학년","responsibleMemberId":"m-23","version":1,"state":"missing"}]}}
```

- 관리자가 아니면 `canManage:false` · `units:[]` · 합계는 R1 이 보여 주는 단위만. 볼 수 없는 수합 · 초안 · 다른 학교 → `NOT_FOUND`. ID 형식 틀림 → `INVALID_INPUT`.

`workhub_collection_operations_mutate(p_member_id text, p_command jsonb, p_request_key text)`

```json
// 명령
{"kind":"remind","requestId":"f3e5…","expectedVersion":1,"reason":"오늘까지 제출 부탁드립니다",
 "recipients":[{"unitId":"0f4b…","memberId":"m-23","expectedVersion":1}]}
// 응답
{"contract":"collection-operations.v1","schoolId":"8566…","memberId":"5289…",
 "data":{"requestKey":"k-8692…","requestId":"f3e5…","version":2,"recordedAt":"2026-10-16T03:09:42.385Z"}}
```

| 명령 | 가능한 단계 | 추가 칸 | 준비 조건 |
|---|---|---|---|
| `remind` | open | `recipients` 1~500(단위 중복 불가) | 메신저(`messaging`) 켜짐 |
| `close` | open | — | P7-05 |
| `archive` | closed | — | P7-05 |
| `reopen` | closed · archived | `dueDate` ≥ 학교 오늘 | P7-05 |
| `extend` | open | `dueDate` ≥ 학교 오늘, 지금 기한보다 뒤 | P7-05 |

- `reason` 1~1,000자(제어문자 불가). 관리자 아님 → `FORBIDDEN`, 판 다름 · 단계 불가 · 알림 대상이 하나라도 이미 제출/담당 바뀜/판 다름/소속 정지 → `CONFLICT`(부분 전송 없음).

## 홈 요약 `home.v1` (모듈 `home`)

`workhub_home_overview(p_member_id text)`

```json
{"contract":"home.v1","schoolId":"8566…","memberId":"m-23","data":{
  "asOf":"2026-10-16T03:09:42.702Z",
  "items":[{"id":"h_cooperation_3703…","kind":"cooperation","title":"평가 자료 협조","dueDate":"2026-10-16","sourceId":"9832…","priority":"urgent","label":"협업 요청 받음"},
           {"id":"h_collection_eb44…","kind":"collection","title":"연수 결과 보고 수합","dueDate":"2026-10-17","sourceId":"f3e5…","priority":"urgent","label":"미제출"},
           {"id":"h_message_f6b2…","kind":"message","title":"1:1 메시지","dueDate":null,"sourceId":"dce7…","priority":"normal","label":"안 읽은 메시지 1개"}],
  "counts":{"collection":1,"supplement":0,"message":1,"student_followup":null,"cooperation":1},
  "unavailable":["student_followup"]}}
```

- 항목 최대 8개(개수는 전부). 꺼진 출처는 `null` + `unavailable`. 학생 후속 항목(P5 켜짐)은 `{"kind":"student_followup","title":"학생 기록 근거 확인: <수업>","sourceId":"<수업 ID>","label":"근거 변경 N건"}`.

## 업무 전환 `school-transitions.v1` (모듈 `transitions`, 공식 담당은 `duty_handover` 도)

`workhub_school_transition_list(p_member_id text, p_cursor text)`

```json
{"contract":"school-transitions.v1","schoolId":"8566…","memberId":"m-21","data":{
  "canManageYear":false,"years":[],
  "recipients":[{"memberId":"m-22","name":"김하늘","version":1},{"memberId":"m-23","name":"김하늘","version":1}, …],
  "resources":[{"kind":"duty","id":"duty-21","version":1,"label":"방과후 업무"}],
  "records":[{"id":"39e7…","kind":"handover","title":"…","version":1,"state":"pending","canAccept":false,"canCancel":true,"summary":["받는 사람: 김하늘","공식 담당: 방과후 업무","…"]}],
  "nextCursor":null}}
```

- 기록 50건씩, `nextCursor` 는 그 사람 전용(다른 사람이 쓰면 `INVALID_INPUT`). 학년도 목록은 연도 관리 권한이 있을 때만.

`workhub_school_transition_preview(p_member_id text, p_plan jsonb)`

```json
// 계획(인계)
{"kind":"handover","recipientMemberId":"m-22","recipientVersion":1,"resources":[{"kind":"duty","id":"duty-21","version":1,"label":"방과후 업무"}],"note":"인계 메모입니다"}
// 응답
{"data":{"fingerprint":"478f…(64자)","expiresAt":"2026-10-16T03:20:00.000Z","affectedCount":1,
  "summary":["받는 사람: 김하늘","공식 담당: 방과후 업무"],
  "excluded":["공식 담당은 수락한 날부터 받는 사람에게 넘어가고, 내 담당은 그 전날까지로 끝납니다.","받는 사람이 수락하기 전까지는 아무것도 넘어가지 않습니다."]}, …}
// 계획(새 학년도)
{"kind":"new_year","sourceYearId":"4dc1…","targetYear":2027,"firstDay":"2027-03-01","lastDay":"2028-02-28",
 "term1First":"2027-03-02","term1Last":"2027-07-20","term2First":"2027-08-20","term2Last":"2028-02-10","copyStructure":true}
// 응답 summary
["2027학년도: 2027-03-01 ~ 2028-02-28","1학기: 2027-03-02 ~ 2027-07-20","2학기: 2027-08-20 ~ 2028-02-10","2026학년도 구성 복사: 부서 2개 · 학급 1개 · 교과 1개"]
```

`workhub_school_transition_mutate(p_member_id text, p_command jsonb, p_request_key text)`

| 명령 | 누가 | 응답 `state` · `version` |
|---|---|---|
| `{"kind":"apply","plan":…,"fingerprint":…}` 인계 | 자원 주인 | `pending` · 1 |
| `{"kind":"apply",…}` 새 학년도 | 연도 관리 권한 | `completed` · 1 |
| `{"kind":"accept","recordId","expectedVersion","reason"}` | 받는 사람(업무실 사용자) | `accepted` · 2 |
| `reject` | 받는 사람 | `rejected` · 2 |
| `cancel` | 요청한 사람 | `cancelled` · 2 |

```json
{"contract":"school-transitions.v1","schoolId":"8566…","memberId":"m-22",
 "data":{"requestKey":"k-f6c0…","recordId":"39e7…","version":2,"state":"accepted","recordedAt":"2026-10-16T03:09:43.447Z"}}
```

- 지문이 다르거나 만료(10~20분) · 자원 · 받는 사람 · 학교 관리 판이 바뀜 → `CONFLICT`. 당사자 아님 → `NOT_FOUND`, 역할이 틀림(요청한 사람이 수락 등) → `FORBIDDEN`.
- 협업을 그 요청을 보낸 사람에게 넘기는 계획 → `INVALID_INPUT`.
