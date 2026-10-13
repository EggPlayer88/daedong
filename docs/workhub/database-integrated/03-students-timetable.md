# 03. 학생·수업·근거·생기부·시간표 통합 계약

> 2026-10-13 시간표 상세 보강은 [14-timetable-operations.md](14-timetable-operations.md)를 따른다. 관리자 확정 기본자료판→담당자 조건/편성/조정→배포→날짜별 교환의 역할·상태·정확한 판 연결을 추가했다. 기존 26표는 재사용하고 변경하는 CHECK는 timetable-extension.json의 supersedes_constraints에 명시한다. 화면 결과와 DB 실행 상태를 구분하며, 더 구체적인 14장의 전이와 제약이 이전 축약 문구보다 우선한다. 실제 구축과 구현은 보류한다.

> 2026-10-12 · 완성된 사이트를 위한 **설계 제안**. 실행 SQL·운영 적용본이 아니다. Claude 2차의 `workhub` 160표와 `workhub_private` 함수를 기준으로 이름과 검증된 구조를 계승한다. 이 문서가 명시한 변경은 동봉 `student-ai-changes.json`의 변경 목록이며 SQL 확정·실행·공개 승인을 대신하지 않는다. 시간표 구현 작업은 현재 보류다.

## 1. 기준과 완료 조건

학생 자료는 `학교 안 불변 학생 → 그날 학적/수강 → 원자료의 정확한 판 → 교사가 확인한 학생 연결판 → 채택 → 본인 관찰/평가의 불변 판 → 문장별 근거 → 해당 판 검토 → 출력` 순서로 이어진다. 받은함을 열거나 학생을 연결하는 것만으로 관찰·평가·생기부 근거가 확정되지 않는다. 공동 수업 자료 열람권한도 다른 교사의 개인 관찰을 가져올 권한이 아니다.

이 문서의 **반드시 유지할 조건**은 다음과 같다.

- R04: 관찰·상담·평가·초안의 학교·작성자·학생 정체성은 불변이다. 특히 검토한 초안의 학생만 바꾸는 UPDATE를 금지한다. 출력 직전에도 원본판·학생·작성자·유효 관계를 다시 검사한다.
- R05: 채택에는 원자료판뿐 아니라 **확정한 학생 연결의 ID와 revision**이 필요하다. A→B→A로 재연결되어도 이전 채택은 저절로 유효해지지 않는다.
- R06: `origin='classroom_adoption'`인 확정 관찰판은 유효한 채택 사슬을 반드시 가진다. 사슬 0개를 직접 기록으로 간주하지 않는다.
- 개인 관찰·상담·평가·초안·받은함은 작성자 전용이다. 관리자·superadmin·지원자도 본문, 건수, 기록 존재 여부를 우회 조회하지 못한다.
- AI 제안은 교사 확정을 대신하지 않는다. 점수 합계·바이트 계산·규칙 검사는 승인된 규칙판을 이용한 코드가 수행한다. NEIS 공식 입력 완료는 별도 사실이다.

기존 DDL의 단일 세션 시험이 통과해도 아래 새 반례와 두 연결 경합 시험을 통과한 것으로 표시하지 않는다. 원본 자료·관찰 본문·실명은 시험에 사용하지 않는다.

## 2. 표준 이름·키·기간

모든 표는 `workhub.<이름>`, 함수는 `workhub_private`의 서버 전용 검증 또는 제한된 공개 명령이다. 신규 ID는 `text DEFAULT gen_random_uuid()::text`, 시각은 `timestamptz`, 날짜는 `date`다. 기존 PK를 UUID형으로 바꾸지 않는다. 관계 기간은 학교 현지 날짜의 `[valid_from, valid_to)`이며 끝 NULL은 열려 있는 기간이다. 기존 legacy의 종료일 포함 값은 이관할 때 한 번 변환하고 원래 DTO 의미는 별도 어댑터로 보존한다.

