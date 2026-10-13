# 통합 테이블과 열 사전

이 파일은 source-baseline.json의 실제 원본 열, 세 기본 변경 목록과 2026-10-13 확장 계약을 합쳐 생성했다. 실행 SQL이 아니다. 단일 열의 참조 표시는 탐색용이며 실제 FK는 학교·부모·작성자·판을 포함한 복합 제약을 따른다. 원본 CHECK/정책/트리거를 무검토로 그대로 적용하면 안 된다.

추출 당시 원본은 160표다. 통합 목표는 190표와 2649열이다. NULL=허용은 항상 그 상태에서 생략 가능하다는 뜻이 아니며 상태별 필수 조건이 추가된다. 생성식은 SQL 확정 때 검증한다.

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

열람: 기존 AI run 본인/origin 규칙 AND 현재 messenger message read. 학교 관리자·다른 대화 참가자는 이 AI run을 자동 열람하지 못한다.

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
| messenger_message_id | text | 허용 | — | workhub.messenger_messages.id · kind=messenger_message인 정확한 원본 메시지 · 생성 후 불변 | 통합 추가 |
| messenger_dispatch_id | text | 허용 | — | workhub.messenger_dispatches.id · 그 메시지가 참조하는 불변 본문판 · 생성 후 불변 | 통합 추가 |
| messenger_message_version | integer | 허용 | — | 선택 당시 상태판; 현재 live version FK로 묶지 않고 변경 시 무효화 · 생성 후 불변 | 통합 추가 |

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
- kind=messenger_message 추가. 이 kind일 때 위 세 열 필수, 기존 다른 kind의 typed 출처 열은 NULL; 기존 kind에서는 위 열 모두 NULL
- (school_id,messenger_message_id,messenger_dispatch_id) FK messenger_messages(school_id,id,dispatch_id)
- school scope만 허용. source_sha256은 실제 선택 메시지/첨부·원문 locator의 지문, AI run origin membership으로 현재 메시지 read 재검사
- 기존 typed source CHECK를 단순 OR로 완화하지 않고 새 분기만 추가; 기존 FK/불변제약 보존

통합 동작 규칙:

- 학생자료는 school 전용이고 상담kind 없음; record_draft purpose는 source_item 직접근거 불가
- 지식은 본교/common, 개인 실행은 common만
- 원본 ACL/철회/판/해시 매회 재검사; 무효행 재활성화 금지
- 같은 학교 재임용 새대화에서 과거 본인 학생 근거는 별도 접근정책 통과시만 허용
- 사용자가 명시 선택한 메시지/연속 범위 또는 해당 대화에서 허용한 요약만 AI에 제공. 학교 전체 메신저 자동 검색/지식색인 금지.
- 일반 대화검색은 AI 공급자 전송과 구분. AI source 선택 범위·출처·대상학교를 사용자에게 표시.
- 원본 회수·방 탈퇴·소속 종료·현재 참여범위 변경 시 AI 결과 출력/재사용 현재권한 검사 실패. 원본문/원문지문은 감사·outbox에 저장 금지.
- 메시지 속 명령은 자료다. 다른 교사가 써둔 명령으로 사용자 확인 없는 발송·학생자료 조회 불가.

인덱스: (run_id); 종류별 정확한 원본 ID/판 partial index; (scope_key,owner_account_id,state); UNIQUE(run_id,knowledge_revision_id,locator_sha256) WHERE kind='knowledge_revision'; UNIQUE(run_id,knowledge_chunk_id,locator_sha256) WHERE kind='knowledge_chunk'; UNIQUE(run_id,document_id,document_revision_no,locator_sha256) WHERE kind='document_revision'; UNIQUE(run_id,observation_id,observation_revision_no,locator_sha256) WHERE kind='observation_revision'; UNIQUE(run_id,assessment_id,assessment_revision_no,locator_sha256) WHERE kind='assessment_revision'; UNIQUE(run_id,source_item_id,source_local_revision,locator_sha256) WHERE kind='source_item_revision'; (school_id,messenger_message_id) WHERE messenger_message_id IS NOT NULL

필수 시험: AI01: 타인/타교/혼합revision 거부; AI02: 개인범위 학생근거 거부; AI04: 정정과 결과공개 경합; MSG12; MSG13

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

## workhub.collection_answer_snapshots

수합 · 신규

열람: 제출 전: 원초안의 현재 개인/공동 ACL. 제출 후: 명시 연결된 제출판 독자에게 그 snapshot만 허용. 관리자/검토자의 미제출 초안 우회 0건.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| collection_id | text | 불가 | — | workhub.collections.id · 요청 | 통합 추가 |
| unit_id | text | 불가 | — | workhub.collection_units.id · 제출 단위 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 게시 문항판 | 통합 추가 |
| draft_id | text | 불가 | — | workhub.unit_drafts.id · 출력 직전의 편집 원장 | 통합 추가 |
| draft_version | integer | 불가 | — | 잠금 후 동결한 초안 버전 | 통합 추가 |
| answers | jsonb | 불가 | — | 활성 문항 답변 projection; 초안 전체 대화 아님 | 통합 추가 |
| provenance | jsonb | 불가 | — | 경로별 출처/제안/확인 구분 | 통합 추가 |
| excluded_paths | jsonb | 불가 | — | 조건상 제외한 경로 목록; 원문값 제외 | 통합 추가 |
| file_manifest | jsonb | 불가 | — | typed snapshot file_links의 표시 projection | 통합 추가 |
| manifest_sha256 | text | 불가 | — | 답변/조건/문항판/정확한 첨부/출처의 canonical 지문 | 통합 추가 |
| created_by_account_id | text | 불가 | — | workhub.accounts.id · 동결 요청자 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- UNIQUE(school_id,id,unit_id,schema_id); UNIQUE(school_id,unit_id,schema_id,id); UNIQUE(school_id,draft_id,draft_version,manifest_sha256)
- (school_id,collection_id) FK collections(school_id,id)
- (school_id,collection_id,unit_id) FK collection_units(school_id,collection_id,id)
- (school_id,collection_id,schema_id) FK collection_schemas(school_id,collection_id,id)
- (school_id,draft_id,unit_id,schema_id) FK unit_drafts(school_id,id,unit_id,schema_id)
- draft_version>0; answers/provenance는 object, excluded_paths/file_manifest는 제한 배열
- INSERT 시 현재 draft version 일치; 이후 draft 변경이 과거 snapshot 내용을 수정하지 않음

통합 동작 규칙:

- 기존 mutable unit_drafts와 장시간 출력 사이를 고정하는 불변 입력이다; 제출 이전에 동결한다.
- 파일 관계는 목적 고정 file_links에 같은 동결 transaction으로 생성, manifest와 전수 일치 후 불변. JSON file ID만으로 접근권한을 부여하지 않는다.
- 필드 provenance의 미확정 필수 값/지원하지 않는 타입·경로는 출력 불가. 숨은 항목은 출력·제출에 포함하지 않는다.

인덱스: (school_id,unit_id,schema_id,created_at DESC,id); (school_id,draft_id,draft_version)

필수 시험: COL04; COL05; COL06; COL07; COL08; COL09

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

열람: 기존 schema 안내 권한, 실제 답변 접근은 별도.

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
| parent_field_id | text | 허용 | — | workhub.collection_fields.id · 같은 schema의 repeat_group 부모 | 통합 추가 |
| activation_rule | jsonb | 허용 | — | 같은 schema field_key를 참조하는 허용 조건식 AST | 통합 추가 |
| repeat_min | integer | 허용 | — | 반복행 최소; repeat_group만 | 통합 추가 |
| repeat_max | integer | 허용 | — | 검증된 출력 지원/정책 범위 내 최대; repeat_group만 | 통합 추가 |
| field_role | text | 불가 | — | input 또는 generated_output, 기존값 input | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): collection_fields_kind_check

통합 필수 제약:

- (school_id,collection_id,schema_id,schema_version) FK collection_schemas의 일치하는 부모
- UNIQUE(school_id,schema_id,field_key)
- UNIQUE(school_id,schema_id,id)
- options는 key/label 객체 배열, key 유일·공백 불가
- 종류별 불필요 옵션/한도 NULL; 숫자 한도 유한; max_length/file_count 양수
- UNIQUE(school_id,schema_id,id); UNIQUE(school_id,schema_id,field_key)
- (school_id,schema_id,parent_field_id) FK collection_fields(school_id,schema_id,id); 부모 cycle/다른 schema/중첩 지원 초과 거부
- CHECK kind IN(boolean,single_choice,multi_choice,number,short_text,date,file,long_text,repeat_group); 기존 collection_fields_kind_check를 대체하며 arbitrary kind 금지
- repeat_min/max는 repeat_group만 양의 정수 또는 0을 정책에 맞게 허용, max>=min; 정책 미정이면 게시 차단
- field_role=generated_output이면 kind=file, parent_field_id NULL, activation_rule NULL, required=true, file_max_count=1, 사용자 질문에서 제외
- schema/field 지연 제약: guided schema는 generated_output 정확히 1개이며 해당 id=output_file_field_id. 반대로 generated_output 행은 그 schema가 guided이고 자신을 output_file_field_id로 참조해야 함
- file_upload schema는 generated_output 0개이며 output_file_field_id가 가리키는 필드는 field_role=input/kind=file/parent NULL/activation NULL/required=true/file_max_count=1. 기존 일반수합(response_mode NULL)에도 generated_output 0개
- 조건식 참조 존재·type 일치·순환없음, 임의 실행문 불허; posted definition 불변

통합 동작 규칙:

- published/retired 부모의 field INSERT/UPDATE/DELETE 전부 거부.
- 키·타입·옵션·필수값 검증은 validate_collection_answers에서 해당 schema만 사용.
- field_key는 의미 안정키, label 변경으로 재발급하지 않음. 의미/유형 변경은 새 key.
- 반복행 row_key 안정키와 answer_path가 첨부·출력 경로를 결정한다.
- 필수 검사는 활성 문항만; 0/false와 NULL 구별; 숨은 값은 초안 보존·출력 제외 안내.

인덱스: (school_id,schema_id,sort_order,id); (school_id,schema_id,parent_field_id,sort_order)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id) → workhub.collections(school_id,id)

필수 시험: WF03; WF15; COL05; COL06; COL07; COL08; COL16; COL21; COL22

## workhub.collection_output_artifacts

수합 · 신규

열람: 원 answer snapshot 현재 ACL. 제출 후 exact 제출 연결만 collector 열람 가능; jobs/documents/raw file 경로도 동일 부모 재검사.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| unit_id | text | 불가 | — | workhub.collection_units.id · 제출 단위 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 출력 문항판 | 통합 추가 |
| answer_snapshot_id | text | 불가 | — | workhub.collection_answer_snapshots.id · 고정 답변 | 통합 추가 |
| template_version_id | text | 불가 | — | workhub.collection_template_versions.id · 정확 양식판 | 통합 추가 |
| mapping_id | text | 허용 | — | workhub.collection_template_mappings.id · 문답형의 승인 매핑판 | 통합 추가 |
| kind | text | 불가 | — | uploaded 또는 generated | 통합 추가 |
| state | text | 불가 | — | queued/running/ready/failed/stale/cancelled | 통합 추가 |
| job_id | text | 허용 | — | workhub.jobs.id · 생성/파일 검사 작업 | 통합 추가 |
| document_id | text | 허용 | — | workhub.documents.id · 생성형 문서 | 통합 추가 |
| document_revision_no | integer | 허용 | — | 생성된 정확한 문서판 | 통합 추가 |
| validation_id | text | 허용 | — | workhub.document_validations.id · 생성형 검사 정확판 | 통합 추가 |
| file_object_id | text | 허용 | — | workhub.file_objects.id · 최종 실물 파일 | 통합 추가 |
| file_sha256 | text | 허용 | — | 검증 실물 지문 | 통합 추가 |
| manifest_sha256 | text | 허용 | — | 답변·양식·매핑·팩·렌더러·파일 결합 지문 | 통합 추가 |
| safe_error_code | text | 허용 | — | 원문 없는 실패 코드 | 통합 추가 |
| ready_at | timestamptz | 허용 | — | 파일/본문 검증 완료 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- UNIQUE(school_id,unit_id,schema_id,id); UNIQUE(school_id,id,answer_snapshot_id); UNIQUE(school_id,id,answer_snapshot_id,manifest_sha256)
- (school_id,unit_id,schema_id,answer_snapshot_id) FK collection_answer_snapshots(school_id,unit_id,schema_id,id)
- (school_id,template_version_id) FK collection_template_versions(school_id,id)
- (school_id,template_version_id,mapping_id) FK collection_template_mappings(school_id,template_version_id,id)
- (scope_key,job_id) FK jobs(scope_key,id)
- (scope_key,document_id,document_revision_no) FK document_revisions(scope_key,document_id,revision_no)
- (scope_key,document_id,document_revision_no,validation_id) FK document_validations(scope_key,document_id,revision_no,id)
- (school_id,file_object_id) FK file_objects(school_id,id)
- document/revision은 둘 다 NULL 또는 둘 다 존재; ready는 file/hash/manifest/ready_at 모두 NN
- generated ready는 mapping/document/revision/validation 모두 NN; uploaded는 mapping/document/revision/validation 모두 NULL
- 생성형 file ID/hash는 exact document_revisions.output과 일치; uploaded는 실제 검증 파일과 일치
- schema의 template/mapping과 일치, 다른 schema 매핑 혼합 금지
- (school_id,document_id,document_revision_no,unit_id,schema_id,answer_snapshot_id,template_version_id,mapping_id) FK document_revisions(school_id,document_id,revision_no,collection_unit_id,collection_schema_id,collection_answer_snapshot_id,collection_template_version_id,collection_mapping_id) MATCH SIMPLE. generated ready에서는 전 열 NN
- generated ready는 document_validations.state=pass, 필수검사 skipped=0, findings의 error=0, unresolved_fields의 활성 필수 미확정=0. 검사 checked_sha256=exact output file hash=document_revisions.output_sha256
- generated ready는 document_revisions의 팩 ID/범위/자산 hash와 mapping의 검증 팩 동일, renderer_contract_version과 검증 rule_set_ref가 승인된 registry 조합. material 입력 지문은 actual render job input_sha256와 같아야 함
- generated ready 선언과 confirm/submit 때 위 검사 및 현재 파일 안전정책 재검사. needs_review/error/not_checked 또는 필수검사 skip은 ready 불가

