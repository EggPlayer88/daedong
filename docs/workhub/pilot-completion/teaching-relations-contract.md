# 수업 담당·수강 관계 변경 확장 계약 — teaching-relations.v1

이 문서는 **Claude SQL 작성 요청**이다. 앱과 자동 회귀만 구현했으며 SQL 설치·활성화·운영 확인은 하지 않았다. 기존 P5 `teaching.v1`의 7개 RPC와 명령 10종은 유지한다. P5 SQL 확정본을 Codex가 고치지 않는다.

## 1. 교사가 사용하는 흐름과 이번 경계

수업 선택 → **담당·수강 관계 관리** → 대상·마지막 유효일·사유 입력 → 서버 영향 미리보기 → 전체 범위 확인 → 확정. 기존 수업·학생 화면 안에 연결하며 시간표와 독립이다.

- **담당 종료**: 선택 담당 관계만 종료. 공동 담당 교사의 다른 관계는 유지한다.
- **담당 교체**: 선택 담당의 마지막 유효일 다음날부터 다른 승인 교사에게 새 담당 관계를 만든다. 기존 담당 종료와 새 담당 생성은 한 트랜잭션이다. 새 교사의 소속 기간·기존 담당 중복을 확인한다. 개인 관찰·상담·평가·활동 자료는 인계하지 않는다.
- **수강 종료**: 선택한 수업의 수강 관계만 종료. 학생 원본, 학적, 다른 수업과 기존 기록을 유지한다.
- **전출 처리**: 선택 학생의 **선택 학적**을 종료하며 그 학적을 참조하는 수강 중 종료일 뒤까지 남은 관계만 함께 처리한다. 현재 선택 수업이 이미 끝났다면 다시 변경하지 않는다. 남은 수강이 없으면 학적만 종료할 수 있다. 미래에 시작할 수강은 `cancel_before_start`로 보존한다. 다른 학년도 학적·다른 학생·학교를 자동 변경하지 않는다. 전입 학교로 학생 자료를 자동 전송하지 않는다.

**이번 범위의 날짜는 앞으로의 변경이다.** 학교의 오늘(`basisDate`)보다 이른 날짜로 소급 종료하지 않는다. 담당 교체의 시작일은 기존 담당 마지막 날의 다음날이므로, 오늘 입력하면 가장 빨라도 **내일부터** 새 담당이다. 오늘부터의 교체·기간 오입력 소급 정정·종료 취소·재등록은 별도 영향 검토 및 승인 계약이 필요하다. 이 제한을 감추거나 학생·관계 삭제로 우회하지 않는다.

## 2. 기존 DB 보존 및 SQL 설계 요청

현재 P5 `course_assignments`, `student_enrollments`, `course_memberships`는 UPDATE/DELETE 금지이며 관계 자체 `version` 열이 없다. 앱 `Student.version`은 학생 원본 판이다. 이를 관계 종료 판으로 사용하면 안 된다.

1. 기존 불변 관계 ID·기간·FK·원문을 남기고 별도 종료 사건/관계 상태 보강으로 유효 종료 범위를 계산하는 증분 설계를 요청한다. 이 문서는 테이블 DDL을 확정하지 않는다.
2. DTO `version`은 **관계별 단조 증가 판**이다. 최초 1, 해당 관계에 종료 사건이 적용되면 1 증가. 기존 학생 원본 판·학적 판·수강 판을 섞지 않는다.
3. `validFrom/validThrough`는 원래 관계의 양 끝 포함 기간. `effectiveThrough`는 종료 사건을 반영한 마지막 유효일이다. `null`은 **시작 전 취소되어 유효한 날짜가 없음**을 의미한다. 무기한이나 필드 누락이 아니다.
4. 종료 사건 후 현재 담당 조회·기록 작성·명부 등록/활동 채택·P4 근거 검사는 새 **유효 기간**을 사용해야 한다. 변경되지 않은 원본 기간만 검사하면 종료 후 새 기록을 넣을 수 있으므로 앱 확장 RPC만 추가해서 끝내지 않는다.
5. 기존 기록과 그 revision/hash/epoch는 관계 종료만으로 수정·철회·양도하지 않는다. 허용된 과거 본인 기록 조회와 기존 근거의 재검증을 계속 지원한다. 종료일 뒤의 미래 날짜 기록이 이미 있으면 새 변경은 `CONFLICT`로 전부 거절하고 원문을 고치지 않는다. 관계 기간이 과거 기록에 미치는 판단과 신규 작성 허용 판단을 분리한다.
6. 학생 원본, 기존 명부 행, 관찰·상담·평가·원문·접수 원장을 삭제하지 않는다. 전체 기능을 끄더라도 허용된 기존 조회 경로는 유지한다.
7. 새 수강이나 담당이 preview 뒤 추가되면 영향 집합이 바뀌므로 commit은 `CONFLICT`. 동시 추가와 종료의 경합까지 동일 학교/학적/수업 잠금 범위 안에서 막는다. 잠금 순서는 ID 기준으로 일관되게 한다.
8. 기존 업무/회원/소속/파일/다른 P 단계의 지문은 변경하지 않는다. 필요한 P5 함수 보강과 사후점검 허용표 갱신은 별도 증분 파일·시험·검토 범위로 제시한다.

