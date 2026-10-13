# 업무·일정·수합·파일·문서 통합 DB 설계 v1

> 2026-10-13 보강: [양식 기반 수합](13-template-collection.md)과 [교사 메신저](12-messenger.md)를 함께 적용한다. 이 장의 기존 제출·검토·접수증·파일 권한 계약은 유지한다. ZIP 기본은 검토형의 승인된 완료본(effective), 검토 없는 수합은 최신 유효 완료본이며 미승인 제출 포함은 명시 선택이다. 양식 분석·문답·출력 생성과 정식 제출은 별도 상태다. 실제 DB 구축은 보류한다.

작성일: 2026-10-12. **실행 가능한 명세를 목표로 한 통합 설계 제안이다. SQL 확정본·마이그레이션·사용자 정책 승인·운영 적용 결과가 아니다.** 원본 Claude 최종 7개, GPT 기존 설계, 운영 코드와 확정 자산은 변경하지 않는다. SQL 확정은 Claude Web, 실행은 사용자라는 저장소 규칙을 따른다.

## 1. 기준과 선택한 해법

기준은 최종 `GPT작업/업무혁신시스템 기획서.md`의 M01~M05·M08 및 C02~C10, 기존 GPT DB02, Claude DB구조설계 최상위 최종본, 2026-10-12 비교 검토의 R02·R07~R10이다. Claude의 `workhub`·`workhub_private`, 기존 160개 표와 실행 가능한 제약을 기본으로 보존한다. 기존 공개 `public.workhub_*` RPC는 승인된 전환 어댑터가 준비되기 전까지 제거하지 않는다. 로그인·회원 보존 계약과 공통 실행/receipt/권한 게이트는 01·04의 정본을 따른다.

이 장의 변경 열·제약·인덱스·읽기 정책은 동반 `workflows-changes.json`에 담는다. `alter`의 누락 열은 기존 정의 유지이며, `drop_columns`는 최종 목표 스키마에서 제거할 중복 열이다. 실제 이관 때는 추가→백필→동등성 검사→읽기 전환→구 writer 폐쇄 뒤 별도 승인으로 제거한다. 원본 DDL을 덮어쓰라는 뜻이 아니다. 모든 신설 ID는 TEXT UUID 문자열, 학교 표는 `(school_id,id)` 유일키와 학교 복합 FK, 삭제는 기본 RESTRICT다. 아래 NN은 NOT NULL, ?는 NULL 허용이다.

선택한 원칙은 다음과 같다.

1. **안내 열람·결과 열람·제출 의무·홈 추천은 별도 축이다.** 학교 전체에 수합 안내를 공개해도 제출 답변을 자동 공개하지 않는다.
2. 답변 JSONB를 유지한다. 문항·선택지 정의는 `collection_schemas`의 불변 판에 묶고, JSON 객체의 키/형식/필수값/범위를 DB 검증 함수가 검사한다. 답변마다 EAV 행을 만들지 않는다. 파일은 기존 `submission_files`와 초안의 목적 고정 파일 연결을 사용한다.
3. 기존 제출·문서·일정 revision과 현재/완료 포인터를 유지한다. 형식이 다른 과거판을 현재 문항 정의로 해석하지 않는다.
4. 업무 책임 이전은 개인 메모·문서 소유권 이전이 아니다. 인계는 같은 학교의 허용된 관계만 하나의 트랜잭션으로 적용한다.
5. 파일의 실물 검사, 악성 검사, 내용 추출은 별도 상태다. 미검사는 `not_scanned`로 표시한다. 승인 정책이 없으면 민감한 제출·공유·다운로드·AI 입력에 사용하지 않는다.
6. 홈은 원본별 권한 있는 조회를 조합한다. 별도의 ‘오늘 업무 원장’이나 수동 수합 완료 행을 만들지 않는다.

## 2. 공통 명령·잠금·오류 계약

공개 쓰기는 전용 `workhub.cmd_*`만 사용하고 authenticated 직접 DML은 허용하지 않는다. 모든 명령은 명시 학교/소속, 명령 종류, `expected_version`, `request_key`를 받는다. actor 계정은 현재 인증에서 얻고 입력 계정 ID를 신뢰하지 않는다. 현재 계정·학교·소속·행동 권한을 잠금 후 다시 검사한다.

정본 순서는 **관련 accounts ID 정렬 → 학교/서비스 gate → memberships ID 정렬 → 역할·정책 행 → actor/scope/operation/request_key 멱등 잠금 → 필요한 근거 owner gate → 업무 원본(종류·ID 정렬) → file_objects ID 정렬 → receipt/audit/outbox INSERT**다. 권한 조회 FOR SHARE와 회수 FOR UPDATE가 실제로 충돌하게 한다. 같은 계열은 handover→collection→unit→schema→draft→submission→correction→file 순서로 잡는다. 인계와 단독 제출·검토·철회도 같은 순서를 사용한다. 다수 원본을 다룰 때 전체 잠금 목록을 먼저 정렬하며 반복문 안에서 새 잠금을 역순으로 추가하지 않는다.

한 명령은 원본 변경+파생 포인터+접수증+감사+outbox를 같은 트랜잭션으로 확정한다. 실패하면 모두 0건이다. 외부 푸시/ZIP/AI는 커밋 뒤 작업이며 실패해도 이미 접수한 제출을 취소하지 않는다. 동일 키/동일 정규화 본문은 같은 원본 ID, 동일 키/다른 본문은 IDEMPOTENCY_CONFLICT다. 재전송에도 현재 원본 읽기 권한을 검사하고 receipt에 저장한 과거 본문을 그대로 반환하지 않는다.

공통 오류는 AUTH_REQUIRED, SCOPE_DENIED, VALIDATION_FAILED, VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, POLICY_UNSET을 유지한다. 업무 코드는 FIELD_SCHEMA_MISMATCH, REQUIRED_ANSWER_MISSING, SELF_REVIEW_FORBIDDEN, CORRECTION_WINDOW_REQUIRED, SUBMISSION_POINTER_INVALID, FILE_POLICY_BLOCKED, STALE_HANDOVER, IMPORT_BASELINE_STALE을 추가한다. 응답은 `{status,resource:{type,id,version},receipt,asOf}`이며 오류를 빈 결과/저장 성공으로 바꾸지 않는다. 충돌 current는 현재 읽기 가능한 교사용 DTO만 반환한다.

`object_revisions` 원문은 authenticated 직접 SELECT를 회수한다. 원본 유형별 현재 권한을 검사하는 RPC로만 과거판을 읽고 audit.read는 ID·판·시각·변경종류 DTO만 얻는다. 협조 요청·수합·문서의 과거 사본에서 원본 권한을 우회하지 않는다.

## 3. 일정·관련 대상·공식 확정판

