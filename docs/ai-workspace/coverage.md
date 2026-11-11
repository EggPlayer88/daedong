# AI 업무 연결 범위와 근거 목록

2026-11-11. 기준은 3차 `7ebd871c`와 이번 4차 연결이다. 목록 원본은 [coverage.json](coverage.json)이다. **사이트 전체 구축 진척도가 아니라, 현재 기능을 AI 작업 공간에서 이용할 수 있는 범위**를 측정한다.

## 집계 방법

교사·관리자가 하나의 결과를 얻는 61개 업무를 같은 비중으로 셌다. 명령 별칭·버튼 수·오류 사례를 업무 수에 더하지 않았다. 개인·공유 일정, 관찰·평가처럼 확인 계약이 다른 작업은 나누고, 같은 계약의 수정·중지·삭제는 한 관리 업무로 묶었다. 실제 사용 빈도를 측정하지 않았으므로 가중치로 수치를 높이지 않는다. 전체 범위에는 기존 평가계획서와 공통 관리자 화면도 포함했다. 시험 사이트 운영·SQL 적용·Vercel 배포·외부 API 계정 발급은 사이트 사용자 업무가 아니므로 제외했다.

AI 안의 기존 작업 패널은 대상 선택·비교·버튼 확인을 사용한다. 이 경로를 “자연어만으로 완료”라고 부르지 않는다. 메뉴 이동이나 검색 결과 목록만 있는 경우도 해당 업무 완료로 세지 않는다.

## 현재 경로 지원

| 구분 | 업무 수 | 의미 |
|---|---:|---|
| AI 기본 화면·확인 카드 | 8 | AI 기본 화면에서 질문·정보 보완·확인 카드 사용 |
| AI 안 기존 업무 패널 | 43 | 대화에서 기존 편집기·조회·확정 화면을 내부 패널로 사용 |
| 일반 업무 화면 연결 | 4 | 일반 메뉴로 이동해 업무 수행 |
| 외부 도구 단계 필요 | 1 | 로컬 계산 작업자 등 사이트 밖 단계 포함 |
| AI 업무 연결 없음 | 5 | 기존 기능은 유지되지만 AI가 해당 업무를 이어 받지 못함 |

**AI 작업 공간 안의 지원 경로: 51/61개 (83.6%).** 이 중 8개는 AI 기본 화면·확인 카드, 43개는 기존 업무 패널이다. 따라서 전체 사이트에서 “대화만으로 90% 이상 완료”는 아직 입증되지 않았다.

AI 표시 상태에서 대표 결과까지 다루는 직접 회귀 근거는 **23/61개 (37.7%)**에 있다. 나머지는 기존 업무 회귀와 AI 진입 검사를 조합했다. 이것도 현재 커밋의 실행 성공률이 아니라 **시험 근거의 범위**다. 테스트 파일 존재 여부로 통과를 주장하지 않으며, 이번 실행 결과와 운영 검증의 구분은 통합 검증 기록을 따른다.

## 남은 연결의 우선순위

1. 할 일 제목 정정·다시 시작·기타 상태 변경: 원래 업무 화면에서 처리한다. AI의 메모·기한·완료 카드가 이 작업들까지 지원하는 것으로 세지 않는다.
2. 홈 업무 요약·급식과 알림의 원본 열기: 일부는 일반 화면으로 이동한다. 자료가 사라지는 문제는 아니지만 AI 안 완료로 집계하지 않는다.
3. 평가계획서 작성·제출: 일반 HWPX 수합과 다른 기존 전용 흐름이다. 기간 업무 메뉴 및 기존 파일 엔진을 유지한 채 연결을 별도 검토해야 한다.
4. 사용자 승인·전역 권한·기간 업무·개인화 설정: 관리자 또는 개인 설정의 명시 확인이 필요하며 현재 AI 명령으로 대신 변경하지 않는다.
5. 시간표 계산 작업자: 로컬 실행과 결과 가져오기는 외부 단계로 유지한다. 웹 대화만으로 계산 실행을 완료했다고 보고하지 않는다.

