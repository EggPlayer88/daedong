# 사이트와 DB 명령 계약

목표 사이트 M00~M15의 화면은 DB 표를 임의로 조합해 쓰지 않고 아래 읽기 모델과 명령을 사용한다. API 번호는 기능군이며 거대한 단일 RPC를 뜻하지 않는다. 실제 세부 route와 JSON Schema는 이 계약을 구체화한 구현 산출물이다.

## 공통 요청과 결과

변경 요청은 인증 JWT, 명시적 scope, idempotency_key, expected_version 또는 정확한 revision을 받는다. account_id·role·approved 같은 클라이언트 주장으로 주체를 결정하지 않는다. 서버는 auth.uid()→accounts→현재 membership을 해석한다. 명령 수신과 실행 권한을 별도로 검사하며 서비스 요청은 제한된 principal 자격을 사용한다.

request_sha256은 클라이언트 의도를 결정적으로 정규화한 지문이다. 명시적으로 확인한 대상판·파일지문·정책판은 포함하되 서버가 첫 실행에서 선택한 정책/근거판은 별도의 고정 실행 맥락으로 보존한다. 동일 키 재시도에서 현재 정책판을 끼워 넣어 원래 의도를 다시 해시하지 않는다. 같은 실행자/범위/명령/키와 같은 요청 지문은 기존 결과, 다른 요청 지문은 IDEMPOTENCY_CONFLICT다. 기존 접수증은 현재 조회 권한 확인 후 원래 요청 지문과 비교해 반환하며, 새 실행만 현재 정책을 평가한다. UNIQUE 충돌을 이용해 접수의 소유권을 선점하고 동시 중복 실행을 막는다. 먼저 SELECT한 결과가 없다는 이유만으로 접수 소유권 없이 실행하지 않는다.

권한 gate와 원본을 01의 동일 잠금 순서로 확보한 뒤 재검사한다. 업무 변경·정확한 판·접수증·필수 감사·outbox는 한 트랜잭션이다. 실패하면 이 묶음은 모두 롤백한다. 외부 API/파일 전송은 잠금을 잡고 기다리지 않는다. outbox 소비는 적어도 한 번 전달을 전제로 수신측 dedup과 job fencing을 사용한다.

성공 결과는 operation_id, status=committed 또는 accepted, resource(type/id/version), server_recorded_at, next_action을 반환한다. accepted+job_id는 최종 업무 완료가 아니다. 오류는 code, retryable, correlation_id, 안전한 사용자 설명을 제공하며 다른 학교 객체의 존재·본문을 노출하지 않는다.

## 기능군별 계약

### API-01 · M00

- 명령: cmd_ensure_account, cmd_request_membership
- 읽기: my_context / school_directory / join_code_preview / membership_requests
- 표: accounts, schools, memberships, school_join_codes
- 입력: join_code 또는 school_id, request_id, 신청 expected_version
- 권한: 로그인 계정, 최소 학교 찾기, 본인 신청만. 승인 전 업무 조회 불가
- 결과: 계정 맥락·신청 ID·pending/active를 구분
- 필수 시험: 첫 로그인/기존 회원/대기/중복 신청/자기승인 차단

### API-02 · M00 / M15

- 명령: cmd_decide_membership, cmd_grant_role, cmd_end_membership, cmd_set_feature_visibility
- 읽기: school_members / feature_status
- 표: memberships, membership_roles, school_features, school_feature_pilots
- 입력: membership_id, 결정·사유·기간, expected_version, 공개 변경 승인 근거
- 권한: 현재 학교의 해당 관리 권한. 자신을 승인/승격하지 못함
- 결과: 새 membership/permission version, 영향받은 접근·작업
- 필수 시험: 회수와 저장 경합/마지막 관리자 보호/타학교/공개 확대

### API-03 · M01

- 명령: cmd_assign, cmd_submit_profile_claim, cmd_review_claim, cmd_save_duty_note
- 읽기: duty_page / approved_profile / pending_claims
- 표: duties, assignments, profile_claims, duty_notes
- 입력: duty/subject/department/class/course, valid_from/to, expected_version
- 권한: 본인 신고와 공식 배정 분리. 지정 업무/인사 범위의 승인권자
- 결과: 승인 관계와 신고 상태를 별도 반환
- 필수 시험: 중복 기간/미승인 프로필 권한상승/학급·수업 다른학교

### API-04 · M01 / M14

