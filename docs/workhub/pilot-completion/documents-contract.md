# W07 문서함 · W06 질문형 HWPX 수합 구현/SQL 인계

이 문서는 구현된 클라이언트·서버 함수와 Claude가 확정할 DB 계약을 구분한다. **새 SQL을 작성·적용하지 않았다.** 문서함·질문형 관련 RPC와 전용 Storage 정책이 없으면 화면은 준비 중/재연결 안내를 보이며 빈 목록이나 저장 완료로 가장하지 않는다. 기존 평가계획 6종 양식·토큰·`api/_hwpx`·기존 회원/인증은 수정하지 않았다.

## 1. 이번 구현

- 문서함: 목록/검색/커서, 개인·학교공유, 5종 일반 초안과 학생 기록 검토초안, 원본부터 새 문서, 버전 이력, 내용 확인 표시, 보관함, 실제 본문 TXT 다운로드.
- AI: 현재 입력과 제안 비교 → 사용자 반영 → 직접 수정 → 별도 저장. 반영 전으로 되돌릴 수 있다. AI 생성과 저장·제출은 분리한다. 미저장 긴 본문을 조용히 자르지 않는다. 긴 문서는 먼저 저장한 정확한 document ID/버전을 근거로 짧은 요청을 보낸다.
- 입력 보호: 현재 탭 메모리만 사용. 학교/계정/역할 범위별 격리. 본문을 localStorage에 넣지 않는다. 미확정 쓰기는 원래 key+명령을 공통 pending 슬롯(`documents`, `guidedDocuments`)에도 저장한다. 새로고침·로그아웃 후 복구를 보장하는 영속 저장소는 아니다.
- 충돌: 제목·본문·종류·공개 범위·기준일·근거 전체 비교. 최신 버전을 확인한 다음 내 입력을 유지하거나 최신 원본을 선택한다. 재전송은 기존 원래 key를 유지하며 결과불명 상태에서 새 key로 복제 저장하지 않는다.
- 질문형: HWPX 원본 업로드 → 실제 문단/표 셀 주소와 원문 확인 → 질문/자료형/필수/길이/선택항목/주소 매핑 저장 → 시험 답변 저장 → 생성 파일 내려받기·확인 → 실제 파일형 수합 요청과 연결해 게시.
- 대상 교사: 게시된 질문형 양식 → 답변 임시저장 → 저장한 응답판으로 생성 → 다운로드·내용/칸 배치 확인 → 기존 수합 화면으로 생성 Blob 전달. **기존 R1S prepare/upload/basic/attach가 새 수합 file ID를 발급**하고, 교사가 최종 제출한다. document artifact ID를 R1S file ID로 사용하지 않는다.
- 독립 서버 `POST /api/workhub-documents/guided`: 기존 로그인 JWT로 사용자 확인 → 서버 전용 claim → DB가 허용한 원본 주소만 읽음 → 명시적 매핑만 코드 채움 → ZIP/XML 재오픈·대상/비대상 문단 대조 → 전용 저장소에 `upsert:false` → finish. 프런트에 서비스키를 두지 않는다.

## 2. 남은 실제 연결·제약

1. 아래 RPC·자료·원장·Storage 정책은 **Claude SQL 확정/사용자 적용이 필요**하다. 현재 연결했다고 주장하지 않는다.
2. Vercel include와 기존 서비스키 구성의 승인된 배포가 필요하다. 외부 설정을 자동 변경하지 않는다. 새 AI 모델·비용 설정도 변경하지 않는다.
3. 실제 PostgREST/Storage/RLS/Google 로그인과 한글에서의 인쇄·페이지 나눔·미리보기 확인은 사용자 요청대로 이후 실사용 검증에 포함한다. 자동 ZIP/XML 검증은 문서의 시각적 완벽함을 보장하지 않는다.
4. `explicit_paragraph_v1`은 단일 run의 텍스트/줄바꿈으로 구성된 실제 문단만 채운다. 표 안의 같은 단순 문단도 지원한다. 복합 서식·필드·그림·제어가 섞인 문단은 원형을 보존하며 선택하지 않는다. 복잡한 양식은 파일형 수합으로 안내한다. 주소 추측·AI XPath·임의 토큰 치환은 없다.
5. 게시 후 질문·주소는 고정한다. 개정은 새 양식으로 만들며 기존 답변의 원본판을 바꾸지 않는다. 기존 게시 양식의 자동 이관·전체 ZIP은 기존 파일 수합 제출 이후 기능을 이용한다.
6. AI의 질문/답변 제안은 본문 제안이다. 문서 구조를 추정해서 자동 매핑/자동 답변확정하지 않는다. 담당자가 실제 칸을 확인하고 교사가 답변·생성물을 확인한다.

