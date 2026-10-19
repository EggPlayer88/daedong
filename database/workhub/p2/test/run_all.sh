#!/bin/bash
# P2 전체 검증: 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · P2 시험(R1+P1 위 / R1+R1S+P1 위) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P2_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P2_APP_SRC  apps/workhub/src/calendar/batch-adapter.ts 가 있는 checkout(PR #48 브랜치).
#               없으면 앱 대조는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); P1=$(cd "$HERE/../../p1" && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p2; mkdir -p "$W"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 "$@"; }
val(){ q -Atc "$1"; }
refuse(){ local name=$1 pat=$2 out rc; shift 2
  out=$("$@" 2>&1); rc=$?
  if { [ "$rc" = 3 ] || [ "$rc" = 1 ]; } && grep -qF -- "$pat" <<<"$out" && grep -q "ERROR:" <<<"$out"; then ok "$name"; else ng "$name  -- exit $rc: $(tail -n 2 <<<"$out" | tr '\n' ' ')"; fi; }
sub(){ local name=$1 log=$2 rc=$3 p f
  sed 's/^/  /' "$log"
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then ng "$name 실행 실패(exit $rc)"; fi
  if [ "$p" = 0 ]; then ng "$name 통과한 시험이 0개"; fi; }
nop2(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ('p2_installs','module_activations','request_receipts','calendar_import_sources','cooperation_requests')")" = 0 ]; }
p1(){ need q -f "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -f "$P1/P1-02_학교관리_공개함수.sql" >/dev/null; }
APP=${P2_APP_SRC:-}
MOD80=$(sed "s/'<학교 코드[^']*>'/'daedong-ms'/; s/'<모듈[^']*>'/'cooperation'/; s/'<사유[^']*>'/'시험'/" "$S/P2-80_모듈중지.sql")

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
refuse "I1 P1 없이 P2-01 → 멈춤" "P1-01·02(2026-10-16.1)를 먼저 적용해 주세요" q -f "$S/P2-01_일정일괄_협업_모델.sql"
nop2 && ok "I2 멈춘 P2-01 은 표를 남기지 않음" || ng I2
p1
refuse "I3 P2-01 전에 P2-02 → 멈춤" "P2-01(2026-10-16.1)을 먼저 실행해 주세요" q -f "$S/P2-02_일정일괄_협업_공개함수.sql"
refuse "I4 P2-01 전에 P2-04 → 멈춤" "P2-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed 's/"<[^"]*>"/"x"/g' "$S/P2-04_모듈활성화_양식.sql")"
refuse "I5 P2-01 전에 P2-80 → 멈춤" "P2-01 이 적용되어 있지 않습니다" q -c "$MOD80"
need q -qc "create function public.workhub_cooperation_list(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I6 같은 이름 함수가 이미 있으면 P2-01 이 멈춤" "같은 이름의 표·함수가 이미 있습니다" q -f "$S/P2-01_일정일괄_협업_모델.sql"
nop2 && ok "I7 멈춘 P2-01 은 표를 남기지 않음(이름 충돌)" || ng I7

echo "== II. 비활성 설치(P1-01·02 + P2-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1
need q -f "$S/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -f "$S/P2-02_일정일괄_협업_공개함수.sql" >/dev/null
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (P1·P2 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. P2 시험(R1 + P1-01·02 위)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1
P2_CAPTURE=$W/cap_p2.json python3 "$T/run_p2.py" > "$W/p2_log.txt" 2>&1; sub "III run_p2.py" "$W/p2_log.txt" $?

echo "== IV. P2 시험(R1 + R1S-01·02 + P1-01·02 위 — PR #47·#49 를 먼저 적용한 운영 순서)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -f "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -f "$R1S/R1S-02_공개함수_권한.sql" >/dev/null; p1
python3 "$T/run_p2.py" > "$W/p2_r1s_log.txt" 2>&1; sub "IV run_p2.py (R1S 위)" "$W/p2_r1s_log.txt" $?

echo "== V. 앱(PR #48) 일정 일괄·협업 어댑터·parser 로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/calendar/batch-adapter.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p2.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p2app="$APP/apps/workhub/src" --outfile="$W/app_contract_p2.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P2_CAPTURE=$W/cap_p2.json node "$W/app_contract_p2.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_p2" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — P2_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
