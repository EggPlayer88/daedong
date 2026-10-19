#!/bin/bash
# P5 전체 검증: 선행 조건 거부 · 비활성 설치 뒤 R1 시험 전체 · P5 시험(R1+P1+P2 위 / R1+R1S+P1+P2+P3+P4 위) · 앱 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> P5_APP_SRC=<PR #48 checkout> bash run_all.sh      (README 참고)
#   P5_APP_SRC  apps/workhub/src/teaching/adapter.ts 가 있는 checkout(PR #48 브랜치). 없으면 앱 대조는 FAIL 로 센다(통과로 세지 않는다).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); P1=$(cd "$HERE/../../p1" && pwd); P2=$(cd "$HERE/../../p2" && pwd); P3=$(cd "$HERE/../../p3" && pwd)
P4=$(cd "$HERE/../../p4" && pwd); R1S=$(cd "$HERE/../../r1s" && pwd); W=$R0_WORK/p5; mkdir -p "$W"
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
TABLES="'p5_installs','teaching_policies','teaching_requests','courses','course_assignments','students','student_enrollments','course_memberships','activity_imports','activity_items','activity_item_revisions','activity_item_omissions','teaching_records','teaching_record_revisions','rubrics','rubric_revisions','assessments','assessment_revisions'"
nop5(){ [ "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('workhub','workhub_private') and c.relname in ($TABLES)")" = 0 ]; }
nop5fn(){ [ "$(val "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname like 'workhub\_teaching\_%'")" = 0 ]; }
p1(){ need q -qf "$P1/P1-01_학교관리_모델.sql" >/dev/null; need q -qf "$P1/P1-02_학교관리_공개함수.sql" >/dev/null; }
p2(){ need q -qf "$P2/P2-01_일정일괄_협업_모델.sql" >/dev/null; need q -qf "$P2/P2-02_일정일괄_협업_공개함수.sql" >/dev/null; }
p3(){ need q -qf "$P3/P3-01_메시지_알림_모델.sql" >/dev/null; need q -qf "$P3/P3-02_메시지_공개함수_Storage.sql" >/dev/null; }
p4(){ need q -qf "$P4/P4-01_자료_문서_모델.sql" >/dev/null; need q -qf "$P4/P4-02_자료_문서_공개함수_Storage.sql" >/dev/null; }
p5(){ need q -qf "$S/P5-01_수업학생_모델.sql" >/dev/null; need q -qf "$S/P5-02_수업학생_공개함수.sql" >/dev/null; }
APP=${P5_APP_SRC:-}
FILL='s/"<[^"]*>"/"x"/g'

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1
refuse "I1 P2 없이 P5-01 → 멈춤" "P2-01·02(2026-10-16.1)를 먼저 적용해 주세요" q -f "$S/P5-01_수업학생_모델.sql"
nop5 && ok "I2 멈춘 P5-01 은 표를 남기지 않음" || ng I2
p2
refuse "I3 P5-01 전에 P5-02 → 멈춤" "P5-01(2026-10-16.1)을 먼저 실행해 주세요" q -f "$S/P5-02_수업학생_공개함수.sql"
refuse "I4 P5-01 전에 P5-04 → 멈춤" "P5-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P5-04_수업모듈활성화_양식.sql")"
need q -qc "create function public.workhub_teaching_catalog(p text) returns int language sql as 'select 1'" >/dev/null
refuse "I5 같은 이름 함수가 이미 있으면 P5-01 이 멈춤" "같은 이름의 표·함수가 이미 있습니다" q -f "$S/P5-01_수업학생_모델.sql"
nop5 && ok "I6 멈춘 P5-01 은 표를 남기지 않음(이름 충돌)" || ng I6
need q -qc "drop function public.workhub_teaching_catalog(text)" >/dev/null
need q -qf "$S/P5-01_수업학생_모델.sql" >/dev/null
refuse "I7 P5-02 전에 P5-04 → 멈춤" "P5-01·02(2026-10-16.1)가 적용되어 있지 않습니다" q -c "$(sed "$FILL" "$S/P5-04_수업모듈활성화_양식.sql")"
need q -qc "create function public.workhub_teaching_course(p text, c text) returns int language sql as 'select 1'" >/dev/null
refuse "I8 같은 이름 공개 함수가 이미 있으면 P5-02 가 멈춤" "같은 이름의 공개 함수가 이미 있습니다" q -f "$S/P5-02_수업학생_공개함수.sql"
need q -qc "drop function public.workhub_teaching_course(text, text)" >/dev/null
nop5fn && ok "I9 멈춘 P5-02 는 공개 함수를 남기지 않음" || ng I9
need q -qf "$S/P5-02_수업학생_공개함수.sql" >/dev/null
refuse "I10 P5-01 다시 실행 → 멈춤" "P5-01 이 이미 적용되었습니다" q -f "$S/P5-01_수업학생_모델.sql"
refuse "I11 P5-02 다시 실행 → 멈춤" "P5-02 가 이미 적용되었습니다" q -f "$S/P5-02_수업학생_공개함수.sql"
refuse "I12 빈칸이 남은 P5-04 → 멈춤" "입력 칸(<...>)을 모두 채워 주세요" q -f "$S/P5-04_수업모듈활성화_양식.sql"
refuse "I13 승인 근거 없는 P5-04 → 멈춤" "승인 근거는 1~200자" q -c "$(sed 's/"approver_user_id": "[^"]*"/"approver_user_id": "x"/; s/"approval_ref": "[^"]*"/"approval_ref": ""/; s/"counseling_scope": "[^"]*"/"counseling_scope": "off"/' "$S/P5-04_수업모듈활성화_양식.sql")"
refuse "I14 상담 범위가 틀린 P5-04 → 멈춤" "counseling_scope 는" q -c "$(sed 's/"approver_user_id": "[^"]*"/"approver_user_id": "x"/; s/"approval_ref": "[^"]*"/"approval_ref": "r"/; s/"counseling_scope": "[^"]*"/"counseling_scope": "all"/' "$S/P5-04_수업모듈활성화_양식.sql")"
[ "$(val "select count(*) from workhub.module_activations where module='teaching'")" = 0 ] && ok "I15 멈춘 P5-04 는 활성화를 남기지 않음" || ng I15
out=$(q -At -F'|' -f "$S/P5-03_사후점검.sql" 2>&1)
if [ "$(grep -c '^P5-03-' <<<"$out")" = 11 ] && ! grep -q '|FAIL|' <<<"$out" && grep -q "(활성화 없음)" <<<"$out"; then ok "I16 비활성 설치 뒤 P5-03 FAIL 없음 · 활성화 없음"; else ng "I16 P5-03 -- $(grep -v '|ok|' <<<"$out" | head -3 | tr '\n' ' ')"; fi

echo "== II. 비활성 설치(P1·P2·P3·P4·P5-01·02, 활성화 0) 뒤 R1 시험 전체가 그대로 통과"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2; p3; p4; p5
python3 "$R1_TEST_DIR/run_r1.py" > "$W/r1_log.txt" 2>&1; sub "II run_r1.py (P1~P5 비활성 설치 위)" "$W/r1_log.txt" $?

echo "== III. P5 시험(R1 + P1 + P2 위)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null; p1; p2
P5_CAPTURE=$W/cap_p5.json python3 "$T/run_p5.py" > "$W/p5_log.txt" 2>&1; sub "III run_p5.py" "$W/p5_log.txt" $?

echo "== IV. P5 시험(R1 + R1S-01·02 + P1 + P2 + P3 + P4 위 — 앞 PR 을 모두 먼저 적용한 운영 순서, 문서함 학생 기록 근거 연결까지)"
need bash "$R1_TEST_DIR/setup.sh" r1 >/dev/null
need q -qf "$R1S/R1S-01_모델_쓰기게이트.sql" >/dev/null; need q -qf "$R1S/R1S-02_공개함수_권한.sql" >/dev/null; p1; p2; p3; p4
python3 "$T/run_p5.py" > "$W/p5_full_log.txt" 2>&1; sub "IV run_p5.py (R1S·P3·P4 위)" "$W/p5_full_log.txt" $?

echo "== V. 앱(PR #48) 수업 어댑터·parser·명령 검사로 실제 응답 확인"
if [ -n "$APP" ] && [ -f "$APP/apps/workhub/src/teaching/adapter.ts" ]; then
  ESB="${ESBUILD:-$R0_REPO/node_modules/.bin/esbuild}"; [ -x "$ESB" ] || ESB="$(command -v esbuild || true)"
  [ -x "$ESB" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하거나 ESBUILD=<esbuild 경로> 를 주세요" >&2; exit 2; }
  need "$ESB" "$T/app_contract_p5.ts" --bundle --platform=node --format=esm --log-level=warning \
       --alias:@daedong/shared="$R1S/test/shared_stub.ts" --alias:p5app="$APP/apps/workhub/src" --outfile="$W/app_contract_p5.mjs"
  echo "  앱 소스: $APP ($(git -C "$APP" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  P5_CAPTURE=$W/cap_p5.json node "$W/app_contract_p5.mjs" > "$W/app_log.txt" 2>&1; sub "V app_contract_p5" "$W/app_log.txt" $?
else
  ng "V 앱 대조 — P5_APP_SRC 에 PR #48 checkout 을 지정하지 않음"
fi

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
