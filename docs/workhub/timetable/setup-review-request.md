# Claude 검토 요청 — 시간표 준비 입력 연결

이번 앱 브랜치는 `feat/workhub-timetable-setup`이며 PR #66 `61045ce`의 후속이다. Claude의 PR #67은 변경하지 않았다. 검토할 앱 PR과 head는 PR 설명의 최신 값을 사용해 달라.

PR #67 `ad10792378dd124efe3af6bef57c5cffcd6dff2a`의 `timetable.setup.v1`을 연결했다. 구현 설명은 [setup-implementation.md](setup-implementation.md)다.

## 중점 확인

1. `setup.ts` / `setup-server.ts`: 현재 T1 실제 응답과 일치하는지. 정원 null, 삭제된 참조, `TEACHER_LEAVES_IN_TERM`·`STUDENT_OVERLAP` 등 findings, 새로운/기존 링크 판, 원키 복구가 일치하는지.
2. `TimetableSetupPanel.tsx`: 공간 등록/수정/삭제, 수업↔공식 학급/별도 수강집단, 다중 공간, 입력 보존과 전체 비교, 최신 판 채택 후 재확인. 원키 결과 미상 상태에서 새 저장·입력 폐기를 막는지.
3. `preparation-refresh.ts` / `TimetablePreparationPanel.tsx`: 공간 저장 뒤 준비 원본을 다시 읽고 시수·일과·수업 활동 ID를 보존하는지. 담당자가 변경을 확인해야 현재 원본을 채택하고, 서버 초안 판 충돌·수업 추가삭제·시수 변경·다른 학기에는 자동 채택하지 않는지.
4. 아직 기준판이 없는 학교에서도 준비 입력을 열 수 있는지. 미설치 RPC는 준비 중/오류로 표시하고 가짜 저장 성공을 내지 않는지.
5. 기존 원키 복구, 학교·역할 변경 후 자료 분리, 준비 초안/기준판 생성/학기 공개의 구분이 유지되는지.

실제 SQL 응답을 저장한 기존 격리 PG17.6 cap.json으로 조회 12건·접수증 22건을 앱 parser에 대조했다. 브라우저 시험은 실제 화면/어댑터와 합성 RPC이며 운영 Supabase 검증이 아니다. 최신 T1에서 계약이 바뀌었다면 어떤 필드·예제가 달라졌는지 알려 달라.

이번 요청은 앱 검토다. SQL 적용·병합·기능 활성화·일반 교사 공개를 자동으로 하지 않는다. T1/T2 SQL 작업은 기존 역할 분담대로 계속 진행하면 된다. 결함은 재현 조건·데이터 영향·권장 수정과 함께, 코드 병합 판단과 DB 활성화 판단을 분리해 답해 달라.
