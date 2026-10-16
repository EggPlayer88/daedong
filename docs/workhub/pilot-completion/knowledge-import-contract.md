# W08 HWPX 학교자료 원문 가져오기 — 구현 및 Claude SQL 요청

## 구현된 범위와 남은 연결

학교자료에 `HWPX에서 자료 가져오기`와 `연결된 HWPX 원본 확인`을 연결했다. 원본 업로드 → 서버의 실제 XML 본문 추출 → 교사 원문/위치/누락항목/종류/적용기간 확인 → **자료 초안** 생성까지 구현했다. 학교 자료로 게시하는 기존 담당자 검토 절차는 별도로 유지한다. 본문을 자동으로 규정/계획이라고 확정하거나, 그림을 OCR하거나, 빠진 내용을 AI로 추정하지 않는다.

코드·자동 검증이 준비된 상태다. **전용 RPC와 비공개 Storage 정책은 Claude SQL 확정/사용자 적용 전**이며 실제 연결 성공을 주장하지 않는다. Vercel 함수 포함 설정과 기존 서버 전용 환경값의 승인된 배포도 필요하다. 기존 인증·회원·기존 source exact 응답·수합/문서함 ID는 변경하지 않는다.

실사용 확인: 실제 학교 HWPX 여러 종류, PostgREST·Storage RLS·서명 URL 차단, 한글의 화면과 추출문의 대조, 휴대폰 읽기 편의성은 이후 묶어서 확인한다. 실제 XML 텍스트만 추출하므로 쪽수·시각적 표 배치·그림의 글자·수식 의미가 보존된 것처럼 말하지 않는다.

## 원본과 정리본 구분

- 원본 파일: 비공개 `workhub-knowledge-files`, immutable `fileId/fileVersion/storageObjectId/bytes/sha256`.
- 추출문: 서버 파서가 확정한 `hwpx_text_v1`, 실제 섹션·문단 ID, locator, text, extractionSha256, omittedObjects.
- 교사가 정리한 본문: 기존 `SourceInput`. 교사는 제목/종류/근거 위치/적용일/본문을 수정하고 다시 확인한다. 이를 실제 원문과 동일한 문장이라고 기록하지 않는다.
- 학교자료판: 새 `KnowledgeSource` 초안 v1. 원본 파일·추출판·교사확인본과 sourceVersion의 연결은 같은 트랜잭션으로 저장한다. 게시/개정되어도 기존 sourceVersion과 연결된 파일/추출 원장은 바뀌지 않는다. 이후 직접 편집은 새 sourceVersion을 만들고 원래 file provenance를 명확히 이어가거나 새 파일로 명시 변경한다.
- AI 인용은 기존 `knowledge sourceId/version`을 사용한다. 원본 fileId를 sourceId처럼 사용하지 않는다. 사용자가 확인한 현재 source판의 유효기간/권한을 다시 검사하고, 해당판과 연결된 원문 위치를 근거로 표시한다.

## 데이터 형식

정확한 프런트 계약: `apps/workhub/src/knowledge/import-contracts.ts`, `import-adapter.ts`.

```ts
Extraction={
 profile:'hwpx_text_v1',fileSha256:string,extractionSha256:string,
 blocks:Array<{id:'Contents/section0.xml:p000000',locator:string,text:string}>,
 omittedObjects:number
}
ImportResult={fileId:string,fileVersion:number,name:string,extraction:Extraction}
ImportCommit={fileId:string,fileVersion:number,extractionSha256:string,input:SourceInput}
```

실제 한도는 `api/workhub-documents/_assets/knowledge-import-limits.json`에서 읽는다. 파서는 본문100000 codepoint/1500문단을 넘으면 **잘라서 성공하지 않고 거부**한다. 기본 HWPX 파일 상한은 기존 `api/collections/_assets/hwpx-basic.json`을 사용한다. 동일 위치 중복, 빈 추출문, 다른 프로필, 무효 hash와 임의경로를 거부한다.

추출 hash의 계산값은 Python `json.dumps(blocks,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode('utf-8')`의 SHA256이다. DB는 프런트가 만든 hash를 신뢰해서 원문을 등록하지 않고, service finish가 확정한 extraction hash와 대조한다.

## 공통 envelope·권한·키

