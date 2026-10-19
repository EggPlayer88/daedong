# HWPX 전용 간소 수합 — Claude DB 변경 요청

2026-10-16 · `feat/workhub-hwpx-simple` · **SQL 작성 요청서이며 실행할 SQL이 아니다.**

## 사용자 결정과 이번 범위

사용자는 승인된 교사가 확인한 HWPX 파일을 올린다는 전제로, 복잡한 문서 검사보다 양식 등록·정보 입력·제출·현황 확인·전체 다운로드에 집중하도록 승인했다. 별도 검사 서버와 ClamAV 운영은 보류한다. PDF·HWP·DOCX·XLSX·PPTX 새 업로드는 이번 수합 범위에서 제외한다.

Codex는 앱과 기존 Vercel에서 실행할 최소 확인 API를 준비한다. Claude는 이 문서와 구현을 대조해 **새 증분 SQL**을 작성하고 시험한다. 계란님이 검토된 SQL을 직접 실행한다. 이미 적용한 R0·R1 SQL 파일을 수정하거나 재실행하지 않는다. 기존 로그인·회원·학교 연결·자료·권한을 보존한다.

**현재 Supabase에 R1-00~04까지 적용됐다는 사용자 보고가 있다. R1-05·06 실행 보고는 없다. 기존 R1-05·06 양식을 그대로 적용하거나, `allowUnscanned=true`만 일괄 게시해 새 흐름을 열지 않는다.** 서버 배포 준비 PR #44는 별도 보류다. 이번 구현만 배포해도 아직 DB에서 제출을 열 수 없다.

## 사용자 흐름과 최소 확인의 의미

1. 담당자가 제목·안내·마감일·대상 교사·HWPX 양식·필요한 입력 항목을 등록한다.
2. 교사는 양식을 내려받아 작성하고 필요한 입력과 HWPX를 제출한다.
3. 파일은 기존 Supabase 비공개 버킷으로 직접 올라간다. 원문을 Vercel 요청 본문에 넣지 않는다.
4. Vercel API가 로그인 사용자와 해당 파일의 권한을 확인한 뒤, DB가 지정한 원본을 읽어 최소 확인을 수행한다.
5. 확인 결과가 DB에 확정된 파일만 초안·양식에 첨부하고 제출할 수 있다. 업로드 완료와 제출 완료는 구분한다.
6. 기존 수정 제출·철회·정정·검토·이력·전체 ZIP 기능을 이어 쓴다.

최소 확인 프로필 이름은 **`hwpx_basic_v1`**이다. 확인하는 것은 파일 크기·SHA-256 일치, HWPX ZIP의 기본 구조·필수 항목·`mimetype`다. ZIP 항목 수·선언 확장량·항목별 크기 상한은 API 자원 보호를 위해 확인한다. 전체 XML 해석·전체 압축 항목 CRC 확인·문서 렌더링·악성코드 검사·문서 내용의 정확성 검사는 하지 않는다. 정상 파일이라고 보증하거나 악성코드 검사를 `clean`으로 기록하지 않는다.

기술 한도 원본은 `apps/main/api/collections/_assets/hwpx-basic.json`이다. 현재 원문 최대 **30 MiB(31,457,280바이트)**, ZIP 항목 최대 4,096개, 선언 확장량 최대 128 MiB, 항목당 선언 크기 최대 64 MiB, `mimetype` 최대 128바이트다. 이 값은 학교 정책을 확정한 것이 아니다. 실제 업로드 상한은 기술 한도·현재 학교 정책·수합별 정책 중 가장 낮은 값이다. SQL에서 100 MiB까지 허용하던 기존 기술 한도를 새 프로필에 그대로 적용하면 안 된다.

## 이미 구현된 R1에서 함께 바꿔야 하는 부분

아래는 `database/workhub/r1/R1-01_정책_파일_실행.sql`과 `R1-03_공개함수_Storage.sql`을 읽어 확인한 의존성이다. 공개 readiness 함수 하나만 추가해서는 작동하지 않는다.

