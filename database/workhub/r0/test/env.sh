# R0 검증 도구 공통 설정. 다른 스크립트가 `. env.sh` 로 읽는다.
# 경로는 모두 이 파일 위치(저장소) 기준으로 계산한다. 바꿀 수 있는 값은 환경 변수로만 받는다.
#   R0_PG_BIN   PostgreSQL 17 의 bin 폴더 (initdb·pg_ctl·psql). 없으면 PATH 의 pg_config 로 찾는다.
#   R0_WORK     시험 서버 작업 폴더. 기본 ${TMPDIR:-/tmp}/r0-verify. 이름에 r0-verify 가 들어가야 한다.
#   R0_PG_PORT  시험 서버 포트(유닉스 소켓 번호로만 쓰고 TCP 는 열지 않는다). 기본 55433.
#   R0_PSQL     psql 경로. 없으면 R0_PG_BIN/psql, 그것도 없으면 PATH 의 psql (서버 패키지에 psql 이 없는 경우).
#   R0_PG_OSUSER root 로 실행할 때 서버를 돌릴 OS 사용자. 기본 postgres.
#   R0_SQL_DIR  시험할 SQL 폴더. 기본 이 폴더의 상위(database/workhub/r0). 실패 주입 확인용으로만 바꾼다.
R0_TEST_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
R0_DIR=$(cd "$R0_TEST_DIR/.." && pwd)
R0_REPO=$(cd "$R0_DIR/../../.." && pwd)
R0_SQL_DIR=${R0_SQL_DIR:-$R0_DIR}
R0_WORK=${R0_WORK:-${TMPDIR:-/tmp}/r0-verify}
R0_PG_PORT=${R0_PG_PORT:-55433}
R0_PG_OSUSER=${R0_PG_OSUSER:-postgres}
if [ -z "${R0_PG_BIN:-}" ] && command -v pg_config >/dev/null 2>&1; then R0_PG_BIN=$(pg_config --bindir); fi

r0_die(){ echo "중단: $*" >&2; exit 2; }
[ -n "${R0_PG_BIN:-}" ] && [ -x "$R0_PG_BIN/initdb" ] && [ -x "$R0_PG_BIN/pg_ctl" ] \
  || r0_die "PostgreSQL 17 bin 폴더(initdb·pg_ctl)를 R0_PG_BIN 으로 알려 주세요 (README 의 '준비' 참고)"
# embedded-postgres 패키지처럼 lib 가 bin 옆에 있으면 그것을 쓴다
[ -d "$R0_PG_BIN/../lib" ] && export LD_LIBRARY_PATH="$(cd "$R0_PG_BIN/../lib" && pwd)${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
# 운영과 같은 주 버전(17)에서만 시험한다. PATH 의 다른 판(예: 16)을 모르고 쓰지 않게 막는다.
R0_PG_VERSION=$("$R0_PG_BIN/postgres" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -n 1)
case "$R0_PG_VERSION" in 17.*) ;; *) r0_die "R0_PG_BIN 의 PostgreSQL 이 17 이 아닙니다(${R0_PG_VERSION:-알 수 없음}: $R0_PG_BIN)" ;; esac
if [ -z "${R0_PSQL:-}" ]; then
  if [ -x "$R0_PG_BIN/psql" ]; then R0_PSQL=$R0_PG_BIN/psql; else R0_PSQL=$(command -v psql || true); fi
fi
[ -n "$R0_PSQL" ] && [ -x "$R0_PSQL" ] || r0_die "psql 을 찾지 못했습니다. R0_PSQL 로 경로를 알려 주세요"
case "$R0_WORK" in
  /*r0-verify*) ;;
  *) r0_die "R0_WORK 는 절대 경로이고 이름에 r0-verify 가 들어가야 합니다 (지금: $R0_WORK). 시험 서버가 이 폴더를 지우고 다시 만듭니다." ;;
esac
export R0_TEST_DIR R0_DIR R0_REPO R0_SQL_DIR R0_WORK R0_PG_PORT R0_PG_BIN R0_PG_VERSION
# 시험 서버는 R0_WORK 안의 유닉스 소켓으로만 받는다(listen_addresses 비움 → 원격 연결 불가)
export R0_PGHOST="$R0_WORK"
PSQL="$R0_PSQL -h $R0_WORK -p $R0_PG_PORT -X -q -v ON_ERROR_STOP=1"
