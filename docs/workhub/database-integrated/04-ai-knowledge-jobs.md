# 04. 지식·Claude·개인 비서·긴 작업 통합 계약

> 2026-10-12 · 완성 사이트용 **DB 설계 제안**. 실행 SQL과 운영 보안·모델·비용 설정을 변경하지 않는다. `workhub.knowledge_documents/knowledge_revisions/knowledge_chunks/conversations/ai_runs/messages/tool_proposals/tool_runs/memories/usage_events/jobs/job_attempts/outbox` 등 Claude 2차의 실제 이름을 유지한다. GPT의 typed 근거와 권한·동시 정정 계약을 결합한다. 변경 열·표 목록은 `student-ai-changes.json`, 공통 주체와 권한은 01, 학생 사슬은 03이 기준이다.

## 1. 무엇을 분리하는가

학교 지식, 교사의 대화, AI의 한 번 실행, 사용자 확인 카드, 실제 업무 명령, 외부 공급자 호출, 비용 계측은 서로 다른 기록이다. AI 응답·확인 카드·job 성공은 학교 업무의 실제 확정 사실을 대신하지 않는다. 작업자 재시도나 대화 재접속이 쓰기 권한을 새로 만들지 않는다.

R11은 서비스 주체의 active·허용 action·현재 scope grant를 실제 실행마다 확인하는 계약이다. R12는 외부 호출 뒤 결과가 불명확한 상태를 임대 만료로 숨겨 다시 실행하지 못하게 하는 계약이다. 두 계약은 DB 함수·domain command·worker를 함께 묶어 수용시험으로 검증한다.

## 2. 학교 지식의 원본·판·검색

| 기존 표 | 유지/보강 사항 |
|---|---|
| `knowledge_documents` | 문서 정체성, school/common scope, authority, 책임자, 대상. 학교 자료를 common으로 UPDATE하지 않는다. 공통화는 원학교/원문서/권리·승인과 새 common 문서를 만든다. |
| `knowledge_revisions` | 원문 해시·파일·등록/검토/게시·시행기간·색인 상태를 분리. 원문 내용·파일을 바꾸면 새 revision. 효력기간이 겹치는 published판은 기존 EXCLUDE로 차단한다. |
| `knowledge_chunks` | 정확한 revision과 location(쪽/조/항/표/행), body, 본문 해시. chunk를 다른 판으로 이동하거나 본문만 UPDATE하지 않는다. 재추출은 새 추출판/명시적 교체 절차다. |
| `knowledge_conflicts` | 상충 문서의 관계와 해소 사실. authority 숫자 하나로 모든 특례·시행일 우열을 자동 판정하지 않는다. |

학교 지식에도 `visibility=school/audience/private`를 명시한다. 기존 audience_set_id가 있으면 audience, 없으면 school로 이관 후보를 만들되 private 원문을 조용히 공개하지 않는다. private는 proposed_by_account_id 본인만 읽고, 관리자는 게시 절차의 메타데이터만 받는다. 공통 범위는 visibility=common이며 service_operators 등록만으로 게시할 수 없고 현재 `operator_grants`의 common 게시 권한이 필요하다.

검색은 현재 주체·범위·학교/소속·ACL·기준일 → 검토/게시·시행판 → 적용 학교급/지역/학년도 → 검색 후보 순서다. 본문 검색 뒤 학교를 거르는 구현을 금지한다. 반환 직전에 원본 철회/파기/권한을 다시 확인한다. 미색인·추출실패·표 누락·근거 없음은 정상 답변과 구분한다. 미래 시행판이 있어도 현재 질의는 현행판을 사용한다. 문서·학생 답변 속 명령은 데이터이며 권한 또는 도구 사용 지시로 실행하지 않는다.

기본 검색은 실제 한국어 질의 표본으로 검증한 문자·제목·조문·메타데이터 검색이다. embedding은 Claude 채택과 별도 공급자·비용·학생자료 전송 승인 대상이다. 이 설계는 모델명·차원·단가를 임의 확정하지 않는다. 향후 embedding을 도입하면 모델/차원/입력정책판별 색인을 분리하고 ACL 및 삭제 전파를 똑같이 적용한다.

