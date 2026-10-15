# W11~W13 수업·학생·평가·활동 연동 — 연결 계약과 SQL 요청

작성: 2026-10-16. 이 문서는 **새 SQL 확정본이나 적용 완료 보고가 아니다.** Codex가 구현한 `apps/workhub/src/teaching/`의 실제 RPC 계약을 Claude SQL 작업에 인계한다. 기존 `students/` 합성 미리보기와 분리되어 있으며 시간표 기능을 사용하지 않는다. SQL 확정·적용과 기존 자료 보존은 기존 역할 분담을 따른다.

## 1. 구현과 적용 상태

| 범위 | 앱에서 구현한 것 | 외부 의존/완료 조건 |
|---|---|---|
| 학교 내 학생·수강 | 안정 학생키를 포함한 UTF-8 CSV, 전체 확인, 기간별 명부, 기존 학생 대조 | 학교/학기/교과/교사 기반과 아래 SQL 필요 |
| 수업·교사 담당 | 관리자에게만 수업·학기·교과·기간·교사 등록 폼 | 서버 `canManageCourses` 및 승인 교사 목록, 학교 관계 FK 필요 |
| 관찰 | 작성자 전용 사실 기록, 날짜, 정정 사유·기대판, 철회 | 원문 개정본·접수증·현재 권한 검증 |
| 상담 | 별도 RPC, 명시적 열기, 별도 권한, 후속일·정정·철회 | 관찰 조회/검색/생기부 근거와 분리된 권한 필요 |
| 평가 | 루브릭판, 항목 상태, 0점, 결시/미제출/미확인, 코드 합계, 교사 확인 | SQL의 동일 계산·루브릭판/항목 FK·확정 검증 |
| 디지털윤리 CSV | 실제 dilemmas/grading 헤더, 원문·질문판, 수동 학생 연결, 보류/제외/채택, 재연결/철회, 관찰 근거 채택 | 원문판·연결판·활동 회차·중복 접수·하위 근거 무효화 트랜잭션 |
| 생기부 근거 | 본인 관찰/확정 평가 의견만 선택, 문장-근거판 검사와 UTF-8 측정, `onRequestStudentDraft` 연결 API | Claude 생성·규칙·검토·출력 흐름과 연결 필요. 이 문서만으로 AI 생성 완료가 아님 |

실제 Supabase에 위 수업 RPC는 이 작업에서 적용하지 않았다. 서버 미준비/조회 실패이면 실제 자료 연결 안내를 표시하며 합성 학생을 넣지 않는다. 예시 답변·성공 상태로 기능이 완료된 것처럼 보이지 않는다.

## 2. 코드와 버전

- 계약: `contracts.ts`, `validation.ts`, `commands.ts`.
- 실제 연결: `adapter.ts` → 기존 `connection.rpcVerified`. 새 인증 인스턴스/토큰/Service role을 만들지 않는다.
- 화면: `TeachingWorkspace.tsx`, `editors.tsx`, `ImportPanel.tsx`, `ActivityReview.tsx`, `ActivityCorrection.tsx`.
- CSV/한도: `csv.ts`, `policy.json`; 평가 계산: `assessment.ts`; 생기부 근거: `evidence.ts`.
- SQL과 앱이 맞출 명시 버전은 **`teaching.v1`**. 예상하지 않은 버전은 이용 가능으로 보지 않는다.
- `policy.json`의 한도는 앱의 입력/응답 방어 한도다. DB 권한 정책을 대체하지 않는다. 학교별 정책이 추가되면 더 엄격한 쪽을 적용한다.

## 3. RPC 목록

모든 공개 함수는 `authenticated`에만 실행을 허용하며 본인 승인·활성 학교 소속을 매번 확인한다. 클라이언트가 보내는 값 중 권한 근거는 없다. `p_member_id`는 요청 범위를 지정할 뿐이고 `auth.uid()`와 실제 소속의 연결을 서버가 확인한다. 읽기 함수에는 비밀키가 필요 없다.

| 함수 | 인자 | 결과 타입 |
|---|---|---|
| `workhub_teaching_catalog` | `p_member_id` | `TeachingCatalog` |
| `workhub_teaching_course` | `p_member_id`, `p_course_id` | `CourseSnapshot` |
| `workhub_teaching_student` | 위 + `p_student_id`, `p_cursor`(NULL/불투명문자열) | `StudentSnapshot` |
| `workhub_teaching_counseling` | 위와 동일 | `CounselingSnapshot` |
| `workhub_teaching_activity` | `p_member_id`, `p_course_id`, `p_import_id` | `ActivitySnapshot` |
| `workhub_teaching_rubric_revision` | `p_member_id`, `p_course_id`, `p_rubric_id`, `p_revision_id` | 공통 봉투 + `{rubric:Rubric}` |
| `workhub_teaching_mutate` | `p_member_id`, `p_command`(아래 판별명령), `p_request_key` | `MutationReceipt` |

