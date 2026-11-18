import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const m = await loadBrowserModule(`export * from '../packages/timetable/src/validate'; export * from '../packages/timetable/src/quality'; export * from '../packages/timetable/src/balanced'; export * from '../packages/timetable/src/cpSat'; export * from '../packages/timetable/src/solver';`)
const policy = JSON.parse(readFileSync('packages/timetable/_assets/balanced-policy.json', 'utf8'))
const python = [process.env.TIMETABLE_PYTHON, process.env.PYTHON, resolve('tests/.venv/Scripts/python.exe'), resolve('tests/.venv/bin/python'), 'python3', 'python'].filter(Boolean)
  .find(p => (!/[\\/]/.test(p) || existsSync(p)) && spawnSync(p, ['-c', 'import ortools; assert ortools.__version__ == "9.15.6755"'], { stdio: 'ignore', windowsHide: true }).status === 0)
assert.ok(python, '고정 버전 OR-Tools가 필요합니다: pip install -r packages/timetable/requirements.txt')
const clone = structuredClone
let count = 0
async function check(name, run) { await run(); count++; console.log('  ✓ ' + name) }

function basis(n = 2) {
  return {
    schemaVersion: 1, id: 'balanced-basis', revision: 1, schoolId: 'school', termId: 'term', sourceFingerprint: 'a'.repeat(64), schoolLevel: 'middle', unsupportedFeatures: [],
    resources: [{ id: 't', kind: 'teacher', label: '교사', capacity: 1 }, { id: 'c', kind: 'class', label: '학급', capacity: 1 }],
    slots: Array.from({ length: n }, (_, i) => ({ id: 's' + (i + 1), day: 1, label: (i + 1) + '교시', startMinute: 540 + i * 55, endMinute: 585 + i * 55, periods: 1 })),
    lessons: ['a', 'b'].map(id => ({ id, courseId: 'course_' + id, label: '수업 ' + id, periods: 1, resourceIds: ['t', 'c'], allowedSlotIds: Array.from({ length: n }, (_, i) => 's' + (i + 1)) })),
    courseLoads: ['a', 'b'].map(id => ({ courseId: 'course_' + id, periods: 1 })), fixed: [], unavailable: [], preferences: [],
  }
}
function oneLesson(n = 3) { const b = basis(n); b.lessons = b.lessons.slice(0, 1); b.courseLoads = b.courseLoads.slice(0, 1); return b }
const defaultPlaces = [{ lessonId: 'a', slotId: 's1' }, { lessonId: 'b', slotId: 's2' }]

// 요청 재생성 코드를 사용하지 않고 과거 JSON 계약의 해시를 계산한다.
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}'
  return JSON.stringify(value)
}
function rehash(request) { const { inputHash, ...payload } = request; return { ...payload, inputHash: createHash('sha256').update(canonical(payload)).digest('hex') } }
// 기능 검사는 환경별 OR-Tools 기동 시간을 허용한다. 60초 성능은 별도 벤치마크로 측정한다.
async function requestFor(b, previous = null, options = {}) { return m.buildCpSatRequest(b, 'balanced-request', previous, { qualityMode: 'balanced', minimizeChanges: false, maxSeconds: 5, maxCandidates: 1, ...options }) }
function pythonJson(code, input) {
  const result = spawnSync(python, ['-c', code], { input: JSON.stringify(input), encoding: 'utf8', maxBuffer: 16000000, timeout: 30000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } })
  assert.equal(result.status, 0, result.stderr || String(result.error))
  return JSON.parse(result.stdout)
}
const imports = "import sys,json\nsys.path.insert(0,'packages/timetable/engine')\nimport runner,jobs_contract\n"
function workerChecks(rows) {
  return pythonJson(imports + "out=[]\nfor row in json.load(sys.stdin):\n try:\n  jobs_contract.validate_result(row['request'],row['response']);out.append(True)\n except jobs_contract.JobError:\n  out.append(False)\nprint(json.dumps(out))", rows)
}
async function solve(b, previous = null, options = {}, preparationTimeout = false) {
  const request = await requestFor(b, previous, options)
  const timing = preparationTimeout ? "it=iter(range(0,10000,10));runner.time.monotonic=lambda:next(it)\n" : ''
  // 실제 Python 계산 결과를 작업자의 독립 검증에도 통과시킨 뒤 화면에 전달한다.
  const response = pythonJson(imports + timing + "request=json.load(sys.stdin)\nresult=runner.solve(request)\njobs_contract.validate_result(request,result)\nprint(json.dumps(result,ensure_ascii=False))", request)
  const result = await m.parseCpSatResponse(request, response)
  return { request, result }
}
function candidate(request, placements) { return { placements, objective: m.evaluateCpSatObjective(request.basis, placements, request.previous), optimal: false, quality: m.evaluateBalancedQuality(request.basis, placements, request.options) } }
function responseFor(request, candidates) { return { contract: request.contract, requestId: request.requestId, inputHash: request.inputHash, engineVersion: policy.engineVersion, status: 'feasible', candidates, issues: [], stats: { elapsedMs: 1, branches: 0, stoppedByLimit: false } } }
async function rejectedByBoth(request, responses) {
  for (const response of responses) await assert.rejects(() => m.parseCpSatResponse(request, response))
  assert.deepEqual(workerChecks(responses.map(response => ({ request, response }))), responses.map(() => false))
}

