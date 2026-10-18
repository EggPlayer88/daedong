// PR #65·#66 앱(apps/workhub, f244f6a)의 실제 시간표 서버 모듈 · parser 에 T1 의 "실제 출력"을 넣어 본다.
//   timetable.v1             createTimetableServer(readiness · get · saveDraft · recoverDraft) — server.ts
//   timetable.preparation.v1 createPreparationServer(get · execute · recover) — preparation-server.ts · preparation.ts
//   timetable.setup.v1       앱 parser 가 아직 없다 → 아래 setupSnapshot · setupReceipt 가 계약의 기준(T1_설계_계약.md 3절). 앱이 만들 때 이것과 같아야 한다.
// run_t1.py 가 시험 중 받은 응답과 그때의 workhub_context 를 T1_CAPTURE 에 남기고, 이 도구가 그 응답을 rpcVerified 자리에 돌려준다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다. run_all.sh 가 esbuild 로 묶는다: --alias:t1app=<checkout>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createTimetableServer } from 't1app/timetable/server'
import { createPreparationServer } from 't1app/timetable/preparation-server'
import { compilePreparation, preparationSource } from 't1app/timetable/preparation'
import { contextResponse } from 't1app/connection/validation'
import { canonical } from 't1app/services/scoped-rpc'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; error: string | null; [k: string]: any }
const file = process.env.T1_CAPTURE
if (!file) { console.log('FAIL T1_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 700))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const errorOf = (raw: any): string | undefined => raw?.error ? String(raw.error.code) : undefined

function connection(c: Capture, sent: { name: string; args: any }[], byName: Record<string, any> = {}) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => {
      sent.push({ name, args })
      if (Object.hasOwn(byName, name)) return structuredClone(byName[name])
      if (!c.raw) throw new Error(String(c.error)); return structuredClone(c.raw)
    },
  } as any
}

// ----------------------------------------------------------------------------- timetable.setup.v1 기준 parser(앱이 만들 때 같은 규칙)
const fail_ = (why: string): never => { throw new Error('INVALID_RESPONSE ' + why) }
const exact = (v: any, keys: string[], why: string) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) fail_(why) }
const id = (v: any, why: string) => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(v) ? v : fail_(why)
const int = (v: any, min: number, max: number, why: string) => Number.isSafeInteger(v) && v >= min && v <= max ? v : fail_(why)
const str = (v: any, max: number, why: string) => typeof v === 'string' && v.trim() && Array.from(v).length <= max ? v : fail_(why)
const day = (v: any, why: string) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fail_(why)
const hash = (v: any, why: string) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v) ? v : fail_(why)
const FINDINGS: Record<string, boolean> = { COURSE_ID_UNSUPPORTED: true, COURSE_STARTS_LATER: true, COURSE_ENDS_EARLY: true, TEACHER_CHANGES_IN_TERM: true, TEACHER_LEAVES_IN_TERM: true,
  LINK_CLASS_REMOVED: true, LINK_SPACE_REMOVED: true, SPACE_CAPACITY_MISSING: true, STUDENT_OVERLAP: true, COURSE_TEACHER_MISSING: false, COURSE_LINK_MISSING: false }