## 3. 대화와 재임용·학교 전환

`conversations`에 `origin_membership_id text?`를 추가한다. scope=school이면 NOT NULL이고 `(school_id,origin_membership_id,owner_account_id)`가 memberships의 같은 학교·계정 복합키를 참조한다. scope=account_private이면 NULL이다. scope, school, owner, origin_membership는 불변이다.

학교 대화 열람은 본인 계정 AND 생성 소속이 현재 유효 AND 학교 유효 AND 자료 차단 아님이다. 같은 계정의 새 소속으로 재임용돼도 과거 대화가 자동으로 열리지 않는다. 학교를 바꾸면 새 대화이며 이전 첨부·질문·학생 목록·기억을 자동 주입하지 않는다. 반면 학생 개인 기록의 소유는 03의 owner account를 유지하며, 새 대화에서 과거 본인 근거를 참조하려면 현재 접근·담당/과거 정정·보존 정책을 별도로 통과해야 한다.

개인 대화는 순수 개인 이용 자격이 있는 계정만 사용한다. school_id/학생/학교 문서/학교 파일을 연결하지 않는다. common 지식의 허용된 게시판은 사용할 수 있지만 학교 대화 메시지를 개인 기억으로 복사하지 않는다. 학교 자료가 섞인 입력은 거부/학교 대화로 명시적 이동 안내 대상이며 자동 이관하지 않는다.

`ai_runs`에도 origin_membership_id를 추가한다. conversation이 있으면 scope/owner/origin이 정확히 일치하고, 브리핑처럼 conversation이 없으면 서버가 현재 소속을 고정한다. 학교 실행은 origin 소속에 묶이며 권한 회수 후 기존 실행 결과를 새 membership에 전달하지 않는다. `messages`는 같은 conversation의 run만 참조하는 기존 복합 FK를 유지한다. 메시지 원문은 주인만 읽고 로그/지원용 JSON에 포함하지 않는다.

## 4. typed AI 실행 근거

신규 `ai_run_sources`는 자유 JSON의 출처 목록을 권한/정정 원장으로 사용하지 않기 위한 표다. 표시용 메시지 인용과 별개이며 다음 구조를 사용한다.

| 열 | 형식 / NULL / 제약 |
|---|---|
| id | text PK DEFAULT UUID text |
| scope_key, run_id, owner_account_id | text NOT NULL. `(scope_key,run_id,owner_account_id)` → ai_runs의 기존 UNIQUE. |
| school_id | text NULL. school 실행이면 run.school_id와 같고 개인 실행이면 NULL. |
| kind | text NOT NULL: knowledge_revision/knowledge_chunk/document_revision/observation_revision/assessment_revision/source_item_revision |
| knowledge_revision_scope_key, knowledge_revision_id / knowledge_chunk_scope_key, knowledge_chunk_id | text NULL. revision 또는 chunk **하나의 쌍**만 선택하며 각각 scope+ID MATCH FULL FK. 선택하지 않은 쌍은 둘 다 NULL이다. chunk에서 revision을 파생해 서로 다른 판을 섞지 못한다. |
| document_id, document_revision_no | text/integer NULL. 선택 시 둘 다 필수, `(scope_key,document_id,revision_no)`로 정확한 문서판 참조. 해당 공유/개인 문서 ACL을 별도 검사한다. |
| observation_id, observation_revision_no | text/integer NULL. 학생 근거는 `(school_id,owner_account_id,observation_id,revision_no)` → observation_revisions의 작성자 포함 UNIQUE. |
| assessment_id, assessment_revision_no | text/integer NULL. 같은 owner·학교의 정확 평가판 복합 FK. |
| source_item_id, source_local_revision | text/integer NULL. 같은 owner·학교의 원자료판 FK. 원자료는 활동 정리/채택 보조에만 쓰며 생기부 생성 purpose에는 직접 허용하지 않는다. |
| source_sha256, locator, locator_sha256, authority_version, evidence_epoch | text/jsonb/text/bigint/bigint?. 해시·원문위치·위치의 정규화 지문·권한판·학생 gate epoch. 본문 복제 필드 없음. |
| state, invalidated_at, invalid_reason | active/stale/withdrawn/blocked 및 시각/코드. 한 번 무효화한 근거행을 재활성화하지 않고 새 run을 만든다. |

