# AI 대화 업무 4차 — 통합 검증

2026-11-11. 3차 PR #120 `7ebd871c` 위의 복합 요청·협업·학교 자료·전체 일정 연결이다. 추가 SQL·운영 DB 적용·권한 확대·유료 AI 호출은 없다.

## 실행 결과

| 검사 | 결과 |
|---|---|
| 전체 `npm test` | **5,518건 통과**, Python 포함 |
| Workhub TypeScript | 통과 |
| main 앱 빌드 | 통과, 기존 큰 초기 번들 경고 유지 |
| 새 브라우저 4파일 | **40건 통과**: 계획 12, 모바일 8, 협업·학교 자료 8, 전체 일정 12 |
| 기존 브라우저 회귀 25파일 | **360건 통과** |
| 기존 일정 뷰 회귀 1파일 | 통과. 자체 건수 미출력이라 숫자 합계에서 제외 |
| 브라우저 최종 합계 | **30파일 모두 통과**, 개별 건수 출력 시나리오 400건 + 일정 뷰 1파일 |

같은 시험의 재실행은 합계에 중복해 더하지 않았다. 최초 통합 실행은 30파일 중 학교 관리 1파일이 실패했다. 아래 경합 보완 후 해당 11건을 재실행해 통과했다. 계획의 일반 질문 보강은 12건, 일정 상세 복구 보강은 12건으로 다시 확인했다. 마지막 일정 콜백 변경 뒤 일정 단위·기존 뷰/복구/가져오기·TypeScript·빌드를 추가 재확인했다.

브라우저 파일은 `tests/browser/`의 다음 목록이다.

- 신규: `workhub-assistant-plan`, `workhub-assistant-completion-mobile`, `workhub-assistant-remaining`, `workhub-assistant-calendar-workspace`.
- 기존: `workhub-assistant-specialists`, `workhub-assistant-timetable`, `workhub-assistant-teaching`, `workhub-assistant-administration`, `workhub-ai-foundation`, `workhub-assistant-operations`, `workhub-assistant-dock`, `workhub-assistant-documents`, `workhub-ui-renewal`, `workhub-assistant-ui`, `workhub-assistant-connected`, `workhub-assistant-calendar`, `workhub-assistant-workflows`, `workhub-cross-module`, `workhub-assistant-practice`, `workhub-global-search`, `workhub-knowledge-assistant`, `workhub-calendar-views`, `workhub-calendar-recovery`, `workhub-calendar-import`, `workhub-cooperation-batch`, `workhub-cooperation-handover`, `workhub-knowledge`, `workhub-knowledge-import`, `workhub-assistant`, `workhub-documents`.

실행 명령:

```text
npm test
npm run check:workhub
npm run build
node tests/browser/run.mjs workhub-assistant workhub-ai-foundation workhub-cross-module workhub-global-search workhub-knowledge workhub-cooperation workhub-calendar workhub-ui-renewal workhub-assistant-dock workhub-documents
node tests/browser/run.mjs workhub-assistant-plan workhub-assistant-administration
node tests/browser/run.mjs workhub-assistant-calendar-workspace workhub-calendar-views workhub-calendar-recovery workhub-calendar-import
npm test -- calendar
```

## 중점 확인

- 최대 4개 명시적 요청을 순서대로 보관하되 단계 선택은 입력만 준비. 전송/저장/다음 단계 자동 실행 없음. 번호 목록 일반 질문은 기존 AI 대화로, 명령과 미지원 요청이 섞이면 전체 보류.
- 인용과 콜론 뒤 메시지 본문은 다른 업무로 승격하지 않음. 새 입력 덮어쓰기와 기존 계획의 조용한 교체 방지.
- 기준일 변경 전 선택한 상대 날짜 입력은 현재 날짜로 자동 재해석하지 않음. 원문 재검토 또는 명시 목록 닫기 후 입력 확인.
- 협업 요청·완료 확인과 학교 자료 게시/원문 조회는 같은 기존 화면·함수 재사용. 학교 자료 ID·판·locator 유지.
- 공유/여러 날짜/대상 지정 일정, 원본 충돌 비교, 일괄 저장과 원래 요청 복구. 검색 상세를 닫고 일괄 편집하다 재연결해도 숨은 모달이 재열리지 않음.
- 기존 업무 편집기 한 개만 유지하며 처리 중 메뉴 이동 보호, 현재 소속 확인, 보관 입력·같은 요청 번호 유지.
- 320px, 화면 높이 축소, 두 배 글씨에서 단계·입력·복구·복귀·학교 관리 선택을 확인.

## 검사 중 수정한 문제

1. **날짜 변경:** 목록의 날짜만 경고하고 이미 선택한 입력은 새 기준일로 실행될 수 있었다. 버튼과 실행 함수 양쪽에서 다시 검토하기 전 실행을 막았다.
2. **일반 질문 목록:** 번호를 붙였다는 이유로 일반 질문을 미지원 명령으로 막았다. 모든 항목이 일반 질문이면 기존 AI 대화로 넘기고 혼합 명령은 계속 전체 보류한다.
3. **일정의 숨은 모달:** 상세 검색 요청을 소비한 뒤 일괄 입력을 복원하면서 과거 요청이 숨은 CalendarPanel의 모달을 다시 열었다. 실제 수락한 요청키를 탭 메모리에 보관하고 숨은 패널에는 상세 요청을 전달하지 않는다.
4. **학교 관리 시험 경합:** 저장 안내가 먼저 보이고 부모 잠금 해제는 다음 렌더에서 반영된다. 즉시 값을 읽던 시험은 저장 안내·선택 활성·부모 잠금 해제·미확정 요청 0을 기다리도록 보완했다. 원키/원문/실제 적용 1회 판정은 유지했다.

처음 제한 환경의 전체 시험은 임시 폴더, 로컬 HTTP, Git Bash 실행 권한으로 19파일이 실패했다. 제품 코드나 기대값을 바꾸지 않고 정상 PC 환경에서 다시 실행했다. 이 실패를 통과 숫자에 숨기지 않는다.

## 범위와 한계

브라우저는 실제 React·연결 셸·전송 어댑터·파서에 합성 DB/Storage/provider 응답을 넣었다. 운영 서버 왕복, 실제 교사 계정의 업무 처리, 실제 AI 답변 품질의 검증 결과가 아니다. 모바일은 데스크톱 브라우저의 viewport/글자 확대이며 실제 휴대폰 키보드·IME 시험은 별도다.

기존 DB/RPC/RLS, 로그인·권한·메뉴 공개, Haiku/Sonnet 배정·학교 예산·파일 생성 엔진 diff 없음. 자연어를 분류하고 단계를 만드는 데 새 유료 요청을 추가하지 않았다.

[업무 연결표](coverage.md)의 51/61(83.6%)는 AI 내부 이용 경로의 비율이다. 기본 화면·확인 카드 8개와 내장 업무 패널 43개이며, 자연어만으로 90% 완료한다는 뜻은 아니다. 운영 성공률은 측정하지 않았다.

일반 메뉴는 유지되며 이전 기능을 삭제하지 않았다. 반영은 #118 → #119 → #120 → 4차 PR 순서로 각 최신 CI와 base를 확인한 뒤 사용자가 병합한다. 추가 SQL은 없다.
