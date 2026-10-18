#!/bin/bash
# T1 전체 검증: I 선행 조건 · 순서 · 원본 제약 확인(멈추면 아무것도 남기지 않음) · II T1 시험 + 통합 점검(T1-06 · INT-03) · 보호 트리거 훼손 회귀
#   · III 앱 대조 · IV 앱 검사 함수 무작위 대조 · V T1-06 목록 재생성 대조.
# 하나라도 실패하면 종료 코드 1, 준비 단계(서버·빌드)가 실패하면 2.
# 사용: R0_PG_BIN=<PostgreSQL 17 bin> T1_APP_SRC=<PR #65·#66 checkout(node_modules 포함)> bash run_all.sh      (README 참고)
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
. "$HERE/../../../workhub/r1/test/env.sh"
T=$HERE; S=$(cd "$HERE/.." && pwd); WH=$(cd "$HERE/../../../workhub" && pwd); W=$R0_WORK/t1; mkdir -p "$W"
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
need q -qf "$S/T1-01_편성기반_모델.sql" >/dev/null
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
# T1-06(1~8단계 + T1 통합 사후 점검)은 FAIL 0 이어야 한다. INT-03(1~8단계)은 T1 을 몰라 03 · 09 · 10 행만 FAIL 이고,
# 그 안에서도 "다름"은 0, 트리거 "빠짐" 0, 제약 "빠짐"은 T1-02 가 없앤 R0 학기 제약 1개뿐이어야 한다(기존 객체 차이 = 승인된 교체 하나).
t106(){ q -At -F'|' -f "$S/T1-06_통합사후점검.sql" 2>&1; }
r106=$(t106)
[ "$(grep -c '^T1-06-' <<<"$r106")" = 13 ] && ! grep -q '|FAIL|' <<<"$r106" && grep -q '^T1-06-01|.*· T1-01 · T1-02 · T1-03$' <<<"$r106" \
  && ok "II-b T1-06 통합 사후 점검 13행 FAIL 0(조합 끝 = T1-01 · T1-02 · T1-03)" || ng "II-b T1-06 -- $(grep '|FAIL|' <<<"$r106" | head -3 | tr '\n' ' ')"
int=$(q -At -F'|' -f "$WH/integration/INT-03_통합사후점검.sql" 2>&1)
other=$(grep '|FAIL|' <<<"$int" | grep -v '^INT-03-0[39]|\|^INT-03-10|' | head -3)
i09=$(grep '^INT-03-09|' <<<"$int" | cut -d'|' -f4); i10=$(grep '^INT-03-10|' <<<"$int" | cut -d'|' -f4)
if [ -z "$other" ] && [[ "$i09" == "빠짐 0 · 목록에 없음 7 · 다름 0"* ]] && [[ "$i10" == "빠짐 1 · 목록에 없음 68 · 다름 0 — 빠짐 workhub.terms.terms_timetable_basis_pending"* ]]; then
  ok "II-c INT-03 의 차이 = T1 객체(트리거 7 · 제약 68)와 T1-02 의 학기 제약 교체뿐, '다름' 0"
else ng "II-c INT-03 차이 -- 09: $i09 / 10: $i10 / 그 밖 FAIL: $other"; fi
# 훼손 회귀: 보호 트리거를 끄면 점검이 잡아야 한다(기존 audit_events_immutable · T1 의 timetable_basis_revisions_immutable)
s3(){ q -At -F'|' -f "$S/T1-00_사전점검_지문.sql" 2>&1 | grep '^지문|S3 ' | cut -d'|' -f4; }
su(){ need r0_psql -U supabase_admin -d r0 -v ON_ERROR_STOP=1 -qc "$1" >/dev/null; }
s3a=$(s3)
su "alter table workhub.audit_events disable trigger audit_events_immutable"
r106=$(t106); s3b=$(s3); post=$(q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1)
[ "$s3a" != "$s3b" ] && grep -q '^T1-06-09|[^|]*|FAIL|.*다름 1.*audit_events_immutable' <<<"$r106" \
  && ok "II-d 기존 보호 트리거(audit_events_immutable)를 끄면 T1-00 지문 S3 가 달라지고 T1-06-09 가 FAIL(다름 1)" || ng "II-d -- S3 같음=$([ "$s3a" = "$s3b" ] && echo 예) / $(grep '^T1-06-09|' <<<"$r106")"
