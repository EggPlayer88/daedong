# daedong-v2 DB 스키마 정의 (SCHEMA.md)

> 작성일: 2026-08-14 / 갱신: 2026-08-15 — 테이블 수 정정(16→17), D15~D17 반영 / 2026-08-16 — 15~16절 시간표 스키마를 v1 실측으로 교정 (정본: backup/v1_timetable_schema.sql) / 2026-08-18 — D20 가입 승인제로 users.is_active 이중 의미 명기
> 총 17개 테이블(시간표 2개 포함), 6개 도메인. RLS 패턴은 DECISIONS.md P4 의 3패턴 (personal / shared / admin-only).
> 모든 PK 는 TEXT, DEFAULT gen_random_uuid()::text (P2). 사용자 ID 는 auth.uid()::text.

---

## 도메인 조감도

```
[사용자]   users, departments
[일정/업무] schedules, tasks
[문서]     documents, document_labels, document_label_map, handover_docs
[학생]     students, class_groups, enrollments, observation_records
[학사]     academic_terms, academic_events
[대시보드] user_dashboard_config
[시간표]   timetables, timetable_changes (v1 스키마 이식, packages/timetable 전용)
```

핵심 관계:
```
users ──┬── schedules.assignee_id  ──→ [나의 할 일 위젯]
        ├── tasks.assignee_id      ──→ [나의 할 일 위젯]
        ├── observation_records.author_id (본인만)
        ├── handover_docs.owner_id
        └── class_groups.homeroom_teacher_id

students ── enrollments ── class_groups
    └── observation_records (student_id + enrollment_id)

class_groups.timetable_class_code (TEXT 참고, FK 없음) ─→ 시간표 CLS ('c1' 등)
```

---

## 1. users — 사용자 (auth.users 와 1:1)

