# Claude에게: 시간표 8단계 DB·AI 연결 요청

> 2026-10-16 · 실행 SQL이 아닌 계약 인계. 기존 전체 시범 PR #48의 SQL 1~7단계를 변경하지 않는다. 이 문서는 사용자가 재개한 시간표를 **후속 8단계**로 추가한다. SQL 확정본은 Claude, 실행은 계란님이 맡는다. Codex는 SQL·외부 설정·운영 DB를 변경하지 않았다.

> 후속 갱신: 이 문서는 PR #54의 `timetable.v1` 기초 3개 RPC 계약을 보존한다. 확정·교환 운영 화면에 추가된 `timetable-operations.v1`의 5개 RPC는 [운영 API 인계](operations-api.md)가 현재 기준이다. 기초 편성과 운영을 구분하고, 두 계약을 합쳐 임의 함수로 구현하지 않는다.

## 1. PR #54의 기초 앱 계약과 후속 운영 계약을 구분한다

PR #54가 연결한 RPC는 **준비 상태, 읽기, 새 초안 저장의 3개**다. 후속 운영 화면은 별도 계약의 5개 RPC를 사용한다. 이 문서의 기초 RPC만 설치하면 확정·공유·교환까지 열리는 것으로 해석하지 않는다. 운영 범위는 [운영 API 인계](operations-api.md)의 현재 parser·어댑터와 함께 구현한다.

| 구분 | 현재 기준 파일 | 역할 |
|---|---|---|
| 주간 편성 자료 | `packages/timetable/src/types.ts`, `validate.ts` | 입력·시수·자원·허용 시간·필수조건·배치 검사 |
| 현재 읽기/초안 API | `apps/workhub/src/timetable/contracts.ts`, `server.ts` | exact JSON parser와 3개 RPC |
| Claude 제안 교환 | `apps/workhub/src/timetable/assistant.ts` | setup/adjust의 typed 제안 검증, 자동 공급자 호출 없음 |
| 날짜별 이동·교환 | `apps/workhub/src/timetable/operations-domain.ts` | 순수 사전 검증, 저장·승인 실행 없음 |
| 완성 운영 요구 | [운영 설계](operations.md) | 확정·공유·교환·실시·보강의 후속 명세 |

신규 시간표 메뉴는 superadmin 범위를 유지한다. SQL 설치가 일반 교사 공개나 권한 승격의 근거가 되지 않는다.

## 2. 이미 있는 기반과 부족한 기준자료

