# 전체 화면 마감 검증

## 결과

| 검증 | 결과 |
|---|---|
| 기준 main `429dde7` GitHub Actions | success · 2026-10-27 07:50:33 UTC 완료 |
| `npm test` | **5,204 통과** |
| 신규 실제 React 브라우저 | **16 통과**, 외부 요청 0 |
| 기존 브라우저 회귀 12개 파일 | **157 통과** |
| 마지막 표시 조정 후 신규·로그인·평가계획·외곽 셸 재검증 | **4개 파일 44건 통과** (위 숫자와 중복, 합산하지 않음) |
| main 빌드 / 업무실 타입 검사·빌드 | 통과 |
| 정적 설계·문서 무결성 검사 | 통과 |
| DB·API·공개 판정·인증 경로 변경 대조 | 변경 없음 |

main 빌드의 기존 500kB 초과 청크 경고는 남아 있다. 빌드 실패가 아니며 이번 작업에서 번들 구조를 바꾸지 않는다.

처음 제한된 Windows 환경에서 돌린 `npm test`는 임시 폴더 접근·정리 권한 때문에 실패했다. 코드를 완화하지 않고 허용된 로컬 환경에서 전체를 다시 실행해 위 결과를 얻었다.

## 신규 시험의 확인 대상

`tests/browser/site-ui-finish.mjs` (전체 브라우저 러너에 등록):

- 일반 교사·관리자 바로가기의 공개 목록 일치
- 화면 이동 뒤 제목 초점, 본문 건너뛰기, 키보드 조작
- 긴 이름·이메일, 320px 및 CSS zoom 2 배치
- 기본 Google·별도 이메일 로그인 화면, 승인 대기에서 업무 링크 없음
- 제출 파일·교과·학년·메모의 화면 안 왕복 보존
- 실패한 제출의 입력 보존, 관리자 전용 현황 비노출
- 제출 48건, 회원 60명, 대화 36건, 긴 답변
- 표 안 가로 스크롤, 취소 확인을 닫았을 때 쓰기 0
- AI 방식 선택·질문 보존, 이동·배치 확인으로 새 AI 요청 없음
- 빈 대화 상자 비노출, 선택한 대화 전체 제목과 원본 번호
- 주요 본문·보조 설명·역할 표시 대비 4.5 이상

기존 회귀는 시간표 준비·조건·교환·다수 수업, 학교·학생, 문서·질문형 양식, AI·기억·설정, 검색·알림, 실제 외곽 셸, 홈 메시지, 모바일, 모듈 간 이동과 원요청 복구를 포함한다.

## 실행

```powershell
npm test
npm run check:workhub
npm run build
npm run build:workhub
npm run test:workhub:browser -- site-ui-finish
npm run test:workhub:browser -- email-login doc-ai-school-policy workhub-shell-layout workhub-cross-module workhub-home-message workhub-navigation-ui workhub-mobile-navigation workhub-assistant-ui workhub-timetable-board-usability workhub-timetable-workflow-ui workhub-school-records-ui workhub-document-library-ui
```

## 검증 경계

캡처는 실제 React 화면에 합성 회원·학교·제출·대화 자료를 넣었다. 실제 운영 DB·Storage·Claude와 연결한 시험이 아니다. 기존 서버 계약 시험은 `npm test`에 포함되지만 운영 연결을 다시 증명하지는 않는다. 2배 확대는 자동 시험의 CSS zoom이며 실제 교사 기기의 브라우저 확대·스크린리더 실사용 검토를 대신하지 않는다.

원격 PR CI와 Vercel 미리보기 상태는 PR의 최신 커밋에서 별도 확인한다.
