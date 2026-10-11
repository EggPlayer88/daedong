# 기획 요구–물리 DB–구축 배치 추적표

작성 기준: 2026-10-11. 대상은 바탕화면 `GPT작업/업무혁신시스템 기획서.md`의 **M00~M15 및 API-01~API-24**다. 이 문서는 이번 DB 설계의 대응 범위를 기록하며 **DDL 작성·승인·실행·운영 연결 완료를 뜻하지 않는다.** 실제 DB 적용 여부는 별도 실측이 필요하다.

## 1. 읽는 기준

| 약칭 | 정본 문서와 범위 |
|---|---|
| 01 | [계정·학교·권한·이관](01-foundation-security-migration.md): 기존 회원 보존, 학교 소속, 승인 관계, 공개 제어, legacy 회수 |
| 02 | [업무·일정·수합·문서/파일](02-workflows-documents.md): 정형 업무 표, 제출판, 파일·문서팩, 상태와 원자성 |
| 03 | [학생·수업·외부 활동](03-students-integrations.md): 명부·담당·개인 기록·평가·문장 근거·활동 원본 |
| 04 | [지식·Claude·공통 운영](04-ai-operations.md): 지식판, 도구 확인, 작업·접수증·사건, 인계·파기·복구 |
| 05 | [구축·SQL 확정 인계](05-build-handoff.md): 실제 생성 순서 B00~B11, 실측·SQL 묶음·검증·실패 복구 |

**표 이름:** 아래 이름은 기존 `auth.users`·`public.users`를 제외하고 모두 `public.workhub_` 접두어를 붙인다. 예를 들어 `collections`는 `public.workhub_collections`다. `X/Y`는 두 표의 축약 나열이며 실제 슬래시가 포함된 이름이 아니다. “제안명”은 이번 문서에서 통일한 물리명이지 사용자 승인이나 확정 SQL을 의미하지 않는다.

**단계:** 이번 DB 구축은 R0 기반 → R1 업무 → R2 수업 → R3 지능·문서 → E 선택 확장이다. 02의 R1-A~D는 R1 안의 세부 순서다. 상위 기획서의 예전 R0~R4 모듈 마일스톤과 숫자만으로 동일시하지 않는다. 실제 FK 생성 선후는 05의 B번호가 우선한다. 일부 배치 완료를 전체 공개 완료로 계산하지 않는다.

| 상태 표기 | 이 문서에서 말하는 정확한 범위 |
|---|---|
| 기존 유지 | 현재 서비스의 기존 계정·기능·보호 자산을 유지한다. 신규 학교별 계약까지 완료됐다는 뜻은 아니다 |
| 연결 코드 | 실제 RPC를 호출하는 어댑터와 화면, 검토용 SQL·로컬 시험이 있다. 운영 DB 적용·실계정 종단 성공은 미확인이다 |
| 로컬 일부 | 합성 자료의 메모리/브라우저 저장 흐름이 있다. 서버 RLS·실제 파일·실자료 저장이 완료된 것은 아니다 |
| 설계 | 이번 문서에 표·명령·검증 계약이 있다. 신축의 서버/화면 구현과 적용은 남아 있다 |
| 사용자 보류 | 시간표 확정·구현을 이번 작업에서 진행하지 않는다. 요구 자체를 삭제한 것은 아니다 |
| E 후속 | 순수 개인 공간 또는 추가 자동 연계 등 별도 자격·정책·비용·외부 계약 후 구현한다 |

현재 `apps/workhub/src/modules.ts`에서 연결 모드는 오늘·일정·내 업무, 개발 미리보기는 여기에 수합·학생을 추가한다. 모든 신축 모듈 선언은 `visibility: 'superadmin'`, `productionEnabled: false`이며, 실제 진입은 기존 main의 모듈 레지스트리와 서버 승인이 별도로 통제한다. 합성 계정 선택을 실제 가입·로그인으로 보지 않는다.

## 2. M00~M15 모듈 대응