kind에 대응하는 원본 ID 묶음 정확히 하나만 존재하도록 CHECK한다. 모든 복합 FK에서 부분 NULL이 검사를 건너뛰지 않도록 쌍 존재 CHECK 또는 MATCH FULL을 사용한다. 지식 출처는 실행 scope가 허용하는 common 또는 본교만, 개인 실행은 common만 허용한다. 학생 근거는 school scope 전용이고 상담은 kind에 없다. 본인 shared 문서 외 다른 교사 공개 문서도 현재 ACL이 허용하면 인용할 수 있으므로 문서 저자와 run owner의 동일성은 강제하지 않는다.

source_item_revisions의 created_by_account_id를 owner로 해석하기 전에 부모 source_items.owner와 일치를 DB 제약으로 보장한다. 학생 원본판의 owner 포함 UNIQUE도 해당 부모 owner와 일치하는 작성자 FK가 전제다. run→conversation.owner/origin, source→원본.owner/학교/판 모두 동시에 맞아야 한다.

원본 정정·철회·파기는 원본의 scope gate 또는 03의 student_evidence_gates 아래 수행하고 ai_run_sources를 통해 영향 run/messages/memories/document/record를 찾는다. 직접 영향은 동기 차단하고 대량 텍스트 가림·삭제는 outbox 작업으로 전파한다. 오래된 메시지를 다시 읽거나 후속 질문 맥락에 넣을 때 현재 원본권한/차단을 검사한다. `needs_review` 표시만 늦게 갱신된다는 이유로 금지된 원문을 다시 AI에 보내지 않는다.

## 5. Claude 정책판·프롬프트·비용 사실

신규 `ai_policy_versions`는 provider='anthropic', model_identifier, prompt_template_ref, prompt_sha256, tool_registry_version, allowed_data_categories, limits jsonb, cache_policy_ref, pricing_reference, approved_by_account_id, approval_ref, approved_at, effective_from/to, state를 가진다. 본문·비밀키를 저장하지 않는다. limits는 승인된 max_tokens/도구호출/동시실행/예산 등이며 이 문서는 숫자를 채우지 않는다. 승인·효력 조건이 없는 정책판은 실행 불가다. 정책 내용은 불변이고 중단·새판 도입만 가능하다.

`ai_runs.policy_version_id`는 정책판 FK이고 기존 model_config_version/prompt_version/tool_contract_version은 정책판과 일치하는 당시 사본이다. 서버가 선택하며 모델이 넘긴 이름·수준을 믿지 않는다. 실제 조립한 시스템 프롬프트와 검색 원문은 브라우저·작업 상세·지원 화면·감사에 노출하지 않는다. 내부 진단에 원문이 꼭 필요하면 별도 승인된 제한 저장소/기간을 사용하며 기본 DB 계약에는 넣지 않는다. 사용자가 쓴 자기 메시지와 숨겨야 할 시스템 프롬프트를 혼동하지 않는다.

`usage_events`의 토큰 DEFAULT 0을 제거하고 NULL=미확인, 0=공급자가 보고한 실제 0으로 구분한다. input/output/cache read/cache write는 bigint NULL이고 음수 금지다. metering_state는 unknown/estimated/reported, provider_request_id, external_call_id, attempt_no, pricing_reference, currency, cost_amount를 기록한다. 단가·통화·예산 귀속은 승인된 정책판에서 온다. 모델 응답 timeout을 비용 0으로 적지 않는다.

외부 호출당 측정은 고유 키로 중복 생성하지 않는다. 미확인 측정의 늦은 보고는 같은 행을 서버 계측 명령으로 unknown/estimated→reported 한 방향 갱신하고 원래/정정 측정 이력은 audit의 값 없는 사건 또는 별도 명시적 adjustment로 남긴다. reported 수정을 숨겨 덮어쓰지 않는다. 조정 이벤트는 원측정 ID와 요청키를 고정하고 집계는 원측정+조정의 계약을 따른다. 학교 관리자는 비용·실패율 합계만, 교사는 자기 실행 요약만 보며 학생 본문·프롬프트가 비용 원장에 들어가지 않는다.

