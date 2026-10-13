# 사이트 청사진과 통합 DB 대응표

정확한 대상은 최종 업무혁신시스템 기획서 1.1의 M00~M15와 API-01~29다. 연결됨은 설계의 추적 가능성을 뜻하며 기능 구현 완료가 아니다.

| 모듈 | 화면 | 주요 원본 | API | 보장할 규칙 |
|---|---|---|---|---|
| M00 계정·학교·소속 | 오늘 진입/학교 전환/가입 승인 | accounts, schools, memberships, membership_roles, school_features | API-01, API-02 | 기존 Auth UID 보존, 승인 대기와 업무 접근 분리 |
| M01 프로필·업무분장·인계 | 업무/내 담당 | duties, assignments, profile_claims, handovers | API-03, API-04 | 신고는 권한이 아니며 의무 ID는 인계 때 유지 |
| M02 일정·학사·시트 전환 | 일정 월/주/목록 | events, event_revisions, calendar_days, source_connections | API-05, API-06 | 원본 하나, 공식 확정과 공유 등록 분리 |
| M03 오늘·개인 업무·협조 | 오늘/개인 할 일 | tasks, cooperation_requests, membership_home_layouts | API-07 | 홈은 권한 있는 원본 조합, 의무를 수동 체크로 완료하지 않음 |
| M04 수합 | 양식 분석/방식·질문 확인/받은·보낸 수합/문답·직접 입력/완료본 | collections, collection_schemas, collection_units, submission_versions, collection_templates, collection_template_versions, collection_template_analyses, collection_template_mappings, file_objects, document_packs, document_revisions, document_validations, jobs, ai_runs, collection_fields, unit_drafts, collection_answer_snapshots, collection_output_artifacts, collection_output_confirmations, documents, file_links | API-08, API-09, API-10, API-27, API-28 | 안내 공개와 완료본 공개 분리, 문항판·접수판 불변; 양식·질문·답변·파일·최종확인의 정확한 판 연결 |
| M05 메신저·전달·알림·문의 | 교사 대화/개별·단체 발송/알림함/전달사항/문의 | notices, notice_receipts, notifications, feedback, messenger_threads, messenger_participants, messenger_messages, messenger_dispatches, messenger_dispatch_targets, messenger_dispatch_files, tool_proposals, tool_runs, idempotency_receipts, outbox | API-11, API-25, API-26 | AI 대화와 교사 대화 분리, 발송 확인·현재 참가 권한, 읽음·제출·동의·확정 구분 |
| M06 학교 지식 | 문서·학교 자료/규정 검색 | knowledge_documents, knowledge_revisions, knowledge_chunks | API-12, API-13 | 학교·시행일·확인판·정확 인용 |
| M07 Claude 비서·기억 | 상주 AI/전문 화면 연결 | conversations, ai_runs, ai_run_sources, tool_proposals, memories, messenger_dispatches, messenger_dispatch_targets, messenger_dispatch_files, messenger_messages, tool_runs, idempotency_receipts, outbox | API-14, API-15, API-26 | 한 입구와 역할별 도구, 현재권한·명시확인 |
| M08 문서·팩·파일함 | 내 초안/공용문서/양식 | documents, document_revisions, document_packs, file_objects, collection_templates, collection_template_versions, collection_template_analyses, collection_template_mappings, document_validations, jobs, ai_runs, collection_schemas, collection_fields, unit_drafts, collection_answer_snapshots, collection_output_artifacts, collection_output_confirmations, file_links | API-16, API-17, API-27, API-28 | AI 내용과 코드 서식/계산 분리, 파일지문마다 검사 |
| M09 시간표 조회·편성 | 관리자 기본자료/조건 설정/편성 작업대/확정 시간표 | timetable_versions, timetable_compositions, timetable_candidates, timetable_basis_revisions, timetable_basis_change_requests, terms, course_groups, course_group_teachers, academic_classes, assignments, bell_schedules, term_day_templates | API-18, API-19, API-29 | 최종 구조 포함, 알고리즘·실제 구현은 사용자 보류 유지; 관리자 자료판·담당자 조건·초안과 배포 분리 |
| M10 시간표 교체·실시 | 교체 요청/대강·보강 | timetable_change_sets, lesson_instances, lesson_executions, cover_ledger | API-20 | 동의·변경확정·실시·원장 분리, 구현 보류 |
| M11 학생·수업·관찰 | 나의 수업/학생 | students, student_enrollments, observations, counselling_records | API-21, API-22 | 학적 기간과 불변 학생ID, 개인 관찰은 작성자 소유 |
| M12 평가·생기부 초안 | 평가/문장별 근거 검토 | assessments, record_drafts, record_sentences, evidence_links | API-23 | 교사 확인 사실만 사용, 근거 바뀌면 출력 차단 |
| M13 수업 사이트 연동 | 활동 받은함/디지털윤리 수업 | activity_instances, source_items, participant_mappings, adoptions | API-24 | 수동 CSV부터 자동 사건까지 같은 불변 원자료/채택 계약 |
| M14 학년도 전환·연속성 | 관리/학년도·인계 | academic_years, terms, student_enrollments, handovers | API-03, API-04, API-21 | 새해에는 관계 새로, 학생ID·이력은 유지 |
| M15 학교 운영·지원 | 관리/설정·작업·복구 | school_policies, policy_versions, jobs, support_sessions, restore_runs, legacy_access_gates, timetable_basis_revisions, timetable_basis_change_requests, terms, course_groups, course_group_teachers, academic_classes, assignments, bell_schedules, term_day_templates | API-02, API-11, API-29 | 역할·정책·복구·옛 경로 폐쇄를 검증한 뒤 공개 |

