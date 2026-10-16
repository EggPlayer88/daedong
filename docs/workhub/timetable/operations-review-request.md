# Claude 검토 요청 — 시간표 확정·공유·교환 운영 화면

검토 대상: `feat/workhub-timetable-operations`. 기준은 PR #54 `cb6775c`의 편성 기반이다. 새 PR 번호와 검토 커밋은 PR 본문에 기록한다. #54가 검토 중이므로 후속 PR의 base는 `feat/workhub-timetable`로 두고 기존 검토 커밋을 변경하지 않았다.

## 요청 범위

현재 진행 중인 시범 SQL 1~7단계는 그대로 진행해 주세요. 이번 후보는 후속 시간표 8단계의 **앱 화면·전송 계약**입니다. SQL·운영 DB·인증·키·비용·메뉴 공개 범위를 바꾸지 않았습니다. 자동 병합이나 SQL 실행은 요청하지 않습니다.

1. 저장 초안의 적용 기간 선택 → 전체 영향 미리보기 → 명시 확인 → 확정 → 공유 조회의 흐름을 확인해 주세요.
2. 본인 수업 이동/두 수업 교환 → 본인 동의를 포함한 제출 → 다른 참여 교사 동의 → 담당자 승인 → 실제 반영의 상태가 섞이지 않는지 확인해 주세요.
3. 요청자와 동일한 계정은 다른 소속 ID로도 자기 승인하지 못하게 한 `requesterIsViewer` 계약, 현재 판·proposalHash·전원 동의·만료·미실시·공식 허용시간 검사를 봐 주세요.
4. 입력/권한/원본/학교가 바뀐 뒤 이전 미리보기를 적용하지 않는지, 최신 읽기 도중 이전 자료가 숨겨지는지 확인해 주세요.
5. 결과 미상은 원래 명령·요청 번호로 recover-only 조회하며 새 명령을 만들지 않는지 확인해 주세요. 복구 실패가 권한 오류여도 원래 번호를 지우지 않습니다. NOT_FOUND는 같은 키 잠금 아래 처리 중 요청도 없을 때만 허용합니다.
6. 기존 요청의 동의·승인 결과를 복구할 때 별도로 작성 중이던 새 교환 요청 입력을 보존하는지 확인해 주세요. 이 문제는 독립 검토에서 발견해 수정했고 수정 전 실패/수정 후 통과를 확인했습니다.
7. 320px 모바일, 키보드 조작, 전후 비교의 전체 목록, 제외일·기간·확정판 안내와 기존 메뉴 이동을 확인해 주세요.
8. [운영 API 인계](operations-api.md)의 5개 RPC와 실제 parser를 먼저 대조해 주세요. 기초 `timetable.v1` 3개 RPC와 다른 계약입니다. 응답 JSON fixture를 앱에 넣어 맞춘 후 증분 SQL을 작성해 주세요.

## 읽을 파일

- [현재 구현과 사용자 흐름](operations-implementation.md)
- [확정·공유·교환 exact API](operations-api.md)
- [기초 편성 3개 RPC 및 AI 인계](sql-handoff.md)
- [검증 기록](operations-verification.md)
- `apps/workhub/src/timetable/operations-contracts.ts`, `operations-server.ts`
- `TimetableOperationsWorkspace.tsx`, `TimetablePublishPanel.tsx`, `TimetableExchangePanel.tsx`
- `tests/test_workhub_timetable_service.mjs`
- `tests/browser/workhub-timetable-publication.mjs`, `workhub-timetable-exchanges.mjs`

## DB 구현에서 필요한 별도 검증

공개 기간 앞뒤 보존, 기존 미래 교환 보존/차단, 실시·학생 기록 영구 ID 보존, 전체 자원 충돌과 시수, 같은 키 실행·복구 경합, 부분 반영 금지, 알림 원장 동시 기록을 실제 PostgreSQL 두 연결로 시험해야 합니다. 앱의 미리보기 검사나 합성 RPC 시험은 이 보장을 증명하지 않습니다.

현재 공유는 학교 로그인 계정 안의 조회입니다. 익명 공유 링크·자동 메시지 발송·Claude 실제 호출·다자 교환 작성·대강/취소/보강은 이번 후보에 포함하지 않았습니다. 수업 변경 명령을 AI가 자동 실행하는 경로도 없습니다.

## 답변 형식

- 실제 사용을 막는 결함: 재현 조건 / 파일·함수 / 입력·자료 영향 / 권장 수정.
- SQL 계약 충돌: 정확한 필드·판·해시·권한·상태 전이와 원자성.
- 사용성 개선: 연결 전에 필수인지, 실사용 피드백 후 가능한지 구분.
- 코드 병합 판단과 실제 DB 활성화 판단을 별도로 제시.

이 문서는 전달용으로 작성했으며 외부 Claude 대화나 GitHub 리뷰에 자동 전송하지 않았습니다.
