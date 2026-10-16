# T1 학교 편성 자료 준비 계약

앱은 공식 학교 자료 조회 → 시간표 준비 초안 → 담당자 확인 → 새 편성 기준판을 구현했다. SQL은 아직 작성·적용하지 않았다. Claude는 아래 RPC를 T1의 증분 SQL로 작성하고, 실제 출력은 `preparation.ts`와 `preparation-server.ts`에 대조한다. 기준판 생성과 학기 시간표 공개는 서로 다른 명령이다.

## 범위와 자료 소유

- 교사·학급·교과·공식 교사 배정·학생 수강 관계는 기존 학교 관리/P5 자료를 읽는다. 준비 화면에서 관계를 새로 만들거나 수정하지 않는다.
- 공식 기준 시수가 있는 수업은 그대로 사용한다. 공식 시수가 `null`인 수업에만 담당자가 시간표 준비용 시수를 입력한다. 이 입력은 공식 학교 배정을 고치지 않는다.
- 실제 학기 날짜, 교시 시각, 연속수업 길이는 추정하지 않는다. 초기 준비 초안의 시간대와 활동은 비어 있다.
- 이번 계약은 새 기준판을 만드는 경로다. 기존 기준판·공개 시간표·이미 승인된 임시 변경을 덮어쓰지 않는다. 기준판 생성 후 기존 시간표 조회 경로가 새 작업 기준판을 반환하도록 연결하되, 공개판은 별도 확정 절차를 유지한다.
- 준비 기준판의 `fixed`, `unavailable`, `preferences`는 비어 있다. 다음 조건 정리 단계에서 조건을 수집한다. 기존 학교 필수조건이 있는 판을 이 경로로 자동 교체하거나 삭제하지 않는다.
- 교과 선택군·분반·공동수업 등 현재 자료로 정확히 표현할 수 없는 요구는 `unsupportedFeatures`에 명시한다. 해당 값이 있으면 앱은 확정을 막는다. 필수 관계를 빼서 편성 가능한 것처럼 만들지 않는다.

## 공통 응답

계약 이름은 `timetable.preparation.v1`이다. RPC는 기존 승인·학교 소속 검증을 이용한다.

```json
{
  "contract": "timetable.preparation.v1",
  "schoolId": "학교 ID",
  "memberId": "소속 ID",
  "data": {}
}
```

오류는 `data` 대신 `"error":{"code":"CONFLICT"}`를 반환한다. 허용 코드는 공통 `ServiceCode`와 같다. 필드의 누락·추가, 다른 학교/소속 응답은 거부한다. ID는 공통 `identifier` 규칙, 날짜는 실제 ISO 날짜, 지문은 소문자 SHA-256 64자리, 판 번호는 1 이상의 정수다.

## 공식 원본과 저장 초안 조회

`workhub_timetable_preparation_get(p_member_id)`의 `data`는 다음 exact 구조다.

```ts
{
  sourceRevision: number,
  sourceFingerprint: string,
  schoolId: string,
  schoolLevel: 'primary' | 'middle' | 'high' | 'other',
  termId: string,
  termLabel: string,
  firstDay: 'YYYY-MM-DD',
  lastDay: 'YYYY-MM-DD',
  canEdit: boolean,
  canConfirm: boolean,
  resources: {
    id: string,
    kind: 'teacher' | 'class' | 'student_group' | 'room' | 'equipment',
    label: string,
    capacity: number
  }[],
  courses: {
    id: string,
    label: string,
    requiredPeriods: number | null,
    resourceIds: string[]
  }[],
  unsupportedFeatures: string[],
  savedDraft: null | {
    id: string,
    revision: number,
    sourceFingerprint: string,
    draft: PreparationDraft
  }
}
```

- `canConfirm: true`이면 `canEdit: true`여야 한다. 두 값은 서버가 현재 권한으로 계산한다.
- 교사·학급·수강집단 capacity는 1이다. 교실·장비는 실제 동시 수용량을 사용한다.
- `course`는 같은 교과 전체가 아니라 같은 공식 담당과 수강집단이 수업하는 배정 단위다. 다른 학급의 시수를 한 개 과목 ID에 합치지 않는다.
- `resourceIds`는 현재 학기·날짜 범위에 유효한 공식 배정을 반영한다. 없는 ID를 참조하면 응답이 거부된다.
- `sourceRevision/sourceFingerprint`는 학기·학교 단계·자원·수업 배정·공식 시수·지원 불가 조건의 의미 있는 변경을 포함해야 한다. 동일 순서의 배열을 안정적으로 반환한다.
- 저장 초안의 지문이 최신 지문과 다를 수 있다. 앱은 과거 초안을 보관한 채 충돌을 표시하고 저장·확정을 막는다. 담당자가 확인하여 현재 공식 자료로 다시 시작할 때까지 조용히 초기화하지 않는다.
- 저장 초안은 다른 학기의 초안이 섞이지 않도록 학교/학기 범위로 반환한다.

## 준비 초안 구조

```ts
type PreparationDraft = {
  title: string,
  slots: {
    id: string,
    day: number,       // 월 1 ~ 일 7
    label: string,
    startMinute: number,
    endMinute: number,
    periods: number
  }[],
  plans: {
    courseId: string,
    weeklyPeriods: number,
    blocks: {
      id: string,
      periods: number,
      allowedSlotIds: string[]
    }[]
  }[]
}
```

