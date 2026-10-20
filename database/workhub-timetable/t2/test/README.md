# T2 시험

임시 PostgreSQL 17 + Supabase 흉내(R0 · R1 시험 도구 재사용). 운영과 무관하다.

```bash
R0_PG_BIN=<PostgreSQL 17 bin> T2_APP_SRC=<PR #72 checkout> ESBUILD=<esbuild> REACT_DIR=<react 폴더> bash run_all.sh
```

| 단계 | 내용 |
|---|---|
| II `run_t2.py` | R1 + P1~P5 + P7 + P8 위에 T1-01~03 · T1-07 · T2 를 직접 설치하고 설치 순서 · 원본 확인 · 접근 경계 · 공개 · 교환 · 알림 · 학사 변경 · 실시 기록 · 동시성 · 중지/재개 · 사후 점검 · 요청 번호 포기(88건) |
| III `app_contract_t2.ts` | II 에서 받은 성공 응답을 PR #72 앱의 실제 parser 에 넣어 대조(앱 코드는 가져다 쓰기만 함) |
| V `gen_t2_07.py check` | T2-07 의 승인 목록이 지금 SQL 파일로 다시 만든 목록과 한 글자도 다르지 않은지 |

- 실시 기록 시험은 끝난 수업이 필요해 시험 DB 에서 수업 시각을 2주 앞으로 옮긴다(시험 전용 — 앱 · 운영 경로 아님).
- T2-07 을 다시 만들 때: R0 만 있는 시험 DB(`setup.sh`)에서 `python3 gen_t2_07.py write`.
