// 앱(PR #35 의 apps/workhub)의 응답 검증 함수로 R1 호환 함수의 "실제 출력"을 검사한다.
// run_r1.py 가 시험 중 받은 응답 봉투를 R1_CAPTURE 파일에 남기고, 이 도구가 그것을 앱 검증 함수에 그대로 넣는다.
// run_all.sh 가 esbuild 로 묶는다: --alias:r1app=<앱 소스>/apps/workhub/src  (앱 코드는 고치지 않고 가져다 쓰기만 한다)
import { readFileSync } from 'node:fs'
import {
  collectionAccess, collectionDetail, collectionFiles, collectionDraft, collectionEnvelope, collectionFileStatus, collectionList,
  collectionReadiness, collectionReceipt, collectionUpload, type CollectionScope,
} from 'r1app/collections/validation'

type Capture = { kind: string; scope: CollectionScope; raw: any; key?: string; requestId?: string; unitId?: string; fileId?: string; expected?: any }
const file = process.env.R1_CAPTURE
if (!file) { console.log('FAIL R1_CAPTURE 경로가 없습니다'); process.exit(1) }
const { captures } = JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 400))) }
const code = (e: unknown) => (e as { code?: string })?.code

const parsers: Record<string, (c: Capture, data: unknown) => unknown> = {
  readiness: (_c, d) => collectionReadiness(d),
  list: (c, d) => collectionList(d, c.scope),
  detail: (c, d) => collectionDetail(d, c.scope, c.requestId!),
  draft: (c, d) => collectionDraft(d, c.unitId!),
  receipt: (c, d) => collectionReceipt(d, c.key!),
  upload: (c, d) => collectionUpload(d, c.scope),
  status: (c, d) => collectionFileStatus(d, c.fileId!),
  // 앱 download() 와 같이 기대 파일을 먼저 collectionFiles 로 정규화한 뒤 비교한다(키 순서 고정)
  access: (c, d) => collectionAccess(d, c.scope, collectionFiles([c.expected])[0]),
}

const tally: Record<string, { ok: number; business: Record<string, number>; bad: number }> = {}
for (const c of captures) {
  const t = (tally[c.kind] ??= { ok: 0, business: {}, bad: 0 })
  let data: unknown
  try { data = collectionEnvelope(c.raw, c.scope) }
  catch (e) {
    // 업무 오류 봉투: 앱이 정해 둔 코드로 바뀌어야 한다(INVALID_RESPONSE 이면 형식 불일치)
    if (code(e) && code(e) !== 'INVALID_RESPONSE') { t.business[code(e)!] = (t.business[code(e)!] ?? 0) + 1; continue }
    t.bad++; console.log(`  봉투 불일치(${c.kind}): ${JSON.stringify(c.raw).slice(0, 300)}`); continue
  }
  if (c.kind === 'access' && !c.expected) { t.ok++; continue }   // 기대 파일을 모르는 기록은 봉투만 본다
  try { parsers[c.kind](c, data); t.ok++ }
  catch (e) { t.bad++; console.log(`  검증 실패(${c.kind}, ${code(e)}): ${JSON.stringify(data).slice(0, 300)}`) }
}
for (const [kind, t] of Object.entries(tally).sort()) {
  const biz = Object.entries(t.business).map(([k, n]) => `${k}×${n}`).join(' ')
  check(`AC-${kind} 앱 검증 함수 통과 ${t.ok}건${biz ? ` · 업무 오류 봉투 ${biz}` : ''}`, t.bad === 0 && t.ok > 0, t)
}
for (const k of Object.keys(parsers)) if (!tally[k]) check(`AC-${k} 응답 기록이 있음`, false, '이 종류의 응답을 하나도 받지 못함')

// 검증 함수가 실제로 걸러 내는지(다른 소속·학교로 바꾼 봉투는 INVALID_RESPONSE)
const sample = captures.find(c => c.kind === 'detail' && c.raw?.data)
if (sample) {
  const wrong = (patch: Record<string, unknown>) => { try { collectionEnvelope({ ...sample.raw, ...patch }, sample.scope); return 'OK' } catch (e) { return code(e) } }
  check('AC-x1 다른 소속 ID 가 적힌 봉투는 거부', wrong({ memberId: 'm-other' }) === 'INVALID_RESPONSE')
  check('AC-x2 다른 학교 ID 가 적힌 봉투는 거부', wrong({ schoolId: 'school-other' }) === 'INVALID_RESPONSE')
  let r: string | undefined = 'OK'
  try { collectionDetail(sample.raw.data, { ...sample.scope, schoolId: 'school-other' }, sample.requestId!) } catch (e) { r = code(e) }
  check('AC-x3 상세의 학교가 연결 범위와 다르면 거부', r === 'INVALID_RESPONSE')
} else check('AC-x 상세 응답 표본', false)
console.log(`app_contract: ${pass}/${pass + fail} 통과`)
process.exit(fail ? 1 : 0)
