# daedong-v2 실행 로드맵 (ROADMAP.md)

> 작성일: 2026-08-14 / 갱신: 2026-08-15 — 001·002 확정본 배치, D17 승격 단계 추가, 핸드오프 갱신 / 2026-08-16 — v1 판정 반영, 시드↔시간표 번호 스왑(009/010) / 2026-08-16 — **Phase 0 완료** (배포: https://daedong-school.vercel.app), D18 인프라 재사용 반영
> Phase 0 → 4 순서로 진행. 각 Phase 는 완료 기준을 충족해야 다음으로.

---

## 모노레포 구조 (목표 형태)

```
daedong-v2/
├── package.json                   ← npm workspaces 루트
├── apps/
│   └── main/                      ← 업무시스템 (Vercel 배포 대상)
│       ├── src/
│       │   ├── pages/             ← 페이지 컴포넌트
│       │   ├── components/        ← 페이지 전용 컴포넌트
│       │   ├── widgets/           ← 대시보드 위젯
│       │   ├── ai/                ← AI 비서 + 문서작성 AI
│       │   └── lib/               ← main 전용 유틸
│       ├── vite.config.js
│       └── package.json
├── packages/
│   ├── timetable/                 ← 시간표 (v1 에서 이식, 독립 경계)
│   │   ├── src/
│   │   │   ├── components/        ← TimetableViewer, SolverModal 등
│   │   │   ├── lib/               ← solver.js, timetableData.js, timetableExport.js
│   │   │   └── index.js           ← 공개 API
│   │   └── package.json
│   └── shared/                    ← 공통 기반 (최하층)
│       ├── src/
│       │   ├── supabase.js        ← DB 클라이언트 (유일한 접근점)
│       │   ├── auth.js            ← 인증 헬퍼
│       │   ├── permissions.js     ← can(user, 'action')
│       │   └── constants.js       ← 역할 목록 등
│       └── package.json
├── migrations/                    ← 001~ SQL + README.md (실행 기록)
└── docs/                          ← DECISIONS.md, SCHEMA.md, ROADMAP.md, PHASE0_GUIDE.md
```

## 페이지 ↔ 테이블 ↔ 권한 매핑

| 라우트 | 페이지 | 사용 테이블 | 노출/권한 |
|--------|--------|------------|----------|
| / | 대시보드 | 위젯별 상이 + user_dashboard_config | 전체 |
| /timetable | 시간표 조회 | timetables | 전체 |
| /timetable/manage | 시간표 관리 | timetables, timetable_changes | extra_permissions "timetable_manage" |
| /schedules | 일정 관리 | schedules | 전체 (편집: 작성자+admin) |
| /documents | 업무 문서 총정리 | documents, document_labels | 전체 (업로드: admin+) |
| /handover | 업무 인수인계 | handover_docs | 전체 (편집: owner+admin) |
| /records | 생활기록부 도우미 | students, enrollments, observation_records | teacher+ |
| /doc-ai | 문서 작성 AI | documents(참조) | 전체 |
| /calendar | 학사일정 | academic_terms, academic_events | 전체 (편집: admin+) |
| /admin/users | 사용자 관리 | users, departments | admin+ |
| /admin/students | 학생 관리 | students, enrollments, class_groups | admin+ |
| (토글 오버레이) | AI 업무 비서 | — | 전체 |

메뉴에서 제외: 나의 할 일 (대시보드 위젯), 문서관리 (documents 통합), AI 비서 (토글)

## 마이그레이션 순서

```
000_reset_v1_project.sql       -- v1 프로젝트 초기화 (D18, 재사용 전제). 블록 단위 실행
001_users_departments.sql      -- users, departments + RLS + handle_new_user 트리거
002_schedules_tasks.sql        -- schedules, tasks + RLS
003_documents.sql              -- documents, labels, label_map + Storage 버킷 + RLS
004_handover.sql               -- handover_docs + RLS
005_students.sql               -- students, class_groups, enrollments + RLS
006_observations.sql           -- observation_records + RLS (personal!)
007_academic.sql               -- academic_terms, academic_events + RLS
008_dashboard.sql              -- user_dashboard_config + RLS
009_seed.sql                   -- 부서 6개 + 2026-2 term (확정본 있음. Phase 1 말 실행. 업무종류는 샘플 판정으로 폐기, 계정은 D17)
010_timetable_domain.sql       -- v1 시간표 스키마 복제 (timetables, timetable_changes) — Phase 2
```

---

## Phase 0 — 기반 ✅ 완료 (2026-08-16)

- [x] v1 DB 에서 "업무 종류" 데이터 조회 → 백업 (샘플 판정·폐기, backup/ 보존)
- [x] repo daedong-v2, npm workspaces 모노레포 셋업 (apps/main, packages/shared, packages/timetable)
- [x] docs/ 에 DECISIONS.md, SCHEMA.md, ROADMAP.md, PHASE0_GUIDE.md 배치
- [x] ~~새 Supabase 프로젝트 생성~~ → **v1 프로젝트 초기화 후 재사용 (D18, 000 실행)**
- [x] (추가) v1 시간표 스키마 실측 백업 — Phase 2 의 010 재료 (backup/v1_timetable_schema.sql)
- [x] Google OAuth 설정 — redirect URL 에 배포 URL + `http://localhost:5175/**` **둘 다** (v1 교훈 1)
- [x] 001, 002 마이그레이션 실행 + README 기록 ([검증] 통과)
- [x] shared 패키지 (supabase.js, auth.js, permissions.js, constants.js)
- [x] 로그인 → 빈 대시보드 → 사용자 관리 뼈대
- [x] 첫 로그인 후 superadmin 승격 UPDATE 1회 (D17 부트스트랩)
- [x] Vercel 배포 연결 — **v1 프로젝트 재사용, Root Directory `apps/main` (D18)**

**완료 기준 달성: 배포 사이트 https://daedong-school.vercel.app 에서 로그인 → superadmin 확인 완료**

## Phase 1 — 일상 코어 (2~3세션)

- [ ] 003, 004, 007, 008 마이그레이션 + 009 시드 실행 (009 확정본 migrations/ 에 있음)
- [ ] 일정 관리 (스프레드시트형 UI, 담당자 지정)
- [ ] tasks + 나의 할 일 위젯 (schedules 합성)
- [ ] 업무 문서 총정리 (업로드/라벨/다운로드, admin 업로드 제한)
- [ ] 학사일정 (학기 표 UI)
- [ ] 대시보드 위젯 4종 (my_tasks, today_timetable 자리만, upcoming_events, recent_documents)

**완료 기준: 계란님 혼자 일상 업무에 실사용 시작 가능**

## Phase 2 — 차별화 기능 (3~4세션)

- [ ] 010 마이그레이션 (시간표 도메인)
- [ ] packages/timetable 로 v1 시간표 코드 이식 (solver, viewer, export, manage)
- [ ] /timetable, /timetable/manage 탑재 + extra_permissions 체크
- [ ] AI 업무 비서 (토글 오버레이, 페이지 컨텍스트 주입)
- [ ] hwpx 생성 기술 검토 (브라우저 vs 서버) — **구현 전 검토 필수**
- [ ] 문서 작성 AI (문서 종류 선택 → 참조 문서 선택 → 대화형 작성 → hwpx 다운로드)
- [ ] AI 비서 → 문서작성 AI 프롬프트 전달 연동

**완료 기준: v1 의 핵심 가치 전부 v2 로 이전**

## Phase 3 — 생기부 + 확장 (2~3세션)

- [ ] 005, 006 마이그레이션
- [ ] /admin/students: 학급 생성, 학생 엑셀 업로드, enrollment 관리
- [ ] /records: 누가기록 작성 UI (학급별/교과별)
- [ ] 생기부 초안 AI (본인 작성 기록만 재료)
- [ ] /handover: 업무 인수인계 (빈 상태로 시작 — v1 샘플 5건은 backup/ 에 양식 참고용 보존)

**완료 기준: 다른 교사에게 시범 오픈 가능**

## Phase 4 — 운영 준비

- [ ] 진급 마법사 (연도 전환: 새 학급 생성 → 진급 엑셀 → 졸업 처리 → 신입생)
- [ ] 대시보드 편집 고도화
- [ ] v1 폐기 (데이터 최종 확인 후)

---

## 핸드오프 기록

> **아래는 Phase 0 지시서 — 2026-08-16 완료됨. 기록용으로 보존.**
> Phase 1 지시서는 Phase 1 착수 시점에 작성한다 (003·004·007·008 + 009 시드 + 일상 코어).

```
[daedong-v2 프로젝트 시작 — Phase 0]

배경: v1(daedong repo)이 구조가 꼬여 전면 재설계. 설계 확정 + v1 데이터 조사·판정까지 완료.
이 폴더에 이미 docs/ (DECISIONS, SCHEMA, ROADMAP, PHASE0_GUIDE), migrations/ (001, 002,
009_seed, README), backup/ (v1 백업 + 판정 기록) 이 배치되어 있음. 전부 먼저 읽고 시작.
⚠ 마이그레이션 SQL 은 전부 확정본. 새로 작성하거나 수정하지 말 것.
  (실행은 계란님이 SQL Editor 에서 직접: Phase 0 은 001·002 만. 009 는 Phase 1 말)

이번 세션 목표 (PHASE0_GUIDE.md 2~8단계 순서):
1. git init + npm workspaces 모노레포 스캐폴드 — 기존 docs/migrations/backup 은 그대로 두고
   apps/main, packages/timetable, packages/shared 추가. .gitignore (.env 포함)
2. apps/main 의 vite.config: server { port: 5175, strictPort: true } 고정
   (chunha-sim 5173 과 동시 실행 대비. OAuth 등록도 전부 5175 기준 — 가이드 5단계)
3. 계란님 수동 단계(Supabase 프로젝트 생성 → 001·002 실행 → OAuth → 첫 로그인 →
   D17 승격 → Vercel)는 PHASE0_GUIDE.md 순서로 안내하고 각 결과 확인
4. shared 패키지 (supabase.js, auth.js — redirectTo 는 window.location.origin,
   permissions.js — 판정 로직은 DB 헬퍼 함수 is_admin 등과 같은 의미로)
5. main: 로그인 → 빈 대시보드 → /admin/users 뼈대

원칙: P1~P8 + D15~D17 준수. 단계별 커밋, push 는 계란님이 직접.
각 단계 완료 후 멈춰서 확인 받고 진행.
```