| 기존 경로 | 현재 동작 | 새 SQL 요구 |
|---|---|---|
| `c_readiness`·`c_verifier_ok` | 활성 작업자·학교 범위·120초 heartbeat·검사 능력을 요구 | 학교가 기본 프로필을 명시적으로 활성화했으면 별도 서버 heartbeat 없이 준비 상태 판정 |
| `c_require(ctx, 'write')` | `c_readiness`를 통해 수합 생성·수정·업로드·제출을 차단 | 기본 프로필의 쓰기 게이트로 분기. 조회 화면만 ready이고 저장은 막히는 상태 방지 |
| `c_prepare` | 6종 확장자와 공통·학교·수합 정책 검사 | 신규 기본 프로필 수합·새 업로드에는 `hwpx`만, 30 MiB 이하를 서버에서도 강제 |
| `c_complete` | 소유한 Storage 객체 ID를 고정하고 `file_verification_jobs`에 등록 | 소유자·실물 고정은 유지하되 기본 확인 경로로 연결. 기존 작업자와 같은 파일을 중복 인수하지 않음 |
| `file_objects_ready_check`·`file_objects_guard` | 실측 해시·용량·확인 주체·시각을 요구, 완료 결과 불변 | 기본 확인의 근거도 보관. CHECK/가드를 제거해 브라우저 주장만으로 ready 처리하지 않음 |
| `c_file_problem` | `not_scanned`는 현재·예약 시점 공통/학교의 `allowUnscanned`를 모두 요구 | 기본 프로필 승인·실측 결과를 분리해 판정. 일반 미검사 파일 전체를 허용하지 않음 |
| `c_parent_resolve`·`c_access`·Storage SELECT | 현재 권한·접근 기록·ready 파일만 읽기 | 기존 권한 재검사·비공개·서명 URL 차단 유지. ready 전 원본을 교사에게 직접 공개하지 않음 |
| 기존 `worker_claim`·`cleanup_claim` | 검사 작업과 정리 원장을 처리 | 기본 확인 임대와 상호 배타적으로 동작. 정리 원장이 생긴 파일은 새 확인·완료도 영구 거부 |

## 앱·API 계약

### 1. 준비 상태

새 공개 함수:

```text
public.workhub_collection_basic_readiness(p_member_id text) → jsonb
```

호출은 기존 교사 JWT의 `authenticated` 역할로 한다. `member_actor`와 같은 현재 승인·계정·학교·소속 검사를 통과해야 한다. 기존 표준 봉투를 유지한다.

```json
{
  "contractVersion": 1,
  "schoolId": "실제 학교 ID",
  "memberId": "요청한 현재 소속 ID",
  "data": {
    "available": true,
    "reason": "ready",
    "policy": {"extensions": ["hwpx"], "maxFileBytes": 31457280, "maxFiles": 1}
  }
}
```

위 크기·개수는 **응답 모양의 예시**다. 운영 정책 게시값으로 복사하지 않는다. 실제 승인 정책을 반환하고 더 낮은 수합 정책을 별도로 적용한다.

기존 사유 열거형을 유지한다: `ready`, `database_missing`, `storage_missing`, `verification_missing`, `policy_missing`. `available=false`면 `policy=null`이다. 새 함수가 없으면 앱은 준비 중으로 닫는다. 기존 `workhub_collection_readiness`로 자동 대체하거나 기존 ready 결과를 새 프로필 승인으로 해석하지 않는다.

`ready`에는 R1S 적용 여부, 전체/쓰기 중지 여부, 비공개 Storage와 기존 정책 무결성, 학교별 기본 프로필 승인·배포 확인, 현재 유효한 학교·공통·수합 운영 정책이 필요하다. 새 API가 실제 배포되고 서버 환경값과 왕복이 확인되기 전에는 관리자가 프로필을 활성화하면 안 된다. 상시 heartbeat를 요구하지 않으므로 활성화 후 API 장애는 readiness만으로 실시간 검출하지 못한다. 이 경우 파일은 완료되지 않고 재시도 안내를 표시한다.

### 2. 브라우저에서 Vercel로 보내는 요청

```text
POST /api/collections/check-hwpx
Authorization: Bearer <현재 사용자 access token>
Content-Type: application/json

{"memberId":"소속 ID","fileId":"업로드 파일 ID","requestKey":"기존 요청 번호"}
```

사용자 ID·학교 ID·Storage 경로·해시·확인 결과는 브라우저가 이 요청에서 지정하지 않는다. `requestKey`는 기존 수합 계약의 8~200자 문자열이다. 회원/소속/파일 식별자는 기존 식별자 계약을 따르며 UUID만으로 좁히지 않는다. 브라우저에 반환할 결과도 기존 `CollectionFileStatus`와 표준 학교·소속 봉투를 따른다.

