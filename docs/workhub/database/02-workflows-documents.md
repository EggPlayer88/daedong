# 업무·일정·수합·문서/파일 물리 DB 설계안

작성 기준: 2026-10-11. **설계 제안이며 실행 SQL·승인·운영 적용 결과가 아니다.** 기존 로그인·회원·인증 트리거·SQL 확정본은 수정하지 않는다. SQL 확정은 Claude Web, 실행은 계란님이라는 저장소 규칙을 따른다. 아래 R0·R1·R2·R3·E는 이번 DB 설계의 생성·검증 순서이며 상위 기획서의 모듈 마일스톤 번호와 자동 동일시하지 않는다. 일부 모듈 완성을 공개 완료로 계산하지 않는다.

## 1. 근거, 범위와 호환 계약

근거는 최종 `GPT작업/업무혁신시스템 기획서.md` C01~C12, M01~M08·M14·M15, 현재 `apps/workhub/src/workflows/types.ts`, `store.ts`, `calendar/contracts.ts`, `tasks/contracts.ts`, [04-workflows.md](../04-workflows.md), [09-task-persistence.md](../09-task-persistence.md), `database/workhub/001-calendar-foundation.proposed.sql`·`004-personal-tasks.proposed.sql`이다. 로컬 수합 구현은 글/숫자·공동 단위·제출/검토/보완/철회를 검증한 기준 사례다. 아래 다문항·파일·면제·대리·인계는 후속 서버 설계이며 현재 구현 완료로 읽지 않는다.

- 기존 `public.workhub_schools`, `workhub_memberships`, `workhub_calendar_events/calendar_receipts/calendar_audit`, `workhub_personal_tasks/task_receipts/task_audit`를 유지한다. 기존 `public.users.id` TEXT와 로그인 신원을 재발급하지 않는다.
- `workhub_context()`, `workhub_calendar_list/get/save` 및 `workhub_task_list/get/mutate`의 **현재 인자·결과 모양은 기존 SQL 파일을 기준으로 보존**한다. 새 필터·취소·공식 일정 명령은 별도 RPC로 추가한다. 기존 함수 내부에 새 정책 검사가 필요하면 신규 승인 마이그레이션에서 전진 변경하며 원본 제안 파일을 덮어쓰지 않는다.
- 현재 `workhub_calendar_events.draft` JSONB가 일정 본문의 기준이다. 새 정규 표를 읽기 원본으로 바꾸기 전까지는 **검증용 투영만 생성**한다. 전환 후에는 승인된 단일 명령이 정규 표·불변 판·호환 JSON을 한 트랜잭션에서 기록한다. 양쪽을 개별 수정하는 동기화 방식은 금지한다.
- 현재 개인 업무는 학교 안 본인 소속의 자료다. 계정 단위 개인 공간은 이 설계의 테이블을 `school_id=NULL`로 재사용하지 않고 별도 후속 계약으로 설계한다.
- M06 지식·M07 AI·작업·outbox·인계 공통 원장·지원/보존 정책은 다른 설계 장이 소유한다. 본 장은 업무 및 파일의 정확한 참조와 적용 계약을 정의한다.

## 2. 표기·공통 물리 규칙

이하 표 이름에는 모두 `public.workhub_`가 붙는다. 이름을 줄여 표기할 뿐 다른 schema에 만들지 않는다.

| 표기 | 정확한 의미 |
|---|---|
| `I` | `id text PRIMARY KEY DEFAULT gen_random_uuid()::text` |
| `S` | `school_id text NOT NULL REFERENCES public.workhub_schools(id)`, `UNIQUE(school_id,id)`; I를 가진 학교 표에 적용 |
| `K` | `scope_type text NOT NULL CHECK(scope_type IN ('school','common'))`, `school_id text NULL REFERENCES workhub_schools(id)`, `scope_key text GENERATED ALWAYS AS (CASE WHEN scope_type='common' THEN 'common' ELSE 'school/'\|\|school_id END) STORED`; `CHECK((scope_type='school' AND school_id IS NOT NULL) OR (scope_type='common' AND school_id IS NULL))`, `UNIQUE(scope_key,id)`; 공통/학교 겸용 표에만 적용 |
| `V` | `version integer NOT NULL DEFAULT 1 CHECK(version>0)`; 낙관적 동시 수정 판 |
| `T` | `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz NOT NULL DEFAULT now()`; 서버만 갱신 |
| `?` | nullable. 이 표시가 없는 열은 NOT NULL. `=x`는 DB DEFAULT x. default가 없으면 RPC에서 필수 공급 |
| `member→M` | `(school_id,member_id)` 등 명시된 열과 `workhub_memberships(school_id,id)` 사이의 복합 FK |
| `→X` | 학교 표는 `(school_id,해당_id) REFERENCES workhub_X(school_id,id)`; 아래 별도 명시한 다열 FK는 그 계약 우선 |
| `UQ(...)`/`IX(...)` | 유일 제약/비유일 B-tree 인덱스. `WHERE ...`가 있으면 부분 인덱스 |
| `IMM` | 본문·판·지문은 INSERT 뒤 수정 금지. 접근 차단/파기 메타는 별도 표/상태로 처리 |

1. FK 삭제 기본은 `ON DELETE RESTRICT`; 소속·제출판·파일을 연쇄 삭제하지 않는다. 임시 폼 하위행을 정리할 때도 명령 내부에서 허용 상태를 확인한다. 실제 보존 종료 파기는 삭제 원장과 검증 절차를 따른다.
2. 모든 숫자 코드·상태는 `text CHECK(value IN (...))`로 명시한다. 타입 enum 변경을 위한 별도 배포를 강요하지 않되 자유 문자열은 허용하지 않는다. 금액/응답의 숫자는 `numeric`이며 IEEE NaN/Infinity를 허용하지 않는다.
3. 새 기간은 `[시작,종료)`로 저장한다. 기존 membership `valid_through`는 **종료일 포함 계약을 유지**한다. 새 날짜 배정의 `valid_until`과 대조할 때 기존 종료일 다음 날로 환산하며 기존 열의 의미를 바꾸지 않는다. 종일 일정의 `end_date`는 현재 DTO와 같이 포함이다. 마감 날짜만 입력하면 학교 시간대의 다음 날 00:00을 `due_at`으로 저장하고 `received_at >= due_at`을 지연으로 판정한다. 시각 마감은 입력 시각 초과를 지연으로 처리할 수 있도록 `due_kind`와 비교 규칙을 함께 저장한다.
4. 모든 변경은 현재 계정·소속·행동권한→멱등 키→정해진 행 잠금→기대판→관계/파일 검사→업무 변경/접수증/감사/outbox를 같은 DB 트랜잭션으로 확정한다. 외부 전송 실패는 이미 확정한 업무를 취소하지 않는다.
5. 공통 감사에는 ID·버전·동작·시각·결과 코드만 기록한다. 개인 메모, 미제출 답변, 문서 본문, 학생 내용, 키를 복제하지 않는다. 본문이 필요한 업무 개정 이력은 해당 업무와 같은 접근 정책을 적용한다.
6. **행 간 조건은 CHECK로 표현했다고 주장하지 않는다.** 같은 단위의 포인터, 문항 유형별 답변, 작성자와 소속 신원 일치, 실물 상태 등은 복합 FK·부분 UQ로 가능한 만큼 강제하고 나머지는 제약 트리거+쓰기 RPC로 검사한다. 브라우저 직접 쓰기는 열지 않는다.
7. `K` 표의 부모 참조는 `(scope_key,parent_id)` 복합 FK다. NULL 학교 값으로 FK 검사를 건너뛰지 않는다. 학교 전용 표가 공통/학교 자료를 선택 참조하면 `source_scope_key text?`와 ID를 함께 두고 `MATCH FULL` FK 및 두 열 동시 NULL/존재를 강제한다. 허용 scope는 `common` 또는 `'school/'||school_id`뿐이다. 학교 전용 표가 학교 작업·영수증·outbox를 참조할 때는 `school_scope_key text GENERATED ALWAYS AS ('school/'||school_id) STORED`를 추가하여 해당 공통 표의 `(scope_key,id)`를 참조한다. ID의 존재와 현재 읽기권한은 별도 검사다.
8. 표에 적은 문자 길이는 PostgreSQL `char_length`와 같은 코드포인트 기준이며 저장 전 JS/서버의 동일 trim 규칙을 적용한다. raw 길이 검사 뒤 정규화한다. 모든 지문 열 `*_sha256`/`payload_hash`는 64자리 소문자 hex, 모든 `position`은 0 이상이다. 모든 FK의 자식 열에는 조회/삭제검사에 필요한 B-tree 인덱스를 만들되 같은 선행 열의 PK/UQ/IX가 있으면 중복 생성하지 않는다. 이 규칙도 단계별 해당 표가 생길 때 적용한다.

## 3. 단계별 생성 순서

