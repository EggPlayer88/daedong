# AI 대화 업무 3차 검증

2026-11-11. 2차 PR #119 위의 시간표·수업·기록·학교 관리 연결. 추가 SQL 없음. 실제 운영 DB/Storage/provider/계정 변경 없음.

## 결과

| 검사 | 결과 |
|---|---|
| 전체 `npm test` | 5,505건 통과, Python 포함 |
| Workhub TypeScript | 통과 |
| main 앱 빌드 | 통과 |
| 신규 전문 대화 브라우저 4파일 | 44건 통과 |
| 기존 대화·문서·검색·연결 브라우저 7파일 | 105건 통과 |
| 기존 시간표·수업·인계·관리 화면 5파일 | 121건 통과 |
| #119 CI 후속 문서·UI·옆자리 회귀 3파일 | 13건 통과 |
| 브라우저 합계 | 19파일, 서로 다른 시나리오 283건 통과 |

브라우저는 실제 React·연결 셸·어댑터·파서에 합성 계정/RPC 응답을 넣었다. 운영 Supabase 왕복이나 실제 AI 답변 품질의 검증 결과로 간주하지 않는다. 같은 파일의 재실행은 합계에 중복해서 더하지 않았다.

## 시험별 근거

| 파일 (`tests/browser/`) | 건수 | 중점 |
|---|---:|---|
| workhub-assistant-specialists | 10 | 대화 분류→실제 연결 셸→업무 패널, 후보 ID, 단일 편집기, 입력 잠금, 신원 무효화, 320px |
| workhub-assistant-timetable | 11 | 수업 조회, 교환·대강 진입, 영향 비교, 명시 요청/승인, 자기 승인 차단, 원키 복구 |
| workhub-assistant-teaching | 12 | 수업/학생 직접 선택, 활동 CSV 진입, 원문 근거판·hash·epoch·구간, 잘못된 근거 제외, 입력·복구 |
| workhub-assistant-administration | 11 | 현재 원본 비교, 인계 영향/확인, 재연결 시 올바른 탭, 같은 요청 복구, 320px |
| workhub-ai-foundation | 7 | 일반/전문 지침·입력·비용 경계 |
| workhub-assistant-connected | 15 | 개인 일정/할 일, 선택 원본, 입력 보존, 현재 권한 |
| workhub-assistant-calendar | 8 | 누락 정보·개인 일정 검토·같은 요청 복구 |
| workhub-cross-module | 29 | 메시지·수합·질문형 문서·생성 파일·AI 답변 복귀 |
| workhub-global-search | 11 | 검색 범위·정확한 판·실패 분리 |
| workhub-guided-ai | 17 | 답변 원본·양식/판 비교·복구 |
| workhub-pilot-connected | 18 | 기존 일정·학교 연결·모듈 격리 |
| workhub-timetable-exchanges | 24 | 기존 교환·동의·승인 |
| workhub-timetable-operation-navigation | 12 | 기존 조회·요청·보관 입력 동선 |
| workhub-teaching | 21 | 기존 수업·평가·기록 |
| workhub-school-transitions | 54 | 기존 인계·학년도 전환 계약 |
| workhub-school-records-ui | 10 | 기존 학교/학생 화면 |
| workhub-assistant-documents | 2 | HWPX 생성·다운로드·수합 전달, 처리 중 잠금·원키 복구 |
| workhub-ui-renewal | 9 | 일반 메뉴 입력과 AI 옆자리 숨김·복귀, 결과 미확정, 모바일 |
| workhub-assistant-dock | 2 | 기존 AI 옆자리 접기·다시 열기 |

단위 신규 `test_workhub_assistant_specialists.mjs` 7건은 12개 업무 별칭, 부정/인용/복합 지시, 기존 검색, 동적 초안 슬롯, 현재 활성 범위의 초안 조회를 확인하며 전체 5,505건에 포함한다.

## 확인하고 보완한 것

- 과거 알림의 `transitionOpen`/`timetableOpen`이 새 전문 요청을 덮어쓰지 않도록 새 요청의 진입에서 이전 이동 정보 폐기.
- 학교 관리의 다른 탭에서 미확정 요청을 만든 뒤 재연결해도 해당 원래 탭을 우선 복원.
- 2차 메시지의 접어 둔 초안으로 답변을 돌리는 경로를 새 전문 편집기 보호가 막지 않도록 구분하고 교차 모듈 29건 재확인.
- 활동 CSV는 일반 근거 탭만 여는 대신 담당 수업 선택 후 기존 입력기로 진입. 취소/권한 거절 후 지연 실행 없음.
- 대강은 교환 입력 대신 기존 대강 입력으로 진입. 미확정 교환과 보관 입력이 있으면 해당 작업 우선.
- 기존 `workhub-assistant-connected`의 시간표 이동 기대값은 일반 페이지 h1에서 대화 작업 패널로 변경. 쓰기 0 검사는 유지하고 `view=assistant`·단일 시간표 인스턴스를 추가. 최초 1개 파일 실패 뒤 수정본은 15건 모두 통과.
- #119의 CI에서 일반 페이지의 AI 옆자리 닫기까지 메뉴 이동 잠금으로 막는 회귀를 확인했다. 옆자리 접기는 같은 편집기와 미확정 요청을 유지하므로 허용하고, 실제 화면이 바뀌는 AI 전체 화면의 닫기는 계속 잠근다. 기존 UI 9건·AI 패널 2건을 그대로 통과하며 #119에도 동일 수정한다.
- #119의 문서 브라우저 시험은 미처 관찰하지 않은 다운로드 Promise가 원래 단언 오류를 브라우저 종료 오류로 덮었다. Promise를 함께 관찰하고, Storage를 보류한 상태에서 상위 화면의 잠금 반영을 기다린 뒤에만 파일을 내려받도록 보강했다. 잠금·원본 해시·수합 전달·같은 번호 복구 판정은 유지했다. CI의 최초 단언 원문은 가려져 있어 잠금 반영 경합이 최초 원인이었다고 단정하지 않는다. 로컬에서는 제한 실행의 다운로드 취소 뒤 합성 localhost만 일반 실행으로 재시험해 2건을 통과했다.

## 실행과 한계

```text
npm test
npm run check:workhub
npm run build
node tests/browser/run.mjs workhub-assistant-specialists workhub-assistant-timetable workhub-assistant-teaching workhub-assistant-administration
node tests/browser/run.mjs workhub-ai-foundation workhub-assistant-connected workhub-assistant-calendar workhub-cross-module workhub-global-search workhub-guided-ai workhub-pilot-connected
```

일반 페이지/대화 패널의 320px 레이아웃은 합성 브라우저로 확인했다. 실제 휴대폰 키보드와 운영 교사 피드백, 실제 provider 응답의 전문성은 별도다. 초기 번들 약 594KB 경고는 기존과 같은 범주이며 이번에 성능 문제가 해결됐다고 주장하지 않는다.

미저장 전문 입력 중에는 기존 이동 잠금을 유지한다. AI와 수다를 나누면서 모든 편집기를 동시에 변경하는 구조가 아니다. 저장/취소 뒤 대화로 돌아오며, 읽기 상태의 선택 원본과 AI 문맥은 같은 컴포넌트에서 유지한다.

DB/RPC/RLS·인증·메뉴 공개·모델/예산·HWPX 엔진 diff 없음. 운영 반영은 #118 → #119 → 이번 3차 PR 순서로 각 기준 브랜치를 확인하고 검토/CI 통과 후 사용자가 병합한다.