새로 연결한 공유·대상 지정·여러 날짜 일정, 기존 일정 변경, 일괄 입력은 원래 일정 편집기와 미리보기 계약을 AI 패널 안에서 이용한다. 자연어가 일정의 모든 필드를 자동 입력하거나 저장을 자동 확정하는 뜻은 아니다.

이 목록은 미연결 부분을 이번에 무조건 구현하거나 권한·비용 변경을 승인한다는 뜻이 아니다. 기존 기능은 원래 메뉴에서 계속 사용할 수 있다.

## 업무별 근거

`직접`은 해당 AI 표시 상태에서 대표 작업의 결과를 확인하는 회귀가 있는 항목, `조합`은 AI 진입/공통 표시와 원래 업무 회귀를 조합한 항목, `코드`는 연결되지 않은 기능의 코드 확인이다. 모든 시험의 성공 여부는 해당 커밋 실행 기록으로 별도 확인한다.

### AI

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| A01 | 일반·업무별 질문과 Haiku 답변·Sonnet 재검토 | AI 기본 화면·확인 카드 | 직접 | 질문·분야 선택 후 답변과 정밀 검토 결과 확인. 실제 provider의 답변 품질은 합성 응답 시험으로 증명하지 않음. [workhub-ai-foundation](../../tests/browser/workhub-ai-foundation.mjs) · [workhub-assistant-ui](../../tests/browser/workhub-assistant-ui.mjs) |
| A02 | 게시 학교 자료를 근거로 질문하고 인용 확인 | AI 기본 화면·확인 카드 | 조합 | 선택한 자료 판·위치의 답변 근거와 원문 확인. 원문 열기 패널과 실제 유료 답변을 한 운영 왕복으로 재시험한 결과 아님. [workhub-assistant-ui](../../tests/browser/workhub-assistant-ui.mjs) · [workhub-knowledge-assistant](../../tests/browser/workhub-knowledge-assistant.mjs) |
| A03 | 개인 기억 저장·수정·중지·선택 사용 | AI 기본 화면·확인 카드 | 직접 | 명시 보관 확인과 선택한 최신 기억을 질문에 반영. 모든 대화를 자동 기억하지 않으며 비밀번호·상담 자료 수집 기능 아님. [workhub-ai-memory](../../tests/browser/workhub-ai-memory.mjs) |
| A04 | 허용 자료 검색과 결과 선택 | AI 기본 화면·확인 카드 | 직접 | 8개 자료 종류의 검색 결과·누락 범위 확인. 자료원 첫 쪽·최대 표시 수 제한이 있고 원문 완료는 각 업무에서 따로 확인. [workhub-assistant-workflows](../../tests/browser/workhub-assistant-workflows.mjs) · [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) |

### 개인 업무

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| W01 | 새 할 일 제안 검토·등록 | AI 기본 화면·확인 카드 | 직접 | 제목·기한·메모 검토 후 접수 결과 확인. 원래 유료 제안·확정 절차 유지. [workhub-assistant-workflows](../../tests/browser/workhub-assistant-workflows.mjs) |
| W02 | 기존 할 일 메모·기한 수정 | AI 기본 화면·확인 카드 | 직접 | 동명 후보 선택·원본 비교·같은 요청 저장. 원본 판 충돌 시 새 판에 임의 덮어쓰기 없음. [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) · [workhub-assistant-operations](../../tests/browser/workhub-assistant-operations.mjs) |
| W03 | 기존 할 일 완료 | AI 기본 화면·확인 카드 | 직접 | 선택한 개인 업무 한 건의 완료 결과 확인. 협업 완료 확인과 일반 할 일 완료를 동일 처리하지 않음. [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) · [workhub-assistant-operations](../../tests/browser/workhub-assistant-operations.mjs) |
| W04 | 할 일 제목 정정·다시 시작·기타 상태 변경 | 일반 업무 화면 연결 | 조합 | 일반 업무 화면의 수정·다시 시작·상태 선택. AI 확인 카드는 메모·기한·완료만 지원하므로 제목 변경과 재개는 원래 화면에서 수행. [TaskPanel](../../apps/workhub/src/tasks/TaskPanel.tsx) · [TaskCard](../../apps/workhub/src/tasks/TaskCard.tsx) · [workhub-tasks](../../tests/browser/workhub-tasks.mjs) |