학교 관리 SQL(PR #49 이후)은 기존 소속·학기·학급·교과·공식 담당을 제공한다. 수업·학생 5단계는 실제 course와 승인 교사·수강 관계를 제공한다. 시간표의 주당 시수, 연속 블록, 일과 시각, 공간, 날짜별 수업 원장은 별도 준비가 필요하다.

- 학교 관리 `schoolType=elementary`를 시간표 `schoolLevel=primary`로 명시 매핑한다. 문자열을 그대로 넘기지 않는다.
- 학교 관리의 `startsOn,lastDay`, 수업의 `validFrom,validThrough`는 마지막 날 포함이다. DB 반열린 기간으로 바꿀 때 한 번만 변환한다.
- 기존 교과 담당 `assignment`를 모든 해당 과목 수업의 담당으로 확대하지 않는다. 실제 승인된 수업 배정을 사용한다.
- `courseId`는 실제 수업집단과 연결하며 별도 중복 교과/교사 원장을 만들지 않는다.
- 원본에 없는 주당 시수·교실·일과·선택수강 중첩을 추정하지 않는다. 준비 전에는 `basis_missing`을 반환한다.

기존 03/14 설계의 표 이름은 목표 설계다. 현재 설치되어 있다고 가정하지 말고 실제 적용된 1~7단계와 대조하여 신규/재사용/이름 매핑 목록을 먼저 제시한다. 확정된 과거 SQL을 고치지 않고 증분으로 작성한다.

## 3. 현재 3개 RPC의 exact 계약

모든 응답은 `createScopedRpc`의 봉투를 따른다. 현재 JWT와 승인·학교 소속을 서버에서 확인한다. 클라이언트가 보낸 `p_member_id`만 신뢰하지 않는다. 날짜와 hash를 포함한 모든 필드는 해당 parser와 대조한다.

성공 봉투:

```json
{
  "contract": "timetable.v1",
  "schoolId": "현재 학교 ID",
  "memberId": "현재 소속 ID",
  "data": {}
}
```

오류 봉투:

```json
{
  "contract": "timetable.v1",
  "schoolId": "현재 학교 ID",
  "memberId": "현재 소속 ID",
  "error": { "code": "CONFLICT" }
}
```

허용 서버 오류 코드는 공통 계약의 `NOT_READY, FORBIDDEN, INACTIVE_MEMBERSHIP, INVALID_INPUT, NOT_FOUND, CONFLICT, IDEMPOTENCY_CONFLICT`다. 읽기 실패·응답 유실은 전송 어댑터가 별도 처리한다. SQL에서 원인별 세부 오류를 추가하려면 앱 parser도 함께 바꿔야 한다.

### 3.1 준비 상태

`workhub_timetable_readiness(p_member_id)`

data는 둘 중 하나이며 추가 키를 넣지 않는다.

```json
{ "available": true }
```

```json
{ "available": false, "reason": "basis_missing" }
```

reason은 `not_installed | basis_missing | not_allowed`다. 함수가 없거나 단순 표만 있는 상태를 성공으로 표시하지 않는다. 기본자료 부족 때문에 기존 일정·업무·문서 수합을 막지 않는다.

### 3.2 조회

`workhub_timetable_get(p_member_id, p_week_start)`

`p_week_start`는 ISO 날짜의 월요일이다. 응답의 `weekStart`는 요청과 같고 lessons 날짜는 그 주 월요일 이상, 다음 월요일 미만이다.

```ts
{
  basis: TimetableBasis | null,
  canDesign: boolean,
  canSave: boolean,
  drafts: TimetableDraft[],
  weekStart: string,
  lessons: PublishedLesson[]
}
```

- `canDesign=false`이면 반드시 `basis=null, drafts=[]`다. 전체 교사 명부·편성 원본이 일반 교사 조회에 섞이면 parser가 거부한다.
- `canSave=true`인데 `canDesign=false`인 조합은 거부한다.
- 일반 교사의 lessons는 **현재 승인된 본인 수업 관계로 서버에서 제한**한다. 이름이 같다는 이유로 소유권을 판단하지 않는다.
- 현재 parser의 drafts는 현재 basis ID·revision·sourceFingerprint에 맞는 검증된 초안만 받는다. 다른 기준판의 과거 초안은 이 배열에 섞지 않는다. 과거판 조회는 별도 API·UI 후속 계약이 필요하다.
- 현재 초안 저장은 전체 배치 검사를 통과한 후보만 지원한다. 미완성/충돌 초안의 서버 저장은 목표 운영 요구이며 이번 RPC에 몰래 추가하지 않는다. 편집 중 입력은 탭 메모리에 유지한다.
- 결과가 비어 있다는 것과 자료를 확인하지 못했다는 것을 구별한다. 권한·연결 실패를 빈 배열 성공으로 바꾸지 않는다.

`TimetableBasis`는 `schemaVersion,id,revision,schoolId,termId,sourceFingerprint,schoolLevel,unsupportedFeatures,resources,slots,lessons,courseLoads,fixed,unavailable,preferences` 키를 정확히 가진다. 세부 키·한도는 타입과 `packages/timetable/_assets/browser-policy.json`을 따른다.

자원의 종류는 `teacher | class | student_group | room | equipment`다. 선택수강 중첩은 필요한 실제 참여 집단이 모두 포함된 자원으로 표현되어야 한다. 학생 이름을 자원 label로 노출하지 않는다. 시간표가 충돌을 검사하려면 필요한 자원을 누락하지 않아야 한다.

`slots`는 요일과 실제 분 단위 시작·끝, 계산 시수를 가진다. 과목명이나 ‘3교시’ 문자열로 시수/실제 시각을 유추하지 않는다. 수업 회차의 `periods` 합계와 공식 `courseLoads`가 맞아야 한다.

`PublishedLesson` exact 키:

```ts
{
  id: string, version: number, date: string,
  startMinute: number, endMinute: number, label: string,
  teacherNames: string[], classNames: string[], roomNames: string[],
  status: 'scheduled' | 'changed' | 'cancelled'
}
```

임시 후보를 PublishedLesson으로 꾸며 넣지 않는다. 현재 API는 실시 여부를 다루지 않으며 예정 상태를 실시로 환산하지 않는다.

### 3.3 새 초안 저장

`workhub_timetable_save_draft(p_member_id, p_input, p_request_key, p_recover_only)`

```ts
p_input = {
  basisId: string,
  basisRevision: number,
  sourceFingerprint: string,
  title: string,
  conditions: {
    fixed: { lessonId: string, slotId: string }[],
    unavailable: { resourceId: string, day: number, startMinute: number, endMinute: number }[],
    preferences: { lessonId: string, slotId: string, weight: number }[]
  },
  placements: { lessonId: string, slotId: string }[]
}
```

성공 data는 추가 키 없이:

```ts
{
  requestKey: string,
  draftId: string,
  version: 1,
  basisRevision: number
}
```

**새 저장은 `p_recover_only=false`이며**, 항상 새 불변 초안을 만든다. 기존 초안을 UPDATE하지 않으며 같은 요청 재전송만 기존 receipt를 돌려준다. requestKey와 basisRevision이 요청과 정확히 맞아야 한다. 기존 저장 확인을 재조회하는 과정에서 기준자료가 바뀌었다고 신규 초안을 만들어서는 안 된다.

`recoverDraft`는 같은 RPC에 `p_recover_only=true`와 원래 명령/요청 번호를 보내 결과만 확인한다. 새 어댑터 인스턴스, 기초판 변경, 조회 실패 뒤에도 원래 명령으로 복구할 수 있다. 기존 원장에 없으면 `NOT_FOUND`이며 새 초안을 만들지 않는다. `p_recover_only`는 운송 제어값이므로 멱등 내용 지문에서 제외한다. false로 최초 저장한 요청을 true로 복구해도 같은 명령이다.

서버 순서는 다음과 같다.

1. 현재 승인·학교·활성 소속·시간표 작성 권한 확인.
2. 같은키 잠금/이미 처리된 동일 명령 조회. 같은키 다른 명령은 `IDEMPOTENCY_CONFLICT`. 기존 결과 조회는 최신 basis 검사보다 먼저 수행하며 현재 권한은 계속 검사한다. recover-only인데 원장이 없으면 `NOT_FOUND`로 종료한다.
3. 신규 요청이면 최신 기준자료판·출처 지문·원본 관계를 잠금 뒤 재확인. 달라졌으면 `CONFLICT`.
4. 학교 공식 fixed/unavailable가 그대로 포함됐는지 확인. 클라이언트가 완화·삭제할 수 없음.
5. 허용된 모든 조건·배치 키, 수업/자원 관계, 시수, 실제시각 중복, 용량, 허용 시간대를 서버에서 다시 검사.
6. 불변 후보·저장 기록·접수증·감사를 한 트랜잭션으로 커밋.
7. 응답 유실 후 같은키 재전송에는 같은 draftId/version을 반환.

클라이언트 hash가 맞는다는 이유로 승인하지 않는다. sourceFingerprint는 원본의 실제 ID·판·유효기간·시수·담당·일과·참여·공간·필수조건에서 서버가 만든 지문이어야 한다. 정규화와 hash 스키마를 문서화하고 PG 출력과 앱 fixture로 고정한다.

## 4. Claude setup/adjust 제안의 현재 exact 계약

현재 `assistant.ts`는 외부 Claude API를 직접 호출하지 않는다. 기존 승인된 비서 런타임에 이 typed context/proposal을 연결하는 후속 구현이 필요하다. 키·모델·가격·예산 변경을 포함하지 않는다.

서버는 클라이언트가 보낸 basis 전체를 권한 있는 원자료로 신뢰하지 않는다. 승인된 현재 학교·담당·기초판을 다시 읽어 같은 문맥을 구성하고 지문을 대조한다. 민감한 부재 사유·학생 실명은 AI용 자료에 넣지 않는다.

context는 `contract='timetable-assistant.v1'`, `stage='setup'|'adjust'`, `basisId,basisRevision,sourceFingerprint,contextFingerprint,prompt,basis,placements`다. setup에는 placements가 비어 있고 adjust는 유효 후보를 포함한다.

proposal exact 키는 `contract,stage,basisId,basisRevision,sourceFingerprint,contextFingerprint,summary,questions,changes`다. changes는 현재 다음 세 종류만 받는다.

- `{kind:'fix',lessonId,slotId}`
- `{kind:'block',resourceId,slotId}`
- `{kind:'prefer',lessonId,slotId,weight}`

미해결 questions가 있으면 적용하지 않는다. 사용자의 명시 확인, 현재 context 지문 일치, 조건·전체 후보 검증이 필요하다. AI가 임의 교사를 새로 만들거나 공식 fixed/unavailable를 제거할 수 없다. 질문·조건 초안 작성과 시간표 생성/저장/배포는 서로 다른 행동이다.

이 단계에는 확정 후 교환용 AI proposal이 아직 없다. 아래 날짜별 도메인으로 별도 설계한다. 범용 함수명·SQL을 AI 응답에 넣어 실행하는 경로를 추가하지 않는다.

## 5. 날짜별 변경의 순수 검증과 현재 운영 API

`operations-domain.ts`는 다음 **사전 검증**을 구현한다.

- canonical UTC 밀리초 시각의 실제 구간 `[startsAt,endsAt)`.
- 학교·basisRevisionId·전체 조회 revision과 원본 지문.
- 영구 날짜별 lesson ID·version·courseId·occurrenceKey와 서버가 승인한 `allowedSpans` 목적 시간대 목록. 전체 조회 범위 안에 있어도 이 목록에 정확히 없는 시간은 거부한다.
- 교사/집단/공간/학생 자원 ID·capacity·units. 교사와 학생 집단/학생 자원 최소 하나가 필수이며 교사만 있는 수업은 불완전 입력이다.
- 같은 수업 길이를 유지하는 move와 원래 시간의 순열인 swap.
- 두 교사 및 다자 교환, 같은교시 명칭이 아닌 실제 시각 충돌.
- 관련 교사 전원의 동일 proposal/base 지문 동의.
- 승인 담당자 현재 활성 여부·권한과 계정 단위 요청자 자기승인 거부.
- 조회 범위 불완전, 만료, 과거/실시/취소 수업, 학교·판 불일치 차단.

모든 report는 `serverRevalidationRequired:true`다. 브라우저에서 제공한 `canApprove,complete,consents`가 참이라는 이유로 서버 승인을 허용하지 않는다. 출처가 검증된 서버 원장을 읽어 안내할 뿐이다. 이 순수 함수는 **실제 동의 생성·서버 원자성·RLS·시수 원장 보존을 증명하지 않는다.**

`substitute,cancel,makeup`은 현재 validator가 `unsupported`를 반환한다. 전체 운영설계에 명시되어 있어도 이미 구현됐다고 평가하지 않는다.

현재 타입은 실명 대신 opaque 자원을 쓴다. 선택수강 검증용 전체 자원 snapshot을 일반 교사에게 노출할 필요는 없다. 서버 전용 검증 경로에서 읽고 교사에게는 필요한 충돌 설명과 본인/관련 수업만 반환한다. 이번 get의 teacher DTO를 운영 snapshot으로 강제 확대하지 않는다.

### 후속 SQL 원자성

실제 확정/교환 SQL은 아래 원자성을 보장하고, [운영 API 인계](operations-api.md)의 5개 RPC와 앱 parser에 맞춘다. 순수 도메인의 다자 교환까지 현재 두 수업 교환 API가 제공하는 것으로 확대하지 않는다.

1. 기준자료 확정판, 잠근 조건판, 후보판과 지문을 영구 참조.
2. 적용 기간 중복 방지와 부분 교체의 앞·대체·뒤 구간 보존.
3. 날짜별 수업·학생 기록의 영구 ID와 실시 이력 보존.
4. 교환 제안/수락/승인 상태, 정확한 source versions·proposal/base/participant 지문.
5. 관련 자원을 정렬하여 잠금. 출장/불가시간·수강/공간 변경·배포·교환이 동일 잠금 규약 사용.
6. 잠금 뒤 최신 권한·판·동의·실제시간·용량을 재조회. 한 수업이라도 충돌하면 전체 실패.
7. 승인과 반영, 점유·접수증·감사·알림을 같은 커밋으로 처리.
8. 기존키 재조회는 중복 이동/보강을 만들지 않음. readiness를 내려도 권한 있는 기존 결과 조회는 유지.
9. 최종 승인자가 요청자와 같은 account이면 대리 승인 필요. 다른 membership으로 우회 불가.
10. 취소/원복은 새 역변경. 실시 정정은 보상 원장. 이전 자료 삭제로 복원하지 않음.

교환 후 실제 시수 자동 확정, 대강 수당, 미응답 자동 수락 규칙을 임의로 넣지 않는다. 학교 승인 정책이 필요하다.

## 6. Claude에게 요청할 검토와 산출물

현재 SQL 1~7단계 작업은 계속하고 시간표는 의존성 목록과 매핑을 먼저 검토해 달라.

- 현재 3개 RPC에 대한 성공/오류 JSON을 먼저 만들어 실제 앱 parser에 넣어 대조.
- schoolAdmin/teaching 기준자료에 빠진 주당시수·일과·공간·참여 관계를 어떻게 승인하고 불변판으로 만들지 제시.
- fixed/unavailable 공식 필수조건의 서버 보존과 잘못된 배치 직접 RPC 호출 거부.
- 새 초안 저장의 동일키·다른명령·기준판 경합·응답 유실 재전송 시험. recover-only의 기존 결과 반환, 원장 없음 NOT_FOUND, 기준판 변경 뒤 원래 결과 반환, 새로운 초안 0건을 함께 확인.
- 날짜별 운영은 별도 `timetable-operations.v1`의 exact API로 구현. 앱 사전 검증 통과를 서버 검증 생략 사유로 쓰지 않음.
- Claude 초기 세팅·후보 조정·확정 후 교환의 질문/제안 흐름을 위 경계로 설계. 모호한 이름·기간·필수여부를 질문으로 남김.
- 설치 전후 기존 회원·로그인·제출·파일·R0/R1·전체 시범 모듈 보존 지문.
- PostgreSQL 17의 두 연결 경합 시험, 실제 PostgREST 출력 대조, 실제 Supabase 검증 여부를 분리한 결과.
- 준비 안 된 기능은 비활성 상태. 계란님 적용/공개 승인 이전 자동 실행·병합·배포 설정 변경 없음.

표만 설치한 단계, 3개 앱 RPC 연결 단계, 날짜별 교환 운영 가능 단계를 각각 구분해 보고한다. 시간표 전체가 ‘오류 없음’이라고 단정하지 말고 어떤 범위·조건·회귀·실제 환경까지 확인했는지 제시한다.

## 식별자와 표시 이름의 공통 계약

### PR #65 운영 실행 확장

전체 학기 확정은 [publication-execution-api.md](publication-execution-api.md), 행사·휴업·특별일과는 [school-day-execution-api.md](school-day-execution-api.md)의 별도 exact 계약을 따른다. 두 흐름의 앱·전송·복구 구현은 완료했으며 SQL은 아직 없다. 기존 `timetable-operations.v1`/`next.v1` 응답 모양을 변경하지 않는다. 모든 확정/교환/학사 변경은 같은 자원 잠금 규약을 사용하고, 만료·기준 변경 검사는 새 명령에 적용하되 권한 있는 원래 접수증 조회는 유지한다. 화면만 검사했다는 이유로 서버의 자원 용량·전체 영향·동의·권한 재검사를 생략하지 않는다.

### 공통 식별자

기초판·학교·학기·자원·시간대·활동·수업(`courseId`) 식별자 및 모든 참조는 앱 공통 RPC와 동일하게 `^[A-Za-z0-9_-]{1,100}$`를 만족해야 한다. 기존 DB의 UUID를 사용할 수 있으며, 합성 키는 영문·숫자·밑줄·하이픈으로만 구성한다. 한글·콜론·공백이 든 문자열은 ID로 반환하지 않는다. 표시 이름(`label`)과 미지원 기능 설명(`unsupportedFeatures`)은 별도의 한국어 문자열이며 ID 제한을 적용하지 않는다. 서버 기초 자료 생성·저장·복구·AI 제안 경로가 모두 같은 ID 규칙을 사용해야 한다.