공개 RPC 성공: `{contract:'knowledge-import.v1',schoolId,memberId,data}`.
실패: `{contract:'knowledge-import.v1',schoolId,memberId,error:{code}}`.

허용 업무오류는 공통 scoped-rpc와 동일. `p_member_id`에서 승인된 auth 사용자/활성 학교/권한을 다시 결정하고 다른 actor·schoolID를 클라이언트 입력으로 받지 않는다. 개인이 가져온 미확인 원본은 source draft 권한을 갖는 본인 또는 실제 담당자만 읽는다. 관리자 역할 하나만으로 다른 학교나 다른 업무의 파일을 읽지 못한다.

모든 쓰기에서 `(school,actor/member,operation,requestKey)` + canonical payload hash로 중복을 막고 기존 receipt를 version 변경 검사보다 먼저 대조한다. payload가 다르면 IDEMPOTENCY_CONFLICT. 결과불명 시 원본 File·확인한 input·prepare/extract/commit의 기존 키를 공통 `knowledgeImport` 슬롯과 현재 탭 메모리에 보관한다. localStorage를 사용하지 않는다. 현재 학교/계정/권한 범위가 바뀌면 다른 scope 화면에서 이전 입력을 열지 않는다.

## 프런트 RPC

모든 함수에 `p_member_id`를 공통으로 받는다.

1. `workhub_knowledge_import_readiness()` → `{available:boolean}`. 기능 준비/파일 저장소/추출서버 연결이 실제로 준비됐을 때만 true. true가 아닌 동안 새 파일 업로드·새 초안 생성 차단. 현재 pending은 기존 receipt 조회 가능.
2. `workhub_knowledge_file_prepare(p_file:{name,bytes,sha256},p_request_key)` → `{fileId,fileVersion,bucket,path,bytes,sha256,uploaded}`. HWPX 확장자/길이/학교정책을 확인한 예약만 발급한다. `uploaded`는 실제 원장/Storage 객체 상태이다. 결과유실 후 prepare를 재실행해도 같은 ID·원본경로이며 재업로드하지 않는다.
3. `workhub_knowledge_file_prepare_get` 인수/응답 동일. **기존 예약 읽기만** 하며 준비 중 새 예약을 만들지 않는다.
4. `workhub_knowledge_file_extract_get(p_file_id,p_request_key)` → ImportResult. 원래 요청이 확정한 실제 추출문만 조회. 새 lease·파싱을 실행하지 않는다.
5. `workhub_knowledge_import_commit(p_import:ImportCommit,p_request_key)` → `{id,version:1,requestKey,recordedAt}`. 자신의 확정 파일판/추출hash/권한을 검사하고, SourceInput을 독립적으로 검증한 후 knowledge draft v1 + source/file/extraction 연결 + receipt를 한 트랜잭션으로 생성한다. `status=published`를 허용하는 인수는 없다. 원본은 고정된 채 정리본을 새 자료판에 저장한다.
6. `workhub_knowledge_import_request_get` 인수/응답 동일. 준비 오류 중 기존 exact key+payload 접수증만 조회. 없으면 명확한 NOT_FOUND, 처리 중이면 RESULT_UNKNOWN. 새 자료를 만들지 않는다.
7. `workhub_knowledge_original_access(p_source_id,p_source_version)` → 다음 중 하나.

```ts
{available:false} // 이 자료판은 직접 입력하여 원본 파일이 없음
{available:true,sourceId,sourceVersion,fileId,fileVersion,ownerMemberId,
 bucket:'workhub-knowledge-files',path,name,bytes,sha256,extractionSha256}
```

접근 불가는 `available:false`로 위장하지 않고 FORBIDDEN/NOT_FOUND를 반환한다. source판의 열람권한과 연결된 immutable file판을 함께 확인한다. 클라이언트는 SDK download 후 bytes/hash 및 access 재조회로 파일이나 권한의 변경을 대조하고, 둘 다 맞을 때만 내려받는다. 다운로드 링크 URL을 클라이언트 입력에서 받지 않는다.

## 서버 API와 claim/finish

경로: `POST /api/workhub-documents/extract-knowledge`.

요청은 `{memberId,fileId,requestKey}`뿐이다. Authorization은 기존 로그인 JWT. 본문·파일경로·학교ID·서비스 비밀키를 보내지 않는다. 서버가 기존 auth 서버에서 확인한 user ID만 다음 service 전용 함수에 전달한다.

