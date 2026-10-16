# P2 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
P2_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P2 시험 · IV R1S 위 P2 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p2.py` | III·IV. R1 시험 자료 + 같은 이름·대기·거절·정지 교사로 124건. `P2_CAPTURE` 로 응답과 그때의 `workhub_context` 를 남김 |
| `app_contract_p2.ts` | V. 남긴 응답을 PR #48 `createCalendarBatchAdapter`·`createCooperationAdapter` 에 넣어 봄(`../../r1s/test/shared_stub.ts` 사용) |

`P2_APP_SRC` 가 없으면 앱 대조는 FAIL 로 셉니다(통과로 세지 않음). P1-01·02 는 `../../p1` 에서 가져다 적용합니다.
