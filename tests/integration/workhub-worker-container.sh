#!/usr/bin/env bash
# Docker가 있는 Linux CI에서 실제 이미지·기본 무접속 실행·운영 구성만 검사한다.
# 실제 Supabase 요청, 서명 내려받기, 운영 정책 게시·작업자 설치는 하지 않는다.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo_root"
command -v docker >/dev/null
docker info >/dev/null
docker compose version
report_dir=${WORKHUB_CONTAINER_REPORT:-"${RUNNER_TEMP:-/tmp}/workhub-container-results"}
mkdir -p "$report_dir"
report_dir=$(cd "$report_dir" && pwd)
owned_tmp=$(mktemp -d "${RUNNER_TEMP:-/tmp}/workhub-container-ci.XXXXXX")
project="workhub-worker-ci-${GITHUB_RUN_ID:-$$}-${RANDOM}"
export WORKHUB_WORKER_IMAGE="workhub-worker-ci:${project}"
export WORKHUB_SCANNER_IMAGE="workhub-clamav-ci:${project}"
compose=(docker compose -p "$project" -f workers/deploy/compose.yaml)
cleanup() {
  "${compose[@]}" down --remove-orphans >/dev/null 2>&1 || true
  # 이 실행이 만든 임시 파일만 지운다. 운영 볼륨·서명은 건드리지 않는다.
  case "$owned_tmp" in "${RUNNER_TEMP:-/tmp}"/workhub-container-ci.*) rm -rf -- "$owned_tmp";; esac
}
trap cleanup EXIT
"${compose[@]}" config --format json > "$report_dir/default-compose.json"
python3 - "$report_dir/default-compose.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert set(x['services'])=={'worker'}
w=x['services']['worker'];assert w['command']==['check'] and w['network_mode']=='none'
assert w['read_only'] is True and w['user']=='10001:10001'
assert w['restart']=='no' and not w.get('secrets') and not w.get('environment')
assert 'ALL' in w['cap_drop'] and w.get('pids_limit',0)>0
print('기본 Compose: 로컬 검사 한 개, 무접속·비밀값 없음')
PY
docker build --progress plain -f workers/Dockerfile -t "$WORKHUB_WORKER_IMAGE" . > "$report_dir/worker-build.log" 2>&1
docker build --progress plain -f workers/deploy/clamav/Dockerfile -t "$WORKHUB_SCANNER_IMAGE" . > "$report_dir/scanner-build.log" 2>&1
"${compose[@]}" up --no-build --abort-on-container-exit --exit-code-from worker > "$report_dir/default-compose-run.log" 2>&1
# 같은 제한으로 실제 CLI 세 경로를 실행한다. --execute 없이는 비밀 파일도 읽지 않는다.
limits=(--rm --network none --read-only --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --memory 1536m --cpus 1 --pids-limit 64 --ulimit core=0 --tmpfs /tmp:rw,noexec,nosuid,nodev,size=128m,mode=1777)
for mode in check verify cleanup; do
  docker run "${limits[@]}" -e WORKHUB_SERVICE_ROLE_KEY_FILE=/missing/file "$WORKHUB_WORKER_IMAGE" "$mode" > "$report_dir/$mode.json"
  python3 - "$report_dir/$mode.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert x['status']=='checked' and x['mode']=='local_only'
