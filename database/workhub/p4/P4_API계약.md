# P4 API 계약 (학교 자료 · 원문 가져오기 · 문서함 · 질문형 양식)

PR #48 앱의 `apps/workhub/src/knowledge/*.ts` · `apps/workhub/src/documents/*.ts` 와 서버 API
`apps/main/api/workhub-documents/_knowledge_import.py` · `_guided_service.py` 가 받아들이는 형태입니다.
시험 V 에서 실제 응답 301건을 앱 코드(어댑터·parser·`createGuidedHttp`)에 넣어 확인했고, 서버 API 는 PR #48 의 실제 `run` 으로 돌렸습니다.

## 봉투

| 경우 | 모양 |
|---|---|
| 성공 | `{contract, schoolId, memberId, data}` |
| 업무 거절 | `{contract, schoolId, memberId, error:{code}}` |
| 로그인·소속 실패 / 예상 밖 오류 | 봉투 없는 예외(`FORBIDDEN`·`INACTIVE_MEMBERSHIP`·기타). 앱: `FORBIDDEN`·`INACTIVE_MEMBERSHIP`·`CANCELLED`·`RESULT_UNKNOWN`·`QUERY_FAILED` |

`contract`: `knowledge.v1` · `knowledge-import.v1` · `documents.v1` · `guided.v1`.
`code`: `NOT_READY`(모듈 꺼짐·정책 없음·학생 기록 확인 전) · `FORBIDDEN`(권한 없는 동작) · `INVALID_INPUT` · `NOT_FOUND`(없거나 볼 수 없음) ·
`CONFLICT`(판·상태·실물이 다름) · `IDEMPOTENCY_CONFLICT`(같은 번호·다른 내용) · `RESULT_UNKNOWN`(같은 번호가 아직 처리 중이거나 임대 중).
업무 거절은 원장에 남기지 않습니다. 요청 번호는 `^[A-Za-z0-9_-]{8,200}$`.

## 앱 함수 23개 (`authenticated`, 첫 인자 `p_member_id`)

| 모듈 | 함수 | 인자 | data |
|---|---|---|---|
| 학교 자료 | `workhub_knowledge_list` | `p_query(≤200), p_cursor` | `{items[≤50]: Source, nextCursor, canManage}` |
| | `workhub_knowledge_mutate` | `p_command, p_request_key` | `{id, version, requestKey, recordedAt}` |
| 원문 가져오기 | `workhub_knowledge_import_readiness` | — | `{available}` |
| | `workhub_knowledge_file_prepare` · `_prepare_get` | `p_file{name,bytes,sha256}, p_request_key` | `{fileId, fileVersion, bucket, path, bytes, sha256, uploaded}` |
| | `workhub_knowledge_file_extract_get` | `p_file_id, p_request_key` | ImportResult |
| | `workhub_knowledge_import_commit` · `_import_request_get` | `p_import{fileId,fileVersion,extractionSha256,input}, p_request_key` | `{id, version:1, requestKey, recordedAt}` |
| | `workhub_knowledge_original_access` | `p_source_id, p_source_version` | `{available:false}` 또는 `{available:true, sourceId, sourceVersion, fileId, fileVersion, ownerMemberId, bucket, path, name, bytes, sha256, extractionSha256}` |
| 문서함 | `workhub_document_list` | `p_query, p_archived, p_cursor` | `{items[≤50]: Document, nextCursor, canShare}` |
| | `workhub_document_get` | `p_document_id, p_version(null=최신)` | Document |
| | `workhub_document_history` | `p_document_id` | `{documentId, versions[]: {version, recordedAt, status}}` 최신순 |
| | `workhub_document_mutate` · `_request_get` | `p_command, p_request_key` | `{documentId, version, requestKey, recordedAt}` |
| 질문형 양식 | `workhub_template_list` | `p_cursor` | `{items[≤50]: Template, nextCursor, canCreate}` |
| | `workhub_template_get` | `p_template_id` | `{template: Template, response: Response \| null}` |
| | `workhub_template_collection_targets` | — | `{items[≤200]: {requestId, title, version}}` |
| | `workhub_template_prepare` · `_prepare_get` | `p_file, p_title, p_request_key` | `{templateId, templateVersion, bucket, path, bytes, sha256, uploaded}` |
| | `workhub_template_mutate` · `_request_get` | `p_command, p_request_key` | `{requestKey, templateId, templateVersion, responseId, responseVersion}` |
| | `workhub_template_operation_get` | `p_operation{action,templateId,templateVersion,responseId,responseVersion,requestKey}` | inspect: `{templateId, templateVersion, inspection}` · render: Artifact |
| | `workhub_document_artifact_access` | `p_artifact_id` | `{artifact: Artifact, bucket, path, ownerMemberId}` |

