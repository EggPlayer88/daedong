# 통합 후보 검증과 배포 후 확인

2026-10-16. 이 문서의 자동 SQL 검사는 **전용 로컬 PostgreSQL의 합성 자료**만 사용한다. 현재 Supabase의 SQL 설치·정책 게시·기능 활성화와는 별개다. SQL 실행과 main 병합은 사용자가 진행한다.

## 한 번에 확인하는 범위

| 검사 | 실제로 실행하는 것 | 이 검사로 확인하지 않는 것 |
|---|---|---|
| 저장소 회귀·브라우저 | 현재 앱의 화면, 어댑터, 입력 복구, 결과 검증 | 실제 교사 계정과 Supabase 왕복 |
| 1~8단계 SQL 통합 | R0/R1/R1S/P1~P8 설치·권한·원본 보존·멱등성·실제 SQL 응답과 현재 앱 대조 | 운영 DB 기준선, PostgREST의 실제 HTTP 응답 |
| P8 단독 | 선행 조건 누락, 부분 설치, 공식 담당 보호, 수업 관계 변경, C8 새 명령/복구 구분 | 사용자 승인이나 실제 기능 활성화 |
| PR62 응답 대조 | 학생 기록 전체 쪽·당시 평가 기준판, 관계 목록, 홈→메시지 대화 번호 | 교사 PC의 인쇄·PDF·엑셀 표시 |
| 관계 실패 조회 보충 대조 | 실제 SQL의 UNAVAILABLE snapshot→같은 어댑터 preview, 추가 RPC 없음 | 원본 P8 하네스가 생략하는 실패 snapshot을 별도로 보충하며 실제 PostgREST는 미검증 |
| 공개 배포 읽기 점검 | 사이트의 공개 번들·설정과 기대 Supabase 프로젝트, 제한된 익명 조회 | 로그인, 데이터 보존, 모듈별 읽기·쓰기 성공 |

## 1. 앱과 SQL 자동 검사

저장소 루트에서 기존 앱 검사를 실행한다. 브라우저 시험은 실제 React와 전송 어댑터를 사용하지만 외부 서비스의 응답은 대역이다.

```bash
npm test
npm run check:workhub
npm run build
npm run build:workhub
npm run test:workhub:browser
```

SQL 전체 검사는 Linux 또는 WSL Linux에서 실행한다. Node 22, Linux용 `npm ci`, Python 3의 `psycopg2-binary`와 `lxml`, PostgreSQL 17의 `initdb`·`pg_ctl`·`postgres`, `psql`이 필요하다. Git 이력에는 SQL 기준 `5c05c2d78af44e4b10455ba06291d93971f7628e`가 있어야 한다. CI는 `fetch-depth: 0`을 사용한다.

```bash
# 외부 DB 접속값이나 API 키가 없는 전용 셸에서 실행한다.
export R0_PG_BIN=/absolute/path/to/postgresql17/bin
export R0_PSQL=/absolute/path/to/psql
export R0_WORK=/tmp/workhub-release-r0-verify
export R0_PG_PORT=55463
bash scripts/verify-workhub-release-sql.sh
```

기존 CI의 `@embedded-postgres/linux-x64@17.6.0-beta.15`와 `psql` 설치를 그대로 재사용할 수 있다. 원본 대조 도구가 사용하는 환경 인자 경로를 보호하기 위해 `R0_WORK`는 공백 없이 지정한다. 저장소 경로에 공백이 있어도 사본은 이 전용 경로에 만든다. Windows Git Bash에서는 안전 가드 회귀만 실행하며 SQL 전체 검사는 WSL로 실행한다.

```bash
node tests/test_workhub_release_verification.mjs
```

실행기는 다음 조건을 확인한다.