| 모듈과 주요 요구 | 이번 물리 표·원본 | 상세 문서 | DB 단계·배치 | 현재 상태와 남은 연결 |
|---|---|---|---|---|
| **M00 계정·학교·소속·공개 제어** | 기존 `auth.users`, `public.users`; `settings`, `schools`, `memberships`, `membership_requests`, `school_roles`, `role_permissions`, `role_grants`, `permission_catalog`, `platform_grants`, `school_features` | 01 §§2~6; 05 §§2~3 | R0/B00~02, 공개 전 B11 | **기존 유지+연결 코드.** 기존 세션/프로필을 읽고 학교 context·연결 진단을 제공한다. 실제 가입 신청/승인·학교별 역할·기능 공개 관리의 신축 서버 전환은 설계 단계다 |
| **M01 프로필·업무분장·업무 페이지·최소 인계** | `departments`, `grade_levels`, `member_departments`, `member_grades`, `profile_claims`; `duties`, `duty_assignments`, `duty_items`, `duty_*_links`; 승인 교과/수업 관계는 `teacher_course_assignments` | 01 §5; 02 §4; 03 §3; 04 §4 | 관계 선행부 R0/B01·04, 업무 R1/B04·06 | **설계.** 현재 fixture의 부서·학년·교과 배열은 개발 계약이며 공식 배정 관리가 아니다. 빠른 프로필 신고는 승인 관계와 분리하고, 업무 페이지는 명시 링크로 조합한다 |
| **M02 학교 일정·공식 학사일정·시트 전환** | 기존 `calendar_events`, `calendar_receipts`, `calendar_audit`; 확장 `calendar_event_details`, `calendar_event_versions`, `calendar_official_actions`, `audience_*`; `calendar_sources`, `calendar_source_records`, `calendar_source_snapshots`, `calendar_import_runs`, `calendar_import_rows`, `calendar_cutovers` | 01 §6.3; 02 §§5~6 | 기본 R0/B02; 공식·시트 R1/B04 | **연결 코드+로컬 일부.** 일정 등록/수정·관련 대상·목록/주/월·충돌 재시도는 있다. 공식 확정판·시트 3방향 대조·기준 전환·서버 취소/개정 이력은 후속 구현이다 |
| **M03 오늘·개인 할 일·협조 요청** | 기존 `personal_tasks`, `task_receipts`, `task_audit`; `cooperation_requests`, `cooperation_responses`, `task_sources`, `duty_items`; 홈은 일정/본인 task/수합 unit 원본의 권한 있는 조회 조합 | 02 §7·§14; 05 §3 | 개인 업무 R0/B02; 협조 R1/B04; 수합 홈 B05 | **연결 코드+로컬 일부.** 연결 홈은 일정·개인 업무, 미리보기 홈은 수합 의무까지 표시한다. 협조 요청·공식 업무 연결은 설계다. 별도 홈 복제 원장이나 수동 “수합 완료” task를 만들지 않는다 |
| **M04 일반 정보·문서 수합** | `collections`, `collection_versions`, `collection_fields`, `collection_field_options`, `collection_unit_specs`, `collection_spec_members`, `collection_units`, `collection_unit_members`, `collection_unit_delegates`, `collection_drafts`, `collection_draft_answers`, `collection_draft_choices`, `collection_submissions`, `collection_submission_answers`, `collection_submission_choices`, `collection_reviews`, `collection_correction_requests`, `collection_correction_fulfillments`, `collection_correction_windows`, `collection_withdrawals`, `collection_exemptions`, `collection_external_actions`, `collection_exports`, `collection_export_items`, typed 첨부 | 02 §§8~9·11·13~15 | R1/B03·05·06 | **로컬 일부.** 글/숫자·개인/공동 단위·비공개 초안·책임자 제출·검토 유무·보완/정정/철회·완료본 집계가 합성 store에 있다. 일반 다문항·실제 파일·면제/대리·DB/RLS·ZIP·운영 인계는 미연결이다 |
| **M05 전달사항·알림·문의** | `notices`, `notice_versions`, `notice_recipients`, `notice_acknowledgements`, `notifications`, `notification_preferences`, `outbox`, `service_feedback`; 지원 세션은 01의 `support_sessions` | 02 §10; 04 §§4~5; 01 §7 | R1/B03·06, 전환 B11 | **설계.** 화면의 저장 성공 안내·에러 안내를 영속 알림함 구현으로 계산하지 않는다. 읽음·명시 확인·업무 완료를 별도로 기록한다 |
| **M06 학교 지식·규정·담당자 안내** | `knowledge_sources`, `knowledge_revisions`, `knowledge_chunks`, `knowledge_conflicts`; 담당 안내는 승인 `duties`, `duty_assignments`; `files`, `jobs`; 승인 시에만 `embedding_profiles`, `knowledge_embeddings` | 04 §2; 02 §§4·11 | R3/B09, 담당 원본 B04 | **설계.** 기존 학교 규정 JSON·문서 자산의 존재는 학교별 지식 등록/게시/시행판/검색 완료가 아니다. 게시·효력·색인을 분리하고 검색 결과도 원본 권한을 재검사한다 |
| **M07 상주 AI·개인 비서·기억** | `ai_threads`, `ai_messages`, `ai_runs`, `ai_run_sources`, `ai_tool_proposals`, `ai_tool_executions`, `ai_memories`, `ai_memory_sources`, `ai_usage`; `jobs`, `command_receipts`, `audit` | 04 §§3~4 | R3/B10, 선행 B03·09 | **기존 기능 별도+설계.** 기존 doc-ai 채팅은 보호하며 신축 일반 비서·확인된 도구 쓰기·학교별 기억은 미구현이다. 학교 안 개인 대화와 E 순수 개인 공간을 혼합하지 않는다 |
| **M08 문서 작성·문서팩·파일함** | `files`, `file_upload_intents`, `documents`, `document_versions`, `document_version_files`, `document_packs`, `document_pack_versions`, `document_pack_assets`, `document_validation_runs`, `document_version_sources`, `document_jobs`; `collection_submission_files`로 수합 연결 | 02 §§11~13; 04 §§2~4 | 파일 최소 R1/B03; 기본 파일함 B04; 수합 파일 B05; 팩/생성 R3/B09·10 | **기존 유지+설계.** 검증된 HWPX 엔진·양식·manifest와 기존 평가계획서 흐름은 유지한다. 새 학교/소속 아래 파일 실물·팩판·생성판·최종 재검사→일반 수합 연결은 별도 구현/검증 대상이다 |
| **M09 시간표 조회·가져오기·기본 편성** | 이번 설계는 `terms`, `courses`, `teacher_course_assignments`, `course_memberships` 접점만 보존. `timetable_*`, solver 후보/배포 표는 이번 확정 범위 밖 | 03 §§1·3; README §8; 05 §4 | **사용자 보류** | 기존 시간표/솔버 코드가 있더라도 이번 DB 구현 완료로 산정하지 않는다. 조회·가져오기·기본 편성·검증·배포 모두 재개 시 별도 설계/시험한다 |
| **M10 시간표 교체·대강·보강·실시** | 위 공통 수업·소속 ID만 연결 접점. 교체안·동의·확정·실시·점유 원장 표는 이번 범위 밖 | 03 §1; README §8; 05 §4 | **사용자 보류** | AI 교체 처리·대강/보강·실시 누계·영향 원복을 현재 제공한다고 표시하지 않는다. 시간표 보류가 학생 명부·관찰 구현을 막지는 않는다 |
| **M11 학생 명부·내 수업·관찰·상담** | `students`, `student_profile_revisions`, `student_enrollments`, `academic_classes`, `courses`, `course_class_links`, `teacher_course_assignments`, `course_memberships`, `student_duty_assignments`; `observations`, `observation_revisions`, `observation_evidence`, `counseling_records`, `counseling_revisions`, `student_record_files`, `student_lifecycle_requests` | 03 §§3~4·8~13 | R2/B07, 기준표 일부 B01·04 | **로컬 일부.** 합성 명부·담당/기간·본인 관찰·정정/철회·근거 출력은 있다. 실제 명부 가져오기·상담·학교 DB/RLS·보존/과거 정정 접근은 서버 구현 대상이다 |
| **M12 평가·생기부 초안·근거 검토** | `assessment_rubrics`, `assessment_rubric_revisions`, `assessment_criteria`, `assessments`, `assessment_revisions`, `assessment_scores`, `assessment_evidence`; `record_drafts`, `record_draft_revisions`, `record_sentences`, `record_sentence_evidence`; `student_record_files`의 export 증거, 공통 `ai_runs`, `files`, `jobs` | 03 §§5~6·10; 04 §3 | R3/B10, 근거 선행 B07·08 | **설계.** 로컬 관찰의 텍스트 근거 출력은 평가/생기부 생성·규칙 검사·공식 기록 완료와 다르다. 본인 확정 근거·문장별 판/해시·현재 근거 재검사가 필수다 |
| **M13 수업 사이트 연계—디지털윤리** | `external_connections`, `activity_instances`, `activity_imports`, `activity_items`, `activity_item_revisions`, `activity_mappings`, `activity_ingest_receipts`, `activity_tombstones`; 채택은 `observation_evidence`, `assessment_evidence`와 연결판; 파일/삭제 원장은 공통 표 | 03 §7·§§10~13; 04 §§4~5 | 수동 CSV R2/B08; 자동 사건 수신 E 후속 | **로컬 일부.** 가상 활동 수신·학생 확인 연결·관찰 채택·원문 변경 재검토가 있다. 두 실제 CSV 파서·실물 보관·외부 연결 자격·자동 수신·물리 파기는 아직 서버 연결되지 않았다 |
| **M14 학년도·학기 전환과 업무 연속성** | `academic_years`, `terms`, 승인 기간 관계; `handovers`, `handover_items`, 허용된 duty/unit/reviewer/cooperation 참조; 과거 본인 정정은 `student_lifecycle_requests`와 원본 개정 | 03 §§3·10.2; 02 §4; 04 §4 | 최소 기준 R0~R1/B01·04·06; 학생 기간 R2/B07 | **설계.** fixture 기준일·학적 기간은 학년도 생성/전환·후임 수락·효력일 인계의 운영 완료가 아니다. 의무 ID/완료본을 유지하고 개인 task·초안·관찰·문서 소유권은 이전하지 않는다. 고급 복사 마법사는 후속이다 |
| **M15 학교 운영·지원·서비스 관리** | `school_features`, `school_policy_versions`, 역할/승인 표, `support_sessions`, `service_feedback`, `audit`, `jobs`, `job_attempts`, `outbox`, `retention_rules`, `deletion_requests`, `deletion_items`, `restoration_ledgers`, `migration_runs` | 01 §§5~10; 04 §§4~5; 05 전반 | R0~R3 각 배치, 정식 전환 B11 | **연결 진단 일부+설계.** 안전한 읽기 진단은 있으나 전학교 운영·지원 세션·복구/파기 관리가 완료된 것은 아니다. 관리자에게 개인 원문·건수를 자동 공개하지 않는다 |