## 6. 확인 카드와 실제 도구 명령

기존 tool_proposals의 normalized payload/hash·object_versions·영향·만료를 유지하고 origin_membership_id, permission_version, affected_subjects_sha256, tool_registry_version을 추가한다. 도구 수준은 승인된 서버 registry에서 결정한다. 표시한 영향과 실행할 영향이 같아야 하며 대상 version/권한/원자료판/명단/설정이 바뀌면 stale로 만들고 재확인한다.

`cmd_confirm_proposal`은 공통 잠금→현재 계정·origin 소속·정책·만료→registry/schema→정규화 payload 및 영향 재계산→기대판 비교→tool_runs claimed 유일 선점→해당 domain command와 동일 멱등 키→receipt/result/outbox를 묶는다. 확인자는 실행자이며 다른 관리자 확인을 필요한 전문 승인으로 대체하지 않는다. 고위험 최종 확정은 전문 화면, 대량 삭제·권한 변경은 일반 AI 도구에 제공하지 않는다.

기존 부분 UNIQUE `tool_runs_one_exec`와 claimed→succeeded/failed/indeterminate 전이를 유지한다. failed는 아무 효과도 반영되지 않았다는 확인이 있을 때만이다. 불명확은 재실행 금지이며 실제 원장·공급자 결과를 조사해 사후 확정한다. 내부 DB 도구는 domain write와 receipt가 같은 트랜잭션에서 성공하고 외부 도구는 아래 job_external_calls가 추가 경계다.

## 7. R11: 작업 주체의 현재 권한

01이 정의하는 `service_principals` 및 신규 `service_principal_scopes`를 참조한다. 사람 작업은 owner_account_id만, 서비스 작업은 service_principal_id만 존재한다. `owner_account_id IS NULL ⇒ 접근 허용` 분기를 제거한다.

| 작업 scope | 필수 주체·범위 |
|---|---|
| school / `s:<school_id>` | 현재 학교에 유효한 요청자 origin_membership 또는 해당 학교 scope grant를 가진 서비스 principal. 학교·서비스 기능 gate도 유효. |
| account_private / `a:<owner>` | 개인 이용 자격이 있는 요청 계정만. 서비스 principal scope grant를 만들지 않는다. 학교 자료 참조 금지. |
| common / `c` | common action이 허용된 active 서비스 principal 또는 승인된 플랫폼 권한의 사람. 학교 관리자 자격만으로 불가. |
| service / `svc` | 전역 복구/운영의 명시적 active principal+service grant. 학교 파기 작업은 service scope로 우회하지 않고 school scope. 순수 개인자료의 승인 파기만 아래 제한 예외를 적용한다. |

jobs는 기존 CHECK를 scope 네 종류로 보강한다. `scope_key`는 NOT NULL 저장 생성 열이며 최종 생성식은 `CASE scope WHEN 'school' THEN 's:' || school_id WHEN 'account_private' THEN 'a:' || owner_account_id WHEN 'common' THEN 'c' WHEN 'service' THEN 'svc' ELSE NULL END`다. 원본의 `ELSE 'c'` 식을 계승하지 않는다. 허용 scope CHECK와 생성 열 NOT NULL이 알 수 없는 범위·필수 ID 누락을 함께 거부한다. 서비스 scope와 common의 key를 구분하며 school_id NULL이라는 사실로 추정하지 않는다. `origin_membership_id`는 학교 사람 작업에 필수, 그 밖에 NULL이다. scope/주체/종류/입력 해시/원요청 ID는 생성 후 불변이다.

