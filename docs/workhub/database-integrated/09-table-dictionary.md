# 통합 테이블과 열 사전

이 파일은 source-baseline.json의 실제 원본 열과 세 변경 목록을 합쳐 생성했다. 실행 SQL이 아니다. 단일 열의 참조 표시는 탐색용이며 실제 FK는 학교·부모·작성자·판을 포함한 복합 제약을 따른다. 원본 CHECK/정책/트리거를 무검토로 그대로 적용하면 안 된다.

추출 당시 원본은 160표다. 통합 목표는 175표와 2374열이다. NULL=허용은 항상 그 상태에서 생략 가능하다는 뜻이 아니며 상태별 필수 조건이 추가된다. 생성식은 SQL 확정 때 검증한다.

## workhub.academic_classes

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| grade | smallint | 불가 | — |  | 원본 |
| class_no | smallint | 허용 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| kind | text | 불가 | 'regular'::text |  | 원본 |
| sort_order | smallint | 불가 | 0 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id) → workhub.academic_years(school_id,id)

## workhub.academic_years

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| school_year | smallint | 불가 | — |  | 원본 |
| starts_on | date | 불가 | — |  | 원본 |
| ends_on | date | 불가 | — |  | 원본 |
| state | text | 불가 | 'planning'::text |  | 원본 |
| closed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

## workhub.account_settings

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| account_id | text | 불가 | — |  | 원본 |
| last_school_id | text | 허용 | — |  | 원본 |
| share_mask_default | boolean | 불가 | false |  | 원본 |
| locale | text | 불가 | 'ko-KR'::text |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)
- (last_school_id) → workhub.schools(id)

## workhub.accounts

계정·학교·권한 · 기존 보강

열람: 본인 최소 프로필. 타인 프로필은 현재 학교 가입승인/roster 전용 DTO에서 최소 필드만 반환.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| auth_user_id | uuid | 불가 | — | 기존 Auth UID를 보존한다. 기존 FK auth.users(id) RESTRICT를 유지하며 새 Auth를 만들지 않는다. · 생성 후 불변 | 통합 변경 |
| legacy_user_id | text | 허용 | — |  | 원본 |
| legacy_link_method | text | 허용 | — |  | 원본 |
| legacy_linked_at | timestamp with time zone | 허용 | — |  | 원본 |
| legacy_link_run_id | text | 허용 | — |  | 원본 |
| display_name | text | 불가 | — |  | 원본 |
| email | text | 허용 | — |  | 원본 |
| status | text | 불가 | 'active'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| permission_version | bigint | 불가 | 1 | 계정 자격·승인 bridge·차단 변경의 무효화 판. 허가증 자체가 아니다. | 통합 추가 |
| legacy_approval_state | text | 불가 | 'hold' | not_legacy/approved/hold. B00 원본 집합·승인 상태와 승인된 신규 가입 경로로만 지정한다. | 통합 추가 |

통합 필수 제약:

- auth_user_id UNIQUE와 기존 Auth FK RESTRICT 유지
- legacy_approval_state IN ('not_legacy','approved','hold')
- permission_version > 0
- legacy_user_id/연결방법/연결시각의 기존 동시 존재 제약 유지

통합 동작 규칙:

- 최초 검증된 연결 이후 Auth/legacy 식별자를 일반 명령으로 바꾸지 않는다.
- 현재 Auth UID로 계정을 파생한다. 이메일·이름 자동 병합 금지.
- hold는 최소 가입/연결 확인 외 업무·개인 AI 접근을 거부하며 학교 승인만으로 해제하지 않는다.
- 병행 단계에는 현재 public.users 승인도 검사한다. 승인된 단일 권위 전환 뒤에만 신축 accounts.status로 분리한다.
- 상태·승인 경계 변경은 permission_version+회수원장+outbox와 원자적으로 반영한다.

인덱스: 기존 auth_user_id UNIQUE 및 legacy_user_id UNIQUE 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (auth_user_id) → auth.users(id)
- (legacy_link_run_id) → workhub.migration_runs(id)

필수 시험: FS01 기존 UID·프로필·트리거 보존; FS02 legacy hold 자동 해제 거부; FS07 계정 정지 선행 경합

## workhub.activity_instances

수업 앱 연결 · 기존 보강

열람: 본인 활동만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| external_app | text | 불가 | 'digital_ethics'::text |  | 원본 |
| lesson_code | text | 허용 | — |  | 원본 |
| activity_date | date | 불가 | — |  | 원본 |
| lesson_instance_id | text | 허용 | — |  | 원본 |
| question_set_version | text | 불가 | — |  | 원본 |
| rubric_id | text | 허용 | — |  | 원본 |
| rubric_revision_no | integer | 허용 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| question_set_sha256 | text | 불가 | — | 당시 질문·선택지 원문 묶음 해시 · 생성 후 불변 | 통합 추가 |
| question_manifest_ref | text | 불가 | — | 서버에 보관한 질문 원문판의 검증된 참조; 임의 URL 실행 금지 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- school_id,owner_account_id,course_group_id,term_id,activity_date,external_app,question_set_version,question_set_sha256는 원자료 수신 이후 변경 금지

통합 동작 규칙:

- 다른 질문판/활동일은 새 활동 또는 원자료 영향이 포함된 명시적 정정 흐름
- 교사 승인 수업과 학기·활동일 일치

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,owner_account_id,rubric_id) → workhub.rubrics(school_id,owner_account_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,rubric_id,rubric_revision_no) → workhub.rubric_revisions(school_id,rubric_id,revision_no)
- (school_id,term_id) → workhub.terms(school_id,id)

필수 시험: SI07: 같은 CSV 다른 활동은 별개; SI08: 질문판 불명/다른 과목 활동 연결 거부

## workhub.adoptions

수업 앱 연결 · 기존 보강

열람: 같은 학교·owner의 활동/target만; 관리자 우회 없음

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| inbox_item_id | text | 불가 | — |  | 원본 |
| source_item_id | text | 불가 | — |  | 원본 |
| source_local_revision | integer | 불가 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 불가 | — |  | 원본 |
| target_revision_no | integer | 불가 | — |  | 원본 |
| state | text | 불가 | 'active'::text |  | 원본 |
| adopted_at | timestamp with time zone | 불가 | now() |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| mapping_id | text | 불가 | — | workhub.participant_mappings.id · 채택 당시 연결 정체성 · 생성 후 불변 | 통합 추가 |
| mapping_revision | integer | 불가 | — | workhub.participant_mapping_revisions.revision · 정확한 교사 확정 연결판 · 생성 후 불변 | 통합 추가 |
| student_id | text | 불가 | — | workhub.students.id · 해당 연결판과 target판에 공통인 학생 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- FK(school_id,mapping_id,mapping_revision,student_id) REFERENCES workhub.participant_mapping_revisions(school_id,mapping_id,revision,student_id)
- 기존 받은함 owner 복합 FK·source_item_revision FK 유지
- mapping의 활동/참가자/owner=원자료, 학생=target판 학생을 제약 trigger로 강제
- R06: classroom origin target판과 사슬 무결성을 양쪽 deferred constraint trigger로 강제

통합 동작 규칙:

- R05: 정확 mapping판이 바뀌면 stale; 같은 학생 ID라는 이유로 자동 복귀 금지
- 재확정은 새 target판+새 adoption; 기존 불변판 valid로 복구 금지
- 사슬 누락 classroom 판은 adoption_chain_stale=true

인덱스: (mapping_id,mapping_revision)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,owner_account_id,inbox_item_id,source_item_id,source_local_revision) → workhub.inbox_items(school_id,owner_account_id,id,source_item_id,source_local_revision)
- (owner_account_id) → workhub.accounts(id)
- (school_id,source_item_id,source_local_revision) → workhub.source_item_revisions(school_id,source_item_id,local_revision)

필수 시험: SI02: 연결 왕복 뒤 기존 채택 불가; SI03: classroom origin+adoption 0행 확정/출력 불가

## workhub.ai_policy_versions

Claude·기억 · 신규

열람: 서버 전용 정책 원문; 사용자/지원에는 승인된 안전 메타데이터만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 승인된 AI 실행 정책판 · 생성 후 불변 | 통합 추가 |
| provider | text | 불가 | 'anthropic' | Claude 공급자 · 생성 후 불변 | 통합 추가 |
| model_identifier | text | 불가 | — | 승인된 서버 모델식별자; 임의 기본값 없음 · 생성 후 불변 | 통합 추가 |
| prompt_template_ref | text | 불가 | — | 서버 제한 저장소 프롬프트판 참조 · 생성 후 불변 | 통합 추가 |
| prompt_sha256 | text | 불가 | — | 프롬프트판 지문; 원문 아님 · 생성 후 불변 | 통합 추가 |
| tool_registry_version | text | 불가 | — | 도구수준과 schema 고정판 · 생성 후 불변 | 통합 추가 |
| allowed_data_categories | text[] | 불가 | — | 전송 승인된 데이터 종류 목록 · 생성 후 불변 | 통합 추가 |
| limits | jsonb | 불가 | — | 승인된 토큰/호출/예산 제한; 값 임의 확정 금지 · 생성 후 불변 | 통합 추가 |
| cache_policy_ref | text | 불가 | — | 승인된 캐싱 정책판 · 생성 후 불변 | 통합 추가 |
| pricing_reference | text | 불가 | — | 승인 단가/비용 귀속 기준판 · 생성 후 불변 | 통합 추가 |
| approved_by_account_id | text | 불가 | — | workhub.accounts.id · 현재 승인권한으로 확정한 사람 · 생성 후 불변 | 통합 추가 |
| approval_ref | text | 불가 | — | 승인 근거 · 생성 후 불변 | 통합 추가 |
| approved_at | timestamptz | 불가 | — | 승인 시각 · 생성 후 불변 | 통합 추가 |
| effective_from | timestamptz | 불가 | — | 시행 시작 · 생성 후 불변 | 통합 추가 |
| effective_to | timestamptz | 허용 | — | 시행 종료 | 통합 추가 |
| state | text | 불가 | 'approved' | approved/suspended/retired | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); provider='anthropic'
- effective_to IS NULL OR effective_to>effective_from
- 정책 내용 변경은 새판; 중단/종료만 허용

통합 동작 규칙:

- 정책 승인/변경은 별도 권한과 승인 절차
- 원문 prompt·API key 저장 금지

인덱스: (state,effective_from,effective_to)

필수 시험: AI13: 클라이언트/로그에 시스템 prompt 없음; 정책 없음/미시행/중단 상태 실행 거부

## workhub.ai_run_sources

Claude·기억 · 신규

열람: 실행 주인+현재 실행/원본 접근 모두 허용; 원문 복제 없음

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 실행 근거 ID · 생성 후 불변 | 통합 추가 |
| scope_key | text | 불가 | — | 실행 scope · 생성 후 불변 | 통합 추가 |
| school_id | text | 허용 | — | workhub.schools.id · 학교 실행일 때만 학교 · 생성 후 불변 | 통합 추가 |
| run_id | text | 불가 | — | workhub.ai_runs.id · 사용한 AI 실행 · 생성 후 불변 | 통합 추가 |
| owner_account_id | text | 불가 | — | workhub.accounts.id · 실행 소유자; 공유문서 저자와는 다름 · 생성 후 불변 | 통합 추가 |
| kind | text | 불가 | — | knowledge_revision/knowledge_chunk/document_revision/observation_revision/assessment_revision/source_item_revision · 생성 후 불변 | 통합 추가 |
| knowledge_revision_scope_key | text | 허용 | — | 지식판 전체를 선택했을 때만 정확한 범위 · 생성 후 불변 | 통합 추가 |
| knowledge_chunk_scope_key | text | 허용 | — | 지식chunk를 선택했을 때만 정확한 범위 · 생성 후 불변 | 통합 추가 |
| knowledge_revision_id | text | 허용 | — | workhub.knowledge_revisions.id · 지식판 전체를 인용할 때만 · 생성 후 불변 | 통합 추가 |
| knowledge_chunk_id | text | 허용 | — | workhub.knowledge_chunks.id · chunk를 인용할 때만; revision은 chunk에서 파생 · 생성 후 불변 | 통합 추가 |
| document_id | text | 허용 | — | workhub.documents.id · 문서판 머리 ID · 생성 후 불변 | 통합 추가 |
| document_revision_no | integer | 허용 | — | workhub.document_revisions.revision_no · 정확한 문서판 · 생성 후 불변 | 통합 추가 |
| observation_id | text | 허용 | — | workhub.observations.id · 관찰판 머리 ID · 생성 후 불변 | 통합 추가 |
| observation_revision_no | integer | 허용 | — | workhub.observation_revisions.revision_no · 정확한 관찰판 · 생성 후 불변 | 통합 추가 |
| assessment_id | text | 허용 | — | workhub.assessments.id · 평가판 머리 ID · 생성 후 불변 | 통합 추가 |
| assessment_revision_no | integer | 허용 | — | workhub.assessment_revisions.revision_no · 정확한 평가판 · 생성 후 불변 | 통합 추가 |
| source_item_id | text | 허용 | — | workhub.source_items.id · 원자료 머리 ID · 생성 후 불변 | 통합 추가 |
| source_local_revision | integer | 허용 | — | workhub.source_item_revisions.local_revision · 정확한 원자료판 · 생성 후 불변 | 통합 추가 |
| source_sha256 | text | 불가 | — | 사용 당시 원본판 해시 · 생성 후 불변 | 통합 추가 |
| locator | jsonb | 불가 | — | 원문 위치/구간의 제한 스키마; 원문 없음 · 생성 후 불변 | 통합 추가 |
| locator_sha256 | text | 불가 | — | 서버가 정규화된 locator로 계산한 고유성 비교 지문 · 생성 후 불변 | 통합 추가 |
| authority_version | bigint | 불가 | — | 사용 당시 접근권한판 · 생성 후 불변 | 통합 추가 |
| evidence_epoch | bigint | 허용 | — | 학생 근거이면 필수인 owner gate epoch · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | 'active' | active/stale/withdrawn/blocked | 통합 추가 |
| invalidated_at | timestamptz | 허용 | — | 무효화 시각 | 통합 추가 |
| invalid_reason | text | 허용 | — | 본문 없는 사유 코드 | 통합 추가 |
| created_at | timestamptz | 불가 | now() | 근거 확정 시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- FK(scope_key,run_id,owner_account_id) REFERENCES workhub.ai_runs(scope_key,id,owner_account_id)
- kind별 정확히 한 원본 ID묶음; 모든 ID+revision 쌍은 동시존재 CHECK
- knowledge_revision: FK(knowledge_revision_scope_key,knowledge_revision_id) MATCH FULL REFERENCES workhub.knowledge_revisions(scope_key,id)
- knowledge_chunk: FK(knowledge_chunk_scope_key,knowledge_chunk_id) MATCH FULL REFERENCES workhub.knowledge_chunks(scope_key,id)
- 선택하지 않은 지식 scope/ID 쌍은 둘 다 NULL
- FK(scope_key,document_id,document_revision_no) REFERENCES workhub.document_revisions(scope_key,document_id,revision_no)
- FK(school_id,owner_account_id,observation_id,observation_revision_no) REFERENCES workhub.observation_revisions(school_id,created_by_account_id,observation_id,revision_no)
- FK(school_id,owner_account_id,assessment_id,assessment_revision_no) REFERENCES workhub.assessment_revisions(school_id,created_by_account_id,assessment_id,revision_no)
- FK(school_id,owner_account_id,source_item_id,source_local_revision) REFERENCES workhub.source_item_revisions(school_id,created_by_account_id,source_item_id,local_revision)
- 학생 kind이면 school_id/evidence_epoch NOT NULL; 모든 행의 school_id는 run.school_id와 IS NOT DISTINCT FROM
- locator_sha256는 서버 정규화 locator 해시와 일치

통합 동작 규칙:

- 학생자료는 school 전용이고 상담kind 없음; record_draft purpose는 source_item 직접근거 불가
- 지식은 본교/common, 개인 실행은 common만
- 원본 ACL/철회/판/해시 매회 재검사; 무효행 재활성화 금지
- 같은 학교 재임용 새대화에서 과거 본인 학생 근거는 별도 접근정책 통과시만 허용

인덱스: (run_id); 종류별 정확한 원본 ID/판 partial index; (scope_key,owner_account_id,state); UNIQUE(run_id,knowledge_revision_id,locator_sha256) WHERE kind='knowledge_revision'; UNIQUE(run_id,knowledge_chunk_id,locator_sha256) WHERE kind='knowledge_chunk'; UNIQUE(run_id,document_id,document_revision_no,locator_sha256) WHERE kind='document_revision'; UNIQUE(run_id,observation_id,observation_revision_no,locator_sha256) WHERE kind='observation_revision'; UNIQUE(run_id,assessment_id,assessment_revision_no,locator_sha256) WHERE kind='assessment_revision'; UNIQUE(run_id,source_item_id,source_local_revision,locator_sha256) WHERE kind='source_item_revision'

필수 시험: AI01: 타인/타교/혼합revision 거부; AI02: 개인범위 학생근거 거부; AI04: 정정과 결과공개 경합

## workhub.ai_runs

Claude·기억 · 기존 보강

열람: 본인+원생성소속 현재유효; job/result가 권한 우회 통로가 아님

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE ('a:'::text \|\| owner_account_id) END |  | 원본 |
| conversation_id | text | 허용 | — |  | 원본 |
| purpose | text | 불가 | — |  | 원본 |
| status | text | 불가 | 'running'::text |  | 원본 |
| model_config_version | text | 불가 | — |  | 원본 |
| prompt_version | text | 불가 | — |  | 원본 |
| tool_contract_version | text | 허용 | — |  | 원본 |
| max_tool_calls | integer | 불가 | — |  | 원본 |
| tool_call_count | integer | 불가 | 0 |  | 원본 |
| idem_key | text | 허용 | — |  | 원본 |
| started_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| error_code | text | 허용 | — |  | 원본 |
| origin_membership_id | text | 허용 | — | workhub.memberships.id · 학교 실행 생성 소속 · 생성 후 불변 | 통합 추가 |
| policy_version_id | text | 불가 | — | workhub.ai_policy_versions.id · 승인된 실제 실행 정책판 · 생성 후 불변 | 통합 추가 |
| job_id | text | 허용 | — | workhub.jobs.id · 비동기 실행을 소유한 동일 scope 작업 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- scope=school iff origin_membership_id IS NOT NULL
- FK(school_id,origin_membership_id,owner_account_id) REFERENCES workhub.memberships(school_id,id,account_id)
- FK(scope_key,job_id) REFERENCES workhub.jobs(scope_key,id)
- conversation이 있으면 scope/owner/origin_membership 일치 제약 trigger
- status CHECK에 queued,indeterminate,cancel_requested 추가; 종료시각 CHECK도 이에 맞춤

통합 동작 규칙:

- 모델/프롬프트/도구판 사본은 policy_version과 일치
- 성공 결과 공개 전에 현재 소속/정책/근거 gate 재검사

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,conversation_id,owner_account_id) → workhub.conversations(scope_key,id,owner_account_id)

필수 시험: AI03: 재임용으로 옛 실행 자동접근 불가; AI04: 입력판 바뀌면 자동 확정 불가

## workhub.assessment_activities

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| rubric_id | text | 불가 | — |  | 원본 |
| rubric_revision_no | integer | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| held_on | date | 허용 | — |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,owner_account_id,rubric_id) → workhub.rubrics(school_id,owner_account_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,rubric_id,rubric_revision_no) → workhub.rubric_revisions(school_id,rubric_id,revision_no)

## workhub.assessment_revisions

학생·평가·생기부 · 기존 보강

열람: 부모 평가 작성자 전용

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| assessment_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| rubric_id | text | 불가 | — |  | 원본 |
| rubric_revision_no | integer | 불가 | — |  | 원본 |
| result_status | text | 불가 | — |  | 원본 |
| item_scores | jsonb | 허용 | — |  | 원본 |
| total | numeric | 허용 | — |  | 원본 |
| ai_proposed | boolean | 불가 | false |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| confirmed_by_account_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| change_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| student_id | text | 불가 | — | workhub.students.id · 부모의 불변 학생 사본 · 생성 후 불변 | 통합 추가 |
| enrollment_id | text | 불가 | — | workhub.student_enrollments.id · 평가 기준일 당시 학적 · 생성 후 불변 | 통합 추가 |
| assessed_on | date | 불가 | — | 이 판의 평가 기준일 · 생성 후 불변 | 통합 추가 |
| body_sha256 | text | 불가 | — | 상태·기준판·항목점수·교사확인을 정규화한 서버 지문 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- UNIQUE(school_id,created_by_account_id,assessment_id,revision_no)
- FK(school_id,enrollment_id,student_id) REFERENCES workhub.student_enrollments(school_id,id,student_id)
- student_id=부모 학생; body_sha256는 64자리 소문자 hex
- 기존 scored/NULL·본인확정·루브릭판 복합 FK 유지

통합 동작 규칙:

- 근거 연결/출력에서 평가판 해시도 비교
- 활동 수업의 수강·승인 담당·기준일 검사

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_account_id,assessment_id) → workhub.assessments(school_id,author_account_id,id)
- (confirmed_by_account_id) → workhub.accounts(id)
- (created_by_account_id) → workhub.accounts(id)
- (school_id,rubric_id,rubric_revision_no) → workhub.rubric_revisions(school_id,rubric_id,revision_no)

필수 시험: SI04: 같은 학교 다른 학생 평가판 연결 거부; SI10: 루브릭 키/범위/합계 불일치 거부

## workhub.assessments

학생·평가·생기부 · 기존 보강

열람: 현재 본교 접근+author 본인; 관리자/지원자 점수·건수 접근 불가

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| activity_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| author_account_id | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| needs_review | boolean | 불가 | false |  | 원본 |
| current_revision_no | integer | 불가 | 1 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- id,school_id,author_account_id,student_id,activity_id 불변

통합 동작 규칙:

- R04: 다른 학생/평가활동으로 UPDATE 금지; 철회+새 기록만
- 확정자는 본인 교사; 총점은 승인 루브릭 기준으로 서버 계산

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,author_account_id,activity_id) → workhub.assessment_activities(school_id,owner_account_id,id)
- (author_account_id) → workhub.accounts(id)
- (school_id,student_id) → workhub.students(school_id,id)

필수 시험: SI01: 확정 평가의 학생 재귀속 거부; SI10: 미제출 NULL/실제 0점 구분

## workhub.assignments

업무·인계 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| department_id | text | 허용 | — |  | 원본 |
| subject_id | text | 허용 | — |  | 원본 |
| grade | smallint | 허용 | — |  | 원본 |
| academic_class_id | text | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| source | text | 불가 | 'admin'::text |  | 원본 |
| source_ref | text | 허용 | — |  | 원본 |
| approved_by_membership_id | text | 불가 | — |  | 원본 |
| approved_at | timestamp with time zone | 불가 | — |  | 원본 |
| ended_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id,academic_class_id) → workhub.academic_classes(school_id,academic_year_id,id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,approved_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,department_id) → workhub.departments(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,subject_id) → workhub.subjects(school_id,id)

## workhub.audience_conditions

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| group_id | text | 불가 | — |  | 원본 |
| dimension | text | 불가 | — |  | 원본 |
| ref_value | text | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,group_id) → workhub.audience_groups(school_id,id)

## workhub.audience_groups

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| audience_set_id | text | 불가 | — |  | 원본 |
| group_no | smallint | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,audience_set_id) → workhub.audience_sets(school_id,id)

## workhub.audience_members

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| audience_set_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| mode | text | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,audience_set_id) → workhub.audience_sets(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.audience_sets

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| include_all | boolean | 불가 | false |  | 원본 |
| label | text | 허용 | — |  | 원본 |
| created_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.audit_events

작업·이관·복구 · 기존 보강

열람: 민감도와 실제 원본/주체 정책의 교집합; 권한이 없던 본문을 audit가 새로 제공하지 않음

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| actor_account_id | text | 허용 | — |  | 원본 |
| actor_membership_id | text | 허용 | — |  | 원본 |
| actor_service_principal_id | text | 허용 | — |  | 원본 |
| support_session_id | text | 허용 | — |  | 원본 |
| operation | text | 불가 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 허용 | — |  | 원본 |
| resource_version | integer | 허용 | — |  | 원본 |
| sensitivity | text | 불가 | — |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| idem_key | text | 허용 | — |  | 원본 |
| details | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| occurred_at | timestamp with time zone | 불가 | now() |  | 원본 |
| scope_key | text | 불가 | — | school/account_private/common/service의 검증된 s:/a:/c/svc 키 · 생성 후 불변 | 통합 추가 |
| job_id | text | 허용 | — | workhub.jobs.id · 업무를 수행한 작업; 같은scope · 생성 후 불변 | 통합 추가 |
| worker_id | text | 허용 | — | 실제 worker 식별; 원요청자와 구별 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- actor_account_id/actor_service_principal_id XOR 정확히1; 기존 <=1 CHECK 교체
- actor_membership은 같은 학교·계정; support_session 실제 지원자 일치
- FK(scope_key,job_id) REFERENCES workhub.jobs(scope_key,id)

통합 동작 규칙:

- 학생/평가/원자료/AI private 종류는 owner_only; 관리자 COUNT 우회불가
- details는 제한 코드/ID/판만, 변경전후 원문snapshot 금지
- 지원은 실제지원자, 서비스는 실제principal로 기록; 타인주체 가장금지
- B01 공통 write_audit(context)가 검증된 DB identity/현재 요청·worker context에서 실제 actor를 파생; 공개 인자나 GUC만으로 principal 선택 금지
- 사람 원요청자와 실제 worker는 별도로 검증·기록; 서비스 actor는 B01 identity→principal 결합 및 현재 action/scope 검사 필수
- 모든 명령은 domain/판/receipt/필수audit/outbox를 같은 트랜잭션에 저장; 감사 실패 무시·빈 actor fallback 금지

인덱스: (scope_key,occurred_at,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (actor_account_id) → workhub.accounts(id)
- (actor_service_principal_id) → workhub.service_principals(id)
- (school_id,actor_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,support_session_id) → workhub.support_sessions(school_id,id)

필수 시험: AI13: 원문/prompt/키 없고 실제actor존재; 서비스actor와 사람actor동시 또는둘다NULL거부

## workhub.bell_periods

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| bell_schedule_id | text | 불가 | — |  | 원본 |
| seq | smallint | 불가 | — |  | 원본 |
| period_no | smallint | 허용 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| starts_at | time without time zone | 불가 | — |  | 원본 |
| ends_at | time without time zone | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,bell_schedule_id) → workhub.bell_schedules(school_id,id)

## workhub.bell_schedules

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| version_no | integer | 불가 | 1 |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id) → workhub.academic_years(school_id,id)

## workhub.calendar_day_grade_overrides

일정·시트 · 기존 보강

열람: 해당 학교 활성 소속. 과거 계산 근거는 판 ID와 함께 제공.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| day | date | 불가 | — |  | 원본 |
| grade | smallint | 불가 | — |  | 원본 |
| day_type | text | 불가 | — |  | 원본 |
| is_instructional | boolean | 불가 | — |  | 원본 |
| bell_schedule_id | text | 허용 | — |  | 원본 |
| source_event_id | text | 허용 | — |  | 원본 |
| source_event_revision_no | integer | 허용 | — | 일과 변경의 정확한 공식 확정판 | 통합 추가 |

통합 필수 제약:

- source_event_id/source_event_revision_no는 둘 다 NULL 또는 둘 다 존재; (school_id,source_event_id,source_event_revision_no) FK → workhub.event_revisions(school_id,event_id,revision_no)
- 학교/날짜 부모는 기존 calendar_days FK 유지; 확정 공식판만 근거 허용

통합 동작 규칙:

- 공식 확정/철회와 날짜 projection 갱신을 같은 transaction으로 처리한다.

인덱스: (school_id,source_event_id,source_event_revision_no)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,bell_schedule_id) → workhub.bell_schedules(school_id,id)
- (school_id,day) → workhub.calendar_days(school_id,day)
- (school_id,source_event_id) → workhub.events(school_id,id)

필수 시험: WF13

## workhub.calendar_days

일정·시트 · 기존 보강

열람: 해당 학교 활성 소속. 과거 계산 근거는 판 ID와 함께 제공.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| day | date | 불가 | — |  | 원본 |
| day_type | text | 불가 | — |  | 원본 |
| is_instructional | boolean | 불가 | — |  | 원본 |
| bell_schedule_id | text | 허용 | — |  | 원본 |
| weekday_override | smallint | 허용 | — |  | 원본 |
| source_event_id | text | 허용 | — |  | 원본 |
| note | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| source_event_revision_no | integer | 허용 | — | 일과 변경의 정확한 공식 확정판 | 통합 추가 |

