#!/bin/bash
# R1S 전체 검증: 교체 함수 대조 · 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · 기존 자료 시나리오 · 신규 DB 시나리오 · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> R1S_APP_SRC=<PR #45 checkout> bash run_all.sh      (README 참고)
#   R1S_APP_SRC  apps/main/api/collections/_hwpx_basic.py 와 apps/workhub/src 가 있는 checkout(PR #45 브랜치).
#                없으면 확인 API 왕복·앱 대조는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); W=$R0_WORK/r1s; mkdir -p "$W"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 "$@"; }
qa(){ r0_psql -U supabase_admin -d r0 "$@"; }
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
APP=${R1S_APP_SRC:-}
export R1S_API_DIR=${APP:+$APP/apps/main/api/collections}

echo "== 준비"
need python3 -c 'import psycopg2'
python3 "$T/r1s_replaced.py" --check > "$W/replaced.txt" 2>&1; sub "R R1-03 교체본 대조" "$W/replaced.txt" $?

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
refuse "I1 R1 없이 R1S-01 → 멈춤" "R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다" q -f "$S/R1S-01_모델_쓰기게이트.sql"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
refuse "I2 R1S-01 전에 R1S-02 → 멈춤" "R1S-01(2026-10-16.1)을 먼저 실행해 주세요" q -f "$S/R1S-02_공개함수_권한.sql"
need q -qc "alter function workhub_private.c_require(workhub_private.actor_context, text) set work_mem = '4MB'" >/dev/null
need q -qc "create or replace function workhub_private.c_complete(p_ctx workhub_private.actor_context, p_file_id text, p_key text) returns jsonb language plpgsql set search_path = '' as \$\$ begin return null; end \$\$" >/dev/null
refuse "I3 교체할 R1-03 함수가 원문과 다르면 R1S-01 이 멈춤" "교체할 R1-03 함수가 원문과 다릅니다(c_complete)" q -f "$S/R1S-01_모델_쓰기게이트.sql"
[ "$(val "select count(*) from pg_class where relname in ('r1s_installs','file_basic_checks','file_check_profiles')")" = 0 ] && ok "I4 멈춘 R1S-01 은 표를 남기지 않음" || ng I4
refuse "I5 R1S-04 를 R1S 전에 실행하면 멈춤" "R1S-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed 's/"<[^"]*>"/"x"/g' "$S/R1S-04_학교활성화_양식.sql")"

echo "== II. 비활성 설치(R1S-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -f "$S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -f "$S/R1S-02_공개함수_권한.sql" >/dev/null
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (R1S 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. 기존 자료 시나리오(R1 작업자 경로로 받은 PDF 가 있는 DB)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
R1S_CAPTURE=$W/cap_legacy.json python3 "$T/run_r1s.py" legacy > "$W/legacy_log.txt" 2>&1; sub "III run_r1s.py legacy" "$W/legacy_log.txt" $?

echo "== IV. 신규 DB 시나리오(운영과 같은 상태: R1-05·06 미실행 → R1S-04 로 정책 게시·활성화)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
R1S_CAPTURE=$W/cap_fresh.json python3 "$T/run_r1s.py" fresh > "$W/fresh_log.txt" 2>&1; sub "IV run_r1s.py fresh" "$W/fresh_log.txt" $?

echo "== V. 앱(PR #45) 어댑터·검증 함수로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/collections/supabase-collections.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_r1s.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$T/shared_stub.ts" --alias:r1sapp="$APP/apps/workhub/src" --outfile="$W/app_contract_r1s.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  R1S_CAPTURE=$W/cap_legacy.json,$W/cap_fresh.json node "$W/app_contract_r1s.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_r1s" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — R1S_APP_SRC 에 PR #45 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
