# P1 학교 관리 — API 계약 (앱 PR #48 과 대조)

2026-10-16 · Claude Code. 앱 원본: `apps/workhub/src/setup/school-admin-contract.ts`, `school-admin-server.ts` (PR #48 `5f3d40f`).

## 1. 함수

모두 `authenticated` 만 실행합니다(anon·service_role 불가). SECURITY DEFINER, `search_path = ''`.

| 함수 | 인자 | data |
|---|---|---|
| `workhub_school_admin_readiness` | `p_member_id text` | `{available:true}` 또는 `{available:false, reason:'not_installed'\|'not_configured'\|'forbidden'}` |
| `workhub_school_admin_get` | `p_member_id text`, `p_school_year integer default null` | 스냅샷 |
| `workhub_school_admin_mutate` | `p_member_id text`, `p_command jsonb`, `p_request_key text` | 접수증 |

`not_installed` 는 함수가 있는데 설치 기록이 어긋난 경우에만 나옵니다(함수 자체가 없으면 앱이 호출 실패로 압니다).
`not_configured` = 이 학교에 활성화 행이 없거나 중지. `forbidden` = 세 권한 중 하나도 없음.

## 2. 봉투

```json
{"kind":"workhub-school-admin","schemaVersion":1,"schoolId":"<학교>","memberId":"<요청 소속>","data":{...}}
{"kind":"workhub-school-admin","schemaVersion":1,"schoolId":"<학교>","memberId":"<요청 소속>","error":{"code":"CONFLICT"}}
```

| 상황 | 응답 | 앱 |
|---|---|---|
| 업무 오류(변경 0) | `error.code` ∈ NOT_READY · INVALID_INPUT · FORBIDDEN · NOT_FOUND · CONFLICT · IDEMPOTENCY_CONFLICT | 같은 코드 |
| 로그인·가입 승인·소속 확인 실패 | 봉투 없는 예외 `FORBIDDEN` / `INACTIVE_MEMBERSHIP` | 연결 모듈이 코드로 바꾸고 문맥 무효화 |
| 그 밖의 오류 | 봉투 없는 예외 | 쓰기 `RESULT_UNKNOWN`, 읽기 `QUERY_FAILED` |

## 3. 스냅샷 예 (시험 응답에서 줄임)

```json
{"version":9,"asOfDate":"2026-10-16","availableYears":[2026,2027],
 "configuration":{"draftId":"<학년도 id>","schoolName":"시험용 대동여자중학교","schoolCode":"daedong-ms","schoolType":"middle",
   "schoolYear":"2026","gradeCount":"3","startsOn":"2026-03-01","lastDay":"2027-02-28",
   "terms":[{"id":"<id>","termNo":"1","name":"1학기(봄)","startsOn":"2026-03-01","lastDay":"2026-08-20"}],
   "departments":[{"id":"<id>","name":"정보부"}],
   "classes":[{"id":"<id>","grade":"1","classNo":"1","name":"1-1","kind":"regular"},{"id":"<id>","grade":"3","classNo":"","name":"도움반","kind":"special"}]},
 "subjects":[{"id":"<id>","name":"국어"}],
 "memberships":[{"id":"m-21","name":"교사21","status":"active","startsOn":"2026-03-01","lastDay":"9999-12-31","version":1}],
 "assignments":[{"id":"<id>","memberId":"m-21","kind":"department","targetId":"<부서 id>","label":"정보부","startsOn":"2026-03-01","lastDay":"2027-02-28","status":"active","version":1}],
 "capabilities":{"configuration":true,"memberships":true,"assignments":true}}
```

- 숫자 칸(`schoolYear`·`gradeCount`·`termNo`·`grade`·`classNo`)은 앱 `SetupDraft` 와 같이 **문자열**입니다.
- 소속 목록은 이 학교 전체(대기·반려 포함), 이메일·Auth ID·역할 내부 정보는 넣지 않습니다.
- 권한이 없는 사람에게는 `FORBIDDEN` 봉투만 줍니다(소속 목록 없음).

## 4. 명령과 접수증

명령 모양은 앱 `schoolAdminCommand` 결과 그대로입니다(시험 AC-shape: 성공한 명령 28건이 앱 parser 를 거친 모양과 같음).

```json
{"kind":"save_configuration","expectedVersion":1,"mode":"update","configuration":{...},"subjects":[...],"reason":"구성 정리"}
{"kind":"assign_duty","expectedVersion":4,"schoolYear":2026,"memberId":"m-21","assignmentKind":"homeroom","targetId":"<학급 id>","label":"1-1 담임","startsOn":"2026-03-01","lastDay":"2027-02-28","reason":"담당 배정"}
{"kind":"end_assignment","expectedVersion":10,"schoolYear":2026,"assignmentId":"<id>","lastDay":"2026-10-16","reason":"담임 교체"}
{"kind":"review_membership","expectedVersion":12,"schoolYear":2026,"targetMemberId":"m-23","decision":"suspended","startsOn":"2026-03-01","lastDay":"9999-12-31","reason":"소속 처리"}
```

접수증: `{"requestKey":"<키>","kind":"assign_duty","version":5,"schoolYear":2026,"recordedAt":"2026-10-15T22:56:21.928Z"}`

- 요청 번호: `^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$`. 같은 번호·같은 원문 → 처음 접수증(판이 지금보다 이전일 수 있음). 같은 번호·다른 원문 → `IDEMPOTENCY_CONFLICT`.
- `expectedVersion` 이 현재 판과 다르면 `CONFLICT`. 성공하면 판 +1, 접수증의 `version` 은 새 판.
- `create_year` 는 새 학년도를 만들고, 기본 조회는 그대로 오늘이 든 학년도입니다.

## 5. 앱과 대조한 결과

시험 중 받은 실제 응답 94건을 PR #48 의 `createSupabaseSchoolAdminServer` 에 그대로 넣었습니다(`test/app_contract_p1.ts`).

- 준비 상태 7 · 스냅샷 21 · 접수증/오류 66건 모두 앱이 같은 값·같은 코드로 읽음
- 앱 parser 가 보내기 전에 막는 명령 28건은 서버도 모두 거부
- 성공 경로: 구성 수정·새 학년도·담당 배정·종료·소속 재직/중지/종료/반려 모두 기록됨
- 다른 학교 봉투, 판이 오르지 않은 접수증은 앱이 거부(`RESULT_UNKNOWN`)

앱 쪽에서 고칠 것은 찾지 못했습니다. 학기 번호 변경만 서버가 막는다는 점을 화면 안내에 넣으면 좋습니다(`P1_설계결정.md` 3절).
