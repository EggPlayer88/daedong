# 시간표 요청 닫기 — 앱 구현과 Claude 대조 요청

2026-10-20. #72 후속 앱 구현. SQL 계약 기준은 #73 `c37a98f7c89480c62635c203a833240219a4e8b2`의
`database/workhub-timetable/t2/T2_요청번호_포기_계약.md`다. SQL·인증·비용·메뉴 공개 범위는 변경하지 않았다.

## 교사가 보는 흐름

1. 저장 응답을 확인하지 못하면 원래 입력과 요청 번호를 현재 탭에 보관한다.
2. 원래 요청 결과 조회가 NOT_FOUND이면, 사용자가 확인한 뒤 같은 번호·같은 내용으로만 다시 보낼 수 있다.
3. 재전송도 업무 오류로 거절되면 `이 요청 닫기`를 제공한다. 오류만으로 잠금을 해제하지 않는다.
4. 첫 버튼은 설명만 연다. `요청 닫기 확인`을 눌렀을 때만 서버에 닫기를 요청한다.
5. `applied`는 원래 성공 접수증을 검증하고 기존 성공 처리로 연결한다. 이미 반영된 시간표를 취소하지 않는다.
6. `abandoned`는 원래 요청 잠금만 해제한다. 입력은 보관하고, 시간표 확정·학사 변경·교환 미리보기는 새로 확인한다.
   실시 기록은 최신 수업·기록과 다시 비교한 뒤 새 번호로 저장한다. 새 요청은 자동으로 보내지 않는다.
7. 닫기 응답이 끊기거나 형식이 틀리면 `closing` 단계와 원키·원문을 보관한다.
   같은 탭에서 화면을 다시 열어도 `요청 닫기 결과 다시 확인`만 가능하고, 원래 명령 재전송은 막는다.

같은 탭의 화면 재진입 보존이다. 브라우저 새로고침·종료 뒤 복원을 약속하지 않는다.
작성 중 입력 때문에 이동 확인이 남는 것과, 결과 미확정 요청 때문에 쓰기가 잠기는 것을 구분한다.

## 서버 호출과 응답

공개 RPC는 `workhub_timetable_operations_abandon(p_member_id, p_kind, p_command, p_request_key)` 하나다.
봉투 계약은 `timetable-operations.abandon.v1`. 기존 `createScopedRpc`가 본인 계정·학교·소속과 응답 범위를 확인한다.
모듈 준비 조회나 최신 시간표 조회 성공을 닫기의 선행조건으로 추가하지 않았다.

| 종류 | 앱 서버 | 보내는 원래 명령 | `applied` 검증 |
|---|---|---|---|
| `operations` | `createTimetableOperationsServer` | `OperationCommand` | `parseOperationReceipt` |
| `publication` | `createPublicationExecutionServer` | 기존 명세 확정의 compact 명령 | `parsePublicationCommitReceipt` |
| `school_day` | `createSchoolDayExecutionServer` | `schoolDayCompactCommand` | `parseSchoolDayCommitReceipt` |
| `execution` | `createTimetableExecutionRecordsServer` | `ExecutionRecordCommand` | `parseExecutionRecordReceipt` |

네 서버 모두 `abandon(memberId, originalCommand, requestKey)`를 제공한다.
UI 테스트용 기존 서버와의 호환을 위해 인터페이스에서는 optional이지만 실제 연결 서버에는 모두 구현돼 있다.
원문 검증은 복구와 같이 미리보기 만료를 허용하며, 확인 시점의 새 명령으로 바꾸지 않는다.

`request-abandon.ts`의 공개 parser:

```ts
parseRequestAbandonResult(
  raw, kind, requestKey, commandHash, parseReceipt, now
)
```

- data 키는 정확히 `kind/requestKey/commandHash/outcome/receipt/decidedAt` 여섯 개다.
- 종류·원키·원문 SHA-256이 일치해야 한다. 원키는 SQL과 같은 `[A-Za-z0-9_-]{8,200}`이다.
- `decidedAt`은 밀리초 UTC ISO 시각이고 허용 시계 오차보다 미래일 수 없다.
- `applied`는 기존 접수증 parser를 통과해야 하며, 접수증 기록 시각이 결정 시각보다 늦을 수 없다.
- `abandoned`는 반드시 `receipt:null`이다. 반복 응답의 결정 시각과 내용도 같아야 한다.
- 성공·닫힘이 같은 번호에서 뒤집히거나 기존 접수증이 바뀌면 잠금 해제 근거로 쓰지 않는다.
- 닫힌 번호의 execute/recover/resend는 로컬에서도 거절한다. 다른 명령으로 재사용하면 IDEMPOTENCY_CONFLICT다.
- 닫기 자체가 쓰기이므로 통신 실패·시간초과·응답 검증 실패는 RESULT_UNKNOWN으로 처리한다.
- CONFLICT만으로 요청을 제거하거나 새로운 번호를 만들지 않는다.

