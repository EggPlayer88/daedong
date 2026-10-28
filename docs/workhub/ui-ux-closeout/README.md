# UI·UX 개편 운영 마감 기록

2026-10-28 · 현재 앱 기준 `f5b1151f5ae14c515a6fd3adc0ea1a6cfee91a0f` · #85–#97 병합 완료

**UI·UX 1차 개편의 구현·병합·배포와 아래 범위의 운영 점검을 마쳤다.** 점검 범위 안에서 남은 차단 결함은 확인하지 못했다. 전체 기능에 결함이 없거나 모든 기기에서 검증됐다는 뜻은 아니다. 다음 단계는 이 앱 기준판을 대상으로 한 Claude의 통합 검토다.

이 문서는 PR별 작성 당시의 기록보다 현재 마감 상태를 우선한다. 과거 실패·미확인 기록은 삭제하지 않고 후속 결과와 구분한다. 이번 마감 작업은 문서만 바꾸며 앱·DB·권한·공개 범위·AI 비용·파일 생성 방식은 그대로 둔다.

## 기준판과 배포 근거

| 항목 | 확인 결과 |
|---|---|
| 확인 시각 | 2026-10-28 21:28 KST, GitHub API 재조회 |
| main / 앱 검토 기준 | `f5b1151f5ae14c515a6fd3adc0ea1a6cfee91a0f` (#97 merge commit) |
| main 자동 검사 | [40640811751](https://github.com/EggPlayer88/daedong/actions/runs/40640811751) `test` 완료·성공, 15:32 KST 완료 |
| Production | GitHub 배포 기록 `7378312460`, 동일 커밋, `success` |
| 배포 URL | [고정 배포](https://daedong-5o0u4ptdw-eggplayer88s-projects.vercel.app) / [운영 사이트](https://daedong-school.vercel.app) |
| 마감 문서 커밋 | 앱 기준판과 별개인 문서 전용 후속 커밋. 문서 PR이 합쳐져도 앱 검토 범위는 위 기준판으로 식별 |

배포 기록의 성공과 실제 화면 점검은 서로 다른 근거다. 아래 운영 결과는 기존 관리자·일반 교사 시험 계정으로 확인한 결과다. 새 배포가 생기면 이 문서는 그 배포를 자동으로 검증한 기록이 되지 않는다.

## 완료한 개편 범위

| PR | 완료 범위 | 상세 기록 |
|---|---|---|
| [#85](https://github.com/EggPlayer88/daedong/pull/85) | 홈 핵심 정보·시간표·AI 옆자리, Pretendard·Tossface | [기본 개편](../ui-renewal/README.md) |
| [#86](https://github.com/EggPlayer88/daedong/pull/86) | 빈 편성 안내·AI 입력 위치·시간표 밀도·시험 교사 공통 화면 | [화면 보완](../ui-polish/README.md) |
| [#87](https://github.com/EggPlayer88/daedong/pull/87) | 메신저·수합·내 업무 입력 | [입력 화면](../workflow-ui/README.md) |
| [#88](https://github.com/EggPlayer88/daedong/pull/88) | 일정·일괄 등록·협업·인계·학년도 전환 | [연결 화면](../coordination-ui/README.md) |
| [#89](https://github.com/EggPlayer88/daedong/pull/89) | 시간표 준비·조건·결과·교환 동의·승인 | [시간표 화면](../timetable-workflow-ui/README.md) |
| [#90](https://github.com/EggPlayer88/daedong/pull/90) | 학교·수업 자료 관리·학생 기록 | [자료·기록](../school-records-ui/README.md) |
| [#91](https://github.com/EggPlayer88/daedong/pull/91) | 문서함·학교 자료·질문형 양식 | [문서 화면](../document-library-ui/README.md) |
| [#92](https://github.com/EggPlayer88/daedong/pull/92) | AI 답변·근거 인용·개인 기억·관리자 설정 | [AI 화면](../assistant-ui/README.md) |
| [#93](https://github.com/EggPlayer88/daedong/pull/93) | 메뉴·검색·알림·모바일 이동·빈 화면·오류 안내 | [공통 이동](../navigation-ui/README.md) |
| [#94](https://github.com/EggPlayer88/daedong/pull/94) | 기존 로그인·대시보드·평가계획·제출·회원 관리, 공통 접근성 | [전체 화면 마감](../site-ui-finish/README.md) |
| [#95](https://github.com/EggPlayer88/daedong/pull/95) | 첫 화면 로딩·화면별 지연 로딩·실패 복구 | [성능·복구](../ui-flow-loading/README.md) |
| [#96](https://github.com/EggPlayer88/daedong/pull/96) | 협업 재검색·작은 화면 확인 버튼·시간표 처리 안내·오래된 탭 안내 | [완료 흐름 보완](../ui-workflow-device/README.md) |
| [#97](https://github.com/EggPlayer88/daedong/pull/97) | 인계·문서·수합의 정상 처리 중/결과 미상 안내 구분, 브라우저 시험 재진입 수정 | [운영 완료 흐름](../operational-flow-finish/README.md) |

13개 PR의 병합 여부를 다시 확인했다. 디자인 기준은 핵심 업무를 먼저 보여 주고 세부 기능은 필요할 때 여는 구성이다. 확인·동의·최종 제출과 같은 기존 보호 단계를 생략하는 개편은 아니다.

## 운영 완료 흐름과 이번에 닫은 항목

| 항목 | 최종 확인 | 남긴 자료·복구 상태 |
|---|---|---|
| 협업 | 요청 → 수락 → 완료 요청 → 담당자 완료 확인, 4판·이력 4건 | 시험 협업 완료 상태 유지 |
| 시간표 | 중단 요청 결과 확인·승인·시각 변경·원래 시각 복귀, 날짜별 조회 | 10월 30일 시험 수업 최종 `11:45–12:30` |
| 수합 인계 | 관리자 → 시험 교사 → 관리자 왕복 인수 | 원래 담당자 복귀, 제출 파일 유지 |
| 문서 제출 | 생성 HWPX → 서버 기본 확인 → 초안 → 최종 제출 → 제출자 다운로드 → 담당자 ZIP | 시험 수합 1개, 최종 제출 1판·완료 1/미제출 0 유지 |
| 원본 일치 | 12,633바이트, 생성 원본·제출자 다운로드·ZIP 내부 HWPX 일치, CSV 1행 | SHA-256은 아래 기재 |
| 배포된 수합 처리 안내 | 초안 저장 중 정상 처리 문구·복구 버튼 비활성, 저장 완료 안내 | 추가 시험 초안 저장, 기존 최종 제출 1판 유지 |
| 배포된 인계 처리 안내 | 신청·취소 중 정상 처리 문구와 복구 버튼 비활성, 완료 상태 | 시험 요청 1개를 수락 전에 취소, 담당자 변경 없음 |
| 배포된 문서 처리 안내 | 기존 양식 4판·답변 2판으로 재생성, 처리 중/완료 안내·입력 보존 | 답변 수정·AI 호출 없이 시험 파일 재생성 |
| 실제 Chrome 200% | 사용자가 Chrome 메뉴에서 200% 설정. 문서 입력·생성·다운로드, 인계 입력·하단 버튼 점검 | 최종 viewport 720×354, 내용 너비 712, DPR 4. 점검 화면 가로 넘침 없음 |
| 작은 화면 | 운영 320/390px에서 저장·제출·조회·다운로드, 한글·줄바꿈·이모지 입력 보존 | 데스크톱 Chrome viewport 시험. 실제 휴대폰 키보드와 구분 |

```text
5c6c4dc7dac1617a2d246374b5979d46cc4b0bb27d5937dc0badcd2d1047fcf4
```

오래된 관리자 탭의 제어 연결은 끊겼지만 같은 프로필의 새 탭에서 복구해 점검을 마쳤다. 이를 사이트 기능 결함으로 판정하지 않았다. 실제 Chrome 확대는 사용자 설정 확인과 확대된 화면의 실측을 함께 근거로 삼았으며, DPR 값만으로 배율을 추정하지 않았다.

실제 화면·다운로드 증거는 로컬 `.tmp-operation-finish/production/` 및 `.tmp-post97-live-reconnected/`에 남겼다. 계정 정보가 있는 원본 이미지·다운로드를 저장소에 추가하지 않았다. 저장소의 [verification.json](verification.json)은 비밀값을 제외한 요약이며, 다른 컴퓨터에서 로컬 증거 파일이 있다고 가정하면 안 된다.

## 자동 검증과 근거의 한계

| 구분 | 결과 | 의미 |
|---|---:|---|
| 앱 전체 `npm test` | 5,204 통과 | 단위·계약·SSR·Python 검사. 운영 DB 전체 사용 검증과 다름 |
| 병합 후 관련 브라우저 회귀 | 186 통과, 8개 파일 | 실제 React·전송 어댑터, 합성 HTTP/RPC/Storage 응답 |
| 로컬 IME·화면 높이 추가 확인 | 8 통과 | 문서·질문형 작성·인계·협업 × 320/390px, CDP 한글 조합·줄바꿈·높이 축소/복구 |
| 추가 브라우저 확인 합계 | 194 통과 | 위 186+8. PR별 과거 시험 건수와 중복 합산하지 않음 |
| TypeScript·운영 빌드·main CI | 통과 | 배포 기준판의 자동 검사 결과 |
| 운영 왕복 | 위 표의 흐름 통과 | 기존 시험 자료·계정에 한정. 모든 모듈·모든 권한 조합의 운영 전수 검증 아님 |

8개 브라우저 파일은 `workhub-school-transitions` 53, `workhub-document-collection-flow` 11, `workhub-collection-server` 38, `workhub-document-library-ui` 14, `workhub-coordination-ui` 8, `workhub-cooperation-batch` 22, `workhub-accessibility` 24, `workhub-mobile-navigation` 16건이다. IME 8건은 로컬 보조 시험이며 영구 CI 항목으로 계산하지 않는다.

#95의 [성능 측정](../ui-flow-loading/loading-measurements.json)은 동일 PC의 로컬 운영 빌드·비로그인·각 5회·CPU 4배 감속·지연 60ms 조건이다. 초기 JS gzip 152,090 → 125,052바이트(17.8% 감소), DCL 중앙값 1,084 → 922ms, FCP 1,208 → 1,076ms였다. 실제 학교 네트워크·로그인 후 DB 왕복 성능의 보장은 아니다. 이번 문서 작업에서 성능을 새로 측정한 것은 아니다.

## 남은 작업과 우선순위

| 우선순위 | 작업 | 상태·완료 기준 |
|---|---|---|
| 1 | Claude의 UI·UX 전체 검토 | [복사할 요청문](claude-review-request.md). 현재 앱 기준판과 기존 시험 계정으로 재현 가능한 결함·사용성 의견 구분 |
| 2 | 확인된 결함을 한 묶음으로 수정 | 아직 새 결함을 가정해 착수하지 않음. 검토 결과에 따라 회귀 시험·배포 범위 결정 |
| 3 | 많은 행·긴 AI 대화·겹치는 시간표의 정보 밀도 | 추가 개선 후보. 실제 불편과 우선순위가 확인되면 작업; 현재 필수 미구현으로 계산하지 않음 |
| 보류 | 실제 휴대폰의 가상 키보드·스크롤 | 사용자 요청으로 나중에 수행. viewport/IME/Chrome 확대 통과로 대체하지 않음 |
| 보류 | 실제 교사 연결·일반 교사 공개·대량 시범 | 별도 결정과 승인 범위. UI 마감 완료 조건에 포함하지 않음 |

이번 기록 갱신을 위해 SQL 실행·기능 활성화·계정 연결·유료 AI 호출을 새로 수행하지 않는다. 문서 PR의 검사와 병합은 앱 개편의 완료 상태와 별도로 기록한다.

이번 문서 변경 후에도 저장소 규칙에 따라 `npm test`를 실행해 224개 파일·5,204건 전부 통과(건너뜀 0)를 확인했다. 새 상대 링크 29개·JSON 3개·공백 오류 검사도 통과했다. 브라우저·운영 점검·성능 수치는 앞선 실행의 근거를 정리한 것이며 이번에 다시 실행한 것으로 계산하지 않는다. 문서 PR의 원격 CI 결과는 해당 PR에서 별도로 확인한다.

## 판단해서 정한 것

- 현재 상태는 이 문서 한 곳에 모으고 13개 PR별 기록에서 연결한다. 과거 미확인·실패를 지우지 않으면서 현재 남은 일과 혼동하지 않도록 했다. 기준판이 바뀌면 이 문서와 `verification.json`의 배포 근거를 함께 갱신한다.
- 문서 커밋과 앱 검토 커밋을 분리한다. 문서 갱신을 새 기능 배포로 오인하지 않도록 했다. 앱 검토 범위를 바꾸려면 요청문의 기준 커밋도 함께 바꾼다.
- 원본 운영 캡처와 다운로드는 로컬에 보관하고 저장소에는 요약만 남긴다. 계정 정보가 든 증거를 불필요하게 공유하지 않기 위한 선택이며, 재검토에 필요하면 해당 항목만 전달한다.