| 기존 표 | 역할·보존 계약 |
|---|---|
| `academic_years`, `terms` | 학교별 학년도·학기. 실제 시작/종료일과 확정 상태를 사용한다. 달력 연도로 학년도를 추정하지 않는다. |
| `subjects`, `academic_classes` | 교과 기준과 행정 학급. 반 이름·학년은 학생 ID가 아니다. 기존 학교급별 학년 범위는 확인된 학교 설정으로 검증한다. |
| `course_groups`, `course_group_classes`, `course_group_teachers` | 실제 수업 집단, 연결 행정학급, 기간별 승인 교사. 담임 배정인 `assignments`와 구별한다. |
| `students` | 학교 안 학생 ID. `school_student_code`는 선택 영구 코드이며 부여 후 재사용·변경하지 않는다. 이름·반·번호로 전국 통합 신원을 만들지 않는다. |
| `student_enrollments` | 행정 학급 재적 기간. 동일 학생 재적과 반/번호의 기간 중복을 기존 EXCLUDE로 차단한다. |
| `course_memberships` | 선택·분반·공동수업 수강 기간. 행정 학급과 별개다. 같은 수업 집단/학생의 기간 중복을 차단한다. |
| `assignments` | 담임·업무·교과 등 승인 배정. 자기 신고는 `profile_claims`에 두며 바로 권한에 사용하지 않는다. |

같은 학교 관계는 `(school_id,id)` 복합 FK를 사용한다. 학적·수강은 `(school_id,id,student_id)` UNIQUE와 동일 열의 FK를 유지한다. 행정 학급은 학년도까지 포함한 기존 FK를 유지한다. 학생·교사·학급·공간 공유는 같은 학교 내에서도 승인된 관계만 허용한다.

전입 시 대상 학교에 새 학교 내 학생 ID를 생성한다. 두 학교의 이름·생년·번호로 자동 동일인 연결하지 않는다. 전출은 기존 학적·수강을 효력일에 종료하고 미래 담당 접근을 닫는다. **동일 account가 같은 학교에 재임용되어 현재 활성 소속과 보존 정책을 충족하면 본인 과거 관찰·상담·평가·초안을 읽을 수 있다.** 과거 학년도 정정 승인은 별도이며 새 학급·타인 명부 권한은 늘어나지 않는다. 다른 학교 또는 다른 교사의 기록은 열지 않는다. AI 대화·기억의 생성 소속 고정은 별도 계약이다.

## 3. 관찰·상담·평가·초안의 정체성과 판

### 3.1 변경 가능한 정보와 바꿀 수 없는 정보

| 표 | 불변 정체성 | 새 판으로 정정할 정보 |
|---|---|---|
| `observations` | id, school_id, author_account_id, author_membership_id, student_id, academic_year_id | 같은 학생의 날짜·학적·수업·사실·분류. 당시 관계를 새로 검사하고 현재 머리와 불변 판을 한 트랜잭션으로 갱신한다. |
| `counselling_records` | id, school_id, author_account_id, author_membership_id, student_id, academic_year_id | 상담 날짜·유형·본문·후속 내용. 상담 원문은 일반 AI·근거·인계 대상이 아니다. |
| `assessments` | id, school_id, author_account_id, student_id, activity_id | 동일 평가 활동에서 루브릭에 맞는 항목 점수·상태·확인. 다른 활동/학생으로 정정하려면 원기록 철회 후 새 기록이다. |
| `record_drafts` | id, school_id, author_account_id, student_id, academic_year_id, area, subject_id, course_group_id | 문장·질문·근거·규칙 검사. 다른 학생·학년도·영역으로 UPDATE/복사 명령을 만들지 않는다. |

원래 다른 학생에게 잘못 기록한 경우 `철회(원학생)+새 기록(정확한 학생)`을 하나의 명시적 정정 명령으로 처리한다. 두 기록 모두 같은 작성자이고 각각 당시 관계가 확인돼야 한다. 감사에는 두 ID·사유 코드만 남기고 본문을 복제하지 않는다. 이전 원기록을 새 학생의 이력처럼 재귀속하지 않는다.

`observation_revisions`는 기존 student/enrollment/course/date 사본을 유지하고 `course_membership_id`, `teacher_assignment_id`(course_group_teachers), `ai_run_id`를 추가한다. 교과 수업 관찰이면 수강·승인 수업 담당이 필수이며 같은 학생·수업·날짜다. 담임 관찰이면 승인 담임 배정으로 검사하고 수강을 억지로 만들지 않는다. `counselling_revisions`와 `assessment_revisions`에도 학생·학적·기준일 사본을 두어 머리만으로 과거 사실을 재구성하지 않는다. 평가판에는 서버가 정규화된 판 내용에서 계산한 `body_sha256`를 추가한다.