function setupSnapshot(v: any) {
  exact(v, ['termId', 'termLabel', 'firstDay', 'lastDay', 'referenceDay', 'sourceRevision', 'sourceFingerprint', 'canEdit', 'spaces', 'classes', 'courses', 'findings'], 'top')
  id(v.termId, 'termId'); str(v.termLabel, 120, 'termLabel'); day(v.firstDay, 'firstDay'); day(v.lastDay, 'lastDay'); day(v.referenceDay, 'ref')
  if (!(v.firstDay <= v.referenceDay && v.referenceDay <= v.lastDay) && v.referenceDay !== v.firstDay) fail_('ref range')
  int(v.sourceRevision, 1, Number.MAX_SAFE_INTEGER, 'rev'); hash(v.sourceFingerprint, 'fp'); if (v.canEdit !== true) fail_('canEdit')
  const spaces = new Set<string>(), classes = new Set<string>()
  for (const s of v.spaces) { exact(s, ['id', 'kind', 'label', 'capacity', 'version'], 'space'); spaces.add(id(s.id, 'space id')); if (!['room', 'equipment'].includes(s.kind)) fail_('space kind')
    str(s.label, 100, 'space label'); if (s.capacity !== null) int(s.capacity, 1, 1000, 'capacity'); int(s.version, 1, Number.MAX_SAFE_INTEGER, 'space ver') }
  for (const c of v.classes) { exact(c, ['id', 'label', 'grade'], 'class'); classes.add(id(c.id, 'class id')); str(c.label, 30, 'class label'); int(c.grade, 1, 20, 'grade') }
  for (const c of v.courses) {
    exact(c, ['id', 'label', 'inTimetable', 'teacherLabels', 'studentCount', 'link'], 'course'); if (typeof c.id !== 'string' || !c.id) fail_('course id'); str(c.label, 160, 'course label')
    if (typeof c.inTimetable !== 'boolean') fail_('inTimetable'); if (!Array.isArray(c.teacherLabels)) fail_('teachers'); c.teacherLabels.forEach((x: any) => str(x, 200, 'teacher'))
    int(c.studentCount, 0, Number.MAX_SAFE_INTEGER, 'students')
    if (c.link !== null) { exact(c.link, ['version', 'studentGroup', 'classIds', 'spaceIds'], 'link'); int(c.link.version, 1, Number.MAX_SAFE_INTEGER, 'link ver')
      if (typeof c.link.studentGroup !== 'boolean' || !Array.isArray(c.link.classIds) || !Array.isArray(c.link.spaceIds)) fail_('link fields')
      if (c.link.studentGroup && c.link.classIds.length) fail_('class+group')
      c.link.classIds.forEach((x: any) => id(x, 'link class')); c.link.spaceIds.forEach((x: any) => id(x, 'link space')) }
  }
  for (const f of v.findings) { exact(f, ['code', 'targetId', 'message', 'blocksConfirm'], 'finding'); if (!Object.hasOwn(FINDINGS, f.code) || FINDINGS[f.code] !== f.blocksConfirm) fail_('finding code')
    if (typeof f.targetId !== 'string' || !f.targetId) fail_('target'); str(f.message, 200, 'message') }
  return v
}
function setupReceipt(v: any, cmd: any, key: string) {
  exact(v, ['requestKey', 'kind', 'targetId', 'version', 'sourceFingerprint'], 'receipt')
  if (v.requestKey !== key || v.kind !== cmd.kind) fail_('key/kind'); if (typeof v.targetId !== 'string' || !v.targetId) fail_('target')
  int(v.version, 1, Number.MAX_SAFE_INTEGER, 'ver'); if (v.sourceFingerprint !== null) hash(v.sourceFingerprint, 'fp')
  if (cmd.kind === 'course_link' && v.targetId !== cmd.courseId) fail_('course target')
  if (cmd.kind !== 'course_link' && cmd.spaceId !== null && v.targetId !== cmd.spaceId) fail_('space target')
  if (cmd.expectedVersion !== null && v.version !== cmd.expectedVersion + 1) fail_('version +1')
  if (cmd.expectedVersion === null && cmd.kind !== 'space_remove' && v.version !== 1) fail_('new version 1')
  return v
}

// ----------------------------------------------------------------------------- 대조
const tally: Record<string, { same: number; localFirst: number; serverOnly: number; priorRead: number }> = {}
const t = (k: string) => (tally[k] ??= { same: 0, localFirst: 0, serverOnly: 0, priorRead: 0 })
const mismatches: string[] = []
async function outcome(fn: () => Promise<any>) { try { return { ok: true, value: await fn(), code: '' } } catch (e) { return { ok: false, value: null, code: code(e) } } }
// 서버 결과와 앱 결과가 같은가. 앱이 보내기 전에 같은 코드로 먼저 거절한 것도 일치로 센다(보내지 않았음을 확인).
// 앱은 쓰기 전에 조회(get)를 먼저 한다. 그 조회가 서버에서 거절됐으면(예: 일반 교사 FORBIDDEN) 앱은 쓰기를 보내지 않고 NOT_READY 로 멈춘다 —
// 사용자는 이미 조회 단계에서 같은 거절을 본다. 이 경우는 따로 센다(priorRead).
function compare(kind: string, label: string, c: Capture, out: { ok: boolean; value: any; code: string }, sent: { name: string }[], target: string, extra?: (v: any) => string | null, priorError?: string) {
  const server = errorOf(c.raw) ?? (c.raw ? 'OK' : 'EXCEPTION')
  const sentTarget = sent.some(s => s.name === target)
  if (server === 'OK') {
    const why = out.ok ? (extra ? extra(out.value) : null) : `앱 ${out.code}`
    if (why) mismatches.push(`${kind} ${label}: 서버 ok · ${why}`); else t(kind).same++
    return
  }
  if (out.ok) { mismatches.push(`${kind} ${label}: 서버 ${server} · 앱 성공`); return }
  if (!sentTarget && out.code === 'NOT_READY' && priorError === server) { t(kind).priorRead++; return }
  if (out.code !== server) { mismatches.push(`${kind} ${label}: 서버 ${server} · 앱 ${out.code}${sentTarget ? '' : '(보내기 전)'}`); return }
  sentTarget ? t(kind).serverOnly++ : t(kind).localFirst++
}

