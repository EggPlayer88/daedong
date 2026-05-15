# 🏗️ 시스템 구조 (ARCHITECTURE)

대동여중 업무혁신시스템의 기술적 구조를 정리한 문서입니다.

---

## 1. 기술 스택

| 영역 | 기술 |
|------|------|
| 프론트엔드 | React 18 + Vite |
| 백엔드 | Vercel Serverless Functions (Node.js ESM) |
| 데이터베이스 | Supabase (PostgreSQL + RLS) |
| AI | Anthropic Claude API (Claude Sonnet 4) |
| 호스팅 | Vercel (자동 빌드/배포) |
| 코드 저장소 | GitHub `EggPlayer88/daedong` |

---

## 2. 페이지 구조

### 사이드바 메뉴 (`App.jsx` 의 `commonMenus` + `adminMenus`)

**모든 교사 공통**:
- 🏠 대시보드 (`DashboardPage`, 정리 2-B 재설계: 좌우 분할 + 메모장 + AI 임베드)
- 📋 나의 할 일 (이전 채팅 작업)
- 📅 일정관리 (`SchedulePage`, 정리 2-A 폼 보강)
- 📁 문서함 (`DocumentsPage`, 이전 채팅 작업)
- 🤖 AI 업무 비서 (`ChatView` 단독 페이지, 대시보드 임베드와 컴포넌트 공유)

**관리자 (시간표관리자 + 슈퍼관리자)**:
- 🗓️ 시간표 관리 (`TimetablePage`, 솔버 + Supabase 저장)
- 📅 시간표 보기 (신) (`TimetableViewer`, 메인 페이지)
- 🗂️ 시간표 목록 (`TimetablesListPage`, 드래프트/활성/이전 관리)
- 📆 학사일정 (`SchoolCalendarPage`)

---

## 3. 시간표 시스템의 페이지 흐름

```
🗓️ 시간표 관리(구)              📅 시간표 보기(신)             🗂️ 시간표 목록
    │                              │                                 │
[솔버 실행]                  [활성 시간표 표시]              [모든 시간표 조회]
    │                              │                                 │
[솔버 결과 useState]         [학급/교사 뷰]                  [활성/드래프트/이전]
    │                        [주차 네비게이션]               분리 표시
[📥 Supabase 저장]           [캘린더 오버레이]                       │
    │                        [변동 적용]                       [클릭 시 미리보기]
    │                              │                          [드래프트 활성화]
[draft 또는 active]                │                          [드래프트 삭제]
    │                              │
    └────[활성화 시]─────────────►[자동 인식]
                                                            
                              [본인 셀 클릭 시]
                              [변동 요청 폼]
                                    │
                              [4가지 type]
                              [AI 추천 옵션]
                                    │
                              [2단 승인 흐름]

                              [관리자 모드 토글]
                                    │
                              [모든 셀 클릭 가능]
                              [직권 변경 즉시 적용]
                                    │
                              [영향받는 교사 사후 통보]

                              [AI 사이드 챗봇]
                                    │
                              [일반 모드: 일반 교사 AI]
                              [관리자 모드: tool use 기반 관리자 AI]
                              [관리자 AI: 검증/통계/제안 도구]
```

---

## 4. 데이터 모델 (Supabase 테이블)

### `timetables` — 시간표 마스터

```sql
id              UUID PRIMARY KEY
name            TEXT
status          TEXT  -- 'draft' | 'active' | 'superseded' | 'rolled_back'
is_active       BOOLEAN  -- true 인 row 는 한 번에 1개만 (UNIQUE INDEX)
effective_from  DATE
effective_until DATE
parent_id       UUID  -- 편집의 부모 (편집 시 새 row 생성, parent 가리킴)
edit_log        JSONB  -- 편집 이력 (Phase 4C-3 에서 누적)
data            JSONB  -- 시간표 데이터 (위 형식)
created_by      TEXT   -- 원래 UUID 였으나 003 마이그레이션으로 TEXT
created_at      TIMESTAMPTZ
updated_at      TIMESTAMPTZ
```