모든 개정은 부모 잠금 아래 `max(revision)+1`을 할당한다. `current_revision_no`만 믿지 않고 최신 불변판도 검사한다. 철회는 끝 상태이며 같은 머리를 부활시키지 않는다. 본문 UPDATE는 전용 삭제 작업의 가림/파기 예외만 허용한다. 일괄 관찰의 최초판은 `fact_scope=common_activity`; 학생별 수행·태도는 개별 교사 확인 후 별도 판으로 작성한다.

### 3.2 평가와 기재규칙

기존 `rubrics/rubric_revisions`, `assessment_activities`, `assessments/assessment_revisions`, `record_rule_sets`를 재사용한다. 루브릭은 활동이 선택한 정확한 판에 고정된다. 기준이 바뀌면 새 활동/명시적 새 기준판 적용 절차이며 과거 점수를 자동 환산하지 않는다.

- `result_status=scored`일 때만 점수/항목 값이 존재한다. 0점은 실제 0이고, 미제출·결시·연결오류·미확인은 NULL이다.
- item_scores의 키는 해당 루브릭 항목과 정확히 대응한다. 각 값의 형식·범위·합계는 승인된 기준으로 서버가 계산한다. AI 총점을 그대로 저장하지 않는다.
- 확정자는 작성 교사 본인이다. AI 제안·교사 검토·확정 시각을 구분한다. 수정은 새 판이고 기존 확정판은 그대로 남는다.
- 생기부 바이트/문자 계산은 `record_rule_sets`의 학교급·학년도·영역·근거·계산식 판에 따른다. 규칙 미확정은 `not_checked`이며 임의의 바이트 한도를 채우지 않는다.
- `record_sentences.kind=sentence/question`을 유지한다. 질문은 최종 문장처럼 출력하지 않는다. 문장별 유효 근거가 없는 경우 완료 표시를 막는다.

## 4. 실제 수업 앱: 수신·학생 확인·교사 채택

### 4.1 CSV 최소 경로

현 디지털윤리 앱의 CSV는 불변 학생 ID·수신 이벤트 revision·확정 활동시각을 보장하지 않는다. 자리번호·별명·행순서는 식별 힌트다. `dilemmas`와 `grading`의 실제 헤더 프로필을 parser_version별로 고정하고 파일 형식을 추정하지 않는다. BOM, 인용부호, 여러 줄, 빈 셀, 수식 보호 작은따옴표를 보존한다. `심화 (평가 제외)` 항목은 점수 근거에서 제외한다.

1. 교사가 학교·수업 집단·학기·활동일·질문판을 선택해 `activity_instances`를 만든다. 질문판의 원문/선택지 해시와 보관 참조를 고정한다.
2. 안전하게 검사된 `file_objects`에 CSV를 올리고 `classroom_imports` 미리보기를 만든다. 동일 `(학교,작성자,활동,파일 SHA256)`이면 기존 결과를 돌려준다. 다른 활동의 같은 파일은 자동 중복 취급하지 않는다.
3. `source_items`의 논리 키는 활동·참가자·항목종류·문항이다. 원문은 `source_item_revisions`에 불변 저장한다. 정정 CSV는 기존 논리 항목과의 연결을 교사가 확인해야 새 판으로 반영한다. 누락 행을 철회로 추정하지 않는다.
4. `participant_mappings`는 현재 상태 projection이며 `participant_mapping_revisions`가 원장이다. confirmed 판에는 학생·활동일 학적·해당 수업 수강이 모두 필요하다. 승인된 교사 담당도 같은 날짜에 검사한다. 다른 참가자를 같은 학생에게 중복 연결하면 보류한다.
5. 받은함에서 원문판·질문판·학생/당시 학급·수업을 확인한다. 교사는 원문을 단순 복사한 성취/인성 추정을 승인하는 대신 직접 확인한 사실 또는 평가 근거로 채택한다.
6. 관찰판/평가판 생성과 `adoptions` 생성, inbox 상태, gate epoch, 접수증·감사·outbox를 한 트랜잭션에서 확정한다. 중간 실패면 모두 롤백한다.

