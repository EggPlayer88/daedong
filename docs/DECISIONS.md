# daedong-v2 설계 결정 문서 (DECISIONS.md)

> 작성일: 2026-08-14 / 갱신: 2026-08-15 — Phase 0 착수 검토 반영 (D15~D17 추가, P3·P4 보강) / 2026-08-16 — v1 실측 판정 반영 (D3 갱신, 시드 009 확정) / 2026-08-16 — D18 추가 (무료 플랜 한도로 v1 Supabase 프로젝트 초기화 후 재사용, 000_reset 확정. D2 일부 대체) / 2026-08-16 — **Phase 0 완료**. D18 을 인프라 3종(Supabase·GitHub·Vercel) 재사용으로 확장 / 2026-08-18 — D19(문서작성 AI 선행 출시)·D20(가입 승인제, 임시) 추가. 003 삽입으로 마이그레이션 번호 재정렬
> 이 문서는 v2 전면 재설계 기획 세션에서 확정된 모든 원칙과 결정사항을 담는다.
> 모든 개발 작업은 이 문서를 우선 참조한다. 변경 시 반드시 이 문서를 갱신한다.

---

## 0. 재구축 배경

- v1 (daedong repo) 은 업데이트를 거듭하며 아이디어가 누더기처럼 쌓여 세부 구조가 꼬임.
- 부분 수리로 회복 불가 판단 → 최종 버전 기준 전면 재설계가 더 효율적.
- v1 의 Phase 5-A 잔재 정비 경험 (죽은 테이블 10개, 이벤트 트리거 잔재, 마이그레이션 미적용 등) 이 재설계 원칙의 근거.

## 1. 확정 결정 요약