`data` 형식 예:
```json
{
  "c1": { "월-1": {"sid":"s1","tid":"t2"}, ... },
  "c2": { ... }
}
```

### `timetable_changes` — 변동 요청

```sql
id                  UUID PRIMARY KEY
type                TEXT  -- 'swap' | 'substitute' | 'self_study' | 'period_move'
status              TEXT  -- 'pending' | 'awaiting_partners' | 'awaiting_admin' | 'approved' | 'rejected' | 'cancelled'
source_date         DATE
source_class_id     TEXT
source_day          TEXT  -- '월'~'금'
source_period       INTEGER
source_teacher_id   TEXT
source_subject_id   TEXT
payload             JSONB  -- type 별 추가 정보
partner_status      JSONB  -- { tid: 'pending'|'approved'|'rejected', ... }
requester_id        TEXT
approver_id         TEXT
approved_at         TIMESTAMPTZ
rejected_by         TEXT
rejection_reason    TEXT
reason              TEXT
is_admin_direct     BOOLEAN  -- 직권 변경이면 true (승인 단계 skip)
created_at          TIMESTAMPTZ
```

`payload` 의 type 별 구조:

```json
// swap
{ "partners": [{"class_id","day","period","teacher_id","subject_id"}, ...] }

// substitute
{ "substitute_teacher_id": "t12", "ai_recommended": false }

// self_study
{ "supervisor_teacher_id": "t4" }   // 없으면 결강 (감독 없음)

// period_move
{ "target_class_id": "c1", "target_day": "수", "target_period": 5 }
```

### `school_calendar` — 학사일정

```sql
date              DATE PRIMARY KEY
type              TEXT  -- 'normal' | 'exam' | 'holiday' | 'event' | 'no_school'
note              TEXT
affected_classes  TEXT[]  -- NULL = 전교, 배열 = 특정 학급만
created_by        TEXT
```

### `notifications` — 알림

```sql
id          UUID PRIMARY KEY
user_id     TEXT NOT NULL
request_id  UUID  -- timetable_changes.id 참조
kind        TEXT  -- 'partner_request' | 'admin_review' | 'approved' | 'rejected' | 'admin_notice'
message     TEXT
read        BOOLEAN
read_at     TIMESTAMPTZ
created_at  TIMESTAMPTZ
```

### `teachers` — 사용자 (이전 채팅 작업)

```sql
id        UUID PRIMARY KEY
name      TEXT
email     TEXT
role      TEXT  -- 'teacher' | 'timetable_admin' | 'super_admin' | 'pending'
status    TEXT  -- 'approved' | 'pending' | 'rejected'
dept      TEXT
...
```

---

## 5. 정적 데이터 (`src/lib/timetableData.js`)

코드에 박혀있는 학교 운영 데이터. Phase 4 까지는 코드 상수, Phase 5 이후 DB 로 옮길 예정.

### Exports

```javascript
export const DAYS = ['월','화','수','목','금'];
export const DP = { 월:6, 화:7, 수:6, 목:7, 금:6 };  // 요일별 최대 교시
export const SP = [{ name:'창체', day:'목', p:7 }];   // 특별활동

export const SBJ = [   // 과목 (SUBJ 아님!)
  { id: 's1', name: '국어', ci: 1, gh: { 1: 4, 2: 4, 3: 4 } },
  // gh = grade hours = 학년별 표준 시수
];

export const TCH = [   // 교사
  { id: 't2', name: '국어T2', subject: '국어',
    as: [{ s: 's1', c: 'c1', h: 4 }, ...] },  // 학급 배정
  // as = assignments
];

export const CLS = [   // 학급
  { id: 'c1', name: '1-1' },
  { id: 'c2', name: '1-2' },
  ...
];

export const CLR = [...];  // 색상 팔레트

// 조회 함수
export const gS = (id) => SBJ.find(s => s.id === id);
export const gT = (id) => TCH.find(t => t.id === id);
export const gC = (id) => CLS.find(c => c.id === id);
```

### 시드 시간표에 등장하는 교사 (중요)