통합 필수 제약:

- 근거 event ID와 revision은 둘 다 NULL 또는 둘 다 존재; (school_id,source_event_id,source_event_revision_no)는 같은 학교 event revision을 참조
- 확정 공식판만 근거 허용; 날짜는 academic_year 범위

통합 동작 규칙:

- 공식 확정/철회와 날짜 projection 갱신을 같은 transaction으로 처리한다.

인덱스: (school_id,source_event_id,source_event_revision_no)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,bell_schedule_id) → workhub.bell_schedules(school_id,id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,source_event_id) → workhub.events(school_id,id)

필수 시험: WF13

## workhub.classroom_connections

수업 앱 연결 · 신규

열람: 본인 안전 메타데이터만; credential_ref는 서버 전용 열

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 외부 수업앱 연결 ID · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 서버가 결정하는 학교 · 생성 후 불변 | 통합 추가 |
| owner_account_id | text | 불가 | — | workhub.accounts.id · 연결 소유 교사 · 생성 후 불변 | 통합 추가 |
| course_group_id | text | 불가 | — | workhub.course_groups.id · 이 연결에 허용된 수업; 다른 수업은 별도 연결 · 생성 후 불변 | 통합 추가 |
| external_app | text | 불가 | — | 허용된 공급 앱 registry key · 생성 후 불변 | 통합 추가 |
| endpoint_id | text | 불가 | — | 승인된 endpoint registry key | 통합 추가 |
| credential_ref | text | 불가 | — | 서버 비밀 저장소 참조이며 비밀값 아님 | 통합 추가 |
| state | text | 불가 | 'paused' | paused/active/revoked | 통합 추가 |
| permission_version | bigint | 불가 | 1 | 허용 범위 및 연결 권한판 | 통합 추가 |
| created_at | timestamptz | 불가 | now() | 생성시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,owner_account_id,id)
- FK(school_id,course_group_id) REFERENCES workhub.course_groups(school_id,id)
- state CHECK(paused,active,revoked); revoked는 끝 상태

통합 동작 규칙:

- 외부 payload의 school/owner는 권한근거가 아님
- 수신 시 현재 교사 소속/담당/연결권한 재검사

인덱스: (school_id,owner_account_id,state)

필수 시험: SI08: 연결1 인증으로 학교2 payload 위조 거부; 권한 회수 뒤 수신 원문 저장·채택 0

## workhub.classroom_event_receipts

수업 앱 연결 · 신규

열람: 본인 안전 수신상태만; 서버 전용 쓰기

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 수신 접수증 ID · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 연결에서 결정한 학교 · 생성 후 불변 | 통합 추가 |
| owner_account_id | text | 불가 | — | workhub.accounts.id · 연결에서 결정한 owner · 생성 후 불변 | 통합 추가 |
| connection_id | text | 불가 | — | workhub.classroom_connections.id · 인증된 연결 · 생성 후 불변 | 통합 추가 |
| event_id | text | 불가 | — | 외부 사건키 · 생성 후 불변 | 통합 추가 |
| external_revision | bigint | 불가 | — | 외부 사건판 · 생성 후 불변 | 통합 추가 |
| event_kind | text | 불가 | — | upsert/cancel/delete · 생성 후 불변 | 통합 추가 |
| payload_sha256 | text | 불가 | — | 정규화 제한 스키마 payload의 지문 · 생성 후 불변 | 통합 추가 |
| activity_instance_id | text | 불가 | — | workhub.activity_instances.id · 확인된 활동 · 생성 후 불변 | 통합 추가 |
| source_item_id | text | 허용 | — | workhub.source_items.id · 적용한 논리항목 | 통합 추가 |
| local_revision | integer | 허용 | — | workhub.source_item_revisions.local_revision · 적용한 내부판 | 통합 추가 |
| state | text | 불가 | 'received' | received/held/applied/ignored/blocked | 통합 추가 |
| safe_error_code | text | 허용 | — | 원문 없는 제한 오류코드 | 통합 추가 |
| received_at | timestamptz | 불가 | now() | 서버 수신시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(connection_id,event_id,external_revision)
- FK(school_id,owner_account_id,connection_id) REFERENCES workhub.classroom_connections(school_id,owner_account_id,id)
- FK(school_id,owner_account_id,activity_instance_id) REFERENCES workhub.activity_instances(school_id,owner_account_id,id)
- source_item_id/local_revision 동시 존재; FK(school_id,source_item_id,local_revision) REFERENCES workhub.source_item_revisions(school_id,source_item_id,local_revision)
- external_revision>0

통합 동작 규칙:

- 같은키 다른지문 conflict, 역전은 held/ignored이며 최신판 되돌리지 않음
- 원문을 receipt에 저장하지 않음; 삭제 원장 먼저 대조

인덱스: (connection_id,state,received_at)

필수 시험: SI08: 중복/역전/취소/삭제재수신/학교위조

## workhub.classroom_imports

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| activity_instance_id | text | 불가 | — |  | 원본 |
| file_object_id | text | 불가 | — |  | 원본 |
| file_sha256 | text | 불가 | — |  | 원본 |
| csv_kind | text | 불가 | — |  | 원본 |
| parser_version | text | 불가 | — |  | 원본 |
| header_check | jsonb | 불가 | — |  | 원본 |
| import_mode | text | 불가 | — |  | 원본 |
| supersedes_import_id | text | 허용 | — |  | 원본 |
| deletion_override_ref | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'previewed'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,owner_account_id,activity_instance_id) → workhub.activity_instances(school_id,owner_account_id,id)
- (owner_account_id) → workhub.accounts(id)
- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,owner_account_id,activity_instance_id,supersedes_import_id) → workhub.classroom_imports(school_id,owner_account_id,activity_instance_id,id)

## workhub.collection_correction_fulfillments

수합 · 신규

열람: 해당 correction request의 현재 권한.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 행 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 경계 | 통합 추가 |
| request_id | text | 불가 | — | workhub.correction_requests.id · 충족한 요청 | 통합 추가 |
| unit_id | text | 불가 | — | workhub.collection_units.id · 공통 단위 | 통합 추가 |
| submission_id | text | 불가 | — | workhub.submission_versions.id · 보완 제출판 | 통합 추가 |
| fulfilled_at | timestamptz | 불가 | — | 접수 시각 snapshot · 생성 후 불변 | 통합 추가 |
| due_kind_snapshot | text | 불가 | — | date/time 당시 비교식 · 생성 후 불변 | 통합 추가 |
| due_at_snapshot | timestamptz | 불가 | — | 당시 보완기한 · 생성 후 불변 | 통합 추가 |
| late | boolean | 불가 | — | 당시 지연 · 생성 후 불변 | 통합 추가 |
| invalidated_at | timestamptz | 허용 | — | 충족 무효 시각 | 통합 추가 |
| invalidation_reason | text | 허용 | — | submission_withdrawn/request_cancelled | 통합 추가 |
| invalidated_by_membership_id | text | 허용 | — | workhub.memberships.id · 무효 사건 실행자 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- request/submission 모두 (school_id,unit_id,id) 복합 FK
- UNIQUE(request_id,submission_id)
- UNIQUE(request_id) WHERE invalidated_at IS NULL
- invalidated_* 세 열 동시 NULL 또는 존재
- 요청 생성 후 제출판이고 submit의 correction_request_id와 일치

통합 동작 규칙:

- 충족 본문 불변, 무효 메타는 한 번만. 철회 후 다시 제출하면 새 fulfillment.
- 요청 포인터는 현재 유효 fulfillment projection, 변경 명령 하나로 같이 갱신.

인덱스: (school_id,unit_id,fulfilled_at DESC,id)

필수 시험: WF07

## workhub.collection_due_changes

수합 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| collection_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 허용 | — |  | 원본 |
| due_at | timestamp with time zone | 불가 | — |  | 원본 |
| reason | text | 허용 | — |  | 원본 |
| changed_by_membership_id | text | 불가 | — |  | 원본 |
| changed_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,changed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,collection_id) → workhub.collections(school_id,id)
- (school_id,collection_id,unit_id) → workhub.collection_units(school_id,collection_id,id)

## workhub.collection_fields

수합 · 기존 보강

열람: 수합 안내 권한. 값/답변은 포함하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| collection_id | text | 불가 | — |  | 원본 |
| schema_version | integer | 불가 | — |  | 원본 |
| field_key | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| required | boolean | 불가 | true |  | 원본 |
| options | jsonb | 허용 | — |  | 원본 |
| number_min | numeric | 허용 | — |  | 원본 |
| number_max | numeric | 허용 | — |  | 원본 |
| file_accept | text[] | 허용 | — |  | 원본 |
| file_max_bytes | bigint | 허용 | — |  | 원본 |
| help_text | text | 허용 | — |  | 원본 |
| sort_order | smallint | 불가 | 0 |  | 원본 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 불변 정의 부모 | 통합 추가 |
| max_length | integer | 허용 | — | short_text 코드포인트 상한 | 통합 추가 |
| file_max_count | integer | 허용 | — | file 문항 최대수 | 통합 추가 |

통합 필수 제약:

- (school_id,collection_id,schema_id,schema_version) FK collection_schemas의 일치하는 부모
- UNIQUE(school_id,schema_id,field_key)
- UNIQUE(school_id,schema_id,id)
- options는 key/label 객체 배열, key 유일·공백 불가
- 종류별 불필요 옵션/한도 NULL; 숫자 한도 유한; max_length/file_count 양수

통합 동작 규칙:

- published/retired 부모의 field INSERT/UPDATE/DELETE 전부 거부.
- 키·타입·옵션·필수값 검증은 validate_collection_answers에서 해당 schema만 사용.

인덱스: (school_id,schema_id,sort_order,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id) → workhub.collections(school_id,id)

필수 시험: WF03; WF15

## workhub.collection_reviewers

수합 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| collection_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| added_by_membership_id | text | 불가 | — |  | 원본 |
| added_at | timestamp with time zone | 불가 | now() |  | 원본 |
| removed_at | timestamp with time zone | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,added_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,collection_id) → workhub.collections(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.collection_schemas

수합 · 신규

열람: 안내 읽기 허용자. 개인/공동 답변은 이 표에 넣지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 행 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 경계 | 통합 추가 |
| collection_id | text | 불가 | — | workhub.collections.id · 수합 부모 | 통합 추가 |
| schema_version | integer | 불가 | — | 수합 안 문항판 | 통합 추가 |
| state | text | 불가 | 'draft' | draft/published/retired | 통합 추가 |
| review_mode | text | 불가 | — | none/required | 통합 추가 |
| self_review | text | 불가 | 'forbid' | forbid/allow_with_note | 통합 추가 |
| title | text | 불가 | — | 문항판 제목 | 통합 추가 |
| instructions | text | 허용 | — | 안내 snapshot | 통합 추가 |
| definition_sha256 | text | 허용 | — | 게시 시 문항/옵션/정책 지문 | 통합 추가 |
| created_by_membership_id | text | 불가 | — | workhub.memberships.id · 같은 학교 작성자 | 통합 추가 |
| created_at | timestamptz | 불가 | clock_timestamp() | 서버 생성 | 통합 추가 |
| published_at | timestamptz | 허용 | — | 최초 게시 시각 | 통합 추가 |
| policy_scope_key | text | 허용 | — | workhub.policy_versions.scope_key · 본교 collection.submission 정책 scope | 통합 추가 |
| policy_version_id | text | 허용 | — | workhub.policy_versions.id · 정확한 승인 정책판 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- UNIQUE(school_id,collection_id,schema_version)
- UNIQUE(school_id,collection_id,id)
- UNIQUE(school_id,collection_id,id,schema_version)
- schema_version>0; state/review/self_review 허용값 CHECK
- (policy_scope_key,policy_version_id) MATCH FULL FK policy_versions(scope_key,id); policy_scope_key='s:'||school_id
- published/retired이면 hash/published_at/정책판 NN

통합 동작 규칙:

- draft에서만 문항 편집. publish 후 내용/정책/지문 불변; retired는 현재 적용 금지일 뿐 과거 참조 유지.
- publish가 부모 FOR UPDATE를 잡고 child field 편집은 같은 부모 잠금과 충돌한다.
- 정책판은 published·승인·시행일·applies_to_scopes·policy_key 검사.

인덱스: (school_id,collection_id,schema_version DESC)

필수 시험: WF03; WF15

## workhub.collection_unit_members

수합 · 기존 보강

열람: 허용 단위의 구성원 메타. 초안 읽기는 현재 유효 구성원만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| role | text | 불가 | — |  | 원본 |
| valid_from | timestamp with time zone | 불가 | now() |  | 원본 |
| removed_at | timestamp with time zone | 허용 | — |  | 원본 |
| added_by_membership_id | text | 허용 | — |  | 원본 |
| valid_until | timestamptz | 허용 | — | 종료 제외, 계획 종료 시각 | 통합 추가 |
| created_at | timestamptz | 불가 | clock_timestamp() | 미래 시작 구성원의 취소 검증 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- valid_until IS NULL OR valid_until>valid_from
- 기존 removed_at>=valid_from CHECK 제거; removed_at IS NULL OR removed_at>=created_at
- 동일 unit/member/role의 [valid_from,valid_until) 기간 EXCLUDE WHERE removed_at IS NULL
- responsible role의 unit별 기간 EXCLUDE WHERE removed_at IS NULL; 기존 removed_at만 기준 unique 교체

통합 동작 규칙:

- 공통 read/write 판정에 valid_from<=now<valid_until 및 removed_at NULL 적용.
- removed_at은 실제 즉시 회수, 미래 종료는 valid_until.
- 변경 시 permission_version/회수원장/grant 회수·캐시 무효화를 같은 transaction.

인덱스: (membership_id,valid_from,valid_until,unit_id) WHERE removed_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,added_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)

필수 시험: WF01; WF18

## workhub.collection_units

수합 · 기존 보강

열람: 당사자와 명시 결과 공개 범위의 안전 현황. private draft 존재 수는 노출 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| collection_id | text | 불가 | — |  | 원본 |
| unit_key | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| responsible_membership_id | text | 허용 | — | workhub.memberships.id · 현재 책임자; 공백 허용 | 통합 변경 |
| obligation_state | text | 불가 | 'assigned'::text |  | 원본 |
| exempt_reason | text | 허용 | — |  | 원본 |
| exempted_by_membership_id | text | 허용 | — |  | 원본 |
| exempted_at | timestamp with time zone | 허용 | — |  | 원본 |
| due_at_override | timestamp with time zone | 허용 | — |  | 원본 |
| current_submission_id | text | 허용 | — |  | 원본 |
| effective_submission_id | text | 허용 | — |  | 원본 |
| first_valid_submitted_at | timestamp with time zone | 허용 | — |  | 원본 |
| first_submission_late | boolean | 허용 | — |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| active_schema_id | text | 불가 | — | workhub.collection_schemas.id · 해당 단위 적용판 | 통합 추가 |
| first_submission_id | text | 허용 | — | workhub.submission_versions.id · 최초 접수의 불변 근거 | 통합 추가 |
| needs_owner | boolean | 불가 | false | 책임 공백 projection | 통합 추가 |

통합 필수 제약:

- active_schema는 same collection 복합 FK
- current/effective/first는 동일 unit 복합 FK DEFERRABLE
- assigned and not needs_owner이면 현재 유효 책임자 필수
- current는 submitted; effective는 submitted+accepted/not_required; none 현재판은 current=effective; 첫 제출 포인터 불변

통합 동작 규칙:

- current/effective/first/보완/집계는 제출·검토·철회 한 transaction.
- 책임자 pointer만으로 미래 기간 접근을 허용하지 않고 현재 관계를 재확인.
- 인계해도 unit_id/제출/완료본 유지; 면제는 본문 삭제 아님.

인덱스: (school_id,collection_id,obligation_state,id); (school_id,responsible_membership_id,obligation_state,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id) → workhub.collections(school_id,id)
- (school_id,exempted_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,responsible_membership_id) → workhub.memberships(school_id,id)
- (school_id,id,current_submission_id) → workhub.submission_versions(school_id,unit_id,id)
- (school_id,id,effective_submission_id) → workhub.submission_versions(school_id,unit_id,id)

필수 시험: WF01; WF06; WF07; WF14

## workhub.collections

수합 · 기존 보강

열람: 안내는 request_visibility+당사자. 결과는 단위 구성원/검토자/요청관리범위, 명시 공개 시 완료본만. 초안 자동 접근 없음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| purpose | text | 허용 | — |  | 원본 |
| owner_membership_id | text | 불가 | — |  | 원본 |
| department_id | text | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| unit_kind | text | 불가 | — |  | 원본 |
| review_mode | text | 불가 | — |  | 원본 |
| self_review | text | 불가 | — |  | 원본 |
| schema_version | integer | 불가 | 1 |  | 원본 |
| obligation_audience_set_id | text | 허용 | — |  | 원본 |
| due_at | timestamp with time zone | 불가 | — |  | 원본 |
| due_on | date | 허용 | — |  | 원본 |
| due_change_revision | integer | 불가 | 1 |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| published_at | timestamp with time zone | 허용 | — |  | 원본 |
| closed_at | timestamp with time zone | 허용 | — |  | 원본 |
| cancelled_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| current_schema_id | text | 허용 | — | workhub.collection_schemas.id · 정확한 현재 published 문항판 | 통합 추가 |
| request_visibility | text | 불가 | — | school/audience/participants | 통합 추가 |
| request_audience_set_id | text | 허용 | — | workhub.audience_sets.id · 안내 대상 | 통합 추가 |
| result_visibility | text | 불가 | 'participants' | participants/audience/school | 통합 추가 |
| result_audience_set_id | text | 허용 | — | workhub.audience_sets.id · 완료 결과 공개 대상 | 통합 추가 |
| results_published_by_membership_id | text | 허용 | — | workhub.memberships.id · 결과 공개 확대 확인자 | 통합 추가 |
| results_published_at | timestamptz | 허용 | — | 결과 공개 확대 시각 | 통합 추가 |

제거/대체 대상: visibility, view_audience_set_id

통합 필수 제약:

- (school_id,id,current_schema_id) FK collection_schemas(school_id,collection_id,id) DEFERRABLE
- published 이후 current_schema_id NN, same collection의 published 판
- 각 visibility=audience iff 해당 audience FK NN
- result_visibility<>participants이면 results_published_by/at NN 및 명시 receipt

통합 동작 규칙:

- 기존 schema_version/review_mode/self_review는 schema projection, 독립 수정 금지.
- 안내 공개 변경이 result 공개를 자동 변경하지 않는다.
- 게시 대상은 unit/member snapshot 한 번; 동적 추천으로 의무 재생성 금지.

인덱스: (school_id,state,due_at,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,department_id) → workhub.departments(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,obligation_audience_set_id) → workhub.audience_sets(school_id,id)
- (school_id,owner_membership_id) → workhub.memberships(school_id,id)
- (school_id,view_audience_set_id) → workhub.audience_sets(school_id,id)

필수 시험: WF03; WF06; WF18

## workhub.constraint_sets

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| version_no | integer | 불가 | — |  | 원본 |
| based_on_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| created_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| locked_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,based_on_id) → workhub.constraint_sets(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

## workhub.conversations

Claude·기억 · 기존 보강

열람: 본인+생성 소속이 현재 유효+학교/자료 유효; 개인은 승인된 개인 이용자격

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE ('a:'::text \|\| owner_account_id) END |  | 원본 |
| context_type | text | 불가 | 'assistant'::text |  | 원본 |
| context_ref | text | 허용 | — |  | 원본 |
| title | text | 허용 | — |  | 원본 |
| legacy_conversation_id | text | 허용 | — |  | 원본 |
| archived_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| origin_membership_id | text | 허용 | — | workhub.memberships.id · 학교 대화를 생성한 소속; 개인 대화는 NULL · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- scope=school iff origin_membership_id IS NOT NULL
- FK(school_id,origin_membership_id,owner_account_id) REFERENCES workhub.memberships(school_id,id,account_id)
- scope,school_id,owner_account_id,origin_membership_id 불변

통합 동작 규칙:

- 재임용 새 membership으로 과거 대화 자동 재열람/자동이관 금지
- 개인 대화에 학교 원문/학생자료 연결 금지

인덱스: (owner_account_id,origin_membership_id,updated_at DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

필수 시험: AI03: 소속 종료→같은학교 재임용 후 옛 대화 0; AI02: 개인 대화의 학교자료 인용 거부

## workhub.cooperation_requests

업무·인계 · 기존 보강

열람: 송신/수신 현재 관계자; 관리자 audit.read 원문 열람 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| from_membership_id | text | 불가 | — |  | 원본 |
| to_membership_id | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| body | text | 허용 | — |  | 원본 |
| due_at | timestamp with time zone | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'requested'::text |  | 원본 |
| substitute_membership_id | text | 허용 | — |  | 원본 |
| response_note | text | 허용 | — |  | 원본 |
| responded_at | timestamp with time zone | 허용 | — |  | 원본 |
| linked_task_id | text | 허용 | — |  | 원본 |
| follow_up_of | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- linked_task_id는 같은 school, 수신자 account 소유, source_type=cooperation,source_id=this.id
- follow_up_of는 같은 school이며 순환 금지

통합 동작 규칙:

- 수락+연결 task+응답 개정+receipt/outbox 원자.
- 대체제안은 새 요청과 수신자 수락 없이 자동 배정하지 않는다.
- 이력 본문도 원본의 현재 ACL. task.note는 응답에 포함하지 않는다.

인덱스: (school_id,to_membership_id,state,due_at,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id,follow_up_of) → workhub.cooperation_requests(school_id,id)
- (school_id,from_membership_id) → workhub.memberships(school_id,id)
- (school_id,linked_task_id) → workhub.tasks(school_id,id)
- (school_id,substitute_membership_id) → workhub.memberships(school_id,id)
- (school_id,to_membership_id) → workhub.memberships(school_id,id)

필수 시험: WF14; WF18

## workhub.correction_requests

수합 · 기존 보강

열람: 현재 당사자; 결과 공개 범위는 보완 내용 접근 권한 아님.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| target_submission_id | text | 불가 | — |  | 원본 |
| review_id | text | 허용 | — |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| due_at | timestamp with time zone | 불가 | — |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| fulfilled_by_submission_id | text | 허용 | — |  | 원본 |
| fulfilled_at | timestamp with time zone | 허용 | — |  | 원본 |
| fulfilled_late | boolean | 허용 | — |  | 원본 |
| cancelled_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| supersedes_request_id | text | 허용 | — | workhub.correction_requests.id · 기한/내용 변경 전 취소한 같은 단위 요청 | 통합 추가 |
| due_kind | text | 불가 | — | date/time | 통합 추가 |

통합 필수 제약:

- target/review/fulfilled/supersedes는 정확히 같은 unit, review는 target판
- 이유·기한·대상판 INSERT 후 불변; 변경은 취소+새 요청
- state fulfilled iff active fulfillment 존재 및 포인터/시각/late 일치
- fulfillment판은 요청 후 판·철회 안 됨; cancelled는 재개 금지

통합 동작 규칙:

- 무관한 제출로 자동 충족 금지. submit은 명시 request ID.
- fulfilled판 철회 때 fulfillment 무효·포인터비움·open 재계산을 같은 transaction.
- target판 철회 자체는 미충족 요청을 없애지 않는다.

인덱스: (school_id,unit_id,due_at) WHERE state='open'

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,target_submission_id,review_id) → workhub.submission_reviews(school_id,submission_id,id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)
- (school_id,unit_id,fulfilled_by_submission_id) → workhub.submission_versions(school_id,unit_id,id)
- (school_id,unit_id,target_submission_id) → workhub.submission_versions(school_id,unit_id,id)

필수 시험: WF06; WF07

## workhub.correction_windows

수합 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| collection_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| opens_at | timestamp with time zone | 불가 | — |  | 원본 |
| closes_at | timestamp with time zone | 불가 | — |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| allows | text | 불가 | — |  | 원본 |
| opened_by_membership_id | text | 불가 | — |  | 원본 |
| closed_early_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id,unit_id) → workhub.collection_units(school_id,collection_id,id)
- (school_id,opened_by_membership_id) → workhub.memberships(school_id,id)

## workhub.counselling_records

학생·평가·생기부 · 기존 보강

열람: 현재 본교 유효 접근+본인 작성자; 과거정정 정책 별도 적용

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| author_account_id | text | 불가 | — |  | 원본 |
| author_membership_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| held_on | date | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'confirmed'::text |  | 원본 |
| current_revision_no | integer | 불가 | 1 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- id,school_id,author_account_id,author_membership_id,student_id,academic_year_id 불변

통합 동작 규칙:

- 상담 본문과 존재·건수는 관리자/지원/일반 AI/인계/생기부 근거에서 제외

기존 FK 관계(변경 계약과 충돌하면 대체):

- (author_account_id) → workhub.accounts(id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,author_membership_id) → workhub.memberships(school_id,id)
- (school_id,student_id) → workhub.students(school_id,id)

필수 시험: SI04: 관리자 COUNT=0; SI09: 담당 인계로 상담 소유 변경 불가

## workhub.counselling_revisions

학생·평가·생기부 · 기존 보강

열람: 부모 상담과 동일한 작성자 전용

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| counselling_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| follow_up | text | 허용 | — |  | 원본 |
| change_reason | text | 허용 | — |  | 원본 |
| body_sha256 | text | 불가 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| student_id | text | 불가 | — | workhub.students.id · 부모의 불변 학생 사본 · 생성 후 불변 | 통합 추가 |
| enrollment_id | text | 불가 | — | workhub.student_enrollments.id · 상담 당시 해당 학생 학적 · 생성 후 불변 | 통합 추가 |
| held_on | date | 불가 | — | 이 판의 상담일 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- FOREIGN KEY(school_id,enrollment_id,student_id) REFERENCES workhub.student_enrollments(school_id,id,student_id)
- 학생은 부모 identity와 같고 상담일 학적 및 허용 상담/담임 관계 확인

통합 동작 규칙:

- 판은 불변; 삭제 작업의 본문 가림만 예외
- 일반 ai_run_sources/evidence_links kind에 상담 추가 금지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_account_id,counselling_id) → workhub.counselling_records(school_id,author_account_id,id)
- (created_by_account_id) → workhub.accounts(id)

필수 시험: SI04: 다른 학생 학적 거부; SI09: 현재 담당 없는 과거 본인 정정은 승인 정책을 거침

## workhub.course_group_classes

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| academic_class_id | text | 불가 | — |  | 원본 |
| occupancy | text | 불가 | — |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_class_id) → workhub.academic_classes(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)

## workhub.course_group_teachers

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| role | text | 불가 | 'primary'::text |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| source | text | 불가 | 'admin'::text |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.course_groups

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| subject_id | text | 허용 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| weekly_hours | numeric(4,1) | 불가 | — |  | 원본 |
| block_pattern | smallint[] | 허용 | — |  | 원본 |
| required_space_kind | text | 허용 | — |  | 원본 |
| default_space_id | text | 허용 | — |  | 원본 |
| roster_basis | text | 불가 | 'class_enrollment'::text |  | 원본 |
| engine_unit_key | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,default_space_id) → workhub.spaces(school_id,id)
- (school_id,subject_id) → workhub.subjects(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

## workhub.course_memberships

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| source | text | 불가 | 'import'::text |  | 원본 |
| confirmed_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,student_id) → workhub.students(school_id,id)

## workhub.cover_ledger

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| cause_change_set_id | text | 불가 | — |  | 원본 |
| lesson_instance_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| entry_kind | text | 불가 | — |  | 원본 |
| hours | numeric(4,1) | 불가 | — |  | 원본 |
| execution_revision_no | integer | 허용 | — |  | 원본 |
| settles_id | text | 허용 | — |  | 원본 |
| reverses_id | text | 허용 | — |  | 원본 |
| formula_ref | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,cause_change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,lesson_instance_id,execution_revision_no) → workhub.lesson_executions(school_id,lesson_instance_id,revision_no)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,reverses_id) → workhub.cover_ledger(school_id,id)
- (school_id,settles_id) → workhub.cover_ledger(school_id,id)

## workhub.data_write_authority

작업·이관·복구 · 기존 보강