## 3. 새로운 공개 RPC 세 개

기존 인증 경로를 사용한다. 매번 실제 로그인 사용자·승인·활성 학교 소속·학교별 권한을 확인한다. `p_member_id`는 범위 선택이며 권한을 증명하지 않는다. 공개 범위나 인증 규칙을 앱 변경으로 넓히지 않는다.

| RPC | 인자 | 결과 |
|---|---|---|
| `workhub_teaching_relations` | `p_member_id`, `p_course_id` | `RelationsSnapshot` |
| `workhub_teaching_relation_preview` | `p_member_id`, `p_intent` | `RelationPreview` |
| `workhub_teaching_relation_commit` | `p_member_id`, `p_command`, `p_request_key` | `RelationReceipt` |

앱 실행 가능한 원본: `apps/workhub/src/teaching/relations-contracts.ts`, `relations-validation.ts`, `relations-adapter.ts`. SQL이 임의로 필드나 판을 변경하면 앱은 지원 완료로 처리하지 않는다. 모든 성공 DTO는 아래 공통 봉투를 갖고 **정확한 키**를 사용한다. `ok:true`만 추가 허용하며, 학생 본문/상담 존재/다른 사용자의 기록 수 같은 추가 필드를 섞지 않는다.

```json
{"contractVersion":"teaching-relations.v1","schoolId":"school-id","memberId":"member-id","ownerUserId":"auth-user-id"}
```

확정 업무 거절은 같은 봉투와 `ok:false, code`를 반환한다. 허용 코드: `UNAVAILABLE/INVALID_INPUT/FORBIDDEN/NOT_FOUND/CONFLICT/IDEMPOTENCY_CONFLICT/QUERY_FAILED`. 다른 범위의 봉투·알 수 없는 쓰기 오류·응답 손상·네트워크 오류는 앱에서 `SAVE_UNCERTAIN`이다. 결과 미상 후의 재시도에 거절이 와도 이전 요청 미적용으로 단정하지 않는다.

**확정 RPC의 업무 거절은 추가로 `requestKey`와 `commandHash`가 반드시 필요하다.** 키 집합은 정확히 공통 봉투 + `ok:false,code,requestKey,commandHash`이다. `applied` 같은 모순된 추가 필드나 누락을 허용하지 않는다. commandHash는 앱 `relationCanonical(p_command)`의 UTF-8 SHA-256(소문자64자리)이다. canonical은 객체 키를 정렬하고, 배열 순서를 그대로 보존하며, 공백 없이 JSON 문자열/숫자/불리언/null을 인코딩한다. SQL `jsonb::text`를 그대로 해시하면 공백 규칙이 달라질 수 있으므로 앱과 실제 문자열·해시 fixture를 대조한다. 서버가 요청번호와 명령 지문에 묶인 **미적용**을 확정할 때만 이 봉투를 쓴다. 누락·다른 key/hash·다른 학교·알 수 없는 속성은 `SAVE_UNCERTAIN`으로 처리하여 원요청을 보존한다. 읽기/preview 오류는 공통 봉투 + `ok:false,code`만 사용한다.


모듈 미설치/미활성은 `UNAVAILABLE`. 앱은 관계 패널에 준비 중을 표시하고 기존 P5 수업·관찰·평가 조회를 계속 사용할 수 있다. **빈 배열도 계약과 capabilities가 유효하면 정상 지원 응답**이다. 빈 목록과 준비 중/조회 실패를 구분한다.

