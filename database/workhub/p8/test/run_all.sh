#!/bin/bash
# P8 전체 검증: 선행 조건 · 원본 판 · 기존 공식 담당 인계 거부(부분 설치 포함) · P8 시험(P7-05 보강 있음 / 없음) · PR #60 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P8_APP_SRC=<PR #60 checkout> bash run_all.sh      (README 참고)
#   P8_APP_SRC  apps/workhub/src/teaching/relations-adapter.ts 가 있는 checkout(PR #60). 없으면 앱 대조(IV)를 FAIL 로 센다.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); WH=$(cd "$HERE/../.." && pwd); W=$R0_WORK/p8; mkdir -p "$W"
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 -v ON_ERROR_STOP=1 "$@"; }
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
ap(){ need q -qf "$WH/$1" >/dev/null; }
base(){ need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; }
p1(){ ap p1/P1-01_학교관리_모델.sql; ap p1/P1-02_학교관리_공개함수.sql; }
p2(){ ap p2/P2-01_일정일괄_협업_모델.sql; ap p2/P2-02_일정일괄_협업_공개함수.sql; }
p3(){ ap p3/P3-01_메시지_알림_모델.sql; ap p3/P3-02_메시지_공개함수_Storage.sql; }
p5(){ ap p5/P5-01_수업학생_모델.sql; ap p5/P5-02_수업학생_공개함수.sql; }
p7(){ ap p7/P7-01_운영_전환_모델.sql; ap p7/P7-02_운영_전환_공개함수.sql; }
FILL='s/"<승인한 관리자[^"]*>"/"00000000-0000-0000-0000-000000000001"/; s/"<승인 근거>"/"시험"/; s/"app_deploy_ref": "<[^"]*>"/"app_deploy_ref": "시험"/; s/\["<[^"]*>"\]/["teaching_relations"]/'
n8(){ val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='workhub_private' and c.relname='p8_installs'"; }
b8(){ val "select count(*) from workhub_private.p8_installs where batch='$1'"; }
post(){ local out; out=$(q -At -F'|' -f "$S/P8-05_사후점검.sql" 2>&1)
  if [ "$(grep -c '^P8-05-' <<<"$out")" = 10 ] && ! grep -q '|FAIL|' <<<"$out" && grep -q "$2" <<<"$out"; then ok "$1"; else ng "$1 -- $(grep -v '|ok|' <<<"$out" | head -3 | tr '\n' ' ')"; fi; }

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
base
refuse "I1 P1 없이 P8-01 → 멈춤" "P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요" q -f "$S/P8-01_학년도_시작연도.sql"
p1; p2; p3
refuse "I2 P7 없이 P8-01 → 멈춤" "P7-01·02(2026-10-16.1, 업무 전환)를 먼저 적용해 주세요" q -f "$S/P8-01_학년도_시작연도.sql"
[ "$(n8)" = 0 ] && ok "I3 멈춘 P8-01 은 설치 기록 표를 남기지 않음" || ng I3
p7
refuse "I4 P8-01 전에 P8-02 → 멈춤" "P8-01(2026-10-16.1)을 먼저 적용해 주세요" q -f "$S/P8-02_협업_알림.sql"
refuse "I5 P8-01 전에 P8-03 → 멈춤" "P8-01(2026-10-16.1)을 먼저 적용해 주세요" q -f "$S/P8-03_업무인계_관리자확인.sql"
refuse "I6 P8-01 전에 P8-04 → 멈춤" "P8-01(2026-10-16.1)을 먼저 적용해 주세요" q -f "$S/P8-04_수업_담당수강_변경.sql"
refuse "I7 P8-01 전에 P8-06 → 멈춤" "P8-01(2026-10-16.1)이 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P8-06_정책모듈활성화_양식.sql")"
post "I8 설치 전 P8-05 FAIL 없음(전부 미적용)" "|info|"
ap p8/P8-01_학년도_시작연도.sql
refuse "I9 P5 없이 P8-04 → 멈춤" "P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요" q -f "$S/P8-04_수업_담당수강_변경.sql"
[ "$(b8 P8-04)" = 0 ] && [ -z "$(val "select to_regclass('workhub.teaching_relation_ends')")" ] && ok "I10 멈춘 P8-04 는 설치 기록 · 표를 남기지 않음" || ng I10
# P7 의 관리자 확인 없는 흐름으로 이미 생긴 공식 담당 인계가 있으면 P8-03 은 덮어쓰지 않는다(시험용 가짜 행은 시험 서버의 superuser 가 복제 모드로 넣고 지운다)
need r0_psql -U supabase_admin -d r0 -v ON_ERROR_STOP=1 -qc "set session_replication_role=replica; insert into workhub.transition_items values ('fake-rec','fake-school',1,'duty','duty-x',1,'가짜')" >/dev/null
refuse "I11 공식 담당 인계 기록이 이미 있으면 P8-03 → 멈춤" "공식 담당이 든 인계 기록이 이미 있습니다" q -f "$S/P8-03_업무인계_관리자확인.sql"
need r0_psql -U supabase_admin -d r0 -v ON_ERROR_STOP=1 -qc "set session_replication_role=replica; delete from workhub.transition_items where record_id='fake-rec'" >/dev/null
[ "$(b8 P8-03)" = 0 ] && ok "I12 멈춘 P8-03 은 설치 기록을 남기지 않음" || ng I12
ap p8/P8-02_협업_알림.sql; ap p8/P8-03_업무인계_관리자확인.sql
refuse "I13 P8-04 없이 teaching_relations 켜기(P8-06) → 멈춤" "teaching_relations 모듈의 SQL(P8-04)이 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P8-06_정책모듈활성화_양식.sql")"
refuse "I14 빈칸이 남은 P8-06 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P8-06_정책모듈활성화_양식.sql"
[ "$(val "select count(*) from workhub.module_activations where module in ('cooperation_notices','duty_admin_review','teaching_relations')")" = 0 ] \
  && ok "I15 멈춘 P8-06 은 켜기 기록을 남기지 않음" || ng I15