`events`, `event_revisions`, `audience_*`, `calendar_days`, `calendar_day_grade_overrides`를 유지한다. 일반 공유 일정은 활성 교사가 생성하고 작성자 또는 공유 일정 관리 권한자가 수정·취소한다. 공식 확정은 school_admin/calendar_official 권한이 맡는다. private는 조건이 all이어도 작성자 외 읽기를 열지 않는다. 담당자는 책임 표시이며 그 자체가 수정·전체 열람 권한은 아니다.

관련 대상은 group 간 OR, 서로 다른 차원 AND, 같은 차원 값 OR, 직접 포함, 제외 우선이다. 승인된 기간별 관계만 사용한다. 미래 일정의 추천 기준일은 시작일, 진행 중은 현재일, 과거 조회는 명시 조회 기준일이다. 읽기는 요청 시각의 학교/소속/ACL을 따로 검사한다. 등록 화면은 ‘읽을 사람’과 ‘홈에 추천할 사람’을 따로 미리 보여 준다. 수합 게시 단위는 이 동적 추천과 달리 snapshot이다.

`events.official_effective_revision_no integer?`를 추가하고 `(scope_key,id,official_effective_revision_no) → event_revisions(scope_key,event_id,revision_no)` 지연 FK를 둔다. 공식 최신 편집안은 events/current_revision, 공식 효력은 이 포인터다. 일반 교사용 목록·학사 계산은 확정 포인터가 가리키는 날짜/본문을 사용한다. 작성자·공식 담당자는 현재안과 효력판을 함께 읽는다. 확정 전 처음 만든 공식안은 일반 교사에게 표시하지 않는다. 공식 일정의 날짜를 편집하면서 이전 효력판이 유지되는지 읽기 API까지 회귀한다.

`cmd_save_event`는 현재안만 갱신하며 공식 효력은 바꾸지 않는다. `cmd_confirm_official`은 학교 gate와 행사/해당 날짜를 잠근 뒤 현재판을 재검증하고 새 official_confirm revision·효력 포인터·calendar_days·담당자 표시·outbox를 한 번에 변경한다. `cmd_withdraw_official`은 사유와 영향 미리보기를 요구하고 별도 철회 revision 후 효력 포인터를 비운다. 취소/휴지통은 구별한다. official 일정의 직접 일반 save·삭제가 효력판을 우회해 바꾸지 못한다.

`calendar_days.source_event_revision_no`와 `calendar_day_grade_overrides.source_event_revision_no`를 추가하여 근거를 정확한 확정판에 묶는다. 두 표 모두 source_event_id/판번호의 동시 NULL 검사와 `(school_id,source_event_id,source_event_revision_no)` 복합 FK를 둔다. 날짜는 소속 학년도 범위 안, 해당 학년 예외도 같은 날짜 부모를 사용한다. 이미 확정한 문서의 계산값은 과거 근거판을 유지하고 자동 덮어쓰지 않는다. 반복 일정 고급 편집과 시간표 실행은 이 장의 신규 범위가 아니다.

조회 인덱스는 기존 기간 인덱스에 `(school_id,start_date,end_date,id)`·`(school_id,responsible_membership_id,start_date,id)`를 보강한다. 읽기 가능한 일정 ID 집합을 먼저 구하고 기간 겹침 `end_date >= from AND start_date <= to`를 적용한다. 제한/정렬 cursor를 사용하며 역할별 count도 같은 ACL이다. 검색어로 타인 private의 존재 여부를 추론할 수 없다.

## 4. 시트 병행·3방향 대조·기준 전환

`source_connections/mappings/records`, `import_runs/rows/candidates`를 유지한다. 안정 external_key는 원본 ID열 또는 최초 사람 확인 매핑이다. 행번호·제목·내용 hash는 영구 ID가 아니다. ID 없는 행의 변경은 후보를 사람에게 확인받는다. 원본 ID열 쓰기는 원본 담당의 명시 동의가 있어야 한다.

신설 `source_record_snapshots`는 I,S, source_record_id NN, mapping_version NN, source_revision?, normalized JSONB NN, source_sha256 NN, captured_at NN이다. INSERT 후 불변이며 정확한 connection/record/mapping을 복합 FK로 고정한다. source_records에는 `last_source_snapshot_id?`를 추가하고 기존 last_source_snapshot/hash는 해당 판의 호환 projection으로만 갱신한다. 마지막 대상 event revision도 정확한 event와 묶는다.

각 import_rows에는 **incoming_snapshot_id, baseline_source_snapshot_id, baseline_target_revision_no, expected_source_record_version, expected_target_version, result_target_revision_no**를 고정한다. 이벤트용 행은 target_event_id도 학교 복합 FK로 가진다. 다른 도메인 import는 그 도메인의 별도 typed resolver를 사용하며 일정을 학생 import처럼 해석하지 않는다. 같은 run의 같은 source_record/안정 external_key는 한 번만 나타난다. source 기준판과 target 기준판은 함께 존재하거나 신규 행에서 함께 NULL이다. baseline은 미리보기 생성 후 불변이다.

비교는 직전 원본 O0·직전 반영 사이트 T0·들어온 원본 O1·현재 사이트 T1의 필드별 정규화 결과로 한다. 원본만 바뀌면 source_only, 사이트만 바뀌면 site_only, 양쪽이 같은 값으로 바뀌면 no_change, 서로 다른 값이면 conflict다. mapping 판이 달라지면 이전 미리보기를 적용하지 않는다. raw 원문에는 필요한 파일/원본 참조만 유지하고 외부 키·비밀 자격을 넣지 않는다.

`cmd_import_preview`는 파일 지문·매핑판·입력 중복·각 baseline·기대판·해결 선택의 manifest 지문을 반환한다. `cmd_import_apply`는 source/record/event 순서의 공통 잠금을 잡고 그 지문과 기대판·현재 권한·쓰기 기준을 다시 검사한다. 바뀌면 IMPORT_BASELINE_STALE이며 서버가 최신 값을 덮어쓰지 않는다. 각 행은 독립된 원자 적용과 `operation/importRun/rowId` 멱등 키를 사용한다. 다른 행 실패는 partial로 표시하고 실패 행만 재시도한다. 한 행의 event/revision/source baseline/result receipt는 전부 성공하거나 전부 실패한다.

site_authoritative 전환은 관리자에게 대조 요약·미해결 0·원본 담당 확인을 보여 준 뒤 연결 기대판/검토 run 지문을 잠그고 기록한다. 모든 구 import 경로도 기준 위치를 검사한다. 전환 직전 만들어진 미리보기의 take_source는 전환 후 거부한다. 파일에서 빠진 행은 missing_in_source일 뿐 삭제가 아니다. 연결의 쓰기 기준을 source로 되돌리는 것은 새 대조·승인 사건이며 과거 cutover를 지우지 않는다.

## 5. 개인 업무·협조·업무 페이지