## 4. 관계 목록 응답

봉투 + `courseId, courseVersion, courseLabel, basisDate, capabilities, assignments, students, approvedTeachers`.

- `courseVersion`: 현재 수업 판. 새 명부/담당 추가나 이 확장 변경과 함께 증가해야 한다. 다른 수업 영향이 있는 전출은 영향 수업의 판도 증가시킨다.
- `basisDate`: 학교 timezone의 오늘, `YYYY-MM-DD`.
- `capabilities`: 정확히 `{manageAssignments:boolean,endMemberships:boolean,transferStudents:boolean}`. 각각 담당 변경, 선택 수업 수강 종료, 학적 전출 권한을 뜻한다. 관리자는 명부를 볼 수 있어도 개인 상담을 열 수 있다는 의미가 아니다. 현재 담당이 수강 종료를 할 수 있는지는 기존 P5 roster 권한을 기준으로 서버가 결정하고, 학적 전출/담당 교체는 학교 관리 권한으로 분리한다.
- `assignments`: 이 수업의 담당 관계(최대300). 지난 관계도 포함할 수 있으나 변경 가능한지는 기간/권한으로 판단한다.
- `students`: 최대1000. 각 항목은 정확히 `{studentId,name,membership:TeachingRelation,enrollment:TeachingRelation}`. 학생/학적/수강 학교와 연결 ID를 서버·앱 양쪽에서 확인한다.
- `approvedTeachers`: 최대300, 정확히 `{memberId,label,validFrom,validThrough}`. `manageAssignments=false`이면 빈 배열. 소속의 승인·활성 및 유효기간을 서버가 확인한다.
- 한도를 넘는 전체 목록은 잘라서 전체처럼 보여 주지 말고 `QUERY_FAILED`로 반환한다. 대형학교 페이지 계약은 후속 확장판으로 함께 정한다.

`TeachingRelation`의 정확한 키:

| 필드 | 의미 |
|---|---|
| `id,schoolId,version,kind,label` | 안정 관계 ID/학교/관계 판/종류/화면 이름 |
| `courseId,courseLabel` | 담당·수강은 필수 문자열, 학적은 둘 다 null |
| `memberId` | 담당은 교사 소속 ID, 나머지는 null |
| `studentId` | 학적·수강은 학생 ID, 담당은 null |
| `enrollmentId` | 수강은 학적 ID, 학적은 자기 id, 담당은 null |
| `validFrom,validThrough,effectiveThrough` | 원본 기간과 실제 종료일(null은 시작 전 취소) |

`kind`는 `assignment/course_membership/enrollment`. 한 응답에 동일 관계를 중복시키거나 다른 학생 학적을 끼워 넣으면 거절한다.

## 5. 변경 의도와 미리보기

`RelationIntent`의 정확한 키:

```json
{
  "kind":"assignment_replace",
  "courseId":"course-id",
  "expectedCourseVersion":8,
  "relationId":"assignment-id",
  "expectedRelationVersion":2,
  "studentId":null,
  "enrollmentId":null,
  "lastDay":"2026-10-20",
  "replacementMemberId":"new-teacher-membership-id",
  "reason":"공식 담당 배정 변경"
}
```

위 날짜는 계약 설명용 예시이며 운영 기본값이 아니다.

- kind: `assignment_end/assignment_replace/membership_end/student_transfer_out`.
- `reason`: 공백만은 불가, 최대2000자. 불필요한 학생 민감정보를 넣지 않도록 안내한다.
- 담당 명령의 studentId/enrollmentId는 null. 교체만 replacementMemberId를 요구하고 나머지는 null.
- 수강/전출은 studentId/enrollmentId 필수. 수강의 relationId는 수강 ID, 전출은 학적 ID(=enrollmentId).
- 양수 판과 모든 필드가 필요하며 알 수 없는 속성을 허용하지 않는다.
- lastDay는 학교 오늘 및 해당 관계 시작일 이상, 현재 effectiveThrough보다 이전. 마지막 하루를 제거하는 시작 전 취소를 일반 단일 종료로 우회하지 않는다.
- 교체의 새 교사는 기존 교사와 달라야 하며, 다음날~기존 유효 종료일까지 소속이 유효해야 한다. 그 기간 기존 동일 수업 담당과 겹치면 거절한다.

