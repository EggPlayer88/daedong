// PR #72 앱(apps/workhub)의 실제 시간표 운영 parser 에 T2 SQL 의 "실제 출력"을 넣어 본다. 앱 코드는 고치지 않고 가져다 쓰기만 한다.
//   timetable-operations.v1 · next.v1  parseOperationsReadiness · parseOperationsView · parsePublishPreview · parseOperationReceipt ·
//                                      parseExchangePreview · parseOperationReferences · parseExchangeRecommendations · parsePublicationManifest · parsePublicationPage
//   timetable-publication.v1           parsePublicationCommitReceipt
//   timetable-school-day.v1            parseSchoolDayExecutionPreview · parseSchoolDayCommitReceipt
//   timetable.execution-records.v1     parseExecutionRecordsView · parseExecutionHistoryPage · parseExecutionRecordReceipt
// run_t2.py 가 받은 응답을 T2_CAPTURE 에 순서대로 남긴다. 화면이 실제로 하는 순서(조회 → 미리보기 → 실행)대로 앞의 응답을 근거로 뒤를 검사한다.
// run_all.sh 가 esbuild 로 묶는다: --alias:t2app=<PR #72 checkout>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { parseOperationsReadiness, parseOperationsView, parsePublishPreview, parsePublishInput, parseOperationReceipt, parseOperationCommand, operationCommandHash,
         parseExchangePreview, parseExchangeInput } from 't2app/timetable/operations-server'
import { parseOperationReferences, parseExchangeRecommendations, parseRecommendationInput, parsePublicationManifest, parsePublicationPage } from 't2app/timetable/operations-next-server'
import { parsePublicationCommitReceipt, publicationCommandHash } from 't2app/timetable/publication-execution-server'
import { parseSchoolDayExecutionInput, parseSchoolDayExecutionPreview, parseSchoolDayCommitReceipt, schoolDayCommitCommand } from 't2app/timetable/school-day-execution-server'
import { parseExecutionRecordsView, parseExecutionHistoryPage, parseExecutionRecordReceipt, executionRecordCommand, executionRecordCommandHash } from 't2app/timetable/execution-records'
import { publicationCommitReference } from 't2app/timetable/publication-execution-server'
import { schoolDayCompactCommand } from 't2app/timetable/school-day-execution-server'
import { parseRequestAbandonResult } from 't2app/timetable/request-abandon'
import { canonical } from 't2app/services/scoped-rpc'
import { createHash } from 'node:crypto'
const sha = (x: unknown) => createHash('sha256').update(canonical(x)).digest('hex')

