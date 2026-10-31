#!/usr/bin/env bash
# embedded PostgreSQL 서버의 라이브러리를 시스템 psql 클라이언트에 상속하지 않는다.
# 부모 시험 서버의 환경과 SQL 접속 인자는 그대로 유지한다.
set -euo pipefail
if [ -z "${WORKHUB_CI_SYSTEM_PSQL:-}" ] || [ ! -x "$WORKHUB_CI_SYSTEM_PSQL" ]; then
  echo "CI psql 실행 파일 설정이 필요합니다." >&2
  exit 2
fi
exec env -u LD_LIBRARY_PATH "$WORKHUB_CI_SYSTEM_PSQL" "$@"