## 전체 표의 도메인 소유

한 표의 정본은 하나다. 여러 화면에서 참조해도 복제 원장을 만들지 않는다. course_groups 등 공통 수업 기준은 시간표 구현 보류와 관계없이 학생/수합 FK의 선행 기준으로 먼저 생성한다.

| 도메인 | 표 수 | 전체 표 |
|---|---:|---|
| 계정·학교·권한 | 23 | accounts, account_settings, schools, memberships, membership_roles, role_catalog, role_permissions, school_join_codes, departments, profile_claims, school_features, school_feature_pilots, service_features, service_switches, service_operators, operator_grants, service_principals, service_principal_scopes, policy_catalog, school_policies, policy_versions, support_sessions, membership_home_layouts |
| 일정·시트 | 15 | events, event_revisions, calendar_days, calendar_day_grade_overrides, audience_sets, audience_groups, audience_conditions, audience_members, source_connections, source_connection_mappings, source_records, source_record_snapshots, import_runs, import_rows, import_row_candidates |
| 업무·인계 | 8 | tasks, duties, assignments, duty_notes, cooperation_requests, handovers, handover_items, handover_acceptances |
| 수합 | 23 | collections, collection_schemas, collection_fields, collection_reviewers, collection_units, collection_unit_members, collection_due_changes, unit_drafts, submission_versions, submission_files, submission_reviews, correction_requests, correction_windows, collection_correction_fulfillments, export_manifests, export_manifest_items, collection_templates, collection_template_versions, collection_template_analyses, collection_template_mappings, collection_answer_snapshots, collection_output_artifacts, collection_output_confirmations |
| 파일·문서 | 10 | file_objects, file_links, file_access_grants, documents, document_packs, document_revisions, document_inputs, document_actions, document_validations, document_revision_sources |
| 메신저·전달·알림 | 15 | notices, notice_receipts, notifications, notification_kinds, notification_preferences, quiet_hours, push_subscriptions, feedback, feedback_events, messenger_threads, messenger_participants, messenger_dispatches, messenger_dispatch_targets, messenger_messages, messenger_dispatch_files |
| 학교 지식 | 4 | knowledge_documents, knowledge_revisions, knowledge_chunks, knowledge_conflicts |
| Claude·기억 | 9 | conversations, messages, ai_runs, ai_run_sources, ai_policy_versions, tool_proposals, tool_runs, memories, usage_events |
| 학생·평가·생기부 | 24 | academic_years, terms, subjects, academic_classes, students, student_enrollments, course_memberships, observations, observation_revisions, counselling_records, counselling_revisions, rubrics, rubric_revisions, assessment_activities, assessments, assessment_revisions, record_rule_sets, record_drafts, record_draft_revisions, record_sentences, evidence_links, record_exports, record_correction_approvals, student_evidence_gates |
| 수업 앱 연결 | 12 | activity_instances, classroom_imports, classroom_connections, classroom_event_receipts, source_items, source_item_revisions, participant_mappings, participant_mapping_revisions, inbox_items, adoptions, source_actions, impact_items |
| 시간표 | 28 | spaces, bell_schedules, bell_periods, term_day_templates, course_groups, course_group_classes, course_group_teachers, constraint_sets, timetable_constraints, teacher_unavailability, timetable_compositions, timetable_candidates, timetable_versions, timetable_placements, timetable_version_impacts, lesson_instances, lesson_instance_teachers, space_reservations, resource_occupancy, timetable_change_sets, timetable_change_items, timetable_change_participants, lesson_executions, lesson_execution_teachers, cover_ledger, school_timetable_types, timetable_basis_revisions, timetable_basis_change_requests |
| 작업·이관·복구 | 19 | jobs, job_attempts, job_external_calls, idempotency_receipts, audit_events, outbox, object_revisions, migration_runs, migration_items, migration_checks, data_write_authority, legacy_access_gates, retention_rules, retention_holds, resource_classes, deletion_ledger, restoration_ledger, recovery_sets, restore_runs |

