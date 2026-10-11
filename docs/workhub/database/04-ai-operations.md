# 04. 학교 지식·Claude·긴 작업·인계·보존 설계

> 2026-10-11 · **구축을 위한 설계안**. SQL 실행본이 아니다. 모델·키·비용·보존기간을 확정하거나 변경하지 않았다. 공통 기반은 [01](01-foundation-security-migration.md), 파일·문서는 [02](02-workflows-documents.md), 학생 근거는 [03](03-students-integrations.md)를 따른다.

## 1. 적용 순서와 표기

- **R0:** 현재 일정·개인 업무의 검증된 계약을 계승. 본 문서의 미래 표를 모두 생성하지 않는다.
- **R1:** 수합·파일 도입과 함께 필요한 command_receipts, audit, jobs/job_attempts, outbox, handovers/handover_items, 보존·파기 관리부터 도입한다.
- **R2:** 학생·수업 앱의 불변 근거를 03의 계약으로 연결한다.
- **R3:** 지식·Claude·문서 생성·평가·생기부 연결 시 나머지 표를 도입한다.
- **E:** 학교와 독립한 순수 개인 공간은 별도 이용 자격 정책을 확정한 뒤 도입한다. 현재 학교 소속 개인 할 일을 개인 공간으로 자동 옮기지 않는다.

**범위 공통 필드:** `scope_type/school_id?/scope_key` 묶음의 school_id는 school일 때 필수, common일 때 반드시 NULL이다. scope_key는 common 또는 school/ID인 DB 생성 열이다. 모든 범위형 표에 UNIQUE(scope_key,id), scope_type·school_id의 CHECK를 적용한다. 선택 공통 참조는 각 참조 전용 scope 열+ID의 MATCH FULL FK와 동시 NULL/존재 CHECK를 사용한다. 학교 전용 표가 공통 실행 표를 참조할 때는 생성 school_scope_key로 연결한다.

아래 모든 이름에 `public.workhub_`를 붙인다. `id`는 TEXT PK, 신규 기본값은 `gen_random_uuid()::text`다. `?`만 NULL 허용, 나머지 필드는 NOT NULL이다. `time`은 timestamptz, `date`는 date, `json`은 크기·버전·키를 검사하는 jsonb다. enum은 TEXT+CHECK로 구현한다. 각 표는 RLS를 켜고 브라우저 직접 쓰기 권한을 주지 않는 것을 기본으로 한다.

학교 전용 표에는 `school_id TEXT FK schools`, `UNIQUE(school_id,id)`를 둔다. 같은 학교의 참조는 `(school_id, target_id)` 복합 FK다. user_id는 기존 public.users를 가리키며 회원을 복제하지 않는다. 학교 내 개인 자료는 현재 유효 소속과 소유 계정을 함께 검사한다. 본 문서의 AI 대화·기억은 생성 당시 owner_member_id에 묶고 자동 재임용 이관은 하지 않는다. 학생 원본의 소유자는 03의 owner_user_id이며, 과거 작성 소속 ID와 현재 소속 ID가 같아야 한다고 잘못 검사하지 않는다.

가변 헤더는 `version bigint NOT NULL DEFAULT 1 CHECK(version>0), created_at time DEFAULT now(), updated_at time DEFAULT now()`를 사용한다. 불변 판/행위는 `created_at time DEFAULT now()`와 필요한 revision을 두고 일반 UPDATE·DELETE를 금지한다. 삭제 절차만 허용된 본문 가림/파기를 하며 최소 tombstone을 남긴다. FK는 명시 없는 CASCADE 대신 RESTRICT다.

## 2. 지식: 원본·효력·게시·색인 분리

