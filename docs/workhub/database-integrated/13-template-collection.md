# 13. 양식 분석·문답 작성·문서 수합 구현 계약 v1.1

작성일: 2026-10-13. 상태: **사용자가 요청한 설계 보완안. 실제 DB 구축·SQL 실행·문서 AI 구현은 보류.** 기존 02장의 수합·파일 계약과 04장의 Claude·작업 계약을 확장한다. 실행 SQL이나 운영 중인 인증·회원·권한 변경이 아니다. 기계 판독 명세는 collection-extension.json이며, 기존 schema-contract.json의 1.0 기준과 함께 읽는다.

## 1. 사용자 요구와 구현 원칙

담당자가 양식을 올리고 Claude가 수합 항목과 형식을 분석한다. Claude가 파일 작성형 또는 문답형을 근거와 함께 추천하고 담당자가 결정한다. 파일 작성형은 내려받기→외부 작성→업로드→미리보기/확인→제출, 문답형은 질문 또는 직접 입력→완성본 확인→제출이다. 질문 중 증빙 파일을 받는 혼합 사용을 지원하되 교사에게 별개의 세 번째 시스템을 학습시키지 않는다.

두 방식은 같은 collection/unit/schema/submission과 제출·검토·보완·철회·완료본 규칙을 사용한다. AI 대화 완료, 파일 생성 완료, 파일 다운로드, 공식 제출, 담당자 검토 완료는 각각 별도 사실이다. 업로드·AI 답변·출력만으로 제출 상태가 바뀌지 않는다. AI 없이 직접 입력하거나 파일을 작성해도 업무를 마칠 수 있어야 한다.

Claude는 분석·질문·문장 정리·누락 안내를 담당한다. 서식 치환·표 확장·합계·파일 검증·필수값·권한·접수는 코드가 수행한다. 분석 결과에 들어 있는 임의 명령·수식·외부 URL을 실행하지 않는다. 양식 내 문장은 분석 대상 데이터이지 시스템 지시가 아니다.

현재 구현에 이 문서의 양식 분석·질문 매핑·임의 문서 자동 채움이 존재한다고 주장하지 않는다. 검증된 평가계획서 자산 및 apps/main/api/_hwpx는 읽기·재사용 경계이며 수정하지 않는다. 새 일반 양식은 기존 6종과 별도 검증 경로를 거쳐야 한다. 특정 HWP/HWPX/DOCX/PDF를 올렸다는 이유만으로 자동 작성 지원으로 판정하지 않는다.

## 2. 화면과 담당자의 책임

| 화면 | 주 사용자 | 입력·동작 | 다음 단계의 조건 |
|---|---|---|---|
| 수합 만들기 | 요청관리자 | 제목, 목적, 마감, 제출 단위, 검토 필요 여부, 양식 업로드 | 학교·담당 범위·파일 실물 검증 |
| 양식 분석 결과 | 요청관리자 | 발견 항목, 표/반복행, 서명/첨부, 해석 불확실 부분, 방식 추천 확인 | 문답 지원과 파일 보관 가능 여부를 분리 |
| 질문·칸 연결 편집 | 요청관리자 | 질문/필수/선택지/조건/반복행, 정확한 양식 칸 연결 | 허용된 필드·표현식·출력 계약 검증 |
| 표본 확인 | 요청관리자 | 합성 답변으로 만든 문서와 누락/잘림 리포트 확인 | 정확한 매핑판·엔진판·팩판의 필수 검사 통과 |
| 게시 미리보기 | 요청관리자 | 대상 단위·책임자·공동작성자, 질문/방식, 마감, 결과 공개 확인 | 대상 snapshot·문항판·표본 확인 지문 고정 |
| 내 제출 | 대상 교사 | AI와 작성/직접 입력/파일 작성, 임시 저장, 재개 | 필수 입력·첨부·현재 단위 권한 |
| 제출 전 확인 | 책임자·유효 대리 | 최종 답변, 출력 파일, 제출 의미 확인 | 현재 답변판과 정확한 파일에 대한 본인 확인 |
| 수합 현황 | 요청관리자·지정 검토자 | 제출/미제출/보완/완료 구분, 검토·재안내 | 미제출 초안 본문·파일명·건수는 미노출 |
| 내려받기 | 허용된 요청관리자 | 완료본 기본, 미승인 포함은 명시 선택 | 고정 선택판 manifest·파일 검사·현재 권한 |

휴대전화에서는 질문 한 묶음과 다음 행동을 먼저 보여 주고 진행률은 필수 활성 항목 기준으로 계산한다. 문항 전부와 AI 대화가 서로 다른 답을 저장하지 않도록 unit_drafts를 단일 편집 원장으로 사용한다. AI 입력 제안은 검토 후 해당 항목에 반영하며 사용자가 입력한 값을 조용히 덮어쓰지 않는다. 문답과 직접 입력 전환 시 같은 초안을 이어 쓴다.