### 성공 응답 공통

```json
{
  "contractVersion": "teaching.v1",
  "schoolId": "school-id",
  "memberId": "member-id",
  "ownerUserId": "authenticated-user-id"
}
```

공통 봉투의 owner는 이 요청을 한 실제 사용자를 뜻한다. 개인 본문의 owner는 모두 같은 사용자인지 다시 확인한다. 학교 관리자라는 이유로 타 교사의 관찰·상담·평가·활동 원문을 한 목록에 넣지 않는다. 학교 명부와 개인 본문의 권한이 다르다.

### 확정된 업무 오류

함수 자체가 명령을 적용하지 않은 것을 확정할 때만 **위 성공 응답과 같은 contractVersion/schoolId/memberId/ownerUserId 봉투에** `ok:false, code:"INVALID_INPUT"`을 덧붙여 반환한다. 봉투가 없거나 다른 범위인 오류는 확정 거절로 신뢰하지 않는다. `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `UNAVAILABLE`도 허용한다. 내부 SQL 원문, 학생 본문, 스택/키를 메시지에 넣지 않는다. 알려지지 않은 쓰기 오류·손상된 성공 응답은 앱이 `SAVE_UNCERTAIN`으로 처리한다.

- RPC 전송 오류, 응답 끊김, 성공 봉투 검증 실패: 명령과 원래 요청번호를 그대로 보관한다.
- 최초 시도의 확정 `INVALID_INPUT/NOT_FOUND/CONFLICT/FORBIDDEN`: 접수되지 않은 것으로 안내하고 입력을 유지한다.
- 이미 결과 미확정이었던 요청의 재시도에서 거절을 받았다고 이전 저장이 없었다고 단정하지 않는다. 기존 pending을 유지한다.
- `QUERY_FAILED`를 ‘기록 0건’으로 바꾸지 않는다.

## 4. 조회 DTO

정확한 필드·nullable은 `contracts.ts`/`validation.ts`가 실행 가능한 원본이다. 아래는 SQL 작성 시 빠뜨리기 쉬운 조건이다.

### 카탈로그

`courses`, `terms`, `subjects`, `approvedTeachers`, `canManageCourses`.

- `Course`: `id/schoolId/version/label/termId/subjectId/assignmentId|null/validFrom/validThrough/canRecord/canCounsel/canManageRoster`.
- `canRecord`와 `canCounsel`이 true인 수업에는 이 사용자의 유효한 `assignmentId`가 있어야 한다.
- 수업 생성/담당 승인 권한이 없는 사용자에게 `approvedTeachers`는 빈 배열이다.
- `Term`에는 `id/schoolId/version/label/firstDay/lastDay`.
- 각 수업의 term/subject는 같은 응답의 학교 기준표에 있어야 한다.
- 시간표 편성·시수 알고리즘과 독립이다. 담당 권한을 편성 결과에서 추측하지 않는다.

### 수업 상세

`course`, `students`, `rubrics`, `imports`.

학생은 `id/schoolId/version/schoolStudentKey/name/grade/classLabel/seatNumber/enrollmentId/courseMembershipId/validFrom/validThrough`. 학교 내부 학생 ID는 불변이며 이름·학년반·번호·외부 별명과 다르다. 학교내학생번호는 학교 내 안정 외부키로 사용하고, 같은 키의 이름/학적이 바뀌면 재확인·정정판으로 처리한다. 같은 학생키를 다른 학생으로 재사용하지 않는다.

루브릭은 작성자 전용이다. `revisionId`, `criteria[{key,label,maximum}]`, `archived`가 있으며 예전 평가가 가리킨 판을 UPDATE하지 않는다. 평가 정정 화면은 현재 기준 목록에 당시 판이 없으면 `workhub_teaching_rubric_revision`으로 정확한 rubricId/revisionId를 별도 조회한다. 사용 종료된 archived=true 판도 당시 평가 정정에 표시할 수 있지만 신규 평가의 기준으로 선택하지 않는다. 다른 판으로 바꿔 덮어쓰거나 재구성하지 않는다. 서버는 현재 호출자·수업·학생 기록의 과거판 열람 권한을 재확인한다.

활동 요약은 `id/schoolId/version/courseId/ownerUserId/label/occurredOn/fileHash/adopted/held/excluded/state/supersededByImportId`. **권한을 확인한 본인 활동만** 반환한다. 조회 한도를 넘어 잘라 놓고 전체 건수로 표현하지 않는다. 큰 학교의 담당 수업/오래된 활동에는 명시적 서버 페이지 계약을 추가한 뒤 앱과 함께 배포해야 한다.

### 학생 기록과 상담

관찰/평가 응답은 `courseId/studentId/observations/assessments/nextCursor`. 상담은 **별도** `courseId/studentId/records/nextCursor`. 각 묶음은 응답당 최대 100건이며 cursor가 있으면 ‘이전 기록 더 보기’로 이어진다. 커서는 school/owner/course/student/정렬/유효기간에 묶이고 다른 범위에 재사용하면 거부한다. 안정 정렬과 ID tie-break를 사용하며 중복/빠진 페이지를 만들지 않는다.

관찰·상담의 공통 필드: `id/schoolId/version/ownerUserId/courseId/studentId/courseMembershipId/assignmentId/revisionId/occurredOn/text/state(active|withdrawn)/contentHash/epoch`. 관찰 `kind=observation`, 상담 `kind=counseling`와 `followUpOn`(빈 문자열 허용).

평가: 같은 본인/학생/수강/담당/판 범위 + `rubricId/rubricRevisionId/occurredOn/comment/scores/confirmed/state/total/contentHash/epoch`.

`Score = {criterionKey,state,points}`이며 상태는 `scored/absent/missing/unconfirmed`. scored에만 유한한 0 이상 소수 둘째 자리까지 점수, 나머지는 **NULL**이다. 모든 항목이 scored일 때만 total을 정수 센트 단위 합산/100으로 계산하고 그 외 total은 NULL. 결시나 미제출을 0점으로 변환하는 정책을 임의로 만들지 않는다. `unconfirmed`가 있으면 confirmed=true 불가. 서버도 루브릭 항목별 만점·중복·누락·다른판 항목을 검사한다.

## 5. 명령과 원자적 효과

| kind | 핵심 입력 | SQL에서 한 트랜잭션으로 보장할 것 |
|---|---|---|
| `course_create` | label, termId, subjectId, teacherMemberIds[], validFrom/Through | 관리 권한, 학기 내 기간, 같은 학교 승인 회원/교과, 수업·담당 연결 |
| `roster_import` | courseId, expectedVersion, rows[], validFrom/Through | roster 권한, 동일 학생키 중복/학급자리 중복, 학교 수준 학년, 기존 안정 학생키 대조, 학적/수강 기간, 목록 원자 반영. 파일에서 빠진 학생 삭제 금지 |
| `observation_save` | 학생/수강/담당/recordId|null/expectedVersion, 날짜·text·reason | 새 머리+불변판+포인터+epoch; 날짜가 수강/담당 기간 안인지. sourceActivity는 별도 아래 설명 |
| `counseling_save` | 위 + followUpOn | 독립 상담 권한을 추가 검증. 관찰·생기부 근거표에 링크 금지 |
| `record_withdraw` | recordKind, recordId, expectedVersion, reason | 작성자/원본 범위, 철회사건/새 판/epoch/하위 검토 무효화. 물리삭제 아님 |
| `rubric_save` | rubricId|null, expectedVersion, label, criteria[] | 본인 수업, 기존 평가판 보존, 새 루브릭판. criteria key는 `criterion-숫자` |
| `assessment_save` | 학생/수강/담당/recordId|null/expectedVersion/루브릭판/날짜/점수/의견/confirmed/reason | 항목 FK·만점·NULL·합계·교사 확정, 새 판, 연결된 생기부 재검토 |
| `activity_import` | courseId, assignmentId, expectedVersion, input | 원문 파일지문/행/질문판 검증, 활동회차/원문판/수동 연결/접수증. 예상과 다르면 부분 반영 없이 거절 |
| `activity_review` | courseId, importId, itemId, expectedVersion, disposition, studentId|null, courseMembershipId|null, reason | 원문판 유지, 새 학생 연결판/처리사건, 이전 근거 무효화. adopt만 학생·수강 필수, hold/exclude/withdraw는 둘 다 NULL |

새 기록/루브릭/평가의 expectedVersion은 0이다. 정정은 양수와 사유를 요구한다. 다른 사람의 변경이나 원문 변경은 last-write-wins로 덮어쓰지 않는다.

### 접수증

`MutationReceipt`: 공통 봉투 + `requestKey`, `commandKind`, `entityId`, `version`, `outcome(applied|replayed)`, `appliedAt`.

접수 원장은 `(학교,실제 소유자,명령 namespace,request_key)`로 범위가 고정된다. 같은 키+정규화 같은 내용은 **기존 접수증**을 반환하고 다른 내용은 `IDEMPOTENCY_CONFLICT`. 서버가 만든 entity ID와 기록판을 새로 만들지 않는다. 원장에는 학생 본문을 중복 복사하지 않는다. 권한 재검증/원장 재생 순서와 해지 상태의 조회 정책을 명확히 정해야 하며, 권한 거절로 기존 성공을 실패로 재분류해서는 안 된다.

## 6. 기간·관계·개인 기록 무결성

1. 모든 공용/개인 관계는 `school_id`와 필요한 `owner_user_id`를 포함한 복합 FK/유니크로 강제한다.
2. 기존 users/auth.users와 학교 소속은 재생성하지 않는다. 안정 학생 ID는 학교 범위에만 있고 전국 학생 통합키를 만들지 않는다.
3. 학적 학급과 수업은 다르다. 선택과목/이동수업은 여러 학급의 학생을 포함할 수 있으며 권한은 `courseMembershipId`가 증명한다.
4. 수강/학적/담당의 학생·수업·학교·날짜가 모두 같아야 한다. 이름/학급 문자열로 맞추지 않는다.
5. 앱 `validFrom/validThrough`, 학기 `firstDay/lastDay`는 **양 끝 포함** DTO다. 서버의 `[시작,종료제외)` 기간은 조회/명령 경계에서 변환한다. 기존 R0 소속 날짜를 일괄 수정하지 않는다.
6. 상담권한은 관찰권한·관리자역할로 대체하지 않는다. 상담 존재 여부·개수·본문도 일반 학생 조회/AI 문맥/학교 전체 검색에 섞지 않는다.
7. 기록 owner는 서버 세션에서 정하고 절대 양도하지 않는다. 교사 업무 인계는 개인 상담·관찰 자동 양도가 아니다.
8. 정정/철회/학생 연결 변경은 현재 원본 epoch를 증가시키며 하위 평가·생기부의 리뷰 표시만 지우는 데 그치지 않는다. 출력 명령은 실제 조상 원본을 동기 재검사한다.

## 7. 실제 디지털윤리 CSV 프로필과 원문 보존

2026-10-16 바탕화면 `디지털 리티러시/public/teacher.js`를 **읽기 전용으로** 확인했다.

- `dilemmas`: 자리번호·별명, 현재 단계, 성찰 완료 + fieldLabels 17개. 선택 코드와 빈 답변을 임의 해석하지 않는다.
- `grading`: 자리번호·별명, 현재 단계, 제출 여부, 나의 결정, 직접 제안, 선택한 근거, 근거를 고른 이유, 다른 사람, 영향, 필요한 조건, 심화 (평가 제외).
- BOM·CRLF·인용부호·쉼표·셀 안 줄바꿈·수식 보호 선행 작은따옴표를 보존한다. `rawCsv` 자체는 바꾸지 않고 parsed cell은 해석된 별도 값이다. UTF-8 SHA-256은 **BOM을 포함한 원문 bytes** 기준이다.
- 파서는 `digital-ethics.csv.v1`. 정해진 전체 헤더와 순서가 다르면 거절한다.
- 현재 외부 앱에는 `privacy-mixed/privacy-simple`도 추가되어 있다. 이 두 프로필은 이번 앱 계약에 넣지 않았으며 기존 grading으로 추정 변환하지 않는다. 실제 질문/헤더 fixture를 확정한 확장판이 필요하다.
- 별명/자리번호/CSV 행번호/파일명의 방코드는 영구 학생/활동 ID가 아니다. 수업·실제 활동일·활동회차명·질문판·질문/선택지 원문을 교사가 확인한다.
- 같은 수강학생으로 여러 CSV 행을 연결할 경우 각 행마다 확인 사유가 필요하다. 서버도 의도치 않은 중복 매핑을 자동 승인하지 않는다.
- 최초 import의 같은 scope + 원문 hash + 동일 활동 회차는 중복 방지해야 한다. **활동 식별의 최종 서버 규칙**: course/owner/occurredOn/label/questionVersion/questionSnapshot hash를 비교해 명시적으로 같은 활동 회차를 판정하고, 같은 식별에 다른 질문판이면 충돌로 돌려보낸다. 별명이나 행순서만으로 원문 수정판을 합치지 않는다.
- 일반 `activity_import`의 `supersedesImportId`는 NULL만 허용한다. 원문 정정은 아래 별도 `activity_correct` 명령만 사용하며 이전 모든 행의 명시적 대응/추가/제외 사유가 필요하다. 기존 import의 학생 연결만 고치는 경우는 activity_review를 쓴다.
- `심화 (평가 제외)`는 원문/관찰자료로 남길 수 있으나 `assessmentActivityCells()`에서 평가 근거 목록을 만들 때 제외한다. 상태열/별명도 점수 근거로 자동 사용하지 않는다.

`ActivitySnapshot`은 import 메타데이터+고정 headers+items 및 `version`, `state:active|superseded`, `supersedesImportId:null|id`, `supersededByImportId:null|id`를 돌려준다. active면 후속판 ID=null, superseded면 후속판 ID 필수이며 자기 자신을 가리키지 않는다. 정정 전 원문은 화면에서도 읽기 전용이다. 각 item의 id/version/revisionId/mappingVersion, 학교/owner/course/import, raw values/alias/rowNumber, disposition, 학생/수강 FK, reason을 모두 검증한다. 최대 500행이며 전체 원문을 자동 공개 검색에 넣지 않는다.

### 활동 → 관찰 채택

기존 활동에서 관찰 작성 버튼을 누르면 새로운 observation_save에 선택적으로 `sourceActivity:{itemId,itemVersion}`가 포함된다. **observation 신규 생성에만** 허용하며 상담/기존 관찰 정정에는 넣지 않는다. 서버는 다음을 같은 트랜잭션에서 검사한다.

- 활동 item의 현재판·연결판·학교·owner·수업·실제 학생·수강이 요청 관찰과 일치.
- disposition=adopt이고 철회/파기/재검토 상태가 아님.
- 해당 활동 날짜와 관찰 날짜의 정책을 검사하며 다른 학생의 원문을 복사하지 않음.
- 관찰의 불변판과 활동 근거 링크를 함께 생성. 입력 text는 교사가 확인한 내용이며 원문을 검토 없이 평가 확정하지 않음.
- 이후 activity_review로 연결/철회 변경 시 채택 관찰과 하위 결과를 stale로 표시하고 정상 출력 차단.

## 8. 생기부·Claude 연결 접점

`TeachingWorkspaceProps.onRequestStudentDraft(source)`를 연결하면 ‘활동·근거’ 탭에 체크박스와 **선택한 근거로 생기부 초안 작성** 버튼이 나타난다.

```ts
interface StudentDraftSource {
  schoolId: string
  memberId: string
  studentId: string
  courseId: string
  evidence: Array<{
    kind: 'observation' | 'assessment'
    id: string
    revisionId: string
    sourceHash: string
    epoch: number
    start: number
    end: number
  }>
}
```

- 학생 본문이나 상담을 콜백에 싣지 않는다. AI 서버는 현재 사용자/학교/학생 권한으로 해당 판을 다시 조회한다.
- 관찰은 active 본인 기록, 평가는 active + confirmed + 비어 있지 않은 교사 의견만 허용한다. 둘 다 `sourceReviewRequired === false`일 때만 AI 근거로 선택한다. 이 boolean은 학생 기록 응답의 필수 필드이며 값이 없으면 안전하다고 추정하지 않는다.
- 근거 구간은 Unicode 코드포인트다. UTF-8 바이트 수와 문자열 index를 혼용하지 않는다.
- `validateSentence()`는 현재 근거의 ID/판/hash/epoch/구간을 비교한다. 이 클라이언트 도구로 서버 출력 검증을 대신하지 않는다.
- 공식 규칙파일/판이 없으면 ‘규칙 미확인’이고, UTF-8 측정만으로 공식 입력 한도 준수나 NEIS 입력 완료를 표시하지 않는다.
- callback 미연결이면 실제 생성 버튼을 노출하지 않는다. AI 생성·문장 근거 검토·판별 저장·출력은 통합 문서 AI 작업에서 마무리한다.

## 9. SQL 필수 검증 시나리오

- 미승인/비활성/타 학교/타 회원/타 owner/과거 담당을 통한 쓰기 거부. 현재 학생목록을 읽는 권한과 과거 정정권한을 구분.
- 관리자에게 타 교사 관찰/상담의 본문·존재·건수가 새지 않음.
- 학교별 안정학생키·기간 학적·개별 수강·담당 FK 불일치 거부.
- 초/중/고 학교 수준 학년 범위, 같은 학급 자리 중복, 교사 담당 기간 겹침 규칙.
- CSV malformed/중복/원문 지문 불일치/파일 누락행 삭제 금지/전체원자성.
- 동일 키 재시도, 응답 손실 후 재시도, 같은 키 다른 본문, 동시 기대버전 충돌.
- 정정/철회 원본 보존, 다른 기록의 revision 연결 거부, revoked/withdrawn의 재활성화 우회 금지.
- 평가 0/결시/미제출/미확인, 전체항목 누락/중복, 다른 루브릭판 항목, NaN/Infinity/음수/소수자리/만점/합계, 미확인 상태의 confirmed 거부.
- 활동 source 재연결/철회 후 관찰·평가·생기부 정상출력 차단. 생기부 상담 근거 지정 거부.
- cursor 범위 바꾸기·같은 페이지 재전송·동시 정정과 페이지 안정성.
- 설치 전후 R0/R1/기존 회원/기존 제출/기존 Storage 지문 동일.

## 10. 자동 검증과 범위

- `node tests/test_workhub_teaching.mjs`: 현재 54건. CSV·명령·스코프·판·평가·실제 RPC 호출계약·SSR 검증.
- `node tests/browser/workhub-teaching.mjs`: 현재 14개 시나리오. 실제 TeachingWorkspace+어댑터를 합성 RPC에 연결, 수업→학생→관찰/상담/평가/CSV/활동/같은요청복구/충돌/320px 사용성 확인.
- DB/Storage/Claude 운영 서버에 요청하는 시험은 아니다. SQL 적용 후 실제 PostgREST 호출과 RLS/권한 검증을 별도로 수행해야 한다.
- 어댑터는 호출 전후 `getIdentity()`의 승인·실제 사용자·역할·추가권한·부서를 대조하고, `recoveryScope(member)`의 역할·담당·유효기간·활성을 함께 비교한다. 쓰기 후 이 재확인이 바뀌거나 실패하면 이미 저장되었을 수 있으므로 pending을 보존한다. 기본 30초 제한에는 응답 후 승인 재확인까지 포함한다. 같은 어댑터에서 동일 scope/requestKey의 다른 정규 명령 지문은 RPC 전에 거부하며 서버 원장이 최종 근거다.
- 현재 탭 메모리 `useEditDraft` + 공유 `usePendingRequest('teaching')`를 사용한다. localStorage/sessionStorage에 학생 본문을 쓰지 않는다. 새로고침 후 복구가 된다고 주장하지 않는다.
- pending은 상위 연결 오류 화면에서도 삭제할 수 없는 미확정 요청으로 집계된다. 확정되지 않은 저장에 새 requestKey를 발급하지 않는다.

## 11. 판단해서 정한 것 / 남은 경계

1. 시간표 없이 수업·수강·담당을 먼저 연결했다. 편성 SQL에 종속시키지 않아 선택과목/초등 학급수업/특별활동을 확장할 수 있다.
2. 학생ID는 학교 내부 안정키로만 대조한다. 별명 유사도나 학년반번호로 자동 병합하지 않는다.
3. 상담은 별도 조회와 권한을 사용한다. 학교 관리자 기본열람/생기부 근거 자동 포함을 만들지 않는다.
4. 상태가 섞인 점수의 합계는 NULL이다. 결시 점수 처리 규정을 앱이 발명하지 않는다.
5. 디지털윤리 활동의 최초 파이프라인은 실제 CSV+교사 확인이다. 외부 사이트 로그인 쿠키/자동 이벤트 API/실시간 동기화를 만들어 둔 것으로 표시하지 않는다.
6. 원문 CSV 정정은 명시적 전체 행 대응 방식, 이전 루브릭판은 정확한 판별 조회로 이번에 구현했다. 자동 행 대응은 제공하지 않는다. 아주 큰 카탈로그/활동 역사 페이지는 별도 서버 cursor 확장 경계이며 조용히 자르지 않는다.
7. DB 적용과 문서 AI의 실제 학생 근거 연결/규칙 출력은 이 모듈 단위 자동시험으로 완료되지 않는다. 전체 시범 진행표에 남은 항목으로 표시해야 한다.


## 12. 원문 정정판·과거 기준판 추가 계약

### 과거 평가 기준판

`workhub_teaching_rubric_revision(p_member_id,p_course_id,p_rubric_id,p_revision_id)`는 공통 학교/member/owner 봉투에 rubric 객체 1개를 반환한다. rubric의 학교·owner·course·id·revisionId가 요청과 모두 일치해야 한다. archived는 사용 종료 상태이며 과거판 조회를 막는 플래그가 아니다. immutable criteria/label/version을 보존하고, 당시 평가 항목을 현재 기준으로 자동 변환하지 않는다. 기존 assessment 정정 command의 rubricId/revisionId는 변경 불가로 서버에서 검증한다. 기존 평가의 판과 다른 판을 client가 보내면 거절한다.

### 활동 원문 정정 `activity_correct`

```ts
{
 kind:'activity_correct',courseId,assignmentId,
 previousImportId,expectedVersion,expectedFileHash,
 input:ActivityImportInput, // supersedesImportId 반드시 previousImportId
 correspondence:{
   reason:string, // 전체 정정 사유 필수
   previousRows:[{itemId,itemVersion}], // 이전 모든 행과 연결 상태의 기대 버전
   rows:[{rowNumber,previousItemId:string|null,reason}], // 새 모든 행
   omitted:[{itemId,reason}] // 새 행과 대응하지 않은 이전 모든 행
 }
}
```

- 원문 CSV와 질문판/활동일/라벨, 학생 연결·보류/제외를 새로 확인한다. 모든 새 행은 처음에 학생 미연결/보류다. 별명·순서로 학생이나 이전 행을 자동 연결하지 않는다.
- 이후 각 새 행의 이전 item을 직접 선택하거나 ‘이전에 없던 추가 행’을 선택하고 추가 사유를 적는다. 하나의 이전 행은 새 행 1개에만 대응한다. 새 파일에 없는 이전 행을 자동 삭제하지 않으며 각 누락행에 더 이상 유효한 원천으로 쓰지 않을 사유를 요구한다. 대응과 누락은 이전 행 집합의 정확한 분할이어야 한다.
- 이전 import ID/version/fileHash + 이전 모든 item ID/version을 서버와 대조한다. 일부 행 누락·중복 대응·다른 학생/교사/import item·scope 주입·이미 정정된 source·같은 fileHash를 거절한다. source.kind와 새 CSV kind가 같아야 한다. 같은 파일의 학생 연결 수정은 activity_review.
- `expectedVersion`은 **이전 import 전체 버전**이다. activity_review로 어느 item이 바뀌어도 item.version 및 import.version을 같은 트랜잭션에서 증가시킨다. import 요약과 상세의 version도 일치해야 한다.
- 원자 transaction: 이전 import/전체 rows lock → 현재 담당/학교/학생/수강·모든 version·fileHash·행 대응 대조 → 새 immutable import+raw+items 생성 → supersedes/supersededBy 연결 → 이전 import를 superseded로 변경/version 증가 → 연관 기록·출력 epoch 무효화 → 감사·수신증 함께 commit. 충돌은 전체 미적용.
- 성공 receipt entityId는 **새 import ID**, version=1. 원래 ID를 반환하거나 원문 row를 UPDATE한 것을 성공으로 표시하지 않는다. 같은 key 재시도는 동일 새 import ID를 반환한다. 실제 본문 hash도 저장 전 서버에서 재계산한다.
- 원문 정정과 같은 입력에서 studentId가 달라졌을 수 있으므로 대응표를 근거로 기존 관찰의 학생을 바꾸지 않는다. 원문 정정과 학생 재연결은 별도 기록의 재검토 사유다.
- 기존 superseded import와 items/raw/history는 읽기 전용으로 보존한다. 새 observation의 sourceActivity로 연결하거나 activity_review를 쓰면 거절한다. UI의 ‘다음 정정판/이전 원문판’으로 원문 계보를 확인한다. 순환·여러 후속판·다른 수업/owner로의 supersedes를 DB 제약으로 차단해야 한다.

### 원천 변경 후 AI 재사용 차단

관찰·평가 응답에는 `sourceReviewRequired:boolean`을 필수로 반환한다. 원천 활동 원문 정정 또는 학생 연결/처리 변경이 있으면 이를 사용한 관찰·평가·하위 생기부 문장의 epoch/version을 올리고 sourceReviewRequired=true(또는 이에 대응하는 서버 무효 상태)로 표시한다. **원문/기존 학생/기존 본문을 자동 덮어쓰지 않는다.**

클라이언트는 해당 기록을 읽을 수 있게 남기고 재검토 안내를 띄우지만 recordEvidence에서 제외한다. Claude prepare/생성/출력도 현재 sourceReviewRequired=false와 현재 epoch를 검사해야 한다. 이미 열린 대화에서 이전 근거를 다시 보내는 우회도 거절한다.

일반 본문 정정만으로 sourceReviewRequired를 false로 지우지 않는다. 이번 UI의 명확한 복구 경로는 최신 활동에서 새 관찰을 작성하고 이전 관찰을 필요에 따라 철회하는 것이다. 자동 근거 교체나 과거 평가 변경을 하지 않는다. 별도 재검토 승인 기능을 추가한다면 현재 원천판·학생·사유를 확인하는 전용 command와 감사가 필요하다.

추가 회귀: 예전 rubric의 archived 판 조회·만점 보존; 다른 판/학교/owner 거부; 원문 정정의 새/누락 모든 행 대응; 중복/생략/동시 version 충돌; 동일 파일 정정 거부; immutable 이전 raw 보존; response loss 후 같은 key 새 import 1개; superseded 원문 신규 채택 차단; 원천 변경 후 관찰 본문 보존 + AI 근거 제외. 전체 UI 자동검증은 실제 SQL 효과를 대신하지 않는다.

## 13. SQL 구현용 정확한 변경 JSON과 접수증 대응

아래 타입은 `teaching/contracts.ts`의 실제 `p_command` 구조다. 5절 요약표의 “핵심 입력”을 최상위에 펼쳐 보내지 않는다. `input` 중첩, 명시적인 null, 빈 문자열, 선택 속성의 생략을 구분한다. 공통 학교/member/owner 봉투는 2절을 따르며 이 모듈의 DTO는 `data` 안에 넣지 않는다.

```ts
type RosterRow = {schoolStudentKey:string;name:string;grade:number;classLabel:string;seatNumber:number};
type Criterion = {key:string;label:string;maximum:number};
type Score = {criterionKey:string;state:'scored'|'absent'|'missing'|'unconfirmed';points:number|null};
type ActivityRow = {
 rowNumber:number;alias:string;values:string[];disposition:'hold'|'adopt'|'exclude';
 studentId:string|null;courseMembershipId:string|null;reason:string
};
type ActivityImportInput = {
 label:string;occurredOn:string;questionVersion:string;questionSnapshot:string;
 kind:'dilemmas'|'grading';parserVersion:'digital-ethics.csv.v1';
 rawCsv:string;fileHash:string;headers:string[];rows:ActivityRow[];supersedesImportId:string|null
};
type ActivityCorrespondence = {
 reason:string;previousRows:{itemId:string;itemVersion:number}[];
 rows:{rowNumber:number;previousItemId:string|null;reason:string}[];
 omitted:{itemId:string;reason:string}[]
};
type TeachingCommand =
 | {kind:'course_create';input:{label:string;termId:string;subjectId:string;teacherMemberIds:string[];validFrom:string;validThrough:string}}
 | {kind:'roster_import';courseId:string;expectedVersion:number;rows:RosterRow[];validFrom:string;validThrough:string}
 | {kind:'observation_save'|'counseling_save';courseId:string;studentId:string;courseMembershipId:string;
    assignmentId:string;recordId:string|null;expectedVersion:number;
    sourceActivity?:{itemId:string;itemVersion:number};
    input:{occurredOn:string;text:string;followUpOn:string;reason:string}}
 | {kind:'record_withdraw';recordKind:'observation'|'counseling'|'assessment';courseId:string;studentId:string;recordId:string;expectedVersion:number;reason:string}
 | {kind:'rubric_save';courseId:string;rubricId:string|null;expectedVersion:number;label:string;criteria:Criterion[]}
 | {kind:'assessment_save';courseId:string;studentId:string;courseMembershipId:string;assignmentId:string;
    recordId:string|null;expectedVersion:number;rubricId:string;rubricRevisionId:string;
    occurredOn:string;comment:string;scores:Score[];confirmed:boolean;reason:string}
 | {kind:'activity_review';courseId:string;importId:string;itemId:string;expectedVersion:number;
    disposition:'hold'|'adopt'|'exclude'|'withdraw';studentId:string|null;courseMembershipId:string|null;reason:string}
 | {kind:'activity_import';courseId:string;assignmentId:string;expectedVersion:number;input:ActivityImportInput}
 | {kind:'activity_correct';courseId:string;assignmentId:string;previousImportId:string;
    expectedVersion:number;expectedFileHash:string;input:ActivityImportInput;correspondence:ActivityCorrespondence};
