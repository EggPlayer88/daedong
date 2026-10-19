# 로컬 시간표 계산 작업자 — timetable.jobs.v1

이 기능은 담당자 PC에서 CP-SAT 계산기를 한 번 실행해 두고, 사용자가 선택한 전용 폴더로 요청·상태·결과를 주고받는 실행 기반이다. 실제 자식 프로세스로 기존 `runner.py`를 실행한다. 서버 배포, HTTP 수신, 인증, SQL, Supabase 저장, 다른 교사와의 공유를 수행하지 않는다. 기존 `timetable.solve.v1` 요청·결과 JSON과 파일 CLI는 그대로 사용할 수 있다.

## 시작과 사용

저장소 루트에서 고정 버전 의존성을 설치한 Python을 사용한다. Windows 예시:

```powershell
python -m venv tests/.venv
tests/.venv/Scripts/python.exe -m pip install -r packages/timetable/requirements.txt
tests/.venv/Scripts/python.exe packages/timetable/engine/jobs.py init --store "C:\시간표 작업"
tests/.venv/Scripts/python.exe packages/timetable/engine/jobs.py work --store "C:\시간표 작업"
```

Linux에서는 Python 경로를 `tests/.venv/bin/python`으로 바꾼다. `init`은 비어 있는 전용 폴더만 초기화하며, 이미 초기화한 같은 폴더는 그대로 반환한다. 일반 자료가 있는 폴더는 거절한다. 동기화 폴더·네트워크 공유·심볼릭 링크·Windows junction은 지원하지 않는다. 이 PC의 같은 사용자만 관리하는 로컬 폴더를 사용한다.

PC의 지원 브라우저에서 시간표의 **이 PC에서 계산하기 → 계산 작업 폴더 연결**을 누르고 같은 폴더를 고른다. 이후 **이 PC에서 최적화 시작**으로 요청을 접수하고 상태를 확인한다. 실행 프로그램은 하나만 켠다. `work`는 계속 대기하며 나중에 들어온 요청도 처리한다. Ctrl+C로 멈추면 자신이 실행한 계산 프로세스를 종료하고 중단 상태를 남긴다. 모바일 또는 폴더 선택 미지원 브라우저는 기존 계산 JSON 파일 방식을 사용한다.

브라우저 외에도 다음 CLI로 같은 계약을 사용할 수 있다.

```powershell
python packages/timetable/engine/jobs.py submit --store "C:\시간표 작업" --input "요청.json"
python packages/timetable/engine/jobs.py status --store "C:\시간표 작업" --request-id "소문자-UUID"
python packages/timetable/engine/jobs.py cancel --store "C:\시간표 작업" --request-id "소문자-UUID"
python packages/timetable/engine/jobs.py result --store "C:\시간표 작업" --request-id "소문자-UUID"
python packages/timetable/engine/jobs.py recover --store "C:\시간표 작업"
```

`submit`은 빠르게 파일만 접수하고 계산하지 않는다. `work --once`는 최대 한 작업을 실행하고 종료하므로 자동 시험이나 수동 진단에 쓴다. `result`는 결과 JSON을 표준 출력으로 내보내므로 교사·학급 자료가 보일 수 있다. 운영 지원 로그나 공용 터미널에 결과를 복사하지 않는다. 오류는 경로나 교사 원문 없이 코드·짧은 안내만 반환한다.

## 정확한 폴더 계약

식별자는 소문자 UUID, 해시는 소문자 SHA-256, 모든 시각은 UTC `YYYY-MM-DDTHH:mm:ss.sssZ`다. 알려지지 않은 필드는 계약 검사로 거절하며, Python 작업자가 JSON을 읽을 때 중복 키와 비유한 수를 거절한다. 브라우저의 일반 JSON 파서가 중복 키까지 검출한다는 뜻은 아니다. 결과 오류 항목의 코드·안내·경로는 앱과 같은 문자·공백·UTF-16 길이 기준으로 검사한다. `ready.json`·`cancel.json`은 파일을 완전히 닫은 뒤 효력이 생긴다.

기초판의 표시 이름은 브라우저와 Python 모두 NEL(`U+0085`)·BOM(`U+FEFF`)을 포함한 공백만의 값을 거절하고, 짝 없는 UTF-16 서로게이트를 입력 오류로 거절한다. 정상 보조 평면 문자(예: 이모지)는 UTF-16 두 칸으로 계산하며 최대 200칸 규칙을 공유한다. 이를 인코딩 예외나 작업자 종료로 처리하지 않는다.