서버는 `/auth/v1/user`로 JWT를 검증한 실제 사용자 ID만 아래 RPC의 `p_actor_user_id`로 보낸다. 사용자 JWT를 단순 디코딩한 값이나 POST 본문의 사용자 ID를 믿지 않는다. service_role은 사용자 권한을 대신하지 않는다. RPC 내부에서도 전달된 실제 사용자와 소속·학교·파일 소유자·원본 수합의 현재 권한을 다시 대조해야 한다.

### 3. 기본 확인 인수

```text
public.workhub_file_basic_claim(
  p_actor_user_id uuid,
  p_member_id text,
  p_file_id text,
  p_request_key text
) → jsonb
```

`PUBLIC`·`anon`·`authenticated`에 실행권을 주지 않고 서버의 `service_role`만 허용한다. 기존 내부 스키마/표 직접 접근권은 계속 0이다. 보안 정의자 함수의 `search_path`를 고정한다. 허용된 서비스 주체·활성 학교 범위를 감사 가능한 방식으로 연결하며 파일 정리 권한을 함께 발급하지 않는다.

응답은 `contractVersion=1`, `schoolId`, `memberId`, `data` 봉투다. 허용 형태는 아래 세 가지다.

| 상황 | `data` |
|---|---|
| 이미 확정됨 | `{fileId,state:'ready'\|'rejected',file:FileReference\|null}` |
| 다른 요청이 유효한 임대로 처리 중 | `{fileId,state:'checking'}` — `leaseToken` 없음 |
| 이 호출이 인수함 | 아래 전체 필드 |

```json
{
  "fileId": "파일 ID",
  "state": "checking",
  "leaseToken": "불투명 문자열",
  "leaseExpiresAt": "ISO 8601 만료 시각",
  "bucket": "workhub-collection-files",
  "path": "학교ID/파일ID/예약시발급한난수",
  "storageObjectId": "complete가 고정한 Storage 객체 UUID",
  "name": "양식.hwpx",
  "extension": "hwpx",
  "claimedBytes": 1234,
  "claimedSha256": "소문자 16진수 64자리",
  "maxFileBytes": 31457280
}
```

`maxFileBytes`는 현재 정책과 원본 예약 정책·수합 정책을 반영한 상한이며 서버는 기술 한도와 다시 비교한다. `leaseToken`은 양의 정수였던 R1 worker 토큰과 달리 **불투명 문자열**이며 `[A-Za-z0-9_-]{16,200}` 형식이다. API가 읽는 `path`는 기존 `학교ID/파일ID/난수` 구조를 유지한다. 임대·경로·객체 정보는 서버 내부에서만 사용하고 브라우저 응답에 포함하지 않는다.

인수의 필수 조건:

- 현재 승인된 동일 계정·소속·학교·원본 수합 접근권과 해당 업로더 권한을 확인한다. 같은 학교라는 이유만으로 다른 교사의 미확정 파일을 인수하지 않는다.
- `complete`를 통과한 실물만 받는다. 기존 고정 `storage_object_id`, 현재 `storage.objects.id`, 업로드 소유자, 버킷·경로가 일치해야 한다. 파일 이름만 보고 찾아가지 않는다.
- 기본 프로필의 유효한 승인과 정책을 적용한다. 기존 폐기·격리·거절·정리 원장 파일을 되살리지 않는다.
- 파일당 하나의 유효 임대만 발급한다. 계정·학교·동시 요청 경합과 기존 검증 작업자를 포함해 중복 인수를 막는다.
- 파일·주체·요청 번호를 멱등성 범위에 포함한다. 같은 번호로 다른 파일/매개변수 요청 시 `IDEMPOTENCY_CONFLICT`를 반환한다.
- 같은 요청 재전송은 진행 중 또는 확정 결과를 돌려준다. 연결 끊김 후 임대가 만료되면 **같은 요청 번호로 재인수**할 수 있어야 한다. 새 인수는 새 토큰을 발급하며 이전 토큰은 완료할 수 없다.
- 재시도 횟수와 짧은 연속 인수 제한을 정하고 명시한다. 제한에 걸렸다고 파일이 통과하거나 자동 삭제되지 않는다. 정기 작업자 없이도 다음 사용자 요청으로 복구할 수 있어야 한다.

### 4. 기본 확인 확정