### 일정

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| C01 | 개인 일정의 누락 정보 보완·등록 | AI 기본 화면·확인 카드 | 직접 | 한 날짜·나만 보기 일정 검토·저장. 학교 공유·여러 날짜·반복 일정을 임의 개인 일정으로 바꾸지 않음. [workhub-assistant-calendar](../../tests/browser/workhub-assistant-calendar.mjs) · [workhub-assistant-operations](../../tests/browser/workhub-assistant-operations.mjs) |
| C02 | 공유·대상 지정·여러 날짜 일정 작성 | AI 안 기존 업무 패널 | 직접 | 기존 일정 화면에서 대상·기간·내용 검토·저장. 실제 CalendarPanel과 합성 어댑터로 공유·여러 날·직접 대상 저장을 검증; 운영 왕복 아님. [workhub-assistant-calendar-workspace](../../tests/browser/workhub-assistant-calendar-workspace.mjs) · [workhub-calendar-views](../../tests/browser/workhub-calendar-views.mjs) |
| C03 | 기존 일정 수정 | AI 안 기존 업무 패널 | 직접 | 검색한 일정의 원본·판 비교 뒤 수정 확인. 현재 판 충돌 비교와 재저장을 검증; 삭제·취소 UI는 현재 지원하지 않음. [workhub-assistant-calendar-workspace](../../tests/browser/workhub-assistant-calendar-workspace.mjs) · [workhub-calendar-views](../../tests/browser/workhub-calendar-views.mjs) |
| C04 | 일정 일괄 가져오기·대상 비교 | AI 안 기존 업무 패널 | 직접 | 입력 원문·기간·대상 비교 후 일괄 저장. 원문·대상 비교, 선택 저장과 미확정 원키 복구를 검증; 운영 왕복 아님. [workhub-assistant-calendar-workspace](../../tests/browser/workhub-assistant-calendar-workspace.mjs) · [workhub-calendar-import](../../tests/browser/workhub-calendar-import.mjs) |

### 메시지

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| M01 | 메시지 본문·수신자·첨부 검토·전송 | AI 안 기존 업무 패널 | 직접 | 대상 선택·HWPX 확인·명시 전송·접수증. 대상 교사 자동 선택·확인 없는 전송 없음. [workhub-messaging](../../tests/browser/workhub-messaging.mjs) · [workhub-messaging-deliveries](../../tests/browser/workhub-messaging-deliveries.mjs) |
| M02 | 받은 메시지 조회·읽음·첨부 내려받기 | AI 안 기존 업무 패널 | 조합 | 허용된 대화 원문과 파일 조회. 학교·참여자 검사는 기존 서버가 수행. [workhub-messaging](../../tests/browser/workhub-messaging.mjs) · [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) |
| M03 | 업무 알림에서 원래 업무 열기 | 일반 업무 화면 연결 | 조합 | 알림의 원본 업무·요청 ID 확인. 알림 출처가 일반 화면으로 연결될 수 있어 AI 안 완료로 세지 않음. [workhub-home-message](../../tests/browser/workhub-home-message.mjs) · [workhub-timetable-notification](../../tests/browser/workhub-timetable-notification.mjs) |

