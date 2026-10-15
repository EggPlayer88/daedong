# 공통 Linux·Docker 파일 검사기 배포 준비

2026-10-15. 특정 서버 업체를 정하지 않은 **배포 구성과 점검 절차**다. 이 파일을 추가하거나 PR을 병합해도 서버·SQL·정기 작업은 설치되지 않는다. R1-00~04는 이미 적용된 상태이며 재실행하지 않는다. R1-05/06의 확정 SQL·적용은 Claude와 계란님이 진행한다.

## 1. 기본 실행은 로컬 자체 검사

저장소 루트에서 Docker Engine과 Compose v2가 있는 Linux에서 실행한다.

```bash
docker compose -f workers/deploy/compose.yaml up --build --abort-on-container-exit --exit-code-from worker
docker compose -f workers/deploy/compose.yaml down
```

`status: checked`, `mode: local_only`, `databaseCalled: false`, `storageCalled: false`, `malwareChecked: false`가 정상이다. 컨테이너 네트워크 자체가 꺼져 있고 비밀 파일·서버 설정을 받지 않는다. 기본 `check`는 PDF·XML·이미지·OLE 파서 자체 검사까지 수행한다. `verify`나 `cleanup`도 `--execute`를 붙이지 않으면 로컬 검사만 한다.

**두 Compose 파일을 `-f` 두 개로 합치지 않는다.** `compose.runtime.yaml`은 이후 서버에서 필요한 별도 구성이다. 운영 파일의 모든 서비스에는 프로필이 있고 작업자 기본 명령도 `check`다.

## 2. 서버에 준비할 항목

| 항목 | 준비 내용 |
|---|---|
| OS·도구 | Linux, Docker Engine, Compose v2. Docker 관리 권한은 서버 관리자만 사용 |
| 메모리 | 컨테이너 상한 합계 7.5 GiB(검사 데몬 4 + 서명 갱신 2 + 작업자 1.5). OS 여유분을 별도로 확보. 동시 사용량은 실제 서버에서 측정 |
| CPU | 데몬·갱신 각 2, 작업자 1 CPU 제한. 한 번에 작업 1개로 시작 |
| 외부 접속 | 작업자는 지정 Supabase HTTPS, 갱신기는 공식 서명 배포에 접속. 검사 데몬은 네트워크 없음. 수신 포트·관리 UI는 열지 않음 |
| 보존 | `signature-db`에 악성 파일 서명만 보존. `scanner-socket`은 Unix 소켓 공유. 원문 문서는 영구 볼륨에 저장하지 않음 |
| 권한 | 작업자·검사기·갱신기 모두 UID/GID 10001. 루트 파일 시스템 읽기 전용, capability 전부 제거, 프로세스·메모리·임시 파일 상한 |
| 실행 형태 | `restart: no`, 단발 수동 실행. cron·systemd timer·클라우드 예약 작업 없음 |

Compose의 기본 외부 네트워크는 **목적지별 방화벽을 뜻하지 않는다.** 서버 구축 시 네트워크 정책을 별도로 확인한다. 파서 프로세스의 자원 제한과 컨테이너 제한은 완전한 OS 보안 샌드박스를 의미하지 않는다.

## 3. 서버별 값과 비밀 파일

`runtime.env.example`을 `runtime.env`로 복사하고 확인한 비밀이 아닌 값만 입력한다. `runtime.env`는 Git에서 제외된다. 학교 이름 대신 **학교 UUID**, 실행할 프로젝트 ID, 승인할 작업자 ID, 배포할 코드의 커밋 SHA를 넣는다. 프로젝트 URL과 ID가 서로 다르면 사전 점검이 실패한다.

서비스 키는 저장소 밖 `/etc/workhub/collection-service-key` 같은 **일반 파일**에 저장한다. 채팅·PR·`.env`·Vercel 브라우저 환경값에는 넣지 않는다. 키는 Supabase가 제공한 서버용 키를 관리자가 직접 준비한다.

Linux 호스트에서 파일은 UID 10001 소유와 **0400**으로 설정한다. Docker Compose의 파일 기반 secret은 원본 호스트 파일 권한을 사용하므로 `uid`/`mode` 옵션만 적는 것으로 해결되지 않는다. 심볼릭 링크·디렉터리·그룹/다른 사용자 읽기 허용 파일은 사전 점검이 거부한다. Docker 관리자와 서버 root는 이 비밀 파일에 접근할 수 있다.