- `database/workhub`가 Claude SQL 기준 커밋과 같아야 한다. 추적되지 않은 SQL 폴더 파일도 거부한다. 시험을 통과시키기 위해 SQL이나 원본 시험의 기대값을 고치지 않는다.
- `DATABASE_URL`, `PG*`, Supabase/API 키, 다른 앱·SQL 경로를 주입하는 환경값이 있으면 값을 출력하지 않고 중단한다. `.env` 파일을 읽지 않는다.
- `R1_CAPTURE`·`P7_BRIDGE`·`P8_BRIDGE`·`INT_R1S_MODE`를 비롯한 단계별 캡처 경로·시험 분기 환경도 시작 전에 거부한다. 완료 뒤 원본 P7 로그와 P8 캡처의 `bridge` 값을 확인해 보강 있음·없음이 실제로 모두 실행됐음을 `branches.json`에 남긴다.
- 작업 폴더 이름과 전용 표식을 확인한다. 다른 자료가 있는 폴더, 심볼릭 링크, 원본 reset 표식이 없는 기존 DB는 초기화하지 않는다.
- PostgreSQL은 지정한 작업 폴더의 Unix 소켓만 열고 TCP를 열지 않는다. 종료 시 이 시험이 만든 서버만 정지하며 운영 DB에 접속하지 않는다.
- SQL·앱·원본 시험의 사본을 만들고 모든 파일의 SHA-256을 남긴다. `.sh`에 CRLF가 있을 때만 사본에서 LF로 바꾸고 보정 파일을 기록한다. SQL 원문은 바꾸지 않는다. 현재 `.gitattributes`는 셸 LF를 강제한다.
- 실행 중 앱이 바뀌어도 처음 캡처한 사본을 검사한다. 최종 후보가 바뀌었다면 최신 코드로 다시 실행한다.
- 하위 도구의 실패 종료와 `FAIL`·`KNOWN`, 새로운 `WARN`은 실패로 처리한다. Claude의 #60/#62 검토에서 비차단으로 분류한 정확한 오류코드 차이만 허용목록으로 구분해 `advisories`에 원문·근거·건수를 남긴다. 이를 0 WARN으로 보고하지 않는다. 통과 항목이 0개인 경우도 성공으로 세지 않는다.
- P8 원본의 `app_contract_p8.ts`는 `snapshotRaw.ok === false`이면 앱의 snapshot 호출을 생략한다. 이 상태의 `preview UNAVAILABLE → QUERY_FAILED` 경고는 실제 UI의 실패 조회 경로를 검증하지 못한다. 원본을 고치지 않고 `tests/integration/workhub-release-relations.ts`가 보강 있음·없음 캡처의 실패 응답을 실제 앱에 먼저 전달한 뒤 preview의 UNAVAILABLE·추가 RPC 0을 확인한다. 이 보충 시험이 빠지거나 실패하면 전체 실행도 실패한다.

결과는 `$R0_WORK/run-*/reports`에 남는다. `integration.log`, `p8.log`, `pr62.log`, `relations-path.log`, `branches.json`, `summary.json`, `source-manifest.json`, `exit-code.txt`를 함께 보관한다. `summary.json`은 실제 Supabase/Storage/Claude를 시험하지 않았다는 경계와 남은 권장 사항의 실제 경고 줄 수를 포함한다. 종료 코드가 0이고 모든 요약의 실패 수가 0일 때만 자동 검사 성공이다.

`R0_WORK/data`는 합성 시험 자료이며 반복 시험 때 원본 reset 도구가 초기화한다. 실행기가 다른 경로를 삭제하거나 운영 자료를 되돌리는 SQL을 실행하지 않는다. 새 실행의 로그는 별도 `run-*` 폴더에 쌓인다.

## 2. Claude 검토 뒤 설치와 배포

코드 검토·SQL 설치·기능 활성화를 구분한다.

현재 SQL 기준은 #61 `5c05c2d78af44e4b10455ba06291d93971f7628e`다. SQL PR의 기준이 바뀌면 `scripts/verify-workhub-release-sql.sh`의 `SQL_REF`, `inventory.json`의 `sql.sha`, `sql-package.json`의 `sourceCommit`·변경 파일 해시를 **같이 갱신**하고 해당 커밋을 merge commit으로 포함해야 CI가 통과한다.

1. 현재 후보의 앱·SQL commit과 자동 검사 결과를 Claude에게 전달한다. C8은 새 명령을 `mutate`, 같은 요청 번호의 복구를 `recover`로 시험한다.
2. Claude와 사용자가 현재 운영 DB에서 `INT-03`과 `R1-04`의 읽기 전용 기준선을 확인한다. 기존 R0/R1 적용 결과와 같다는 추측으로 넘어가지 않는다.
3. 승인된 실행 안내대로 남은 1~7단계와 8단계를 비활성 설치한다. R0/R1을 재실행하거나 R0-90을 실행하지 않는다.
4. 현재 후보를 검토하고 사용자가 병합·배포한다. Git 병합 자체는 DB 설치나 기능 활성화가 아니다.
5. 앱 배포를 확인한 뒤 사용자가 관리자 제한 범위에서 모듈별 시험용 활성화를 승인하고, Claude의 안내에 따라 SQL을 적용한다. 그 범위에서 아래의 실제 읽기·쓰기·파일 왕복을 확인한다. 확인된 모듈의 활성화 유지와 일반 교사 공개는 별도로 판단한다. 비서의 C7·D1~D10과 외부 비용 설정은 별도 결정 전까지 보류한다.

위 순서는 운영 SQL의 상세 명령을 대체하지 않는다. 실제 SQL 파일과 빈칸·승인 근거는 `database/workhub/integration` 및 단계별 실행 안내를 사용한다.

