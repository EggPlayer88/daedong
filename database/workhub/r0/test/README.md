# R0 검증 도구

운영과 무관한 임시 PostgreSQL 17 에서 R0 SQL 을 실제로 돌려 보는 도구다. `npm test` 에는 들어가지 않는다.
시험 서버는 `R0_WORK` 폴더 안의 유닉스 소켓으로만 받고(TCP 를 열지 않음), 다른 DB 에는 연결하지 않는다.

## 준비 (한 번)

| 필요한 것 | 확인·설치 |
|---|---|
| PostgreSQL **17** 의 `initdb`·`pg_ctl` | 시스템 패키지(`pg_config --bindir`)나 아래 npm 패키지. 운영과 같은 17.6 을 권장 |
| `psql` | 위 bin 폴더에 없으면 PATH 의 것을 쓴다(16 이상이면 된다). 다른 곳이면 `R0_PSQL` |
| Python 3.9+ 와 `psycopg2` | `python3 -m pip install psycopg2-binary` |
| Node 20+ 와 저장소 개발 의존성(`esbuild`·`pg`) | 저장소 루트에서 `npm ci` |

PostgreSQL 17.6 을 시스템에 깔 수 없으면, 작성 때 쓴 npm 패키지로 받을 수 있다(작업 폴더는 저장소 밖):

```bash
npm install --prefix /tmp/pg17pkg @embedded-postgres/linux-x64@17.6.0-beta.15
export R0_PG_BIN=/tmp/pg17pkg/node_modules/@embedded-postgres/linux-x64/native/bin
```

## 실행

저장소 루트에서:

```bash
npm ci
export R0_PG_BIN=<PostgreSQL 17 bin 폴더>     # pg_config 가 17 을 가리키면 생략 가능
bash database/workhub/r0/test/run_all.sh
```

- 끝줄에 `== 합계: PASS n · FAIL 0` 이 나오고 **종료 코드 0** 이면 전부 통과다.
- 하나라도 실패하면 종료 코드 **1**, 준비 단계(서버·입력 생성·빌드)가 실패하면 **2** 다.
- 거부를 기대하는 시험은 "psql 이 SQL 오류로 멈추고 그 메시지가 기대한 문구" 일 때만 통과한다. 연결 실패나 다른 오류는 실패로 센다.
- root 로 실행하면 시험 서버는 `postgres` OS 사용자로 돈다(`R0_PG_OSUSER` 로 바꿈).

| 환경 변수 | 기본값 | 뜻 |
|---|---|---|
| `R0_PG_BIN` | `pg_config --bindir` | PostgreSQL 17 bin 폴더 |
| `R0_PSQL` | `R0_PG_BIN/psql` → PATH | psql 경로 |
| `R0_WORK` | `${TMPDIR:-/tmp}/r0-verify` | 시험 서버 작업 폴더. 이름에 `r0-verify` 가 있어야 하고, 이 도구가 만든 `data` 폴더만 지운다 |
| `R0_PG_PORT` | `55433` | 소켓 번호 |
| `R0_SQL_DIR` | `database/workhub/r0` | 시험할 SQL 폴더. 실패 주입 확인 때만 바꾼다 |

## 파일

| 파일 | 역할 |
|---|---|
| `env.sh` | 경로 계산(모두 저장소 기준)과 위 환경 변수 확인 |
| `reset.sh bare\|schema\|legacy` | 시험 서버 초기화. bare = Supabase 흉내만, schema = + `migrations/001~007`, legacy = + `seed.sql` |
| `mock_supabase.sql` | Supabase 역할·`auth`·`storage`·기본 권한 흉내 (superuser `supabase_admin` 으로 실행, `postgres` 는 superuser 아님) |
| `seed.sql` | 기존 자료 DB 시험 자료 (합성 회원·제출·파일 행) |
| `gen_inputs.py` | `R0-03` 의 `<...>` 칸을 **합성 시험 값**으로 채운 입력 4개를 `R0_WORK/inputs` 에 만든다. 날짜는 실행하는 날이 속한 학년도로 계산. 운영 초기값이 아니다 |
| `snapshot.sql` | public·auth·storage 지문: 구조, 회원·Auth 자료 해시, 제출·파일 **행 수**. Storage 파일 본문 바이트는 보지 않는다 |
| `run_tests.py` | 호환 함수 정상·거부 시험 (psycopg2) |
| `app_contract.ts` | 앱의 실제 검증 함수(`apps/workhub/src`)로 RPC 응답 확인. `run_all.sh` 가 esbuild 로 묶어 실행 |
| `run_all.sh` | 위 전부 + 설치·거부·되돌림 |
| `capture.py` | `R0_호환함수_입출력예시.md` 의 예시 수집 (설치된 시험 서버에서 `. env.sh && python3 capture.py`) |
| `gen_cons.py` | `R0_제약처분표.md` 다시 생성. 기준 계약은 `R0_CONTRACT`(기본: 저장소의 `schema-contract.json`) |

## 실패 판정 확인 방법

SQL 하나를 일부러 틀리게 고친 사본으로 돌리면 종료 코드가 1 이어야 한다.

```bash
cp -r database/workhub/r0 /tmp/r0-broken
sed -i "s/WHEN p_audience -> 'excludeMemberIds' ? p_membership_id THEN false/WHEN false THEN false/" /tmp/r0-broken/R0-02_B02_일정업무.sql
R0_SQL_DIR=/tmp/r0-broken bash database/workhub/r0/test/run_all.sh; echo "exit $?"   # → FAIL 3건, exit 1
```
