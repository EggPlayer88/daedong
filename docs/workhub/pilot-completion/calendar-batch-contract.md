# W04 일정 일괄 가져오기: 구현 및 Claude SQL 요청 계약

상태: 기존 `CalendarImport`/`EventEditor`/일정 RPC를 보존하고 별도 batch 기능을 구현했다. SQL은 Claude의 P2 별도 PR에서 관리하며, 이 앱 보완에서는 DB에 적용하지 않았다. 코드와 합성 전송 시험 통과는 운영 저장 성공을 의미하지 않는다.

## 사용 흐름

1. CSV·TSV 또는 시트 표를 붙인다. 원본 묶음 ID·이름과 공개 범위를 명시한다. 기본 공개 범위는 나만 보기이며, 학교 공개는 직접 선택한다.
2. `parseImportTable`, `prepareImportRows`, 열 제안·누락열 검사를 기존 구현 그대로 재사용한다. 제목/날짜가 바뀌어도 유지되는 원본 ID 열이 필수다. 원본 행 번호나 제목으로 ID를 대신하지 않는다.
3. 유효 행만 서버에 보내 저장 이력과 현재 일정을 비교한다. 입력 오류 행은 번호와 사유를 별도 보류 표시한다. 누락열에 실제 값이 있으면 명시적인 제외 동의를 받는다. 새 파일 읽기에 실패해도 이전 비교·선택·동의는 해제한다.
4. 서버가 신규/중복/원본 변경/사이트 변경과 충돌/보류로 분류한다. 이전 가져오기·현재 사이트·이번 원본의 10개 전체 항목을 비교한다. 대상은 교사/부서/학년/교과의 이름과 포함/제외 의미로 표시하고, 이름이 없으면 확인 필요와 원본 ID를 남긴다.
5. 저장할 행을 직접 선택한다. 중복·보류는 선택 불가. 충돌은 전체 항목 교체 확인을 따로 받아야 선택할 수 있다. 공개 범위·대상 변경도 교체 범위다.
6. 최대 50개 유효 행을 한 배치로 준비하고, 선택행은 전부 하나의 트랜잭션에서 commit한다. 하나라도 원본/현재 버전·권한이 바뀌면 전체 미적용. CSV에 없는 행은 **절대 삭제 추정하지 않는다**.
7. 응답 손실 때 원본·선택행·현재 버전·원래 요청 번호를 그대로 보관하고 동일 요청으로 결과를 확인한다. 비교 토큰이 만료되어도 이미 commit된 요청 수신증 재생은 가능해야 한다.

진입점: `CalendarBatchImport({connection,member,members,date,revision?,onClose,onSaved?,onNavigationLockChange?})`. `onSaved(BatchReceipt)`는 선택한 모든 행의 수신증을 검증한 뒤 호출한다. 기존 개별 가져오기 UI/함수의 계약을 바꾸지 않는다.

## 서버의 원본 식별과 소유

- 학교 범위 안의 원본 묶음 key + 행 sourceId로 원본 계보를 구분한다. 묶음 key는 1~160자의 영문/숫자 및 `_.:@/-`, 첫 글자 영문/숫자. 사람이 읽는 이름은 160자. 행 sourceId는 공백 제어문자 없는 비어있지 않은 160자 이내 텍스트이며 한국어도 허용한다.
- 서버 원본 묶음 등록 정보에 생성자와 수정 가능한 담당자를 둔다. 새 묶음을 만드는 권한과 기존 묶음을 수정할 권한을 별도로 확인한다. 같은 학교에 우연히 같은 key를 넣었다고 타인의 원본을 소유하게 하지 않는다. 현재 UI는 권한을 확인하지 못한 원본을 보류로 표시할 수 있다. 묶음 담당자 변경 UI는 별도 학교 관리 범위다.
- 행 계보에는 현재 eventId, 마지막 승인된 incoming 전체 스냅샷·sourceHash, 실제 적용된 event version, import batch ID, 제출자, 일시가 필요하다. 원본 text 전체를 저장해야 하는 요구는 없다. fileHash와 원본 묶음/행 식별을 보존한다.
- 현재 일정과 이전 스냅샷 모두 호출자가 읽을 수 있어야 비교에 반환한다. 현재 이벤트 수정 권한도 있어야 변경 가능한 분류를 반환한다. 특히 타인의 private 일정과 과거 private 본문은 일정 관리자에게도 자동 노출하지 않는다. 클라이언트도 `canRead(previous)`·`canEdit(current)`를 대조한다.
- 다른 시트에서 원본 key를 바꿔 같은 일정이 들어오면 자동 동일시하지 않는다. 전역 중복 추측·자동 병합은 이번 범위가 아니다. 동일 묶음/행에서 유일성으로 중복 생성을 막는다.

## 공통 봉투와 값

모든 성공/거절 응답은 scope를 포함:

```ts
{ok:true,contractVersion:'calendar-batch.v1',schoolId,memberId,ownerUserId,...}
```