`002_seed_data.sql` 이 시간표 시드 만들 때 사용하는 교사 ID:
- `t2` (국어T2), `t7` (수학T1), `t20` (영어T2), `t12` (과학T2), `t4` (사회), `t14` (체육T2)

이 6명만 시뮬레이션 페르소나로 등록되어 있어요. 다른 교사 페르소나로 전환하면 본인 셀이 안 보입니다.

---

## 6. 변동 요청 흐름

### 일반 교사 (교사 모드)

```
1. 시간표 보기 → 본인 셀 클릭
2. ChangeRequestForm 진입
3. 4가지 type 중 선택 (swap/substitute/self_study/period_move)
4. AI 추천 (선택) 또는 직접 선택
5. 사유 입력 → 제출
6. status: awaiting_partners (파트너 있으면) 또는 awaiting_admin
7. 파트너 교사들이 알림 받음 → 승인/반려
8. 모두 승인 시 status: awaiting_admin
9. 시간표관리자가 알림 받음 → 승인/반려
10. 승인 시 status: approved → 시간표에 자동 반영
```

### 관리자 (관리자 모드)

```
1. 시간표 보기 → 관리자 모드 토글
2. 모든 셀 클릭 가능
3. ChangeRequestForm 진입 (보라색 테마, "직권 변경" 배지)
4. 폼 작성 → 제출
5. status: approved 즉시 (is_admin_direct = true)
6. 영향받는 교사들에게 admin_notice 알림 발송
```

---

## 7. AI 시스템

### 일반 교사 AI (`api/timetable-chat.js`)

- 시간표 도메인 특화 챗봇
- 사용자 질문 + 시간표 컨텍스트(주차 시간표, 변동, 캘린더, 사용자 정보) 를 시스템 프롬프트로 묶어 Claude 에 전달
- 본인/다른 교사 시간표 조회, 변동 흐름 안내, 통계 등 지원
- **권한 외 요청은 거절**: 시간표 직접 수정, 다른 교사 변동 대신 만들기 등

### 관리자 AI (`api/admin-chat.js`)

- Tool use 기반 (Claude API 의 tool use 기능)
- 5개 도구 (`api/_adminTools.js`):
  1. `validate_timetable` — 시수/충돌 검증
  2. `query_change_stats` — 변동 통계
  3. `analyze_substitute_load` — 보강 부담 분석
  4. `find_available_teachers` — 빈 교사 찾기
  5. `propose_change` — 변동 제안 (UI 카드로 표시 → 사용자 클릭 시 적용)
- Tool use 루프: max 5 회
- 변경은 항상 propose 만, 적용은 사용자 클릭

### AI 추천 (보강/이동, `api/recommend-*.js`)

- 두 단계 처리:
  1. **결정론적**: 빈 교사/슬롯 추출 + 휴리스틱 점수
  2. **Claude**: 상위 후보의 자연어 사유 생성
- API 키 없거나 호출 실패 시 휴리스틱 사유로 fallback

---

## 8. 사이드바 빨간 점 / 알림

`TimetableViewer` 가 30초마다 알림 카운트 폴링.
미확인 알림 카운트를 `window.dispatchEvent('timetable:unread-count', { count })` 로 발송.
`App.jsx` 의 `Sidebar` 가 그 이벤트 받아서 시간표 메뉴 옆에 빨간 숫자 배지 표시.

페이지 떠날 때 자동으로 count 0 으로 초기화 (stale 카운트 방지).

---

## 9. 마이그레이션 이력

### 001_phase1_timetable.sql

4개 테이블 생성: `timetables`, `timetable_changes`, `school_calendar`, `notifications`.
모든 외래키 컬럼은 UUID.
RLS 비활성화 (Phase 6 에서 정책 작성 예정).

### 002_seed_data.sql

- 9학급 (1학년 3개, 2학년 3개, 3학년 3개) 시드 시간표 (회전 패턴)
- 5월 캘린더: 휴일 3개(1, 5, 25일), 행사 2개(13, 20일), 시험 3일(27, 28, 29일)
- 시간표는 `is_active = true` 로 저장

### 004_create_events.sql