순수 개인자료의 승인 파기는 퇴직·계정 종료와 독립적으로 완료해야 한다. 따라서 account_private에 포괄 서비스 grant를 주는 대신, **scope=service·kind=deletion_process·현재 service grant의 허용 action**을 가진 전용 명령만 정확히 한 계정의 승인된 deletion_ledger와 불변 manifest를 처리할 수 있다. 실행 scope와 자료 scope/account를 모두 기록하며 manifest 범위 밖 읽기/쓰기·AI 전송·결과 공개는 금지한다. 일반 job의 scope 일치 검사에서 이 승인 파기 경로 하나만 명시적으로 예외 처리하고, 학교 자료 파기는 항상 school scope에 둔다. 원장 ID만 전달하면 통과하는 예외가 아니라 승인 상태·대상계정·manifest hash·현재 principal 권한을 모두 잠금 뒤 재검사한다.

`job_actor_allowed(job,action)`는 principal.active, action=ANY(allowed_actions), 현재 기간·미회수 scope grant, 학교/서비스 gate, 사람 계정·origin 소속·현재 역할/정책을 검사한다. 작업 생성뿐 아니라 **claim·heartbeat·외부 호출 시작·finish·domain 결과 공개** 때 다시 검사한다. 사람 역할이 필요한 작업은 단순 학교 소속만 보지 않고 kind registry의 현재 permission을 검사한다. 요청자와 실제 worker ID를 분리한다.

**B01 선행조건:** 서버가 검증한 DB 실행 identity를 승인된 service_principal로 해석하는 01의 공통 주체 경계를 worker 도입 전에 마련한다. 요청자가 넘긴 principal ID, 임의로 설정 가능한 GUC, worker_id 문자열 자체는 주체 증명이 아니다. 실제 서비스 주체를 확인할 수 없으면 claim·heartbeat·외부 호출 시작·finish·감사 쓰기를 모두 거부한다. 사람 요청 작업을 worker가 수행할 때도 원요청자 권한과 실제 worker의 허용 action·현재 실행 범위를 각각 검사한다. DB 연결이 service role이라는 이유만으로 특정 principal이나 모든 학교 권한을 부여하지 않는다.

서비스 principal 및 scope grant 읽기는 FOR SHARE, 회수는 FOR UPDATE/UPDATE를 사용한다. 공통 잠금 순서는 01과 동일하다: `accounts/서비스 principal(정렬) → schools/service_switches/platform·service grant → memberships → 역할/정책 → 멱등 advisory → 근거 owner gate → 원본 종류/ID → files → receipt/audit/outbox`. 기존 job_claim/job_finish가 job 행부터 잠그는 순서를 바꿔야 한다. 사전 무잠금 조회는 잠금할 주체 ID를 찾는 용도뿐이며 immutable identity를 잠금 뒤 재확인한다.

권한을 잃으면 cancel 또는 pause 정책을 적용하고 결과를 공개하지 않는다. 이미 시작한 외부 호출은 비용·실행 여부를 사실대로 남기되 결과물을 요청자에게 반환하지 않는다. 권한 회수 후 재임용된 다른 membership으로 자동 재개하지 않는다. 사람이 새 요청을 명시적으로 생성해야 한다.

## 8. R12: 외부 호출과 임대는 서로 다른 상태다

기존 jobs/job_attempts의 lease_token fencing, heartbeat, checkpoint, attempt 원장을 유지한다. 임대 만료는 작업자가 응답하지 않는다는 사실이며 외부 호출 미실행의 증거가 아니다.

신규 `job_external_calls`의 필수 열은 id, scope_key, job_id, attempt_no, lease_token, call_key, provider, operation, request_sha256, state, started_at?, provider_request_id?, safe_result_ref?, result_sha256?, result_bytes?, finished_at?, safe_error_code?, resolution_ref?, resolved_by_account_id?다. FK `(scope_key,job_id)` 및 `(job_id,attempt_no,lease_token)`으로 정확한 시도를 참조한다. UNIQUE(job_id,call_key), provider_request_id가 있으면 provider/operation과 함께 고유하다. safe_result_ref는 operation registry가 정의한 kind·scope_key·불변 대상 ID/판 또는 최소 receipt만 받는 검증된 제한 결과 참조이며 임시 서명 URL을 포함하지 않는다. 요청 원문·응답 원문·credential은 넣지 않는다.