```text
public.workhub_file_basic_finish(
  p_actor_user_id uuid,
  p_member_id text,
  p_file_id text,
  p_request_key text,
  p_lease_token text,
  p_storage_object_id uuid,
  p_result jsonb
) → jsonb
```

실행권과 봉투는 claim과 같다. `p_result` 계약:

```json
{
  "profile": "hwpx_basic_v1",
  "outcome": "ready",
  "sizeBytes": 1234,
  "sha256": "서버가 실제로 읽어 계산한 소문자 16진수 64자리",
  "rejectReason": null,
  "checks": {"size": true, "sha256": true, "hwpx": true}
}
```

- `outcome`은 `ready` 또는 `rejected`다. `ready`는 세 checks 모두 true, 실제 크기/해시와 예약값 일치, 확장자 HWPX, 현재 승인 프로필과 정책 만족이 필요하다.
- `rejected`는 `rejectReason`에 API 구현의 고정된 짧은 코드를 둔다. 원문 파일명·사용자 입력·외부 오류 메시지를 넣지 않는다. 전체 원문을 읽지 못한 초과 파일은 `sizeBytes`·`sha256`가 null일 수 있다. 이를 `ready`에서 허용하면 안 된다. 기존 rejection CHECK를 함께 검토한다.
- API의 거절 코드는 `FILE_SIZE_LIMIT`, `FILE_SIZE_MISMATCH`, `FILE_HASH_MISMATCH`, `FILE_SIGNATURE_MISMATCH`, `FILE_STRUCTURE_LIMIT`, `FILE_STRUCTURE_INVALID`, `FILE_ENCRYPTED`, `FILE_STRUCTURE_UNSUPPORTED`, `FILE_HWPX_REQUIRED_PART`다. 현재 DB의 `reject_reason`은 소문자만 허용한다. finish는 이 고정 allowlist를 검증한 뒤 명시적 DB 코드로 매핑한다. 기존 CHECK를 느슨하게 풀거나 알 수 없는 문자열을 그대로 저장하지 않는다.
- `scan_state='clean'`, `checks.malware=true`, 기존 심층 검사 `container=true` 등을 수행하지 않았는데 채우지 않는다. `hwpx_basic_v1`의 별도 근거를 저장하고 `not_scanned`와 구분 가능한 프로필 판정으로 사용 가능 여부를 결정한다. 기존 레코드의 검증 이력을 다시 쓰지 않는다.
- finish 시점에 계정 승인·소속·학교·업로더·원본 권한·정책·중지 상태·정리 원장·임대 주체/만료/토큰·고정 Storage 객체 ID를 **동일 트랜잭션에서** 다시 대조한다. claim 이후 권한 회수·정책 변경·실물 교체 시 성공으로 확정하지 않는다.
- 파일 결과·임대 완료·멱등 영수증·감사·outbox는 한 트랜잭션이다. 같은 결과의 같은 요청 재전송은 동일 확정 결과, 다른 결과는 `CONFLICT`여야 한다.
- 권한/정책 오류나 인증·다운로드·서버 오류는 파일 내용이 잘못됐다는 뜻이 아니다. API는 성공으로 바꾸거나 임의의 새 요청 번호로 다시 제출하지 않는다. 임대 만료 후 같은 번호로 재시도한다.

완료 응답의 `data`는 기존 status 계약이다.

```json
{"fileId":"파일 ID","state":"ready","file":{"id":"파일 ID","name":"양식.hwpx","extension":"hwpx","bytes":1234,"sha256":"소문자 16진수 64자리"}}
```

파일의 확정 거절은 **HTTP 200의 정상 응답 봉투에 `state='rejected', file=null`**로 반환한다. 파일 내용이 잘못됐다는 판단은 이 확정 상태로만 표시한다.

claim/finish의 예상 가능한 업무 실패는 **HTTP 200의 표준 `error` 봉투를 필수로 사용한다.** PostgreSQL `RAISE EXCEPTION 'NOT_READY'` 같은 원시 예외로 대체하지 않는다. `error.code`는 기존 짧은 업무 코드(`NOT_READY`, `INVALID_INPUT`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `FILE_NOT_READY`, `FILE_FAILED`)만 사용한다. 예를 들면 다음과 같다.

```json
{"contractVersion":1,"schoolId":"학교 ID","memberId":"소속 ID","error":{"code":"NOT_READY"}}
```