await check('기존 여섯 옵션 요청의 해시·결과·작업자 검증 계약을 보존한다', async () => {
  const b = basis()
  const old = rehash({ contract: 'timetable.solve.v1', requestId: 'legacy-request', basis: b, previous: null,
    options: { maxSeconds: 15, maxCandidates: 1, seed: 71283, minimizeChanges: true, improveTeacherBalance: true, spreadCourses: true } })
  const rebuilt = await m.buildCpSatRequest(b, 'legacy-request')
  assert.deepEqual(rebuilt, old)
  assert.equal(Object.hasOwn(rebuilt.options, 'qualityMode'), false)
  const response = { contract: old.contract, requestId: old.requestId, inputHash: old.inputHash, engineVersion: 'canonical-cpsat-1', status: 'feasible',
    candidates: [{ placements: defaultPlaces, objective: { changedLessons: 0, movedLessons: 0, preferencePenalty: 0, teacherPeakPeriods: 2, courseRepeats: 0 }, optimal: false }], issues: [], stats: { elapsedMs: 1, branches: 0, stoppedByLimit: false } }
  assert.deepEqual(await m.parseCpSatResponse(old, response), response)
  assert.deepEqual(workerChecks([{ request: old, response }]), [true])
})

await check('브라우저 초안의 벌점 100을 품질 우선 실제 왕복에서 1로 개선한다', async () => {
  const b = basis(), original = clone(b)
  b.preferences = [{ lessonId: 'a', slotId: 's2', weight: 1 }, { lessonId: 'b', slotId: 's2', weight: 100 }]
  original.preferences = clone(b.preferences)
  const initial = m.solveTimetable(b, { maxMs: 5000 })
  assert.equal(initial.score, 100)
  const previous = { basis: b, placements: initial.placements }
  const { result } = await solve(b, previous)
  assert.equal(result.status, 'feasible')
  assert.equal(result.candidates[0].objective.preferencePenalty, 1)
  assert.equal(result.candidates[0].optimal, false)
  assert.ok(result.candidates[0].quality.totalPenalty < m.evaluateBalancedQuality(b, initial.placements).totalPenalty)
  assert.deepEqual(b, original)
})

await check('품질 점수가 나빠도 필수 고정을 절대로 풀지 않는다', async () => {
  const b = basis(); b.fixed = clone(defaultPlaces)
  b.preferences = [{ lessonId: 'a', slotId: 's1', weight: 1000000 }]
  const { result } = await solve(b, null, { maxCandidates: 3 })
  assert.equal(result.status, 'feasible')
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.candidates[0].placements, defaultPlaces)
  assert.equal(result.candidates[0].objective.preferencePenalty, 1000000)
})

