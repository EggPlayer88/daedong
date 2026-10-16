// PR #60 앱(apps/workhub)의 실제 서비스 · parser 에 P8 의 "실제 출력"을 넣어 본다.
//   업무 전환(createTransitionService) · 학교 관리(createSupabaseSchoolAdminServer) · 협업(createCooperationAdapter)
//   · 알림함(createSupabaseMessagingServer.inbox) · 수업 관계(createTeachingRelationsAdapter)
// run_p8.py 가 시험 중 받은 응답과 그때의 workhub_context 를 P8_CAPTURE 에 남기고, 이 도구가 그 응답을 rpcVerified 자리에 돌려준다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다. run_all.sh 가 esbuild 로 묶는다: --alias:p8app=<PR #60 checkout>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createTransitionService } from 'p8app/administration/transitions'
import { createSupabaseSchoolAdminServer } from 'p8app/setup/school-admin-server'
import { academicYearStartMatches } from 'p8app/setup/academic-year'
import { createCooperationAdapter } from 'p8app/cooperation/adapter'
import { createSupabaseMessagingServer } from 'p8app/messaging/supabase-messaging'
import { createTeachingRelationsAdapter } from 'p8app/teaching/relations-adapter'
import { relationCanonical, relationsSnapshot } from 'p8app/teaching/relations-validation'
import { csvHash } from 'p8app/teaching/csv'
import { contextResponse } from 'p8app/connection/validation'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; error: string | null; [k: string]: any }
const file = process.env.P8_CAPTURE
if (!file) { console.log('FAIL P8_CAPTURE 경로가 없습니다'); process.exit(1) }
const doc = JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[]; bridge: boolean }
const captures = doc.captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 600))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}'
  return JSON.stringify(v)
}

// 앱의 연결(로그인 · 학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 이름별로 기록한 실제 응답을 돌려준다.
function connection(c: Capture, sent: { name: string; args: any }[], byName: Record<string, any> = {}) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => {
      sent.push({ name, args })
      if (Object.hasOwn(byName, name)) { if (byName[name] === null) throw new Error('응답 없음'); return structuredClone(byName[name]) }
      if (!c.raw) throw new Error(String(c.error)); return structuredClone(c.raw)
    },
  } as any
}
const errorOf = (raw: any): string | undefined => !raw ? undefined : raw.ok === false ? String(raw.code) : raw.error ? String(raw.error.code) : undefined

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
const skipped: Record<string, number> = {}
const localDiff: Record<string, number> = {}
const states: Record<string, number> = {}
let localFirst = 0, hashChecked = 0, cooperationNotices = 0, modernLists = 0, legacyLists = 0
const unexpected: string[] = []