`tasks`의 5상태(todo/doing/waiting/done/cancelled), 계정+scope, 원본 중복 키를 유지한다. 제목·메모는 유니코드 코드포인트 한도, 날짜는 실제 달력 검사, trim은 서버/클라이언트 동일 규칙을 사용한다. 기존 DTO 120/2000을 받는 어댑터는 조용히 200/5000으로 확대하지 않고 API 판별 규칙을 명시한다.

직접/AI 개인 준비 업무만 본인이 체크·취소·재개한다. 수합/보완/공지 확인/인계 등 원본 의무형 task가 존재하더라도 **표시 projection**이며 완료 진실은 원본이다. read RPC는 원본 상태를 재계산해 반환하고 worker 지연 시 task.status를 믿지 않는다. `completed_by_ref`는 source_type별 실제 완료 사건을 DB resolver가 검증한다. 관리자 또는 AI가 개인 체크를 수합 접수로 바꾸지 못한다.

task의 owner_account_id와 private note는 생성 뒤 소유권 불변이다. 일정 담당 변경 시 기존 담당자의 원본 연결 카드를 종료하고 새 담당자에게 같은 원본의 새 카드를 만든다. 개인 메모·개인 진행상태는 넘기지 않는다. 현재 담당 카드의 유일 인덱스는 기존 것을 유지하며 두 변경은 같은 트랜잭션이다. 이전 담당이 다시 맡으면 본인 기존 카드의 재사용 여부를 명시하고 메모는 그 본인에게만 남는다. 인계 미리보기에도 개인 note를 넣지 않는다.

협조 요청 상태는 requested→accepted/declined/substitute_proposed/cancelled, accepted→completed/cancelled이다. 요청자는 작성/취소, 수신자는 수락/거절/대체 제안/완료를 한다. 대체자 제안은 자동 배정이 아니며 follow_up_of를 가진 새 요청과 그 사람의 수락이 필요하다. 수락·linked_task 생성·응답판·receipt/outbox는 원자 처리한다. task의 scope/school/owner가 수신자와 정확히 일치해야 한다. 요청자는 공유 요청 상태만 읽고 수신자의 개인 메모를 읽지 않는다. 과거 object_revisions도 동일하다.

업무 페이지는 duties/assignments의 승인된 duty_id를 기준으로 events.duty_id, collections.duty_id, documents.duty_id, cooperation_requests.duty_id를 연결한다. 규정은 지식 장의 명시 업무 링크를 사용한다. 제목 유사도는 후보 표시일 뿐 자동 권한·연결이 아니다. 페이지 목록은 객체마다 현재 ACL을 적용하므로 업무 담당이라는 이유로 미제출 초안·학생 기록이 섞이지 않는다.

## 6. 수합 안내·결과·의무·문항판

collections의 `visibility/view_audience_set_id`를 최종적으로 `request_visibility/request_audience_set_id`로 대체한다. 값은 school/audience/participants다. **`result_visibility`는 participants가 기본이며** audience/school은 제출 정보의 성격과 영향 목록을 명시 확인한 관리 명령에서만 설정한다. `result_audience_set_id`는 결과 audience일 때만 존재한다. result 공개로 얻는 것은 완료본의 허용 답변/첨부이며 초안·과거 철회판·검토 의견·보완 내역은 아니다. 별도 `results_published_by_membership_id/at`와 승인 receipt를 보존한다. 제목/안내 공개를 변경한다고 결과 공개 필드를 자동 갱신하지 않는다.

당사자는 요청 관리자(현재 관리 범위), 현재 유효한 단위 구성원, 현재 지정 검토자다. 관리자 역할만으로 당사자가 되지 않는다. 미제출 초안은 personal이면 작성자, shared이면 현재 유효한 공동 구성원만 읽는다. 관리자/검토자에게 존재 여부·건수·첨부명도 반환하지 않는다.

신설 `collection_schemas`: I,S; collection_id TEXT NN, schema_version INTEGER NN, state TEXT NN=draft(draft/published/retired), review_mode NN(none/required), self_review NN=forbid(forbid/allow_with_note), title NN, instructions?, definition_sha256?, created_by_membership_id NN, created_at NN, published_at?, policy_scope_key?/policy_version_id?이다. 정책은 정본 `workhub.policy_versions(scope_key,id)` MATCH FULL FK이며 본교 `collection.submission` 정책판을 고정한다. published에는 승인·유효한 정책판이 필수다. `(school_id,collection_id,schema_version)`와 `(school_id,collection_id,id)` 유일. 게시 뒤 정의·검토정책·지문 불변, retired는 신규 적용만 막고 과거판 해석을 유지한다.

collection_fields에 schema_id를 추가하고 `(school,collection,schema_id,schema_version)`를 collection_schemas의 정확한 부모에 묶는다. draft schema의 문항만 편집할 수 있고 published/retired schema의 문항 INSERT/UPDATE/DELETE 모두 거부한다. options JSON은 `{key,label}` 배열로 유지하되 key 중복·빈값·종류 외 options·잘못된 한도·숫자 NaN/Infinity를 DB 검증 함수가 거부한다. publish 시 정렬된 문항·옵션·정책의 canonical hash를 계산한다. hash는 동등성 증거이며 권한이 아니다.

collections.current_schema_id와 units.active_schema_id는 같은 collection의 published schema를 가리킨다. 기존 schema_version 열은 서버 projection이며 별도 writer가 없다. 모드/문항 변경은 새 schema를 만들고 영향 단위·누락 답변·기존 검토 대기/보완을 미리 보여 준다. pending 제출 또는 열린 보완이 있는 단위의 모드 변경은 처리 후 적용하도록 거부한다. 과거 submission.review_mode_snapshot은 바꾸지 않는다.

게시 명령은 collection/schema 기대판, 대상 목록 지문, 현재 승인 관계와 활성 소속을 검사하고 units와 members를 한 번 만든다. unit_key는 기준 ID의 정규 조합 또는 서버 발급 custom 키다. 사람 이름/부서명 변경으로 의무가 늘지 않는다. 공유 3인 한 단위는 의무 1개, 책임자 1인이 두 단위를 맡으면 의무 2개다. 게시 뒤 동적 대상 변화로 의무를 자동 재생성하지 않는다. 단위 추가/면제/취소/인계는 명시 명령이다.

## 7. 기간별 공동작성·초안·JSON 답변 검증

collection_unit_members에 valid_until?와 created_at을 추가한다. 읽기/쓰기 공통식은 **소속 승인·현재 유효 + valid_from <= statement_timestamp() + (valid_until IS NULL OR now < valid_until) + removed_at IS NULL**이다. removed_at은 실제 회수 시각이며 미래 종료 예약으로 쓰지 않는다. 미래 구성원도 시작 전에 취소할 수 있도록 기존 removed_at>=valid_from CHECK는 제거하고 created_at보다 이르지 않도록 검사한다. 예약 종료는 valid_until이다. 같은 단위/사람/역할의 유효 기간 중첩과 책임자 기간 중첩은 EXCLUDE로 막는다. 미래 기간·회수는 권한판/복원 원장에 반영한다. 책임 공백은 needs_owner로 표시하며 전임 소속을 연장하지 않는다.