아직 학교·소속 봉투를 안전하게 구성할 수 없는 사전 권한 게이트 실패와 예상하지 않은 SQL 오류만 원시 예외로 올린다. API는 원시 PostgREST 오류 메시지를 해석하거나 공개하지 않고 실패로 닫는다. HTTP 상태에 따른 인증·접근 거부 및 함수 미등록 판정 외의 원시 오류는 `RESULT_UNKNOWN`이다. SQL 원문·예외 DETAIL·키·경로를 교사에게 반환하지 않는다.

API는 표준 업무 오류를 읽어 HTTP 오류 상태로 변환하되, **현재 브라우저는 비정상 HTTP 응답 중 401·403만 권한 거부로 분류하고 나머지는 `RESULT_UNKNOWN`으로 보존한다.** 배포 미준비·정책/임대 충돌·일시 장애를 확정 파일 거절로 오해해 원본과 요청 번호를 버리는 일을 막기 위한 선택이다. 파일 자체의 확정 거절은 앞서 설명한 HTTP 200의 `rejected`만 해당한다. 이 동작을 바꾸려면 원본 파일·기존 요청 번호를 유지하는 화면 복구 방식과 함께 변경해야 한다.

API의 외부 왕복 처리 예산은 **45초**, 브라우저 HTTP 호출과 수합 어댑터의 파일 확인 전용 제한은 각각 **55초**다. 일반 목록 조회·파일 메타데이터 처리의 기존 제한을 파일 확인 경로에 재사용하지 않는다. 제한을 넘기거나 응답을 받지 못하면 확정 실패로 간주하지 않고 같은 요청 번호로 복구한다. SQL 임대 시간은 이 처리 예산과 왕복 여유를 수용하도록 정하고 시험해야 한다.

## DB 설계에서 보존해야 하는 것

1. **기존 자료 읽기:** 이전 PDF/HWP/Office 파일과 기존 제출판을 삭제·재검사·거절로 바꾸지 않는다. 목록·상세·다운로드·ZIP의 FileReference는 역사 자료를 계속 읽는다. HWPX-only는 새로운 수합/새 업로드의 정책이다. 공통 `file.safety.extensions`를 단순히 `['hwpx']`로 덮어써 기존 `c_file_problem`에서 과거 파일을 막지 않는다. 새 작성과 기존 읽기의 정책 판정을 분리하고 회귀로 증명한다.
2. **기존 수합 이력:** 제출판·철회·정정·담당자 승인·접수 번호·요청 번호·감사/outbox를 그대로 유지한다. 문서 내용 자동작성·빈칸 AI 채움은 이번 DB 변경에 포함하지 않는다.
3. **기존 회원과 접근권:** 공개 범위와 가입 승인 흐름을 바꾸지 않는다. 학교가 다른 자료, 다른 교사의 초안, 이미 종료된 소속에 대한 거부를 유지한다. 새 프로필은 소속 인증을 우회할 명분이 아니다.
4. **파일 원본 불변:** `complete` 이후 동일 경로 덮어쓰기 금지, 원본 객체 ID 고정, 다른 객체 대체 거부, 정리 원장의 영구 차단을 유지한다. SQL에서 `storage.objects`를 직접 삭제하지 않는다.
5. **기존 작업 기록:** 기존 검증 작업·임대·cleanup 원장을 삭제하거나 일괄 성공 처리하지 않는다. 활성 기존 임대와 기본 확인이 충돌하면 안전하게 멈추고 재인수 규칙을 명시한다. 새 기본 확인의 유효 임대는 cleanup의 삭제 후보가 되지 않아야 한다.
6. **중지와 복구:** 기본 프로필을 끄면 새 업로드/확정/제출을 닫고, 기존 확정 자료의 허용된 읽기는 계속 가능하게 한다. 전체 중지와 쓰기 중지는 기존 의미를 보존한다. 재개 시 만료 임대와 같은 요청 번호가 안전하게 복구돼야 한다.
7. **정리 기능:** 별도 서버를 보류하면서 자동 임시 파일 정리도 활성화하지 않는다. 미첨부 파일은 당분간 남을 수 있으며 보존일 경과만으로 자동 삭제됐다고 표시하지 않는다. 향후 정리 도입은 별도 승인·시험으로 진행한다.

