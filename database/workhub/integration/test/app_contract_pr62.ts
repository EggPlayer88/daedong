// PR #62(사용성 보완) 앱 코드에 1~8단계 SQL 의 "실제 응답"을 넣어 본다. 앱은 고치지 않고 가져다 쓰기만 한다.
//   A 학생 기록 출력: P5 수업 · 학생 · 평가 기준 응답 → readRecordExport · recordExportCsv
//   B 관계 목록: P8 관계 조회 응답 → relationStatus · filterAssignments · filterRelationStudents
//   C 홈 메시지: P7 홈 응답의 message.sourceId → 메시지 어댑터(workhub_message_get)의 p_thread_id
// 실행: run_pr62.sh 가 esbuild 로 묶는다(--alias:pr62app=<PR #62 checkout>/apps/workhub/src).
import { readFileSync } from 'node:fs'
import { createTeachingAdapter } from 'pr62app/teaching/adapter'
import { createTeachingRelationsAdapter } from 'pr62app/teaching/relations-adapter'
import { createSupabaseMessagingServer } from 'pr62app/messaging/supabase-messaging'
import { readRecordExport, recordExportCsv } from 'pr62app/teaching/record-export'
import { relationStatus, filterAssignments, filterRelationStudents } from 'pr62app/teaching/relations-list'
import { homeOverview } from 'pr62app/home/overview'
import { parseCsv } from 'pr62app/teaching/csv'
import { contextResponse } from 'pr62app/connection/validation'
import policy from 'pr62app/teaching/record-export-policy.json'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; [k: string]: any }
const load = (env: string) => { const f = process.env[env]; if (!f) { console.log(`FAIL ${env} 경로가 없습니다`); process.exit(1) } return (JSON.parse(readFileSync(f, 'utf8')) as { captures: Capture[] }).captures }
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)

// 이름 · 인자로 응답을 고르는 연결. 고르지 못하면 실패로 돌려(통과로 세지 않음) 무엇을 물었는지 남긴다.
function connection(c: Capture, route: (name: string, args: any) => any, sent: { name: string; args: any }[] = []) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true, profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => { sent.push({ name, args }); const raw = route(name, args); if (raw === undefined) throw new Error('응답 없음 ' + name); return structuredClone(raw) },
  } as any
}
const ok = (c: Capture) => c.raw && c.raw.ok !== false && !c.raw.error