`state='response_received'`는 **safe_result_ref, result_sha256, finished_at이 모두 존재하고 같은 트랜잭션에서 검증·저장된 경우에만** 허용한다. 참조 scope는 external call/job의 실행 scope와 같아야 하며 등록된 kind 처리기가 실제 대상 존재·정확한 불변판·읽기/쓰기 허용·hash 일치를 검사한다. 파일 등 실물이 필요한 operation은 영속 실물의 보관·hash·bytes 확인을 먼저 마치고, NOT NULL·0 이상의 result_bytes와 DB 참조·상태를 함께 커밋한다. DB 원자 커밋 전에 안전하게 보관한 고아 실물은 정리 대상이며 그 자체를 외부 호출 재실행 허가로 보지 않는다. 결과 본문이 없는 operation도 registry가 정한 최소 완료 receipt를 같은 scope로 저장하고 그 정규화 지문을 result_sha256에 남긴다. 순수 개인자료 파기 예외의 receipt는 실행 scope=svc에 속하며 승인 manifest를 가리키는 제한 메타만 갖는다.

결과 참조·hash·bytes는 첫 보관 뒤 불변이며 일반 갱신으로 다른 결과를 끼워 넣을 수 없다. 보존 정책에 따른 결과 파기·차단은 전용 lifecycle 경로로 공개/재개를 막고 최소 tombstone을 유지하며, 과거 외부 효과를 새로 실행해도 된다는 상태로 되돌리지 않는다. 응답을 실제로 수신했더라도 결과 보관 트랜잭션 전에 종료되면 request_started가 남고 이후 unknown으로 조사한다. 응답을 받았다는 메모리상의 사실만으로 response_received를 먼저 커밋하는 경로는 없다.

상태 전이는 다음과 같다.

```text
prepared → request_started → response_received
         ↘ cancelled       ↘ unknown → confirmed_succeeded
                                      ↘ confirmed_not_run
```

`prepared`는 안전한 요청 지문을 기록한 상태이고 실제 호출 전에 `request_started`를 별도 트랜잭션으로 커밋한다. 정확히 이 이후 프로세스가 죽으면 외부에 요청이 전달됐는지 모를 수 있으므로 unknown이다. 공급자가 응답을 보내기 전에 request ID를 알 수 없는 경우에도 call_key/request hash로 외부 시작 사실을 남긴다. 공급자의 멱등 기능은 공식 계약과 실제 검증이 있는 경우에만 사용하며 존재한다고 가정하지 않는다.

| 상황 | claim/reap/재시도 정책 |
|---|---|
| 만료된 running, 외부 단계 없음 또는 prepared만 있음 | 기존 작업의 안전한 checkpoint에서 재인수 가능. attempt/lease를 증가시킨다. |
| request_started 또는 unknown인 외부 단계가 있음 | `job_claim`은 토큰을 새로 주지 않고 `EXTERNAL_OUTCOME_UNKNOWN`; reap은 indeterminate. 단순 attempts 여유로 queued에 넣지 않는다. |
| 응답 수신 후 결과 참조·hash 원자 보관 전 worker 종료 | request_started→unknown으로 조사하며 자동 재호출 0회. 실제 수신 여부만으로 완료 상태를 만들지 않는다. |
| response_received, 업무 결과 공개 전 worker 종료 | 영속 결과 참조·hash가 이미 원자 보관된 상태다. 공급자 재호출 없이 해당 결과를 재검증해 domain finalize만 재개한다. 공개 직전 현재 권한·근거를 재검사하고 실물이 없거나 파기됐으면 결과 불가로 차단한다. |
| confirmed_not_run | 사후 확인 근거/권한/승인된 재시도 정책에 따라 새 attempt와 새 call_key를 만든다. 예전 호출 기록을 지우지 않는다. |
| confirmed_succeeded | 기존 효과를 조사·연결한다. 같은 효과를 다시 실행하지 않는다. |

