# DOC_AI_HANDOFF.md — 문서작성 AI(평가계획서) 선행 출시 지시서

> 작성: 2026-08-16, Claude Web 설계 세션. 대상: Claude Code 구현 세션.
> 결정 번호: **D19** (아래 6절). 로드맵 위치: **Phase 1.5** (Phase 0 완료 직후 선행 삽입).

## 0. 배경과 범위

- 목표: 교사들이 daedong-school.vercel.app 에 Google 로그인 → **채팅만으로 평가계획서
  내용을 확정 → 통일된 양식의 .hwpx 파일 다운로드**.
- D9(AI 이원화)의 "문서 작성 AI" 절반을 **평가계획서 단일 문서 종류**로 좁혀 선행 출시.
  AI 비서(토글), 문서 종류 선택, 참조 문서 연동은 이번 범위 아님 — Phase 2 원안 유지.
- 핵심 설계 원칙: **AI 는 내용 수집만, 파일 생성은 결정적 코드가.**
  - 채팅 AI 는 manifest 의 필드를 대화로 수집해 JSON 으로 확정한다.
  - hwpx 채움은 검증된 엔진(hwpx_lib)이 토큰 치환으로 수행한다.
  - → 대화가 어떻게 흘러도 **결과물 양식은 구조적으로 100% 통일**된다.
- **템플릿 교체 가능 구조**: 코드는 특정 양식을 모른다. `template.hwpx`(토큰 박힌 양식)
  + `template-manifest.json`(필드 명세)만 읽는다. 실제 양식은 내일 도착 →
  Claude Web 이 두 파일을 제작해 배치하면 코드 수정 없이 가동.

## 1. 아키텍처

```
[브라우저 /doc-ai]
   │  ① POST /api/doc-ai/chat   (Authorization: Bearer <supabase access token>)
   │     { messages: [...] }  →  { reply: "..." }
   │     reply 에 ===PLAN_READY=== JSON ===END=== 가 나타나면 확인 카드 렌더
   │  ② POST /api/doc-ai/generate
   │     { fields: {...} }  →  { filename, base64 }  → Blob 다운로드
   ▼
[Vercel Functions (apps/main/api/)]
   chat.js      Node.  Supabase 토큰 검증 → manifest 로 시스템 프롬프트 구성
                → Anthropic /v1/messages 호출 (키는 서버 env)
   generate.py  Python. 토큰 검증 → manifest 기반 필드 검증 → 템플릿 unpack
                → smart_replace 토큰 치환 → 잔여 토큰 0 확인 → pack → verify_hwpx
                → base64 반환
```

## 2. 파일 배치

```
apps/main/
├── requirements.txt                     ← lxml  (Vercel Python 런타임용)
├── api/
│   ├── _hwpx/                           ← 엔진 이식 (doc-ai-prep/engine/ 4개 그대로.
│   │   ├── hwpx_lib.py                     ⚠ 검증된 코드 — 수정 금지, import 만)
│   │   ├── hwpx_zip.py
│   │   ├── analyze_template.py          ← 서버에선 안 쓰지만 템플릿 통합 작업용으로 동반
│   │   └── extract_text.py
│   └── doc-ai/
│       ├── chat.js
│       ├── generate.py
│       └── _assets/
│           ├── template-manifest.json   ← 지금은 draft 를 복사해 두기. 내일 확정본 교체
│           └── template.hwpx            ← 내일 배치. 없으면 generate 가 TEMPLATE_MISSING 에러
└── src/pages/DocAi.jsx (+ 필요 컴포넌트)  ← /doc-ai 라우트, 로그인 필수
```

- Python 함수가 `_hwpx/`, `_assets/` 를 읽을 수 있도록 번들 포함 확인. 기본 번들에
  안 들어가면 apps/main/vercel.json 의 `functions.{"api/doc-ai/generate.py":{"includeFiles":"api/**"}}` 사용.
- `sys.path` 에 `_hwpx` 추가 후 `from hwpx_lib import *`.

## 3. API 계약