담당자가 게시하는 의무는 개인별 또는 학년/교과 공동 단위이다. 공동 단위에서 작성자 여러 명이 답변을 편집할 수 있어도 최종 제출은 책임자 또는 유효 대리만 한다. 개인 준비초안을 담당자에게 자동 공유하지 않으며 공동 초안으로 복사하는 행위는 작성자가 미리 확인한다.

## 3. 추천·지원수준·폴백

분석 응답은 recommendation, reasons, uncertain_items, required_capabilities, available_capabilities, extraction_evidence를 반환한다. 숫자로 표현한 모델 신뢰도 하나로 지원 여부나 공개를 결정하지 않는다.

| 판정 | 의미 | 허용 경로 |
|---|---|---|
| file_only | 파일을 전달·보관할 수 있으나 자동 채움은 검증하지 못함 | 파일 작성형 |
| guided_candidate | 항목과 칸 후보를 찾았으나 매핑/출력 검증 전 | 담당자 편집·표본 검증까지만 |
| guided_verified | 정확한 양식 hash+매핑판+출력 엔진/팩판의 필수 검사 통과, 담당자 확인 | 문답형 게시 가능 |
| blocked | 파일 손상·암호화·안전정책 차단 등 사용 불가 | 원인 표시·다른 파일 등록 |

상태는 extension 전용 판정이며 기존 document_packs.support_level 값을 덮어쓰지 않는다. file_only는 다운로드 안전성까지 자동 승인한다는 뜻이 아니며 기존 파일 정책을 별도 통과해야 한다.

추천은 자유 서술량·반복 구조·첨부/서명·조건부 항목·정확한 출력 가능성·미해결 칸을 함께 고려한다. 담당자가 문답형을 선택해도 guided_verified 조건을 우회하지 못한다. 스캔 이미지, 병합셀, 복잡한 수식·차트, 암호화 파일 등은 실제 파서·출력 검증 결과를 기준으로 판정한다. 초기에 지원하는 파일 형식·크기·반복행 한도는 승인된 capability/정책 설정으로 정하고 여기서 임의 수치를 확정하지 않는다.

문답형 생성이 실패하면 답변은 보존하고 재시도·직접 입력을 제공한다. 파일 작성형으로 전환하려면 담당자가 새 문항판의 영향 목록을 확인해야 한다. 파일 작성으로 바꾸어도 이미 제출한 답변을 지우거나 완료본을 되돌리지 않는다. 반드시 원형 문서를 납품해야 하는 업무에서 임의 PDF/텍스트로 대체해 성공으로 표시하지 않는다.

## 4. 필드·질문·양식 칸의 계약

collection_fields.field_key는 label에서 자동 생성하지 않는 안정 식별자다. 같은 의미를 복제하는 새 schema에서는 유지하고 의미·타입이 바뀌면 새 key를 부여한다. collection_fields.id는 그 문항판의 실제 행 ID이며 stable key와 구별한다. 출력 매핑은 같은 template version 안의 안정 target_key와 구조적 locator를 가진다. 셀의 화면 좌표만으로 치환하지 않고 실제 파서가 검증 가능한 문서 위치를 사용한다.

필드 형식은 기존 short_text/number/date/boolean/single_choice/multi_choice/file을 유지하며 필요한 long_text와 repeat_group을 명시 확장한다. 파일 작성형은 결과 문서를 받는 file 필드 한 개와 필요한 공통 질문을 정의한다. 문답형은 결과 문서를 받는 output_file_field_id가 정확한 같은 schema의 file 필드여야 한다. 이 결과 문항은 교사 질문 목록에서 숨기고 서버 산출물 연결용으로 사용한다.

guided schema는 output_file_field_id가 가리키는 generated_output 문항이 정확히 한 개여야 한다. 그 문항은 kind=file, parent_field_id와 activation_rule은 NULL, required=true, file_max_count=1이다. 역방향으로도 모든 generated_output 문항은 guided schema의 유일한 output_file_field_id여야 한다. 두 번째 생성 문항이나 포인터 없는 생성 문항은 게시뿐 아니라 schema/field 지연 무결성 검사에서 거부한다. file_upload는 결과 문항이 같은 조건의 field_role=input이며 generated_output은 0개다. 기존 일반수합(response_mode=NULL)에도 generated_output을 만들지 않는다. 따라서 생성되지 않을 두 번째 필수 출력파일 때문에 영원히 제출하지 못하는 정의를 저장할 수 없다.

반복행은 repeat_group 아래 같은 schema의 자식 문항을 두며 답변은 [{row_key, values:{field_key:value}}]이다. row_key는 행 순서/이름과 별개의 서버 발급 안정 키다. 부모 cycle, 허용 깊이 초과, 중복 row_key, 정의되지 않은 키, 허용 범위 밖 행 수를 거부한다. 초기는 단일 반복 깊이를 기본 구현 범위로 두고 더 깊은 중첩은 unsupported로 표시한다. 행 수 한도는 검증된 출력 팩의 한도와 학교 정책의 교집합이다. 파일 첨부는 answer_path=[group_key,row_key,field_key]로 구별한다.

