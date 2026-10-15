# R1 파일형 문서 수합 — Claude SQL 작성 요청서

2026-10-15 · Codex 작성 · SQL 작성/검토 전달용 · 실행은 계란님

## 1. 요청과 현재 상태

이미 적용한 R0 기반 위에 파일형 수합의 저장·공동 초안·제출·검토·보완·철회와 비공개 Storage 연결을 추가할 **R1 SQL 확정안 및 검증 자료**를 작성해 주세요. 대상은 기존 Supabase 프로젝트 `dhaoszbqtbofqftgjfyb`입니다. 이 문서는 SQL 실행 승인이나 실행 결과가 아닙니다. SQL 작성·교차 검토 → 사용자 적용 → 서버 검증기 구현/배포 및 준비 상태 확인 → 통합 실사용시험 순서로 진행합니다. 실사용시험은 이번 작성 단계에서 진행하지 않습니다.

현재 확인한 R0 범위는 `workhub` 기반·일정·개인 업무와 공개 호환 함수 7개입니다. 사용자가 초기 설정 검사 및 전후 지문 통과, 학교 표시와 업무실 진입을 확인했습니다. 이것을 수합·Storage 왕복, 저장된 모든 자료 내용, 파일 본문 보존이 검증됐다는 뜻으로 확대하지 않습니다. 기존 R0 파일을 다시 실행하거나 수정하지 않습니다.

이번 앱 PR은 **클라이언트 RPC/Storage 전송과 비동기 화면 경계**를 제공합니다. 파일 실물을 검사하는 서버 검증기는 아직 구현·배포하지 않았습니다. SQL을 적용해도 검증기 또는 승인된 정책이 없으면 `available:false`여야 합니다. 브라우저가 계산한 SHA-256, 업로드 성공, `storage.objects` 메타데이터만으로 파일을 검증 완료로 처리하지 않습니다.

### 정본과 읽을 파일

- 저장소 규칙: [CLAUDE.md](../../CLAUDE.md). SQL 확정·실행 역할과 인증·정책 승인 경계를 유지합니다.
- 앱 전송 계약: [collections/contracts.ts](../../apps/workhub/src/collections/contracts.ts), [supabase-collections.ts](../../apps/workhub/src/collections/supabase-collections.ts), [validation.ts](../../apps/workhub/src/collections/validation.ts), [legacy-storage.ts](../../apps/workhub/src/collections/legacy-storage.ts).
- 기존 화면 DTO: [workflows/types.ts](../../apps/workhub/src/workflows/types.ts). 프리뷰 [store.ts](../../apps/workhub/src/workflows/store.ts)는 현재 화면 동작 참고이며 서버 권한 정본이 아닙니다.
- 파일 표시/입력 계약: [files/contracts.ts](../../apps/workhub/src/files/contracts.ts), [files/validation.ts](../../apps/workhub/src/files/validation.ts).
- 통합 설계: [02-workflows-documents.md](database-integrated/02-workflows-documents.md) §2·6~9·11·13, [api-contracts.json](database-integrated/api-contracts.json) API-08/09/10/17, [workflows-changes.json](database-integrated/workflows-changes.json), [schema-contract.json](database-integrated/schema-contract.json).
- 적용한 R0: 바탕화면 저장소 `클로드작업/R0_DB구축/`의 `R0_설계결정.md`, `R0_호환함수_입출력예시.md`, `R0-01_B01_기반.sql`, `R0-02_B02_일정업무.sql` 및 실제 적용 결과. 복사본과 적용본이 다르면 적용본을 먼저 확인합니다.

이 요청서의 R1 호환 API는 통합 설계 전체를 구현했다는 선언이 아닙니다. 미지원 기능을 빈 성공으로 흉내 내지 말고 지원 범위·보류 제약·후속 의존성을 처분표에 남겨 주세요.

## 2. 보존 조건과 이번 범위

1. 기존 `public`·`auth` 자료, 회원 승인·로그인 함수, 기존 평가계획서·제출, R0 일정·개인 업무·접수·감사 자료를 보존합니다. 기존 공개 RPC를 교체하거나 재설정하지 않습니다.
2. 기존 `legacy_gate`/`member_actor` 경로를 재사용합니다. 승인된 superadmin, 첫 관리자 연결 범위를 유지하며 교사 계정 일괄 연결·승격·메뉴 공개 확대는 하지 않습니다. 첫 관리자만 연결되어 있다는 사실은 자기검토 금지를 완화할 근거가 아닙니다.
3. `workhub`/`workhub_private`를 PostgREST 노출 schema로 추가하지 않습니다. 공개 호환 함수는 `public.workhub_*`, 내부 함수는 비공개 schema에 두며 `SECURITY DEFINER`, 빈 `search_path`, 완전 수식 이름과 최소 EXECUTE 권한을 사용합니다.
4. 기존 Storage bucket·object·정책을 재작성하지 않습니다. R1 전용 비공개 bucket과 제한된 추가 정책의 정확한 변경 목록을 제출합니다. 기존 permissive 정책이 새 bucket까지 허용하면 정책 간 OR 때문에 새 제한 정책만으로 보호되지 않습니다. 이 경우 준비 완료를 차단하고 기존 정책에 필요한 최소 변경을 별도 승인 항목으로 제시합니다.
5. `R0-90_되돌림.sql`은 사용하지 않습니다. 후속 표가 생긴 R0 전체를 지우는 되돌림은 이 작업의 복구 절차가 아닙니다.
6. 이번 입력은 글 1개·숫자 1개·파일 묶음과 직접 지정한 제출 단위입니다. AI 양식 분석·문답·출력 생성, 인계, 결과 전체 공개, 명부 이관, 서버 ZIP 작업은 범위에 넣지 않습니다. 검토형/무검토형의 현재판·완료본 구분은 유지합니다.