await check('공동교사·수강집단 충돌과 공간 용량은 품질 모드에서도 강제한다', async () => {
  for (const kind of ['teacher', 'student_group', 'room']) {
    const b = basis()
    b.resources.push({ id: 'u', kind: 'teacher', label: '다른 교사', capacity: 1 }, { id: 'v', kind: 'class', label: '다른 학급', capacity: 1 }, { id: 'shared', kind, label: '공유 자원', capacity: 1 })
    b.lessons[1].resourceIds = ['u', 'v']
    b.lessons.forEach(l => { l.resourceIds.push('shared'); l.allowedSlotIds = ['s1'] })
    assert.equal((await solve(b)).result.status, 'infeasible')
    if (kind === 'room') {
      b.resources.find(r => r.id === 'shared').capacity = 2
      assert.equal((await solve(b)).result.status, 'feasible')
    }
  }
})

await check('다른 과목의 실제 배치가 다른 세 후보를 품질 상한 안에서 반환한다', async () => {
  const b = oneLesson(3), { request, result } = await solve(b, null, { maxSeconds: 2, maxCandidates: 3 })
  assert.equal(result.candidates.length, 3)
  assert.equal(new Set(result.candidates.map(c => m.actualTimetableFingerprint(b, c.placements))).size, 3)
  for (const c of result.candidates) {
    assert.equal(c.quality.totalPenalty, 0)
    assert.equal(m.validatePlacements(b, c.placements).valid, true)
  }
  assert.equal(request.options.qualityMode, 'balanced')
})

let identical
await check('동일한 수업 카드의 여섯 순열을 실제 한 후보로 처리한다', async () => {
  const b = basis(3)
  b.lessons = ['a', 'b', 'c'].map(id => ({ id, courseId: 'same', label: '같은 수업', periods: 1, resourceIds: ['t', 'c'], allowedSlotIds: ['s1', 's2', 's3'] }))
  b.courseLoads = [{ courseId: 'same', periods: 3 }]
  identical = await solve(b, null, { maxCandidates: 3 })
  assert.equal(identical.result.candidates.length, 1)
  assert.equal(m.validatePlacements(b, identical.result.candidates[0].placements).valid, true)
})

await check('수업 ID만 교환한 응답을 앱과 작업자 모두 중복으로 거절한다', async () => {
  const { request, result } = identical, bad = clone(result)
  const swapped = clone(bad.candidates[0].placements)
  ;[swapped[0].lessonId, swapped[1].lessonId] = [swapped[1].lessonId, swapped[0].lessonId]
  assert.equal(m.validatePlacements(request.basis, swapped).valid, true)
  bad.candidates.push(candidate(request, swapped))
  await rejectedByBoth(request, [bad])
})

await check('슬롯 ID가 달라도 실제 시각과 내용이 같으면 후보를 늘리지 않는다', async () => {
  const b = oneLesson(1)
  b.slots.push({ ...b.slots[0], id: 'alias', label: '같은 시각의 별칭' })
  b.lessons[0].allowedSlotIds.push('alias')
  const { request, result } = await solve(b, null, { maxCandidates: 3 })
  assert.equal(result.candidates.length, 1)
  const bad = clone(result), current = bad.candidates[0].placements[0].slotId
  bad.candidates.push(candidate(request, [{ lessonId: 'a', slotId: current === 's1' ? 'alias' : 's1' }]))
  await rejectedByBoth(request, [bad])
})

