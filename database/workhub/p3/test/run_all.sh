#!/bin/bash
# P3 전체 검증: 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · P3 시험(R1+P1+P2 위 / R1+R1S+P1+P2 위) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P3_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P3_APP_SRC  apps/workhub/src/messaging/files.ts 와 apps/main/api/messages/_message_hwpx.py 가 있는 checkout(PR #48 브랜치).
#               없으면 wrapper 시험(O 일부)과 앱 대조는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); P1=$(cd "$HERE/../../p1" && pwd); P2=$(cd "$HERE/../../p2" && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p3; mkdir -p "$W"
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
nop3(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ('p3_installs','messaging_policies','message_threads','messages','message_files','notifications')")" = 0 ]; }
nop3fn(){ [ "$(val "select count(*) from pg_proc where pronamespace='public'::regnamespace and (proname like 'workhub\_messag%' or proname='workhub_inbox_list')")" = 0 ] \
          && [ "$(val "select count(*) from storage.buckets where id='workhub-message-files'")" = 0 ]; }
base(){ need q -qf "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -qf "$P1/P1-02_학교관리_공개함수.sql" >/dev/null
        need q -qf "$P2/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -qf "$P2/P2-02_일정일괄_협업_공개함수.sql" >/dev/null; }
APP=${P3_APP_SRC:-}
FILL='s/"<[^"]*>"/"x"/g'

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qf "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -qf "$P1/P1-02_학교관리_공개함수.sql" >/dev/null
refuse "I1 P2 없이 P3-01 → 멈춤" "P2-01·02(2026-10-16.1)를 먼저 적용해 주세요" q -f "$S/P3-01_메시지_알림_모델.sql"
nop3 && ok "I2 멈춘 P3-01 은 표를 남기지 않음" || ng I2
need q -qf "$P2/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -qf "$P2/P2-02_일정일괄_협업_공개함수.sql" >/dev/null
refuse "I3 P3-01 전에 P3-02 → 멈춤" "P3-01(2026-10-16.1)을 먼저 실행해 주세요" q -f "$S/P3-02_메시지_공개함수_Storage.sql"
refuse "I4 P3-01 전에 P3-04 → 멈춤" "P3-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P3-04_메시지활성화_양식.sql")"
refuse "I5 P3-01 전에 P3-05 → 멈춤" "P3-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P3-05_첨부활성화_양식.sql")"
need q -qc "create function public.workhub_message_threads(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I6 같은 이름 함수가 이미 있으면 P3-01 이 멈춤" "같은 이름의 표·함수가 이미 있습니다" q -f "$S/P3-01_메시지_알림_모델.sql"
nop3 && ok "I7 멈춘 P3-01 은 표를 남기지 않음(이름 충돌)" || ng I7
need q -qc "drop function public.workhub_message_threads(text)" >/dev/null
need q -qf "$S/P3-01_메시지_알림_모델.sql" >/dev/null
need q -qc "insert into storage.buckets(id, name, public) values ('workhub-message-files', 'workhub-message-files', true)" >/dev/null
refuse "I8 같은 이름 버킷(공개)이 이미 있으면 P3-02 가 멈춤" "workhub-message-files 버킷 또는 workhub_message 이름의 Storage 정책이 이미 있습니다" q -f "$S/P3-02_메시지_공개함수_Storage.sql"
[ "$(val "select count(*) from pg_proc where pronamespace='public'::regnamespace and (proname like 'workhub\_messag%' or proname='workhub_inbox_list')")" = 0 ] \
  && [ "$(val "select count(*) from pg_policy where polname like 'workhub\_message\_files\_%'")" = 0 ] && ok "I9 멈춘 P3-02 는 공개 함수·Storage 정책을 남기지 않음" || ng I9
need q -qc "delete from storage.buckets where id='workhub-message-files'" >/dev/null
need q -qc "alter table storage.objects disable row level security" >/dev/null
refuse "I10 storage.objects RLS 가 꺼져 있으면 P3-02 가 멈춤" "storage.objects 의 RLS 가 꺼져 있습니다" q -f "$S/P3-02_메시지_공개함수_Storage.sql"
nop3fn && ok "I11 멈춘 P3-02 는 버킷·공개 함수를 남기지 않음" || ng I11

echo "== II. 비활성 설치(P1·P2·P3-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; base
need q -qf "$S/P3-01_메시지_알림_모델.sql" >/dev/null; need q -qf "$S/P3-02_메시지_공개함수_Storage.sql" >/dev/null
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (P1·P2·P3 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. P3 시험(R1 + P1 + P2 위)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; base
P3_CAPTURE=$W/cap_p3.json P3_APP_SRC="$APP" python3 "$T/run_p3.py" > "$W/p3_log.txt" 2>&1; sub "III run_p3.py" "$W/p3_log.txt" $?

echo "== IV. P3 시험(R1 + R1S-01·02 + P1 + P2 위 — PR #47·#49·#50 을 먼저 적용한 운영 순서)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qf "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -qf "$R1S/R1S-02_공개함수_권한.sql" >/dev/null; base
P3_APP_SRC="$APP" python3 "$T/run_p3.py" > "$W/p3_r1s_log.txt" 2>&1; sub "IV run_p3.py (R1S 위)" "$W/p3_r1s_log.txt" $?

echo "== V. 앱(PR #48) 메시지·첨부 어댑터·parser·확인 API 연결로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/messaging/files.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p3.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p3app="$APP/apps/workhub/src" --outfile="$W/app_contract_p3.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P3_CAPTURE=$W/cap_p3.json node "$W/app_contract_p3.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_p3" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — P3_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
