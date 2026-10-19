#!/bin/bash
# P6 전체 검증: 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · P6 시험(R1+P1+P2+P4+P5 위 / R1+R1S+P1~P5 위) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P6_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P6_APP_SRC  apps/main/api/workhub-ai/_assistant.py 와 apps/workhub/src/assistant/server.ts 가 있는 checkout(PR #48 브랜치).
#               없으면 실제 서버 코드 시험(III·IV)과 앱 대조(V)는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); P1=$(cd "$HERE/../../p1" && pwd); P2=$(cd "$HERE/../../p2" && pwd); P3=$(cd "$HERE/../../p3" && pwd)
P4=$(cd "$HERE/../../p4" && pwd); P5=$(cd "$HERE/../../p5" && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p6; mkdir -p "$W"
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
TABLES="'p6_installs','assistant_policies','assistant_threads','assistant_requests','assistant_request_sources','assistant_exchanges','assistant_proposals','assistant_task_requests'"
nop6(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ($TABLES)")" = 0 ]; }
nop6fn(){ [ "$(val "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'workhub\_ai\_%'")" = 0 ]; }
p1(){ need q -qf "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -qf "$P1/P1-02_학교관리_공개함수.sql" >/dev/null; }
p2(){ need q -qf "$P2/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -qf "$P2/P2-02_일정일괄_협업_공개함수.sql" >/dev/null; }
p3(){ need q -qf "$P3/P3-01_메시지_알림_모델.sql" >/dev/null; need q -qf "$P3/P3-02_메시지_공개함수_Storage.sql" >/dev/null; }
p4(){ need q -qf "$P4/P4-01_자료_문서_모델.sql" >/dev/null; need q -qf "$P4/P4-02_자료_문서_공개함수_Storage.sql" >/dev/null; }
p5(){ need q -qf "$P5/P5-01_수업학생_모델.sql" >/dev/null; need q -qf "$P5/P5-02_수업학생_공개함수.sql" >/dev/null; }
p6(){ need q -qf "$S/P6-01_비서_모델.sql" >/dev/null; need q -qf "$S/P6-02_비서_공개함수.sql" >/dev/null; }
APP=${P6_APP_SRC:-}
FILL='s/"<[^"]*>"/"x"/g'

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2
refuse "I1 P4 없이 P6-01 → 멈춤" "P4-01·02(2026-10-16.1, 학교 자료·문서함)를 먼저 적용해 주세요" q -f "$S/P6-01_비서_모델.sql"
nop6 && ok "I2 멈춘 P6-01 은 표를 남기지 않음" || ng I2
p4
refuse "I3 P5 없이 P6-01 → 멈춤" "P5-01·02(2026-10-16.1, 수업·학생)를 먼저 적용해 주세요" q -f "$S/P6-01_비서_모델.sql"
p5
refuse "I4 P6-01 전에 P6-02 → 멈춤" "P6-01(2026-10-16.1)을 먼저 적용해 주세요" q -f "$S/P6-02_비서_공개함수.sql"
refuse "I5 P6-01 전에 P6-04 → 멈춤" "P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P6-04_비서활성화_설정_양식.sql")"
refuse "I6 P6-01 전에 P6-05 → 멈춤" "P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P6-05_비서요청_관리확인_양식.sql")"
need q -qc "create function public.workhub_ai_prepare(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I7 같은 이름 함수가 이미 있으면 P6-01 이 멈춤" "같은 이름의 표·함수가 이미 있습니다" q -f "$S/P6-01_비서_모델.sql"
nop6 && ok "I8 멈춘 P6-01 은 표를 남기지 않음(이름 충돌)" || ng I8
need q -qc "drop function public.workhub_ai_prepare(text)" >/dev/null
need q -qf "$S/P6-01_비서_모델.sql" >/dev/null
need q -qc "create function public.workhub_ai_thread_get(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I9 같은 이름 공개 함수가 이미 있으면 P6-02 가 멈춤" "같은 이름의 함수(workhub_ai_*)가 이미 있습니다" q -f "$S/P6-02_비서_공개함수.sql"
need q -qc "drop function public.workhub_ai_thread_get(text)" >/dev/null
nop6fn && ok "I10 멈춘 P6-02 는 공개 함수를 남기지 않음" || ng I10
refuse "I11 P6-02 전에 P6-04 → 멈춤" "P6-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P6-04_비서활성화_설정_양식.sql")"
need q -qf "$S/P6-02_비서_공개함수.sql" >/dev/null
refuse "I12 P6-01 다시 실행 → 멈춤" "P6-01 이 이미 적용되었습니다" q -f "$S/P6-01_비서_모델.sql"
refuse "I13 P6-02 다시 실행 → 멈춤" "P6-02 가 이미 적용되었습니다" q -f "$S/P6-02_비서_공개함수.sql"
refuse "I14 빈칸이 남은 P6-04 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P6-04_비서활성화_설정_양식.sql"
refuse "I15 숫자 칸을 문자로 채운 P6-04 → 멈춤" "는 1~200자입니다" q -c "$(sed "$FILL" "$S/P6-04_비서활성화_설정_양식.sql" | sed 's/"approval_ref": "x"/"approval_ref": ""/')"
refuse "I16 숫자 칸을 따옴표로 채운 P6-04 → 멈춤" "1 이상의 정수입니다" q -c "$(sed "$FILL" "$S/P6-04_비서활성화_설정_양식.sql" | sed 's/"allowed_members": "x"/"allowed_members": "all_members"/; s/"model": "x"/"model": "m1"/')"
refuse "I17 빈칸이 남은 P6-05 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P6-05_비서요청_관리확인_양식.sql"
[ "$(val "select count(*) from workhub.module_activations where module='assistant'")" = 0 ] && [ "$(val "select count(*) from workhub.assistant_policies")" = 0 ] \
  && ok "I18 멈춘 P6-04 는 활성화·설정 판을 남기지 않음" || ng I18