열람: 현재 자기 학교의 쓰기 기준 설명. 변경은 승인된 운영 명령.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| data_kind | text | 불가 | — |  | 원본 |
| authority | text | 불가 | — |  | 원본 |
| effective_from | timestamp with time zone | 불가 | — |  | 원본 |
| cutover_run_id | text | 허용 | — |  | 원본 |
| approval_ref | text | 불가 | — |  | 원본 |
| decided_by_account_id | text | 불가 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- 기존 PK(school_id,data_kind), cutover run 동일학교 FK 유지

통합 동작 규칙:

- 자료종류별 쓰기 권위는 한 곳이며 양방향 자동 덮어쓰기 금지.
- 이관 완료 뒤 legacy는 소속/권한을 되살리는 권위가 아니다.
- 계정 전역 권위 전환은 학교 한 행으로 표현하지 않고 승인된 전역 적용본/legacy gate와 묶는다.

인덱스: 기존 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (decided_by_account_id) → workhub.accounts(id)
- (school_id,cutover_run_id) → workhub.migration_runs(school_id,id)
- (school_id) → workhub.schools(id)

필수 시험: MIG03 병행쓰기 충돌; MIG04 옛 경로 쓰기 회수

## workhub.deletion_ledger

작업·이관·복구 · 기존 보강

열람: 본인 요청의 최소 처리 상태 또는 지정 파기 담당의 메타. 본문 없음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| seq | bigint | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 불가 | — |  | 원본 |
| content_sha256 | text | 허용 | — |  | 원본 |
| file_sha256 | text | 허용 | — |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| retention_rule_id | text | 허용 | — |  | 원본 |
| retention_rule_scope | text | 허용 | — |  | 원본 |
| retention_rule_scope_key | text | 허용 |  CASE retention_rule_scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     WHEN 'common'::text THEN 'c'::text     ELSE NULL::text END |  | 원본 |
| requested_by_account_id | text | 허용 | — |  | 원본 |
| requested_at | timestamp with time zone | 불가 | now() |  | 원본 |
| approved_by_account_id | text | 허용 | — |  | 원본 |
| approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| state | text | 불가 | 'requested'::text |  | 원본 |
| blocked_at | timestamp with time zone | 허용 | — |  | 원본 |
| scope_summary | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| retained_reason | text | 허용 | — |  | 원본 |
| completed_at | timestamp with time zone | 허용 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| job_scope_key | text | 허용 | — | 상수 c 생성열을 제거하고 검증된 명시 열로 대체. 학교/공통은 같은 scope, 개인 파기 전용 예외는 svc 실행 범위 | 통합 변경 |
| replicated_at | timestamp with time zone | 허용 | — |  | 원본 |
| scope | text | 불가 | — | 삭제 대상 자료의 school/account_private/common/service | 통합 추가 |
| owner_account_id | text | 허용 | — | workhub.accounts.id · 개인 범위면 필수 | 통합 추가 |
| scope_key | text | 불가 | GENERATED ALWAYS AS (CASE scope WHEN 'school' THEN 's:' \|\| school_id WHEN 'account_private' THEN 'a:' \|\| owner_account_id WHEN 'common' THEN 'c' ELSE 'svc' END) STORED | 삭제 대상의 명시적 범위 · 생성 후 불변 | 통합 추가 |
| manifest_sha256 | text | 허용 | — | 차단 이후 필수인 승인된 정확한 파기 영향목록 지문 | 통합 추가 |

통합 필수 제약:

- scope와 school/owner 일치 CHECK
- UNIQUE(scope_key,id)
- FOREIGN KEY(job_scope_key,job_id) REFERENCES workhub.jobs(scope_key,id) MATCH FULL
- state<>'requested'면 manifest_sha256 NOT NULL 및 64hex
- scope=school/common이면 job_scope_key=scope_key; account_private의 승인된 전용 파기만 job_scope_key=svc 허용
- 원본별 유일성을 (scope_key,resource_type,resource_id)로 명시

통합 동작 규칙:

- partial은 완료가 아니며 같은 승인 잔여목록으로 재개할 수 있다.
- 완료는 DB 원문/사본/추출/색인/캐시/파일·결과를 각각 대조한 뒤만 가능.
- 정확한 개인 승인 manifest 처리만 서비스 실행 scope 예외로 허용하며 임의 계정 열람 도구를 제공하지 않는다.
- 삭제 대상/승인/지문 불변. 확대는 새 승인.
- 사용 차단과 복구 재적용 원장 기록은 같은 트랜잭션.
- job_scope_key의 기존 GENERATED 상수 식을 제거하고 기존 행을 승인된 실제 job.scope_key와 대조·백필한다. 이 변경 목록은 목표 필드사전이며 실제 ALTER/제약 교체 순서는 확정 SQL에서 검증한다.

인덱스: (scope_key,state,requested_at) WHERE state IN ('requested','blocked','in_progress','partial')

기존 FK 관계(변경 계약과 충돌하면 대체):

- (approved_by_account_id) → workhub.accounts(id)
- (job_scope_key,job_id) → workhub.jobs(scope_key,id)
- (requested_by_account_id) → workhub.accounts(id)
- (retention_rule_scope_key,retention_rule_id) → workhub.retention_rules(scope_key,id)
- (school_id) → workhub.schools(id)
- (resource_type) → workhub.resource_classes(resource_type)

필수 시험: MIG06 partial 재개·실물 잔존·hold 검사; MIG07 복구 후 재파기; FS09 개인 manifest 밖 실행 거부

## workhub.departments

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| kind | text | 불가 | 'department'::text |  | 원본 |
| sort_order | smallint | 불가 | 0 |  | 원본 |
| active_from | date | 불가 | — |  | 원본 |
| active_to | date | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

## workhub.document_actions

파일·문서 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| document_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| action | text | 불가 | — |  | 원본 |
| file_object_id | text | 허용 | — |  | 원본 |
| submission_version_id | text | 허용 | — |  | 원본 |
| external_ref | text | 허용 | — |  | 원본 |
| actor_account_id | text | 불가 | — |  | 원본 |
| at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (actor_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (school_id,submission_version_id) → workhub.submission_versions(school_id,id)
- (scope_key,document_id,revision_no) → workhub.document_revisions(scope_key,document_id,revision_no)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)

## workhub.document_inputs

파일·문서 · 기존 보강

열람: 목적 문서의 현재 권한과 원본파일 허용 범위.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| scope_key | text | 불가 | — |  | 원본 |
| document_id | text | 불가 | — |  | 원본 |
| file_object_id | text | 불가 | — |  | 원본 |
| purpose | text | 불가 | — |  | 원본 |
| added_by_account_id | text | 불가 | — |  | 원본 |
| added_at | timestamp with time zone | 불가 | now() |  | 원본 |
| file_scope_key | text | 불가 | — | workhub.file_objects.scope_key · 입력 파일의 정확한 범위. 목적 문서 scope_key와 분리, 기존 같은범위 행을 확인 후 백필 | 통합 추가 |

통합 필수 제약:

- (scope_key,document_id) FK → workhub.documents(scope_key,id) 유지; 두 열 NOT NULL
- 기존 (scope_key,file_object_id) FK를 (file_scope_key,file_object_id) FK → workhub.file_objects(scope_key,id)로 교체; 두 열 NOT NULL
- CHECK(file_scope_key=scope_key OR file_scope_key='c'); 학교→본교/common, 개인→본인/common, 공통→common
- fact_source는 extract_state=ok 및 교사의 명시 확인 근거

통합 동작 규칙:

- 연결·생성·출력 시 현재 파일/원본 읽기·목적 문서 쓰기·안전 정책·공통 게시 상태를 함께 검사. scope 일치만으로 읽기 허가 금지.
- extract ok 자체를 사실 확정으로 보지 않고 form/fact_source/style_example 용도와 교사 확인을 구분.
- 채택한 입력은 document_revision_sources.source_scope_key/source_file_id에 같은 정확 파일 범위를 고정. generic file_links의 같은scope 규칙은 그대로 유지.

인덱스: (file_scope_key,file_object_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (added_by_account_id) → workhub.accounts(id)
- (scope_key,document_id) → workhub.documents(scope_key,id)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)

필수 시험: WF10; WF11; WF17; WF17: 학교/common·개인/common 입력 성공, 타학교·다른개인·학교→개인 연결 거부; 공통 자료 철회 후 생성/출력 차단

## workhub.document_packs

파일·문서 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| pack_code | text | 불가 | — |  | 원본 |
| school_year | smallint | 허용 | — |  | 원본 |
| pack_version | text | 불가 | — |  | 원본 |
| support_level | text | 불가 | — |  | 원본 |
| school_levels | text[] | 불가 | '{}'::text[] |  | 원본 |
| asset_manifest | jsonb | 불가 | — |  | 원본 |
| asset_sha256 | text | 불가 | — |  | 원본 |
| validation_status | text | 불가 | 'pending'::text |  | 원본 |
| validation_tests_run | integer | 허용 | — |  | 원본 |
| validation_tests_skipped | integer | 허용 | — |  | 원본 |
| validation_required_skipped | integer | 허용 | — |  | 원본 |
| validation_report | jsonb | 허용 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| activated_at | timestamp with time zone | 허용 | — |  | 원본 |
| retired_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

## workhub.document_revision_sources

파일·문서 · 신규

열람: 목적 문서 현재 read와 원본 현재 read의 교집합. 존재 정보도 허용 범위만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 근거 관계 ID · 생성 후 불변 | 통합 추가 |
| scope_key | text | 불가 | — | workhub.documents.scope_key · 목적 문서 scope | 통합 추가 |
| school_id | text | 허용 | — | workhub.schools.id · 학교 문서만 | 통합 추가 |
| document_id | text | 불가 | — | workhub.documents.id · 목적 문서 | 통합 추가 |
| revision_no | integer | 불가 | — | 목적 불변판 | 통합 추가 |
| source_kind | text | 불가 | — | file/event_revision/document_revision/knowledge_revision | 통합 추가 |
| source_scope_key | text | 불가 | — | 원본 정확 scope | 통합 추가 |
| source_file_id | text | 허용 | — | workhub.file_objects.id · 파일 근거 | 통합 추가 |
| source_event_id | text | 허용 | — | workhub.events.id · 일정 근거 | 통합 추가 |
| source_event_revision_no | integer | 허용 | — | 정확 일정판 | 통합 추가 |
| source_document_id | text | 허용 | — | workhub.documents.id · 문서 근거 | 통합 추가 |
| source_document_revision_no | integer | 허용 | — | 정확 문서판 | 통합 추가 |
| source_knowledge_revision_id | text | 허용 | — | workhub.knowledge_revisions.id · 정확 지식판 | 통합 추가 |
| source_sha256 | text | 불가 | — | 당시 원본 지문 · 생성 후 불변 | 통합 추가 |
| purpose | text | 불가 | — | form/fact/style | 통합 추가 |
| locator | text | 불가 | — | 쪽/문항/문단 위치 | 통합 추가 |
| confirmed_by_account_id | text | 불가 | — | workhub.accounts.id · 근거 확인 계정 | 통합 추가 |
| confirmed_at | timestamptz | 불가 | clock_timestamp() | 확인시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(scope_key,id)
- (scope_key,document_id,revision_no) FK → workhub.document_revisions(scope_key,document_id,revision_no); 세 열 NOT NULL
- source_kind IN (file,event_revision,document_revision,knowledge_revision); file이면 source_file_id만 NN, event_revision이면 source_event_id/source_event_revision_no만 NN, document_revision이면 source_document_id/source_document_revision_no만 NN, knowledge_revision이면 source_knowledge_revision_id만 NN; 각 경우 나머지 모든 ID와 판번호는 NULL인 CHECK
- MATCH SIMPLE FK (source_scope_key,source_file_id) → workhub.file_objects(scope_key,id)
- MATCH SIMPLE FK (source_scope_key,source_event_id,source_event_revision_no) → workhub.event_revisions(scope_key,event_id,revision_no)
- MATCH SIMPLE FK (source_scope_key,source_document_id,source_document_revision_no) → workhub.document_revisions(scope_key,document_id,revision_no)
- MATCH SIMPLE FK (source_scope_key,source_knowledge_revision_id) → workhub.knowledge_revisions(scope_key,id)
- source_scope_key NOT NULL; kind별 CHECK가 선택한 FK의 전 열 NN을 보장하여 선택 참조 검사를 생략할 수 없음
- CHECK(source_scope_key=scope_key OR source_scope_key='c'); 학교 목적은 본교/common, 개인 목적은 본인/common만; 학교→개인 복사 금지
- 자기 문서판 순환·AI생성문을 원사실로 환류 금지

통합 동작 규칙:

- 본문 INSERT 후 불변, 원자료 삭제/정정은 정본 lifecycle 차단과 목적문서 stale 반영.
- 생성/출력 직전 원본 판/hash/현재권한 재검사. common이란 이유만으로 미게시판 사용 금지.

인덱스: (scope_key,document_id,revision_no); (source_kind,source_knowledge_revision_id); (source_document_id,source_document_revision_no)

필수 시험: WF17; WF18; WF17: 네 종류 정상 근거 각각 성공; 미선택 ID NULL 허용; 선택 ID 누락/선택판 누락/불필요 ID·판/다른scope ID 모두 거부

## workhub.document_revisions

파일·문서 · 기존 보강

열람: 문서 현재 권한; source 원문 접근은 별도 현재 ACL.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| document_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| origin | text | 불가 | — |  | 원본 |
| content | jsonb | 불가 | — |  | 원본 |
| content_sha256 | text | 불가 | — |  | 원본 |
| pack_asset_sha256 | text | 허용 | — |  | 원본 |
| source_refs | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| unresolved_fields | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| output_file_id | text | 허용 | — |  | 원본 |
| output_sha256 | text | 허용 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| pack_id_snapshot | text | 허용 | — | workhub.document_packs.id · 생성 당시 실제 팩 | 통합 추가 |
| pack_scope_key_snapshot | text | 허용 | — | workhub.document_packs.scope_key · common 또는 본교 팩 scope | 통합 추가 |
| pack_version_snapshot | integer | 허용 | — | 팩판 표시값 | 통합 추가 |

통합 필수 제약:

- 팩 snapshot 세열 동시 NULL 또는 존재; (scope_key,pack_id) MATCH FULL 복합 FK
- pack_version/hash는 해당 실제 팩과 일치
- 원본 content/outputfile/hash와 팩 snapshot INSERT 후 불변

통합 동작 규칙:

- 새생성은 현재 active 팩, 과거판은 당시 팩 근거 유지.
- source_refs JSON은 document_revision_sources의 표시 snapshot, ACL/근거 단독 원장 아님.
- 재업로드는 새 file+revision+validation. pass 승계 금지.

인덱스: (pack_scope_key_snapshot,pack_id_snapshot)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (created_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,document_id) → workhub.documents(scope_key,id)
- (scope_key,job_id) → workhub.jobs(scope_key,id)
- (scope_key,output_file_id) → workhub.file_objects(scope_key,id)

필수 시험: WF17

## workhub.document_validations

파일·문서 · 기존 보강

열람: 문서 현재 read, findings도 원본문서와 같은 민감도.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| document_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| checked_sha256 | text | 불가 | — |  | 원본 |
| rule_set_ref | text | 허용 | — |  | 원본 |
| support_level_applied | text | 불가 | — |  | 원본 |
| skipped_rules | integer | 불가 | 0 |  | 원본 |
| state | text | 불가 | — |  | 원본 |
| findings | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| checked_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- 검사 sha=정확 revision 출력/내용 sha, pass에는 유효 규칙판·필수 skipped0
- 결과 INSERT 후 불변; 현재판의 pass는 같은hash/팩판 검사에서만

통합 동작 규칙:

- 근거 stale면 과거 pass가 있어도 새 출력/제출 허용을 자동 승계하지 않는다.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (scope_key,document_id,revision_no) → workhub.document_revisions(scope_key,document_id,revision_no)
- (scope_key,job_id) → workhub.jobs(scope_key,id)

필수 시험: WF17

## workhub.documents

파일·문서 · 기존 보강

열람: 본인 또는 명시 현재 공유대상. 과거판/근거/파일도 현재 원본 ACL.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE ('a:'::text \|\| owner_account_id) END |  | 원본 |
| pack_id | text | 허용 | — |  | 원본 |
| pack_scope | text | 허용 | — |  | 원본 |
| pack_scope_key | text | 허용 |  CASE pack_scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     WHEN 'common'::text THEN 'c'::text     ELSE NULL::text END |  | 원본 |
| doc_type | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'active'::text |  | 원본 |
| current_revision_no | integer | 불가 | 0 |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| linked_unit_id | text | 허용 | — |  | 원본 |
| conversation_id | text | 허용 | — |  | 원본 |
| stale_since | timestamp with time zone | 허용 | — |  | 원본 |
| stale_reason | text | 허용 | — |  | 원본 |
| legacy_ref | text | 허용 | — |  | 원본 |
| shared_with | text | 불가 | 'none'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- owner_account_id는 학교 scope에서도 불변
- current_revision_no는 정확한 동일 document revision이며 비어 있는 문서는0

통합 동작 규칙:

- 문서 head의 팩 선택은 다음 판 입력이며 과거 revision의 팩판을 바꾸지 않는다.
- private/shared_with는 현재 ACL. duty/linked_unit 접근이 학생기록이나 개인초안을 자동 공개하지 않음.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (pack_scope_key,pack_id) → workhub.document_packs(scope_key,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,linked_unit_id) → workhub.collection_units(school_id,id)
- (scope_key,conversation_id,owner_account_id) → workhub.conversations(scope_key,id,owner_account_id)

필수 시험: WF17; WF18

## workhub.duties

업무·인계 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| department_id | text | 허용 | — |  | 원본 |
| parent_duty_id | text | 허용 | — |  | 원본 |
| description | text | 허용 | — |  | 원본 |
| active_from | date | 불가 | — |  | 원본 |
| active_to | date | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,department_id) → workhub.departments(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,parent_duty_id) → workhub.duties(school_id,id)

## workhub.duty_notes

업무·인계 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| duty_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| written_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id,written_by_membership_id) → workhub.memberships(school_id,id)

## workhub.event_revisions

일정·시트 · 기존 보강

열람: 원본의 현재 읽기 정책. 과거 private revision을 audit.read로 열지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| event_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| event_version | integer | 불가 | — |  | 원본 |
| snapshot | jsonb | 불가 | — |  | 원본 |
| change_kind | text | 불가 | — |  | 원본 |
| change_reason | text | 허용 | — |  | 원본 |
| changed_by_account_id | text | 허용 | — |  | 원본 |
| changed_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- UNIQUE(scope_key,event_id,revision_no)
- 본문 snapshot·event_version·change_kind·actor·시각은 INSERT 후 불변
- UNIQUE(school_id,event_id,revision_no)

통합 동작 규칙:

- official_withdraw 변경 종류 추가; 확정/철회는 해당 권한 명령만.
- 날짜/본문 snapshot의 hash·버전은 시트 baseline과 문서 근거에서 정확히 참조한다.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (changed_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,event_id) → workhub.events(scope_key,id)

필수 시험: WF12; WF13; WF18

## workhub.events

일정·시트 · 기존 보강

열람: 현재 소속+원본 visibility; 공식 미확정안은 작성자/공식담당만. revision도 현재 원본 ACL로 재검사.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE ('a:'::text \|\| author_account_id) END |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| visibility | text | 불가 | — |  | 원본 |
| official_state | text | 허용 | — |  | 원본 |
| status | text | 불가 | 'active'::text |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| description | text | 허용 | — |  | 원본 |
| location | text | 허용 | — |  | 원본 |
| category | text | 불가 | 'other'::text |  | 원본 |
| all_day | boolean | 불가 | true |  | 원본 |
| start_date | date | 불가 | — |  | 원본 |
| end_date | date | 불가 | — |  | 원본 |
| starts_at | timestamp with time zone | 허용 | — |  | 원본 |
| ends_at | timestamp with time zone | 허용 | — |  | 원본 |
| audience_set_id | text | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| department_id | text | 허용 | — |  | 원본 |
| responsible_membership_id | text | 허용 | — |  | 원본 |
| affects_instruction | boolean | 불가 | false |  | 원본 |
| author_account_id | text | 불가 | — |  | 원본 |
| author_membership_id | text | 허용 | — |  | 원본 |
| source_record_id | text | 허용 | — |  | 원본 |
| current_revision_no | integer | 불가 | 1 |  | 원본 |
| cancelled_at | timestamp with time zone | 허용 | — |  | 원본 |
| cancel_reason | text | 허용 | — |  | 원본 |
| deleted_at | timestamp with time zone | 허용 | — |  | 원본 |
| deleted_by_account_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| official_effective_revision_no | integer | 허용 | — | 일반 교사 조회·학사 계산의 확정판; 최신 편집안과 분리 | 통합 추가 |

통합 필수 제약:

- event_revisions UNIQUE(scope_key,event_id,revision_no) 후 (scope_key,id,official_effective_revision_no) 복합 FK DEFERRABLE INITIALLY DEFERRED
- 효력 포인터는 kind=official에서만 허용; 해당 판 official_confirm/confirmed 검증

통합 동작 규칙:

- save는 현재안만 변경한다. confirm/withdraw가 효력 포인터·calendar_days·revision·receipt/outbox를 원자 변경한다.
- 읽기 DTO는 일반 교사에게 효력판, 작성자/공식 담당에게 현재안과 효력판을 구분한다.
- current/effective는 학교/계정 scope 변경 권한이 아니다. private는 추천 조건과 무관하게 작성자만.
- 책임자 변경은 이전 소유자의 task note를 이동하지 않고 원본 연결 카드를 종료/생성한다.

인덱스: (school_id,start_date,end_date,id); (school_id,responsible_membership_id,start_date,id) WHERE responsible_membership_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (author_account_id) → workhub.accounts(id)
- (deleted_by_account_id) → workhub.accounts(id)
- (school_id,audience_set_id) → workhub.audience_sets(school_id,id)
- (school_id,author_membership_id) → workhub.memberships(school_id,id)
- (school_id,department_id) → workhub.departments(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,responsible_membership_id) → workhub.memberships(school_id,id)
- (school_id,source_record_id) → workhub.source_records(school_id,id)

필수 시험: WF13; WF18

## workhub.evidence_links

학생·평가·생기부 · 기존 보강

열람: 현재 허용된 작성자 전용; 차단 consumer/source의 링크 메타데이터도 숨김

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| consumer_type | text | 불가 | — |  | 원본 |
| consumer_id | text | 불가 | — |  | 원본 |
| consumer_revision_no | integer | 허용 | — |  | 원본 |
| source_type | text | 불가 | — |  | 원본 |
| source_id | text | 불가 | — |  | 원본 |
| source_revision_no | integer | 허용 | — |  | 원본 |
| source_sha256 | text | 불가 | — |  | 원본 |
| span | jsonb | 허용 | — |  | 원본 |
| confirmed_by_account_id | text | 불가 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 불가 | now() |  | 원본 |
| validity | text | 불가 | 'valid'::text |  | 원본 |
| validity_changed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- 평가판 source_sha256도 실제 assessment_revisions.body_sha256와 일치
- 생기부 문장의 모든 source/consumer school·owner·학생·정확판 일치
- span은 원문 Unicode code point 범위·source hash와 일치

통합 동작 규칙:

- INSERT 검사 외 검토/출력에서 같은 계약 반복; 무효 근거의 valid 복귀 금지
- 다형 FK 대체 검증은 원본 존재/판/삭제 RESTRICT까지 강제
- 상담·원자료 직접 생기부 근거 금지

인덱스: (source_type,source_id,source_revision_no)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (confirmed_by_account_id) → workhub.accounts(id)
- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

필수 시험: SI01: 머리 변경 오염도 출력에서 거부; SI03: adoption 누락은 직접기록으로 간주하지 않음

## workhub.export_manifest_items

수합 · 신규

열람: manifest 현재 권한+해당 제출 현재 권한.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 행 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 경계 | 통합 추가 |
| export_id | text | 불가 | — | workhub.export_manifests.id · 내보내기 묶음 | 통합 추가 |
| unit_id | text | 불가 | — | workhub.collection_units.id · 단위 | 통합 추가 |
| submission_id | text | 불가 | — | workhub.submission_versions.id · 고정 제출판 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 해석 정의판 | 통합 추가 |
| file_object_id | text | 허용 | — | workhub.file_objects.id · 파일 없는 글/숫자 응답이면NULL | 통합 추가 |
| file_sha256 | text | 허용 | — | 실물 지문 snapshot | 통합 추가 |
| archive_path | text | 불가 | — | 서버 정규화 ZIP 경로 | 통합 추가 |
| state | text | 불가 | 'queued' | queued/succeeded/failed/skipped | 통합 추가 |
| error_code | text | 허용 | — | 본문 없는 안전 코드 | 통합 추가 |
| created_at | timestamptz | 불가 | clock_timestamp() | 선택 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- export/단위는 같은 collection
- (school_id,unit_id,submission_id,schema_id) FK submission_versions
- 파일이 있으면 동일 제출판 submission_files 관계 및 hash 일치
- UNIQUE(export_id,archive_path)
- state failed이면 error_code NN; file/hash 동시 NULL/존재

통합 동작 규칙:

- 선택 ID/판/hash/path는 불변, 실행 상태만 변경.
- 파일 없는 답변도 manifest에 1항목 포함. 상위경로/절대경로/중복 파일명 거부.

인덱스: (school_id,export_id,state,id)

필수 시험: WF16

## workhub.export_manifests

수합 · 기존 보강

열람: 현재 요청관리/내보내기 권한; ZIP은 모든 포함판 현재 권한도 재확인.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| collection_id | text | 불가 | — |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| selection | text | 불가 | — |  | 원본 |
| items | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| file_object_id | text | 허용 | — |  | 원본 |
| failed_items | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| state | text | 불가 | 'queued'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| manifest_sha256 | text | 허용 | — | 고정 선택 항목의 canonical 지문 | 통합 추가 |

통합 필수 제약:

- items/failed_items JSON은 export_manifest_items projection
- ready/partial은 실제 출력 file와 검증 manifest 지문 필요

통합 동작 규칙:

- none latest_valid, required chosen 접수판 기본; effective는 명시선택.
- 시작/항목/최종연결/다운로드 권한 재검사, 권한 잃은 파일 섞인 구ZIP 재발급 금지.
- 동일 고정 항목 실패만 재시도, 중간 새제출판 자동치환 금지.