조건부 질문은 허용된 비교/논리식 AST만 받는다. 예: field=participates, op=eq, value=true. 임의 JavaScript·SQL·템플릿 코드는 금지한다. 참조 대상이 같은 schema에 존재해야 하며 순환 의존을 거부한다. 활성 문항의 필수 조건만 검사한다. 조건 변경으로 숨겨진 값은 초안에 보존하고 제출 미리보기에 '이번 제출에서 제외'를 표시한다. 출력·제출 snapshot은 활성 답변 projection을 사용하여 숨긴 과거 값이 파일에 남지 않게 한다.

검증 phase는 draft/prepare_output/submit으로 구분한다. prepare_output은 활성 입력 문항과 증빙 첨부를 검사하되 아직 만들지 않은 generated_output 파일을 필수 누락으로 처리하지 않는다. submit은 생성된 exact 파일을 포함한 submission_files를 같은 접수 트랜잭션에서 검사한다. 답변 JSON의 파일 표시값만으로 필수 파일을 충족시킬 수 없고, 서버가 만든 typed 파일관계가 정본이다.

대화에서 숫자·날짜를 추출해도 타입·범위는 코드가 검사한다. 0과 false는 유효값이며 빈칸과 구별한다. 미확정 항목은 unresolved 상태로 표시하고 필수 항목이면 제출을 막는다. 학교·이름·교과·수업 배정 등 사전 채움은 현재 권한 있는 원본과 source revision/asOf를 표시한 제안이다. 지난해 문서의 값을 현재 사실로 확정하지 않는다.

AI의 제안과 교사의 확정은 구별한다. collection_answer_snapshots.provenance에는 source_kind, source_ref, proposed_by(ai/user/prefill), confirmed_by_account_id, confirmed_at를 필드 경로별로 기록한다. source_ref는 승인된 typed 참조만 허용하고 ACL을 대신하지 않는다. 답변 snapshot의 값과 provenance에 불일치가 있으면 출력하지 않는다.

## 5. 불변 사슬과 재사용

연결 정본은 다음과 같다.

~~~text
collection_templates
  → collection_template_versions (원본 file ID + 실물 hash)
  → collection_template_analyses (정확한 양식판 + Claude 실행/작업)
  → collection_template_mappings (칸/질문 매핑판 + 출력 계약 + 검증 표본)
  → collection_schemas (담당자가 게시한 질문판·작성방식)
  → unit_drafts (개인/공동 현재 답변, 낙관적 버전)
  → collection_answer_snapshots (정확한 답변판·활성 답변·첨부 지문)
  → documents / document_revisions (생성 내용과 정확한 출력판)
  → collection_output_artifacts (답변/양식/매핑/출력 파일의 결합)
  → collection_output_confirmations (실제 제출자의 최종 확인)
  → submission_versions + submission_files (기존 원자 접수)
~~~

양식은 같은 학교 안에서 재사용할 수 있다. 새 수합은 양식판/승인 매핑을 참조하되 대상·마감·질문판·정책을 새로 만든다. 다른 학교로 복사하려면 빈 양식과 매핑만 명시적으로 복제하는 별도 권한 기능이 필요하며 답변·개인자료·권한은 복사하지 않는다. 초기 구현에서는 같은 학교 재사용으로 한정한다.

원본 파일 교체는 새 template version, 분석 재시도는 새 analysis, 매핑 내용 변경은 새 mapping version이다. 같은 분석 결과를 사람이 고쳤으면 source='human_review'와 수정 근거를 기록한다. 미검증 AI 매핑을 승인판으로 위장하지 않는다. 샘플 문서는 실학생/실교사의 응답이 아닌 합성 fixture로 만들며 원본 텍스트 자체에 개인정보가 있으면 마스킹과 안전정책 검사를 먼저 한다.

게시 schema는 불변이다. 게시 후 문항·조건·모드·출력 대상·양식을 바꾸면 새 schema를 만든다. 영향 미리보기는 단위별 초안/미제출/검토 대기/완료/열린 보완과 호환 가능한 필드 매핑을 반환한다. 기존 02장 규칙대로 pending 제출 또는 열린 보완이 있는 단위에는 모드 변경을 적용하지 않는다. 단위별 활성 schema 이동은 담당자의 명시 적용과 현재 기대판 확인으로 처리하고, 기존 제출판과 완료본의 schema는 바꾸지 않는다.

새 판으로 답변을 옮길 때는 같은 안정 key·타입·선택지 의미가 검증된 항목만 복사 후보로 제시한다. 책임자가 복사 결과를 확인해야 하며 제거 필드·유형 변경·조건 변경을 조용히 버리거나 임의 변환하지 않는다.