## 검토 범위와 수치

원본 160표 중 94표를 명시 보강하고 30표를 추가한 목표 190표, 2649열이다. 표 수 자체를 완성도 지표로 삼지 않는다. 신규 표는 정확한 정책/문항/채택 근거, 인계 수락, 외부 호출 경계 등 기존 반례를 닫거나 이미 기획된 기능의 최소 관계를 구현하기 위한 것이다.

각 표의 최종 열은 09-table-dictionary.md, 기계 판독형 카탈로그는 schema-contract.json이다. 변경 JSON에 없는 원본 함수·정책도 통합 공통 계약을 따르도록 SQL 작성 단계에서 재검토한다.

## 청사진 공통 계약 C01~C12

| ID | 계약 | 상세 명세 | 검증 |
|---|---|---|---|
| C01 | 인증·자료 범위·학교 경계 | 01-foundation-security.md | IT01, IT02, IT04 |
| C02 | 열람·추천·의무 분리 | 02-workflows-documents.md, 05-api-site-contract.md | IT08, IT31 |
| C03 | 상태·버전·접수 | 02-workflows-documents.md, 03-students-timetable.md | IT06, IT07, IT22 |
| C04 | 멱등·경합·확정 | 01-foundation-security.md, 05-api-site-contract.md | IT04, IT05, IT06, IT13, IT21 |
| C05 | 파일·긴작업·취소 | 02-workflows-documents.md, 04-ai-knowledge-jobs.md | R10, R11, R12, IT09, IT20 |
| C06 | 마감·연체·재제출 | 02-workflows-documents.md | IT07 |
| C07 | 가져오기·안정원본ID | 02-workflows-documents.md, 03-students-timetable.md | IT10, IT14, IT15 |
| C08 | 인계·전출·학년도 정정 | 01-foundation-security.md, 02-workflows-documents.md, 03-students-timetable.md | IT04, IT11, IT28 |
| C09 | 근거·정정전파 | 03-students-timetable.md, 04-ai-knowledge-jobs.md | R04, R05, R06, IT13 |
| C10 | 알림·캐시·학교전환 | 02-workflows-documents.md, 05-api-site-contract.md | IT03, IT33 |
| C11 | AI행동·기억·비용 | 04-ai-knowledge-jobs.md | IT18, IT19, IT20 |
| C12 | 보존·지원·복구 | 01-foundation-security.md, 07-migration-operations.md | IT24, IT25, IT26 |