unit_drafts에는 collection_id/schema_id를 추가하고 `(school,unit,collection)`·`(school,collection,schema)` 복합 FK를 둔다. unit/draft_kind/owner/schema는 불변이다. 공유 유일키는 `(unit_id,schema_id)`, 개인은 `(unit_id,schema_id,owner_account_id)`다. 새 문항판에는 새 draft ID를 만들고 허용 답변/파일만 명시 변환한다. 기존 초안의 schema_id를 바꾸지 않는다.

`validate_collection_answers(schema_id, answers, phase)`는 다음을 DB에서 검사한다. phase=draft에서는 필수 누락을 허용하고, submit에서는 필수값을 강제한다.

- JSON 최상위는 object. 정의되지 않은 key 거부. 정의된 key의 null은 미입력이며 빈 문자열/빈 배열의 필수 의미를 종류별로 고정한다.
- boolean은 실제 JSON boolean, number는 유한 numeric(문자열 숫자 불가), date는 YYYY-MM-DD의 실제 날짜, short_text는 문자열·문항 코드포인트 한도다. 숫자 0은 유효하고 NULL과 구별한다.
- single_choice는 옵션 key 하나, multi_choice는 중복 없는 옵션 key 배열이며 그 schema에 존재하는 값만 허용한다.
- file 답변 JSON에는 클라이언트 경로나 서명 URL을 넣지 않는다. 정확한 문항 key와 검증된 typed 파일관계에서 서버가 표시용 manifest를 만든다. 필수 파일 수·크기·형식·policy는 실제 관계를 기준으로 확인한다.

서버와 DB는 같은 canonical 형식의 시험 fixture를 공유한다. JSON Schema 라이브러리를 쓴다는 이유만으로 DB 핵심 검사나 학교/단위 FK를 생략하지 않는다. 초안 버전 충돌은 최신판을 반환하되 내 입력은 UI에서 보존하며 자동 병합/덮어쓰기를 하지 않는다.

## 8. 제출판·자기검토·모드별 포인터

submission_versions에 collection_id, schema_id, source_draft_id/version, submitted_by_account_id, responsible_membership_id_snapshot, responsible_account_id_snapshot, review_mode_snapshot, due_kind_snapshot(date/time), receipt_xid를 추가한다. source draft는 `(school,draft,unit,schema)` 복합 FK이며 submission도 unit/schema/collection이 일치한다. 실제 제출 계정은 submitted_by_membership_id의 계정과 일치해야 한다. 당시 책임자도 같은 방식으로 고정한다. 제출·대리 이력은 인계 후 바꾸지 않는다.

접수 시각은 잠금·검사 이후 서버 `clock_timestamp()`로 정한다. 날짜 마감은 학교 시간대의 다음 날 00:00을 저장하고 `receipt_at >= due_at`이면 지연, 시각 마감은 `receipt_at > due_at`이면 지연이다. due_kind와 당시 마감을 제출판에 고정한다. 클라이언트 시각은 접수/지연 근거가 아니다.

제출은 활성 책임자 또는 유효 delegate만 가능하다. 공동작성자는 초안 편집만 가능하다. 공유초안만 공동 제출하며 개인초안은 작성자 확인 후 명시 복사한다. cmd_submit은 현재 schema·unit/draft 기대판·필수값·마감/창·첨부를 검사한 뒤 제출판/파일 snapshot/current/effective/최초 제출/보완 충족/receipt/audit/outbox를 한 번에 확정한다. first_submission_id를 추가해 최초 시각·지연 projection의 실제 근거를 남긴다.

검토는 현재 지정 검토자가 현재 pending 제출판에 한 번만 한다. 검토자의 **account_id를 실제 제출자와 당시 책임자 account snapshot 및 현재 책임자 계정**에 대조한다. 인계·재임용으로 membership ID가 달라져도 자기검토 금지가 유지된다. allow_with_note는 승인된 schema 정책이 있어야 하며 공백 아닌 사유가 필요하다. 학교 관리자라는 이유로 지정 검토자를 우회하지 않는다. review는 불변이고 제출 review_state를 같은 트랜잭션에서 반영한다.

| 사건 | current | effective | 불변 조건 |
|---|---|---|---|
| none v1 제출 | v1 | v1 | not_required; 가짜 승인행 없음 |
| none v2 정정 | v2 | v2 | 사유/이전판/창 검사; 외부 처리 상태 승계 없음 |
| none 현재판 철회 | NULL | NULL | v1 자동 부활 금지 |
| required 첫 제출 | v1 | NULL | pending |
| required v1 승인 | v1 | v1 | 다른 지정 검토자 |
| required v2 제출/보완 | v2 | v1 | 완료 합계는 v1 |
| required 미승인 v2 철회 | 가장 최근 유효 이전판 또는 NULL | 기존 완료본 | 남은 보완 의무는 유지 |
| required v2 승인 | v2 | v2 | v1 역사 보존 |

DB 지연 제약은 포인터가 같은 unit의 유효 제출인지, effective가 accepted/not_required인지, none 활성 current=effective인지, 최초 포인터가 바뀌지 않는지 검사한다. 어떤 판을 자동 복원할지는 명령의 명시 전이로만 정한다. required의 accepted 또는 user_confirmed 판은 직접 철회 금지다. exported는 단순 내보낸 기록이며 공식 처리 확인과 구별하고 그 사실만으로 user_confirmed로 승격하지 않는다. pending/changes_requested인 최신 미승인판 및 none의 현재판은 마감 전·공식 처리 전 책임자/대리가 사유와 함께 철회할 수 있다. 마감 후나 closed 요청은 해당 단위의 withdrawal/both 창이 있어야 한다. 정책 미승인 환경에서는 이런 전이를 공개하지 않는다.

## 9. 보완·연체·면제와 보완 철회의 원자성

correction_requests는 대상판·검토판·기한·사유를 불변으로 보존한다. 기한 변경은 이전 요청 취소+supersedes_request_id를 가진 새 요청이다. 같은 단위 열린 요청 1개를 유지한다. 제출자는 어떤 correction_request를 충족하는지 명시하고, 무관한 제출이 전체 보완을 자동 충족시키지 않는다.

신설 `collection_correction_fulfillments`: I,S; request_id/unit_id/submission_id NN, fulfilled_at NN, due_kind_snapshot NN, due_at_snapshot NN, late NN, invalidated_at?, invalidation_reason?(submission_withdrawn/request_cancelled), invalidated_by_membership_id?다. 같은 단위 복합 FK, `(request_id,submission_id)` 유일, invalidated_at IS NULL인 request당 1개다. 충족 본문은 불변이며 무효 메타만 한 번 채울 수 있다.