| 내부 단계 | 이번 단계에서 실제 생성할 묶음 | 아직 생성하지 않을 것 |
|---|---|---|
| R0 | 기존 001/004 준비 상태와 권한 시험, 적용 여부 점검. 신원·학교 최소 기반·기존 일정과 개인 업무 | 전체 도메인 빈 테이블 선생성 |
| R1-A | 공식 업무분장·업무 항목·협조 요청, 필요하면 대상 조건 표, 기존 일정/할 일 조회 호환 | 문항 옵션·제출 파일·ZIP |
| R1-B | 일정 불변판·공식 상태·취소, 시트 대조/기준 전환, 최소 인계 어댑터, 앱 알림 | AI 문서 생성 테이블 |
| R1-C | 수합 요청/문항 판·단위 snapshot·글/숫자 답변·접수/검토/보완/면제·정정, 게시 알림 | 파일 답변·문서팩 실행 |
| R1-D | 나머지 필드 유형·선택지·수합 첨부·내보내기, 문서함. 기본 files/업로드 계약은 이 단계의 파일수합 사용보다 먼저 생성·검증 | 미검증 양식팩 생성·AI 원문 추출 |
| R2 | 학생/외부 활동의 typed 파일·근거 참조가 해당 모듈과 함께 추가 | 학생 민감 자료를 공용 문서로 복제 |
| R3 | 문서팩/문서 불변판·검사/근거·파일 생성 작업과 지식/AI 접점 | 미지원 양식의 검증 완료 표시 |
| E | 순수 개인 공간은 별도 권한·보존 계약이 확정된 뒤 별도 생성 | 학교 표의 school_id를 NULL로 바꿔 개인 공간처럼 사용 |

각 표의 도입 단계를 아래에 명시한다. R1-C를 시작한다고 R1-D·R3의 FK·열을 먼저 생성할 필요가 없다. 참조 대상이 아직 없으면 해당 관계 표도 생성하지 않는다. 최종 RC 공개 게이트와 사용자 승인 정책은 별도다.

## 4. 업무분장·공식 배정·인계 접점 — R1-A

기준표 `departments`, `grade_levels`는 기반 장, `academic_years`, `terms`, `subjects`, `academic_classes`, `courses`, `teacher_course_assignments`는 학생/수업 장의 정의를 사용한다. **`course_groups`라는 중복 표를 만들지 않는다.** 본인 신고는 기반 장의 profile claim이고 아래 배정에는 승인된 값만 들어온다.

| 표 | 열 | FK·유일·체크·인덱스 |
|---|---|---|
| `duties` | I,S,V,T; `code text`, `name text`, `description text=''`, `department_id text?`, `active boolean=true` | department→departments; UQ(school_id,code); name 1~120, description≤3000; IX(school_id,department_id,active,id) |
| `duty_assignments` | I,S,V,T; `duty_id text`, `member_id text`, `academic_year_id text`, `term_id text?`, `assignment_role text`, `valid_from date`, `valid_until date`, `approved_by_member_id text`, `approved_at timestamptz`, `state text='active'` | duty→duties; member/approved_by→M; year/term→각 기준표; role lead/support; state active/revoked; from<until; 같은 duty+member+role의 active 기간 중첩 금지(기간 EXCLUDE 또는 동일키 잠금+trigger); IX(school_id,member_id,valid_from,valid_until), IX(school_id,duty_id,state) |
| `duty_items` | I,S,V,T; `duty_id text`, `assigned_member_id text`, `created_by_member_id text`, `title text`, `instructions text=''`, `due_at timestamptz?`, `state text='todo'`, `completed_at timestamptz?` | duty→duties; member→M; title1~120; state todo/doing/waiting/done/cancelled; done와completed_at 동치; IX(school_id,assigned_member_id,state,due_at,id) |
| `duty_calendar_links` | `school_id text`, `duty_id text`, `event_id text` | PK(school_id,duty_id,event_id), 양쪽 동일학교 FK; IX(school_id,event_id) |
| `duty_collection_links` | `school_id text`, `duty_id text`, `collection_id text` | R1-C 생성. PK(school_id,duty_id,collection_id), 양쪽 FK; 역방향 IX |
| `duty_document_links` | `school_id text`, `duty_id text`, `document_id text` | R1-D 생성. PK(school_id,duty_id,document_id), 양쪽 FK; 역방향 IX |

`duty_items`는 배정자·담당자가 함께 상태를 확인하는 **공식 업무 항목**이다. 기존 `personal_tasks`와 다르며 개인 메모를 담지 않는다. 업무 페이지는 위 명시 링크를 기준으로 연결한다. 제목 키워드가 같은 것은 연결 후보이지 확정 링크가 아니다. 업무 항목 완료는 허용 담당자 행동이며 수합 의무를 대신 완료하지 않는다.

인계 원장은 공통 `handovers/handover_items`가 소유한다. 본 장의 어댑터는 아래를 하나의 적용 트랜잭션에 포함한다.

- 초기 인계 종류는 공통 원장의 `duty_assignment`, `duty_item`, `collection_unit`, `reviewer`, `cooperation_request`만 사용한다. 각 대상의 기대판·필드 변화·기간·허용 행동을 snapshot 지문으로 고정한다. `duty_item`은 명시적인 `(school_id,duty_item_id)→workhub_duty_items(school_id,id)`로 연결하고 `assigned_member_id`만 승인 범위 안에서 바꾼다. 개인 업무·미제출 개인 준비 초안·관찰·대화는 제외 목록으로 명시한다.
- 후임의 수락과 유효 소속, 적용일, 현재 객체판을 재검사한다. 전임 승인 배정은 적용일에 끝내고 후임 배정은 그날 시작한다. 학교 내 과거 날짜 단위 계약은 학교 시간대 기준 날짜로 환산한다.
- 단위 ID·제출판·완료본 포인터는 그대로 유지하고 책임자/명시 공동 구성원 관계만 개정한다. 공동 초안 인계 여부는 목록에 명시하여 후임의 공동 구성원 편입이 승인된 경우에만 읽을 수 있게 한다. 전임은 유효기간 종료 뒤 기존 링크로 초안을 읽지 못한다.
- 같은 인계 재실행은 한 번만 적용된다. 단 하나의 수합 판이 변경돼도 전체 적용을 중단하고 `stale`로 재미리보기한다. 모듈별 순차 API 호출로 반쪽 인계를 만들지 않는다.
- 소속 종료가 먼저면 접근은 먼저 종료한다. 공백 의무는 `needs_owner`로 공통 원장에 연결하고 관리자에게 재배정하게 한다. 인계 미수락 때문에 소속 유효기간을 늘리지 않는다.

공개 문서의 업무관리 관계는 초기 인계에서 제외한다. `duty_document_links`는 업무와 문서의 연결이며 문서 관리권한을 이전하는 표가 아니다. 문서 소유자나 개인 초안의 작성자를 인계 편의를 위해 바꾸지 않는다. 문서 관리 책임의 typed 관계·행동권한·수락 계약은 후속 명세와 검증을 만든 뒤 지원 종류에 추가한다. 협조 요청도 원장의 명시 대상 필드만 옮기며 연결된 개인 task/notes 소유자는 바꾸지 않는다.

## 5. 열람과 추천의 대상 조건 — 필요 시 R1-A

기존 JSON 계약은 `all/groups/includeMemberIds/excludeMemberIds`다. 새 조건표가 생기기 전에는 이 구조를 계속 사용한다. 전환 때 동일 JSON을 아래 표로 무손실 변환하고 역변환 동등성을 시험한다. **첫 전환 범위는 기존 지원 부서·학년·교과뿐**이며 학급·업무 조건은 해당 승인 배정과 테스트가 준비된 명령 버전에서만 확장한다.

| 표 | 열 | 제약 |
|---|---|---|
| `audience_sets` | I,S; `all_members boolean=false`, `created_by_member_id text`, `created_at timestamptz=now()` | 작성자→M; 저장 후 IMM. 사용 중 조건을 수정하지 않고 새 set 생성 |
| `audience_groups` | I,S; `audience_set_id text`, `position integer` | set→audience_sets; position≥0; UQ(school_id,audience_set_id,position) |
| `audience_group_departments` | `school_id text`,`group_id text`,`department_id text` | PK(학교,group,department), 각각 동일학교 FK |
| `audience_group_grades` | `school_id text`,`group_id text`,`grade_level_id text` | PK(학교,group,grade), 각각 동일학교 FK |
| `audience_group_subjects` | `school_id text`,`group_id text`,`subject_id text` | PK(학교,group,subject), 각각 동일학교 FK |
| `audience_members` | `school_id text`,`audience_set_id text`,`member_id text`,`mode text` | PK(학교,set,member,mode); mode include/exclude; set→audience_sets, member→M; 같은 사람이 양쪽에 있어도 exclude 우선 |

group 자식 전체가 0개인 빈 그룹은 무효다. group 간 OR, group 내 다른 종류 AND, 같은 종류 OR다. 최종 대상은 현재 학교의 유효 승인 배정과 소속을 사용한다. 공개 전체 일정의 관련 대상이 연구부뿐이어도 전체 교사는 읽고 연구부에만 추천한다. private의 대상이 all이어도 타인은 읽지 못한다.

추천 기준은 미래 일정이면 시작일, 진행 중이면 현재일(`max(today,start_date)`), 과거 조회에는 명시한 조회 기준일이다. 읽기는 **요청 시점** 소속·행동권한을 별도로 검사한다. 수합 게시 대상은 계산 결과를 단위 snapshot으로 고정하고 동적 추천표가 바뀌어도 기존 의무를 재생성하지 않는다.

전환은 학교별 backfill→JSON/정규 조건 동등성 보고→쓰기 일시 직렬화→최종 대조→정규 조건을 기준으로 RPC 호환 출력 순서다. 이전 API가 JSON만 직접 갱신할 수 있으면 전환을 허용하지 않는다. 롤백은 호환 JSON에 같은 최신판이 반영된 것이 확인된 경우에만 읽기 원본 선택을 되돌린다.