type Capture = { kind: string; at: number; scope: { schoolId: string; memberId: string }; raw: any; error: string | null; [k: string]: any }
const file = process.env.T2_CAPTURE
if (!file) { console.log('FAIL T2_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const seen: Record<string, number> = {}
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; if (!ok) console.log('FAIL ' + name + '  -- ' + JSON.stringify(info).slice(0, 900)) }
const err = (e: unknown) => (e as { code?: string })?.code ?? String(e)

const views = new Map<string, any>(), refs = new Map<string, any>(), execViews = new Map<string, any>()
let lastSchoolDay: { result: any; view: any; refs: any } | null = null, lastManifest: any = null
for (const c of captures) {
  const env = c.raw, m = c.scope.memberId
  if (!env || !('data' in env)) { if (env && env.error) { seen['error:' + c.kind] = (seen['error:' + c.kind] ?? 0) + 1 } continue }
  const data = env.data, now = c.at
  let ok = true, info: unknown = null
  try {
    switch (c.kind) {
      case 'ops_readiness': parseOperationsReadiness(data); break
      case 'ops_get': views.set(m, parseOperationsView(data, m, c.range.from, c.range.until, now)); break
      case 'references': { const v = views.get(m); if (v.asOf !== c.asOf) throw new Error('조회 asOf 와 다른 참조'); refs.set(m, parseOperationReferences(data, v)); break }
      case 'publish_preview': parsePublishPreview(data, parsePublishInput(c.input), views.get(m)?.timeZone ?? 'Asia/Seoul', now); break
      case 'exchange_preview': parseExchangePreview(data, parseExchangeInput(c.input), views.get(m), now); break
      case 'recommend': parseExchangeRecommendations(data, parseRecommendationInput(c.input), views.get(m), now); break
      case 'ops_execute': { const cmd = parseOperationCommand(c.command); parseOperationReceipt(data, cmd, c.key, await operationCommandHash(cmd), now); break }
      case 'publish_manifest': lastManifest = await parsePublicationManifest(data, parsePublishInput(c.input), now); break
      case 'publish_page': await parsePublicationPage(data, lastManifest, 0); break
      case 'publication_execute': { const cmd = { kind: 'publish_manifest' as const, manifest: lastManifest }
        parsePublicationCommitReceipt(data, cmd, c.key, await publicationCommandHash(cmd), now); break }
      case 'school_day_preview': { const v = views.get(m), r = refs.get(m), input = parseSchoolDayExecutionInput(c.input)
        lastSchoolDay = { result: await parseSchoolDayExecutionPreview(data, input, v, r, now), view: v, refs: r }; break }
      case 'school_day_execute': await parseSchoolDayCommitReceipt(data, schoolDayCommitCommand(lastSchoolDay!.result, lastSchoolDay!.view, lastSchoolDay!.refs), c.key, now); break
      case 'execution_get': execViews.set(m + ':' + c.lessonId, parseExecutionRecordsView(data, c.lessonId, now)); break
      case 'execution_history': { const v = execViews.get(m + ':' + c.lessonId), last = v.history.at(-1)
        parseExecutionHistoryPage(data, c.lessonId, c.anchor, last.version - 1, last.id, last, v.asOf); break }
      case 'execution_record': { const cmd = executionRecordCommand(c.command); parseExecutionRecordReceipt(data, cmd, c.key, await executionRecordCommandHash(cmd), m, now); break }
      case 'abandon': {
        // 앱이 그 종류의 실행 RPC 로 보낸 명령과 닫기에 보내는 명령이 같은 모양인지 먼저 본다(지문이 같아야 원장과 맞음)
        const k = c.abandonKind, sent = c.command; let parseReceipt: (v: unknown) => unknown
        if (k === 'operations') { const cmd = parseOperationCommand(sent); if (canonical(cmd) !== canonical(sent)) throw new Error('운영 명령 모양 다름')
          const h = await operationCommandHash(cmd); parseReceipt = v => parseOperationReceipt(v, cmd, c.key, h, now) }
        else if (k === 'publication') { const cmd = { kind: 'publish_manifest' as const, manifest: lastManifest }
          if (canonical(publicationCommitReference(cmd as any)) !== canonical(sent)) throw new Error('공개 명령 모양 다름')
          const h = await publicationCommandHash(cmd as any); parseReceipt = v => parsePublicationCommitReceipt(v, cmd as any, c.key, h, now) }
        else if (k === 'school_day') { const cmd = schoolDayCommitCommand(lastSchoolDay!.result, lastSchoolDay!.view, lastSchoolDay!.refs)
          if (canonical(schoolDayCompactCommand(cmd)) !== canonical(sent)) throw new Error('학사 변경 명령 모양 다름')
          parseReceipt = v => parseSchoolDayCommitReceipt(v, cmd, c.key, now) }
        else if (k === 'execution') { const cmd = executionRecordCommand(sent); if (canonical(cmd) !== canonical(sent)) throw new Error('실시 기록 명령 모양 다름')
          const h = await executionRecordCommandHash(cmd); parseReceipt = v => parseExecutionRecordReceipt(v, cmd, c.key, h, m, now) }
        else throw new Error('모르는 닫기 종류 ' + k)
        const r = await parseRequestAbandonResult(data, k, c.key, sha(sent), parseReceipt, now)
        seen['abandon:' + k + ':' + r.outcome] = (seen['abandon:' + k + ':' + r.outcome] ?? 0) + 1
        break }
      default: throw new Error('모르는 종류 ' + c.kind)
    }
  } catch (e) { ok = false; info = { error: err(e), data } }
  seen[c.kind] = (seen[c.kind] ?? 0) + 1
  check(`${c.kind} #${seen[c.kind]} (${m})`, ok, info)
}
const need = ['ops_readiness', 'ops_get', 'references', 'publish_preview', 'exchange_preview', 'recommend', 'ops_execute', 'publish_manifest', 'publish_page',
              'publication_execute', 'school_day_preview', 'school_day_execute', 'execution_get', 'execution_history', 'execution_record',
              'abandon:operations:applied', 'abandon:operations:abandoned', 'abandon:publication:applied', 'abandon:publication:abandoned',
              'abandon:school_day:applied', 'abandon:school_day:abandoned', 'abandon:execution:applied', 'abandon:execution:abandoned']
check('모든 응답 종류를 한 번 이상 앱 parser 로 대조함', need.every(k => (seen[k] ?? 0) > 0), need.filter(k => !seen[k]))
console.log(`PASS 앱 parser 대조: 성공 응답 ${pass}건 통과 · 실패 ${fail}건 (종류별 ${JSON.stringify(seen)})`)
if (fail) { console.log('FAIL 앱 parser 대조 실패 ' + fail + '건'); process.exit(1) }