assert x['databaseCalled'] is False and x['storageCalled'] is False and x['malwareChecked'] is False
assert set(x['checks'])=={'size','sha256','signature','container','encryption'}
PY
done
# 가짜 키도 빌드 컨텍스트 밖 파일로만 공급한다. config에는 키 본문이 들어가지 않는다.
secret_path="$owned_tmp/service-key"
printf '%s' 'sb_secret_workhub_container_ci_not_a_real_key_12345' > "$secret_path"
chmod 0400 "$secret_path"
if [[ $(id -u) == 0 ]]; then chown 10001:10001 "$secret_path"; else sudo chown 10001:10001 "$secret_path"; fi
export WORKHUB_SECRET_FILE="$secret_path"
export WORKHUB_SUPABASE_URL=https://aaaaaaaaaaaaaaaaaaaa.supabase.co
export WORKHUB_EXPECTED_PROJECT_REF=aaaaaaaaaaaaaaaaaaaa
export WORKHUB_SCHOOL_ID=11111111-1111-4111-8111-111111111111
export WORKHUB_WORKER_ID=container-ci
export WORKHUB_WORKER_RELEASE=container-ci
runtime=(docker compose -p "$project" -f workers/deploy/compose.runtime.yaml)
"${runtime[@]}" --profile scanner --profile execution config --format json > "$report_dir/runtime-compose.json"
python3 - "$report_dir/runtime-compose.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert set(x['services'])=={'worker','clamav','signatures'}
for name,s in x['services'].items():
 assert s['read_only'] is True and s['user']=='10001:10001' and s['restart']=='no'
 assert not s.get('ports') and 'ALL' in s['cap_drop'] and s.get('profiles')
w=x['services']['worker'];assert w['command']==['check']
assert 'WORKHUB_SERVICE_ROLE_KEY' not in w['environment']
assert w['environment']['WORKHUB_SERVICE_ROLE_KEY_FILE']=='/run/secrets/workhub_service_key'
assert w['environment']['WORKHUB_SCANNER_MODE']=='clamav'
assert x['services']['clamav']['network_mode']=='none'
assert len(x['volumes'])==2
print('운영 Compose: 명시 프로필, 기본 check, TCP 공개 없음, 비밀 파일만 사용')
PY
# 실제 bind secret의 읽기와 환경 사전검사. 네트워크가 없는 단일 컨테이너다.
docker run "${limits[@]}" \
  --mount "type=bind,source=$secret_path,target=/run/secrets/workhub_service_key,readonly" \
  -e WORKHUB_SERVICE_ROLE_KEY_FILE=/run/secrets/workhub_service_key \
  -e WORKHUB_SUPABASE_URL -e WORKHUB_EXPECTED_PROJECT_REF -e WORKHUB_SCHOOL_ID \
  -e WORKHUB_WORKER_ID -e WORKHUB_WORKER_RELEASE -e WORKHUB_SCANNER_MODE=clamav \
  -e WORKHUB_CLAMAV_SOCKET=/run/clamav/clamd.ctl \
  "$WORKHUB_WORKER_IMAGE" preflight > "$report_dir/preflight.json"
python3 - "$report_dir/preflight.json" <<'PY'
import json,sys
x=json.load(open(sys.argv[1]));assert x['status']=='checked' and x['mode']=='deployment_preflight'
assert x['databaseCalled'] is False and x['storageCalled'] is False
assert x['activationVerified'] is False and x['scannerCalled'] is False
assert 'sb_secret_' not in json.dumps(x)
PY
# 공식 이미지 파생본에서 실제 UID·볼륨 권한·설정 파싱을 확인한다. 서명 다운로드는 안 한다.
docker run --rm --network none --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 512m --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777 \
  --entrypoint /bin/sh "$WORKHUB_SCANNER_IMAGE" -ec \
  'test "$(id -u)" = 10001; test "$(id -g)" = 10001; test -w /var/lib/clamav; test -w /run/clamav; clamconf --config-dir=/etc/clamav --non-default' \
  > "$report_dir/scanner-config.log"
python3 - "$report_dir/scanner-config.log" <<'PY'
from pathlib import Path
import sys
text=Path(sys.argv[1]).read_text()
assert '/run/clamav/clamd.ctl' in text and 'workhub' in text
assert 'ERROR' not in text and 'ERROR:' not in text
PY
printf '%s\n' '{"status":"passed","workerImageBuilt":true,"scannerImageBuilt":true,"networklessCliModes":3,"secretFilePreflight":true,"scannerConfigurationParsed":true,"databaseCalled":false,"storageCalled":false,"liveScannerTested":false}' > "$report_dir/result.json"
cat "$report_dir/result.json"
