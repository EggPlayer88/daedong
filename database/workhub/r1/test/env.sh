# R1 검증 도구 공통 설정. R0 도구(env.sh·reset.sh)를 그대로 재사용한다.
#   R0_PG_BIN  PostgreSQL 17 bin 폴더 (R0 README 의 '준비' 참고)
#   R0_WORK    시험 서버 작업 폴더. 기본 ${TMPDIR:-/tmp}/r1-r0-verify (R0 도구 규칙상 이름에 r0-verify 포함)
R1_TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
R1_DIR=$(cd "$R1_TEST_DIR/.." && pwd)
export R0_WORK=${R0_WORK:-${TMPDIR:-/tmp}/r1-r0-verify}
. "$R1_DIR/../r0/test/env.sh"
export R1_TEST_DIR R1_DIR