post "I16 부분 설치(P8-01~03, P8-04 없음) 뒤 P8-05 FAIL 없음" "|ok|"

echo "== II. 바꿀 함수가 원본 판이 아니면 덮어쓰지 않음"
base; p1; p2; p3; p7
need q -qc "do \$\$ declare d text; begin d := pg_get_functiondef('workhub_private.p7_plan_eval(workhub_private.actor_context,jsonb)'::regprocedure);
  execute regexp_replace(d, 'BEGIN', E'BEGIN\n  -- 누군가 고친 판', ''); end \$\$" >/dev/null
refuse "II1 p7_plan_eval 이 고쳐져 있으면 P8-01 → 멈춤" "원본 판(2026-10-16.1)이 아닙니다" q -f "$S/P8-01_학년도_시작연도.sql"
[ "$(n8)" = 0 ] && ok "II2 멈춘 P8-01 은 아무것도 남기지 않음" || ng II2
base; p1; p2; p3; p5; p7; ap p8/P8-01_학년도_시작연도.sql
need q -qc "do \$\$ declare d text; begin d := pg_get_functiondef('workhub_private.p5_catalog'::regproc);
  execute regexp_replace(d, 'BEGIN', E'BEGIN\n  -- 누군가 고친 판', ''); end \$\$" >/dev/null
refuse "II3 p5_catalog 이 고쳐져 있으면 P8-04 → 멈춤" "원본 판(2026-10-16.1)이 아닙니다" q -f "$S/P8-04_수업_담당수강_변경.sql"
[ "$(b8 P8-04)" = 0 ] && ok "II4 멈춘 P8-04 는 설치 기록을 남기지 않음" || ng II4

fresh(){ base; p1; p2; p3; ap p4/P4-01_자료_문서_모델.sql; ap p4/P4-02_자료_문서_공개함수_Storage.sql; p5; p7; }
echo "== III. P8 시험(R1+P1~P5+P7 위, P7-05 보강 있음)"
fresh
(cd "$T" && P8_CAPTURE="$W/cap_bridge.json" python3 run_p8.py) >"$W/p8_bridge.log" 2>&1; sub "III P8 시험(보강 있음)" "$W/p8_bridge.log" $?
echo "== III-b. P8 시험(P7-05 보강 없이)"
fresh
(cd "$T" && P8_BRIDGE=0 P8_CAPTURE="$W/cap_nobridge.json" python3 run_p8.py) >"$W/p8_nobridge.log" 2>&1; sub "III-b P8 시험(보강 없음)" "$W/p8_nobridge.log" $?

echo "== IV. PR #60 앱 대조(실제 응답 → 앱 서비스 · parser)"
APP=${P8_APP_SRC:-}
if [ -z "$APP" ] || [ ! -f "$APP/apps/workhub/src/teaching/relations-adapter.ts" ]; then
  ng "IV P8_APP_SRC(PR #60 checkout)가 없어 앱 대조를 하지 못함"
else
  ESB=${ESBUILD:-$(cd "$WH/../.." && pwd)/node_modules/.bin/esbuild}
  need "$ESB" "$T/app_contract_p8.ts" --bundle --platform=node --format=esm --log-level=warning \
    --alias:@daedong/shared="$WH/r1s/test/shared_stub.ts" --alias:p8app="$APP/apps/workhub/src" --outfile="$W/app_p8.mjs"
  for c in bridge nobridge; do
    P8_CAPTURE="$W/cap_$c.json" node "$W/app_p8.mjs" >"$W/app_$c.log" 2>&1; sub "IV 앱 대조($c)" "$W/app_$c.log" $?
  done
fi

echo "합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ]