### 4.2 R05: 정확한 연결판을 저장한다

`adoptions`에 `mapping_id text NOT NULL`, `mapping_revision integer NOT NULL`, `student_id text NOT NULL`을 추가한다. `participant_mapping_revisions`에는 `UNIQUE(school_id,mapping_id,revision,student_id)`를 둔다. FK는 `(school_id,mapping_id,mapping_revision,student_id)` 전체다. 기존 원자료판 FK와 받은함의 owner 복합 FK도 유지한다.

추가 제약 트리거는 mapping 부모와 source_item의 **같은 활동·참가자·작성자**, mapping판의 학생과 대상 관찰/평가판 학생, 학적·수강·활동 날짜를 대조한다. 현재 유효 연결은 `max(revision)`을 먼저 선택한 뒤 confirmed 여부를 판단한다. current pointer가 늦거나 최신판이 held/changed/rejected이면 예전 confirmed판으로 돌아가지 않는다.

`adoption_chain_stale()`는 원자료 최신판·삭제/철회·정확한 mapping 최신판·원문과 활동 질문판·target의 학생/owner를 검사한다. 현재 학생 ID가 우연히 같아도 mapping_revision이 바뀌면 stale다. 재검토는 기존 불변 관찰판을 다시 valid로 켜는 행동이 아니다. 새 관찰/평가판과 새 채택을 만들고 기존 연결은 이력으로 남긴다.

### 4.3 R06: 사슬 누락은 거부한다

`origin=classroom_adoption`인 가림/파기되지 않은 관찰판은 최소 한 개의 adoptions 이력을 반드시 가진다. 그중 현재판이 confirmed이고 needs_review=false여서 근거로 사용할 수 있다면 최소 한 개의 활성·유효 사슬이 필요하다. 아직 초안을 만드는 트랜잭션 중간에는 잠시 없을 수 있지만 **DEFERRABLE INITIALLY DEFERRED 제약 트리거가 커밋 때 확인**한다. 관찰판·adoption INSERT/UPDATE/DELETE 양쪽에서 영향 target을 검사한다. 명시적 철회/원자료 정정으로 무효화된 과거판과 채택 이력은 보존하고, 현재판도 needs_review=true로 차단하여 남길 수 있다. 이를 검토·출력 가능으로 취급하지 않는다.

`origin_ref`는 화면용 호환 정보이며 권한·근거 판정에 쓰지 않는다. AI 다듬기는 ai_run_sources를 통해 입력 원문과 전후 판을 확인하며 classroom 원본을 지닌 사실을 direct로 세탁하지 않는다. `adoption_chain_stale()`는 classroom origin인데 사슬이 0개이면 true/`ADOPTION_CHAIN_MISSING`을 반환한다. 평가 활동의 자료 채택도 같은 target 판 사슬을 적용한다.

### 4.4 후속 서버 자동 연계

신규 `classroom_connections`는 `(school_id,owner_account_id,id)`, external_app, endpoint_id, credential_ref(비밀 아님), state, permission_version, 허용 수업 범위를 가진다. 연결 권한은 소유자의 현재 학교·수업 담당으로 제한한다. 실제 비밀은 서버 비밀 저장소에만 둔다.

`classroom_event_receipts`는 connection_id, event_id, external_revision, event_kind, payload_sha256, activity_instance_id, source_item_id?, local_revision?, state, received_at, safe_error_code를 저장한다. UNIQUE(connection_id,event_id,external_revision). 같은 키·다른 지문은 `IDEMPOTENCY_CONFLICT`, 같은 키·같은 지문은 현재 권한 재검사 후 기존 결과다. 원문은 receipt에 복사하지 않는다.

서버가 인증된 connection에서 school/owner를 결정한다. 외부 payload의 school_id/교사 ID는 권한 근거가 아니다. envelope는 `schema_version,event_id,external_revision,event_kind,external_activity_key,participant_key,question_set_version,item_key,occurred_at,content`의 제한 스키마다. 외부순서가 역전되면 보류/옛판 이력으로 남기고 최신 포인터를 되돌리지 않는다. revision 없는 공급자는 자동 최신판 덮어쓰기를 지원하지 않고 CSV와 같은 교사 확인 흐름을 사용한다. 원자료 수신 성공은 학생 연결·점수 확정·관찰 채택 성공이 아니다.

