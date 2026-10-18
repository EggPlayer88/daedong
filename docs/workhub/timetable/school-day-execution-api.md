# 학사 변경 미리보기·원자 반영 계약

2026-10-17 · 앱 구현 / SQL 작성 요청. 실제 DB 구축·활성화와 실사용 검증은 별도다.

이 문서가 기존 `timetable-operations.next.v1`의 학사 영향 초안을 대체한다. 새 SQL은 아래 두 RPC만 만들며, 구 `operations_school_day_preview`를 만들거나 서로 다른 입력을 alias로 연결하지 않는다. 아래 두 RPC는 별도 `timetable-school-day.v1` 응답 봉투를 사용한다. 함수·표·정책 SQL은 Claude가 작성하고 사용자가 적용한다.

## 1. 교사가 사용하는 흐름

시간표 담당자가 **행사·휴업·특별일과 관리 → 날짜·학급 선택 → 사유와 변경 시각 입력 → 바뀔 수업 미리보기 → 전후·보강 검토 수 확인 → 반영** 순서로 처리한다. 미리보기에서는 실제 수업을 바꾸지 않는다. 확인란을 체크해도 반영 버튼을 누르기 전에는 기록 명령을 보내지 않는다.

- 휴업·행사: 해당 날짜의 대상 수업을 취소하고 보강 검토 차시와 손실 시간을 표시한다.
- 특별일과: 현재 실제 수업 시작·종료 시각을 새 시작·종료 시각에 연결한다. 표시 이름이나 가상의 교시 ID로 추정하지 않는다. 동일 시각의 수업들은 같은 매핑을 사용한다.
- 특별일과에서 바뀌지 않은 수업은 판을 올리거나 기록하지 않는다.
- 취소·단축했다고 보강 수업을 자동 생성하지 않는다. 보강 차시는 취소 회차 수이고, 손실은 정수 초로 계산한 뒤 화면에서 분·초로 표시한다.
- 새로운 입력이나 원본 조회 변경은 앞서 본 미리보기와 확인란을 무효화한다. 입력 자체는 탭 메모리에 보관한다.
- 다른 시간표 변경과 공통 저장 잠금을 사용한다. 결과를 모르면 원래 명령·요청 번호로 접수증만 조회한다.

## 2. 응답 봉투

성공: `{ contract:'timetable-school-day.v1', schoolId, memberId, data }`.

실패: 같은 봉투의 `data` 대신 `{ error:{code} }`. 기존 `ServiceCode`를 사용한다. 없는 기능은 `NOT_READY`, 대상 판 변경은 `CONFLICT`, 같은 번호의 다른 명령은 `IDEMPOTENCY_CONFLICT`다. 준비되지 않은 SQL을 성공한 것처럼 응답하지 않는다.

정확한 타입은 `apps/workhub/src/timetable/school-day-execution-contracts.ts`, 검증은 `school-day-execution-server.ts`가 기준이다. 아래 목록은 생략 가능한 예시가 아니라 exact 계약이다.

## 3. 미리보기 RPC

`workhub_timetable_school_day_preview(p_member_id, p_input, p_source_as_of, p_from, p_until)`

`p_input`:

```text
{
  kind: 'closure' | 'special_bells',
  date: YYYY-MM-DD,
  groupIds: 식별자[] (중복 없음, 정렬),
  reason: 공백이 아닌 문자열 (기존 operations-api-limits.reason),
  bells: [{before:{startsAt,endsAt}, after:{startsAt,endsAt}}]
}
```

`closure`는 `bells:[]`다. `special_bells`는 선택 날짜·학급의 모든 예정 수업 원래 시각을 정확히 한 번씩 매핑한다. **수업 시각은 정수 초이며 UTC `YYYY-MM-DDTHH:mm:ss.000Z` 형식**, 시작 < 종료다. 대상 원본 수업과 변경 후 수업 모두 초 미만 값은 반올림하지 않고 거부한다. `sourceAsOf`·`createdAt`·`expiresAt`·접수시각은 기존 밀리초 형식을 유지한다. 화면의 새 시각 입력은 분 단위이며 DST 누락·중복 시각과 잘못된 날짜는 거부한다. 새 변경 후 시각은 학교 시간대의 대상 날짜 안이어야 한다. 이미 날짜를 가로지르는 원본 수업은 before 및 변경하지 않은 after를 그대로 보내 차단 사유를 읽을 수 있고, 서버는 `CROSS_DAY_LESSON`을 반환하며 해당 수업을 changes에 넣지 않는다. 이를 새 자정 경계 수업 생성 허용으로 해석하지 않는다.

`data` 필드:

| 필드 | 의미 |
|---|---|
| input, sourceAsOf | 정규화한 원래 입력과 조회 시각 |
| previewId, previewHash | 서버가 보관한 미리보기 식별자·내용 지문 |
| createdAt, expiresAt | 생성·만료 시각. 기존 15분 한도 이내 |
| complete | 반드시 true |
| coverage | `{date,groupIds,complete:true,existingRequests:'complete'}` |
| affectedLessons | `{lessonId,version}[]`; 해당 날짜에 걸치는 선택 학급의 예정 수업 전체 |
| changes | 기존 `OperationLessonChange[]`; 실제 before 전체와 after 전체 |
| requestEffects | `{requestId,version,state,handling:'blocked'}[]`; 영향 수업과 관련된 진행·승인 교환 |
| blockers | `{code,message}[]`; code 중복 없음 |
| preserved | `{pastRecords:true,outsideTarget:true,existingChanges:'retained'|'blocked'}` |
| lostLessonCount | 실제 취소한 회차 수 |
| lostSeconds | 0 이상 안전한 정수. 회차별 `max(0,원래 초-변경 후 초)`의 합계. 취소 후 초는 0. 최대 `operations-api-limits.lessons × lessonMinutes × 60` |
| changesActualSchedule | 반드시 false |

`previewHash`는 자기 자신만 뺀 미리보기 전체를 앱 `canonical`로 직렬화한 UTF-8 SHA-256이다. JSON 객체 키는 사전순, 배열 순서는 응답과 같다. `lostMinutes`는 더 이상 받지 않으며 SQL은 `lostSeconds`를 JSON 정수로 내보낸다. 예를 들어 1초 단축은 `1`이며 `1/60` 같은 소수 분을 해시에 넣지 않는다. 서버와 앱의 canonical 결과를 반드시 대조한다.

### 전체 영향·보존 조건

앱은 조회의 수업 전체와 ID 참조 전체를 비교한다. `complete:true`만 믿고 누락·다른 학급·같은 이름의 다른 학급·원본 판 불일치를 수용하지 않는다. 수업명·교사·학급·공간 등 원래 정보는 바뀔 수 없고, 수정 회차의 판은 정확히 +1이다.

- 취소 after: 원래 시각 유지, `state:'cancelled'`, `canRequest:false`, `allowedTargets:[]`.
- 특별일과 after: 연결된 새 시각만 변경, `state:'scheduled'`, `canRequest:false`, `allowedTargets:[]`. 실제 최신 교환 가능 시간은 다음 조회에서 서버가 다시 계산한다.
- 공동 수업의 일부 학급만 고른 경우 `PARTIAL_GROUP_SCOPE` 차단. 그 공동 수업을 changes에 넣지 않는다.
- 이미 시작된 예정 수업은 `PAST_RECORD` 차단. 실시 완료·취소 수업은 변경하지 않는다.
- 자정을 넘는 회차는 `CROSS_DAY_LESSON` 차단. 날짜 일부만 취소하지 않는다.
- 대상 예정 수업이 없으면 `NO_LESSONS` 차단. 변화가 없으면 `NO_CHANGES` 등의 설명을 붙여 반영을 막는다.
- 진행중(`awaiting_consent`·`awaiting_approval`) 또는 이미 반영된(`applied`) 교환이 관련되면 정확한 요청 ID·판·상태를 requestEffects에 넣고 `EXISTING_EXCHANGE` 차단, `existingChanges:'blocked'`로 응답한다. 교환의 취소·재승인·새 교환으로의 대체를 자동 결정하지 않는다.
- 앱은 같은 교사·같은 학생 집단 ID의 실제 시간 중복을 다시 대조하며, 중복에는 `RESOURCE_CONFLICT` 차단이 필요하다.
- **서버는 공식 수업·학생 수강 관계를 사용해 서로 다른 집단 ID 사이의 실제 학생 중복까지 검사해야 한다.** 앱 표시 DTO에는 학생 명단이 없으므로 이름이나 다른 집단 ID만 보고 학생이 겹치지 않는다고 추정하지 않는다. 학생 관계 근거가 불완전하면 차단한다.
- **서버는 공간별 공식 동시 사용 가능 수업 수와 실제 점유를 검사한다.** 학생 좌석 정원과 다른 값이다. 표시 DTO에는 이 수치가 없으므로 앱은 공간 ID가 같다는 이유만으로 1로 추정하지 않는다. 체육관 등 공동 공간은 허용할 수 있고, 동시 수업 수 초과나 공간 근거 미확인은 서버 blocker로 막는다.
- 서버가 조회 범위 밖의 관련 교환·공동수업을 발견하여 보존을 증명할 수 없으면 차단한다. 기존 교환을 조용히 누락하거나 자동 폐기하지 않는다.