### 수합

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| F01 | 양식 포함 수합 초안 작성·검토·공개 | AI 안 기존 업무 패널 | 직접 | 수합 제목·기한·대상·양식 확인 뒤 초안과 별도 공개. 초안 저장을 공개 성공으로 간주하지 않음. [workhub-collection-conversation](../../tests/browser/workhub-collection-conversation.mjs) |
| F02 | HWPX 제출 초안·최종 제출 | AI 안 기존 업무 패널 | 직접 | 파일 검사·초안·최종 확인·접수 시각. 양식 파일과 제출 파일을 구분. [workhub-collection-conversation](../../tests/browser/workhub-collection-conversation.mjs) |
| F03 | 보완 요청·마감 후 보완 재제출 | AI 안 기존 업무 패널 | 조합 | 허용된 보완 단위·기한 안의 새 접수. AI 연결 진입과 기존 수합 회귀를 조합한 근거이며 운영 재제출 실측 아님. [workhub-collection-followup](../../tests/browser/workhub-collection-followup.mjs) · [workhub-collection-conversation](../../tests/browser/workhub-collection-conversation.mjs) |
| F04 | 제출 현황·미제출 확인·전체 ZIP | AI 안 기존 업무 패널 | 조합 | 허용된 제출 현황과 파일 묶음·CSV. 미제출 알림 발송도 기존 명시 확인 유지. [workhub-collection-submission-list](../../tests/browser/workhub-collection-submission-list.mjs) · [workhub-collection-export](../../tests/browser/workhub-collection-export.mjs) |
| F05 | 마감·재개·기한 연장·보관 | AI 안 기존 업무 패널 | 조합 | 원본 판·대상 영향 확인 뒤 상태 변경. 기존 모듈 활성화 및 담당 권한 필요. [workhub-collection-operations](../../tests/browser/workhub-collection-operations.mjs) · [workhub-collection-conversation](../../tests/browser/workhub-collection-conversation.mjs) |

### 문서

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| D01 | 개인 문서 작성·수정·저장·공유 | AI 안 기존 업무 패널 | 조합 | 원문·문서 판·공유 범위 확인. 학교 공유 권한 확대 없음. [workhub-documents](../../tests/browser/workhub-documents.mjs) · [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) |
| D02 | 질문형 양식 원본·질문·위치 연결 | AI 안 기존 업무 패널 | 조합 | 원양식·질문 위치 비교·시험 답변·게시. AI 제안만으로 연결·게시하지 않음. [workhub-guided-setup](../../tests/browser/workhub-guided-setup.mjs) · [workhub-guided-ai](../../tests/browser/workhub-guided-ai.mjs) |
| D03 | 질문 답변·HWPX 생성·내려받기 | AI 안 기존 업무 패널 | 직접 | 저장한 답변 판으로 생성·해시 비교·파일 확인. 원래 Python 생성 엔진과 확인 절차 사용. [workhub-assistant-documents](../../tests/browser/workhub-assistant-documents.mjs) |
| D04 | 생성 문서를 수합에 첨부·최종 제출 | AI 안 기존 업무 패널 | 직접 | 별도 수합 파일 예약·검사·접수 결과. 문서 생성 성공을 수합 제출로 대신 표시하지 않음. [workhub-assistant-documents](../../tests/browser/workhub-assistant-documents.mjs) |

### 학교 자료

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| K01 | HWPX 원본 가져오기·본문 추출·초안 | AI 안 기존 업무 패널 | 조합 | 원본 검사·추출·초안 저장. 직접 AI 회귀는 텍스트 초안 저장이며 HWPX 가져오기·추출은 원래 패널 회귀와 조합; 게시 전 확인 필요. [workhub-assistant-remaining](../../tests/browser/workhub-assistant-remaining.mjs) · [workhub-knowledge-import](../../tests/browser/workhub-knowledge-import.mjs) |
| K02 | 자료 수정·게시·종료·유효기간 관리 | AI 안 기존 업무 패널 | 직접 | 현재 판·게시 범위·유효기간 확인. AI 상태의 초안 저장·게시 결과를 검증; 종료·유효기간은 원래 패널 회귀와 조합. [workhub-assistant-remaining](../../tests/browser/workhub-assistant-remaining.mjs) · [workhub-knowledge](../../tests/browser/workhub-knowledge.mjs) |
| K03 | 과거 판·인용 위치·원본 HWPX 조회 | AI 안 기존 업무 패널 | 직접 | 요청한 sourceId·version·locator와 원본 확인. AI 안 과거 판·질문 근거 전달을 검증; HWPX 원본 다운로드는 원래 패널 회귀와 조합. [workhub-assistant-remaining](../../tests/browser/workhub-assistant-remaining.mjs) · [workhub-knowledge-assistant](../../tests/browser/workhub-knowledge-assistant.mjs) · [workhub-assistant-connected](../../tests/browser/workhub-assistant-connected.mjs) |