통합 동작 규칙:

- 내용 저장은 documents/revisions를 재사용하고 이 표는 사슬 결합과 출력 준비 상태만 담당한다.
- ready 후 파일/판/해시/입력은 불변. 답변/파일 교체/팩검증 변경은 새 artifact, 기존 사용은 stale.
- ready는 제출 아님. 출력 완료 전 초안/권한 변경은 현재 제출에 연결하지 않는다.

인덱스: (school_id,unit_id,schema_id,created_at DESC,id); (scope_key,job_id) WHERE job_id IS NOT NULL; (school_id,file_object_id) WHERE file_object_id IS NOT NULL

필수 시험: COL01; COL04; COL09; COL10; COL11; COL12; COL13; COL19; COL23; COL24

## workhub.collection_output_confirmations

수합 · 신규

열람: 확인 본인 및 현재 해당 초안/제출 권한자. 담당자에게 미제출 확인의 존재를 별도 노출하지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| unit_id | text | 불가 | — | workhub.collection_units.id · 단위 | 통합 추가 |
| schema_id | text | 불가 | — | workhub.collection_schemas.id · 문항판 | 통합 추가 |
| artifact_id | text | 불가 | — | workhub.collection_output_artifacts.id · 확인한 정확한 산출물 | 통합 추가 |
| answer_snapshot_id | text | 불가 | — | workhub.collection_answer_snapshots.id · 확인한 답변 snapshot | 통합 추가 |
| manifest_sha256 | text | 불가 | — | 서버의 exact artifact 지문과 일치 | 통합 추가 |
| draft_version | integer | 불가 | — | 확인 당시 current draft version | 통합 추가 |
| confirmed_by_membership_id | text | 불가 | — | workhub.memberships.id · 현재 책임자 또는 유효 대리 | 통합 추가 |
| confirmed_by_account_id | text | 불가 | — | workhub.accounts.id · 실제 현재 인증 계정 | 통합 추가 |
| confirmed_at | timestamptz | 불가 | — | 서버 확인 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- UNIQUE(school_id,unit_id,schema_id,artifact_id,id); UNIQUE(school_id,artifact_id,confirmed_by_account_id,manifest_sha256)
- (school_id,unit_id,schema_id,artifact_id) FK collection_output_artifacts(school_id,unit_id,schema_id,id)
- (school_id,artifact_id,answer_snapshot_id,manifest_sha256) FK collection_output_artifacts(school_id,id,answer_snapshot_id,manifest_sha256)
- (school_id,confirmed_by_membership_id,confirmed_by_account_id) FK memberships(school_id,id,account_id)
- draft_version>0; 확인은 ready exact artifact에 대해서만; artifact snapshot의 draft_version과 일치

통합 동작 규칙:

- 불변 확인 사실이며 확인 주체를 제출자로 바꾸지 못한다. 실제 submitter 계정/현재 책임·대리 권한 재검사.
- 같은 제출판에 연결할 때 draft/manifest/현재 schema가 달라졌으면 확인은 역사로만 남고 제출은 거부한다.

인덱스: (school_id,artifact_id,confirmed_at DESC)

필수 시험: COL04; COL09; COL10; COL11; COL12

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

열람: 기존 안내 읽기. mapping 세부·답변·초안 ACL을 상속해 넓히지 않음.

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
| response_mode | text | 허용 | — | 기존 일반수합 NULL, 신규 양식수합 file_upload 또는 guided | 통합 추가 |
| template_version_id | text | 허용 | — | workhub.collection_template_versions.id · 양식 수합의 정확한 빈 양식 | 통합 추가 |
| mapping_id | text | 허용 | — | workhub.collection_template_mappings.id · guided의 정확 승인 매핑 | 통합 추가 |
| output_file_field_id | text | 허용 | — | workhub.collection_fields.id · 최종 문서가 들어가는 같은 schema의 file 문항 | 통합 추가 |
| output_requirement | text | 허용 | — | original_required 또는 validated_output | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- UNIQUE(school_id,collection_id,schema_version)
- UNIQUE(school_id,collection_id,id)
- UNIQUE(school_id,collection_id,id,schema_version)
- schema_version>0; state/review/self_review 허용값 CHECK
- (policy_scope_key,policy_version_id) MATCH FULL FK policy_versions(scope_key,id); policy_scope_key='s:'||school_id
- published/retired이면 hash/published_at/정책판 NN
- (school_id,template_version_id) FK collection_template_versions(school_id,id)
- (school_id,template_version_id,mapping_id) FK collection_template_mappings(school_id,template_version_id,id)
- (school_id,id,output_file_field_id) FK collection_fields(school_id,schema_id,id) DEFERRABLE
- response_mode NULL이면 이번 확장 연결 전부 NULL; file_upload/guided는 template/output field/requirement 모두 NN; guided만 mapping NN
- published schema material 불변; output file field는 kind=file이며 같은 collection/schema; generated_output은 guided 전용
- UNIQUE(school_id,id,template_version_id,mapping_id) 추가; 생성 문서판이 정확한 schema/양식/매핑 조합을 FK로 참조
- guided에는 output_file_field_id가 가리키는 root/file/generated_output/required=true/file_max_count=1/activation NULL 필드 정확히 1개. 다른 generated_output 필드가 있거나 역참조가 없으면 지연 제약으로 거부
- file_upload에는 output_file_field_id가 root/file/input/required=true/file_max_count=1/activation NULL이며 generated_output 필드 0개. 일반수합 모드 NULL도 generated_output 0개

통합 동작 규칙:

- draft에서만 문항 편집. publish 후 내용/정책/지문 불변; retired는 현재 적용 금지일 뿐 과거 참조 유지.
- publish가 부모 FOR UPDATE를 잡고 child field 편집은 같은 부모 잠금과 충돌한다.
- 정책판은 published·승인·시행일·applies_to_scopes·policy_key 검사.
- 기존 수합 schema와 review/self_review/current/effective 계약 유지.
- guided 게시 시 승인 mapping exact hash, field 정의, 검증 표본, 현재 renderer/pack capability를 재검사.
- 게시 후 변경은 새 schema+단위별 영향승인, pending 제출/열린 보완 단위의 모드 변경 거부.
- 게시 schema의 입력 필드 의미/타입/조건/반복 구조는 승인 mapping.field_definition과 일치; 다르면 새 mapping+표본 필요.

인덱스: (school_id,collection_id,schema_version DESC); (school_id,template_version_id,id) WHERE template_version_id IS NOT NULL

필수 시험: WF03; WF15; COL01; COL02; COL03; COL16; COL22

## workhub.collection_template_analyses

수합 · 신규

열람: 현재 양식 관리자만; 분석 job/ai 결과로 초안 접근 범위를 넓히지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| template_version_id | text | 불가 | — | workhub.collection_template_versions.id · 분석한 정확한 원본판 | 통합 추가 |
| job_id | text | 불가 | — | workhub.jobs.id · 분석 작업 | 통합 추가 |
| ai_run_id | text | 허용 | — | workhub.ai_runs.id · Claude 실행; 호출 전/수동 분석은 NULL | 통합 추가 |
| state | text | 불가 | — | queued/running/succeeded/needs_review/failed/outcome_unknown/cancelled | 통합 추가 |
| recommendation | text | 허용 | — | file_upload 또는 guided_candidate | 통합 추가 |
| result | jsonb | 허용 | — | 후보 필드·위치·불확실성·지원 capability, 성공 종료 시 불변 | 통합 추가 |
| result_sha256 | text | 허용 | — | 정규화 분석 결과 지문 | 통합 추가 |
| analysis_contract_version | text | 불가 | — | 분석 DTO와 출력 위치 계약 버전 | 통합 추가 |
| completed_at | timestamptz | 허용 | — | 검증한 완료/실패 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- (school_id,template_version_id) FK collection_template_versions(school_id,id)
- (scope_key,job_id) FK jobs(scope_key,id); (scope_key,ai_run_id) FK ai_runs(scope_key,id)
- UNIQUE(scope_key,job_id); UNIQUE(school_id,template_version_id,id)
- 성공 또는 검토필요 결과는 result/result_sha256/completed_at 모두 존재; failed/unknown을 verified로 사용 금지
- 상태·추천은 명시 enum; result는 제한된 object, 실행 코드/비밀/원시 전체 대화 저장 금지

통합 동작 규칙:

- jobs와 동일 lease token 및 현재 양식 접근 검사를 통과한 worker만 완료한다.
- 원본 sha가 바뀌지 않아도 새 프롬프트/분석 재시도는 새 analysis로 기록한다.
- 외부 결과 outcome_unknown은 04장 복구 규칙을 따르며 자동 중복 호출하지 않는다.

인덱스: (school_id,template_version_id,created_at DESC,id)

필수 시험: COL01; COL02; COL15; COL19

## workhub.collection_template_mappings

수합 · 신규

열람: 현재 양식 관리자. 게시 수합 참가자는 질문·지원 요약만 읽고 분석 원문·관리 메타는 받지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| template_version_id | text | 불가 | — | workhub.collection_template_versions.id · 매핑한 정확한 원본판 | 통합 추가 |
| analysis_id | text | 허용 | — | workhub.collection_template_analyses.id · 사용한 AI 분석 또는 수동 검토 근거 | 통합 추가 |
| version_no | integer | 불가 | — | 해당 양식판 내 매핑판 | 통합 추가 |
| source | text | 불가 | — | ai_reviewed 또는 human_review | 통합 추가 |
| field_definition | jsonb | 불가 | — | 안정 field_key의 타입/질문/조건/반복 구조, 게시 schema의 원본 | 통합 추가 |
| mapping_definition | jsonb | 불가 | — | field_key→target_key/구조 locator 및 허용 코드 변환 | 통합 추가 |
| mapping_sha256 | text | 불가 | — | field+mapping+출력 계약의 canonical 지문 | 통합 추가 |
| renderer_contract_version | text | 불가 | — | 실제 사용할 렌더러 계약판 | 통합 추가 |
| pack_id | text | 허용 | — | workhub.document_packs.id · 검증된 출력 팩 | 통합 추가 |
| pack_scope_key | text | 허용 | — | 같은 학교 또는 허용된 common 팩 | 통합 추가 |
| pack_asset_sha256 | text | 허용 | — | 정확한 검증 팩 자산 지문 | 통합 추가 |
| state | text | 불가 | — | candidate/verified/approved/retired | 통합 추가 |
| sample_document_id | text | 허용 | — | workhub.documents.id · 합성 표본 문서 | 통합 추가 |
| sample_revision_no | integer | 허용 | — | 표본의 정확한 불변판 | 통합 추가 |
| sample_validation_id | text | 허용 | — | workhub.document_validations.id · 표본 정확판 검사 | 통합 추가 |
| sample_manifest_sha256 | text | 허용 | — | 입력 fixture/양식/매핑/팩/출력 해시 묶음 | 통합 추가 |
| approved_by_membership_id | text | 허용 | — | workhub.memberships.id · 표본 확인자 | 통합 추가 |
| approved_at | timestamptz | 허용 | — | 확인 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- UNIQUE(school_id,template_version_id,version_no); UNIQUE(school_id,template_version_id,id)
- (school_id,template_version_id) FK collection_template_versions(school_id,id)
- (school_id,template_version_id,analysis_id) FK collection_template_analyses(school_id,template_version_id,id); 선택 ID만 NULL인 경우 MATCH SIMPLE
- (pack_scope_key,pack_id) MATCH FULL FK document_packs(scope_key,id); pack/asset 지문은 모두 NULL 또는 모두 존재
- (scope_key,sample_document_id,sample_revision_no) FK document_revisions(scope_key,document_id,revision_no); sample document/revision은 동시 NULL
- (scope_key,sample_document_id,sample_revision_no,sample_validation_id) FK document_validations(scope_key,document_id,revision_no,id); 선택 ID bundle 완전성 CHECK
- (school_id,approved_by_membership_id) FK memberships(school_id,id)
- approved/retired는 표본 정확판/검사/manifest/승인자/승인시각 모두 NN; verified도 exact sample 검사 성공 필수
- source enum/상태 enum/version_no>0; 정의 JSON은 허용형식, target 중복/필드 누락/임의 실행문 금지
- guided 승인 매핑은 pack_id/pack_scope_key/pack_asset_sha256 NN이고 현재 검증·활성 팩 및 renderer contract와 일치; 검증 없는 임의 renderer 사용 금지