`R1S-04`·`P3-05` 보류 사유는 검사 API 미구현이 아니다. `apps/main/api/collections/check-hwpx.py`와 `apps/main/api/messages/check-hwpx.py`의 운영 Vercel 배포, `SUPABASE_SERVICE_ROLE_KEY`를 Production 서버 변수에만 설정하는 작업, 실제 Supabase/Storage 왕복 확인이 남았다. API 키를 클라이언트 변수·소스·검토 자료에 넣지 않는다. 사용자 승인 후 관리자 범위에서 업로드→최소 검사→제출/전송→권한 있는 내려받기를 확인하며, 별도 검사기 서버 `R1-05`는 계속 보류한다. 최신 단계별 조건은 [운영 마무리 안내](../../../database/workhub/integration/운영_마무리_안내.md)를 따른다.

## 3. 배포 후 한 번 실행할 읽기 전용 점검

아래 명령은 로그인이나 저장 명령을 보내지 않고 기존 공개 배포 점검기를 사용한다. 실제 공개 번들의 Supabase 프로젝트가 기대값과 같은지 먼저 확인한다. 출력 파일은 새 이름으로 지정하며 기존 보고서를 덮어쓰지 않는다.

```bash
node scripts/check-workhub-deployment.mjs \
  --site https://daedong-school.vercel.app/ \
  --expected-project dhaoszbqtbofqftgjfyb \
  --output workhub-deployment-check.json
```

`status: observed`만으로 전체 기능이 준비됐다고 판단하지 않는다. 보고서의 프로젝트 일치·진단 코드와 `notAssessed` 범위를 함께 확인한다. 개인정보, 토큰, 원시 API 응답을 보고서에 추가하지 않는다. 이 작업에서는 해당 사이트 점검을 자동 실행하지 않았으며 실제 배포 뒤 사용한다.

## 4. 모아서 진행할 실제 환경 검증

각 항목은 확인일·앱 commit·SQL 설치 판·확인자·결과를 남긴다. 실제 쓰기 검증은 사용자가 지정한 시험 계정·시험 자료로 진행하며 이 문서의 자동 실행기가 대신 쓰지 않는다.

| 묶음 | 실제 확인할 흐름 | 통과 기준 |
|---|---|---|
| 기존 서비스·학교 연결 | 기존 Google 로그인·가입 승인·학교 선택·일정/업무 읽기·저장 | 기존 회원·제출 자료 유지, 기대 학교만 조회 |
| 수합·파일 | HWPX 양식→업로드→제출→정정→담당자 ZIP | 현재 확정 파일·대상·마감이 정확, 타인/타교 서명 URL 차단 |
| 메시지·알림·협업 | 선택 대화 열기→전송→첨부→협업 완료/인계 알림 | 대화 번호·수신자·알림 출처 일치, 중복 전송 없음 |
| 공식 담당·업무 전환 | 관리자 확인→수락, 협업/수합 반려, 여러 쪽 목록 | 현재 권한/판 준수, 여러 쪽의 대상도 정확히 처리 |
| 결과 미상 복구 | 저장 응답 단절→모듈 중지/목록 실패→원래 번호 복구 | 원래 접수증 반환, 기존 요청 번호·내용 유지, 신규 중복 저장 없음 |
| 수업·학생 관계 | 담당·수강 관계 변경, 영향 재확인, 당시 평가 기준 출력 | 과거 기록의 기준판 보존, 상담·사적 자료 혼입 없음 |
| 기록 출력·스킨 | 인쇄 차단/재시도, PDF 저장, 엑셀 CSV, 200% 확대·모바일 | 미리보기 유지, 글자/열 깨짐·가로 넘침·필수 동선 누락 없음 |
| 학교 자료·질문형 문서 | 자료 추출→검토→게시, 답변→HWPX→명시 첨부→제출 | 원본/정리본 구분, AI 제안만으로 실제 제출하지 않음 |
| 홈·학년도·인계 | 역할별 홈·지연 목록·전환 범위 미리보기/수락 | 현재 권한과 기간 반영, 사적 학생 기록·개인 상담 미이관 |

실제 PostgREST·Storage·교사 PC 결과가 확인되기 전에는 자동 검사의 통과 수를 실사용 완료율로 바꾸지 않는다. 시간표의 실제 DB 연결과 비서 비용 결정은 이 검사의 성공으로 자동 해제되지 않는다.

## 판단해서 정한 것

- 원본 SQL을 바꾸지 않는 실행기를 추가했다. Claude 검토본과 같은 SQL을 현재 앱에 반복 대조하기 위해서다. SQL 기준을 바꾸려면 위 세 기준값·원문 해시와 검토 근거를 함께 갱신한다.
- 전용 셸에서 외부 접속 환경이 발견되면 지우고 진행하지 않고 중단한다. 실수로 운영 접속값을 섞은 실행임을 사용자가 알 수 있게 했다.
- 실제 서비스 점검은 기존 읽기 전용 도구를 재사용하고, 쓰기·파일·교사 PC 확인은 별도 표로 남겼다. 자동 시험과 실사용 성공을 혼동하지 않기 위해서다.
