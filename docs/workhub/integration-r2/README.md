# 2차 통합 기준과 검토 인계

2026-10-15 · `chore/workhub-integration-r2` · 기준 main `ebdc06411d4224bf29b28915bd6695b2fbefadee` (#25)

사용자가 요청한 #26~#42의 17개 PR을 원본 커밋 이력과 함께 통합한다. #3 운영 자동화와 #5 시간표 엔진은 제외한다. 현재 단계는 통합 PR 검토이며 main 병합·실제 운영 SQL 실행·작업자 배포·메뉴 공개 확대는 하지 않는다.

## 포함 범위

| PR | 내용 | 고정한 원본 끝 커밋 |
|---|---|---|
| [#26](https://github.com/EggPlayer88/daedong/pull/26) | refactor: 내 업무 표시 분리와 연결 오류 안내·메뉴 경로 보완 | `0c4bd46` |
| [#27](https://github.com/EggPlayer88/daedong/pull/27) | 학교 초기 설정 준비: 초안 파일 보관과 입력 검증 | `aaf24e7` |
| [#28](https://github.com/EggPlayer88/daedong/pull/28) | DB 준비 재개: 4표 상속 제약 모순과 생성기 검사 보완 | `026c166` |
| [#29](https://github.com/EggPlayer88/daedong/pull/29) | chore: 학교 연결 읽기 조사 도구와 B00 DB 조사 인계 | `e2361b5` |
| [#30](https://github.com/EggPlayer88/daedong/pull/30) | feat: 기본 파일형 수합의 양식·제출·검토·ZIP 미리보기 | `751a1d9` |
| [#31](https://github.com/EggPlayer88/daedong/pull/31) | 업무실 DB 첫 구축(R0) SQL과 검증 도구 | `2d766b5` |
| [#32](https://github.com/EggPlayer88/daedong/pull/32) | 문서 수합 사용성 보완: 교사 일괄 지정·검토 이력·파일 교체 | `b0e24dd` |
| [#33](https://github.com/EggPlayer88/daedong/pull/33) | 문서 수합 파일 수명 관리: 미저장 파일 회수와 저장 원문 보호 | `4299ef7` |
| [#34](https://github.com/EggPlayer88/daedong/pull/34) | 문서 수합 서버 연결 준비: 파일 전송·저장 복구·R1 SQL 인계 | `fbb8369` |
| [#35](https://github.com/EggPlayer88/daedong/pull/35) | 문서 수합 공동 제출·철회·정정·이력 화면 | `4e07eb3` |
| [#36](https://github.com/EggPlayer88/daedong/pull/36) | 문서 수합 전체 ZIP 다운로드: 완료본·현재판과 누락 방지 | `09dd890` |
| [#37](https://github.com/EggPlayer88/daedong/pull/37) | feat: 수합 서버 파일 검사·임시 파일 정리 코어 준비 | `977fa7e` |
| [#38](https://github.com/EggPlayer88/daedong/pull/38) | feat: PDF 검사·HWP 기반과 HWPX 호환성 보완 | `a4b4677` |
| [#39](https://github.com/EggPlayer88/daedong/pull/39) | R1 문서 수합 서버 SQL (DB·호환 함수·비공개 파일 권한·검증 작업자 계약) | `2d38c5b` |
| [#40](https://github.com/EggPlayer88/daedong/pull/40) | feat: 압축 PDF와 HWP 실문서 호환성 보완 | `6ad6694` |
| [#41](https://github.com/EggPlayer88/daedong/pull/41) | fix: 수합 충돌 비교와 입력·요청 보관 복구 | `dbfe57c` |
| [#42](https://github.com/EggPlayer88/daedong/pull/42) | 문서 수합 R1 서버 검사·정리 연결 | `ee087be` |

기계 판독 목록과 보류 SHA는 [pr-inventory.json](pr-inventory.json)에 고정한다. #42에는 #30·32~38·40~42의 수합 체인이 있었지만 **#26~29와 #31·39는 없었다.** 따라서 #42 하나만 main에 합치면 학교 설정·진단·설계 보완 등이 누락된다.

통합 브랜치는 main에서 만들고 #42 → #26 → #27 → #28 → #29 → #31 → #39를 merge commit으로 합쳤다. #31은 #39의 조상이지만 별도 병합으로 R0/R1 경계를 남겼다. 중간 source branch에 커밋하거나 rebase/force push하지 않았다. 이전 1차 통합의 19개 이력도 보존한다.

## 충돌 해결과 추가 변경

- 충돌은 `docs/workhub/PROGRESS.md`, `tests/README.md` 두 문서에서 발생했다.
- 진행 문서는 최신 #42 기록을 보존한 뒤 2차 통합 현황으로 다시 썼다. 기능별 인계 문서는 각각 보존했다.
- 시험 안내는 학교 설정·수합·배포 조사 내용을 합쳤다. 이미 오래된 브라우저 파일 개수 표현은 고정 숫자를 제거했다.
- 앱 코드는 자동 병합됐다. #26의 실제 진입점/메뉴 주소와 #41의 입력 보관·이탈 보호를 전체 브라우저 회귀로 함께 확인한다. 학교 설정 공개 범위는 #27의 superadmin 그대로다.
- 통합 추가 작업은 2차 전용 이력/원문 보호 검사, SQL 전체/작업자 통합 시험 래퍼, CI와 인계 문서다. 기능 구조를 다시 옮기거나 새 공통 저장소를 만들지 않는다.

기존 `check:workhub:integration`은 1차 후보 재현용으로 남긴다. 당시에는 SQL 제안 불변이 전제였으므로 현재 R0/R1 디렉터리를 추가하면 실패하는 것이 정상이다. 이를 느슨하게 고쳐 통과시키는 대신 `check:workhub:integration:r2`에서 2차 승인 범위를 고정한다.

## SQL과 배포 상태

| 구분 | 현재 상태 | 이번 통합의 의미 |
|---|---|---|
| R0 #31 | 사용자 적용 완료·학교 표시/업무실 진입 확인 | 원본과 시험을 저장소 기준에 포함 |
| R1 #39 R1-00~04 | 사용자 적용 완료 보고·보존 지문 일치·기존 사이트 확인 | 최신 승인 SQL과 앱/작업자 계약을 함께 보존 |
| R1-05/06 | 미적용 | 작업자 연결·정책값은 사용자/Claude의 후속 단계 |
| 서버 검사기 #42 | 코드·자동 시험 준비 | 독립 서버 배포·비밀값·실제 ClamAV가 남음 |
| main 배포 | #25 기준 | 이 PR을 사용자가 병합한 뒤 앱 배포가 갱신됨 |

통합·CI는 **현재 Supabase에 SQL을 재실행하지 않는다.** R0/R1 SQL은 각 원본 PR의 디렉터리 전체와 Git 기준으로 동일해야 한다. 이미 적용한 운영 DB의 상태를 Git 병합으로 되돌릴 수 없다. 코드 되돌림을 R0-90이나 R1 자료 제거와 연결하지 않는다.

과거 문서의 ‘적용 전/조사 중’은 해당 작성 시점의 기록이다. 현행 순서는 이 문서, [누적 진행](../PROGRESS.md), [R1 실행 안내](../../../database/workhub/r1/R1_실행안내.md), [검사기 배포 인계](../40-collection-r1-connection.md)를 기준으로 한다. 전체 미래 DB 설계의 F1~F9 잔여 사항과 R1 구현 리뷰 F1~F7 해결은 다른 범위다. R0/R1 적용만으로 전체 학교 시스템 DB가 완성됐다고 판단하지 않는다.

## 자동 검증

```bash
npm run check:workhub:integration:r2
npm run check:workhub:design
npm run check:workhub
npm test
npm run build
npm run build:workhub
npm run test:workhub:browser
```

2차 가드는 전체 Git 이력이 필요하다. 17개 포함·기존 19개 보존·#3/#5 제외·보호된 인증/회원/문서 자산·R0/R1 원문·미해결 충돌·공개 범위/운영 자동화를 확인한다. 실패 주입 회귀로 누락/변조도 잡는지 확인한다.

Linux에서는 아래 SQL 검증도 실행한다. 원본 테스트 도구의 합성 DB에서 설치·권한·거부·지문·복구를 시험하고, 같은 통합 앱의 검증 함수와 실제 worker HTTP 연결 코드를 대조한다.

```bash
# Node22/npm ci, Python3.12/worker 의존성/psycopg2-binary, PG17와 psql 준비 후
export R0_PG_BIN=/absolute/path/to/postgresql17/bin
export R0_PSQL="$(command -v psql)"
export R0_WORK=/absolute/path/to/workhub-r2-r0-verify
export R0_PG_PORT=55447
export WORKHUB_R2_SQL_REPORT=/absolute/path/to/results
npm run test:workhub:r2-sql
```

이 명령의 작업 폴더는 검증 전용이어야 한다. 래퍼가 검사 전용 경로/서버를 확인하며 원본 도구는 그 안의 합성 DB를 초기화한다. 운영 DSN/키를 받지 않는다. CI는 지정한 임시 폴더의 PG17.6을 사용하고 끝나면 중지한다. #3의 운영 DB 정기 조회 자동화와 관계없는 일회성 검사다.

결과 수치·명령·환경·한계는 [verification.md](verification.md)에 기록한다. `check:workhub:design`은 현재 저장소 설계 정합성/참조 검사이며 외부 원본 18개를 다시 모두 읽은 시험은 아니다. 생성된 검증 JSON은 결과 폴더에 보관하고 승인된 원본 산출물을 불필요하게 덮어쓰지 않는다.

## Claude에게 요청할 검토

1. 17개 PR의 고정 SHA가 모두 조상인지, #26~29의 별도 기능이 누락되지 않았는지.
2. 문서 충돌 해결과 앱 자동 병합이 기존 안내·입력/요청번호 보존을 함께 유지하는지.
3. #34의 두 화면 결함을 #41이 해결했는지 통합본에서 재확인.
4. #42의 R1 실제 응답 계약, 정책·임대·실물 확인, 응답 유실/재인수, 정리 F7, readiness와 스캐너 오류 처리를 집중 검토.
5. SQL 원본/기존 인증/회원/문서 엔진과 보류 기능의 경계, CI SQL 시험의 로컬 전용성을 확인.
6. 아래 잔여 항목을 실사용 완료와 구분하고 병합 차단 여부를 판단.

GitHub 조사 시 #39의 8개 리뷰 스레드는 모두 해결됐다. 다른 16개 PR에는 GitHub 리뷰가 등록되지 않았으며 일부 바탕화면 Claude 보고서만 있다. 따라서 자동 검사 성공을 ‘전체 PR 상대 AI 검토 완료’로 표현하지 않는다. 이번 통합본의 상대 AI 검토가 필요하다.

## 남은 작업과 알려진 후속 사항

- #27 학교 설정 초안: 중/고등학교 학년 범위와 같은 학년/반의 중복 검사를 더 엄격하게 할 후속 사항이 남아 있다. 실제 DB를 만드는 화면은 아니며 통합 시 그대로 보존했다.
- #26 TaskPanel의 편집 상태 정리는 비차단 리팩터링 과제다.
- 파일 검사기의 실제 서버 배포, ClamAV 데몬/한도/서명 갱신, R1-05/06 승인, 실제 Supabase PostgREST/Storage와 서명 URL 차단 확인이 남는다.
- 미지원 HWP/PDF 변형, 실제 다중 교사·모바일·공동 제출/정정·ZIP·일정/업무 저장·기존 서비스 확인은 나중에 모아서 진행한다.
- 학생·수업 실제 연결, 메신저·학교 지식·Claude·알림/관리 기능은 후속 개발이다. 문서작성 AI 신규 개발·시간표는 계속 보류한다.

## 병합과 기존 PR 정리

Claude 검토 → 필요한 보완 → 동일 최신 커밋의 CI/미리보기 확인 → **사용자가 Create a merge commit으로 main 병합** 순서다. 이력을 보존해야 17개 원본 PR의 포함을 검증할 수 있다. 이 PR을 만드는 동안 원본 PR을 닫거나 브랜치를 삭제하지 않는다.

병합 후 main에서 원본 SHA 도달 가능성을 다시 확인한다. GitHub가 자동으로 정리하지 않은 PR만 통합 PR 링크와 포함 사실을 남겨 정리한다. 승인되지 않은 #3/#5는 그대로 별도 보류한다.

## 판단해서 정한 것

| 결정 | 이유 | 변경 위치 |
|---|---|---|
| 한 통합 후보에 17개 이력 보존 | 별도 갈래 누락과 중간 배포 혼선을 막음 | 이번 merge 이력·PR inventory |
| SQL 원문 수정 없이 통합 | 사용자 적용본과 저장소의 기준 일치 | R0/R1 디렉터리 보호 검사 |
| 1차 가드 보존·2차 가드 추가 | 서로 다른 승인 범위를 혼동하지 않음 | scripts/check-workhub-integration-r2.mjs |
| SQL 검사를 필수 CI 안에 포함 | 앱과 실제 DB 계약의 불일치를 통합 시 검출 | test.yml·검증 래퍼 |
| 비차단 후속은 별도 기록 | 통합에 새 기능 변경을 섞지 않고 검토 가능하게 함 | 이 문서의 남은 작업 |
