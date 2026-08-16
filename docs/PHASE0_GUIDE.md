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
- [ ] 이 폴더의 파일들: migrations/001, 002, README + docs 4개

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
> 판정되어 폐기. 부서 6개(실제 부서)만 migrations/009_seed.sql 로 이관 확정 (Phase 1 말 실행).
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

## 3단계. 새 Supabase 프로젝트 생성 — [계란]

1. https://supabase.com/dashboard → **New project**
2. 설정:
   - Name: `daedong-v2`
   - Database Password: 생성 후 **비밀번호 관리 도구에 보관** (분실 시 리셋 가능하지만 번거로움)
   - Region: **Northeast Asia (Seoul)** `ap-northeast-2`
3. 생성 완료 후 **Project Settings → API** 에서 복사해 둘 것 2개:
   - Project URL (`https://<PROJECT_REF>.supabase.co`)
   - `anon` `public` key
4. `<PROJECT_REF>` 값도 따로 메모 (5단계 Google 리디렉션 URI 에 필요)

✅ 확인: URL 과 anon key 를 Claude Code 에 전달할 준비가 됐다 (.env 용).

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

### 5-1. Google Cloud Console (https://console.cloud.google.com)

1. 프로젝트 선택/생성 (v1 때 쓰던 OAuth 클라이언트를 재사용해도 되지만,
   깔끔한 폐기(Phase 4 v1 폐기)를 위해 **새 클라이언트 권장**)
2. API 및 서비스 → OAuth 동의 화면: 외부(External), 앱 이름/이메일만 채우고 저장
3. 사용자 인증 정보 → 사용자 인증 정보 만들기 → **OAuth 클라이언트 ID** → 웹 애플리케이션
   - 승인된 자바스크립트 원본:
     - `http://localhost:5175`
     - (8단계 후) Vercel 배포 도메인 추가
   - 승인된 리디렉션 URI:
     - `https://<PROJECT_REF>.supabase.co/auth/v1/callback`  ← 3단계에서 메모한 REF
4. 생성된 **Client ID / Client Secret** 복사

### 5-2. Supabase Dashboard

1. Authentication → Providers → Google → Enable, Client ID/Secret 붙여넣기 → Save
2. Authentication → **URL Configuration**:
   - Site URL: 일단 `http://localhost:5175` (8단계 배포 후 배포 URL 로 교체)
   - **Additional Redirect URLs: `http://localhost:5175/**`**
     ← ★ v1 교훈 1. 이걸 빼먹으면 로컬 개발 검증이 불가능해진다. 절대 생략 금지.
   - (8단계 후) 배포 URL 도 `https://<도메인>/**` 형태로 추가

✅ 확인: Providers 에 Google enabled, Redirect URLs 에 localhost 와일드카드 존재.

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

## Phase 0 완료 판정

- [ ] backup/ 에 v1 업무 종류 데이터 + 출처 테이블 기록
- [ ] 모노레포 스캐폴드 + 문서/마이그레이션 배치 + 커밋
- [ ] 001, 002 실행 + README 기록
- [ ] OAuth: localhost + 배포 URL 모두 등록
- [ ] **배포 사이트에서 계란님 로그인 → superadmin 역할 확인** (ROADMAP 완료 기준)

완료 시 → Phase 1 (003, 004, 007, 008 + 일상 코어 기능) 로.
