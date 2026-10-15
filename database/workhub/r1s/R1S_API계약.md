# R1S ↔ 서버 확인 API·화면(PR #45) 계약

2026-10-16 · Claude Code → Codex. PR #45(head 2f8d9a3)의 `check_file`·`createSupabaseCollectionServer` 를 R1S 시험 DB 에
붙여 왕복 시험했습니다(`R1S_시험결과.md` III·V). 아래는 PR #45 가 지금 가정과 다르거나, 문서에 적어 둘 것입니다.

## 1. 함수

| 함수 | 부르는 쪽 | 인자 |
|---|---|---|
| `workhub_collection_basic_readiness(p_member_id text)` | 브라우저(authenticated) | |
| `workhub_file_basic_claim(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text)` | API(service_role) | 사람 UID 는 `/auth/v1/user` 로 확인한 값 |
| `workhub_file_basic_finish(p_actor_user_id uuid, p_member_id text, p_file_id text, p_request_key text, p_lease_token text, p_storage_object_id uuid, p_result jsonb)` | API(service_role) | `p_result = {profile, outcome, sizeBytes, sha256, rejectReason, checks:{size, sha256, hwpx}}` |

service_role 요청에 사람 JWT(sub)를 함께 실으면 거부됩니다(서비스 키로만 부를 것).

## 2. 응답

- readiness: R1 준비 상태와 같은 봉투. `policy.extensions` 는 항상 `['hwpx']`, `allowUnscanned` 는 `false`.
- claim
  - 이미 확정 → `{fileId, state: ready|rejected|pending_verification, file}`
  - 다른 확인이 진행 중 → `{fileId, state:'checking', leaseToken:null, leaseExpiresAt}` → **화면은 잠시 뒤 자동 재시도 안내**
  - 새 임대 → `{fileId, state:'checking', leaseToken(64 hex), leaseExpiresAt, bucket, path, storageObjectId, extension, name, claimedBytes, claimedSha256, maxFileBytes}`
  - 임대는 **90초**. API 의 다운로드·검사 예산이 이보다 짧아야 합니다.
  - 실물이 없거나(id·owner) 바뀌었으면 claim 단계에서 `rejected`(`object_missing`/`object_changed`)로 닫습니다.
  - Storage 객체 크기(`storage.objects.metadata.size`)가 신고 크기와 다르면 내려받기 전에 `rejected`(`object_size_mismatch`)로 닫습니다.

### 짧게 받은 내려받기 (2026-10-16, PR #48 과 맞춤)

| 상황 | 판정 근거 | 결과 |
|---|---|---|
| 실물 자체가 신고보다 짧음/김 | claim 이 Storage 객체 크기와 신고 크기를 대조 | claim 단계에서 영구 `rejected`, 임대 0 |
| 객체 크기는 맞는데 이번 전송만 짧음(Content-Length 불일치·연결 끊김) | API 가 받은 바이트 < 신고 크기 | `RESULT_UNKNOWN`, finish 하지 않음. 파일은 확인 중, 임대는 90초 뒤 만료 |
| 위 뒤 같은 요청 번호로 재시도 | 임대 중이면 `checking`(→ `pending_verification`), 만료 뒤면 새 임대 | 온전히 받으면 `ready` |

PR #48 의 `check_file` 이 짧은 전송을 영구 거절하지 않는 것은 맞습니다. 다만 그 근거만으로는 "실물이 짧은 파일"이 영원히 확인 중에
남으므로, 실물 크기는 DB 가 Storage 기록으로 먼저 판정합니다. metadata 에 크기가 없는 객체는 claim 이 판정하지 않습니다(실제 Storage 는 업로드 뒤 크기를 적습니다 — 실환경 미검증).
- finish → `{fileId, state: ready|rejected, file}`. ready 파일은 `scan_state:'not_scanned'`, `verification.malwareScan:false`.

## 3. 오류 — PR #45 가 지금과 다르게 다뤄야 할 것

| 상황 | R1S 응답 | PR #45 현재 | 요청 |
|---|---|---|---|
| 기본 확인 대상이 아닌 파일·남의 파일 claim | `NOT_FOUND` | 그대로 전달 | 문서에 명시 |
| 횟수 제한(파일당 10분 6회, 계정당 10분 60회) | `NOT_READY` | 일시 실패 | "잠시 뒤 다시"로 안내 |
| 같은 요청 번호·같은 파일·**다른 결과** | `CONFLICT` | — | 영구 실패로 |
| 같은 요청 번호·다른 파일 | `IDEMPOTENCY_CONFLICT` | `RESULT_UNKNOWN`(무한 재시도 가능) | 새 요청 번호로 다시 claim |
| 소속 gate 실패 | 봉투 없는 PostgREST 오류(HTTP 400, `P0001`, message `FORBIDDEN`/`INACTIVE_MEMBERSHIP`) | `RESULT_UNKNOWN` | message 를 보고 FORBIDDEN·INACTIVE_MEMBERSHIP 로 옮기기 |
| 임대 만료·token 불일치·실물 변경 | `CONFLICT` | — | 다시 claim |

## 4. 화면·운영

- 프로필을 끈 학교(R1S-80) · R1S 미설치에서도 **읽기는 열려 있어야 합니다**(PR #45 검토 필수 2번). readiness 가 false 여도 목록·상세·내려받기는 R1 함수로 됩니다.
- 기존 PDF 가 든 초안은 다시 저장할 때 PDF 를 빼라는 안내가 필요합니다(`R1S_설계결정.md` 4절).
- `SUPABASE_SERVICE_ROLE_KEY` 는 Vercel Production 범위에만.