서버는 게시 schema의 입력 필드 정의를 승인 mapping의 field_definition과 대조한다. 라벨·도움말만 바꾸는 것도 새 schema 지문에 기록하고, 출력 의미·타입·조건·반복 구조가 달라지면 새 mapping과 표본 검증을 요구한다. mapping 승인 후 별개 schema를 임의 작성해 필드 연결을 바꾸는 우회를 허용하지 않는다.

## 6. 추가 표와 기존 표 보강

열의 정확한 목록과 제약은 collection-extension.json이 정본이다. 모든 신규 표는 TEXT UUID id PK, UNIQUE(school_id,id), 학교 복합 FK, 기본 삭제 RESTRICT를 사용한다. current/head의 version과 불변 material version_no를 혼동하지 않는다.

| 표 | 역할 | 핵심 연결/불변 조건 |
|---|---|---|
| collection_templates | 같은 학교에서 재사용할 양식의 이름·관리 주체 | 생성자 계정과 현재 명시 관리권한; retired는 과거 사슬 보존 |
| collection_template_versions | 업로드 양식의 정확한 원본판 | template+version_no 유일, file ID/hash 고정 |
| collection_template_analyses | 양식 분석 결과·추천·불확실성 | template version+job+ai_run; 외부 결과 unknown은 성공 아님 |
| collection_template_mappings | 출력 위치·질문 연결·표본 검증·담당자 승인 | 원본판/analysis/매핑판 불변, 승인 시 표본 문서·검사·확인 정확 일치 |
| collection_answer_snapshots | 출력/제출에 사용하는 답변 동결판 | school+unit+schema+draft+draft_version+첨부 manifest 불변 |
| collection_output_artifacts | 답변 snapshot에서 만든/확인한 정확한 파일 | unit/schema/mapping/document revision/file/hash, 생성 성공과 제출 분리 |
| collection_output_confirmations | 제출자의 정확한 결과 확인 증거 | artifact+draft version+manifest hash+actor, 후속 변경 시 효력 상실 |

기존 보강은 다음과 같다.

- collection_schemas: response_mode(file_upload/guided), template_version_id, mapping_id, output_file_field_id, output_requirement(original_required/validated_output) 추가. 기존 텍스트/숫자 수합은 response_mode=NULL로 유지할 수 있으며 신규 양식 수합만 명시 모드 필요.
- collection_fields: parent_field_id, activation_rule, repeat_min/max, field_role(input/generated_output) 추가. 부모·출력 문항은 정확한 schema 복합 FK.
- unit_drafts: 기존 version과 JSON answers 재사용. AI 대화 세션 자체를 답변 정본으로 사용하지 않음.
- documents/document_revisions/document_validations: 기존 생성/출력/팩/검사 사슬 재사용. unit-linked 문서는 단위 초안 ACL도 추가로 만족해야 함.
- document_revisions에는 collection_unit_id, collection_schema_id, collection_answer_snapshot_id, collection_template_version_id, collection_mapping_id, collection_generation_input_sha256, collection_renderer_contract_version을 선택 묶음으로 추가한다. 수합 생성판이면 모두 존재하며 원본문서 linked_unit_id·exact schema/답변 snapshot·승인 매핑·실제 작업 입력 지문과 일치한다. artifact는 scope만 확인하지 않고 이 정확한 8열 복합키(학교·문서·문서판·단위·문항판·답변 snapshot·양식판·매핑판)를 참조한다. 다른 단위의 정상 생성파일을 재포장하는 것은 같은 학교라도 거부한다.
- file_objects/file_links/submission_files: 기존 실물 검증과 typed 링크 재사용. 반복문항용 answer_path를 보강하고 file_links 허용 resolver에 양식판·표본·output artifact를 구현/음성시험 후 추가.
- submission_versions: answer_snapshot_id, output_artifact_id, output_confirmation_id의 정확한 단위/문항판 FK 추가. 기존 수합에는 NULL 허용, 문답형과 신규 파일 수합에는 제출 정책에 맞는 확인 사슬 필수.
- export_manifests/export_manifest_items: 새 원장을 만들지 않고 정확한 제출판·파일 hash를 재사용.
- jobs/ai_runs/job_external_calls: 기존 임대·멱등·권한·외부결과 unknown 계약 재사용. 모델명·비용·max_tokens·캐싱은 이번 설계에서 변경하지 않음.

문서 원본에 linked_unit_id가 있으면 소유자라는 이유만으로 종료된 단위 자료에 접근할 수 없다. unit 연결 산출물은 문서 ACL과 현재 초안/제출 ACL의 교집합이다. 담당자는 제출 전 artifact·문서·파일·작업 결과·검색·건수로 초안을 우회해 읽지 못한다. 제출 후에는 제출판에 연결된 정확한 산출물만 볼 수 있다. private draft 문서의 owner를 담당자로 바꾸어 해결하지 않는다.

