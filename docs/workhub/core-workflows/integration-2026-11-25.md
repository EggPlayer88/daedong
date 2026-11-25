# main 통합 뒤 CL1·TR2 격리 SQL 검증

2026-11-25. `feat/core-workflow-completion`의 main 통합 커밋 `e5018e10`에서 기존 검증 실행기를 그대로 실행했다. **전체 SQL 체인 217건 통과, 실패 0**이다. 운영 DB 적용·기능 활성화·실제 자료 발행을 수행한 기록은 아니다.

## 범위와 결과

정확한 증분 경로는 `database/workhub-calendar-lifecycle/cl1`과 `database/workhub-timetable/tr2`다. TR2 실행기가 전신 설치 기준과 NT1·CL1을 먼저 검증하므로 중복 실행하지 않았다. `--write`와 점검 파일 재생성 저장 옵션은 사용하지 않았다.

| 검증 | 결과 |
|---|---|
| 외부 DSN·libpq 옵션·키·임의 인자 사전 차단 | 7건 통과. DB 생성 없이 검사 |
| 기존 기준 및 NT1까지 | 누적 94건 통과 |
| CL1까지 | 누적 155건 통과 |
| TR2를 포함한 전체 체인 | 누적 217건 통과, 실패 0 |
| CL1 실제 SQL 응답 → 현재 앱 parser | 6건 통과 |
| TR2 실제 SQL 응답 → 현재 앱 parser | 18건 통과 |
| CL1-02 / INT-16 | 각각 7행 / 18행, FAIL 0. 저장 원문과 재생성·해시 일치 |
| TR2-02 / INT-17 | 각각 8행 / 18행, FAIL 0. 저장 원문과 재생성·해시 일치 |
| 설치·점검 SQL, 생성기, README, checks.json | 두 증분 폴더의 14개 파일 SHA-256 전후 동일 |
| 시험 서버 종료 | 실행기 정상 종료 후 소유 클러스터 `pg_ctl status` 종료코드 3 확인 |

누적 검사 수를 서로 더하지 않는다. 앱 parser 대조도 전체 SQL 체인 안에서 호출된 별도 시나리오 수이며 전체 `npm test`나 브라우저 검증 결과가 아니다.

CL1은 기존 자료·권한·비용 F1~F5 보존, 취소 원본과 이전 판 보존, 원키 조회·명시 재전송, 가시성 철회 뒤 비노출, 취소·저장 경합, outbox 실패의 전체 롤백을 확인했다. 설치 전신의 원문·소유자·검색 경로·실행 문맥 훼손은 설치를 거부했고, 설치 후 보호 트리거·실행 권한 훼손은 점검에서 검출했다.

TR2는 F1~F4 지문과 기존 모든 표의 자료·권한·비용, 기존 함수 원문·권한을 보존했다. 합성 22명·9학급·288교시를 사용해 미연결·만료·권한 변경 차단, 미리보기의 무변경, 명시 발행, 원번호 복구·닫기, 동시 발행 중복 방지, 휴업·교환으로 고정된 수업과 다른 T1 계보·기간 밖 수업 보존을 확인했다. 기존 함수·기준판 제약·RLS 훼손 설치 거부와 새 불변 트리거·권한 훼손 검출도 통과했다.

## 재현 환경과 명령

- Windows, Python 3.12, `psycopg2 2.9.13`, PostgreSQL 17.6.
- 검증 도구는 `@embedded-postgres/windows-x64@17.6.0-beta.15`를 별도 ignored `dist`에 설치하고 같은 바이너리를 외부 ASCII 전용 경로에 복사했다. 저장소 패키지 선언·lockfile은 바꾸지 않았다.
- 현재 체크아웃의 별도 설치 `node_modules`를 사용했다. 운영 DSN·키·비어 있지 않은 `PG*` 환경변수가 없는 것을 확인했다.
- 새 임시 클러스터만 `127.0.0.1:55847`에 생성했고, 실행기가 실제 데이터 경로가 자신이 만든 폴더인지 확인했다. `trust` 인증은 이 합성 로컬 클러스터의 기존 시험 설정이다.

```powershell
$qaTemporary = 'C:\Users\lyj19\.codex\visualizations\2026\10\10\01a12565-e17c-7720-ad1c-22e02580d010\qa-temp'
$env:TEMP = $qaTemporary
$env:TMP = $qaTemporary
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$env:WORKHUB_DEPLOYMENT_PG_BIN = Join-Path $qaTemporary 'core-workflows-pg17-runtime-20261125/bin'
$env:WORKHUB_DEPLOYMENT_TEST_PORT = '55847'
$env:WORKHUB_DEPLOYMENT_REPORT = Join-Path (Get-Location) 'dist/core-workflows-integration-20261125/reports-ascii'
python database/workhub-deployment/integration/test/test_runner_safety.py
python database/workhub-timetable/tr2/build_checks.py
```

## 환경 준비 중 실패와 증거

기존 임시 runtime은 의존 DLL이 없어 `postgres --version`이 `3221225781`로 종료됐다. 고정 버전을 새로 준비한 뒤 첫 실행은 한글 저장소 경로 아래의 PostgreSQL 설치에서 `initdb` post-bootstrap UTF-8 오류(`0xc7 0xd0`)로 실패했다. 이 단계에서는 SQL을 실행하지 않았다. 같은 바이너리를 ASCII 경로로 복사한 재실행은 초기화부터 전체 검증까지 통과했다. 실행기·SQL·기대값·접속 차단 가드는 변경하지 않았다.

- 전체 성공 로그: `dist/core-workflows-integration-20261125/tr2-full-chain-ascii.log`
- 초기화 실패 로그: `dist/core-workflows-integration-20261125/tr2-full-chain.log`
- 원본 지문: 같은 폴더의 `source-hashes-before.json`, `source-hashes-result.json` (`CheckedFiles: 14`, `ChangedFiles: []`).
- 실행기가 만든 `.tmp-tr2-current-predecessors.json`, `.tmp-tr2-current-basis-constraints.json`도 같은 ignored 결과물 폴더로 이동해 보존했다.
- 이번 성공 클러스터 및 합성 응답: 위 `$qaTemporary` 아래 `workhub-p9-pg17-cqzf0u1l`의 `run.log`, `server.log`, `cl1-app-captures.json`, `tr2-app-captures.json`.
- 이번 초기화 실패 폴더: 위 `$qaTemporary` 아래 `workhub-p9-pg17-_hrfdovq`의 `run.log`.

두 시험 폴더와 로그는 보존했다. 기존 DB·로그를 정리하지 않았다. 로컬 실행 성공은 운영 DB의 현재 설치 상태·실제 교사 연결 기간·Production 배포 완료를 확인한 것이 아니며, 운영 적용은 각 CL1/TR2 README의 순서를 별도로 따른다.
