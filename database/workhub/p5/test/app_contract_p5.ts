// PR #48 앱(apps/workhub)의 실제 수업 어댑터(createTeachingAdapter)와 parser·명령 검사에 P5 의 "실제 출력"을 넣어 본다.
// run_p5.py 가 시험 중 받은 응답(봉투)과 그때의 workhub_context 를 P5_CAPTURE 에 남기고, 이 도구가 앱 코드에 그대로 넣는다.
// 앱 코드는 고치지 않고 가져다 쓰기만 한다. run_all.sh 가 esbuild 로 묶는다: --alias:p5app=<앱 소스>/apps/workhub/src
import { readFileSync } from 'node:fs'
import { createTeachingAdapter } from 'p5app/teaching/adapter'
import { contextResponse } from 'p5app/connection/validation'

type Scope = { schoolId: string; memberId: string; userId: string }
type Capture = { kind: string; scope: Scope; context: any; raw: any; [k: string]: any }
const file = process.env.P5_CAPTURE
if (!file) { console.log('FAIL P5_CAPTURE 경로가 없습니다'); process.exit(1) }
const captures = (JSON.parse(readFileSync(file, 'utf8')) as { captures: Capture[] }).captures
let pass = 0, fail = 0
const check = (name: string, ok: boolean, info?: unknown) => { ok ? pass++ : fail++; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -- ' + JSON.stringify(info).slice(0, 500))) }
const code = (e: unknown) => (e as { code?: string })?.code ?? String(e)
const bump = (o: Record<string, number>, k: string) => { o[k] = (o[k] ?? 0) + 1 }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']'
  if (v !== null && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical((v as any)[k])).join(',') + '}'
  return JSON.stringify(v)
}

// 앱의 연결(로그인·학교 소속)을 그때의 실제 workhub_context 로 대신한다. rpc 는 기록한 실제 응답을 돌려주고, 앱이 보낸 이름·인자를 남긴다.
function connection(c: Capture, sent: { name: string; args: any }[]) {
  const ctx = contextResponse(c.context, c.scope.schoolId)
  return {
    info: () => structuredClone(ctx),
    getIdentity: async () => ({ userId: c.scope.userId, approved: true,
                                profile: { id: c.scope.userId, is_active: true, role: 'superadmin', department_id: null, extra_permissions: [] } }),
    rpcVerified: async (name: string, args: any) => { sent.push({ name, args }); return structuredClone(c.raw) },
  } as any
}

const tally: Record<string, { ok: number; bad: number; codes: Record<string, number> }> = {}
const note = (k: string) => (tally[k] ??= { ok: 0, bad: 0, codes: {} })
let localFirst = 0, replayed = 0
const skipped: Record<string, number> = {}

for (const c of captures) {
  if (!c.context) { bump(skipped, `${c.kind}: workhub_context 가 없는 계정(앱이 연결 단계에서 막음)`); continue }
  const want = c.raw?.ok === false ? String(c.raw.code) : undefined
  const sent: { name: string; args: any }[] = []
  const m = c.scope.memberId
  const t = c.kind === 'mutate' ? `mutate:${c.command?.kind ?? '?'}` : c.kind
  let expected: { name: string; args: any }
  try {
    const app = createTeachingAdapter(connection(c, sent))
    let out: any, data: any = c.raw
    switch (c.kind) {
      case 'catalog': expected = { name: 'workhub_teaching_catalog', args: { p_member_id: m } }; out = await app.catalog(m); break
      case 'course': expected = { name: 'workhub_teaching_course', args: { p_member_id: m, p_course_id: c.courseId } }; out = await app.course(m, c.courseId); break
      case 'student':
        expected = { name: 'workhub_teaching_student', args: { p_member_id: m, p_course_id: c.courseId, p_student_id: c.studentId, p_cursor: c.cursor ?? null } }
        out = await app.student(m, c.courseId, c.studentId, c.cursor ?? null); break
      case 'counseling':
        expected = { name: 'workhub_teaching_counseling', args: { p_member_id: m, p_course_id: c.courseId, p_student_id: c.studentId, p_cursor: c.cursor ?? null } }
        out = await app.counseling(m, c.courseId, c.studentId, c.cursor ?? null); break
      case 'activity': expected = { name: 'workhub_teaching_activity', args: { p_member_id: m, p_course_id: c.courseId, p_import_id: c.importId } }; out = await app.activity(m, c.courseId, c.importId); break
      case 'rubric_revision':
        expected = { name: 'workhub_teaching_rubric_revision', args: { p_member_id: m, p_course_id: c.courseId, p_rubric_id: c.rubricId, p_revision_id: c.revisionId } }
        out = await app.rubricRevision(m, c.courseId, c.rubricId, c.revisionId); data = c.raw.rubric; break
      case 'mutate':
        expected = { name: 'workhub_teaching_mutate', args: { p_member_id: m, p_command: c.command, p_request_key: c.key } }
        out = await app.mutate(m, c.command, c.key); if (c.raw.outcome === 'replayed') replayed++; break
      default: bump(skipped, '알 수 없는 종류 ' + c.kind); continue
    }
    if (want) throw new Error(`서버는 ${want} 인데 앱은 통과`)
    if (canonical(out) !== canonical(data)) throw new Error('앱이 해석한 값이 서버 응답과 다름')
    if (sent.length !== 1 || canonical(sent[0]) !== canonical(expected)) throw new Error('보낸 이름·인자 다름 ' + JSON.stringify(sent).slice(0, 300))
    note(t).ok++; bump(note(t).codes, 'ok')
  } catch (e) {
    const got = code(e)
    if (want && got === want) {
      note(t).ok++; bump(note(t).codes, want)
      if (!sent.length) localFirst++            // 앱이 보내기 전에 같은 이유로 막음
    } else {
      note(t).bad++
      console.log(`  불일치 ${t} 서버=${want ?? 'ok'} 앱=${got} 보냄=${sent.length} ${(e as Error)?.message ?? ''}: ${JSON.stringify(c.raw).slice(0, 200)} 명령=${JSON.stringify(c.command ?? null).slice(0, 300)}`)
    }
  }
}

for (const [k, v] of Object.entries(tally).sort())
  check(`${k}: 실제 응답 ${v.ok + v.bad}건을 앱 어댑터가 서버와 같은 결과로 해석 (${Object.entries(v.codes).map(([a, b]) => `${a} ${b}`).join(' · ')})`, v.bad === 0 && v.ok > 0, v)
const kinds = ['catalog', 'course', 'student', 'counseling', 'activity', 'rubric_revision', 'mutate:course_create', 'mutate:roster_import', 'mutate:observation_save', 'mutate:counseling_save',
               'mutate:record_withdraw', 'mutate:rubric_save', 'mutate:assessment_save', 'mutate:activity_import', 'mutate:activity_review', 'mutate:activity_correct']
check(`앱 함수·명령 ${kinds.length}종 모두 실제 응답으로 확인함`, kinds.every(k => (tally[k]?.ok ?? 0) > 0), kinds.filter(k => !(tally[k]?.ok)))
check(`재전송(replayed) 접수증 ${replayed}건도 앱 접수증 검사를 통과`, replayed > 0, replayed)
check(`앱이 보내기 전에 같은 코드로 막은 요청 ${localFirst}건(서버도 같은 코드)`, localFirst > 0, localFirst)
console.log(`  참고: 건너뜀 ${JSON.stringify(skipped)}`)
console.log(`합계: PASS ${pass} · FAIL ${fail}`)
process.exit(fail ? 1 : 0)
