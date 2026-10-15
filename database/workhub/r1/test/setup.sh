#!/bin/bash
# 시험 서버를 "R0 적용 완료(기존 자료 포함)" 상태로 만들고, $1=r1 이면 R1-01~03 까지 적용한다.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
bash "$R0_TEST_DIR/reset.sh" legacy >/dev/null
r0_psql -U supabase_admin -d r0 -f "$R1_TEST_DIR/mock_storage_r1.sql" >/dev/null
mkdir -p "$R0_WORK/inputs"
python3 "$R0_TEST_DIR/gen_inputs.py" "$R0_DIR/R0-03_학교초기설정.sql" "$R0_WORK/inputs" >/dev/null
r0_psql -U postgres -d r0 -f "$R0_DIR/R0-01_B01_기반.sql" >/dev/null
r0_psql -U postgres -d r0 -f "$R0_DIR/R0-02_B02_일정업무.sql" >/dev/null
r0_psql -U postgres -d r0 -f "$R0_WORK/inputs/R0-03_filled.sql" >/dev/null
if [ "${1:-}" = r1 ]; then
  for f in R1-01_정책_파일_실행.sql R1-02_수합_원본.sql R1-03_공개함수_Storage.sql; do
    r0_psql -U postgres -d r0 -f "$R1_DIR/$f" >/dev/null
  done
fi
echo "setup ${1:-r0} done"
