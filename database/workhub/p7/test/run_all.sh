#!/bin/bash
# P7 전체 검증: 선행 조건 거부 · 비활성 설치(보강 전/후) 뒤 R1 시험 전체 · P7 시험(R1+P1~P3 위 / R1+R1S+P1~P5 위 / 보강 없이) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P7_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P7_APP_SRC  apps/workhub/src/collections/operations.ts 가 있는 checkout(PR #48 브랜치). 없으면 앱 대조(V)를 FAIL 로 센다.
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); P1=$(cd "$HERE/../../p1" && pwd); P2=$(cd "$HERE/../../p2" && pwd); P3=$(cd "$HERE/../../p3" && pwd)
P4=$(cd "$HERE/../../p4" && pwd); P5=$(cd "$HERE/../../p5" && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p7; mkdir -p "$W"
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
TABLES="'p7_installs','operation_requests','collection_operations','collection_operation_history','collection_reminders','transition_records','transition_items','transition_history'"
PUB="'workhub_collection_operations_get','workhub_collection_operations_mutate','workhub_home_overview','workhub_school_transition_list','workhub_school_transition_preview','workhub_school_transition_mutate'"
nop7(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ($TABLES)")" = 0 ]; }
nop7fn(){ [ "$(val "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname in ($PUB)")" = 0 ]; }
p1(){ need q -qf "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -qf "$P1/P1-02_학교관리_공개함수.sql" >/dev/null; }
p2(){ need q -qf "$P2/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -qf "$P2/P2-02_일정일괄_협업_공개함수.sql" >/dev/null; }
p3(){ need q -qf "$P3/P3-01_메시지_알림_모델.sql" >/dev/null; need q -qf "$P3/P3-02_메시지_공개함수_Storage.sql" >/dev/null; }
p4(){ need q -qf "$P4/P4-01_자료_문서_모델.sql" >/dev/null; need q -qf "$P4/P4-02_자료_문서_공개함수_Storage.sql" >/dev/null; }
p5(){ need q -qf "$P5/P5-01_수업학생_모델.sql" >/dev/null; need q -qf "$P5/P5-02_수업학생_공개함수.sql" >/dev/null; }
p7(){ need q -qf "$S/P7-01_운영_전환_모델.sql" >/dev/null; need q -qf "$S/P7-02_운영_전환_공개함수.sql" >/dev/null; }
bridge(){ need q -qc "$(sed 's/"<승인한 사람[^"]*>"/"시험"/; s/"<승인 근거[^"]*>"/"시험(합성 값)"/' "$S/P7-05_R1_P2_보강_별도승인.sql")" >/dev/null; }
APP=${P7_APP_SRC:-}
FILL='s/"<[^"]*>"/"x"/g'
p03(){ local out; out=$(q -At -F'|' -f "$S/P7-03_사후점검.sql" 2>&1)
  if [ "$(grep -c '^P7-03-' <<<"$out")" = 12 ] && ! grep -q '|FAIL|' <<<"$out" && grep -q "$2" <<<"$out"; then ok "$1"; else ng "$1 -- $(grep -v '|ok|' <<<"$out" | head -3 | tr '\n' ' ')"; fi; }

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
refuse "I1 P1 없이 P7-01 → 멈춤" "P1-01·02(2026-10-16.1, 학교 관리)를 먼저 적용해 주세요" q -f "$S/P7-01_운영_전환_모델.sql"
p1
refuse "I2 P2 없이 P7-01 → 멈춤" "P2-01·02(2026-10-16.1, 일정·협업)를 먼저 적용해 주세요" q -f "$S/P7-01_운영_전환_모델.sql"
p2
refuse "I3 P3 없이 P7-01 → 멈춤" "P3-01·02(2026-10-16.1, 메신저·알림)를 먼저 적용해 주세요" q -f "$S/P7-01_운영_전환_모델.sql"
nop7 && ok "I4 멈춘 P7-01 은 표를 남기지 않음" || ng I4
p3
refuse "I5 P7-01 전에 P7-02 → 멈춤" "P7-01(2026-10-16.1)을 먼저 적용해 주세요" q -f "$S/P7-02_운영_전환_공개함수.sql"
refuse "I6 P7-01 전에 P7-04 → 멈춤" "P7-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P7-04_모듈활성화_양식.sql")"
refuse "I7 P7-01 전에 P7-05 → 멈춤" "P7-01·02(2026-10-16.1)를 먼저 적용해 주세요" q -c "$(sed "$FILL" "$S/P7-05_R1_P2_보강_별도승인.sql")"
need q -qc "create table workhub.transition_records(x int)" >/dev/null
refuse "I8 같은 이름 표가 이미 있으면 P7-01 이 멈춤" "같은 이름의 표·함수가 이미 있습니다" q -f "$S/P7-01_운영_전환_모델.sql"
need q -qc "drop table workhub.transition_records" >/dev/null
nop7 && ok "I9 멈춘 P7-01 은 표를 남기지 않음(이름 충돌)" || ng I9
need q -qf "$S/P7-01_운영_전환_모델.sql" >/dev/null
refuse "I10 P7-02 전에 P7-04 → 멈춤" "P7-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P7-04_모듈활성화_양식.sql")"
refuse "I11 P7-02 전에 P7-05 → 멈춤" "P7-01·02(2026-10-16.1)를 먼저 적용해 주세요" q -c "$(sed "$FILL" "$S/P7-05_R1_P2_보강_별도승인.sql")"
need q -qc "create function public.workhub_home_overview(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I12 같은 이름 공개 함수가 이미 있으면 P7-02 가 멈춤" "같은 이름의 공개 함수가 이미 있습니다" q -f "$S/P7-02_운영_전환_공개함수.sql"
need q -qc "drop function public.workhub_home_overview(text)" >/dev/null
nop7fn && ok "I13 멈춘 P7-02 는 공개 함수를 남기지 않음" || ng I13
need q -qf "$S/P7-02_운영_전환_공개함수.sql" >/dev/null
refuse "I14 P7-01 다시 실행 → 멈춤" "P7-01 이 이미 적용되었습니다" q -f "$S/P7-01_운영_전환_모델.sql"
refuse "I15 P7-02 다시 실행 → 멈춤" "P7-02 가 이미 적용되었습니다" q -f "$S/P7-02_운영_전환_공개함수.sql"
refuse "I16 빈칸이 남은 P7-04 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P7-04_모듈활성화_양식.sql"
refuse "I17 모르는 모듈 이름 P7-04 → 멈춤" "modules 는" q -c "$(sed "$FILL" "$S/P7-04_모듈활성화_양식.sql")"
refuse "I18 빈칸이 남은 P7-05 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P7-05_R1_P2_보강_별도승인.sql"
[ "$(val "select count(*) from workhub.module_activations where module in ('collection_ops','home','transitions','duty_handover')")" = 0 ] \
  && [ "$(val "select count(*) from workhub_private.p7_installs where batch='P7-05'")" = 0 ] \
  && ok "I19 멈춘 P7-04 · P7-05 는 활성화 · 보강 기록을 남기지 않음" || ng I19
