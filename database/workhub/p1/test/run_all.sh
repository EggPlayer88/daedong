#!/bin/bash
# P1 전체 검증: 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · P1 시험(R1 위 / R1+R1S 위) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P1_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P1_APP_SRC  apps/workhub/src/setup/school-admin-server.ts 가 있는 checkout(PR #48 브랜치).
#               없으면 앱 대조는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p1; mkdir -p "$W"
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
nop1(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ('p1_installs','school_admin_activations','year_departments','year_classes','year_subjects','staff_assignments','school_admin_changes')")" = 0 ]; }
APP=${P1_APP_SRC:-}

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
refuse "I1 R1 없이 P1-01 → 멈춤" "R0 과 R1-01·02·03(2026-10-15.1)이 모두 적용되어 있지 않습니다" q -f "$S/P1-01_학교관리_모델.sql"
nop1 && ok "I2 멈춘 P1-01 은 표를 남기지 않음" || ng I2
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
refuse "I3 P1-01 전에 P1-02 → 멈춤" "P1-01(2026-10-16.1)을 먼저 실행해 주세요" q -f "$S/P1-02_학교관리_공개함수.sql"
refuse "I4 P1-01 전에 P1-04 → 멈춤" "P1-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed 's/"<[^"]*>"/"x"/g' "$S/P1-04_학교활성화_양식.sql")"
need q -qc "create or replace function workhub_private.member_relations(p_school_id text, p_membership_id text) returns jsonb language sql stable set search_path = '' as \$\$ select '{}'::jsonb \$\$" >/dev/null
refuse "I5 교체할 R0 함수가 원문과 다르면 P1-01 이 멈춤" "교체할 R0 함수가 원문과 다릅니다" q -f "$S/P1-01_학교관리_모델.sql"
nop1 && ok "I6 멈춘 P1-01 은 표를 남기지 않음(교체 함수 다름)" || ng I6
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qc "alter table workhub.terms drop constraint terms_label_check, add constraint terms_label_check check (length(label) between 1 and 31)" >/dev/null
refuse "I7 넓힐 R0 제약이 원문과 다르면 P1-01 이 멈춤" "넓힐 R0 제약이 원문과 다릅니다" q -f "$S/P1-01_학교관리_모델.sql"
refuse "I8 P1-01 전에 P1-80 → 멈춤" "P1-01 이 적용되어 있지 않습니다" q -c "$(sed "s/'<학교 코드[^']*>'/'daedong-ms'/; s/'<사유[^']*>'/'시험'/" "$S/P1-80_학교중지.sql")"

echo "== II. 비활성 설치(P1-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -f "$S/P1-01_학교관리_모델.sql" >/dev/null; need q -f "$S/P1-02_학교관리_공개함수.sql" >/dev/null
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (P1 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. P1 시험(R1-01~03 위)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
P1_CAPTURE=$W/cap_p1.json python3 "$T/run_p1.py" > "$W/p1_log.txt" 2>&1; sub "III run_p1.py" "$W/p1_log.txt" $?

echo "== IV. P1 시험(R1 + R1S-01·02 비활성 설치 위 — PR #47 을 먼저 적용한 운영 순서)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -f "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -f "$R1S/R1S-02_공개함수_권한.sql" >/dev/null
python3 "$T/run_p1.py" > "$W/p1_r1s_log.txt" 2>&1; sub "IV run_p1.py (R1S 위)" "$W/p1_r1s_log.txt" $?

echo "== V. 앱(PR #48) 학교 관리 어댑터·parser 로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/setup/school-admin-server.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p1.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p1app="$APP/apps/workhub/src" --outfile="$W/app_contract_p1.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P1_CAPTURE=$W/cap_p1.json node "$W/app_contract_p1.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_p1" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — P1_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
