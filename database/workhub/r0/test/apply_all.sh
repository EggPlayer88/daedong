#!/bin/bash
# $1 = empty|legacy : 초기화 후 R0-01, R0-02 (legacy 면 R0-03 까지) 적용
set -e
. /tmp/claude-0/b01/test/env.sh
bash /tmp/claude-0/b01/test/reset.sh $1 2>&1 | grep -v -i initdb
cp /tmp/claude-0/b01/sql/*.sql /var/tmp/r0pg/; chmod 644 /var/tmp/r0pg/*.sql
$PSQL -U supabase_admin -d r0 -f /tmp/claude-0/b01/test/snapshot.sql > /tmp/claude-0/b01/test/snap_before_$1.txt
$PSQL -U postgres -d r0 -f /var/tmp/r0pg/R0-01_B01_기반.sql > /tmp/claude-0/b01/test/out_r001_$1.txt
$PSQL -U postgres -d r0 -f /var/tmp/r0pg/R0-02_B02_일정업무.sql > /tmp/claude-0/b01/test/out_r002_$1.txt
if [ "$1" = legacy ]; then
  $PSQL -U postgres -d r0 -f /var/tmp/r0pg/R0-03_filled.sql > /tmp/claude-0/b01/test/out_r003_$1.txt
fi
$PSQL -U supabase_admin -d r0 -f /tmp/claude-0/b01/test/snapshot.sql > /tmp/claude-0/b01/test/snap_after_$1.txt
echo "applied $1"
