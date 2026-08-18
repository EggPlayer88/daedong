# CLAUDE.md — 협업 규칙 (daedong-v2)

> 2026-08-18 확정. Claude Code 세션은 이 문서를 먼저 읽고 시작한다.
> 설계·결정은 `docs/DECISIONS.md`, 일정은 `docs/ROADMAP.md`,
> 문서작성 AI 는 `docs/DOC_AI_MASTER_PLAN.md` 가 기준 문서다.

**대동여중 업무혁신시스템** — 배포: https://daedong-school.vercel.app

---

## 1. 자율 진행 (승인 없이 바로 하고, 끝나고 보고)

- UI/프론트 구현·수정
- 프롬프트 다듬기 (`_assets/prompt-rules*.md`, `chat.js` 의 프롬프트 조립부)
- 테스트 작성·갱신
- 리팩터링
- 문서 갱신 (`docs/`, 각 `README.md`)
- 버그 수정
- 파일 배치 (전달받은 자산을 정해진 위치로)

**보고 형식** — 커밋 단위 요약 + **"판단해서 정한 것"** 목록.
사후 검토용이므로 "왜 그렇게 정했는지"와 "되돌리려면 어디를 고치면 되는지"를 함께 적는다.

**커밋** — 연속 작업은 알아서 이어가되, **논리 단위로 쪼갠다.**
(예: 자산 배치 / 구현 / 테스트·문서 를 한 덩어리로 묶지 않는다)

## 2. 승인 필요 (멈추고 확인받는다)

- **DB 마이그레이션·스키마·RLS 변경**
  SQL 확정본은 Claude Web 이 작성하고, 실행은 계란님이 SQL Editor 에서 한다.
- **확정본 수정** — 아래 5종은 읽기 전용으로 취급한다:
  | 대상 | 이유 |
  |---|---|
  | `migrations/*.sql` | 실행 기록과 짝이라 사후 수정이 이력을 거짓으로 만든다 |
  | `_assets/template-master.hwpx` · `_assets/template-arts.hwpx` | v3.1 검증본. 마스터 170토큰(5수준) / 예체능판 168토큰(3수준, LV_D·E 없음). 재토큰화는 Claude Web. 구버전은 `archive/doc-ai-v2/` 에 보존 |
  | `apps/main/api/_hwpx/` | 실전 검증된 hwpx 엔진. import 만 하고 고치지 않는다 |
  | manifest 의 계약 섹션 | `direct_tokens` / `pattern_tokens` / `composition_rules` / `unused_handling` / `limits` / `fixed_texts` / `final_check` / `collection_guides` / `variants` — `doc-ai-template-v3/template-manifest.v3.final.json` 원문과 동일해야 하며 테스트로 고정돼 있다. 코드가 쓰는 `token_paths` · `collection_guides_fields` · `variant_routing` 은 이 계약을 기계가 읽게 펼친 것이라 대조 테스트로 묶여 있다 |
  | `_assets/regulation-2026.json` 의 `thresholds` · `rules` · `article` | 학업성적관리규정 조문에서 온 수치다. 코드 편의로 바꾸면 학교 규정과 어긋난다. 조문 개정 시에만, 계란님 확인 후 |
- **인증·보안 로직 변경** (승인 게이트, RLS 전제, 토큰 검증 경로)
- **API 키·비용 구조에 영향 주는 것** (모델 교체, max_tokens·상한, 캐싱 전략)
- **파괴적 작업** — 데이터 삭제, 파일 대량 삭제, force push 류
- **외부 서비스 설정 변경** (Supabase 대시보드, Vercel, Google Cloud)
- **`DECISIONS.md` 의 결정(D번호) 신설·변경** — 제안은 자유, **확정은 계란님**

> 판단이 서지 않으면 승인 필요 쪽으로 분류한다.

## 3. 불변 규칙

