# P8 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등. python3 + psycopg2, node + esbuild
P8_APP_SRC=<PR #60 checkout> ESBUILD=<esbuild 경로, 없으면 저장소 node_modules> bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체. I 선행 조건 · 기존 공식 담당 인계 · 부분 설치(P8-01~03) 거부와 P8-05 · II 바꿀 함수가 원본 판이 아니면 멈춤 · III P8 시험(P7-05 있음 / 없음) · IV PR #60 앱 대조. 실패 1, 준비 실패 2 |
| `run_p8.py` | III. R1 + P1~P5 + P7 위에서 P8-01~04 를 직접 설치하며 A 설치 · 원본 대비 표시 없는 차이 없음 · 지문, B 켜기 전(옛 앱 경로), C P8-06 거부, D Q4, E C6 행동 × 받는 사람, F Q2 흐름 · 동시성 · 중지, G 수업 관계 · 불변 · 동시성, H 사용 뒤 사후 점검 · 지문. `P8_BRIDGE=0` 이면 P7-05 없이(협업 인계 알림 행만 건너뜀). `P8_CAPTURE` 로 응답과 그때의 `workhub_context` · 목록 · 관계 조회를 남김 |
| `app_contract_p8.ts` | IV. 남긴 응답을 PR #60 `createTransitionService` · `createSupabaseSchoolAdminServer` · `createCooperationAdapter` · `createSupabaseMessagingServer` · `createTeachingRelationsAdapter` 와 parser 에 넣어 봄. `commandHash` = 앱 `csvHash(relationCanonical())` 비교 포함 |

- `P8_APP_SRC` 가 없으면 IV 는 FAIL 로 셉니다(통과로 세지 않음).
- 앱 대조의 `[#60 결함 D1]` 불일치는 앱 쪽 결함 재현입니다(서버 ok, 앱이 보내기 전에 `NOT_READY`). 숨기지 않고 FAIL 로 셉니다 — `../../integration/재검토_PR60.md` 1절.
- 1~8단계를 한 DB 에서 보는 시험은 `../../integration/test/run_integration.sh` 입니다(이 시험과 따로).