### 협업

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| O01 | 협업 요청·수락·반려·완료 확인 | AI 안 기존 업무 패널 | 직접 | 수신자 요청·할 일 연결·완료 요청·요청자 확인. AI 상태의 요청·수락·완료 요청 결과를 검증; 반려와 요청자의 최종 완료 확인은 원래 패널 회귀와 조합. [workhub-assistant-remaining](../../tests/browser/workhub-assistant-remaining.mjs) · [workhub-cooperation-batch](../../tests/browser/workhub-cooperation-batch.mjs) |
| O02 | 기존 협업 조회·처리 이력·연결 업무 | AI 안 기존 업무 패널 | 조합 | 현재 담당자와 변조 없는 이력 확인. 원래 이력 파서와 권한을 유지하며 연결 업무 열기는 일반 화면으로 이어질 수 있음. [workhub-assistant-remaining](../../tests/browser/workhub-assistant-remaining.mjs) · [workhub-cooperation-handover](../../tests/browser/workhub-cooperation-handover.mjs) |

### 시간표

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| T01 | 학기·공간·정원·수업·학급·시수 준비 | AI 안 기존 업무 패널 | 조합 | 준비 원본·누락·기준판 확인. 학교 기초 자료 변경은 기존 담당 권한과 미리보기 유지. [workhub-timetable-preparation](../../tests/browser/workhub-timetable-preparation.mjs) · [workhub-timetable-setup-batch](../../tests/browser/workhub-timetable-setup-batch.mjs) · [workhub-assistant-specialists](../../tests/browser/workhub-assistant-specialists.mjs) |
| T02 | 하드·소프트 조건과 AI 제안 검토 | AI 안 기존 업무 패널 | 조합 | 제안 전후 조건·충돌·원본 고정. 제안이 직접 편성을 확정하지 않음. [workhub-timetable-condition-review](../../tests/browser/workhub-timetable-condition-review.mjs) · [workhub-timetable-assistant](../../tests/browser/workhub-timetable-assistant.mjs) |
| T03 | 계산기 실행·후보 결과 가져오기 | 외부 도구 단계 필요 | 조합 | 로컬 계산 작업과 결과 파일 확인. 별도 Python 작업자·폴더 연결이 필요하므로 사이트 대화만으로 완료하지 못함. [workhub-timetable-local-engine](../../tests/browser/workhub-timetable-local-engine.mjs) · [workhub-timetable-worker](../../tests/browser/workhub-timetable-worker.mjs) |
| T04 | 생성 후보 비교·수동 조정·엑셀 입출력 | AI 안 기존 업무 패널 | 조합 | 후보 점수·충돌·수업 배치·판 유지. 편성 편집기 조작을 말만으로 자동 수행하지 않음. [workhub-timetable-candidate-library](../../tests/browser/workhub-timetable-candidate-library.mjs) · [workhub-timetable-adjustments](../../tests/browser/workhub-timetable-adjustments.mjs) · [workhub-timetable-workbook](../../tests/browser/workhub-timetable-workbook.mjs) |
| T05 | 학기 시간표 확정·공개 | AI 안 기존 업무 패널 | 조합 | 현재 편성안과 적용 기간 영향 비교 후 접수. AI가 공개 버튼 대신 승인하지 않음. [workhub-timetable-publication-commit](../../tests/browser/workhub-timetable-publication-commit.mjs) · [workhub-assistant-specialists](../../tests/browser/workhub-assistant-specialists.mjs) |
| T06 | 날짜별 시간표·교사·학급 조회·출력 | AI 안 기존 업무 패널 | 직접 | 확정 수업과 변경 이력·출력 원문 확인. AI 상태의 날짜별 조회를 검증; 출력은 원래 패널 회귀와 조합하며 실제 교사 PC의 PDF 품질은 별도. [workhub-assistant-timetable](../../tests/browser/workhub-assistant-timetable.mjs) · [workhub-timetable-published-export](../../tests/browser/workhub-timetable-published-export.mjs) |
| T07 | 교환 요청·양쪽 동의·별도 승인 | AI 안 기존 업무 패널 | 직접 | 영향 비교·동의·현재 판 승인·반영 결과. 자기 승인 금지 및 승인자 조건 유지. [workhub-assistant-timetable](../../tests/browser/workhub-assistant-timetable.mjs) · [workhub-timetable-exchanges](../../tests/browser/workhub-timetable-exchanges.mjs) |
| T08 | 대강·보강 요청·실시 기록 | AI 안 기존 업무 패널 | 조합 | 대상·시간·당사자·승인·실시 기록. 대강 입구만으로 실제 대강 승인까지 새 회귀를 완료했다고 세지 않음. [workhub-assistant-timetable](../../tests/browser/workhub-assistant-timetable.mjs) · [workhub-timetable-interventions](../../tests/browser/workhub-timetable-interventions.mjs) · [workhub-timetable-execution-records](../../tests/browser/workhub-timetable-execution-records.mjs) |
| T09 | 휴업·특별일과·기간 학사 변경 | AI 안 기존 업무 패널 | 조합 | 영향 수업·합반·보강 확인 뒤 변경. 공식 방학과 보강 검토 대상의 기존 구분 유지. [workhub-timetable-school-day-commit](../../tests/browser/workhub-timetable-school-day-commit.mjs) · [workhub-timetable-operation-review](../../tests/browser/workhub-timetable-operation-review.mjs) |

