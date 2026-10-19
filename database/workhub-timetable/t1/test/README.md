# T1 시험

```bash
# R1 시험과 같은 준비(../../../workhub/r1/test/README.md): R0_PG_BIN 등. python3 + psycopg2, node + esbuild
R0_PG_BIN=<PostgreSQL 17 bin> T1_APP_SRC=<PR #65·#66 checkout(node_modules 포함)> [ESBUILD=<esbuild 경로>] bash run_all.sh
```

| 파일 | 하는 일 |
|---|---|
| `run_all.sh` | 전체. I 선행 조건 · 순서 · 바뀐 R0 제약에서 멈춤, II `run_t1.py` + T1-06 FAIL 0 · INT-03 차이는 T1 과 학기 제약 교체뿐 · 보호 트리거 끄기 훼손 회귀, III 앱 대조, IV 무작위 대조, V T1-06 목록 재생성 대조. 실패 1, 준비 실패 2 |
| `run_t1.py` | II. R1 + P1~P5 + P7 + P8 위에서 T1-01~03 을 직접 설치하고 A 설치 · 지문, B 켜기 전, C T1-05, D 권한, E 담당자 입력 · 미완성 조회, F 준비 · 확정, G 편성 초안, H 동시성 · 중지, J 재검토 F1 · F2 재현(공개 RPC 로 미래 수강 겹침 · 교사 재직 종료), I 사용 뒤를 봄. `T1_CAPTURE` 에 응답과 그때의 `workhub_context` · 앞선 조회를 남김 |
| `app_contract_t1.ts` | III. 남긴 응답을 앱 `createTimetableServer` · `createPreparationServer` · parser 에 넣어 봄. K-3(확정 기준판 = `compilePreparation`), `setup.v1` 기준 parser |
| `gen_t1_int.py` | V. `T1-06_통합사후점검.sql` 을 만든다(`write`) · 저장소 파일과 같은지 본다(`check`). INT-03 생성기(`../../../workhub/integration/test/gen_manifest.py`)를 가져다 1~8단계 목록을 만들고 T1-01~03 을 덧붙인다. R0 만 있는 시험 DB 에서 |
| `run_all_t1_07.sh` · `run_t1_07.py` | T1-07(준비 대상 학기 고르기). 설치 순서 · 원본 확인 · 지문, `timetable.target.v1` 계약 · 동시성 · 학기 닫힘/빼기, 사용 뒤 T1-08 · T1-09. `T1_07_CAPTURE` 에 응답 예시. `R0_PG_BIN=… bash run_all_t1_07.sh` |
| `gen_t1_09.py` | `T1-09_통합사후점검.sql` 을 만든다(`write`) · 같은지 본다(`check`). `gen_t1_int.py` 에 T1-07 단계를 더한 것 |
| `fuzz_t1.ts` · `fuzz_t1.py` | IV. 확정 성공 응답을 씨앗으로 무작위 변형을 만들어 앱 판정을 붙이고(ts), 같은 변형을 SQL 이식 함수에 넣어 비교(py). `T1_FUZZ_SEED` · `T1_FUZZ_N` |

- `T1_APP_SRC` 가 없으면 III · IV 는 FAIL 로 셉니다(통과로 세지 않음).
- 이 시험은 저장소 CI 에서 돌지 않습니다(앱 checkout · PG17 필요). PR 에 결과를 적습니다.
- T1-07 을 고치면 `python3 gen_t1_09.py write` 로 T1-09 를 다시 만듭니다(T1-06 은 그대로). T1 SQL 을 고치면 `python3 gen_t1_int.py write` 로 T1-06 을 다시 만듭니다(R0 만 있는 시험 DB: `bash ../../../workhub/r1/test/setup.sh`).
- 앱 코드는 가져다 쓰기만 하고 고치지 않습니다. 번들 별칭: `t1app=<checkout>/apps/workhub/src`, `t1pkg=<checkout>/packages/timetable/src`, `@daedong/shared=../../../workhub/r1s/test/shared_stub.ts`.