통합 동작 규칙:

- field/mapping/renderer/pack/source material은 INSERT 후 불변, 내용 변경은 새 version_no.
- 표본 필수 검사 skipped=0·실물 hash·원본/매핑/엔진/팩 지문 일치 후 verified; 담당자 명시 확인 후 approved.
- 기존 보호 자산을 바꾸지 않고 지원된 팩 또는 승인된 새 출력 경로를 참조한다.

인덱스: (school_id,template_version_id,state,version_no DESC)

필수 시험: COL01; COL02; COL03; COL19

## workhub.collection_template_versions

수합 · 신규

열람: 양식 관리자 또는 해당 판을 게시한 수합의 안내/양식 수신 권한. 미게시 초안 양식을 학교 전체에 공개하지 않음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| template_id | text | 불가 | — | workhub.collection_templates.id · 재사용 양식 부모 | 통합 추가 |
| version_no | integer | 불가 | — | 양식 파일의 증가 판번호 | 통합 추가 |
| source_file_id | text | 불가 | — | workhub.file_objects.id · 검증된 원본 파일 | 통합 추가 |
| source_sha256 | text | 불가 | — | 실물 검증된 원본 지문 | 통합 추가 |
| registered_by_membership_id | text | 불가 | — | workhub.memberships.id · 등록자 | 통합 추가 |
| capability_report | jsonb | 불가 | — | 등록 시점의 파일 이용 가능/분석 가능 정보, 분석 성공을 의미하지 않음 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- UNIQUE(school_id,template_id,version_no); UNIQUE(school_id,template_id,id)
- (school_id,template_id) FK collection_templates(school_id,id)
- (school_id,source_file_id) FK file_objects(school_id,id)
- (school_id,registered_by_membership_id) FK memberships(school_id,id)
- version_no>0; source_sha256는 64자리 hex이고 검증된 file_objects.sha256와 일치

통합 동작 규칙:

- 원본 파일/해시/부모/판은 INSERT 후 불변. 수정 파일은 새 file object와 새 판이다.
- 현재 파일 정책을 통과하기 전 분석·전달·AI 입력 금지. 지원 형식은 승인 capability 설정으로 판정한다.

인덱스: (school_id,template_id,version_no DESC); (school_id,source_file_id)

필수 시험: COL01; COL02; COL18; COL19

## workhub.collection_templates

수합 · 신규

열람: 현재 생성자 또는 명시 양식 관리권한; 게시 수합 대상자는 연결된 정확한 빈 양식판만 읽음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 발급 UUID 문자열, PK | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 현재 학교 경계 | 통합 추가 |
| scope_key | text | 불가 | — | 01장 학교 scope 규칙으로 서버 생성; 클라이언트 지정 불가 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| version | integer | 불가 | — | 명령 동시성용 양의 버전, 불변 material 판번호와 별개 | 통합 추가 |
| title | text | 불가 | — | 양식 표시명; 권한·정체성 키로 사용하지 않음 | 통합 추가 |
| created_by_membership_id | text | 불가 | — | workhub.memberships.id · 작성 당시 유효 소속 | 통합 추가 |
| state | text | 불가 | — | active 또는 retired | 통합 추가 |
| management_duty_id | text | 허용 | — | workhub.duties.id · 명시된 관리 업무; 그 자체가 모든 수합 답변 접근권은 아님 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(scope_key,id); version>0
- school_id와 scope_key는 같은 학교를 나타냄; 모든 관계 삭제 기본 RESTRICT
- (school_id,created_by_membership_id) FK memberships(school_id,id)
- (school_id,management_duty_id) FK duties(school_id,id); NULL이면 작성자와 명시 위임자 관리
- CHECK state IN(active,retired); title 공백 금지

통합 동작 규칙:

- 양식 재사용 카탈로그이며 답변이나 현재 제출 원장을 넣지 않는다.
- retired는 신규 사용만 막고 기존 양식판/제출/파일 사슬을 보존한다.

인덱스: (school_id,state,created_at DESC,id)

필수 시험: COL01; COL18

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

시간표 · 기존 보강

열람: 시간표 담당 전용; 일반 교사에게 개별 불가 사유를 공개하지 않음

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
| basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 이 조건판이 참조하는 관리자 기준자료판 | 통합 추가 |
| conditions_sha256 | text | 허용 | — | locked 상태의 전체 정규화 조건 지문 | 통합 추가 |

통합 필수 제약:

- FOREIGN KEY(school_id,basis_revision_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- locked이면 conditions_sha256 필수; 하위 조건과 본문 불변; 변경은 based_on_id를 둔 새판
- 기존 데이터에 NOT NULL 도입 전 사람이 확인한 기준판 연결 필요; 임의 채움 금지

통합 동작 규칙:

- 필수·선호·미지원·명시 제외 상태를 포함해 잠금
- 조건 잠금과 compose가 현재 basis 원본 지문을 확인
- 잠금/편성/배포의 hard 충족 검사는 strength=hard와 school_hard 모두 검사한다.

인덱스: idx_constraint_sets_basis(school_id,basis_revision_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,based_on_id) → workhub.constraint_sets(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

필수 시험: TT07; TT08; TT09

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

시간표 · 기존 보강

열람: 해당 교사 및 지정 업무담당의 범위; 전교 공개 누계 금지

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

통합 필수 제약:

- 기존 settles_id/reverses_id/lesson_instance/execution_revision FK와 멱등 제약 유지
- 보강 대상/충당량은 같은 학교·교과/수업 맥락 검증. 원장 정정은 보상행; 중복 충당과 반대 부호 이중 계상 금지

통합 동작 규칙:

- 예정시수와 실제실시·보강필요를 분리
- 금액·수당·규정은 확인된 계산식판만 사용, AI 임의 계산금지

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,cause_change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,lesson_instance_id,execution_revision_no) → workhub.lesson_executions(school_id,lesson_instance_id,revision_no)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)
- (school_id,membership_id) → workhub.memberships(school_id,id)
- (school_id,reverses_id) → workhub.cover_ledger(school_id,id)
- (school_id,settles_id) → workhub.cover_ledger(school_id,id)

필수 시험: TT03; TT20

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

열람: 기존 문서판 ACL AND 현재 연결 단위의 초안/제출 ACL. collection source FK가 원본 개인초안 전체 열람을 허용하지 않음.

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
| collection_unit_id | text | 허용 | — | workhub.collection_units.id · 수합 생성판의 정확한 단위, 원문서 linked_unit_id와 일치 | 통합 추가 |
| collection_schema_id | text | 허용 | — | workhub.collection_schemas.id · 생성에 사용한 불변 수합 문항판 | 통합 추가 |
| collection_answer_snapshot_id | text | 허용 | — | workhub.collection_answer_snapshots.id · 렌더러가 실제 소비한 불변 답변 snapshot | 통합 추가 |
| collection_template_version_id | text | 허용 | — | workhub.collection_template_versions.id · 생성 원본 양식의 정확한 판 | 통합 추가 |
| collection_mapping_id | text | 허용 | — | workhub.collection_template_mappings.id · 실제 사용한 승인 매핑판 | 통합 추가 |
| collection_generation_input_sha256 | text | 허용 | — | 실제 job.input_sha256와 같은 생성 입력 지문 | 통합 추가 |
| collection_renderer_contract_version | text | 허용 | — | 실제 생성에 사용한 검증 렌더러 계약판 | 통합 추가 |

통합 필수 제약:

- 팩 snapshot 세열 동시 NULL 또는 존재; (scope_key,pack_id) MATCH FULL 복합 FK
- pack_version/hash는 해당 실제 팩과 일치
- 원본 content/outputfile/hash와 팩 snapshot INSERT 후 불변
- 수합 생성판의 7개 collection_* 열은 모두 NULL 또는 모두 NN. NN이면 school_id와 job_id NN이며 origin은 실제 생성 경로를 나타냄
- (school_id,document_id,collection_unit_id) FK documents(school_id,id,linked_unit_id) MATCH SIMPLE; 수합판에서는 모든 FK 열 NN
- (school_id,collection_unit_id,collection_schema_id,collection_answer_snapshot_id) FK collection_answer_snapshots(school_id,unit_id,schema_id,id)
- (school_id,collection_template_version_id,collection_mapping_id) FK collection_template_mappings(school_id,template_version_id,id)
- (school_id,collection_schema_id,collection_template_version_id,collection_mapping_id) FK collection_schemas(school_id,id,template_version_id,mapping_id)
- UNIQUE(school_id,document_id,revision_no,collection_unit_id,collection_schema_id,collection_answer_snapshot_id,collection_template_version_id,collection_mapping_id)
- collection_generation_input_sha256는 64자리 hex이며 해당 job.input_sha256와 일치. job.input의 unit/schema/snapshot/template/mapping/renderer/pack 식별자와 FK 사슬 전수 일치
- collection_renderer_contract_version과 mapping.renderer_contract_version 동일, revision pack snapshot ID/scope/asset hash와 mapping 검증 팩 동일
- 수합 source 열은 content/output/pack과 함께 INSERT 후 불변; file 재업로드/수동수정은 새 판과 재검증

통합 동작 규칙:

- 새생성은 현재 active 팩, 과거판은 당시 팩 근거 유지.
- source_refs JSON은 document_revision_sources의 표시 snapshot, ACL/근거 단독 원장 아님.
- 재업로드는 새 file+revision+validation. pass 승계 금지.
- 원본문서·생성 입력·출력파일은 기존 문서판에 저장하며 별도 본문 사본을 만들지 않는다.
- worker는 현재 job lease와 권한을 확인하고 실제 사용하는 snapshot/mapping 입력으로만 typed source 열을 채운다. 클라이언트가 제공한 임의 source 문자열로 대체 금지.
- artifact 생성 시 이 정확 source 사슬을 FK로 고정해 같은 학교 다른 단위/초안의 정상 파일을 포장하는 경로를 차단한다.

인덱스: (pack_scope_key_snapshot,pack_id_snapshot); (school_id,collection_unit_id,collection_schema_id,collection_answer_snapshot_id) WHERE collection_answer_snapshot_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (created_by_account_id) → workhub.accounts(id)
- (school_id) → workhub.schools(id)
- (scope_key,document_id) → workhub.documents(scope_key,id)
- (scope_key,job_id) → workhub.jobs(scope_key,id)
- (scope_key,output_file_id) → workhub.file_objects(scope_key,id)

필수 시험: WF17; COL04; COL09; COL19; COL23; COL24

## workhub.document_validations

파일·문서 · 기존 보강

열람: 기존 원문서 현재 ACL 및 linked unit 경계.

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
- UNIQUE(scope_key,document_id,revision_no,id) 추가하여 표본/산출물이 정확한 문서판 검사를 FK로 참조

통합 동작 규칙:

- 근거 stale면 과거 pass가 있어도 새 출력/제출 허용을 자동 승계하지 않는다.
- 매핑 표본 필수검사 skipped>0 또는 exact checked hash 불일치이면 문답형 검증 통과 불가.
- 파일 안전 검증·서식 검증·내용 규정 검증의 통과 범위를 구분한다.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (scope_key,document_id,revision_no) → workhub.document_revisions(scope_key,document_id,revision_no)
- (scope_key,job_id) → workhub.jobs(scope_key,id)

필수 시험: WF17; COL02; COL03; COL19; COL23

## workhub.documents

파일·문서 · 기존 보강

열람: 기존 문서 권한과 수합 원본의 현재 권한 교집합.

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
- linked_unit_id가 있는 수합 초안/산출물은 문서 ACL AND 해당 unit draft/submission 현재 ACL을 함께 만족
- UNIQUE(school_id,id,linked_unit_id) 추가. 수합 생성 문서판의 정확 unit FK가 참조하며 linked_unit_id 변경으로 기존 판을 재배정하지 못함
- 생성 document owner 변경으로 수합 비공개 초안 경계를 우회하지 못함

통합 동작 규칙:

- 문서 head의 팩 선택은 다음 판 입력이며 과거 revision의 팩판을 바꾸지 않는다.
- private/shared_with는 현재 ACL. duty/linked_unit 접근이 학생기록이나 개인초안을 자동 공개하지 않음.
- 기존 문서 저장/판 생성 사용, 단위 연결 산출물 공개는 실제 submission의 exact revision/file 연결 뒤에만.
- 개인 문서함·검색·jobs·ai_runs·source ref에서 동일 부모 경계를 재검사한다.
- 개인초안 산출물은 shared_with=none, 공동초안 산출물은 shared_with=unit_members로 생성하되 현재 유효 구성원 검사. linked unit의 개인초안 문서를 school/duty_members로 확대 금지.

인덱스: (school_id,linked_unit_id,id) WHERE linked_unit_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (pack_scope_key,pack_id) → workhub.document_packs(scope_key,id)
- (school_id,duty_id) → workhub.duties(school_id,id)
- (school_id) → workhub.schools(id)
- (school_id,linked_unit_id) → workhub.collection_units(school_id,id)
- (scope_key,conversation_id,owner_account_id) → workhub.conversations(scope_key,id,owner_account_id)

필수 시험: WF17; WF18; COL04; COL12; COL20; COL24

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

열람: 기존 현재 요청관리/내보내기 권한 및 포함 제출판 ACL.

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