- 명령: cmd_handover_preview, cmd_handover_accept, cmd_handover_apply, cmd_handover_cancel
- 읽기: handover_detail / handover_impact
- 표: handovers, handover_items, handover_acceptances, assignments, collection_units
- 입력: scope, 후임 membership, effective_on, manifest_hash, acceptance_id, expected_versions
- 권한: 원책임자·후임·적용권자 역할을 나누고 활성 후임과 정확한 수락판 확인
- 결과: 기존 의무 ID를 유지한 책임 이동·제외 항목·접수증
- 필수 시험: NULL 수락/내용 바뀐 수락/개인자료 제외/경합/부분적용 0건

### API-05 · M02

- 명령: cmd_save_event, cmd_confirm_official, cmd_cancel_event, cmd_delete_event
- 읽기: events_in_range / event_detail / audience_preview
- 표: events, event_revisions, audience_sets, calendar_days
- 입력: 제목·시간·공개범위·대상판·kind·expected_version·변경사유
- 권한: 공유 일정은 활성 교사 등록. 공식 확정은 별도 권한. 개인 일정 관리자 자동열람 금지
- 결과: 불변 일정판·원본 ID·추천 이유·공식 여부
- 필수 시험: 공식 초안 비노출/학교전환/개인범위/수업일 영향

### API-06 · M02

- 명령: cmd_import_preview, cmd_import_apply, cmd_cutover_source
- 읽기: import_diff / import_result
- 표: source_connections, source_records, source_record_snapshots, import_runs, import_rows
- 입력: connection_id, mapping_version, file_id, baseline_ids, row decisions, expected_versions
- 권한: 연결 담당자만. 사이트 기준으로 전환한 원본을 시트가 덮지 못함
- 결과: 행별 applied/conflict/skipped/error와 기준 위치
- 필수 시험: 3방향 충돌/안정ID없음/미리보기후변경/파일누락삭제 금지

### API-07 · M03

- 명령: cmd_save_task, cmd_set_task_state, cmd_cooperation_create, cmd_cooperation_respond
- 읽기: home_snapshot / my_tasks / assigned_task_status
- 표: tasks, cooperation_requests, events, collection_units, lesson_instances
- 입력: scope·title·task_id·expected_version 또는 협조 응답·대체자
- 권한: 개인 작업은 본인. 배정자는 협조 상태만, 개인 메모 본문은 제외
- 결과: 원본이 연결된 홈 카드·개인 할 일·협조 상태
- 필수 시험: 수합 수동완료 금지/원본-사본 열람 동일/중복 카드/부분조회 실패

### API-08 · M04

- 명령: cmd_open_collection, cmd_publish_collection, cmd_change_collection_schema, cmd_exempt_unit
- 읽기: collection_detail / collection_units_status / publish_preview
- 표: collections, collection_schemas, collection_fields, collection_units, collection_unit_members
- 입력: schema_id/hash·unit definitions·responsible membership·due_at·request/result_visibility·policy_version
- 권한: 게시 권한·대상·정책판. 단위별 하나의 의무. 결과 공개 별도
- 결과: 게시판·고정 의무·단위 ID·면제 이력
- 필수 시험: 같은단위중복/정의판불변/다른수합schema FK/결과공개기본차단

### API-09 · M04

- 명령: cmd_save_draft, cmd_submit, cmd_withdraw_submission
- 읽기: unit_draft / submission_receipt / operation_result
- 표: unit_drafts, submission_versions, submission_files, collection_units
- 입력: unit_id·schema_id·answers·검증 file IDs·expected unit/draft version·idempotency_key
- 권한: 초안은 유효 구성원. 제출/철회는 책임자 또는 유효 대리
- 결과: 불변 제출판·서버 접수시각·review state·완료본 포인터
- 필수 시험: 미래구성원/RLS/동시제출/응답유실/철회후과거본무단복원금지

### API-10 · M04

- 명령: cmd_review_submission, cmd_request_correction, cmd_open_correction_window, cmd_collection_export
- 읽기: submission_review / correction_status / export_status
- 표: submission_reviews, correction_requests, collection_correction_fulfillments, export_manifests, export_manifest_items
- 입력: submission_id/revision·review decision·due_at·reason·selected version IDs
- 권한: 지정 검토자·요청관리자. 과거 제출자/책임자 계정 기준 자기검토 금지
- 결과: 검토 결과·보완 의무·검사된 선택판의 출력 작업 ID
- 필수 시험: 인계후자기검토/충족판철회/보완연체/ZIP부분실패/출력중권한회수