개인초안의 문서는 기존 shared_with=none, 공동초안의 문서는 shared_with=unit_members를 사용한다. 각 경우 현재 초안 구성원/소유자 조건도 함께 검사하며 school/duty_members 공유로 개인초안 자료를 확대하지 않는다. 제출된 정확한 문서판 열람은 제출판의 별도 typed 경로에서 허용하고 개인초안 문서 전체를 공개하지 않는다.

### 기존 제약·인덱스의 명시 대체

이 확장은 새 제약을 덧붙이는 것만으로 구현할 수 없다. 다음 원본 제약/인덱스는 동반 JSON의 supersedes_constraints/supersedes_indexes로 목표 설계에서 명시 대체하며 원본 DDL과 운영 DB에는 손대지 않는다. 이전 정의는 대상 설계의 superseded 이력으로 남기고 유효한 제약 목록에 중복 유지하지 않는다.

| 대체하는 기존 이름/정의 | 새 목표 계약 |
|---|---|
| collection_fields_kind_check | 기존 7종과 long_text/repeat_group을 허용하는 명시 CHECK |
| submission_files_pkey 및 같은 이름의 backing index | PRIMARY KEY(submission_id,answer_path,file_object_id), 학교 포함 UNIQUE(school_id,submission_id,answer_path,file_object_id) |
| file_links_resource_type_resource_id_file_object_id_role_key 및 같은 이름의 backing index | 아래 새 활성 링크 UNIQUE |
| 기존 활성 UNIQUE(scope_key,resource_type,resource_id,resource_version,field_id,file_object_id,role) | UNIQUE(scope_key,resource_type,resource_id,resource_version,field_id,answer_path,file_object_id,role) NULLS NOT DISTINCT WHERE unlinked_at IS NULL |

같은 file_object를 같은 반복 문항의 다른 row_key에 붙이는 것은 허용하고 같은 경로의 중복 활성 연결은 거부한다. 불변 snapshot의 연결은 별도의 동결 규칙으로 유지한다. 생성기가 이전 backing index나 경로 없는 활성 UNIQUE를 계속 남기면 새 기능이 거부되므로 COL21로 합성 목표 계약과 실제 후속 DDL을 각각 검증해야 한다.

## 7. 상태와 트랜잭션 경계

양식/매핑 준비 상태와 교사의 제출 상태를 합치지 않는다.

- 분석: queued → running → succeeded / needs_review / failed / outcome_unknown / cancelled. jobs의 상태를 안전하게 projection하며 실패·unknown은 검증 완료가 아니다.
- 매핑: candidate → verified → approved → retired. 내용 수정은 새 판. approved에는 표본·필수검사·담당자 확인이 모두 필요.
- 산출물: queued → running → ready / failed / stale / cancelled. 답변/첨부/양식/매핑/팩/규칙이 바뀌면 기존 산출물은 보존하면서 새 제출용 사용을 stale로 막는다.
- 확인: 불변 사실이다. 현재 초안/산출물/hash와 맞지 않으면 과거 확인을 새 제출에 사용할 수 없다.
- 제출: 기존 02장의 current/effective·review/보완/철회 규칙 그대로다.

cmd_prepare_collection_output은 현재 unit/schema/draft/첨부 manifest를 잠그고 불변 answer snapshot과 job 또는 검증 대기 artifact를 등록한다. AI/렌더러 호출 동안 DB 잠금은 유지하지 않는다. worker는 lease_token·현재 권한·정확한 snapshot을 확인하여 새 document revision과 실제 file object를 만들고 검증 후 ready로 연결한다. 작업 완료 전에 답변이 바뀌어도 과거 결과를 최신 초안에 덮어쓰지 않고 stale로 반환한다.

생성형의 ready는 파일이 존재한다는 뜻보다 엄격하다. exact document_validations.state=pass, 오류 finding=0, 필수검사 skipped=0, 활성 필수 미확정=0, checked_sha256=실제 출력파일 hash=document_revisions.output_sha256를 모두 만족해야 한다. 문서판에 기록한 실제 팩 ID/범위/자산 hash·renderer 계약판·양식/매핑·답변 snapshot과 승인 표본/검사 규칙판의 호환성이 검증되어야 한다. 실제 render job.input_sha256와 문서판의 collection_generation_input_sha256도 일치시킨다. needs_review/error/not_checked, 다른 hash의 성공 검사, 생략된 필수검사는 ready로 승격할 수 없다. 확인·제출 시에도 현재 안전정책과 exact 사슬을 재검사한다.

파일 작성형은 업로드된 최종 파일의 실제 hash/형식/안전정책을 검증하고 artifact(kind='uploaded')로 묶는다. 내용 이해·맞춤법·업무 규정 준수까지 자동 검증했다고 표시하지 않는다. 미리보기 불가능한 형식은 '미리보기 미지원, 내려받아 확인'으로 안내하며 실제 원본을 읽을 수 있는 확인 경로를 제공한다.

