#!/bin/bash
# 시험 서버 초기화: $1 = empty | legacy
set -e
. /tmp/claude-0/b01/test/env.sh
su postgres -s /bin/bash -c "LD_LIBRARY_PATH=$LD_LIBRARY_PATH $PGB/pg_ctl -D $D/data -m fast stop" >/dev/null 2>&1 || true
rm -rf $D/data
su postgres -s /bin/bash -c "LD_LIBRARY_PATH=$LD_LIBRARY_PATH $PGB/initdb -D $D/data -U supabase_admin -E UTF8 --no-locale" >/dev/null
su postgres -s /bin/bash -c "LD_LIBRARY_PATH=$LD_LIBRARY_PATH $PGB/pg_ctl -D $D/data -o '-p 55433 -k $D -c listen_addresses= -c timezone=UTC' -l $D/log.txt -w start" >/dev/null
$PSQL -U supabase_admin -d postgres -c "create database r0"
cp /tmp/claude-0/b01/test/mock_supabase.sql /var/tmp/r0pg/mock.sql; chmod 644 /var/tmp/r0pg/mock.sql
$PSQL -U supabase_admin -d r0 -f /var/tmp/r0pg/mock.sql
if [ "$1" = legacy ] || [ "$1" = schema ]; then
  for f in 001 002 003 004 005 006 007; do
    $PSQL -U postgres -d r0 -f /home/claude/daedong/migrations/${f}_*.sql >/dev/null
  done
fi
if [ "$1" = legacy ]; then
  $PSQL -U supabase_admin -d r0 -f /tmp/claude-0/b01/test/seed.sql >/dev/null
fi
echo "reset $1 done"