## 3. API-01~API-24 대응

상위 기획서의 `/path`는 **논리 서버 계약**이다. 현재는 Supabase RPC 이름이 실제 호출 계약인 영역이 있으므로 새 REST 경로를 전부 만든 것으로 읽지 않는다. 02 §14의 신규 RPC 이름도 확정 SQL과 함께 검증할 제안이다.

| API | 실제로 연결해야 하는 데이터/행동 | 문서·배치 | 현재 구현과 서버 연결 상태 | 반드시 남길 완료 증거 |
|---|---|---|---|---|
| **API-01** /me·학교 검색·소속 신청 | 기존 users와 `membership_requests`; 최소 학교 조회 `workhub_joinable_schools`, 본인 신청 create/get | 01 §4.2; B01 | 기존 세션/프로필 및 `workhub_context` 연결 코드만 있다. 가입 학교 검색·신청은 설계 | 미승인 계정은 본인 신청만, 다른 교사/업무/이메일 반환 0 |
| **API-02** 소속·역할·공개 관리 | `memberships`, `role_grants`, `school_features`, 정책판/감사 | 01 §§4~6; B01·11 | 현재 승인 superadmin 게이트와 소속 읽기 존재. 학교별 승인·역할 CRUD/공개 확대는 미연결 | 자기 승인·전역 승격·다른 학교 변경 거부; 서버/메뉴 공개 일치 |
| **API-03** 공식 배정·신고·업무 | `profile_claims`, `member_*`, `duty_assignments`, 승인 수업/담임 관계 | 01 §5·02 §4·03 §3; B04·07 | fixture 관계는 로컬 계약. 서버 배정 관리 명령은 설계 | 본인 신고로 열람권한 상승 없음; 날짜·소속·대상 FK 검증 |
| **API-04** 인계 미리보기·수락·적용 | `handovers`, `handover_items`, 기대판·효력일·기존 unit/공식 업무 책임 | 02 §4·04 §4·03 §10.2; B06 | 설계. 교사 담당 변경과 업무 인계의 지원 범위를 구분 | 인계/전출 경합에서 전체 또는 0 적용, 의무 수·접수판 불변 |
| **API-05** 일정·개정 | 기존 `workhub_calendar_list`, `workhub_calendar_get`, `workhub_calendar_save`, 후속 query/transition과 일정 불변판 | 02 §§5~6·14; B02·04 | **연결 코드.** 실제 RPC 어댑터·화면·SQL 제안이 있다. 공식판/취소/개정 확장은 설계 | 실제 회원으로 왕복·권한 회수·동시 version 충돌, 공식 save 우회 거부 |
| **API-06** 시트 대조·적용·기준 전환 | `calendar_sources`, `calendar_source_records`, `calendar_source_snapshots`, `calendar_import_runs`, `calendar_import_rows`, `calendar_cutovers` | 02 §6; B04, 파일 필요 시 B03 | 설계 | 안정 row key·기준 원본/대상판·현재 양쪽 대조·전환 후 구시트 덮어쓰기 차단 |
| **API-07** 홈·개인 업무·협조 | `workhub_task_list`, `workhub_task_get`, `workhub_task_mutate`, 권한별 홈 조합, `cooperation_requests`, `cooperation_responses`, `task_sources` | 02 §§7·14; B02·04·05 | 개인 업무 RPC/홈 연결 코드, 합성 수합 요약 존재. 협조 서버 명령은 설계 | 응답 유실 같은 키/본문, 다른 소유자 차단, 개인 체크가 원본 의무를 완료하지 않음 |
| **API-08** 수합 요청·게시·면제 | 요청/문항판→고정 unit/member snapshot→의무 상태 | 02 §8·§9.3; B05 | 글/숫자·공동 단위 게시의 로컬 일부. 서버·일반 문항·면제는 미연결 | 동시 게시 의무 중복 0; 면제 분모 제외와 복원 이력 |
| **API-09** 초안·제출·철회 | unit/schema에 고정한 draft, 불변 submissions, typed 파일, current/effective | 02 §§9·11; B05 | 로컬 비공개 초안·책임자 제출·철회 존재. 서버/실물 첨부는 미연결 | 다른 단위 draft 혼합 거부, 같은 키 접수 1회, 모드별 철회·권한 검사 |
| **API-10** 검토·보완·정정·내보내기 | `collection_reviews`, `collection_correction_requests`, `collection_correction_fulfillments`, `collection_correction_windows`, `collection_exports`, `collection_export_items` | 02 §§9·13; B05·06 | 로컬 검토/보완/정정·완료본 집계 일부. DB·ZIP·파일 재검사는 미연결 | v1 완료+v2 대기/철회/보완의 3축 상태·합계, 고정판 ZIP 및 부분 실패 |
| **API-11** 공지·알림·문의·지원 | `notices`, `notifications`, `service_feedback`, `support_sessions`, `outbox` | 02 §10·01 §7·04 §§4~5; B06·11 | 연결 준비 진단만 일부. 영속 알림/지원 세션 서버는 설계 | 읽음≠명시 확인≠업무 완료, 중복 알림 0, 지원 만료·원본 회수 즉시 검사 |
| **API-12** 지식 등록·판·게시 | `knowledge_sources`, `knowledge_revisions`, `files`, `jobs`, 게시자/시행일 | 04 §2·02 §11; B09 | 설계. 기존 자산을 신축 지식판으로 자동 승인하지 않음 | 추출/검토/게시/시행/철회 상태 분리; common 무단 승격 거부 |
| **API-13** 지식 검색 | `knowledge_chunks`, `knowledge_conflicts`, 권한·기준일 필터와 원본 재검사 | 04 §2; B09 | 설계. embedding은 선택·별도 승인 | 미래/철회판 차단, 색인 지연 구분, 구간/판/출처 재현 |
| **API-14** 비서 실행·도구 확인 | `ai_runs`, `ai_run_sources`, `ai_tool_proposals`, `ai_tool_executions`, domain command/receipt | 04 §§3~4; B10 | 신축 일반 비서/도구 미연결. 기존 doc-ai는 별도 기존 기능 | 만료·대상판·권한·영향 명단 변경 시 재확인; 동시 실행 1회 |
| **API-15** 기억 제안·확정·중단 | `ai_memories`, `ai_memory_sources` | 04 §3; B10 | 설계; E 개인 기억과 다른 학교 범위 | 원자료 철회·소속 종료 후 재사용 차단, 본인 확인 없는 장기 기억 없음 |
| **API-16** 문서 작업·검사·출력 | `document_packs`, `document_pack_versions`, `document_pack_assets`, `document_jobs`, `document_versions`, `document_validation_runs`, `document_version_sources`, files/jobs | 02 §12·04 §4; B09·10 | 기존 문서 엔진/흐름 유지, 신축 학교별 어댑터·팩/작업 서버는 설계 | 팩판/학교 일치, 새 최종 파일 재검사, 미지원/미검사와 pass 구분 |
| **API-17** 파일 초기화·완료·다운로드·파기 요청 | `files`, `file_upload_intents`와 typed 첨부, `deletion_requests`, `deletion_items`, `restoration_ledgers` | 02 §11·04 §5; B03·05·11 | 기존 제출 Storage와 다르다. 신축 파일 서버는 설계 | 실물 크기/형식/해시·현재 원본권한, DB 실패 시 허위 접수 없음, 복원 후 삭제 재적용 |
| **API-18** 시간표 조회·가져오기 | common `terms`, `courses`, `memberships` ID 접점만 보존 | README §8·03 §1; **보류** | **사용자 보류.** 이번 SQL/신축 연결 범위 밖 | 재개 시 매핑·기간/일과·미확정 행·권한 시험을 별도 배치에 등록 |
| **API-19** 시간표 편성·후보 검사·배포 | 후보/제약판/기본표는 이번 물리 확정 범위 밖 | README §8·05 §4; **보류** | **사용자 보류.** 솔버 코드 존재와 학교 DB 배포 완료를 구분 | 재개 시 입력판·필수제약·수동 변경 재검사·배포 경합 증거 |
| **API-20** 교체·동의·적용·원복·실시 | 교체/실시/공간 점유 원장과 승인 계약은 후속 | README §8·05 §4; **보류** | **사용자 보류.** 범용 업무 수합으로 교체 승인을 대체하지 않음 | 재개 시 관련자 동의·실시간 자원 잠금·계획/실시·영향 원복 검증 |
| **API-21** 명부 가져오기·수강생 | `students`, `student_profile_revisions`, `student_enrollments`, `courses`, `course_memberships`, `teacher_course_assignments` | 03 §§3·9; B07 | 합성 명부 조회 일부. 실제 import/승인 매핑/DB 미연결 | 동명이인/번호 재사용/전입·전출 후보 확인, 파일 누락으로 삭제 안 함 |
| **API-22** 관찰·개정·상담 | `observations`, `observation_revisions`, `counseling_records`, `counseling_revisions`, 담당/과거 정정 정책 | 03 §§4·8~10; B07 | 본인 관찰·정정/철회 로컬 일부. 상담·서버 저장 미연결 | 본인/현재 학교/당시 담당, 새 개정본, 관리자·지원자 본문/건수 차단 |
| **API-23** 평가 확정·생기부 초안·검토·출력 | `assessment_*`, `record_draft*`, `record_sentences`, `record_sentence_evidence`, `student_record_files` export | 03 §§5~6·10; B10 | 설계. 로컬 관찰 출력은 이 API의 생기부 완료 증거가 아님 | 0점/NULL/결시 분리, 본인 확정 근거, 규칙 미확보 not_checked, 출력 직전 동기 검사 |
| **API-24** 활동·CSV·채택·매핑/원문 정정·삭제 | `activity_instances`, `activity_imports`, `activity_items`, `activity_item_revisions`, `activity_mappings`, `activity_ingest_receipts`, `activity_tombstones`, evidence, lifecycle | 03 §7·§§10~13; B08, 자동 연결 E | 가상 원자료 수신/채택 로컬 일부. 실제 CSV·외부 자격·서버/물리 삭제 미연결 | 활동 범위 중복·수동 논리 ID·매핑판·정정 전파·삭제 후 재수신 차단 |

