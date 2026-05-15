# 🏫 대동여중 업무혁신시스템

중학교의 시간표 운영·변동 관리·학사일정·업무 협업을 AI 와 함께 통합 관리하는 웹 시스템.

---

## 📌 한 줄 요약

- **누구를 위해**: 대동여자중학교 교직원 (교사, 시간표관리자, 슈퍼관리자)
- **무엇을**: 시간표 보기·변동 요청·승인·학사일정·AI 비서 통합
- **어떻게**: React + Supabase + Vercel + Claude API

---

## 🌐 운영 환경

| 영역 | 위치 |
|------|------|
| 코드 저장소 | `EggPlayer88/daedong` (GitHub) |
| 배포 | Vercel (GitHub push 시 자동 빌드) |
| 데이터베이스 | Supabase (`dhaoszbqtbofqftgjfyb.supabase.co`) |
| AI | Anthropic Claude API (Claude Sonnet 4) |
| 빌드 도구 | Vite + React 18 |

---

## 📁 디렉토리 구조

```
daedong/
├── src/
│   ├── App.jsx                    # 루트 (사이드바, 라우팅, 인증 통합)
│   ├── lib/                       # 데이터/엔진 (UI 없음)
│   │   ├── supabase.js            # Supabase 클라이언트
│   │   ├── timetableData.js       # 정적 데이터 (과목/교사/학급/표준시수)
│   │   ├── timetableEngine.js     # 순수함수 (TT 변환, 변동 병합)
│   │   ├── changesAPI.js          # 변동 요청 DB API
│   │   ├── timetablesAPI.js       # 시간표 CRUD API
│   │   └── solver.js              # CP-SAT 시간표 생성기
│   └── pages/
│       ├── TimetablePage.jsx       # 시간표 관리(구) - 솔버 + 저장
│       ├── TimetableViewer.jsx     # 시간표 보기(신) - 메인 페이지
│       ├── TimetablesListPage.jsx  # 시간표 목록 + 미리보기
│       ├── SchoolCalendarPage.jsx  # 학사일정 관리
│       ├── ChangeRequestForm.jsx   # 변동 요청 폼
│       ├── ChangeTabPanels.jsx     # 알림/내요청/관리자승인 탭
│       ├── TimetableAIPanel.jsx    # AI 사이드 챗봇
│       ├── DocumentsPage.jsx       # 문서 (이전 채팅 작업)
│       ├── SchedulePage.jsx        # 일정 관리 (정리 2-A 에서 폼 보강)
│       └── DashboardPage.jsx       # 대시보드 (정리 2-B 재설계, 좌우 분할 + 메모장 + AI 임베드)
├── api/
│   ├── chat.js                    # 업무 AI 비서 (이전 채팅 작업)
│   ├── _timetableContext.js       # 시간표 AI 공통 유틸
│   ├── _adminTools.js             # 관리자 AI 도구 5종
│   ├── admin-chat.js              # 관리자 AI 엔드포인트 (tool use)
│   ├── timetable-chat.js          # 일반 교사 AI 엔드포인트
│   ├── recommend-substitute.js    # 보강 교사 추천
│   ├── recommend-move.js          # 이동/교환 옵션 추천
│   └── parse-document.js          # 문서 파싱 (이전 채팅 작업)
├── migrations/
│   ├── 001_phase1_timetable.sql      # 4개 테이블 생성
│   ├── 002_seed_data.sql             # 시드 데이터
│   ├── 003_phase2_relax_types.sql    # UUID → TEXT (시뮬레이션용)
│   ├── 004_create_events.sql         # events 테이블 (정리 1, schedules→events 통일)
│   ├── 005_add_event_columns.sql     # priority/tags/dept 컬럼 보강 (정리 1 보강)
│   ├── 006_migrate_scope_to_tags.sql # scope='all' → tags=['전체'] 자동 변환 (정리 2-A)
│   └── 007_create_notes.sql          # 메모장 테이블 (정리 2-B)
└── docs/                          # ← 이 문서들 (핸드오프)
    ├── CLAUDE.md                  # 클로드 코드 안내
    ├── ARCHITECTURE.md            # 시스템 구조
    ├── DECISIONS.md               # 결정 누적
    ├── ROADMAP.md                 # 다음 작업
    └── CONVENTIONS.md             # 코드 컨벤션
```

---

## ✅ 현재 진행 상태 (Phase 4C-3 완료 + 정리 작업 1·2-A·2-B 완료)

| Phase | 내용 | 상태 |
|-------|------|------|
| 1 | 데이터 모델 + 시간표 보기 | ✅ 완료 |
| 2A | 변동 요청 + 2단 승인 + 알림 | ✅ 완료 |
| 2B | AI 추천 + 일반 교사 AI 비서 | ✅ 완료 |
| 3A | 관리자 모드 + 학사일정 + 직권 변경 | ✅ 완료 |
| 3B | 관리자 AI 비서 (tool use) | ✅ 완료 |
| 3C | AI 보조 운영 기능 | ⏸️ 시범운영 후 재설계 |
| 4A | 솔버 결과 Supabase 저장 | ✅ 완료 |
| 4B-1 | 시간표 목록 페이지 | ✅ 완료 |
| 4B-2 | 이전 시간표 읽기 전용 보기 | ✅ 완료 |
| 4C-1 | 드래프트 편집 페이지 (카드 바구니 방식 + 충돌 사전 차단) | ✅ 완료 |
| 4C-2 | swap 편집 + 충돌 강제 차단 | ✅ 완료 (4C-1 에 흡수, 결정 8) |
| 4C-3 | edit_log 이력 표시 UI (목록 페이지 "📜 이력" 버튼 → 별도 페이지) | ✅ 완료 |
| 정리 1 | schedules→events 통일, 베타 라벨, 학교 설정 임시 비활성화, 잔존 파일/문구 정리 | ✅ 완료 |
| 정리 2-A | SchedulePage 폼 보강 (priority/tags/dept), 부서 DEPT 통합, scope→tags 단순화 | ✅ 완료 |
| 정리 2-B | 대시보드 재설계 (좌우 분할) + 메모장 + 오늘 내 수업 + AI 비서 임베드 | ✅ 완료 |
| 5 | 임시교사 시스템 | ⏳ 예정 |
| 6 | 인증 통합 (페르소나 → 실인증) | ⏳ 예정 |
| 7 | 영구 변경 시스템 (시간 여행) | ⏳ 예정 |
| 8 | AI 재설계 (시범운영 피드백 반영) | ⏸️ 보류 |

---

## 🚀 빠른 시작

WSL Ubuntu 환경에서 처음 시작하시면:

1. `docs/SETUP.md` — Ubuntu 환경 셋업
2. `docs/CLAUDE.md` — 클로드 코드 시작 안내
3. 그 외 `docs/` 안의 다른 문서들 — 필요에 따라

---

## 📞 도움 받기

- **다음 작업 결정**: `docs/ROADMAP.md` 참조
- **기존 결정 확인**: `docs/DECISIONS.md` 참조
- **코드 컨벤션**: `docs/CONVENTIONS.md` 참조
- **시스템 구조**: `docs/ARCHITECTURE.md` 참조