### API-11 · M05 / M15

- 명령: cmd_publish_notice, cmd_ack_notice, cmd_feedback_create, cmd_support_session_grant, cmd_support_session_revoke
- 읽기: notices_for_me / notifications / feedback_status / support_scope
- 표: notices, notice_receipts, notifications, feedback, support_sessions
- 입력: notice revision·수신대상·확인 요청 또는 feedback·지원범위·만료
- 권한: 게시 범위·현재 원본 권한·승인 지원 목적/기간. 읽음≠명시확인
- 결과: 게시판·중복없는수신목록·확인판·문의번호
- 필수 시험: 수신범위회수/수정후확인판/조용한시간/문의민감첨부기본없음

### API-12 · M06

- 명령: cmd_knowledge_upload, cmd_knowledge_create_revision, cmd_knowledge_publish, cmd_knowledge_withdraw
- 읽기: knowledge_revision / extraction_status / publication_preview
- 표: knowledge_documents, knowledge_revisions, knowledge_chunks, knowledge_conflicts
- 입력: file_id·scope·effective interval·school_level/region·verified_text·source locator
- 권한: 제안과 게시 권한 분리. 공통 승격 별도. 원문확인과 시행범위 필수
- 결과: 확인된 게시판·색인 상태·충돌 후보
- 필수 시험: 미확인추출게시불가/시행전후정확판/철회/학교규정공통화금지

### API-13 · M06

- 명령: query_knowledge
- 읽기: search_knowledge / knowledge_index_status
- 표: knowledge_documents, knowledge_revisions, knowledge_chunks
- 입력: scope·query·as_of_date·filters·cursor
- 권한: 검색 전에 범위·학교·시행·대상 필터, 인용 직전 원본 재검사
- 결과: 근거 구간·원문판·쪽/조항·기준일·색인준비상태
- 필수 시험: 권한없는벡터후보유출/현행판미색인/상충자료/전출후캐시

### API-14 · M07

- 명령: cmd_assistant_run, cmd_confirm_proposal, cmd_cancel_assistant_run
- 읽기: conversation / assistant_run_status / proposal_detail
- 표: conversations, messages, ai_runs, ai_run_sources, tool_proposals, tool_runs, jobs
- 입력: scope·conversation_id·message·proposal/hash·expected target versions·confirmation
- 권한: 본인·현재소속·생성소속·도구별 현재권한. 모델이 행동 수준을 바꾸지 못함
- 결과: 근거답변 또는 확인가능한 작업안·실행접수증
- 필수 시험: 재임용/확인후대상변경/중복확인/원문명령주입/외부결과불명확

### API-15 · M07

- 명령: cmd_memory_propose, cmd_memory_confirm, cmd_memory_revoke, cmd_memory_correct
- 읽기: usable_memories / memory_history
- 표: memories, ai_run_sources, conversations
- 입력: memory_id·source refs·content·scope·expires_at·expected_version
- 권한: 본인 확인과 범위·만료·원본 권한. 학교정보를 개인기억으로 자동복사 금지
- 결과: 확인 상태·재사용 가능 여부·정정/중단 이력
- 필수 시험: 미확인기억재사용/근거파기/학교전출/동일교재임용

### API-16 · M08

- 명령: cmd_document_job, cmd_document_validate, cmd_document_export
- 읽기: document_detail / validation_report / job_status
- 표: document_packs, documents, document_revisions, document_revision_sources, document_validations, jobs
- 입력: pack_id/version·input role refs·structured fields·expected_revision
- 권한: 서버가 허용팩판·자산을 선택. 생성/검사/제출은 별도행동
- 결과: 초안판·누락목록·지원수준·검사결과·검증 file ref
- 필수 시험: 기존6양식회귀/작년사실자동승계금지/수정파일재검사/원형보존과내용지원구분

### API-17 · M08

- 명령: cmd_file_init, cmd_file_complete, cmd_file_download, cmd_file_delete_request
- 읽기: file_status / file_grant_status
- 표: file_objects, file_links, file_access_grants, deletion_ledger
- 입력: 원본 종류/ID·media type·size·hash·intent·expected_version
- 권한: 실물과 요청객체 일치·소유관계/원본권한·정책판·사용시점 재검사
- 결과: 검증 상태·현재 권한 다운로드 경로·삭제 접수
- 필수 시험: 경로바꾸기/타학교부모/부모UPDATE/미검사/회수후링크/실물없는ready

