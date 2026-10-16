#!/usr/bin/env bash
# 현재 앱과 Claude의 SQL 원본을 격리 PostgreSQL 17에서 함께 검사한다.
# 운영 DSN/키를 받지 않는다. 원본 SQL은 복사만 하고, 원본 시험의 reset은 전용 임시 DB만 초기화한다.
set -euo pipefail
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SQL_REF=edd743f978a8cf04f52b71d9892be209a89484ad
fail(){ echo "중단: $*" >&2; exit 2; }
MODE=${1:-run}
[[ "$#" -le 1 && ( "$MODE" = run || "$MODE" = --check-safety ) ]] || fail "사용법: bash scripts/verify-workhub-release-sql.sh [--check-safety]"

# 값은 출력하지 않는다. 외부 접속값이 섞인 셸에서는 지우고 다시 실행하게 한다.
while IFS= read -r name; do
  case "$name" in
    PG*|DATABASE_URL|DIRECT_URL|SUPABASE*|VITE_SUPABASE*|ANTHROPIC*|OPENAI*|WORKHUB_TEST_DATABASE_URL|R0_SQL_DIR|R0_CONTRACT|INT_*|R1_*|R1S_*|P[1-8]_*)
      [ -z "${!name:-}" ] || fail "외부 접속 또는 시험 범위 변경 환경이 있습니다($name). 값을 제거한 전용 셸에서 실행하세요." ;;
  esac