- none latest_valid, required effective 완료본 기본; received 미승인 포함은 명시선택.
- 시작/항목/최종연결/다운로드 권한 재검사, 권한 잃은 파일 섞인 구ZIP 재발급 금지.
- 동일 고정 항목 실패만 재시도, 중간 새제출판 자동치환 금지.
- 기본 selection은 effective. 검토 없는 수합도 current=effective 계약에 따라 같은 기본 사용.
- 미승인 received 포함은 담당자 명시 선택·상태 표시; 완료본 없는 단위는 현황표에 미완료 사유 표시.
- 02장 13절의 이전 1.0 received 기본을 대체하며 현재 02장과 동일; 고정 item ID/hash·부분실패·현재권한 규칙 유지.

인덱스: (school_id,requested_by_membership_id,created_at DESC,id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,collection_id) → workhub.collections(school_id,id)
- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,job_id) → workhub.jobs(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)

필수 시험: WF16; COL14; COL17

## workhub.feedback

메신저·전달·알림 · 기존 계승

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

메신저·전달·알림 · 기존 계승

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

열람: typed 원본 현재 ACL. 미제출 artifact/문서/파일은 collector에게 비공개.

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
| answer_path | text[] | 허용 | — | 문항 key 또는 반복행 group/row_key/field 경로; 수합 외 링크는 NULL | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): file_links_resource_type_resource_id_file_object_id_role_key

이번 판에서 대체하는 인덱스(그대로 생성 금지): file_links_resource_type_resource_id_file_object_id_role_key, UNIQUE (scope_key,resource_type,resource_id,resource_version,field_id,file_object_id,role) NULLS NOT DISTINCT WHERE unlinked_at IS NULL

통합 필수 제약:

- scope/file/resource_type/resource_id/resource_version/role/actor/linked_at/field_id 불변
- unlink 메타만 1회 변경, 새 연결은 새 행
- draft 파일은 동일 schema의 file 문항
- resource resolver 허용 목록 외 종류·미지원 복합PK 거부; source·target·version·scope 검사
- 기존 UNIQUE(resource_type,resource_id,file_object_id,role) 제거는 새 활성 연결 유일 인덱스로 대체할 때만 수행
- 신규 typed resolver: collection_template_versions, collection_answer_snapshots, collection_output_artifacts. 정확 학교/판/원본권한 검증 구현 후 allowlist
- 수합 경로는 exact schema field와 row_key 존재·형식 검증; file ID/raw path로 부모 권한 대체 금지
- answer_path는 file_links의 불변 연결 정체성에 포함. 다른 반복행으로 UPDATE하지 못하며 기존 초안 관계 변경은 unlink+새 링크, 동결 snapshot 관계는 변경 금지
- 활성 링크 UNIQUE(scope_key,resource_type,resource_id,resource_version,field_id,answer_path,file_object_id,role) NULLS NOT DISTINCT WHERE unlinked_at IS NULL; 기존 명명 UNIQUE 및 answer_path 없는 활성 UNIQUE를 대체
- 불변 answer snapshot 링크는 freeze transaction에서만 INSERT, 그 후 UPDATE/unlink/추가 금지; 전체 접근 차단/정정은 별도 사건

통합 동작 규칙:

- 초기 resolver: unit_drafts/documents/notices/knowledge_revisions/document_packs/import_runs/export_manifests.
- 기존 typed submission_files/document_inputs/document_revisions.output_file_id를 generic link로 우회 금지.
- 연결 시 파일읽기+목적쓰기+공개범위 상승 허용 검사; unlink/원본권한회수와 grant revoke 같은 transaction.
- 불변판의 파일 연결은 내용 수정용 unlink 불가. 전체 차단/정정판으로 처리.
- snapshot file_manifest JSON과 typed link의 file/hash/path 전수 일치 검사.
- 기존 파일 실물·안전정책·현재 다운로드 ACL·grant 회수 유지. 원본 양식 접근이 답변 파일 접근을 열지 않음.

인덱스: (school_id,resource_type,resource_id,resource_version) WHERE unlinked_at IS NULL; UNIQUE (scope_key,resource_type,resource_id,resource_version,field_id,answer_path,file_object_id,role) NULLS NOT DISTINCT WHERE unlinked_at IS NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (linked_by_account_id) → workhub.accounts(id)
- (resource_type) → workhub.resource_classes(resource_type)
- (school_id) → workhub.schools(id)
- (scope_key,file_object_id) → workhub.file_objects(scope_key,id)
- (unlinked_by_account_id) → workhub.accounts(id)

필수 시험: WF05; WF10; WF05: 연결→unlink→동일 파일 재연결 성공; 동일 문항의 동시 활성 연결 중복 거부; 서로 다른 문항의 동일 파일은 구별; COL01; COL04; COL08; COL12; COL21

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

시간표 · 기존 보강

열람: 실제 수업 담당과 승인된 실시 확인 범위, 학생 기록 권한 확대 없음

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

통합 필수 제약:

- 기존 (lesson_instance_id,revision_no) 불변판과 동일 학교 복합 FK 유지
- 정정은 새판; 같은 실시판의 원장 계상 멱등, 시간 경과로 실시 확정 금지

통합 동작 규칙:

- 대강·결강·보강·실시 정정은 lesson_execution_teachers/cover_ledger와 함께 처리
- 실시 기록과 연결된 학생 활동·관찰을 삭제하지 않음

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,lesson_instance_id) → workhub.lesson_instances(school_id,id)

필수 시험: TT03; TT20

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

시간표 · 기존 보강

열람: 확정 수업 최소 DTO는 현재 학교 교사, 학생 자료/개인사유는 별도 원본 권한

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

통합 필수 제약:

- 기존 lesson 영구 ID와 school/term/course 복합 FK 보존; 엔진 unit 순번을 영구 ID로 재사용 금지
- 이미 실시/학생자료 연결한 수업을 재생성·원복으로 삭제하거나 다른 수업 의미로 재귀속 금지

통합 동작 규칙:

- 기본표 재배포 시 승인 미래변경 영향 검토; 기존 수업 변경을 소실시키지 않음
- 교사/학급/교실 DTO는 같은 날짜별 원장 조회; 캐시가 오래되면 최신성 표시

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,course_group_id) → workhub.course_groups(school_id,id)
- (school_id,replaces_lesson_id) → workhub.lesson_instances(school_id,id)
- (school_id,space_id) → workhub.spaces(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)
- (school_id,timetable_version_id) → workhub.timetable_versions(school_id,id)

필수 시험: TT03; TT14; TT15; TT22

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

## workhub.messenger_dispatch_files

메신저·전달·알림 · 신규

열람: prepared는 현재 발신자만. delivered는 읽을 수 있는 정확한 message 부모 AND file 안전상태/실물일치/기존원본 현재 ACL. 관리자 우회 없음.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| dispatch_id | text | 불가 | — | workhub.messenger_dispatches.id · 불변 발송판 · 생성 후 불변 | 통합 추가 |
| file_object_id | text | 불가 | — | workhub.file_objects.id · 같은 학교의 검증된 파일 · 생성 후 불변 | 통합 추가 |
| sha256 | text | 불가 | — | 준비 당시 실물 지문 · 생성 후 불변 | 통합 추가 |
| size_bytes | bigint | 불가 | — | 검증된 실물 크기 · 생성 후 불변 | 통합 추가 |
| filename | text | 불가 | — | 화면 표시용 정규화 파일명; 경로로 쓰지 않음 · 생성 후 불변 | 통합 추가 |
| position | integer | 불가 | — | 본문 아래 표시 순서 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,dispatch_id) FK messenger_dispatches(school_id,id); (school_id,file_object_id) FK file_objects(school_id,id)
- UNIQUE(dispatch_id,file_object_id)
- UNIQUE(dispatch_id,position)
- size_bytes>=0; position>=0; sha256 64자리 hex
- 준비 시 안전검사/실물hash/학교/원본현재권한 일치. confirmed 이후 첨부 INSERT/UPDATE/DELETE 금지

통합 동작 규칙:

- 새 파일은 기존 cmd_file_init으로 school 비공개 미연결 업로드를 예약하고 안전검사 후 prepare에 file ID/hash를 전달한다. 미연결 상태·업로드 주체·동일 학교를 확인한 새 업로드만 dispatch 생성+typed 첨부+intended_resource_type=messenger_dispatch/id 1회 bind를 원자 수행한다. 기존 업무 파일의 intended_resource_type/id·원부모·소유자는 변경하지 않고 typed 첨부 참조와 현재 원본 ACL을 유지한다.
- 기존 학교·개인 파일을 DM에 붙여 원본 ACL을 확대하지 않는다. 새 파일 업로드와 기존 업무자료 링크 공유를 구분한다.
- 이미 다른 원본에 속한 파일은 모든 수신자가 원본을 현재 읽을 수 있을 때만 현재 원본 ACL을 AND로 검사하는 링크로 제공; 권한이 다른 경우 업무카드/접근요청 안내.
- 다운로드는 messageId+fileId로 수행하고 message.dispatchId=이 행 dispatch를 서버 확인한다. 직접 dispatchId나 파일ID/Storage URL만으로 다운로드 불가.
- 파일 한도·형식·보존기간·URL 수명은 승인 정책값. 미정이면 해당 업로드/발송만 POLICY_UNSET, 임의 숫자 기본값 금지.

인덱스: (school_id,file_object_id,dispatch_id)

필수 시험: MSG04; MSG06; MSG09; MSG12; MSG14

## workhub.messenger_dispatch_targets

메신저·전달·알림 · 신규

열람: 발신자는 전체 상태, 수신자는 본인 delivered 최소 접수만. 양쪽 모두 현재 해당 학교 origin 소속과 메시지 관계 확인.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| dispatch_id | text | 불가 | — | workhub.messenger_dispatches.id · 확인안 · 생성 후 불변 | 통합 추가 |
| recipient_membership_id | text | 불가 | — | workhub.memberships.id · 고정 수신 소속 · 생성 후 불변 | 통합 추가 |
| recipient_account_id | text | 불가 | — | workhub.accounts.id · 고정 수신 계정 · 생성 후 불변 | 통합 추가 |
| recipient_participant_id | text | 허용 | — | workhub.messenger_participants.id · group의 정확한 참여 episode; direct는 전달 시 생성/선택 | 통합 추가 |
| result_thread_id | text | 허용 | — | workhub.messenger_threads.id · 실제 생성/기존 DM 또는 고정 group 방 | 통합 추가 |
| state | text | 불가 | — | pending/delivered/blocked/failed/cancelled; delivered는 DB 메시지 커밋 | 통합 추가 |
| safe_error_code | text | 허용 | — | 본문 없는 허용목록 실패 사유 | 통합 추가 |
| attempt_count | integer | 불가 | — | 내부 전달 시도 수; 재시도 정책에서 증가 | 통합 추가 |
| delivered_at | timestamptz | 허용 | — | delivered일 때 서버 시각 | 통합 추가 |
| version | integer | 불가 | — | 1부터 시작하는 낙관적 동시성 판 | 통합 추가 |
| corrects_message_id | text | 허용 | — | workhub.messenger_messages.id · 정정 발송 대상의 이전 메시지. prepared 시 고정하며 같은 학교·방·발신자 소유 검증 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,dispatch_id) FK messenger_dispatches(school_id,id)
- (school_id,recipient_membership_id,recipient_account_id) FK memberships(school_id,id,account_id)
- (school_id,result_thread_id,recipient_participant_id,recipient_membership_id,recipient_account_id) FK messenger_participants(school_id,thread_id,id,membership_id,account_id) MATCH SIMPLE
- UNIQUE(dispatch_id,recipient_membership_id); 발신자 자신은 targets에 넣지 않음
- delivered이면 result_thread/participant/delivered_at 필수이고 같은 dispatch/thread 메시지가 반드시 존재
- sender/recipient 동일 계정 및 다른 학교 거부; recipient ID/account는 준비 후 불변
- state delivered에서는 재시도/삭제/다른 thread 대입 금지; failed는 DB 효과 없음이 증명된 경우만
- (school_id,corrects_message_id) FK messenger_messages(school_id,id); 정정대상은 현재 존재하는 이전 메시지이며 같은 발신자의 동일 결과방만 허용
- CHECK((result_thread_id IS NULL) = (recipient_participant_id IS NULL)); delivered이면 두 선택열 모두 NOT NULL. 준비 단계는 두 선택열 모두 NULL 허용

통합 동작 규칙:

- 단체 개별발송은 대상별 독립 transaction: DM 확보+message 1개+target delivered+receipt/audit/outbox 원자.
- group는 동결한 현재 참여집합 전체와 메시지 1개를 같은 transaction으로 처리한다. 그룹 전달 중 부분 성공은 허용하지 않음.
- 부서/학년 조건은 준비 시 대상 스냅숏; 실행은 현재 소속·접근검사를 다시 하며 selector를 재해석해 다른 사람에게 보내지 않는다.
- 성공행은 건너뛰고 실패행만 같은 dispatch/recipient 키로 재시도한다. blocked는 새 확인안을 만들기 전 자동 재시도하지 않는다.
- 수신자에게 타 수신자 목록·실패사유·단체발송 집계 반환 금지.
- group 정정은 모든 targets가 같은 corrects_message_id를 갖거나 전부 NULL. 직접/개별발송 정정은 대상별 자기 DM의 원메시지만 참조한다. 정정 대상도 확인 지문에 포함한다.
- 같은 방의 다른 참여자 episode를 수신자 행에 연결할 수 없다. 복합 FK가 수신 소속·계정까지 묶으며 현재 active episode도 명령에서 재검사한다.