인덱스: (school_id,requested_by_membership_id,created_at DESC,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id) → workhub.collections(school_id,id)
- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,job_id) → workhub.jobs(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: WF16

## workhub.feedback

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| ticket_no | bigint | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| membership_id | text | 허용 | — |  | 원본 |
| account_id | text | 불가 | — |  | 원본 |
| module_code | text | 허용 | — |  | 원본 |
| screen | text | 허용 | — |  | 원본 |
| category | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'received'::text |  | 원본 |
| assigned_operator_account_id | text | 허용 | — |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| resolved_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)
- (assigned_operator_account_id) → workhub.service_operators(account_id)
- (school_id) → workhub.schools(id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.feedback_events

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| feedback_id | text | 불가 | — |  | 원본 |
| state | text | 허용 | — |  | 원본 |
| note | text | 허용 | — |  | 원본 |
| internal | boolean | 불가 | false |  | 원본 |
| by_account_id | text | 불가 | — |  | 원본 |
| at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (by_account_id) → workhub.accounts(id)
- (feedback_id) → workhub.feedback(id)

## workhub.file_access_grants

파일·문서 · 기존 보강

열람: 수신자에게 안전 발급 메타만. 실물은 현재 원본 ACL 재검사.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| file_object_id | text | 불가 | — |  | 원본 |
| granted_to_account_id | text | 불가 | — |  | 원본 |
| via_link_id | text | 허용 | — |  | 원본 |
| method | text | 불가 | — |  | 원본 |
| issued_at | timestamp with time zone | 불가 | now() |  | 원본 |
| expires_at | timestamp with time zone | 불가 | — |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoke_reason | text | 허용 | — |  | 원본 |
| resource_type | text | 불가 | — | 허용 resolver 종류 | 통합 추가 |
| resource_id | text | 불가 | — | 정확한 부모 ID | 통합 추가 |
| resource_version | integer | 허용 | — | 판이 있는 부모는 필수 | 통합 추가 |
| resource_link_id | text | 허용 | — | 정확한 typed/generic 관계 ID | 통합 추가 |

통합 필수 제약:

- grant 발급 시 수신계정/학교/부모판/파일/hash/정책 일치
- 정체성은 불변; revoked_at/사유만 일방향

통합 동작 규칙:

- file_grant_valid는 현재 원본 resolver를 항상 검사; 학교 접근+live link만으로 허용 금지.
- 민감 파일은 인증 proxy, 서명 URL은 승인 비민감 용도만.
- 원본권한 종료는 같은 transaction에서 revoke; 저장소 issued URL 무효화 한계 별도 실측.

인덱스: (school_id,resource_type,resource_id) WHERE revoked_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (granted_to_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)
- (scope_key,file_object_id,via_link_id) → workhub.file_links(scope_key,file_object_id,id)

필수 시험: WF01; WF10; WF18

## workhub.file_links

파일·문서 · 기존 보강

열람: 원본 typed 부모의 현재 read; linked_by라는 이유만으로 계속 읽을 수 없음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| file_object_id | text | 불가 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 불가 | — |  | 원본 |
| resource_version | integer | 허용 | — |  | 원본 |
| role | text | 불가 | — |  | 원본 |
| linked_by_account_id | text | 불가 | — |  | 원본 |
| linked_at | timestamp with time zone | 불가 | now() |  | 원본 |
| unlinked_at | timestamp with time zone | 허용 | — |  | 원본 |
| unlinked_by_account_id | text | 허용 | — |  | 원본 |
| field_id | text | 허용 | — | workhub.collection_fields.id · unit_drafts file 문항일 때 정확한 정의 | 통합 추가 |

통합 필수 제약:

- scope/file/resource_type/resource_id/resource_version/role/actor/linked_at/field_id 불변
- unlink 메타만 1회 변경, 새 연결은 새 행
- draft 파일은 동일 schema의 file 문항
- resource resolver 허용 목록 외 종류·미지원 복합PK 거부; source·target·version·scope 검사
- 기존 UNIQUE(resource_type,resource_id,file_object_id,role) 제거는 새 활성 연결 유일 인덱스로 대체할 때만 수행

통합 동작 규칙:

- 초기 resolver: unit_drafts/documents/notices/knowledge_revisions/document_packs/import_runs/export_manifests.
- 기존 typed submission_files/document_inputs/document_revisions.output_file_id를 generic link로 우회 금지.
- 연결 시 파일읽기+목적쓰기+공개범위 상승 허용 검사; unlink/원본권한회수와 grant revoke 같은 transaction.
- 불변판의 파일 연결은 내용 수정용 unlink 불가. 전체 차단/정정판으로 처리.

인덱스: UNIQUE (scope_key,resource_type,resource_id,resource_version,field_id,file_object_id,role) NULLS NOT DISTINCT WHERE unlinked_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (linked_by_account_id) → workhub.accounts(id)
- (resource_type) → workhub.resource_classes(resource_type)
- (school_id) → workhub.schools(id)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)
- (unlinked_by_account_id) → workhub.accounts(id)

필수 시험: WF05; WF10; WF05: 연결→unlink→동일 파일 재연결 성공; 동일 문항의 동시 활성 연결 중복 거부; 서로 다른 문항의 동일 파일은 구별

## workhub.file_objects

파일·문서 · 기존 보강

열람: 소유/typed 부모 현재 ACL. 파일 자체 ID나 scope만으로 업무자료를 공개하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     WHEN 'account_private'::text THEN ('a:'::text \|\| owner_account_id)     ELSE 'c'::text END |  | 원본 |
| bucket | text | 불가 | 'workhub-private'::text |  | 원본 |
| storage_key | text | 불가 | — |  | 원본 |
| original_name | text | 불가 | — |  | 원본 |
| declared_mime | text | 허용 | — |  | 원본 |
| detected_mime | text | 허용 | — |  | 원본 |
| size_bytes | bigint | 허용 | — |  | 원본 |
| expanded_bytes | bigint | 허용 | — |  | 원본 |
| sha256 | text | 허용 | — |  | 원본 |
| verification | jsonb | 허용 | — |  | 원본 |
| scan_state | text | 불가 | 'pending'::text |  | 원본 |
| state | text | 불가 | 'uploading'::text |  | 원본 |
| reject_reason | text | 허용 | — |  | 원본 |
| extract_state | text | 불가 | 'not_requested'::text |  | 원본 |
| intended_resource_type | text | 허용 | — |  | 원본 |
| intended_resource_id | text | 허용 | — |  | 원본 |
| first_linked_at | timestamp with time zone | 허용 | — |  | 원본 |
| derived_from_file_id | text | 허용 | — |  | 원본 |
| derivation | text | 허용 | — |  | 원본 |
| upload_expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| verified_at | timestamp with time zone | 허용 | — |  | 원본 |
| deleted_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| safety_policy_scope_key | text | 허용 | — | workhub.policy_versions.scope_key · 검증 당시 승인 정책 scope | 통합 추가 |
| safety_policy_version_id | text | 허용 | — | workhub.policy_versions.id · 검증/사용 안전정책판 | 통합 추가 |
| sensitivity | text | 불가 | — | public/school/internal_private/student_sensitive | 통합 추가 |
| verified_by_service_id | text | 허용 | — | workhub.service_principals.id · 실물 검증한 활성 서비스 주체 | 통합 추가 |
| common_safety_policy_scope_key | text | 허용 | — | workhub.policy_versions.scope_key · 적용한 공통 안전 하한 정책 scope, 항상 c | 통합 추가 |
| common_safety_policy_version_id | text | 허용 | — | workhub.policy_versions.id · 적용한 정확한 공통 안전 하한 정책판 | 통합 추가 |

통합 필수 제약:

- (safety_policy_scope_key,safety_policy_version_id) MATCH FULL FK policy_versions(scope_key,id)
- 학교 파일은 본교 file.safety, common/account_private는 common의 applies_to_scopes 일치
- 검증 후 file scope/owner/path/hash/bytes/mime 불변; scan clean은 실제 검사 성공만
- ready는 실물 검증 증거; 사용 가능 여부는 scan+현재정책+목적+민감도 별도
- (common_safety_policy_scope_key,common_safety_policy_version_id) MATCH FULL FK policy_versions(scope_key,id); scope_key=c

통합 동작 규칙:

- not_scanned 승인정책 없으면 제출/공유/다운로드/AI사용 차단. 업로더 상태확인·삭제요청만.
- 승인된 not_scanned 허용도 해당 목적/형식/범위에 한정, 자동실행/inline render 금지.
- 현재 정책과 검증 당시 정책 중 더 제한적으로 재판정; rejected/quarantined/deleted 예외 없음.
- DB메타 ready를 Storage 실물 증거로 대체하지 않고 worker가 hash/bytes/mime을 검증.
- 학교 파일은 공통하한+학교판을 모두 고정하고 현재 유효 두 정책과 당시 두 판의 허용 교집합만 사용. common/account_private는 동일 common판을 두 쌍에 기록. 한 정책의 차단도 옛 허용판으로 우회 금지.

인덱스: (school_id,sensitivity,state,id); (safety_policy_scope_key,safety_policy_version_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (intended_resource_type) → workhub.resource_classes(resource_type)
- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,derived_from_file_id) → workhub.file_objects(scope_key,id)

필수 시험: WF09; WF10; WF11; WF20

## workhub.handover_acceptances

업무·인계 · 신규

열람: 해당 handover 현재 허용자.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 행 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 경계 | 통합 추가 |
| handover_id | text | 불가 | — | workhub.handovers.id · 인계 | 통합 추가 |
| accepted_by_membership_id | text | 불가 | — | workhub.memberships.id · 수락한 정확한 후임 | 통합 추가 |
| accepted_by_account_id | text | 불가 | — | workhub.accounts.id · 후임 신원 | 통합 추가 |
| manifest_version | integer | 불가 | — | 확인한 manifest판 · 생성 후 불변 | 통합 추가 |
| items_sha256 | text | 불가 | — | 원본키/기대판/필드변화 지문 · 생성 후 불변 | 통합 추가 |
| effective_on | date | 불가 | — | 확인한 효력일 · 생성 후 불변 | 통합 추가 |
| accepted_at | timestamptz | 불가 | clock_timestamp() | 본인 수락시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- UNIQUE(school_id,handover_id,id)
- UNIQUE(handover_id,manifest_version,accepted_by_membership_id)
- 계정=수락소속.account_id, 현재handover.to와 일치
- manifest_version>0; hash64hex

통합 동작 규칙:

- 본인 현재 유효 소속만 수락; 모든 본문 INSERT 후 불변.
- 적용은 이 수락을 확인하며 NULL projection만으로 허용하지 않는다.

인덱스: (school_id,handover_id,manifest_version DESC)

필수 시험: WF04; WF14

## workhub.handover_items

업무·인계 · 기존 보강

열람: handover 현재 권한; 개인 본문 없이 허용 delta만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| handover_id | text | 불가 | — |  | 원본 |
| object_type | text | 불가 | — |  | 원본 |
| object_id | text | 불가 | — |  | 원본 |
| object_version | integer | 불가 | — |  | 원본 |
| action | text | 불가 | — |  | 원본 |
| exclude_reason | text | 허용 | — |  | 원본 |
| result | text | 허용 | — |  | 원본 |
| result_ref | text | 허용 | — |  | 원본 |
| target_key | jsonb | 불가 | — | 대상 종류의 정확한 PK 객체; 임의키 거부 · 생성 후 불변 | 통합 추가 |
| target_fingerprint | text | 불가 | — | 대상 관계/기간/허용 delta 지문 · 생성 후 불변 | 통합 추가 |
| manifest_version | integer | 불가 | — | 속한 인계 미리보기판 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- 단일ID는 target_key={id}, reviewer는 collection_id/membership_id/added_at 정확키
- kind별 resolver가 target 실제 존재·학교·부모·허용 field를 검사; 지원 없는 kind 거부
- 항목 정체성 불변; 새 manifest에는 새 item
- active 인계 간 같은 종류/정규target_key 중복은 대상 정렬 advisory lock 아래 검사
- 기존 UNIQUE(handover_id,object_type,object_id)를 UNIQUE(handover_id,manifest_version,object_type,target_key)로 교체; target_key는 종류별 정확한 PK JSONB 객체

통합 동작 규칙:

- 개인task/note/개인초안/학생기록/대화/문서owner 이전 금지.
- 공식 원본 관련 task는 owner변경이 아닌 이전카드 종료+새 카드 생성으로 적용.
- 등록뿐 아니라 apply와 handover 상태 재활성화 때도 원본·기대판/지문 재검사.
- 활성 대상 claim은 진행 중인 handover의 현재 manifest_version 항목만 사용한다. 새 미리보기판은 새 item 행이며 과거 item이 계속 대상을 점유하지 않는다.

인덱스: (school_id,object_type,object_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,handover_id) → workhub.handovers(school_id,id)

필수 시험: WF04; WF14

## workhub.handovers

업무·인계 · 기존 보강

열람: 전임/후임과 handover.manage의 허용 공개 manifest; 개인 내용 제외.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| scope_duty_id | text | 허용 | — |  | 원본 |
| scope_role_code | text | 허용 | — |  | 원본 |
| scope_academic_class_id | text | 허용 | — |  | 원본 |
| scope_course_group_id | text | 허용 | — |  | 원본 |
| from_membership_id | text | 불가 | — |  | 원본 |
| to_membership_id | text | 허용 | — |  | 원본 |
| effective_on | date | 불가 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| items_sha256 | text | 허용 | — |  | 원본 |
| public_note | text | 허용 | — |  | 원본 |
| created_by_membership_id | text | 불가 | — |  | 원본 |
| accepted_at | timestamp with time zone | 허용 | — |  | 원본 |
| accepted_items_sha256 | text | 허용 | — |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| applied_by_membership_id | text | 허용 | — |  | 원본 |
| reject_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| manifest_version | integer | 불가 | 1 | 수락하는 대상 묶음판 | 통합 추가 |
| current_acceptance_id | text | 허용 | — | workhub.handover_acceptances.id · 현재 유효한 후임 수락 | 통합 추가 |

통합 필수 제약:

- manifest_version>0
- (school_id,id,current_acceptance_id) FK handover_acceptances(school_id,handover_id,id) DEFERRABLE
- applied이면 current_acceptance_id/accepted_at/accepted_items_sha256/items_sha256/applied_at/applied_by 모두 NN
- 현재 acceptance의 후임/manifest_version/hash/effective_on 일치

통합 동작 규칙:

- 수락 뒤 항목/기대판/후임/효력일 변경은 stale·manifest 증가·현재수락 해제; 이전수락은 보존.
- apply는 전체 원본 잠금과 기대판 재검사 후 전부 또는0.
- state 재활성화에도 같은 대상 다른 active 인계 중복 검사.
- 전임 소속 종료를 수락 지연 때문에 연장하지 않는다.

인덱스: (school_id,state,effective_on,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,applied_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,from_membership_id) → workhub.memberships(school_id,id)
- (school_id,scope_academic_class_id) → workhub.academic_classes(school_id,id)
- (school_id,scope_duty_id) → workhub.duties(school_id,id)
- (school_id,to_membership_id) → workhub.memberships(school_id,id)
- (scope_role_code) → workhub.role_catalog(role_code)

필수 시험: WF04; WF14

## workhub.idempotency_receipts

작업·이관·복구 · 기존 보강

열람: 브라우저 직접조회 금지; 명령별 현재권한을 통과한 안전 재응답

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| actor_account_id | text | 허용 | — | workhub.accounts.id · 사람 actor; 서비스일 때 NULL · 생성 후 불변 | 통합 변경 |
| scope_key | text | 불가 | — |  | 원본 |
| operation | text | 불가 | — |  | 원본 |
| idem_key | text | 불가 | — |  | 원본 |
| request_sha256 | text | 불가 | — |  | 원본 |
| resource_type | text | 허용 | — |  | 원본 |
| resource_id | text | 허용 | — |  | 원본 |
| resource_version | integer | 허용 | — |  | 원본 |
| result | jsonb | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| actor_service_principal_id | text | 허용 | — | workhub.service_principals.id · 서비스 actor; 사람일 때 NULL · 생성 후 불변 | 통합 추가 |
| actor_key | text GENERATED ALWAYS AS (CASE WHEN actor_account_id IS NOT NULL THEN 'a:'\|\|actor_account_id ELSE 's:'\|\|actor_service_principal_id END) STORED | 불가 | — | 사람/서비스 ID 충돌 없는 키 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- 기존 actor_account_id 기반 PK를 PRIMARY KEY(actor_key,scope_key,operation,idem_key)로 교체
- num_nonnulls(actor_account_id,actor_service_principal_id)=1
- request_sha256 불변; 같은키 다른payload conflict

통합 동작 규칙:

- 기존 rows의 키 대조·멱등회귀 후 전환; 운영자료 직접변경 지시 아님
- 재응답 시 현재 actor/scope/original resource 권한 검사
- request_sha256은 클라이언트 의도의 결정적 정규화이며 명시 확인판을 포함; 서버가 최초 선택한 정책·근거판은 해당 원본 revision 또는 실행 snapshot에 고정하고 receipt의 resource/판으로 추적. 현재 정책 변경을 과거 동일키 재요청 해시에 끼워 넣지 않는다
- result는 ID/판/시각만; 원문/명단/서명URL 저장 금지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (actor_account_id) → workhub.accounts(id)

필수 시험: AI06: 비활성서비스는 과거receipt 재조회도 거부; 같은 요청 재시도 domain write1/다른payload conflict

## workhub.impact_items

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| cause_type | text | 불가 | — |  | 원본 |
| cause_id | text | 불가 | — |  | 원본 |
| cause_revision_no | integer | 허용 | — |  | 원본 |
| affected_type | text | 불가 | — |  | 원본 |
| affected_id | text | 불가 | — |  | 원본 |
| needs_external_fix | boolean | 불가 | false |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| resolved_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

## workhub.import_row_candidates

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| import_row_id | text | 불가 | — |  | 원본 |
| source_record_id | text | 불가 | — |  | 원본 |
| score | numeric | 허용 | — |  | 원본 |
| reasons | jsonb | 불가 | '[]'::jsonb |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,import_row_id) → workhub.import_rows(school_id,id)
- (school_id,source_record_id) → workhub.source_records(school_id,id)

## workhub.import_rows

일정·시트 · 기존 보강

열람: import 생성자 및 명시 연결 관리권한; 다른 학교 raw 숨김.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| import_run_id | text | 불가 | — |  | 원본 |
| row_no | integer | 불가 | — |  | 원본 |
| external_key | text | 허용 | — |  | 원본 |
| raw | jsonb | 불가 | — |  | 원본 |
| normalized | jsonb | 허용 | — |  | 원본 |
| match_kind | text | 허용 | — |  | 원본 |
| source_record_id | text | 허용 | — |  | 원본 |
| decision | text | 불가 | — |  | 원본 |
| error_code | text | 허용 | — |  | 원본 |
| error_detail | text | 허용 | — |  | 원본 |
| resolution | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| target_type | text | 허용 | — |  | 원본 |
| target_id | text | 허용 | — |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| incoming_snapshot_id | text | 허용 | — | workhub.source_record_snapshots.id · 입력 원본판; 신규 미매핑은 매핑확정 뒤 생성 | 통합 추가 |
| baseline_source_snapshot_id | text | 허용 | — | workhub.source_record_snapshots.id · 미리보기 당시 기준 원본판 | 통합 추가 |
| baseline_target_revision_no | integer | 허용 | — | 미리보기 당시 기준 사이트 revision | 통합 추가 |
| expected_source_record_version | integer | 허용 | — | 적용 전 대조할 원본행 판 | 통합 추가 |
| expected_target_version | integer | 허용 | — | 적용 전 대조할 사이트 판 | 통합 추가 |
| target_event_id | text | 허용 | — | workhub.events.id · 일정 적용의 typed 대상 | 통합 추가 |
| result_target_revision_no | integer | 허용 | — | 실제 성공 결과판 | 통합 추가 |
| preview_row_sha256 | text | 불가 | — | baseline/입력/해결선택의 고정 지문 | 통합 추가 |

통합 필수 제약:

- UNIQUE(import_run_id,source_record_id) WHERE source_record_id IS NOT NULL
- UNIQUE(import_run_id,external_key) WHERE external_key IS NOT NULL
- snapshot은 동일 source_record/connection 복합 FK; target revisions는 동일 target_event_id
- preview 고정 이후 incoming/baseline/expected/hash는 불변; 해결 변경은 새 preview
- import_run_id/resolution/source_record_id/target 변경 전부 동일 연결·쓰기 기준 재검사

통합 동작 규칙:

- 행별 원자 적용과 안정 멱등키. 실패 행만 재시도.
- 기준 원본 O0/대상 T0·현재 O1/T1를 모두 보존; 판 변경이면 IMPORT_BASELINE_STALE.
- take_source만 아닌 create/manual 적용 경로도 현재 authority 검사.

인덱스: (school_id,import_run_id,decision,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,import_run_id) → workhub.import_runs(school_id,id)
- (school_id,source_record_id) → workhub.source_records(school_id,id)

필수 시험: WF12; WF09

## workhub.import_runs

일정·시트 · 기존 보강

열람: import 현재 관리권한; jobs 상태만으로 raw 내용 공개하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| connection_id | text | 불가 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| mapping_version | integer | 불가 | — |  | 원본 |
| file_object_id | text | 허용 | — |  | 원본 |
| source_revision | text | 허용 | — |  | 원본 |
| source_sha256 | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'previewing'::text |  | 원본 |
| counts | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| created_by_membership_id | text | 불가 | — |  | 원본 |
| applied_by_membership_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| preview_sha256 | text | 허용 | — | 매핑·입력·행 결정 manifest 지문 | 통합 추가 |
| expected_connection_version | integer | 허용 | — | 기준 전환/매핑 변경 감지 | 통합 추가 |
| approved_preview_sha256 | text | 허용 | — | 적용자가 확인한 정확한 미리보기 | 통합 추가 |

통합 필수 제약:

- preview_ready 이상이면 preview_sha256/expected_connection_version 존재
- applied 상태는 모든 해당 행 결과/실패 집계와 일치

통합 동작 규칙:

- mapping 변경은 preview 무효. applied/partial counts는 행 결과의 projection.
- source cutover는 같은 connection의 review run만 참조하며 미해결0·관리권한·지문 재검사.

인덱스: (school_id,connection_id,created_at DESC,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,applied_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,connection_id,mapping_version) → workhub.source_connection_mappings(school_id,connection_id,mapping_version)
- (school_id,connection_id,target_type) → workhub.source_connections(school_id,id,target_type)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,job_id) → workhub.jobs(school_id,id)

필수 시험: WF12

## workhub.inbox_items

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| source_item_id | text | 불가 | — |  | 원본 |
| source_local_revision | integer | 불가 | — |  | 원본 |
| state | text | 불가 | 'new'::text |  | 원본 |
| decided_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,source_item_id,source_local_revision) → workhub.source_item_revisions(school_id,source_item_id,local_revision)
- (school_id,owner_account_id,source_item_id) → workhub.source_items(school_id,owner_account_id,id)

## workhub.job_attempts

작업·이관·복구 · 기존 보강

열람: 서버 전용; 요청자에게 원문 없는 실행요약 DTO만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| job_id | text | 불가 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| attempt_no | integer | 불가 | — |  | 원본 |
| lease_token | bigint | 불가 | — |  | 원본 |
| worker | text | 불가 | — |  | 원본 |
| started_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| outcome | text | 허용 | — |  | 원본 |
| external_request_id | text | 허용 | — |  | 원본 |
| safe_error_code | text | 허용 | — |  | 원본 |

통합 필수 제약:

- UNIQUE(job_id,attempt_no,lease_token)

통합 동작 규칙:

- external_request_id는 호환 요약이며 외부 단계 원장은 job_external_calls
- lease_lost는 외부호출 failed를 의미하지 않음
- 사용자가 attempt 상태를 직접 바꾸지 않음

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (scope_key,job_id) → workhub.jobs(scope_key,id)

필수 시험: AI08: 재인수 차단 시 이전 외부unknown 사실 보존; AI10: 이전lease 결과 확정 거부

## workhub.job_external_calls

작업·이관·복구 · 신규

열람: 서버전용; 요청자에게 안전한 결과불명확 상태만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 외부 효과 실행 ID · 생성 후 불변 | 통합 추가 |
| scope_key | text | 불가 | — | 작업과 동일 scope · 생성 후 불변 | 통합 추가 |
| job_id | text | 불가 | — | workhub.jobs.id · 실행 작업 · 생성 후 불변 | 통합 추가 |
| attempt_no | integer | 불가 | — | workhub.job_attempts.attempt_no · 해당 내부 시도번호 · 생성 후 불변 | 통합 추가 |
| lease_token | bigint | 불가 | — | workhub.job_attempts.lease_token · 외부시작을 허용받은 토큰 · 생성 후 불변 | 통합 추가 |
| call_key | text | 불가 | — | 작업 내 논리 외부호출 키 · 생성 후 불변 | 통합 추가 |
| provider | text | 불가 | — | 승인 공급자 · 생성 후 불변 | 통합 추가 |
| operation | text | 불가 | — | 허용된 외부 동작 · 생성 후 불변 | 통합 추가 |
| request_sha256 | text | 불가 | — | 요청지문; 본문 없음 · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | 'prepared' | prepared/request_started/response_received/unknown/confirmed_not_run/confirmed_succeeded/cancelled | 통합 추가 |
| started_at | timestamptz | 허용 | — | 실제 호출 직전 별도트랜잭션으로 확정한 시작 | 통합 추가 |
| provider_request_id | text | 허용 | — | 공급자가 알려준 요청번호; 모르면 NULL | 통합 추가 |
| safe_result_ref | jsonb | 허용 | — | operation registry의 kind/scope_key/불변 ID·판 또는 최소 receipt; 첫 보관 뒤 불변; 원문/비밀/서명URL 금지 | 통합 추가 |
| result_sha256 | text | 허용 | — | 실물 또는 정규화 최소 receipt 지문; 첫 보관 뒤 불변 | 통합 추가 |
| result_bytes | bigint | 허용 | — | 실물 결과 operation에서 필수인 검증된 보관 바이트 수; 첫 보관 뒤 불변 | 통합 추가 |
| finished_at | timestamptz | 허용 | — | 응답/확인 완료시각 | 통합 추가 |
| safe_error_code | text | 허용 | — | 원문 없는 오류코드 | 통합 추가 |
| resolution_ref | text | 허용 | — | 불명확 결과 사후확인의 근거 | 통합 추가 |
| resolved_by_account_id | text | 허용 | — | workhub.accounts.id · 사후확인 권한을 가진 사람 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(job_id,call_key)
- FK(scope_key,job_id) REFERENCES workhub.jobs(scope_key,id)
- FK(job_id,attempt_no,lease_token) REFERENCES workhub.job_attempts(job_id,attempt_no,lease_token)
- UNIQUE(provider,operation,provider_request_id) WHERE provider_request_id IS NOT NULL
- confirmed_not_run/confirmed_succeeded는 resolution_ref와 실제 확인주체 필수
- response_received이면 safe_result_ref/result_sha256/finished_at NOT NULL; 결과 보관과 상태를 같은 트랜잭션에서 확정
- result_sha256는 NULL 또는 64자리 소문자 16진수; result_bytes는 NULL 또는 >=0
- safe_result_ref의 등록 kind/동일 scope/정확한 불변 ID·판/실물존재/hash를 operation 처리기로 검증; 실물 operation은 result_bytes NOT NULL
- safe_result_ref/result_sha256/result_bytes 첫 보관 뒤 일반 UPDATE 불변; 승인 lifecycle 파기 예외는 공개·재개 차단 및 tombstone 유지

통합 동작 규칙:

- R12: 전송 전에 request_started 커밋; ID미수신 crash도 unknown
- 응답 수신 후 영속 결과 참조/hash 원자 보관 전 crash는 unknown; response_received 선행 커밋 금지
- 결과본문 없는 operation도 registry 최소 receipt와 정규화 지문을 동일 scope에 원자 저장; 개인 승인파기 예외는 svc receipt에서 제한 manifest 메타만 참조
- 실물 결과는 보관/hash/bytes 확인을 먼저 마친 뒤 DB 참조와 상태를 원자 commit; commit 전 고아 실물은 정리 대상이며 재호출 허가가 아님
- unknown이면 자동재호출 금지; 사후확인만 terminal로 전이
- response_received는 저장 결과를 재검증해 공급자 재호출 없이 domain finalize만 재개; 원본 결과 분실/파기시 결과 불가로 차단
- 현재 lease로 시작하고 늦은응답은 사실보완으로만 허용; 옛token domain 확정금지

인덱스: (job_id,state); (state,started_at) WHERE state IN ('request_started','unknown')

필수 시험: AI08: 외부요청번호있는 만료작업 claim 거부; AI09: request ID 없는 crash도 재호출0; AI10: 늦은응답으로 권한회수 우회불가

## workhub.jobs

작업·이관·복구 · 기존 보강

열람: 본인 현재 원생성 접근의 안전 요약만; service 작업은 허용된 운영 메타데이터만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 불가 | CASE scope WHEN 'school' THEN 's:' \|\| school_id WHEN 'account_private' THEN 'a:' \|\| owner_account_id WHEN 'common' THEN 'c' WHEN 'service' THEN 'svc' ELSE NULL END | 저장 생성 열; 기존 ELSE c 식을 교체하고 service를 svc로 구분 · 생성 후 불변 | 통합 변경 |
| owner_account_id | text | 허용 | — |  | 원본 |
| service_principal_id | text | 허용 | — |  | 원본 |
| on_owner_access_lost | text | 불가 | 'cancel'::text |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'queued'::text |  | 원본 |
| input | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| input_sha256 | text | 허용 | — |  | 원본 |
| idem_key | text | 허용 | — |  | 원본 |
| progress | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| checkpoint | jsonb | 허용 | — |  | 원본 |
| attempts | integer | 불가 | 0 |  | 원본 |
| max_attempts | integer | 불가 | 3 |  | 원본 |
| next_attempt_at | timestamp with time zone | 허용 | — |  | 원본 |
| lease_owner | text | 허용 | — |  | 원본 |
| lease_expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| lease_token | bigint | 불가 | 0 |  | 원본 |
| heartbeat_at | timestamp with time zone | 허용 | — |  | 원본 |
| last_error_code | text | 허용 | — |  | 원본 |
| result | jsonb | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| started_at | timestamp with time zone | 허용 | — |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| cancel_requested_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| origin_membership_id | text | 허용 | — | workhub.memberships.id · 학교 사람 작업의 요청 소속; 서비스 작업은 NULL · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- scope CHECK(school,account_private,common,service); scope_key 생성식 s:<school>/a:<owner>/c/svc
- school iff school_id IS NOT NULL; 사람 학교작업 iff origin_membership_id IS NOT NULL
- owner_account_id와 service_principal_id 정확히 하나; account_private에 서비스principal 금지
- FK(school_id,origin_membership_id,owner_account_id) REFERENCES workhub.memberships(school_id,id,account_id)

