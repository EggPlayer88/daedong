#!/bin/bash
# R0 전체 검증: 빈 구조 DB · 기존 자료 DB · 거부 · 호환 함수 · 앱 검증 함수 · 되돌림.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·입력·빌드)가 실패하면 2 로 끝난다.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> bash run_all.sh      (README 참고)
set -uo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
T=$R0_TEST_DIR; S=$R0_SQL_DIR; IN=$R0_WORK/inputs
PASS=0; FAIL=0
ok(){ PASS=$((PASS+1)); echo "PASS $1"; }
ng(){ FAIL=$((FAIL+1)); echo "FAIL $1"; }
need(){ "$@" || { echo "중단: 준비 단계 실패 → $*" >&2; exit 2; }; }
q(){ r0_psql -U postgres -d r0 "$@"; }
qa(){ r0_psql -U supabase_admin -d r0 "$@"; }
# 설치 묶음(여러 파일을 이어서 실행하는 시험용)
install12(){ q -f "$S/R0-01_B01_기반.sql" && q -f "$S/R0-02_B02_일정업무.sql"; }
install123(){ q -f "$S/R0-01_B01_기반.sql" >/dev/null && q -f "$S/R0-02_B02_일정업무.sql" >/dev/null && q -f "$IN/R0-03_filled.sql"; }
# 거부를 기대하는 시험: psql 이 SQL 오류(-f 는 종료 코드 3, -c 는 1)로 멈추고 그 메시지가 기대한 문구여야 통과.
# 성공(0)·연결 실패(2)·기대와 다른 오류 문구(파일 없음 포함)는 FAIL 이다.
refuse(){ local name=$1 pat=$2 out rc; shift 2
  out=$("$@" 2>&1); rc=$?
  if { [ "$rc" = 3 ] || [ "$rc" = 1 ]; } && grep -qF -- "$pat" <<<"$out" && grep -q "ERROR:" <<<"$out"; then ok "$name"; else ng "$name  -- exit $rc: $(tail -n 2 <<<"$out" | tr '\n' ' ')"; fi; }
# 성공을 기대하는 시험: 종료 코드 0 이고 결과에서 패턴에 맞는 행 수가 want 와 같아야 통과.
rows(){ local name=$1 want=$2 pat=$3 out rc n; shift 3
  out=$("$@" 2>&1); rc=$?; n=$(grep -cE -- "$pat" <<<"$out")
  if [ "$rc" = 0 ] && [ "$n" = "$want" ]; then ok "$name"; else ng "$name  -- exit $rc, 맞는 행 $n/$want: $(tail -n 2 <<<"$out" | tr '\n' ' ')"; fi; }
same(){ if diff -q "$2" "$3" >/dev/null; then ok "$1"; else ng "$1  -- $(diff "$2" "$3" | head -n 4 | tr '\n' ' ')"; fi; }
val(){ q -Atc "$1"; }
prep(){ need bash "$T/reset.sh" "$1" >/dev/null; }
# 하위 시험(Python·Node)의 PASS/FAIL 을 합산. 도구가 비정상 종료했는데 FAIL 줄이 없으면 그것도 FAIL 로 센다.
sub(){ local name=$1 log=$2 rc=$3 p f
  sed 's/^/  /' "$log"
  p=$(grep -c '^PASS' "$log"); f=$(grep -c '^FAIL' "$log")
  PASS=$((PASS+p)); FAIL=$((FAIL+f))
  if [ "$rc" != 0 ] && [ "$f" = 0 ]; then ng "$name 실행 실패(exit $rc)"; fi
  if [ "$p" = 0 ]; then ng "$name 통과한 시험이 0개"; fi; }

echo "== 준비: 시험 입력 생성 · 앱 검증 도구 빌드"
need mkdir -p "$IN"
need python3 -c 'import psycopg2'
need python3 "$T/gen_inputs.py" "$S/R0-03_학교초기설정.sql" "$IN"
[ -x "$R0_REPO/node_modules/.bin/esbuild" ] && [ -d "$R0_REPO/node_modules/pg" ] || { echo "중단: 저장소 루트에서 npm ci 를 먼저 실행하세요 (esbuild·pg)" >&2; exit 2; }
need "$R0_REPO/node_modules/.bin/esbuild" "$T/app_contract.ts" --bundle --platform=node --format=cjs --external:pg --log-level=warning --outfile="$R0_WORK/app_contract.cjs"

echo "== I. 설치 (기존 Supabase 구조가 없는 DB)"
prep bare
refuse "I1 기존 회원 구조 없으면 R0-01 시작 전 멈춤" "R0 중단: 기존 회원 구조" q -f "$S/R0-01_B01_기반.sql"
[ "$(val "select count(*) from pg_namespace where nspname like 'workhub%'")" = 0 ] && ok "I2 멈춘 뒤 아무것도 남지 않음" || ng I2