인덱스: (school_id,dispatch_id,state,id); (school_id,recipient_membership_id,dispatch_id); (school_id,corrects_message_id) WHERE corrects_message_id IS NOT NULL

필수 시험: MSG01; MSG04; MSG07; MSG08; MSG10; MSG11; MSG14

## workhub.messenger_dispatches

메신저·전달·알림 · 신규

열람: 발신자 본인 현재 origin membership만 준비안/전체 발송 결과를 조회. 수신자는 자기 messenger_messages 경로에서 본문과 본인 관련 카드만 받음. 관리자 일괄본문/수신명단 조회 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| sender_membership_id | text | 불가 | — | workhub.memberships.id · 발송 주체의 고정 소속 · 생성 후 불변 | 통합 추가 |
| sender_account_id | text | 불가 | — | workhub.accounts.id · 인증에서 파생한 발송 계정 · 생성 후 불변 | 통합 추가 |
| mode | text | 불가 | — | direct/group/broadcast_direct; 수신자에게 서로 다른 의미 · 생성 후 불변 | 통합 추가 |
| group_thread_id | text | 허용 | — | workhub.messenger_threads.id · group일 때만 대상 방 · 생성 후 불변 | 통합 추가 |
| expected_participant_epoch | bigint | 허용 | — | group 확인 당시 참여판 | 통합 추가 |
| body | text | 불가 | — | 정규화한 plain text 본문; 승인된 렌더러만 사용, HTML 실행 없음 · 생성 후 불변 | 통합 추가 |
| content_sha256 | text | 불가 | — | 본문·파일지문·업무카드·전달모드의 canonical SHA-256 · 생성 후 불변 | 통합 추가 |
| confirmation_sha256 | text | 불가 | — | content + 정확한 정렬 수신자 + 현재권한판 + 방참여판 + 정책판 + 만료의 지문 · 생성 후 불변 | 통합 추가 |
| recipient_selector | jsonb | 불가 | — | 직접 ID/부서/학년 등 명단 생성 조건. 실제 발송 대상은 targets 고정 집합 · 생성 후 불변 | 통합 추가 |
| policy_bindings | jsonb | 불가 | — | 적용 정책의 scope_key/id/version 및 명령 registry 판; 임의 실행문 불가 · 생성 후 불변 | 통합 추가 |
| permission_context | jsonb | 불가 | — | 확인 당시 계정/학교/소속/역할 권한판. 실행 때 현재값과 비교 · 생성 후 불변 | 통합 추가 |
| origin | text | 불가 | — | manual/ai/workflow; AI도 교사가 발신자 · 생성 후 불변 | 통합 추가 |
| tool_proposal_id | text | 허용 | — | workhub.tool_proposals.id · AI 확인 제안과의 1방향 연결; payload가 이 dispatch와 지문 참조 · 생성 후 불변 | 통합 추가 |
| card_kind | text | 허용 | — | collection/timetable_change; 없으면 다른 card 열도 NULL · 생성 후 불변 | 통합 추가 |
| collection_id | text | 허용 | — | workhub.collections.id · 수합 안내 카드의 현재 원본 · 생성 후 불변 | 통합 추가 |
| timetable_change_set_id | text | 허용 | — | workhub.timetable_change_sets.id · 시간표 변경 카드의 현재 원본 · 생성 후 불변 | 통합 추가 |
| card_version | integer | 허용 | — | 표시 제안 당시 원본 판; 행동 시 현재 원본 재검사 · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | — | prepared/confirmed/sending/completed/partial/failed/cancelled/expired | 통합 추가 |
| expires_at | timestamptz | 불가 | — | 확인 유효 시각; 구체 유효시간은 승인 정책 | 통합 추가 |
| confirmed_at | timestamptz | 허용 | — | 교사가 정확한 지문을 확인한 서버 시각 | 통합 추가 |
| confirmed_by_membership_id | text | 허용 | — | workhub.memberships.id · sender_membership_id와 같아야 함 | 통합 추가 |
| target_count | integer | 불가 | — | 준비 시 고정 대상 수. 최소 1 | 통합 추가 |
| version | integer | 불가 | — | 1부터 시작하는 낙관적 동시성 판 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 생성 시각 | 통합 추가 |
| completed_at | timestamptz | 허용 | — | 모든 대상 최종결과가 있을 때 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,sender_membership_id,sender_account_id) FK memberships(school_id,id,account_id)
- (school_id,group_thread_id) FK messenger_threads(school_id,id)
- (school_id,collection_id) FK collections(school_id,id); (school_id,timetable_change_set_id) FK timetable_change_sets(school_id,id)
- card_kind=collection이면 collection_id/card_version만 존재; timetable_change이면 timetable_change_set_id/card_version만 존재; 없음이면 전부 NULL
- UNIQUE(school_id,id,sender_membership_id,sender_account_id)
- group mode iff group_thread_id와 expected_participant_epoch 존재; direct는 target_count=1
- tool_proposal_id는 동일 school·actor·origin membership의 tool_proposals이며 cmd_messenger_confirm 전용 tool registry; 일반 FK 외 명령 검증
- confirmed_at/confirmed_by는 둘 다 NULL 또는 존재하고 confirmed_by=sender; confirmed 이후 상태에는 확인 필수
- confirmed/completed 후 content/selector/정확한 대상/첨부/card/확인 맥락 불변; 수정은 새 dispatch
- 준비안은 trim(body) 비어있지 않음 OR 첨부 존재 OR 업무카드 존재; 실제 대상행 수=target_count, 학교/소속별 중복 없음
- prepared 생성과 targets/files를 같은 transaction으로 생성하고 지연 무결성 검사. 정규화 본문/card/policy JSON은 서버 schema로 검증

통합 동작 규칙:

- 본문은 이 불변 dispatch에 한 번만 보관하고 messenger_messages가 참조한다. 일반 수신자는 dispatch 직접 조회 불가, 메시지 DTO에서 본문만 받는다.
- AI prepared만으로 전송하지 않는다. 확인 이후 target 고정. 명단 변화는 확인 전 STALE, 확인 후 새로운 교사를 자동 추가하지 않음.
- confirmed 이후 권한 상실·소속 종료는 미전송 대상 blocked. 이미 전달된 사실은 지우지 않고 현재 메시지 열람권을 별도로 적용한다.
- 정정은 dispatch_targets.corrects_message_id가 가리키는 과거 본문을 덮어쓰지 않는 새 메시지. 원메시지 조회 시 정정 연결을 표시; 학교 일반관리자가 타인 메시지를 정정할 수 없음.
- 자동 workflow 알림은 기본 notifications로 처리. 사람 이름으로 DM을 자동 발송하지 않으며 반복 안내는 매번 현재 미제출/미동의 명단으로 새 확인안을 만든다.

인덱스: (school_id,sender_membership_id,created_at DESC,id); (school_id,state,created_at,id) WHERE state IN(prepared,confirmed,sending,partial); (school_id,tool_proposal_id) WHERE tool_proposal_id IS NOT NULL

필수 시험: MSG04; MSG06; MSG07; MSG08; MSG09; MSG10; MSG13

## workhub.messenger_messages

메신저·전달·알림 · 신규

열람: 현재 active origin membership + current active participant episode + seq>=visible_from_seq AND (발신자 또는 해당 dispatch 고정 수신자). withdrawn은 내용 없는 표식만.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| thread_id | text | 불가 | — | workhub.messenger_threads.id · 실제 표시되는 방 · 생성 후 불변 | 통합 추가 |
| dispatch_id | text | 불가 | — | workhub.messenger_dispatches.id · 본문·파일·발신자의 불변 발송판 · 생성 후 불변 | 통합 추가 |
| seq | bigint | 불가 | — | 방 잠금 아래 단조 증가 순번 · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | — | visible/withdrawn; 일반 수정으로 본문 대체 금지 | 통합 추가 |
| sent_at | timestamptz | 불가 | — | DB 커밋에 대응하는 서버 기록시각 | 통합 추가 |
| withdrawn_at | timestamptz | 허용 | — | 회수 명령 시각 | 통합 추가 |
| withdrawn_by_membership_id | text | 허용 | — | workhub.memberships.id · 발신자 본인; 안전사건은 별도 승인 운영 경로 | 통합 추가 |
| version | integer | 불가 | — | 1부터 시작하는 낙관적 동시성 판 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- (school_id,thread_id) FK messenger_threads(school_id,id); (school_id,dispatch_id) FK messenger_dispatches(school_id,id)
- UNIQUE(thread_id,seq)
- UNIQUE(dispatch_id,thread_id)
- UNIQUE(school_id,id,dispatch_id)
- seq>=1; visible이면 withdrawn 열 NULL; withdrawn이면 withdrawn_at 필수
- dispatch sender가 방의 현재 참여자이며 group은 dispatch.group_thread_id와 같아야 함
- direct/broadcast_direct는 그 DM 상대가 정확한 dispatch target이어야 함; sender/recipient 외 세 번째 참여 금지

통합 동작 규칙:

- 메시지 body 중복 열 없음. 읽기는 현재 participant episode의 seq범위+현재 소속+message visible 검사 후 dispatch 본문을 조립한다.
- withdrawn은 대화에 회수 표식만 남기고 본문/첨부/검색/AI문맥을 막는다. 이미 상대가 읽거나 내려받은 파일까지 회수했다고 보장하지 않음.
- 회수와 read/download/AI 근거선택은 동일 메시지 gate로 직렬화한다. 캐시·색인 무효화는 후속이며 서버 읽기검사를 대체하지 않음.
- 정정은 새 dispatch_targets.corrects_message_id 참조이며 원본문을 덮어쓰지 않음. 메시지 직접삭제는 일반 API 없음.

인덱스: (school_id,thread_id,seq DESC); (school_id,dispatch_id,id)

필수 시험: MSG02; MSG03; MSG05; MSG08; MSG09; MSG10; MSG12

## workhub.messenger_participants

메신저·전달·알림 · 신규

열람: 본인 episode와 현재 방의 최소 참여자 정보만. 다른 학교/관계없는 관리자 불가. 종료 참여자도 기존 메시지 발신 표시용 최소 탈퇴 표식만 반환.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| thread_id | text | 불가 | — | workhub.messenger_threads.id · 대화방 · 생성 후 불변 | 통합 추가 |
| membership_id | text | 불가 | — | workhub.memberships.id · 참여 당시 고정 소속 · 생성 후 불변 | 통합 추가 |
| account_id | text | 불가 | — | workhub.accounts.id · 참여자 계정 · 생성 후 불변 | 통합 추가 |
| role | text | 불가 | — | manager/member; direct는 member | 통합 추가 |
| state | text | 불가 | — | active/left/removed; 종료 후 같은 행을 active로 되돌리지 않음 | 통합 추가 |
| visible_from_seq | bigint | 불가 | — | 참여 직후 볼 수 있는 첫 순번; 기본 last_seq+1 · 생성 후 불변 | 통합 추가 |
| last_read_seq | bigint | 불가 | — | 실제 화면에 표시한 연속 읽음 경계; visible_from_seq-1 이상, 단조 증가 | 통합 추가 |
| joined_at | timestamptz | 불가 | — | 참여 시작 | 통합 추가 |
| ended_at | timestamptz | 허용 | — | left/removed이면 필수 | 통합 추가 |
| ended_by_membership_id | text | 허용 | — | workhub.memberships.id · 자발적 나가기/제거 수행자; 소속 종료 worker는 NULL | 통합 추가 |
| version | integer | 불가 | — | 1부터 시작하는 낙관적 동시성 판 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- UNIQUE(school_id,thread_id,id)
- (school_id,thread_id) FK messenger_threads(school_id,id)
- (school_id,membership_id,account_id) FK memberships(school_id,id,account_id)
- (school_id,ended_by_membership_id) FK memberships(school_id,id)
- UNIQUE(thread_id,membership_id) WHERE state=active
- state=active iff ended_at IS NULL; visible_from_seq>=1; last_read_seq>=visible_from_seq-1
- 동일 thread/membership episode 기간은 중첩 금지. 종료 시점은 joined_at 이상; 새 episode는 ended_at 뒤 생성
- joined_at/visible_from_seq와 thread/member/account 정체성 불변; ended 상태에서 active로 역전 금지
- UNIQUE(school_id,thread_id,id,membership_id,account_id)

통합 동작 규칙:

- 읽음 명령은 해당 episode의 접근 가능 메시지 순번만 허용하고 max(기존,입력)로 갱신한다.
- 페이지가 뒤에서 열리면 현재 화면 이전을 읽음으로 처리할지 UI에서 명시해 자동 과장하지 않는다. 미조회 앞부분이 있으면 연속 경계 이전까지만 갱신한다.
- 새 참여자/재입장자는 새 visible_from_seq 이후만 본다. 과거 파일/검색/인용/AI 문맥도 같은 경계 적용.
- 메시지를 읽어도 수합 제출/시간표 동의/공지 확인 상태는 바뀌지 않는다.

인덱스: (school_id,membership_id,thread_id) WHERE state=active; (school_id,thread_id,state,id)

필수 시험: MSG02; MSG03; MSG05; MSG14

## workhub.messenger_threads

메신저·전달·알림 · 신규