## 3. 공통 RPC 보안·접수증

모든 공개 RPC는 기존 승인된 auth 사용자 + 현재 활성 학교 소속 + 권한 + 기능 상태를 서버에서 확인한다. 인수에 `p_member_id`를 받고 학교는 이 소속으로 결정한다. 사용자에게서 `schoolId`·owner ID를 받는 방식으로 권한을 확정하지 않는다.

성공은 정확히 `{contract:"documents.v1"|"guided.v1",schoolId,memberId,data}`. 실패는 정확히 `{contract,schoolId,memberId,error:{code}}`.

허용 오류: `NOT_READY`, `FORBIDDEN`, `INACTIVE_MEMBERSHIP`, `INVALID_INPUT`, `NOT_FOUND`, `CONFLICT`, `IDEMPOTENCY_CONFLICT`, `CANCELLED`, `QUERY_FAILED`, `RESULT_UNKNOWN`, `INVALID_RESPONSE`. 서버 SQL/원문/개인정보를 오류에 담지 않는다. SQL에서 클라이언트 전용 오류를 임의 성공으로 바꾸지 않는다.

쓰기의 키는 `(school,actor/member,operation,requestKey)`. payload canonical hash가 다르면 IDEMPOTENCY_CONFLICT. **동일 키의 기존 receipt 조회를 expectedVersion 검사보다 먼저** 수행하되 현재 소속과 열람 권한은 재확인한다. 키는 학교/소속/업무 경계 간 재사용하지 않는다. mutating 행과 receipt는 같은 트랜잭션. 저장 후 응답 유실은 같은 key로만 복구한다.

`*_request_get`, `*_prepare_get`, `*_operation_get`은 **순수 조회**이다. feature 준비 오류/일시 중지에서도 기존 exact key/payload receipt만 조회할 수 있다. 없으면 `NOT_FOUND`, 진행 중이면 `RESULT_UNKNOWN`; 새 쓰기·lease 취득·업로드·검사 실행을 하지 않는다. root UI가 pending을 버려도 안전한 NOT_FOUND는 기존 원장이 정말 없음이 확정되는 경우에만 반환한다.

공통 adapter는 쓰기 응답 뒤 신원 재확인 실패를 CANCELLED/RESULT_UNKNOWN으로 처리하여 pending을 보존한다. 다시 조회해서 확정 거절된 경우만 pending을 지운다.

## 4. 문서함 자료형과 RPC (`documents.v1`)

정확한 런타임 계약 원본: `apps/workhub/src/documents/contracts.ts`, `adapter.ts`.

`DocumentInput`:

```ts
{title:string /* 1..200 */, kind:'parent_letter'|'event_plan'|'event_report'|'rubric'|'general'|'student_record',
 body:string /* 1..100000 code points */, visibility:'private'|'school', basisDate:'YYYY-MM-DD',
 sources:Array<{kind:'knowledge'|'document'|'collection'|'calendar'|'task',sourceId:string,sourceVersion:number,locator:string,quote:string}>,
 studentContext:null|{studentId:string,courseId:string,evidence:Array<{
  kind:'observation'|'assessment',id:string,revisionId:string,sourceHash:string,epoch:number,start:number,end:number
 }>}}
```

인용 quote가 없으면 빈 문자열이다. locator를 원문 인용인 것처럼 만들지 않는다. sourceVersion은 양의 정수이고 실제 열람 가능한 불변 판과 같아야 한다. 근거와 학생 문장은 모델의 주장만으로 권한을 통과시키지 않는다.

`LibraryDocument` = DocumentInput + `{id,schoolId,ownerMemberId,version,latestVersion,status:'draft'|'confirmed'|'archived',updatedAt,canEdit,origin:null|{documentId,version}}`.