## 6. 일정의 공식 상태·개정본·시트 전환 — R1-B

기존 이벤트의 id/school/author/version은 유지한다. 추가 `UNIQUE(school_id,id)`를 전진 마이그레이션으로 보장한 뒤 아래 복합 참조를 연다.

| 표 | 열 | 제약·인덱스 |
|---|---|---|
| `calendar_event_details` | `school_id text`,`event_id text` PK; `kind text='shared'`,`state text='active'`,`official_state text='not_applicable'`,`current_version_id text?`,`official_effective_version_id text?`,`deleted_at timestamptz?` | event→calendar_events; kind shared/official; state draft/active/cancelled; official_state not_applicable/proposed/confirmed/withdrawn; shared이면not_applicable; official effective는 해당event의confirmed판. 취소와휴지통은별도 |
| `calendar_event_versions` | I,S; `event_id text`,`version integer`,`title text`,`description text=''`,`location text=''`,`start_date date`,`end_date date`,`all_day boolean`,`start_time time?`,`end_time time?`,`visibility text`,`audience_set_id text?`,`legacy_audience jsonb?`,`author_member_id text`,`changed_by_member_id text`,`change_reason text=''`,`created_at timestamptz=now()`,`academic_year_id text?`,`term_id text?`,`body_sha256 text` | event→calendar_events, 각 member→M, year/term/조건 FK; UQ(school,event_id,version), UQ(school,event_id,id); title1~100,안내≤2000,장소≤100,version>0,start≤end; all_day↔시각NULL, 같은날시간지정start<end; visibility school/audience/private; 조건set 또는legacy snapshot중정확히하나; IMM; IX(school,start_date,end_date,event_id) |
| `calendar_official_actions` | I,S; `event_id text`,`event_version_id text`,`actor_member_id text`,`action text`,`reason text`,`created_at timestamptz=now()` | version은같은event FK; action confirm/withdraw; actor→M; UQ(event_version_id,action); 공식 확정 권한자가 해당판을 명시 확인 |

현재 일정 DTO의 visibility는 유지한다. 공식 편집안은 `current_version_id`를 바꾸어도 `official_effective_version_id`를 자동 바꾸지 않는다. 수업일수는 후자와 실제 일과 설정을 사용한다. 기존 `calendar_save`도 공식 이벤트를 무조건 일반 공유 일정처럼 수정할 수 없도록 같은 권한/버전 검사를 거치는 것을 공식 기능 활성화의 필수 게이트로 둔다. 취소·삭제된 행을 기존 list/get가 active처럼 반환하지 않도록 호환 경로도 같은 projection을 사용한다.

| 시트 표 | 열 | 제약·인덱스 |
|---|---|---|
| `calendar_sources` | I,S,V,T; `owner_member_id text`,`source_kind text`,`external_document_key text`,`external_sheet_key text`,`authority_state text='parallel'`,`mapping_version integer=1`,`mapping jsonb`,`active boolean=true` | owner→M; kind sheet/csv/paste; authority parallel/site; UQ(school,kind,document_key,sheet_key); mapping은허용필드매핑만, 비밀키저장금지 |
| `calendar_source_records` | I,S,V; `source_id text`,`external_row_key text`,`identity_mode text`,`event_id text?`,`last_source_snapshot_id text?`,`last_target_version_id text?`,`active boolean=true` | source/event/판 FK; UQ(school,source_id,external_row_key); identity stable_id/manual_confirmed; baseline 두pointer는둘다NULL또는둘다존재; event/판 같은event검사 |
| `calendar_source_snapshots` | I,S; `source_record_id text`,`mapping_version integer`,`source_revision text?`,`normalized_body jsonb`,`sha256 text`,`captured_at timestamptz=now()` | record FK; IMM; JSON은입력원본재현용으로만보존, 학교/사용자관계의권한근거로사용금지 |
| `calendar_import_runs` | I,S,V,T; `source_id text`,`actor_member_id text`,`mapping_version integer`,`state text`,`input_sha256 text`,`source_file_id text?`,`preview_sha256 text?`,`approved_by_member_id text?`,`approved_at timestamptz?` | source/memberFK; state uploaded/previewed/applying/applied/partial/failed/cancelled; 파일FK는R1-D에서추가. 매핑변경시미리보기무효 |
| `calendar_import_rows` | I,S,V; `run_id text`,`display_row integer`,`source_record_id text?`,`incoming_snapshot_id text?`,`expected_source_record_version integer?`,`baseline_source_snapshot_id text?`,`baseline_target_version_id text?`,`expected_event_version integer?`,`decision text`,`result_event_version_id text?`,`error_code text?` | run/record/snapshot/판FK; baseline snapshot은같은record·target판은같은event; UQ(school,run_id,display_row), UQ(school,run_id,source_record_id) WHERE source_record_id IS NOT NULL; decision no_change/create/source_only/site_only/conflict/ignored/error; 적용성공에는result판필수, 실패는기술본문없는코드 |
| `calendar_cutovers` | I,S; `source_id text`,`expected_source_version integer`,`review_run_id text`,`actor_member_id text`,`approved_at timestamptz`,`comparison_sha256 text`,`new_authority text='site'` | source/run/memberFK; UQ(source_id,new_authority); 비교run은같은source. IMM |

마지막 원본 snapshot/마지막 반영 대상판·현재 원본·현재 사이트판을 보존하여 3방향 대조한다. 원본만 변경→미리보기 반영, 사이트만 변경→사이트 유지, 양쪽 변경→항목별 충돌 해소, 양쪽 동일→no_change다. 미리보기 manifest에는 source record의 판·baseline 두 포인터·목표 event 판을 모두 고정하고, 적용할 때 하나라도 바뀌면 재대조한다. 같은 원본 key가 한 입력에 두 번 있으면 행번호로 별개 일정 두 개를 만들지 않고 해당 입력을 오류 처리한다. 원본 담당의 동의 없이 시트 ID열을 쓰지 않는다. 행번호·내용 해시는 영구 ID가 아니며 ID없는 행은 최초 매핑 후 확인형 변경만 허용한다. 이번 입력에 없는 행을 삭제하지 않는다.

기준 전환 RPC는 비교 run 지문·source version·미처리 충돌 0·연결 관리권한을 검사하고 source `authority_state=site`와 cutover 이력을 같이 기록한다. 전환 후 구 시트 입력이 사이트를 자동 덮어쓰지 못하도록 모든 import 적용 경로가 authority를 재검사한다. 일반 교사의 일정 편집권으로 source owner나 기준 전환 권한을 얻지 않는다.

## 7. 개인 업무와 협조 요청 — R1-A

기존 `personal_tasks` 필드는 변경하지 않는다. title120/notes2000 코드포인트·ECMAScript trim·NULL due_date↔DTO 빈 문자열·5상태·학교+owner 소유를 유지한다. task RPC가 전달하는 conflict current도 현재 읽기권한을 다시 검사한다.

| 신규 표 | 열 | 제약·인덱스 |
|---|---|---|
| `cooperation_requests` | I,S,V,T; `requester_member_id text`,`target_member_id text`,`duty_id text?`,`title text`,`message text=''`,`due_at timestamptz?`,`state text='requested'`,`accepted_at timestamptz?` | 각member→M,duty→duties; state requested/accepted/declined/alternative_proposed/completed/cancelled; title1~120,message≤2000; IX(school,target,state,due_at,id), IX(school,requester,state,id) |
| `cooperation_responses` | I,S; `request_id text`,`actor_member_id text`,`request_version integer`,`response text`,`alternative_member_id text?`,`note text=''`,`created_at timestamptz=now()` | request/member→각FK; response accept/decline/propose_alternative/complete/cancel; alternative iff propose_alternative; UQ(request_id,request_version); IMM |
| `task_sources` | I,S; `owner_member_id text`,`task_id text`,`event_id text?`,`cooperation_id text?`,`duty_item_id text?`,`created_at timestamptz=now()` | task는(school,owner,task_id)→personal_tasks; 기타동일학교FK; 세source중정확히하나; 각source종류별 UQ(school,owner,event/cooperation/duty_item) WHERE source IS NOT NULL; UQ(school,task_id) |

협조 수락은 공식 소속·업무권한 승격이 아니다. 요청자/대상자만 요청의 공유 내용·응답 상태를 읽고, 연결된 개인 업무의 notes는 소유자만 읽는다. 수락 후 개인 준비 업무를 만드는 경우 요청/개인 업무/source link를 한 트랜잭션에 기록한다. 재시도 때 같은 source+owner로 두 할 일을 만들지 않는다. 대체자 제안은 그 사람에게 자동 배정하지 않고 요청자의 명시 재요청과 대상자의 수락을 요구한다.

수합 단위 의무는 `personal_tasks`에 복제하지 않는다. 홈은 `collection_units`에서 원본 상태를 읽어 별도 유형으로 합친다. 개인 준비 체크가 접수나 검토 완료가 되지 않는다. 일정 변경은 source 링크의 원본 표시만 최신으로 갱신하고 개인 메모/상태를 덮어쓰지 않는다. 의무 인계는 `duty_items`와 수합 단위의 책임을 옮기며 기존 개인 notes 소유자를 바꾸지 않는다.

## 8. 일반 수합의 요청·문항·정적 제출 단위 — R1-C

