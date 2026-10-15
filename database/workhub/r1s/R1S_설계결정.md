# R1S 설계 결정 — "판단해서 정한 것"

2026-10-16 · Claude Code. 각 항목은 왜 그렇게 정했는지, 되돌리려면 어디를 고치는지를 함께 적습니다.
D번호(DECISIONS.md) 신설이 아니라 R1S 안의 구현 판단입니다. 확정은 계란님 검토 후입니다.

## 1. 전체 모양 — R1 쓰기 판정 안에 "프로필 경로"를 하나 더 둔다

- 활성화 행이 `active` 인 학교에서만 `c_require('write')` 가 `c_basic_readiness`·`c_basic_effective` 를 봅니다.
  그 밖의 학교·상태는 R1 원래 판정(검증 작업자 heartbeat) 그대로입니다.
- 켠 학교의 쓰기 정책 = 게시된 정책 ∩ 프로필: 확장자 `['hwpx']`, 상한 `least(정책, 30MiB)`, `allowUnscanned=false`.
- 프로필을 켰는데 정책·주체가 맞지 않으면 **NOT_READY** 입니다. 작업자 경로로 넘어가지 않습니다(실패는 닫힌 쪽).
- 왜: "준비 상태 함수만 추가"나 "allowUnscanned 일괄 허용"이 아니라, 파일 1건마다 확인 기록이 있어야 받는 구조로 하라는 요청.
- 되돌리기: R1S-80 으로 학교별로 끄면 즉시 R1 원래 판정. 함수 자체는 R1S-01 의 교체 5개.

## 2. 확인 API 의 사람 확인 — service_role 호출 안에서 사람 UID 로 기존 gate 를 다시 통과

- claim/finish 는 service_role 만 부릅니다. API 는 사람 JWT 를 `/auth/v1/user` 로 확인한 UID 를 `p_actor_user_id` 로 넘깁니다.
- DB(`c_basic_member`)는 ① 현재 역할이 `service_role` 이고 `auth.uid()` 가 비어 있음(브라우저 토큰을 그대로 넘긴 요청 거부)을 확인하고,
  ② 그 트랜잭션 안에서만 `request.jwt.claims`·`request.jwt.claim.sub` 를 그 UID 로 바꿔 **기존** `member_actor`(승인 gate
  `is_approved`·`get_my_role` 포함)와 소속 잠금을 그대로 통과시킨 뒤, ③ 설정을 되돌리고 `auth.uid()` 가 다시 비었는지 확인합니다.
- 왜: 승인·소속 판정을 새로 쓰면 인증 로직이 두 벌이 됩니다. 기존 함수를 그대로 다시 쓰는 편이 어긋날 여지가 적습니다.
- 위험: 실제 PostgREST 에서 시험하지 않았습니다(실행안내 8절). 실패하면 사람 확인이 안 되므로 FORBIDDEN 쪽으로 실패합니다.
- 되돌리기: `R1S-02` 1절 `c_basic_member`.

## 3. 확인 서버 주체는 따로, service_role 연결 없이

- `svc_hwpx_basic`: 작업 목록이 정확히 `['file.basic_check']`, 학교 범위 승인 1개. `api_role_principals`(R1-05 의 service_role 연결)는 만들지 않습니다.
- 왜: R1 작업자 함수 8개는 `api_role_principals` 로 주체를 찾습니다. 기본 확인 주체를 거기 연결하면 service_role 이
  작업자 함수(검증 확정·정리)까지 그 주체로 부를 수 있게 됩니다. 연결하지 않으면 작업자 경로는 계속 닫혀 있습니다.
- 감사·outbox 행위자 = 이 주체. 요청한 소속은 details 에 남깁니다.

## 4. 읽기와 쓰기 판정을 나눔

- 쓰기(`c_file_problem`): `not_scanned` 파일은 프로필이 켜져 있고 기본 확인 근거가 있을 때만 통과.
- 읽기(`c_parent_resolve` → 새 `c_file_read_problem`): 현재 정책의 확장자·크기를 보지 않습니다. 그래서
  - 작업자 경로로 받아 둔 기존 PDF 는 HWPX 전용으로 줄어든 뒤에도 그대로 열립니다.
  - 기본 확인으로 받은 HWPX 는 프로필을 끈 뒤(R1S-80)에도 열립니다.
- 왜: 쓰기 조건이 바뀌었다고 이미 낸 자료를 못 보게 되면 안 됩니다(문서 42 §DB 6).
- 결과: **기존 PDF 가 든 초안을 다시 저장하려면 PDF 를 빼야 합니다**(시험 L103). 제출본·검토 열람은 영향 없음.

## 5. 확인 기록과 작업자 대기열은 서로 배타

- 한 파일에 `file_basic_checks` 와 `file_verification_jobs` 가 동시에 생기면 트리거가 `BASIC_PROFILE_CONFLICT` 로 막습니다.
- prepare 는 프로필 학교에서 확인 기록을 만들고, complete 는 기본 확인 파일에 작업자 작업을 만들지 않습니다.

## 6. DB 가 믿는 것과 직접 확인하는 것

- DB 가 직접 대조: 임대 token(sha256 만 저장)·만료·주체·활성화·계정, Storage 실물 id·owner, 결과 모양·코드별 일관성,
  크기·sha256 이 업로드 신고값과 같음, ready 크기 ≤ 현재 상한.
- DB 가 믿는 것: **HWPX 구조 판정(`checks.hwpx`)**. DB 는 파일 본문을 읽지 않으므로 승인된 확인 API 의 판정을 그대로 받습니다.
  시험 L45 도 그래서 "구조 위조"가 아니라 "해시 불일치 위조"를 막는 것으로 바꿨습니다.

## 7. R1-04 는 R1S-03 이 대신한다

- R1S 적용 뒤 R1-04 의 03·04·09 행은 FAIL 로 보입니다(함수 17→20, 작업 목록 CHECK 확장). R1-04 는 확정본이라 고치지 않고,
  같은 점검을 R1S 기준으로 담은 R1S-03 을 씁니다.

## 8. 중지했을 때

- `stopped` 학교는 R1 원래 판정으로 돌아갑니다. 작업자가 없으니 쓰기는 NOT_READY, 읽기는 그대로.
- 확인 중(`verifying`)이던 파일은 그대로 남습니다. 재개(R1S-81) 후 임대가 끝나면 다시 확인할 수 있습니다.
  재개 없이 오래 두면 그 파일은 "검증 대기"로 남는다는 점이 한계입니다.

## 9. 오류 모양에서 정한 것 (Codex 앱 계약은 `R1S_API계약.md`)

- 기본 확인 대상이 아닌 파일·남의 파일 claim → `NOT_FOUND` (있는지 여부를 알리지 않음)
- 횟수 제한(파일당 10분 6회, 계정당 10분 60회) → `NOT_READY`
- 임대 90초. 진행 중인 임대가 있으면 `leaseToken:null` 로 "확인 중"만 알림
- 소속 gate 실패는 R1 과 같이 봉투 없는 예외(FORBIDDEN·INACTIVE_MEMBERSHIP)