기존 job_note_external은 열린 호출 행의 provider_request_id를 한 번 채우는 경로로 제한한다. 호출 사실을 그 함수 하나만으로 표현하지 않는다. `job_reap('failed')` 기본값만으로 불명확 외부 단계를 확정 실패로 바꿀 수 없으며 현재 외부 단계로 결과를 계산한다. 관리자·worker가 outcome 문자열만 선택해서 unknown을 지우지 못한다. job_attempts의 lease_lost는 외부 효과의 failed와 다르며 external call의 unknown 상태를 보존한다.

옛 worker의 token은 jobs, job_attempts, external call, 문서/생기부 결과 공개 어디에서도 유효하지 않다. 외부 공급자의 늦은 응답은 제한된 수신 경로에서 해당 call_key에 연결해 사실을 보완할 수 있으나 예전 lease로 domain 성공을 확정하지 않는다. DB 트랜잭션 잠금은 외부 네트워크 호출 동안 유지하지 않는다.

## 9. 접수증·감사·outbox·기억

idempotency_receipts는 actor+scope+operation+request_key+payload_hash를 묶는다. 재조회 때 현재 권한·원본 차단을 검사하고 예전 성공 JSON에 민감본문·명단·서명 URL을 저장하지 않는다. 다른 payload를 같은 키로 보내면 conflict다. receipt는 domain write와 같은 트랜잭션이며 job 예약도 같은 범위에서 커밋한다.

audit_events는 실제 actor_account_id 또는 actor_service_principal_id XOR이며, support_session이 있으면 그 실제 지원자와 일치한다. job 요청자와 worker는 별도 필드다. 변경 전후 원문 snapshot은 금지하고 ID·판·action·사유 코드·요청 ID만 저장한다. service_principals의 allowed_actions를 감사 action 전체 문자열과 무조건 동일시하지 않고 kind→필요 action registry로 검증한다.

모든 명령·worker는 B01에서 먼저 제공하는 공통 `write_audit(context)`를 사용한다. context는 검증된 DB identity와 서버가 확인한 현재 요청/worker 범위에서 만든 내부 구조이며 브라우저가 actor를 지정하는 공개 API가 아니다. 함수는 실제 사람/서비스 actor, 필요한 현재 membership, support_session의 실제 지원자, job의 원요청자와 실제 worker를 구분해 검증하고 기록한다. 서비스 actor는 §7의 DB identity→principal 결합을 재사용하며 actor 누락·임의 principal 대입·두 actor 동시 입력을 거부한다. domain 변경·정확한 판·접수증·필수 audit·outbox를 한 트랜잭션에서 처리하고 감사 검증/INSERT 실패는 전체 실패다. 각 기능이 빈 actor 감사 INSERT를 따로 구현하거나 감사 실패만 무시하는 fallback을 두지 않는다.

outbox는 원본 변경과 함께 INSERT, event/aggregate/version으로 중복 방지한다. 본문·학생 명단을 payload에 넣지 않는다. 전송 worker도 lease token으로 선점하고 소비자는 사건 키로 멱등 처리한다. 접근 회수·원본 삭제 뒤 도착한 사건은 더 넓은 데이터를 재조회하거나 알림 본문을 복원하지 않는다. 실패는 지수 지연/최대 정책판과 dead 상태로 노출하되 실패 메시지에 원문을 담지 않는다.

memories에 origin_membership_id를 추가하고 대화와 같은 scope/생성 소속 불변 규칙을 적용한다. candidate→사용자 확인 active→paused/revoked/expired/invalidated/deleted, 역방향 자동 부활 금지다. 기존 usable_memories가 만료·출처 최신판을 검사하는 구조를 유지하되 현재 origin 소속·현재 원본 ACL까지 확인한다. 원자료 정정·철회·대화 종료·소속 종료는 즉시 재사용 차단과 파생 가림/파기 대상으로 이어진다. 학생 성향/위험등급의 추정을 장기 기억으로 자동 저장하지 않는다.

## 10. 인덱스·오류·수용시험