## 4. 논리명과 이번 물리 제안명의 차이

아래는 이름이 달라 누락처럼 보이거나 새 표를 중복 생성하기 쉬운 부분이다. 논리 요구를 유지하면서 현재 코드와 물리 제약에 맞춘 대응이며, 기존 계정이나 데이터의 자동 이관 허가가 아니다.

| 상위 기획의 논리 이름·개념 | 이번 대응 | 구현 시 주의 |
|---|---|---|
| `accounts(auth_subject, status)` | 기존 `auth.users`와 `public.users`를 유지 | 새 accounts/학교별 회원 복제·OAuth 재생성 없음. auth UUID와 기존 public.users TEXT ID 대응을 보존하고 실제 불일치를 먼저 조사 |
| `schools/memberships` | 기존 `public.workhub_schools/workhub_memberships` 보강 | 기존 DTO/ID와 종료일 포함 `valid_through` 계약 유지. 새 종료 제외 기간과 변환을 명시 |
| `assignments` 한 묶음 | `duty_assignments`, `member_departments`, `member_grades`, `teacher_course_assignments`, `student_duty_assignments` | 학교/대상/기간을 typed FK로 구분. `profile_claims`는 승인 전 신고이며 권한 원장이 아님 |
| DB-C `tasks/task_assignees` | 본인 `personal_tasks`, 공식 `duty_items`, 협조 `cooperation_requests` | 현재 legacy public.tasks는 자동 복사하지 않음. 개인 메모 소유권과 공식 책임 이전을 분리; 별도 task_assignees를 무조건 생성하지 않음 |
| `events/event_revisions/audience_rules` | `calendar_events` + `calendar_event_details`, `calendar_event_versions` + `audience_sets`, `audience_groups`와 종류별 관계표 | 기존 draft JSON이 초기 원본. 정규화 전환은 동등성 대조와 단일 writer; 두 원본 독립 수정 금지 |
| `source_connections/source_records/import_runs` | 일정은 `calendar_sources`, `calendar_source_records`, `calendar_source_snapshots`, `calendar_import_runs`, `calendar_import_rows`, `calendar_cutovers` | 학생 활동 import와 원장 공유하지 않음. row 번호·제목·내용 hash를 안정 원본 ID로 취급하지 않음 |
| `unit_drafts/submission_versions/reviews/export_manifests` | `collection_drafts`, `collection_submissions`, `collection_reviews`, `collection_exports`, `collection_export_items` 및 정형 답변/선택/파일 표 | 새 문항 schema마다 새 draft ID. current/effective/최초 제출·보완 충족 이력을 분리하고 판을 직접 수정하지 않음 |
| `file_objects/file_links` | `files`와 `collection_*_files`, `document_version_files`, `notice_version_files`, `student_record_files` | generic resource_type/resource_id만으로 파일 ACL을 만들지 않음. 도메인 부모·판·현재 권한과 실물검사 필수 |
| `document_revisions` | `document_versions`; 주본문 실물은 정확한 `file_id` | 생성판/최종 업로드판/검사판은 새 ID·hash로 연결. 기존 manifest·템플릿 원본 재작성 없음 |
| `knowledge_documents/chunks/extraction_jobs` | `knowledge_sources`, `knowledge_revisions`, `knowledge_chunks`; 추출은 `jobs`, `job_attempts` | 게시/시행/추출/색인 상태 분리. common은 NULL 학교라는 추정이 아니라 scope_type+생성 scope_key로 명시 |
| `conversations/messages/runs/tool_runs/usage_events` | `ai_threads`, `ai_messages`, `ai_runs`, `ai_tool_executions`, `ai_usage`와 `ai_tool_proposals` | 기존 doc_ai_conversations를 자동 복사/공용화하지 않음. 학교를 바꾸면 새 대화, 오래된 확인과 근거 재검사 |
| `course_groups`를 DB-J 선행으로 요구 | 공통 `courses` + `course_class_links` + `course_memberships` | 시간표 테이블에 의존하지 않고 수업/기록을 진행. 학적 학급과 선택 수강 집단을 동일시하지 않음. 시간표 재개 시 이 ID에 접속 |
| `classroom_imports/source_items/adoptions/source_actions` | `activity_imports`, `activity_items`, `activity_item_revisions`, `activity_mappings`; 채택은 `observation_evidence`, `assessment_evidence`, 철회/삭제는 판·lifecycle·tombstone | 받은함 상태는 원본·매핑·근거 관계로 계산. 독립 adoptions 상태를 추가해 실제 관찰/평가와 이중 원본을 만들지 않음 |
| `record_exports` | `student_record_files`의 export 링크+`files`, 출력판/지문/시각 | 내보냄은 공식 NEIS 입력 완료가 아님. 원자료 정정 후 예전 출력의 효력/후속 정정을 따로 안내 |
| `idempotency_receipts/audit_events/deletion_ledger` | 새 도메인 `command_receipts`, `audit`, `deletion_requests`, `deletion_items`, `restoration_ledgers`; 기존 calendar/task receipt/audit 유지 | opaque 결과 ID·감사 참조는 권한을 부여하지 않음. 같은 변경에 기존/공통 영수증을 중복 발급하지 않음 |
| 작성자 `owner` 하나 | `owner_user_id`는 기존 계정의 지속 신원, `owner_member_id`는 작성 당시 학교 소속 | 저장 시 member.user_id=user 일치를 강제. 같은 user의 새 소속도 과거 접근을 자동 허용하지 않으며 현재 학교/담당/정정 정책을 검사. 학교 안 개인 task는 기존 member 소유 계약 유지 |
| 학교와 무관한 개인 업무 | E의 `account_workspaces`, `account_tasks`, `account_ai_*` 후속 계약 | 현재 school_id를 NULL로 바꾸거나 학교·학생 파일을 복사하지 않음. 학교 승인과 별도의 이용자격·비용·보존 검증 필요 |

