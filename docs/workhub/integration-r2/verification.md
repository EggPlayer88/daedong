# 2차 통합 자동 검증 결과

2026-10-15 · 통합 기능 소스 `40d52a8187201275b98f734580decaef685cac0c` + 이 PR의 2차 통합 가드·CI·인계 보완. 이후 앱/worker/SQL 소스는 변경하지 않았다. 원본 고정 SHA는 [pr-inventory.json](pr-inventory.json)에 있다. GitHub 최종 커밋의 필수 검사 결과는 PR 체크에서 확인한다.

## 실행 결과

| 검사 | 실제 결과 | 범위 |
|---|---|---|
| `npm test` | **2,290건 통과**, Python 건너뜀 없음 | 기존/신규 앱·문서·파일·작업자 회귀, 2차 가드 22건 포함 |
| `npm run test:workhub:browser` | **36개 파일 / 36개 통과** | 기존 앱 경유·독립 미리보기·홈/모바일·학교 설정·수합·복구 |
| `npm run check:workhub` | 통과 | 신규 앱 타입 검사 |
| `npm run build`, `npm run build:workhub` | 모두 통과 | 기존 앱과 업무실 앱 빌드 |
| `npm run check:workhub:design` | 통과 | 저장소 내부 설계 정합성/참조; 외부 18원본 재열람 아님 |
| `npm run check:workhub:integration:r2` | 통과 | 17개 원본 PR 포함·이전 19개 보존·#3/#5 제외·SQL 원문·보호 경계 |
| R0 원본 전체 SQL | **167/167** | 독립 PostgreSQL 17.6 합성 DB |
| R1 원본 전체 SQL | **287/287**, 미실행 0 | 같은 PG17.6, 통합 앱 검증 함수와 대조 포함 |
| 실제 R1 SQL + Python 작업자 | **23/23** | 실제 SQL/worker/HTTP 클라이언트, PostgREST/Storage HTTP만 합성 대역 |
| SQL 실행기 경로/소유권/포트 거부 | **6/6** | 잘못된 작업 경로·기존 다른 폴더·심볼릭 링크·포트 거부 |
| SQL 실행기 종료 | exit 0·서버 정지 확인 | `postmaster.pid` 없음, 원본 SQL/도구 변경 없음 |
| `git diff --check` | 통과 | 공백/충돌 표식 확인 |

각 행의 단위가 다르므로 하나의 ‘총 시험 개수’로 합산하지 않는다. 브라우저 36은 시나리오 36건이라는 뜻이 아니라 시험 파일 수다. SQL 시험은 npm test에 합산하지 않았다.

## 환경과 재현

앱·브라우저 회귀는 Windows에서 실행했다. SQL/작업자 연결은 WSL Ubuntu, PostgreSQL 17.6, psql 16.15, Node 22.20.0, Python 3.12.3에서 실행했다. Linux 전용 SQL 래퍼의 환경은 [통합 안내](README.md#자동-검증)와 파일 머리말에 있다. Windows에서 Linux용 원본 사본을 내보낼 때는 `git -c core.autocrlf=false archive`를 사용한다.

CI는 전체 Git 이력을 가져오고, 2차 가드·전체 회귀·기존 PostgreSQL 계약 시험·R0/R1 전체/작업자 시험·두 앱 빌드·Chromium 회귀를 같은 필수 `test` job에서 실행한다. SQL 시험용 PG17.6은 runner 전용 폴더와 포트만 사용한다. 생산 환경 접속값은 주입하지 않는다. 이번 추가는 예약 실행/작업자 배포가 아니다.

## 증거 위치

바탕화면 작업 폴더의 `GPT작업/2026-10-15_2차통합/`에 아래 원본 로그를 보관한다.

- `source-prs.json`, `review-inventory.md/json`: 원본 SHA와 GitHub/로컬 검토 이력 조사.
- `npm-test.log`, `build.log`, `design.log`: 회귀·타입/빌드·설계 검사.
- `browser/summary.json` 및 각 브라우저 결과: 36파일 전체 회귀.
- `sql/r0-full.log`, `sql/r1-full.log`, `sql/worker-integration.json`, `sql/wrapper-guards.json`, `sql/server-stop.log`, `sql/검증요약.md`: 실제 로컬 SQL 시험 및 정지 결과.

CI에서도 SQL·브라우저 결과를 아티팩트로 보관한다. 로컬 경로에 의존하지 않고 PR 체크에서 다시 검증할 수 있다.

## 아직 확인하지 않은 것

- 운영 Supabase의 실제 PostgREST 및 Storage SDK 업로드/다운로드/서명 URL 차단.
- 실제 ClamAV 엔진·서명 갱신·컨테이너 실행/배포·비밀값·작업자 운용.
- R1-05/06 정책/학교/작업자 연결과 준비 상태 활성화.
- 실제 교사 다중 계정·학교별 권한·수합/정정/ZIP·모바일·일정/업무 저장 종단 확인.

SQL 원문을 가져온 것과 현재 운영 DB를 다시 검증한 것은 다르다. 실제 사용 확인은 사용자가 요청한 대로 나중에 모아서 진행한다. 보류한 시간표 및 운영 자동화는 이번 검증 대상에 포함하지 않는다.