서버 화면은 요청 작성/게시·파일 준비·초안 저장/최종 제출·검토/보완·현재 파일 내려받기를 우선 연결합니다. `withdraw`와 `open_correction`은 어댑터/SQL 명령 계약에는 포함되지만 이번 화면의 조작 UI는 후속입니다. 프리뷰의 고급 현황표·공동 제출 단위 설정·과거판 탐색·ZIP 등과 서버 화면이 모두 동일하게 연결됐다고 보고하지 않습니다. SQL은 아래 명령 계약을 모두 준비하고, 각 기능의 `DB 구현/클라이언트 전송/화면/환경시험` 상태를 인계표에 따로 적어 주세요.

## 3. 공개 RPC와 봉투 계약

모든 함수는 `p_member_id text`를 받습니다. 실제 actor는 JWT에서 얻으며 입력 소속 ID는 맥락일 뿐 본인 증명이 아닙니다. 같은 학교의 유효한 본인 소속을 서버에서 확인한 뒤 응답의 `schoolId`·`memberId`를 채웁니다.

성공은 `{contractVersion:1,schoolId,memberId,data}`이고 업무상 거절은 `{contractVersion:1,schoolId,memberId,error:{code}}`입니다. `data`와 `error`는 동시에 존재하지 않습니다. 다른 학교·계정·소속의 응답, 잘못된 판, 누락 필드는 앱이 거부합니다. `error`에 SQL 원문·본문·파일 경로·타인 자료를 넣지 않습니다. 인증·소속 gate에서 맥락을 확정하기 전에 실패하면 기존 R0 오류 경로로 거부하며 임의 학교 봉투를 만들어 내지 않습니다.

| 공개 함수 | 추가 인자 | `data` |
|---|---|---|
| `workhub_collection_readiness` | 없음 | `CollectionReadiness` |
| `workhub_collection_list` | `p_cursor text`, 최초 `null` | `{items:CollectionRequest[],nextCursor:string|null}` |
| `workhub_collection_get` | `p_request_id text` | `CollectionDetail` |
| `workhub_collection_draft_get` | `p_request_id text,p_unit_id text` | `CollectionDraft|null` |
| `workhub_collection_mutate` | `p_command jsonb,p_request_key text` | `CollectionReceipt` |
| `workhub_file_prepare` | `p_parent jsonb,p_file jsonb,p_request_key text` | `CollectionUpload` |
| `workhub_file_complete` | `p_file_id text,p_request_key text` | `CollectionFileStatus` |
| `workhub_file_status` | `p_file_id text` | `CollectionFileStatus` |
| `workhub_file_access` | `p_parent jsonb,p_file_id text` | `{file:FileReference,bucket:string,path:string}` |

업무 오류 코드는 `NOT_READY`, `INVALID_INPUT`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `FILE_NOT_READY`, `FILE_FAILED`입니다. 통합 설계의 세부 코드를 이 호환 코드에 매핑하는 표를 제출해 주세요. 예를 들어 필수값 누락은 `INVALID_INPUT`, 기대판 충돌은 `CONFLICT`, 정책/검증기 미설정은 `NOT_READY`입니다. `INVALID_RESPONSE`, `QUERY_FAILED`, `RESULT_UNKNOWN`, `CANCELLED`는 앱의 응답 검증·전송·계정 전환 경계 코드입니다. 서버가 결과 불명확을 성공으로 바꾸면 안 됩니다.

예상 업무 오류를 JSON으로 반환할 때도 원본·접수·감사·outbox 변경은 **전부 0건**이어야 합니다. 예외를 잡아 봉투로 변환하면서 일부 변경을 커밋하는 구현을 금지합니다. 예상 밖 DB 오류는 내부 진단과 사용자 응답을 구분합니다.

### 조회·DTO 제한

- 목록은 현재 ACL을 먼저 적용한 안정 정렬과 불투명 cursor를 사용합니다. 페이지당 최대 50개, ID 중복 금지입니다. cursor 문법은 `/^[A-Za-z0-9_=-]+$/`, 최대 2,048자입니다. cursor에 민감 본문을 담지 말고 학교·조회 주체·정렬 조건과 결합해 재검증합니다.
- `CollectionDetail`은 `{request,units,submissions,reviews,supplements,withdrawals}`만 담습니다. **drafts를 포함하지 않습니다.** 관리자/검토자에게 미제출 초안의 존재·건수·내용·첨부 이름을 제공하지 않습니다.
- 상세는 최대 100단위, submissions/reviews/supplements/withdrawals 각각 최대 1,000건을 따릅니다. 구성원/ID 목록의 앱 한도는 각각 100개입니다. 초과 자료를 자른 뒤 전체라고 반환하지 말고 지원 한도 오류로 닫습니다. 장기 운영 전 이력 페이지 계약을 별도 확장해야 합니다. 현재 cursor는 수합 목록 전용이며 상세 이력용 RPC나 cursor가 이미 존재한다고 가정하지 않습니다.
- 상세의 배열·부모·포인터는 하나의 일관된 서버 snapshot이어야 합니다. 응답 조립 중 여러 문장이 서로 다른 READ COMMITTED snapshot을 읽어 current와 제출 배열이 어긋나지 않도록 원본 잠금 또는 단일 조회 구조를 검증합니다.
- 공개 ID는 `/^[A-Za-z0-9_-]{1,100}$/`입니다. 새 영속 ID는 통합 설계대로 TEXT UUID를 사용합니다. 실제 날짜와 ISO 시각을 반환하며 ID·판·시각을 클라이언트에서 정하지 않습니다.
- `CollectionReceipt`는 `{requestId,resourceId,resourceVersion,recordedAt,requestKey}`입니다. `requestId`는 수합 ID, `requestKey`는 명령 멱등 키입니다. UI는 접수 후 상세·초안을 다시 읽습니다.

