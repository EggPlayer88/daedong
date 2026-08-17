# daedong-v2 Phase 0 상세 실행 가이드 (PHASE0_GUIDE.md)

> 작성일: 2026-08-15
> 대상: 계란님(수동 단계) + Claude Code(구현 단계). 위에서 아래로 순서대로 진행.
> 각 단계 끝의 ✅ 확인을 통과해야 다음 단계로 넘어간다.

담당 표기: **[계란]** = 계란님이 브라우저/대시보드에서 직접, **[CC]** = Claude Code 세션.

---

## 준비물 체크

- [ ] Google 계정 (로그인에 사용할 계정 확정 — 이 이메일이 D17 승격 기준이 됨)
- [ ] v1 Supabase 프로젝트 접근 (업무 종류 데이터 조사용)
- [ ] GitHub 계정 (EggPlayer88), Vercel 계정
- [ ] 이 폴더의 파일들: migrations/000, 001, 002, 010_seed, README + docs 4개
- [ ] (D18) v1 사이트 운영 중단 합의 — 000 실행 시점부터 v1 은 영구적으로 깨진다.
      **v1 GitHub repo 는 유일한 참조본이므로 절대 삭제 금지**

---

## 1단계. v1 "업무 종류" 데이터 조사·백업 — [계란] + [CC]

D3 에 따라 v1 에서 보존할 데이터는 계란 계정 + 업무 종류뿐. 계정은 D17 로 대체되므로
실질 보존 대상은 업무 종류 하나다. 어느 테이블인지부터 실측한다 (교훈 3: 문서 맹신 금지).

**[계란] v1 Supabase → SQL Editor 에서 순서대로 실행:**

```sql
-- 1) public 테이블 전수 목록
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

```sql
-- 2) "업무 종류" 후보 좁히기 (duty/work/task/category 계열 이름 검색)
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (table_name  ILIKE '%duty%' OR table_name  ILIKE '%work%'
       OR table_name ILIKE '%task%' OR table_name ILIKE '%category%'
       OR column_name ILIKE '%duty%')
