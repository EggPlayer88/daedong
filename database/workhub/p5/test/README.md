# P5 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
P5_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P5 시험 · IV R1S·P3·P4 위 P5 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p5.py` | III·IV. R1 시험 자료 + 두 학교 · 같은 이름 학생 · 대기·거절·정지 교사로 138건. `P5_CAPTURE` 로 응답과 그때의 `workhub_context` 를 남김. P4 가 있는 DB(IV)에서는 문서함 학생 기록 초안이 P5 근거로 열리는지까지 봄 |
| `app_contract_p5.ts` | V. 남긴 응답을 PR #48 `createTeachingAdapter`(parser · 명령 검사 · 접수증 검사)에 넣어 봄(`../../r1s/test/shared_stub.ts` 사용) |

`P5_APP_SRC` 가 없으면 앱 대조는 FAIL 로 셉니다(통과로 세지 않음).
P1~P4 는 `../../p1`~`../../p4` 에서 가져다 적용하고, 중지·재개는 `../../p2/P2-80`·`P2-81` 을 씁니다.