오류 및 SHA-256 canonical 규칙은 `cooperation-contract.md`의 공통 규칙과 동일하다. **commit의 확정 거절**에는 `ok:false,code,requestKey,commandHash,outcome:'rejected'`와 같은 scope가 필수다. 단순 SQL 오류·네트워크 실패·다른 요청의 거절은 pending을 해제하지 않는다.

모든 날짜·문자수·종일/시간·대상 조건은 기존 `EventDraft`/R0 일정 제약과 같아야 한다. 호출자가 학교/user를 지정하지 않으며 p_member_id와 auth.uid에서 도출한다. 새 일정 visibility는 현재 UI에서 private/school만 선택하지만, 과거 baseline/current에는 audience도 가능하므로 비교에서 버리면 안 된다.

```ts
EventDraft={title,description,location,startDate,endDate,allDay,startTime,endTime,
 visibility:'private'|'school'|'audience',
 audience:{all,groups:[{departmentIds,gradeIds,subjectIds}],includeMemberIds,excludeMemberIds}}
```

객체에 정의되지 않은 학교/owner/eventId 등을 끼워 넣으면 거절한다. title/description/location trim, 종일이면 시간 빈 문자열 등 기존 코드 정규화 이후의 draft를 해시한다. `sourceHash=SHA256(canonical(draft))`; `fileHash=SHA256(UTF8(rawCsv))`. UTF-8 BOM이 텍스트에 있으면 해시에 포함한다. 원문 CSV에서 내용이 같은 행의 순서를 바꿔도 sourceId가 같으면 같은 원본이다. fileHash만으로 중복 일정이라고 단정하지 않는다.

### 대상 배열 정규화와 기존 요청 보존 (2026-10-16, C4)

새 비교 요청은 includeMemberIds/excludeMemberIds의 중복을 제거하고 PostgreSQL `COLLATE C`에 맞는 코드포인트 순서로 정렬한다. localeCompare의 사용자 언어별 정렬을 쓰지 않는다. 정렬한 draft로 sourceHash를 계산하며, incoming·baseline·현재 일정도 같은 방식으로 비교한다. 대상 선택 순서만 다른 것은 변경으로 판단하지 않는다.

포함·제외에 같은 교사가 있으면 양쪽 값을 보존하여 제외 우선 의미를 유지한다. all·그룹 조건과 실제 대상 차이를 삭제하거나 임의로 같게 만들지 않는다. 원 객체/원문 CSV는 수정하지 않는다.

기존 앱이 만든 미전송 prepare 입력은 먼저 기존 draft/sourceHash의 일치를 확인한 뒤 복사본을 정렬하고 새 sourceHash를 계산한다. 변조된 원문을 새 해시로 덮어 통과시키지 않는다. 이미 전송한 commit은 이 정규화 경로를 거치지 않으며 prepareId·previewHash·sourceHash·선택 순서·requestKey를 그대로 재확인한다. 결과 미상 요청은 새 요청으로 바꾸지 않는다.

## workhub_calendar_batch_prepare(p_member_id, p_input jsonb)

```ts
p_input={sourceKey,sourceLabel,fileHash,omittedColumns:string[],
 rows:[{key,line,sourceId,sourceHash,draft:EventDraft}]}
```

rows 1~50, key·sourceId 중복 불가. `key`는 클라이언트 검토행 연결용(import-row-1 등)이며 영속 원본 식별자는 아니다. line은 원본 실제 줄번호, max 1000. 원본 파일 선택에서 1MB/25만자/200개 표행/30열을 먼저 제한한다. omissions는 기록용이며 누락열의 내용을 server가 복원하지 않는다. ID 없는 행·표 안 중복·깨진 날짜는 서버 전달 전 보류한다. 유효행이 50개를 넘으면 줄여 다시 가져오게 한다.

서버는 input 전체를 검증하고 immutable preview를 만들어 반환:

```ts
{...envelope,prepareId,previewHash,sourceKey,fileHash,expiresAt,
 rows:[{key,line,sourceId,sourceHash,state,reason,incoming:EventDraft,
        eventId:string|null,expectedVersion:number|null,
        baseline:EventDraft|null,current:CalendarEvent|null}]}
```

- preview는 현재 학교/member/user와 input 전체 및 source registry revision, row snapshot에 결합한다. random token/ID와 TTL은 서버 결정. 만료는 ISO8601.
- 행 수·key·line·sourceId·sourceHash·incoming은 요청과 일치한다. 클라이언트가 전체 대조하므로 누락/추가/변조를 허용하지 않는다.
- previewHash는 immutable preview 의 유효 내용을 서버 canonical digest로 고정한다. 클라이언트는 변조되지 않은 저장 토큰과 함께 commit에 그대로 돌려준다. 서버는 클라이언트가 만들어 낸 preview를 믿지 않는다.
- `new`: ledger 연결 없음. eventId/expectedVersion/baseline/current 모두 null.
- `duplicate`: incoming == baseline == current draft. 어떤 쓰기도 하지 않는다.
- `changed`: incoming != baseline, current draft == baseline. 원본만 바뀌어 안전한 수정 후보.
- `conflict`: current draft != baseline. 이번 원본의 변경 유무와 관계없이 사람의 전체 비교 확인 필요. eventId 및 expectedVersion은 현재 이벤트 기준.
- `held`: 접근 불가/삭제된 원본/알 수 없는 계보/지원하지 않는 상태. 사유를 제공하되 비공개 원본의 존재·내용을 유출하지 않는다. eventId/expectedVersion/baseline/current 모두 null. 자동 신규 승격하지 않는다.
- 비교 중 event 내용과 version, source ledger 상태가 한 스냅샷에 대응해야 한다. 응답에는 현재 이벤트 school/author/version/updatedAt 전체가 포함되어야 한다.

