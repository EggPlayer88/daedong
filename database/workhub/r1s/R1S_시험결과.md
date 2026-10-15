# R1S 시험 결과

2026-10-16 · Claude Code · `test/run_all.sh` 한 번에 **PASS 411 · FAIL 0**

시험 DB: 로컬 PostgreSQL 17 + R0 시험과 같은 Supabase 흉내(역할 `anon`·`authenticated`·`service_role`, `auth.uid()`, Storage 표).
매 구간마다 R0 + R1-01~03 상태로 새로 만듭니다. 앱 쪽은 PR #45 head `2f8d9a3` 의 코드를 **고치지 않고 그대로** 불러 썼습니다.

| 구간 | 내용 | 결과 |
|---|---|---|
| 준비 | R1S-01 의 교체 함수 5개 = R1-03 원문 + R1S 표시 부분 / R1S-00·01·03 에 박힌 함수 지문이 실제 본문과 같음 | 4/4 |
| I | 선행 조건이 틀리면 멈추고 아무것도 남기지 않음 (R1 없음, R1S-01 전 R1S-02, R1-03 함수 변조, 실패 뒤 표 0, R1S 전 R1S-04) | 5/5 |
| II | 비활성 설치(R1S-01·02, 활성화 0) 뒤 **R1 시험 전체** 그대로 | 244/244 |
| III | 기존 자료 시나리오: R1 작업자 경로로 PDF 를 받아 둔 DB → R1S 적용·활성화 → PR #45 `check_file` 로 실제 HWPX 확인 왕복, 위조·경합·중지·재개·읽기 유지 | 120/120 |
| IV | 신규 DB 시나리오(지금 운영과 같음: R1-05·06 미실행): R1S-04 입력 거부 경우들 + 정책 게시·활성화·왕복 | 32/32 |
| V | 시험 중 받은 실제 응답을 PR #45 의 `createSupabaseCollectionServer`·`collectionAccess` 에 넣어 앱이 받아들이는지 + HWPX 외 정책·다른 학교 봉투를 앱이 거부하는지 | 6/6 |

## 확인한 주요 성질

- 활성화 전에는 어떤 학교도 기본 확인을 쓸 수 없음(준비 상태 `verification_missing`)
- 활성화 뒤 HWPX 외 형식 예약 → `FILE_FAILED`, 정책의 `allowUnscanned` 는 끝까지 `false`
- ready 파일은 `scan_state = not_scanned`, `malwareScan:false` — clean 으로 적는 경로 없음
- 임대 token 은 해시만 저장, 만료·주체·실물 id·owner·크기·sha256 불일치 → 확정 거부
- 같은 결과 재전송은 멱등, 다른 결과는 `CONFLICT`, 같은 번호 다른 파일은 `IDEMPOTENCY_CONFLICT`
- 사람 JWT 를 실은 service_role 요청·anon·authenticated 의 claim/finish 호출 거부
- 확인 기록과 작업자 대기열이 한 파일에 같이 생기지 않음
- R1S-80 중지 → 쓰기 NOT_READY, 읽기·내려받기·기존 PDF·기본 확인 HWPX 열람 유지 → R1S-81 재개
- R1S-00 지문 F1~F9·G1~G4 가 R1S-01·02 전후 같음
- R1S 적용 뒤 R1-04 는 의도한 3행(03·04·09)만 FAIL

## 시험하지 못한 것

실제 Supabase(PostgREST 의 `request.jwt.claims` 바꾸기, 실제 `is_approved` 데이터), Storage HTTP, Vercel 환경 변수·시간 제한.
`R1S_실행안내.md` 8절.
