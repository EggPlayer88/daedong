#!/usr/bin/env bash
# 승인된 R0·R1 SQL과 실제 작업자를 전용 로컬 PostgreSQL에서 연속 검증한다.
# 사전 준비: npm ci, Python psycopg2-binary·workers/requirements.txt, PostgreSQL 17 bin, psql 16+.
# 필수 환경: R0_WORK(끝 이름 workhub-r2-r0-verify*), R0_PG_BIN, R0_PSQL.
# 선택 환경: R0_PG_PORT(기본 55447), WORKHUB_R2_SQL_REPORT(로그 저장 경로).
# 운영 접속값을 받지 않으며 SQL 원문·외부 DB·사이트 설정을 바꾸지 않는다.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
fail(){ echo "중단: $*" >&2; exit 2; }
[ "$(id -u)" != 0 ] || fail "일반 OS 사용자로 실행하세요. root 실행은 지원하지 않습니다."
[ -n "${R0_WORK:-}" ] && [[ "$R0_WORK" = /* ]] || fail "R0_WORK는 전용 임시 폴더의 절대 경로여야 합니다."
[ ! -L "$R0_WORK" ] || fail "심볼릭 링크 작업 폴더는 사용할 수 없습니다."
R0_WORK=$(realpath -m "$R0_WORK")
case "$(basename "$R0_WORK")" in workhub-r2-r0-verify*) ;; *) fail "R0_WORK의 끝 이름은 workhub-r2-r0-verify로 시작해야 합니다." ;; esac
MARKER="$R0_WORK/.codex-workhub-r2-sql"
if [ -d "$R0_WORK" ] && [ -n "$(find "$R0_WORK" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
  [ -f "$MARKER" ] && [ "$(cat "$MARKER")" = 'codex-workhub-r2-local-sql-v1' ] || fail "기존 파일이 있는 다른 작업 폴더는 사용할 수 없습니다."
fi
mkdir -p "$R0_WORK"
printf '%s\n' 'codex-workhub-r2-local-sql-v1' > "$MARKER"
export R0_WORK
export R0_PG_PORT=${R0_PG_PORT:-55447}
[[ "$R0_PG_PORT" =~ ^[0-9]+$ ]] && [ "$R0_PG_PORT" -ge 1024 ] && [ "$R0_PG_PORT" -le 65535 ] || fail "유효한 로컬 시험 포트를 지정하세요."
[ -n "${R0_PG_BIN:-}" ] && [ -n "${R0_PSQL:-}" ] || fail "R0_PG_BIN과 R0_PSQL이 필요합니다."
# 외부 연결용 환경을 상속하지 않는다. 원본 도구는 명시한 Unix 소켓만 사용한다.
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS
export R0_SQL_DIR="$REPO/database/workhub/r0"
source "$REPO/database/workhub/r0/test/env.sh"
export R1_APP_SRC="$REPO"
OUTPUT=${WORKHUB_R2_SQL_REPORT:-$R0_WORK/reports}
[[ "$OUTPUT" = /* ]] || fail "WORKHUB_R2_SQL_REPORT은 절대 경로여야 합니다."
mkdir -p "$OUTPUT"
cleanup(){
  # 원본 reset.sh가 만든 표식이 있을 때만 이 서버를 정지한다. 자료 삭제는 하지 않는다.
  if [ -f "$MARKER" ] && [ -f "$R0_WORK/data/.r0-verify" ]; then
    "$R0_PG_BIN/pg_ctl" -D "$R0_WORK/data" -m fast -w stop > "$OUTPUT/server-stop.log" 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
python3 -c 'import psycopg2, pypdf, olefile, lxml, PIL'
[ -x "$REPO/node_modules/.bin/esbuild" ] || fail "저장소에서 npm ci를 먼저 실행하세요."
step(){
  local name=$1; shift
  echo "실행: $name"
  if "$@" > "$OUTPUT/$name.log" 2>&1; then
    tail -n 4 "$OUTPUT/$name.log"
  else
    local status=$?
    tail -n 30 "$OUTPUT/$name.log"
    return "$status"
  fi
}
step r0-full bash "$REPO/database/workhub/r0/test/run_all.sh"
step r1-full bash "$REPO/database/workhub/r1/test/run_all.sh"
grep -q 'FAIL 0 · 미실행 0' "$OUTPUT/r1-full.log" || fail "R1 전체 시험에 실패 또는 미실행이 있습니다."
# 전체 시험이 바꾼 합성 자료를 재사용하지 않고, 원본 setup으로 설치 직후 상태를 새로 만든다.
step worker-setup bash "$REPO/database/workhub/r1/test/setup.sh" r1
r0_psql -U supabase_admin -d postgres -c 'CREATE DATABASE codex_r1_worker_r2 TEMPLATE r0' > "$OUTPUT/worker-database.log"
r0_psql -U supabase_admin -d postgres -c 'GRANT ALL ON DATABASE codex_r1_worker_r2 TO postgres' >> "$OUTPUT/worker-database.log"
# 작업자 시험은 목적지·PG17·실제 data_directory를 다시 검사하고 loopback만 허용한다.
# 이 전용 서버만 loopback TCP를 열며 외부 주소는 받지 않는다.
"$R0_PG_BIN/pg_ctl" -D "$R0_WORK/data" -m fast -w stop > "$OUTPUT/worker-restart.log" 2>&1
"$R0_PG_BIN/pg_ctl" -D "$R0_WORK/data" -o "-p $R0_PG_PORT -k '$R0_WORK' -c listen_addresses=127.0.0.1 -c timezone=UTC" -l "$R0_WORK/log.txt" -w start >> "$OUTPUT/worker-restart.log" 2>&1
step worker-integration python3 "$REPO/tests/integration/workhub-r1-worker.py" \
  --sql-root "$REPO/database/workhub/r1" --port "$R0_PG_PORT" \
  --database codex_r1_worker_r2 --expected-data-directory "$R0_WORK/data" \
  --output "$OUTPUT/worker-integration.json"
echo "R0·R1 전체 SQL 및 실제 작업자 연결 시험 완료. 실제 Supabase/PostgREST/Storage 확인은 별도입니다."