열람: 현재 학교 소속이 활성이고 현재 참여 episode가 active인 사람만. 퇴직·탈퇴 시 목록/검색/본문/파일 즉시 차단. 관리자·플랫폼 자동 열람 불가.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | — | 서버 생성 식별자 · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 불변 학교 경계 · 생성 후 불변 | 통합 추가 |
| kind | text | 불가 | — | direct/group; 생성 후 불변 · 생성 후 불변 | 통합 추가 |
| title | text | 허용 | — | group 제목; direct는 NULL. 상대 이름은 현재 표시자료로 조립 | 통합 추가 |
| direct_low_membership_id | text | 허용 | — | workhub.memberships.id · direct의 정렬상 작은 소속 ID · 생성 후 불변 | 통합 추가 |
| direct_high_membership_id | text | 허용 | — | workhub.memberships.id · direct의 정렬상 큰 소속 ID · 생성 후 불변 | 통합 추가 |
| created_by_membership_id | text | 불가 | — | workhub.memberships.id · 방 생성 당시 소속 · 생성 후 불변 | 통합 추가 |
| created_by_account_id | text | 불가 | — | workhub.accounts.id · 방 생성 당시 계정 · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | — | active/archived; 보관은 삭제/권한회수가 아님 | 통합 추가 |
| participant_epoch | bigint | 불가 | — | 참여/탈퇴/역할변경마다 증가; 발송 확인 지문에 포함 | 통합 추가 |
| last_seq | bigint | 불가 | — | 0부터 시작. 이 방 마지막 커밋 메시지 순번; 순번 배정은 방 잠금 아래 실행 | 통합 추가 |
| version | integer | 불가 | — | 1부터 시작하는 낙관적 동시성 판 | 통합 추가 |
| created_at | timestamptz | 불가 | — | 서버 생성 시각 | 통합 추가 |
| updated_at | timestamptz | 불가 | — | 서버 최신 활동 시각 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id)
- UNIQUE(school_id,id)
- school_id와 모든 작성 주체/부모 관계는 불변; FK 삭제는 RESTRICT/NO ACTION, 학교/계정 CASCADE 금지
- kind=direct iff 두 direct membership 존재 AND low<high; group이면 두 열 모두 NULL
- UNIQUE(school_id,direct_low_membership_id,direct_high_membership_id) WHERE kind=direct
- (school_id,direct_low_membership_id)/(school_id,direct_high_membership_id) FK memberships(school_id,id); 서로 다른 현재 소속, 계정도 서로 달라야 함
- (school_id,created_by_membership_id,created_by_account_id) FK memberships(school_id,id,account_id)
- last_seq>=0, participant_epoch>=1, version>=1; direct 방은 정확히 두 지정 소속만 참여 가능
- group title은 공백제거 후 비어있지 않음; 직접 DM에는 title 없음. 길이 한도는 승인된 입력 규격에서 조회

통합 동작 규칙:

- 같은 학교 두 소속의 역순 동시 DM 생성은 UNIQUE와 멱등 명령으로 한 방으로 수렴한다.
- 전출 뒤 새 소속으로 돌아온 사용자는 새 membership이므로 옛 DM이 자동 재개되지 않는다.
- group에서 현재 manager가 0명이 되는 변경은 현재 참여자에게 역할 인계하거나 방 archived 처리와 원자 결합한다. 학교 관리자 자동 manager 승격 금지.
- 나가기/멤버 추가/재입장은 participant_epoch 증가. 재입장은 새 참여 행과 새 visible_from_seq를 만든다.

인덱스: (school_id,updated_at DESC,id); (school_id,state,id)

필수 시험: MSG01; MSG02; MSG03; MSG04

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

메신저·전달·알림 · 기존 계승

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

메신저·전달·알림 · 기존 보강

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

메신저·전달·알림 · 기존 계승

열람: 01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| kind | text | 불가 | — |  | 원본 |
| label | text | 불가 | — |  | 원본 |
| scope | text | 불가 | — |  | 원본 |
| urgent_allowed | boolean | 불가 | false |  | 원본 |

## workhub.notification_preferences

메신저·전달·알림 · 기존 계승

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

메신저·전달·알림 · 기존 보강

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

메신저·전달·알림 · 기존 계승

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

메신저·전달·알림 · 기존 계승

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

시간표 · 기존 보강

열람: 당사자는 사용 가능 여부, 원인 본문은 현재 권한 범위

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| school_id | text | 불가 | — |  | 원본 |
| resource_type | text | 불가 | — |  | 원본 |
| resource_id | text | 불가 | — |  | 원본 |
| slot | tstzrange | 불가 | — |  | 원본 |
| source_type | text | 불가 | — |  | 원본 |
| source_id | text | 불가 | — |  | 원본 |
| exclusive | boolean | 불가 | true |  | 원본 |

통합 필수 제약:

- 기존 복합키/EXCLUDE 유지; 모든 teacher/class/group/student/space 원본은 같은 school 참조를 검증
- 빈 자원에도 동일 정렬 resource-key 잠금을 사용. 공유 공간 용량은 잠금 아래 기간별 총량 재검사

통합 동작 규칙:

- 불가시간·명부변경·공간예약·배포·교환의 모든 작성 경로가 동일 잠금 규약 사용
- 원자 변경 실패는 어느 교사/학급 점유도 남기지 않음

필수 시험: TT01; TT02; TT19

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

시간표 · 기존 보강

열람: 학교 담당자는 지원 상태, 내부 증거는 운영 권한 범위

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
| operation_support | jsonb | 불가 | '{}'::jsonb | import_read/compose/manual_validate/daily_change별 designed/unsupported/verified 및 evidence_ref·engine/adapter/validator판 | 통합 추가 |

통합 필수 제약:

- operation_support는 허용 키/상태 스키마; verified는 실측 evidence_ref와 확인자/시각·엔진/검증판 필요
- 기존 support_state의 designed는 전체 지원완료가 아님; 새 엔진판에서 자동 계승하지 않음

통합 동작 규칙:

- 학교급 이름만으로 지원 판정하지 않음
- 미검증 운영형은 자동편성뿐 아니라 검증되지 않은 수동 배포/교환도 차단

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id) → workhub.schools(id)
- (verified_by_account_id) → workhub.accounts(id)

필수 시험: TT02; TT21

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

열람: 기존 exact 제출판 현재 ACL.

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
| answer_path | text[] | 불가 | — | 기존 단일 문항은 [field_key], 반복은 [group_key,row_key,field_key] | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): submission_files_pkey

이번 판에서 대체하는 인덱스(그대로 생성 금지): submission_files_pkey

통합 필수 제약:

- submission/schema/field 모두 동일 collection schema 복합 FK
- field_key=해당 field.key 및 kind=file
- 파일은 같은 학교 ready·hash/size 일치·정책 허용
- policy(scope_key,id) 복합 FK, file 목적별 허용 scope
- INSERT 시 submission.receipt_xid=pg_current_xact_id(); UPDATE/DELETE 금지
- (common_safety_policy_scope_key,common_safety_policy_version_id) MATCH FULL FK policy_versions(scope_key,id); scope_key=c
- PRIMARY KEY(submission_id,answer_path,file_object_id); UNIQUE(school_id,submission_id,answer_path,file_object_id). 기존 submission_files_pkey와 동명 backing index를 대체
- answer_path는 exact schema/답변 snapshot의 경로; 필드 ID/schema 학교 복합 FK 유지
- generated_output의 file ID/hash는 submission.output_artifact의 exact file과 일치

통합 동작 규칙:

- 현재 파일 읽기+목적 제출 권한+공개범위 상승 검사.
- 시각 now 동등성을 같은 transaction의 증거로 사용하지 않는다.
- 필수 파일 수/크기/형식 확인 뒤 접수 성공; 첨부 실패는 전체 rollback.
- 학교 파일은 공통하한+학교판을 모두 고정하고 현재 유효 두 정책과 당시 두 판의 허용 교집합만 사용. common/account_private는 동일 common판을 두 쌍에 기록. 한 정책의 차단도 옛 허용판으로 우회 금지.
- 신규 필드는 기존 행의 field_key로 명시 백필하는 계획만 정의하며 실제 SQL/백필 실행 금지.
- 접수와 같은 transaction에서 exact file/hash/정책 snapshot을 고정하고 이후 불변.

인덱스: (school_id,schema_id,field_id); (school_id,submission_id,answer_path)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,file_object_id) → workhub.file_objects(school_id,id)
- (school_id,submission_id) → workhub.submission_versions(school_id,id)

필수 시험: WF03; WF05; WF09; WF10; WF11; COL08; COL09; COL13; COL21

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

열람: 기존 exact 제출판 ACL. 이 FK가 원개인초안 전체나 다른 artifact 접근을 열지 않음.

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
| answer_snapshot_id | text | 허용 | — | workhub.collection_answer_snapshots.id · 정확한 동결 답변 | 통합 추가 |
| output_artifact_id | text | 허용 | — | workhub.collection_output_artifacts.id · 확인한 exact 파일 결합 | 통합 추가 |
| output_confirmation_id | text | 허용 | — | workhub.collection_output_confirmations.id · 실제 제출자 확인 | 통합 추가 |

통합 필수 제약:

- (school_id,unit_id,collection_id) FK collection_units
- (school_id,collection_id,schema_id,schema_version) FK collection_schemas
- (school_id,source_draft_id,unit_id,schema_id) FK unit_drafts
- UNIQUE(school_id,unit_id,id,schema_id)
- 계정=각 membership.account_id; source_draft shared이고 제출 actor 책임자/유효 delegate
- receipt_at 서버 clock_timestamp; date 마감 >=, time > 지연 검사
- withdrawn이면 review_state<>accepted AND external_state<>user_confirmed; exported만으로 공식처리 판정 금지
- (school_id,unit_id,schema_id,answer_snapshot_id) FK collection_answer_snapshots(school_id,unit_id,schema_id,id)
- (school_id,unit_id,schema_id,output_artifact_id) FK collection_output_artifacts(school_id,unit_id,schema_id,id)
- (school_id,output_artifact_id,answer_snapshot_id) FK collection_output_artifacts(school_id,id,answer_snapshot_id)
- (school_id,unit_id,schema_id,output_artifact_id,output_confirmation_id) FK collection_output_confirmations(school_id,unit_id,schema_id,artifact_id,id)
- 기존 일반 수합은 세 연결 NULL 가능; 신규 양식수합은 셋 모두 NN, 부분 NULL 불가
- submission.answers/schema/draft version과 exact snapshot 일치, confirmation actor=current actual submitter 계정 일치

통합 동작 규칙:

- 본문·정의판·실제제출자·당시책임자·마감/모드 snapshot·receipt_xid 불변.
- JSON 답변 submit 검사 필수, 알 수 없는 key·형식·필수 누락 거부.
- new판 external_state unknown, none not_required/required pending. 정정은 이전판+공백 아닌 사유.
- cmd_submit에서 현재 source draft·unit/schema·안전 파일·확인 지문·현재 책임자/대리 재검사 후 제출/첨부/current/effective/receipt/outbox 원자.
- output ready/AI 대화 완료/다운로드는 제출이 아니며 지연 계산은 기존 서버 접수시각만.
- 기존 review/correction/withdraw/late/current/effective 전이 유지.
- 개인초안에서 공동 제출용으로 복사할 때 새 shared draft snapshot/artifact/confirmation 필요; 개인 artifact 직접 공유 접수 금지.

인덱스: (school_id,unit_id,version_no DESC); (school_id,collection_id,receipt_at,id); (school_id,output_artifact_id) WHERE output_artifact_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,external_state_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,submitted_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id,correction_of_id) → workhub.submission_versions(school_id,unit_id,id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)
- (school_id,withdrawn_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,unit_id,correction_request_id) → workhub.correction_requests(school_id,unit_id,id)

필수 시험: WF02; WF03; WF06; WF08; WF09; WF15; COL09; COL10; COL11; COL12; COL13; COL20

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

학생·평가·생기부 · 기존 보강

열람: 기존 학기 읽기 범위 유지; 포인터는 전용 관리자 확정 명령만 변경

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
| current_timetable_basis_id | text | 허용 | — | workhub.timetable_basis_revisions.id · 학기 전체 snapshot의 최신 관리자 확정판. 날짜별 적용표의 포인터가 아니며 미확정이면 NULL | 통합 추가 |

통합 필수 제약:

- FOREIGN KEY(school_id,current_timetable_basis_id,id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- 기존 UNIQUE(school_id,id) 유지. 포인터 갱신은 term 잠금+expected version 조건으로 version 증가

통합 동작 규칙:

- 시간표 담당자·AI는 포인터 직접 UPDATE 금지
- 현재 포인터판의 원본 지문이 바뀌면 stale; 자동으로 새 기준판을 만든 것으로 처리하지 않음
- 모든 basis판은 해당 term 전체 기간을 포함하므로 대상 날짜별로 다른 기준판을 추측해 고르지 않는다. 배포판은 당시 basis를 고정하고 조회는 timetable_versions의 효력기간을 사용한다.

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,academic_year_id) → workhub.academic_years(school_id,id)

필수 시험: TT04; TT05; TT06

## workhub.timetable_basis_change_requests

시간표 · 신규