```

observation_save도 `input.followUpOn` 키는 필수이며 값은 빈 문자열이다. 상담은 같은 위치에 후속 날짜 또는 빈 문자열을 쓴다. sourceActivity는 신규 관찰에서만 선택적으로 허용하며 나머지는 속성 자체를 생략한다. 신규 recordId/rubricId는 null, expectedVersion=0이다. 최초 reason은 빈 문자열일 수 있지만 정정/철회/연결 변경 사유는 기존 규칙대로 필수다. 일반 activity_import의 supersedesImportId는 null이며, activity_correct는 이전 import ID와 12절의 전체 행 대응을 함께 검증한다.

성공 접수증의 `entityId/version`은 아래와 같아야 한다. `requestKey/commandKind`는 보낸 명령과 같고 `outcome`은 applied 또는 replayed, `appliedAt`은 실제 저장 시각이다. 재전송에서는 최초 결과의 entityId/version을 반환한다.

| 명령 | entityId | 결과 version / expectedVersion 기준 |
|---|---|---|
| course_create | 새 course ID | 1; expectedVersion 인자 없음 |
| roster_import | 요청 courseId | 현재 course.version을 expectedVersion으로 검사한 뒤 +1 |
| observation_save / counseling_save / assessment_save | 새 기록 ID 또는 요청 recordId | 기록 머리 expectedVersion+1 |
| record_withdraw | 요청 recordId | 기록 머리 expectedVersion+1 |
| rubric_save | 새 rubric ID 또는 요청 rubricId | rubric 머리 expectedVersion+1 |
| activity_import | 새 import ID | **1**; 입력 expectedVersion은 현재 course.version으로 담당/명부 기준을 검사 |
| activity_review | 요청 itemId | item.expectedVersion+1; import.version도 같은 트랜잭션에서 증가 |
| activity_correct | 이전과 다른 새 import ID | **1**; 입력 expectedVersion은 이전 import.version, expectedFileHash는 이전 원문 hash |

이 부록은 앱 계약의 명칭·중첩·판 대응을 명확히 적은 것이며 새로운 열람권이나 학교 정책을 승인하지 않는다. 실제 SQL의 역할·기간·학교·작성자·원문 재검증은 앞 절의 요구를 모두 유지한다.

학생/명부 학년의 브라우저 기술 상한은 `teaching/school-limits.ts`가 `setup/assets/school-admin.json`의 gradeBounds와 customGradeTechnicalLimit에서 공통으로 읽는다(현재 최대 20). CSV·명부 명령·학생 응답을 같은 범위로 검사한다. 이는 모든 학교에 20학년을 허용한다는 정책이 아니며 SQL은 실제 해당 학교의 gradeCount, 학년도와 수업/학적 기간을 다시 검사해야 한다.