| 표 / 단계 | 주요 열 | 관계·제약·인덱스 |
|---|---|---|
| knowledge_sources / R3 | id, scope_type:school/common, school_id?, title text, kind text, school_type?, jurisdiction?, owner_member_id?, visibility:school/audience/private/common, audience_set_id?, version, created_at, updated_at | school이면 school_id/owner_member_id 필수, common이면 둘 다 NULL. 학교 원본을 common으로 UPDATE 금지. scope_key generated로 common 또는 school/ID를 만들고 UNIQUE(scope_key,id). 같은 범위 제목 중복은 허용. school 자료의 audience_set_id는 학교복합FK; private는 작성자만, common scope는 visibility=common 고정 |
| knowledge_revisions / R3 | id, source_id, scope_type/school_id?/scope_key, revision int, file_id?, inline_text?, content_hash text, effective_from date, effective_until date?, academic_year?, publication_state:draft/review/published/withdrawn, extraction_state:pending/ready/partial/failed, reviewed_by_user_id?, reviewed_at?, published_at?, withdrawn_at?, version | FK(scope_key,source_id)→sources. file와 직접본문 중 정확히 하나. UNIQUE(scope_key,source_id,revision). 기간 종료제외; 종료>시작. 원본문/지문은 불변, 게시상태만 전용명령으로 변경. INDEX(scope_key,source_id,effective_from,effective_until,publication_state) |
| knowledge_chunks / R3 | id, scope_type/school_id?/scope_key, revision_id, ordinal int, locator json, text text, text_hash text, index_state:pending/ready/failed, extraction_version text | FK(scope_key,revision_id)→revisions. UNIQUE(scope_key,revision_id,ordinal). locator는 page/article/paragraph/table/row 등 원문위치. 원문 변경은 새 chunk. GIN 검색문서 인덱스는 실제 한국어 검색 품질 시험 후 채택 |
| knowledge_conflicts / R3 | id, scope_type/school_id?/scope_key, first_revision_id, second_revision_id, reason_code text, state:open/resolved/dismissed, resolved_by_user_id?, resolution_note?, created_at, resolved_at? | 같은 범위 판의 FK, 두 ID가 다름. UNIQUE(scope_key,정렬된 두 판 ID,reason_code). 서로 다른 scope의 상충은 조회 결과에서 일시 비교하며 원문을 교차학교 기록으로 복사하지 않음 |
| embedding_profiles / R3 선택 | id, provider text, model text, dimensions int, input_policy_version text, enabled bool, created_at | UNIQUE(provider,model,dimensions,input_policy_version), dimensions>0. API 키는 저장하지 않음. 승인된 모델만 서버 설정과 일치 |
| knowledge_embeddings / R3 선택 | id, scope_type/school_id?/scope_key, chunk_id, profile_id, input_hash text, vector_value vector, state:queued/ready/failed, indexed_at? | FK(scope_key,chunk_id)→chunks, profile FK. UNIQUE(scope_key,chunk_id,profile_id). 저장 벡터 차원은 profile과 일치하도록 trigger/전용 writer 검사. 인덱스는 profile별 차원과 연산자를 맞춰 생성; 다른 모델 벡터 혼합 금지 |

`scope_key`는 클라이언트 입력을 믿는 문자열이 아니라 DB에서 scope_type과 school_id로 생성한다. 공유 가능한 공통 자료라는 이유로 `school_id=NULL`이면 공개라고 처리하지 않는다. 공통 지식의 게시 권한은 학교 관리자와 다른 서비스 게시 권한이며, 학교 자료를 공통화하려면 원본 권리·범위를 별도 검토한다.

학교 지식의 scope와 읽기 ACL은 별개다. school scope에서도 visibility=private이면 작성자만, audience이면 승인된 대상만 읽는다. 학교 게시자/관리자에게 private 원문 열람을 부여하지 않는다. 비공개 초안을 공유 자료로 제안하는 행동은 별도 공개범위 확인을 받고 새 게시판을 만든다. 학생 관찰·상담은 학교 공용 지식 색인에 넣지 않는다.

학교 파일은 `(school_id,file_id)`로, 공통 파일은 02의 명시적 common 경로로 검사한다. 파일과 source의 범위 불일치는 DB writer가 거부한다. 직접 입력 본문도 파일과 같은 보존·권한 정책을 따른다.

**검색 함수의 필수 순서**

1. auth 계정·현재 학교/소속·자료 읽기 범위를 검사한다. 질문의 기준일은 서버 검증된 명시적 date다.
2. 해당 범위와 기준일에 게시·시행 중인 판을 고른다. 미래판을 올렸다고 현행판을 덮어쓰지 않는다.
3. 학교급·지역·학년도·대상 조건을 제한한 후보에서 검색한다. 같은 효력 범위에서 상충하는 판은 자동 우열 판정하지 않고 충돌과 원문을 제시한다.
4. 검색 결과를 반환하기 직전에 원본의 게시·철회·접근 상태를 다시 검사한다. 지연된 색인·캐시가 권한을 만들지 않는다.
5. ai_run_sources에 정확한 판·chunk·지문·위치를 남긴다. 미색인·추출실패·근거 없음은 정상 답변과 구분한다.

한 원본의 동일 적용 범위에 유효판이 겹치지 않도록 배타 제약 또는 원본 잠금 후 겹침 검사를 사용한다. 서로 다른 규정 원본의 충돌은 별도 문제이며 조용히 제거하지 않는다. 한국어는 단순 PostgreSQL 기본 분할만으로 형태소 검색 품질을 보장하지 않는다. 제목·조문·대상·전문 검색을 표본 질의로 평가하고, 필요할 때만 승인된 embedding을 추가한다.