### 수업·학생

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| E01 | 수업 등록·담당·학생 명부·수강 연결 | AI 안 기존 업무 패널 | 조합 | 현재 관계·수강 기간·명부 비교 후 반영. 동명 학생·교사 자동 연결 없음. [workhub-teaching](../../tests/browser/workhub-teaching.mjs) · [workhub-roster-import](../../tests/browser/workhub-roster-import.mjs) |
| E02 | 활동 CSV 가져오기·학생 연결 | AI 안 기존 업무 패널 | 조합 | 담당 수업·원문·학생 매칭·저장. AI 입구에서 CSV 입력기까지 확인; 최종 가져오기는 기존 수업 시험 근거와 조합. [workhub-assistant-teaching](../../tests/browser/workhub-assistant-teaching.mjs) · [workhub-teaching](../../tests/browser/workhub-teaching.mjs) |
| E03 | 관찰 기록 작성·정정·원문 근거 | AI 안 기존 업무 패널 | 직접 | 선택 학생의 기록 저장·원키 복구. 학생·학교·기준판·권한을 유지. [workhub-assistant-teaching](../../tests/browser/workhub-assistant-teaching.mjs) |
| E04 | 평가 기준판·학생 평가 기록 | AI 안 기존 업무 패널 | 조합 | 평가 당시 기준판·점수·의견 확인. 기준판을 대화가 임의 선택하지 않음. [workhub-assistant-teaching](../../tests/browser/workhub-assistant-teaching.mjs) · [workhub-teaching](../../tests/browser/workhub-teaching.mjs) |
| E05 | 관찰·평가 근거로 학생 기록 초안 | AI 안 기존 업무 패널 | 조합 | 원문 revision·hash·epoch·구간과 AI 초안 확인. 민감 상담 자료는 새로 AI에 연결하지 않으며 AI 결과 자동 확정 없음. [workhub-assistant-teaching](../../tests/browser/workhub-assistant-teaching.mjs) · [workhub-assistant-ui](../../tests/browser/workhub-assistant-ui.mjs) |
| E06 | 담당·수강 관계 정정과 영향 검토 | AI 안 기존 업무 패널 | 조합 | 현재 관계·기록 영향·명령 hash 검토. 기존 판과 현재 권한 재검사 유지. [workhub-teaching-relations](../../tests/browser/workhub-teaching-relations.mjs) |
| E07 | 학생 기록 인쇄·PDF·CSV 출력 | AI 안 기존 업무 패널 | 조합 | 여러 쪽 기록·평가 당시 판·출력 내용. 실제 프린터·브라우저 PDF 저장 대화상자는 별도 조작. [workhub-record-export](../../tests/browser/workhub-record-export.mjs) |
| E08 | 작성자 전용 상담 수동 조회·기록 | AI 안 기존 업무 패널 | 조합 | 상담 권한을 확인한 뒤 본인 기록만 별도로 열고 저장. AI 안의 동일 수업 UI에 있는 수동 탭일 뿐 상담 원문은 AI 근거·생기부 초안에서 제외. [workhub-teaching](../../tests/browser/workhub-teaching.mjs) · [TeachingWorkspace](../../apps/workhub/src/teaching/TeachingWorkspace.tsx) |