| 명령 | receipt의 `resourceId` | `resourceVersion` |
|---|---|---|
| create/update/publish | 수합 request ID (`requestId`와 동일) | 요청 version |
| save_draft | 저장한 shared draft ID | draft version |
| submit | 새로 접수한 submission ID | 제출 revision |
| review/withdraw/open_correction | 변경한 unit ID | unit version |

`requestId`는 어느 명령에서도 부모 수합 ID입니다. 특히 save_draft 이후 화면은 이 접수판과 서버에서 다시 읽은 draft.version을 대조합니다. 접수증만으로 draft ID나 답변 본문을 조립하지 않고, 재조회에서 더 최신판이 확인되면 입력을 보존한 채 충돌 비교로 보냅니다.

## 4. 명령 입력과 원자 처리

`p_command`의 허용 키와 타입은 [CollectionCommand](../../apps/workhub/src/collections/contracts.ts)를 그대로 따릅니다. 모르는 명령/키, null·배열로 바꾼 객체, 문자열 숫자, 음수·소수 기대판을 거부합니다.

| `kind` | 입력 | 잠금·동작 |
|---|---|---|
| `create` | `input:CollectionInput` | 같은 학교의 대상·검토자·정책 검증, 요청/문항 초안 생성 |
| `update` | `requestId,expectedVersion,input` | 요청 관리자, 요청 초안 판 일치; 게시된 문항·대상 변경 거부 |
| `publish` | `requestId,expectedVersion` | 요청/문항판·정확한 대상 명단·현재 소속 재검증, 단위와 구성원 snapshot을 한 번 생성 |
| `save_draft` | `requestId,unitId,expectedVersion,input:AnswerInput` | 현재 공동 구성원, shared draft 기대판; 첫 초안은 0 |
| `submit` | `requestId,unitId,draftId,expectedDraftVersion,expectedVersion,reason,correctionRequestId?` | 책임자, unit·draft 두 기대판, 해당 문항판/필수값/첨부/마감·정정창 검증 |
| `review` | `requestId,unitId,submissionId,expectedVersion,decision,note,dueDate` | 지정 검토자, 정확한 pending 제출판; decision은 `accepted` 또는 `changes_requested` |
| `withdraw` | `requestId,unitId,submissionId,expectedVersion,reason` | 현재 책임자, 해당 현재판과 철회 가능 상태·기한/창 검사 |
| `open_correction` | `requestId,unitId,expectedVersion,dueDate,reason` | 요청 관리자, 해당 단위에만 적용; 정정·철회 허용 범위의 정책 근거 필요 |

`CollectionInput`·`AnswerInput`의 필드명과 한도는 기존 타입·검증과 맞춥니다. 제목 120, 안내 3,000, 문항명 120, 단위명 100, 글 응답 5,000, 사유/의견 1,000, 단위 수 1~100입니다. 숫자 0은 유효하며 null과 구별합니다. 필수 응답은 초안 저장 때 미입력을 허용하고 제출 때 검사합니다. 문자열 한도·trim·Unicode 정규화는 SQL과 앱 공통 fixture로 대조하며 JS 문자열 길이와 DB 문자 수 차이를 숨기지 않습니다.

`CollectionInput`에는 학년도 ID가 없습니다. `create` 시 서버가 해당 학교 시간대의 현재 기준일에 대응하는 유효 학년도를 R0 자료에서 해석하여 **정확히 하나**일 때만 원본에 고정합니다. 0개이거나 여러 개면 설정 오류로 거부하고 임의 연도나 가장 최근 행을 고르지 않습니다. 같은 생성 요청의 재전송, update/publish 및 후속 초안·제출은 최초 고정한 학년도 관계를 유지합니다. 해가 바뀌었다고 기존 수합을 새 학년도에 조용히 옮기지 않습니다. 학년도 이전은 이번 명령 범위 밖입니다.

R1 UI는 **현재 schema의 shared draft 하나**만 지원합니다. 부모 `unitId+version`은 이 shared draft로만 해석하고 개인초안·과거 문항판을 자동 선택하지 않습니다. `submit.correctionRequestId`가 있으면 그 단위의 정확한 열린 보완 요청과 연결합니다. 생략한 제출이 열린 보완을 임의로 전부 충족하면 안 됩니다.

### 접수·검토·철회 불변 조건