## 4. 원자 실행·복구 RPC

`workhub_timetable_school_day_execute(p_member_id, p_command, p_request_key, p_recover_only)`

```text
p_command = {
  kind:'school_day',
  preview:{previewId,previewHash,expiresAt}
}
```

**원본 view·references·미리보기 전체는 로컬 명령의 `context`로만 보존**한다. RPC에는 위 compact 참조와 원래 요청 번호만 보내며, 서버는 자신이 보관한 불변 미리보기를 읽는다. `commandHash`는 위 compact 명령의 canonical SHA-256이다.

전송 전 원본 검증 실패는 `INVALID_INPUT`, 유효한 미리보기의 기한 만료는 `CONFLICT`로 구분하고 실제 execute RPC를 보내지 않는다. 이때 화면은 입력을 유지하며 보내지 않은 명령을 결과 미상으로 남기지 않는다. 실제 전송 뒤 응답이 끊기거나 응답 검증에 실패하면 기존처럼 원래 명령·번호를 보존한다. 기한 만료 타이머는 확인란과 반영 버튼을 비활성화하고 다시 미리보기를 안내한다.

`p_recover_only:false`:

1. 기존 인증·학교 소속·담당 권한을 서버에서 재검사한다.
2. 같은 학교·요청 번호의 접수증이 있으면 명령 지문을 확인하고 원래 결과를 반환한다. 다른 명령이면 충돌이다.
3. 처음 처리하는 명령만 미리보기 만료·완전성·차단 항목·현재 판을 검사한다.
4. 대상 회차, 겹치는 교사·학생 관계·공간, 날짜 예외, 기존 교환과 기준 자료를 잠금 안에서 재검사한다. 미리보기 이후 바뀌었으면 전체 거부한다.
5. 학사 변경 기록·회차 변경·보강 검토 근거·감사·접수증을 **한 트랜잭션**으로 반영한다. 부분 성공은 없다. 같은 날짜 대상 변경의 경합으로 유효성 검사가 빠지지 않게 한다.

`p_recover_only:true`:

- **기존 접수증 조회 전용**이다. 미리보기 만료나 현재 모듈 준비 상태 때문에 원래 결과를 못 읽게 하지 않는다.
- 기존 인증·조회 권한은 계속 검사한다. 다른 학교·계정의 접수증을 반환하지 않는다.
- 접수증이 없으면 `NOT_FOUND` 등 명시 오류이며 실행으로 전환하지 않는다.
- 앱은 새로운 서버 객체를 만든 뒤에도 탭 메모리의 원래 command·key로 복구할 수 있다. 관련 없는 교환이 그 사이 만료되어도 원본 조회 시각 기준 검증을 유지한다.
- 앱은 같은 인스턴스에서 이미 확인한 접수증의 entityId·시각·내용이 바뀌면 거부한다.

`data` 접수증의 정확한 필드:

```text
{
  requestKey, commandHash, kind:'school_day', entityId,
  version:1, status:'applied', recordedAt,
  changedLessonCount, changesHash, lostLessonCount
}
```

`changesHash`는 전체 변경의 `{id:after.id,version:after.version}` 목록을 ID ASCII 순서(SQL `COLLATE "C"`에 해당)로 정렬한 canonical SHA-256이다. `changedLessonCount`와 `lostLessonCount`는 원본 미리보기와 같아야 한다. `recordedAt`은 생성 이후·만료 이전의 원래 기록 시각이며 재조회 때 현재 시각으로 바꾸지 않는다. 접수증은 모든 수업 행을 다시 싣지 않는다.

## 5. 검증과 실제 연결 경계

자동 회귀는 잘못된 전후·ID·판·누락·부분 공동수업·과거·교환 상태·특별일과 매핑·학생 집단 중복·공동 공간·자정·DST·compact 접수증·원키 복구를 검사한다. 브라우저는 실제 React 및 RPC 어댑터를 사용하고 응답은 합성이다.

- `node tests/test_workhub_timetable_school_day_commit.mjs`
- `node tests/browser/workhub-timetable-school-day-commit.mjs`
- 기존 `tests/test_workhub_timetable_next.mjs` 읽기 계약 유지

실제 Supabase 함수, 잠금·트랜잭션, PostgREST 응답, 운영 배포에서의 수업·일정 반영은 아직 검증하지 않았다. SQL 구현 뒤 계약 대조 및 복수 학교·동시 승인·답변 유실 복구 시험을 거쳐 사용자 승인으로 연결한다. 이 문서는 SQL 실행 또는 일반 교사 공개 승인이 아니다.