| 표 | 열 | 제약·인덱스 |
|---|---|---|
| `collections` | I,S,V,T; `manager_member_id text`,`academic_year_id text`,`term_id text?`,`state text='draft'`,`current_schema_id text?`,`published_at timestamptz?`,`closed_at timestamptz?`,`cancelled_at timestamptz?` | manager/year/term FK; state draft/published/closed/cancelled; published이후schema필수; IX(school,manager,state,updated_at,id) |
| `collection_versions` | I,S; `collection_id text`,`schema_version integer`,`title text`,`instructions text=''`,`review_mode text`,`reviewer_member_id text?`,`due_kind text`,`due_at timestamptz`,`due_display_date date?`,`display_timezone text`,`visibility text`,`audience_set_id text?`,`created_by_member_id text`,`created_at timestamptz=now()`,`change_reason text=''`,`schema_sha256 text` | collection/member/조건 FK; UQ(school,collection_id,schema_version), UQ(school,collection_id,id); schema_version>0; review none/required, required↔reviewer필수; due_kind date/time, date↔due_display_date필수; visibility school/audience/participants; IMM |
| `collection_fields` | I,S; `schema_id text`,`field_key text`,`position integer`,`kind text`,`label text`,`required boolean=false`,`max_length integer?`,`min_number numeric?`,`max_number numeric?`,`max_files integer?` | schema FK; UQ(school,schema_id,field_key), UQ(school,schema_id,position), UQ(school,schema_id,id,kind); kind text/number/boolean/date/single_choice/multi_choice/file; 한도는종류별적용·양수, min≤max; 문항판IMM |
| `collection_field_options` | I,S; `schema_id text`,`field_id text`,`option_key text`,`label text`,`position integer` | R1-D 생성. field→해당schema문항; UQ(school,field_id,option_key), UQ(school,field_id,position); 선택형에만허용; IMM |
| `collection_unit_specs` | I,S,V; `collection_id text`,`unit_key text`,`label text`,`kind text`,`responsible_member_id text`,`department_id text?`,`class_id text?`,`course_id text?`,`subject_id text?`,`grade_level_id text?` | 요청초안의제출단위; collection/member/각기준표FK; UQ(school,collection_id,unit_key); kind member/department/class/course/subject_grade/custom; kind별필수참조와불필요참조NULL 강제 |
| `collection_spec_members` | `school_id text`,`spec_id text`,`member_id text`,`role text='contributor'` | PK(school,spec,member), 각각FK; role contributor; 책임자는자동구성원으로합산 |
| `collection_units` | I,S,V,T; `collection_id text`,`unit_key text`,`label_snapshot text`,`kind text`,`source_spec_id text`,`responsible_member_id text?`,`reviewer_member_id text?`,`active_schema_id text`,`obligation_state text='assigned'`,`current_submission_id text?`,`effective_submission_id text?`,`first_submission_id text?`,`published_at timestamptz`,`needs_owner boolean=false` | collection/spec/member/schema FK; UQ(school,collection_id,unit_key), UQ(school,id,collection_id); state assigned/exempt/cancelled; assigned & !needs_owner이면responsible필수; pointer는해당unit제출FK(지연제약); IX(school,responsible,obligation_state,id), IX(school,collection_id,obligation_state,id) |
| `collection_unit_members` | I,S; `unit_id text`,`member_id text`,`display_name_snapshot text`,`role text`,`valid_from timestamptz`,`valid_until timestamptz?`,`assigned_by_member_id text` | unit/member/assigner FK; role responsible/contributor; UQ(school,unit_id,member_id,valid_from); 같은unit+member의기간중첩금지; 한시점responsible은1명(공백이면0); IX(school,member_id,unit_id,valid_until) |
| `collection_unit_delegates` | I,S,V; `unit_id text`,`delegate_member_id text`,`authorized_by_member_id text`,`valid_from timestamptz`,`valid_until timestamptz`,`reason text`,`revoked_at timestamptz?` | R1-D. unit/memberFK; from<until; 대리승인범위권한과유효책임자확인; 제출행은실제대리actor와책임자를구분 |

`unit_key`는 단위의 안정 ID다. 표시 이름이나 인원수로 의무를 식별하지 않는다. 사용자 정의 단위는 서버가 생성한 고정 키를 쓴다. 교과×학년은 기준표 ID의 정규 조합으로 만들고 이름 변경에 따라 새 의무를 생성하지 않는다.

게시 RPC는 collection 기대판·문항판지문·단위 목록 지문·모든 책임자/공동 구성원의 현재 학교 소속·검토자의 자기검토 금지를 확인한 뒤 `units`, `unit_members`를 한 번 생성하고 published 전환·접수증·알림 outbox를 함께 기록한다. 책임자 1명이 2단위를 맡으면 의무2, 공동작성자3명이1단위면의무1이다. 대상 0명은 명시 확인의 대상이고 조회 실패를 0명으로 바꾸지 않는다.

게시 후 문항·검토모드 변경은 새 `collection_versions`를 만든다. 이미 제출된 판의 schema/review_mode를 수정하지 않는다. 최초 구현은 검토 대기판·활성 보완이 있는 상태에서 검토모드 변경을 거부하고 먼저 처리하거나 명시 전환안을 다시 확인하게 한다. 적용 단위 목록·단위 기대판·초안 문항 손실 영향을 승인받아 `active_schema_id`를 바꾼다. 마감 변경도 새 정책판을 만들며 과거 접수시각/마감 snapshot은 보존한다. AP04 미확정 정책은 자동 활성화하지 않는다.

## 9. 초안·불변 제출판·검토·완료본 — R1-C, 선택/파일은 R1-D

| 표 | 열 | 제약·인덱스 |
|---|---|---|
| `collection_drafts` | I,S,V,T; `collection_id text`,`unit_id text`,`schema_id text`,`draft_scope text`,`owner_member_id text?`,`last_editor_member_id text` | unit/schema/memberFK; scope personal/unit; personal↔owner필수; UQ(school,unit_id,schema_id,owner_member_id) WHERE personal; UQ(school,unit_id,schema_id) WHERE unit; unit/schema/scope/owner는불변,본문만판검사로수정; unit공동초안과개인준비초안별도 |
| `collection_draft_answers` | I,S; `draft_id text`,`schema_id text`,`field_id text`,`field_kind text`,`text_value text?`,`number_value numeric?`,`boolean_value boolean?`,`date_value date?` | draft/schema/field FK; UQ(school,draft_id,field_id); field의schema/type복합FK; 타입에맞는한열만사용, 미입력은전부NULL; 숫자finite; 초안저장은필수누락허용 |
| `collection_draft_choices` | `school_id text`,`answer_id text`,`option_id text` | R1-D. PK(school,answer,option); answer/option 같은field검사; single이면행≤1, multi중복불가 |
| `collection_submissions` | I,S; `unit_id text`,`collection_id text`,`schema_id text`,`revision integer`,`submitted_by_member_id text`,`responsible_member_id_snapshot text`,`delegate_id text?`,`draft_id text`,`draft_version integer`,`receipt_at timestamptz`,`due_kind_snapshot text`,`due_at_snapshot timestamptz`,`review_mode_snapshot text`,`reviewer_member_id_snapshot text?`,`correction_of_id text?`,`correction_reason text=''`,`answer_sha256 text`,`request_receipt_id text`, `school_scope_key`(§2.7 생성열) | unit은같은collection FK; schema은같은collectionFK; member/delegate/draftFK; UQ(school,unit_id,revision), UQ(school,unit_id,id); revision>0; revision>1이면사유필수; correction_of는같은unit판; receipt는(scope_key,id)복합FK DEFERRABLE INITIALLY DEFERRED; IMM; IX(school,collection_id,receipt_at,id) |
| `collection_submission_answers` | I,S; `submission_id text`,`schema_id text`,`field_id text`,`field_kind text`,`text_value text?`,`number_value numeric?`,`boolean_value boolean?`,`date_value date?` | 제출/field복합FK; UQ(school,submission_id,field_id); draft와같은타입규칙+필수검사; IMM |
| `collection_submission_choices` | `school_id text`,`answer_id text`,`option_id text` | R1-D. draft choices와같은제약, IMM |
| `collection_reviews` | I,S; `unit_id text`,`submission_id text`,`reviewer_member_id text`,`decision text`,`note text=''`,`created_at timestamptz=now()` | submission은같은unitFK; reviewer→M; decision accepted/changes_requested; UQ(school,submission_id); changes면note필수; IMM |
| `collection_correction_requests` | I,S,V; `unit_id text`,`target_submission_id text`,`review_id text?`,`requested_by_member_id text`,`reason text`,`due_kind text`,`due_at timestamptz`,`due_display_date date?`,`display_timezone text`,`created_at timestamptz=now()`,`cancelled_at timestamptz?`,`supersedes_request_id text?`,`fulfilled_submission_id text?`,`fulfilled_at timestamptz?` | target/fulfilled는같은unitFK; review는같은submission검사; supersedes는같은unit요청; due_kind/date/time 규칙은요청판과동일; fulfilled 두열동시NULL/존재; fulfilled는요청이후판이며현재철회안됨; 사유/기한/대상판IMM, 기한변경은이전요청취소+새요청; IX(school,unit_id,due_at) WHERE cancelled_at IS NULL AND fulfilled_at IS NULL |
| `collection_correction_fulfillments` | I,S; `request_id text`,`unit_id text`,`submission_id text`,`fulfilled_at timestamptz`,`due_kind_snapshot text`,`due_at_snapshot timestamptz`,`late boolean`,`invalidated_at timestamptz?`,`withdrawal_id text?` | request/submission은같은unitFK; UQ(school,request_id,submission_id); UQ(school,request_id) WHERE invalidated_at IS NULL; late는§2.3의날짜/시각경계규칙으로생성; invalidated/withdrawal은동시NULL/존재하며같은submission철회FK; 불변충족본문+철회무효메타만변경 |
| `collection_correction_windows` | I,S,V; `unit_id text`,`opened_by_member_id text`,`valid_from timestamptz`,`valid_until timestamptz`,`allow_submit boolean`,`allow_withdraw boolean`,`reason text`,`revoked_at timestamptz?` | unit/memberFK; from<until, 동작하나이상; 해당단위만허용; IX(school,unit_id,valid_until) |
| `collection_withdrawals` | I,S; `unit_id text`,`submission_id text`,`actor_member_id text`,`delegate_id text?`,`reason text`,`created_at timestamptz=now()` | 제출은같은unitFK; actor/delegateFK; UQ(school,submission_id); IMM |
| `collection_exemptions` | I,S; `unit_id text`,`actor_member_id text`,`action text`,`reason text`,`created_at timestamptz=now()`,`unit_version integer` | unit/memberFK; action exempt/restore/cancel; UQ(school,unit_id,unit_version); IMM. 최신unit의obligation_state와동시갱신 |
| `collection_external_actions` | I,S; `submission_id text`,`actor_member_id text`,`action text`,`reference text?`,`created_at timestamptz=now()` | 해당제출/memberFK; action exported/user_confirmed; IMM; 외부번호는필요최소만, 외부결재본문복제금지 |

