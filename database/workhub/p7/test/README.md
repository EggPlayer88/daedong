# P7 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등. python3 + psycopg2, node + esbuild
P7_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험(보강 전 · 후) · III P7 시험 · IV R1S·P5 위 / 보강 없이 P7 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p7.py` | III·IV. `P7_BRIDGE=0` 이면 P7-05 구간(H)을 건너뜀. P5 가 있으면 학생 후속 시험(F10~F13)에 `../../p5/test/run_p5.py` 도구를 씀. `P7_CAPTURE` 로 응답과 그때의 `workhub_context` 를 남김 |
| `app_contract_p7.ts` | V. 남긴 응답을 PR #48 `createCollectionOperations` · `createHomeService` · `createTransitionService`(parser)에 넣어 봄 |

`P7_APP_SRC` 가 없으면 V 는 FAIL 로 셉니다(통과로 세지 않음).
P1~P5 는 `../../p1`~`../../p5` 에서 가져다 적용하고, 중지·재개는 `../../p2/P2-80`·`P2-81` 을 씁니다.