취소·삭제 사건도 버전이 있는 사건으로 처리한다. 원문 재전송은 활동·논리키·내용 해시와 삭제 원장을 먼저 대조한다. 삭제 후 같은 event/내용을 새 ID로 포장해도 자동 재생성하지 않는다. 복원 승인은 별도 권한·사유·범위를 가진 명령이며 임의 문자열 override만으로 우회하지 않는다.

## 5. 문장별 근거·동시 정정·출력

기존 `evidence_links`를 재사용한다. record_sentence는 confirmed observation_revision 또는 assessment_revision만 참조한다. 상담·받은함·원자료·다른 생기부 초안을 직접 근거로 연결하지 않는다. 평가판 해시도 비교한다. `span`은 원문 Unicode code point의 [start,end)와 원본 해시에 묶고 범위 밖/분리 surrogate/원문 불일치를 거부한다.

다형 type/id 링크를 유지하더라도 FK와 동등한 target 존재·학교·owner·학생·불변 판 검사를 제약 트리거로 강제한다. 미래 새 type은 검증기와 삭제 영향 처리·시험이 먼저 도입된 뒤 CHECK 목록에 추가한다. 원본 삭제는 RESTRICT/전용 파기 절차이며 dangling 링크를 만들지 않는다.

### 5.1 작성자 근거 gate

신규 `student_evidence_gates(school_id text, owner_account_id text, epoch bigint DEFAULT 0, updated_at timestamptz)`의 PK는 `(school_id,owner_account_id)`다. 학교·계정 FK가 있고 브라우저에 직접 열지 않는다. epoch는 단조 증가하며 학생 신원이나 본문을 담지 않는다.

공통 잠금은 `accounts/서비스 principal 정렬 → 학교·서비스 gate/grant → memberships 정렬 → 역할·정책 → 멱등 advisory → student_evidence_gates → 원본 종류/ID 정렬 → 파일 → receipt/audit/outbox`다. 권한 검사 행은 FOR SHARE, 회수는 FOR UPDATE/UPDATE로 실제 충돌시킨다. gate는 근거 변경/확정/출력 모두 FOR UPDATE로 획득하며 같은 소유자의 재검사와 변경을 직렬화한다. 여러 작성자·학교를 순회하는 파기 작업은 키 정렬을 지키고 한 소유자의 원자 작업으로 분할한다.

원자료 정정/철회·mapping 새판·관찰/평가 정정·삭제 차단은 gate 아래서 원본판/current pointer/epoch와 직접 파생 `impact_items`·needs_review·접수증·outbox를 함께 커밋한다. 파생이 많아 비동기 전파하더라도 gate epoch와 동기 원본판 검사가 즉시 출력을 막아야 한다. 전파 완료 전 기존 텍스트를 정상 결과로 노출하지 않는다.

AI 생성은 gate 아래 입력판/epoch를 읽어 실행 출처를 저장한 뒤 트랜잭션을 종료하고 외부 호출한다. `record_draft_revisions`에는 ai_run_id(교사 직접 작성은 NULL)와 evidence_epoch를 고정하여 생성 당시 사슬을 찾는다. 돌아오면 동일 gate와 현재 권한을 다시 획득한다. source hash/revision/mapping/epoch 중 하나라도 달라졌으면 결과를 `needs_review`로 보관하거나 폐기하며 reviewed로 승격하지 않는다. 외부 호출 동안 DB 잠금을 유지하지 않는다.

### 5.2 검토·출력 트랜잭션

