# P5 API 계약 (수업 · 학생 · 관찰 · 상담 · 평가 · 활동 CSV)

PR #48 앱의 `apps/workhub/src/teaching/*.ts`(`teaching.v1`)가 받아들이는 형태입니다.
시험 V 에서 실제 응답 300건을 앱 `createTeachingAdapter` · parser · 명령 검사에 넣어 확인했습니다.

## 봉투

| 경우 | 모양 |
|---|---|
| 성공 | `{ok:true, contractVersion:'teaching.v1', schoolId, memberId, ownerUserId, ...DTO}` (평평한 모양. `ownerUserId` = 로그인한 Auth UID) |
| 업무 거절 | `{ok:false, contractVersion, schoolId, memberId, ownerUserId, code}` |
| 로그인·소속 실패 / 예상 밖 오류 | 봉투 없는 예외(`FORBIDDEN`·`INACTIVE_MEMBERSHIP`·기타). 앱: 조회 `QUERY_FAILED`/`CANCELLED`, 쓰기 `SAVE_UNCERTAIN`/`CANCELLED` |

`code`: `UNAVAILABLE`(모듈 꺼짐·정책 없음) · `INVALID_INPUT` · `FORBIDDEN`(권한 없는 동작) · `NOT_FOUND`(없거나 볼 수 없음) ·
`CONFLICT`(판·담당·상태가 다름) · `IDEMPOTENCY_CONFLICT`(같은 번호·다른 내용) · `QUERY_FAILED`(목록이 한도를 넘음).
업무 거절은 원장에 남기지 않습니다. 요청 번호는 앱 `identifier` 규칙(`^[a-zA-Z0-9][a-zA-Z0-9_.:@/-]{0,159}$`).

## 앱 함수 7개 (`authenticated`, 첫 인자 `p_member_id`)

| 함수 | 인자 | DTO |
|---|---|---|
| `workhub_teaching_catalog` | — | `courses[≤300]: Course, terms, subjects, approvedTeachers, canManageCourses` |
| `workhub_teaching_course` | `p_course_id` | `course, students[≤1000], rubrics(내 것), imports[≤100](내 것)` |
| `workhub_teaching_student` | `p_course_id, p_student_id, p_cursor` | `courseId, studentId, observations[≤100], assessments[≤100], nextCursor`(내 것만) |
| `workhub_teaching_counseling` | `p_course_id, p_student_id, p_cursor` | `courseId, studentId, records[≤100], nextCursor`(내 것만) |
| `workhub_teaching_activity` | `p_course_id, p_import_id` | 원문판 + `items[≤500]`(내 것만) |
| `workhub_teaching_rubric_revision` | `p_course_id, p_rubric_id, p_revision_id` | `rubric`(그 판의 내용) |
| `workhub_teaching_mutate` | `p_command, p_request_key` | 접수증 `requestKey, commandKind, entityId, version, outcome('applied'·'replayed'), appliedAt` |

`Course.canRecord` = 오늘 유효한 담당 · `canCounsel` = 상담 정책 + 오늘 담당 · `canManageRoster` = 관리자 또는 오늘 담당.
담당이 없으면 `assignmentId=null` 이고 `canRecord`·`canCounsel` 은 `false`.

## 명령 10종 (`p_command.kind`)

| kind | 누가 | 접수증 `entityId` · `version` | 주요 거절 |
|---|---|---|---|
| `course_create` | 관리자 | 새 수업 · 1 | 관리자 아님 `FORBIDDEN` · 학기 밖 기간 `INVALID_INPUT` · 없는/폐지 교과 · 받을 수 없는 교사 `NOT_FOUND` |
| `roster_import` | 관리자 · 현재 담당 | 수업 · `expectedVersion+1` | 판 다름 · 같은 키 다른 이름/학적/수강 기간 `CONFLICT` · 학교 학년 수 초과 `INVALID_INPUT` |
| `observation_save` · `counseling_save` | 현재 담당(상담은 정책도) | 기록 · 새 1 / 정정 `expectedVersion+1` | 다른 `assignmentId` · 판 다름 · 철회됨 `CONFLICT` · 기간 밖 날짜 `INVALID_INPUT` · 남의 기록 `NOT_FOUND` |
| `record_withdraw` | 현재 담당 | 기록 · `expectedVersion+1` | 이미 철회 · 판 다름 `CONFLICT` |
| `rubric_save` | 현재 담당 | 기준 · 새 1 / 고침 `expectedVersion+1` | 보관됨 · 판 다름 `CONFLICT` |
| `assessment_save` | 현재 담당 | 평가 · 새 1 / 정정 `expectedVersion+1` | 새 평가가 현재 기준판 아님 · 정정이 기준판을 바꿈 `CONFLICT` · 점수가 기준과 안 맞음 `INVALID_INPUT` |
| `activity_import` | 현재 담당 | 새 원문판 · 1 | 원문 지문·해석이 목록과 다름 · 머리줄이 형식과 다름 `INVALID_INPUT` · 수업 판 다름 · 같은 활동 회차 `CONFLICT` |
| `activity_review` | 원문판 주인(현재 담당) | 행 · `expectedVersion+1` | 행 판 다름 · 정정 전 판 · 채택 아닌 행 철회 `CONFLICT` · 수강 아닌 학생 `NOT_FOUND`/`INVALID_INPUT` |
| `activity_correct` | 원문판 주인(현재 담당) | 새 원문판 · 1 | 대응표가 이전 행의 정확한 분할이 아님 `INVALID_INPUT` · 이전 판·지문·행 판 다름 `CONFLICT` |

명령 모양은 앱 `validateCommand` 와 같은 규칙으로 서버에서도 검사합니다(모르는 칸 · 빈 사유 · 범위 밖 수 → `INVALID_INPUT`).
시험 V: 앱이 보내기 전에 같은 코드로 먼저 막은 요청 98건(서버도 같은 코드).

## 문서함(P4) 연결

`workhub_private.p5_document_student_check(ctx, studentContext)` — P4 의 학생 기록 검토 초안이 부릅니다. 앱이 직접 부르지 않습니다.
`studentContext` = `{courseId, studentId, evidence[]}`, 근거 한 줄 = `{kind:'observation'|'assessment', id, revisionId, sourceHash, epoch, start, end}`(앱 `assistantReference` 와 같은 모양, 모양 검사는 P4-02).
결과: 통과 · `NOT_READY` · `NOT_FOUND` · `CONFLICT` · `INVALID_INPUT`(규칙은 `P5_설계결정.md` D-P5-8a).