- 제출판, 파일 snapshot, current/effective/최초 제출 포인터, 정확한 보완 충족, 접수증, 감사, outbox는 하나의 트랜잭션입니다. 파일 실물 검증은 그 전에 끝나 있어야 합니다.
- 최초 제출 시각·당시 마감·최초 지연을 서버에서 고정합니다. 날짜 마감은 학교 시간대 다음 날 00:00 기준이며 클라이언트 날짜를 접수 증거로 쓰지 않습니다. R0의 실제 학년도·학기 날짜를 다시 입력하거나 추정하지 않습니다.
- 무검토형은 current=effective, 현재판 철회 시 둘 다 비우고 이전판을 자동 부활시키지 않습니다. 검토형 새 제출은 기존 effective를 유지하고 정확한 현재 pending판 승인 때만 바꿉니다.
- `previousSubmissionId`는 제출 당시의 current 연결입니다. 검토형 v1 승인→v2 미승인 철회→v3 제출은 previous=v1일 수 있고, 무검토형 v1 철회→v2 제출은 previous=null일 수 있습니다. 이를 무조건 revision-1 연결로 바꾸거나 정상 이력을 거부하지 않습니다. 존재하는 previous는 같은 단위의 더 이전판이어야 합니다.
- 자기검토는 실제 제출자 account, 당시 책임자 account snapshot, 현재 책임자 account를 대조합니다. membership ID 변경으로 우회할 수 없습니다. 기본 금지이며 첫 관리자 혼자 시험하기 위해 예외를 만들지 않습니다.
- `changes_requested`는 정확한 제출판·검토와 사유·기한을 가진 보완 요청입니다. 후속 제출 철회 시 그 제출의 보완 충족만 무효화하고 남은 보완 의무를 복구합니다.
- 승인 완료판 직접 철회, 마감 후 무허가 정정/철회, 완료본 없는 상태의 완료 표시는 거부합니다. 정책이 정해지지 않은 전이는 공개하지 않습니다.
- 기대판 충돌은 `CONFLICT`입니다. 클라이언트가 다시 조회하여 내 입력과 비교하므로 자동 덮어쓰기·자동 병합을 하지 않습니다.

### 멱등성과 공통 잠금

R0의 `(actor_key,scope_key,operation,idem_key)`와 정규화 본문 SHA-256을 재사용합니다. 키 8~200자, 동일 키/동일 본문은 동일 원본 접수, 동일 키/다른 본문은 `IDEMPOTENCY_CONFLICT`입니다. `collection.create`처럼 R0의 operation 문법에 맞춘 이름을 고정하고 실제 목록을 제출합니다. 원본 읽기 권한은 재전송에서도 현재 기준으로 검사합니다.

R0 `idempotency_receipts.result`에는 `resource_type/resource_id/resource_version/recorded_at`만 저장합니다. 제출 본문·명단·파일 경로·서명 URL·전체 DTO를 넣거나 트리거를 완화하지 않습니다. 재전송에도 현재 원본 접근 권한을 검사한 뒤 **해당 명령의 최초 접수 ID·판·시각을 보존한 CollectionReceipt**를 반환합니다. resourceVersion을 현재 원본의 최신판으로 치환하지 않습니다. 답변/요청 본문은 별도 조회에서 현재 허용 DTO로 다시 읽습니다.

예를 들어 내 초안 v2 저장 응답이 유실된 뒤 다른 교사가 v3를 저장했다면 같은 키 재시도의 접수판은 여전히 v2입니다. 별도 초안 조회 v3와 비교해 충돌을 알려야 하며, 접수판을 v3로 바꾸어 타인 변경을 내 저장 결과로 표시하면 안 됩니다.

잠금은 R0 gate 순서와 통합 설계의 계정/학교/소속/역할 → actor·scope·operation·key → collection → unit → schema → draft → submission → correction → file 정렬을 함께 검토합니다. 실제 다중 계정 잠금 목록을 미리 정렬하고 검토·철회·GC·검증 완료도 같은 순서를 따르게 해 주세요. 승인/소속 회수의 UPDATE가 작업의 권한 SHARE 잠금과 충돌하는지 시험합니다.

## 5. Storage 업로드·상태·내려받기

앱은 기존 공용 Supabase 인스턴스와 로그인 세션으로 Storage SDK를 직접 호출합니다. 업로드 옵션은 `upsert:false,cacheControl:'0'`, 내려받기는 인증된 `.download(path)`입니다. 공개 URL·signed URL·브라우저 삭제 API를 사용하지 않습니다. 따라서 SQL의 access RPC 검사와 **실제 Storage 요청 시점의 RLS**가 모두 필요합니다.

### 고정 경로와 typed 부모

- bucket: **`workhub-collection-files`**, 비공개.
- 경로: **`<schoolId>/<fileId>/<opaqueKey>`**. schoolId/fileId는 위 ID 문법, opaqueKey는 `/^[A-Za-z0-9_-]{16,100}$/`이며 서버가 생성합니다. 원본 파일명·이메일·학생명·확장자를 경로 식별자로 쓰지 않습니다.
- prepare의 `p_file`: `{name,extension,claimedBytes,claimedSha256}`. 서버가 소속·부모·현재 정책을 검사하며 claimed 값은 업로더의 신고값입니다. 검증 증거가 아닙니다.
- `FileReference`: `{id,name,extension,bytes,sha256}`. `bytes/sha256`는 서버 실물 검증 결과이며 bucket/path/URL은 답변 JSON에 넣지 않습니다.