ORDER BY table_name;
```

```sql
-- 3) 후보 테이블 내용 확인 (테이블명을 바꿔가며)
-- SELECT * FROM 후보테이블명 LIMIT 50;
```

**[계란]** 3)의 결과를 CSV 다운로드(결과 그리드 우상단) 또는 복사 → Claude Code 세션에 전달.
**[CC]** backup/ 폴더를 repo 에 배치.

> **✔ 이 단계는 완료됨 (2026-08-16)**: 업무종류 = v1 public.tasks 로 확인 → 5건 모두 샘플로
> 판정되어 폐기. 부서 6개(실제 부서)만 migrations/010_seed.sql 로 이관 확정 (Phase 1 말 실행).
> 백업·판정 기록은 backup/README.md 참조.

✅ 확인: backup 파일이 repo 에 있고, 원본 테이블명이 기록되어 있다.

---

## 2단계. repo 스캐폴드 — [CC]

- [ ] `daedong-v2` 폴더 생성, git init
- [ ] npm workspaces 모노레포:
  - 루트 package.json 의 workspaces: `["apps/*", "packages/*"]`
  - `apps/main` (React + Vite), `packages/timetable` (빈 뼈대), `packages/shared`
- [ ] `migrations/` 에 001, 002, README.md 배치 (이 폴더의 확정본 그대로. **새로 작성 금지**)
- [ ] `docs/` 에 DECISIONS.md, SCHEMA.md, ROADMAP.md, PHASE0_GUIDE.md 배치
- [ ] 커밋 (push 는 계란님이 직접 — 기존 협업 원칙)

P8 경계 리마인드: main → timetable, shared / timetable → shared 만 / shared → 없음.
DB 접근은 shared/supabase.js 단일 경유.

✅ 확인: `npm install` 이 루트에서 한 번에 돌고, `npm run dev -w apps/main` 로 빈 화면이 뜬다.

---

## 3단계. v1 Supabase 프로젝트 초기화 (000 실행) — [계란] + [CC 안내]

> **변경 (2026-08-16, D18)**: 원래 계획은 "새 프로젝트 생성"이었으나 무료 플랜의
> 프로젝트 한도로 신규 생성이 불가 → **v1 프로젝트를 밀고 v2 로 재사용**한다.
> v1 사이트는 운영 중단. DB 백업은 생략(보존 대상은 이미 backup/ 에 확보됨).
> **⚠ v1 GitHub repo 는 이제 v1 의 유일한 참조본 — 절대 삭제 금지.**

**[계란] v1 Supabase → SQL Editor 에서 `migrations/000_reset_v1_project.sql` 실행.**
⚠ **한 번에 전체 Run 금지.** `[A] → [B] → [C] → [D] → [검증]` 블록 단위로 나눠서 실행한다.

- **[A0]** (선택) 시간표 테이블 정의 추출 — 백업이 아니라 **Phase 2 재료**(010 이 v1 실측
  스키마 복제를 전제). 결과 CSV 를 backup/ 에. 건너뛰어도 Phase 0~1 진행에는 지장 없음
- **[A] 조사** — 결과를 [CC] 에 전달. 이벤트 트리거 목록에서 **Supabase 시스템 것
  (`graphql_watch_*`, `pgsodium_*` 등) 은 절대 삭제 대상에 넣지 않는다.**
  v1 이 만든 것(`rls_auto_enable` 류)만 [B1] 에 실명으로 채운다
- **[B] 표적 제거** — B1 은 [A] 결과를 보고 주석 해제.
  B2 는 **정책 제거(DO 블록)만 SQL 로**, 버킷·파일은 **대시보드 Storage 에서 버킷 삭제**로
  처리한다 (`storage.protect_delete()` 시스템 트리거가 직접 DELETE 를 차단 — 우회 금지)
- **[C] public 스키마 재생성** — ⚠ 여기서 v1 테이블/데이터/정책이 전부 소멸.
  **권한 복구 GRANT 블록까지 반드시 함께 실행** (빠지면 API 가 아무것도 못 읽음)
- **[D] auth 사용자 전부 삭제** — 대시보드 Authentication → Users → 각 사용자 Delete.
  **생략 금지**: v1 계정이 남아 있으면 v2 첫 로그인 때 `auth.users` INSERT 가 없어
  `handle_new_user` 트리거가 안 돌고 → public.users 행 없음 → D17 승격 대상 없음
- **[검증]** public_tables = 0, buckets = 0, auth.users 트리거 0행, Users 화면 0 users

**접속 정보**: 프로젝트가 그대로이므로 **Project URL / anon key 는 v1 것을 그대로 사용**한다
(Project Settings → API). 초기화로 값이 바뀌지 않는다. `<PROJECT_REF>` 도 v1 것 그대로.

✅ 확인: [검증] 4개 항목 통과 + URL/anon key 를 Claude Code 에 전달할 준비 완료 (.env 용).

---

## 4단계. 001, 002 마이그레이션 실행 — [계란]

1. SQL Editor → New query → **001 파일 내용 전체** 붙여넣기 → Run
2. 001 하단 [검증] 블록의 쿼리 3개를 실행해 결과 확인
   - users/departments rowsecurity = t, 정책 users 2 + departments 4, 함수 8개
3. **⚠ 001 맨 아래 [D17 부트스트랩] UPDATE 는 지금 실행하지 않는다** (7단계에서)
4. 같은 방식으로 002 실행 + [검증] (schedules 4 + tasks 4 정책)
5. migrations/README.md 표에 실행일 기록 → 커밋

✅ 확인: 검증 쿼리 결과가 주석의 기대값과 일치, README 기록 완료.

---

## 5단계. Google OAuth 설정 — [계란], [CC 가 옆에서 안내]

> **변경 (2026-08-16, D18)**: 같은 Supabase 프로젝트를 계속 쓰므로 **Google Cloud 의
> OAuth 클라이언트와 Supabase 의 Google Provider 설정을 그대로 재사용**한다.
> 000 초기화는 `public` 스키마와 auth 사용자만 지우며, Provider 설정(Client ID/Secret)과
> URL Configuration 은 그대로 남는다. 새 클라이언트를 만들 필요 없음.
> 리디렉션 URI(`https://<PROJECT_REF>.supabase.co/auth/v1/callback`) 도 REF 가 같아 그대로 유효.
> **실제로 할 일은 아래 2개 — 5175 등록뿐이다.**

