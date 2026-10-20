#!/bin/bash
# T2(시간표 운영) 검증: II run_t2.py(설치 순서 · 원본 확인 · 계약 · 권한 · 동시성 · 사용 뒤 점검) · V T2-07 목록 재생성 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계가 실패하면 2.
# III 은 PR #72 앱의 실제 parser 에 II 의 응답을 넣어 본다(T2_APP_SRC = PR #72 checkout, ESBUILD = esbuild 경로, react 가 필요하면 REACT_DIR).
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> T2_APP_SRC=<PR #72 checkout> ESBUILD=<esbuild> bash run_all.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../../workhub/r1/test/env.sh"
T=$HERE; WH=$(cd "$HERE/../../../workhub" && pwd); W=$R0_WORK/t2; mkdir -p "$W"
PASS=0; FAIL=0
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 -v ON_ERROR_STOP=1 "$@"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
sub(){ local name=$1 log=$2 rc=$3 p f
  sed 's/^/  /' "$log"
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then ng "$name 실행 실패(exit $rc)"; fi
  if [ "$p" = 0 ]; then ng "$name 통과한 시험이 0개"; fi; }
ap(){ need q -qf "$WH/$1" >/dev/null; }

echo "== 준비"
need python3 -c 'import psycopg2'
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
for f in p1/P1-01_학교관리_모델.sql p1/P1-02_학교관리_공개함수.sql p2/P2-01_일정일괄_협업_모델.sql p2/P2-02_일정일괄_협업_공개함수.sql \
         p3/P3-01_메시지_알림_모델.sql p3/P3-02_메시지_공개함수_Storage.sql p4/P4-01_자료_문서_모델.sql p4/P4-02_자료_문서_공개함수_Storage.sql \
         p5/P5-01_수업학생_모델.sql p5/P5-02_수업학생_공개함수.sql p7/P7-01_운영_전환_모델.sql p7/P7-02_운영_전환_공개함수.sql \
         p8/P8-01_학년도_시작연도.sql p8/P8-02_협업_알림.sql p8/P8-03_업무인계_관리자확인.sql p8/P8-04_수업_담당수강_변경.sql; do ap "$f"; done

echo "== II. T2 시험(R1 + P1~P5 + P7 + P8 위에서 T1-01~03 · T1-07 · T2-01~06 · T2-02 를 직접 설치)"
(cd "$T" && T2_CAPTURE="$W/samples.json" python3 run_t2.py) >"$W/t2.log" 2>&1; sub "II T2 시험" "$W/t2.log" $?

echo "== III. 앱 대조(PR #72 parser 에 II 의 실제 응답)"
APP=${T2_APP_SRC:-}; ESB=${ESBUILD:-${APP:+$APP/node_modules/.bin/esbuild}}
if [ -z "$APP" ] || [ ! -d "$APP/apps/workhub/src/timetable" ] || [ -z "$ESB" ] || [ ! -x "$ESB" ]; then
  ng "III T2_APP_SRC(PR #72 checkout)와 ESBUILD 가 없어 앱 대조를 하지 못함"
else
  need "$ESB" "$T/app_contract_t2.ts" --bundle --platform=node --format=esm --log-level=warning \
    --alias:t2app="$APP/apps/workhub/src" ${REACT_DIR:+--alias:react="$REACT_DIR"} --outfile="$W/app_t2.mjs"
  T2_CAPTURE="$W/samples.json" node "$W/app_t2.mjs" >"$W/app.log" 2>&1; sub "III 앱 대조" "$W/app.log" $?
fi

echo "== V. T2-07 목록 = 지금 SQL 파일로 다시 만든 목록(R0 만 있는 시험 DB 에서 1~8단계 · T1 · T1-07 · T2 를 차례로 적용)"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
python3 "$T/gen_t2_07.py" check >"$W/gen.log" 2>&1; sub "V gen_t2_07 check" "$W/gen.log" $?

echo "합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ]
