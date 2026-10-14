#!/bin/bash
# R0 전체 검증: 빈 구조 DB · 기존 자료 DB · 거부 · 되돌림. 결과는 표준 출력.
. /tmp/claude-0/b01/test/env.sh
T=/tmp/claude-0/b01/test; S=/var/tmp/r0pg
ok(){ echo "PASS $1"; }; ng(){ echo "FAIL $1"; }
q(){ $PSQL -U postgres -d r0 "$@"; }
prep(){ bash $T/reset.sh $1 >/dev/null 2>&1; cp /tmp/claude-0/b01/sql/*.sql $S/; chmod 644 $S/*.sql; }

echo "== I. 설치 (기존 Supabase 구조가 없는 DB)"
prep bare
q -f $S/R0-01_B01_기반.sql 2>&1 | grep -q "R0 중단: 기존 회원 구조" && ok "I1 기존 회원 구조 없으면 R0-01 시작 전 멈춤" || ng I1
[ "$(q -Atc "select count(*) from pg_namespace where nspname like 'workhub%'")" = 0 ] && ok "I2 멈춘 뒤 아무것도 남지 않음" || ng I2

echo "== II. 설치 (기존 앱 구조 있음, 자료 0건 = 빈 DB)"
prep schema
q -f $S/R0-00_전후지문.sql > $T/fp_e1.txt
q -f $S/R0-02_B02_일정업무.sql 2>&1 | grep -q "R0 중단" && ok "II1 R0-02 를 먼저 실행하면 멈춤" || ng II1
[ "$(q -f $S/R0-01_B01_기반.sql 2>&1 | grep -cE '^ B01-[0-9] .*\| ok ')" = 7 ] && ok "II2 R0-01 검증 7행 모두 ok" || ng "II2 R0-01 검증 행"
[ "$(q -f $S/R0-02_B02_일정업무.sql 2>&1 | grep -cE '^ B02-[0-9] .*\| ok ')" = 5 ] && ok "II3 R0-02 검증 5행 모두 ok" || ng "II3 R0-02 검증 행"
q -f $S/R0-03_학교초기설정.sql 2>&1 | grep -q "입력 칸(<...>)을 모두 채워" && ok "II4 입력 칸이 비면 초기 설정 멈춤" || ng II4
q -f $S/R0-03_filled.sql 2>&1 | grep -q "찾지 못했습니다" && ok "II5 회원이 없으면 초기 설정 멈춤(회원을 만들지 않음)" || ng II5
[ "$(q -Atc "select (select count(*) from workhub.schools)+(select count(*) from workhub.accounts)+(select count(*) from workhub.audit_events)")" = 0 ] && ok "II6 멈춘 초기 설정은 아무것도 쓰지 않음" || ng II6
q -f $S/R0-00_전후지문.sql > $T/fp_e2.txt; diff -q $T/fp_e1.txt $T/fp_e2.txt >/dev/null && ok "II7 기존 구조 지문 전후 동일" || ng II7

echo "== III. 설치 (기존 자료 DB: 회원·제출·파일)"
prep legacy
$PSQL -U supabase_admin -d r0 -f $T/snapshot.sql > $T/snap_b.txt
q -f $S/R0-00_전후지문.sql > $T/fp_l1.txt
for f in teacher pending baddate; do :; done
sed 's/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000002/' $S/R0-03_filled.sql > $S/x_teacher.sql
sed 's/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000005/' $S/R0-03_filled.sql > $S/x_pending.sql
sed 's/"2027-02-28"/"2026-02-28"/' $S/R0-03_filled.sql > $S/x_baddate.sql; chmod 644 $S/x_*.sql
q -f $S/R0-01_B01_기반.sql >/dev/null && q -f $S/R0-02_B02_일정업무.sql >/dev/null && ok "III1 R0-01·R0-02 적용" || ng III1
q -f $S/x_teacher.sql 2>&1 | grep -q "승인된 superadmin" && ok "III2 일반 교사를 첫 관리자로 지정하면 멈춤" || ng III2
q -f $S/x_pending.sql 2>&1 | grep -q "승인된 superadmin" && ok "III3 승인 대기 superadmin 을 첫 관리자로 지정하면 멈춤" || ng III3
q -f $S/x_baddate.sql 2>&1 | grep -q "학년도 마지막 날" && ok "III4 학년도 날짜가 거꾸로면 멈춤" || ng III4
[ "$(q -f $S/R0-03_filled.sql 2>&1 | grep -cE '^ S-[0-9].*\| t$')" = 8 ] && ok "III5 초기 설정 확인 S-1~S-8 모두 true" || ng "III5 초기 설정 확인"
q -f $S/R0-01_B01_기반.sql 2>&1 | grep -q "이미 있습니다" && ok "III6 R0-01 다시 실행하면 멈춤" || ng III6
q -f $S/R0-03_filled.sql 2>&1 | grep -q "이미 초기 설정" && ok "III7 R0-03 다시 실행하면 멈춤" || ng III7
q -f $S/R0-00_전후지문.sql > $T/fp_l2.txt; diff -q $T/fp_l1.txt $T/fp_l2.txt >/dev/null && ok "III8 기존 구조 지문 전후 동일" || ng III8
$PSQL -U supabase_admin -d r0 -f $T/snapshot.sql > $T/snap_a.txt; diff -q $T/snap_b.txt $T/snap_a.txt >/dev/null && ok "III9 기존 회원·Auth 자료 해시까지 동일" || ng III9
$PSQL -U supabase_admin -d r0 -c "delete from auth.users where id='00000000-0000-0000-0000-000000000001'" 2>&1 | grep -q accounts_auth_user_id_fkey && ok "III10 연결된 관리자의 Auth 계정은 지워지지 않음(RESTRICT)" || ng III10

echo "== IV. 정상·거부 시험 (호환 함수)"
python3 $T/run_tests.py | sed 's/^/  /'
echo "== V. 앱 검증 함수로 실제 응답 확인"
(cd /tmp/claude-0/b01/tsrun && node app_contract.cjs | sed 's/^/  /')

echo "== VI. 되돌림"
q -f $S/R0-90_되돌림.sql 2>&1 | grep -q "| t " && ok "VI1 R0-90 실행, 확인 행 true" || ng VI1
$PSQL -U supabase_admin -d r0 -qc "delete from public.users where id in ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010'); delete from auth.users where id::text in ('00000000-0000-0000-0000-000000000007','00000000-0000-0000-0000-000000000008','00000000-0000-0000-0000-000000000009','00000000-0000-0000-0000-000000000010')"
$PSQL -U supabase_admin -d r0 -f $T/snapshot.sql > $T/snap_r.txt; diff -q $T/snap_b.txt $T/snap_r.txt >/dev/null && ok "VI2 되돌림 뒤 public·auth·storage 가 설치 전과 완전히 같음(시험용 추가 회원 제거 후)" || ng VI2
q -f $S/R0-01_B01_기반.sql >/dev/null 2>&1 && q -f $S/R0-02_B02_일정업무.sql >/dev/null 2>&1 && [ "$(q -f $S/R0-03_filled.sql 2>&1 | grep -cE '^ S-[0-9].*\| t$')" = 8 ] && ok "VI3 되돌림 뒤 다시 설치 가능" || ng VI3