// ---------------------------------------------------------------------------- A 학생 기록 출력
{
  const caps = load('P5_CAPTURE'), member = (c: Capture) => c.scope.memberId
  const students = caps.map((c, i) => ({ c, i })).filter(x => x.c.kind === 'student' && x.c.cursor === null && x.c.context)
  let noPage = 0
  let done = 0, rowsSeen = 0, assessments = 0, historical = 0, withdrawn = 0, review = 0, multi = 0, forbidden = 0, notFound = 0
  for (const { c: s, i } of students) {
    // 같은 사람 · 수업의 수업 응답 중 이 학생 조회와 가장 가까운 것(시험 중 상태가 바뀌므로 앞쪽 우선)
    const courses = caps.map((c, j) => ({ c, j })).filter(x => x.c.kind === 'course' && member(x.c) === member(s) && x.c.courseId === s.courseId)
    const course = [...courses].reverse().find(x => x.j < i) ?? courses[0]
    if (!course) continue
    // 시험 중 남긴 응답에 그 다음 쪽(같은 cursor)이 없으면 이 조합은 셀 수 없다(앱 결과로 세지 않고 따로 셈).
    let missed = false
    const route = (name: string, args: any) => {
      if (name === 'workhub_teaching_course') return course.c.raw
      if (name === 'workhub_teaching_student') return args.p_cursor === null ? s.raw
        : caps.find(x => x.kind === 'student' && member(x) === member(s) && x.studentId === s.studentId && x.cursor === args.p_cursor && ok(x))?.raw ?? void (missed = true)
      if (name === 'workhub_teaching_rubric_revision') return caps.find(x => x.kind === 'rubric_revision' && member(x) === member(s) && x.rubricId === args.p_rubric_id && x.revisionId === args.p_revision_id && ok(x))?.raw
    }
    const adapter = createTeachingAdapter(connection(s, route)), scope = { schoolId: s.scope.schoolId, memberId: member(s), ownerUserId: s.scope.userId }
    const want = !ok(s) ? String(s.raw.code) : !ok(course.c) ? String(course.c.raw.code) : undefined
    for (const includeWithdrawn of [false, true]) {
      const selection = { firstDay: '2000-01-01', lastDay: '2099-12-31', observations: true, assessments: true, includeWithdrawn }
      try {
        const report = await readRecordExport(adapter, scope, s.courseId, s.studentId, selection)
        if (want) { check(`A 서버 ${want} 인데 출력이 만들어짐 ${s.studentId}`, false, s.raw); continue }
        const raws = [...s.raw.observations.map((r: any) => ({ ...r, kind: 'observation' })), ...s.raw.assessments.map((r: any) => ({ ...r, kind: 'assessment' }))]
        const expected = raws.filter(r => includeWithdrawn || r.state === 'active')
        const page2 = s.raw.nextCursor !== null
        if (page2) multi++
        // 첫 쪽만 비교(다음 쪽은 다른 시점 응답이라 개수 비교는 첫 쪽 포함 여부로)
        const ids = new Set(report.rows.map(r => r.kind + ':' + r.id))
        const missing = expected.filter(r => !ids.has(r.kind + ':' + r.id))
        const extraWithdrawn = !includeWithdrawn && report.rows.some(r => r.state !== 'active')
        const rubricOk = report.rows.filter(r => r.kind === 'assessment').every(r => {
          const raw = s.raw.assessments.find((a: any) => a.id === r.id)
          return !raw || (r.rubricRevisionId === raw.rubricRevisionId && r.scores.length === raw.scores.length && r.total === raw.total && r.confirmed === raw.confirmed)
        })
        const csv = parseCsv(recordExportCsv(report).replace(/^﻿/, ''))
        const csvOk = csv.length === report.rows.length + 1 && csv.every(row => row.length === policy.headers.length) && csv.slice(1).every(row => !/^[=+\-@\t\r]/.test(row[13] ?? ''))
        check(`A 출력 ${s.studentId.slice(0, 8)} 철회${includeWithdrawn ? '포함' : '제외'}: ${report.rows.length}건${page2 ? '(2쪽)' : ''} · 빠진 것 0 · 철회 구분 · 당시 기준판 · CSV ${policy.headers.length}열`,
          !missing.length && !extraWithdrawn && rubricOk && csvOk, { missing: missing.map(r => r.id), extraWithdrawn, rubricOk, csvOk })
        done++; rowsSeen += report.rows.length
        for (const r of report.rows) {
          if (r.kind === 'assessment') { assessments++; if (!course.c.raw.rubrics?.some((x: any) => x.revisionId === r.rubricRevisionId)) historical++ }
          if (r.state === 'withdrawn') withdrawn++
          if (r.sourceReviewRequired) review++
        }
      } catch (e) {
        const got = code(e)
        if (missed) { noPage++; missed = false; continue }
        if (want) { (got === 'FORBIDDEN' || got === want || got === 'RESPONSE') ? (want === 'NOT_FOUND' ? notFound++ : 0) : 0
          check(`A 서버 ${want} → 출력 중단(${got}) · 부분 출력 없음`, true); continue }
        // 수업 응답에 이 학생이 없으면(명부 변경 · 다른 학생) 앱은 FORBIDDEN 으로 출력하지 않음
        if (got === 'FORBIDDEN' && !course.c.raw.students?.some((x: any) => x.id === s.studentId)) { forbidden++; check(`A 수업 명부에 없는 학생 ${s.studentId.slice(0, 8)} → FORBIDDEN(출력 없음)`, true); continue }
        check(`A 실제 응답인데 출력 실패 ${s.studentId.slice(0, 8)} ${got}`, false, (e as Error).message)
      }
    }
  }
  check(`A 요약: 출력 ${done}회 · 행 ${rowsSeen} · 평가 ${assessments}(수업 응답에 없는 옛 기준판 ${historical}) · 철회 ${withdrawn} · 근거 재검토 ${review} · 2쪽 ${multi} · 명부 밖 ${forbidden} · 다음 쪽 응답이 남지 않아 못 센 조합 ${noPage}`, done > 0 && assessments > 0)
  check('A 옛 평가 기준판을 workhub_teaching_rubric_revision 으로 가져와 씀(1건 이상)', historical > 0, { historical })
}