통합 동작 규칙:

- R11: actor NULL=허용 분기 제거; principal active/action/current scope grant 검사
- B01의 검증된 DB 실행 identity→승인 service_principal 결합이 선행; 호출자 인자/GUC/worker_id로 주체 선택 금지
- 생성/claim/heartbeat/외부시작/finish/domain publish에서 실제 gate 잠금과 최신검사; 사람 원요청 권한과 실제 worker 권한을 각각 검증
- R12: request_started/unknown 외부 단계가 있는 만료 running은 직접 재claim 금지
- actor/권한gate를 job행보다 먼저 잠금; 원요청/입력/scope 불변
- 새membership 재임용에 이전작업 자동재개 금지
- 순수개인 승인파기만 service deletion_process+단일계정 승인 deletion_ledger/불변manifest/현재grant로 자료scope예외; school파기는항상school

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (service_principal_id) → workhub.service_principals(id)

필수 시험: AI06/07: 비활성·다른action/scope·회수경합; AI08/09: 외부시작후 lease만료 즉시claim 거부; AI10: 옛token 공개 거부

## workhub.knowledge_chunks

학교 지식 · 기존 보강

열람: 브라우저 직접 본문조회 없음; ACL 선필터 검색 RPC만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| revision_id | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| seq | integer | 불가 | — |  | 원본 |
| location | jsonb | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| body_tsv | tsvector | 허용 | to_tsvector('simple'::regconfig, body) |  | 원본 |
| body_sha256 | text | 불가 | — | 원문 구간의 서버 해시 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- UNIQUE(scope_key,id)
- scope_key,revision_id,seq,location,body,body_sha256 불변; 삭제 전용 본문 파기 예외

통합 동작 규칙:

- 검색 결과 반환 직전 원본판 게시/효력/ACL/차단 재검사

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (scope_key,revision_id) → workhub.knowledge_revisions(scope_key,id)

필수 시험: AI01: chunk와 다른 revision 혼합 저장 거부; 원본 철회 직후 오래된 검색캐시에서 본문 0

## workhub.knowledge_conflicts

학교 지식 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| revision_a_id | text | 불가 | — |  | 원본 |
| revision_a_scope | text | 불가 | — |  | 원본 |
| revision_a_scope_key | text | 허용 |  CASE revision_a_scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| revision_b_id | text | 불가 | — |  | 원본 |
| revision_b_scope | text | 불가 | — |  | 원본 |
| revision_b_scope_key | text | 허용 |  CASE revision_b_scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| description | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| assigned_membership_id | text | 허용 | — |  | 원본 |
| due_on | date | 허용 | — |  | 원본 |
| resolution | text | 허용 | — |  | 원본 |
| resolved_by_account_id | text | 허용 | — |  | 원본 |
| resolved_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (resolved_by_account_id) → workhub.accounts(id)
- (revision_a_scope_key,revision_a_id) → workhub.knowledge_revisions(scope_key,id)
- (revision_b_scope_key,revision_b_id) → workhub.knowledge_revisions(scope_key,id)
- (school_id,assigned_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.knowledge_documents

학교 지식 · 기존 보강

열람: scope와 ACL 먼저; private 본인, audience 승인대상, school 현재소속, common 게시/공개등급

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| authority | text | 불가 | — |  | 원본 |
| school_levels | text[] | 불가 | '{}'::text[] |  | 원본 |
| region_codes | text[] | 불가 | '{}'::text[] |  | 원본 |
| audience_set_id | text | 허용 | — |  | 원본 |
| disclosure_level | text | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| steward_membership_id | text | 허용 | — |  | 원본 |
| proposed_by_account_id | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'proposed'::text |  | 원본 |
| promoted_from_school_id | text | 허용 | — |  | 원본 |
| promoted_from_document_id | text | 허용 | — |  | 원본 |
| promotion_approval_ref | text | 허용 | — |  | 원본 |
| promoted_by_account_id | text | 허용 | — |  | 원본 |
| promoted_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| visibility | text | 불가 | — | school/audience/private/common; 이관 시 명시적으로 판정 | 통합 추가 |

통합 필수 제약:

- scope=common iff visibility=common
- visibility=audience iff audience_set_id IS NOT NULL; school/private는 audience NULL

통합 동작 규칙:

- private 학교 원문은 proposed_by_account_id만; 관리자가 자동 공개하지 않음
- 공통 게시/파기는 현재 operator_grants의 action 검사

인덱스: (scope_key,visibility,state)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (promoted_by_account_id) → workhub.accounts(id)
- (promoted_from_school_id,promoted_from_document_id) → workhub.knowledge_documents(school_id,id)
- (proposed_by_account_id) → workhub.accounts(id)
- (school_id,audience_set_id) → workhub.audience_sets(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,steward_membership_id) → workhub.memberships(school_id,id)

필수 시험: AI01: 다른 학교/사적원문 검색 0; AI14: 운영자등록만으로 common 게시 불가

## workhub.knowledge_revisions

학교 지식 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| document_id | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| file_object_id | text | 허용 | — |  | 원본 |
| source_sha256 | text | 불가 | — |  | 원본 |
| source_format | text | 불가 | — |  | 원본 |
| source_location | text | 허용 | — |  | 원본 |
| school_year | smallint | 허용 | — |  | 원본 |
| amended_on | date | 허용 | — |  | 원본 |
| effective_from | date | 불가 | — |  | 원본 |
| effective_to | date | 허용 | — |  | 원본 |
| review_state | text | 불가 | 'extracting'::text |  | 원본 |
| publish_state | text | 불가 | 'unpublished'::text |  | 원본 |
| index_state | text | 불가 | 'not_indexed'::text |  | 원본 |
| extraction_job_id | text | 허용 | — |  | 원본 |
| extraction_notes | text | 허용 | — |  | 원본 |
| registered_by_account_id | text | 불가 | — |  | 원본 |
| verified_by_account_id | text | 허용 | — |  | 원본 |
| verified_at | timestamp with time zone | 허용 | — |  | 원본 |
| published_by_account_id | text | 허용 | — |  | 원본 |
| published_at | timestamp with time zone | 허용 | — |  | 원본 |
| withdrawn_at | timestamp with time zone | 허용 | — |  | 원본 |
| withdrawn_by_account_id | text | 허용 | — |  | 원본 |
| withdraw_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (published_by_account_id) → workhub.accounts(id)
- (registered_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,document_id) → workhub.knowledge_documents(scope_key,id)
- (scope_key,extraction_job_id) → workhub.jobs(scope_key,id)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)
- (verified_by_account_id) → workhub.accounts(id)
- (withdrawn_by_account_id) → workhub.accounts(id)

## workhub.legacy_access_gates

작업·이관·복구 · 기존 보강

열람: 서버 전용과 목적별 플랫폼 안전 점검 DTO.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| path_code | text | 불가 | — |  | 원본 |
| description | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'open'::text |  | 원본 |
| evidence_ref | text | 허용 | — |  | 원본 |
| verified_by_account_id | text | 허용 | — |  | 원본 |
| verified_at | timestamp with time zone | 허용 | — |  | 원본 |

통합 필수 제약:

- 기존 path_code PK·verified 증거/시각/검증자 필수 유지

통합 동작 규칙:

- 필수 코드 집합이 누락 없이 존재하고 모두 verified일 때만 두 번째 실제 학교를 연다.
- 직접 URL/REST/Storage/Range/구 접수증·종료회원까지 실제 부정시험한다.
- 합성 환경 예외는 승인된 환경표로 고정하며 사용자 인자만으로 synthetic 우회 불가.

인덱스: 기존 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (verified_by_account_id) → workhub.accounts(id)

필수 시험: MIG04 행 삭제/미생성으로 게이트 통과 불가

## workhub.lesson_execution_teachers

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| lesson_instance_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,lesson_instance_id,revision_no) → workhub.lesson_executions(school_id,lesson_instance_id,revision_no)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.lesson_executions

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| lesson_instance_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| state | text | 불가 | — |  | 원본 |
| actual_starts_at | timestamp with time zone | 허용 | — |  | 원본 |
| actual_ends_at | timestamp with time zone | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 불가 | — |  | 원본 |
| reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)

## workhub.lesson_instance_teachers

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| lesson_instance_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| role | text | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.lesson_instances

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| lesson_date | date | 불가 | — |  | 원본 |
| period_no | smallint | 허용 | — |  | 원본 |
| starts_at | timestamp with time zone | 불가 | — |  | 원본 |
| ends_at | timestamp with time zone | 불가 | — |  | 원본 |
| slot | tstzrange | 허용 | tstzrange(starts_at, ends_at, '[)'::text) |  | 원본 |
| space_id | text | 허용 | — |  | 원본 |
| origin | text | 불가 | — |  | 원본 |
| timetable_version_id | text | 허용 | — |  | 원본 |
| change_set_id | text | 허용 | — |  | 원본 |
| replaces_lesson_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'planned'::text |  | 원본 |
| cancel_category | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,replaces_lesson_id) → workhub.lesson_instances(school_id,id)
- (school_id,space_id) → workhub.spaces(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)
- (school_id,timetable_version_id) → workhub.timetable_versions(school_id,id)

## workhub.membership_home_layouts

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| membership_id | text | 불가 | — |  | 원본 |
| layout | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (membership_id) → workhub.memberships(id)

## workhub.membership_roles

계정·학교·권한 · 기존 보강

열람: 현재 같은 학교에서 필요한 역할 메타. 역할 내용이 private 원문 열람을 허용하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| role_code | text | 불가 | — |  | 원본 |
| scope_type | text | 불가 | 'school'::text |  | 원본 |
| scope_department_id | text | 허용 | — |  | 원본 |
| scope_grade | smallint | 허용 | — |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| granted_by_membership_id | text | 허용 | — |  | 원본 |
| granted_at | timestamp with time zone | 불가 | now() |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoke_reason | text | 허용 | — |  | 원본 |

통합 필수 제약:

- 기존 학교 복합 FK·소속 내 기간·허용 scope·동일 역할 범위 중첩 거부 유지

통합 동작 규칙:

- member_has_perm 계열은 계정·학교·소속의 현재 활성과 기간까지 포함한다.
- grade/department 범위를 school 전체로 승격하지 않는다.
- 역할 회수와 관련 데이터 쓰기/worker 확정은 공통 gate 잠금을 공유한다.
- 이관은 최초 연결 이후 회수된 grant를 다시 생성하지 않는다.
- 마지막 관리자 회수·자기 승격은 명시된 운영 명령과 감사로 제한한다.

인덱스: (school_id,membership_id,valid_from,valid_to) WHERE revoked_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,scope_department_id) → workhub.departments(school_id,id)
- (role_code) → workhub.role_catalog(role_code)
- (school_id,granted_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

필수 시험: FS03 학교/학년/부서 범위 분리; MIG02 R03 회수된 역할 유지; FS07 역할 회수 선행 경합

## workhub.memberships

계정·학교·권한 · 기존 보강

열람: 본인 소속/신청. 타인 전체 행은 같은 학교 membership.approve 한정, 일반 roster는 전용 최소 DTO.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| account_id | text | 불가 | — |  | 원본 |
| status | text | 불가 | 'pending'::text |  | 원본 |
| employment_type | text | 허용 | — |  | 원본 |
| valid_from | date | 허용 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| requested_at | timestamp with time zone | 불가 | now() |  | 원본 |
| request_note | text | 허용 | — |  | 원본 |
| join_code_id | text | 허용 | — |  | 원본 |
| decided_by_membership_id | text | 허용 | — |  | 원본 |
| decided_at | timestamp with time zone | 허용 | — |  | 원본 |
| decision_note | text | 허용 | — |  | 원본 |
| left_reason | text | 허용 | — |  | 원본 |
| permission_version | bigint | 불가 | 1 | 권한·기간·관계 회수의 무효화 판. 기존 정수 값을 보존하며 확장한다. | 통합 변경 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- UNIQUE(school_id,id,account_id) 추가
- 기존 UNIQUE(school_id,id), pending 조건부 UNIQUE 유지
- active/suspended/left의 동일 school/account daterange [) 중첩 거부 유지
- 같은 학교 결정자 복합 FK 및 같은 계정 자기 승인 금지 유지

통합 동작 규칙:

- 계정·학교·소속 status와 기간을 모두 현재 시점으로 검사한다.
- 학교/계정 ID는 생성 뒤 불변이며 복귀는 새 소속 ID다.
- 승인·종료·기간 변경은 현재 권한·expectedVersion을 검사하고 회수원장을 남긴다.
- 기존 public.workhub_memberships.valid_through의 포함 종료일은 명시적으로 +1일 변환한다.
- 미래·종료 소속의 본문 접근을 차단한다. 같은 계정이 같은 학교에 재임용되면 보존된 본인 관찰/상담/평가/생기부초안 및 개인 task/doc/event 읽기는 허용하되 이전 AI 대화/기억 자동 열람과 타인·새명부 접근은 금지한다.

인덱스: (account_id,status,school_id); (school_id,status,valid_from,valid_to)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)
- (school_id,decided_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,join_code_id) → workhub.school_join_codes(school_id,id)

필수 시험: FS04 미래/만료/재임용 경계; FS07 실제 독립 연결 권한 회수 경합; MIG02 종료 소속 이관 부활 차단

## workhub.memories

Claude·기억 · 기존 보강

열람: 본인+생성소속 유효+원본 접근; 지원자 우회 없음

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| content | text | 허용 | — |  | 원본 |
| source_type | text | 불가 | — |  | 원본 |
| source_id | text | 허용 | — |  | 원본 |
| source_revision | integer | 허용 | — |  | 원본 |
| state | text | 불가 | 'candidate'::text |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| invalid_reason | text | 허용 | — |  | 원본 |
| deleted_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| origin_membership_id | text | 허용 | — | workhub.memberships.id · 학교 기억의 생성 소속; 개인은 NULL · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- scope=school iff origin_membership_id IS NOT NULL
- FK(school_id,origin_membership_id,owner_account_id) REFERENCES workhub.memberships(school_id,id,account_id)
- scope/school/owner/origin 불변

통합 동작 규칙:

- usable_memories에서 생성소속·현재출처 ACL/판·만료 모두 재검사
- 학교자료를 개인 기억으로 자동복사 금지; 정정/철회/전출/삭제 시 즉시 사용차단
- 학생 성향/위험 추정 자동 장기기억 금지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

필수 시험: AI03: 재임용 때 옛기억 자동 복구0; AI12: 원문파기시 복제기억도 대상

## workhub.messages

Claude·기억 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| conversation_id | text | 불가 | — |  | 원본 |
| seq | integer | 불가 | — |  | 원본 |
| role | text | 불가 | — |  | 원본 |
| content | jsonb | 불가 | — |  | 원본 |
| run_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (conversation_id) → workhub.conversations(id)
- (conversation_id,run_id) → workhub.ai_runs(conversation_id,id)

## workhub.migration_checks

작업·이관·복구 · 기존 보강

열람: 현재 열람 가능한 이관 실행의 안전한 합계만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| run_id | text | 불가 | — |  | 원본 |
| check_code | text | 불가 | — |  | 원본 |
| expected | jsonb | 불가 | — |  | 원본 |
| actual | jsonb | 불가 | — |  | 원본 |
| passed | boolean | 불가 | — |  | 원본 |
| checked_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- 기존 PK(run_id,check_code)·불변 유지

통합 동작 규칙:

- 승인된 이관 종류별 필수 check_code 집합을 서버/적용본에서 고정한다.
- 체크 한 행이 true라는 이유로 계정 보존·파일/권한 검사를 생략하지 않는다.
- 개수 대조뿐 아니라 UID/기존 값/참조/트리거·지문과 차이 건수를 검사한다.

인덱스: 기존 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (run_id) → workhub.migration_runs(id)

필수 시험: MIG01 행 단위 보존; MIG03 누락 검사 false-positive 차단

## workhub.migration_items

작업·이관·복구 · 기존 보강

열람: 학교 ops에 비식별 매핑 상태. 임의 target_type/id는 권한 증거가 아님.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| run_id | text | 불가 | — |  | 원본 |
| source_kind | text | 불가 | — |  | 원본 |
| source_id | text | 불가 | — |  | 원본 |
| source_sha256 | text | 불가 | — |  | 원본 |
| target_type | text | 허용 | — |  | 원본 |
| target_id | text | 허용 | — |  | 원본 |
| target_sha256 | text | 허용 | — |  | 원본 |
| mapping_state | text | 불가 | — |  | 원본 |
| error_code | text | 허용 | — |  | 원본 |
| exclusion_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| intent | text | 불가 | 'compare_only' | first_link/compare_only. 최초 applied 연결이 있으면 compare_only만 | 통합 추가 |
| target_version_at_review | integer | 허용 | — | 대상 원본판. 신규이면 NULL | 통합 추가 |
| target_permission_version_at_review | bigint | 허용 | — | 현재 권한판. 승인 이후 변경을 탐지 | 통합 추가 |

통합 필수 제약:

- intent IN ('first_link','compare_only')
- 기존 원본별 최초 applied 조건부 UNIQUE 유지
- 기존 school/run 복합 FK·mapping_state 필수값 유지

통합 동작 규칙:

- 대상에 어떤 변경을 하기 전에 최초 applied 연결을 조회한다.
- 연결된 회원은 legacy의 admin/active에 의해 역할·종료 소속을 재생성하지 않는다.
- 원본별 변경분은 unchanged/conflict/needs_mapping으로 기록하고 권한 변경은 별도 현재 도메인 명령으로 한다.
- unresolved를 화면에만 출력하고 mapped/applied로 기록하지 않는다.

인덱스: 기존 migration_items_applied와 open 부분 인덱스 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,run_id) → workhub.migration_runs(school_id,id)
- (target_type) → workhub.resource_classes(resource_type)

필수 시험: MIG02 다른 회원 추가 후 관리자 역할0 유지; MIG03 전출/재임용/다른학교/미매핑 분류

## workhub.migration_runs

작업·이관·복구 · 기존 보강

열람: 해당 학교 ops 권한의 비식별 실행 메타. 원본 개인자료 복사 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| source_kind | text | 불가 | — |  | 원본 |
| source_snapshot_at | timestamp with time zone | 불가 | — |  | 원본 |
| source_fingerprint | text | 불가 | — |  | 원본 |
| mapping_version | integer | 불가 | — |  | 원본 |
| state | text | 불가 | 'prepared'::text |  | 원본 |
| expected_counts | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| actual_counts | jsonb | 허용 | — |  | 원본 |
| sql_bundle_sha256 | text | 허용 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| approved_by_account_id | text | 허용 | — |  | 원본 |
| approval_ref | text | 허용 | — |  | 원본 |
| approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| failure_code | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| apply_mode | text | 불가 | 'delta_compare' | initial_link/delta_compare. 기본은 비교만 | 통합 추가 |
| approval_manifest_sha256 | text | 허용 | — | validated/applied에서 필수인 승인 효과 목록 지문 | 통합 추가 |
| target_snapshot_at | timestamptz | 허용 | — | 대상 현재 상태·판을 대조한 기준시각 | 통합 추가 |

통합 필수 제약:

- apply_mode IN ('initial_link','delta_compare')
- validated/applied면 approval_manifest_sha256 64hex 및 target_snapshot_at NOT NULL
- 기존 (school_id,source_kind,source_fingerprint,mapping_version) UNIQUE 유지

통합 동작 규칙:

- 필수 check_code 집합 전체의 통과와 미해결0/승인된 제외가 있어야 applied.
- delta_compare는 계정/소속/역할 생성·활성화 권한이 없다.
- 원본 전체 지문 변경은 기존 대상 권한을 복구할 근거가 아니다.
- 대상판·권한판 변경은 기존 승인을 무효화하고 중단한다.

인덱스: 기존 school/source/fingerprint unique 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (approved_by_account_id) → workhub.accounts(id)
- (created_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

필수 시험: MIG02 R03 역할 부활 차단; MIG03 필수 체크 누락·대상 변경·unresolved 적용 거부

## workhub.notice_receipts

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| notice_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| in_target | boolean | 불가 | — |  | 원본 |
| targeted_version | integer | 허용 | — |  | 원본 |
| read_at | timestamp with time zone | 허용 | — |  | 원본 |
| read_version | integer | 허용 | — |  | 원본 |
| acknowledged_at | timestamp with time zone | 허용 | — |  | 원본 |
| acknowledged_version | integer | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,notice_id) → workhub.notices(school_id,id)

## workhub.notices

전달·알림 · 기존 보강

열람: 현재 승인 관계와 대상. 확인 명단은 요청자/명시 관리권한만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| author_membership_id | text | 불가 | — |  | 원본 |
| posting_basis | text | 불가 | — |  | 원본 |
| basis_department_id | text | 허용 | — |  | 원본 |
| basis_duty_id | text | 허용 | — |  | 원본 |
| basis_academic_class_id | text | 허용 | — |  | 원본 |
| basis_grade | smallint | 허용 | — |  | 원본 |
| audience_set_id | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| importance | text | 불가 | 'normal'::text |  | 원본 |
| requires_ack | boolean | 불가 | false |  | 원본 |
| ack_due_at | timestamp with time zone | 허용 | — |  | 원본 |
| ack_version | integer | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| published_at | timestamp with time zone | 허용 | — |  | 원본 |
| expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| withdrawn_at | timestamp with time zone | 허용 | — |  | 원본 |
| withdrawn_by_membership_id | text | 허용 | — |  | 원본 |
| withdraw_reason | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 동작 규칙:

- 기존 승인 게시근거·명시 확인·철회 불변 유지.
- 알림·file/link·revision 읽기에도 현재 notice ACL, 중요 표시로 전체 대상 확장 금지.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,audience_set_id) → workhub.audience_sets(school_id,id)
- (school_id,author_membership_id) → workhub.memberships(school_id,id)
- (school_id,basis_academic_class_id) → workhub.academic_classes(school_id,id)
- (school_id,basis_department_id) → workhub.departments(school_id,id)
- (school_id,basis_duty_id) → workhub.duties(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,withdrawn_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: WF18

## workhub.notification_kinds

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| kind | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| urgent_allowed | boolean | 불가 | false |  | 원본 |

## workhub.notification_preferences

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| account_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| channel | text | 불가 | — |  | 원본 |
| enabled | boolean | 불가 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)
- (kind) → workhub.notification_kinds(kind)

## workhub.notifications

전달·알림 · 기존 보강

열람: 수신 현재 account/membership+원본 현재read. 알림ID만으로 원본 접근 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| recipient_account_id | text | 불가 | — |  | 원본 |
| recipient_membership_id | text | 허용 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| source_type | text | 불가 | — |  | 원본 |
| source_id | text | 불가 | — |  | 원본 |
| source_version | integer | 불가 | 1 |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| link_path | text | 허용 | — |  | 원본 |
| priority | text | 불가 | 'normal'::text |  | 원본 |
| urgent_by_membership_id | text | 허용 | — |  | 원본 |
| digest_bucket | text | 허용 | — |  | 원본 |
| deliver_after | timestamp with time zone | 불가 | now() |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| read_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoke_reason | text | 허용 | — |  | 원본 |
| push_state | text | 불가 | 'none'::text |  | 원본 |

통합 필수 제약:

- title은 민감 이름/본문 없는 허용 템플릿에서 서버 생성
- 기존 recipient+kind+source+version 중복키 유지

통합 동작 규칙:

- 원본 제목은 읽기 RPC에서 현재 ACL 후 합성, 저장된 민감 제목 캐시 금지.
- read RLS와 push worker 모두 현재 원본 resolver 검사, revoke 지연에도 노출 없음.
- 읽음/명시확인/업무완료 구별, 푸시 실패로 업무 rollback 금지.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (kind) → workhub.notification_kinds(kind)
- (recipient_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (school_id,recipient_membership_id) → workhub.memberships(school_id,id)
- (school_id,urgent_by_membership_id) → workhub.memberships(school_id,id)
- (source_type) → workhub.resource_classes(resource_type)

필수 시험: WF18; WF19

## workhub.object_revisions

작업·이관·복구 · 기존 보강

열람: 원문 직접 SELECT 금지. object_revision_read의 현재 원본권한 검사만 허용. audit.read는 본문 허가증이 아님.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| object_type | text | 불가 | — |  | 원본 |
| object_id | text | 불가 | — |  | 원본 |
| version | integer | 불가 | — |  | 원본 |
| snapshot | jsonb | 불가 | — |  | 원본 |
| change_kind | text | 불가 | — |  | 원본 |
| changed_by_account_id | text | 허용 | — |  | 원본 |
| changed_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- 기존 PK(school_id,object_type,object_id,version)·일반 수정 불변 유지

통합 동작 규칙:

- R01: authenticated의 원문 포함 표 전체 SELECT를 회수한다.
- 감사 DTO에는 원본 ID/판/변경종류/시각/최소 행위자만 제공하며 snapshot을 포함하지 않는다.
- 본문 읽기 RPC는 등록된 원본 종류의 현재 접근권한+요청판 허용을 검사한다.
- 원본 private/차단/파기/소속종료 후 사본·검색·비교·export 접근도 거부한다.
- 사본은 원본 보존/파기 정책을 상속한다. 불변 트리거의 승인된 파기 경로를 따로 검증한다.

인덱스: 기존 학교/시각 및 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (changed_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

필수 시험: FS06 관계없는 감사 관리자에게 협조원본0/사본본문0; FS05 권한 회수 뒤 과거판/검색/ZIP 접근 거부

## workhub.observation_revisions

학생·평가·생기부 · 기존 보강

열람: 부모 observations에 본인이 현재 접근할 때만; 학생본문 공용 AI 검색 금지

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| observation_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| action | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| enrollment_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 허용 | — |  | 원본 |
| observed_on | date | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| activity_label | text | 허용 | — |  | 원본 |
| category | text | 허용 | — |  | 원본 |
| fact_scope | text | 불가 | 'individual'::text |  | 원본 |
| origin | text | 불가 | — |  | 원본 |
| origin_ref | text | 허용 | — |  | 원본 |
| attested_at | timestamp with time zone | 불가 | — |  | 원본 |
| change_reason | text | 허용 | — |  | 원본 |
| body_sha256 | text | 불가 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| course_membership_id | text | 허용 | — | workhub.course_memberships.id · 수업 관찰일의 해당 학생 수강; 담임 관찰은 NULL 가능 · 생성 후 불변 | 통합 추가 |
| teacher_assignment_id | text | 허용 | — | workhub.course_group_teachers.id · 수업 관찰일 승인된 교사 담당; 담임 관찰은 승인 assignments로 별도 검사 · 생성 후 불변 | 통합 추가 |
| ai_run_id | text | 허용 | — | workhub.ai_runs.id · AI 다듬기의 실제 본인 실행; 원문 비교 출처는 ai_run_sources · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- UNIQUE(school_id,created_by_account_id,observation_id,revision_no)
- FOREIGN KEY(school_id,course_membership_id,student_id) REFERENCES workhub.course_memberships(school_id,id,student_id)
- FOREIGN KEY(school_id,teacher_assignment_id) REFERENCES workhub.course_group_teachers(school_id,id)
- FK(school_id,ai_run_id) REFERENCES workhub.ai_runs(school_id,id); 같은 owner 및 origin 소속/접근 검증
- student_id=부모의 불변 student_id; classroom_adoption 사슬 존재는 양쪽 변경에서 deferred constraint trigger

통합 동작 규칙:

- R06: 가림/파기되지 않은 classroom_adoption판의 채택이력0개는 커밋거부; current+confirmed+needs_review=false이면 활성유효사슬도필수
- course_group_id가 있으면 같은 수업/날짜의 수강과 승인 담당 필수
- origin_ref는 표시 호환값일 뿐 권한/사슬 검사에 사용하지 않음
- AI 다듬기로 classroom 출처를 direct로 세탁하지 않음

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_account_id,observation_id) → workhub.observations(school_id,author_account_id,id)
- (created_by_account_id) → workhub.accounts(id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,enrollment_id,student_id) → workhub.student_enrollments(school_id,id,student_id)
- (school_id,student_id) → workhub.students(school_id,id)

필수 시험: SI03: 문자열 origin_ref만 채운 채택 관찰 거부; SI04: 다른 학생 수강/다른 교사 담당 거부

## workhub.observations

학생·평가·생기부 · 기존 보강

열람: 현재 본교 유효 소속+본인 author+보존/차단 정책; 관리자/지원자 우회 및 존재/건수 노출 금지

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| author_account_id | text | 불가 | — |  | 원본 |
| author_membership_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| enrollment_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 허용 | — |  | 원본 |
| lesson_instance_id | text | 허용 | — |  | 원본 |
| observed_on | date | 불가 | — |  | 원본 |
| state | text | 불가 | 'confirmed'::text |  | 원본 |
| needs_review | boolean | 불가 | false |  | 원본 |
| current_revision_no | integer | 불가 | 1 |  | 원본 |
| batch_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- id,school_id,author_account_id,author_membership_id,student_id,academic_year_id UPDATE 불변 트리거
- author_membership_id의 school/account가 머리 school/author와 일치

통합 동작 규칙:

- R04: 학생 오기록은 원기록 철회+다른 학생 새기록; 같은 머리의 재귀속 금지
- 현재 projection 변경은 새 불변판과 같은 트랜잭션; 철회 뒤 부활 금지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (author_account_id) → workhub.accounts(id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,author_membership_id) → workhub.memberships(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,enrollment_id,student_id) → workhub.student_enrollments(school_id,id,student_id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,student_id) → workhub.students(school_id,id)

필수 시험: SI01: 학생/작성자/학교 재귀속 UPDATE 거부; SI09: 작년 본인 정정과 전출 후 접근 구분

## workhub.operator_grants

계정·학교·권한 · 신규

열람: 본인 허용 행동 DTO. 원표는 authenticated 직접 읽기·쓰기 금지, 플랫폼 관리 함수만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 플랫폼 행동 부여 ID · 생성 후 불변 | 통합 추가 |
| account_id | text | 불가 | — | workhub.service_operators.account_id · 실제 운영자 계정 · 생성 후 불변 | 통합 추가 |
| permission_code | text | 불가 | — | 서버 registry의 허용 플랫폼 행동 코드 · 생성 후 불변 | 통합 추가 |
| valid_from | timestamptz | 불가 | — | 시작 포함 | 통합 추가 |
| valid_to | timestamptz | 허용 | — | 종료 제외. NULL은 계속 | 통합 추가 |
| approved_by_account_id | text | 불가 | — | workhub.accounts.id · 승인 주체. 최초 bootstrap은 별도 승인 증거 · 생성 후 불변 | 통합 추가 |
| approval_ref | text | 불가 | — | 승인 근거 참조. credential 금지 · 생성 후 불변 | 통합 추가 |
| approved_at | timestamptz | 불가 | — | 승인 시각 · 생성 후 불변 | 통합 추가 |
| revoked_at | timestamptz | 허용 | — | 회수 시각. 회수된 행을 재활성화하지 않고 새 승인을 생성 | 통합 추가 |
| version | integer | 불가 | 1 | 낙관적 충돌 판 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- permission_code IN ('school.bootstrap','common.publish','common.index','support.execute','policy.manage','service.manage','operations.restore','operations.migrate')
- valid_to IS NULL OR valid_from < valid_to
- 동일 account_id/permission_code의 미회수 tstzrange [) 기간 중첩 금지
- version > 0

통합 동작 규칙:

- 계정 active+운영자 미회수+현재 grant가 모두 필요하다.
- 학교 역할은 이 표를 만들거나 수정하지 못한다.
- grant 회수·지원 읽기·common 작업 확정은 충돌하는 gate 잠금으로 직렬화한다.
- 플랫폼 grant는 학교의 비공개 자료를 상시 읽는 권한이 아니다.

인덱스: (account_id,permission_code,valid_from,valid_to) WHERE revoked_at IS NULL

필수 시험: FS05 학교 관리자의 플랫폼 권한 획득 거부; FS11 운영자 grant 만료/회수 차단

## workhub.outbox

작업·이관·복구 · 기존 보강

열람: 서버전용; 사용자에게 해당업무의 안전상태만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| topic | text | 불가 | — |  | 원본 |
| aggregate_type | text | 불가 | — |  | 원본 |
| aggregate_id | text | 불가 | — |  | 원본 |
| aggregate_version | integer | 허용 | — |  | 원본 |
| payload | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| dedupe_key | text | 불가 | — |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'pending'::text |  | 원본 |
| attempts | integer | 불가 | 0 |  | 원본 |
| max_attempts | integer | 불가 | 3 |  | 원본 |
| next_attempt_at | timestamp with time zone | 불가 | now() |  | 원본 |
| lease_owner | text | 허용 | — |  | 원본 |
| lease_expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| last_error_code | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| processed_at | timestamp with time zone | 허용 | — |  | 원본 |
| scope_key | text | 불가 | — | 사건원본의 검증된 s:/a:/c/svc 범위 · 생성 후 불변 | 통합 추가 |
| lease_token | bigint | 불가 | 0 | 선점마다 증가하는 전송토큰 | 통합 추가 |

통합 필수 제약:

- lease_token>=0; 선점시단조증가; 기존 dedupe_key UNIQUE 유지
- 원본종류별 scope/schema 검사; scope_key와school_id일치

통합 동작 규칙:

- 원본변경과 같은DB트랜잭션 INSERT
- 옛lease 소비자 결과확정 거부; 수신측 사건키멱등
- payload는 ID/판/종류만; 회수뒤 늦은사건이 명단/원문을 복원하지 않음

인덱스: (state,next_attempt_at,id) WHERE state IN ('pending','failed')

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

필수 시험: AI12: 삭제 뒤 늦은검색/알림 사건으로 본문재생성0; AI10: 오래된전송worker확정거부

## workhub.participant_mapping_revisions

수업 앱 연결 · 기존 보강

열람: 해당 활동의 본인 소유자만

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| mapping_id | text | 불가 | — |  | 원본 |
| revision | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| student_id | text | 허용 | — |  | 원본 |
| enrollment_id | text | 허용 | — |  | 원본 |
| course_membership_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | — |  | 원본 |
| reason | text | 허용 | — |  | 원본 |
| by_account_id | text | 불가 | — |  | 원본 |
| at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- UNIQUE(school_id,mapping_id,revision,student_id)
- state=confirmed이면 student_id,enrollment_id,course_membership_id 모두 NOT NULL
- 기존 school/학생을 포함한 학적·수강 복합 FK 및 owner FK 유지

통합 동작 규칙:

- R05: 최신판을 먼저 선택한 뒤 상태를 검사; 옛 confirmed로 fallback 금지
- 활동일 학적·해당 수업 수강·승인 교사 담당 필수; current pointer가 최신판보다 뒤처져도 이전판 유효 금지

인덱스: (mapping_id,revision DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (by_account_id) → workhub.accounts(id)
- (school_id,by_account_id,mapping_id) → workhub.participant_mappings(school_id,owner_account_id,id)
- (school_id,course_membership_id,student_id) → workhub.course_memberships(school_id,id,student_id)
- (school_id,enrollment_id,student_id) → workhub.student_enrollments(school_id,id,student_id)
- (school_id,student_id) → workhub.students(school_id,id)

필수 시험: SI02: A→B→A에도 옛 채택 stale; SI05: 최신판 held와 head 지연에서 v1 사용 거부

## workhub.participant_mappings

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| activity_instance_id | text | 불가 | — |  | 원본 |
| participant_key | text | 불가 | — |  | 원본 |
| student_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'proposed'::text |  | 원본 |
| current_revision | integer | 불가 | 1 |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,owner_account_id,activity_instance_id) → workhub.activity_instances(school_id,owner_account_id,id)
- (owner_account_id) → workhub.accounts(id)
- (school_id,student_id) → workhub.students(school_id,id)

## workhub.policy_catalog

계정·학교·권한 · 기존 보강

열람: 승인된 이용자에게 안전한 정책 설명. 게시/수정은 플랫폼 policy.manage.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| policy_key | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| description | text | 불가 | — |  | 원본 |
| default_value | jsonb | 불가 | — |  | 원본 |
| default_approval_ref | text | 허용 | — |  | 원본 |
| default_approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| allowed_values | jsonb | 허용 | — |  | 원본 |
| basis | text | 불가 | — |  | 원본 |
| value_schema | jsonb | 허용 | — | 코드 registry와 대조할 값 형식. 미정 키는 게시 불가 | 통합 추가 |
| allowed_override_scopes | text[] | 불가 | ARRAY[]::text[] | 학교 override 허용 여부. 기본은 완화 불가 | 통합 추가 |

통합 필수 제약:

- allowed_override_scopes <@ ARRAY['school']::text[]
- 게시되는 policy_version의 key는 검증된 서버 registry와 value_schema를 갖춰야 함

통합 동작 규칙:

- default_approval_ref 없는 추천값은 실제 승인 기본값이 아니다.
- 정책값을 임의 SQL/권한 코드로 실행하지 않는다.
- 학교 설정으로 private 경계·tenant 격리·승인된 공통 안전 하한을 완화하지 못한다.

인덱스: 기존 policy_key PK 재사용

필수 시험: FS10 미정 정책·형식 불일치·학교 하한 완화 거부

## workhub.policy_versions

계정·학교·권한 · 신규

열람: 현재 이용자에게 적용되는 게시/과거판. draft는 해당 정책 게시 권한자만. 관리 권한이 원본 개인본문 권한을 주지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 정확한 시행 정책판 · 생성 후 불변 | 통합 추가 |
| scope | text | 불가 | — | common/school 게시 주체 범위 · 생성 후 불변 | 통합 추가 |
| school_id | text | 허용 | — | workhub.schools.id · school 정책이면 필수 · 생성 후 불변 | 통합 추가 |
| scope_key | text | 불가 | GENERATED ALWAYS AS (CASE scope WHEN 'school' THEN 's:' \|\| school_id ELSE 'c' END) STORED | 공통/학교 생성키 · 생성 후 불변 | 통합 추가 |
| policy_key | text | 불가 | — | workhub.policy_catalog.policy_key · 등록된 정책 종류 · 생성 후 불변 | 통합 추가 |
| policy_version | integer | 불가 | — | 해당 scope/key의 양수 판 번호 · 생성 후 불변 | 통합 추가 |
| applies_to_scopes | text[] | 불가 | — | 실제 적용 자료/실행 범위. 게시 후 불변 | 통합 추가 |
| value | jsonb | 불가 | — | 형식 검증된 값. 게시 후 불변 | 통합 추가 |
| state | text | 불가 | 'draft' | draft/published/retired | 통합 추가 |
| effective_from | date | 불가 | — | 시작 포함. 게시 후 불변 | 통합 추가 |
| effective_to | date | 허용 | — | 종료 제외. 새 판 게시와 원자적으로 닫는 경우만 변경 | 통합 추가 |
| approved_by_account_id | text | 허용 | — | workhub.accounts.id · published/retired에서는 필수 | 통합 추가 |
| approved_by_membership_id | text | 허용 | — | workhub.memberships.id · 학교 게시판의 승인자 소속. common이면 NULL | 통합 추가 |
| approved_at | timestamptz | 허용 | — | 게시/퇴역판의 승인 시각 필수 | 통합 추가 |
| approval_ref | text | 허용 | — | 게시/퇴역판의 승인 근거 필수 | 통합 추가 |
| created_at | timestamptz | 불가 | now() | 판 생성시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(scope_key,id)
- UNIQUE(scope_key,policy_key,policy_version)
- scope IN ('common','school') AND ((scope='school')=(school_id IS NOT NULL))
- applies_to_scopes 비어있지 않음 AND subset school/account_private/common/service
- school이면 applies_to_scopes=ARRAY['school']; common이면 승인된 registry 적용범위
- state IN ('draft','published','retired') AND policy_version > 0
- effective_to IS NULL OR effective_from < effective_to
- published/retired면 approved_by_account_id/approved_at/approval_ref 모두 NOT NULL; school이면 승인 member 필수; common이면 승인 member 반드시 NULL
- FOREIGN KEY(school_id,approved_by_membership_id,approved_by_account_id) REFERENCES workhub.memberships(school_id,id,account_id); common의 member는 NULL
- 같은 scope/key의 published/retired daterange [) 기간 중첩 금지
- scope='common'이면 approved_by_membership_id IS NULL

통합 동작 규칙:

- 게시된 내용/적용범위/시작일/승인 사실 불변. 수정은 새 판.
- common 승인은 현재 operator_grants policy.manage; school은 해당 학교 policy.manage+catalog 허용 조건.
- 순수개인 자료 안전/비용 정책은 common 판을 사용하며 계정이 완화판을 게시하지 않는다.
- 복합 정책 적용 시 정확한 각 scope_key/id/지문을 모두 고정한다.
- 과거 기준일에는 retired 판도 원래 적용 구간으로 판정한다.

인덱스: (scope_key,policy_key,effective_from,effective_to) WHERE state IN ('published','retired')

필수 시험: FS10 미래 시행판/동일 기간 중첩/NULL 승인 거부; MIG08 과거 제출의 정책판 유지

## workhub.profile_claims

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| claim_kind | text | 불가 | — |  | 원본 |
| none_of | text | 허용 | — |  | 원본 |
| department_id | text | 허용 | — |  | 원본 |
| subject_id | text | 허용 | — |  | 원본 |
| grade | smallint | 허용 | — |  | 원본 |
| academic_class_id | text | 허용 | — |  | 원본 |
| duty_id | text | 허용 | — |  | 원본 |
| free_text | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'pending'::text |  | 원본 |
| decided_by_membership_id | text | 허용 | — |  | 원본 |
| decided_at | timestamp with time zone | 허용 | — |  | 원본 |
| decision_note | text | 허용 | — |  | 원본 |
| resulting_assignment_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_class_id) → workhub.academic_classes(school_id,id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,department_id) → workhub.departments(school_id,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,resulting_assignment_id) → workhub.assignments(school_id,id)
- (school_id,subject_id) → workhub.subjects(school_id,id)

## workhub.push_subscriptions

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| account_id | text | 불가 | — |  | 원본 |
| endpoint | text | 불가 | — |  | 원본 |
| p256dh | text | 불가 | — |  | 원본 |
| auth_secret | text | 불가 | — |  | 원본 |
| user_agent | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| last_success_at | timestamp with time zone | 허용 | — |  | 원본 |
| failure_count | integer | 불가 | 0 |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoke_reason | text | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)

## workhub.quiet_hours

전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| account_id | text | 불가 | — |  | 원본 |
| quiet_start | time without time zone | 불가 | '21:00:00'::time without time zone |  | 원본 |
| quiet_end | time without time zone | 불가 | '07:00:00'::time without time zone |  | 원본 |
| weekend_quiet | boolean | 불가 | true |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)

## workhub.record_correction_approvals

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 불가 | — |  | 원본 |
| target_revision_no | integer | 불가 | — |  | 원본 |
| requested_by_account_id | text | 불가 | — |  | 원본 |
| approver_membership_id | text | 불가 | — |  | 원본 |
| decision | text | 불가 | 'pending'::text |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| approval_ref | text | 허용 | — |  | 원본 |
| access_until | timestamp with time zone | 허용 | — |  | 원본 |
| requested_at | timestamp with time zone | 불가 | now() |  | 원본 |
| decided_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (requested_by_account_id) → workhub.accounts(id)
- (school_id,approver_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.record_draft_revisions

학생·평가·생기부 · 기존 보강

열람: 부모 초안의 현재 본인 접근과 동일

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| draft_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| body | text | 불가 | — |  | 원본 |
| byte_count | integer | 허용 | — |  | 원본 |
| char_count | integer | 허용 | — |  | 원본 |
| rule_set_id | text | 허용 | — |  | 원본 |
| rule_set_scope | text | 허용 | — |  | 원본 |
| rule_set_scope_key | text | 허용 |  CASE rule_set_scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     WHEN 'common'::text THEN 'c'::text     ELSE NULL::text END |  | 원본 |
| rule_check_state | text | 불가 | — |  | 원본 |
| rule_findings | jsonb | 불가 | '[]'::jsonb |  | 원본 |
| generated_by | text | 불가 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| evidence_set_sha256 | text | 불가 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| ai_run_id | text | 허용 | — | workhub.ai_runs.id · 이 초안판 생성에 사용한 본인 AI 실행; 직접 작성은 NULL · 생성 후 불변 | 통합 추가 |
| evidence_epoch | bigint | 불가 | — | 생성 당시 확인한 학생 근거 gate epoch · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- FK(school_id,ai_run_id) REFERENCES workhub.ai_runs(school_id,id)
- AI 생성판이면 ai_run_id 필수; 그 실행 owner=초안 author, purpose=record_draft; 직접 작성의 epoch도 현재 gate에서 서버 결정

통합 동작 규칙:

- 생성 당시 근거와 실행을 정확히 추적; 원본이 바뀌면 새 결과를 reviewed로 자동확정하지 않음

인덱스: (ai_run_id) WHERE ai_run_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_account_id,draft_id) → workhub.record_drafts(school_id,author_account_id,id)
- (created_by_account_id) → workhub.accounts(id)
- (rule_set_scope_key,rule_set_id) → workhub.record_rule_sets(scope_key,id)
- (school_id,job_id) → workhub.jobs(school_id,id)

필수 시험: AI04: 생성 중 근거변경에 대한 결과 공개 차단; 다른 교사 AI 실행을 내 초안판 생성근거로 연결하면 거부

## workhub.record_drafts

학생·평가·생기부 · 기존 보강

열람: 본인 작성자+현재 본교 접근+보존정책; 학생 변경 명령 없음

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| author_account_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| area | text | 불가 | — |  | 원본 |
| subject_id | text | 허용 | — |  | 원본 |
| course_group_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| needs_review | boolean | 불가 | false |  | 원본 |
| needs_review_reason | text | 허용 | — |  | 원본 |
| current_revision_no | integer | 불가 | 0 |  | 원본 |
| reviewed_revision_no | integer | 허용 | — |  | 원본 |
| reviewed_evidence_sha256 | text | 허용 | — |  | 원본 |
| reviewed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| reviewed_evidence_epoch | bigint | 허용 | — | 마지막 검토가 고정한 owner gate epoch | 통합 추가 |

통합 필수 제약:

- R04: id,school_id,author_account_id,student_id,academic_year_id,area,subject_id,course_group_id 불변
- state<>draft이면 reviewed_evidence_epoch 필수; 현재 gate/원본검사와 일치해야 확정

통합 동작 규칙:

- 검토/출력 때 문장과 모든 원본판의 학생·학교·owner·최신성 재검사
- evidence_set_sha256는 서버가 실제 문장/근거판/구간/mapping/규칙판으로 재계산
- 새판 생성 시 draft로 되돌림

기존 FK 관계(변경 계약과 충돌하면 대체):

- (author_account_id) → workhub.accounts(id)
- (school_id,id,reviewed_revision_no) → workhub.record_draft_revisions(school_id,draft_id,revision_no)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,student_id) → workhub.students(school_id,id)
- (school_id,subject_id) → workhub.subjects(school_id,id)

필수 시험: SI01: A로 검토 후 head.student_id=B UPDATE 거부; SI06: 근거 동시 정정이 먼저면 검토/출력 실패

## workhub.record_exports

학생·평가·생기부 · 기존 보강

열람: 본인 작성자+현재 원본권한; 다운로드 재발급 시도 동일 재검사

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| draft_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| exported_by_account_id | text | 불가 | — |  | 원본 |
| format | text | 불가 | — |  | 원본 |
| file_object_id | text | 허용 | — |  | 원본 |
| evidence_check_sha256 | text | 불가 | — |  | 원본 |
| official_state | text | 불가 | 'unknown'::text |  | 원본 |
| exported_at | timestamp with time zone | 불가 | now() |  | 원본 |
| student_id | text | 불가 | — | workhub.students.id · 출력 대상 학생 사본 · 생성 후 불변 | 통합 추가 |
| academic_year_id | text | 불가 | — | workhub.academic_years.id · 출력 학년도 사본 · 생성 후 불변 | 통합 추가 |
| area | text | 불가 | — | 초안의 불변 기재영역 사본 · 생성 후 불변 | 통합 추가 |
| subject_id | text | 허용 | — | workhub.subjects.id · 과목 영역인 경우 교과 사본 · 생성 후 불변 | 통합 추가 |
| course_group_id | text | 허용 | — | workhub.course_groups.id · 초안 수업 사본 · 생성 후 불변 | 통합 추가 |
| evidence_epoch | bigint | 불가 | — | 최종 동기 검사 gate epoch · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- 모든 대상 FK는 school 복합 FK
- identity 사본이 draft identity와 일치해야 INSERT; 출력 당시 현재판/근거지문/epoch 재검사

통합 동작 규칙:

- 이미 다운로드된 파일의 회수를 보장하지 않음; 원본 정정 시 영향목록으로 최신성 상실 표시
- official_state는 사용자 공식 입력 확인과 구분

인덱스: (school_id,draft_id,revision_no)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,exported_by_account_id,draft_id) → workhub.record_drafts(school_id,author_account_id,id)
- (exported_by_account_id) → workhub.accounts(id)
- (school_id,draft_id,revision_no) → workhub.record_draft_revisions(school_id,draft_id,revision_no)
- (school_id,file_object_id) → workhub.file_objects(school_id,id)

필수 시험: SI01: 오염 fixture에서도 다른 학생 근거로 export 거부; SI06: 출력 후 정정은 기존 출력 영향으로 남음

## workhub.record_rule_sets

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| school_level | text | 불가 | — |  | 원본 |
| school_year | smallint | 불가 | — |  | 원본 |
| area | text | 불가 | — |  | 원본 |
| form_version | text | 불가 | — |  | 원본 |
| byte_limit | integer | 허용 | — |  | 원본 |
| char_limit | integer | 허용 | — |  | 원본 |
| counting_method | text | 불가 | — |  | 원본 |
| source_ref | text | 불가 | — |  | 원본 |
| confirmed_by_account_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (confirmed_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)

## workhub.record_sentences

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| draft_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| seq | smallint | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| text | text | 불가 | — |  | 원본 |
| signals | jsonb | 불가 | '[]'::jsonb |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,draft_id,revision_no) → workhub.record_draft_revisions(school_id,draft_id,revision_no)

## workhub.recovery_sets

작업·이관·복구 · 기존 보강

열람: 서버 및 승인된 operations.restore 메타. 원본 snapshot 경로·접근토큰은 일반 DTO 제외.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| taken_at | timestamp with time zone | 불가 | — |  | 원본 |
| state | text | 불가 | 'building'::text |  | 원본 |
| db_snapshot_ref | text | 허용 | — |  | 원본 |
| storage_snapshot_ref | text | 허용 | — |  | 원본 |
| object_manifest_ref | text | 허용 | — |  | 원본 |
| object_manifest_sha256 | text | 허용 | — |  | 원본 |
| object_count | bigint | 허용 | — |  | 원본 |
| total_bytes | bigint | 허용 | — |  | 원본 |
| pack_versions | jsonb | 허용 | — |  | 원본 |
| account_map_ref | text | 허용 | — |  | 원본 |
| sql_bundle_sha256 | text | 허용 | — |  | 원본 |
| app_version | text | 허용 | — |  | 원본 |
| deletion_seq_high_water | bigint | 허용 | — |  | 원본 |
| restoration_seq_high_water | bigint | 허용 | — |  | 원본 |
| verified_by_restore_run_id | text | 허용 | — |  | 원본 |
| expires_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_by_service_principal_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| scope | text | 불가 | — | school/service 복구 세트 범위. school_id NULL로 추정하지 않음 | 통합 추가 |

통합 필수 제약:

- scope IN ('school','service') AND ((scope='school')=(school_id IS NOT NULL))
- 기존 complete/verified 필수 스냅숏·실물 manifest·계정대응·SQL/앱·원장기준점 조건 유지
- complete/verified는 total_bytes NOT NULL도 필수
- verified는 성공한 자기 recovery_set의 restore_run FK/상태 검증

통합 동작 규칙:

- 실제 Storage 바이트 없는 manifest만으로 complete 판정 금지.
- 백업 위치/만료는 승인 정책이며 실제 credential을 저장하지 않는다.
- 학교 세트는 해당학교와 명시적 공통 의존판만 포함하며 글로벌 운영 scope가 공개권한을 주지 않는다.

인덱스: 기존 학교/시점 부분 인덱스 유지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (created_by_service_principal_id) → workhub.service_principals(id)
- (school_id) → workhub.schools(id)
- (id,verified_by_restore_run_id) → workhub.restore_runs(recovery_set_id,id)

필수 시험: MIG07 파일 누락/지문불일치/다른세트 검증회수 거부

## workhub.resource_classes

작업·이관·복구 · 기존 보강

열람: 서비스 분류 설명. 관리 쓰기는 승인된 내부 경로만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| resource_type | text | 불가 | — |  | 원본 |
| record_class | text | 불가 | — |  | 원본 |
| scope_dependent | boolean | 불가 | false |  | 원본 |

통합 필수 제약:

- 새 통합 표마다 자료 분류 항목 존재
- 원본/사본과 scope별 보존 분류 검사

통합 동작 규칙:

- object_revisions의 실제 원문은 원본 자료 분류·파기 범위를 상속한다.
- 여기에 등록됐다는 사실은 권한·파기 승인이 아니다.
- 보존 분류 미확정은 해당 수집/파기 기능의 공개 게이트에서 확인한다.

인덱스: 기존 PK 재사용

필수 시험: MIG06 사본만 잔존하는 파기 차단; MIG09 신규표 분류 누락 검사

## workhub.resource_occupancy

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 불가 | — |  | 원본 |
| slot | tstzrange | 불가 | — |  | 원본 |
| source_type | text | 불가 | — |  | 원본 |
| source_id | text | 불가 | — |  | 원본 |
| exclusive | boolean | 불가 | true |  | 원본 |

## workhub.restoration_ledger

작업·이관·복구 · 기존 보강

열람: 서버 전용과 최소 운영 검증 DTO. 학교 admin이 원문을 조회하는 경로가 아님.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| seq | bigint | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| operation_type | text | 불가 | — |  | 원본 |
| subject_type | text | 불가 | — |  | 원본 |
| subject_id | text | 불가 | — |  | 원본 |
| detail | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| source_ref | text | 허용 | — |  | 원본 |
| effective_at | timestamp with time zone | 불가 | now() |  | 원본 |
| recorded_at | timestamp with time zone | 불가 | now() |  | 원본 |
| replicated_at | timestamp with time zone | 허용 | — |  | 원본 |
| scope | text | 불가 | — | school/account_private/common/service 회수 대상 범위 | 통합 추가 |
| owner_account_id | text | 허용 | — | workhub.accounts.id · 개인 범위의 계정 | 통합 추가 |
| scope_key | text | 불가 | GENERATED ALWAYS AS (CASE scope WHEN 'school' THEN 's:' \|\| school_id WHEN 'account_private' THEN 'a:' \|\| owner_account_id WHEN 'common' THEN 'c' ELSE 'svc' END) STORED | 회수 대상의 생성 scope key · 생성 후 불변 | 통합 추가 |
| subject_key | jsonb | 불가 | — | 안전한 구조화 PK. 복합 키를 ':' 문자열로만 해석하지 않는다. | 통합 추가 |

통합 필수 제약:

- scope와 school/owner 일치 CHECK
- 기존 seq PK 및 복제시각 외 불변 유지
- subject_key는 등록된 subject_type의 정확한 키 schema

통합 동작 규칙:

- 계정/학교/소속/역할/관계/지원/서비스 grant 회수와 같은 트랜잭션에서 기록한다.
- 본문·키·토큰 없음. 승인된 별도 장애경계로 복제하여 최신 기준점 추적.
- 복구는 원장 재적용 후에만 접근을 재개한다.

인덱스: 기존 seq/미복제 부분 인덱스 유지; (scope_key,seq)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

필수 시험: MIG07 회수 역할·종료소속·파일발급 부활 차단; MIG06 원장 복제 지연 경보

## workhub.restore_runs

작업·이관·복구 · 기존 보강