### API-18 · M09

- 명령: cmd_timetable_import_preview, cmd_timetable_import_apply
- 읽기: my_lessons / timetable_grid / import_mapping
- 표: bell_schedules, timetable_versions, timetable_placements, lesson_instances
- 입력: school/term·source_file·mapping·기대입력판
- 권한: 지정 담당자. 학교 일과·학기·교사/학급/공간 매핑 확인
- 결과: 명시적으로 구분한 후보/배포판·미매핑 목록
- 필수 시험: 초중고일과/다중학급선택분반/미매핑보류/기존실시보존

### API-19 · M09

- 명령: cmd_start_composition, cmd_validate_candidate, cmd_publish_timetable
- 읽기: composition_status / candidate_diff / publish_impact
- 표: constraint_sets, timetable_constraints, timetable_compositions, timetable_candidates, timetable_version_impacts
- 입력: 조건판/시수/배정·input hash·candidate version·publish confirmation
- 권한: 담당자·확인된 조건판. AI는 필수조건을 임의 완화하지 못함
- 결과: 계산결과/미해결·검증보고·영향명세·배포판
- 필수 시험: 조건변경후후보재검사/수동수정/교사학생공간충돌/실시판보존

### API-20 · M10

- 명령: cmd_change_propose, cmd_change_respond, cmd_change_apply, cmd_change_revert, cmd_confirm_execution
- 읽기: change_candidates / consent_status / execution_ledger
- 표: timetable_change_sets, timetable_change_items, timetable_change_participants, resource_occupancy, lesson_executions, cover_ledger
- 입력: 원수업판·변경항목판·동의hash·승인·expected_versions·실시결과
- 권한: 관련자 동의·지정 승인·실제 담당. 빈 자원도 동시에 두 번 배정 불가
- 결과: 원자변경·이전판관계·실시판·보강원장
- 필수 시험: 교체경합/동의후수정/전출후동의/원복영향/시간경과자동실시금지

### API-21 · M11

- 명령: cmd_roster_import_preview, cmd_roster_import_apply
- 읽기: course_roster / student_context / roster_diff
- 표: students, student_enrollments, course_groups, course_memberships, course_group_teachers
- 입력: 명부 file·기간·학급/수강 매핑·stable external IDs·expected versions
- 권한: 명부담당/현재수업담당 범위. 동명이인은 사람 확인
- 결과: 불변학생ID·기간별학적/수강·행별결과
- 필수 시험: 동명이인/전학/복수학교/선택과목/학년전환ID유지

### API-22 · M11

- 명령: cmd_save_observation, cmd_correct_observation, cmd_withdraw_observation, cmd_save_counselling
- 읽기: my_observations / my_counselling / revision_history
- 표: observations, observation_revisions, counselling_records, counselling_revisions, student_evidence_gates
- 입력: student_id·enrollment/course·occurred_at·facts·origin·expected_revision
- 권한: 본인과 현재 학교·당시 담당 관계. 과거학년도 정정 절차
- 결과: 확인된사실판·정정사유·근거영향·재검토상태
- 필수 시험: 타교사비공개/학생정체성변경거부/과거정정/근거출력경합

### API-23 · M12

- 명령: cmd_confirm_assessment, cmd_save_record_draft, cmd_link_evidence, cmd_review_record, cmd_export_record
- 읽기: assessment_detail / record_evidence_graph / export_check
- 표: assessments, assessment_revisions, rubric_revisions, record_drafts, record_draft_revisions, evidence_links, record_exports
- 입력: student/context·rubric revision·evidence refs·draft revision·reviewed hash
- 권한: 작성자·현재소속·정확학생/원본판·기재규칙판·교사검토
- 결과: 평가확정판·문장근거·검토지문·출력기록
- 필수 시험: A학생근거B초안/근거철회/실제0점vs미평가/규칙미정/원문파기

### API-24 · M13

- 명령: cmd_classroom_import_preview, cmd_classroom_import_apply, cmd_classroom_remap, cmd_classroom_adopt, cmd_classroom_source_withdraw
- 읽기: activity_inbox / mapping_review / adoption_impact
- 표: activity_instances, classroom_imports, source_items, source_item_revisions, participant_mappings, participant_mapping_revisions, adoptions, inbox_items
- 입력: activity/question revision·file/event receipt·source revision·mapping revision·target revision
- 권한: 활동담당교사 확인. 학생자동확정/자동평가 금지
- 결과: 확인받은함·정확연결판에고정된채택·관찰/평가후속판
- 필수 시험: A→B→A/채택없는출처/중복역순/질문판변경/삭제후재수입차단


