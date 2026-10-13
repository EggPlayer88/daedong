import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { schoolDate, watchSchoolDay } = await loadBrowserModule("export * from '../apps/workhub/src/app/school-day.ts'")
let passed = 0, failures = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.stack) } }

// 실제 시간이나 DB 없이 한국 날짜 경과·절전·정리 동작을 재현한다.
function clock(initial) {
  let now = Date.parse(initial), serial = 0
  const timers = new Map(), originalNow = Date.now
  Date.now = () => now
  const document = new EventTarget()
  document.visibilityState = 'visible'
  const documentListeners = new Map()
  const addDocument = document.addEventListener.bind(document), removeDocument = document.removeEventListener.bind(document)
  document.addEventListener = (name, callback) => { documentListeners.set(callback, name); addDocument(name, callback) }
  document.removeEventListener = (name, callback) => { documentListeners.delete(callback); removeDocument(name, callback) }
  const host = new EventTarget()
  const listeners = new Map()
  const add = host.addEventListener.bind(host), remove = host.removeEventListener.bind(host)
  host.addEventListener = (name, callback) => { listeners.set(callback, name); add(name, callback) }
  host.removeEventListener = (name, callback) => { listeners.delete(callback); remove(name, callback) }
  host.document = document
  host.Date = Date
  host.setTimeout = (callback, wait = 0) => { const id = ++serial; timers.set(id, { callback, due: now + wait }); return id }
  host.clearTimeout = id => timers.delete(id)
  host.setInterval = (callback, wait) => { const id = ++serial; timers.set(id, { callback, due: now + wait, interval: wait }); return id }
  host.clearInterval = id => timers.delete(id)
  return {
    host, timers, listeners, documentListeners,
    advance(milliseconds) {
      const end = now + milliseconds
      let iterations = 0
      while (true) {
        const next = [...timers.entries()].filter(([, timer]) => timer.due <= end).sort((a, b) => a[1].due - b[1].due)[0]
        if (!next) break
        assert(++iterations < 10000, '타이머가 무한 반복해서는 안 됩니다')
        const [id, timer] = next
        now = timer.due
        if (timer.interval) timer.due += timer.interval
        else timers.delete(id)
        timer.callback()
      }
      now = end
    },
    setTime(value) { now = Date.parse(value) },
    visible(value) { document.visibilityState = value ? 'visible' : 'hidden'; document.dispatchEvent(new Event('visibilitychange')) },
    resume() { host.dispatchEvent(new Event('pageshow')) },
    restore() { Date.now = originalNow },
  }
}

test('한국 기준일은 UTC·연도·윤년 경계를 구분한다', () => {
  for (const [input, expected] of [
    ['2026-10-19T14:59:59.999Z', '2026-10-19'],
    ['2026-10-19T15:00:00.000Z', '2026-10-20'],
    ['2026-12-31T15:00:00.000Z', '2027-01-01'],
    ['2028-02-28T15:00:00.000Z', '2028-02-29'],
    ['2028-02-29T15:00:00.000Z', '2028-03-01'],
  ]) assert.equal(schoolDate(Date.parse(input)), expected)
})
test('초기 진입·같은 날짜의 타이머와 복귀는 갱신하지 않는다', () => {
  const time = clock('2026-10-19T01:00:00Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++)
  try {
    assert.equal(changes, 0)
    time.advance(180000); time.resume(); time.visible(true)
    assert.equal(changes, 0)
  } finally { dispose(); time.restore() }
})
test('활성 화면의 자정 경과는 포커스 없이 60초 이내 한 번 알린다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++)
  try {
    time.advance(60000)
    assert.equal(changes, 1)
    time.advance(180000); time.visible(true); time.resume()
    assert.equal(changes, 1)
  } finally { dispose(); time.restore() }
})
test('숨김 중 갱신은 미루고 여러 날 후 보이는 순간 한 번 알린다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++)
  try {
    time.visible(false); time.advance(120000)
    assert.equal(changes, 0)
    time.setTime('2026-10-22T03:00:00Z'); time.visible(true)
    assert.equal(changes, 1)
    time.resume(); time.visible(true)
    assert.equal(changes, 1)
  } finally { dispose(); time.restore() }
})
test('절전·페이지 복귀와 시계 역방향 변경도 날짜당 한 번 재확인한다', () => {
  const time = clock('2026-10-19T01:00:00Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++)
  try {
    time.setTime('2026-10-22T03:00:00Z'); time.resume()
    assert.equal(changes, 1)
    time.setTime('2026-10-18T03:00:00Z'); time.resume()
    assert.equal(changes, 2)
    time.resume(); time.advance(120000)
    assert.equal(changes, 2)
  } finally { dispose(); time.restore() }
})
test('해제한 감시자는 타이머와 복귀 신호에 반응하지 않는다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++)
  try {
    dispose(); dispose()
    assert.equal(time.timers.size, 0)
    assert.equal(time.listeners.size, 0)
    assert.equal(time.documentListeners.size, 0)
    time.setTime('2026-10-22T03:00:00Z'); time.visible(true); time.resume(); time.advance(120000)
    assert.equal(changes, 0)
  } finally { time.restore() }
})
test('빠른 기기 시계는 서버 기준일이 바뀔 때까지 제한된 재확인만 요청한다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0, basis = '2026-10-19'
  const dispose = watchSchoolDay(time.host, () => { changes++; if (changes === 2) basis = '2026-10-20' }, () => basis)
  try {
    time.advance(60000)
    assert.equal(changes, 1)
    time.advance(60000)
    assert.equal(changes, 2)
    time.advance(1200000)
    assert.equal(changes, 2)
  } finally { dispose(); time.restore() }
})
test('서버 기준일이 계속 같아도 추가 갱신 세 번 뒤에는 멈춘다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0
  const dispose = watchSchoolDay(time.host, () => changes++, () => '2026-10-19')
  try {
    time.advance(1200000)
    assert.equal(changes, 4)
    time.advance(1200000)
    assert.equal(changes, 4)
  } finally { dispose(); time.restore() }
})
test('서버 조회 실패·화면 폐기로 기준일이 사라지면 후속 확인을 취소한다', () => {
  const time = clock('2026-10-19T14:59:30Z')
  let changes = 0, basis = '2026-10-19'
  const dispose = watchSchoolDay(time.host, () => { changes++; basis = undefined }, () => basis)
  try {
    time.advance(1200000)
    assert.equal(changes, 1)
  } finally { dispose(); time.restore() }
})
console.log('\n학교 기준일 감지 ' + passed + '개 통과, ' + failures + '개 실패')
if (failures) process.exitCode = 1