### 공통: 인증 (두 엔드포인트 모두)
```js
// 요청 헤더의 Bearer 토큰을 Supabase 에 검증 위임 (의존성 0)
const r = await fetch(`${process.env.VITE_SUPABASE_URL}/auth/v1/user`, {
  headers: { apikey: process.env.VITE_SUPABASE_ANON_KEY,
             Authorization: req.headers.authorization } });
if (!r.ok) return 401;
```
- 프론트는 `supabase.auth.getSession()` 의 access_token 을 매 요청에 첨부.
- VITE_ 접두사 env 는 서버 함수에서도 process.env 로 읽힌다 (접두사는 클라이언트
  번들 노출 여부만 결정). 재사용해도 됨.

### POST /api/doc-ai/chat  (Node)
- body: `{ messages: [{role:'user'|'assistant', content:string}, ...] }`
- 검증: messages 배열 형태, 총 길이 상한 (예: 60 메시지 / 총 40,000자 초과 시 400 —
  비용 폭주 방지).
- Anthropic 호출: SDK 없이 native fetch.
  ```js
  fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{
    'x-api-key': process.env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens: 2000,
      system: buildSystemPrompt(manifest), messages }) })
  ```
- 응답: `{ reply }` (content 의 text 블록 결합). 스트리밍은 v1 생략.
- 시스템 프롬프트는 4절 초안 + manifest 의 필드 목록을 코드로 주입
  (manifest 가 바뀌면 프롬프트도 자동 반영되도록 하드코딩 금지).

### POST /api/doc-ai/generate  (Python)
- body: `{ fields: { year, semester, subject, ..., perf_areas: [{name,points,method,period,criteria}, ...] } }`
- 절차:
  1. 토큰 검증 (공통) — Python 에선 urllib 로 동일 호출
  2. manifest 로드 → required 필드 존재 검증, ratio_sum_100 검증, perf_areas 개수
     min~max 검증. 실패 시 400 + 어떤 필드가 왜 실패했는지 명시
  3. template.hwpx 존재 확인 → 없으면 409 `{error:"TEMPLATE_MISSING"}` (오늘은 이 상태가 정상)
  4. tempfile 디렉토리에 unpack → `load_section` → 모든 단일 필드 토큰을
     `smart_replace` 로 치환 → repeating_group: 1..max 슬롯 중 입력된 것은 값,
     **미사용 슬롯은 빈 문자열로 치환** (fixed_rows_blank_unused)
  5. `scan_placeholders` 로 잔여 `{{` 토큰 0 확인 (남으면 500 — 템플릿/manifest 불일치 신호)
  6. `save_section` → pack → `verify_hwpx(expect_texts=[subject 등 2~3개], forbid_texts=['{{'])`
  7. 응답: `{ filename, base64 }`. 파일명은 filename_pattern 으로 생성.
     ⚠ 한글 파일명을 HTTP 헤더로 보내면 인코딩 문제가 잦다 — **바이너리 응답 대신
     base64 JSON 으로 통일**하고 프론트에서 Blob + a[download] 처리.

## 4. 시스템 프롬프트 초안 (chat.js 에서 manifest 주입해 완성)

```
너는 대동여자중학교의 평가계획서 작성 도우미다. 교사와 대화하며 아래 항목을
수집해 평가계획서를 완성한다.

[수집 항목]  ← manifest.fields + repeating_group 에서 코드로 생성
- 학년도(기본 {default}), 학기, 교과, 대상 학년, 작성 교사, ...
- 수행평가 영역 (1~{max}개): 영역명 / 만점·반영비율 / 평가 방법 / 시기 / 평가 기준

[대화 규칙]
- 첫 인사에서 무엇을 만들지 한 줄로 안내하고, 교과·학년부터 묻는다.
- 한 번에 1~2개 항목만 묻는다. 교사가 한꺼번에 여러 정보를 주면 모두 반영하고
  빠진 것만 이어서 묻는다.
- 교사가 준 정보를 절대 지어내거나 임의로 보완하지 않는다. 불명확하면 되묻는다.
- 지필+수행 반영 비율 합이 100 이 아니면 지적하고 재확인한다 (자유학기 등
  지필 0% 는 가능 — 사유를 written_plan 에 기록).
- 평가 기준 등 서술 항목은 교사의 메모를 학업성적관리규정에 맞는 문어체(개조식)로
  다듬어 제안하고 확인받는다.
- 학생 이름·성적 등 개인정보는 수집하지 않는다. 언급되면 계획서에 넣지 않겠다고 안내.
- 모든 항목이 확정되면 전체 내용을 요약해 보여주고 "이대로 생성할까요?" 확인을 받는다.
- 교사가 확정하면, 다른 말 없이 정확히 아래 형식만 출력한다:
===PLAN_READY===
{ manifest 의 key 를 그대로 쓴 JSON }
===END===
```