`workhub_knowledge_file_extract_claim(p_actor_user_id,p_member_id,p_file_id,p_request_key)`:

```ts
{state:'pending'}
{state:'completed',result:ImportResult}
{state:'leased',leaseToken,leaseExpiresAt,
 bucket:'workhub-knowledge-files',path,fileVersion,name,bytes,sha256,storageObjectId}
```

응답은 공통 knowledge-import envelope로 감싼다. `leaseToken`은16~200자 `[A-Za-z0-9_-]`, 기한은 timezone을 포함한다. source path가 정확히 현재 학교/소속/file 예약 경로인지 확인한 후 다운로드하고, 실측 bytes/hash가 같을 때만 파싱한다. 원본 객체ID를 없는 것으로 간주해 무시하거나 현재 path의 다른 객체로 대체하지 않는다.

`workhub_knowledge_file_extract_finish`는 claim 인수 + `{p_lease_token,p_storage_object_id,p_result:ImportResult}`. 응답 data는 확정한 ImportResult와 정확히 동일해야 한다. lease/원본현재 objectID/학교/소속/권한/버전/기존key를 다시 검사하고 실제 추출문과 hash를 immutable 원장에 저장한다. 재인수는 원래 객체/입력판을 고정 유지한다. 클라이언트 anon/authenticated가 service 함수를 직접 부를 수 없어야 한다. service_role이라도 p_actor와 member를 실제 자료권한에 대조한다.

실패 원문에는 파일 본문·이메일·SQL·서비스키를 노출하지 않는다. 오류 로그도 본문을 기본 기록하지 않는다. XML DTD/외부 entity/네트워크 접근은 사용하지 않는다. 복합 run의 텍스트는 읽지만 그림·수식·OLE·차트의 의미는 추정하지 않고 omittedObjects에 알린다. 표 안 문단은 상위 문단에서 중복 추출하지 않는다. 페이지 번호가 확실하지 않으므로 섹션/문단/표 셀 주소를 표시한다.

## Storage 정책 요청

전용 버킷 `workhub-knowledge-files`, public=false.

원본 경로: `{schoolId}/{ownerMemberId}/{fileId}/original.hwpx`.

브라우저는 유효한 본인 예약의 정확 경로에 INSERT만 한다. upsert=false, UPDATE/DELETE 금지. 원장 확정 후 path 재사용을 금지하고, 전체 객체ID가 바뀌면 원본판을 교체하지 않는다. 다운로드는 실제 source판 또는 본인의 등록/검토 권한으로 제한하고, 과거 file ID를 아는 것으로 다른 학교의 파일을 얻을 수 없어야 한다. 공개/임의 서명 URL 발급은 허용하지 않는다.

본문은 게시판권한, 원본은 source/file 관계권한이다. 초안작성자는 다른 사람에게 숨겨진 원본·중간추출을 문서 ID로 읽을 수 없어야 한다. 보존일수/미확인 파일정리 정책은 기존 사용자 승인 흐름에서 정하며 자동파괴 작업을 추가하지 않았다.

## 자동 시험과 실제 시험 구분

- `test_knowledge_import.py`: 합성 실제ZIP에서18건. 복합run/표중복방지/그림·수식누락/상한/DTD/원본ID·학교·버킷·lease/추출결과유실.
- `test_workhub_knowledge_import.mjs`:17건. exact자료, 원본판·추출hash, role변경, 예약/버킷, read-only 복구, 저장키고정, source판 원본 다운로드 전후 대조.
- `tests/browser/workhub-knowledge-import.mjs`:8건. 원문/누락 확인, 명시 초안저장, metadata변경 재확인, 파일과키보존, 준비중 기존결과조회, 소속전환,320px.

모두 운영 Supabase에 쓰지 않고 합성 서버/파일로 검사했다. SQL/정책/실제 파일 앱에서의 정상 경로 검증은 별도 남은 단계다. Claude SQL 시험에는 학교교차, sourceVersion교차, 원본객체교체, 철회소속, 같은key다른본문, 추출hash위조, 게시상태우회, service함수 직접호출, 준비중 receipt 순수읽기, 보존지문불변을 포함한다.