요청의 fulfilled_by/at/late는 이 active fulfillment의 projection이다. `cmd_withdraw_submission`이 보완 제출판을 철회하면 **submission 상태·current/effective·fulfillment 무효·request의 fulfilled 포인터 해제·state=open·연체 projection·receipt/outbox**를 같은 트랜잭션에서 바꾼다. 요청이 이미 cancelled면 open으로 되살리지 않는다. 미승인 보완요청판 자체를 철회해 effective v1으로 돌아가더라도 열린 요청을 자동 취소하지 않는다. 더 이상 요구하지 않을 때는 관리자의 명시 취소가 필요하다.

집계는 세 축을 따로 반환한다: 최초 제출 지연(불변 first판), 현재 미제출 연체(현재마감 초과이고 current 없음), 미충족 보완 기한 초과(활성 fulfillment 없음). 면제/취소는 제출판 삭제가 아니며 분모·독촉에서 제외한다. 책임 공백도 운영 의무 합계에서는 누락시키지 않고 needs_owner로 분리한다. 숫자 합계는 현재 ACL로 허용된 unit의 effective판을 각각 한 번만 더하며 numeric 정밀도를 유지한다. NULL은 제외, 0은 포함한다.

## 10. 인계 수락·대상 고정·원자 적용

handovers/items를 유지한다. `handover_acceptances`를 신설하여 후임 membership/account, handover_id, manifest_version, items_sha256, effective_on, accepted_at을 불변 기록한다. handovers는 current_acceptance_id를 가리키고 기존 accepted_*는 그 projection이다. 수락 이후 항목·원본 기대판·후임·적용일이 바뀌면 manifest_version을 증가시키고 stale 처리, 현재 수락 포인터를 비운다. 과거 수락행은 지우지 않는다.

applied이면 current_acceptance_id/accepted_at/accepted_hash/items_hash/applied_at/applied_by가 전부 NN이고 수락한 후임·manifest_version·지문·적용일이 현재값과 같아야 한다. NULL 비교로 CHECK를 우회하지 못한다. 기존 handover_items.id를 유지하고 `target_key JSONB`에 대상의 정확한 복합 PK를 보존한다. 단일 ID 대상은 `{id}`만, reviewer는 `{collection_id,membership_id,added_at}`만 받으며 다른 키는 거부한다. object_type/object_id는 단순 문자열 ACL이 아니며 종류별 정해진 resolver가 같은 학교·실제 부모·기대판·변경 가능 필드를 INSERT와 적용 때 검사한다. 지원하지 않는 종류는 거부한다. version 열이 없는 관계는 target_fingerprint로 정확한 PK·기간·권한 내용을 고정하고 적용 때 대조한다.

초기 지원은 승인 배정·역할·수합 책임/검토자·수업 담당·업무 자료 관리/시트 연결 담당이다. source 개인 task·private note·개인 준비초안·학생 기록·대화·문서 소유권은 제외한다. 수합 공동초안은 후임의 공동 구성원 편입을 인계 manifest에서 명시 수락한 경우만 접근을 연다. 문서의 owner_account_id를 후임으로 바꾸는 편법은 허용하지 않는다. task 항목은 공식 원본 책임 변경에 따른 카드 종료/생성으로 변환하고 개인 task 자체를 이전하지 않는다.

cmd_handover_preview는 대상별 원본 기대판·허용 field delta·진행 의무/제외 항목·효력일을 계산한다. accept는 후임 본인만 현재 manifest를 수락한다. apply는 인계관리 권한자가 학교 시간대의 적용일 이후 실행하며 모든 관련 계정/소속/권한/원본/파일 잠금을 먼저 확보한다. 후임 활성·전임/후임 관계·모든 기대판을 다시 확인하고 하나라도 불일치하면 STALE_HANDOVER로 **전체 0건**이다. 성공 시 단위 ID·제출판·완료본을 유지한 채 책임/기간/권한판/카드/outbox/receipt를 원자 변경한다.

동시에 진행 중인 다른 인계가 같은 대상에 접근하지 못하도록 대상 정렬 advisory lock과 활성 item claim을 검사한다. 기존 `(handover_id,object_type,object_id)` 유일성은 `(handover_id,manifest_version,object_type,target_key)`로 교체하여 같은 대상의 새 미리보기판을 보존한다. claim은 진행 중인 인계의 현재 manifest_version만 사용하며 과거판이 대상을 계속 점유하지 않는다. 초안 인계의 재활성화/상태 변경에도 재검사한다. 적용 완료 후 재실행은 같은 결과를 반환한다. 수락 지연은 전임의 접근 종료를 늦추지 않는다. 전임 종료 후 담당 공백은 needs_owner, 후임이 종료되면 적용 중단 후 재지정이다.

## 11. 파일 실물·검사 정책·현재 다운로드 권한

기존 file_objects의 scope_key, 검증 후 path/hash/bytes/mime 불변, derived_from, state, extract_state를 유지한다. 새 파일은 항상 새 object ID와 서버 생성 경로다. init→업로드→실물 크기/형식/hash/압축 확장 검사→verified→ready의 증거를 서버 작업자가 만든다. 요청의 claimed 값을 검증된 값으로 복사하지 않는다. DB metadata의 ready만으로 Storage 실물이 존재한다고 주장하지 않는다.

scan_state는 pending/clean/rejected/error/not_scanned를 유지한다. file_objects에 safety_policy_scope_key?/safety_policy_version_id?, common_safety_policy_scope_key?/common_safety_policy_version_id?, sensitivity NN, verified_by_service_id?를 추가한다. clean은 실제 검사 성공만 뜻한다. 정책 정본은 `workhub.policy_versions(scope_key,id)`이며 각 쌍을 MATCH FULL 복합 FK로 고정한다. 학교 파일은 해당 학교의 file.safety 판과 scope_key='c'인 공통 하한 판을 **모두** 고정한다. common·account_private 파일은 applies_to_scopes에 해당 범위를 허용한 공통 판을 두 정책 쌍에 동일하게 기록한다. NULL school_id로 정책 FK를 건너뛰지 않는다. 개인 이용자가 정책을 완화할 수 없다. 승인 전 not_scanned는 개인 업로더의 안전한 상태 확인/삭제 요청만 허용하고 제출·공유·파일 내려받기·AI 추출 사용은 차단한다. 운영 정책이 해당 형식/목적을 명시 허용하면 not_scanned 그대로 사용하되 UI에 미검사 상태를 알리고 자동 실행/브라우저 inline render는 금지한다. 학생/민감 기록은 승인 정책이 별도로 허용하지 않으면 계속 차단한다. rejected/quarantined/deleted는 어떤 예외로도 사용하지 않는다. 검증 당시 적용한 공통/학교 정책판은 역사로 유지하고, 실제 사용은 당시 판과 현재 유효 공통 하한·학교 정책의 허용 교집합으로 판정한다. 정책 하나라도 현재 차단하면 옛 허용판으로 우회하지 못한다. submission_files에도 접수에 적용한 두 정책판을 고정한다.