## 5. 프론트 (/doc-ai)

- 라우트 /doc-ai, 로그인 필수 (기존 가드 재사용). 상단 메뉴에 "문서 작성 AI" 추가.
- 화면: 메시지 목록 + 입력창 + 전송(로딩 표시). 대화 상태는 React state 만
  (새로고침 = 초기화. ai_conversations 저장은 P1 에 따라 보류 — 화면에 안내 문구 한 줄).
- 응답에서 `===PLAN_READY===` 감지 → 마커 앞 텍스트는 채팅으로, JSON 은 파싱해
  **확인 카드**(필드 요약 표) 렌더 → [한글파일 생성] 버튼 → generate 호출 →
  base64 → Blob 다운로드. 수정 원하면 "대화로 계속 수정" (카드 닫고 채팅 재개).
- JSON 파싱 실패 시: 사용자에게는 "정리 중 오류, 한 번 더 확정해 달라" 안내하고
  대화에 "방금 JSON 형식이 깨졌으니 PLAN_READY 를 다시 출력해줘" 를 자동 첨부.
- TEMPLATE_MISSING(409) 응답 처리: "양식 준비 중입니다 — 내용은 확정됐으니 양식
  등록 후 다시 생성해 주세요" 안내 (오늘 상태에서 자연스럽게 동작해야 함).

## 6. 문서 반영

- DECISIONS.md 에 **D19** 추가: "문서작성 AI 를 평가계획서 단일 범위로 Phase 1.5
  선행 출시. 구조 = 통일 템플릿(토큰) + manifest + 결정적 채움(hwpx_lib 이식) +
  채팅 수집(Claude API 프록시). AI 는 내용만, 서식은 코드가. D9 의 부분 선행이며
  Phase 2 원안(문서 종류 선택·참조 문서·AI 비서 연동)은 유지."
- ROADMAP.md 에 **Phase 1.5** 섹션 삽입 (Phase 0 과 1 사이): 오늘 항목 + 내일
  항목(템플릿 배치 → E2E → 교사 시범 오픈). Phase 1 은 순연이 아니라 병행 가능 명시.
- P1(최소 스키마) 위배 아님: DB 테이블 추가 0개.

## 7. 환경 변수 / 배포

- Vercel → Settings → Environment Variables 에 **ANTHROPIC_API_KEY** 추가 (계란님 수동).
  ⚠ 절대 VITE_ 접두사 금지 (붙이면 클라이언트 번들에 노출 = 키 유출).
  로컬은 `vercel env pull` 또는 apps/main/.env 에 추가 (.env 는 이미 gitignore).
- 로컬 개발: vite dev 서버는 api/ 함수를 실행하지 못한다.
  → 함수 테스트는 `npx vercel dev` 또는 preview 배포로. UI 는 vite 로 개발하되
  API 베이스를 동일 오리진 상대경로로 (배포에서 자동 동작).

## 8. 오늘 완료 기준 (템플릿 없이)

- [ ] 엔진 4파일 이식 + requirements.txt, draft manifest 배치
- [ ] chat.js: 인증 → Claude 호출 → 응답. 실제 키로 대화 동작 확인 (preview 배포)
- [ ] generate.py: 검증 로직 + TEMPLATE_MISSING 응답. 치환 함수는 가짜 필드 dict 로
      단위 확인 (템플릿 의존 부분 제외)
- [ ] /doc-ai UI: 대화 → PLAN_READY 카드 → 생성 클릭 시 "양식 준비 중" 안내까지 전체 흐름
- [ ] D19/Phase 1.5 문서 반영, 단계별 커밋

## 9. 내일 플러그인 절차 (기록용)

1. 계란님 → Claude Web 에 확정 양식(.hwpx) 업로드
2. Claude Web: 구조 분석 → 토큰 심은 template.hwpx + 확정 template-manifest.json 제작
   (repeating 전략·max 값 이때 확정)
3. 두 파일을 api/doc-ai/_assets/ 에 교체 배치 → 배포 → E2E (채팅→생성→한글에서 열기)
4. 교사 2~3명 시범 → 피드백 반영 → 전체 안내