async function main() {
  const envelopeBad: string[] = []
  for (const [i, c] of captures.entries()) {
    if (!c.raw) continue
    const keys = Object.keys(c.raw).sort().join(',')
    if (!(keys === 'contract,data,memberId,schoolId' || keys === 'contract,error,memberId,schoolId') || c.raw.schoolId !== c.scope.schoolId || c.raw.memberId !== c.scope.memberId
        || (c.raw.error && Object.keys(c.raw.error).join() !== 'code')) envelopeBad.push(`${i}:${c.kind}`)
    const contract = { readiness: 'timetable.v1', get: 'timetable.v1', save: 'timetable.v1', prep_get: 'timetable.preparation.v1', prep_exec: 'timetable.preparation.v1',
                       setup_get: 'timetable.setup.v1', setup_exec: 'timetable.setup.v1' }[c.kind]
    if (c.raw.contract !== contract) envelopeBad.push(`${i}:${c.kind} contract ${c.raw.contract}`)
  }
  check(`봉투: ${captures.filter(c => c.raw).length}건 모두 {contract, schoolId, memberId, data | error:{code}} · 계약 이름 · 학교 · 소속 일치`, !envelopeBad.length, envelopeBad)
  check('예외로 끝난 응답 없음(모든 업무 거절은 봉투)', captures.every(c => c.raw), captures.filter(c => !c.raw).map(c => [c.kind, c.error]))

  let confirms = 0, k3 = 0, compileAgree = 0, compileChecked = 0
  for (const [i, c] of captures.entries()) {
    const sent: { name: string; args: any }[] = [], label = `#${i}`
    if (c.kind === 'readiness') {
      const out = await outcome(() => createTimetableServer(connection(c, sent)).readiness(c.scope.memberId))
      compare('readiness', label, c, out, sent, 'workhub_timetable_readiness', v => canonical(v) === canonical(c.raw.data) ? null : '값 다름')
    } else if (c.kind === 'get') {
      const out = await outcome(() => createTimetableServer(connection(c, sent)).get(c.scope.memberId, c.week))
      compare('get', label, c, out, sent, 'workhub_timetable_get', v => canonical(v) === canonical(c.raw.data) ? null : '값 다름')
    } else if (c.kind === 'save') {
      const server = createTimetableServer(connection(c, sent, c.getRaw ? { workhub_timetable_get: c.getRaw } : {}))
      const week = c.getRaw?.data?.weekStart
      if (c.recover) {
        compare('save(recover)', label, c, await outcome(() => server.recoverDraft(c.scope.memberId, c.input, c.key)), sent, 'workhub_timetable_save_draft')
      } else {
        if (c.getRaw && !c.getRaw.error) await outcome(() => server.get(c.scope.memberId, week))
        compare('save', label, c, await outcome(() => server.saveDraft(c.scope.memberId, c.input, c.key)), sent, 'workhub_timetable_save_draft', undefined, errorOf(c.priorRaw))
      }
    } else if (c.kind === 'prep_get') {
      const out = await outcome(() => createPreparationServer(connection(c, sent)).get(c.scope.memberId))
      compare('prep_get', label, c, out, sent, 'workhub_timetable_preparation_get', v => canonical(v) === canonical(c.raw.data) ? null : '값 다름')
    } else if (c.kind === 'prep_exec') {
      const srcRaw = c.sourceRaw
      const server = createPreparationServer(connection(c, sent, srcRaw ? { workhub_timetable_preparation_get: srcRaw } : {}))
      let source: any = null
      if (srcRaw && !srcRaw.error) source = (await outcome(() => server.get(c.scope.memberId))).value
      const out = await outcome(() => c.recover ? server.recover(c.scope.memberId, c.input, c.key, source ?? undefined) : server.execute(c.scope.memberId, c.input, c.key))
      compare(c.recover ? 'prep_exec(recover)' : 'prep_exec', label, c, out, sent, 'workhub_timetable_preparation_execute', v => {
        if (c.input.kind !== 'confirm') return v.basis === null ? null : 'basis 있음'
        confirms++
        // K-3: 앱 compilePreparation(같은 원본 · 초안 · 서버 ID · 판) = 서버 기준판(정준형 비교)
        const compiled = compilePreparation(source, c.input.draft, v.basis.id, v.basis.revision)
        if (compiled.basis && canonical(compiled.basis) === canonical(v.basis)) { k3++; return null }
        return 'K-3 기준판 다름'
      }, errorOf(c.priorRaw))
      // 서버가 확정을 INVALID_INPUT 으로 거절한 경우 · 성공한 경우: 앱 compile 판정이 같은가(같은 원본 판일 때만)
      if (source && c.input.kind === 'confirm' && !c.recover && c.input.sourceFingerprint === source.sourceFingerprint && c.input.sourceRevision === source.sourceRevision) {
        const serverCode = errorOf(c.raw) ?? 'OK'
        if (serverCode === 'OK' || serverCode === 'INVALID_INPUT') {
          compileChecked++
          let appBasis = false
          try { appBasis = !!compilePreparation(source, c.input.draft).basis } catch { appBasis = false }
          if (appBasis === (serverCode === 'OK')) compileAgree++; else mismatches.push(`compile ${label}: 서버 ${serverCode} · 앱 compile ${appBasis ? '통과' : '거절'}`)
        }
      }
    } else if (c.kind === 'setup_get') {
      if (c.raw.error) { t('setup_get').serverOnly++; continue }
      try { setupSnapshot(c.raw.data); t('setup_get').same++ } catch (e) { mismatches.push(`setup_get ${label}: ${String(e)}`) }
    } else if (c.kind === 'setup_exec') {
      if (c.raw.error) { t('setup_exec').serverOnly++; continue }
      try { setupReceipt(c.raw.data, c.command, c.key); t('setup_exec').same++ } catch (e) { mismatches.push(`setup_exec ${label}: ${String(e)}`) }
    }
  }
  for (const [k, v] of Object.entries(tally)) console.log(`INFO ${k}: 같은 결과 ${v.same} · 앱이 보내기 전 같은 코드로 거절 ${v.localFirst} · 서버만 거절(앱 통과 · 서버 코드 그대로 전달) ${v.serverOnly} · 앞선 조회에서 같은 코드로 거절 ${v.priorRead}`)
  check(`서버 응답 ${captures.length}건을 앱 서버 모듈 · parser 에 넣은 결과가 모두 일치`, !mismatches.length, mismatches)
  check(`K-3: 확정 접수증의 기준판 ${confirms}건 = 앱 compilePreparation 결과(정준형 · 배열 순서 포함)`, confirms > 0 && k3 === confirms, { confirms, k3 })
  check(`확정 판정: 서버 성공 · INVALID_INPUT ${compileChecked}건 = 앱 compilePreparation 통과 · 거절`, compileChecked > 0 && compileAgree === compileChecked, { compileChecked, compileAgree })
  const sources = captures.filter(c => c.kind === 'prep_get' && c.raw?.data).map(c => preparationSource(c.raw.data, c.scope.schoolId))
  check(`준비 원본 ${sources.length}건: requiredPeriods 전부 null(정책 1 — 추정 없음) · 공간 자원 정원은 입력값만`, sources.length > 0
        && sources.every(s => s.courses.every(x => x.requiredPeriods === null)), null)
  for (const k of ['readiness', 'get', 'save', 'prep_get', 'prep_exec', 'setup_get', 'setup_exec'])
    check(`${k} 응답을 1건 이상 대조함`, (tally[k]?.same ?? 0) + (tally[k]?.localFirst ?? 0) + (tally[k]?.serverOnly ?? 0) + (tally[k]?.priorRead ?? 0) > 0, tally[k])
  console.log(`합계: PASS ${pass} · FAIL ${fail}`)
  process.exit(fail ? 1 : 0)
}
main()
