#!/bin/bash
# 시험 서버 초기화: $1 = bare | schema | legacy
#   bare   = Supabase 흉내만 (기존 앱 구조 없음)
#   schema = + migrations/001~007 (자료 0건)
#   legacy = + seed.sql (회원·제출·파일 시험 자료)
# R0_WORK 안의 시험 서버만 지우고 다시 만든다. 다른 DB 에는 연결하지 않는다.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
case "${1:-}" in bare|schema|legacy) ;; *) r0_die "사용법: reset.sh bare|schema|legacy" ;; esac

as_pg(){ if [ "$(id -u)" = 0 ]; then su "$R0_PG_OSUSER" -s /bin/bash -c "LD_LIBRARY_PATH='${LD_LIBRARY_PATH:-}' $*"; else bash -c "$*"; fi; }
mkdir -p "$R0_WORK"
[ "$(id -u)" = 0 ] && chown "$R0_PG_OSUSER" "$R0_WORK"
# 이전 시험 서버 정지·삭제: 우리가 만든 표식(.r0-verify)이 있는 data 폴더만 지운다
if [ -d "$R0_WORK/data" ]; then
  [ -f "$R0_WORK/data/.r0-verify" ] || r0_die "$R0_WORK/data 는 이 도구가 만든 폴더가 아닙니다. 직접 확인 후 지워 주세요."
  as_pg "'$R0_PG_BIN/pg_ctl' -D '$R0_WORK/data' -m fast stop" >/dev/null 2>&1 || true
  rm -rf "$R0_WORK/data"
fi
as_pg "'$R0_PG_BIN/initdb' -D '$R0_WORK/data' -U supabase_admin -E UTF8 --no-locale" >/dev/null
as_pg "touch '$R0_WORK/data/.r0-verify'"
as_pg "'$R0_PG_BIN/pg_ctl' -D '$R0_WORK/data' -o \"-p $R0_PG_PORT -k '$R0_WORK' -c listen_addresses='' -c timezone=UTC\" -l '$R0_WORK/log.txt' -w start" >/dev/null
r0_psql -U supabase_admin -d postgres -c "create database r0"
r0_psql -U supabase_admin -d r0 -f "$R0_TEST_DIR/mock_supabase.sql" >/dev/null
if [ "$1" != bare ]; then
  for n in 001 002 003 004 005 006 007; do
    f=$(ls "$R0_REPO"/migrations/${n}_*.sql)
    r0_psql -U postgres -d r0 -f "$f" >/dev/null
  done
fi
if [ "$1" = legacy ]; then
  r0_psql -U supabase_admin -d r0 -f "$R0_TEST_DIR/seed.sql" >/dev/null
fi
echo "reset $1 done"