cmd_confirm_collection_output은 actor가 확인한 artifact ID·exact file hash·answer manifest·현재 draft version을 고정한다. 공동작성자가 preview를 봤어도 책임자/유효 대리가 최종 확인해야 한다. 제출 직전 책임자가 바뀌면 기존 actor의 확인으로 새 책임자가 제출할 수 없다.

개인 초안을 공동 제출하기 위해 복사한 경우에는 공유 초안에서 새 snapshot·산출물·확인을 만든다. 개인 초안의 artifact를 공유 제출판에 직접 붙여 개인 초안 전체의 접근권을 옮기는 우회는 금지한다. 파일형 단독 단위도 기존 제출 계약에 따라 책임자 자신의 명시 제출용 초안에서 같은 절차를 적용한다.

cmd_submit은 기존 잠금 순서에 template/mapping/snapshot/artifact/confirmation을 사전 정렬해 포함하고 현재 권한·policy·schema·draft·입력 manifest·파일 실물 상태·확인 actor를 재검사한다. answer snapshot↔artifact↔confirmation↔submission↔submission_files와 unit pointer, receipt, audit, outbox를 하나의 트랜잭션으로 확정한다. 하나라도 stale이면 전체 0건이다. 파일 생성 성공 이후 제출이 실패해도 '문서 준비 완료, 아직 제출하지 않음'을 표시하고 안전하게 재시도한다.

재시도는 동일 idempotency_key/동일 본문이면 동일 결과, 다른 본문이면 IDEMPOTENCY_CONFLICT다. 완료됐는지 모르는 외부 AI 호출은 job_external_calls의 unknown 복구 계약을 따르고 무조건 재호출하지 않는다.

## 8. API 계약과 예시

공통 학교/소속·expected_version·idempotency_key·현재 권한·파일 정책은 01/02/04/05를 따른다. 요청 봉투는 scope={school_id}와 idempotency_key를 사용한다. 성공 봉투의 operation_id, status(committed/accepted), resource, server_recorded_at, next_action과 오류 봉투의 code, retryable, correlation_id, 안전한 설명은 05장 공통 계약을 그대로 상속한다. receipt/job_id 등은 추가 도메인 정보이며 공통 봉투를 대체하지 않는다. 아래 endpoint 명칭은 기존 cmd_* 계약을 HTTP 또는 RPC 어댑터에 매핑할 때 사용하는 목표 명령이며 현재 배포된 API라고 주장하지 않는다. 동반 JSON의 API-27·API-28에 목록을 등록한다.

### API-27: 양식 분석·매핑 확정

명령: cmd_register_collection_template, cmd_analyze_collection_template, cmd_save_collection_mapping, cmd_validate_collection_mapping, cmd_approve_collection_mapping.
조회: collection_template_detail, collection_template_analysis, collection_mapping_preview.

등록 입력: scope={school_id}, collection_id(초안 연결 시), file_object_id, expected_file_version, title, idempotency_key.
등록 결과: template_id, template_version_id, source_sha256, support='file_only', resource version/receipt.

분석 입력 예:
~~~json
{
  "scope": {"school_id": "school-example"},
  "template_version_id": "template-version-example",
  "expected_version": 1,
  "idempotency_key": "analyze-example-1"
}
~~~

접수 결과 예:
~~~json
{
  "operation_id": "operation-analysis-example",
  "status": "accepted",
  "resource": {"type": "collection_template_analysis", "id": "analysis-example", "version": 1},
  "server_recorded_at": "2026-10-13T03:00:00Z",
  "next_action": "poll_analysis",
  "job_id": "job-example",
  "recommendation": null,
  "receipt": {"id": "receipt-example"}
}
~~~

분석 완료 조회는 recommendation='guided_candidate', reasons, uncertain_items, field_candidates, target_candidates, capability_report와 정확한 source_sha256를 반환한다. 아직 검증 전이면 '자동 채움 가능'으로 표시하지 않는다.

매핑 확정 입력: mapping_id, expected_version, mapping_sha256, sample_document_id/revision_no, sample_validation_id, sample_manifest_sha256, acknowledged_findings, idempotency_key.
확정 결과: approved_mapping_id/version_no, template_version_id, approved_by/at, verification report, receipt.
대표 오류: TEMPLATE_NOT_READY, TEMPLATE_SOURCE_CHANGED, MAPPING_UNVERIFIED, SAMPLE_OUTPUT_MISMATCH, REQUIRED_VALIDATION_SKIPPED, UNSUPPORTED_OUTPUT_FORMAT, FIELD_MAPPING_INVALID.

### API-28: 문답·직접 입력·출력 준비·확인

명령: cmd_propose_collection_answers, cmd_apply_collection_answer_proposal, cmd_prepare_collection_output, cmd_confirm_collection_output.
조회: collection_interview_context, collection_output_preview.
직접 입력 저장은 기존 API-09 cmd_save_draft를 그대로 사용한다.