su "alter table workhub.audit_events enable trigger audit_events_immutable"
su "alter table workhub.timetable_basis_revisions disable trigger timetable_basis_revisions_immutable"
r106=$(t106); post=$(q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1)
grep -q '^T1-06-09|[^|]*|FAIL|.*timetable_basis_revisions_immutable' <<<"$r106" && grep -q '^T1-04-10|[^|]*|FAIL|.*timetable_basis_revisions_immutable(꺼짐 D)' <<<"$post" \
  && ok "II-e T1 보호 트리거(timetable_basis_revisions_immutable)를 끄면 T1-04-10 · T1-06-09 가 FAIL" || ng "II-e -- $(grep '^T1-04-10|' <<<"$post") / $(grep '^T1-06-09|' <<<"$r106")"
su "alter table workhub.timetable_basis_revisions enable trigger timetable_basis_revisions_immutable"
r106=$(t106); post=$(q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1)
! grep -q '|FAIL|' <<<"$r106" && ! grep -q '|FAIL|' <<<"$post" && [ "$(s3)" = "$s3a" ] && ok "II-f 다시 켜면 T1-04 · T1-06 FAIL 0 · 지문 S3 원래대로" || ng "II-f 복구 뒤 -- $(grep '|FAIL|' <<<"$r106$post" | head -2 | tr '\n' ' ')"
# 훼손 회귀: DML 이 아닌 권한(TRUNCATE · MAINTAIN · 열 단위)만 API 역할에 줘도 T1-04-02 가 잡아야 한다(Codex 재검토 권고 1)
p402(){ q -At -F'|' -f "$S/T1-04_사후점검.sql" 2>&1 | grep '^T1-04-02|'; }
g_ok=1; g_log=""
for g in "TRUNCATE ON workhub.timetable_drafts TO authenticated|timetable_drafts:authenticated TRUNCATE" \
         "MAINTAIN ON workhub.timetable_requests TO service_role|timetable_requests:service_role MAINTAIN" \
         "SELECT (id) ON workhub.timetable_basis_revisions TO anon|timetable_basis_revisions:anon SELECT" \
         "REFERENCES ON workhub_private.t1_installs TO PUBLIC|t1_installs:PUBLIC REFERENCES"; do
  sql=${g%%|*}; want=${g#*|}
  su "grant $sql"; r=$(p402); su "revoke ${sql/ TO / FROM }"
  if [[ "$r" == *"|FAIL|"*"$want"* ]]; then :; else g_ok=0; g_log="$g_log [$sql → $r]"; fi
done
[ $g_ok = 1 ] && [[ "$(p402)" == *"|ok|"* ]] \
  && ok "II-g TRUNCATE · MAINTAIN · 열 단위 SELECT · PUBLIC REFERENCES 를 하나씩 주면 T1-04-02 가 FAIL(권한 이름까지), 거두면 ok" || ng "II-g --$g_log / 복구 뒤 $(p402)"

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

echo "== V. T1-06 목록 = 지금 SQL 파일로 다시 만든 목록(R0 만 있는 시험 DB 에서 1~8단계 · T1 을 차례로 적용)"
need bash "$R1_TEST_DIR/setup.sh" >/dev/null
python3 "$T/gen_t1_int.py" check >"$W/gen.log" 2>&1; sub "V gen_t1_int check" "$W/gen.log" $?

echo "합계: PASS $PASS · FAIL $FAIL"
[ "$FAIL" = 0 ]