file_links는 연결 정체성(scope/file/resource_type/id/version/role/linked_by/linked_at)을 불변으로 만든다. 제거는 unlinked_at만 기록하고 재연결은 새 행이다. 잘못된 부모의 UPDATE 우회를 닫는다. 부모 resolver는 허용 목록의 지원 표만 받으며 존재·정확한 판·같은 scope·현재 source 읽기·target 쓰기·공개 범위 상승 허용 여부를 검사한다. 임의 resource_classes 행을 파일 ACL로 사용하지 않는다. 초기 resolver 목록은 unit_drafts(정확 schema/file 문항), documents(정확 document revision), notices(정확 notice version), knowledge_revisions(정확 불변판), document_packs(정확 팩판), import_runs(입력 파일), export_manifests(출력 묶음)이다. 이 밖은 해당 도메인 typed 관계 구현·음성시험 뒤 allowlist에 추가한다. submission_files/document_inputs/document_revisions.output_file_id는 기존 typed 관계가 정본이며 generic link로 우회하지 않는다. 복합키 부모는 dedicated typed 관계 또는 명시 resolver를 요구하고 검증 불가능하면 거부한다. unlink·부모 차단/철회/삭제·권한 축소는 같은 transaction에서 grant를 회수하고, 물리 삭제는 ledger 이후에만 수행한다. 불변판의 파일 관계는 unlink로 내용 수정하지 않고 원본 전체 사용 차단과 새 정정판으로 처리한다.

file_links의 기존 전체 이력 유일성은 활성 연결만의 유일 인덱스로 교체한다. 키는 `(scope_key,resource_type,resource_id,resource_version,field_id,file_object_id,role)`이며 NULLS NOT DISTINCT와 `WHERE unlinked_at IS NULL`을 적용한다. 같은 초안에 같은 파일을 제거 후 다시 붙일 수 있고, 서로 다른 문항에 같은 파일을 선택해도 문항 관계는 구별된다. 완료판의 정정 금지와 현재 읽기 권한 검사는 그대로 적용한다.

수합 submission_files는 같은 unit/schema의 file 문항만 받는다. 파일 hash/bytes/검증정책 snapshot을 저장하며 본문 불변이다. 같은 트랜잭션 판정은 receipt_at=now()라는 시각 추정 대신 submission의 서버 생성 `receipt_xid xid8 = pg_current_xact_id()`를 사용한다. 제출판 INSERT와 첨부를 동일 transaction에서만 허용하고 실제 파일검사는 그 전에 완료해야 한다. 판이 finalized된 뒤 첨부 추가/수정/삭제는 항상 거부한다. 서버는 최종 관계를 검사한 뒤 접수 성공을 반환한다.

다운로드는 file_id 하나가 아니라 typed 부모/판/link ID를 받는다. 현재 계정·소속·원본 ACL·링크 생존·파일 상태·정책을 매번 검사한다. file_grant_valid도 원본 resolver를 다시 호출하며 학교 접근만으로 참을 반환하지 않는다. 민감 파일은 인증 proxy가 기준이고 서명 URL은 승인된 비민감 용도에 제한한다. issued URL을 실제 폐기하지 못하는 저장소에서는 TTL 동안의 잔여 접근을 숨기지 않으며 민감용 발급을 허용하지 않는다. 구성원 제거·private 전환·소속 종료 시 grant 회수는 원본 변경과 같은 transaction이며 실제 저장소 토큰 정책은 별도 승인 환경 시험 대상이다.

실물 삭제와 DB commit은 분리된다. deletion ledger 차단→작업자 물리 삭제→확인 후 purged 표기이며 파일 첨부와 동일 파일 잠금을 공유한다. 미첨부 고아 파일은 승인 보존정책에 따라만 정리한다. 백업 완료는 파일 bytes/hash 복구까지 별도로 증명한다.

## 12. 문서함·문서판·팩·근거

documents/revisions/inputs/validations/actions/document_packs를 유지한다. 기본 파일함은 AI 없이도 자신의 업로드·업무 파일·공용 팩을 현재 권한으로 구분한다. 문서 owner는 불변이며 shared_with는 명시 공유 범위다. 업무 담당은 duty 자료 중 허용 공유문서를 읽지만 개인 문서/미제출 초안은 읽지 않는다.

document_inputs는 목적 문서의 기존 `scope_key`를 유지하고 `file_scope_key TEXT NN`을 추가한다. 문서 FK는 `(scope_key,document_id) → documents(scope_key,id)`, 파일 FK는 `(file_scope_key,file_object_id) → file_objects(scope_key,id)`다. 기존 `(scope_key,file_object_id)` FK는 새 파일 FK로 교체한다. 기존 행은 확인된 같은 범위 값으로 백필한다. `file_scope_key = scope_key OR file_scope_key = 'c'`를 CHECK하여 학교 문서는 본교/common, 개인 문서는 본인/common, 공통 문서는 common만 입력으로 허용한다. 이 범위 검사는 읽기 권한을 대신하지 않으며 연결·생성·출력 시 현재 파일/원본 ACL, 허용 게시 상태, 안전 정책과 목적 문서 쓰기 권한을 별도로 검사한다. 학교 자료를 개인 입력으로 연결하거나 다른 개인의 파일을 연결하지 않는다. fact_source는 extract_state=ok와 교사의 명시 확인이 필요하다. 이 입력을 생성판에 채택할 때 document_revision_sources의 source_scope_key/source_file_id에 정확한 파일 범위를 고정한다. generic file_links의 같은 범위 규칙을 완화하지 않고 이 typed 관계에서만 공통 입력을 명시적으로 지원한다.

document_revisions에 pack_id/pack_scope_key/pack_version을 snapshot으로 고정한다. 문서 head의 팩 변경이 과거 생성판을 다시 해석하지 않게 한다. 새 생성판은 현재 활성 팩·허용 scope·정확 asset hash를 검사한다. 팩은 기존 검증된 manifest·template·token-map 자산을 참조하고 보호 자산을 다시 작성하지 않는다. 최종 재업로드는 새 file ID·새 revision·새 validation이며 pass를 복사하지 않는다. 문서 generated/validated/downloaded/submitted/officially_approved는 각각 사건이며 다운로드를 공식 결재로 표시하지 않는다.

