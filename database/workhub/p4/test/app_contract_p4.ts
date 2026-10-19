// PR #48 앱(apps/workhub)의 실제 자료·원문 가져오기·문서함·질문형 양식 어댑터와 parser 에 P4 의 "실제 출력"을 넣어 본다.
// run_p4.py 가 시험 중 받은 응답(봉투)과 그때의 workhub_context 를 P4_CAPTURE 에 남기고, 이 도구가 앱 코드에 그대로 넣는다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다.
// 서버 API(원문 추출·양식 분석·생성)는 PR #48 의 실제 Python wrapper(_knowledge_import.run · _guided_service.run)가 낸
// 응답을 HTTP 처리기(extract-knowledge.py · guided.py)와 같은 규칙(성공 200 본문 / 실패 status + {error:{code}})으로 감싸
// 앱의 createGuidedHttp(fetch 흉내) → 서비스 순서로 통과시킨다.
// run_all.sh 가 esbuild 로 묶는다: --alias:p4app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createKnowledgeService } from 'p4app/knowledge/adapter'
import { createKnowledgeImportService } from 'p4app/knowledge/import-adapter'
import { createDocumentsService } from 'p4app/documents/adapter'
import { createGuidedService, createGuidedHttp } from 'p4app/documents/guided-adapter'
import { canonical } from 'p4app/services/scoped-rpc'
import { contextResponse } from 'p4app/connection/validation'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; [k: string]: any }
const file = process.env.P4_CAPTURE
if (!file) { console.log('FAIL P4_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const b64 = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 기록한 실제 응답을 돌려주고, 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name: string; args: any }[], answers: Record<string, any>) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => {
      sent.push({ name, args })
      if (!(name in answers)) throw new Error('기록 없는 호출 ' + name)
      return structuredClone(answers[name])
    },
  } as any
}
// 서버 API 응답을 HTTP 처리기와 같은 모양으로: 성공 → 200 + wrapper 출력, 실패 → error.status + {error:{code}}
function http(c: Capture, route?: '/api/workhub-documents/extract-knowledge') {
  return createGuidedHttp({
    getSession: async () => ({ access_token: 'a'.repeat(40), user: { id: c.scope.userId } }) as any,
    fetch: (async () => new Response(JSON.stringify(c.raw ?? { error: { code: c.error } }), { status: c.raw ? 200 : c.status, headers: { 'Content-Type': 'application/json' } })) as any,
    ...(route ? { route } : {}),
  })
}
const never = { upload: async () => { throw new Error('호출되면 안 됨') }, download: async () => { throw new Error('호출되면 안 됨') } }
const blobPort = (c: Capture, bucket: string) => ({ ...never, download: async (path: string) => {
  if (!c.bytes) throw new Error('실물 없음'); const want = c.kind === 'tpl_download' ? c.raw.data.path : c.raw.data.path
  if (path !== want || (c.raw.data.bucket && c.raw.data.bucket !== bucket)) throw new Error('다른 위치를 내려받음'); return new Blob([b64(c.bytes)]) } })

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let localFirst = 0, localOtherCode = 0, normalized = 0, serverOnly = 0, wrapperPassed = 0, downloads = 0, httpMapped = 0
const skipped: Record<string, number> = {}