열람: 현재 해당 학교 기준자료 관리자와 요청한 시간표 담당자만 조회. 요청자는 미적용 요청 철회, 관리자는 검토만 전용 명령으로 처리.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 관리자 기준자료 수정요청 ID · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 · 생성 후 불변 | 통합 추가 |
| term_id | text | 불가 | — | workhub.terms.id · 학기 · 생성 후 불변 | 통합 추가 |
| base_basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 신청자가 본 정확한 기본자료판 · 생성 후 불변 | 통합 추가 |
| requested_by_membership_id | text | 불가 | — | workhub.memberships.id · 현재 시간표 담당 신청자 · 생성 후 불변 | 통합 추가 |
| proposed_changes | jsonb | 불가 | — | 허용 entity/field/현재값/제안값의 목록. 임의 JSON path·SQL 실행 불가 · 생성 후 불변 | 통합 추가 |
| proposal_sha256 | text | 불가 | — | 기준판·제안·사유를 정규화한 서버 지문 · 생성 후 불변 | 통합 추가 |
| reason | text | 불가 | — | 수정 사유. 복무 상세 등 불필요한 민감정보는 제외 · 생성 후 불변 | 통합 추가 |
| state | text | 불가 | 'requested' | 요청/검토/반영/반려/철회/새 요청 대체 | 통합 추가 |
| reviewed_by_membership_id | text | 허용 | — | workhub.memberships.id · 기준자료 확정 권한을 가진 검토자 | 통합 추가 |
| reviewed_at | timestamptz | 허용 | — | 검토 결정 시각 | 통합 추가 |
| review_note | text | 허용 | — | 안전한 검토 사유 | 통합 추가 |
| resolved_basis_revision_id | text | 허용 | — | workhub.timetable_basis_revisions.id · 실제 반영 완료된 새 기준자료판 | 통합 추가 |
| created_at | timestamptz | 불가 | now() | 신청 시각 · 생성 후 불변 | 통합 추가 |
| updated_at | timestamptz | 불가 | now() | 현재 상태 갱신 시각 | 통합 추가 |
| version | integer | 불가 | 1 | 조건부 상태 변경 버전 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(school_id,id,term_id)
- FOREIGN KEY(school_id,term_id) REFERENCES workhub.terms(school_id,id)
- FOREIGN KEY(school_id,base_basis_revision_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- FOREIGN KEY(school_id,resolved_basis_revision_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- FOREIGN KEY(school_id,requested_by_membership_id) REFERENCES workhub.memberships(school_id,id)
- FOREIGN KEY(school_id,reviewed_by_membership_id) REFERENCES workhub.memberships(school_id,id)
- CHECK(state IN requested,in_review,applied,rejected,withdrawn,superseded); CHECK(version>=1); proposal_sha256 64자리 소문자 hex
- applied일 때만 resolved_basis_revision_id 필수, 다른 상태에서는 NULL; applied/rejected에는 reviewed_by와 reviewed_at 필수
- applied의 해결판은 동일 term에서 base보다 새로운 판이며 원본 변경·새판 확정과 같은 커밋; 기존판 승인 재사용 금지
- proposed_changes는 참조 ID·허용 field key·타입·현재값을 검증, client가 임의 원본/권한필드를 수정하도록 실행하지 않음
- 상태·검토필드 외 본문/학교/학기/신청자/기준판 불변; 수정은 새 요청

통합 동작 규칙:

- timetable 담당자는 요청만; 관리자 검토 후 기존 원본 명령 경로를 통해 수정
- 원본이 미리 바뀌었거나 기준판이 최신이 아니면 자동 적용하지 않고 diff를 보여 주며 새 요청/새 확인 요구
- requested→in_review→applied/rejected; 미적용 상태→withdrawn 또는 superseded; 종결 상태 부활 금지
- 일반 교사용 알림에는 요청 본문을 복제하지 않음

인덱스: idx_timetable_basis_requests_pending(school_id,term_id,state,created_at); idx_timetable_basis_requests_requester(school_id,requested_by_membership_id,created_at DESC)

필수 시험: TT04; TT05; TT06

## workhub.timetable_basis_revisions

시간표 · 신규

열람: 현재 학교의 기준자료 확정/시간표 담당 capability만 최소 범위 조회. 일반 교사는 배포 DTO만, 브라우저 직접 쓰기 금지.

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | gen_random_uuid()::text | 확정된 기본자료판 ID · 생성 후 불변 | 통합 추가 |
| school_id | text | 불가 | — | workhub.schools.id · 학교 · 생성 후 불변 | 통합 추가 |
| term_id | text | 불가 | — | workhub.terms.id · 대상 학기 · 생성 후 불변 | 통합 추가 |
| revision_no | integer | 불가 | — | 학기 잠금 아래 증가하는 기본자료판 순번 · 생성 후 불변 | 통합 추가 |
| based_on_id | text | 허용 | — | workhub.timetable_basis_revisions.id · 동일 학교·학기의 이전 기준판 · 생성 후 불변 | 통합 추가 |
| schema_version | text | 불가 | — | 검증된 snapshot 스키마판 · 생성 후 불변 | 통합 추가 |
| valid_from | date | 불가 | — | 학교 현지 학기 전체 시작일, 포함. 부분기간 기준자료판은 사용하지 않음 · 생성 후 불변 | 통합 추가 |
| valid_to | date | 불가 | — | 학교 현지 학기 전체 종료일의 exclusive 경계. 부분기간 기준자료판은 사용하지 않음 · 생성 후 불변 | 통합 추가 |
| timezone | text | 불가 | — | 확인된 학교 IANA 시간대 · 생성 후 불변 | 통합 추가 |
| snapshot | jsonb | 불가 | — | 허용 스키마의 명부·시수·배정·일과·공간·참여 충돌 최소 사본 · 생성 후 불변 | 통합 추가 |
| snapshot_sha256 | text | 불가 | — | 서버가 정규화 snapshot에서 계산한 지문 · 생성 후 불변 | 통합 추가 |
| source_manifest_sha256 | text | 불가 | — | source 종류/ID/판 또는 정렬 지문/기간을 고정한 서버 지문 · 생성 후 불변 | 통합 추가 |
| confirmed_by_membership_id | text | 불가 | — | workhub.memberships.id · 기본자료 확정 권한을 행사한 활성 소속 · 생성 후 불변 | 통합 추가 |
| confirmed_at | timestamptz | 불가 | now() | 확정 시각 · 생성 후 불변 | 통합 추가 |
| created_at | timestamptz | 불가 | now() | 생성 시각 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- PRIMARY KEY(id); UNIQUE(school_id,id); UNIQUE(school_id,id,term_id); UNIQUE(school_id,term_id,revision_no)
- FOREIGN KEY(school_id,term_id) REFERENCES workhub.terms(school_id,id)
- FOREIGN KEY(school_id,confirmed_by_membership_id) REFERENCES workhub.memberships(school_id,id)
- FOREIGN KEY(school_id,based_on_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- CHECK(revision_no>0 AND valid_from<valid_to); [valid_from,valid_to)=정규화된 해당 학기 전체 기간; source와 snapshot 지문은 64자리 소문자 hex
- 행은 확인된 불변판만 존재한다. 필수 승인·검사 누락 INSERT 거부, UPDATE/DELETE는 공통 보존·파기 전용 절차 외 금지
- snapshot JSON Schema와 허용 source kind 검증; 모든 school/term/teacher/class/course/assignment/bell/space/participation 참조는 원본 존재·학교·학기·기간·승인을 검증하는 FK 동등 제약 트리거; source 삭제는 보존 정책과 영향 검사 없이 허용하지 않음
- snapshot 저장 시 원본 잠금/지문 재검사; terms 포인터·receipt·감사와 같은 커밋

통합 동작 규칙:

- 공식 자료 원본은 기존 academic_classes/course_groups/course_group_teachers/assignments 등이며 snapshot은 확정 당시 재현용
- revision_no는 term 잠금으로 할당; 이후 새판이 생겨도 이전 snapshot을 덮어쓰지 않음
- 확정 담당은 관리자 capability; timetable.compose만 가진 교사는 생성 불가
- 학생 실명·상담·개인 사유 원문은 snapshot에서 제외; 과거 재현에 필요한 최소 불변 ID/참여 충돌만 저장
- AI prompt에는 전체 snapshot을 자동 전송하지 않고 필요한 비식별 조건 DTO만 전달
- 새 확정판은 현재 배포 시간표를 자동 변경하지 않음
- 한 판은 학기 전체의 기간별 원본 관계를 포함한다. terms.current_timetable_basis_id는 가장 최근 관리자 확정판이며 특정 날짜의 배포표 선택 포인터가 아니다. 부분기간만 수정해도 전체 학기 snapshot의 새판을 생성한다.

인덱스: idx_timetable_basis_term_latest(school_id,term_id,revision_no DESC); idx_timetable_basis_confirmed_by(school_id,confirmed_by_membership_id,confirmed_at DESC)

필수 시험: TT04; TT05; TT06; TT23

## workhub.timetable_candidates

시간표 · 기존 보강

열람: 시간표 담당자만 초안 조회·변경명령; 일반 교사는 배포판만

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
| basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 수동 후보도 반드시 고정하는 관리자 기준자료판 · 생성 후 불변 | 통합 추가 |
| constraint_set_id | text | 불가 | — | workhub.constraint_sets.id · 검증할 잠금 조건판 · 생성 후 불변 | 통합 추가 |
| label | text | 불가 | — | 담당자에게 보이는 편성안 이름 · 생성 후 불변 | 통합 추가 |
| validation_state | text | 불가 | 'not_checked' | not_checked/valid/invalid/stale | 통합 추가 |
| validation_report | jsonb | 허용 | — | 구조화 충돌/경고·판/지문 보고. 개인 사유 최소화 | 통합 추가 |
| validator_version | text | 허용 | — | 실제 검사한 독립 검증기판 | 통합 추가 |
| locked_placements | jsonb | 불가 | '[]'::jsonb | 회차키·위치·배치지문을 포함한 고정 목록 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- FOREIGN KEY(school_id,basis_revision_id) REFERENCES workhub.timetable_basis_revisions(school_id,id)
- FOREIGN KEY(school_id,constraint_set_id) REFERENCES workhub.constraint_sets(school_id,id)
- basis와 constraint의 term/basis 일치; composition이 있으면 동일 term/basis/constraint
- validation_state=valid이면 hard_ok=true, validated_sha256/validated_at/validator_version/report 필수; report는 actual placements/기준판/조건/달력지문을 고정
- placements/locked_placements/label/derived_from 불변; 변경은 새 candidate. 검증필드만 전용 검사명령으로 갱신; current 입력 불일치면 stale
- candidate derived_from은 같은 school·term이며 cycle 금지. 다른 basis에서 파생할 때 명시 재매핑·신규검증 필수

통합 동작 규칙:

- 충돌 초안 저장 허용, invalid/stale/not_checked 배포 금지
- 기존 placements/placements_sha256/derived_from_id 사용
- 교사 변경과 위치 변경을 따로 계산; 구조 변경에 이전 unit 순번 재활용 금지
- 고정해제·부분재생성도 정확한 전후 후보 지문 확인

인덱스: idx_timetable_candidates_basis(school_id,basis_revision_id,created_at DESC); idx_timetable_candidates_condition(school_id,constraint_set_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,composition_id) → workhub.timetable_compositions(school_id,id)
- (school_id,created_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,derived_from_id) → workhub.timetable_candidates(school_id,id)

필수 시험: TT10; TT11; TT12; TT13

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

시간표 · 기존 보강

열람: 본인 응답 가능, 당사자에게 응답 상태만, 사유는 목적별 공개

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
| bound_participants_sha256 | text | 불가 | — | 응답이 묶인 필수 참여자 전체 집합 지문 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- 기존 school/change_set/membership FK 유지. bound_candidate_sha256/bound_base_snapshot_sha256/bound_participants_sha256 모두 부모와 일치해야 응답 채택
- 요청자는 전체후보 제출로 정확한 판의 본인 동의를 남김. 무응답/단순 메시지 읽음은 accepted가 아님
- 동의·거절·최종 승인자는 실제 JWT account로 판정. 관리자가 타인을 대신해 consent UPDATE 금지
- 확정 시 참여자 명단은 서버가 실제 수업/교사에서 재계산; 누락한 참여자가 있으면 거부

통합 동작 규칙:

- 응답 상태변경은 expected version 명령과 감사 사용
- 내용이 바뀐 새 요청은 전원 새 동의 필요

인덱스: idx_timetable_participants_pending(school_id,membership_id,response,updated_at DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,change_set_id,requested_by_membership_id) → workhub.timetable_change_sets(school_id,id,requested_by_membership_id)
- (school_id,membership_id) → workhub.memberships(school_id,id)

필수 시험: TT16; TT17; TT18; TT19

## workhub.timetable_change_sets

시간표 · 기존 보강

열람: 당사자는 자신의 요청/동의에 필요한 최소 정보, 담당자는 지정 범위, 상세 복무사유 별도 보호

| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |
|---|---|---|---|---|---|
| id | text | 불가 | (gen_random_uuid())::text |  | 원본 |
| school_id | text | 불가 | — |  | 원본 |
| term_id | text | 불가 | — |  | 원본 |
| kind | text | 불가 | — |  | 원본 |
| state | text | 불가 | 'draft' | draft/awaiting_consent/ready_for_approval/applied/rejected/withdrawn/expired/superseded. 기존 상태는 검증된 명시 매핑으로 전환 | 통합 변경 |
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
| supersedes_change_set_id | text | 허용 | — | workhub.timetable_change_sets.id · 미적용 제안 변경 시 대체한 이전 요청 · 생성 후 불변 | 통합 추가 |
| expires_at | timestamptz | 불가 | — | 동의·승인 가능 기한 | 통합 추가 |
| required_participants_sha256 | text | 불가 | — | 서버가 계산한 실제 필수 참여자·역할 집합 지문 · 생성 후 불변 | 통합 추가 |
| approval_policy_version | text | 불가 | — | 전원동의·최종승인·대리승인 기준 정책판 · 생성 후 불변 | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): timetable_change_sets_state_check

통합 필수 제약:

- FOREIGN KEY(school_id,supersedes_change_set_id) REFERENCES workhub.timetable_change_sets(school_id,id)
- 동일 학교·학기 대체만; 자기참조/cycle 금지; 후보/기준/대상/내용 변경은 새 change_set이며 이전 동의 가져오기 금지
- state는 draft/awaiting_consent/ready_for_approval/applied/rejected/withdrawn/expired/superseded로 정규화; 기존 상태는 전환 명세 작성 후 승인된 이관에서 매핑
- expires_at>created_at, 승인 시 현재시각<expires_at; applied에는 applied_by/at와 원자 변경 결과 필수
- 필수 참여자 서버 계산 지문 일치, 전원 유효 consent, 자기 account 최종승인 금지, 모든 기대 lesson판/권한/가용성 재검사
- 후보/기준/필수참여자/정책판은 draft를 떠난 뒤 불변; 변경은 supersedes 새 요청

통합 동작 규칙:

- 한 사람이 거절/만료/소속종료하면 전체 applied 불가
- 최종 승인과 반영을 같은 명령으로 처리; 오래 유지되는 승인대기 적용 창을 만들지 않음
- applied 취소는 reverts_change_set_id를 가진 현재판 역변경. 후속 변경/실시 보존
- 기존 awaiting_peers→awaiting_consent, awaiting_approval→ready_for_approval. 기존 reverted는 삭제하지 않고 적용 원장/역변경 연결을 검증해 applied+reverts 관계로 표현한다. 이력 없는 reverted는 수동 검토로 보류한다.

인덱스: idx_timetable_changes_actionable(school_id,state,expires_at); idx_timetable_changes_supersedes(school_id,supersedes_change_set_id) WHERE supersedes_change_set_id IS NOT NULL

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,applied_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,base_timetable_version_id) → workhub.timetable_versions(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,reverts_change_set_id) → workhub.timetable_change_sets(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

필수 시험: TT01; TT03; TT16; TT17; TT18; TT19; TT20

## workhub.timetable_compositions

시간표 · 기존 보강

열람: 현재 시간표 담당자와 해당 job principal의 최소 범위

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
| status | text | 불가 | 'queued' | 작업 실행상태 queued/running/completed/failed/cancelled. 탐색 결과는 result_kind | 통합 변경 |
| optimality | text | 불가 | 'unknown'::text |  | 원본 |
| limit_reached | boolean | 허용 | — |  | 원본 |
| diagnostics | jsonb | 허용 | — |  | 원본 |
| job_id | text | 허용 | — |  | 원본 |
| requested_by_membership_id | text | 불가 | — |  | 원본 |
| created_at | timestamp with time zone | 불가 | now() |  | 원본 |
| finished_at | timestamp with time zone | 허용 | — |  | 원본 |
| updated_at | timestamp with time zone | 불가 | now() |  | 원본 |
| version | integer | 불가 | 1 |  | 원본 |
| basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 실행 당시 기준자료판 · 생성 후 불변 | 통합 추가 |
| calendar_sha256 | text | 불가 | — | 실행이 사용한 학사일정·일과 지문 · 생성 후 불변 | 통합 추가 |
| adapter_version | text | 불가 | — | 정규 입력을 엔진으로 바꾼 검증된 adapter판 · 생성 후 불변 | 통합 추가 |
| result_kind | text | 허용 | — | 실행 완료 결과; 실행 진행 상태와 별개 | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): timetable_compositions_status_check, tt_compositions_finished, tt_compositions_limit_known, tt_compositions_proven, tt_compositions_infeasible_proof, tt_compositions_unresolved_limit

통합 필수 제약:

- FOREIGN KEY(school_id,basis_revision_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- 부모 constraint_set이 같은 term/basis이며 locked. input_sha256는 실제 input_file 또는 보존된 정규 입력을 해시한 값
- status IN queued/running/completed/failed/cancelled; result_kind는 NULL 또는 feasible/optimal/infeasible/unresolved/invalid_input/unsupported/internal_error/cancelled
- queued/running ⇒ result_kind NULL AND finished_at NULL AND limit_reached NULL AND optimality=unknown
- completed ⇒ result_kind IN feasible/optimal/infeasible/unresolved AND finished_at NN AND limit_reached NN
- failed ⇒ result_kind IN invalid_input/unsupported/internal_error AND finished_at NN AND limit_reached NULL AND optimality=unknown
- cancelled ⇒ result_kind=cancelled AND finished_at NN AND limit_reached NULL AND optimality=unknown
- result_kind=optimal ⇔ optimality=proven; optimal이면 검증후보>=1 AND limit_reached=false AND diagnostics의 증명범위=전체 입력
- result_kind=feasible ⇒ 검증후보>=1 AND optimality=unknown; limit_reached는 실제 한도 도달 여부
- result_kind=infeasible ⇒ limit_reached=false AND optimality=unknown AND diagnostics의 해당 전체 입력 불가능 증명 근거 필수
- result_kind=unresolved ⇒ optimality=unknown AND diagnostics.outcome_reason NN; limit_reached는 실제 한도도달 여부이며 false라도 해결/불가능 증명 없음을 표시
- 종료시각 조건은 status와 완전 동치로 적용; 기존 status 중심 5개 보조 CHECK는 새 진리표 계약으로 대체

통합 동작 규칙:

- status와 result_kind 분리; 기존 solver_version/seed/time_limit_ms/job 재사용
- 작업 완료의 stale 결과는 자동 배포하지 않음
- 외부 AI/solver 호출 동안 DB 잠금 유지하지 않음; jobs fencing으로 늦은 결과 차단
- 기존 feasible 중 optimality=proven은 completed/optimal, 나머지는 completed/feasible. infeasible/unresolved는 completed/동명 result_kind. 기존 failed는 진단에 따라 failed/invalid_input 또는 unsupported 또는 internal_error로 분류하며 근거 없으면 internal_error. cancelled는 양쪽 cancelled. 이전 결과/진단/시각 이력 보존.

인덱스: idx_timetable_compositions_basis(school_id,basis_revision_id,created_at DESC)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,constraint_set_id) → workhub.constraint_sets(school_id,id)
- (school_id,input_file_id) → workhub.file_objects(school_id,id)
- (school_id,job_id) → workhub.jobs(school_id,id)
- (school_id,requested_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)
- (school_id,base_version_id) → workhub.timetable_versions(school_id,id)

필수 시험: TT08; TT09; TT10; TT25

## workhub.timetable_constraints

시간표 · 기존 보강

열람: 조건판 담당자 범위; 사유는 목적별 최소 공개

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
| engine_support | text | 불가 | 'unknown' | 현재 engine/adapter에서의 supported/unsupported/unknown; 기존 partial은 unknown으로 재검증 | 통합 변경 |
| source_basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 해석의 기준자료판 | 통합 추가 |
| interpretation_schema_version | text | 불가 | — | 형식과 대상/기간을 검사한 조건 스키마판 | 통합 추가 |
| excluded_from_run | boolean | 불가 | false | 미지원 선호를 담당자가 명시 제외했는지 | 통합 추가 |
| exclusion_reason | text | 허용 | — | 이번 실행에서 제외한 사유 | 통합 추가 |

이번 판에서 대체하는 원본 제약(그대로 적용 금지): timetable_constraints_engine_support_check

통합 필수 제약:

- FOREIGN KEY(school_id,source_basis_revision_id) REFERENCES workhub.timetable_basis_revisions(school_id,id)
- 부모 constraint_set의 basis와 같아야 함; params 대상 ID·kind·기간·strength의 허용 스키마를 서버와 제약 트리거에서 검사
- engine_support 기본값은 unknown, 값은 supported/unsupported/unknown. 엔진/adapter판에 대한 검사 없이 supported 기록 금지
- excluded_from_run이면 strength=soft이고 확인자/확인시각/사유 필수. hard의 명시 제외도 금지
- 학교 날짜 applies_from/to는 [from,to); 기간제약은 해당 기준자료판 기간 안. strength IN(hard,school_hard)이면 weight NULL, soft의 weight는 확인된 허용범위
- 기존 strength enum hard/school_hard/soft 유지. 필수조건 predicate는 hard와 school_hard 모두 포함. excluded_from_run은 soft만 허용.

통합 동작 규칙:

- 자료 안 프롬프트 명령을 조건이나 도구 권한으로 채택하지 않음
- confirmed 불가시간은 선호 편집으로 완화 불가
- 미확인/미지원 필수조건은 생성 차단
- 기존 partial은 unknown으로 재검증한다. 과거 supported도 엔진/adapter판 근거가 없으면 unknown으로 전환한다. 이전값·전환사유 이력은 보존한다.
- 화면의 필수조건은 hard와 school_hard를 포함. school_hard는 학교 규칙·확정 불가시간에서 온 필수조건으로 담당자의 soft 전환/제외를 허용하지 않음. 근거 원본의 승인 절차를 거친 새판만 반영.

인덱스: idx_timetable_constraints_basis(school_id,source_basis_revision_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,confirmed_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,constraint_set_id) → workhub.constraint_sets(school_id,id)

필수 시험: TT07; TT08; TT09; TT23

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

시간표 · 기존 보강

열람: 현재 학교 교사는 배포된 안전한 DTO만; 내부 근거/후보는 담당자

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
| basis_revision_id | text | 불가 | — | workhub.timetable_basis_revisions.id · 배포한 기준자료판 · 생성 후 불변 | 통합 추가 |
| calendar_sha256 | text | 불가 | — | 확정 때 검증한 실제 적용 기간 달력/일과 지문 · 생성 후 불변 | 통합 추가 |

통합 필수 제약:

- FOREIGN KEY(school_id,basis_revision_id,term_id) REFERENCES workhub.timetable_basis_revisions(school_id,id,term_id)
- source_candidate와 school/term/basis 동일; 모든 원본·조건·배포영향의 지문 재검사
- 동일 학교·학기에 적용되는 공개판 [effective_from,effective_to) 겹침 금지. 새판 전환의 기존 기간 경계 변경은 감사/이력 남김
- 이미 실시한 lesson과 학생 자료 관계는 변경/삭제 금지; unresolved timetable_version_impacts가 있으면 배포 차단
- 부분 기간 대체 시 기존 유효구간의 앞/뒤 잔여 구간을 함께 원자 보존한다. 한 행으로 비연속 기간 표현 금지; 필요한 뒤 복원판은 새 version/candidate와 독립검증으로 생성.

통합 동작 규칙:

- 기존표·미래 교환·새표 영향을 전부 검토하여 원자 반영
- 공개판과 lesson/occupancy/receipt/audit/outbox는 동일 최종 커밋; 큰 준비 작업의 staging은 비공개
- 효력기간과 실제 날짜 변경 분리
- 예: 기존 [9/1,1/1)에서 [11/1,12/1)을 대체하면 앞 [9/1,11/1), 새 [11/1,12/1), 뒤 [12/1,1/1) 총3구간. 뒤 복원판도 현재 기준자료/달력/승인 미래변경으로 재검증; 불가능하면 전체 배포 보류. 과거 실시판과 참조는 보존.

인덱스: idx_timetable_versions_basis(school_id,basis_revision_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (school_id,base_version_id) → workhub.timetable_versions(school_id,id)
- (school_id,published_by_membership_id) → workhub.memberships(school_id,id)
- (school_id,source_candidate_id) → workhub.timetable_candidates(school_id,id)
- (school_id,term_id) → workhub.terms(school_id,id)

필수 시험: TT01; TT03; TT14; TT15; TT22

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

열람: 기존 개인/공동 현재 구성원 ACL 유지; collector에게 초안 존재·건수·파일명·AI 결과 비공개.

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
- UNIQUE(school_id,id,unit_id,schema_id) 보장; 기존 개인/공동 초안 유일키·schema 불변 계약 유지
- answers 반복행/조건식은 exact schema의 validator로 검사; generated_output 문항의 값을 클라이언트가 임의 설정할 수 없음

통합 동작 규칙:

- 답변 JSON object·허용 key/type/범위 검사, draft는 필수 누락 허용.
- 새 schema는 새 draft ID; 명시 변환·개인→공유 복사, 자동 합치기 없음.
- 현재 유효 구성원과 expected_version 재검사.
- AI 제안/직접 입력은 같은 version 원장 사용. AI 제안 반영도 expected_version 검사.
- 초안 변경은 관련 ready artifact를 현재판용으로 stale 계산하며 기존 artifact의 파일/답변은 수정하지 않는다.
- validator phase=draft/prepare_output/submit: prepare_output은 generated_output 누락을 허용, submit은 exact 생성파일 typed 관계를 필수 검사.

인덱스: (school_id,unit_id,schema_id)

기존 FK 관계(변경 계약과 충돌하면 대체):

- (owner_account_id) → workhub.accounts(id)
- (school_id,unit_id) → workhub.collection_units(school_id,id)
- (updated_by_account_id) → workhub.accounts(id)

필수 시험: WF01; WF03; WF15; COL04; COL05; COL09; COL12

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