AI 답변 제안은 현재 schema+draft version과 사용자 메시지를 입력받아 patch 후보·근거·확인 필요 항목만 반환한다. apply 명령은 교사가 선택한 field paths와 기대판을 검사한 뒤 기존 draft 저장 명령으로 연결한다. 모델 출력에 없는 필드를 임의로 추가하거나 숨은 자동 제출 도구를 호출하지 않는다. 통합 대화 UI를 쓰더라도 해당 단위/학교 맥락과 현재 접근을 고정한다.

출력 준비 입력 예:
~~~json
{
  "scope": {"school_id": "school-example"},
  "unit_id": "unit-example",
  "schema_id": "schema-example",
  "draft_id": "draft-example",
  "expected_unit_version": 3,
  "expected_draft_version": 7,
  "idempotency_key": "output-example-7"
}
~~~

접수 결과 예:
~~~json
{
  "operation_id": "operation-output-example",
  "status": "accepted",
  "resource": {"type": "collection_output_artifact", "id": "artifact-example", "version": 1},
  "server_recorded_at": "2026-10-13T03:05:00Z",
  "next_action": "poll_output",
  "answer_snapshot_id": "snapshot-example",
  "job_id": "job-render-example",
  "submission_state": "not_submitted"
}
~~~

미리보기 조회는 현재 actor가 볼 수 있는 exact file/hash, active answers, excluded fields, unresolved fields, document revision, validation summary, manifest hash, stale reasons를 반환한다. file hash·manifest hash는 서버 검증값이며 클라이언트 주장을 그대로 저장하지 않는다.

확인 입력: artifact_id, expected_artifact_version, expected_draft_version, observed_manifest_sha256, idempotency_key.
확인 결과: confirmation_id, artifact_id, manifest_sha256, confirmed_at, can_submit, receipt. can_submit은 조회 당시 정보이며 실제 submit 재검사를 대신하지 않는다.

기존 API-09 제출 입력에 answer_snapshot_id, output_artifact_id, output_confirmation_id를 추가한다. 예시의 모든 ID/hash는 형식 예시이며 실제 권한을 갖는 토큰이나 운영 데이터가 아니다.

오류 응답 예:
~~~json
{
  "status": "conflict",
  "error": {
    "code": "OUTPUT_STALE",
    "retryable": false,
    "correlation_id": "correlation-output-example",
    "message": "답변이 변경되어 문서를 다시 준비해야 합니다.",
    "details": {"expected_draft_version": 7, "current_draft_version": 8},
    "retry_action": "prepare_output"
  }
}
~~~

권한 없는 actor에게는 current draft 값·타학교 ID 존재·첨부명 등을 details로 반환하지 않는다. 지원 불가를 빈 문서 성공으로 바꾸지 않는다.

### 기존 API-08~10 보강

- API-08 게시: 모드·template version·approved mapping·schema hash·대상 manifest를 함께 고정한다. 문답형은 exact 검증 사슬 누락 시 게시 거부.
- API-09 저장/제출: 조건부·반복행 검증, draft 변경 시 현재 output stale 계산, final confirmation 재검사. 외부 편집 최종본 재업로드는 새 파일/산출물 확인.
- API-10 내보내기: **기본 선택을 effective(완료본)**로 통일한다. 미승인 제출본을 함께 받을 때 received를 명시 선택하고 파일명·현황표에 검토 상태를 표시한다. 이는 02장 13절의 이전 1.0 received 기본을 대체하며 현재 02장과 동일한 계약이다. 완료본 없는 단위를 ZIP에서 조용히 누락하지 않고 manifest의 미완료 사유로 표시한다.

## 9. 파일 정리·검토·재안내

기본 묶음은 단위별 effective_submission_id에 연결된 정확한 파일과 답변 현황표다. 표시 이름이 바뀌어도 안정 unit ID와 제출판을 manifest에 남긴다. ZIP 경로는 서버가 정규화하고 동명이인·동일 제목의 충돌을 피한다. 수합 제목/단위 표시명/제출판/검토상태 조합을 사용하며 민감정보를 파일명에 과도하게 넣지 않는다.

수합 담당자가 '미제출자에게 안내'를 누르면 현재 obligation_state와 current/effective/열린 보완을 구분하여 대상 미리보기를 만든다. 메신저 단체 발송은 수합을 완료하거나 초안을 읽는 권한이 아니다. 메시지 전송의 실제 recipient snapshot·발송 확인은 메신저 계약을 따른다.

부분 내보내기 실패는 manifest item마다 사유와 재시도 가능 여부를 보여 준다. 최종 ZIP도 현재 허용된 모든 포함판에 접근할 수 있어야 내려받는다. 이미 승인한 제출판이 있는 상태에서 새 미승인 수정본이 올라오면 기본 완료본 묶음은 기존 승인판을 유지한다.

## 10. 구현 순서와 완료 조건

