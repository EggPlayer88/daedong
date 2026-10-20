# P9 기존 가입 교사 연결과 수업 담당 후보

2026-10-20, Codex 작업 브랜치. **운영 DB에 실행하지 않았다.** 이번 산출물은 기존 회원의 업무실 소속 연결(A), 담당 자격 분리(B)다. 수업·학생 정정/취소/보관(C)은 이 배치에 넣지 않는다. 담당 교체는 기존 P8의 미리보기·기간·확정 절차를 재사용한다.

설계 출처는 Claude [PR #75](https://github.com/EggPlayer88/daedong/pull/75), `848bb2fdc67453a16db4fa6549a6b53472a203b2`의 `P9_설계_계약.md`다. 원문을 `P9_원안_출처PR75.md`에 보존했다. 원안의 운영 수치는 10월 20일 당시 Claude가 조사한 값이며 이 배치가 운영을 다시 조회한 결과가 아니다.

## 실제로 바뀌는 것

- 관리자가 **학교별로 허용한 기존 회원 UID**만 보고, 재직 기간과 연결 근거를 확인한다.
- 미리보기 → 10분 안에 확정 → 실제 업무실 소속 ID를 받는다. 이름이나 이메일로 사람을 추측하지 않는다.
- 같은 번호를 재전송하면 원래 접수증을 받는다. 통신이 끊기면 입력·명령·번호를 그대로 유지한다.
- 결과 확인 중 미리보기가 만료되어도 원래 요청을 명시적으로 닫을 수 있다. 서버가 이미 반영했다면 원접수증을 반환하고, 아직 반영하지 않았다면 취소 장벽을 남겨 늦게 도착한 반영을 거부한다.
- 학교 관리 판도 함께 올라가므로 다른 화면에서 읽은 옛 소속 목록으로 덮어쓰지 못한다.
- 일반 교사를 수업 담당으로 고를 수 있지만 업무실 입장, 메시지·협업 수신 범위와 역할은 바뀌지 않는다.

가상 교사는 이 API에 들어오지 않는다. 로컬 시간표 시범의 교사 자원 ID와 실제 `membership.id`의 교체 연결만 다룬다. 가상 Auth 계정·가상 업무실 소속을 만들거나 다른 교사의 동의를 대신 기록하지 않는다.

## 원안에서 보완한 결정

| 항목 | 구현 |
|---|---|
| 기존 회원 전체가 여러 학교에 노출될 위험 | DB 승인 양식에 학교별 UID 허용 목록을 명시한다. 다른 학교 소속이나 계정 유무를 후보 검색으로 탐색할 수 없다. |
| 새 공개 API | 기존 `member_actor`·`legacy_gate`를 그대로 통과하고 `year.manage`가 있어야 조회한다. 미리보기·확정에는 `membership.approve`도 필요하다. |
| 기존 로그인 계정 | `auth.users`와 `public.users`는 읽기만 한다. 새로 만드는 것은 `workhub.accounts`와 `memberships` 및 P9 원장이다. |
| R0 확정 CHECK 변경 | 변경하지 않는다. `legacy_link_run_id`는 기존처럼 NULL이고, P9 연결 원장이 계정·소속·기존 UID를 직접 FK로 묶는다. |
| 기간 | 소속 시작 ≤ 서버의 학교 오늘, 마지막 날은 없거나 학교 오늘 이후다. 수업의 1학기 기간과 현재 재직 기간은 다르다. |
| 중복·겹침 | 기존 소속이 요청 기간 전체를 포함하면 건너뛴다. 정지·대기·일부 기간 겹침은 전체 반영을 막는다. 기존 소속을 몰래 연장하지 않는다. |
| 기존 접수증 | 사용자·학교·소속·현재 관리 권한을 확인한 뒤, 신규 정책/활성화/미리보기 만료보다 먼저 접수증을 읽는다. 권한 회수 후 우회 복구는 허용하지 않는다. |
| 요청 닫기 | 적용과 같은 잠금 안에서 원접수증 반환 또는 `closed` 원장 기록 중 하나만 확정한다. 단순 `CONFLICT`는 닫힘 증거가 아니다. 원래 번호·원문으로 받은 `applied`/`closed` 응답만 화면 잠금을 푼다. |
| 동시 연결 | 학교 관리 잠금과 별도 전역 교사 연결 잠금을 쓰고, 원장과 기존 소속 EXCLUDE/FK로 중복을 막는다. |
| 담당 후보 분리 | P5/P8 함수 네 곳의 확정 본문 지문을 먼저 비교하고 `p2_member_reachable` 한 번씩만 `p9_teacher_assignable`로 바꾼다. 메시지의 함수는 바꾸지 않는다. |
| Auth 삭제 경쟁 | Auth 표의 쓰기 권한을 요구하는 `FOR SHARE`를 쓰지 않는다. 기존 계정 또는 새 계정의 Auth FK가 삭제와 직렬화한다. |

## 설치와 활성화는 분리

사용자가 검토·승인한 뒤 실행한다. 지금 이 문서는 실행 승인이 아니다.

1. **기준선 저장:** 현재 설치 단계에 맞는 T2-07과 R0-00/보존 지문을 읽기 전용으로 저장한다.
2. **P9-01:** 모델·공개 함수 설치. 학교 정책 행이 없어서 기본 비활성이다.
3. **P9-02:** 수업 담당 후보 함수 네 곳 분리. P9 정책이 비활성인 동안에는 기존 함수 결과를 그대로 사용한다.
4. **P9-04 / P9-05:** 국소·전체 통합 점검. FAIL 0을 확인한다. P9 뒤에는 기존 T2-07 대신 **P9-05**가 전체 구조 기준이다.
5. **P9-03 별도 승인:** 학교 ID, 승인자의 기존 Auth UID, 이 학교 재직을 확인한 UID 목록, 실제 승인 근거와 `p_enable=true`를 입력한다. 전 교사를 자동으로 선택하지 않는다.
6. **앱:** 학교 관리 → 가입 교사 연결 → 정확한 UID·기간 확인 → 미리보기 → 명시 확인 → 연결.
7. 회원표 지문, 연결 결과와 역할 수를 확인한다. 새 역할 수는 0이다. 일반 교사 공개와 T2 활성화는 별개다.

P9-03은 기본 빈칸이라 그대로 실행하면 아무것도 바꾸지 않고 멈춘다. 기존 승인 근거의 잘못된 문구를 고치는 작업이나 과거 회원 자료 수정은 포함하지 않는다.

## 앱 계약

`apps/workhub/src/setup/school-roster-contracts.ts`가 정확한 필드 목록이다.

| RPC | 입력 | 출력 |
|---|---|---|
| `workhub_school_roster_get` | `p_member_id` | 준비 상태, 판, 학교 오늘, 허용 UID 후보, 수업 담당 가능한 소속 목록 |
| `workhub_school_roster_preview` | `p_member_id`, `p_intent` | 미리보기 ID·지문·만료 시각·대상별 결과 |
| `workhub_school_roster_commit` | `p_member_id`, `p_command`, `p_request_key` | 원래 요청 번호·판·접수 시각·UID별 소속 ID |
| `workhub_school_roster_close` | `p_member_id`, 원래 `p_command`, 원래 `p_request_key` | `{requestKey,outcome:'applied',receipt:원접수증}` 또는 `{requestKey,outcome:'closed',receipt:null}` |

봉투: `{contract:'school-roster.v1',schoolId,memberId,data}` 또는 같은 범위와 `error:{code}`.
`intent`: `{expectedVersion,targetUserIds,startsOn,lastDay,reason}`. UID는 정렬하고 최대 300명, 날짜는 실제 ISO 날짜, 이유는 1~200자다. `command`는 `{previewId,fingerprint,intent}`다.

닫기는 미리보기 만료와 학교 관리/P9 모듈 중지 뒤에도 현재 본인·학교·소속·관리 권한을 확인하고 처리한다. 닫기 응답이 끊기면 같은 번호·같은 원문으로 닫기를 다시 호출한다. 닫힌 번호의 늦은 `commit`은 `CONFLICT`, 같은 번호의 다른 명령은 `IDEMPOTENCY_CONFLICT`다. 닫힌 미리보기는 재사용하지 않고 새 미리보기와 새 요청 번호로 시작한다. 최초 요청의 미리보기가 다른 학교·다른 작성자 것이면 `NOT_FOUND`이며 해당 원장·접수증을 반환하지 않는다.

## 자동 검증

`test/run_p9.py`는 매번 새 임시 폴더에 PostgreSQL 17을 초기화하고 **127.0.0.1**의 높은 시험 포트로만 연다. 운영 URL·DSN·키를 입력받지 않는다. 종료 시 자신의 서버를 중지하고 시험 폴더와 로그를 남긴다. PostgreSQL을 root로 실행하지 않는다.

Linux/CI:

```sh
python -m pip install psycopg2-binary
export P9_PG_BIN="$(pg_config --bindir)"
export P9_CAPTURE="${RUNNER_TEMP:-/tmp}/p9-captures.json"
python database/workhub-school-data/p9/test/run_p9.py
node tests/test_workhub_school_roster.mjs
```

`pg_config`가 PostgreSQL 17을 가리켜야 한다. 포트 충돌이면 `P9_TEST_PORT`를 49152~65535 사이 빈 포트로 바꾼다. 생성기가 통합 점검문을 현재 SQL과 다시 대조하므로 원문과 기대값이 다르면 실패한다. SQL 수정 뒤에는 격리 환경에서만 `P9_WRITE_MANIFEST=1`로 재생성하고, 변수를 지운 뒤 전체 시험을 다시 통과시킨다.

Windows PowerShell(설치 경로에 맞춘 값):

```powershell
$env:P9_PG_BIN = 'C:/검증용-PostgreSQL17/bin'
$env:P9_CAPTURE = Join-Path $env:TEMP 'p9-captures.json'
python -m pip install psycopg2-binary
python database/workhub-school-data/p9/test/run_p9.py
node tests/test_workhub_school_roster.mjs
```

Python에 시간대 데이터가 없으면 `tzdata`를 설치하거나 `PYTHONTZPATH`를 PostgreSQL의 `share/timezone` 경로로 지정한다.

검증 범위: 학교 격리, 미승인/없는 UID, 현재 자격·기간, 미리보기 뒤 변경, 원자적 반영, 같은 번호 재시도·다른 원문 거부, 동일 요청 동시 두 연결, 원본 회원 지문, Auth 계정 수, 역할 부여 없음, 일반 교사 입장 차단, P5 실제 담당 후보, 승인 양식 빈칸 차단, 전체 통합 구조와 훼손 탐지, 실제 SQL 응답의 앱 parser 대조.

2026-10-20 검증 결과: 격리 PostgreSQL **17.6에서 74건 통과, 실패 0건**. 요청 닫기의 만료·중지·권한 회수·다른 학교·응답 유실과 반영/닫기의 동시 경합 6회가 포함된다. P9-05의 전체 구조 점검 13행에서 FAIL이 없었고, 보호 트리거를 일부러 끈 경우에는 FAIL이 발생했다. 실제 SQL 응답 6개(`applied`/`closed` 포함)를 넣은 앱 계약 시험은 **26건 통과**했다. `P9_CAPTURE`가 없는 일반 저장소 시험에서는 그 6개 실제 SQL 대조를 제외한 20건을 실행한다.

실제 Supabase/PostgREST, 실제 학교 회원 선택, 운영 배포 후 브라우저 왕복은 이 격리 시험으로 검증했다고 표시하지 않는다.
