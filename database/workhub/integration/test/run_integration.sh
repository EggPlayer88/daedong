#!/bin/bash
# 1~7단계 통합 회귀 — R0 + R1 + R1S + P1~P7(+ P7-05) 를 한 DB 에 운영 순서대로 설치한 상태에서 확인한다.
#   단계별 run_all.sh(각자 DB 를 초기화하며 자기 단계만 본다)와 따로 둔다. 시험용 임시 PostgreSQL 만 쓴다(운영 DB 와 무관).
#   I    INT-03 목록이 지금 SQL 파일과 같은지(gen_manifest check)
#   II   R0 만 있는 DB 에 초기화 없이 파일 하나씩 적용 · 파일마다 INT-03 · 단계마다 모든 사후 점검 · 기존 자료 보존
#   III  다 설치된 DB 에서 권한 · search_path 등을 실제로 망가뜨려 INT-03 이 정확한 행으로 FAIL 하는지(15건 — 상속 실행 권한 · 소유자 전부 변경 포함)
#   IV   다 설치된 DB(P7-05 전 · 후) 에서 R1 시험 전체(run_r1.py) → 끝나고 INT-03
#   V    각 단계 시험을 "뒷 단계가 모두 설치된 DB" 에서(stage_hook) — R1S(fresh · legacy) · P1~P6 · P7(P7-05 전 · 후)
#   VI   V 에서 받은 실제 응답을 앱(INT_APP_SRC, 지금 기준 PR #59) parser · 서비스에 넣어 대조
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> INT_APP_SRC=<앱 checkout(PR #59)> bash run_integration.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
WH=$(cd "$HERE/../.." && pwd)
. "$WH/r1/test/env.sh"
W=$R0_WORK/integration; mkdir -p "$W"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 -v ON_ERROR_STOP=1 "$@"; }
sub(){ local name=$1 log=$2 rc=$3 p f
  sed 's/^/  /' "$log"
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then ng "$name 실행 실패(exit $rc)"; fi
  if [ "$p" = 0 ]; then ng "$name 통과한 시험이 0개"; fi; }
APP=${INT_APP_SRC:-}

# 운영 순서 파일 목록(gen_manifest.STAGES 와 같다)
R1S_F="r1s/R1S-01_모델_쓰기게이트.sql r1s/R1S-02_공개함수_권한.sql"
P1_F="p1/P1-01_학교관리_모델.sql p1/P1-02_학교관리_공개함수.sql"
P2_F="p2/P2-01_일정일괄_협업_모델.sql p2/P2-02_일정일괄_협업_공개함수.sql"
P3_F="p3/P3-01_메시지_알림_모델.sql p3/P3-02_메시지_공개함수_Storage.sql"
P4_F="p4/P4-01_자료_문서_모델.sql p4/P4-02_자료_문서_공개함수_Storage.sql"
P5_F="p5/P5-01_수업학생_모델.sql p5/P5-02_수업학생_공개함수.sql"
P6_F="p6/P6-01_비서_모델.sql p6/P6-02_비서_공개함수.sql"
P7_F="p7/P7-01_운영_전환_모델.sql p7/P7-02_운영_전환_공개함수.sql"
P705_F="p7/P7-05_R1_P2_보강_별도승인.sql"
apply(){ local f; for f in "$@"; do
  if [ "${f##*/}" = "P7-05_R1_P2_보강_별도승인.sql" ]; then
    need q -qc "$(sed 's/"<승인한 사람[^"]*>"/"통합 시험"/; s/"<승인 근거[^"]*>"/"통합 회귀(시험 DB)"/' "$WH/$f")" >/dev/null
  else need q -qf "$WH/$f" >/dev/null; fi; done; }
int03(){ local out; out=$(q -At -F'|' -f "$WH/integration/INT-03_통합사후점검.sql" 2>&1)
  if [ "$(grep -c '^INT-03-' <<<"$out")" = 13 ] && ! grep -q '|FAIL|' <<<"$out" && grep -q "$2" <<<"$out"; then ok "$1"
  else ng "$1 -- $(grep -v '|ok|\|info' <<<"$out" | head -3 | tr '\n' ' ')"; fi; }

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. INT-03 목록 = 지금 SQL 파일을 차례로 적용해 만든 목록"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
python3 "$HERE/gen_manifest.py" check > "$W/manifest.txt" 2>&1; sub "I gen_manifest check" "$W/manifest.txt" $?

echo "== II · III. 한 DB 차례 설치(초기화 없음) · 망가뜨리기"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
python3 "$HERE/run_build.py" > "$W/build.txt" 2>&1; sub "II·III run_build.py" "$W/build.txt" $?

echo "== IV. 다 설치된 DB 에서 R1 시험 전체 — P7-05 전 · 후"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F $P5_F $P6_F $P7_F
int03 "IV-a0 설치 직후(P7-05 전) INT-03 FAIL 없음" "R1S · P1 · P2 · P3 · P4 · P5 · P6 · P7$"
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1a.txt" 2>&1; sub "IV-a run_r1.py (전 단계 비활성 설치, P7-05 전)" "$W/r1a.txt" $?
int03 "IV-a9 R1 시험 뒤에도 INT-03 FAIL 없음" "R1S · P1 · P2 · P3 · P4 · P5 · P6 · P7$"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F $P5_F $P6_F $P7_F $P705_F
int03 "IV-b0 설치 직후(P7-05 후) INT-03 FAIL 없음" "· P7 · P7-05$"
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1b.txt" 2>&1; sub "IV-b run_r1.py (전 단계 비활성 설치 + P7-05)" "$W/r1b.txt" $?
int03 "IV-b9 R1 시험 뒤에도 INT-03 FAIL 없음" "· P7 · P7-05$"