같은 학교의 다른 단위·문항판도 서로 섞이지 않게 아래 상위 관계를 **별도 복합 FK**로 강제한다. 단독 ID FK와 현재 읽기권한 검사만으로 대체하지 않는다.

| 부모의 추가 유일 제약 | 자식의 정확한 복합 FK |
|---|---|
| `collection_versions UQ(school_id,collection_id,id)` | `collection_units(school_id,collection_id,active_schema_id)`, `collection_submissions(school_id,collection_id,schema_id)`가 해당 키 참조 |
| `collection_drafts UQ(school_id,id,unit_id,schema_id)` 및 `UQ(school_id,id,schema_id)` | `collection_submissions(school_id,draft_id,unit_id,schema_id)`, `collection_draft_answers(school_id,draft_id,schema_id)`가 각각 참조 |
| `collection_submissions UQ(school_id,id,schema_id)` 및 `UQ(school_id,unit_id,id)` | `collection_submission_answers(school_id,submission_id,schema_id)`, 단위 current/effective/first의 `(school_id,id,각_submission_id)`, reviews/withdrawals/corrections의 `(school_id,unit_id,submission_id)`가 각각 참조 |
| `collection_fields UQ(school_id,schema_id,id,kind)` 및 `UQ(school_id,schema_id,id)` | draft/submission answers의 `(school_id,schema_id,field_id,field_kind)`, options의 `(school_id,schema_id,field_id)`가 각각 참조 |
| `collection_correction_requests UQ(school_id,unit_id,id)` | `collection_correction_fulfillments(school_id,unit_id,request_id)` 참조; 같은 행의 submission 역시 동일 unit 복합 FK |

`collection_drafts`에는 `(school_id,unit_id,collection_id)→collection_units(school_id,id,collection_id)`와 `(school_id,collection_id,schema_id)→collection_versions(school_id,collection_id,id)`를 적용한다. 옛 schema의 초안은 읽기/명시 변환용으로 보존할 수 있으므로 unit의 현재 active_schema와 영구 FK로 묶지는 않는다. **저장·최종 제출 명령은 draft.schema_id=unit.active_schema_id를 재검사**하고 다르면 문항 변환 미리보기를 요구한다. 새 schema로 옮길 때는 기존 draft의 schema를 UPDATE하지 않고 새 draft ID를 만든다. 확인된 답변·선택·허용 파일만 새 초안으로 복사하며 누락 항목을 조용히 버리지 않는다. 이로써 과거 제출판의 draft/schema 복합 FK도 그대로 보존된다. draft/submission choices와 files처럼 schema를 직접 보유하지 않는 관계는 고정 부모 행을 경유하는 제약 트리거로 문항/선택지가 같은 schema인지 검사한다.

초안 RLS/조회는 personal이면 작성자, unit이면 현재 유효한 공동 구성원으로 제한한다. 요청 관리자·검토자·학교 관리자·지원자라는 이유로 **본문·첨부·초안 존재 여부/건수**를 반환하지 않는다. 제출 전 공동 파일도 동일 경계다. 개인 준비 초안을 공동 초안으로 옮기는 것은 별도 명시 복사이며, 작성자 본인의 확인 후 허용 문항·파일만 복사한다. 자동 합치지 않는다.

요청판의 `visibility`는 수합 안내 열람 범위다. 학교 전체가 안내를 읽는다고 다른 단위의 제출 답변·첨부를 읽을 수 있지는 않다. 제출 후에는 현재 단위 구성원, 그 단위의 지정 검토자, 요청 관리 범위 안의 담당자만 해당 판을 읽는다. 파일·ZIP·숫자 합계도 이 허용 단위를 먼저 제한한다. 학교 관리자에게 전체 제출 열람을 자동 부여하지 않으며, 면제/관리 권한과 답변 열람 권한이 다르면 집계에도 그대로 적용한다.

### 9.1 제출 RPC 원자성

1. 호출자의 현재 소속·책임자 또는 유효 대리·공동 초안 읽기권한을 확인한다. 개인 준비 초안을 바로 공동 제출하지 않는다.
2. §14의 users→학교 gate→소속→권한/정책 공통 잠금을 잡고 현재 권한을 재검사한 뒤, 같은 `scope_key+actor_user_id+operation+request_key`의 멱등 잠금과 collection/unit/draft 잠금을 잡는다. unit 기대판과 draft 기대판을 모두 검사한다. 소속이 바뀐 재시도는 원래 actor member와 현재 행동권한을 검증하고 소속 종료를 우회하지 않는다.
3. 적용 schema·마감/정정 창·활성 의무·필수 문항·선택지·파일 ready/clean/실물/소유/연결 권한을 다시 검사한다. 수정된 최종 파일은 새파일/새검사다.
4. 다음 revision, 답변·선택·파일 불변 snapshot, 접수시각/마감/검토 모드 snapshot을 만든다. 클라이언트 timestamp를 접수시각으로 신뢰하지 않는다.
5. current/effective와 최초 제출 pointer, 보완 충족, unit version, 접수증·감사·outbox를 함께 기록한다. 임의로 필수1개를 뒤늦게 실패시켜도 전부 rollback되어야 한다.
6. 응답 유실 시 같은 키로 같은 결과를 반환한다. 현재 열람권한이 사라졌으면 과거 receipt.result 본문을 반환하지 않는다. 새키 자동 재제출은 금지한다.

공통 `workhub_command_receipts.id`는 서버가 트랜잭션 안에서 먼저 할당하고 제출판의 `request_receipt_id`에 사용한다. 불변판 INSERT 후 같은 트랜잭션에서 receipt를 INSERT하여 지연 FK를 만족시킨다. receipt에는 `result_kind='collection_submission'`, 원본 ID와 안전한 접수 메타만 저장하고 답변·파일 URL은 저장하지 않는다. 제출판을 먼저 NULL로 만들었다가 후속 UPDATE하는 방식이나 DB 밖 2단계 확정은 사용하지 않는다. 기존 task/calendar 전용 receipt는 그대로 둔다.

### 9.2 모드별 포인터와 철회

| 사건 | `current_submission_id` | `effective_submission_id` | 추가 검사 |
|---|---|---|---|
| none 첫 v1 | v1 | v1 | `not_required`, 사람 승인 아님 |
| none 정정 v2 | v2 | v2 | 사유/마감후창 검사, 공식처리 상태복사금지 |
| none 현재 v2 철회 | NULL | NULL | 과거v1 자동복원금지, 외부처리된판은직접철회금지 |
| required 첫 v1 | v1 | NULL | pending |
| required v1 승인 | v1 | v1 | 지정된다른검토자·현재대기판 |
| required 정정 v2 제출 | v2 | v1 | v1집계유지 |
| required v2 보완요청 | v2 | v1 | 별도보완요청+기한 생성 |
| required 미승인 v2 철회 | v1 또는 NULL | 기존값 유지 | 보완의무없애지않음 |
| required v2 승인 | v2 | v2 | 이전완료본 이력보존 |

required의 accepted판은 직접 철회하지 않는다. `exported` 기록은 파일을 내보낸 사실이고 외부 공식 처리 완료는 `user_confirmed`로 별도다. 직접 철회 차단의 외부 처리 기준은 AP04에서 확정한 상태를 사용하되, **이미 공식 처리했다고 확인된 판은 반드시 차단**한다. 정책 승인 전에는 임의 허용 상태로 공개하지 않는다. none에 가짜 검토 행을 만들지 않는다.

자기 검토는 현재 책임자뿐 아니라 **그 판의 실제 제출자·책임자 snapshot**와 검토자가 같은지 검사한다. 대리 제출 후 책임자가 자기 편의로 승인하는 우회도 막는다. 인계 뒤 옛 검토자가 아니라 현재 지정 검토자에게 처리권을 주되 해당판의 자기검토 금지 이력은 보존한다.