### 5-1. Google Cloud Console (https://console.cloud.google.com)

1. v1 때 쓰던 프로젝트 → API 및 서비스 → 사용자 인증 정보 → **기존 OAuth 클라이언트 ID** 열기
2. **승인된 자바스크립트 원본에 `http://localhost:5175` 추가** ← (a) 이번에 할 일
   - 기존 항목(v1 배포 도메인 등)은 지우지 않아도 무방
   - (8단계 후) Vercel 배포 도메인도 여기에 추가
3. 승인된 리디렉션 URI: `https://<PROJECT_REF>.supabase.co/auth/v1/callback` 이 이미 있는지만 확인
4. Client ID / Secret 은 이미 Supabase 에 등록돼 있으므로 다시 복사할 필요 없음

### 5-2. Supabase Dashboard

1. Authentication → Providers → Google → **Enabled 상태인지 확인만** (재설정 불필요)
2. Authentication → **URL Configuration**:
   - Site URL: `http://localhost:5175` 로 **변경** (8단계 배포 후 배포 URL 로 교체)
   - **Additional Redirect URLs 에 `http://localhost:5175/**` 추가** ← (b) 이번에 할 일
     ← ★ v1 교훈 1. 이걸 빼먹으면 로컬 개발 검증이 불가능해진다. 절대 생략 금지.
   - v1 배포 URL 항목은 남아 있어도 무해 (Phase 4 v1 폐기 때 정리)
   - (8단계 후) v2 배포 URL 도 `https://<도메인>/**` 형태로 추가

✅ 확인: Providers 에 Google enabled, 승인된 원본에 `http://localhost:5175`,
Redirect URLs 에 `http://localhost:5175/**` 존재.

---

## 6단계. shared 패키지 + 로그인 뼈대 — [CC]

- [ ] `apps/main/vite.config.js` — **server: { port: 5175, strictPort: true } 고정**
      (chunha-sim 이 5173 사용 중. 포트가 자동으로 밀리면 OAuth 리디렉션이 조용히 깨짐)
- [ ] `apps/main/.env` (git 제외): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
      + `.env.example` 커밋
- [ ] `packages/shared/src/supabase.js` — createClient, **유일한 DB 접근점** (P8)
- [ ] `packages/shared/src/auth.js` — `signInWithOAuth({ provider: 'google',
      options: { redirectTo: window.location.origin } })` ← origin 사용으로 로컬/배포 겸용
- [ ] `packages/shared/src/permissions.js` — `can(user, action)`.
      역할 계층 + extra_permissions 판정을 **DB 헬퍼 함수(is_admin 등)와 같은 의미**로 구현
- [ ] `packages/shared/src/constants.js` — 역할 4종 등
- [ ] main: 로그인 페이지 → 로그인 후 빈 대시보드 → `/admin/users` 뼈대
      (users 목록 표시. role 표기. admin+ 만 메뉴 노출 — 지금은 아무도 admin 이 아니어도 됨)

✅ 확인: 로컬에서 Google 로그인 버튼 → 동의 화면 → 앱으로 복귀까지 에러 없음.

---

## 7단계. 첫 로그인 + superadmin 승격 (D17) — [계란]