## 검증

| 검사 | 결과 |
|---|---|
| 저장소 전체 `npm test` | 4,370 통과 / 실패 0 / 건너뜀 0 |
| 관련 브라우저 6파일 | 83시나리오 통과 / 실패 0 |
| 기존 운영·확정·학사 변경·실시 기록 어댑터 | 41 + 36 + 58 + 54건 통과(전체 시험에 포함) |
| `check:workhub`, `build`, `build:workhub` | 통과 |
| `check:workhub:timetable`, `git diff --check` | 통과, 보호 경로 변경 없음 |

- 새 어댑터 회귀 `tests/test_timetable_request_abandon.mjs`: 76건.
  네 종류, 원키·compact 명령·hash, 만료 원문, 학교/소속 변경, 잘못된 봉투·접수증,
  응답 유실, 동일 번호 반복, 최초 응답과 닫힘의 경합, 기록 시각 변조를 포함한다.
- 새 브라우저 `tests/browser/workhub-timetable-request-close.mjs`: 20건.
  실제 React·전송 어댑터와 합성 RPC로 최초 저장부터 복구·닫기, 네 종류의 닫힘/기존 성공,
  closing 재진입, 모듈 중지, 입력 보존, 새 번호, 학교 변경 중 늦은 응답, 320px 키보드를 확인한다.
- 기존 운영·확정·학사 변경·실시 기록 어댑터와 관련 브라우저도 함께 재검증한다.
- 실제 Supabase·PostgREST를 호출하거나 T2 SQL을 실행하지 않았다. SQL 원장 잠금의 원자성은
  합성 브라우저 시험으로 증명할 수 없으므로 아래 Claude 대조가 필요하다.

관련 브라우저 묶음은 전체 확정 18, 학사 변경 19, 운영 복구 7, 요청 닫기 20, 실시 기록 14,
실시 기록 전체 연결 5건이다. 위 83건에 새 20건이 포함돼 있으며 중복 합산하지 않는다.
로그와 화면은 바탕화면 `GPT작업/2026-10-20_시간표요청닫기/`에 보관했다.
원격 CI는 최종 PR head에서 별도 확인한다.

## Claude가 대조할 것

1. 네 종류 모두 실제 `_abandon`의 `applied/abandoned` 응답을 위 parser와 기존 접수증 parser에 넣기.
2. SQL의 원래 접수증 recordedAt과 원장 decidedAt 관계, 반복 닫힘의 시각 불변 확인.
3. 처음 요청과 닫기의 동시 실행: 하나만 확정되고, 닫힌 뒤 늦은 원요청은 반영 0.
4. 모듈 중지 중 본인 요청 복구는 가능하되 다른 계정·학교·소속은 거절.
5. 닫기 응답 유실 뒤 같은 인자 재확인, 다른 명령의 원키 재사용 거절.
6. 앱 병합·SQL 비활성 설치·학교 활성화를 각각 판단.

D-T2-1·2·6은 사용자 승인이 필요한 권장안으로 남긴다. 시범 명단, 학사 변경 알림,
두 번째 승인 담당자 조건을 이번 앱 변경으로 확정하거나 서버에 적용하지 않았다.
학사 변경 알림의 원본 ID는 교환 요청 ID와 다르므로 현재 교환 알림 목적지를 재사용하지 않는다.

## 판단해서 정한 것과 되돌리기

- 공통 parser와 확인 화면을 두고 네 서비스의 기존 접수증 검증을 재사용했다. 같은 복구 규칙의 차이를 줄이기 위해서다.
- 닫기 단계를 원키와 함께 현재 탭 메모리에 둔다. 화면 재진입 중 원래 요청을 다시 보내는 일을 막기 위해서다.
- 되돌릴 때는 이 앱 커밋을 되돌릴 수 있다. 단 서버에 이미 닫힌 번호는 다시 열리지 않으며,
  구버전 앱은 그 번호를 CONFLICT로 받아 잠금을 유지할 수 있다. SQL 원장을 지우는 되돌림은 포함하지 않는다.