### 9.3 지연·보완·면제·집계

- 최초 지연: `first_submission_id`의 receipt/due snapshot으로 계산한다. later판이나 마감 변경·철회로 최초 역사 판정을 다시 쓰지 않는다.
- 현재 미제출 연체: obligation=assigned AND !needs_owner의 책임 귀속을 표시하되 담당 공백 의무도 학교 운영 집계에 남김; 현재시각이 적용마감 경계를 넘었고 current=NULL이면 연체다. exempt/cancelled는 분모·독촉에서 제외한다.
- 보완 초과: 취소되지 않은 correction request에 유효 fulfilled판이 없고 기한을 넘음. 실제 보완 제출 시 그 요청 ID를 명시하여 fulfilled판/at를 기록한다. **관련 없는 보완을 모든 제출로 무조건 충족시키지 않는다.** 첫 로컬 계약의 한 단위 전부 보완 모델은 요청별 연결로 확장한다.
- fulfilled판 철회 시 그판에 연결된 충족 행에 invalidated_at/withdrawal_id를 기록하고 요청의 fulfilled 두 포인터를 같은 트랜잭션에서 비운다. 보완요청판 철회로 effective v1을 복구해도 미충족 보완은 남는다. 늦은 보완 제출 사실은 `collection_correction_fulfillments`의 불변 기한·시각·late로 재현한다. 요청 기한 변경은 취소/대체 이력으로 남기고 이미 제출된 판의 늦음 판정을 덮어쓰지 않는다.
- unit의 current는 접수수, effective는 완료본수와 숫자 합계에 사용한다. 총계는 허용된 단위를 먼저 제한하고 각 단위를 한 번만 센다. 빈 숫자는 NULL, 0은 유효; sum은numeric, 화면이안전정밀도로표현못하면문자열+단위/반올림규칙을반환한다.
- 면제·취소는 의무 상태 변경이지 제출판 삭제가 아니다. 복원은 새 이력/현재판으로 처리하며 최초 접수증을 다시 발행하지 않는다. 관리자 완료 처리 버튼으로 누락 제출을 채우지 않는다.

## 10. 전달사항·알림 — R1-B

| 표 | 열 | 제약·인덱스 |
|---|---|---|
| `notices` | I,S,V,T; `author_member_id text`,`duty_id text?`,`current_version_id text?`,`state text='draft'` | member/dutyFK; state draft/published/withdrawn; IX(school,state,updated_at,id) |
| `notice_versions` | I,S; `notice_id text`,`version integer`,`title text`,`body text`,`audience_set_id text`,`visibility text`,`ack_required boolean=false`,`published_at timestamptz?`,`created_by_member_id text`,`created_at timestamptz=now()` | notice/조건/memberFK; UQ(school,notice_id,version), UQ(school,notice_id,id); visibility school/audience; title1~160/body한도는승인된입력정책; IMM |
| `notice_recipients` | `school_id text`,`notice_version_id text`,`member_id text`,`target_reason text`,`delivered_at timestamptz?` | PK(school,notice_version,member), version/memberFK; 게시대상snapshot,이행의무로승격금지 |
| `notice_acknowledgements` | `school_id text`,`notice_version_id text`,`member_id text`,`read_at timestamptz?`,`acknowledged_at timestamptz?` | PK(school,version,member), 수신대상복합FK; 명시확인과읽음별도,의미있는개정판에는새확인대상 |
| `notifications` | I,S; `recipient_member_id text`,`source_outbox_id text`,`kind text`,`source_version integer`,`available_at timestamptz`,`read_at timestamptz?`,`revoked_at timestamptz?`,`created_at timestamptz=now()`, `school_scope_key`(§2.7 생성열) | memberFK; (school_scope_key,source_outbox_id)→workhub_outbox(scope_key,id); UQ(school,source_outbox_id,recipient_member_id,kind,source_version); IX(school,recipient,available_at DESC,id) WHERE revoked_at IS NULL; 본문/학생이름/개인메모저장금지 |
| `notification_preferences` | `school_id text`,`member_id text` PK; `timezone text='Asia/Seoul'`,`quiet_start time`,`quiet_end time`,`quiet_weekends boolean`,`digest_enabled boolean`,`updated_at timestamptz=now()`,`version integer=1` | memberFK; 승인전기본정책을설정값으로자동확정하지않음. 시간대지원목록검사 |

알림 원본은 공통 outbox에 **typed 도메인 참조**를 둔다. 알림함은 사건→원본 읽기권한을 요청 때 다시 검사해 제목·링크를 만든다. 오래된 공개 알림이 private로 바뀐 제목을 계속 노출하지 않게 한다. 같은 사건 재전송은 알림1개, 원본 새판은 별도 의미있는사건이며 낱개저장마다전체푸시하지 않는다. 푸시는 알림함이 기록된 뒤 수행하고 실패를 원본 트랜잭션으로 역전파하지 않는다.

확인 명단은 해당 확인 요청자만 조회한다. 일반 관리자용 전체 교사 읽음 순위·미제출 초안 통계를 만들지 않는다. 중요 flag가 게시범위를 넓히지 않으며 작성자 승인된 업무/부서 범위 밖 대상은 게시 시 거부한다. 문의·지원 세션 및 운영 통계는 공통 운영 장을 따르고 본문 자동 첨부는 하지 않는다.

## 11. 파일 본체와 도메인별 첨부 — R1-D

### 11.1 `public.workhub_files`

파일 한 행은 **변경 불가능한 한 실물**이다. 같은 이름의 수정파일도 새 id와 새 object_path를 만든다.

| 열 | 타입/NULL/default | 제약·의미 |
|---|---|---|
| id | text PK, UUID 문자열 default | 파일 논리 식별자 |
| scope_type | text NN | school/common. account_private는후속별도계약 |
| school_id | text NULL | 학교scope면필수,common이면NULL; schoolsFK |
| scope_key | text GENERATED STORED | §2의K식으로생성, UNIQUE(scope_key,id) |
| owner_member_id | text NULL | 학교scope면필수·동일학교membersFK,common이면NULL |
| created_by_user_id | text NN | 기존public.users.id FK. 신원유지용이며단독읽기권한아님 |
| bucket, object_path | text NN | UQ(bucket,object_path); 서버생성·클라이언트임의경로불가 |
| original_filename, claimed_mime | text NN | 표시명정리; 경로·권한판정에사용금지 |
| detected_mime | text NULL | 서버실물검사결과 |
| sha256 | text NULL | ready면64자리소문자hex필수 |
| byte_size | bigint NULL | 0이상; ready면필수. 요청claim을확정값으로복사하지않음 |
| upload_state | text NN='uploading' | uploading/validating/ready/failed |
| scan_state | text NN='pending' | pending/clean/rejected; 미검사pass금지 |
| version | integer NN=1 | 메타/접근판>0; 실물교체용아님 |
| expires_at | timestamptz NULL | 미완료업로드만기 |
| finalized_at | timestamptz NULL | ready면필수 |
| access_revoked_at, purged_at | timestamptz NULL | 차단과실물파기완료를구분 |
| created_at, updated_at | timestamptz NN=now() | 서버시각 |

UQ(school_id,id)와 UQ(scope_key,id)를 모두 둔다. IX(school_id,owner_member_id,created_at DESC,id); IX(upload_state,expires_at) WHERE finalized_at IS NULL; IX(access_revoked_at) WHERE purged_at IS NULL. ready이면 scan=clean·실물존재확인·detected_mime/hash/bytes가 모두 있어야 한다. ready 후 scope/school/owner/object_path/hash/bytes/detected_mime은 불변이다. 공통 파일은 공통 게시 권한으로 확정된 지식판/양식팩의 typed 참조를 통해서만 읽으며, scope=common 자체로 공개하지 않는다. 자동 OCR/AI추출지원 여부는 이 검사와 별개다.

`file_upload_intents`: I,S,V,T; `file_id text`, `uploader_member_id text`, `purpose text`, `target_draft_id text?`, `target_document_id text?`, `target_import_id text?`, `target_notice_id text?`, `expires_at timestamptz`, `max_bytes bigint`, `allowed_types jsonb`, `state text='issued'`. file/member/각typed대상FK, purpose collection_draft/document/calendar_import/notice에따른대상정확히하나, max_bytes>0, state issued/completed/expired/cancelled, UQ(school,file_id). 설정 snapshot은 업로드 한도/허용형식의 증거이고 임의 권한은 아니다. 파일 소유자의 소속/user 일치와 목적 객체의 현재 작성권한을 생성·완료·첨부 때 재검사한다. 공통 양식 자산 업로드는 학교 업로드 RPC와 분리한 운영 전용 경로다.

### 11.2 관계 표