| # | 항목 | 결정 |
|---|------|------|
| D1 | 재설계 범위 | daedong 프로젝트 전체 |
| D2 | 시작 방식 | 백지 시작 (새 repo + 새 Supabase 프로젝트) — ※ **Supabase 부분은 D18 로 대체**. 새 프로젝트 대신 v1 프로젝트를 000 으로 초기화해 재사용 (백지 상태라는 실질은 동일) |
| D3 | 데이터 이관 | (2026-08-16 실측 갱신) 실제 이관 대상은 **부서 6개 명단뿐** (010_seed). v1 업무종류 5건은 샘플로 판정·폐기 (원본 backup/ 보존), 계정은 D17 로 대체. 나머지 전부 폐기 |
| D4 | 저장소 구조 | 모노레포 (npm workspaces). 시간표는 packages/timetable 로 별도 폴더 + 명확한 경계 |
| D5 | 시간표 탑재 방식 | 컴포넌트 패키지. main 이 import. 같은 탭 안에서 렌더링 |
| D6 | ID 정책 | 사용자 ID = TEXT (auth.uid()::text). 도메인 PK = TEXT + gen_random_uuid()::text DEFAULT |
| D7 | 역할 체계 | 4계층 (superadmin > admin > department_head > teacher) + extra_permissions JSONB (예: "timetable_manage") |
| D8 | 문서 기능 통합 | v1 의 "문서관리" + "업무 문서 총정리" → documents 하나로 통합. 조회/다운로드 전체, 업로드는 admin+ |
| D9 | AI 이원화 | AI 업무 비서 (토글 상주, 사이트 도우미) 와 문서 작성 AI (hwpx 특화, 독립 페이지) 는 완전 별개 UI. 비서가 문서 요청 감지 시 문서작성 AI 로 프롬프트 전달 |
| D10 | 나의 할 일 | 메뉴 제거, 대시보드 위젯으로만. 소스 3개: schedules 담당자 매칭(자동) + 상급자 부여(tasks) + 본인 추가(tasks) |
| D11 | 생기부 학급 ↔ 시간표 클래스 | FK 없음. class_groups.timetable_class_code (TEXT) 참고 저장만. 수명주기가 달라 강결합 금지 |
| D12 | 누가기록 접근 | 작성자 본인만 조회/수정 (RLS personal). 생기부 초안 AI 도 본인 작성 기록만 재료로 사용 |
| D13 | 학생 진급 구조 | students(불변) / class_groups(연도별) / enrollments(연결) 3분리. 삭제 없음, status 변경만 |
| D14 | 인프라 | 유지: Supabase (DB+Auth+Storage) + Vercel + React/Vite + Google OAuth |
| D15 | RLS 역할 체크 | 정책 내 역할 확인은 SECURITY DEFINER 헬퍼 함수(get_my_role, is_admin 등, 001 정의) 경유만. users 정책이 users 를 직접 조회하면 무한 재귀 |
| D16 | 권한 컬럼 보호 | "본인 행 수정 OK, 단 role/extra_permissions/is_active 는 admin+" 는 RLS(행 단위)로 불가 → users BEFORE UPDATE 트리거로 강제 |
| D17 | superadmin 부트스트랩 | 새 프로젝트에선 첫 로그인 전 uid 를 알 수 없어 시드 불가 → 첫 로그인(teacher 자동 생성) 후 email 기준 UPDATE 로 승격 1회 |
| D18 | v1 인프라 재사용 | (2026-08-16, Phase 0 완료 시점 확장) 무료 플랜 한도로 신규 생성이 불가해 **v1 의 인프라 3종을 전부 재사용**한다 — ① **Supabase**: 000_reset_v1_project.sql 로 초기화 후 재사용 (URL/anon key/Google OAuth 클라이언트/Provider 설정 그대로). ② **GitHub repo (EggPlayer88/daedong)**: main 을 v2 로 force push. ③ **Vercel 프로젝트**: Root Directory 를 `apps/main` 으로 전환, 배포 도메인 `https://daedong-school.vercel.app` 유지. v1 사이트는 운영 중단, DB 백업은 생략(보존 대상은 backup/ 에 확보). force push 로 사라졌던 v1 코드는 **`v1-final` / `v1-legacy` 브랜치로 복구 완료** ([보류] 항목 참조) |
| D19 | 문서작성 AI 선행 출시 | (2026-08-16, Phase 1.5) D9 의 "문서 작성 AI" 절반을 **평가계획서 단일 문서 종류**로 좁혀 Phase 1 보다 먼저 출시. 구조 = 통일 템플릿(토큰) + manifest 계약 + 결정적 채움(hwpx_lib 이식) + 채팅 수집(Claude API 프록시). **AI 는 내용만, 서식·계산은 코드가** — 대화가 어떻게 흘러도 결과물 양식은 구조적으로 통일된다. AI 비서(토글)·문서 종류 선택·참조 문서 연동은 Phase 2 원안 유지. DB 테이블 추가 0개(P1 위배 아님). 상세 계획은 docs/DOC_AI_MASTER_PLAN.md |
| D20 | 가입 승인제 (**임시 제도**) | (2026-08-18) Google 가입 즉시 사용 가능하던 것을 → 가입 시 **대기 상태(`is_active=false`)로 생성**하고 admin+ 승인 후 사용. 003 마이그레이션 + `/admin/users` 승인 UI + doc-ai API 게이트. **도입 이유**: 학교 이메일 도메인 제한이 없어 아무나 가입하면 (a) 교내 데이터 열람 (b) 문서작성 AI 의 Claude API 비용이 무한정 발생. ⚠ **트레이드오프**: `is_active` 가 "승인 대기"와 "퇴직·전출"의 **이중 의미**를 갖는다 — 임시 제도라 컬럼을 새로 만들지 않고 기존 컬럼을 빌려 쓴다(P1 최소 스키마). 화면에서는 `created_at` 기준으로 신규 가입 대기와 비활성 처리를 구분해 보여준다. **폐지 조건**: ① 학교 계정 도메인 제한(Google Workspace)이 가능해지거나 ② 승인 대기가 운영 부담이 될 때. 폐지 시 `handle_new_user` 의 `is_active` 를 true 로 원복하고 정책 5개를 001·002 원형으로 되돌리는 마이그레이션을 새 번호로 작성한다. 그때 상태 컬럼 분리(`status`)를 함께 검토 |

## 2. 설계 원칙 (P1~P8)

### P1. 최소 스키마 원칙
지금 확실히 쓰는 기능의 테이블만 생성한다. "나중에 필요할 것 같은" 테이블/컬럼 금지. 확장은 그때 마이그레이션으로 한다.

### P2. ID 정책
- 사용자 ID: TEXT (auth.users 의 uid 를 text 캐스팅)
- 도메인 엔티티 PK: TEXT, DEFAULT gen_random_uuid()::text
- 상태값/역할 등은 ENUM 대신 TEXT + CHECK 제약

### P3. 역할은 계층 + 권한 조합
- users.role: 'superadmin' | 'admin' | 'department_head' | 'teacher' (계층, 상위가 하위 포함)
- users.extra_permissions: JSONB 배열 (예: ["timetable_manage"]) — 계층과 무관한 추가 권한
- 새 권한이 생겨도 스키마 변경 없이 추가 가능
- role/extra_permissions/is_active 변경 통제는 users BEFORE UPDATE 트리거로 강제 (D16). SQL Editor 실행(auth.uid() 없음)은 통과 → D17 부트스트랩 경로