echo "== II. 설치 (기존 앱 구조 있음, 자료 0건 = 빈 DB)"
prep schema
need q -f "$S/R0-00_전후지문.sql" -o "$R0_WORK/fp_e1.txt"
refuse "II1 R0-02 를 먼저 실행하면 멈춤" "R0 중단" q -f "$S/R0-02_B02_일정업무.sql"
rows "II2 R0-01 검증 7행 모두 ok" 7 '^ B01-[0-9] .*\| ok ' q -f "$S/R0-01_B01_기반.sql"
rows "II3 R0-02 검증 5행 모두 ok" 5 '^ B02-[0-9] .*\| ok ' q -f "$S/R0-02_B02_일정업무.sql"
refuse "II4 입력 칸이 비면 초기 설정 멈춤" "입력 칸(<...>)을 모두 채워" q -f "$S/R0-03_학교초기설정.sql"
refuse "II5 회원이 없으면 초기 설정 멈춤(회원을 만들지 않음)" "찾지 못했습니다" q -f "$IN/R0-03_filled.sql"
[ "$(val "select (select count(*) from workhub.schools)+(select count(*) from workhub.accounts)+(select count(*) from workhub.audit_events)")" = 0 ] && ok "II6 멈춘 초기 설정은 아무것도 쓰지 않음" || ng II6
need q -f "$S/R0-00_전후지문.sql" -o "$R0_WORK/fp_e2.txt"
same "II7 기존 구조 지문 전후 동일" "$R0_WORK/fp_e1.txt" "$R0_WORK/fp_e2.txt"

echo "== III. 설치 (기존 자료 DB: 회원·제출·파일)"
prep legacy
need qa -f "$T/snapshot.sql" -o "$R0_WORK/snap_b.txt"
need q -f "$S/R0-00_전후지문.sql" -o "$R0_WORK/fp_l1.txt"
rows "III1 R0-01·R0-02 적용" 12 '^ B0[12]-[0-9] .*\| ok ' install12
refuse "III2 일반 교사를 첫 관리자로 지정하면 멈춤" "승인된 superadmin" q -f "$IN/x_teacher.sql"
refuse "III3 승인 대기 superadmin 을 첫 관리자로 지정하면 멈춤" "승인된 superadmin" q -f "$IN/x_pending.sql"
refuse "III4 학년도 날짜가 거꾸로면 멈춤" "학년도 마지막 날" q -f "$IN/x_baddate.sql"
rows "III5 초기 설정 확인 S-1~S-8 모두 true" 8 '^ S-[0-9].*\| t$' q -f "$IN/R0-03_filled.sql"
refuse "III6 R0-01 다시 실행하면 멈춤" "이미 있습니다" q -f "$S/R0-01_B01_기반.sql"
refuse "III7 R0-03 다시 실행하면 멈춤" "이미 초기 설정" q -f "$IN/R0-03_filled.sql"
need q -f "$S/R0-00_전후지문.sql" -o "$R0_WORK/fp_l2.txt"
same "III8 기존 구조 지문 전후 동일" "$R0_WORK/fp_l1.txt" "$R0_WORK/fp_l2.txt"
need qa -f "$T/snapshot.sql" -o "$R0_WORK/snap_a.txt"
same "III9 기존 회원·Auth·제출·Storage 목록 자료(행 수·해시) 동일(snapshot.sql 범위)" "$R0_WORK/snap_b.txt" "$R0_WORK/snap_a.txt"
refuse "III10 연결된 관리자의 Auth 계정은 지워지지 않음(RESTRICT)" accounts_auth_user_id_fkey qa -c "delete from auth.users where id='00000000-0000-0000-0000-000000000001'"

echo "== IV. 정상·거부 시험 (호환 함수)"
python3 "$T/run_tests.py" > "$R0_WORK/rpc_log.txt" 2>&1; sub "IV run_tests.py" "$R0_WORK/rpc_log.txt" $?
echo "== V. 앱 검증 함수로 실제 응답 확인"
NODE_PATH="$R0_REPO/node_modules" node "$R0_WORK/app_contract.cjs" > "$R0_WORK/app_log.txt" 2>&1; sub "V app_contract" "$R0_WORK/app_log.txt" $?

