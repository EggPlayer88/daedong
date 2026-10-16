# P1 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
P1_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P1 시험 · IV R1S 위 P1 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p1.py` | III·IV. 학교 2곳·교사 8명 자료로 130건. `P1_CAPTURE` 로 응답을 남김 |
| `app_contract_p1.ts` | V. 남긴 응답을 PR #48 `createSupabaseSchoolAdminServer` 에 넣어 봄(`../../r1s/test/shared_stub.ts` 사용) |

`P1_APP_SRC` 가 없으면 앱 대조는 FAIL 로 셉니다(통과로 세지 않음).