| `p_parent.kind` | 정확한 모양 | 의미 |
|---|---|---|
| `template` | `{kind:'template',requestId,version}` | 저장된 수합 초안의 배부 파일; version >= 1 |
| `draft` | `{kind:'draft',requestId,unitId,version}` | 현재 shared draft; 최초 저장 전 version 0 가능 |
| `submission` | `{kind:'submission',requestId,unitId,submissionId}` | 불변 제출판의 파일 내려받기; 이 부모로 새 업로드 금지 |

업로드 목적과 정확한 부모 기대판은 prepare에서 고정합니다. 새 요청은 수합 초안을 먼저 저장한 뒤 양식을 올립니다. R1은 파일 문항 한 개만 지원하므로 서버가 해당 문항 ID를 확정하여 typed 관계에 저장해야 합니다. 앞으로 다중 파일 문항을 지원할 때는 이 계약을 확장합니다.

`FileReadScope.memberIds[]`나 프리뷰 파일 소유자 목록은 서버 ACL의 증거가 아닙니다. 같은 학교라는 사실, 해시를 안다는 사실, 클라이언트에 파일 ID가 있다는 사실로 읽기를 허용하지 않습니다. prepare 이후 원본판이 바뀌면 첨부 확정 명령의 기대판을 다시 검사하고 다른 부모/단위로 자동 재결합하지 않습니다.

### 상태와 재확인

`CollectionFileState`는 `awaiting_upload | pending_verification | ready | rejected`입니다. `CollectionUpload`는 `{fileId,bucket,path,expiresAt,state}`, 상태 응답은 `{fileId,state,file}`이며 ready일 때만 `file`이 정확한 FileReference이고 그 밖에는 null입니다.

1. prepare는 업로더·scope·typed 부모·기대판·정책·신고값·만료를 가진 불변 업로드 intent를 만들고 경로를 한 번 발급합니다. 같은 요청 재시도는 같은 fileId를 사용합니다.
2. Storage INSERT는 그 JWT가 소유한 미만료 `awaiting_upload` intent의 정확한 bucket/path에만 허용합니다. 범용 경로 INSERT, 임의 파일의 교체, UPDATE/upsert, authenticated DELETE를 금지합니다. 기존 정책을 통한 우회도 시험합니다.
3. complete는 업로드 존재를 확인하고 검증 큐/lease를 한 번 접수합니다. 실물이 아직 없으면 `awaiting_upload`를 반환할 수 있습니다. **같은 complete 키 재시도는 현재 상태를 다시 평가**합니다. 이전 awaiting 결과를 영구 저장하여 이후 실제 업로드가 영원히 진행되지 않는 구현을 금지합니다.
4. worker가 실물을 읽고 검증한 뒤에만 ready/rejected를 확정합니다. complete 자체가 브라우저 claimed 값을 복사해 ready로 바꾸면 안 됩니다. 상태 조회는 현재 상태를 반환합니다.
5. 앱은 사용자 동작으로 상태를 다시 확인합니다. 자동 무한 polling에 의존하지 않습니다. 전송 응답이 끊겨도 새 fileId를 무조건 만들거나 같은 경로를 덮어쓰지 않고 현재 intent/상태를 확인합니다.

미첨부 파일의 상태는 현재 유효한 업로더만 조회합니다. 연결 후에도 uploader라는 이유만으로 회수된 부모 권한을 우회하지 않도록 현재 원본 관계를 재검사합니다. 응답이 늦게 도착한 이전 학교·계정 결과는 앱에서 폐기하지만 서버도 현재 actor를 매번 확인해야 합니다.

### 실제 내려받기 시점의 검사

access는 typed 부모·정확한 판·활성 파일 관계·현재 actor/소속·파일 상태·현재 정책을 검사한 뒤 `{file,bucket,path}`를 돌려줍니다. 필요한 경우 짧은 파일 접근 grant를 기록하되 URL을 발급하지 않습니다. Storage SELECT 정책은 실제 다운로드 시점에 이 grant와 같은 원본 resolver를 다시 검사해야 합니다. 한 번 access를 통과했다는 이유로 이후 소속 종료·구성원 제거·철회·권한 회수를 무시하면 안 됩니다.

Storage 목록 조회, 경로 추측, 다른 부모로 재요청, 같은 파일의 다른 학교 참조도 권한 시험에 포함합니다. 다운로드할 파일의 실제 bytes/hash 검증은 서버 검증과 별개로 앱에서도 확인할 수 있지만 클라이언트 검사가 서버 권한 검사를 대신하지 않습니다.

## 6. 별도 서버 검증기 의존성 — 아직 미구현

SQL 작성물에는 검증 job/lease·결과 기록·봉인 함수의 계약을 포함하되 **검증기가 이미 있다는 전제는 금지**합니다. 후속 서버 코드가 구현·배포되고 실제 Storage 실물에 대한 시험을 통과해야 준비 완료가 됩니다.

