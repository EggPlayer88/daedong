# P10 학교 AI 공통 서버 계약

신규 증분 계약. 운영 적용·키 등록·유료 호출 없음. 공급자 설정은 `model-routing.json`의 2026-10-21.1 판을 사용한다. 설치 경로는 `database/workhub-ai-policy/p10/`이며 기존 P6 설치 뒤 P10-01→02→03 순서로 적용한다.

## 공통 봉투

`{contract:'ai-gateway.v1',schoolId:string|null,actorUserId:string,feature:'assistant'|'evaluation',requestKey:string,data:object}` 또는 같은 범위의 `error:{code}`.

아래 RPC는 service_role 전용이며 사람 JWT를 함께 실으면 거부한다. actor는 서버가 `/auth/v1/user`로 검증한 UID다. assistant는 기존 member_actor, evaluation은 현재 승인된 public.users와 명시적 학교 연결표를 사용한다. 서버가 학교를 추정하지 않는다.

- `workhub_ai_gateway_prepare(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_payload_sha256 text,p_quality text,p_input jsonb DEFAULT NULL,p_review_of jsonb DEFAULT NULL)`
- `workhub_ai_gateway_start(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,p_counted_input_tokens integer,p_provider_body_sha256 text)`
- `workhub_ai_gateway_finish(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,p_result jsonb)`
- `workhub_ai_gateway_recover(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_payload_sha256 text)`
- `workhub_ai_gateway_release(p_actor_user_id uuid,p_feature text,p_member_id text,p_request_key text,p_lease_token text,p_reason text)`

prepare 신규 data: `{state:'claimed',leaseToken,policy:{version,model,maxInputTokens,maxOutputTokens,reservedMicroUsd},credential:{version,keyId,iv,ciphertext,tag},assistant:null|<기존 P6 claimed DTO>,execution:{quality,model,reviewOf},reviewSnapshot:null|{requestKey,exchangeId,segments},studentIdentity:null|{studentId,schoolStudentKey,name}}`. 이미 실행 중이면 `{state:'pending',reason:'in_progress'|'provider_unknown'}`. 완료·시작 전 종료이면 원 결과. 같은 키의 입력 해시·quality·reviewOf 변경은 IDEMPOTENCY_CONFLICT. payload_sha256는 서버에서 계산한 논리 요청의 SHA-256이며 assistant 원래 7필드 입력 해시는 P6가 별도로 검증한다.

assistant p_input은 P6 원형 7필드, quality는 quick/review, reviewOf는 null 또는 `{requestKey,exchangeId}`. 학생 초안의 실제 quality는 review. 정밀검토는 같은 사용자의 완료 quick 답변을 확인하고 원 입력의 references를 복원한다. reviewSnapshot은 최신 history 범위 밖이어도 원답변의 segments를 정확히 포함한다. studentIdentity는 P5 학생·수업 권한 검증을 통과한 같은 학교의 등록 식별번호와 이름이며 상담 자료를 추가 조회하지 않는다. evaluation은 p_input/p_review_of/assistant/reviewSnapshot/studentIdentity 모두 null이다. 실제 공급자 본문은 서버에서 한 번 만들며 count_tokens와 start 후 messages 요청에 같은 본문을 쓴다.

start data `{started:boolean}`. `true` 한 번만 외부 유료 호출권을 준다. 사전 count 상한은 입력 80,000·출력 8,000이며 캐싱은 사용하지 않는다. 비용 예약은 입력 100,000·출력 8,000 기준으로 quick 14,000 / review 280,000 microUSD다. 현재 회원·학교 연결·근거·키 판·예산월을 다시 검증한다. ciphertext는 AES-256-GCM; iv 12바이트, tag 16바이트 strict base64. AAD는 `JSON.stringify(['workhub.ai.school-key.v1',schoolId,credential.version])`.

finish p_result:

- `{state:'completed',response:<검증한 JSON>,usage:{inputTokens,outputTokens},providerMessageId:string}`
- `{state:'rejected',code:'OUTPUT_INVALID'|'PROVIDER_REJECTED'|'TRUNCATED',usage:null|{inputTokens,outputTokens},providerMessageId:null|string}`
- `{state:'provider_unknown'}`
- `{state:'provider_unknown',observedUsage:{inputTokens,outputTokens}}`

assistant completed.response는 기존 P6 checked_output 전체를 넣는다. SQL이 P6 finish로 근거와 대화를 반영한 공개 결과를 최종 response로 저장한다. evaluation response는 기존 reply/stop_reason/truncated/usage/carry 결과다. completed data는 `{state:'completed',response,quality,model,usage}`. 승인 범위 안의 알려진 사용량은 파싱 실패·권한 회수 때도 기록하며 답변 노출만 차단한다. 실제 입력 100,000 또는 출력 8,000 초과는 자동 정산하지 않는다. observed_usage에 관측값을 남기고 원예약을 유지하며 해당 학교 overage_blocked로 새 호출을 중지한다. 이 행은 기존 수동 정산 RPC로도 처리할 수 없고 별도 승인·증분이 필요하다.