Preview 봉투 + `courseId,previewId,fingerprint,expiresAt,intent,changes,replacement,recordsPreserved:true,historyNotTransferred:true`.

- `intent`는 요청 의도와 정확히 동일. 서버가 날짜/대상을 몰래 수정하지 않는다.
- `previewId`: 불투명 ID. `fingerprint`:64자리 소문자 SHA-256. `expiresAt`:시간대를 포함하는 실제 ISO시각.
- `changes`: `TeachingRelation`의 모든 키 + `afterThrough`와 `effect` 두 개. 최대1001개, 종류+ID 중복 없음. `version`은 **변경 전** 관계 판.
- `effect=end`: afterThrough=lastDay. `effect=cancel_before_start`: 원래 시작일>lastDay이고 afterThrough=null. 이미 lastDay 이전에 끝난 관계는 영향 목록에서 제외한다.
- 담당/수강 단일 종료는 해당 관계 1개만. 전출은 선택 학적 1개와 그 학적의 남은 수강 0개 이상. 학생이 이미 끝낸 현재 수업을 억지로 changes에 넣지 않는다.
- `replacement`: 교체일 때만 정확히 `{memberId,label,validFrom,validThrough}`, 나머지는 null. validFrom=lastDay+1, validThrough=기존 담당 effectiveThrough.
- preview는 학생/담당 관계를 변경하지 않는다. 필요하면 제한된 수명의 서버 미리보기 원장을 만들 수 있으며 학교·사용자·의도·기간·대상판·영향집합·수업판·새교사소속판·정책판을 fingerprint에 묶는다. 동작에 영향을 주는 변화가 나면 확정하지 않는다.
- 앱 preview 어댑터는 먼저 성공한 최신 관계 목록을 요구한다. 현재 목록에서 이미 알고 있는 학적/수강/담당이 영향을 받으면 반드시 미리보기에 있어야 하며 ID·판·범위·원기간·유효 종료일도 같아야 한다. 이미 종료된 현재 수강은 생략 가능하다. 다른 수업 전체의 완전성은 서버에서 실제 관계를 재조회해 보장한다.
- preview 응답이 이미 만료됐거나 확인 화면에서 기다리다가 만료되면 새 확정 요청·번호를 만들기 전에 차단한다. 입력은 유지하고 새 미리보기를 요구한다. **기존 결과 미상 요청의 원키 재시도에는 이 새 요청용 만료 차단을 적용하지 않는다.**
- preview ID는 다른 사용자/학교/수업/명령에 재사용 불가. 이전 preview의 입력을 바꾸면 새 미리보기를 받아야 한다.
- 앱은 반환된 보존 문구를 서버 동작의 증명으로 간주하지 않는다. 아래 SQL 회귀로 실제 보존을 증명해야 한다.

## 6. 확정·동시 수정·결과 미상 복구

`RelationCommit`은 정확히 `{previewId,previewFingerprint,intent,expectedChanges}`이다. expectedChanges는 `{kind,id,version}`의 **변경 전** 관계 판 목록이며 preview.changes와 일치해야 한다. 서버는 이 목록을 권한/변경 대상의 최종 근거로 신뢰하지 않고 서버 미리보기와 실제 DB의 전체 영향집합을 다시 비교한다.

1. 학교·작성자·namespace+requestKey별 접수 원장을 먼저 확인한다. 같은 번호/같은 명령의 완료 요청은 원래 접수증을 재생한다. 다른 명령은 IDEMPOTENCY_CONFLICT.
2. 새로운 요청이면 미리보기 소유자·만료·미사용·지문·의도·수업/관계 판·현재 권한·영향집합을 트랜잭션에서 재확인한다. 단일 preview를 서로 다른 요청 번호로 두 번 적용하지 않는다.
3. 종료 사건·교체 새 관계·각 관계 판·영향 수업 판·감사 사건·미리보기 사용 처리·접수증을 원자적으로 기록한다. 어느 하나 실패하면 전체 미적용.
4. 결과 미상 요청의 재생은 그 후 preview가 만료/소비됐거나 관계판이 변했더라도 **이미 완료한 원래 요청**을 확인할 수 있어야 한다. 권한 소멸로 재생을 거절하면 미적용이라고 답하지 않는다. 민감정보 없이 접수 결과 확인이 가능한지 서버 규칙을 명시한다.
5. 앱은 원래 명령 전체와 요청번호를 현재 탭 메모리에 보관한다. 배경 조회 실패·판 충돌·재조회·미리보기 재만료가 있어도 pending 명령을 재작성하지 않는다. 미확정 요청이 있으면 새 변경/닫기를 막는다. 브라우저 종료 이후 복원을 약속하지 않는다. 부모 수업 catalog/course 배경 조회가 실패해도 관계 패널의 원요청 결과 확인 버튼은 남는다. 권한을 확인하지 못한 동안 관계 이름·입력·미리보기는 감추고 새 쓰기를 막는다. 원요청 확인은 전송 어댑터가 현재 계정과 권한을 다시 검사한다.
6. 최초 확정 거절은 입력을 보존한다. 충돌 후 최신 목록을 표시하고, 사용자가 최신 판 반영→새 미리보기→명시 확인한 경우에만 새 요청을 만든다. 자동 last-write-wins 금지.