```bash
# 파일 내용을 관리자만 직접 입력한 뒤 소유권·권한을 설정한다.
# 아래는 기존 파일의 권한 설정이며 키 생성·입력 명령이 아니다.
sudo chown 10001:10001 /etc/workhub/collection-service-key
sudo chmod 0400 /etc/workhub/collection-service-key
```

운영 Compose는 `WORKHUB_SERVICE_ROLE_KEY_FILE=/run/secrets/workhub_service_key`만 전달한다. 컨테이너 진입점이 실제 실행 또는 `preflight` 때 읽고, 키 본문을 결과 JSON에 출력하지 않는다. 파일 방식과 `WORKHUB_SERVICE_ROLE_KEY` 직접 환경값을 동시에 주지 않는다. 이미지 빌드 컨텍스트는 코드/의존성 또는 검사기 설정만 허용하며 `.env`·Git·학교 문서·비밀 파일을 포함하지 않는다.

## 4. 서버 확보 후 이미지·스캐너만 확인

**아래 명령은 향후 서버에서 관리자가 실행할 절차다. 이번 개발에서 외부 서버에 실행하지 않는다.** SQL을 게시하거나 작업을 인수하지 않는다.

```bash
# 값 입력 후 구성 검증. 키 본문은 config에 포함되지 않지만 경로·학교 UUID는 공유하지 않는다.
docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml --profile scanner --profile execution config --quiet

docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml --profile scanner --profile execution build

# 이 단계부터 공식 ClamAV 서명 내려받기가 시작된다. Supabase 요청은 없다.
docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml --profile scanner up -d signatures clamav

docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml --profile scanner ps

# 파서·설정·실제 Unix 소켓·서명 최신성·무해 시험 문자열 검출 확인. DB/Storage 호출 없음.
docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml run --rm --no-deps worker preflight --scanner
```

최초 서명 다운로드가 실패하거나 차단되면 갱신기 상태를 먼저 확인한다. 서명 볼륨을 지우고 반복 다운로드하지 않는다. 갱신기의 `healthy`는 초기 파일 존재 검사이고, **실제 악성 검사 준비 증명은 worker의 `preflight --scanner` 결과**다. 데몬의 `healthy` 역시 소켓 응답일 뿐이다. 스캐너 응답, EICAR 시험, 서명 시각(현재 구현 48시간 이내)이 모두 통과해야 한다.

`signatures`와 `clamav`는 같은 소켓을 공유해 서명 갱신 통지를 전달한다. 소켓은 0660이고 UID/GID는 10001이다. TCP 3310·7357을 열지 않는다. 데몬 임시 검사 파일은 `/tmp` tmpfs에만 생기며 컨테이너 종료 시 사라진다.

## 5. R1-05·06과 실제 실행의 경계

이 저장소의 [R1 연결 인계](../../docs/workhub/40-collection-r1-connection.md)와 [이번 활성화 준비 문서](../../docs/workhub/41-worker-activation-handoff.md)를 Claude에게 전달한다. 원본 SQL을 바꾸지 말고, 코드 릴리스·작업자 ID·학교 UUID·실측 검사 능력·정책값을 맞춰 승인한다.

- 로컬/컨테이너 검사 통과와 `preflight` 통과만으로 업무실 수합 준비 상태는 켜지지 않는다.
- Claude와 R1-05 작업자 연결 및 R1-06 정책 게시의 값·순서를 확인한 뒤 계란님이 직접 SQL을 적용한다.
- 이후 실제 연결 확인 때만 수동으로 `verify --execute --max-jobs 1`을 실행한다. 이 명령은 DB heartbeat·작업 인수·Storage 파일 읽기·검사 결과 기록을 수행한다.
- `cleanup --execute`는 실제 파일 삭제가 가능한 별도 작업이다. 정리 기준·대상 확인을 마친 뒤 별도로 승인·실행한다. 배포에 자동 포함하지 않는다.
- 실제 Storage 업로드/다운로드·서명 URL 차단·다중 교사 권한·실패 복구 확인은 계란님이 요청한 대로 모아서 진행한다.