1. 현재 계정·소속·학교·본인 소유·보존/과거 정정 정책 확인, gate와 초안/원본 잠금.
2. 초안 현재판=max판, identity tuple, 문장 종류·근거 수, 원본의 학교/owner/학생, 최신 확정판, adoption 사슬, 해시·구간, 기재규칙판을 **다시** 검사.
3. 서버가 정렬된 문장/근거판/구간/mapping판/규칙판으로 evidence_set_sha256를 계산한다. 클라이언트가 보낸 지문끼리 일치한다는 이유로 검사를 생략하지 않는다.
4. reviewed는 정확한 draft revision·evidence hash·gate epoch에 묶는다. 새 초안판은 draft로 되돌린다. 출력은 같은 검사를 반복하고 `record_exports`에 그 revision·학생·학년도·영역·지문·epoch를 불변 사본으로 저장한다.
5. 파일 출력은 서버 작업의 임시 결과를 최종 검사 후 공개한다. 다운로드 URL 발급 때도 현재 권한/차단 상태를 재확인한다. 동시 정정이 먼저 커밋하면 출력은 `EVIDENCE_CHANGED`; 출력이 먼저 커밋하면 이후 정정은 영향 목록으로 해당 출력의 최신성 상실을 표시한다. 이미 내려받은 파일을 회수했다고 표시하지 않는다.

## 6. 과거 정정·개인정보·삭제

본인 과거 기록을 정정할 때 현재 학교 소속, 작성 당시 학생 관계, 보존 상태와 정책을 검사한다. 필요한 절차 승인에는 기존 `record_correction_approvals`를 사용한다. 승인자는 본문 없이 ID·종류·사유 코드·결재번호·범위·기한만 보고, 소유자와 다른 현재 유효 승인권자여야 한다. 새 담당자에게 원본문을 넘기는 명령으로 사용하지 않는다. 승인 당시 revision이 달라졌거나 기한이 끝나면 새 승인이 필요하다.

명부 관리자는 명부·배정만 관리한다. 개인 본문뿐 아니라 기록 수·상담 유무·점수·검색 추천·알림·AI trace·파일 링크에도 동일한 owner 규칙이 적용된다. 지원 세션과 서비스 principal에 포괄적 개인 원문 열람을 부여하지 않는다. 삭제 worker는 승인된 manifest의 최소 대상만 처리하며 결과에 본문을 싣지 않는다.

삭제는 gate 아래 사용 차단·epoch 증가·직접 파생 stale·삭제 원장/outbox를 먼저 원자 커밋한다. 별도 작업이 원자료판 raw_text/parsed, CSV 파일, AI 입력/출력 메시지, 추출본, 검색색인, 캐시, 파생 문장/내보낸 파일을 manifest별로 가림·파기한다. FK를 유지할 최소 tombstone과 필요한 법정 보존 대상은 분리한다. 일부 잔존은 partial/retained이며 completed가 아니다. 사용자의 PC 원본 CSV와 외부 수업 앱 자료는 자동 삭제됐다고 말하지 않으며 첫 도입부터 수동 삭제 안내/사용자 확인/확인 불가 상태를 기록한다.

학기 전환의 최소 기능은 새 기간·행정학급·수업·승인 담당·학적/수강을 미리보기 후 생성하는 것이다. 관찰/평가/상담/받은함/초안은 복사하지 않는다. 고급 일괄 전환 마법사도 같은 명령을 묶어 호출하며 원자 범위·부분 실패·재시도 receipt를 유지한다.

## 7. 시간표 26표: 완성 사이트의 접점 계약

알고리즘을 새로 설계하지 않는다. 현재 주간 편성 엔진은 별도 검증된 입력/후보 계약을 통해 연결하고, 날짜별 실제 변경·수업 실시·시수 원장은 아래 DB가 맡는다. 지금 구현 작업은 보류하지만 완성 목표에서 기본 자동편성·검사·배포·교체를 삭제하지 않는다.