| 표 | 정확한 연결 열 | 제약·권한 |
|---|---|---|
| `collection_draft_files` | `school_id`,`draft_id`,`field_id`,`file_id` TEXT NN, `position integer NN`, `attached_by_member_id text NN`, `created_at timestamptz NN` | PK(school,draft,field,file); draft/file/member동일학교FK,field는draft.schema의file문항; UQ(school,draft,field,position); 현재공동/개인초안권한 |
| `collection_submission_files` | `school_id`,`submission_id`,`field_id`,`file_id` TEXT NN, `position integer NN`,`sha256_snapshot text NN`,`byte_size_snapshot bigint NN` | PK(school,submission,field,file); typedFK+문항schema검사; IMM; 파일snapshot은실물메타와동일; 제출판권한 |
| `document_version_files` | `school_id`,`document_version_id`,`file_id` TEXT NN, `role text NN`,`position integer NN` | PK(school,document_version,file,role); typedFK; role source/preview/attachment; UQ(school,document_version,role,position); 주본문실물은document_versions.file_id만기준이며이표는보조파일; 불변문서판권한 |
| `notice_version_files` | `school_id`,`notice_version_id`,`file_id` TEXT NN, `position integer NN` | typedFK+PK(school,notice_version,file); 게시판의열람범위보다민감한파일붙이기거부 |

같은 파일을 다른 객체에 붙이는 것은 공개 범위를 넓힐 수 있다. 서버는 **파일을 현재 읽을 수 있는가 + 목적 객체에 연결할 권한이 있는가 + 원파일 분류가 목적 공개범위를 허용하는가**를 모두 검사한다. 자기 소유 업로드나 초안 파일을 허용된 제출판으로 넘기는 것은 명시적 최종 제출과 함께 확정한다. 타인의 개인 파일을 ID만 알아서 공지에 연결할 수 없다. 기존 제출파일을 정정판에서 재사용하려면 원파일 검증·현재 읽기권한을 다시 검사한다.

다운로드 RPC는 file_id뿐 아니라 정확한 typed link와 원본 판을 받아 그 관계로 판정한다. 미제출 파일은 검토자가 raw file_id나 Storage 경로로 우회할 수 없어야 한다. 민감 파일은 요청별 인증 proxy를 우선 제안한다. 서명 URL은 짧은 만료라도 이미 발급된 링크의 실질 회수 한계를 표시하며, 재발급 거부만으로 이미 발급 URL을 회수했다고 하지 않는다.

DB와 Storage는 하나의 트랜잭션이 아니다. init→임시업로드→실물검사→ready→업무첨부확정 순서와 재시도 ID를 둔다. ready이지만 연결 실패한 파일은 미첨부로 남기고, approved 정리정책 전에는 임의 영구삭제하지 않는다. 삭제/보존은 공통 deletion ledger와 연동하며 복원 시 폐기·차단 이력을 재적용한다. DB메타만 백업하고 파일복구완료라고 표시하지 않는다.

## 12. 문서함·문서팩·생성판 — R1-D/R3

| 표 | 열 | 제약·단계 |
|---|---|---|
| `documents` | I,S,V,T; `owner_member_id text`,`title text`,`visibility text`,`audience_set_id text?`,`state text='draft'`,`current_version_id text?` | R1-D. owner→M/조건FK; visibility private/audience/school; state draft/active/archived; title1~200; IX(school,owner,updated_at DESC,id) |
| `document_versions` | I,S; `document_id text`,`revision integer`,`file_id text?`,`pack_scope_key text?`,`pack_version_id text?`,`created_by_member_id text`,`source_type text`,`content_text text?`,`content_sha256 text`,`created_at timestamptz=now()`,`validation_state text='not_checked'`,`needs_review boolean=false`,`previous_version_id text?` | R1-D 파일함판, R3 pack/검사추가. document/member/file동일학교FK; (pack_scope_key,pack_version_id)→document_pack_versions(scope_key,id) MATCH FULL, scope는common/본교만; UQ(school,document_id,revision),UQ(school,document_id,id); source_type upload/generated/edited; file또는content중하나이상; 이전판같은document; 검증state pass/needs_review/error/not_checked; 본문/실물연결IMM,검증state/needs_review는파생메타 |
| `document_packs` | I,K; `code text`,`name text`,`current_version_id text?`,`active boolean=true` | R3. UQ(scope_key,code); current는(scope_key,id,current_version_id)→document_pack_versions(scope_key,pack_id,id) 지연FK; 공통승격은별도권한 |
| `document_pack_versions` | I,K; `pack_id text`,`version integer`,`document_type text`,`school_level text`,`academic_year_label text?`,`support_level text`,`manifest_sha256 text`,`manifest jsonb`,`validation_state text`,`created_by_user_id text`,`published_at timestamptz?`,`withdrawn_at timestamptz?` | R3. (scope_key,pack_id)→document_packs(scope_key,id); user→public.users.id; UQ(scope_key,pack_id,version),UQ(scope_key,pack_id,id); support validated_template/structure_reuse/content_draft; 검증 not_checked/needs_review/pass/error; 자산본문IMM,게시/철회상태는전용명령. manifest는버전고정자산계약이며기존확정manifest수정안함 |
| `document_pack_assets` | `scope_key text`,`pack_version_id text`,`role text`,`file_id text`,`sha256_snapshot text`,`position integer` | R3. PK(scope_key,pack_version_id,role,position); (scope_key,pack_version_id)→document_pack_versions(scope_key,id); (scope_key,file_id)→files(scope_key,id); role template/token_map/prompt/validator/sample; key는검증된부모판에서복사하며공통팩은공통file만; 임의학교file을공통팩에참조불가 |
| `document_validation_runs` | I,S; `document_version_id text`,`file_id text?`,`pack_scope_key text?`,`pack_version_id text?`,`validator_version text`,`input_sha256 text`,`state text`,`report_file_id text?`,`checked_at timestamptz`,`checked_by_member_id text?` | R3. 문서/파일/리포트동일학교FK; pack은MATCH FULL scope복합FK로common/본교만; state pass/needs_review/error; 같은실물hash+팩판만검사유효; report자체도원문동일권한; IMM |
| `document_version_sources` | I,S; `document_version_id text`,`purpose text`,`source_file_id text?`,`source_document_version_id text?`,`source_knowledge_scope_key text?`,`source_knowledge_revision_id text?`,`source_calendar_version_id text?`,`source_sha256 text`,`locator text`,`confirmed_by_member_id text`,`confirmed_at timestamptz` | R3, 해당모듈참조준비때열추가. purpose template/fact/style_example; typed source ID정확히하나; knowledge는(scope_key,id)→workhub_knowledge_revisions MATCH FULL이며common/본교만; 나머지대상doc/member/source는동일학교FK; 자기순환·AI생성문서를관찰원사실로역주입금지 |

학교 문서팩은 public/workhub 테이블과 정적 자산의 연결 목록일 뿐 `_hwpx`나 기존 양식 manifest를 다시 쓰지 않는다. 생성할 팩판·자산지문은 서버가 선택해 작업 입력에 고정한다. 프런트가 임의 bucket/path/template경로를 지정하지 못한다.

생성 작업은 공통 `workhub_jobs`와 문서 확장 `document_jobs`를 사용한다. `document_jobs`: I,S; `job_id text`, `owner_member_id text`, `document_id text`, `pack_scope_key text?`, `pack_version_id text?`, `input_document_version_id text?`, `output_document_version_id text?`, `input_sha256 text`, `requested_support_level text`, `school_scope_key`(§2.7 생성열). UQ(school,job_id); job는(school_scope_key,job_id)→workhub_jobs(scope_key,id), pack은MATCH FULL scope복합FK(common/본교만), 나머지는동일학교typedFK. input/output판은같은document, 작업actor/user/학교일치. requested_support_level은팩의3값중하나. 구조입력은 개인 초안 권한의 문서판으로 보관하고 공통 job log에 복제하지 않는다. lease/heartbeat/attempt/실패재개는 공통 jobs 계약만 사용한다.

최종 업로드는 새 files.id·새 document revision으로 만들고 이전 생성판의 pass를 복사하지 않는다. 검증 파일만 제출할 수 있는 수합이면 동일file hash의 유효 validation run을 요구하고, 일반 파일수합은 해당 문서팩 검사와 구분한다. 파일 업로드 허용과 AI 내용추출/원형보존 지원은 각각 표시한다. 작년 숫자·담당·날짜를 사실 근거로 확정하지 않는다.

## 13. 수합 내보내기와 접수증 — R1-D

`collection_exports`: I,S,V,T; `collection_id text`, `requested_by_member_id text`, `job_id text`, `selection_mode text`, `manifest_sha256 text`, `output_file_id text?`, `state text`, `school_scope_key`(§2.7 생성열). collection/member/file동일학교FK; (school_scope_key,job_id)→workhub_jobs(scope_key,id); mode current_received/effective/explicit_versions; state queued/running/succeeded/partial/failed/cancelled; UQ(school,job_id). export.state는공통job의결과를원자적으로투영하며독립적인두실행큐를만들지않는다.

`collection_export_items`: I,S; `export_id text`, `unit_id text`, `submission_id text`, `file_id text?`, `archive_path text`, `state text`, `error_code text?`, `sha256_snapshot text?`. export/unit/판/file동일학교FK, 제출판같은unit; UQ(school,export_id,archive_path); state queued/succeeded/failed/skipped; 파일없는응답도manifest항목으로포함; 경로는서버정규화·상위폴더탈출금지.

검토없음은 최신 유효 접수본, 검토있음은 선택한 접수본이 기본이다. **내려받기 기본판과 완료본 합계는 별도**다. 완료본만 선택한 내보내기는 mode=effective로 명시한다. ZIP 목록·파일명에는 단위·판·검토상태를 넣고 선택한 판 ID/hash를 고정한다. 작업 중 새판이 생겨도 자동으로 섞지 않는다. 시작·각 파일 추가·최종 파일 연결·다운로드 때 권한을 재검사한다. 접근 철회된 단위는 실패목록으로 남기며 이전 광범위 ZIP을 그대로 재발급하지 않는다.