```bash
# R1-05/06 승인·적용과 실사용 확인 시점이 된 뒤에만 실행한다.
docker compose --env-file workers/deploy/runtime.env -f workers/deploy/compose.runtime.yaml run --rm --no-deps worker verify --execute --max-jobs 1
```

검사 연결을 중지할 때는 새 작업자 실행을 멈추고, 필요하면 Claude와 R1-80 비파괴 중지 절차를 확인한다. `docker compose ... stop`은 컨테이너를 중지한다. `down --volumes`·수합 버킷 삭제·R0 재실행·R0-90은 이 배포 절차에 없다. 기존 서명 볼륨의 UID가 다르다는 이유로 호스트 경로를 재귀 chown하지 않는다. 실제 서버에서 해당 Docker 볼륨만 확인해 조치한다.

## 6. 자동 검사와 남는 확인

```bash
bash tests/integration/workhub-worker-container.sh
```

이 CI 검사는 실제 worker 이미지와 ClamAV 파생 이미지를 빌드하고, 네트워크 없는 읽기 전용 컨테이너에서 `check`·미승인 `verify`·미승인 `cleanup`을 실행한다. 기본/운영 Compose를 Docker가 직접 해석하고, 가짜 비밀 파일을 통한 무접속 사전 점검, 스캐너 이미지 UID·볼륨 권한·설정 파싱을 확인한다. 결과는 `WORKHUB_CONTAINER_REPORT` 또는 임시 `workhub-container-results`에 기록한다. 별도 시험 때문에 운영 설정이나 학교 자료를 전달하지 않는다.

**CI는 공식 서명 다운로드와 실제 ClamAV 탐지·운영 Supabase 접속을 검증하지 않는다.** 스캐너 버전·설정 파싱 통과와 실제 파일 탐지 성공을 구분한다. 실제 서버에서 4절을 확인하고, 수합 실사용 경로는 마지막에 모아서 확인해야 한다.

## 7. 판단 근거와 갱신

- 검토한 공식 LTS `clamav/clamav:1.4.6_base`와 digest `sha256:1b483c3988220dae0e107911e2788c2a671ccd4ec01901777f8ac02e518d3af2`를 고정했다. 2026-10-15 Docker Hub API 확인값이다. 기능 릴리스가 예고 없이 바뀌지 않게 한 프로젝트 선택이며, 새 패치/이미지 수정이 나오면 지원 여부·digest를 확인하고 이 Dockerfile을 갱신한 PR로 재검증한다. 자동 이미지 업데이트는 설치하지 않는다. [공식 태그](https://hub.docker.com/r/clamav/clamav/tags?name=1.4.6_base), [지원 정책](https://docs.clamav.net/faq/faq-eol.html).
- `_base` 이미지와 영구 서명 볼륨을 사용한다. 공식 문서는 서명 다운로드 중복을 줄이기 위한 볼륨 보존과 검사 데몬 약 4 GiB 메모리를 안내한다. 본 구성은 4 GiB 데몬과 별도 갱신 컨테이너·공유 소켓으로 나눴다. [공식 Docker 안내](https://docs.clamav.net/manual/Installing/Docker.html).
- 공식 Alpine 이미지 위에 UID/GID 10001과 설정만 얹는다. 기본 root 진입 스크립트를 사용하지 않고 `clamd`와 `freshclam`을 각각 비특권 사용자로 시작한다. [공식 이미지 소스](https://github.com/Cisco-Talos/clamav-docker/tree/main/clamav/1.4/alpine).
- `clamd.conf`에는 Unix 소켓·INSTREAM 상한·탐지 한도 초과 경고를 명시했다. 이 자원 상한은 학교 수합 정책 승인이 아니며 DB 정책과 별도로 더 엄격하게 차단할 수 있다. [clamd 설정 원문](https://github.com/Cisco-Talos/clamav/blob/clamav-1.4.6/etc/clamd.conf.sample), [명령 프로토콜](https://docs.clamav.net/manual/Usage/ClamdProtocol.html).
- 바꾸려면 배포 동작은 `compose*.yaml`, 이미지 버전은 `clamav/Dockerfile`, 검사기 한도는 `clamav/*.conf`, 실제 파일 실행 승인은 R1-05/06을 각각 검토한다. 운영 자동화는 이번 범위에 넣지 않았다.
