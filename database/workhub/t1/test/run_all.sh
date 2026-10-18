#!/bin/bash
# T1 전체 검증: I 선행 조건 · 순서 · 원본 제약 확인(멈추면 아무것도 남기지 않음) · II T1 시험 · III 앱 대조 · IV 앱 검사 함수 무작위 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> T1_APP_SRC=<PR #65·#66 checkout(node_modules 포함)> bash run_all.sh      (README 참고)
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); WH=$(cd "$HERE/../.." && pwd); W=$R0_WORK/t1; mkdir -p "$W"
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
p4(){ ap p4/P4-01_자료_문서_모델.sql; ap p4/P4-02_자료_문서_공개함수_Storage.sql; }
p5(){ ap p5/P5-01_수업학생_모델.sql; ap p5/P5-02_수업학생_공개함수.sql; }
p7(){ ap p7/P7-01_운영_전환_모델.sql; ap p7/P7-02_운영_전환_공개함수.sql; }
p8(){ ap p8/P8-01_학년도_시작연도.sql; ap p8/P8-02_협업_알림.sql; ap p8/P8-03_업무인계_관리자확인.sql; ap p8/P8-04_수업_담당수강_변경.sql; }
FILL='s/"<승인한 관리자[^"]*>"/"00000000-0000-0000-0000-000000000001"/; s/"<승인 근거>"/"시험"/; s/"app_deploy_ref": "<[^"]*>"/"app_deploy_ref": "시험"/'
n1(){ val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where (n.nspname='workhub_private' and c.relname='t1_installs') or (n.nspname='workhub' and c.relname like 'timetable\_%')"; }
b1(){ val "select count(*) from workhub_private.t1_installs where batch='$1'"; }

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건 · 순서가 맞지 않으면 아무것도 만들지 않고 멈춤"
base; p1; p2; p3; p4; p5; p7
refuse "I1 P8 없이 T1-01 → 멈춤" "P8-01 · P8-04(2026-10-16.1)를 먼저 적용해 주세요" q -f "$S/T1-01_편성기반_모델.sql"
[ "$(n1)" = 0 ] && ok "I2 멈춘 T1-01 은 표를 하나도 남기지 않음" || ng I2
refuse "I3 T1-01 전에 T1-02 → 멈춤" "T1-01(2026-10-18.1)을 먼저 적용해 주세요" q -f "$S/T1-02_R0증분_학기기준판_제약.sql"
refuse "I4 T1-01 전에 T1-03 → 멈춤" "T1-01 · T1-02(2026-10-18.1)를 먼저 적용해 주세요" q -f "$S/T1-03_편성기반_공개함수.sql"
refuse "I5 T1-03 전에 T1-05 → 멈춤" "T1-01 · T1-02 · T1-03(2026-10-18.1)이 모두 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/T1-05_시간표활성화_양식.sql")"
p8
ap t1/T1-01_편성기반_모델.sql
refuse "I6 T1-02 전에 T1-03 → 멈춤" "T1-01 · T1-02(2026-10-18.1)를 먼저 적용해 주세요" q -f "$S/T1-03_편성기반_공개함수.sql"
# R0 원본 제약이 바뀌어 있으면 T1-02 는 덮어쓰지 않는다(시험 서버의 superuser 가 제약을 바꿔 둔다)
need r0_psql -U supabase_admin -d r0 -v ON_ERROR_STOP=1 -qc "alter table workhub.terms drop constraint terms_timetable_basis_pending; alter table workhub.terms add constraint terms_timetable_basis_pending check (current_timetable_basis_id is null or true)" >/dev/null
refuse "I7 R0 학기 제약이 원본이 아니면 T1-02 → 멈춤" "R0 원본(CHECK current_timetable_basis_id IS NULL)이 아닙니다" q -f "$S/T1-02_R0증분_학기기준판_제약.sql"
[ "$(b1 T1-02)" = 0 ] && ok "I8 멈춘 T1-02 는 설치 기록을 남기지 않음" || ng I8
post=$(q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1)
[ "$(grep -c '^T1-04-' <<<"$post")" = 10 ] && grep -q '^T1-04-04|.*|FAIL|' <<<"$post" && ok "I9 바뀐 R0 제약은 T1-04 가 FAIL 로 잡음(T1-02 전)" || ng "I9 -- $(grep -v '|ok|\||info|' <<<"$post" | head -3 | tr '\n' ' ')"