await check('실제 차이가 기준보다 작은 후보를 앱·작업자에서 거절한다', async () => {
  const b = basis()
  b.slots.push({ ...b.slots[0], id: 'offset', startMinute: 541, endMinute: 586 })
  b.lessons[0].allowedSlotIds = ['s1', 'offset']; b.lessons[1].allowedSlotIds = ['s2']
  const request = await requestFor(b, null, { maxCandidates: 3 })
  const better = [{ lessonId: 'a', slotId: 'offset' }, { lessonId: 'b', slotId: 's2' }]
  assert.equal(m.timetableDifferenceMinutes(b, better, defaultPlaces), 1)
  const response = responseFor(request, [candidate(request, better), candidate(request, defaultPlaces)])
  assert.ok(response.candidates[0].quality.totalPenalty <= response.candidates[1].quality.totalPenalty)
  await rejectedByBoth(request, [response])
})

await check('점수·버전·최적성·배치·필드 변조를 앱과 작업자가 함께 거절한다', async () => {
  const b = oneLesson(3), request = await requestFor(b, null, { maxCandidates: 3 })
  const good = responseFor(request, [candidate(request, [{ lessonId: 'a', slotId: 's1' }])])
  assert.deepEqual(await m.parseCpSatResponse(request, good), good)
  const edits = [
    r => r.candidates[0].quality.totalPenalty++, r => r.candidates[0].quality.teacherGapMinutes++,
    r => r.candidates[0].quality.totalPenalty = false, r => delete r.candidates[0].quality,
    r => r.candidates[0].quality.hidden = 0, r => r.candidates[0].optimal = true,
    r => r.candidates[0].objective.changedLessons++, r => r.candidates[0].placements.pop(),
    r => r.engineVersion = 'canonical-cpsat-1', r => r.inputHash = '0'.repeat(64),
  ]
  await rejectedByBoth(request, edits.map(edit => { const bad = clone(good); edit(bad); return bad }))
})

await check('품질 상한을 넘겨 후보 수를 채우지 않고 정확히 계산한 나쁜 응답도 거절한다', async () => {
  const b = oneLesson(3)
  b.preferences = [{ lessonId: 'a', slotId: 's2', weight: 1000 }, { lessonId: 'a', slotId: 's3', weight: 2000 }]
  const { request, result } = await solve(b, null, { maxCandidates: 3 })
  assert.equal(result.candidates.length, 1)
  assert.equal(result.candidates[0].quality.totalPenalty, 0)
  const bad = clone(result); bad.candidates.push(candidate(request, [{ lessonId: 'a', slotId: 's2' }]))
  await rejectedByBoth(request, [bad])
})

await check('품질 모드와 변경 최소화의 모순·숨은 옵션을 양쪽 요청 검사에서 거절한다', async () => {
  for (const options of [{ qualityMode: 'balanced' }, { qualityMode: undefined }, { qualityMode: null }, { qualityMode: 'unknown', minimizeChanges: false }, { qualityMode: 'balanced', minimizeChanges: true }, { qualityMode: 'balanced', minimizeChanges: false, relaxHard: true }]) {
    await assert.rejects(() => m.buildCpSatRequest(basis(), 'invalid-request', null, options))
  }
  const valid = await requestFor(basis())
  const broken = [r => r.options.qualityMode = null, r => r.options.qualityMode = 'unknown', r => r.options.minimizeChanges = true, r => r.options.spreadCourses = 1, r => r.options.relaxHard = true]
    .map(edit => { const value = clone(valid); edit(value); return rehash(value) })
  const statuses = pythonJson(imports + "print(json.dumps([runner.solve(r)['status'] for r in json.load(sys.stdin)]))", broken)
  assert.deepEqual(statuses, broken.map(() => 'invalid'))
})

await check('지원하지 않는 조건도 새 모드의 버전으로 안전하게 반환한다', async () => {
  const b = basis(); b.unsupportedFeatures = ['격주 수업']
  const { result } = await solve(b)
  assert.equal(result.status, 'unsupported')
  assert.equal(result.engineVersion, policy.engineVersion)
  assert.equal(result.candidates.length, 0)
})