추가 인덱스는 ai_run_sources(run_id), 종류별 정확 원본 ID/판 partial index, (scope_key,owner_account_id,state), conversations(owner_account_id,origin_membership_id,updated_at DESC), jobs(state,next_attempt_at) queued partial, job_external_calls(job_id,state), unknown 외부 호출 partial, usage_events(external_call_id), outbox(state/기존 전송상태,available_at)이다. 실제 기존 열 이름에 맞춰 SQL을 확정하고 인덱스 추가만으로 권한 필터를 대신하지 않는다.

표준 오류는 ACTOR_INACTIVE, PRINCIPAL_ACTION_DENIED, PRINCIPAL_SCOPE_DENIED, ORIGIN_MEMBERSHIP_ENDED, SOURCE_UNAVAILABLE, EVIDENCE_CHANGED, CONFIRMATION_STALE, LEASE_LOST, EXTERNAL_OUTCOME_UNKNOWN, POLICY_UNSET, IDEMPOTENCY_CONFLICT다. 외부에는 존재 여부를 드러내지 않는 RESOURCE_UNAVAILABLE 계열로 필요시 매핑하며 내부 코드에도 학생본문/키를 담지 않는다.

| 시험 | 관측 기준 |
|---|---|
| AI01 | 같은 학교 다른 교사의 관찰, 다른 학교 본인 기록, knowledge chunk와 다른 revision 혼합은 FK/명령 양쪽 거부. |
| AI02 | 개인 run에 학교 파일·학생 근거·학교 대화 인용 불가; 허용 common 지식만 가능. |
| AI03 | 생성 membership 종료 후 새 membership으로 재임용해도 과거 conversation/run/memory 0건. 새 대화에서 정책상 허용된 본인 과거 학생 근거만 별도 사용. |
| AI04 | 원본 정정과 AI 결과 확정의 두 연결 경합에서 gate 순서에 따라 새 결과는 미검토/거부. 비동기 전파 지연에도 정상 공개 0. |
| AI05 | 확인 뒤 payload/권한판/영향명단/대상판/도구 registry/만료 중 하나 변경 시 기존 proposal 쓰기 0회. 동시 claim 2개에서 domain write·receipt 1개. |
| AI06 / R11 | inactive principal, allowed_action 불일치, 다른 학교/common grant, 만료/회수 grant 모두 생성·claim·heartbeat·finish·publish 거부. |
| AI07 / R11 | 실제 두 연결: 권한 회수가 먼저 커밋하면 worker 성공 공개 실패; worker 확정이 먼저면 회수 이후 모든 조회/다운로드 차단. 같은 gate 충돌을 barrier로 관측. |
| AI08 / R12 | request_started+외부 request ID+임대 만료에서 즉시 claim token 증가 0. indeterminate/unknown 사실 유지. |
| AI09 / R12 | request ID가 아직 없는 호출 전송 직후 crash도 자동 재호출 0. prepared만 있으면 안전한 재인수 가능. |
| AI10 | worker A 만료→B 인수 후 A의 heartbeat/결과/문서 공개 전부 거부. 늦은 응답은 외부 사실 확인으로만 수신. |
| AI11 | timeout 계측은 tokens/cost NULL+unknown, 실제 0은 reported 0. 같은 공급자 보고 두 번 수신해도 비용 중복 0. |
| AI12 | 삭제 뒤 messages/memories/chunks/파일/캐시/출력 중 하나 잔존하면 완료 불가. 이미 사용자 PC에 내려간 파일은 회수됐다고 표시하지 않음. |
| AI13 | 로그·지원 JSON·job progress/result·audit·outbox·usage에 시스템 prompt/학생원문/키 없음. |
| AI14 | 운영자등록만 있고 common 게시 grant가 없는 계정은 게시·공통 파기·복구 실행 불가. |

기존 762 시험은 회귀 기반이며 새 R04~R06/R11/R12 시험을 추가해야 한다. 실제 PostgreSQL 목표 버전의 독립 두 연결 시험, Supabase Auth/PostgREST/Storage/RLS, 실제 worker 재시작/응답유실, UI 권한회수와 다운로드를 별도 확인한다. 외부 공급자 테스트는 승인된 키·비용 정책이 있는 환경에서만 하고, 설계 문서 작성 단계에서 실행하지 않는다.
