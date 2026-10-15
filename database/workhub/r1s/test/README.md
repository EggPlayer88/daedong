# R1S 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
R1S_APP_SRC=<PR #45 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(준비 · I 거부 · II R1 시험 · III 기존 자료 · IV 신규 DB · V 앱 대조). 실패 1, 준비 실패 2 |
| `r1s_replaced.py` | R1-03 원문에서 교체 함수 5개를 만들고, `--check` 로 R1S-01 본문과 R1S-00·01·03 의 지문을 대조 |
| `run_r1s.py legacy|fresh` | III·IV. PR #45 `check_file` 를 실제로 불러 확인 왕복. `R1S_CAPTURE` 로 응답을 남김 |
| `app_contract_r1s.ts` + `shared_stub.ts` | V. 남긴 응답을 PR #45 앱 어댑터·검증 함수에 넣어 봄 |

`R1S_APP_SRC` 가 없으면 왕복·앱 대조는 FAIL 로 셉니다(통과로 세지 않음).