## 대시보드 응답

home_snapshot은 school/account scope와 basis_at, permission_version, sections를 반환한다. 각 section은 ready/empty/error/forbidden/disabled를 구분한다. 각 카드는 source_type/id/revision, relevance_reason, obligation_kind, due_at, responsible_label, next_action을 포함한다. 원본 없는 AI 의무 카드를 만들지 않는다.

한 원본의 여러 추천 이유는 한 카드에 병합한다. 수합은 unit_id, 교체는 change_set_id, 수업은 instance_id, task는 task_id를 dedup key로 쓴다. 마감은 수합/의무 원본의 서버 기준 값을 읽는다. 부분 조회 실패를 “할 일 없음”으로 바꾸지 않는다.

비공개 본문을 홈 집계에 복제하지 않는다. 캐시가 필요하면 학교·계정·소속·권한판·기준일·조회조건을 키로 삼고, 원본 변경/권한회수 시 무효화한다. 알림과 AI 브리핑도 읽는 순간 원본 권한을 재검사한다. 조회 결과가 오래됐으면 표시하고 확정 행동은 최신 상태를 확인한다.

## 기존 화면 연결 어댑터

| 현재 계약 | 통합 DB 연결 | 보존/변경 기준 |
|---|---|---|
| LegacyServices.getSession / signInWithGoogle | 기존 Google/Auth 세션 유지 | 인증 코드 변경 없이 기존 UID를 accounts에 연결 |
| LegacyIdentity.userId | Auth UID | 신규 account.id나 membership.id로 혼용하지 않음 |
| LegacyProfile.is_active / role | 이관 미리보기 입력과 legacy 승인 보존 | 새 학교 역할의 영구 권위가 아니며 회수된 역할 복구 금지 |
| CalendarAdapter.list/get/save(memberId, …) | events_in_range/명시 scope + cmd_save_event | memberId는 요청 맥락, 실제 실행자는 JWT. 조회에 날짜범위·cursor 추가 |
| TaskAdapter.create/update/setStatus | cmd_save_task / cmd_set_task_state | requestKey·expectedVersion 유지, 의무형 task의 수동완료 차단 |
| 기존 validThrough | 새 valid_to exclusive | date인 경우만 하루 증가. NULL은 무기한. 원본값과 변환판 보존 |
| fixture / preview store | 합성 데이터 모드 | 운영 연결 결과와 혼합하거나 미리보기 성공을 DB 성공으로 표시하지 않음 |
| 기존 수합/학생 UI state | 새로운 불변판·검토 상태·정확 ID | adapter에서 상태를 버리거나 모두 done으로 단순화하지 않음 |

기존 프론트 오류를 바꾸지 않아야 하는 과도기에는 MEMBERSHIP_INACTIVE→INACTIVE_MEMBERSHIP, VERSION_CONFLICT→CONFLICT, SCOPE_DENIED→FORBIDDEN, RESOURCE_UNAVAILABLE→NOT_FOUND로 명시 매핑한다. 원래 코드와 correlation_id는 안전한 진단 정보로 보존한다. 변환할 수 없는 새 상태는 숨기지 말고 화면에 대응 상태를 추가한다.

전환 중 각 엔터티 종류의 기준 쓰기 위치는 data_write_authority 하나로 결정한다. 같은 버튼이 옛 RPC와 새 RPC를 모두 호출하는 이중 쓰기를 만들지 않는다. 구 RPC를 유지해야 하면 호환 facade가 새 명령 하나에 위임한다. 기준을 바꾼 뒤에는 rollback도 데이터 대조와 차단 절차를 따른다.

## API 구현 완료의 기준

명령마다 입력 JSON Schema, 권한 검사, DB 원자성, 오류 코드, 현재권한 결과 재조회, 화면 종단 시험이 있어야 구현 완료다. 이 파일의 함수명이 존재한다는 이유만으로 구현·노출·운영 완료로 계산하지 않는다. 24개 기능군 모두 현재 status는 target_contract_not_implemented이며, 기존 일부 함수의 존재는 별도 실측 목록으로 관리한다.