공통 idempotency receipt는 operation과typed result ID를 유지하며 최종 접수증은 `submission_id`, unit/revision, server receipt_at, 당시 review_mode/state, request ID를 반환한다. 오래된 receipt를 다시 받는 것은 현재 검토상태가 당시와 같다는 뜻이 아니므로 현재 상태 조회를 함께 제공한다. 기존 task/calendar receipts는 이 공통표로 급히 이전하지 않는다.

## 14. RPC 명령·조회 계약과 잠금 순서

아래는 **신규 RPC 제안명**이다. 현재 공개된 함수 이름은 §1에서 그대로 유지한다. 명령 인자는 actor member, 명시 school scope, typed command, expected versions, request key이고, actor/school을 본문 값만으로 신뢰하지 않는다. 신규 명령은 알 수 없는 추가 입력 필드를 거부한다.

| RPC 묶음 | 주요 명령·결과 | 원자 적용/권한 |
|---|---|---|
| `workhub_duty_list`, `workhub_duty_assign`, `workhub_duty_item_mutate` | 공식배정·업무페이지·담당항목 | 배정승인권한/기간, 개인notes노출금지 |
| `workhub_audience_preview` | 조건+기준일→ID/이름/포함이유/제외수 | 현재열람허용명부만, 실패와0구분 |
| `workhub_calendar_query`, `workhub_calendar_transition` | cursor기간조회, 취소/복구/공식확정 | 기존save도동일공식상태검사, 임의공식확정금지 |
| `workhub_calendar_import_preview/apply`, `workhub_calendar_cutover` | 3방향차이/행별반영/기준전환 | source관리권한·판·권한·전환상태재검사 |
| `workhub_cooperation_mutate` | 요청/수락/거절/대체제안/완료 | 요청및수신자행동분리; 개인tasklink생성멱등 |
| `workhub_collection_list/get`, `workhub_collection_mutate` | 생성/초안수정/게시/닫기/취소/정책판 | 관리범위검사,게시대상snapshot한번 |
| `workhub_collection_unit_get`, `workhub_collection_draft_get/save` | 단위상태/공동또는개인초안 | 요청관리자에게초안존재도자동노출안함 |
| `workhub_collection_submit`, `workhub_collection_review` | 접수판/특정판검토 | 책임자/대리,지정검토자,자기검토차단 |
| `workhub_collection_correct`, `workhub_collection_withdraw`, `workhub_collection_exempt` | 정정창·보완연결·철회·면제 | 모드별pointer+의무+집계+감사같이 |
| `workhub_collection_export` | 고정판manifest+job ID | 요청자열람범위,partial재시도 |
| `workhub_notice_mutate/ack`, `workhub_notification_list/read` | 게시·명시확인·알림함 | 확인명단권한,본문원본재검사 |
| `workhub_file_init/complete/download`, `workhub_document_mutate/validate/export` | 업로드계약·검증파일·허용전송/판 | Storage실물검사·typed도메인관계·지원상태 |

목록 RPC는 학교+권한을 먼저 제한하고 cursor `(due_at,id)` 또는 `(updated_at,id)`를 반환한다. limit은 서버 상한을 적용하고 count는 같은권한조건으로 계산한다. 에러를 빈배열로 바꾸지 않는다. home은 개인업무·수합·일정 모듈별 `{status,data,asOf}`를 합치고 하나의 실패가 다른영역을지우지않는다.

새 도메인의 잠금 순서는 **관련 users ID 정렬→학교 권한 gate(공통 작업은 platform grant)→memberships ID 정렬→권한/정책 행→멱등키 advisory lock→근거 owner gate(학생/AI를 참조할 때)→업무 원본(종류/ID 정렬)→파일 ID 정렬→receipt/audit/outbox INSERT**다. 이 장의 업무 원본 종류 순서는 handover→collection→unit→draft로 고정하고 다른 모듈을 함께 변경할 때는 공통 정렬 순서를 먼저 등록한다. auth/gate 조회는 FOR SHARE, 권한 회수는 FOR UPDATE처럼 실제로 상호 충돌하는 잠금을 사용한다. FOR KEY SHARE만으로 non-key 권한 변경을 막았다고 하지 않는다. 기존 001/004를 이미 이 순서라고 주장하지 않으며 호환 변경은 별도 승인 후 회귀한다. 개별 명령·인계·권한 종료도 같은 순서를 따른다. create는 아직 원본 ID가 없어도 멱등 잠금을 먼저 확보하여 동시 재시도 두 건을 만들지 않는다. file purge는 업로드/첨부 명령과 같은 파일행 잠금을 사용한다. 검토/제출/철회는 unit행을 공통 잠금점으로 삼아 승인과 철회가 둘 다 성공하지 않게 한다. 대리와 권한 변경은 잠금 뒤 현재판을 다시 확인한다.

## 15. 수용 시험과 적용 전 남은 승인

| 시험 ID | 실제 DB에서 실행할 사례 | 통과 조건 |
|---|---|---|
| WD01 | 동일계정겸임2학교,같은학교관리자,종료소속으로task/초안/파일조회 | 0본문·0개인건수·0다운로드;멱등receipt로도우회불가 |
| WD02 | 기존calendar/task DTO·기존RPC 결과를신규기반에재실행 | 필드/버전/오류의호환;로그인회원hash변화없음 |
| WD03 | JSON대상↔정규표 왕복,OR/AND/직접추가/제외,진행중신규소속 | 양계층동등,private우선,자기신고권한상승불가 |
| WD04 | 일정공식미확정판저장·구save우회·취소·삭제 | 공식현재판/유효판분리,구RPC로정책우회안됨 |
| WD05 | 행정렬/삽입/제목수정/원본누락/매핑변경/양쪽수정/기준전환 | 안정ID보존,3방향근거재현,누락삭제안함,전환후구시트거부 |
| WD06 | 공동3인1단위·책임자2단위·동시게시2연결 | 의무1/2정확,게시중복없음,미제출초안비공개 |
| WD07 | 초안공동수정충돌·구성원제거·개인준비초안 | 최신판명시비교,삭제아닌권한회수,기존파일URL우회차단 |
| WD08 | 두연결동시제출·응답유실같은키·다른본문같은키 | 접수1판·한번version증가,충돌반환,권한재검사 |
| WD09 | required v1승인→v2보완→v2철회,보완재제출판철회 | effective v1유지+남은보완유지+현재지연3축정확 |
| WD10 | none v1→v2→철회,required승인본/외부처리판철회 | none둘다NULL과거복원없음,금지철회거부,가짜승인행없음 |
| WD11 | 숫자0/NULL/매우큰수·면제/복원·마감단축·새보완 | 0포함/NULL제외,정밀합계,면제분모제외,과거지연불변 |
| WD12 | 대리만료·자기검토·담당인계와제출경합;duty_item인계;문서/개인task인계시도 | 실제행동자보존,자기검토우회불가,의무ID/완료본유지,전부또는0적용;공식업무담당만변경,미지원문서/개인자료이전거부 |
| WD13 | 가짜확장자·hash/size불일치·압축한도·실물없는ready | 확정거부,파일저장만으로제출완료아님 |
| WD14 | 타인초안file_id를공지첨부·같은학교일반관리자가직접다운로드 | 도메인링크/원본권한검사로모두거부 |
| WD15 | 생성pass파일수정재업로드·다른학교팩·철회팩·문서근거정정 | 새파일/새검사필수,팩scope검사,needs_review표시 |
| WD16 | 알림중복·private전환·읽음만표시·푸시실패 | 알림1개,회수후제목비노출,확인/업무완료변경없음 |
| WD17 | ZIP중권한회수·파일누락·부분실패재시도 | 허용고정판만,실패목록과재시도분리,성공거짓표시없음 |
| WD18 | DB+파일복원후삭제원장재적용·소속종료재검사 | 삭제/차단자료재노출없음,실물까지복구증거 |
| WD19 | 같은학교같은교사의A/B단위초안ID·문항schema·선택지를교차전달 | 각본문열람가능해도부모복합FK/제약검사로거부,접수·파일연결0건 |
| WD20 | common학교NULL참조·다른학교팩/파일·공통지식미게시판참조 | scope_key FK로NULL우회불가,본교또는허용common만,게시/현재권한별도검사 |

자동 단위/PGlite 검증뿐 아니라 **독립 PostgreSQL 두 연결**로 WD06·08·12의 잠금 경합을 확인한다. Supabase Storage·서명 링크/인증 proxy·실제 OAuth·기존 회원 보존은 별도 운영 전 승인 환경 종단 증거가 필요하다. 이 문서 작성이나 로컬 테스트를 그 증거로 대체하지 않는다.

판단해서 제안한 사항: 수합은 문항·선택·단위·답변·파일을 관계형으로 분리하고 immutable snapshot JSON은 원본재현·manifest에만 제한했다. 개인업무를공유업무와분리해인계시개인메모유출을막았다. 기존JSON일정을즉시교체하지않고단일writer기준전환을명시했다. 구현착수전에 AP04의철회·면제·모드변경정책, 파일허용형식/한도·파기정책, 공통자료게시권한을 확정해야한다. 미승인 값을승인된DB기본값으로배포하지않는다.