서비스 주체 설계는 기존 `workhub_private.api_role_principals`가 활성 service_role 연결 한 개를 전제로 하는 부분을 반드시 확인한다. 새 주체를 임의로 중복 등록하거나 기존 주체에 정리 권한을 덧붙이지 않는다. 기존 연결 유무를 먼저 조사하고, 기본 확인만 허용하는 범위/작업 코드를 선택해 설계 근거와 실제 SQL 시험을 제시한다.

## Claude에게 요청하는 산출물과 SQL 시험

별도 PR에 **R1S 증분 배치**로 작성해 달라. 번호는 제안이며 최종 파일명은 실행 안내와 일치시키면 된다.

| 단계 | 요청 산출물 |
|---|---|
| R1S-00 | 읽기 전용 현재 상태·전후 지문. R0/R1 버전, 기존 05/06 적용 여부, 작업자/임대, 함수/권한, 정책 상태, 기존 회원·제출·Storage 목록 확인 |
| R1S-01 | 프로필/근거/임대 모델과 내부 쓰기·파일 사용 판정 보완. 새 프로필 기본 비활성 |
| R1S-02 | readiness·claim·finish 공개 계약 및 권한. 필요한 기존 함수 교체는 증분 파일에서만 수행하고 전제 지문을 확인 |
| R1S-03 | 사후 점검. 함수 계약·권한·RLS·Storage·프로필 비활성 확인. 비활성 상태는 정상 안내 |
| R1S-04 | 사용자 입력형 학교별 정책·최소 권한 서버 연결·배포 확인·프로필 활성화. 이전 05/06 대체 관계 명시. 아직 확인하지 않은 날짜/수치/배포 확인값을 미리 넣지 않음 |
| R1S-80/81 | 비파괴 중지·재개. 자료 삭제·DROP·원본 과거판으로 일괄 변환 없음 |

최종 SQL에 최소 다음 시험과 결과를 포함해 달라.

- 적용 전후 기존 auth/public 회원, 기존 제출/파일 목록, R0 구조·자료 지문 동일. R1 변경 함수/신규 표의 허용 차이만 따로 목록화.
- R1S 미적용·프로필 비활성·정책 없음·비공개 정책 손상·전체 중지에서는 readiness가 닫힘. heartbeat가 없어도 명시 활성화한 HWPX 프로필만 정상.
- 새 수합 생성→양식 업로드→complete→claim→finish→파일 연결→게시→교사 초안→제출→권한 있는 다운로드까지 실제 앱 계약으로 왕복.
- 신규 PDF/HWP/Office, HWPX로 이름만 바꾼 파일, 30 MiB 초과, 더 낮은 학교/수합 제한 초과를 서버에서 거부. 기존 PDF 포함 자료의 조회·다운로드·ZIP은 보존.
- 브라우저 `authenticated`와 `anon`이 claim/finish를 직접 실행하지 못함. service_role 호출도 잘못된 사용자/소속/학교/파일/정책/서버 연결이면 거부.
- 동일 요청 재전송·동시 claim·임대 만료 재인수·이전 토큰 finish·다른 파일에 요청 번호 재사용·응답 단절 후 동일 finish 재시도.
- claim 뒤 소속/승인/역할 회수, 정책 축소, 학교/전체 중지, 원본 수합 접근 종료, Storage 객체 삭제/교체 각각에서 확정 성공 금지.
- complete 전 claim 거부, 준비만 된 브라우저 `claimedSha256`로 ready 금지, 실측 해시/용량 불일치 거부, null 결과로 ready 금지, 검사 안 한 malware를 clean으로 위장 금지.
- cleanup 원장 이후 complete/claim/finish 모두 거부. 기존 cleanup 임대와 새 확인 임대의 경합, 기본 확인 중 cleanup 인수 거부, 원장 후 같은 경로 재업로드 거부.
- 기존 작업자의 큐·임대·완료 기록 유지. 기본 확인 결과를 기존 worker가 다시 봉인하거나 덮어쓸 수 없음.
- `ready` 전 직접/서명 다운로드 차단, ready 후 현재 권한으로 직접 다운로드 허용, 권한 회수 후 차단. SQL 대역시험과 실제 Storage 시험은 구분해 보고.
- API가 사용하는 정확한 필드/형식/프로필을 실제 SQL 응답과 맞춰 검증. 제안 계약을 변경해야 하면 SQL을 배포하기 전에 Codex에 알려 앱과 동시에 조정.

## 환경값·적용 순서·이번 작업의 한계