| 티켓 | 선행 | 산출물 | 완료 기준 |
|---|---|---|---|
| COL-T01 | 공통 권한/파일/명령 계약 | 수합 fixture·DTO·필드 validator·화면 흐름 | AI 없이 기존 텍스트/숫자·파일 작성형을 끝낼 수 있음 |
| COL-T02 | T01, 파일 검사·다운로드 | 양식 등록/버전/재사용/지원수준 화면 | 안전한 원본 전달과 미지원 표시, 기존 팩 불변 |
| COL-T03 | T02, Claude 실행·jobs | 분석 후보 DTO·매핑 편집·표본 생성 검증 | 미검증 후보를 게시하지 못함 |
| COL-T04 | T03 | 게시 schema·대상 snapshot·판 변경 영향 | 과거 제출판 불변, pending/보완 단위 모드 변경 차단 |
| COL-T05 | T01/T04 | 직접 입력·문답·반복행·조건부·첨부·개인/공동 초안 | 같은 답변 원장, 권한/충돌/재개 회귀 |
| COL-T06 | T03/T05 | snapshot→문서→파일→확인→원자 제출 | 오래된 출력/다른 단위 파일/타인 확인으로 제출 0건 |
| COL-T07 | T06 | 검토·보완·effective 기본 ZIP·현황표·재안내 연결 | 부분 실패·완료본/최신안 구분·권한 회수 종단 |
| COL-T08 | T01~T07 | 합성 DB·파일·브라우저·동시성·복구 검증 | 동반 COL01~COL24 실행 증거 확보 후 별도 공개 검토 |

이 순서는 이후 구현의 의존 관계다. 실제 DB·문서 AI 구현 재개를 승인한 것으로 해석하지 않는다. 보류 중에는 순수 fixture/DTO/화면 설계를 진행할 수 있지만 운영 API·DB 연결·보호 자산 수정·신규 메뉴 공개 확대는 별도 승인 절차를 지킨다.

## 11. 필수 수용 시험

collection-extension.json의 COL01~COL24를 추적한다. 특히 다음 실패 경로를 성공 경로와 같은 비중으로 검증한다.

1. 타학교 양식/매핑/schema/단위/파일을 교차 연결하면 FK·명령·읽기에서 모두 거부.
2. 미검증 분석 후보/필수 검사를 건너뛴 표본/다른 매핑판 표본으로 문답형 게시 거부.
3. 공동 구성원 종료·미래 시작·개인초안의 작업 결과/검색/첨부 우회 열람 0건.
4. 답변 7판 출력 후 8판 저장, 파일 교체, 조건 변화, 책임자 인계 시 기존 확인으로 제출 0건.
5. 0/false·미입력·조건 숨김·반복행 순서 변경·중복 row key·파일 경로 충돌 검증.
6. 출력 성공 후 제출 응답 유실 재시도는 제출판/알림 한 번, 외부 AI unknown은 확인 전 중복 호출 금지.
7. 검토 필수 v1 승인 뒤 v2 대기이면 기본 ZIP은 v1, 명시 받은판 모드만 v2 포함.
8. AI 장애·분석 미지원 때도 파일 작성/직접 입력 경로와 답변 저장은 유지.
9. 렌더러·팩·원본 hash 변경 시 표본/출력 지원 판정을 재검증하고 과거판 기록은 유지.
10. 기존 인증·회원·평가계획서 6종·기존 제출/철회/보완 회귀를 통과한 증거 없이 공개하지 않음.
11. COL21: 옛 kind CHECK/PK/UNIQUE와 backing index가 목표 설계에서 명시 대체되고 같은 파일의 서로 다른 반복행 첨부는 통과하며 같은 경로 중복은 거부.
12. COL22: guided 출력필드의 input 지정, 복수 generated_output, output 포인터 누락, 조건부 출력, file_upload의 generated_output은 모두 거부.
13. COL23: 실패/미검사/필수 skipped/필수 미확정/다른 exact hash·팩·매핑·렌더러·job 입력으로 ready/confirm/submit 승격 0건.
14. COL24: 같은 학교 A단위의 정상 문서판을 B단위 artifact 또는 A단위 다른 snapshot에 붙여도 문서 linked_unit·revision typed 입력·artifact 복합 FK가 거부.

## 12. 설계에서 정한 것과 아직 확인할 것

**설계 기본값:** 담당자가 최종 방식 결정, 문답형은 표본 검증 필수, AI 없이 직접 입력 가능, 제출자 최종 확인 필수, 단위 초안 비공개, 결과 다운로드는 완료본 기본, 새 학교로 자료 자동 공유 금지.

**운영 승인·실측 필요:** 실제 양식 표본과 지원 파일 형식, 파서/출력 엔진별 보존 가능 범위, 파일 검사/보존 정책, 출력 분량/반복행 한도, 문답형 사용 학교·교사 공개 범위, 비용 상한. 수치와 지원 형식을 임의로 확정하지 않는다. 운영 DB 생성과 SQL 확정은 계속 보류하며 현재 회원과 로그인 자료는 보존한다.