// ---------------------------------------------------------------------------- B 관계 목록
{
  const caps = load('P8_CAPTURE').filter(c => c.kind === 'rel_snapshot' && ok(c) && c.context)
  let rel = 0, students = 0, differ = 0, searched = 0
  const counts: Record<string, number> = {}
  // 서버 계약(P8-04 p8_rel_dto): 날짜 양 끝 포함, 시작 전 취소 = effectiveThrough null
  const expect = (r: any, basis: string) => r.effectiveThrough === null ? 'cancelled' : r.effectiveThrough < basis ? 'ended' : r.validFrom > basis ? 'scheduled' : 'active'
  for (const c of caps) {
    const snap = await createTeachingRelationsAdapter(connection(c, () => c.raw)).snapshot(c.scope.memberId, c.courseId)
    const all = [...snap.assignments, ...snap.students.flatMap(s => [s.membership, s.enrollment])]
    const bad = all.filter(r => relationStatus(r, snap.basisDate) !== expect(r, snap.basisDate))
    for (const r of all) counts[relationStatus(r, snap.basisDate)] = (counts[relationStatus(r, snap.basisDate)] ?? 0) + 1
    rel += all.length; students += snap.students.length
    differ += snap.students.filter(s => relationStatus(s.membership, snap.basisDate) !== relationStatus(s.enrollment, snap.basisDate)).length
    // 상태 필터의 합 = 전체, 학생 상태는 수강 기준
    const sumA = (['active', 'scheduled', 'ended', 'cancelled'] as const).reduce((n, st) => n + filterAssignments(snap.assignments, snap.basisDate, '', st).length, 0)
    const sumS = (['active', 'scheduled', 'ended', 'cancelled'] as const).reduce((n, st) => n + filterRelationStudents(snap.students, snap.basisDate, '', st).length, 0)
    const byMembership = (['active', 'scheduled', 'ended', 'cancelled'] as const).every(st => filterRelationStudents(snap.students, snap.basisDate, '', st).every(s => relationStatus(s.membership, snap.basisDate) === st))
    // 이름 검색은 전체 목록에서(공백 · 대소문자 무관), 자기 자신을 찾음
    const find = snap.students.every(s => filterRelationStudents(snap.students, snap.basisDate, ' ' + s.name.toUpperCase() + ' ', 'all').some(x => x.studentId === s.studentId))
      && snap.assignments.every(a => filterAssignments(snap.assignments, snap.basisDate, a.label, 'all').some(x => x.id === a.id))
    searched += snap.students.length + snap.assignments.length
    check(`B 관계 조회 ${c.courseId?.slice(0, 8)}: 상태 ${all.length}건 서버 계약과 같음 · 필터 합 = 전체 · 학생 필터 = 수강 기준 · 이름 검색`,
      !bad.length && sumA === snap.assignments.length && sumS === snap.students.length && byMembership && find, { bad: bad.map(r => [r.kind, r.validFrom, r.effectiveThrough, snap.basisDate]), sumA, sumS, byMembership, find })
  }
  check(`B 요약: 조회 ${caps.length}건 · 관계 ${rel} (${Object.entries(counts).map(([k, v]) => k + ' ' + v).join(' · ')}) · 학생 ${students} · 수강과 학적 상태가 다른 학생 ${differ} · 검색 ${searched}`, caps.length > 0 && rel > 0)
}

// ---------------------------------------------------------------------------- C 홈 메시지 → 대화
{
  const caps = load('P7_CAPTURE').filter(c => c.kind === 'home' && c.raw?.data && c.context)
  let items = 0
  for (const c of caps) {
    const member = { id: c.scope.memberId, schoolId: c.scope.schoolId } as any
    const home = homeOverview(c.raw.data, member)
    for (const item of home.items.filter(x => x.kind === 'message')) {
      items++
      // 앱이 홈 항목으로 여는 대화 = workhub_message_get(p_thread_id = sourceId). 응답은 보내기 전 인자만 본다.
      const sent: { name: string; args: any }[] = []
      const server = createSupabaseMessagingServer(connection(c, () => ({ ok: false, code: 'NOT_FOUND' }), sent))
      let got = ''
      try { await server.messages(c.scope.memberId, item.sourceId) } catch (e) { got = code(e) }
      check(`C 홈 메시지 항목 → workhub_message_get(p_thread_id = sourceId), 삭제 · 권한 없음(NOT_FOUND) → 다른 대화를 열지 않고 오류`,
        sent.length === 1 && sent[0].name === 'workhub_message_get' && sent[0].args.p_thread_id === item.sourceId && got !== '', { sent, got })
    }
  }
  check(`C 요약: 홈 응답 ${caps.length}건 · 메시지 항목 ${items}`, items > 0)
}

console.log(`\nPR #62 앱 대조: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