## 청사진 수용 기준 V01~V48

아래는 원문을 추적한 설계 연결이며 실제 기능 시험 통과를 뜻하지 않는다. 원문 지문은 blueprint-contracts.json에 기록했다.

| ID | 상황 | 기대 결과 | 통합 시험 |
|---|---|---|---|
| V01 | 신규 계정·소속 없음·pending으로 가입/업무 접근 | 최소 학교/본인 신청만 가능, 업무·자기 승인 차단 | IT01, IT12 |
| V02 | 한 계정이 A학교 관리자/B학교 교사, 같은 이름 자료 | 학교별 권한 분리·다른 학교 역할/객체 사용 거부 | IT02 |
| V03 | 열어 둔 세션·작업·옛 URL 상태에서 소속 종료 | 새/옛 API·DB·파일·AI·캐시·작업 접근/실행 회수 | IT04, IT25 |
| V04 | 관리자·담임·운영자가 타인 기록/대화/건수 요청 | 본문·집계·검색·알림·내보내기 모두 차단 | R01, IT02, IT26 |
| V05 | 프로필 교과 자가 변경·담당 시작/종료 경계 | 추천 요청만 변화, 공식 권한 불변·기간 정확 | IT12, IT31 |
| V06 | 인계 수락·효력일·중복 요청·중간 실패 | 원자 한 번 적용·의무 ID/수 유지·실패 전체 취소 | R09, IT11 |
| V07 | private 일정에 audience가 남음·0명·제외 조건 | private 작성자만, 대상 규칙·접근 분리 정확 | IT31 |
| V08 | 부서 AND 교과 OR 직접추가, 제외·발생일/현재시점 | 승인 관계로 정확 선정, 조회 실패를 0명 처리 안 함 | IT31 |
| V09 | 일반 교사의 공식 일정 수정·공유 취소·시수 재계산 | 공식 확정 권한 보호·개정 보존·문서 소급 변경 없음 | IT32 |
| V10 | 시트 정렬·행 삽입·내용 수정·ID 소실·동시 수정 | 안정 ID 유지, ID 소실 확인, 기준 전환 뒤 덮어쓰기 차단 | IT10 |
| V11 | 초보 교사·360px·느린 카드·학교 전환·미저장 | 오늘 할 일 설명 가능·수평 막힘 없음·학교 자료 혼합 없음 | IT03, IT30 |
| V12 | 개인 체크·수합 의무 체크·중복 AI 요청 | 개인 할 일만 완료, 원본 의무는 실제 접수·확정으로 완료 | IT30, IT07 |
| V13 | 숫자 수합/파일 없음·검토 없음·내보내기·공동 3명 1단위 | 정상 접수·완료본/집계/출력·의무 수 1·불필요 승인 없음 | IT07 |
| V14 | 공동 작성자 초안 편집/제출 시도·구성원 제거·요청자 초안 조회 | 구성원 편집 가능·지정 책임자만 제출, 제거 즉시 차단, 미제출 비공개 | R02, IT07 |
| V15 | 접수 v1→정정 v2→보완·철회, 외부 처리 있음 | 판별 상태·완료본 정확, v1 외부 처리 v2로 복사 안 함 | IT07 |
| V16 | 검토 없음 v2 정정·철회, ZIP 대기 중 권한 종료 | 유효판 정확·과거판 자동 부활 없음·다운로드 권한 차단 | IT07, IT09 |
| V17 | 동시 제출/검토·더블클릭·응답 유실·같은키 다른본문 | 중복 0·지정판 충돌·동일 접수 재조회 또는 명확한 거부 | IT05, IT06, IT07 |
| V18 | 미제출 마감 초과·기한 전/후 보완 제출·면제·마감 변경·none 철회 후 옛판 존재 | 지연 3축 구별·재제출로 보완 연체 해제·현재 포인터 기준·분모/독촉 정확·과거 판정 유지 | IT07 |
| V19 | 같은 사건 재전송·권한 밖 알림·조용한 시간 | 중복 0·정보 비노출·묶음/긴급 정책 정확 | IT33 |
| V20 | 키보드·200% 확대·읽음/확인 요청·문의 | 핵심 조작·상태 이해 가능, 읽음이 승인으로 처리 안 됨 | IT30, IT33 |
| V21 | HWPX/텍스트 PDF/직접입력·스캔/암호화/잘림·미래판·색인 지연·철회 | 원문/쪽 위치 대조·추출 오류 보류·게시/시행/색인 분리·유효판만 사용 | IT17 |
| V22 | 학교 규정 질문·출처 없음·타학교 유사 문서 | 적용판/출처 정확, 없으면 확인 필요, 타학교 근거 0 | IT02, IT17 |
| V23 | 규정 상충·과거/미래 기준일·문서 속 도구 지시 | 범위/시점 구별·확정 과장 없음·권한 변경 없음 | IT17, IT18 |
| V24 | 파일 성공 후 DB 실패·작업 중단·알림 실패·복구 | 허위 접수 0·실패 단계 재개·중복 0·실물 대조 | IT06, IT09, IT24 |
| V25 | 기존 6양식·최대길이·누락·실제 한글 열기 | 자산 지문 보존·필수 회귀 0 skip·동등 출력/오류 | IT29 |
| V26 | 최종 파일 재업로드·형식 위장·해제 과다·추출 잘림 | 새 검사·실물 확인·한도 거부·잘림 안내·이전 검사 승계 안 함 | IT09, IT29, IT35 |
| V27 | 전임 전출이 수락보다 먼저·새 의무 발생·학기 변경 | 권한 종료 우선·담당 공백 표시·낡은 목록 적용 거부 | IT04, IT11 |
| V28 | 시간표 미매핑·일과 중복·기간/학급코드 혼동 | 기존표 유지·오류 행 안내·학생 명부 자동 연결 없음 | IT23 |
| V29 | 동의 뒤 출장 확정·예약·수강 변경·동시 교체 | 확정 잠금 안 재검사, 충돌 후보 반영 0 | IT21 |
| V30 | 교체 후 추가 교체/예약/실시가 있는 원복 | 후속 자료 덮지 않음·새 후보/동의·실시 정정 구분 | IT22 |
| V31 | L0 읽기 질문·모델이 높은 도구 수준 요청 | 허용 읽기만·서버 수준 고정·전문 승인 이동 | IT18 |
| V32 | 확인 뒤 입력/판/대상 변경·만료·중복 확인 | 낡은 승인 거부·한 번 실행·새 영향 재확인 | IT18 |
| V33 | 악성 문서·학생 답변·다른 학교 문서팩·규칙 누락 | 외부 지시 무시·자산 격리·누락 검사 통과 표시 없음 | IT18, IT29, IT35 |
| V34 | 감사/오류 로그·지원 세션 만료·AI 무한 반복 | 민감 본문 비기록·지원 종료 차단·반복 중지·추적 가능 | IT20, IT26 |
| V35 | AI/알림/일부 조회 장애·느린 학교망 | 수동 핵심 업무 유지·오류≠빈 자료·기준시각·재개 | IT30, IT33 |
| V36 | 기억 미확인·수정·삭제·원자료 정정·전출 | 확인 전 장기 사용 없음·철회/만료/무효화 즉시 반영 | IT19 |
| V37 | 기본 편성 고정칸·요구량·출장·모순·시간 초과 | 필수조건 준수·불가능/미해결 구별·자동 완화 없음 | IT23 |
| V38 | 후보 수동 충돌·새 기본표와 기존 교체/보강 | 재검사 전 배포 차단·미해결 영향 보류·과거 실시 보존 | IT21, IT22, IT23 |
| V39 | 예정→미실시→정정→취소/원복 재시도 | 예정/실시 누계 정확·원인당 한 번·학교 산식 표시 | IT22 |
| V40 | 동명이인·번호 재사용·전입/반 이동·CSV 누락 | 확인 없는 병합/전출 없음·당시 관계 보존 | IT14, IT28 |
| V41 | 본인의 작년 기록 정정·타인/관리자 정정 | 작성자 개정 가능·절차 승인과 본문권한 분리 | IT13, IT28 |
| V42 | 생성/검토/내보내기 중 근거·학생 매핑 정정 | 불변 근거 유지·동기 검사·재검토·낡은 정상 출력 차단 | R04, R05, R06, IT13 |
| V43 | 미제출·결시·0점·루브릭 개정·AI 점수 | 상태 정확·코드 계산·교사 확정·기존 점수 자동 변경 없음 | IT16 |
| V44 | 미확정/철회 근거·규칙 없음·과장 문장·공식입력 구분 | 생성 제외/확인 필요·not_checked·문장 근거·공식 입력 오표시 없음 | R06, IT16, IT17, IT35 |
| V45 | 두 CSV 실제 형식·BOM·따옴표·줄바꿈·수식보호 | 원문 보존·정확 질문 매칭·실행 방지·심화 평가 제외 | IT14 |
| V46 | 같은 활동/다른 활동 동일 파일·행 정렬·중복학생 | 범위별 중복 정확·확인형 연결·누락=삭제 아님 | IT14, IT15 |
| V47 | 미채택 외부 답변·채택 후 원문 정정/철회 | 근거 사용 차단/허용 구별·관련 관찰/평가/초안 재검토 | R05, R06, IT13, IT15 |
| V48 | 일부학생 원본 삭제·재수입·복구·이미 내보낸 문안 | 파일 실물 처리 범위 표시·삭제 부활 방지·외부 정정 안내 | IT15, IT24 |

