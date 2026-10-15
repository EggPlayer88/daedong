#!/bin/bash
# R1 전체 검증: 선행 조건 거부 · 설치 · 전후 지문 · 정상/거부 시나리오 · 앱 검증 함수 · 중지/재개 · 제거 전 점검.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> [R1_APP_SRC=<앱 소스 checkout>] bash run_all.sh      (README 참고)
#   R1_APP_SRC  apps/workhub/src/collections/validation.ts 가 있는 저장소 checkout(예: PR #35 브랜치).
#               없으면 앱 검증 단계는 "미실행"으로 표시하고 통과로 세지 않는다.
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
T=$R1_TEST_DIR; S=$R1_DIR; W=$R0_WORK/r1; mkdir -p "$W"
PASS=0; FAIL=0; SKIP=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
skip(){ SKIP=$((SKIP+1)); echo "미실행 $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 "$@"; }
qa(){ r0_psql -U supabase_admin -d r0 "$@"; }
val(){ q -Atc "$1"; }
refuse(){ local name=$1 pat=$2 out rc; shift 2
  out=$("$@" 2>&1); rc=$?
  if { [ "$rc" = 3 ] || [ "$rc" = 1 ]; } && grep -qF -- "$pat" <<<"$out" && grep -q "ERROR:" <<<"$out"; then ok "$name"; else ng "$name  -- exit $rc: $(tail -n 2 <<<"$out" | tr '\n' ' ')"; fi; }
rows(){ local name=$1 want=$2 pat=$3 out rc n; shift 3
  out=$("$@" 2>&1); rc=$?; n=$(grep -cE -- "$pat" <<<"$out")
  if [ "$rc" = 0 ] && [ "$n" = "$want" ]; then ok "$name"; else ng "$name  -- exit $rc, 맞는 행 $n/$want: $(tail -n 3 <<<"$out" | tr '\n' ' ')"; fi; }
same(){ if diff -q "$2" "$3" >/dev/null; then ok "$1"; else ng "$1  -- $(diff "$2" "$3" | head -n 4 | tr '\n' ' ')"; fi; }
sub(){ local name=$1 log=$2 rc=$3 p f
  sed 's/^/  /' "$log"
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then ng "$name 실행 실패(exit $rc)"; fi
  if [ "$p" = 0 ]; then ng "$name 통과한 시험이 0개"; fi; }
fp(){ q -At -f "$S/R1-00_사전점검_지문.sql" > "$W/$1_all.txt" && grep '^지문' "$W/$1_all.txt" > "$W/$1.txt"; }
install(){ for f in R1-01_정책_파일_실행.sql R1-02_수합_원본.sql R1-03_공개함수_Storage.sql; do q -f "$S/$f" || return 1; done; }
r0_only(){ need bash "$R0_TEST_DIR/reset.sh" legacy >/dev/null; need qa -f "$T/mock_storage_r1.sql" >/dev/null
  need mkdir -p "$R0_WORK/inputs"; need python3 "$R0_TEST_DIR/gen_inputs.py" "$R0_DIR/R0-03_학교초기설정.sql" "$R0_WORK/inputs" >/dev/null
  need q -f "$R0_DIR/R0-01_B01_기반.sql" >/dev/null; need q -f "$R0_DIR/R0-02_B02_일정업무.sql" >/dev/null; }

echo "== 준비"
need python3 -c 'import psycopg2'

echo "== I. 선행 조건이 맞지 않으면 아무것도 만들지 않고 멈춤"
r0_only
refuse "I1 R0-03(학교 초기 설정) 전이면 R1-01 이 멈춤" "활성 학교가 없습니다" q -f "$S/R1-01_정책_파일_실행.sql"
[ "$(val "select count(*) from pg_class where relname in ('batch_installs','file_objects','policy_versions')")" = 0 ] && ok "I2 멈춘 R1-01 은 표를 남기지 않음" || ng I2
need q -f "$R0_WORK/inputs/R0-03_filled.sql" >/dev/null
refuse "I3 R1-01 전에 R1-02 를 실행하면 멈춤" "R1-01(2026-10-15.1)이 적용되어 있지 않습니다" q -f "$S/R1-02_수합_원본.sql"
refuse "I4 R1-02 전에 R1-03 을 실행하면 멈춤" "R1-02(2026-10-15.1)가 적용되어 있지 않습니다" q -f "$S/R1-03_공개함수_Storage.sql"
need qa -qc "insert into storage.buckets(id, name, public) values ('workhub-collection-files', 'workhub-collection-files', false)"
refuse "I5 같은 이름 버킷이 이미 있으면 R1-01 이 멈춤(남의 버킷을 덮지 않음)" "버킷이 이미 있습니다" q -f "$S/R1-01_정책_파일_실행.sql"
need qa -qc "delete from storage.buckets where id = 'workhub-collection-files'"

echo "== II. 설치 (R0 적용 + 기존 회원·제출·파일 자료가 있는 DB)"
rows "II1 R1-00 사전 점검 7행이 ok/info" 7 '^점검\|[^|]*\|(ok|info)\|' q -At -f "$S/R1-00_사전점검_지문.sql"
need fp fp_before
rows "II2 R1-01 검증 5행 ok" 5 '^ R1-01-[0-9] .*\| ok ' q -f "$S/R1-01_정책_파일_실행.sql"
rows "II3 R1-02 검증 4행 ok" 4 '^ R1-02-[0-9] .*\| ok ' q -f "$S/R1-02_수합_원본.sql"
rows "II4 R1-03 검증 6행 ok" 6 '^ R1-03-[0-9] .*\| ok ' q -f "$S/R1-03_공개함수_Storage.sql"
out=$(q -f "$S/R1-04_사후점검.sql" 2>&1); rc=$?
{ [ "$rc" = 0 ] && [ "$(grep -c '^ R1-04-' <<<"$out")" = 14 ] && ! grep -q '| FAIL ' <<<"$out"; } && ok "II5 R1-04 사후 점검 14행, FAIL 없음" || ng "II5 -- $out"
grep -E '^ R1-04-14 .*\| info .*verification_missing' <<<"$out" >/dev/null && ok "II6 SQL 만 적용한 상태는 준비 완료가 아님(verification_missing)" || ng "II6 -- $(grep R1-04-14 <<<"$out")"
refuse "II7 R1-01 다시 실행하면 멈춤" "R1 표가 이미 있습니다" q -f "$S/R1-01_정책_파일_실행.sql"
refuse "II8 R1-02 다시 실행하면 멈춤" "이미 적용되었습니다" q -f "$S/R1-02_수합_원본.sql"
refuse "II9 R1-03 다시 실행하면 멈춤" "이미 적용되었습니다" q -f "$S/R1-03_공개함수_Storage.sql"
need fp fp_after
same "II10 R1-00 지문(기존 구조·R0 구조·R0 자료·기존 자료) 설치 전후 동일" "$W/fp_before.txt" "$W/fp_after.txt"
rows "II11 R1-82 제거 전 점검은 읽기만 하고 외부 의존 0" 0 '^의존' q -At -f "$S/R1-82_제거전점검.sql"
need fp fp_after2
same "II12 R1-04·R1-82 실행 뒤에도 지문 동일(읽기 전용)" "$W/fp_after.txt" "$W/fp_after2.txt"

echo "== FP. 지문이 실제 변경을 잡는지"
fpchk(){ local name=$1; shift; need qa -qc "$*"; need fp fp_x
  if diff -q "$W/fp_after2.txt" "$W/fp_x.txt" >/dev/null; then ng "$name  -- 지문이 같음(변경을 못 잡음)"; else ok "$name"; fi; cp "$W/fp_x.txt" "$W/fp_after2.txt"; }
fpchk "FP1 기존 회원 한 행 값 변경" "update public.users set name = name || '.' where id = (select min(id) from public.users)"
fpchk "FP2 다른 버킷 Storage 목록 경로 변경" "update storage.objects set name = name || '.moved' where name = (select min(name) from storage.objects)"
fpchk "FP3 R0 자료(학기) 변경" "alter table workhub.terms disable trigger user; update workhub.terms set label = label || '.' where id = (select min(id) from workhub.terms); alter table workhub.terms enable trigger user"
fpchk "FP4 R0 함수 설정 변경" "alter function workhub_private.js_trim(text) set work_mem = '4MB'"
fpchk "FP5 기존 public 정책 추가" "create policy fp_x on public.users for select to authenticated using (false)"

echo "== III. 정상·거부 시나리오 (run_r1.py)"
need bash "$T/setup.sh" r1 >/dev/null
R1_CAPTURE=$W/capture.json python3 "$T/run_r1.py" > "$W/rpc_log.txt" 2>&1; sub "III run_r1.py" "$W/rpc_log.txt" $?

echo "== IV. 앱 검증 함수로 실제 응답 확인"
if [ -n "${R1_APP_SRC:-}" ] && [ -f "$R1_APP_SRC/apps/workhub/src/collections/validation.ts" ]; then
  [ -x "$R0_REPO/node_modules/.bin/esbuild" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하세요 (esbuild)" >&2; exit 2; }
  need "$R0_REPO/node_modules/.bin/esbuild" "$T/app_contract.ts" --bundle --platform=node --format=cjs --log-level=warning \
       --alias:r1app="$R1_APP_SRC/apps/workhub/src" --outfile="$W/app_contract.cjs"
  echo "  앱 소스: $R1_APP_SRC ($(git -C "$R1_APP_SRC" log -1 --format=%h 2>/dev/null || echo '판 모름'))"
  R1_CAPTURE=$W/capture.json node "$W/app_contract.cjs" > "$W/app_log.txt" 2>&1; sub "IV app_contract" "$W/app_log.txt" $?
else
  skip "IV 앱 검증 함수 대조 — R1_APP_SRC 에 앱 소스(PR #35 checkout)를 지정하지 않음"
fi

echo "== V. 중지·재개 양식"
refuse "V1 칸을 채우지 않은 R1-80 은 바꾸지 않고 멈춤" "칸을 채워 주세요" q -f "$S/R1-80_중지.sql"
refuse "V2 열려 있을 때 R1-81 은 멈춤" "이미 열려 있습니다" q -c "$(sed "s/'<사유: 날짜와 이유>'/'시험'/" "$S/R1-81_재개.sql")"
refuse "V3 잘못된 중지 단계는 멈춤" "writes_stopped 또는 all_stopped" q -c "$(sed "s/'<중지 단계: writes_stopped 또는 all_stopped>'/'closed'/; s/'<사유: 날짜와 이유>'/'시험'/" "$S/R1-80_중지.sql")"
[ "$(val "select state from workhub_private.r1_switch")" = open ] && ok "V4 멈춘 양식은 스위치를 바꾸지 않음" || ng V4
refuse "V2b 칸을 채우지 않은 R1-81 은 멈춤" "칸을 채워 주세요" q -f "$S/R1-81_재개.sql"
refuse "V5 중지 기록은 고칠 수 없음" "IMMUTABLE" q -c "update workhub_private.r1_switch_log set reason = 'x'"

echo "== 합계: PASS $PASS · FAIL $FAIL · 미실행 $SKIP"
[ "$FAIL" = 0 ] || exit 1