API가 사용하는 서버 환경값은 `SUPABASE_URL`과 `SUPABASE_SERVICE_ROLE_KEY`다. 기존 `VITE_SUPABASE_URL`은 URL 대체값으로만 사용할 수 있으며 두 URL이 모두 있으면 같은 프로젝트여야 한다. 서버용 키는 **새 서버 전용 설정 항목**이며, 공개 접두어 `VITE_`로 만들거나 앱 번들·Git·문서에 값을 넣지 않는다. 새 Supabase secret과 기존 service_role JWT를 지원하지만 실제 환경값 생성/변경은 이번 코드 작업에서 하지 않는다. 기존 로그인·문서 AI의 환경값을 교체하지 않는다.

권장 순서는 다음과 같다.

1. Claude 증분 SQL 작성·독립 PostgreSQL 시험 → Codex 재검토.
2. 계란님이 R1S-00 지문 저장 → 비활성 상태의 R1S-01~03 적용 → 지문/사후 점검 확인.
3. 앱/API PR 검토·사용자 병합, Vercel의 서버 환경값 설정, 배포 확인. 아직 프로필을 열지 않는다.
4. 프로필 활성화 전 가능한 인증 실패·미설정 상태·서버 계약 확인을 수행한다. 실제 파일 왕복은 승인한 시험 범위에서 학교별 활성화를 진행한 뒤 확인하고 실패 시 즉시 비파괴 중지한다.
5. 사용자와 정책·배포 확인값을 확정해 R1S-04 적용. 나중에 묶어서 할 실사용 확인에 실제 업로드·서버 원본 확인·제출·권한·철회/정정·ZIP·모바일·오류 복구를 포함한다.

아직 수행하지 않은 것: SQL 작성·적용, 서버 키 등록, 운영 API 배포, 실제 Supabase/PostgREST/Storage 왕복, 학교에서 쓰는 실제 HWPX 호환성 확인. 앱·API 자동시험의 통과를 이 항목의 완료로 적지 않는다. 별도 검사 서버·ClamAV·작업자 heartbeat·정리 스케줄러·시간표·문서작성 AI 작업은 계속 보류한다.

## 판단해서 정한 것

| 선택 | 이유 | 변경 위치 |
|---|---|---|
| 신규 쓰기는 HWPX, 과거 읽기는 유지 | 사용자가 범위를 줄여도 기존 자료를 잃지 않게 함 | 앱 신규 정책과 R1S 쓰기/읽기 정책 분기 |
| Vercel 요청 시 최소 확인 | 상시 검사 서버 없이 기존 사이트·Storage 활용 | `apps/main/api/collections/`와 새 claim/finish |
| 서비스 역할만 결과 확정 | 브라우저의 형식·해시 주장을 신뢰하는 우회 방지 | 새 RPC 실행권과 실제 사용자 재확인 |
| 별도 프로필 근거와 관리자 활성화 | 악성코드를 검사하지 않았다는 사실과 승인 범위를 정확히 보존 | R1S 정책·증거·readiness |
| 파일·요청 번호 유지 재시도 | 네트워크 오류에서 재업로드·중복 제출을 줄임 | claim/finish 임대·멱등 계약 |
| 신규 SQL 적용 전 준비 중 | 기존 ready나 allowUnscanned로 우회해 자료를 열지 않음 | 앱 readiness와 서버 API 오류 처리 |

## 클로드에게 전달할 짧은 요청

> 계란님이 문서 수합을 HWPX 전용·최소 확인 방식으로 간소화하고 별도 검사 서버를 보류하기로 했습니다. `docs/workhub/42-hwpx-basic-collection-request.md`와 이 PR의 앱·Vercel API 구현을 함께 검토해 주세요. 기존 R1-00~04는 보존하고 R1S 증분 SQL을 별도 PR로 작성해 주세요. 핵심은 새 basic readiness, 서버 전용 claim/finish, 기존 쓰기 게이트와 not_scanned 판정의 프로필별 분기, 기존 자료/권한/요청 번호/정리 원장 보존입니다. R1-05·06을 그대로 실행하거나 allowUnscanned 일괄 허용으로 대체하지 않습니다. 자동 SQL 시험과 실제 API 응답 계약 대조, 비활성 설치→배포 확인→학교별 활성화 순서를 포함해 주세요. SQL 적용은 계란님과 진행하며 실제 서비스 확인은 이후 한꺼번에 진행합니다.