## 2026-10-13 보강 추적

| 영역 | 추가 API | 상세 시험 | 구현 티켓 | 작성 원본 |
|---|---|---|---|---|
| 메신저·전달·알림 | API-25, API-26 | MSG01, MSG02, MSG03, MSG04, MSG05, MSG06, MSG07, MSG08, MSG09, MSG10, MSG11, MSG12, MSG13, MSG14 | MSG-T01, MSG-T02, MSG-T03, MSG-T04, MSG-T05 | messenger-extension.json |
| 수합 | API-27, API-28 | COL01, COL02, COL03, COL04, COL05, COL06, COL07, COL08, COL09, COL10, COL11, COL12, COL13, COL14, COL15, COL16, COL17, COL18, COL19, COL20, COL21, COL22, COL23, COL24 | COL-T01, COL-T02, COL-T03, COL-T04, COL-T05, COL-T06, COL-T07, COL-T08 | collection-extension.json |
| 시간표 | API-29 | TT01, TT02, TT03, TT04, TT05, TT06, TT07, TT08, TT09, TT10, TT11, TT12, TT13, TT14, TT15, TT16, TT17, TT18, TT19, TT20, TT21, TT22, TT23, TT24, TT25 | TT-T01, TT-T02, TT-T03, TT-T04, TT-T05, TT-T06, TT-T07, TT-T08 | timetable-extension.json |

연결 여정은 15-implementation-handoff.md를 따른다. 기존 V01~V48의 원문 추적은 history의 v1.0 기획서이며 최신 보강은 extension JSON으로 추적한다. 운영 DB 시험은 미실행이다.
