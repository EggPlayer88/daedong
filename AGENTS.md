# AGENTS.md — Codex 작업 규칙 (daedong-v2)

> 이 저장소의 규칙 원본은 **`CLAUDE.md`** 다. Codex 도 시작 전에 `CLAUDE.md` 를 전부 읽고
> 그대로 따른다. 이 파일은 Codex 에게 특히 중요한 것만 요약한다. 둘이 다르면 `CLAUDE.md` 가 이긴다.

**2026-10-20 역할 전환:** 사용자의 명시 지시에 따라 남은 구축과 증분 SQL 작성은 Codex,
검토·사용 피드백은 Claude가 맡는다. 운영 DB 적용과 기능 활성화·main 병합은 사용자가 한다.
기존 SQL을 덮어쓰지 않고 새 증분 파일과 검증 결과·실행 순서를 준비한다.

**대동여중 업무혁신시스템** — 배포: https://daedong-school.vercel.app
교사들이 실제로 쓰고 있는 서비스다. `main` 에 합쳐지는 순간 운영 사이트가 바뀐다.

## 작업 방식 (`CLAUDE.md` 3-1절)

- **`main` 에 직접 커밋·push 하지 않는다.** 작업 브랜치(`feat/…`, `fix/…`, `docs/…`, `chore/…`)를
  만들어 push 하고 PR 을 연다. **병합은 계란님만** 한다.
- **한 작업은 한 AI 가 전담한다.** Codex 가 맡은 브랜치는 Codex 가 만들고 Claude 가 검토한다.
  Claude 가 맡은 브랜치에는 커밋하지 않는다 — 검토를 맡으면 PR 리뷰 코멘트로 의견을 남긴다.
- **작업 전 `git pull`, 작업 후 `git push`.** 기준은 항상 GitHub 다.
- **PR 은 작게.** `main` 이 앞서가면 브랜치에 `main` 을 merge 한다 (rebase·force push 금지).
- PR 을 열기 전에 **`npm test` 를 돌려 전부 통과**하는지 확인한다. PR 에서도 같은 검사가 자동으로 돈다.

## 멈추고 계란님께 확인받을 것 (`CLAUDE.md` 2절)

- DB 마이그레이션·스키마·RLS 변경 (SQL 확정본은 Claude Web 이 쓰고 실행은 계란님이 한다)
- **확정본 수정 금지**: `migrations/*.sql`, `_assets/tpl-*.hwpx`·`_assets/token-map.json`,
  `apps/main/api/_hwpx/`, manifest 계약 섹션, `_assets/regulation-2026.json` 의 수치·조문
- 인증·보안 로직, API 키·비용 구조(모델·max_tokens·캐싱), 파괴적 작업, 외부 서비스 설정
- 메뉴 공개 범위 확대 — 신규 모듈은 `visibility: 'superadmin'` 이 기본 (`apps/main/src/lib/modules.js`)
- 판단이 서지 않으면 확인받는 쪽으로 분류한다. **추측으로 진행하지 않는다.**

## 코드 관행 (`CLAUDE.md` 5·6절)

- 주석·커밋 메시지는 **한국어**. 커밋 본문은 "왜" 를 적는다. 논리 단위로 커밋을 쪼갠다.
- 하드코딩 금지 — 필드 목록·학교 상수·양식 한도는 `apps/main/api/doc-ai/_assets/` 에서 읽는다.
- AI 는 내용만, 서식·계산은 코드가 한다. 실패는 안전한 쪽으로.
- 변경한 경로는 실제로 돌려서 확인한다. 테스트는 `tests/` (`tests/README.md`).
  Python 테스트는 `lxml` 이 필요하다: `python3 -m venv tests/.venv && tests/.venv/bin/pip install lxml`