```sql
CREATE TABLE users (
  id                TEXT PRIMARY KEY,              -- auth.users.id::text
  email             TEXT NOT NULL,
  name              TEXT NOT NULL,
  role              TEXT NOT NULL DEFAULT 'teacher'
                    CHECK (role IN ('superadmin','admin','department_head','teacher')),
  extra_permissions JSONB NOT NULL DEFAULT '[]',   -- 예: ["timetable_manage"]
  department_id     TEXT REFERENCES departments(id),
  is_active         BOOLEAN NOT NULL DEFAULT true, -- ⚠ D20 이후 이중 의미 (아래 참조)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: shared (본인 행은 본인 수정 가능하되 role/extra_permissions 는 admin+ 만 변경)
- ⚠ 위 컬럼 제한은 RLS 로 표현 불가 → BEFORE UPDATE 트리거 protect_privileged_columns 로 강제 (D16). is_active 도 보호 대상. SQL Editor 실행(auth.uid() 없음)은 통과 → superadmin 부트스트랩 경로 (D17)
- 신규 가입 시 handle_new_user 트리거로 자동 생성 (role='teacher' 기본)
- ⚠ **is_active 의 이중 의미 (D20, 임시)**: 003 이후 신규 가입은 `is_active=false`(**승인 대기**)로 생성되고 admin+ 가 승인해야 사용 가능하다. 기존 의미인 **퇴직·전출**도 같은 컬럼을 쓴다 — 임시 제도라 컬럼을 늘리지 않았다(P1). 화면에서는 `created_at` 으로 신규 대기와 비활성 처리를 구분한다. 제도 폐지 시 `status` 컬럼 분리를 검토
- INSERT 정책 없음(트리거 전용), DELETE 정책 없음(삭제 금지, is_active 로 관리)

## 2. departments — 부서

```sql
CREATE TABLE departments (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL,                 -- 교무부, 연구부, 학생안전부, 학생생활부, 진로부, 정보부
  head_id    TEXT REFERENCES users(id),     -- 부장
  sort_order INT NOT NULL DEFAULT 0
);
```
- RLS: shared (편집 admin+)
- 시드: v1 의 부서 6개
- head_id 는 users 와 순환 참조 → 001 에서 departments(head_id 없이) → users → ALTER 순서로 생성

## 3. schedules — 일정 관리 (스프레드시트형)

```sql
CREATE TABLE schedules (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  date          DATE NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT,
  assignee_id   TEXT REFERENCES users(id),      -- 담당자. "나의 할 일" 자동 소환 키
  department_id TEXT REFERENCES departments(id),
  created_by    TEXT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: shared (전체 조회, 수정은 작성자 + admin+)
- 나의 할 일 자동 소환 = assignee_id = 나 인 행 조회. **복사 없음, 단일 진실.**

## 4. tasks — 할 일 (부여 + 개인)

```sql
CREATE TABLE tasks (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title       TEXT NOT NULL,
  assignee_id TEXT NOT NULL REFERENCES users(id),
  assigner_id TEXT REFERENCES users(id),   -- NULL 이면 본인이 직접 추가한 것
  due_date    DATE,
  is_done     BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: personal 변형 — assignee 본인 + assigner + admin+ 조회. 완료 체크는 assignee.
- 부여 권한: department_head 는 자기 부서원에게, admin+ 는 전체에게.
- 대시보드 위젯 = tasks(내 것, 미완료) + schedules(담당=나, 다가옴) 두 쿼리 합성.

## 5. documents — 업무 문서 총정리 (v1 문서관리 통합)

```sql
CREATE TABLE documents (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title       TEXT NOT NULL,
  description TEXT,
  file_path   TEXT NOT NULL,     -- Supabase Storage 경로
  file_name   TEXT NOT NULL,
  file_size   INT,
  mime_type   TEXT,
  uploaded_by TEXT REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: shared 변형 — 조회/다운로드 전체, **INSERT/UPDATE/DELETE 는 admin+**
- Storage 버킷: documents (동일 정책)

## 6. document_labels + document_label_map — 라벨

```sql
CREATE TABLE document_labels (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name       TEXT NOT NULL UNIQUE,
  color      TEXT,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE document_label_map (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  label_id    TEXT NOT NULL REFERENCES document_labels(id) ON DELETE CASCADE,
  PRIMARY KEY (document_id, label_id)
);
```
- RLS: shared (라벨 생성/편집 admin+)

## 7. handover_docs — 업무 인수인계

```sql
CREATE TABLE handover_docs (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  duty_name   TEXT NOT NULL,          -- 업무명. v1 "업무 종류" 데이터가 시드로 들어감
  content     TEXT,                   -- 마크다운 본문
  owner_id    TEXT REFERENCES users(id),  -- 현재 담당자
  attachments JSONB NOT NULL DEFAULT '[]', -- Storage 경로 배열
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: shared (조회 전체, 수정 owner + admin+)

## 8. class_groups — 학급 (생기부 도메인, 연도별)

```sql
CREATE TABLE class_groups (
  id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  year                 INT NOT NULL,           -- 2026
  grade                INT NOT NULL,           -- 1,2,3
  class_no             INT NOT NULL,           -- 1,2,3
  homeroom_teacher_id  TEXT REFERENCES users(id),
  timetable_class_code TEXT,                   -- 'c1' 참고용. FK 없음 (D11)
  UNIQUE (year, grade, class_no)
);
```
- RLS: shared (편집 admin+)
- 매년 새 연도 학급을 새 레코드로 생성 (2026년 1-1 과 2027년 1-1 은 다른 행)

## 9. students — 학생 본체 (재학 기간 내내 불변)

```sql
CREATE TABLE students (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name           TEXT NOT NULL,
  birth_date     DATE,                        -- 동명이인 구분용 (선택)
  admission_year INT NOT NULL,                -- 입학년도
  status         TEXT NOT NULL DEFAULT 'enrolled'
                 CHECK (status IN ('enrolled','graduated','transferred_out','withdrawn')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- **반 정보 없음.** 진급/반편성이 바뀌어도 이 레코드는 불변.
- 졸업/전출 시 status 만 변경. **삭제 금지** (생기부 보존 원칙).
- RLS: shared 조회 (교사 전체), 편집 admin+
- 등록: 관리자 엑셀 업로드 (학년, 반, 학번, 이름 형식)

## 10. enrollments — 소속 (학생-학급 연결, 학적 이력)

```sql
CREATE TABLE enrollments (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id     TEXT NOT NULL REFERENCES students(id),
  class_group_id TEXT NOT NULL REFERENCES class_groups(id),
  student_no     INT NOT NULL,                -- 그 해의 번호
  UNIQUE (student_id, class_group_id)
);
```
- "홍길동은 2026년 1-1반 3번" = 레코드 1개. 3년 재학 = 레코드 3개 (학적 이력).
- 진급 처리 = 새 enrollment INSERT (기존 레코드 불변).
- RLS: shared 조회, 편집 admin+

## 11. observation_records — 누가기록

```sql
CREATE TABLE observation_records (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  student_id    TEXT NOT NULL REFERENCES students(id),
  enrollment_id TEXT REFERENCES enrollments(id),  -- 기록 당시의 소속 (역사 보존)
  author_id     TEXT NOT NULL REFERENCES users(id),
  record_type   TEXT NOT NULL CHECK (record_type IN ('subject','homeroom')),
  subject_name  TEXT,                             -- record_type='subject' 일 때
  content       TEXT NOT NULL,
  observed_at   DATE NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```
- RLS: **personal — author_id = auth.uid()::text 만 조회/수정/삭제** (D12)
- 교과 기록은 교과교사가, 학급 기록은 담임이 작성 (record_type 으로 구분)
- 생기부 초안 AI 는 본인 작성 기록만 재료로 사용 (RLS 와 자연 일치)

## 12. academic_terms — 학기

```sql
CREATE TABLE academic_terms (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  year       INT NOT NULL,
  semester   INT NOT NULL,
  start_date DATE,
  end_date   DATE,
  UNIQUE (year, semester)
);
```
- RLS: shared (편집 admin+)

## 13. academic_events — 학사일정

```sql
CREATE TABLE academic_events (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  term_id    TEXT REFERENCES academic_terms(id),
  title      TEXT NOT NULL,
  event_type TEXT CHECK (event_type IN ('event','holiday','vacation','exam')),
  start_date DATE NOT NULL,
  end_date   DATE
);
```
- RLS: shared (편집 admin+)
- UI: 학기 단위 표로 행사/공휴일/방학/시험 한눈에

## 14. user_dashboard_config — 대시보드 위젯 설정

```sql
CREATE TABLE user_dashboard_config (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  layout  JSONB NOT NULL DEFAULT '[]'
  -- 예: [{"widget":"my_tasks","order":1,"visible":true}, ...]
);
```
- RLS: personal
- Phase 1 위젯 4종: my_tasks(나의 할 일), today_timetable(오늘 시간표), upcoming_events(다가오는 학사일정), recent_documents(최근 문서)

## 15~16. 시간표 도메인 — v1 스키마 이식

> **⚠ 정본은 `backup/v1_timetable_schema.sql`** (2026-08-16, 000 초기화 직전 실측).
> 아래는 요약이며, 010 작성 시에는 반드시 그 파일을 기준으로 한다.
> (2026-08-16 교정: 이 절에 `effective_date` 라고 적혀 있었으나 실측 결과 그런 컬럼은 없고,
> `effective_from`/`effective_until` + `parent_id` + `status` 로 구성된 **버전 워크플로우**였다.
> 교훈 3 — 문서 맹신 금지의 실사례.)

```sql
-- timetables (실측 요약)
--   id UUID PK, name, effective_from DATE NOT NULL, effective_until DATE,
--   parent_id UUID → timetables(id) 자기참조, edit_log JSONB,
--   status TEXT CHECK ('active'|'superseded'|'rolled_back'|'draft'),
--   is_active BOOLEAN + 부분 유니크 인덱스(활성본은 전체에서 1개만),
--   data JSONB NOT NULL (최상위 키 c1~c8), created_by, created_at, updated_at

-- timetable_changes (실측 요약) — 변경 요청 승인 워크플로우
--   id UUID PK, type CHECK ('swap'|'substitute'|'self_study'|'period_move'),
--   status CHECK ('pending'|'awaiting_partners'|'awaiting_admin'|'approved'|'rejected'|'cancelled'),
--   source_* 6개, payload/partner_status JSONB, requester/approver/rejected_by,
--   supersession_status CHECK, superseded_by UUID → timetables(id), 알림 필드 2개,
--   reason, is_admin_direct, created_at, updated_at
```
- PK 가 **UUID** — v2 의 P2(TEXT PK)와 다르지만 "v1 스키마 그대로 복제" 결정에 따라 010 에서도 uuid 유지 (격리된 도메인이라 무해)
- packages/timetable 만 접근. v1 의 subjects/classes/teachers/teacher_assignments 테이블은 v2 로 가져오지 않음 (진실의 원천이 timetableData.js 이므로, P5 예외 조항)
- **RLS 는 v1 것을 복제하지 않는다** — P4 3패턴 + `has_extra_permission('timetable_manage')` 로 새로 설계
- 011_timetable_domain.sql 작성 시 `backup/v1_timetable_schema.sql` 을 그대로 복제 + 001 의 `set_updated_at()` 트리거 부착 (시드 010 · 시간표 011 — 003 가입 승인제 삽입으로 한 칸씩 밀림)
- 데이터: `backup/v1_timetables_data.csv` 의 최신 초안(7/29) `data` JSONB 재주입 시 솔버 재실행 불필요

---

## 17. doc_ai_conversations — 문서작성 AI 대화 (004, 실행 완료)

```sql
CREATE TABLE doc_ai_conversations (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id    TEXT NOT NULL REFERENCES users(id),
  doc_type   TEXT NOT NULL DEFAULT 'evaluation_plan',
  subject    TEXT,
  grade      INT,
  title      TEXT,                          -- 목록 표시용. 교과·학년에서 자동 생성
  messages   JSONB NOT NULL DEFAULT '[]',   -- [{role, content}, ...] 전문
  status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed')),
  created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
);
```
- **RLS: personal — 본인 행만. admin 열람도 없다.** 작성 중인 평가계획서는 교사의
  사적 공간이라 권한 상승으로도 열지 않는다. insert 에만 `is_approved()` 를 함께 건다(D20)
- id 는 **클라이언트가 만든다** — 첫 교환부터 upsert 하기 위해서다
- 인사만 오간 대화는 저장하지 않는다 (/doc-ai 를 열 때마다 빈 행이 쌓이지 않게)
- 문서 생성이 끝나면 `status='completed'` 로 표시. 대화는 남아 다시 열 수 있다
- 다른 AI(업무 비서)의 대화는 이 표에 넣지 않는다. `doc_type` 은 평가계획서 외
  문서 종류가 늘어날 때를 위한 자리다

## AI 관련 (Phase 2 에서 추가 검토)

- 업무 비서(assistant) 대화 저장은 아직 없다. 필요해지면 별도 테이블로 —
  문서작성 AI 와 수명·삭제 정책이 다르므로 한 표에 섞지 않는다.