| 기존 표 묶음(26표 전부) | 유지할 불변식 |
|---|---|
| `spaces`, `bell_schedules`, `bell_periods`, `term_day_templates` | 실제 시각·학교/학기·공간 용도. 교시 번호만 같다고 시각이 같은 것으로 보지 않는다. 일과 변경은 이후 확정 수업 영향 검사가 필요하다. |
| `course_groups`, `course_group_classes`, `course_group_teachers` | 행정학급과 수업집단 분리, 팀티칭·기간 담당. 초등 학급 중심/중등 교과 중심/고교 선택분반을 같은 관계로 표현한다. |
| `constraint_sets`, `timetable_constraints`, `teacher_unavailability` | hard/soft와 출처·승인 상태·설정판 고정. 확정 출장·복무 불가시간은 hard이고 AI가 묵시 완화하지 않는다. |
| `timetable_compositions`, `timetable_candidates` | 입력판·엔진판·seed/실행한도·결과검사·미해결 상태. timeout/해 없음/미검증 후보를 구분한다. 후보는 불변이며 수동편집도 새 후보로 재검사한다. |
| `timetable_versions`, `timetable_placements`, `timetable_version_impacts` | 배포판의 효력기간·직전판·변경영향. 과거 실시수업과 승인된 미래 변경을 덮어쓰지 않고 영향별 유지/재검토를 결정한다. |
| `lesson_instances`, `lesson_instance_teachers`, `space_reservations`, `resource_occupancy` | 날짜별 예정 수업 및 실제 시각 자원 점유. 교사·공간·학급·집단·선택수강 학생 충돌을 동기 검사하고 EXCLUDE를 최종 방어로 둔다. |
| `timetable_change_sets`, `timetable_change_items`, `timetable_change_participants` | 교체/대체/휴강/보강 종류와 대상 수업판·동의 지문. 동의 후 교사·시각·원판·영향이 바뀌면 재동의. 자기 요청의 최종 승인 금지. |
| `lesson_executions`, `lesson_execution_teachers`, `cover_ledger` | 예정과 실시 분리. 실제 실시판·담당을 근거로 보강/대체 시수 누계를 계산하며 정정은 보상행/새 실시판으로 남긴다. |
| `school_timetable_types` | 검증된 학교 운영형만 지원됨으로 표시한다. 복잡한 선택분반·특수/공동교육과정 미검증 조합을 지원 완료로 주장하지 않는다. |

고교 선택분반은 승인 수강명단으로 충돌 학생을 결정한다. 공동교육과정 외부 교사는 승인된 외부 자원 식별자로 취급하되 다른 학교 학생 원문을 공유하거나 전국 학생 ID를 만들지 않는다. 특수학급·통합수업의 학생 이동은 실제 참여 집단과 기간으로 표현하며 행정학급 중복 금지를 수업 참여 중복 금지로 잘못 확장하지 않는다. 상세 학교별 제약은 확인된 설정판이며 모르는 제약은 미해결로 남긴다.

편성 경로는 `입력판 확정 → 기본 자동편성 → 후보 검사 → 수동 수정/새 후보 → 영향 검토 → 승인 배포`다. 필수 입력은 수업·시수·담당·공간·불가시간·고정칸·수강/학급 관계다. soft 최적화보다 hard 충족을 먼저 판정한다. AI는 사용자 의도와 설명/요청 초안을 맡고 solver와 검증기가 타당성을 판정한다.

확정 변경은 공통 권한 잠금 뒤 관련 teacher/space/class/group/student 자원키를 정렬해 `lock_resources()`로 획득한다. 불가시간 등록·수강명단 변경·공간 예약·배포·교체가 같은 키를 사용한다. READ COMMITTED에서 잠금 뒤 최신판·권한·시간 겹침을 다시 읽고 모든 대상 lesson의 기대판을 한 트랜잭션에서 비교한다. 일부만 교체하지 않는다. rollback은 과거 상태 덮어쓰기가 아니라 현재판 기준 역변경 요청이며 이후 동의·보강·실시·다른 교체 영향이 있으면 재검토한다.

## 8. 명령·오류·인덱스·수용시험