제한값 원본은 `packages/timetable/_assets/browser-policy.json`이다. 숫자를 SQL과 따로 관리하지 말고 시험에서 일치 여부를 검사한다. 시간대 시작은 0~1439분, 종료는 1~1440분이며 시작보다 커야 한다. 연속수업의 `periods`는 전체 실제 시간대의 차시 수다. 학년별 종이 다르면 별도 시간대를 만들고 해당 수업의 허용 시간대를 다르게 지정한다.

공식 수업마다 정확히 하나의 plan을 가진다. 슬롯 ID, course ID, 전체 활동 ID는 각각 중복되지 않는다. 활동의 허용 시간대는 존재해야 하며 차시 수가 같아야 한다. 공란 시간대·활동, 시수 0은 미완성 초안 저장에서 허용한다. 공식 `requiredPeriods`가 있는 plan의 시수를 바꾸거나 숨은 교사 배정 필드를 추가할 수 없다.

## 저장·기준판 생성

RPC:

```ts
workhub_timetable_preparation_execute({
  p_member_id: string,
  p_request_key: string,
  p_recover_only: boolean,
  p_input: {
    kind: 'save' | 'confirm',
    sourceRevision: number,
    sourceFingerprint: string,
    termId: string,
    draftId: string | null,
    expectedDraftRevision: number | null,
    draft: PreparationDraft
  }
})
```

새 초안은 draft ID/판이 모두 null이다. 기존 초안은 두 값을 함께 보낸다. 새 명령은 학교 범위, 역할, 공식 원본 판/지문, 대상 초안의 소유 범위·현재 판을 하나의 트랜잭션 안에서 다시 확인한다. 준비 초안에 대한 동시 저장을 잠그고, CAS 실패는 `CONFLICT`로 처리한다.

`save`는 구조가 유효한 미완성 초안을 저장한다. `confirm`은 구조에 더해 다음을 모두 통과해야 한다.

1. 수업별 주간 시수와 활동 차시 합계가 일치하고 0이 아니다.
2. 공식 담당 교사와 학급 또는 학생 수강집단이 존재한다.
3. 활동마다 허용 시간대가 있으며 시간대 차시와 일치한다.
4. 전체 기준판이 `validateBasis`를 통과한다.
5. 각 교사·학급의 실제 겹침을 제외한 허용 시간대 상한이 배정 시수보다 적지 않다.
6. 표현하지 못하는 필수 요구가 없다.

상한 점검은 배치 가능성의 필요조건이지 해의 존재 증명은 아니다. 실제 시간표 생성은 이후 엔진이 수행한다.

성공 `data`:

```ts
{
  requestKey: string,
  kind: 'save' | 'confirm',
  draftId: string,
  draftRevision: number,
  sourceFingerprint: string,
  basis: TimetableBasis | null
}
```

초안 판은 `expectedDraftRevision + 1`(신규 1)이어야 하며 기존 draft ID는 바뀌지 않는다. `save`의 basis는 null이다. `confirm`의 basis는 `compilePreparation(source, draft, serverBasisId, serverBasisRevision)`와 전체 내용이 같아야 한다. 서버가 발급하는 기준판 ID/판을 제외하고 교시·교사·수업명·시수·허용 시간대·자원 정보 등을 임의로 바꾸지 않는다. 초안 저장, 기준판 생성, 요청 접수증은 함께 커밋한다.

## 응답 유실·재전송

- 요청 키를 학교/소속/명령 내용에 묶는다. 같은 키+같은 내용은 같은 접수증을 돌려주고, 다른 내용은 `IDEMPOTENCY_CONFLICT`다.
- `p_recover_only: true`는 최초 접수증 조회 전용이다. 접수증이 없으면 `NOT_FOUND`이고 새 저장/확정을 실행하지 않는다.
- 접수증 조회는 최신 준비 자료 조회 또는 새 기능 쓰기 가능 여부에 종속시키지 않는다. 현재 로그인·학교 소속의 접근 권한은 확인한다.
- 앱은 원래 input·request key와 **당시 공식 원본 snapshot**을 같은 탭의 pending 저장소에 보관한다. 새 어댑터 인스턴스에서도 당시 원본으로 전체 basis를 다시 계산해 복구 응답과 대조한다. snapshot은 검증용 로컬 문맥이며 RPC의 `p_input`에 추가하지 않는다.
- 시간초과·불완전 응답·연결 오류를 저장 실패로 단정하지 않는다. 화면에서 원래 요청 결과 확인을 제공하고 입력을 보존한다.
- 현재 탭 메모리 보존이며 브라우저 종료·새로고침 후 복원을 약속하지 않는다. 로그인·학교·소속 범위가 바뀌면 이전 자료를 노출하지 않는 기존 범위 규칙을 따른다.

## UI와 검증 경계

학교 연결에서 준비 패널을 연 때만 조회한다. RPC 미설치는 준비 중으로 표시하고 연습 자료를 공식 자료로 저장하지 않는다. 원래 결과 미상 요청은 패널 상태와 별개로 복구 경로를 유지한다. 화면에서 아직 추가하지 않은 교시 이름·시각도 탭 재연결에 보존한다.

자동 검증: `tests/test_workhub_timetable_preparation.mjs` 18건, `tests/browser/workhub-timetable-preparation.mjs` 8건. 브라우저는 실제 React·전송 어댑터를 사용하며 RPC 응답은 합성이다. 실제 PostgREST/RLS/동시 트랜잭션은 아직 검증하지 않았다. SQL 작성 후 실제 SQL 출력 대조와 동일 키·판 충돌·다른 학교·교사 변경·응답 유실 회귀가 필요하다. SQL 적용·일반 교사 공개·비용 설정은 이 앱 구축에 포함하지 않는다.