### 학교 관리

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| S01 | 학교·학년도·학급·교과·부서 구성 | AI 안 기존 업무 패널 | 직접 | 원본과 변경 필드 비교·명시 반영. 단일 구성 저장의 대화 상태 회귀가 있으며 전체 관리자 작업 자동화 의미 아님. [workhub-assistant-administration](../../tests/browser/workhub-assistant-administration.mjs) |
| S02 | 교과·학급 자료 일괄 입력·정정 | AI 안 기존 업무 패널 | 조합 | 일괄 원문·현재 ID·영향·오류 비교. 파일을 자동 수집하거나 기존 자료 삭제하지 않음. [workhub-school-configuration-batch](../../tests/browser/workhub-school-configuration-batch.mjs) · [workhub-school-data-maintenance](../../tests/browser/workhub-school-data-maintenance.mjs) |
| S03 | 가입 전 교사 명부·담임·담당 배정 | AI 안 기존 업무 패널 | 조합 | 현재 교사 명부·배정 기간·연결 영향. 교사 가입과 계정 권한 부여는 별개. [workhub-teacher-roster](../../tests/browser/workhub-teacher-roster.mjs) · [workhub-assistant-specialists](../../tests/browser/workhub-assistant-specialists.mjs) |
| S04 | 가입 계정·학교 소속 연결 | AI 안 기존 업무 패널 | 조합 | 허용 후보·계정·명부·기간 직접 확인. 승인된 후보·역할 범위 확대 없음. [workhub-school-roster](../../tests/browser/workhub-school-roster.mjs) · [workhub-assistant-specialists](../../tests/browser/workhub-assistant-specialists.mjs) |
| S05 | 공식 담당·수합·협업 인계 | AI 안 기존 업무 패널 | 직접 | 인계 범위·현재 판·관리자 확인·인수자 수락. 개인 상담·사적 자료를 전체 이관하지 않음. [workhub-assistant-administration](../../tests/browser/workhub-assistant-administration.mjs) · [workhub-school-transitions](../../tests/browser/workhub-school-transitions.mjs) |
| S06 | 새 학년도 생성·학기 전환 준비 | AI 안 기존 업무 패널 | 조합 | 학년도 숫자·첫날·배정 영향 확인. 원래 승인 계약을 거치며 자동 연장 없음. [workhub-school-transitions](../../tests/browser/workhub-school-transitions.mjs) |
| S07 | 나이스 원본 조회·학사일정 변경 비교·반영 | AI 안 기존 업무 패널 | 조합 | 원본과 일정 비교 후 선택 반영. 급식 자동 갱신·API 키 등록은 이 대화 반영 작업과 별개. [workhub-neis](../../tests/browser/workhub-neis.mjs) · [workhub-assistant-administration](../../tests/browser/workhub-assistant-administration.mjs) |
| S08 | 학교 AI 키·예산·진단·운영 현황 | AI 안 기존 업무 패널 | 조합 | 기존 설정 화면의 학교별 키 등록·상태·예산 확인. API 발급·결제·환경변수 설정은 외부 작업이며 AI가 대신 승인하지 않음. [workhub-assistant-ui](../../tests/browser/workhub-assistant-ui.mjs) |

### 홈·조회

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| H01 | 오늘 업무·기한·수업·수합 요약 조회 | 일반 업무 화면 연결 | 조합 | 현재 역할의 긴급 업무·기한·수업·제출 상태 확인. 홈으로 이동하여 보며 대화 안의 통합 요약을 새로 만드는 기능 아님. [workhub-home-overview](../../tests/browser/workhub-home-overview.mjs) · [workhub-home-grid](../../tests/browser/workhub-home-grid.mjs) |
| H02 | 학교 급식 조회 | 일반 업무 화면 연결 | 조합 | 기준 날짜의 나이스 급식과 갱신 상태 확인. 자동 갱신은 기존 서버 작업이며 AI가 대화 요청으로 급식을 새로 수집하지 않음. [workhub-neis](../../tests/browser/workhub-neis.mjs) · [ConnectedWorkspace](../../apps/workhub/src/app/ConnectedWorkspace.tsx) |

