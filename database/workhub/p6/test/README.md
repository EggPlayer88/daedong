# P6 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등. python3 + PR #48 서버 코드가 쓰는 표준 라이브러리만
P6_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P6 시험 · IV R1S·P3 위 P6 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p6.py` | III·IV. 117건. 질문 · 준비 상태는 `P6_APP_SRC` 의 실제 서버 코드(`apps/main/api/workhub-ai/_assistant.py`)에 가짜 DB 연결 · 가짜 모델 응답기를 붙여 보냄. P5 시험 자료는 `../../p5/test/run_p5.py` 를 가져다 씀. `P6_CAPTURE` 로 응답과 그때의 `workhub_context` 를 남김 |
| `app_contract_p6.ts` | V. 남긴 응답을 PR #48 `createAssistantServer` · `createAssistantHttp`(parser)에 넣어 봄 |

`P6_APP_SRC` 가 없으면 III·IV·V 는 FAIL 로 셉니다(통과로 세지 않음).
P1~P5 는 `../../p1`~`../../p5` 에서 가져다 적용하고, 중지·재개는 `../../p2/P2-80`·`P2-81` 을 씁니다.