p03 "I20 비활성 설치 뒤 P7-03 FAIL 없음 · 활성화 없음 · 보강 미적용" "(활성화 없음)"
bridge
p03 "I21 P7-05 뒤 P7-03 FAIL 없음 · 보강 적용됨" "적용됨("
refuse "I22 P7-05 다시 실행 → 멈춤" "이미 적용되었습니다" q -c "$(sed 's/"<승인한 사람[^"]*>"/"시험"/; s/"<승인 근거[^"]*>"/"시험"/' "$S/P7-05_R1_P2_보강_별도승인.sql")"

echo "== II. 비활성 설치(P1~P3 + P7-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과 — 보강 전 · 보강 후"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3; p7
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II-a run_r1.py (P7 비활성 설치 위)" "$W/r1_log.txt" $?
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3; p7; bridge
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1b_log.txt" 2>&1; sub "II-b run_r1.py (P7 + 보강 P7-05 위)" "$W/r1b_log.txt" $?

echo "== III. P7 시험(R1 + P1 + P2 + P3 위 — R1S · P4 · P5 없음, 보강 포함)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3
P7_CAPTURE=$W/cap_p7.json python3 "$T/run_p7.py" > "$W/p7_log.txt" 2>&1; sub "III run_p7.py" "$W/p7_log.txt" $?

echo "== IV. P7 시험(R1 + R1S-01·02 + P1~P5 위 — 앞 PR 을 모두 먼저 적용한 운영 순서) · 보강 없이"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qf "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -qf "$R1S/R1S-02_공개함수_권한.sql" >/dev/null; p1; p2; p3; p4; p5
python3 "$T/run_p7.py" > "$W/p7_full_log.txt" 2>&1; sub "IV-a run_p7.py (R1S·P5 위)" "$W/p7_full_log.txt" $?
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3
P7_BRIDGE=0 P7_CAPTURE=$W/cap_p7_nobridge.json python3 "$T/run_p7.py" > "$W/p7_nobridge_log.txt" 2>&1; sub "IV-b run_p7.py (보강 P7-05 없이)" "$W/p7_nobridge_log.txt" $?

echo "== V. 앱(PR #48) 서비스(createCollectionOperations · createHomeService · createTransitionService)·parser 로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/collections/operations.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p7.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p7app="$APP/apps/workhub/src" --outfile="$W/app_contract_p7.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P7_CAPTURE=$W/cap_p7.json node "$W/app_contract_p7.mjs" > "$W/app_log.txt" 2>&1; sub "V-a app_contract_p7 (보강 포함)" "$W/app_log.txt" $?
  P7_BRIDGE=0 P7_CAPTURE=$W/cap_p7_nobridge.json node "$W/app_contract_p7.mjs" > "$W/app_nb_log.txt" 2>&1; sub "V-b app_contract_p7 (보강 없이)" "$W/app_nb_log.txt" $?
else
  ng "V 앱 대조 — P7_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