- worker는 Storage에서 실물을 읽어 실제 크기, SHA-256, MIME/파일 표식, 지원 문서 컨테이너·압축 확장 한도, 실패/암호화/미지원 조건을 검사합니다. 악성 검사와 형식 검사를 다른 상태로 기록합니다.
- scan 상태는 실제 검사에 따라 `pending/clean/rejected/error/not_scanned`를 보존합니다. 형식 검사 성공을 `clean`으로 바꾸지 않습니다. 미검사 사용은 해당 목적/형식/민감도를 명시 허용한 학교 정책과 공통 하한 정책이 함께 승인돼 있을 때만 가능합니다.
- 파일의 당시 정책판을 보존하며 사용 시점에는 당시 허용판과 현재 학교/공통 정책의 허용 교집합을 검사합니다. 학생·민감 자료, rejected/quarantined/deleted 파일에 임의 예외를 만들지 않습니다.
- 검증 결과 봉인 함수는 **worker의 `service_role` 전용**이어야 하고 anon/authenticated/PUBLIC에는 EXECUTE를 주지 않습니다. service_role이라는 이름만으로 호출자가 제출한 `verified=true`를 믿는 범용 함수로 만들지 말고, 서버 작업의 fileId·정확한 path·검증 실행 ID·lease 소유/만료·물체 정체성·결과 지문을 대조합니다.
- R0의 서비스 주체는 `session_user` 매핑을 사용합니다. PostgREST의 `authenticator → service_role` 호출과 직접 DB worker는 주체 해석이 다를 수 있으므로 실제 역할 체인으로 증명해 주세요. 기존 `member_actor`나 승인 gate를 완화하지 말고 worker 전용 capability/서비스 주체·실행경로를 명시합니다. 브라우저가 서비스 주체 ID를 인자로 골라 감사 기록을 위조할 수 없어야 합니다.
- 검증 도중과 검증 완료 뒤 업로더의 교체/삭제가 불가능해야 합니다. worker 결과를 적용할 때 상태·lease·실물 정체성이 바뀌었으면 거부합니다. verified 이후 path/hash/bytes/MIME를 불변으로 하고 수정본은 새 fileId를 사용합니다.

`CollectionReadiness`는 `{available,reason,policy}`입니다. reason은 `ready | database_missing | storage_missing | verification_missing | policy_missing`만 사용합니다. `available:true`이면 reason=ready이며 policy는 실제 승인 정책의 `FilePolicy {extensions,maxFileBytes,maxFiles}`여야 합니다. 필요한 객체·RLS·검증 서비스·승인된 제출 및 파일 정책 중 하나라도 빠지면 false와 해당 사유를 반환합니다. readiness에 고정 true를 심거나 검증기 존재를 확인하지 않고 SQL 함수 존재만으로 준비 완료를 선언하지 않습니다. worker 준비 증명의 등록·갱신·만료 방식도 제출해 주세요.

클라이언트의 기술 상한은 한 파일 100MiB 이하, 최대 512개 이하의 형식 검증 한도일 뿐 학교 운영 허용값이 아닙니다. 허용 형식/크기/개수, 미검사 허용, 보존기간, 검토자 권한, 마감 후 정정/철회 정책은 별도 승인 근거가 필요합니다. 프리뷰 기본값을 운영 정책으로 확정하지 않습니다.

## 7. 표·제약·통합 API 대응

| 통합 계약 | R1에서 필요한 원본/관계 | 요청 사항 |
|---|---|---|
| API-08 요청·게시 | `collections`, `collection_schemas`, `collection_fields`, `collection_units`, `collection_unit_members`, `collection_reviewers` | 학교 복합 FK, 불변 게시 문항판, 대상 snapshot, 현재 관리자/검토자 관계 |
| API-09 초안·제출 | `unit_drafts`, `submission_versions`, `submission_files` | 현재 shared draft 유일성, 정확 schema/unit/collection, 당시 계정·책임자·마감·검토 모드 snapshot |
| API-10 검토·보완·정정 | `submission_reviews`, `correction_requests`, `collection_correction_fulfillments`, `correction_windows` | 불변 검토, 열린 보완 하나, 충족판 철회/복구, 창의 범위와 승인 정책 |
| API-17 파일 | `file_objects`, 필요한 typed 파일 관계, `file_access_grants`, `deletion_ledger` | 실물 검증·불변 경로·목적 고정·현재 ACL·삭제 원장 |
| 공통 정책·실행 | `policy_versions`, 기존 R0 `idempotency_receipts/audit_events/outbox/service_principals/service_principal_scopes` | 정책 scope 복합 FK, R0 접수증/서비스 주체 계약 보존 |
| R1 실행 보조 | 업로드 intent, 검증 job/lease, 준비 상태 근거 | 기존 통합 표로 충족하는지 또는 최소 신설 관계가 필요한지 처분표 제출 |

표·열은 `schema-contract.json`과 `workflows-changes.json`을 함께 대조합니다. 아직 없는 참조 대상은 R0처럼 이름 있는 pending CHECK로 안전하게 닫거나 필수 최소 의존성을 함께 배치합니다. 없는 FK를 주석으로만 남기거나 NOT VALID로 권한 경계를 건너뛰지 않습니다. 새 표마다 열·유일키·FK·CHECK·불변 트리거·인덱스·RLS·GRANT를 빠짐없이 대조해 주세요.

