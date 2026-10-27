# AI 화면 자동 검증

2026-10-27 · Windows / Chrome · 기준 main `807d7ba`.

| 검사 | 결과 |
|---|---:|
| `npm test` | **5,204 / 실패 0** |
| 관련 브라우저 | **12개 파일 · 177개 항목 / 실패 0** |
| 새 AI UI 회귀 | 위 결과에 포함된 **25건** |
| `npm run check:workhub` | 통과 |
| `npm run build` | 통과 |
| `npm run build:workhub` | 통과 |
| `npm run check:workhub:design` | 오류 0 |
| `git diff --check` | 통과 |

운영 앱의 기존 500kB 초과 청크 경고는 남아 있다. 이번 변경에서 번들 분리 구조를 바꾸지 않았다.

## 브라우저 검사 범위

| 파일 | 항목 |
|---|---:|
| workhub-assistant-ui | 25 |
| workhub-ui-polish | 6 |
| workhub-ai-memory | 18 |
| workhub-assistant-practice | 10 |
| workhub-ai-operations | 13 |
| workhub-ai-school-policy | 15 |
| workhub-knowledge-assistant | 20 |
| workhub-assistant | 27 |
| workhub-ui-renewal | 9 |
| workhub-cross-module | 8 |
| doc-ai-school-policy | 11 |
| workhub-guided-ai | 15 |
| **합계** | **177** |

[기존 AI 회귀 7개 파일](browser-core.json), [연결 회귀 4개 파일](browser-integration.json), [새 화면 25건](ui-results.json).

```text
node tests/browser/run.mjs workhub-assistant workhub-ai-memory workhub-ai-school-policy workhub-ai-operations workhub-ui-polish workhub-knowledge-assistant
node tests/browser/run.mjs workhub-ui-renewal workhub-guided-ai doc-ai-school-policy workhub-cross-module
node tests/browser/workhub-assistant-ui.mjs
```

첫 실행에는 새 UI 파일을 등록하기 전 7개 파일을 검사했고 새 파일은 독립 실행했다. 이후 첫 명령으로 실행하면 새 UI 파일도 포함된다.

## 확인한 보존 동작

- 화면 열기·도구 펼치기·스킨 변경만으로 AI 호출·기억 저장·키 저장을 하지 않는다.
- 정밀 검토는 직접 누른 후 원래 답변 요청 번호를 가지고 별도 요청으로 보낸다.
- 자료 제목·판·인용 줄바꿈과 원문 이동 당시 ID/판이 유지된다.
- 기억 검색·선택·수정·중지·삭제·복구에서 내용 확인과 원래 요청 번호가 유지된다.
- 키 입력을 접어도 미확정 저장의 복구를 숨기지 않는다. 재진입 뒤 키를 재전송하지 않고 같은 요청 번호로 결과를 확인한다.
- 관리 권한이 없으면 키 교체 입력·버튼이 없다. 학교/계정 변경 뒤 이전 입력·응답을 노출하지 않는다.
- 320px, 두 배 글자 크기, 밝음·따뜻함·어두움 스킨에서 주요 텍스트 대비 4.5:1 이상, 가로 넘침·키보드 접근·입력 보존을 확인했다.
- 실제 업무실 AI 옆자리, 질문형 양식의 원질문 복귀, 평가계획서 학교 AI 정책, 메시지 초안 전달 회귀가 통과했다.

## 시험 중 발견·수정

- 새 화면의 실제 스킨 검사에서 따뜻한 배경 위 판 번호가 4.45:1로 기준에 못 미쳤다. 판 정보·예산 라벨·선택된 기억 메타·운영 상태의 글자색을 보완해 세 스킨을 모두 통과했다.
- 기존 시험의 평면 `details` 선택과 예산 패널의 부모 탐색을 새 중첩 구조에 맞췄다. 값·원문 판·질문 우선 순서·유료 호출 횟수 기대값은 유지했다.
- 새 운영 화면 시험은 StrictMode의 초기 읽기 횟수를 고정 1회로 가정하지 않고, 상세 펼치기 전후 읽기 횟수 불변과 쓰기 0을 확인한다.

## 경계

React·전송 어댑터·브라우저는 실제 코드이고 DB/Storage/AI 응답은 합성이다. 운영 DB·실제 키·유료 AI를 호출하지 않았다. 이 결과는 새 배포의 실제 서버 왕복 성공을 대신하지 않는다. SQL·인증·권한·메뉴 등록·AI 정책·파일 생성 엔진·API 서버 경로 변경은 없다.

로컬 자동 검증 완료와 GitHub 원격 CI 완료는 별개다. 원격 결과는 PR의 최신 커밋에서 확인한다.
