# T1 시험

```bash
# R1 시험과 같은 준비(../../r1/test/README.md): R0_PG_BIN 등. python3 + psycopg2, node + esbuild
R0_PG_BIN=<PostgreSQL 17 bin> T1_APP_SRC=<PR #65·#66 checkout(node_modules 포함)> [ESBUILD=<esbuild 경로>] bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체. I 선행 조건 · 순서 · 바뀐 R0 제약에서 멈춤, II `run_t1.py` + INT-03 차이 = T1-04-10, III 앱 대조, IV 무작위 대조. 실패 1, 준비 실패 2 |
| `run_t1.py` | II. R1 + P1~P5 + P7 + P8 위에서 T1-01~03 을 직접 설치하고 A 설치 · 지문, B 켜기 전, C T1-05, D 권한, E 담당자 입력 · 미완성 조회, F 준비 · 확정, G 편성 초안, H 동시성 · 중지, I 사용 뒤를 봄. `T1_CAPTURE` 에 응답과 그때의 `workhub_context` · 앞선 조회를 남김 |
| `app_contract_t1.ts` | III. 남긴 응답을 앱 `createTimetableServer` · `createPreparationServer` · parser 에 넣어 봄. K-3(확정 기준판 = `compilePreparation`), `setup.v1` 기준 parser |
| `fuzz_t1.ts` · `fuzz_t1.py` | IV. 확정 성공 응답을 씨앗으로 무작위 변형을 만들어 앱 판정을 붙이고(ts), 같은 변형을 SQL 이식 함수에 넣어 비교(py). `T1_FUZZ_SEED` · `T1_FUZZ_N` |

- `T1_APP_SRC` 가 없으면 III · IV 는 FAIL 로 셉니다(통과로 세지 않음).
- 앱 코드는 가져다 쓰기만 하고 고치지 않습니다. 번들 별칭: `t1app=<checkout>/apps/workhub/src`, `t1pkg=<checkout>/packages/timetable/src`, `@daedong/shared=../../r1s/test/shared_stub.ts`.