## 5. 구축 배치별 완료 체크

아래는 **완료 조건 목록**이다. 이번 설계 작성으로 어떤 항목도 통과 처리하지 않는다. 각 배치에 확정 SQL SHA·환경·실행자·전후 대조·시험 결과·남은 제한을 붙이고, 운영 적용과 격리 환경 시험 결과를 분리한다. 상세 시험은 01의 F, 02의 WD, 03의 ST, 04 §7, 05의 DBV를 따른다.

| 배치·단계 | 완료 체크 항목 | 연결 요구와 시험 축 |
|---|---|---|
| **B00 / R0 조사·보존** | 환경 식별; 실제 schema/RLS/GRANT/trigger/Storage 실측; 회원 ID·승인·프로필 기준선; DB+파일 격리 복구 증거 | M00·M15; DBV01·27·28·31. 개수 일치만으로 전회원 보존 완료 금지 |
| **B01 / R0 기반 최소** | 학교·소속·역할·가입 예외; 플랫폼/학교 권한 분리; 현재 사용자·기간 검사; 필요한 학기/조직 기준만 생성 | API-01~03; DBV02~06. 기존 로그인·회원 상태 불변; common 파일/지식의 DBV33은 해당 R1/R3 배치에서 검사 |
| **B02 / R0 현재 기능** | 기존 일정/task RPC·DTO 동등성; 실제 계정 연결 시험; 수정 충돌·같은 키 재시도·권한 회수; 기간 경계와 누락 필드 검사 | API-05·07; DBV07~10·29·34. 연결 진단 ready만으로 저장 완료 판단 금지 |
| **B03 / R1 공통 파일·실행** | files 실물/typed 권한; scope NULL 우회 차단; 원본+receipt/audit/outbox 원자성; lease 교체·취소·불명확 실패·파기 최소 원장 | API-17 및 전 모듈 공통; WD13~14·18·20, DBV14~15·24·27·30·33 |
| **B04 / R1 공유 업무** | 학년도/학기/교과/학급/수업 기준표 선행→승인 배정·대상 OR/AND/제외→documents/document_versions 최소 파일함·duty_document_links; 공식 일정·안정 ID+3방향 시트 대조/기준 전환·협조 | API-03·05~07·파일함 접점; WD03~05, DBV06~07. 학생 개인정보·명부/수강은 B07이며 B04에서 만들지 않음; B05의 class/course FK를 미리 충족 |
| **B05 / R1 수합** | schema→단위→초안→불변 제출→검토/보완/철회→집계; 파일 검사 선행; 개인/공동 초안 경계; 필수 답변·면제·대리·현재/완료 포인터·내보내기 | API-08~10; WD06~17·19, DBV11~14. 글/숫자 로컬 성공으로 파일/서버까지 완료 처리 금지 |
| **B06 / R1 알림·인계** | 알림 중복/회수·읽음/확인 분리; 지원 범위; 후임 수락/효력일/대상판; 지원된 typed 객체의 책임을 원자 적용 | API-04·11; WD12·16, DBV13·25~26. 개인 기록·문서 소유권 자동 이전 금지 |
| **B07 / R2 학생 기반** | B04 학급/수업 기준에 불변 학생 ID·학적·기간별 수강/담당 추가; 동명이인/학년 전환; 본인 관찰·상담·정정; 현재/과거 접근과 lifecycle | API-21·22; ST01~10·23~24·28, DBV16~18. 소속/담당 없는 전교 명부 노출 금지 |
| **B08 / R2 수업 앱** | 두 CSV 파서·질문판·활동 회차·파일 중복; 교사 확인 매핑/채택; 원문 정정/철회/삭제와 재수입 차단 | API-24; ST13~15·18~19·25~27, DBV19~20. 자동 사건 자격/외부 sender 구현은 E에서 별도 체크 |
| **B09 / R3 지식·문서** | B04의 최소 문서함에 학교/공통 문서팩·생성·검사·정확 근거 확장; 지식 게시/시행/색인; 기존 양식 엔진 회귀 | API-12·13·16; WD15·20, DBV21·33. 미지원 양식/추출 실패/미검사를 성공 표시하지 않음 |
| **B10 / R3 Claude·평가·근거** | 승인 도구/확인/1회 실행; 비용 상태·기억 중단; 교사 확정 평가·문장 근거; 정정과 생성/출력 동시성·규칙 검사 | API-14~16·23; ST11~12·20~22, DBV18~19·22~24. 학생 원자료와 생성문을 사실 원본으로 순환시키지 않음 |
| **B11 / 정식 전환** | 기존 Google 로그인부터 실제 작업 종단; legacy public/API/Storage 우회 회수; 학교별 복구·삭제 재적용; 역할별 사용성·부하·교사 파일럿 | 전 API 중 보류/E 제외한 실제 도입 범위; DBV01~34의 해당 전체. 적용 범위와 미도입 기능을 명시하고 전체 공개 게이트와 별도 대조 |
| **E / 후속** | 순수 개인 이용자격/비용/보존·학교자료 유입 차단; 외부 자동 연결 자격·sender outbox·재전송/역순/동판 충돌 검증 | 04 §6, 03의 S6/ST16~17. 기존 학교 task/수동 CSV 완료로 대체하지 않음 |
| **시간표 / 사용자 보류** | 재개 요청 후 M09·M10/API-18~20의 별도 표·명령·배포/교체/실시·경합 시험을 확정 | 현재 완료 체크 대상에서 보류로 식별. course/member/term 접점의 존재는 시간표 완료 증거가 아님 |