- `workhub_document_list(p_member_id,p_query,p_archived,p_cursor)` → `{items:LibraryDocument[<=50],nextCursor:null|string,canShare:boolean}`. 목록은 최신 판, 안정된 커서. 기본 개인 + 허용된 학교 공유. 검색 실패와 진짜0건 분리.
- `workhub_document_get(p_member_id,p_document_id,p_version:null|positiveInt)` → LibraryDocument. 명시된 이전판을 읽는 경우 `canEdit:false`; 이전판도 현재 열람권한 필요.
- `workhub_document_history(p_member_id,p_document_id)` → `{documentId,versions:[{version,recordedAt,status}]}` 최신부터 최대500. 과거 비공개 소유권이나 자료 유출을 허용하지 않는다.
- `workhub_document_mutate(p_member_id,p_command,p_request_key)` → `{documentId,version,requestKey,recordedAt}`.
- `workhub_document_request_get(p_member_id,p_command,p_request_key)` → 동일 receipt, 읽기 전용.

명령:

```ts
{kind:'create',input:DocumentInput,origin:null|{documentId,version}}
{kind:'update',documentId,expectedVersion,input:DocumentInput}
{kind:'confirm'|'archive',documentId,expectedVersion}
```

create는 v1, 나머지는 expectedVersion+1. 내용 확인 표시는 제출·결재·법적 승인 의미가 아니다. 편집은 소유자만, 학교공유는 별도 허가. 관리자라는 이유로 개인 문서를 열람할 수 없다. 보관함 이동도 hard delete하지 않는다. 사본은 원본 읽기권한·정확한 origin판 확인 후 생성한다.

### 학생 기록 초안 추가 규칙

`kind=student_record` ⇔ studentContext 존재. private 강제. 학생 context 없는 일반문서로 kind 변경하거나 공유해서 우회할 수 없다. 기존 학생문서의 학생/과목 context 변경은 거부하고 새 초안으로 분리한다. 근거 종류는 누가기록 observation / 확정된 assessment만 허용, 상담·개인민감정보 제외. 모든 evidence의 school, 실제 교사소유/담당학생, course/student, revision/hash/epoch, codepoint `[start,end)`를 서버에서도 재검증한다. 철회·정정된 근거는 새 저장/확인/AI 읽기/내려받기 때 현재 epoch와 대조해 충돌로 막는다. 근거철회 시 기존초안을 자동최신근거로 바꿔 증거를 꾸미지 않는다. 공식 생기부/NEIS 자동기재 기능은 없다.

## 5. 질문형 양식 자료형과 프런트 RPC (`guided.v1`)

원본: `guided-contracts.ts`, `guided-adapter.ts`. 표시 한도는 `_assets/guided-limits.json`, 파일 상한은 기존 `_assets/hwpx-basic.json`에서 읽는다.

```ts
Anchor={id:'Contents/section0.xml:p000000',section:'Contents/section0.xml',paragraph:0,
 sourceText:string,sourceHash:sha256,cell:null|{row:string,column:string}}
Inspection={profile:'explicit_paragraph_v1',templateSha256,anchors:Anchor[],unsupportedParagraphs:number}
Question={id,label,kind:'text'|'longtext'|'number'|'date'|'select',required:boolean,maxLength:number,options:string[],
 anchorId,sourceText,sourceHash}
Mapping={profile:'explicit_paragraph_v1',templateSha256,questions:Question[]}
Template={id,schoolId,ownerMemberId,title,version,state:'draft'|'published',inspection:Inspection|null,
 mapping:Mapping|null,collectionRequestId:string|null,canManage:boolean}
Artifact={artifactId,templateId,templateVersion,responseId,responseVersion,bytes,sha256}
GuidedResponse={id,templateId,templateVersion,schoolId,ownerMemberId,version,answers:Record<string,string>,preview:boolean,artifact:Artifact|null}
```

- `workhub_template_list(p_member_id,p_cursor)` → `{items:Template[<=50],nextCursor,canCreate}`. draft는 해당 양식 담당자만, published는 실제 연결된 수합 대상 또는 담당자만.
- `workhub_template_get(p_member_id,p_template_id)` → `{template:Template,response:GuidedResponse|null}`. response는 현재 교사 것만. 양식판/응답판/artifact판 일치 필요.
- `workhub_template_collection_targets(p_member_id)` → `{items:[{requestId,title,version}]}` 최대200. 담당자가 연결할 수 있는 실제 HWPX 파일형 수합만. 이 목록은 전교 모든 요청을 노출하는 탐색기가 아니다.
- `workhub_template_prepare(p_member_id,p_file:{name,bytes,sha256},p_title,p_request_key)` → `{templateId,templateVersion,bucket,path,bytes,sha256,uploaded}`.
- `workhub_template_prepare_get` 인수/응답 동일, 원래 예약 조회만. `uploaded`는 실제 Storage 원장 확인 결과다. 응답유실 후 이미 업로드된 파일을 새 객체로 덮어쓰지 않는다. name은 안전한 `.hwpx` 파일명만, bytes/hash는 형식 검사 대상일 뿐 신뢰된 실측이 아니다.
- `workhub_template_mutate(p_member_id,p_command,p_request_key)` / `workhub_template_request_get` → `{requestKey,templateId,templateVersion,responseId:null|string,responseVersion:null|positiveInt}`.