| 파일 | 작성자·정확한 내용 |
|---|---|
| `queue.json` | 초기화 CLI: `{contract:'timetable.jobs.v1',queueId,createdAt,policyVersion:1}` |
| `jobs/<requestId>/request.json` | 브라우저/접수 CLI: 기존 `CpSatRequest` 전체. 요청 ID·입력 해시·기초판·이전판·옵션 포함 |
| `jobs/<requestId>/ready.json` | 요청을 닫은 뒤 마지막에 생성: `{contract,queueId,requestId,inputHash,queuedAt}` |
| `jobs/<requestId>/cancel.json` | 취소 요청: `{contract,queueId,requestId,inputHash,requestedAt}` |
| `jobs/<requestId>/status.json` | 작업자: `{contract,queueId,requestId,inputHash,sequence,state,queuedAt,updatedAt,startedAt,finishedAt,code}` |
| `jobs/<requestId>/result.json` | 작업자: 기존 `CpSatResponse` 전체 |
| `worker.json` | 작업자: `{contract,queueId,workerId,state:'ready'|'busy'|'stopped',updatedAt,activeRequestId}` |

`status.sequence`는 양의 정수이고 상태 변경마다 증가한다. 시작·종료 시각과 `code`의 초기값은 null이다. `state`는 `queued`, `running`, `cancel_requested`, `succeeded`, `failed`, `cancelled`, `timed_out`, `interrupted` 중 하나다. 완료 상태에서는 종료 시각을 반드시 기록한다. 접수 표식만 있고 상태가 없으면 아직 **대기**이며, 작업자가 실제 계산을 시작했다는 뜻이 아니다. 작업자 heartbeat가 없거나 오래되었으면 실행 여부를 확정하지 않는다. 계산 백분율은 제공하지 않는다.

아직 실행하지 않은 요청은 접수 시각 `queuedAt`, 동률이면 요청 UUID 순으로 하나씩 처리한다. 같은 밀리초에 만들어진 파일의 생성 순서를 별도 접수 순서로 약속하지 않는다. 이미 계산 중인 요청을 나중 접수 때문에 선점하거나 두 요청을 동시에 실행하지 않는다.

`succeeded`는 **검증된 계산 응답을 전달했다**는 뜻이다. 그 안의 `response.status`는 `feasible`뿐 아니라 `infeasible`, `unknown`, `unsupported`, `invalid`, `error`일 수도 있다. 유효한 후보가 없는 결과를 시간표 생성 성공으로 표시하지 않는다. `failed`는 프로세스 실행·파일·결과 검증 등의 실행 기반 실패다. 엔진의 정상 시간 제한(`unknown` 또는 `feasible + stoppedByLimit`)과 감독기의 강제 종료(`timed_out`)를 구분한다.

작업자는 `request.snapshot.json`·`manifest.json`을 내부용으로 고정한다. 브라우저는 이를 수정하지 않는다. manifest는 원래 ready, 원본 전체 해시, 접수 시각, 실행 종료 한도, 실행 PID와 `processIdentity`(확인한 생성 토큰 또는 null)를 담는다. 기존 토큰 없는 manifest도 읽되 보수적으로 복구한다. 동일 요청 번호·동일 원본은 중복 실행하지 않으며, 같은 번호에 다른 원본은 `REQUEST_CONFLICT`다. 완료된 요청은 읽기·취소·재접수로 상태를 바꾸지 않는다.

## 원자성·검증·재시작

