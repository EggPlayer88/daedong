# R1 검증 도구

임시 PostgreSQL 17 서버에 Supabase 흉내(역할·auth·storage 표)를 만들고 R0 → R1 을 적용해 시험합니다.
운영 DB(`dhaoszbqtbofqftgjfyb`)에는 연결하지 않습니다. R0 도구(`../../r0/test/`)를 그대로 재사용합니다.

## 준비

- PostgreSQL 17 의 bin 폴더 (R0 README 의 '준비'와 같음) → `R0_PG_BIN`
- Python 3 + `psycopg2`
- 앱 대조(선택): 저장소 루트에서 `npm ci` (esbuild), 그리고 앱 소스 checkout 경로 → `R1_APP_SRC`
  - 예: `git worktree add /tmp/pr35 origin/<PR #35 브랜치>` 후 `R1_APP_SRC=/tmp/pr35`
  - 지정하지 않으면 그 단계는 **미실행**으로 표시되고 통과로 세지 않습니다.

## 실행

```bash
cd database/workhub/r1/test
R0_PG_BIN=<PostgreSQL 17 bin> R1_APP_SRC=<앱 checkout> bash run_all.sh
```

종료 코드: 0 = 모두 통과, 1 = 실패 있음, 2 = 준비 단계 실패.

## 파일

| 파일 | 하는 일 |
|---|---|
| `env.sh` | 공통 설정. 시험 서버 폴더 기본값 `${TMPDIR:-/tmp}/r1-r0-verify` |
| `mock_storage_r1.sql` | R0 흉내에 Storage 판 차이(owner_id·버킷 크기 한도 등)를 더함 |
| `setup.sh [r1]` | 기존 자료 DB + R0-01~03 적용, `r1` 이면 R1-01~03 까지 |
| `run_r1.py` | 정상·거부 시나리오 244건 (PostgREST 와 같은 역할 경로로 호출, Storage 요청 종류는 `storage.operation` 으로 흉내) |
| `app_contract.ts` | `run_r1.py` 가 받은 실제 응답 봉투를 앱의 검증 함수(`collections/validation.ts`)에 넣어 확인 |
| `run_all.sh` | 선행 조건 거부 → 설치 → 전후 지문 → 지문 민감도 → 시나리오 → 앱 대조 → 중지 양식 |

## 이 도구가 확인하지 못하는 것

- 실제 PostgREST HTTP 응답(JSON 직렬화·헤더·오류 본문). 여기서는 `authenticator → set role → request.jwt.claims`
  로 같은 SQL 경로만 흉내 냅니다.
- 실제 Supabase Storage API·SDK. 업로드·내려받기는 `storage.objects` 행 INSERT/SELECT 로 RLS 판정만 봅니다.
  파일 본문 바이트, 실제 버킷 크기 한도, Storage 서버의 owner 기록 방식은 확인하지 않습니다.
- 서버 검증 작업자. 작업자 함수는 시험 코드가 직접 호출합니다(실제 파일 검사 없음).
- 운영 DB 의 실제 기존 정책·자료. 사전 점검(R1-00)을 운영에서 돌려야 압니다.