```ts
{kind:'save_mapping',templateId,expectedVersion,title,mapping} // templateVersion = expectedVersion+1
{kind:'publish',templateId,expectedVersion,previewArtifactId,collectionRequestId,collectionVersion} // +1
{kind:'save_answers',templateId,templateVersion,responseId:null|string,expectedVersion:0|positiveInt,
 answers:Record<string,string>,preview:boolean} // responseVersion=expectedVersion+1, templateVersion unchanged
```

매핑 저장은 서버가 이전 inspect에서 확정한 실제 앵커 원문/해시/원본 SHA와 일치해야 한다. 양식 새판을 만들면 이전 시험답변/artifact를 현재판 미리보기로 인정하지 않는다. 게시하려면 같은 담당자·양식판·Mapping hash·확인한 시험응답판의 생성 artifact와 수합 expectedVersion이 필요하다. 게시판은 불변이고 대상 교사는 그 게시판의 답변을 쓴다. `preview:true`는 담당자 시험자료이며 실제 교사 제출 현황으로 계산하지 않는다. 임시답변은 필수빈칸 허용, 생성은 필수/날짜/숫자/선택/길이 전체 검증. 숫자0을 누락으로 판단하지 않는다.

`workhub_document_artifact_access(p_member_id,p_artifact_id)` → `{artifact:Artifact,bucket,path,ownerMemberId}`. 현재 요청자 본인 생성물 또는 연결 수합의 허가된 담당자만. 현재 소속/원본판/응답판/권한을 매번 확인한다. SDK download 후 클라이언트는 bytes/hash 대조 및 access 재조회로 철회/교체 여부를 다시 확인한다.

save_mapping/publish의 접수증은 responseId=null, responseVersion=null이며 templateVersion=expectedVersion+1이다. save_answers는 templateVersion을 유지하고 responseVersion=expectedVersion+1, responseId는 새 저장 ID 또는 요청한 기존 응답 ID다. 미사용 필드를 생략하지 않는다.

`workhub_template_operation_get(p_member_id,p_operation:{action:'inspect'|'render',templateId,templateVersion,responseId,responseVersion,requestKey})` → action=inspect이면 InspectResult, render이면 Artifact. inspect의 responseId/responseVersion은 null이고 render는 저장한 ID/양의 판이다. 성공 data에 pending/completed 래퍼를 덧붙이지 않는다. 기존 결과가 아직 미확정이면 RESULT_UNKNOWN, 원장이 확실히 없으면 NOT_FOUND다. 준비중에 새 작업 없이 기존 결과 조회. 아래 HTTP 요청과 같은 이름·scope·원래 키로 lookup한다.

## 6. 서버 전용 claim/finish

HTTP 요청은 `{action,memberId,templateId,templateVersion,responseId,responseVersion,requestKey}`만 받는다. inspect의 response 둘은 null. render는 실제 저장한 응답 ID/판. 파일 경로·Mapping·answers·school/actor는 요청 본문에서 받지 않는다.

서버는 기존 `SupabaseClient.user(JWT)`의 auth 서버 확인값을 `p_actor_user_id`에 넣는다. `workhub_template_inspect_claim`, `workhub_template_render_claim` 인수:

```ts
{p_actor_user_id,p_member_id,p_template_id,p_template_version,p_response_id,p_response_version,p_request_key}
```

클라이언트 anon/authenticated는 이 함수를 직접 실행할 수 없다. service_role 전용이어도 actor를 실제 member/현재권한에 다시 대조한다. source path를 여러 학교에서 가져올 수 있는 범용 파일프록시가 되면 안 된다.

claim data 세 형태:

```ts
{state:'pending'}
{state:'completed',result:InspectResult|Artifact}
{state:'leased',leaseToken,leaseExpiresAt,
 source:{bucket:'workhub-document-files',ownerMemberId,path,bytes,sha256,storageObjectId},
 mapping:Mapping,answers:Record<string,string>,target:{artifactId,bucket:'workhub-document-files',path}}
```

inspect는 mapping/answers/target을 사용하지 않는다. 서버 원본 다운로드 후 bytes/hash 일치, 최소 HWPX 구조 확인, bounded XML 파싱으로 처리한다. lease는 동일 원래 키와 원본 object ID/Mapping판/응답판/출력 경로를 고정하고 재인수 때 바꾸지 않는다. 외부 네트워크 지연/결과유실은 pending 유지. 경합 재인수·중복 finish는 반드시 같은 결과만 확정한다.

finish 이름은 `workhub_template_inspect_finish`, `workhub_template_render_finish`. claim 인수 + `{p_lease_token,p_source_object_id,p_result}`. finish는 현재원본ID와 원본허가·응답판 및 출력 Storage 객체의 존재/metadata를 확인해 원장에 고정한다. source가 바뀌거나 소속/학교가 바뀌면 확정 거부. lease 소유자 외 finish 거부.

`InspectResult={templateId,templateVersion,inspection:Inspection}`. render result는 Artifact. finish envelope data는 p_result와 정확히 같아야 한다. 원본 객체가 없거나 출력 upload만 있고 DB확정이 없는 경우 완료로 표시하지 않는다. 성공 receipt는 고정결과를 재반환한다.

## 7. Storage

새 비공개 버킷 `workhub-document-files`, 공개 URL 금지.

- 원본: `{schoolId}/{ownerMemberId}/{templateId}/source.hwpx`.
- 생성물: `{schoolId}/{actorMemberId}/{artifactId}/output.hwpx`.
- 브라우저는 발급된 원본 예약 경로에 본인·현재학교·만료전 `INSERT`만 가능. upsert/UPDATE/DELETE 금지. 동일 경로를 재발급·교체하지 않는다. 원본 등록 완료 뒤 동일경로 INSERT/완료 재시도는 원래 객체 ID와 일치해야 한다.
- 생성물 INSERT는 전용 서버만, DB-issued target path에만. `x-upsert:false`. 이미 생성되었는데 응답만 사라졌다면 **원래 출력과 bytes 전체가 동일한 것만** 재사용한다. 다른 객체로 바뀌면 CONFLICT.
- 다운로드는 저장소 정책과 artifact/source access의 현재 학교·역할 권한 둘 다 적용. 담당자가 해당 수합을 맡았다는 사실로 모든 개인 문서 또는 다른 수합 문서를 읽을 수 없다.
- 원본 보존·생성결과 보존·미첨부 파일 정리는 새 상태표/참조원장에 근거해 별도 승인된 정책으로 한다. 이 기능은 파일을 대량 삭제하지 않는다.

## 8. 검증 체크리스트

자동 검증 파일:

- `test_workhub_documents.mjs`: 문서/학생/양식 범위, exact응답, 과거판, unknown/replay, 학생 근거, 실제 매핑주소, 응답판.
- `test_workhub_guided_files.mjs`: 파일예약·다른버킷/학교/권한교체 거부, API 로그인, 원래결과 읽기 복구, 다운로드 전후 재확인.
- `test_guided_hwpx.py`: 실제 ZIP/XML 생성, 선택한 문단만 치환, 특수문자·줄바꿈·표 주소, 복합서식 제외, 원본 SHA/DTD 거부, 길이/날짜/필수/숫자/선택검증.
- `test_guided_service.py`: service claim/finish, lease·원본/출력경로·객체ID·응답유실·중복처리 계약.
- `tests/browser/workhub-documents.mjs`: 실제 React 입력·접기·AI왕복·충돌 전체비교·학생private·생성파일 확인·수합 전달·모바일.

Claude SQL 시험에는 **타학교·타교사·철회소속·다른학생·상담근거·근거 epoch 변경·다른 양식판·다른 원본객체·다른 생성객체·같은key 다른payload·준비중 기존 receipt 조회·부재확정·부분트랜잭션실패**를 포함한다. SQL/정책 적용 전후에는 기존 회원18·기존제출·R0/R1 원장 보존 지문을 비교한다. 이 문서에 SQL 실행 승인이나 실행 완료 주장은 없다.