prepare는 실제 일정 쓰기가 아니다. 응답이 끊기면 원본을 유지한 채 다시 prepare할 수 있다. 이전 preview를 정리하는 TTL 정책은 일정·회원 자료를 삭제하지 않는다. 클라이언트가 준비 완료라고 표시했더라도 commit에서 모든 조건을 다시 검사한다.

## workhub_calendar_batch_commit(p_member_id, p_command jsonb, p_request_key)

```ts
p_command={kind:'calendar_batch_commit',prepareId,previewHash,
 selections:[{key,sourceId,sourceHash,eventId,expectedVersion,
              decision:'create'|'update'|'replace_conflict'}]}
```

선택 1~50, key·sourceId 유일. create는 eventId/expectedVersion null, update/replace_conflict는 기존 ID+양수 현재 version. 서버 preview에서 각각 new/changed/conflict와 대응해야 하며 duplicate/held는 거부한다. 선택 순서와 무관하게 lock 순서를 일정하게 잡아 교착을 줄인다.

**원자 처리 요구**:
1. 현재 auth/승인/소속/학교·원본 접근 확인. 요청 원장에 같은 scope+key가 있으면 먼저 원래 완료/거절 결과 재생. payload가 다르면 IDEMPOTENCY_CONFLICT.
2. 새 요청이면 preview 유효·scope·hash 및 모든 선택행 검증. 토큰에 없던 source/event/expectedVersion/hash를 받지 않는다.
3. 선택 원본 계보와 기존 event 행을 잠그고 현재 version뿐 아니라 source ledger revision도 검사. 새 행은 원본 유니크키가 아직 비어 있는지 확인. 다른 배치가 선점했다면 CONFLICT.
4. 모든 선택이 가능할 때만 일정을 생성/수정하고 원본 스냅샷·ledger·감사·요청 수신증을 같은 트랜잭션으로 commit한다. 일부만 성공하는 응답은 계약 위반이다.
5. 기존 event author를 호출자로 바꿔 소유권을 빼앗지 않는다. 기존 일정의 visibility/audience 변경 권한도 재검사한다. 다른 교사의 private 일정은 처리 대상 아님.

성공 응답:

```ts
{...envelope,requestKey,prepareId,previewHash,outcome:'applied'|'replayed',appliedAt,
 items:[{key,sourceId,eventId,version}]}
```

items가 선택행과 일대일·누락 없음. 신규 version=1, 수정 version=expectedVersion+1. eventId 중복 없음. 예외적으로 서버의 기존 일정 버전 정책이 다르면 이 계약과 클라이언트 검증을 같이 리뷰해야 하며 거짓 version을 보내지 않는다. 이미 commit된 요청은 preview 만료나 후속 일정 편집 이후에도 원래 수신증을 재생한다. 현재 접근이 회수되었다면 비공개 수신증을 반환하지 않으며 클라이언트는 원래 key를 보관한다.

## 자동 검증 및 적용 순서

- `node tests/test_workhub_calendar_batch.mjs`: 19개. 파서 재사용, ID/누락열/50개 상한, row/draft/대상 주입 거부, 모든행/해시/분류 검증, 타인 private 및 이전 private 스냅샷 차단, 전체 10필드 비교, 충돌 명시 선택, receipt 전행 검증, 응답 손실 same-key 재시도.
- `node tests/browser/workhub-cooperation-batch.mjs`: 전체 11개 중 일괄 5개. 신규/중복/변경/충돌/보류, 실제 UI 공개범위·설명·대상 비교, 동일-key 응답 유실 재시도, 경쟁 후 전체 미적용, 입력 보류·파일 읽기 실패 초기화, 320px 가로 넘침 없음 및 localStorage/sessionStorage에 원문 미저장.
- 기존 개별 CalendarImport/일정편집기는 수정하지 않았다. 기존 importer의 원본 ID가 지속 원장에 없었던 자료를 자동 연결하지 않는다. 최초 이력 연결이 필요한 경우 관리자 검토와 별도 SQL 계약이 필요하다.

Claude 순서: 신규 source registry/ledger·preview·receipt 설계 → R0 공통 일정 쓰기 규칙과 비교 → 임시 PG 및 실제 앱 parser 대조 회귀 → PR 상호검토 → 계란님 SQL 적용 → 실제 PostgREST 및 경쟁/응답유실 확인. 실제 Supabase·Vercel 쓰기 확인과 교사 실사용 피드백은 후속 일괄 점검이다.
