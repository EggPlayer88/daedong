# P3 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등
P3_APP_SRC=<PR #48 브랜치 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체(I 거부 · II R1 시험 · III P3 시험 · IV R1S 위 P3 시험 · V 앱 대조). 실패 1, 준비 실패 2 |
| `run_p3.py` | III·IV. R1 시험 자료 + 같은 이름·대기·거절·정지·업무실 자격 없는 교사 + 페이지용 교사 55명으로 188건. `P3_CAPTURE` 로 응답과 그때의 `workhub_context`·준비 상태·대화 조회를 남김. Storage 는 `storage.objects` 행과 메모리 저장소로 흉내 |
| `app_contract_p3.ts` | V. 남긴 응답을 PR #48 `createSupabaseMessagingServer`·`createMessageFileServer`·`createMessageFileCheck` 에 넣어 봄(`../../r1s/test/shared_stub.ts` 사용) |

`P3_APP_SRC` 가 없으면 서버 확인 API 시험(O37~O41)과 앱 대조는 FAIL 로 셉니다(통과로 세지 않음).
P1·P2 는 `../../p1`·`../../p2` 에서 가져다 적용하고, 중지·재개는 `../../p2/P2-80`·`P2-81` 을 씁니다.