열람: 승인된 운영 담당의 안전한 검증 메타. 원본 개인자료는 복구 사유로 상시 열람하지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| recovery_set_id | text | 불가 | — |  | 원본 |
| purpose | text | 불가 | — |  | 원본 |
| environment_ref | text | 불가 | — |  | 원본 |
| outbound_disabled | boolean | 불가 | — |  | 원본 |
| state | text | 불가 | 'planned'::text |  | 원본 |
| restored_at | timestamp with time zone | 허용 | — |  | 원본 |
| files_checked_at | timestamp with time zone | 허용 | — |  | 원본 |
| file_missing_count | integer | 허용 | — |  | 원본 |
| file_mismatch_count | integer | 허용 | — |  | 원본 |
| ledgers_reapplied_at | timestamp with time zone | 허용 | — |  | 원본 |
| reapplied_deletion_seq_to | bigint | 허용 | — |  | 원본 |
| reapplied_restoration_seq_to | bigint | 허용 | — |  | 원본 |
| access_checked_at | timestamp with time zone | 허용 | — |  | 원본 |
| access_check_result | jsonb | 허용 | — |  | 원본 |
| started_by_account_id | text | 불가 | — |  | 원본 |
| started_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| result_summary | jsonb | 허용 | — |  | 원본 |

통합 필수 제약:

- 상태별 선행 시각/원장기준점/파일 검사 결과에 명시적 NOT NULL+순서 CHECK
- succeeded이면 missing/mismatch=0, access_check_result의 필수 검사 모두 성공
- 기존 동일 recovery_set FK와 종료시각 조건 유지

통합 동작 규칙:

- 외부 AI/이메일/푸시/웹훅 차단이 확인된 격리 환경만.
- 현재 계정·권한 회수와 파기 원장을 재적용한 뒤 접근 시험.
- 불명확한 외부 호출/옛 worker/outbox를 자동 재실행하지 않는다.
- 한 학교 사고로 다학교 운영 DB 전체를 과거로 덮지 않는다.

인덱스: (recovery_set_id,started_at DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (recovery_set_id) → workhub.recovery_sets(id)
- (started_by_account_id) → workhub.accounts(id)

필수 시험: MIG07 실제 파일 열기·권한재적용·외부재전송0; MIG09 실제 Supabase/worker 복구 리허설

## workhub.retention_holds

작업·이관·복구 · 기존 보강

열람: 보존 담당자가 목적상 필요한 최소 메타. 원본 본문권한을 확대하지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 불가 | — |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| basis_ref | text | 불가 | — |  | 원본 |
| held_by_account_id | text | 불가 | — |  | 원본 |
| held_at | timestamp with time zone | 불가 | now() |  | 원본 |
| released_by_account_id | text | 허용 | — |  | 원본 |
| released_at | timestamp with time zone | 허용 | — |  | 원본 |
| scope | text | 불가 | — | school/account_private/common/service 명시 | 통합 추가 |
| owner_account_id | text | 허용 | — | workhub.accounts.id · account_private 대상이면 필수 | 통합 추가 |
| scope_key | text | 불가 | GENERATED ALWAYS AS (CASE scope WHEN 'school' THEN 's:' \|\| school_id WHEN 'account_private' THEN 'a:' \|\| owner_account_id WHEN 'common' THEN 'c' ELSE 'svc' END) STORED | 대상 범위 키 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- (scope='school')=(school_id IS NOT NULL)
- (scope='account_private')=(owner_account_id IS NOT NULL)
- scope IN ('school','account_private','common','service')
- 대상 domain handler가 실제 scope/id 일치를 검사
- 활성 UNIQUE를 (scope_key,resource_type,resource_id,reason)으로 보강

통합 동작 규칙:

- hold는 파기를 제한하며 원본문 접근을 새로 열지 않는다.
- 대상범위/근거는 생성 후 불변, 해제는 해제자·시각·감사 필수.

인덱스: (scope_key,resource_type,resource_id) WHERE released_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (held_by_account_id) → workhub.accounts(id)
- (released_by_account_id) → workhub.accounts(id)
- (resource_type) → workhub.resource_classes(resource_type)
- (school_id) → workhub.schools(id)

필수 시험: MIG06 다른 학교/개인 hold 바꿔치기 거부

## workhub.retention_rules

작업·이관·복구 · 기존 보강

열람: 적용되는 승인 정책 설명과 지정 정책 담당자의 초안. 학교가 공통 정책을 수정하지 못함.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 허용 |  CASE scope     WHEN 'school'::text THEN ('s:'::text \|\| school_id)     ELSE 'c'::text END |  | 원본 |
| record_class | text | 불가 | — |  | 원본 |
| policy_version | integer | 불가 | — |  | 원본 |
| purpose | text | 불가 | — |  | 원본 |
| legal_basis_ref | text | 허용 | — |  | 원본 |
| retention_expression | jsonb | 허용 | — |  | 원본 |
| exceptions | text | 허용 | — |  | 원본 |
| post_end_access | text | 허용 | — |  | 원본 |
| purge_owner_role | text | 허용 | — |  | 원본 |
| backup_expiry | jsonb | 허용 | — |  | 원본 |
| state | text | 불가 | 'unconfirmed'::text |  | 원본 |
| effective_from | date | 허용 | — |  | 원본 |
| effective_to | date | 허용 | — |  | 원본 |
| approved_by_account_id | text | 허용 | — |  | 원본 |
| approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| approval_ref | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| purge_service_action | text | 불가 | 'deletion_process' | 파기 실행에 필요한 서비스 행동. 인간 책임 역할과 구분 | 통합 추가 |

통합 필수 제약:

- purge_service_action='deletion_process'
- 기존 승인된 정책의 근거/기간/승인 필수·scope 기간 중첩 거부 유지
- 학교 규칙은 승인된 공통 안전 하한을 완화하지 못함

통합 동작 규칙:

- 보존기간·법적 근거·백업만료를 임의 채우지 않는다.
- 미정이면 관련 파기/공개 기능의 정책 게이트를 막는다.
- 사람 책임/승인과 실제 독립 서비스 실행자를 분리한다.
- 공유 사본은 원본 분류/파기 범위를 따라야 하며 ops_metadata로 무제한 잔존하지 않는다.

인덱스: 기존 scope/class/version unique와 기간 exclusion 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (approved_by_account_id) → workhub.accounts(id)
- (purge_owner_role) → workhub.role_catalog(role_code)
- (school_id) → workhub.schools(id)

필수 시험: MIG06 미승인 규칙·hold 파기 거부; MIG07 복구 후 정책/파기판 일치

## workhub.role_catalog

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| role_code | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| description | text | 불가 | — |  | 원본 |
| grantable_by | text | 불가 | — |  | 원본 |
| allowed_scopes | text[] | 불가 | '{school}'::text[] |  | 원본 |

## workhub.role_permissions

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| role_code | text | 불가 | — |  | 원본 |
| permission | text | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (role_code) → workhub.role_catalog(role_code)

## workhub.rubric_revisions

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| rubric_id | text | 불가 | — |  | 원본 |
| revision_no | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| items | jsonb | 불가 | — |  | 원본 |
| max_total | numeric | 불가 | — |  | 원본 |
| conversion | jsonb | 허용 | — |  | 원본 |
| source_ref | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,rubric_id) → workhub.rubrics(school_id,id)

## workhub.rubrics

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| subject_id | text | 허용 | — |  | 원본 |
| grade | smallint | 허용 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| current_revision_no | integer | 불가 | 1 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,subject_id) → workhub.subjects(school_id,id)

## workhub.school_feature_pilots

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| module_code | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| added_by_account_id | text | 불가 | — |  | 원본 |
| added_at | timestamp with time zone | 불가 | now() |  | 원본 |
| removed_at | timestamp with time zone | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (added_by_account_id) → workhub.accounts(id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,module_code) → workhub.school_features(school_id,module_code)

## workhub.school_features

계정·학교·권한 · 기존 보강

열람: 현재 자기 학교의 안전한 기능 상태. 수정은 명시적 설정 권한.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| module_code | text | 불가 | — |  | 원본 |
| visibility | text | 불가 | 'operator'::text |  | 원본 |
| support_state | text | 불가 | 'designed'::text |  | 원본 |
| approval_ref | text | 허용 | — |  | 원본 |
| limitations | text | 허용 | — |  | 원본 |
| updated_by_account_id | text | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- 기존 학교/모듈 PK와 pilot 동일학교 FK 유지

통합 동작 규칙:

- 신규 모듈 superadmin 기본 범위 유지. 학교 공개 설정은 기존 rollout과 AND로 결합한다.
- 메뉴/라우트/RPC/직접읽기/파일/작업의 동일 모듈 gate를 적용한다.
- 새 공개/파일럿 확대는 승인된 배포·음성시험과 함께만 수행한다.

인덱스: 기존 PK와 활성 pilot 인덱스 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (updated_by_account_id) → workhub.accounts(id)

필수 시험: FS12 숨긴 모듈 직접 URL/RPC/파일 호출 거부

## workhub.school_join_codes

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| code_sha256 | text | 불가 | — |  | 원본 |
| expires_at | timestamp with time zone | 불가 | — |  | 원본 |
| max_uses | integer | 허용 | — |  | 원본 |
| used_count | integer | 불가 | 0 |  | 원본 |
| created_by_membership_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.school_policies

계정·학교·권한 · 기존 보강

열람: 현재 자기 학교의 정책 설명. 직접 쓰기 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| policy_key | text | 불가 | — |  | 원본 |
| value | jsonb | 불가 | — |  | 원본 |
| effective_from | date | 불가 | — |  | 원본 |
| approval_ref | text | 불가 | — |  | 원본 |
| updated_by_membership_id | text | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- 기존 school/policy_key PK·복합 FK 유지

통합 동작 규칙:

- 현재값의 호환 투영만 담당한다. 업무 결정은 정확한 policy_versions와 기준일로 판정한다.
- 미래 시행값을 현재 학교값으로 먼저 덮지 않는다.
- 캐시/스케줄러 갱신 실패가 과거 정책 적용 또는 권한 허용을 만들지 못한다.

인덱스: 기존 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (policy_key) → workhub.policy_catalog(policy_key)
- (school_id) → workhub.schools(id)
- (school_id,updated_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: FS10 정책 전환 경계와 stale projection

## workhub.school_timetable_types

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| type_code | text | 불가 | — |  | 원본 |
| support_state | text | 불가 | 'designed'::text |  | 원본 |
| evidence_ref | text | 허용 | — |  | 원본 |
| verified_by_account_id | text | 허용 | — |  | 원본 |
| verified_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (verified_by_account_id) → workhub.accounts(id)

## workhub.schools

계정·학교·권한 · 기존 보강

열람: 현재 자기 학교의 허용 메타. 가입 전에는 별도 최소 디렉터리 DTO. 플랫폼도 목적별 메타만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| code | text | 불가 | — |  | 원본 |
| neis_code | text | 허용 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| school_level | text | 불가 | — |  | 원본 |
| grade_count | smallint | 불가 | — |  | 원본 |
| region_code | text | 허용 | — |  | 원본 |
| timezone | text | 불가 | 'Asia/Seoul'::text |  | 원본 |
| status | text | 불가 | 'preparing'::text |  | 원본 |
| support_state | text | 불가 | 'designed'::text |  | 원본 |
| directory_listed | boolean | 불가 | false |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| permission_version | bigint | 불가 | 1 | 학교 상태·권한/공개 정책 변경의 무효화 판 | 통합 추가 |

통합 필수 제약:

- permission_version > 0
- 학교 ID/code의 기존 유일성 유지

통합 동작 규칙:

- 일반 업무는 status=active만 허용한다. preparing은 승인된 bootstrap/합성 시험 전용.
- 두 번째 실제 학교 활성화는 필수 legacy_access_gates 코드 집합의 존재+verified를 확인한다.
- 학교 상태 회수는 읽기·쓰기·worker·파일 gate와 같은 잠금으로 직렬화한다.

인덱스: 기존 code UNIQUE 재사용; (status,directory_listed,id) 가입 목록의 최소 조회

필수 시험: FS03 학교 바꿔치기 거부; MIG04 preparing/필수 legacy gate 누락 차단

## workhub.service_features

계정·학교·권한 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| feature | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| description | text | 불가 | — |  | 원본 |

## workhub.service_operators

계정·학교·권한 · 기존 보강

열람: 본인 운영자 등록 메타 또는 승인된 플랫폼 관리 경로. 일반 학교 관리권과 무관.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| account_id | text | 불가 | — |  | 원본 |
| level | text | 불가 | — |  | 원본 |
| granted_at | timestamp with time zone | 불가 | now() |  | 원본 |
| granted_note | text | 불가 | — |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |

통합 필수 제약:

- 기존 account_id PK/FK, level enum 유지

통합 동작 규칙:

- 운영자 등록 여부와 실제 플랫폼 행동 권한을 분리한다.
- level=operator/support 또는 is_operator()만으로 common 게시·지원·학교 본문 접근을 허용하지 않는다.
- 행동 허가는 현재 operator_grants로 판정하며 철회 시 회수원장에 기록한다.

인덱스: 기존 PK 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)

필수 시험: FS05 운영자 상시 개인자료 열람 거부; FS11 지원 grant 회수

## workhub.service_principal_scopes

계정·학교·권한 · 신규

열람: 서버·승인된 플랫폼 관리 경로만. 일반 사용자/학교 admin 직접 읽기·쓰기 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 서비스 범위 승인 ID · 생성 후 불변 | 통합 추가 |
| service_principal_id | text | 불가 | — | workhub.service_principals.id · 제한된 자동 실행 주체 · 생성 후 불변 | 통합 추가 |
| scope_type | text | 불가 | — | school/common/service 중 하나 · 생성 후 불변 | 통합 추가 |
| school_id | text | 허용 | — | workhub.schools.id · school scope면 필수 · 생성 후 불변 | 통합 추가 |
| scope_key | text | 불가 | GENERATED ALWAYS AS (CASE scope_type WHEN 'school' THEN 's:' \|\| school_id WHEN 'common' THEN 'c' ELSE 'svc' END) STORED | 승인된 실행 범위 생성키 · 생성 후 불변 | 통합 추가 |
| valid_from | timestamptz | 불가 | — | 시작 포함 | 통합 추가 |
| valid_to | timestamptz | 허용 | — | 종료 제외 | 통합 추가 |
| approved_by_account_id | text | 불가 | — | workhub.accounts.id · service.manage 권한의 승인자 · 생성 후 불변 | 통합 추가 |
| approval_ref | text | 불가 | — | 범위 부여 승인 근거 · 생성 후 불변 | 통합 추가 |
| approved_at | timestamptz | 불가 | — | 승인 시각 · 생성 후 불변 | 통합 추가 |
| revoked_at | timestamptz | 허용 | — | 현재 승인 회수 시각 | 통합 추가 |
| version | integer | 불가 | 1 | 낙관적 충돌 판 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(scope_key,id)
- scope_type IN ('school','common','service')
- (scope_type='school') = (school_id IS NOT NULL)
- valid_to IS NULL OR valid_from < valid_to
- 동일 principal/scope_key의 미회수 tstzrange [) 기간 중첩 금지

통합 동작 규칙:

- 학교 작업은 school scope, 공통 관리는 common, 글로벌 운영은 service로 한정한다.
- account_private 포괄 읽기 grant를 만들지 않는다.
- 순수개인 승인 파기는 service의 전용 deletion_process 명령에서 정확한 계정별 승인 manifest만 처리하는 예외다.
- scope 회수와 worker 결과 확정이 같은 gate 행 잠금에 충돌해야 한다.

인덱스: (service_principal_id,scope_key,valid_from,valid_to) WHERE revoked_at IS NULL

필수 시험: FS09 다른 학교/common/service scope 우회 거부; MIG06 개인 파기 manifest 밖 접근 거부

## workhub.service_principals

계정·학교·권한 · 기존 보강

열람: 서버 전용. 브라우저 DML/직접 SELECT/임의 principal 선택 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| allowed_actions | text[] | 불가 | — |  | 원본 |
| active | boolean | 불가 | true |  | 원본 |
| approval_ref | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| permission_version | bigint | 불가 | 1 | 서비스 자격·allowed_actions 회수 판 | 통합 추가 |
| approved_by_account_id | text | 불가 | — | workhub.accounts.id · 현재 service.manage 권한이 있는 승인자 | 통합 추가 |
| approved_at | timestamptz | 불가 | — | 서비스 주체 승인 시각 | 통합 추가 |

통합 필수 제약:

- 기존 id PK·active·allowed_actions 비어있지 않음·approval_ref 유지
- allowed_actions는 서버 job/action registry의 코드만 허용
- permission_version > 0

통합 동작 규칙:

- owner NULL을 허용 판정으로 사용하지 않는다.
- active AND action allowlist AND 현재 정확한 scope grant를 claim/재개/외부 호출/확정에서 검사한다.
- 실제 DB 실행 역할과 principal의 대응은 신뢰된 서버 allowlist로 고정한다. 공개 함수 인자/클라이언트 GUC/worker_id/승인자가 입력한 actor ID를 신원 근거로 사용하지 않는다.
- B01에서 검증된 실행 context와 write_audit(context)를 먼저 연결하고 bootstrap/migration 포함 기존 운영 함수의 NULL actor 감사 INSERT를 전환한다.
- 권한 축소는 같은 잠금 아래 permission_version·회수원장·outbox에 기록한다.

인덱스: 기존 PK 재사용

필수 시험: FS09 R11 inactive/action 밖 주체 차단; FS07 서비스 권한 회수 선행 경합

## workhub.service_switches

계정·학교·권한 · 기존 보강

열람: 현재 학교와 전역의 안전한 상태 설명. 변경은 승인된 운영 경로.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| feature | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| disabled | boolean | 불가 | — |  | 원본 |
| reason | text | 불가 | — |  | 원본 |
| set_by_account_id | text | 불가 | — |  | 원본 |
| set_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- 기존 전역 또는 학교별 feature UNIQUE 유지

통합 동작 규칙:

- 전역 또는 학교 중 어느 하나가 중지하면 해당 작업을 거부한다.
- 쓰기/AI/외부발송 중지는 새 명령과 작업 재개/외부전송 직전에도 검사한다.
- 예외는 최소 가입/읽기진단/접수상태확인 등 등록된 읽기 경로만 허용한다.
- 스위치 변경은 실행 gate 잠금과 직렬화하고 감사·권한판을 갱신한다.

인덱스: 기존 feature/school 조건부 조회 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (feature) → workhub.service_features(feature)
- (school_id) → workhub.schools(id)
- (set_by_account_id) → workhub.accounts(id)

필수 시험: MIG07 격리 복원 환경 외부 전송0; FS07 스위치 회수 선행 경합

## workhub.source_actions

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 불가 | — |  | 원본 |
| action | text | 불가 | — |  | 원본 |
| reason | text | 허용 | — |  | 원본 |
| impact_count | integer | 불가 | 0 |  | 원본 |
| deletion_ledger_id | text | 허용 | — |  | 원본 |
| at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,deletion_ledger_id) → workhub.deletion_ledger(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.source_connection_mappings

일정·시트 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| connection_id | text | 불가 | — |  | 원본 |
| mapping_version | integer | 불가 | — |  | 원본 |
| column_mapping | jsonb | 불가 | — |  | 원본 |
| created_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,connection_id) → workhub.source_connections(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)

## workhub.source_connections

일정·시트 · 기존 보강

열람: 현재 연결 관리자; 비밀 API 키는 이 표에 저장하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| source_kind | text | 불가 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| display_name | text | 불가 | — |  | 원본 |
| external_ref | text | 허용 | — |  | 원본 |
| stable_id_column | text | 허용 | — |  | 원본 |
| stable_id_approved_by_membership_id | text | 허용 | — |  | 원본 |
| stable_id_approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| mapping_version | integer | 불가 | 1 |  | 원본 |
| authority_state | text | 불가 | 'source_authoritative'::text |  | 원본 |
| cutover_at | timestamp with time zone | 허용 | — |  | 원본 |
| cutover_by_membership_id | text | 허용 | — |  | 원본 |
| cutover_import_run_id | text | 허용 | — |  | 원본 |
| owner_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- cutover_import_run_id는 같은 school/connection의 import_runs를 참조; 학교 FK만으로 대체 금지

통합 동작 규칙:

- site_authoritative 전환과 연결 판 증가·receipt·audit를 원자 처리.
- 구시트 미리보기 재사용 거부; 역전환도 새 비교/승인 사건으로 보존.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,cutover_import_run_id) → workhub.import_runs(school_id,id)
- (school_id,id,mapping_version) → workhub.source_connection_mappings(school_id,connection_id,mapping_version)
- (school_id,cutover_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,owner_membership_id) → workhub.memberships(school_id,id)
- (school_id,stable_id_approved_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: WF12

## workhub.source_item_revisions

수업 앱 연결 · 기존 보강

열람: 부모 source_item의 owner 전용; 수신 receipt에 원문 복사 금지

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| source_item_id | text | 불가 | — |  | 원본 |
| local_revision | integer | 불가 | — |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| classroom_import_id | text | 허용 | — |  | 원본 |
| raw_text | text | 허용 | — |  | 원본 |
| parsed | jsonb | 허용 | — |  | 원본 |
| row_position | integer | 허용 | — |  | 원본 |
| content_sha256 | text | 불가 | — |  | 원본 |
| change_kind | text | 불가 | — |  | 원본 |
| change_reason | text | 허용 | — |  | 원본 |
| link_confirmed_by_account_id | text | 허용 | — |  | 원본 |
| link_confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| deletion_override_ref | text | 허용 | — |  | 원본 |
| created_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

통합 필수 제약:

- UNIQUE(school_id,created_by_account_id,source_item_id,local_revision)
- FK(school_id,created_by_account_id,source_item_id) REFERENCES workhub.source_items(school_id,owner_account_id,id)

통합 동작 규칙:

- 정확한 원문판·활동 논리키를 포함한 hash와 삭제 원장 대조
- 누락 CSV행을 철회로 추정하지 않음; 정정은 교사 연결확인
- 원본문 삭제 후 최소 tombstone을 남기고 재수신 자동 재생성 금지

인덱스: (school_id,source_item_id,local_revision DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (created_by_account_id) → workhub.accounts(id)
- (link_confirmed_by_account_id) → workhub.accounts(id)
- (school_id,classroom_import_id) → workhub.classroom_imports(school_id,id)
- (school_id,source_item_id) → workhub.source_items(school_id,id)

필수 시험: SI07: CSV 줄바꿈/BOM/빈답/수식문자 보존; SI08: 삭제된 논리항목 재전송 차단

## workhub.source_items

수업 앱 연결 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| activity_instance_id | text | 불가 | — |  | 원본 |
| participant_key | text | 불가 | — |  | 원본 |
| item_kind | text | 불가 | — |  | 원본 |
| question_key | text | 불가 | — |  | 원본 |
| current_local_revision | integer | 불가 | 1 |  | 원본 |
| state | text | 불가 | 'active'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,owner_account_id,activity_instance_id) → workhub.activity_instances(school_id,owner_account_id,id)
- (owner_account_id) → workhub.accounts(id)

## workhub.source_record_snapshots

일정·시트 · 신규

열람: source 연결 담당과 import 담당만; raw 학생정보가 있는 다른 도메인 권한을 자동 합치지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 행 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 경계 | 통합 추가 |
| source_record_id | text | 불가 | — | workhub.source_records.id · 안정 원본행 | 통합 추가 |
| connection_id | text | 불가 | — | workhub.source_connections.id · 같은 연결 | 통합 추가 |
| mapping_version | integer | 불가 | — | 정규화에 사용한 불변 매핑판 | 통합 추가 |
| source_revision | text | 허용 | — | 외부 수정판 표시 | 통합 추가 |
| normalized | jsonb | 불가 | — | 정규화 원본 snapshot; ACL 근거가 아님 · 생성 후 불변 | 통합 추가 |
| source_sha256 | text | 불가 | — | canonical 정규화 지문 · 생성 후 불변 | 통합 추가 |
| captured_at | timestamptz | 불가 | clock_timestamp() | 서버 포착 시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- (school_id,source_record_id,connection_id)는 source_records의 같은 학교/연결 부모
- (school_id,connection_id,mapping_version) FK source_connection_mappings
- UNIQUE(school_id,source_record_id,id)
- normalized는 object; sha256은 64자리 hex; mapping_version>0

통합 동작 규칙:

- INSERT 후 불변. 운영 파기는 ledger 전용이며 미리보기/반영 근거가 참조하는 동안 RESTRICT.

인덱스: (school_id,source_record_id,captured_at DESC,id)

필수 시험: WF12

## workhub.source_records

일정·시트 · 기존 보강

열람: 연결 관리/가져오기 권한 범위; 대상 열람권한은 별도.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| connection_id | text | 불가 | — |  | 원본 |
| external_key | text | 불가 | — |  | 원본 |
| key_kind | text | 불가 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 허용 | — |  | 원본 |
| last_source_sha256 | text | 허용 | — |  | 원본 |
| last_source_snapshot | jsonb | 허용 | — |  | 원본 |
| last_source_revision | text | 허용 | — |  | 원본 |
| last_target_version | integer | 허용 | — |  | 원본 |
| last_target_revision_no | integer | 허용 | — |  | 원본 |
| last_target_sha256 | text | 허용 | — |  | 원본 |
| last_import_run_id | text | 허용 | — |  | 원본 |
| authority_state | text | 불가 | 'source_authoritative'::text |  | 원본 |
| state | text | 불가 | 'linked'::text |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| last_source_snapshot_id | text | 허용 | — | workhub.source_record_snapshots.id · 직전 반영 원본 불변판 | 통합 추가 |
| target_event_id | text | 허용 | — | workhub.events.id · target_type=events의 정확한 학교 대상 | 통합 추가 |

통합 필수 제약:

- UNIQUE(school_id,id,connection_id)
- last_source_snapshot_id는 동일 source_record 복합 FK
- target_type=events이면 target_event_id와 target_id 일치
- baseline 원본판과 마지막 대상 revision/version/hash는 함께 존재 또는 함께 NULL
- 이벤트 target revision은 같은 target_event_id의 event_revisions 복합 FK

통합 동작 규칙:

- last_source_snapshot/hash는 불변 snapshot의 호환 projection이며 별도 writer 금지.
- 원본행+event 결과+baseline+receipt는 같은 행 적용 transaction.
- missing_in_source는 삭제가 아니다.

인덱스: (school_id,target_event_id) WHERE target_event_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,last_import_run_id) → workhub.import_runs(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,connection_id,target_type) → workhub.source_connections(school_id,id,target_type)

필수 시험: WF12

## workhub.space_reservations

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| space_id | text | 불가 | — |  | 원본 |
| starts_at | timestamp with time zone | 불가 | — |  | 원본 |
| ends_at | timestamp with time zone | 불가 | — |  | 원본 |
| purpose_category | text | 불가 | — |  | 원본 |
| purpose_note | text | 허용 | — |  | 원본 |
| reserved_by_membership_id | text | 불가 | — |  | 원본 |
| event_id | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'confirmed'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,event_id) → workhub.events(school_id,id)
- (school_id,reserved_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,space_id) → workhub.spaces(school_id,id)

## workhub.spaces

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| kind | text | 불가 | 'classroom'::text |  | 원본 |
| capacity | smallint | 허용 | — |  | 원본 |
| equipment | text[] | 불가 | '{}'::text[] |  | 원본 |
| reservable | boolean | 불가 | false |  | 원본 |
| active | boolean | 불가 | true |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

## workhub.student_enrollments

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| student_id | text | 불가 | — |  | 원본 |
| academic_class_id | text | 불가 | — |  | 원본 |
| number | smallint | 허용 | — |  | 원본 |
| valid_from | date | 불가 | — |  | 원본 |
| valid_to | date | 허용 | — |  | 원본 |
| source | text | 불가 | 'import'::text |  | 원본 |
| source_ref | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_class_id) → workhub.academic_classes(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,student_id) → workhub.students(school_id,id)

## workhub.student_evidence_gates

학생·평가·생기부 · 신규

열람: 브라우저 직접 조회/쓰기 금지; 전용 명령만 사용

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — | workhub.schools.id · 개인 근거가 속한 학교 · 생성 후 불변 | 통합 추가 |
| owner_account_id | text | 불가 | — | workhub.accounts.id · 개인 기록 작성 계정 · 생성 후 불변 | 통합 추가 |
| epoch | bigint | 불가 | 0 | 원본·연결·접근 차단 변경마다 단조 증가하는 판 | 통합 추가 |
| updated_at | timestamptz | 불가 | now() | 마지막 gate 변경 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(school_id,owner_account_id)
- CHECK(epoch>=0); epoch 감소 금지

통합 동작 규칙:

- R04~R06: 원자료·mapping·관찰·평가 변경과 AI/생기부 확정·출력은 같은 owner gate FOR UPDATE 사용
- 권한/정책/멱등 잠금 뒤, 원본행·파일 잠금 전에 획득
- 외부 네트워크 호출 동안 gate를 유지하지 않음

필수 시험: SI06: 두 독립 연결 정정/출력의 양쪽 선행 순서를 barrier로 검사; AI04: 생성 중 epoch 변경 시 자동 검토완료 금지

## workhub.students

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| school_student_code | text | 허용 | — |  | 원본 |
| status | text | 불가 | 'enrolled'::text |  | 원본 |
| status_changed_on | date | 허용 | — |  | 원본 |
| created_from_import_run_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,created_from_import_run_id) → workhub.import_runs(school_id,id)
- (school_id) → workhub.schools(id)

## workhub.subjects

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| name | text | 불가 | — |  | 원본 |
| short_name | text | 허용 | — |  | 원본 |
| curriculum_code | text | 허용 | — |  | 원본 |
| subject_group | text | 허용 | — |  | 원본 |
| aliases | text[] | 불가 | '{}'::text[] |  | 원본 |
| active | boolean | 불가 | true |  | 원본 |
| sort_order | smallint | 불가 | 0 |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)

## workhub.submission_files

수합 · 기존 보강

열람: 정확한 제출판 현재 권한; raw file ID 직접 다운로드 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| submission_id | text | 불가 | — |  | 원본 |
| field_key | text | 불가 | — |  | 원본 |
| file_object_id | text | 불가 | — |  | 원본 |
| sha256 | text | 불가 | — |  | 원본 |
| size_bytes | bigint | 불가 | — |  | 원본 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 해당 제출의 문항판 | 통합 추가 |
| field_id | text | 불가 | — | workhub.collection_fields.id · 정확한 file 문항 | 통합 추가 |
| safety_policy_scope_key | text | 불가 | — | workhub.policy_versions.scope_key · 사용 승인 정책 scope | 통합 추가 |
| safety_policy_version_id | text | 불가 | — | workhub.policy_versions.id · 접수에 적용한 안전 정책 | 통합 추가 |
| common_safety_policy_scope_key | text | 불가 | — | workhub.policy_versions.scope_key · 적용한 공통 안전 하한 정책 scope, 항상 c | 통합 추가 |
| common_safety_policy_version_id | text | 불가 | — | workhub.policy_versions.id · 적용한 정확한 공통 안전 하한 정책판 | 통합 추가 |

통합 필수 제약:

- submission/schema/field 모두 동일 collection schema 복합 FK
- field_key=해당 field.key 및 kind=file
- 파일은 같은 학교 ready·hash/size 일치·정책 허용
- policy(scope_key,id) 복합 FK, file 목적별 허용 scope
- INSERT 시 submission.receipt_xid=pg_current_xact_id(); UPDATE/DELETE 금지
- (common_safety_policy_scope_key,common_safety_policy_version_id) MATCH FULL FK policy_versions(scope_key,id); scope_key=c

통합 동작 규칙:

- 현재 파일 읽기+목적 제출 권한+공개범위 상승 검사.
- 시각 now 동등성을 같은 transaction의 증거로 사용하지 않는다.
- 필수 파일 수/크기/형식 확인 뒤 접수 성공; 첨부 실패는 전체 rollback.
- 학교 파일은 공통하한+학교판을 모두 고정하고 현재 유효 두 정책과 당시 두 판의 허용 교집합만 사용. common/account_private는 동일 common판을 두 쌍에 기록. 한 정책의 차단도 옛 허용판으로 우회 금지.

인덱스: (school_id,schema_id,field_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,submission_id) → workhub.submission_versions(school_id,id)

필수 시험: WF03; WF05; WF09; WF10; WF11

## workhub.submission_reviews

수합 · 기존 보강

열람: 현재 당사자만; 완료 결과 공개자가 검토 의견까지 읽지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| submission_id | text | 불가 | — |  | 원본 |
| reviewer_membership_id | text | 불가 | — |  | 원본 |
| decision | text | 불가 | — |  | 원본 |
| comment | text | 허용 | — |  | 원본 |
| decided_at | timestamp with time zone | 불가 | now() |  | 원본 |
| reviewer_account_id | text | 불가 | — | workhub.accounts.id · 소속이 바뀌어도 자기검토 계정 비교 | 통합 추가 |

통합 필수 제약:

- reviewer.account=reviewer_membership.account
- 현재 지정 reviewer·submitted/pending 판·판당1회
- forbid이면 제출자/당시책임자/현재책임자 계정 모두와 불일치
- allow_with_note에는 승인 schema 정책+trim(comment) 비어있지 않음

통합 동작 규칙:

- unit 잠금 후 현재 권한과 account snapshot 비교.
- review INSERT와 submission 상태·effective pointer·receipt/outbox 원자.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,reviewer_membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id,submission_id) → workhub.submission_versions(school_id,unit_id,id)

필수 시험: WF02; WF08

## workhub.submission_versions

수합 · 기존 보강

열람: 현재 단위/검토/요청관리 권한; 결과 공개자는 effective만. 초안과 별도.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| version_no | integer | 불가 | — |  | 원본 |
| schema_version | integer | 불가 | — |  | 원본 |
| submitted_by_membership_id | text | 불가 | — |  | 원본 |
| answers | jsonb | 불가 | — |  | 원본 |
| receipt_at | timestamp with time zone | 불가 | now() |  | 원본 |
| due_snapshot | timestamp with time zone | 불가 | — |  | 원본 |
| due_change_revision | integer | 불가 | — |  | 원본 |
| is_late | boolean | 불가 | — |  | 원본 |
| correction_of_id | text | 허용 | — |  | 원본 |
| correction_reason | text | 허용 | — |  | 원본 |
| correction_request_id | text | 허용 | — |  | 원본 |
| request_id | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'submitted'::text |  | 원본 |
| withdrawn_at | timestamp with time zone | 허용 | — |  | 원본 |
| withdrawn_by_membership_id | text | 허용 | — |  | 원본 |
| withdraw_reason | text | 허용 | — |  | 원본 |
| review_state | text | 불가 | — |  | 원본 |
| external_state | text | 불가 | 'unknown'::text |  | 원본 |
| external_state_at | timestamp with time zone | 허용 | — |  | 원본 |
| external_state_by_membership_id | text | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| collection_id | text | 불가 | — | workhub.collections.id · 같은 unit의 요청 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 불변 정의판 | 통합 추가 |
| source_draft_id | text | 불가 | — | workhub.unit_drafts.id · 제출한 정확한 공유초안 | 통합 추가 |
| source_draft_version | integer | 불가 | — | 확인한 초안판 | 통합 추가 |
| submitted_by_account_id | text | 불가 | — | workhub.accounts.id · 실제 actor의 지속 계정 | 통합 추가 |
| responsible_membership_id_snapshot | text | 불가 | — | workhub.memberships.id · 당시 책임 관계 | 통합 추가 |
| responsible_account_id_snapshot | text | 불가 | — | workhub.accounts.id · 당시 책임 계정 | 통합 추가 |
| review_mode_snapshot | text | 불가 | — | none/required 불변 | 통합 추가 |
| due_kind_snapshot | text | 불가 | — | date/time | 통합 추가 |
| receipt_xid | xid8 | 불가 | pg_current_xact_id() | 현재 transaction만 첨부 허용 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- (school_id,unit_id,collection_id) FK collection_units
- (school_id,collection_id,schema_id,schema_version) FK collection_schemas
- (school_id,source_draft_id,unit_id,schema_id) FK unit_drafts
- UNIQUE(school_id,unit_id,id,schema_id)
- 계정=각 membership.account_id; source_draft shared이고 제출 actor 책임자/유효 delegate
- receipt_at 서버 clock_timestamp; date 마감 >=, time > 지연 검사
- withdrawn이면 review_state<>accepted AND external_state<>user_confirmed; exported만으로 공식처리 판정 금지

통합 동작 규칙:

- 본문·정의판·실제제출자·당시책임자·마감/모드 snapshot·receipt_xid 불변.
- JSON 답변 submit 검사 필수, 알 수 없는 key·형식·필수 누락 거부.
- new판 external_state unknown, none not_required/required pending. 정정은 이전판+공백 아닌 사유.

인덱스: (school_id,unit_id,version_no DESC); (school_id,collection_id,receipt_at,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,external_state_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,submitted_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id,correction_of_id) → workhub.submission_versions(school_id,unit_id,id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)
- (school_id,withdrawn_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id,correction_request_id) → workhub.correction_requests(school_id,unit_id,id)

필수 시험: WF02; WF03; WF06; WF08; WF09; WF15

## workhub.support_sessions

계정·학교·권한 · 기존 보강

열람: 요청자·지정 지원자·학교 승인자의 최소 세션 메타. 대상 원문은 매회 현재 권한 교집합을 통과하는 별도 RPC.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| requester_confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| operator_account_id | text | 불가 | — |  | 원본 |
| feedback_id | text | 허용 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 허용 | — |  | 원본 |
| correlation_id | text | 허용 | — |  | 원본 |
| purpose | text | 불가 | — |  | 원본 |
| allowed_actions | text[] | 불가 | — |  | 원본 |
| starts_at | timestamp with time zone | 불가 | — |  | 원본 |
| expires_at | timestamp with time zone | 불가 | — |  | 원본 |
| state | text | 불가 | 'requested'::text |  | 원본 |
| approved_by_membership_id | text | 허용 | — |  | 원본 |
| approved_at | timestamp with time zone | 허용 | — |  | 원본 |
| rejected_by_membership_id | text | 허용 | — |  | 원본 |
| rejected_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoked_by_account_id | text | 허용 | — |  | 원본 |
| revoked_at | timestamp with time zone | 허용 | — |  | 원본 |
| revoke_reason | text | 허용 | — |  | 원본 |
| closed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| target_version | integer | 허용 | — | 내용 지원이면 확인한 정확한 원본판. error_only이면 NULL | 통합 추가 |
| scope_sha256 | text | 허용 | — | 대상/판/목적/행동/기한/요청자 지문. 요청자 확인 후 필수·불변 | 통합 추가 |

통합 필수 제약:

- requester_confirmed_at 존재 시 scope_sha256 NOT NULL 및 64hex
- view_content면 target_version NOT NULL 및 양수
- 기존 동일 학교 요청자·승인자 FK, 승인/확인/기한 상태 CHECK 유지

통합 동작 규칙:

- 현재 요청자 원본권한 AND 지원자 support.execute grant AND 승인세션 범위만 허용한다.
- 작성자 전용 학생/상담/대화/미제출 초안은 지원 대상 등록 자체를 거부한다.
- 초기는 view_meta만. 내용/재시도는 유형별 구현·시험을 배포한 뒤 공개한다.
- 확인 후 대상·판·행동·기한 변경은 새 세션과 재확인을 요구한다.
- 지원 actor는 실제 운영자이고 요청자 member를 가장하지 않는다.

인덱스: 기존 (school_id,state,expires_at), (operator_account_id,state,expires_at) 재사용

기존 FK 관계(변경 계약과 충돌하면 대체):

- (operator_account_id) → workhub.service_operators(account_id)
- (revoked_by_account_id) → workhub.accounts(id)
- (school_id,approved_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,feedback_id) → workhub.feedback(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,rejected_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: FS11 원본 private/전출/grant회수/만료 뒤 지원 차단; FS05 민감자료 대상 등록 거부

## workhub.tasks

업무·인계 · 기존 보강

열람: 본인 현재 허용 scope만. 배정자는 assigned_task_status의 안전 상태 DTO만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| owner_account_id | text | 불가 | — |  | 원본 |
| title | text | 불가 | — |  | 원본 |
| note | text | 허용 | — |  | 원본 |
| status | text | 불가 | 'todo'::text |  | 원본 |
| due_on | date | 허용 | — |  | 원본 |
| due_at | timestamp with time zone | 허용 | — |  | 원본 |
| source_type | text | 불가 | 'direct'::text |  | 원본 |
| source_id | text | 허용 | — |  | 원본 |
| source_role | text | 허용 | — |  | 원본 |
| completion_rule | text | 불가 | 'manual'::text |  | 원본 |
| completed_by_ref | text | 허용 | — |  | 원본 |
| assigned_by_membership_id | text | 허용 | — |  | 원본 |
| assignment_batch_id | text | 허용 | — |  | 원본 |
| academic_year_id | text | 허용 | — |  | 원본 |
| pinned | boolean | 불가 | false |  | 원본 |
| sort_key | integer | 불가 | 0 |  | 원본 |
| done_at | timestamp with time zone | 허용 | — |  | 원본 |
| cancelled_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

통합 필수 제약:

- owner_account_id는 모든 scope에서 생성 뒤 불변
- source_type별 source_id의 실제 학교 부모/owner 관계를 DB resolver로 검사
- source_event 완료는 해당 source의 실제 완료 사건 completed_by_ref를 검증

통합 동작 규칙:

- 직접/AI task만 본인 수동 완료. 수합/보완/확인/인계 의무는 원본 조회 projection.
- 일정 책임 이전은 old 카드 종료+new 소유자 카드 생성; private note/state 이전 금지.
- scope+원본+owner 중복 방지 유지; 필요 시 기존 owner 카드를 재사용하되 해당 본인만 메모를 읽는다.
- UI 기존 title120/notes2000과 DB200/5000의 차이는 API 버전별 명시 제한, 조용한 확대 금지.

인덱스: (owner_account_id,school_id,status,due_on,id) WHERE status IN ('todo','doing','waiting')

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,academic_year_id) → workhub.academic_years(school_id,id)
- (school_id,assigned_by_membership_id) → workhub.memberships(school_id,id)
- (school_id) → workhub.schools(id)

필수 시험: WF14; WF18; WF19

## workhub.teacher_unavailability

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| slot | tstzrange | 불가 | — |  | 원본 |
| reason_category | text | 불가 | — |  | 원본 |
| reason_note | text | 허용 | — |  | 원본 |
| state | text | 불가 | 'tentative'::text |  | 원본 |
| source_event_id | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,source_event_id) → workhub.events(school_id,id)

## workhub.term_day_templates

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| weekday | smallint | 불가 | — |  | 원본 |
| grade | smallint | 불가 | 0 |  | 원본 |
| bell_schedule_id | text | 불가 | — |  | 원본 |
| lesson_periods | smallint | 불가 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,bell_schedule_id) → workhub.bell_schedules(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

## workhub.terms

학생·평가·생기부 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| academic_year_id | text | 불가 | — |  | 원본 |
| term_no | smallint | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| starts_on | date | 불가 | — |  | 원본 |
| ends_on | date | 불가 | — |  | 원본 |
| state | text | 불가 | 'planning'::text |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id) → workhub.academic_years(school_id,id)

## workhub.timetable_candidates

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| composition_id | text | 허용 | — |  | 원본 |
| derived_from_id | text | 허용 | — |  | 원본 |
| rank | smallint | 허용 | — |  | 원본 |
| placements | jsonb | 불가 | — |  | 원본 |
| placements_sha256 | text | 불가 | — |  | 원본 |
| hard_ok | boolean | 허용 | — |  | 원본 |
| score | numeric | 허용 | — |  | 원본 |
| score_breakdown | jsonb | 허용 | — |  | 원본 |
| change_count | integer | 허용 | — |  | 원본 |
| validated_sha256 | text | 허용 | — |  | 원본 |
| validated_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_by_membership_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,composition_id) → workhub.timetable_compositions(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,derived_from_id) → workhub.timetable_candidates(school_id,id)

## workhub.timetable_change_items

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| change_set_id | text | 불가 | — |  | 원본 |
| seq | smallint | 불가 | — |  | 원본 |
| action | text | 불가 | — |  | 원본 |
| lesson_instance_id | text | 허용 | — |  | 원본 |
| lesson_instance_version | integer | 허용 | — |  | 원본 |
| target_date | date | 허용 | — |  | 원본 |
| target_starts_at | timestamp with time zone | 허용 | — |  | 원본 |
| target_ends_at | timestamp with time zone | 허용 | — |  | 원본 |
| target_period_no | smallint | 허용 | — |  | 원본 |
| before_state | jsonb | 허용 | — |  | 원본 |
| after_state | jsonb | 불가 | — |  | 원본 |
| result_lesson_instance_id | text | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,result_lesson_instance_id) → workhub.lesson_instances(school_id,id)

## workhub.timetable_change_participants

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| change_set_id | text | 불가 | — |  | 원본 |
| membership_id | text | 불가 | — |  | 원본 |
| role | text | 불가 | — |  | 원본 |
| response | text | 불가 | 'pending'::text |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| bound_candidate_sha256 | text | 불가 | — |  | 원본 |
| bound_base_snapshot_sha256 | text | 불가 | — |  | 원본 |
| responded_at | timestamp with time zone | 허용 | — |  | 원본 |
| note | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id,requested_by_membership_id) → workhub.timetable_change_sets(school_id,id,requested_by_membership_id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

## workhub.timetable_change_sets

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| reason_category | text | 불가 | — |  | 원본 |
| reason_note | text | 허용 | — |  | 원본 |
| urgent | boolean | 불가 | false |  | 원본 |
| base_timetable_version_id | text | 불가 | — |  | 원본 |
| base_snapshot_sha256 | text | 불가 | — |  | 원본 |
| candidate_sha256 | text | 불가 | — |  | 원본 |
| reverts_change_set_id | text | 허용 | — |  | 원본 |
| applied_at | timestamp with time zone | 허용 | — |  | 원본 |
| applied_by_membership_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,applied_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,base_timetable_version_id) → workhub.timetable_versions(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,reverts_change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

## workhub.timetable_compositions

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| constraint_set_id | text | 불가 | — |  | 원본 |
| base_version_id | text | 허용 | — |  | 원본 |
| input_file_id | text | 허용 | — |  | 원본 |
| input_sha256 | text | 불가 | — |  | 원본 |
| solver_version | text | 불가 | — |  | 원본 |
| time_limit_ms | integer | 불가 | — |  | 원본 |
| seed | bigint | 허용 | — |  | 원본 |
| status | text | 불가 | 'queued'::text |  | 원본 |
| optimality | text | 불가 | 'unknown'::text |  | 원본 |
| limit_reached | boolean | 허용 | — |  | 원본 |
| diagnostics | jsonb | 허용 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,constraint_set_id) → workhub.constraint_sets(school_id,id)
- (school_id,input_file_id) → workhub.file_objects(school_id,id)
- (school_id,job_id) → workhub.jobs(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)
- (school_id,base_version_id) → workhub.timetable_versions(school_id,id)

## workhub.timetable_constraints

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| constraint_set_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| strength | text | 불가 | — |  | 원본 |
| weight | integer | 허용 | — |  | 원본 |
| target_type | text | 불가 | — |  | 원본 |
| target_id | text | 허용 | — |  | 원본 |
| params | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| applies_from | date | 허용 | — |  | 원본 |
| applies_to | date | 허용 | — |  | 원본 |
| rationale | text | 허용 | — |  | 원본 |
| source_type | text | 불가 | 'manual'::text |  | 원본 |
| source_ref | text | 허용 | — |  | 원본 |
| confirmed_by_membership_id | text | 허용 | — |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| engine_support | text | 불가 | 'supported'::text |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,constraint_set_id) → workhub.constraint_sets(school_id,id)

## workhub.timetable_placements

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| timetable_version_id | text | 불가 | — |  | 원본 |
| course_group_id | text | 불가 | — |  | 원본 |
| weekday | smallint | 불가 | — |  | 원본 |
| period_no | smallint | 불가 | — |  | 원본 |
| space_id | text | 허용 | — |  | 원본 |
| locked | boolean | 불가 | false |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,space_id) → workhub.spaces(school_id,id)
- (school_id,timetable_version_id) → workhub.timetable_versions(school_id,id)

## workhub.timetable_version_impacts

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| timetable_version_id | text | 불가 | — |  | 원본 |
| change_set_id | text | 허용 | — |  | 원본 |
| lesson_instance_id | text | 허용 | — |  | 원본 |
| classification | text | 불가 | — |  | 원본 |
| resolved_at | timestamp with time zone | 허용 | — |  | 원본 |
| resolved_by_membership_id | text | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,resolved_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,timetable_version_id) → workhub.timetable_versions(school_id,id)

## workhub.timetable_versions

시간표 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| version_no | integer | 불가 | — |  | 원본 |
| state | text | 불가 | 'draft'::text |  | 원본 |
| effective_from | date | 허용 | — |  | 원본 |
| effective_to | date | 허용 | — |  | 원본 |
| source_candidate_id | text | 허용 | — |  | 원본 |
| base_version_id | text | 허용 | — |  | 원본 |
| validation_sha256 | text | 허용 | — |  | 원본 |
| impact_summary | jsonb | 허용 | — |  | 원본 |
| published_by_membership_id | text | 허용 | — |  | 원본 |
| published_at | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,base_version_id) → workhub.timetable_versions(school_id,id)
- (school_id,published_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,source_candidate_id) → workhub.timetable_candidates(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

## workhub.tool_proposals

Claude·기억 · 기존 보강

열람: 실행자 본인+현재 원생성 접근; 다른 사람 확인 불가

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| run_id | text | 불가 | — |  | 원본 |
| school_id | text | 허용 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| actor_account_id | text | 불가 | — |  | 원본 |
| tool_name | text | 불가 | — |  | 원본 |
| level | smallint | 불가 | — |  | 원본 |
| payload | jsonb | 불가 | — |  | 원본 |
| payload_sha256 | text | 불가 | — |  | 원본 |
| object_versions | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| impact_summary | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| expires_at | timestamp with time zone | 불가 | — |  | 원본 |
| state | text | 불가 | 'proposed'::text |  | 원본 |
| confirmed_at | timestamp with time zone | 허용 | — |  | 원본 |
| executed_at | timestamp with time zone | 허용 | — |  | 원본 |
| result_ref | text | 허용 | — |  | 원본 |
| undo_until | timestamp with time zone | 허용 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| origin_membership_id | text | 허용 | — | workhub.memberships.id · 실행자 원생성 소속 · 생성 후 불변 | 통합 추가 |
| permission_version | bigint | 불가 | — | 확인 카드 발급 권한판 · 생성 후 불변 | 통합 추가 |
| affected_subjects_sha256 | text | 불가 | — | 실제 영향 대상 묶음의 서버 해시 · 생성 후 불변 | 통합 추가 |
| tool_registry_version | text | 불가 | — | 도구 수준/schema의 승인 고정판 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- origin 소속=run origin; actor=run owner
- payload/대상판/영향/registry/주체/기한은 생성 후 불변

통합 동작 규칙:

- 확인/실행 때 권한·영향·기대판·도구수준을 서버가 재계산
- 불명확 실행은 claimed/succeeded와 같은 단일 실행 유일성에 포함

기존 FK 관계(변경 계약과 충돌하면 대체):

- (actor_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,run_id,actor_account_id) → workhub.ai_runs(scope_key,id,owner_account_id)

필수 시험: AI05: 확인 이후 대상/권한/영향 바뀌면 쓰기0; 동시 제안 실행에서 실제 명령1

## workhub.tool_runs

Claude·기억 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| run_id | text | 불가 | — |  | 원본 |
| proposal_id | text | 허용 | — |  | 원본 |
| tool_name | text | 불가 | — |  | 원본 |
| level | smallint | 불가 | — |  | 원본 |
| input_sha256 | text | 불가 | — |  | 원본 |
| status | text | 불가 | — |  | 원본 |
| result_summary | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| started_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |

기존 FK 관계(변경 계약과 충돌하면 대체):

- (run_id) → workhub.ai_runs(id)
- (run_id,proposal_id) → workhub.tool_proposals(run_id,id)

## workhub.unit_drafts

수합 · 기존 보강

열람: personal은 작성자+현재 구성원; shared는 현재 구성원. 관리자/검토자에게 존재·건수·첨부명도 숨김.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| unit_id | text | 불가 | — |  | 원본 |
| draft_kind | text | 불가 | — |  | 원본 |
| owner_account_id | text | 허용 | — |  | 원본 |
| schema_version | integer | 불가 | — |  | 원본 |
| answers | jsonb | 불가 | '{}'::jsonb |  | 원본 |
| updated_by_account_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| collection_id | text | 불가 | — | workhub.collections.id · 단위와 같은 요청 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 정확 문항판 | 통합 추가 |

통합 필수 제약:

- (school_id,unit_id,collection_id) FK collection_units
- (school_id,collection_id,schema_id) FK collection_schemas
- UNIQUE(school_id,id,unit_id,schema_id)
- 공유 UNIQUE(unit_id,schema_id), 개인 UNIQUE(unit_id,schema_id,owner_account_id); 기존 schema 없는 unique 교체
- unit/collection/schema/scope/owner 불변; 저장 시 active_schema 일치

통합 동작 규칙:

- 답변 JSON object·허용 key/type/범위 검사, draft는 필수 누락 허용.
- 새 schema는 새 draft ID; 명시 변환·개인→공유 복사, 자동 합치기 없음.
- 현재 유효 구성원과 expected_version 재검사.

인덱스: (school_id,unit_id,schema_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)
- (updated_by_account_id) → workhub.accounts(id)

필수 시험: WF01; WF03; WF15

## workhub.usage_events

Claude·기억 · 기존 보강

열람: 본인 실행 안전요약, 학교담당자는 비용합계만; 학생별 사용내역 노출 금지

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | bigint | 불가 | — |  | 원본 |
| scope_key | text | 불가 | — |  | 원본 |
| account_id | text | 허용 | — |  | 원본 |
| run_id | text | 허용 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| charge_scope | text | 불가 | — |  | 원본 |
| charge_school_id | text | 허용 | — |  | 원본 |
| provider | text | 불가 | — |  | 원본 |
| model | text | 불가 | — |  | 원본 |
| input_tokens | bigint | 허용 | 0 | DEFAULT 제거: NULL미확인,0실제0 | 통합 변경 |
| output_tokens | bigint | 허용 | 0 | DEFAULT 제거: 공급자가 보고한 출력량 | 통합 변경 |
| cache_read_tokens | bigint | 허용 | 0 | DEFAULT 제거: 미확인과0분리 | 통합 변경 |
| cache_write_tokens | bigint | 허용 | 0 | DEFAULT 제거: 미확인과0분리 | 통합 변경 |
| status | text | 불가 | — |  | 원본 |
| retry_of_id | bigint | 허용 | — |  | 원본 |
| occurred_at | timestamp with time zone | 불가 | now() |  | 원본 |
| external_call_id | text | 허용 | — | workhub.job_external_calls.id · 비동기 외부 호출과 연결 · 생성 후 불변 | 통합 추가 |
| attempt_no | integer | 불가 | — | 공급자 호출 시도번호 · 생성 후 불변 | 통합 추가 |
| provider_request_id | text | 허용 | — | 실제 공급자 요청번호 | 통합 추가 |
| metering_state | text | 불가 | 'unknown' | unknown/estimated/reported | 통합 추가 |
| pricing_reference | text | 불가 | — | 승인단가·귀속 기준판 · 생성 후 불변 | 통합 추가 |
| currency | text | 허용 | — | 확인된 비용통화; 임의기본값 없음 | 통합 추가 |
| cost_amount | numeric | 허용 | — | 확인/추정 비용; 미확인 NULL | 통합 추가 |
| event_kind | text | 불가 | 'measurement' | measurement/adjustment · 생성 후 불변 | 통합 추가 |
| adjusts_usage_event_id | bigint | 허용 | — | workhub.usage_events.id · 명시적 비용정정 원측정 · 생성 후 불변 | 통합 추가 |
| measurement_key | text | 불가 | — | 공급자 보고/조정의 멱등키 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- UNIQUE(scope_key,measurement_key)
- 원측정/외부호출 scope 일치 trigger; adjustment만 adjusts_usage_event_id 필수
- 토큰은 NULL 또는>=0; unknown은 보고된 실제0으로 위장 금지

통합 동작 규칙:

- unknown/estimated→reported 단방향 보완; reported 수정은 명시적 adjustment
- 집계는 원측정+명시적조정 계약; 원문/prompt/키 금지

인덱스: (external_call_id); (charge_school_id,occurred_at)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (account_id) → workhub.accounts(id)
- (charge_school_id) → workhub.schools(id)
- (scope_key,job_id) → workhub.jobs(scope_key,id)
- (scope_key,retry_of_id) → workhub.usage_events(scope_key,id)
- (scope_key,run_id) → workhub.ai_runs(scope_key,id)

필수 시험: AI11: timeout NULL과reported0구분; 중복 보고 비용2배 방지