echo "== II. T1 시험(R1 + P1~P5 + P7 + P8 위에서 T1 을 직접 설치)"
base; p1; p2; p3; p4; p5; p7; p8
(cd "$T" && T1_CAPTURE="$W/cap.json" python3 run_t1.py) >"$W/t1.log" 2>&1; sub "II T1 시험" "$W/t1.log" $?
# INT-03(1~8단계 통합 사후 점검)은 T1 을 모른다 → 03 · 09 · 10 행만 FAIL 이고, 그 수가 T1-04-10 과 같아야 한다(T1 밖 차이 없음)
int=$(q -At -F'|' -f "$WH/integration/INT-03_통합사후점검.sql" 2>&1); t104=$(q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1 | grep '^T1-04-10|' | cut -d'|' -f4)
nf=$(grep -o '^INT-03-03|[^|]*|FAIL|[0-9]*' <<<"$int" | awk -F'|' '{print $4}'); ntg=$(grep '^INT-03-09|' <<<"$int" | grep -o '목록에 없음 [0-9][0-9]*' | awk '{print $3}')
ncm=$(grep '^INT-03-10|' <<<"$int" | grep -o '빠짐 [0-9][0-9]*' | awk '{print $2}'); nce=$(grep '^INT-03-10|' <<<"$int" | grep -o '목록에 없음 [0-9][0-9]*' | awk '{print $3}')
other=$(grep '|FAIL|' <<<"$int" | grep -v '^INT-03-0[39]|\|^INT-03-10|' | head -3)
if [ -z "$other" ] && [ "$t104" = "함수 $nf · 트리거 $ntg · 빠진 제약 $ncm · 목록에 없는 제약 $nce" ]; then ok "II-b INT-03 의 FAIL 은 03 · 09 · 10 뿐이고 수가 T1-04-10 과 같음($t104)"
else ng "II-b INT-03 차이 -- T1-04-10=$t104 / INT-03 함수 $nf 트리거 $ntg 빠짐 $ncm 추가 $nce / 그 밖 FAIL: $other"; fi

APP=${T1_APP_SRC:-}
ESB=${ESBUILD:-$APP/node_modules/.bin/esbuild}
if [ -z "$APP" ] || [ ! -f "$APP/apps/workhub/src/timetable/preparation.ts" ] || [ ! -x "$ESB" ]; then
  ng "III · IV T1_APP_SRC(PR #65·#66 checkout, node_modules 포함)가 없어 앱 대조를 하지 못함"
else
  echo "== III. 앱 대조(실제 응답 → createTimetableServer · createPreparationServer · parser, setup.v1 기준 parser)"
  need "$ESB" "$T/app_contract_t1.ts" --bundle --platform=node --format=esm --log-level=warning \
    --alias:@daedong/shared="$WH/r1s/test/shared_stub.ts" --alias:t1app="$APP/apps/workhub/src" --outfile="$W/app_t1.mjs"
  T1_CAPTURE="$W/cap.json" node "$W/app_t1.mjs" >"$W/app.log" 2>&1; sub "III 앱 대조" "$W/app.log" $?
  echo "== IV. 앱 검사 함수 ↔ SQL 이식본 무작위 대조(씨앗 3개)"
  need "$ESB" "$T/fuzz_t1.ts" --bundle --platform=node --format=esm --log-level=warning \
    --alias:@daedong/shared="$WH/r1s/test/shared_stub.ts" --alias:t1app="$APP/apps/workhub/src" --alias:t1pkg="$APP/packages/timetable/src" --outfile="$W/fuzz_t1.mjs"
  for seed in 20261018 77 4242; do
    { T1_FUZZ_SEED=$seed T1_FUZZ_N=1500 T1_CAPTURE="$W/cap.json" T1_FUZZ="$W/fuzz.json" node "$W/fuzz_t1.mjs" && T1_FUZZ="$W/fuzz.json" python3 "$T/fuzz_t1.py"; } >"$W/fuzz_$seed.log" 2>&1
    sub "IV 무작위 대조(씨앗 $seed)" "$W/fuzz_$seed.log" $?
  done
fi

echo "합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ]
