import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const m = await loadBrowserModule(`export * from '../packages/timetable/src/cpSat'; export {validateBasis} from '../packages/timetable/src/validate';`)
const python = [process.env.TIMETABLE_PYTHON, process.env.PYTHON, resolve('tests/.venv/Scripts/python.exe'), resolve('tests/.venv/bin/python'), 'python3', 'python'].filter(Boolean).find(p => (!/[\\/]/.test(p) || existsSync(p)) && spawnSync(p, ['-c', 'import ortools; assert ortools.__version__ == "9.15.6755"'], { stdio: 'ignore', windowsHide: true }).status === 0)
assert.ok(python, '고정 OR-Tools가 필요합니다: pip install -r packages/timetable/requirements.txt')
const engine = resolve('packages/timetable/engine'), cliPath = join(engine, 'jobs.py')
const temporary = mkdtempSync(join(tmpdir(), '학교 시간표 작업 ')), children = new Set()
const env = { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
let count = 0, activeCheck = ''
const json = p => JSON.parse(readFileSync(p, 'utf8'))
const save = (p, value) => writeFileSync(p, JSON.stringify(value))
async function check(name, fn) { activeCheck = name; await fn(); count++; console.log('  ✓ ' + name) }
function call(args, expected = 0) {
  const result = spawnSync(python, [cliPath, ...args], { encoding: 'utf8', env, timeout: 30000, windowsHide: true })
  assert.equal(result.status, expected, result.stderr || result.stdout || String(result.error))
  return JSON.parse(result.stdout)
}
function runtime(script, args = []) {
  const result = spawnSync(python, ['-c', `import sys; sys.path.insert(0, sys.argv[1]); ${script}`, engine, ...args], { encoding: 'utf8', env, timeout: 30000, windowsHide: true })
  assert.equal(result.status, 0, result.stderr || result.stdout || String(result.error))
  return result.stdout.trim() ? JSON.parse(result.stdout) : null
}
function worker(store, fixture = null, once = false) {
  const args = fixture ? ['-c', "import sys; sys.path.insert(0,sys.argv[1]); import jobs_worker; from pathlib import Path; from jobs_runtime import JobStore; jobs_worker.ENGINE=Path(sys.argv[3]); jobs_worker.LocalWorker(JobStore(sys.argv[2])).run(once=True)", engine, store, fixture] : [cliPath, 'work', '--store', store, ...(once ? ['--once'] : [])]
  const child = spawn(python, args, { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  children.add(child)
  let output = ''
  child.stderr.on('data', chunk => output += chunk)
  child.stdout.on('data', chunk => output += chunk)
  child.finished = new Promise((done, reject) => { child.on('error', reject); child.on('exit', code => { children.delete(child); done({ code, output }) }) })
  return child
}
async function waitFor(fn, description = '상태 변경', milliseconds = 15000) {
  const until = Date.now() + milliseconds
  while (Date.now() < until) { try { const result = fn(); if (result) return result } catch {} await delay(40) }
  assert.fail(description + ' 대기 시간 초과')
}
function newStore() { const path = join(temporary, randomUUID()); call(['init', '--store', path]); return path }
const basis = () => ({ schemaVersion: 1, id: 'basis', revision: 1, schoolId: 'school', termId: 'term', sourceFingerprint: 'a'.repeat(64), schoolLevel: 'middle', unsupportedFeatures: [], resources: [{ id: 'teacher', kind: 'teacher', label: '교사', capacity: 1 }, { id: 'class', kind: 'class', label: '학급', capacity: 1 }], slots: [{ id: 'm1', day: 1, label: '월1', startMinute: 540, endMinute: 585, periods: 1 }, { id: 'm2', day: 1, label: '월2', startMinute: 595, endMinute: 640, periods: 1 }], lessons: [{ id: 'l1', courseId: 'course', label: '국어', periods: 1, resourceIds: ['teacher', 'class'], allowedSlotIds: ['m1', 'm2'] }], courseLoads: [{ courseId: 'course', periods: 1 }], fixed: [], unavailable: [], preferences: [] })
const request = async (id = randomUUID(), b = basis(), options = {}) => m.buildCpSatRequest(b, id, null, { maxSeconds: 5, ...options })
function submit(store, req) { const input = join(temporary, `${randomUUID()}.json`); save(input, req); return call(['submit', '--store', store, '--input', input]) }
function browserSubmit(store, req, ready = true, queuedAt = new Date().toISOString()) {
  const path = join(store, 'jobs', req.requestId); mkdirSync(path)
  save(join(path, 'request.json'), req)
  if (ready) save(join(path, 'ready.json'), { contract: 'timetable.jobs.v1', queueId: json(join(store, 'queue.json')).queueId, requestId: req.requestId, inputHash: req.inputHash, queuedAt })
  return path
}
function status(store, id) { return call(['status', '--store', store, '--request-id', id]) }
function ageJob(store, id) {
  const path = join(store, 'jobs', id), old = '2000-01-01T00:00:00.000Z', marker = { ...json(join(path, 'ready.json')), queuedAt: old }
  save(join(path, 'ready.json'), marker)
  if (existsSync(join(path, 'manifest.json'))) save(join(path, 'manifest.json'), { ...json(join(path, 'manifest.json')), ready: marker })
  const state = json(join(path, 'status.json'))
  save(join(path, 'status.json'), { ...state, queuedAt: old, updatedAt: old, startedAt: state.startedAt ? old : null, finishedAt: old })
}
const sleepFixture = join(temporary, '느린 계산.py'); writeFileSync(sleepFixture, 'import time\ntime.sleep(30)\n')
const invalidFixture = join(temporary, '잘못된 계산.py'); writeFileSync(invalidFixture, "import argparse,json\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');a=p.parse_args();open(a.output,'w').write('{}')\n")

try {
  await check('전용 폴더 초기화는 안정 queueId를 보존하며 임의 파일을 덮어쓰지 않는다', () => {
    const store = newStore(), queue = json(join(store, 'queue.json')); assert.deepEqual(call(['init', '--store', store]), queue)
    const occupied = join(temporary, randomUUID()); mkdirSync(occupied); writeFileSync(join(occupied, '교사 자료.txt'), '보존')
    assert.equal(call(['init', '--store', occupied], 1).error.code, 'STORE_NOT_EMPTY'); assert.equal(readFileSync(join(occupied, '교사 자료.txt'), 'utf8'), '보존')
    const finder = join(temporary, randomUUID()); mkdirSync(finder); writeFileSync(join(finder, '.DS_Store'), 'finder')
    assert.equal(call(['init', '--store', finder]).contract, 'timetable.jobs.v1'); assert.equal(readFileSync(join(finder, '.DS_Store'), 'utf8'), 'finder')
  })
  await check('실제 비동기 작업자가 브라우저 폴더 요청을 계산하고 앱이 결과를 독립 재검증한다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req), child = worker(store, null, true)
    assert.equal((await child.finished).code, 0)
    const done = status(store, req.requestId); assert.equal(done.state, 'succeeded'); assert.equal(done.sequence, 3); assert.ok(done.startedAt && done.finishedAt)
    assert.equal((await m.parseCpSatResponse(req, json(join(path, 'result.json')))).status, 'feasible')
    const originalStatus = json(join(path, 'status.json')); call(['work', '--store', store, '--once']); assert.deepEqual(json(join(path, 'status.json')), originalStatus)
    assert.equal(call(['result', '--store', store, '--request-id', req.requestId]).requestId, req.requestId)
  })
  await check('request 파일만 있고 ready 마커가 없으면 실행하지 않는다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req, false)
    call(['work', '--store', store, '--once']); assert.equal(existsSync(join(path, 'status.json')), false)
  })
  await check('요청 파일 기록 뒤 중단된 접수는 같은 원본일 때 ready만 완성한다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req, false); submit(store, req)
    assert.ok(existsSync(join(path, 'ready.json'))); assert.deepEqual(json(join(path, 'request.json')), req)
    call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId).state, 'succeeded')
  })
  await check('동일 요청 재접수는 원본을 보존하고 다른 내용은 충돌로 거부한다', async () => {
    const store = newStore(), req = await request(); submit(store, req); const before = json(join(store, 'jobs', req.requestId, 'ready.json')); submit(store, req)
    assert.deepEqual(json(join(store, 'jobs', req.requestId, 'ready.json')), before)
    const changed = basis(); changed.lessons[0].label = '바뀐 교과'; const other = await request(req.requestId, changed), input = join(temporary, 'conflict.json'); save(input, other)
    assert.equal(call(['submit', '--store', store, '--input', input], 1).error.code, 'REQUEST_CONFLICT')
  })
  await check('다른 작업 폴더의 마커와 위조 요청 지문을 실행하지 않는다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req), marker = json(join(path, 'ready.json')); marker.queueId = randomUUID(); save(join(path, 'ready.json'), marker)
    call(['work', '--store', store, '--once']); assert.equal(existsSync(join(path, 'status.json')), false); assert.equal(existsSync(join(path, 'result.json')), false)
    marker.queueId = json(join(store, 'queue.json')).queueId; save(join(path, 'ready.json'), marker); req.basis.lessons[0].label = '위조'; save(join(path, 'request.json'), req)
    call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId).code, 'INVALID_REQUEST')
  })
  await check('계산 전 취소는 자식 프로세스 실행 없이 완료한다', async () => {
    const store = newStore(), req = await request(); submit(store, req); call(['cancel', '--store', store, '--request-id', req.requestId]); call(['work', '--store', store, '--once'])
    const done = status(store, req.requestId); assert.equal(done.state, 'cancelled'); assert.equal(done.startedAt, null); assert.equal(existsSync(join(store, 'jobs', req.requestId, 'result.json')), false)
  })
  await check('실행 중 취소는 실제 자식 프로세스를 끝낸 뒤 종료 상태를 기록한다', async () => {
    const store = newStore(), req = await request(); submit(store, req); const child = worker(store, sleepFixture)
    await waitFor(() => status(store, req.requestId)?.state === 'running'); call(['cancel', '--store', store, '--request-id', req.requestId]); assert.equal((await child.finished).code, 0)
    assert.equal(status(store, req.requestId).state, 'cancelled')
    const pid = json(join(store, 'jobs', req.requestId, 'manifest.json')).processId
    assert.equal(runtime('import jobs_worker,json; print(json.dumps(jobs_worker.process_alive(int(sys.argv[2]))))', [String(pid)]), false)
  })
  await check('시간 한도를 넘긴 실제 자식 프로세스를 강제 종료한다', async () => {
    const store = newStore(), req = await request(randomUUID(), basis(), { maxSeconds: 1 }); submit(store, req); const child = worker(store, sleepFixture), before = Date.now()
    assert.equal((await child.finished).code, 0); assert.ok(Date.now() - before >= 5000)
    const done = status(store, req.requestId); assert.equal(done.state, 'timed_out'); assert.equal(done.code, 'HARD_TIMEOUT')
  })
  await check('성공 종료 코드만으로 잘못된 계산 결과를 수용하지 않는다', async () => {
    const store = newStore(), req = await request(); submit(store, req); assert.equal((await worker(store, invalidFixture).finished).code, 0)
    assert.equal(status(store, req.requestId).code, 'RESULT_INVALID'); assert.equal(existsSync(join(store, 'jobs', req.requestId, 'result.json')), false)
  })
  await check('오류 항목의 코드·빈 안내·문자 수 변조를 작업자와 앱이 함께 거부한다', async () => {
    const req = await request(), good = { code: 'ENGINE_ERROR', message: '계산을 확인해 주세요.', path: '' }
    const make = issue => ({ contract: req.contract, requestId: req.requestId, inputHash: req.inputHash, engineVersion: 'canonical-cpsat-1', status: 'error', candidates: [], issues: [issue], stats: { elapsedMs: 1, branches: 0, stoppedByLimit: false } })
    const issues = [{ ...good, code: 'error' }, { ...good, code: 'ERROR_1' }, { ...good, code: '' }, { ...good, code: 'A'.repeat(101) }, { ...good, message: ' \t\n' }, { ...good, message: '\ufeff' }, { ...good, message: '가'.repeat(2001) }, { ...good, message: '😀'.repeat(1001) }, { ...good, path: 'a'.repeat(501) }, { ...good, path: '😀'.repeat(251) }, { ...good, path: false }]
    const values = issues.map(make), file = join(temporary, '오류 항목 검증.json'); save(file, { req, values })
    const accepted = runtime(`import json; from jobs_contract import validate_result, JobError\nd=json.load(open(sys.argv[2],encoding='utf-8')); accepted=[]\nfor value in d['values']:\n try:\n  validate_result(d['req'],value); accepted.append(True)\n except JobError:\n  accepted.append(False)\nprint(json.dumps(accepted))`, [file])
    assert.deepEqual(accepted, values.map(() => false))
    for (const value of values) await assert.rejects(() => m.parseCpSatResponse(req, value))
    const fixture = join(temporary, '오류 항목 계산.py'), store = newStore(); submit(store, req)
    writeFileSync(fixture, "import argparse,json\np=argparse.ArgumentParser();p.add_argument('--input');p.add_argument('--output');a=p.parse_args();r=json.load(open(a.input,encoding='utf-8'));r={k:r[k] for k in ('contract','requestId','inputHash')};r.update(engineVersion='canonical-cpsat-1',status='error',candidates=[],issues=[dict(code='lowercase',message='안내',path='')],stats=dict(elapsedMs=1,branches=0,stoppedByLimit=False));json.dump(r,open(a.output,'w',encoding='utf-8'))\n")
    assert.equal((await worker(store, fixture).finished).code, 0); assert.equal(status(store, req.requestId).code, 'RESULT_INVALID')
  })
  await check('오류 항목의 허용 경계와 JavaScript 공백·UTF-16 길이가 앱과 일치한다', async () => {
    const req = await request(), issues = [{ code: 'A'.repeat(100), message: '가'.repeat(2000), path: 'a'.repeat(500) }, { code: '_', message: '😀'.repeat(1000), path: '😀'.repeat(250) }, { code: 'INFO', message: '\u0085', path: '' }, { code: 'INFO', message: '\u001c', path: '' }, { code: 'INFO', message: '\ufeff 안내 \ufeff', path: '' }]
    const values = issues.map(issue => ({ contract: req.contract, requestId: req.requestId, inputHash: req.inputHash, engineVersion: 'canonical-cpsat-1', status: 'error', candidates: [], issues: [issue], stats: { elapsedMs: 0, branches: 0, stoppedByLimit: false } }))
    const file = join(temporary, '오류 항목 경계.json'); save(file, { req, values })
    const accepted = runtime("import json; from jobs_contract import validate_result; d=json.load(open(sys.argv[2],encoding='utf-8')); print(json.dumps([validate_result(d['req'],value)['status'] for value in d['values']]))", [file])
    assert.deepEqual(accepted, values.map(() => 'error')); for (const value of values) assert.equal((await m.parseCpSatResponse(req, value)).status, 'error')
  })
  await check('실행 실패와 계산상의 해 없음·미지원 응답을 구분한다', async () => {
    const store = newStore(), b = basis(); b.unsupportedFeatures = ['격주']; const req = await request(randomUUID(), b); submit(store, req); call(['work', '--store', store, '--once'])
    assert.equal(status(store, req.requestId).state, 'succeeded'); assert.equal(call(['result', '--store', store, '--request-id', req.requestId]).status, 'unsupported')
  })
  await check('동일 폴더 작업자 두 개는 OS 잠금으로 동시 실행하지 않는다', async () => {
    const store = newStore(), first = worker(store); await waitFor(() => existsSync(join(store, 'worker.json')))
    assert.equal(call(['work', '--store', store, '--once'], 1).error.code, 'WORKER_BUSY')
    assert.equal(call(['cleanup', '--store', store], 1).error.code, 'WORKER_BUSY')
    first.kill(); await first.finished; call(['work', '--store', store, '--once'])
  })
  await check('지속 작업자는 먼저 실행해 두고 이후 들어온 두 요청을 순서대로 처리한다', async () => {
    const store = newStore(), first = worker(store); await waitFor(() => existsSync(join(store, 'worker.json')))
    const a = await request(), b = await request(), queuedAt = Date.now()
    // 빠른 Linux 파일 쓰기는 같은 밀리초가 될 수 있으므로 접수 순서의 근거를 명시한다.
    browserSubmit(store, a, true, new Date(queuedAt - 1000).toISOString()); browserSubmit(store, b, true, new Date(queuedAt).toISOString())
    await waitFor(() => status(store, a.requestId)?.state === 'succeeded' && status(store, b.requestId)?.state === 'succeeded')
    assert.ok(status(store, a.requestId).finishedAt <= status(store, b.requestId).startedAt)
    first.kill(); await first.finished
  })
  await check('같은 접수 시각은 파일 생성 순서와 무관하게 UUID 순서로 하나씩 처리한다', async () => {
    const store = newStore(), a = await request('ffffffff-ffff-ffff-ffff-ffffffffffff'), b = await request('00000000-0000-0000-0000-000000000000'), queuedAt = new Date().toISOString()
    browserSubmit(store, a, true, queuedAt); browserSubmit(store, b, true, queuedAt)
    const first = worker(store)
    await waitFor(() => status(store, a.requestId)?.state === 'succeeded' && status(store, b.requestId)?.state === 'succeeded')
    assert.ok(status(store, b.requestId).finishedAt <= status(store, a.requestId).startedAt)
    first.kill(); await first.finished
  })
  await check('중단 실행은 같은 번호로 재시작하지 않고 접수증 복구만 수행한다', async () => {
    const store = newStore(), req = await request(); submit(store, req)
    runtime("from jobs_runtime import JobStore,atomic_json; s=JobStore(sys.argv[2]); s.admit(sys.argv[3]); a=s.manifest(sys.argv[3]); a['deadlineAt']='2000-01-01T00:00:00.000Z'; atomic_json(s.path(sys.argv[3])/'manifest.json',a); s.transition(sys.argv[3],'running')", [store, req.requestId])
    assert.deepEqual(call(['recover', '--store', store]).blockedRequestIds, [req.requestId])
    assert.equal(call(['work', '--store', store, '--once'], 1).error.code, 'RECOVERY_REQUIRED')
    assert.deepEqual(call(['recover', '--store', store, '--confirm-stopped', req.requestId]).blockedRequestIds, [])
    assert.equal(status(store, req.requestId).state, 'interrupted'); call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId).state, 'interrupted')
  })
  await check('결과 기록 뒤 상태 기록 전에 중단되면 결과를 검증하여 완료 접수증을 복구한다', async () => {
    const store = newStore(), req = await request(); submit(store, req); call(['work', '--store', store, '--once']); const file = join(store, 'jobs', req.requestId, 'status.json'), done = json(file)
    save(file, { ...done, state: 'running', finishedAt: null }); call(['recover', '--store', store]); assert.equal(status(store, req.requestId).state, 'succeeded')
  })
  await check('작업자를 실제로 중단해도 살아 있는 계산을 중복 실행하지 않고 종료 뒤 복구한다', async () => {
    const store = newStore(), req = await request(randomUUID(), basis(), { maxSeconds: 1 }), fixture = join(temporary, '자연 종료.py'); writeFileSync(fixture, 'import time\ntime.sleep(2)\n'); submit(store, req)
    const child = worker(store, fixture), manifest = join(store, 'jobs', req.requestId, 'manifest.json')
    await waitFor(() => json(manifest).processId)
    child.kill(); await child.finished
    assert.deepEqual(call(['recover', '--store', store]).blockedRequestIds, [req.requestId])
    assert.equal(call(['work', '--store', store, '--once'], 1).error.code, 'RECOVERY_REQUIRED')
    await delay(6500)
    assert.deepEqual(call(['recover', '--store', store]).blockedRequestIds, [])
    assert.equal(status(store, req.requestId).state, 'interrupted'); assert.equal(existsSync(join(store, 'jobs', req.requestId, 'result.json')), false)
  })
  await check('보관 결과의 목적함수·지문·후보 누락 변조를 읽기에서도 거부한다', async () => {
    const store = newStore(), req = await request(); submit(store, req); call(['work', '--store', store, '--once']); const file = join(store, 'jobs', req.requestId, 'result.json'), good = json(file)
    for (const change of [v => v.inputHash = '0'.repeat(64), v => v.candidates[0].objective.changedLessons = true, v => v.candidates[0].placements = []]) {
      const bad = structuredClone(good); change(bad); save(file, bad); assert.equal(call(['result', '--store', store, '--request-id', req.requestId], 1).error.code, 'RESULT_INVALID')
    }
  })
  await check('접수 뒤 원본 스냅샷 변경을 중복 실행으로 덮지 않는다', async () => {
    const store = newStore(), req = await request(); submit(store, req); runtime('from jobs_runtime import JobStore; JobStore(sys.argv[2]).admit(sys.argv[3])', [store, req.requestId]); const path = join(store, 'jobs', req.requestId, 'request.snapshot.json'); save(path, { ...req, inputHash: '0'.repeat(64) })
    call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId).code, 'INVALID_REQUEST')
  })
  await check('보관 기간 지난 완료 작업만 미리보기 후 명시적으로 정리한다', async () => {
    const store = newStore(), old = await request(), waiting = await request(); submit(store, old); call(['work', '--store', store, '--once']); submit(store, waiting)
    assert.deepEqual(call(['cleanup', '--store', store]).requestIds, [])
    const file = join(store, 'jobs', old.requestId, 'status.json'); ageJob(store, old.requestId)
    assert.deepEqual(call(['cleanup', '--store', store]).requestIds, [old.requestId]); assert.ok(existsSync(file))
    assert.equal(call(['cleanup', '--store', store, '--apply']).applied, true); assert.equal(existsSync(file), false); assert.ok(existsSync(join(store, 'jobs', waiting.requestId)))
  })
  await check('보관 작업에 알 수 없는 파일이 있으면 삭제하지 않는다', async () => {
    const store = newStore(), req = await request(); submit(store, req); call(['cancel', '--store', store, '--request-id', req.requestId]); call(['work', '--store', store, '--once']); const path = join(store, 'jobs', req.requestId); ageJob(store, req.requestId); writeFileSync(join(path, '보존.txt'), '중요')
    assert.equal(call(['cleanup', '--store', store, '--apply'], 1).error.code, 'UNKNOWN_FILES'); assert.equal(readFileSync(join(path, '보존.txt'), 'utf8'), '중요')
  })
  await check('수동으로 고른 최근 완료 작업 한 개는 정리하지만 대기 작업은 거부한다', async () => {
    const store = newStore(), req = await request(); submit(store, req)
    assert.equal(call(['cleanup', '--store', store, '--request-id', req.requestId, '--apply'], 1).error.code, 'JOB_NOT_FINISHED')
    call(['cancel', '--store', store, '--request-id', req.requestId]); call(['work', '--store', store, '--once'])
    assert.deepEqual(call(['cleanup', '--store', store, '--request-id', req.requestId]).requestIds, [req.requestId]); assert.ok(existsSync(join(store, 'jobs', req.requestId)))
    call(['cleanup', '--store', store, '--request-id', req.requestId, '--apply']); assert.equal(existsSync(join(store, 'jobs', req.requestId)), false)
  })
  await check('작업 번호 경로 이탈을 거부하고 폴더 밖 파일은 건드리지 않는다', () => {
    const store = newStore(); assert.equal(call(['status', '--store', store, '--request-id', '../outside'], 1).error.code, 'INVALID_REQUEST_ID')
  })
  await check('연결 디렉터리로 다른 자료에 접근하지 않는다', () => {
    const store = newStore(), linked = join(temporary, '연결 폴더'); symlinkSync(store, linked, process.platform === 'win32' ? 'junction' : 'dir')
    assert.equal(call(['init', '--store', linked], 1).error.code, 'UNSAFE_PATH'); assert.ok(existsSync(join(store, 'queue.json')))
  })
  await check('정책의 대기 작업 수를 넘긴 요청을 접수하지 않는다', async () => {
    const store = newStore(), policy = json(resolve('packages/timetable/_assets/job-policy.json'))
    for (let i = 0; i < policy.maximumPendingJobs; i++) submit(store, await request())
    const req = await request(), input = join(temporary, 'over-limit.json'); save(input, req)
    assert.equal(call(['submit', '--store', store, '--input', input], 1).error.code, 'QUEUE_FULL'); assert.equal(readdirSync(join(store, 'jobs')).length, policy.maximumPendingJobs)
  })
  await check('깨진 JSON·중복 키·무한 수를 허용하지 않는다', () => {
    const store = newStore(), input = join(temporary, 'invalid.json')
    for (const raw of ['{"requestId":1,"requestId":2}', '{"value":NaN}', '{']) { writeFileSync(input, raw); assert.equal(call(['submit', '--store', store, '--input', input], 1).error.code, 'FILE_UNREADABLE') }
  })

  await check('거부한 원본 하나를 failed로 남기고 지속 작업자는 다음 정상 요청을 실행한다', async () => {
    const store = newStore(), bad = await request(), good = await request(); const path = browserSubmit(store, bad, true, new Date(Date.now() - 1000).toISOString())
    bad.basis.resources[0].label = '\u0085'; save(join(path, 'request.json'), bad); browserSubmit(store, good)
    const child = worker(store)
    await waitFor(() => status(store, bad.requestId)?.state === 'failed' && status(store, good.requestId)?.state === 'succeeded')
    assert.equal(status(store, bad.requestId).code, 'INVALID_REQUEST'); assert.equal(existsSync(join(path, 'result.json')), false)
    child.kill(); await child.finished
    assert.deepEqual(call(['cleanup', '--store', store, '--request-id', bad.requestId]).requestIds, [bad.requestId])
  })
  await check('원본 내용이 깨져도 정확한 요청 표식의 취소는 원본 검증 전에 끝낸다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req); writeFileSync(join(path, 'request.json'), '{')
    call(['cancel', '--store', store, '--request-id', req.requestId]); call(['work', '--store', store, '--once'])
    assert.equal(status(store, req.requestId).state, 'cancelled'); assert.equal(status(store, req.requestId).startedAt, null)
    assert.equal(existsSync(join(path, 'manifest.json')), false)
  })
  await check('취소 표식의 queueId·요청 번호·해시는 원본 검증을 생략해도 대조한다', async () => {
    for (const key of ['queueId', 'requestId', 'inputHash']) {
      const store = newStore(), req = await request(), path = browserSubmit(store, req)
      call(['cancel', '--store', store, '--request-id', req.requestId]); const cancel = json(join(path, 'cancel.json'))
      cancel[key] = key === 'inputHash' ? '0'.repeat(64) : randomUUID(); save(join(path, 'cancel.json'), cancel)
      call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId), null); assert.equal(existsSync(join(path, 'result.json')), false)
      assert.equal(call(['cancel', '--store', store, '--request-id', req.requestId], 1).error.code, key === 'inputHash' ? 'REQUEST_CONFLICT' : 'INVALID_JOB')
    }
  })
  await check('TS와 Python 기초판은 NEL·BOM·짝 없는 서로게이트와 UTF-16 길이를 같은 결과로 판정한다', async () => {
    const labels = ['\u0085', '\ufeff', ' \u0085\ufeff ', '\ud800', '\udc00', '교사\ud800', '😀'.repeat(101), '😀'.repeat(100), '\u0085교사\ufeff', '교사']
    const values = labels.map(label => { const b = basis(); b.resources[0].label = label; return b })
    const input = join(temporary, '문자 대조.json'); save(input, values)
    const accepted = runtime(`import json; import runner\nvalues=json.load(open(sys.argv[2],encoding='utf-8')); result=[]\nfor value in values:\n try:\n  runner.validate_basis(value); result.append(True)\n except runner.InputError:\n  result.append(False)\nprint(json.dumps(result))`, [input])
    assert.deepEqual(accepted, [false, false, false, false, false, false, false, true, true, true])
    assert.deepEqual(values.map(value => m.validateBasis(value).valid), accepted)
  })
  await check('외부 접수로 대기 한도를 넘겨도 해당 작업 실패 뒤 취소·다음 정상 계산이 진행된다', async () => {
    const store = newStore(), reqs = []
    for (let i = 0; i < 17; i++) { const req = await request(); reqs.push(req); browserSubmit(store, req, true, new Date(Date.now() - 10000 + i).toISOString()) }
    call(['work', '--store', store, '--once']); assert.equal(status(store, reqs[0].requestId).code, 'QUEUE_FULL')
    call(['cancel', '--store', store, '--request-id', reqs[1].requestId]); call(['work', '--store', store, '--once'])
    assert.equal(status(store, reqs[1].requestId).state, 'cancelled'); assert.equal(status(store, reqs[2].requestId).state, 'succeeded')
  })
  await check('101개 보관 폴더에서도 조회·취소·전체 정리가 가능하고 신규 실행만 거절한다', async () => {
    const store = newStore(), first = await request(); browserSubmit(store, first); call(['cancel', '--store', store, '--request-id', first.requestId]); call(['work', '--store', store, '--once']); ageJob(store, first.requestId)
    const source = join(store, 'jobs', first.requestId), template = json(join(source, 'status.json'))
    for (let i = 0; i < 100; i++) { const req = await request(), path = browserSubmit(store, req, true, template.queuedAt); save(join(path, 'status.json'), {...template, requestId:req.requestId, inputHash:req.inputHash}) }
    assert.equal(status(store, first.requestId).state, 'cancelled'); call(['cancel', '--store', store, '--request-id', first.requestId])
    const input = join(temporary, '보관초과.json'); save(input, await request()); assert.equal(call(['submit', '--store', store, '--input', input], 1).error.code, 'STORE_FULL')
    assert.equal(call(['cleanup', '--store', store]).requestIds.length, 101); assert.equal(call(['cleanup', '--store', store, '--apply']).requestIds.length, 101)
    assert.deepEqual(readdirSync(join(store, 'jobs')), [])
  })
  await check('실행 여유 용량 부족도 failed 접수증으로 격리하고 후속 취소는 유지한다', async () => {
    const store = newStore(), req = await request(); browserSubmit(store, req)
    runtime("from jobs_runtime import JobStore; from jobs_worker import LocalWorker; from jobs_contract import POLICY; POLICY['maximumStoreBytes']=1000; LocalWorker(JobStore(sys.argv[2])).run(once=True)", [store])
    assert.equal(status(store, req.requestId).code, 'STORE_FULL')
    call(['cancel', '--store', store, '--request-id', req.requestId]); assert.equal(status(store, req.requestId).state, 'failed')
    assert.deepEqual(call(['cleanup', '--store', store, '--request-id', req.requestId]).requestIds, [req.requestId])
  })
  await check('Finder 표식과 원자 기록 임시 파일은 정상 실행을 막지 않고 완료 정리에서만 지운다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req)
    writeFileSync(join(store, 'jobs', '.DS_Store'), 'finder'); writeFileSync(join(path, '.DS_Store'), 'finder')
    const tmp = join(path, `.status.json.${randomUUID()}.tmp`); writeFileSync(tmp, '부분 기록')
    call(['work', '--store', store, '--once']); assert.equal(status(store, req.requestId).state, 'succeeded'); assert.ok(existsSync(tmp))
    call(['cleanup', '--store', store, '--request-id', req.requestId, '--apply']); assert.equal(existsSync(path), false); assert.ok(existsSync(join(store, 'jobs', '.DS_Store')))
  })
  await check('PID 재사용은 생성 토큰 불일치와 명시 확인이 모두 있어야 중단 복구한다', async () => {
    const store = newStore(), req = await request(); submit(store, req)
    const identity = runtime('import json; from jobs_worker import process_identity; print(json.dumps(process_identity(int(sys.argv[2]))))', [String(process.pid)])
    assert.ok(identity)
    runtime("from jobs_runtime import JobStore,atomic_json; s=JobStore(sys.argv[2]); s.admit(sys.argv[3]); m=s.manifest(sys.argv[3]); m.update(deadlineAt='2000-01-01T00:00:00.000Z', processId=int(sys.argv[4]), processIdentity=sys.argv[5]); atomic_json(s.path(sys.argv[3])/'manifest.json',m); s.transition(sys.argv[3],'running')", [store, req.requestId, String(process.pid), identity])
    assert.deepEqual(call(['recover', '--store', store, '--confirm-stopped', req.requestId]).blockedRequestIds, [req.requestId])
    const file = join(store, 'jobs', req.requestId, 'manifest.json'), manifest = json(file); save(file, {...manifest, processIdentity: identity + '0'})
    assert.deepEqual(call(['recover', '--store', store]).blockedRequestIds, [req.requestId])
    assert.deepEqual(call(['recover', '--store', store, '--confirm-stopped', req.requestId]).blockedRequestIds, [])
    assert.equal(status(store, req.requestId).state, 'interrupted'); process.kill(process.pid, 0)
  })


  await check('빈 ready는 해당 요청만 보류하고 닫힌 뒤 같은 번호를 실행하며 정상 다음 요청은 진행한다', async () => {
    const store = newStore(), waiting = await request(), good = await request(), path = browserSubmit(store, waiting), ready = json(join(path, 'ready.json'))
    writeFileSync(join(path, 'ready.json'), ''); browserSubmit(store, good)
    const child = worker(store)
    await waitFor(() => status(store, good.requestId)?.state === 'succeeded'); assert.equal(existsSync(join(path, 'status.json')), false)
    save(join(path, 'ready.json'), ready); await waitFor(() => status(store, waiting.requestId)?.state === 'succeeded')
    child.kill(); await child.finished
  })
  await check('빈 cancel은 가짜 취소·실패를 만들지 않고 닫힌 뒤 실제 취소를 확인한다', async () => {
    const store = newStore(), waiting = await request(), good = await request(), path = browserSubmit(store, waiting), ready = json(join(path, 'ready.json'))
    writeFileSync(join(path, 'cancel.json'), ''); browserSubmit(store, good); const child = worker(store)
    await waitFor(() => status(store, good.requestId)?.state === 'succeeded'); assert.equal(status(store, waiting.requestId), null)
    const {queuedAt,...identity}=ready; save(join(path, 'cancel.json'), {...identity,requestedAt:new Date().toISOString()})
    await waitFor(() => status(store, waiting.requestId)?.state === 'cancelled'); assert.equal(status(store, waiting.requestId).startedAt, null)
    child.kill(); await child.finished
  })
  await check('실행 중 빈 cancel을 읽어도 계산을 실패시키지 않고 완성된 취소 표식만 적용한다', async () => {
    const store = newStore(), req = await request(), path = browserSubmit(store, req), child = worker(store, sleepFixture)
    await waitFor(() => status(store, req.requestId)?.state === 'running'); writeFileSync(join(path, 'cancel.json'), '')
    await delay(400); assert.equal(status(store, req.requestId).state, 'running')
    const {queuedAt,...identity}=json(join(path, 'ready.json')); save(join(path, 'cancel.json'), {...identity,requestedAt:new Date().toISOString()})
    assert.equal((await child.finished).code, 0); assert.equal(status(store, req.requestId).state, 'cancelled')
  })
  await check('실행 전 깨진 status는 다른 요청을 막지 않고 원래 상태 복원 뒤 같은 번호로 이어간다', async () => {
    const store = newStore(), waiting = await request(), good = await request(); submit(store, waiting)
    runtime('from jobs_runtime import JobStore; JobStore(sys.argv[2]).admit(sys.argv[3])', [store, waiting.requestId])
    const file = join(store, 'jobs', waiting.requestId, 'status.json'), original = json(file); writeFileSync(file, '')
    browserSubmit(store, good); const child = worker(store); await waitFor(() => status(store, good.requestId)?.state === 'succeeded')
    assert.equal(readFileSync(file,'utf8'),''); save(file,original); await waitFor(() => status(store, waiting.requestId)?.state === 'succeeded')
    child.kill(); await child.finished
  })
  await check('이미 실행했을 수 있는 manifest·상태 오류는 새 계산을 추측 실행하지 않는다', async () => {
    const store = newStore(), running = await request(), next = await request(); submit(store, running)
    runtime("from jobs_runtime import JobStore,atomic_json; s=JobStore(sys.argv[2]); s.admit(sys.argv[3]); m=s.manifest(sys.argv[3]); m['deadlineAt']='2000-01-01T00:00:00.000Z'; atomic_json(s.path(sys.argv[3])/'manifest.json',m); s.transition(sys.argv[3],'running')", [store,running.requestId])
    writeFileSync(join(store,'jobs',running.requestId,'status.json'),''); browserSubmit(store,next)
    assert.equal(call(['work','--store',store,'--once'],1).error.code,'RECOVERY_REQUIRED'); assert.equal(status(store,next.requestId),null)
  })

  console.log(`전부 통과 (${count}건)`)
} catch (error) {
  // 전체 실행기가 stderr 끝부분만 보여 주어도 실패한 시험과 위치가 함께 남는다.
  console.error(`  ✗ ${activeCheck}: ${String(error?.stack ?? error).replace(/\s+/g, ' ')}`)
  process.exitCode = 1
} finally {
  for (const child of children) child.kill()
  await Promise.all([...children].map(child => child.finished))
  // mkdtemp로 이 시험이 만든 전용 디렉터리만 제거한다.
  assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/')))
  rmSync(temporary, { recursive: true, force: true })
}