### 기존·공통 사이트

| 번호 | 업무 | 현재 경로 | 근거 수준 | 결과·한계 |
|---|---|---|---|---|
| L01 | 평가계획서 AI 작성·HWPX 생성 | AI 업무 연결 없음 | 코드 | 기존 평가계획서 화면의 작성·생성. AI 작업 패널에서 기존 평가계획서 전용 흐름을 실행하지 않음. [DocAiPage](../../apps/main/src/pages/DocAiPage.jsx) · [DOC_AI_MASTER_PLAN](../../docs/DOC_AI_MASTER_PLAN.md) |
| L02 | 평가계획서 제출·담당자 수합 | AI 업무 연결 없음 | 코드 | 기존 제출 화면의 파일·접수·담당자 확인. 일반 문서 수합과 별개 기존 기능이며 AI 대화 연결 완료에 포함하지 않음. [SubmissionsPage](../../apps/main/src/pages/SubmissionsPage.jsx) · [test_submissions](../../tests/test_submissions.mjs) |
| L03 | 사용자 가입 승인·전역 계정 권한 | AI 업무 연결 없음 | 코드 | 기존 사용자 관리 화면의 승인. AI로 관리자 권한을 부여하는 기능 아님. [AdminUsersPage](../../apps/main/src/pages/AdminUsersPage.jsx) · [modules](../../apps/main/src/lib/modules.js) |
| L04 | 기간 업무 메뉴 표시·숨김 설정 | AI 업무 연결 없음 | 코드 | 기존 기간 업무 관리 화면의 설정. 원래 관리자 수동 설정이며 메뉴 공개 범위 유지. [test_site_seasonal](../../tests/test_site_seasonal.mjs) · [modules](../../apps/main/src/lib/modules.js) |
| L05 | 내 계정·화면 표시·접근성 설정 | AI 업무 연결 없음 | 코드 | 현재 계정·글자 크기·화면 설정. 설정 UI는 유지하지만 대화에서 값을 바꾸는 명령 없음. [modules](../../apps/main/src/lib/modules.js) · [workhub-ui-renewal](../../tests/browser/workhub-ui-renewal.mjs) |

## 운영 적용과 공개 범위

- 일반 교사 AI 메뉴를 새로 공개하지 않는다. 슈퍼관리자 또는 기존에 허용된 사용자라도 학교 모듈 readiness·소속·실제 역할 검사를 통과해야 한다.
- 이 목록은 인증·권한을 통과하는 것을 시험으로 우회하지 않으며, DB·RLS·모델·월 예산·파일 생성 엔진을 바꾸지 않는다.
- 실제 Claude 답변의 전문성, 운영 Supabase/Storage 왕복, 휴대폰 키보드, 여러 사용자의 동시 행동은 별도 증거가 필요하다.
- 상담은 원래 권한이 있는 작성자의 수동 탭만 존재하며 AI 근거·생기부 초안으로 넘기지 않는다. 상담을 처리하는 AI 기능이 추가됐다고 설명하지 않는다.
- 한 건의 원본 판과 요청 번호를 보존하는 복구, 계정 변경 후 이전 자료 비노출, 실패한 단계를 성공으로 표시하지 않는 것을 완료율보다 우선한다.

## 판단해서 정한 것

- 목록은 코드의 메뉴 구조와 기존 회귀에서 추적했다. 전체 시스템의 99% 구축 같은 이전 진행률과 섞지 않는다.
- 90%를 맞추기 위해 기존 평가계획서·관리자 설정을 분모에서 빼거나, 동일 기능의 여러 표현을 분자로 늘리지 않는다.
- 기존 패널을 대화 안에 띄우는 구현과 AI가 자연어 지시를 이해해 입력을 채우는 기능을 나눈다. 패널 연결의 존재만으로 자연어 완료율을 계산하지 않는다.
- 목록을 수정할 때는 `coverage.json`의 해당 행과 근거를 함께 바꾸고 숫자는 원본 행에서 다시 계산한다.