배부 파일 `CollectionInput.fileCollection.templates[]`는 AI 양식 분석 기능이 아닙니다. 정확한 학교/collection/요청판/file 관계가 필요합니다. 통합 §11의 generic `file_links` allowlist에 collections를 문자열로 추가하는 것만으로 권한을 열지 않습니다. 기존 typed 관계로 충분한지, 배부 파일 전용 관계가 필요한지 명시하고 새 관계가 필요하면 표사전·제약·테스트와 함께 최소 제안으로 제출합니다. `collection_template_versions`를 사용한다면 AI mapping을 요구하지 않는 배부 파일 역할과 여러 배부 파일의 정체성을 분명히 합니다.

철회 이력과 정정창도 앱 DTO를 저장한 JSON 덩어리로만 처리하지 말고 정확한 원본·actor·제출판·사유·시각 관계로 보존합니다. schema ID가 앱 명령에 직접 없는 부분은 잠근 unit의 현재 published schema를 유일하게 해석하고 과거판을 현재 문항으로 다시 해석하지 않습니다.

`tasks_source_pending` 해제와 업무 projection 생성은 이번 화면 연결에 필수가 아닙니다. 구현하지 않는다면 R0 CHECK를 유지하고 수합 상태를 개인 task의 완료 값으로 대체하지 않습니다. 서버 export manifest/ZIP은 미구현으로 남기며 현재 클라이언트 묶음 다운로드를 서버 manifest 검증 완료로 주장하지 않습니다.

## 8. 미첨부 파일 수명과 정리

브라우저는 Storage 파일을 삭제하지 않습니다. 창 닫기·업로드 선택 취소·네트워크 실패가 곧 영구 삭제 요청이 되지 않습니다.

서버 정리는 만료된 upload intent, 활성 업로드/검증 lease, 아직 재확인 가능한 명령, 초안/양식/불변 제출판의 typed 관계, 보존 정책을 함께 확인합니다. 임시 hold가 존재하면 GC와 첨부 확정이 같은 파일 잠금에서 경쟁하도록 설계합니다. GC 판단 직후 save_draft/submit이 파일을 붙이는 경합을 막아야 합니다.

파일이 이미 저장본/접수판에 연결됐으면 현재 UI 목록에서 빠졌다는 이유로 지우지 않습니다. 과거 불변판과 실제 보존 근거를 확인하고, 미첨부 파일 정리는 승인된 정책에 따라 deletion ledger 차단 → 작업자 물리 삭제 → 확인 후 purged 순서입니다. **물리 삭제는 Storage API를 사용하며 `DELETE FROM storage.objects`로 메타데이터만 지우지 않습니다.** R1 되돌림의 기본 동작에도 실물 삭제를 포함하지 않습니다.

## 9. Claude가 전달할 결과물

1. **단계별 SQL 파일**: `R1-00` 읽기 전용 전후 지문/사전 점검, `R1-01` 필수 정책·파일/실행 관계, `R1-02` 수합 원본/제약, `R1-03` 공개 RPC·Storage 정책, `R1-04` 적용 후 읽기 전용 검사처럼 순서와 책임이 보이게 분리해 주세요. 실제 분할은 의존성에 맞게 조정하되 각 파일의 정상 결과·실패 시 원자 범위를 적습니다.
2. **적용 안내**: 현재 프로젝트 ref 확인, R0 지문/버전 전제, 파일별 실행 순서, 사용자 입력값의 출처, 필요한 별도 승인, 오류 때 중지할 지점을 적습니다. 기존 학교/학년도/학기는 DB에서 읽고 임의 날짜나 가짜 초기 설정을 넣지 않습니다.
3. **제약 처분표/변경 명세**: 기존 R0 유지/추가/후속 보류, 통합 설계와 차이, 신설 typed 관계, policy와 worker 의존성, 정확한 공개 함수 signature·반환 예시·오류 매핑을 제공합니다.
4. **검증 보고서와 실행 도구**: PostgreSQL 17 계열 fixture, 실제 PostgREST 호출 결과, Storage SDK/RLS 시험 결과를 구분합니다. 수행하지 못한 환경 시험은 미실행으로 적습니다.
5. **비파괴 중지/복구안**: 쓰기·준비 상태를 닫고 원본·접수·감사·Storage 실물을 보존하는 R1 전용 절차를 기본으로 합니다. 새 객체 제거가 필요하면 의존성·행 수·보존 자료를 먼저 검사하고 별도 사용자 확인 대상으로 둡니다. DROP SCHEMA CASCADE, R0-90, 자동 대량 삭제는 사용하지 않습니다.
6. **후속 worker 구현 요청**: job/lease 인수·봉인 함수 입력/출력·정체성 증명·검사 종류·실패 재시도·삭제 API·준비 상태 증명과 필요한 배포 항목을 별도 문서로 제공합니다. SQL 완료와 worker 완료를 분리합니다.

SQL 확정본에는 파일 버전/지문과 적용 전제 검사, 적용 완료 후 식별 가능한 버전 증거를 포함합니다. 이미 다른 판이 적용됐으면 임의 덮어쓰기로 진행하지 않고 중단합니다. 재실행 지원 여부와 부분 단계 적용 후 재개 방법을 명시합니다.

## 10. 필수 검증 시나리오

