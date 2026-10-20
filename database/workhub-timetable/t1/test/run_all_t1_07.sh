#!/bin/bash
# T1-07(준비 대상 학기 고르기) 검증: II run_t1_07.py(설치 순서 · 원본 확인 · 지문 · 계약 · 동시성 · 사용 뒤 점검) · V T1-09 목록 재생성 대조.
# T1 자체 시험(run_all.sh)은 T1-07 을 설치하지 않으므로 그대로 따로 돌린다. 하나라도 실패하면 종료 코드 1, 준비 단계가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> bash run_all_t1_07.sh
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../../workhub/r1/test/env.sh"
T=$HERE; WH=$(cd "$HERE/../../../workhub" && pwd); W=$R0_WORK/t1_07; mkdir -p "$W"
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

echo "== II. T1-07 시험(R1 + P1~P5 + P7 + P8 위에서 T1-01~03 · T1-07 을 직접 설치)"
(cd "$T" && T1_07_CAPTURE="$W/samples.json" python3 run_t1_07.py) >"$W/t1_07.log" 2>&1; sub "II T1-07 시험" "$W/t1_07.log" $?

echo "== V. T1-09 목록 = 지금 SQL 파일로 다시 만든 목록(R0 만 있는 시험 DB 에서 1~8단계 · T1 · T1-07 을 차례로 적용)"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
python3 "$T/gen_t1_09.py" check >"$W/gen.log" 2>&1; sub "V gen_t1_09 check" "$W/gen.log" $?

echo "합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ]