echo "== VI. 되돌림"
nsc(){ val "select count(*) from pg_namespace where nspname like 'workhub%'"; }
need qa -qc "create view public.r0_later_view as select id from workhub.events"
refuse "VI0 업무실 밖 객체(뷰)가 업무실을 참조하면 R0-90 이 지우기 전에 멈춤" "업무실 밖의 객체가 업무실을 참조" q -f "$S/R0-90_되돌림.sql"
[ "$(nsc)" = 2 ] && [ "$(val "select count(*) from pg_views where viewname='r0_later_view'")" = 1 ] && ok "VI0b 멈춘 되돌림은 아무것도 지우지 않음" || ng VI0b
need qa -qc "drop view public.r0_later_view; create table workhub.later_batch(id int)"
refuse "VI0c R0 이후에 생긴 표가 있으면 R0-90 이 멈춤(R0 전용)" "R0 이후에 생긴 표" q -f "$S/R0-90_되돌림.sql"
need qa -qc "drop table workhub.later_batch"
# 바깥(public) 표의 DEFAULT·저장 생성열·RLS 정책이 업무실 함수를 참조하는 경우: 각각 지우기 전에 멈추고 바깥 표는 그대로
ext_state(){ qa -Atc "select coalesce((select string_agg(column_name||'='||coalesce(column_default,'')||'/'||is_generated, ';' order by ordinal_position) from information_schema.columns where table_schema='public' and table_name='r0_ext'),'')
  ||'|'||coalesce((select string_agg(policyname, ',') from pg_policies where schemaname='public' and tablename='r0_ext'),'')
  ||'|'||coalesce((select count(*)::text from public.r0_ext),'none')"; }
for c in "DEFAULT:create table public.r0_ext(id int, v text default workhub_private.js_trim(' d '))" \
         "저장 생성열:create table public.r0_ext(id int, v text generated always as (workhub_private.js_trim(' g ')) stored)" \
         "RLS 정책:create table public.r0_ext(id int); alter table public.r0_ext enable row level security; create policy r0_ext_pol on public.r0_ext using (workhub_private.js_trim(' y ') = 'y')"; do
  label=${c%%:*}; ddl=${c#*:}
  need qa -qc "$ddl; insert into public.r0_ext(id) values (1),(2)"
  before=$(ext_state) || { echo "중단: 바깥 표 상태를 읽지 못함" >&2; exit 2; }
  case "$before" in *"|2") ;; *) echo "중단: 바깥 표 상태가 예상과 다름: $before" >&2; exit 2 ;; esac
  refuse "VI0d 바깥 표의 $label 가 업무실 함수를 참조하면 R0-90 이 지우기 전에 멈춤" "업무실 밖의 객체가 업무실을 참조" q -f "$S/R0-90_되돌림.sql"
  after=$(ext_state)
  [ "$before" = "$after" ] && [ "$(nsc)" = 2 ] && ok "VI0e 멈춘 뒤 바깥 표의 $label·자료와 업무실이 그대로" || ng "VI0e $label  -- $before → $after"
  need qa -qc "drop table public.r0_ext"
done
rows "VI1 R0-90 실행, 확인 행 true" 1 '^ t +\| t +\| t$' q -f "$S/R0-90_되돌림.sql"
need qa -qc "delete from public.users where id in ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010'); delete from auth.users where id::text in ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010')"
need qa -f "$T/snapshot.sql" -o "$R0_WORK/snap_r.txt"
same "VI2 되돌림 뒤 snapshot.sql 범위(구조, 회원·Auth·제출·Storage 목록 행 수·해시)가 설치 전과 같음(시험용 추가 회원 제거 후)" "$R0_WORK/snap_b.txt" "$R0_WORK/snap_r.txt"
rows "VI3 되돌림 뒤 다시 설치 가능" 8 '^ S-[0-9].*\| t$' install123

echo "== SN. 자료 비교(snapshot.sql)가 실제 변경을 잡는지"
need qa -f "$T/snapshot.sql" -o "$R0_WORK/snap_s0.txt"
sn(){ local name=$1; shift; need qa -qc "$*"; need qa -f "$T/snapshot.sql" -o "$R0_WORK/snap_s1.txt"
  if diff -q "$R0_WORK/snap_s0.txt" "$R0_WORK/snap_s1.txt" >/dev/null; then ng "$name  -- 비교 결과가 같음(변경을 못 잡음)"; else ok "$name"; fi
  cp "$R0_WORK/snap_s1.txt" "$R0_WORK/snap_s0.txt"; }
sn "SN1 Storage 파일 목록 경로 변경을 잡음" "update storage.objects set name = name || '.moved' where name = (select min(name) from storage.objects)"
sn "SN2 Storage 파일 목록 한 행 삭제를 잡음" "delete from storage.objects where name = (select min(name) from storage.objects)"
sn "SN3 제출 한 건 삭제를 잡음" "delete from public.doc_submissions where ctid = (select ctid from public.doc_submissions limit 1)"

echo "== 합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ] || exit 1