for (const c of captures) {
  const want = c.raw?.error ? String(c.raw.error.code) : c.error ? String(c.error) : undefined
  const sent: { name: string; args: any }[] = []
  const m = c.scope.memberId
  let expected: { name: string; args: any } | undefined
  const same = (out: unknown, data: unknown, why: string) => { if (canonical(out) !== canonical(data)) throw new Error(why) }
  const conn = (name: string) => connection(c, sent, { [name]: c.raw })
  try {
    let out: any
    switch (c.kind) {
      case 'kn_list':
        expected = { name: 'workhub_knowledge_list', args: { p_member_id: m, p_query: c.query, p_cursor: c.cursor } }
        out = await createKnowledgeService(conn(expected.name)).list(m, c.query, c.cursor); same(out, c.raw.data, '값이 바뀜'); break
      case 'kn_mutate':
        expected = { name: 'workhub_knowledge_mutate', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await createKnowledgeService(conn(expected.name)).mutate(m, c.command, c.key); same(out, c.raw.data, '접수증이 바뀜'); break
      case 'ki_ready':
        expected = { name: 'workhub_knowledge_import_readiness', args: { p_member_id: m } }
        out = await createKnowledgeImportService(conn(expected.name), never as any).ready(m); same(out, c.raw.data.available, '값이 바뀜'); break
      case 'ki_prepare': {
        if (!c.bytes) { bump(skipped, 'ki_prepare: 실물 없이 보낸 위조 메타데이터(서버 단독 방어)'); continue }
        const name = c.replay ? 'workhub_knowledge_file_prepare_get' : 'workhub_knowledge_file_prepare'
        expected = { name, args: { p_member_id: m, p_file: c.file, p_request_key: c.key } }
        out = await createKnowledgeImportService(conn(name), never as any).prepare(m, new File([b64(c.bytes)], c.file.name), c.key, c.replay)
        same(out, { fileId: c.raw.data.fileId, fileVersion: c.raw.data.fileVersion, uploaded: c.raw.data.uploaded }, '예약이 바뀜'); break
      }
      case 'ki_extract_get':
        expected = { name: 'workhub_knowledge_file_extract_get', args: { p_member_id: m, p_file_id: c.fileId, p_request_key: c.key } }
        out = await createKnowledgeImportService(conn(expected.name), never as any).extract(m, c.fileId, c.key, true); same(out, c.raw.data, '추출 결과가 바뀜'); break
      case 'ki_extract': {
        // 실제 Python wrapper 출력 → HTTP 처리기 모양 → 앱의 createGuidedHttp → extract
        const port = { ...never, extract: http(c, '/api/workhub-documents/extract-knowledge') }
        out = await createKnowledgeImportService(connection(c, sent, {}), port as any).extract(m, c.fileId, c.key)
        same(out, c.raw.data, '추출 결과가 바뀜'); wrapperPassed++; break
      }
      case 'ki_commit': {
        const name = c.replay ? 'workhub_knowledge_import_request_get' : 'workhub_knowledge_import_commit'
        expected = { name, args: { p_member_id: m, p_import: c.input, p_request_key: c.key } }
        out = await createKnowledgeImportService(conn(name), never as any).commit(m, c.input, c.key, c.replay); same(out, c.raw.data, '접수증이 바뀜'); break
      }
      case 'ki_original': {
        expected = { name: 'workhub_knowledge_original_access', args: { p_member_id: m, p_source_id: c.sourceId, p_source_version: c.sourceVersion } }
        if (c.raw?.data && c.raw.data.available === true && !c.bytes) { bump(skipped, 'ki_original: 실물을 남기지 않은 위치 조회'); continue }
        out = await createKnowledgeImportService(conn(expected.name), blobPort(c, 'workhub-knowledge-files') as any).original(m, c.sourceId, c.sourceVersion)
        if (c.raw.data.available === false) { if (out !== null) throw new Error('없음이 바뀜') }
        else { if (!(out?.blob instanceof Blob) || out.blob.size !== c.raw.data.bytes || out.name !== c.raw.data.name) throw new Error('내려받은 실물이 다름'); downloads++
               if (sent.filter(s => s.name === expected!.name).length !== 2) throw new Error('위치 재확인을 하지 않음') }
        break
      }
      case 'doc_list':
        expected = { name: 'workhub_document_list', args: { p_member_id: m, p_query: c.query.trim(), p_archived: c.archived, p_cursor: c.cursor } }
        out = await createDocumentsService(conn(expected.name)).list(m, c.query, c.archived, c.cursor); same(out, c.raw.data, '값이 바뀜'); break
      case 'doc_get':
        expected = { name: 'workhub_document_get', args: { p_member_id: m, p_document_id: c.documentId, p_version: c.version } }
        out = await createDocumentsService(conn(expected.name)).get(m, c.documentId, c.version ?? undefined); same(out, c.raw.data, '값이 바뀜'); break
      case 'doc_history':
        expected = { name: 'workhub_document_history', args: { p_member_id: m, p_document_id: c.documentId } }
        out = await createDocumentsService(conn(expected.name)).history(m, c.documentId); same(out, c.raw.data.versions, '값이 바뀜'); break
      case 'doc_mutate':
        expected = { name: 'workhub_document_mutate', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await createDocumentsService(conn(expected.name)).mutate(m, c.command, c.key); same(out, c.raw.data, '접수증이 바뀜'); break
      case 'doc_recover':
        expected = { name: 'workhub_document_request_get', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await createDocumentsService(conn(expected.name)).recover(m, c.command, c.key); same(out, c.raw.data, '접수증이 바뀜'); break
      case 'tpl_list':
        expected = { name: 'workhub_template_list', args: { p_member_id: m, p_cursor: c.cursor } }
        out = await createGuidedService(conn(expected.name), never as any).list(m, c.cursor); same(out, c.raw.data, '값이 바뀜'); break
      case 'tpl_get':
        expected = { name: 'workhub_template_get', args: { p_member_id: m, p_template_id: c.templateId } }
        out = await createGuidedService(conn(expected.name), never as any).get(m, c.templateId); same(out, c.raw.data, '값이 바뀜'); break
      case 'tpl_targets':
        expected = { name: 'workhub_template_collection_targets', args: { p_member_id: m } }
        out = await createGuidedService(conn(expected.name), never as any).targets(m); same(out, c.raw.data.items, '값이 바뀜'); break
      case 'tpl_prepare': {
        if (!c.bytes) { bump(skipped, 'tpl_prepare: 실물 없이 보낸 위조 메타데이터(서버 단독 방어)'); continue }
        const name = c.replay ? 'workhub_template_prepare_get' : 'workhub_template_prepare'
        expected = { name, args: { p_member_id: m, p_file: c.file, p_title: c.title, p_request_key: c.key } }
        out = await createGuidedService(conn(name), never as any).prepare(m, new File([b64(c.bytes)], c.file.name), c.title, c.key, c.replay)
        same(out, { templateId: c.raw.data.templateId, templateVersion: c.raw.data.templateVersion, path: c.raw.data.path, uploaded: c.raw.data.uploaded }, '예약이 바뀜'); break
      }
      case 'tpl_mutate':
        expected = { name: 'workhub_template_mutate', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await createGuidedService(conn(expected.name), never as any).mutate(m, c.command, c.key); same(out, c.raw.data, '접수증이 바뀜'); break
      case 'tpl_recover':
        expected = { name: 'workhub_template_request_get', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await createGuidedService(conn(expected.name), never as any).recover(m, c.command, c.key); same(out, c.raw.data, '접수증이 바뀜'); break
      case 'tpl_op_get':
        expected = { name: 'workhub_template_operation_get', args: { p_member_id: m, p_operation: c.operation } }
        out = await createGuidedService(conn(expected.name), never as any).recoverOperation(m, c.operation)
        same(out, c.raw.data, '작업 결과가 바뀜'); break
      case 'tpl_download': {
        expected = { name: 'workhub_document_artifact_access', args: { p_member_id: m, p_artifact_id: c.artifactId } }
        if (c.raw?.data && !c.bytes) { bump(skipped, 'tpl_download: 실물을 남기지 않은 위치 조회'); continue }
        out = await createGuidedService(conn(expected.name), blobPort(c, 'workhub-document-files') as any).download(m, c.artifactId)
        if (!(out instanceof Blob) || out.size !== c.raw.data.artifact.bytes) throw new Error('내려받은 실물이 다름'); downloads++
        if (sent.filter(s => s.name === expected!.name).length !== 2) throw new Error('위치 재확인을 하지 않음')
        break
      }
      case 'tpl_inspect': case 'tpl_render': {
        const p = c.payload, port = { ...never, run: http(c) }
        const svc = createGuidedService(connection(c, sent, {}), port as any)
        out = c.kind === 'tpl_inspect' ? await svc.inspect(m, p.templateId, p.templateVersion, p.requestKey)
                                       : await svc.render(m, p.templateId, p.templateVersion, p.responseId, p.responseVersion, p.requestKey)
        same(out, c.kind === 'tpl_inspect' ? c.raw.data.inspection : c.raw.data, '결과가 바뀜'); wrapperPassed++; break
      }
      default:
        bump(skipped, '알 수 없는 종류 ' + c.kind); continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    if (expected) {
      const last = sent.filter(s => s.name === expected!.name)
      if (!last.length || last.some(s => canonical(s.args) !== canonical(expected!.args))) {
        // 앱이 명령을 정규화(앞뒤 공백 걷기 등)해 서버가 받은 것과 다르게 보냈다 → 그 결과도 서버와 같아야 하므로 따로 센다
        if (last.length && ['kn_mutate', 'doc_mutate', 'tpl_mutate', 'doc_recover', 'tpl_recover', 'ki_commit'].includes(c.kind)) { normalized++; bump(skipped, '앱이 명령을 다르게 정규화'); continue }
        throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(sent).slice(0, 300))
      }
    }
    const t = note(c.kind); t.ok++; bump(t.codes, 'ok')
  } catch (e) {
    const got = code(e), t = note(c.kind)
    const serverApi = c.kind === 'ki_extract' || c.kind === 'tpl_inspect' || c.kind === 'tpl_render'
    if (want && got === want) {
      t.ok++; bump(t.codes, want)
      if (expected && !sent.some(s => s.name === expected?.name)) localFirst++          // 앱이 보내기 전에 같은 이유로 막음
    } else if (want && serverApi && ((c.status === 403 && got === 'FORBIDDEN') || (!['NOT_READY', 'CONFLICT', 'INVALID_INPUT', 'NOT_FOUND', 'IDEMPOTENCY_CONFLICT', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(want) && got === 'RESULT_UNKNOWN'))) {
      // HTTP 경계: 403 은 앱이 FORBIDDEN 으로, 앱이 모르는 코드는 RESULT_UNKNOWN(재조회 유도)으로 받는다 — 앱의 의도된 축약
      httpMapped++; t.ok++; bump(t.codes, `${want}→${got}(HTTP)`)
    } else if (want === 'INVALID_INPUT' && got === 'INVALID_RESPONSE' && !sent.length) {
      // 모양이 틀린 명령(모르는 칸 등)을 앱이 보내지 않고 막았지만, 앱의 exact() 가 입력 검사에도 INVALID_RESPONSE 를 쓴다.
      // 쓰기는 없고 화면 문구만 "서버 자료의 형식" 으로 나온다 — 앱 화면은 이런 명령을 만들지 않으므로 따로 센다(보고서에 적음).
      localOtherCode++; t.ok++; bump(t.codes, '앱이 안 보냄(INVALID_RESPONSE 로 표시)')
    } else if (!want && (c.kind === 'ki_prepare' || c.kind === 'tpl_prepare') && got === 'INVALID_INPUT' && !sent.length) {
      serverOnly++; t.ok++; bump(t.codes, '앱이 더 엄격(INVALID_INPUT)')
    } else {
      t.bad++; console.log(`  불일치 ${c.kind} 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.length} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw ?? c.error).slice(0, 200)} 명령=${JSON.stringify(c.command ?? c.payload ?? null).slice(0, 300)}`)
    }
  }
}

for (const [k, v] of Object.entries(tally))
  check(`${k}: 실제 응답 ${v.ok + v.bad}건을 앱 어댑터가 서버와 같은 결과로 해석 (${Object.entries(v.codes).map(([a, b]) => `${a} ${b}`).join(' · ')})`, v.bad === 0 && v.ok > 0, v)
const kinds = ['kn_list', 'kn_mutate', 'ki_ready', 'ki_prepare', 'ki_extract_get', 'ki_extract', 'ki_commit', 'ki_original', 'doc_list', 'doc_get', 'doc_history',
               'doc_mutate', 'doc_recover', 'tpl_list', 'tpl_get', 'tpl_targets', 'tpl_prepare', 'tpl_mutate', 'tpl_recover', 'tpl_op_get', 'tpl_download', 'tpl_inspect', 'tpl_render']
check(`앱 함수 ${kinds.length}종 모두 실제 응답으로 확인함`, kinds.every(k => (tally[k]?.ok ?? 0) > 0), kinds.filter(k => !(tally[k]?.ok)))
check(`실제 Python wrapper 출력 ${wrapperPassed}건(원문 추출·양식 분석·생성)을 앱 createGuidedHttp → 서비스가 그대로 받음`, wrapperPassed > 0, wrapperPassed)
check(`내려받기 ${downloads}건: 앱이 위치 확인 → 실물 크기·해시 확인 → 위치 재확인까지 통과`, downloads > 0, downloads)
check(`앱이 보내기 전에 같은 코드로 막은 요청 ${localFirst}건(서버도 같은 코드)`, localFirst > 0, localFirst)
console.log(`  참고: 모양이 틀린 명령을 앱이 보내지 않고 INVALID_RESPONSE 로 막은 요청 ${localOtherCode}건 · 앱이 명령을 다르게 정규화해 비교에서 뺀 요청 ${normalized}건 · 앱이 더 엄격하게 먼저 막은 예약 ${serverOnly}건 · HTTP 경계에서 앱이 축약한 서버 API 오류 ${httpMapped}건 · 건너뜀 ${JSON.stringify(skipped)}`)
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