- 상태·heartbeat·결과는 같은 디렉터리의 임시 파일을 쓰고 flush/fsync 후 교체한다. 요청 원본·최초 manifest·최종 결과는 기존 파일을 덮어쓰지 않는 배타 생성으로 기록한다.
- 브라우저 파일 생성과 `close()` 사이에는 빈 `ready.json`·`cancel.json`이 보일 수 있다. 완전한 표식을 검증하기 전에는 해당 대기 작업만 보류하고 다음 감시에서 다시 읽는다. 가짜 접수증·취소 완료를 만들지 않고 다른 정상 대기 작업을 계속 처리한다. 실행 중 읽힌 미완성 취소도 실패나 취소로 단정하지 않는다. 이미 실행했을 수 있는 manifest·상태가 손상되면 중복 실행을 피하기 위해 복구 확인 전 새 계산은 보류한다.
- 폴더당 OS 파일 잠금을 하나만 보유하고 계산도 하나만 실행한다. 두 번째 작업자와 실행 중 cleanup/recover는 `WORKER_BUSY`로 멈춘다. 운영 게이트웨이를 붙일 때도 폴더 잠금이 사용자 인증을 대신한다고 해석하면 안 된다.
- 자식 프로세스의 종료 코드 0만 믿지 않는다. 요청 해시, 엔진 버전, 응답 모양, 전체 배치의 하드조건, 목적함수, 후보 중복, 상태별 응답 일관성을 Python에서 재검증한다. 브라우저는 기존 `parseCpSatResponse`로 다시 검증하고 최신 편성 지문과 일치할 때 후보만 가져온다. 확정·DB 저장은 자동 실행하지 않는다.
- 취소는 실제 감독 중인 자식 프로세스를 종료하고 확인한 뒤 완료로 표시한다. 종료 요청 후 살아 있으면 강제 종료한다. 파일에 저장된 PID는 조회만 하며, 임의 PID를 종료하지 않는다.
- 강제 종료 뒤 두 번째 대기까지 시간초과하거나 종료 권한 오류가 나면 `cancelled`/`timed_out` 접수증을 만들지 않는다. 실행 기록·임시 결과를 보존하고 해당 작업자를 복구 대기로 유지하여 다음 계산을 막는다. 실패 접수증 쓰기까지 실패한 경우도 동일하다. 작업자를 중지하고 실제 계산 종료와 원본 파일을 확인한 뒤 `recover`로 복구한다. heartbeat 또는 완료 뒤 임시 파일 정리 실패만으로 이미 확인된 계산 결과를 실패로 바꾸지는 않는다.
- 강제 한도는 요청 `maxSeconds`에 정책의 5초를 더한다. 이는 Python 시작·모델 준비·파일 출력 여유다. 엔진 자체의 기존 계산 한도는 그대로다.
- 작업자 비정상 종료 후에는 기존 번호를 자동 재실행하지 않는다. 이미 완성한 결과가 있으면 재검증 후 완료 상태만 복구한다. 결과가 없으면 실행 한도가 지나고 이전 PID도 종료된 것을 확인한 뒤 `interrupted`로 기록한다. PID가 남아 있거나 조회할 수 없으면 다음 계산도 보류한다. Windows 생성 시각 또는 Linux 부팅 ID·프로세스 시작 토큰이 저장값과 다른 경우에는 PID 재사용을 확인한 것이다. 담당자가 실제 계산 종료를 확인하고 `recover --store "..." --confirm-stopped "원래 UUID"`를 실행해야 이 경우를 해제한다. 같은 토큰의 실제 계산, 토큰 미기록, 토큰 조회 불가는 이 옵션으로 강제 해제하지 않는다. 저장된 PID의 프로세스를 죽이지 않는다.
- 실행 한도를 저장한 뒤 PID를 기록하기 전에 작업자가 종료된 경우, 프로세스 존재 여부를 확정할 수 없어서 자동 해제하지 않는다. 실제 계산 프로세스가 끝난 것을 확인한 담당자만 `recover --store "..." --confirm-stopped "원래 UUID"`로 해당 요청을 중단 완료로 정리한다. 실행 한도가 지나기 전에는 이 옵션도 해제하지 않는다.
- 브라우저의 메모리 복구는 기존 앱의 탭 내 입력 보존 범위다. 폴더 결과는 브라우저를 닫아도 남지만, 브라우저 재시작 후 모든 화면 입력 자동 복원을 약속하지 않는다.

## 한도와 정리

정책 원본은 `packages/timetable/_assets/job-policy.json`이다. 대기 16개, 보관 작업 100개, 폴더 자료 128 MB, 결과 16 MB, 기본 보관기간 7일이다. 실제 계산 전에 요청 스냅샷과 결과 임시/최종 파일을 위한 공간을 추가 예약 검사한다. 엔진의 기존 입력·모델 선택·자원 선택 한도도 적용한다. 이 한도는 작업자가 쓰는 파일과 실행을 제한하며, 사용자가 직접 폴더에 쓰는 파일까지 막는 파일시스템 용량 제한이나 OS 메모리 제한이 아니다. 운영 서버에는 별도 메모리·프로세스 격리가 필요하다.