Receipt 봉투 + 정확히 `previewId,previewFingerprint,requestKey,intentKind,changes,replacementAssignmentId,outcome,appliedAt`.

- changes: 확정된 `{kind,id,version}` 목록. 요청 expectedChanges와 집합이 같고 모든 version=이전+1.
- 교체는 새 replacementAssignmentId(기존 ID와 달라야 함), 나머지는 null. 새 담당 관계 판은1로 시작한다.
- outcome은 applied/replayed. appliedAt는 timezone을 포함한 유효한 시각.
- 앱은 preview/key/명령/학교/작성자/관계 판이 모두 맞는 접수증을 받았을 때만 완료를 표시한다.

## 7. Claude SQL 검토·시험 요청

- 기존 R0/R1/P1~P7 지문 및 P5 과거 자료 보존. 수정한 P5 접근/기간 함수의 필요 범위 명시.
- 다른 학교·학생·학적·수업·교사 대입, 비활성/승인 대기·일반 사용자 권한, 위조 capability 무시.
- 단일 종료의 다른 공동 담당/다른 수강 불변, 교체의 종료+새 담당 원자성, 중복/겹침/기간 초과 거절.
- 전출 영향: 학적만 남은 경우, 현재 수강 이미 종료, 여러 수업, 미래 시작 수강 취소, 다른 학년도/학적 보존.
- 현재 날짜 이전의 소급·이미 종료·날짜가 바뀌어 범위를 벗어난 preview·미래 작성 기록 존재 시 거절.
- preview 이후 명부/담당/수강/학생/권한/새교사소속 변경과 동시 INSERT 경합을 잡는지.
- 모든 관계 판·수업 판·학생 원본 판을 구분. 기존 개인기록 원문·revision·hash·epoch·owner가 변경되지 않는지.
- 동일 key 재시도, 다른 명령 동일 key, preview 재사용, 중간 오류 롤백, 저장 후 응답 단절 및 만료 후 접수증 재생.
- 종료 후 신규 기록 기간 차단, 기존 본인 과거 기록 조회·P4 근거 검증 지속, 다른 교사에게 원문 노출 없음.
- 실제 출력 JSON을 앱 parser/adapter에 넣어 대조. 서버에 없는 기능은 준비 중으로 남겨 성공을 위장하지 않음.

## 8. 현재 자동 검증과 남은 단계

전용 단위 24건, 실제 React+어댑터 브라우저 13건을 합성 RPC 응답으로 검증했다. 학교/관계/학적 범위, 기간·교체 중복, exact DTO, 전출 영향, 미지원 서버, 충돌·배경 오류·결과 미상 입력과 요청번호 보존, 기존 학생/관찰 보존을 포함한다. 320px 가로 넘침과 키보드로 미리보기·확인 체크·확정 버튼 이동도 확인했다. 실제 DB/Storage/브라우저 운영 연결의 성공을 의미하지 않는다. `WORKHUB_QA_OUTPUT`을 지정하면 `teaching-relations-320.png`와 `teaching-relations-results.json`을 남긴다.

남은 단계: Claude 증분 SQL 작성 → 앱 대조 및 통합 회귀 → 검토 → 사용자 적용 → 제한된 계정으로 실제 연결/기간/권한/기록 보존 확인. 일반 교사 공개는 별도 승인이다.