await check('모델 준비가 시간 초과여도 현재 조건에 유효한 이전 안은 반환한다', async () => {
  const b = basis(), old = { basis: clone(b), placements: clone(defaultPlaces) }
  const { result } = await solve(b, old, {}, true)
  assert.equal(result.status, 'feasible')
  assert.equal(result.stats.stoppedByLimit, true)
  assert.equal(result.candidates.length, 1)
  assert.deepEqual(result.candidates[0].placements, defaultPlaces)
  assert.equal(result.candidates[0].optimal, false)
})

await check('새 조건을 어기는 과거 안을 시간 초과 대체 후보로 사용하지 않는다', async () => {
  const old = basis(), current = clone(old)
  current.unavailable = [{ resourceId: 't', day: 1, startMinute: 540, endMinute: 585 }]
  const { result } = await solve(current, { basis: old, placements: clone(defaultPlaces) }, {}, true)
  assert.equal(result.status, 'unknown')
  assert.equal(result.candidates.length, 0)
  assert.equal(result.stats.stoppedByLimit, true)
})

await check('유효한 이전 최고안보다 나쁜 첫 후보를 양쪽 응답검사에서 거절한다', async () => {
  const b = oneLesson(3)
  b.preferences = [{ lessonId: 'a', slotId: 's2', weight: 10 }]
  const old = { basis: clone(b), placements: [{ lessonId: 'a', slotId: 's1' }] }
  const request = await requestFor(b, old)
  const bad = responseFor(request, [candidate(request, [{ lessonId: 'a', slotId: 's2' }])])
  await rejectedByBoth(request, [bad])
})

await check('현재도 유효한 이전 안을 버린 빈 미확정·불가능 응답을 양쪽에서 거절한다', async () => {
  const b = basis(), old = { basis: clone(b), placements: clone(defaultPlaces) }, request = await requestFor(b, old)
  const responses = ['unknown', 'infeasible'].map(status => {
    const bad = responseFor(request, [])
    bad.status = status; bad.stats.stoppedByLimit = status === 'unknown'
    bad.issues = [{ code: status === 'unknown' ? 'SEARCH_LIMIT' : 'NO_SOLUTION', message: '반환 후보가 없습니다.', path: 'basis' }]
    return bad
  })
  await rejectedByBoth(request, responses)
})

await check('수업 사이 빈 교습 가능 분을 평가하고 단순 휴식 간격은 제외한다', () => {
  const b = basis(3), spaced = [{ lessonId: 'a', slotId: 's1' }, { lessonId: 'b', slotId: 's3' }]
  assert.equal(m.evaluateBalancedQuality(b, defaultPlaces).teacherGapMinutes, 0)
  assert.equal(m.evaluateBalancedQuality(b, spaced).teacherGapMinutes, 45)
  b.unavailable = [{ resourceId: 't', day: 1, startMinute: 595, endMinute: 640 }]
  assert.equal(m.evaluateBalancedQuality(b, spaced).teacherGapMinutes, 0)
})

await check('교사 균형·과목 분산 옵션 해제는 보고값을 보존하고 점수에서만 제외한다', async () => {
  const b = basis(3)
  b.slots.push(...b.slots.map(s => ({ ...s, id: s.id + '_d2', day: 2 })))
  b.lessons.forEach(l => { l.courseId = 'same'; l.allowedSlotIds = b.slots.map(s => s.id) })
  b.courseLoads = [{ courseId: 'same', periods: 2 }]
  b.fixed = clone(defaultPlaces)
  const all = m.evaluateBalancedQuality(b, defaultPlaces), disabled = m.evaluateBalancedQuality(b, defaultPlaces, { improveTeacherBalance: false, spreadCourses: false })
  assert.ok(all.totalPenalty > 0)
  assert.equal(disabled.totalPenalty, 0)
  for (const key of Object.keys(all).filter(k => k !== 'totalPenalty')) assert.equal(disabled[key], all[key])
  const { result } = await solve(b, null, { improveTeacherBalance: false, spreadCourses: false })
  assert.deepEqual(result.candidates[0].quality, disabled)
})

console.log(`시간표 품질 우선·하위호환·실제 후보·독립 검증 ${count}건 통과`)