브라우저와 CLI는 접수 전에 실제 폴더의 보관 수·대기 수·파일 바이트와 새 요청/표식 공간뿐 아니라 요청 스냅샷, 결과 최대 크기 두 개, 메타데이터 최대 크기 네 개를 함께 예약 검사한다. 같은 출처의 탭들은 queueId 단위 Web Lock을 사용하고 CLI 접수끼리는 별도 OS 파일 잠금을 사용한다. **한 전용 폴더에서는 브라우저 또는 CLI 한 접수 방식을 선택한다.** 두 방식 사이에 공통 OS 잠금이 있는 것은 아니므로 혼합 동시 접수를 지원한다고 간주하지 않는다. 작업자는 실행 직전 한도를 다시 검사한다. 동일 번호·원본의 이미 접수된 요청 복구는 한도가 찼더라도 새 파일을 쓰지 않고 가능하다.

외부 도구가 대기 한도를 넘기면 작업자는 정상 ready의 접수 시각·UUID 순서를 유지하고 초과분만 `failed(QUEUE_FULL)`로 처리한다. 가장 오래된 작업을 용량 검사 때문에 먼저 탈락시키지 않는다. 빈 ready/status는 접수 시 대기 한 건으로 보수적으로 센다. 읽기 권한 오류와 다른 queue/request 식별자의 파일을 정상 접수로 인정한다는 뜻은 아니다.

원본 내용·용량·실행 준비에서 거부된 작업은 해당 `failed(code)`로 끝내고 다음 작업을 계속 처리한다. 검증된 취소 표식은 실행하지 않을 원본 내용의 검증보다 먼저 `cancelled`로 남긴다. 표식의 queueId·요청 번호·해시 검사는 생략하지 않는다. 외부 도구 때문에 보관 수가 이미 100개를 넘었어도 조회·취소·정리 경로는 막지 않는다. 새 접수/실행만 한도로 거절한다.

자동 삭제는 없다. 정리는 작업자를 중지하고 브라우저의 계산 폴더 연결을 해제한 후 두 단계로 한다. CLI 접수와 정리는 공통 접수 잠금으로도 배제한다.

```powershell
python packages/timetable/engine/jobs.py cleanup --store "C:\시간표 작업"
python packages/timetable/engine/jobs.py cleanup --store "C:\시간표 작업" --apply
```

첫 명령은 보관기간이 지난 **완료 작업**과 1시간 이상 바뀌지 않은 **미접수 파일**을 구분해 보여 준다. 완료 작업의 두 번째 명령은 다시 대조한 뒤 알려진 전용 파일만 지운다. `.DS_Store`, `desktop.ini`, `Thumbs.db`는 작업 디렉터리로 세지 않는다. 완료 작업 안의 OS 메타 파일, 이 프로그램의 `.파일명.UUID.tmp`, 알려진 작업 파일 이름으로 시작하는 `파일명.crswap`/`파일명.숫자.crswap`은 명시 정리할 때만 함께 지운다. 임의 `.tmp`/`.crswap`을 넓게 삭제하지 않는다. 재귀 삭제와 연결 경로 추적은 하지 않는다. 작업을 지우면 그 번호의 원본 대조 이력도 없어지므로 새 계산은 반드시 새 UUID를 사용한다.

미접수 정리는 삭제가 아니라 **원본 보존 격리**다. request만 남았거나 ready가 없거나 미완성이고, manifest·status(빈 파일 포함)·snapshot·cancel·result·엔진 임시 결과가 모두 없어야 한다. 디렉터리와 모든 허용 파일의 마지막 수정 시각이 정책 `orphanCleanupAfterSeconds:3600` 이전이어야 한다. 알 수 없는 파일·링크·완성된 ready·다른 식별자의 마커는 대상에서 제외하거나 거절한다. 미리보기는 queueId·선택 범위·파일 내용/식별/수정 시각 지문을 `.orphan-cleanup-preview.json`에 기록하며, `--apply`는 이 계획이 있어야 한다. 이동 직전과 직후 다시 검사하여 변경되면 원위치 복원 또는 보존 후 `CLEANUP_CHANGED`로 중단한다.