## 6. 현재 상태의 확인 근거

- [신축 앱 README](../../../apps/workhub/README.md): 연결 진입·SQL 제안·합성 자료와 실자료의 경계, 실제 Supabase 미적용 설명.
- [모듈 선언](../../../apps/workhub/src/modules.ts), [연결 화면](../../../apps/workhub/src/app/ConnectedWorkspace.tsx), [개발 미리보기](../../../apps/workhub/src/preview/PreviewApp.tsx): 연결/미리보기별 실제 화면 범위.
- [업무·수합 계약](../04-workflows.md), [학생 계약](../05-students.md), [개인 업무 연결](../09-task-persistence.md): 로컬 구현과 어댑터의 현재 범위.
- [기존 일정 SQL 제안](../../../database/workhub/001-calendar-foundation.proposed.sql), [개인 업무 SQL 제안](../../../database/workhub/004-personal-tasks.proposed.sql): 보존할 RPC/DTO·권한·트랜잭션 계약. 존재하는 파일을 실행 완료 증거로 사용하지 않는다.

추적표의 합계는 **모듈 16개와 API 24개를 대응시켰다**는 뜻이다. 기능 완성도 100%나 DB 적용률을 의미하지 않는다. 적용 뒤에는 해당 배치의 실측 결과를 근거로 상태를 갱신하며, 설계 문서가 있다는 이유로 미구현·보류·미검증 항목을 완료로 바꾸지 않는다.