### P4. RLS 는 처음부터, 3패턴으로만
- personal: user_id = auth.uid()::text (본인 데이터만)
- shared: 읽기 전체 open, 쓰기는 역할 체크
- admin-only: 읽기/쓰기 모두 역할 체크
- 모든 테이블은 이 3패턴 중 하나. 예외 없음.
- 정책 안의 역할 확인은 반드시 001 의 SECURITY DEFINER 헬퍼 함수(get_my_role / is_admin / is_dept_head_or_above / my_department_id / has_extra_permission) 경유 (D15). 특히 users 자신의 정책이 users 를 서브쿼리하면 무한 재귀 에러.

### P5. 진실의 원천은 DB
- 업무시스템 도메인은 전부 DB 가 진실. 하드코딩 상수는 UI 표시용만.
- 예외: 시간표 도메인의 timetableData.js (v1 방식 유지, packages/timetable 내부에 격리)

### P6. 파일과 메타데이터 분리
- 파일 본체: Supabase Storage
- 메타데이터 (제목, 라벨, 업로더 등): DB 테이블
- 라벨은 별도 테이블 (document_labels + document_label_map)

### P7. 마이그레이션 규율
- 모든 스키마 변경은 번호 붙은 SQL 파일 (migrations/001_xxx.sql)
- SQL Editor 수동 실행 + migrations/README.md 에 실행 기록
- DROP 은 반드시 조사 → 백업 → 실행 순서

### P8. 모노레포 경계
- main → timetable, shared import 가능
- timetable → shared 만 import 가능 (main 을 모름, 역방향 의존 금지)
- shared → 아무것도 import 안 함 (최하층)
- DB 접근은 반드시 shared/supabase.js 경유

## 3. v1 에서 배운 교훈 (재발 방지)

1. **OAuth redirect 에 localhost 포함할 것** — v1 은 배포 URL 만 등록되어 로컬 개발 검증이 불가능했음. 새 Supabase 프로젝트 생성 시 redirect URL 에 http://localhost:5175/** 반드시 포함. ※ v2 의 dev 포트는 **5175 로 고정** (vite server.port=5175, strictPort=true): chunha-sim 등 다른 Vite 프로젝트(5173)와 동시 실행 시 포트가 밀리면 OAuth 가 조용히 깨지는 것을 방지.
2. **RLS 를 나중에 붙이지 말 것** — v1 은 rls_auto_enable 이벤트 트리거 잔재로 403 사고 발생. v2 는 처음부터 3패턴으로 설계.
3. **핸드오프 문서를 맹신하지 말 것** — 문서와 실제 DB 상태가 다를 수 있음. 조사(실측)가 우선.
4. **코드가 실제 참조하는 테이블을 grep 으로 확인할 것** — v1 정비 때 documents/tasks/notifications 를 잔재로 오판할 뻔함.
5. **마이그레이션 실행 여부를 기록할 것** — v1 의 010 은 문서상 완료였으나 실제 미적용이었음.

## 4. 보류/후속 결정 사항

- v1 "업무 종류" 데이터 → **종결 (2026-08-16)**: v1 public.tasks 로 확인 → 5건 모두 샘플로 판정·폐기 (근거: 동일 시각 일괄 생성, 수정 이력 없음, 일반론적 내용). 원본과 판정 기록은 backup/ 에 보존. handover_docs 는 빈 상태로 시작
- v1 tasks 구조 필드(dept, area 등) 처리 → **종결 (2026-08-16)**: 폐기 판정으로 결정 불필요. 부활 시 마크다운 평탄화 규칙은 backup/README.md 참조
- v1 코드 사본 확보 (D18 후속) → **종결 (2026-08-16)**: force push 로 사라졌던 GitHub 의 v1 이력을 브랜치 2개로 복구. `v1-final` (e8ddf6e — v1 이력 92커밋 + 미커밋이던 조사 파일 3개), `v1-legacy` (598da56 — 원본 tip). 로컬 `~/projects/daedong` 까지 포함해 삼중 사본. **Phase 4 v1 폐기 전까지 이 두 브랜치를 삭제하지 말 것** (Phase 2 시간표 이식의 참조본)
- hwpx 브라우저/서버 생성 기술 방식: Phase 2 시작 시 기술 검토 선행
- 대시보드 위젯 드래그 배치 등 고급 편집: Phase 3+ 로 연기
- 진급 마법사 UI: Phase 4. Phase 1~3 은 엑셀 업로드로 운영
- enrollments 에 UNIQUE (class_group_id, student_no) 추가 여부: 같은 반 번호 중복(엑셀 업로드 오류)을 DB 가 잡아주는 장점 vs 전입생 결번 승계 관행과의 충돌 → 학교 관행 확인 후 006 작성 전(Phase 3)에 결정