검사를 통과한 미접수 디렉터리는 `jobs/<UUID>`에서 `.cleanup-orphans/<UUID>`로 원자 이동한다. 열린 FSA 핸들의 뒤늦은 기록이 있어도 파일 자체를 삭제하지 않는다. 격리한 파일은 실행·대기·작업 수에서 제외하되 용량 검사에는 계속 포함된다. 응답의 `requestIds`는 완료 정리 후보, `deletedRequestIds`는 실제 삭제, `orphanRequestIds`는 미접수 격리 후보, `quarantinedRequestIds`는 실제 보존 격리다. 격리 파일을 자동 삭제하지 않으며 복구할 때는 보존한 `request.json`의 기준판·옵션을 확인하고 앱에서 같은 입력으로 **새 UUID의 요청**을 생성한다. 기존 번호를 덮어쓰거나 같은 번호로 자동 재실행하지 않는다. 이 규칙은 로컬 미접수 격리에만 해당하며 서버에 접수한 요청의 기존 번호 복구 규칙은 바꾸지 않는다.

한도에 도달했거나 최근 결과를 직접 정리하려면 `cleanup --store "..." --request-id "완료 UUID"`로 그 작업 하나를 미리 보고, 같은 명령에 `--apply`를 붙인다. 직접 고른 완료 작업만 7일 이전에도 정리할 수 있다. 대기·실행 작업은 이 방식으로도 지우지 않는다.

## 손상된 실행 기록의 수동 보존 복구

`manifest.json`/`status.json`이 손상되었으면 `recover --confirm-stopped`로 내용을 추측해 재작성하거나 강제 삭제하지 않는다. 다음 절차를 따른다.

1. 모든 브라우저에서 폴더 연결을 해제하고 CLI 접수와 작업자를 중지한다. 작업 관리자 또는 프로세스 도구로 해당 계산기의 실제 자식 계산이 끝났는지 확인한다. 저장된 PID 숫자만 보고 다른 프로세스를 종료하지 않는다. 확인할 수 없으면 여기서 멈춘다.
2. 전용 폴더 전체를 백업한다. 원래 요청 UUID와 queueId를 별도로 기록하고, request·ready·manifest·status·snapshot·result 파일을 모두 보존한다. 손상된 파일 한 개만 지워서 새 대기처럼 만들지 않는다.
3. 정상 백업의 같은 요청 기록이 있으면 담당자가 그 원본을 대조하여 복원하고 `recover`로 검증한다. 정상 원본이 없으면 손상된 UUID 디렉터리 전체를 `jobs` 밖의 별도 보존 폴더로 이동한다. 이 수동 이동은 모든 계산 종료 확인 후에만 하며 원본 파일을 수정·삭제하지 않는다.
4. 새 작업자를 시작하기 전에 `recover`에서 미확인 실행이 남는지 확인한다. 기존 결과를 최신 기준판과 대조해 가져오거나, 원본을 확인한 후 **새 UUID**로 계산을 요청한다. 손상된 번호를 재사용하지 않는다.

이 절차는 손상 기록을 자동으로 안전하다고 판정하는 기능이 아니다. 종료를 입증할 수 없거나 사용자 자료의 소유·내용이 불명확하면 지원 담당자가 보존 자료부터 검토한다.

## 구현 분리와 검증 범위

| 모듈 | 책임 |
|---|---|
| `jobs_contract.py` | 작업·마커·상태와 기존 계산 응답의 독립 검증 |
| `jobs_runtime.py` | 전용 폴더, 원본 고정, 원자적 파일, OS 잠금, 보관·정리 |
| `jobs_worker.py` | 대기열, 실제 자식 프로세스, 취소·시간초과, heartbeat, 재시작 복구 |
| `jobs.py` | 로컬 CLI; 새 HTTP·인증 경로 없음 |
| `engine-jobs.ts` / `LocalTimetableEngine.tsx` | 사용자가 고른 폴더, 동일 요청 복구, 상태·결과 검증과 화면 연결 |

`node tests/test_timetable_jobs.mjs`는 공백·한글 경로에서 실제 고정 OR-Tools 계산과 앱 parser 왕복, 지속 감시, 취소, 실제 시간초과 종료, 다중 작업자 차단, 중단 후 복구, 변조 거부와 수동 정리를 실행한다. 느린/잘못된 자식은 시험에서만 런타임의 엔진 경로를 바꿔 만든 별도 fixture이며 공개 CLI에는 임의 실행 파일 인자가 없다. 브라우저의 실제 폴더 왕복 시험은 `tests/browser/workhub-timetable-local-engine.mjs`다. 실제 학교 자료, 운영 Vercel/Supabase, 운영 서버의 메모리 한도와 여러 교사의 원격 접속은 이 시험으로 검증하지 않는다.