echo "== V. 각 단계 시험을 뒷 단계가 모두 설치된 DB 에서"
hook(){ local name=$1 suite=$2 trig=$3; shift 3
  python3 "$HERE/stage_hook.py" "$WH/$suite" "$trig" "$@" > "$W/$name.txt" 2>&1; sub "V $name" "$W/$name.txt" $?; }
export R1S_API_DIR=${APP:+$APP/apps/main/api/collections}
for m in fresh legacy; do
  need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
  INT_R1S_MODE=$m R1S_CAPTURE=$W/cap_r1s_$m.json hook r1s_$m r1s/test/run_r1s.py r1s/R1S-02_공개함수_권한.sql $P1_F $P2_F $P3_F $P4_F $P5_F $P6_F $P7_F $P705_F
done
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F
P1_CAPTURE=$W/cap_p1.json hook p1 p1/test/run_p1.py p1/P1-02_학교관리_공개함수.sql $P2_F $P3_F $P4_F $P5_F $P6_F $P7_F $P705_F
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F
P2_CAPTURE=$W/cap_p2.json hook p2 p2/test/run_p2.py p2/P2-02_일정일괄_협업_공개함수.sql $P3_F $P4_F $P5_F $P6_F $P7_F $P705_F
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F
P3_CAPTURE=$W/cap_p3.json P3_APP_SRC="$APP" hook p3 p3/test/run_p3.py p3/P3-02_메시지_공개함수_Storage.sql $P4_F $P5_F $P6_F $P7_F $P705_F
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F
P4_CAPTURE=$W/cap_p4.json P4_APP_SRC="$APP" hook p4 p4/test/run_p4.py p4/P4-02_자료_문서_공개함수_Storage.sql $P5_F $P6_F $P7_F $P705_F
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F
P5_CAPTURE=$W/cap_p5.json hook p5 p5/test/run_p5.py p5/P5-02_수업학생_공개함수.sql $P6_F $P7_F $P705_F
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F $P5_F
P6_CAPTURE=$W/cap_p6.json P6_APP_SRC="$APP" hook p6 p6/test/run_p6.py p6/P6-02_비서_공개함수.sql $P7_F $P705_F
# P7 은 마지막 단계라 뒷 단계가 없다 — 앞 단계를 모두 깐 DB 에서 그대로 돌리고(P7-05 는 시험이 직접 적용), 끝나고 INT-03.
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F $P5_F $P6_F
P7_CAPTURE=$W/cap_p7.json python3 "$WH/p7/test/run_p7.py" > "$W/p7.txt" 2>&1; sub "V p7 (R1S · P1~P6 위, P7-05 포함)" "$W/p7.txt" $?
int03 "V p7-9 P7 시험 뒤 INT-03 FAIL 없음(P7-05 후)" "· P7 · P7-05$"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; apply $R1S_F $P1_F $P2_F $P3_F $P4_F $P5_F $P6_F
P7_BRIDGE=0 P7_CAPTURE=$W/cap_p7_nobridge.json python3 "$WH/p7/test/run_p7.py" > "$W/p7nb.txt" 2>&1; sub "V p7nb (R1S · P1~P6 위, P7-05 없이)" "$W/p7nb.txt" $?
int03 "V p7nb-9 P7 시험 뒤 INT-03 FAIL 없음(P7-05 전)" "P6 · P7$"

echo "== VI. V 의 실제 응답을 앱(INT_APP_SRC, 지금 기준 PR #59) parser · 서비스에 넣어 대조"
if [ -n "$APP" ] && [ -d "$APP/apps/workhub/src" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  app(){ local st=$1 env=$2 caps=$3 extra=${4:-}
    need "$ESB" "$WH/$st/test/app_contract_$st.ts" --bundle --platform=node --format=esm --log-level=warning \
         --alias:@daedong/shared="$WH/r1s/test/shared_stub.ts" --alias:${st}app="$APP/apps/workhub/src" --outfile="$W/app_$st.mjs"
    env $extra $env=$caps node "$W/app_$st.mjs" > "$W/app_$st$extra.txt" 2>&1; sub "VI app_contract_$st $extra" "$W/app_$st$extra.txt" $?; }
  app r1s R1S_CAPTURE "$W/cap_r1s_fresh.json,$W/cap_r1s_legacy.json"
  app p1 P1_CAPTURE "$W/cap_p1.json"; app p2 P2_CAPTURE "$W/cap_p2.json"; app p3 P3_CAPTURE "$W/cap_p3.json"
  app p4 P4_CAPTURE "$W/cap_p4.json"; app p5 P5_CAPTURE "$W/cap_p5.json"; app p6 P6_CAPTURE "$W/cap_p6.json"
  app p7 P7_CAPTURE "$W/cap_p7.json"; app p7 P7_CAPTURE "$W/cap_p7_nobridge.json" P7_BRIDGE=0
else
  ng "VI 앱 대조 — INT_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
