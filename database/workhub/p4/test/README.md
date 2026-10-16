# P4 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
P4_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P4 시험 · IV R1S·P3 위 P4 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p4.py` | III·IV. R1 시험 자료 + 같은 이름·대기·거절·정지 교사 + 게시된 수합 2건(HWPX 칸 있음/없음)으로 210건. `P4_CAPTURE` 로 응답과 그때의 `workhub_context` 를 남김. Storage 는 `storage.objects` 행과 메모리 저장소로 흉내. 서버 API 는 PR #48 의 실제 `_knowledge_import.run`·`_guided_service.run` |
| `app_contract_p4.ts` | V. 남긴 응답을 PR #48 `createKnowledgeService`·`createKnowledgeImportService`·`createDocumentsService`·`createGuidedService`·`createGuidedHttp` 에 넣어 봄(`../../r1s/test/shared_stub.ts` 사용) |

`P4_APP_SRC` 가 없으면 서버 API 시험(F25~F29·F44~F48·G12~G15·G25~G33·G42·G47~G50)과 앱 대조는 FAIL 로 셉니다(통과로 세지 않음).
P1·P2·P3 는 `../../p1`·`../../p2`·`../../p3` 에서 가져다 적용하고, 중지·재개는 `../../p2/P2-80`·`P2-81` 을 씁니다.