- 자료 명령: `create{input}` · `update{id, expectedVersion, input}` · `publish|retire{id, expectedVersion, reason}`. input = `{title, kind: regulation·annual_plan·school_guide·other, body, locator, effectiveFrom, effectiveThrough('' 가능)}`
- 문서 명령: `create{input, origin: {documentId, version} \| null}` · `update{documentId, expectedVersion, input}` · `confirm|archive{documentId, expectedVersion}`.
  input = `{title, kind, body, visibility: private·school, sources[≤100]: {kind: knowledge·document·collection·calendar·task, sourceId, sourceVersion, locator, quote}, basisDate, studentContext}`
- 양식 명령: `save_mapping{templateId, expectedVersion, title, mapping}` · `save_answers{templateId, templateVersion, responseId, expectedVersion, preview, answers}` · `publish{templateId, expectedVersion, previewArtifactId, collectionRequestId, collectionVersion}`
- Artifact `{artifactId, templateId, templateVersion, responseId, responseVersion, bytes, sha256}`

## 서버 API 함수 6개 (`service_role` 만, 첫 두 인자 `p_actor_user_id, p_member_id`)

| 함수 | 하는 일 |
|---|---|
| `workhub_knowledge_file_extract_claim(…, p_file_id, p_request_key)` | 확정 결과가 있으면 `{state:'completed', result}`, 임대 중이면 `{state:'pending'}`, 아니면 `{state:'leased', leaseToken, leaseExpiresAt, bucket, path, fileVersion, name, bytes, sha256, storageObjectId}` |
| `workhub_knowledge_file_extract_finish(…, p_lease_token, p_storage_object_id, p_result)` | 추출문 고정 → ImportResult. 다른 토큰·다른 실물 → `CONFLICT` |
| `workhub_template_inspect_claim` · `_render_claim(…, p_template_id, p_template_version, p_response_id, p_response_version, p_request_key)` | 위와 같은 모양. leased 에 `source{bucket, ownerMemberId, path, bytes, sha256, storageObjectId}`, render 는 `mapping`·`answers`·출력 위치 |
| `workhub_template_inspect_finish` · `_render_finish(…, p_lease_token, p_source_object_id, p_result)` | 분석 고정 / 생성 파일 고정(출력 실물이 Storage 에 있어야 함) |

사람 JWT 가 실린 service 호출은 `FORBIDDEN`. API 가 확인한 UID 로 소속·승인 확인(`member_actor`)을 그대로 통과해야 합니다.

## Storage

| 버킷 | 경로 | 올리기 | 읽기 |
|---|---|---|---|
| `workhub-knowledge-files`(비공개, 30MiB) | `학교/소속/파일/original.hwpx` | 예약한 본인만, 30분 안, 한 번(덮어쓰기 불가) | 그 자료를 볼 수 있는 사람(초안: 작성자·관리자 / 게시 뒤: 업무실 사용자) |
| `workhub-document-files`(비공개, 30MiB) | `학교/소속/양식/source.hwpx` · `학교/소속/생성파일/output.hwpx` | 원본: 예약한 본인 · 생성 파일: 서버(service_role)만 | 원본: 서버 API 만 · 생성 파일: 만든 사람만 |

UPDATE·DELETE 정책은 없습니다. 서명 URL·목록 조회로는 읽을 수 없습니다(시험 F39·G31).