release reason은 COUNT_FAILED/INPUT_TOO_LARGE/CANCELLED. 시작 전만 `{state:'failed',code}` 또는 `{state:'closed'}`로 종료·0원 해제한다. CANCELLED+leaseToken null은 준비 응답을 받지 못했을 때도 원키를 닫으며, 미접수 원키에는 tombstone을 남겨 늦은 prepare를 막는다. 만료·키 회전·예산월 변경·정책 중지 뒤에도 현재 권한이 있으면 prepared 원키를 닫을 수 있다. 시작 후에는 pending을 유지하며 예약액을 없애지 않는다. 이미 완료/실패한 요청은 원접수증을 반환한다. recover는 새 예약·새 호출권을 만들지 않으며 없으면 `{state:'missing'}`다.

## 학교 키 관리

- `workhub_ai_school_status(p_actor_user_id uuid,p_member_id text)`
- `workhub_ai_school_key_save(p_actor_user_id uuid,p_member_id text,p_request_key text,p_expected_version integer,p_envelope jsonb,p_masked_suffix text)`
- `workhub_ai_school_key_recover(p_actor_user_id uuid,p_member_id text,p_request_key text)`
- `workhub_ai_school_key_close(p_actor_user_id uuid,p_member_id text,p_request_key text,p_expected_version integer)`

status: `{contract:'assistant.school.v1',schoolId,memberId,policyVersion,canManage,credential:{configured,version,maskedSuffix,updatedAt},budget:{month,timeZone,currency:'USD',limitMicroUsd:100000000,settledMicroUsd,reservedMicroUsd,availableMicroUsd},models:{quick:{id,label},review:{id,label}},status:'ready'|'key_missing'|'policy_missing'|'budget_exhausted'|'disabled'}`.

save/recover/close: `{contract:'assistant.school.v1',schoolId,memberId,requestKey,state:'applied'|'pending'|'closed',credentialVersion:number|null}`. p_envelope={keyId,iv,ciphertext,tag}; AAD version=p_expected_version+1. 같은 키는 최초 접수증을 반환한다. close는 저장 접수증이 있으면 applied 원본을 반환하고, 없으면 closed tombstone을 남겨 늦은 save를 막는다. recover에는 expectedVersion 인자가 없다. 현재 year.manage 권한을 매번 확인한다. 키 저장은 정책·모듈 활성화를 하지 않는다.

위 네 설정 RPC의 예상 거절은 `{error:{code}}`이며 SQL HTTP400 문자열을 해석하지 않는다. CONFLICT/IDEMPOTENCY_CONFLICT/INVALID_INPUT/현재 권한 거절만 명시 코드로 돌려주고 예상 밖 DB 오류는 그대로 실패한다. status의 budget_exhausted는 잔액이 0보다 커도 다음 최소 예약 14,000 미만이면 가능하다. disabled에는 overage_blocked가 포함된다.

## 운영자 양식 RPC

- `workhub_ai_school_policy_register(p_actor_user_id uuid,p_member_id text,p_approval_ref text)`: 고정된 두 모델의 P6 가격판과 비활성 학교 정책 생성.
- `workhub_ai_school_link_legacy(p_actor_user_id uuid,p_member_id text,p_user_ids uuid[],p_approval_ref text)`: 확인한 기존 승인 UID만 학교에 명시 연결. 회원·Auth 생성 없음.
- `workhub_ai_school_control(p_actor_user_id uuid,p_member_id text,p_enabled boolean,p_approval_ref text)`: 별도 켜기/중지. 키 없는 켜기와 overage 차단 해제는 불가. 기존 assistant 모듈 활성화와 별개.
- `workhub_ai_school_resolve(p_actor_user_id uuid,p_member_id text,p_gateway_id text,p_input_tokens integer,p_output_tokens integer,p_evidence_ref text)`: 공급자 청구를 확인한 unknown만 승인 상한 안에서 정산. observed_usage 행은 거부.

05~08은 값이 없는 실행 양식이며 설치 파일과 분리한다. service_role과 현재 year.manage 권한이 필요하다.

## 기존 대화 읽기

authenticated 전용 `workhub_ai_policy_threads_list(p_member_id text,p_mode text,p_cursor text)`와 `workhub_ai_policy_thread_get(p_member_id text,p_thread_id text,p_cursor text)`. 기존 assistant.v1 구조를 유지하고 새 원장이 있는 exchanges에만 execution:{quality,model,reviewOf}를 추가한다. 기존 메타 없는 답변을 quick으로 추측하지 않는다.