정리 작업 1: `events` 테이블 생성. SchedulePage / DashboardView / MyScheduleView / api/chat.js 가 의존하는 일정 테이블 누락(404) 해결.

기존 코드 안에서 `events`(SchedulePage) 와 `schedules`(나머지) 가 분리되어 있던 것을 `events` 로 통일.
`date → start_date`, `visibility → scope` 컬럼 매핑 + schedules 의 `priority/tags/dept` 흡수.

### 005_add_event_columns.sql

정리 작업 1 보강. 운영 환경 events 테이블이 이미 존재해 004 의 `CREATE TABLE IF NOT EXISTS` 가 효과 없는 문제 해결. `ALTER TABLE` 로 priority/tags/dept 컬럼만 보강.

### 006_migrate_scope_to_tags.sql

정리 작업 2-A. `scope` 컬럼을 코드에서 제거하고 `tags` 로 단일화하는 과정의 데이터 보강.
`scope='all'` 이면서 `tags` 가 NULL/빈 배열인 기존 일정에 `tags=['전체']` 자동 채움.
`scope` 컬럼 자체는 DROP 하지 않고 보존 (롤백 가능성). 코드는 더 이상 scope 를 사용 안 함.

새 규칙:
- `tags=['전체', ...]` → 공유 일정
- `tags=[]` → 개인 일정 (본인만)

### 007_create_notes.sql

정리 작업 2-B. 대시보드 메모장용 `notes` 테이블 생성.
사용자당 1행 (user_id PK), content (TEXT), updated_at. upsert 로 자동 저장.
RLS 는 Phase 6 인증 통합과 함께 설정.

### 003_phase2_relax_types.sql

UUID → TEXT 마이그레이션. 시뮬레이션 페르소나 't2', 'admin' 같은 문자열 사용 가능하게.
Phase 6 인증 통합 시 되돌릴 예정.

영향 컬럼:
- `timetable_changes.requester_id`, `approver_id`, `rejected_by`
- `notifications.user_id`
- `timetables.created_by`
- `school_calendar.created_by`

---

## 10. 환경변수

### Vercel 환경 변수 (Production + Preview)

| 이름 | 용도 | 가시성 |
|------|------|--------|
| `VITE_SUPABASE_URL` | 클라이언트 Supabase 연결 | Public (VITE_ 접두사) |
| `VITE_SUPABASE_ANON_KEY` | 클라이언트 익명 키 | Public |
| `VITE_GOOGLE_CLIENT_ID` | Google 로그인 | Public |
| `SUPABASE_SERVICE_ROLE_KEY` | API 라우트 서버 키 | Sensitive |
| `ANTHROPIC_API_KEY` | Claude API | Plain (Sensitive 권장 알림) |

`VITE_` 접두사는 Vite 가 클라이언트 번들에 포함시킨다는 의미. 서버 전용 키는 접두사 없이.

### 로컬 개발용

`.env.local` 파일에 같은 값들 (gitignore 됨).

---

## 11. 알려진 이슈

### schedules 테이블 404

대시보드 / 나의 할 일 페이지가 `schedules` 테이블 조회하는데 그 테이블이 Supabase 에 없음. 이전 채팅의 일정 관리 기능이 거기 의존. 콘솔 에러 발생하지만 시간표 시스템과는 무관.

**해결책 후보**: Phase 5+ 어딘가에서 `schedules` 테이블 만들기 또는 호출부 제거.

### 시간표 관리(구) - 시간표 보기(신) 미통합

기존 `TimetablePage` 와 새 `TimetableViewer` 가 별도 메뉴. 사용자가 어디서 어떻게 작업할지 헷갈릴 수 있음.

**해결책 후보**: Phase 5+ 에서 통합. 솔버 기능을 새 페이지로 흡수.

### 시드 시간표가 학년별 표준 시수와 안 맞음

`002_seed_data.sql` 의 회전 패턴이 표준 시수 (timetableData.js 의 gh) 와 안 맞아서 시수 검증 시 불일치 다수 발견됨. 실제 시간표 (솔버 결과) 로 교체 시 해결.