| 명령 | 원자 단위 / 실패 |
|---|---|
| `cmd_roster_import_apply` | 승인된 import manifest+명부/기간/담당+receipt. 후보 누락=전출 아님. 이름만 같은 자동 병합 금지. |
| `cmd_save_observation/cmd_correct_observation/cmd_withdraw_observation` | owner/학생 identity+당시 관계+불변판+gate+파생 영향. `IDENTITY_FROZEN`, `RELATION_NOT_VALID`, `VERSION_CONFLICT`. 최종 API 이름·입력은 05가 정본이다. |
| `cmd_classroom_import_apply/remap/adopt` | 정확한 원자료판·mapping판·교사 확정·채택·target판을 함께 저장. `MAPPING_CHANGED`, `ADOPTION_CHAIN_MISSING`, `SOURCE_BLOCKED`. |
| `cmd_assessment_confirm` | 루브릭판/항목/근거 검사+교사 확정 새판. `RUBRIC_MISMATCH`, `EVIDENCE_NOT_CONFIRMED`. |
| `cmd_record_review/export` | 위 5.2 전체 재검사, 출력 manifest/receipt. `EVIDENCE_CHANGED`, `RULE_SET_UNCONFIRMED`. |
| `cmd_timetable_publish/change_confirm/execution_record` | 자원 잠금·최신판·승인/동의·점유·실시/원장+outbox. 충돌은 해당 자원/시각만 반환하고 다른 교사 개인 사유는 비공개. |

새 인덱스는 `adoptions(mapping_id,mapping_revision)`, `source_item_revisions(school_id,source_item_id,local_revision DESC)`, `participant_mapping_revisions(mapping_id,revision DESC)`, `evidence_links(source_type,source_id,source_revision_no)`, `record_exports(school_id,draft_id,revision_no)`, 미해결 impact `(owner_account_id,state)`를 기본으로 한다. 실제 EXPLAIN과 최소/최대 학교 합성자료로 확인하고 본문 전체 공용 인덱스를 만들지 않는다.

| 시험 ID | 반드시 관측할 결과 |
|---|---|
| SI01 / R04 | A 근거로 검토한 초안을 B로 UPDATE하면 즉시 거부. 방어적으로 오염된 fixture를 만들어도 출력에서 거부. |
| SI02 / R05 | mapping A→B→A 후 기존 채택은 stale. 동일 학생의 새 연결판도 재확인 전 자동 복귀하지 않음. |
| SI03 / R06 | classroom origin+문자열 origin_ref만 있고 adoptions 0개이면 확정 커밋/출력 거부. 원자료 철회 후도 동일. |
| SI04 | 같은 학교 다른 owner, 다른 학교 같은 owner, 다른 학생의 학적/수강/평가판 모두 FK/검증기에서 거부. 관리자 COUNT도 0. |
| SI05 | 원문 v2 또는 최신 mapping판을 먼저 넣고 머리 pointer 갱신이 늦어도 v1을 새 근거로 사용하지 못함. |
| SI06 | 독립 두 연결: 정정이 먼저 gate 획득 후 commit하면 검토/출력 실패. 반대 순서에서는 정정이 기존 출력의 영향 상태를 남김. |
| SI07 | CSV 같은 파일 같은 활동 멱등, 다른 활동 독립, 행 순서 변경/동명이인/누락/빈답/다중줄/BOM/수식문자 보존. |
| SI08 | 자동 사건 중복·역전·취소·삭제 뒤 재전송·다른 school payload 거부. 원문판/학생 확인 없이 점수 확정 0. |
| SI09 | 전출·재임용·담당 종료·작년 기록 정정에서 본인 허용 범위만. 후임 인계 manifest에 개인 기록 0. |
| SI10 | 미제출은 NULL, 실제 0은 scored; 미확인 규칙은 not_checked; 질문은 문장으로 출력하지 않음. |
| SI11 | 파기 후 DB/파일/AI/색인/출력 잔존 중 하나라도 있으면 partial. 외부 PC 파일은 별도 확인 불가 표시. |
| TT01 | 확정 출장 등록과 교체의 두 연결 경합에서 하나만 충돌 없이 커밋. 잠금 없는 사전 검사만으로 통과하지 않음. |
| TT02 | 선택분반 학생/팀티칭/변칙 교시 겹침 탐지. 미검증 학교형은 배포 불가 사유를 제시. |
| TT03 | 배포/교체/원복/실시 정정 후 보강 누계 이중 계상 0, 원판 이후 변경은 조용히 소실되지 않음. |

완료 순서는 기반 권한/파일/원장 → 명부·관계·개인 관찰 → CSV·정확 채택 → AI 출처/평가/생기부 → 시간표 별도 승인 재개다. 표 생성만으로 기능 완료라고 판정하지 않는다. 이 문서의 새 FK를 포함하는 표/검증 함수/정책/시험은 같은 구축 묶음에서 배포한다.