1. `npm run dev -w apps/main` → http://localhost:5175 → Google 로그인
2. Supabase → Table Editor → users 에 내 행이 생겼는지 확인 (role = teacher)
   - 행이 없으면: 001 의 on_auth_user_created 트리거 확인, Authentication → Users 에는 있는지 대조
3. SQL Editor 에서 001 맨 아래 [D17 부트스트랩] 블록 실행:
   ```sql
   UPDATE public.users SET role = 'superadmin' WHERE email = '내가_로그인한_이메일';
   ```
4. 앱 새로고침 → 역할이 superadmin 으로 보이는지 확인
5. migrations/README.md 의 D17 행에 기록

✅ 확인: 화면에서 본인 역할 superadmin 확인. **이것이 Phase 0 완료 기준의 핵심.**

---

## 8단계. Vercel 배포 — [계란] + [CC 안내]

> **변경 (2026-08-16, D18 확장)**: 새 repo/프로젝트를 만들지 않고 **v1 것을 그대로 재사용**했다.
> - GitHub: `EggPlayer88/daedong` 의 main 을 v2 로 **force push**
>   (⚠ 이로써 GitHub 의 v1 코드는 브랜치 끝에서 사라짐 — DECISIONS [보류] 항목 참조)
> - Vercel: v1 프로젝트의 **Root Directory 를 `apps/main` 으로 전환**
> - 배포 도메인: **https://daedong-school.vercel.app** (v1 도메인 승계)
> 아래 1~2 는 신규 생성 시의 절차이며, 이번에는 2의 설정 전환만 수행했다.

1. Vercel → Add New Project → daedong-v2 repo Import
2. **모노레포 설정 (중요)**:
   - Root Directory: `apps/main`
   - Settings → General → "Include source files outside of the Root Directory" **활성화**
     (packages/shared 를 빌드에 포함하기 위함)
   - Framework Preset: Vite
3. Environment Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
4. Deploy → 배포 도메인 확보
5. **배포 도메인을 3곳에 등록** (하나라도 빠지면 배포판 로그인 실패):
   - Google Cloud Console → 승인된 자바스크립트 원본
   - Supabase → URL Configuration → Site URL (localhost 에서 교체)
   - Supabase → URL Configuration → Additional Redirect URLs (`https://<도메인>/**`)
     - localhost 항목은 **지우지 말 것** (v1 교훈 1)

✅ 확인: 배포 사이트에서 Google 로그인 → superadmin 확인.

---

## Phase 0 완료 판정 — ✅ 전 항목 완료 (2026-08-16)

- [x] backup/ 에 v1 업무 종류 데이터 + 출처 테이블 기록 (+ 시간표 스키마 실측 5종)
- [x] 모노레포 스캐폴드 + 문서/마이그레이션 배치 + 커밋
- [x] 000 초기화 [검증] 통과 (D18) + 001, 002 실행 + README 기록
- [x] OAuth: localhost(`http://localhost:5175/**`) + 배포 URL 모두 등록 — **localhost 유지됨** (v1 교훈 1)
- [x] **배포 사이트(https://daedong-school.vercel.app)에서 로그인 → superadmin 역할 확인** (ROADMAP 완료 기준)

**→ Phase 0 공식 완료. 다음은 003(가입 승인제, D20) → Phase 1 (004, 005, 008, 009 + 010 시드 + 일상 코어 기능).**

### Phase 1 로 넘어가기 전 확인할 것

- [x] **v1 코드 사본 확보 완료** — `EggPlayer88/daedong` 의 `v1-final`(이력 92커밋 + 미커밋
      조사 파일 3개) / `v1-legacy`(원본 tip 598da56) 브랜치 + 로컬 `~/projects/daedong`.
      **Phase 4 v1 폐기 전까지 삭제 금지** (Phase 2 시간표 이식의 참조본)
- 010_seed.sql 은 **Phase 1 말** 실행 (001~009 선행)