신설 document_revision_sources는 scope_key/document_id/revision_no, source_kind, source_file_id?, source_event_id/revision_no?, source_document_id/revision_no?, source_knowledge_revision_id?, source_scope_key NN, source_sha256, purpose(form/fact/style), locator, confirmed_by_account_id/at을 가진다. 네 가지 선택형 원본 FK는 **MATCH SIMPLE**로 둔다: `(source_scope_key,source_file_id) → file_objects(scope_key,id)`, `(source_scope_key,source_event_id,source_event_revision_no) → event_revisions(scope_key,event_id,revision_no)`, `(source_scope_key,source_document_id,source_document_revision_no) → document_revisions(scope_key,document_id,revision_no)`, `(source_scope_key,source_knowledge_revision_id) → knowledge_revisions(scope_key,id)`. 공통 NN source_scope_key에 미선택 ID가 NULL이므로 네 FK 모두 MATCH FULL로 두면 정상 행도 거부된다. 대신 CHECK가 source_kind의 허용값과 정확한 ID 묶음을 강제한다. file은 file ID만, event_revision은 event ID+판번호만, document_revision은 document ID+판번호만, knowledge_revision은 knowledge revision ID만 NN이고, 선택되지 않은 나머지 ID·판번호는 전부 NULL이다. 선택한 묶음은 전 열이 NN이므로 MATCH SIMPLE도 실제 원본 FK 검사를 생략하지 못한다. 목적 문서 FK의 세 열은 모두 NN이며 기존 정확한 판 참조를 유지한다. source scope는 목적 school과 같거나 허용된 common, 개인 목적이면 본인/common만이며 개인 목적에 학교 자료를 복사하지 않는다. 입력 확인 당시 권한과 생성/출력 직전 현재 권한을 모두 검사한다. 기존 source_refs JSON은 이 관계의 표시 snapshot이며 독립 ACL/근거 원장이 아니다.

추출 ok인 파일도 자동으로 사실 확정하지 않는다. 교사가 확인한 현재 학교/연도에 맞는 사실과 표현 예시를 구분한다. 근거 정정/철회는 documents.stale_since/사유와 관련 생성판 재검토로 전달하고 이전 파일의 유효검사를 무조건 유지하지 않는다. 출력/제출 직전 정확 source revision/hash를 재확인한다. 일반 HWPX 내용 지원·검증 팩 원형 보존·스캔/암호화 불가를 별도 support_level로 표시한다.

## 13. ZIP 내보내기·공지·알림

export_manifests는 작업/선택 모드를 유지하고, 신설 export_manifest_items가 unit/submission/schema/file의 정확한 ID·판/hash·상태·오류 코드를 고정한다. 기존 items/failed_items JSON은 관계표의 읽기 projection이다. none은 latest_valid(현재 유효 완료본), required는 effective(승인 완료본)가 기본이다. 미승인 received판을 포함하려면 선택 모드와 미검토 상태를 명시 확인한다. 파일 없는 숫자/글 응답도 항목에 포함한다. ZIP 파일명은 단위·판·검토상태를 포함하고 경로를 서버 정규화한다.

작업자는 시작·각 항목 접근·최종 연결·다운로드 때 권한을 검사한다. 중간 권한 회수/파일 누락은 해당 항목 실패, 결과 partial을 명시한다. 현재 볼 수 없는 자료가 섞인 예전 ZIP을 재발급하지 않는다. 실패 항목만 고정 ID로 재시도하며 새 제출판으로 슬쩍 바꾸지 않는다. 파일 bytes·manifest hash 검증 전 ready 금지다.

notices/notice_receipts와 notification_*는 유지한다. 게시 근거는 현재 승인된 부서·업무·학급·학년 관계이고 중요 표시는 범위를 늘리지 않는다. 전달 확인 명단은 해당 요청자/명시 관리권한자에게만 반환한다. read_at와 acknowledged_at는 다른 사건이며 둘 다 다른 의무의 완료가 아니다. 의미 있는 본문 변경은 새 notice version으로 확인을 새로 받는다.

알림 제목은 안전한 템플릿(예: ‘수합 요청이 있습니다’)만 저장하고 학생 이름·본문·개인 메모를 넣지 않는다. 목록 DTO의 원본 제목은 현재 원본 ACL로 조회한 뒤 덧붙인다. notifications read 정책과 push 발송 때도 source 현재 권한을 확인하므로 revoke worker가 늦어도 제목/링크를 노출하지 않는다. 사건+수신자+kind+source_version 중복 키, 앱 알림 기준, 조용한 시간·아침 묶음·긴급 권한의 기존 계약을 유지한다. 알림 실패가 업무 commit을 되돌리지 않는다.

## 14. 홈·업무 조회와 파생 캐시

`workhub.dashboard_section(p_school,p_section,p_cursor,p_limit,p_as_of)`은 authenticated 현재 actor 기준으로 today_events, my_tasks, collection_obligations, reviews, notices, recent_documents를 각각 조회한다. 순수 개인 공간은 명시 scope로 따로 요청하며 학교 전환 응답에 섞지 않는다. 홈은 이 독립 호출을 병렬 조합해 `{section,status,data,asOf,nextCursor}`를 받는다. 하나의 실패는 해당 칸만 retry이며 전체를 비우지 않는다.

- 일정: 현재 열람 가능한 원본 중 오늘 겹침/다가오는 기간, 추천 이유와 원본 판 포함. 관련 여부가 읽기권한을 대신하지 않는다.
- 개인 업무: owner+scope의 미완료 마감순, 출처 원본 권한을 재검사. 개인 체크는 원본 의무를 완료하지 않는다.
- 수합: 현재 책임/유효 대리 단위, 요청·문항판·current/effective·지연 세 축을 반환. 완료본이 있어도 열린 보완이면 할 일이 남는다. 관리자 집계도 본문 열람 가능한 단위와 관리 전용 메타를 구분한다.
- 검토: 현재 지정 검토자이면서 self-review 정책을 통과하는 pending판만 표시한다.
- 전달/문서: 현재 source ACL 후 조회한다. 검색·건수·최근 목록에도 같은 식을 사용한다.

DB 조회는 Claude의 ‘내 소속/권한/단위 집합을 질의당 한 번 계산’ 방식을 유지한다. JSON 답변 전체 GIN은 기본 생성하지 않고 정확한 schema별 numeric 집계는 권한 제한 후 계산한다. 필요한 인덱스는 units(collection_id,obligation_state), current members(membership_id,valid_from,valid_until), submissions(unit_id,version_no DESC), corrections(unit_id,due_at) WHERE open, tasks(owner,school,status,due_on,id), notifications(recipient,created_at,id) WHERE revoked_at IS NULL이다.

