# R0 검증 도구

운영과 무관한 임시 PostgreSQL 17 에서 R0 SQL 을 실제로 돌려 보는 도구다. `npm test` 에는 들어가지 않는다.

| 파일 | 역할 |
|---|---|
| `env.sh` | PostgreSQL 17 바이너리·소켓 경로. 환경에 맞게 고친다 (작성 때는 `@embedded-postgres/linux-x64@17.6.0-beta.15`) |
| `mock_supabase.sql` | Supabase 역할·`auth`·`storage`·기본 권한 흉내 (superuser `supabase_admin` 으로 실행) |
| `seed.sql` | 기존 자료 DB 시험 자료 |
| `reset.sh bare\|schema\|legacy` | 서버 초기화. schema = migrations 001~007 만, legacy = + seed |
| `snapshot.sql` | public·auth·storage 상세 지문 (자료 해시 포함) |
| `run_tests.py` | 호환 함수 정상·거부 시험 86개 (psycopg2) |
| `app_contract.ts` | 앱의 실제 응답 검증 함수로 RPC 출력 확인 20개 (esbuild 로 묶어 node 실행, `pg` 필요) |
| `run_all.sh` | 위 전부 + 설치·거부·되돌림 22개 |
| `capture.py` | `R0_호환함수_입출력예시.md` 의 예시 수집 |
| `gen_cons.py` | `R0_제약처분표.md` 생성 (schema-contract.json 과 실제 제약 대조) |

R0-03 시험 입력은 `R0-03_학교초기설정.sql` 의 칸을 시험 값으로 채운 `R0-03_filled.sql` 을 쓴다 (`run_all.sh` 가 소켓 폴더에 둔 파일).