**Claude와 embedding은 별개다.** Anthropic은 자체 embedding 모델을 제공하지 않는다고 안내한다. Claude 사용 결정만으로 외부 embedding 공급자·비용·학생자료 전송이 승인된 것은 아니다. 처음에는 확인 가능한 문자/메타데이터 검색을 만들고, embedding 공급자·차원·전송 범위는 별도 승인한다. [Anthropic embedding 문서](https://platform.claude.com/docs/en/build-with-claude/embeddings)

## 3. Claude: 대화, 실행, 확인을 서로 다른 기록으로 둔다

| 표 / 단계 | 주요 열 | 관계·제약·인덱스 |
|---|---|---|
| ai_threads / R3 | id, school_id, owner_user_id, owner_member_id, mode:assistant/document/student_draft, title text?, state:active/archived/deletion_pending, version, created_at, updated_at | owner_member.user_id=owner_user_id DB 강제. UNIQUE(school_id,owner_user_id,id). 본인 생성 소속의 유효 접근 전용. INDEX(school_id,owner_member_id,updated_at DESC,id). 관리자·지원자 본문 읽기 금지 |
| ai_messages / R3 | id, school_id, thread_id, sequence bigint, role:user/assistant/tool, content json, content_schema_version int, run_id?, state:visible/redacted, created_at | FK(school_id,thread_id), UNIQUE(school_id,thread_id,sequence). 메시지 content는 대화이며 권한/사실 원장이 아님. INDEX(thread_id,sequence). 본문파기는 별도 삭제 절차 |
| ai_runs / R3 | id, school_id, thread_id, requested_by_member_id, client_request_key text, input_hash text, input_message_id, agent_config_version text, provider text='anthropic', model text, state:queued/running/succeeded/failed/indeterminate/cancel_requested/cancelled, job_id?, started_at?, finished_at?, result_message_id?, version | UNIQUE(school_id,requested_by_member_id,client_request_key). input/result message는 같은 thread의 복합 FK. model은 승인된 서버 설정 복사. provider timeout을 성공이나 확정 실패로 추정하지 않음 |
| ai_run_sources / R3 | id, school_id, owner_user_id, run_id, kind:knowledge_revision/knowledge_chunk/document/observation/assessment/activity, knowledge_revision_scope_key text?, knowledge_chunk_scope_key text?, knowledge_revision_id?, knowledge_chunk_id?, document_version_id?, observation_revision_id?, assessment_revision_id?, activity_item_revision_id?, source_hash text, locator json, authority_version bigint, needs_review bool DEFAULT false, created_at | kind별 정확히 한 source ID. 아래 복합 FK·소유 규칙 필수. UNIQUE(run_id,kind,정확한 source ID,locator 지문). 원문 자체는 복제하지 않음 |
| ai_tool_proposals / R3 | id, school_id, run_id, actor_member_id, tool_name text, tool_schema_version int, fixed_level smallint, normalized_arguments json, arguments_hash text, expected_versions json, affected_subjects_hash text, permission_version bigint, expires_at time, state:pending/confirmed/expired/cancelled/invalidated, confirmed_by_member_id?, confirmed_at?, version | tool_name/level은 서버 registry와 일치. 확인자는 실행자. CHECK 만료>생성. 암호학적 nonce/token은 DB에 해시만 저장. 대상 원본 종류별 arguments를 서버에서 검증; FK가 없는 임의 ID 실행 금지 |
| ai_tool_executions / R3 | id, school_id, proposal_id, command_receipt_id?, job_id?, state:claimed/succeeded/failed/indeterminate, result_ref json?, error_code?, created_at, finished_at? | UNIQUE(school_id,proposal_id). 확정한 proposal 1회만 claim. 결과 참조는 해당 도구 결과의 typed schema이며 조회 때 원본권한 재검사 |
| ai_memories / R3 | id, school_id, owner_member_id, content text, purpose text, state:proposed/confirmed/paused/revoked, expires_at time?, confirmed_at?, version, created_at, updated_at | 본인만 확정·수정·중단. INDEX(school_id,owner_member_id,state,expires_at). 학생 추정성향·민감기록의 자동 장기 기억 금지 |
| ai_memory_sources / R3 | id, school_id, memory_id, message_id?, source_scope_key text?, knowledge_revision_id?, document_version_id?, source_hash text | 세 ID 중 정확히 하나. knowledge는 (source_scope_key,knowledge_revision_id) MATCH FULL FK와 common/본교 검사. message는 해당 기억 소유자의 thread, document는 현재 허용 문서. 원자료 권한 종료·철회·변경 시 기억 중단/재확인. 학생 원본은 초기 미지원 |
| ai_usage / R3 | id, school_id, run_id, attempt_no int, provider text, provider_request_id?, operation text, model text, input_tokens bigint?, output_tokens bigint?, cache_read_tokens bigint?, cache_write_tokens bigint?, metering_state:reported/estimated/unknown, result_state text, created_at | UNIQUE(run_id,attempt_no,operation). provider_request_id가 있는 경우 조건부 UNIQUE(provider,provider_request_id,operation). 토큰 NULL은 미확인, 0과 구분. 본문·API 키 없음; 학교별 합계는 담당자에게 메타데이터만 |

`ai_run_sources`의 참조는 다음처럼 확정한다. source ID 여섯 열 중 정확히 하나이며 kind와 대응한다.

- knowledge_revision → `(knowledge_revision_scope_key,knowledge_revision_id)` FK `knowledge_revisions(scope_key,id)`, knowledge_chunk → `(knowledge_chunk_scope_key,knowledge_chunk_id)` FK `knowledge_chunks(scope_key,id)`. 각각 MATCH FULL, kind별 해당 쌍만 존재하도록 CHECK한다. **판 ID와 chunk ID를 함께 저장하지 않는다.** chunk의 revision에서 판을 파생해 판·구간 불일치를 없앤다. 허용 source scope는 common 또는 현재 school의 생성키다. 읽기 DTO의 source_scope_key는 선택된 scope 열을 나타낸다.
- document → `(school_id,document_version_id)` FK `document_versions(school_id,id)`. 부모 documents의 현재 visibility/owner/audience를 검사한다. 다른 작성자의 공유 문서도 읽기 권한이 있으면 가능하므로 학생 근거와 같은 소유자 CHECK를 붙이지 않는다.
- observation/assessment/activity → `(school_id,owner_user_id,각 revision ID)` FK `observation_revisions/assessment_revisions/activity_item_revisions(school_id,owner_user_id,id)`. 상담은 kind에 없다.
- `(school_id,run_id)` FK와 함께 **run→thread.owner_user_id=source.owner_user_id**를 제약 트리거로 강제한다. 소유 계정은 서버에서 파생한다. 이 owner_user_id는 참조를 실행한 대화의 소유자이며 공유 문서 저자의 ID라는 뜻이 아니다.
- 새 소속의 새 대화가 과거 본인 학생 근거를 참조할 때는 같은 user+같은 school에 더해 현재 담당·보존·과거 정정/접근 정책을 검사한다. 작성 당시 member ID equality만 요구하거나 다른 학교의 본인 자료를 섞지 않는다. 기존 AI thread의 owner_member_id는 자동 이전하지 않는다.

늦게 도입하는 원본 종류는 해당 FK와 검증 함수가 배포되기 전 CHECK에 추가하지 않는다.

대화의 자료 범위는 처음 선택한 학교에 고정한다. 학교를 바꾸면 새 thread를 열며 이전 첨부·학생 목록·기억을 자동 전달하지 않는다. 대화가 소속을 넘나들며 학교 자료를 합치지 못하도록 FK와 조회 API가 강제한다.

**도구 확인 트랜잭션:** 아래 공통 잠금 순서의 권한·멱등·근거 gate를 획득 → proposal을 원본 잠금 순서로 잠금 → 현재 사용자·소속·학교·권한·만료 확인 → 서버 registry의 level/schema 확인 → 정규화 입력 지문·대상판·영향 대상 재계산 → 달라지면 invalidated → domain command를 동일 멱등 키로 실행 → 결과/접수증+execution+outbox 기록. L4 확정은 전문 승인 UI가 담당하고 L5 대량 삭제·권한 변경은 AI에 노출하지 않는다. 확인 카드는 권한을 부여하는 토큰이 아니다.

민감 원본의 철회·권한 종료 후 기존 답변을 무조건 재사용하지 않는다. 연결 메시지를 stale/가림 대상으로 표시하고, 매 요청에 원자료 권한을 다시 확인한다. 본문 삭제는 messages·기억·작업 입력·색인·캐시·결과 파일까지 파기 목록에 포함한다. 이미 사용자 기기에 내려간 출력물을 회수했다고 표시하지 않는다.

## 4. 긴 작업·중복 방지·사건 전달

| 표 / 단계 | 주요 열 | 관계·제약·인덱스 |
|---|---|---|
| command_receipts / R1 | id, scope_type:school/common, school_id?, scope_key, actor_user_id, actor_member_id?, operation text, request_key text, payload_hash text, schema_version int, result_kind text, result_id text?, safe_result json?, committed_at time | UNIQUE(scope_key,actor_user_id,operation,request_key). 학교이면 actor_member_id 필수. 클라이언트 직접조회 금지. 저장 결과를 조회할 때 현재 원본권한 재검사. 민감본문·임시서명URL 저장 금지 |
| audit / R1 | id, scope_type:school/common, school_id?, scope_key, actor_user_id?, actor_member_id?, actor_kind:member/platform/worker/support, support_session_id?, worker_principal_id text?, action text, resource_kind text, resource_id text, before_version bigint?, after_version bigint?, request_id text, reason_code?, job_id?, created_at | actor_kind별 필수 주체는 아래 규칙. support_session은 같은 학교 복합 FK, job은 scope 복합 FK. append-only; 민감본문 없음. INDEX(scope_key,created_at,id), (scope_key,resource_kind,resource_id,created_at). resource ID는 설명용이며 권한 부여 없음 |
| jobs / R1 | id, scope_type:school/common, school_id?, scope_key, requested_by_user_id, requested_by_member_id?, kind text, command_receipt_id?, input_ref json, input_hash text, state:queued/running/succeeded/failed/cancel_requested/cancelled/indeterminate, stage text, version bigint, available_at time, attempt_count int, lease_owner text?, lease_until time?, lease_token bigint DEFAULT 0, heartbeat_at?, cancel_requested_at?, result_ref json?, safe_error_code?, created_at, updated_at | 입력은 allowlist kind별 ID+판, 본문/credential 전달 금지. INDEX(state,available_at,id) 부분 queued; INDEX(lease_until) 부분 running. 결과 참조는 domain별 검증. 작업명만으로 테이블/SQL 임의실행 불가 |
| job_attempts / R1 | id, scope_type:school/common, school_id?, scope_key, job_id, attempt_no int, stage text, lease_token bigint, started_at time, finished_at?, outcome?, external_request_id?, safe_error_code? | UNIQUE(scope_key,job_id,attempt_no). provider 응답 유실 등 사실대로 기록. 일반 사용자는 본인의 요약만 보고 실행 환경 정보는 비공개 |
| outbox / R1 | id, scope_type:school/common, school_id?, scope_key, event_type text, aggregate_type text, aggregate_id text, aggregate_version bigint, occurred_at time, safe_payload json, delivery_state:pending/leased/delivered/dead, available_at time, attempts int, lease_token bigint, lease_until time?, last_error_code? | UNIQUE(scope_key,event_type,aggregate_type,aggregate_id,aggregate_version). 원본변경과 같은 DB 트랜잭션에서 INSERT. INDEX(delivery_state,available_at,id). safe_payload는 ID·판·변화 종류만, 본문/명단·개인상담 없음 |
| handovers / R1 | id, school_id, from_member_id, to_member_id, requested_by_member_id, effective_at time, state:proposed/accepted/applied/rejected/cancelled/stale, accepted_at?, applied_at?, version, created_at, updated_at | 같은 학교복합FK. 종료소속 권한 연장 금지. 후임 수락은 실행 시점 권한검사 대체 불가 |
| handover_items / R1 | id, school_id, handover_id, kind:duty_assignment/duty_item/collection_unit/reviewer/cooperation_request, duty_assignment_id?, duty_item_id?, collection_unit_id?, collection_id?, cooperation_request_id?, expected_version bigint, effect_hash text | kind별 typed FK+exactly-one. UNIQUE(handover_id,kind,target). duty_item→02 duty_items, reviewer→해당 collection의 현재 지정 검토자 변경. 개인 관찰·상담·대화·개인 할 일과 문서 소유권은 초기 인계목록에서 제외. 수합 단위 재생성 금지 |

공통 게시·색인도 실행할 수 있도록 command_receipts/audit/jobs/job_attempts/outbox만 명시적인 school/common scope를 지원한다. scope_key는 지식과 같은 DB 생성 규칙을 쓰며 UNIQUE(scope_key,id), 관련 FK(scope_key,parent_id)를 둔다. command_receipts/jobs의 school 사용자 대행 요청은 school_id·actor/requester 소속이 필수이며 해당 소속의 user_id와 actor/requester_user_id가 일치해야 한다. common 요청은 school_id·member_id가 NULL이고 별도 플랫폼 게시/색인 권한이 필요하다. 초기 지원 세션은 진단 읽기만 제공하며 학교 사용자로 가장해 command/job을 생성하지 않는다. 지원 쓰기를 도입할 때는 별도 지원 실행 계약을 먼저 설계한다. source와 job의 scope가 다르면 거부한다. 학교 AI run이 common 지식 원본을 읽을 수는 있지만 common 관리 job을 소유하거나 실행할 수는 없다. account_private 작업은 여기로 섞지 않는다.

**감사 주체는 요청자와 실행자를 구분한다.** CHECK와 전용 기록 함수는 다음을 강제한다.

- member: school scope, 실제 actor_user_id+actor_member_id 필수·동일인, support/worker 필드 NULL.
- platform: common scope, 실제 actor_user_id 필수, member/support/worker 필드 NULL, 행동별 현재 플랫폼 grant.
- support: school scope, 실제 지원자 actor_user_id와 support_session_id 필수, actor_member_id NULL. `support_sessions.support_user_id`와 일치하고 요청자·승인자·목적은 그 세션에서 따라간다. 요청자 member를 지원자의 actor_member로 기록하지 않는다.
- worker: job_id+worker_principal_id 필수, actor_user_id/actor_member_id/support_session_id NULL. job의 requested_by_*가 원래 요청자다. 제한된 내부 실행기의 신원은 기록하되 credential을 넣지 않는다. scope/lease_token·요청자 권한 검사는 실행 함수가 강제한다.

현재 `calendar_receipts/calendar_audit`, `task_receipts/task_audit`를 공통 표로 급히 옮기지 않는다. 이미 검증된 일정·개인 업무의 원자성·오류 계약은 유지한다. **새 도메인부터** 공통 command_receipts와 audit를 적용하고 기존 도메인은 중복 영수증을 발급하지 않는다. 공통 도메인의 민감한 결과는 원본 ID와 버전으로 재구성한다. 기존 도메인 영수증의 정규화 본문/response 보관은 별도 정리 검토 대상이며 자동 복사하지 않는다.

**정확히 한 번의 범위:** DB 원본 확정은 멱등 키·유일 제약·잠금으로 한 번만 반영한다. 알림/외부 호출 전달은 적어도 한 번을 전제로 소비자가 중복 제거한다. Claude 등 외부 사업자의 호출은 timeout만으로 실제 미실행을 증명할 수 없다. 자동 재호출로 비용이 한 번만 발생한다고 약속하지 않고 indeterminate와 실행 흔적을 남긴다.

worker는 job_id+lease_token을 가진 내부 실행 주체다. lease 만료 후 옛 worker가 돌아오면 그 token으로 결과를 확정할 수 없다. 각 checkpoint와 최종 write에서 token을 조건으로 검사한다. 결과 확정 시 요청자의 현재 권한과 원본판도 재검사한다. 서버용 키로 RLS를 우회할 수 있다는 사실을 사용자 대행 권한으로 사용하지 않는다. 브라우저에서 호출할 수 있는 함수에 임의 actor ID·SQL·임의 job kind를 전달하는 경로를 만들지 않는다.

**신규 도메인 잠금 순서:** 관련 users(정렬) → school 권한 gate(common은 관련 platform grant) → memberships(정렬) → 권한/정책 행 → 명령 멱등 advisory key → 근거 owner gate(학생/AI에서 필요할 때) → 업무 원본(종류/ID 정렬) → 파일 → receipt/audit/outbox INSERT. 신규 create는 원본이 아직 없으므로 멱등 키를 먼저 잠근 뒤 존재 여부를 재조회하고 원본을 만든다. 게이트 읽기는 FOR SHARE, 승인·회수 변경은 FOR UPDATE 등 실제로 충돌하는 모드를 선택한다. FOR KEY SHARE만으로 is_active 같은 non-key 변경을 막는다고 가정하지 않는다.

기존 001·004 잠금 순서는 구현 기록 그대로 유지하고 새 권한 게이트를 반영하는 전환에서 경합을 다시 검증한다. 관련 작업은 같은 순서를 따르며 동일 학교 전체 쓰기를 배타적으로 직렬화하지 않는다. 인계·권한종료·제출의 경합은 서버 시간 기준 잠금 아래 검증한다. SERIALIZABLE 재시도도 원래 멱등 키를 유지한다.

## 5. 정책·파기·복구·문의

| 표 / 단계 | 주요 열 | 관계·제약·인덱스 |
|---|---|---|
| retention_rules / R1 | id, scope_type/school_id?/scope_key, record_class text, policy_version int, legal_basis_ref text?, retention_expression json?, state:unconfirmed/approved/retired, approved_by_user_id?, approved_by_member_id?, approved_at time?, effective_from date, created_at | UNIQUE(scope_key,record_class,policy_version). 학교 승인자는 해당 user/member 일치, common은 승인된 플랫폼 정책 주체. unconfirmed를 무기한 승인으로 해석하지 않음. 근거 확인 전 자동 영구파기 금지, 공개 전 대상 유형별 정책확정 |
| deletion_requests / R1 | id, scope_type/school_id?/scope_key, requester_user_id?, requester_member_id?, owner_user_id?, record_class text, scope_ref json, reason_code text, rule_id?, state:requested/review/approved/running/completed/blocked/rejected, legal_hold bool, job_id?, version, created_at, updated_at | rule/job은 scope 복합 FK. 사람 요청은 requester_user_id 필수, 학교 요청은 일치 member, common은 플랫폼 권한. 정책 자동 작업은 승인 rule+job 필수. scope_ref는 허용 도메인+검증된 고정 manifest. requester가 본문을 못 읽으면 여기서도 미공개 |
| deletion_items / R1 | id, scope_type/school_id?/scope_key, request_id, kind:row_content/file/chunk/embedding/cache/derived_output, target_id text, target_version text, state:pending/redacted/deleted/blocked, content_hash text?, completed_at time?, safe_error_code text? | request는 scope 복합 FK. UNIQUE(scope_key,request_id,kind,target_id,target_version). 삭제 권한은 전용 내부 함수, 임의 target DELETE 금지. 같은 scope의 승인 manifest만 실행 |
| restoration_ledgers / R1 | id, scope_type/school_id?/scope_key, deletion_request_id?, revocation_ref json?, operation_type:erasure/access_revocation, applied_at time, target_manifest_ref text, replay_state text, created_at | request는 scope 복합 FK. operation별 승인 삭제 요청 또는 검증된 회수 manifest 필수. 본문 없는 가림·권한회수 원장. DB 백업과 별도 보호된 복구원장 사본을 유지해 과거시점 복원 뒤 재적용. 기간은 승인정책에 따름 |
| service_feedback / R1 | id, school_id, reporter_member_id, category text, redacted_summary text, state:received/triaged/planned/resolved/closed, assigned_support_id?, version, created_at, updated_at | 학생원문·상담·대화 자동 첨부 금지. 최소 재현정보만. report attachment는 별도 명시적 동의·허용범위 필요, 초기판 미지원 |

공통 자료도 같은 네 표의 common scope로 철회·파기·복원 재삭제를 추적한다. 학교 삭제 명령은 common 요청을 만들거나 실행할 수 없고, 공통 파기 작업이 학교 개인자료를 포함하지 못한다. 학교 전용 lifecycle 표는 생성 school_scope_key로 deletion_requests를 참조한다.

file 본체, DB행, 지식추출문, embedding, AI 대화, export 파일은 하나의 파기 처리 범위에서 각각 결과를 확인한다. 일부 실패를 completed로 표시하지 않는다. 감사 행은 원본문 대신 삭제/정정 사실과 최소 식별자만 남긴다. 법적 보존기간을 본 문서가 추정하지 않는다.

복구는 새 격리 환경에 DB+파일 원본을 함께 복원 → 파일 manifest의 지문/크기 대조 → 삭제/권한회수 원장 재적용 → 접근·접수증·출력 검증 → 재개 순서다. 학교별 복구를 위해 전체 운영 DB를 과거로 돌려 다른 학교의 최신 쓰기를 잃지 않는다. 학교 단위로 추출·대조·재반영하는 별도 리허설이 필요하다. Supabase의 DB 백업에는 Storage 파일 본체가 포함되지 않으므로 별도 파일 백업을 완료 조건에 넣는다. [공식 백업 문서](https://supabase.com/docs/guides/platform/backups)

## 6. 순수 개인 공간의 후속 계약

학교 안의 개인 업무·대화는 학교 소속 종료 후 자동 접근을 보장하지 않는다. 학교와 무관한 개인 할 일을 제공할 때는 다음 **별도 표**를 E 단계에서 만든다.

| 표 | 필수 설계 |
|---|---|
| account_workspaces | id TEXT PK, user_id TEXT UNIQUE FK public.users, state:active/suspended/closed, version, created_at. 서비스 개인 이용자격을 별도 승인; 학교 승인이 없어도 된다고 현재 is_active를 무시하지 않음 |
| account_tasks | id, workspace_id FK, owner_user_id FK, title/notes/due_date/status/version/created_at/updated_at. FK(workspace_id,owner_user_id)로 소유일치. school_id·학생·학교 파일 FK 없음. INDEX(owner_user_id,status,due_date,id) |
| account_ai_threads/messages/memories | 학교 AI와 다른 저장소·RPC·사용자 단위 소유. 학교 자료 참조·첨부·학생 ID 저장 도구 금지. provider/usage와 확인/삭제 계약은 재사용하되 학교 threads와 UNION하지 않음 |

이 표들은 이름만 존재하는 구현 완료 영역이 아니다. 개인 AI의 이용자격·비용귀속·보존 정책 확정과 학교 내용 유입 방지 검증이 선행돼야 한다. 새 scope를 `school_id IS NULL`로 추정해서 현재 학교 도메인 표에 끼워 넣지 않는다.

## 7. 수용시험

1. 다른 학교의 chunk ID를 직접 지정하거나 검색 결과의 ID를 바꿔도 본문·인용·embedding을 얻지 못한다.
2. common으로 가장한 학교 파일, school scope가 맞지 않는 revision과 chunk를 DB에서 거부한다.
3. 미래 시행판을 미리 게시했을 때 오늘 질문에는 현행판, 미래 기준일 질문에는 미래판을 사용한다.
4. 원본 철회 직후 오래된 검색 캐시·지연 embedding 결과에서도 본문을 반환하지 않는다.
5. 소속 종료 후 과거 AI thread·첨부·기억·접수증 접근을 차단하고, 같은 user가 다른 학교에서 재사용하지 못한다.
6. AI 확인 후 대상·권한·version·영향 명단 중 하나라도 달라지면 기존 확인으로 쓰기를 실행하지 못한다.
7. 같은 proposal의 동시 실행 두 개는 domain write 한 번, 영수증 한 개다.
8. worker A의 lease가 만료되어 B가 인수한 후 A의 성공 응답이 늦게 와도 반영되지 않는다.
9. DB 저장 성공 뒤 응답 유실·outbox 재전달을 해도 접수증·제출·알림을 중복 생성하지 않는다.
10. provider timeout은 비용 0 또는 미실행으로 표시하지 않는다. 동일 시도인지 확인할 수 없는 호출은 indeterminate로 분류한다.
11. 근거 정정과 AI 생성 확정이 동시에 일어나도 낡은 근거를 검토완료로 확정하지 못한다.
12. 파기 요청의 학생 본문이 DB에서만 사라지고 파일·AI 메시지·색인에 남아 있으면 completed가 아니다.
13. 과거 백업 복원 뒤 삭제·권한회수 원장을 재적용해야 운영 재개 조건을 통과한다.
14. 지원자·학교 관리자가 개인 AI 대화·기억·학생 근거를 접수증/작업 상세를 통해 읽지 못한다.
15. 인계와 전출이 동시에 처리돼도 전출 권한은 즉시 종료되고 의무 수는 증가하지 않는다.
16. account_private 표/도구에 학교 파일·학생 근거를 연결하려는 요청이 거부된다.
17. 지원 세션의 감사 actor는 실제 지원자이고 학교 요청자를 가장하지 않는다. worker의 실행 주체와 원래 요청자도 구분된다.
18. common 지식·파일을 파기한 후 과거 백업을 복원해도 common 삭제 원장이 재적용된다.
19. 같은 학교 재임용 교사가 새 대화에서 허용된 과거 본인 근거를 사용하되 다른 교사·학교 자료는 참조하지 못한다. 과거 대화의 자동 이관은 없다.
20. 지식 chunk와 다른 revision을 섞거나 단일 scope 값으로 없는 source FK 검사를 건너뛰려 해도 저장이 거부된다.

## 8. 공식 기술 근거

RLS·테이블 GRANT·함수 EXECUTE 권한은 함께 검증해야 한다. SECURITY DEFINER는 함수 소유자의 권한으로 실행될 수 있으므로 search_path 고정만으로 보호되지 않으며 본문 안의 현재 사용자/소유자 검사가 필요하다. [Supabase API 보안](https://supabase.com/docs/guides/api/securing-your-api), [Database functions](https://supabase.com/docs/guides/database/functions)

검색에도 원본 권한을 적용하고 원본/파생 관계를 유지하는 방향은 [RAG with Permissions](https://supabase.com/docs/guides/ai/rag-with-permissions)를 참고했다. 본 문서의 학교·소속·미래 시행·개인기록·worker 계약은 이 시스템을 위해 추가로 설계한 조건이다.