out=$(q -At -F'|' -f "$S/P6-03_사후점검.sql" 2>&1)
if [ "$(grep -c '^P6-03-' <<<"$out")" = 10 ] && ! grep -q '|FAIL|' <<<"$out" && grep -q "(활성화 없음)" <<<"$out"; then ok "I19 비활성 설치 뒤 P6-03 FAIL 없음 · 활성화 없음"; else ng "I19 P6-03 -- $(grep -v '|ok|' <<<"$out" | head -3 | tr '\n' ' ')"; fi

echo "== II. 비활성 설치(P1~P6-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3; p4; p5; p6
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (P1~P6 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. P6 시험(R1 + P1 + P2 + P4 + P5 위 — P3·R1S 없음) — PR #48 실제 서버 코드 + 가짜 모델 응답기"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p4; p5
P6_APP_SRC=$APP P6_CAPTURE=$W/cap_p6.json python3 "$T/run_p6.py" > "$W/p6_log.txt" 2>&1; sub "III run_p6.py" "$W/p6_log.txt" $?

echo "== IV. P6 시험(R1 + R1S-01·02 + P1 + P2 + P3 + P4 + P5 위 — 앞 PR 을 모두 먼저 적용한 운영 순서)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qf "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -qf "$R1S/R1S-02_공개함수_권한.sql" >/dev/null; p1; p2; p3; p4; p5
P6_APP_SRC=$APP python3 "$T/run_p6.py" > "$W/p6_full_log.txt" 2>&1; sub "IV run_p6.py (R1S·P3 위)" "$W/p6_full_log.txt" $?

echo "== V. 앱(PR #48) 비서 연결(createAssistantServer · createAssistantHttp)·parser 로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/assistant/server.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p6.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p6app="$APP/apps/workhub/src" --outfile="$W/app_contract_p6.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P6_CAPTURE=$W/cap_p6.json node "$W/app_contract_p6.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_p6" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — P6_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