| 영역 | 반드시 확인할 것 |
|---|---|
| 보존 | 실행 전후 기존 public/auth 구조·회원·기존 제출·R0 일정/업무·접수·감사 행 수/해시 동일. Storage 기존 bucket/object 목록과 권한 지문 보존. 의도한 R1 추가 객체는 allowlist로 분리 |
| 준비 상태 | DB/Storage/검증기/정책 각각 누락 시 false, SQL만 적용한 상태에서 verification_missing 또는 policy_missing. 브라우저에서 ready 강제 불가 |
| 역할 | 실제 `authenticator→authenticated`와 JWT 주체, anon·미승인·비superadmin·타학교·종료소속 거부. 기존 첫 관리자 공개 범위 유지 |
| 봉투 | 실제 PostgREST HTTP 응답이 contractVersion/schoolId/memberId/data 또는 error와 정확히 일치. JSON 문자열 이중 인코딩·배열 래핑·null 누락·SQL 오류 누출 금지 |
| 조회 | 빈 목록과 오류 구별, cursor 재사용/위조, 다른 학교 응답 거부, 상세 snapshot 일관성, 50/100/1,000 한도 경계 |
| 초안 비공개 | 관리자/검토자에게 초안 내용뿐 아니라 존재·첨부명·건수도 비노출. 현재 공동 구성원만 읽기/쓰기, 회수 직후 차단 |
| 동시 저장 | 같은 draft/unit 기대판의 동시 명령 하나만 성공. 실패 시 원본·receipt/audit/outbox 전체 0건. 서로 다른 키 경합·같은 키 동시 요청도 확인 |
| 멱등 | 같은 키 같은 본문 단일 접수, 다른 본문 충돌, 응답 유실 후 같은 키 복구, 재전송 시 현재 권한 회수 반영, metadata-only receipt |
| 제출 | 누락/NaN/문자열 숫자/미검증 파일/타단위 파일 거부, source draft 판 고정, 서버 접수시각·마감 경계, required/none 포인터 진리표, 철회 후 정상 재제출 previous 연결 |
| 학년도 | 생성 시 기준일에 해당하는 유효 학년도 정확히 하나, 누락/중복 설정 거부, 새 학년도 이후 동일키 재전송·수정에서도 최초 학년도 보존 |
| 검토·보완 | 계정 기준 자기검토 차단, 지정되지 않은 관리자 거부, 정확한 pending판 1회 검토, 보완 ID 불일치 거부, 충족판 철회 시 미완료 복구 |
| 업로드 | 미발급/만료/타인/타학교 path 거부, 동명 새 파일은 새 ID, upsert/UPDATE/DELETE 금지, 검증 중/완료 후 교체 금지, 기존 Storage permissive 정책 우회 없음 |
| 검증 | claimed hash·size 거짓, 실물 누락, MIME/표식 불일치, 압축 확장·암호화·미지원·검사 실패, worker lease 만료/중복 결과/다른 path 봉인 거부 |
| 상태 복구 | 같은 complete 키의 awaiting→실제 업로드→pending/ready, complete 큐 중복 없음, pending 자동 성공 금지, fileStatus 현재 상태, timeout 후 새 ID 중복 생성 방지 |
| 내려받기 | 실제 인증 SDK download에서 typed 부모와 현재 ACL 적용. access 후 소속/구성원/정책 회수, 경로 직접 요청, grant 재사용, Storage 목록 조회 차단 |
| GC | 임시 hold·활성 lease와 저장 경합, 저장/과거 제출 파일 보존, 승인된 고아 파일만 정리, Storage API 삭제 후 ledger 확정 |
| 서비스 경계 | worker 봉인 함수 authenticated/anon 실행 거부, 실제 service_role 경로와 감사 주체 검증, 임의 주체 ID/검증됨 플래그 주입 차단 |
| 복구 | R1 비파괴 중지 후 R0 일정·업무·로그인·기존 제출 다운로드 유지, R0-90을 사용하지 않음 |

DB fixture는 PostgreSQL 17과 Supabase 역할·권한 특성을 맞추고 superuser로만 성공한 결과를 앱 호환 시험으로 세지 않습니다. 날짜 경계 시험은 격리 fixture에서 명시한 가상 기준일로 수행하고 운영의 실제 학년도 날짜와 섞지 않습니다. 운영 학교·학년도·학기 초기 설정을 다시 만들거나 확인하지 않은 날짜를 채우지 않습니다.

DB의 `storage.objects` 행 해시 일치는 파일 본문 바이트 보존의 증거가 아닙니다. 실제 기존 파일의 인증 다운로드와 bytes/hash 확인은 후속 통합 시험 항목으로 남깁니다. 실제 PostgREST·Storage 환경을 쓰지 못했다면 모의시험 통과 수와 별개로 미검증이라고 명시합니다.

## 11. 완료 보고 기준

이번 전달의 완료는 **검토 가능한 R1 SQL·적용 안내·검증 자료·worker 후속 계약이 준비된 상태**입니다. 사용자 SQL 적용, worker 배포, 운영 정책 승인, 실사용 검증을 완료했다고 보고하지 않습니다.

SQL 적용 전에는 새 RPC 부재가 정상적인 미준비 상태입니다. 적용 후에도 verifier/policy가 없으면 기능을 닫습니다. 마지막으로 남은 승인·수동 적용·서버 구현·환경 검증 항목을 각각 적고, 사용자가 실행할 확정본과 아직 제안인 항목을 구별해 주세요.