done < <(compgen -e)
[ "$(id -u)" != 0 ] || fail "일반 OS 사용자로 실행하세요."
[ -n "${R0_WORK:-}" ] && [[ "$R0_WORK" = /* ]] || fail "R0_WORK는 전용 임시 폴더의 절대 경로여야 합니다."
case "$R0_WORK" in *"'"*|*'"'*|*'`'*|*'$'*|*'\'*|*$'\n'*|*$'\r'*) fail "작업 경로에는 셸 특수문자를 넣을 수 없습니다." ;; esac
# 원본 앱 대조 도구의 env 인자 경로가 분리되지 않도록 DB 임시 경로만 공백 없이 둔다.
[[ ! "$R0_WORK" =~ [[:space:]] ]] || fail "시험 DB 경로는 공백 없이 지정하세요. 저장소 경로와는 별개입니다."
[ "$(realpath -ms "$R0_WORK")" = "$(realpath -m "$R0_WORK")" ] || fail "작업 폴더와 상위 경로에 심볼릭 링크를 사용할 수 없습니다."
R0_WORK=$(realpath -m "$R0_WORK")
case "$(basename "$R0_WORK")" in workhub-release-r0-verify*) ;; *) fail "작업 폴더 끝 이름은 workhub-release-r0-verify로 시작해야 합니다." ;; esac
case "$R0_WORK/" in "$REPO/"*) fail "소스 저장소 안에는 시험 DB를 만들지 않습니다." ;; esac
MARKER="$R0_WORK/.codex-workhub-release-sql"
if [ -e "$R0_WORK" ]; then
  [ -d "$R0_WORK" ] || fail "작업 경로가 폴더가 아닙니다."
  if [ -n "$(find "$R0_WORK" -mindepth 1 -maxdepth 1 -print -quit)" ]; then
    [ -f "$MARKER" ] && [ ! -L "$MARKER" ] && [ "$(cat "$MARKER")" = 'workhub-release-local-sql-v1' ] || fail "다른 자료가 있는 폴더는 사용할 수 없습니다."
  fi
  [ ! -L "$R0_WORK/data" ] || fail "시험 data 폴더가 심볼릭 링크입니다."
  if [ -e "$R0_WORK/data" ]; then
    [ -f "$R0_WORK/data/.r0-verify" ] && [ ! -L "$R0_WORK/data/.r0-verify" ] || fail "원본 reset 도구의 표식이 없는 DB는 초기화하지 않습니다."
  fi
fi
export R0_PG_PORT=${R0_PG_PORT:-55463}
[[ "$R0_PG_PORT" =~ ^[0-9]+$ ]] && [ "$R0_PG_PORT" -ge 1024 ] && [ "$R0_PG_PORT" -le 65535 ] || fail "유효한 로컬 시험 포트를 지정하세요."
# 회귀 시험용: 위 검사는 파일 생성·DB 시작·네트워크 요청 없이 끝난다.
if [ "$MODE" = --check-safety ]; then echo 'PASS 실행기 안전 조건'; exit 0; fi
[ "$(uname -s)" = Linux ] || fail "SQL 시험은 Linux 또는 WSL Linux에서 실행하세요."
[ -n "${R0_PG_BIN:-}" ] && [ -n "${R0_PSQL:-}" ] || fail "R0_PG_BIN과 R0_PSQL이 필요합니다."
for path in "$R0_PG_BIN" "$R0_PSQL"; do
  [[ "$path" = /* ]] || fail "런타임은 절대 경로여야 합니다."
  case "$path" in *"'"*|*'"'*|*'`'*|*'$'*|*'\'*|*$'\n'*|*$'\r'*) fail "런타임 경로에 셸 특수문자가 있습니다." ;; esac
done
command -v python3 >/dev/null || fail "Python 3가 필요합니다."
command -v node >/dev/null || fail "Node.js가 필요합니다."
python3 -c 'import psycopg2, lxml' || fail "Python psycopg2와 lxml이 필요합니다."
export ESBUILD=${ESBUILD:-$REPO/node_modules/.bin/esbuild}
[ -x "$ESBUILD" ] && [ -d "$REPO/node_modules/react" ] || fail "Linux 저장소에서 npm ci를 먼저 실행하세요."
git -C "$REPO" cat-file -e "$SQL_REF^{commit}" || fail "SQL 기준 커밋이 없습니다. 전체 Git 이력이 있는 체크아웃을 사용하세요."
git -C "$REPO" diff --quiet "$SQL_REF" -- database/workhub || fail "Claude SQL 원본과 다른 변경이 있습니다. SQL을 고쳐 시험을 통과시키지 않습니다."
[ -z "$(git -C "$REPO" ls-files --others --exclude-standard -- database/workhub)" ] || fail "SQL 폴더에 원본에 없는 파일이 있습니다."
mkdir -p "$R0_WORK"
chmod 700 "$R0_WORK"
printf '%s\n' 'workhub-release-local-sql-v1' > "$MARKER"
export R0_WORK
RUN=$(mktemp -d "$R0_WORK/run-XXXXXXXX")
OUTPUT="$RUN/reports"
SNAPSHOT="$RUN/source"
mkdir -p "$OUTPUT" "$SNAPSHOT"
echo "결과 폴더: $OUTPUT"

# 실행 중 소스가 바뀌어도 시험은 처음 캡처한 앱으로 끝낸다. SQL·앱의 파일별 hash를 함께 남긴다.
# .sh의 CRLF만 사본에서 LF로 바꾸며, SQL/원본 테스트의 내용은 바꾸지 않는다.
python3 - "$REPO" "$SNAPSHOT" "$OUTPUT/source-manifest.json" "$SQL_REF" <<'PY'
import hashlib, json, pathlib, shutil, subprocess, sys
root, target, output = map(pathlib.Path, sys.argv[1:4])
prefixes = ['database/workhub', 'migrations', 'apps/workhub/src', 'apps/main/api', 'packages/shared', 'docs/workhub/database-integrated', 'scripts/verify-workhub-release-sql.sh', 'scripts/lib/workhub-release-results.mjs', 'tests/integration/workhub-release-relations.ts']
names = subprocess.check_output(['git', '-C', str(root), 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', *prefixes]).decode().split('\0')
rows, normalized = [], []
for name in filter(None, names):
    source = root / name
    if source.is_symlink() or not source.is_file():
        raise SystemExit('소스의 심볼릭 링크/누락 파일을 사본으로 만들지 않습니다: ' + name)
    before = source.read_bytes()
    copied = before.replace(b'\r\n', b'\n') if name.endswith('.sh') else before
    dest = target / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(copied)
    if before != copied: normalized.append(name)
    rows.append({'path': name, 'sourceSha256': hashlib.sha256(before).hexdigest(), 'testedSha256': hashlib.sha256(copied).hexdigest()})
for row in rows:
    if hashlib.sha256((root / row['path']).read_bytes()).hexdigest() != row['sourceSha256']:
        raise SystemExit('사본을 만드는 동안 소스가 바뀌었습니다. 다시 실행하세요: ' + row['path'])
manifest = {'schemaVersion': 1, 'sqlCommit': sys.argv[4], 'appCommit': subprocess.check_output(['git', '-C', str(root), 'rev-parse', 'HEAD']).decode().strip(), 'shellLineEndingsNormalized': normalized, 'files': rows}
output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'원본 사본 {len(rows)}개 / 셸 LF 보정 {len(normalized)}개 (SQL 변경 0)')
PY
ln -s "$REPO/node_modules" "$SNAPSHOT/node_modules"
export INT_APP_SRC="$SNAPSHOT" P8_APP_SRC="$SNAPSHOT"
export R0_SQL_DIR="$SNAPSHOT/database/workhub/r0"
source "$SNAPSHOT/database/workhub/r0/test/env.sh"
cleanup(){
  local status=$?
  if [ -f "$MARKER" ] && [ ! -L "$R0_WORK/data" ] && [ -f "$R0_WORK/data/.r0-verify" ]; then
    if "$R0_PG_BIN/pg_ctl" -D "$R0_WORK/data" status >/dev/null 2>&1; then
      "$R0_PG_BIN/pg_ctl" -D "$R0_WORK/data" -m fast -w stop > "$OUTPUT/server-stop.log" 2>&1 || status=1
    fi
  fi
  if [ -e "$R0_WORK/data/postmaster.pid" ]; then echo 'FAIL 시험 서버 종료 확인' >&2; status=1; fi
  printf '%s\n' "$status" > "$OUTPUT/exit-code.txt"
  trap - EXIT
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
# 원본 R1 시험은 한국 날짜 자료를 만든다. 현재 세션의 current_date도 같은 기준으로 둔다.
export PGOPTIONS='-c timezone=Asia/Seoul'
step(){
  local name=$1; shift
  echo "실행: $name"
  if "$@" > "$OUTPUT/$name.log" 2>&1; then
    tail -n 3 "$OUTPUT/$name.log"
  else
    local status=$?
    tail -n 30 "$OUTPUT/$name.log"
    return "$status"
  fi
  # 기존 검토의 비차단 코드 차이만 별도 집계한다. 신규 WARN·FAIL·KNOWN·0건은 실패다.
  node "$SNAPSHOT/scripts/lib/workhub-release-results.mjs" check "$name" "$OUTPUT/$name.log"
}
step integration bash "$SNAPSHOT/database/workhub/integration/test/run_integration.sh"
step p8 bash "$SNAPSHOT/database/workhub/p8/test/run_all.sh"
node "$SNAPSHOT/scripts/lib/workhub-release-results.mjs" branches "$R0_WORK" > "$OUTPUT/branches.json"
step pr62-build "$ESBUILD" "$SNAPSHOT/database/workhub/integration/test/app_contract_pr62.ts" --bundle --platform=node --format=esm --log-level=warning \
  --alias:@daedong/shared="$SNAPSHOT/database/workhub/r1s/test/shared_stub.ts" --alias:pr62app="$SNAPSHOT/apps/workhub/src" --loader:.css=text --outfile="$RUN/app_pr62.mjs"
step pr62 env P5_CAPTURE="$R0_WORK/integration/cap_p5.json" P8_CAPTURE="$R0_WORK/integration/cap_p8.json" P7_CAPTURE="$R0_WORK/integration/cap_p7.json" node "$RUN/app_pr62.mjs"
step relations-build "$ESBUILD" "$SNAPSHOT/tests/integration/workhub-release-relations.ts" --bundle --platform=node --format=esm --log-level=warning \
  --alias:@daedong/shared="$SNAPSHOT/database/workhub/r1s/test/shared_stub.ts" --alias:releaseapp="$SNAPSHOT/apps/workhub/src" --outfile="$RUN/relations-path.mjs"
step relations-path env P8_CAPTURE="$R0_WORK/integration/cap_p8.json,$R0_WORK/integration/cap_p8_nobridge.json" node "$RUN/relations-path.mjs"
node "$SNAPSHOT/scripts/lib/workhub-release-results.mjs" summarize "$OUTPUT"
git -C "$REPO" diff --quiet "$SQL_REF" -- database/workhub || fail "검사 중 SQL 원본이 바뀌었습니다. 결과를 확정하지 않습니다."
echo '완료: 격리 PostgreSQL·앱 계약 검사. 실제 Supabase·Storage·Claude·배포 확인은 별도입니다.'