- **push 는 계란님이 직접 한다.** 세션은 커밋까지만.
- 계란님 수동 단계(SQL 실행, 대시보드 설정)는 **절차를 안내하고 결과를 확인**한 뒤 다음으로.
- **막히거나 애매하면 추측으로 진행하지 않고 질문한다.**
  틀린 전제 위에 쌓은 작업은 되돌리는 비용이 더 크다.
  → 이 프로젝트의 **제1원칙**과 같은 정신이다
  (`apps/main/api/doc-ai/_assets/prompt-rules.v2.md` — *"확실하지 않으면 되묻고,
  공란으로 두는 한이 있더라도 추정으로 잘못된 정보를 담지 않는다. 공란은 실패가 아니다 —
  잘못된 정보가 담긴 공문서가 실패다."*).
  AI 가 공문서를 쓸 때 지키는 규칙을, 세션이 코드를 쓸 때도 똑같이 지킨다.
- 실측이 문서를 이긴다 — 문서와 실제가 다르면 실제를 확인하고 문서를 고친다.
  (v1 교훈 3·4: `docs/DECISIONS.md` 3절)

## 4. 역할 분담 (DOC_AI_MASTER_PLAN 6절 요약)

| 주체 | 담당 |
|---|---|
| **Claude Web** | 설계, 파서 제작, 36블록 파싱, prefill 생성, 검증 리포트, **템플릿 재토큰화**, 마이그레이션 SQL 확정본 작성. 참고 파일은 이쪽으로 업로드 |
| **Claude Code** (이 세션) | 웹앱 통합(마스터플랜 Phase B), 검증 테스트, 배포 준비 |
| **계란님** | 파일 수급, 양식 확정, 매핑표, 매칭 리포트 검토, **SQL 실행**, **push** |

경계가 겹칠 때: **문서 생성 규칙·양식·토큰은 Web**, **웹앱 코드와 그 검증은 Code.**

## 5. 코드 관행

- **주석·커밋 메시지는 한국어.** 커밋 본문은 "무엇을" 보다 **"왜"** 를 적는다.
- 커밋 말미에 `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`
- **하드코딩 금지** — 필드 목록·학교 상수·양식 한도는 `_assets/` 의 자산에서 읽는다.
  자산이 바뀌면 프롬프트·검증·화면이 자동으로 따라가야 한다.
- **AI 는 내용만, 서식·계산은 코드가** (D19). 시수·만점 표기·합계는 서버가 계산하고
  AI 가 준 값이 달라도 덮어쓴다 — 교사가 본 값과 문서 값이 갈라지지 않게.
- 실패는 **안전한 쪽으로** — 승인 조회 실패는 "대기", 배점 불일치는 거부.
- **규정 위반은 근거를 붙여 거부** — `_regulation.py` 의 ERROR 는 생성을 막고 조문을
  같이 보여준다. WARN·FLAG 는 막지 않고 `notices` 로 알린다. 수치는 상한·하한만
  제안하고, 확정 권한은 교과협의회에 있다고 명시한다 (임의규정을 강제하지 않는다).
- **안 되는 걸 되는 것처럼 하지 않는다** (프롬프트 제0원칙). 양식이 못 담으면
  담은 척하지 말고, 만들되 무엇이 빠졌는지 알린다.

## 6. 검증

- 변경한 경로는 **실제로 돌려서** 확인한다 (빌드 통과만으로 끝내지 않는다).
- 테스트는 `tests/` 에 있고 `npm test` 로 전부 돌린다. `tests/README.md` 참조.
- 화면 변경은 `react-dom/server` 로 렌더해 문구·구조를 확인한다.
  깨진 입력(배열 자리에 문자열/null)에도 화면이 죽지 않는지까지 본다.
- Python 함수는 venv + lxml 로 실제 hwpx 를 생성해 확인한다.

## 7. 주요 경로

```
apps/main/
  src/pages, src/components, src/lib   ← 화면
  api/doc-ai/  chat.js generate.py extract.py _fill.py _regulation.py
  api/doc-ai/_assets/                  ← 프롬프트·상수·manifest·규정·template-{master,arts}.hwpx
  api/doc-ai/_assets/prefill/          ← 작년(2025-2) 교과·학년별 데이터 팩 23건 + 매칭리포트
  api/doc-ai/_assets/standards-db.json ← 성취기준·성취수준 DB 14개 교과 (✗ 를 메울 유일한 출처)
  api/_hwpx/                           ← hwpx 엔진 (수정 금지)
packages/shared/                       ← supabase·auth·permissions (DB 단일 접근점)
migrations/                            ← 001~ SQL + README(실행 기록)
docs/                                  ← DECISIONS · ROADMAP · SCHEMA · PHASE0_GUIDE
                                         DOC_AI_MASTER_PLAN
doc-ai-template-v3/                    ← Web 이 넘긴 마스터 양식 원본 + FINAL manifest
archive/doc-ai-v2/                     ← 구버전 양식·manifest (삭제 금지)
tests/                                 ← 검증 스크립트
```