// 같은 요청 번호가 앞서 나온 업무 전환 쓰기 = 기존 요청의 복구(앱 service.recover). 처음 보내는 것은 새 명령(service.mutate).
// 복구 건은 새 명령으로도 한 번 더 넣어 보아, 새 명령의 준비 조건(관리자 확인 모듈 등)이 그대로인지 따로 센다(PR #63).
const seenKeys = new Set<string>(), asNew: Record<string, number> = {}
let recovered = 0
for (const c of captures) {
  const isRecovery = c.kind === 'tr_mutate' && seenKeys.has(c.key)
  if (c.kind === 'tr_mutate') seenKeys.add(c.key)
  if (!c.context) { bump(skipped, `${c.kind}: workhub_context 가 없는 계정`); continue }
  if (!c.raw && /^[A-Z_]+$/.test(String(c.error)) && !String(c.error).startsWith('P8_TEST')) { bump(skipped, `${c.kind}: 봉투 없는 예외 ${c.error}(앱 연결 단계 · 서버 쪽만 확인)`); continue }
  if (c.kind === 'message_mutate' || c.kind === 'teaching_mutate' || c.kind === 'catalog' || c.kind === 'course' || c.kind === 'coop_get') continue   // 앞 단계 계약 — 각 단계 시험이 본다
  const writing = ['tr_mutate', 'sa_mutate', 'coop_mutate', 'rel_commit'].includes(c.kind)
  const want = !c.raw ? (writing ? 'UNCERTAIN' : 'QUERY_FAILED') : errorOf(c.raw)
  const sent: { name: string; args: any }[] = []
  const m = c.scope.memberId
  let t = c.kind
  try {
    let out: any, same: any, expected: { name: string; args: any }
    switch (c.kind) {
      case 'tr_list': {
        expected = { name: 'workhub_school_transition_list', args: { p_cursor: c.cursor ?? null, p_member_id: m } }
        out = await createTransitionService(connection(c, sent)).list(m, c.cursor ?? null)
        const d = c.raw.data, modern = Object.hasOwn(d, 'dutyApproval')
        modern ? modernLists++ : legacyLists++
        // 옛 모양이면 앱은 빈 칸을 기본값으로 채운다(dutyApproval null · 기록 4칸 null/false)
        same = modern ? d : { ...d, dutyApproval: null, records: d.records.map((r: any) => ({ ...r, requesterMemberId: null, requiresAdminReview: null, canAdminReview: false, adminReview: null })) }
        t = modern ? 'tr_list(새 모양)' : 'tr_list(옛 모양)'
        if (modern) for (const r of d.records) bump(states, `${r.requiresAdminReview ? 'duty' : 'other'}:${r.state}:${r.version}`)
        break
      }
      case 'tr_preview':
        expected = { name: 'workhub_school_transition_preview', args: { p_plan: c.plan, p_member_id: m } }
        out = await createTransitionService(connection(c, sent, { workhub_school_transition_list: c.listRaw })).preview(m, c.plan); same = c.raw.data; break
      case 'tr_mutate':
        expected = { name: 'workhub_school_transition_mutate', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        if (isRecovery) {
          recovered++
          try { await createTransitionService(connection(c, [], { workhub_school_transition_list: c.listRaw })).mutate(m, c.command, c.key); bump(asNew, `${c.command?.kind}:보냄`) }
          catch (e) { bump(asNew, `${c.command?.kind}:${code(e)}`) }
        }
        { const svc = createTransitionService(connection(c, sent, { workhub_school_transition_list: c.listRaw }))
          // 거절 · 결과 모름은 종류 없이 'tr_mutate' / 'tr_recover' 로 센다(아래 강제 실패 확인이 이 이름을 본다)
          if (isRecovery) t = 'tr_recover'
          out = isRecovery ? await svc.recover(m, c.command, c.key) : await svc.mutate(m, c.command, c.key)
          t = `${isRecovery ? 'tr_recover' : 'tr_mutate'}:${c.command?.kind}` }
        same = { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state, legacyDutyReceipt: false }
        bump(states, 'receipt:' + c.raw.data.state); break
      case 'sa_get':
        expected = { name: 'workhub_school_admin_get', args: { p_school_year: c.year ?? null, p_member_id: m } }
        out = await createSupabaseSchoolAdminServer(connection(c, sent)).get(m, c.year ?? undefined); same = c.raw.data; break
      case 'sa_mutate':
        expected = { name: 'workhub_school_admin_mutate', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        out = await createSupabaseSchoolAdminServer(connection(c, sent)).mutate(m, c.command, c.key); same = c.raw.data; t = `sa_mutate:${c.command?.mode}`; break
      case 'coop_mutate':
        expected = { name: 'workhub_cooperation_mutate', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        out = await createCooperationAdapter(connection(c, sent)).mutate(m, c.command, c.key); same = null; break
      case 'inbox': {
        expected = { name: 'workhub_inbox_list', args: { p_unread_only: false, p_cursor: c.cursor ?? null, p_member_id: m } }
        out = await createSupabaseMessagingServer(connection(c, sent)).inbox(m, false, c.cursor ?? null); same = null
        cooperationNotices += out.items.filter((x: any) => x.source?.module === 'cooperation').length; break
      }
      case 'rel_snapshot':
        expected = { name: 'workhub_teaching_relations', args: { p_course_id: c.courseId, p_member_id: m } }
        out = await createTeachingRelationsAdapter(connection(c, sent)).snapshot(m, c.courseId); same = c.raw; break
      case 'rel_preview': {
        expected = { name: 'workhub_teaching_relation_preview', args: { p_intent: c.intent, p_member_id: m } }
        const app = createTeachingRelationsAdapter(connection(c, sent, { workhub_teaching_relations: c.snapshotRaw }))
        if (c.snapshotRaw && c.snapshotRaw.ok !== false) await app.snapshot(m, c.intent.courseId)
        out = await app.preview(m, c.intent); same = c.raw; t = `rel_preview:${c.intent?.kind ?? '?'}`; break
      }
      case 'rel_commit': {
        expected = { name: 'workhub_teaching_relation_commit', args: { p_command: c.command, p_request_key: c.key, p_member_id: m } }
        out = await createTeachingRelationsAdapter(connection(c, sent)).commit(m, c.command, c.key); same = c.raw; t = `rel_commit:${c.raw?.outcome ?? '?'}`; break
      }
      default: bump(skipped, '알 수 없는 종류 ' + c.kind); continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    // 앱이 덧붙이는 봉투 칸(관계 계약)은 서버 원형에 있는 것이므로 그대로 비교한다
    if (same !== null && canonical(out) !== canonical(same)) throw new Error('앱이 해석한 값이 서버 응답과 다름 ' + JSON.stringify(out).slice(0, 300))
    const mine = sent.filter(x => x.name === expected.name)
    if (mine.length !== 1 || canonical(mine[0]) !== canonical(expected)) throw new Error('보낸 이름 · 인자 다름 ' + JSON.stringify(sent).slice(0, 300))
    note(t).ok++; bump(note(t).codes, 'ok')
  } catch (e) {
    const got = code(e), mine = sent.filter(x => !['workhub_school_transition_list', 'workhub_teaching_relations'].includes(x.name) || c.kind === 'tr_list' || c.kind === 'rel_snapshot')
    if (want && (got === want || (want === 'UNCERTAIN' && ['RESULT_UNKNOWN', 'SAVE_UNCERTAIN'].includes(got)))) {
      note(t).ok++; bump(note(t).codes, want); if (!mine.length) localFirst++
    } else if (want && !mine.length) {
      // 앱이 서버에 보내기 전에 스스로 거절했지만 코드가 다르다(서버 계약 문제가 아니라 앱 쪽 문구 — 보고)
      note(t).ok++; bump(note(t).codes, want); bump(localDiff, `${t}: 서버 ${want} · 앱이 먼저 ${got}`)
    } else {
      note(t).bad++
      // C8(#60 결함, #63 에서 수정 주장): 공식 담당이 없는 수락 · 반려(또는 같은 번호 복구)도 관리자 확인 모듈이 켜져 있어야만 보낸다
      const c8 = c.kind === 'tr_mutate' && !want && got === 'NOT_READY' && c.command?.kind !== 'apply' && c.command?.kind !== 'cancel' && c.listRaw?.data?.dutyApproval !== 'admin_review_v1'
      unexpected.push(`${c8 ? '[C8] ' : ''}${t}(${c.command?.kind ?? ''}) 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.map(x => x.name).join('+')} 목록 dutyApproval=${JSON.stringify(c.listRaw?.data?.dutyApproval)}`)
      console.log(`  불일치 ${t} 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.length} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 300)} 명령=${JSON.stringify(c.command ?? c.intent ?? c.plan ?? null).slice(0, 300)}`)
    }
  }
}

// ---- 명령 지문: 서버 commandHash(p2_sha) = 앱 csvHash(relationCanonical(명령)) — 실제 거절 봉투로
for (const c of captures.filter(c => c.kind === 'rel_commit' && c.raw?.ok === false && typeof c.raw.commandHash === 'string' && c.command && typeof c.command === 'object')) {
  const h = await csvHash(relationCanonical(c.command))
  if (h !== c.raw.commandHash) { console.log('  지문 다름', c.raw.code, h, c.raw.commandHash); fail++ } else hashChecked++
}
for (const [k, v] of Object.entries(tally).sort()) check(`앱 ${k}: 서버 응답을 앱이 같은 결과로 해석 (${Object.entries(v.codes).map(([a, b]) => a + ' ' + b).join(', ')})`, v.bad === 0, v)
check(`업무 전환 같은 번호 재전송 ${recovered}건은 service.recover 로 넣음(새 명령은 service.mutate)`, recovered > 0, recovered)
console.log(`  INFO 복구 건을 새 명령(service.mutate)으로 보냈다면: ${JSON.stringify(asNew)} — 새 명령의 준비 조건 보호(복구와 별개)`)
check(`관계 확정 거절 봉투의 commandHash = 앱 csvHash(relationCanonical(명령)) — ${hashChecked}건(한글 사유 포함)`, hashChecked >= 3, hashChecked)
check(`업무 전환 목록: 옛 모양 ${legacyLists}건 · 새 모양 ${modernLists}건을 모두 앱이 읽음`, legacyLists > 0 && modernLists > 0)
const want = ['duty:awaiting_admin:1', 'duty:pending:2', 'duty:accepted:3', 'duty:rejected:2', 'duty:rejected:3', 'duty:cancelled:2', 'receipt:awaiting_admin', 'receipt:pending', 'receipt:accepted', 'receipt:completed']
check(`관리자 확인 흐름의 상태 · 판 조합(${want.join(' · ')})을 앱 parser 가 모두 받아들임`, want.every(k => (states[k] ?? 0) > 0), states)
check(`알림함: 협업 출처 알림 ${cooperationNotices}건을 앱이 {module:cooperation,id} 로 읽음`, cooperationNotices >= 6, cooperationNotices)
const relKinds = ['rel_preview:membership_end', 'rel_preview:assignment_replace', 'rel_preview:assignment_end', 'rel_preview:student_transfer_out', 'rel_commit:applied', 'rel_commit:replayed']
check(`수업 관계: 네 가지 의도의 미리보기와 확정(applied · replayed)을 앱이 받아들임`, relKinds.every(k => (tally[k]?.codes.ok ?? 0) > 0), Object.keys(tally).filter(k => k.startsWith('rel_')))
const codes = Object.entries(tally).filter(([k]) => k.startsWith('rel_')).reduce((a, [, v]) => ({ ...a, ...v.codes }), {} as Record<string, number>)
const REL = ['UNAVAILABLE', 'INVALID_INPUT', 'FORBIDDEN', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT']
check(`수업 관계 거절 코드(${REL.join(' · ')})가 시험에 나오고 앱이 같은 코드로 받음`, REL.every(k => (codes[k] ?? 0) > 0), codes)
check(`중간 강제 실패(봉투 없는 오류)를 앱이 결과 모름으로 받음 — 업무 인계 수락(관리자 확인 뒤) · 협업 처리`,
      (tally['tr_mutate']?.codes.UNCERTAIN ?? 0) > 0 && (tally['coop_mutate']?.codes.UNCERTAIN ?? 0) > 0, { tr: tally['tr_mutate']?.codes, coop: tally['coop_mutate']?.codes })
// Q4: 앱의 학년도 시작 연도 검사가 서버와 같은 규칙인지(서버가 받아들인 · 거절한 실제 입력으로)
const q4 = captures.filter(c => c.kind === 'sa_mutate' && c.command?.mode === 'create_year')
const q4ok = q4.every(c => academicYearStartMatches(Number(c.command.configuration.schoolYear), c.command.configuration.startsOn) === !(c.raw?.error?.code === 'INVALID_INPUT'))
check(`Q4: 학교 관리 새 학년도 ${q4.length}건 — 앱 academicYearStartMatches 판정 = 서버 판정`, q4.length >= 2 && q4ok, q4.map(c => [c.command.configuration.schoolYear, c.command.configuration.startsOn, c.raw?.error?.code ?? 'ok']))
// 옛 SQL 응답(설치만 · 켜기 전)은 snapshot parser 가 깨지지 않고 UNAVAILABLE 로 받는다
const unav = captures.filter(c => c.kind === 'rel_snapshot' && c.raw?.code === 'UNAVAILABLE')
check(`켜기 전 관계 조회 UNAVAILABLE ${unav.length}건 → 앱 UNAVAILABLE(수업 기록 열람은 따로)`, unav.length > 0 && (tally.rel_snapshot?.codes.UNAVAILABLE ?? 0) >= unav.length)
const snaps = captures.filter(c => c.kind === 'rel_snapshot' && c.raw && c.raw.ok !== false)
let snapOk = 0
for (const c of snaps) { try { relationsSnapshot(structuredClone(c.raw), { schoolId: c.scope.schoolId, memberId: c.scope.memberId, ownerUserId: c.scope.userId } as any, c.courseId); snapOk++ } catch (e) { console.log('  관계 조회 parser 거부', code(e)) } }
check(`관계 조회 parser(relationsSnapshot) 직접: ${snaps.length}건 모두 통과`, snaps.length > 0 && snapOk === snaps.length)
if (Object.keys(localDiff).length) console.log('WARN 앱이 보내기 전에 막았지만 코드가 다름(PR #60 앱 쪽 확인): ' + JSON.stringify(localDiff))
check('건너뛴 응답은 workhub_context 없는 계정 · 봉투 없는 예외뿐', Object.keys(skipped).every(k => k.includes('workhub_context') || k.includes('봉투 없는 예외')), skipped)
console.log(`앱이 보내기 전에 같은 코드로 먼저 막은 요청 ${localFirst}건 · 건너뜀 ${JSON.stringify(skipped)}`)
if (unexpected.length) console.log('예상하지 못한 불일치(재현 조건 위): ' + unexpected.join(' | '))
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