최초는 캐시 없이 페이지 제한·집합 RLS로 측정한다. 도입하더라도 원본 ID/판·계산 결과만 가진 **파생 캐시**이며 별도 정본이 아니다. 캐시 키는 account/school/scope/permission_version/정책판/section/기준일이며 원본 변경·권한회수·기간 경계에 무효화한다. 원본 제목/본문을 저장해 ACL 재검사를 생략하지 않는다. stale 표시 캐시도 현재 권한 확인이 실패하면 폐기하고 개인정보 칸은 표시하지 않는다. 캐시 갱신이 늦어도 명령·다운로드는 항상 원본을 본다.

## 15. 생성 순서·명령별 완료 조건

| 묶음 | 선행 조건 | 명령/조회와 완료 기준 |
|---|---|---|
| W0 기본 호환 | 계정/학교/소속 gate·기존 DB 실측 | tasks/events 기존 입력·응답·종료일 변환, 소속 종료·충돌·응답 유실 회귀 |
| W1 일정/업무 | 승인 배정/대상·불변 event revision | save/confirm/withdraw/query, 협조 수락·개인 note 격리, 시트 preview/apply/cutover |
| W2 수합 글/숫자 | collection_schemas·members 기간·receipt | draft/publish/submit/review/withdraw/correct/exempt, current/effective/지연/인계 종단 |
| W3 파일/문서함 | Storage 승인 환경·file policy·실물 검증 | init/complete/download, typed 첨부·ZIP, 일반 파일함·새파일 새판 |
| W4 문서 생성 | 검증 팩·job/AI 권한·근거 판 | 문서 source→팩→산출물→검사→수합, 수정 최종본 재검사 |
| W5 운영 마감 | 알림·원자 인계·실제 복구 | 기존 회원 실제 로그인부터 모든 도입 기능 종단, 부분 실패/동시성/회수 검증 |

단계는 생성·검증 순서이지 사용자에게 일부만 조기 공개하자는 제안이 아니다. 최종 공개 게이트와 보류된 시간표 범위는 통합 총괄 문서를 따른다. 승인 미정 값은 POLICY_UNSET으로 막고 허위 기본값으로 운영하지 않는다.

## 16. 필수 수용 시험

| ID | 사례 | 반드시 확인할 결과 |
|---|---|---|
| WF01 | 미래 공동작성자·시작 직전/직후·시작 전 취소·예약 종료 | 초안/첨부/건수 현재 유효기간 일치, 미래 0행(R02) |
| WF02 | 제출자 인계·동일 계정 새 소속·대리 제출 후 책임자 검토 | 제출자/당시 책임자 계정의 자기검토 거부(R07) |
| WF03 | 게시 문항 INSERT/UPDATE/DELETE·schema999·타수합 schema·A단위/B초안 | 모두 거부, 과거 답변 해석 불변(R08) |
| WF04 | 수락 NULL/부분 NULL·지문 불일치·날짜/후임 변경·인계 재활성화 충돌 | 적용0·재수락 필요·동일 대상 중복0(R09) |
| WF05 | file_link 부모/type/version/file UPDATE·타학교·개인목적 연결 | 정체성 변경 거부·새 연결도 현재권한/범위 검사(R10) |
| WF06 | none v1/v2/철회·required v1승인/v2대기/철회·보완판 철회 | 명시 포인터, 옛 none판 부활0, 미충족 보완 유지 |
| WF07 | 보완 제출 후 철회·보완요청판 철회·기한 변경·면제 복원 | fulfillment 무효와 open 재계산 원자, 최초 지연 불변 |
| WF08 | 두 세션 같은 키/다른 키 동시 제출·응답 유실·검토/철회 경합 | 접수1판 또는 명시 충돌, 승인과 철회 동시 성공0 |
| WF09 | 파일 성공 후 DB 강제 실패·영수증 INSERT 강제 실패 | 제출/첨부/pointer/outbox/receipt 전부0, 미첨부 실물 상태는 정직하게 유지 |
| WF10 | 본인 파일 ID로 타인초안/공지 연결·구성원 제거 후 grant 재사용 | 현재 원본 ACL로 차단, 기존 issued URL 한계 별도 실측 |
| WF11 | not_scanned 정책 없음/승인/철회·quarantined·추출 실패 | 정책 없는 사용0, 미검사를 clean으로 표시0, AI입력 별도 판정 |
| WF12 | 행 정렬·중복 key·ID 소실·양쪽 변경·매핑 변경·적용 직전 기준 전환 | baseline 재현, 잘못된 덮어쓰기0, 원본 누락 삭제0 |
| WF13 | 공식 효력 v1 뒤 편집안 v2·구 save·확정·철회 | 일반 조회/학사계산 v1 유지, 확정 때만 v2, private 우회0 |
| WF14 | 담당 인계 도중 한 unit 기대판 충돌·후임 종료·동일 키 재실행 | 전체0 또는 전체1, 의무 ID/완료본 유지, 개인 note 이전0 |
| WF15 | 숫자0/NULL/큰수·false/빈선택·잘못된 날짜·추가key | schema별 정확한 거부/합계, 허용 단위만 집계 |
| WF16 | ZIP 도중 권한회수·파일 누락·새 제출·부분 재시도 | 고정 허용판만, partial/실패목록 명시, 옛 광범위 ZIP 재발급0 |
| WF17 | 문서 팩 교체·최종 재업로드·근거 정정/철회 | 과거 팩판 유지, 새 hash 재검사, stale 근거 출력/제출 차단 |
| WF18 | 원본 비공개 뒤 revision/알림/홈/검색/count/캐시 조회 | 직접경로와 같은 ACL, audit.read 원문 우회0 |
| WF19 | 일부 홈 RPC 실패·늦은 학교 A 응답·권한판 변경 | 해당칸 retry, 학교B에A자료0, 원본 없는 완료표시0 |
| WF20 | DB+파일 복원·삭제/회수 원장 재적용 | 실물/판/hash 일치, 폐기·회수 자료 재노출0 |

기존 762개는 유지하되 의미가 바뀐 정책 시험은 새 계약으로 명시 갱신한다. 이번 문서는 새 DDL 시험 통과를 주장하지 않는다. R02·R07~R10의 이전 재현 SQL을 차단을 기대하는 회귀로 바꾸고 PostgreSQL 두 연결, 실제 Supabase API/Storage, 화면 왕복은 별도 증거로 남긴다. 160표/RLS수·verify_security 0행은 개별 정책 정확성의 대체 증거가 아니다.

## 17. 판단해서 정한 것

불변 schema+JSONB 답변, 결과 기본 비공개, 계정 기준 과거 자기검토, 수락행 별도 보존, 보완 충족 이력, 파일 link 불변, 원본별 홈 조회를 선택했다. 관계·기간·역사 증거를 DB에서 재검증하면서 과도한 답변 EAV와 홈 원장 복제를 피하기 위해서다. 되돌리려면 해당 절과 workflows-changes.json의 동일 표·WF 시험을 함께 변경해야 한다. 해법의 채택 제안은 실제 DB·RLS·공개범위 변경 승인을 대신하지 않는다.
