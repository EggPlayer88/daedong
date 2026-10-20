import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule("export * from '../apps/workhub/src/timetable/pilot/fixture'; export * from '../apps/workhub/src/timetable/pilot/roster'")
let count = 0
async function check(name, test) { await test(); count++; console.log('  ✓ ' + name) }
const fixture = m.getPilotFixture()
const candidate = (id = 'member-1', label = '검증 교사') => ({ id, schoolId: fixture.schoolId, label, active: true })
const directory = await m.createRegisteredTeacherDirectory(fixture.schoolId, 1, [candidate(), candidate('member-2', '같은 이름'), candidate('member-3', '같은 이름')])
const roster = await m.createPilotRoster(fixture)
const input = () => ({ expectedVersion: 1, sourceFingerprint: roster.revisions[0].sourceFingerprint, effectiveFrom: '2026-03-16', requestKey: 'replace-1', assignments: [{ roleId: fixture.teachers[0].id, candidateId: 'member-1' }] })
const preview = () => m.previewRosterReplacement(fixture, roster, directory, input(), '2026-03-09')

await check('1학기 원본 해시를 고정하고 9학급 279칸을 가상 교사 18명으로 구성한다', async () => {
  assert.equal(fixture.classes.length, 9); assert.equal(fixture.teachers.length, 18); assert.equal(fixture.lessons.length, 279)
  assert.equal(fixture.lessons.filter(lesson => lesson.subject === '창체').length, 9)
  assert.equal(fixture.source.originalCollisionCount, 90)
  const raw = await readFile(new URL('../backup/v1_timetables_data.csv', import.meta.url))
  assert.equal(createHash('sha256').update(raw).digest('hex'), fixture.source.sha256)
  assert.ok(fixture.teachers.every(teacher => teacher.kind === 'virtual' && teacher.label.startsWith('가상 ')))
  assert.equal(m.validatePilotFixture(fixture).lessons.length, 279)
})
await check('279칸 각각을 옛 시드의 학급·요일·교시·과목 회전식과 대조한다', () => {
  const subjects = ['국어', '수학', '영어', '과학', '사회', '체육']
  for (let classIndex = 0; classIndex < 9; classIndex++) {
    const cells = fixture.lessons.filter(lesson => lesson.classIds.includes(`pilot-c${classIndex + 1}`))
    assert.equal(cells.length, 31)
    for (let day = 1; day <= 5; day++) for (let period = 1; period <= 6; period++) {
      assert.equal(cells.find(lesson => lesson.weekday === day && lesson.period === period)?.subject, subjects[(period - 1 + classIndex + (day - 1) * 2) % 6])
    }
  }
})
await check('교사·학급·교실 동시간 중복과 겹치는 종소리는 거부한다', () => {
  for (const edit of [f => { f.lessons[31].teacherId = f.lessons[0].teacherId }, f => { f.lessons[31].classIds = f.lessons[0].classIds }, f => { f.lessons[31].roomId = f.lessons[0].roomId }, f => { f.daySlots[1].startTime = '09:10' }]) {
    const changed = structuredClone(fixture); edit(changed); assert.throws(() => m.validatePilotFixture(changed))
  }
})
await check('숨은 필드·미등록 자원·잘못된 날짜·제어문자를 거부한다', () => {
  for (const edit of [f => { f.secret = true }, f => { f.lessons[0].teacherId = 'absent' }, f => { f.dateRange.startsOn = '2026-02-30' }, f => { f.teachers[0].label = '교사\u0085' }, f => { f.teachers[0].label = '\ud800' }]) {
    const changed = structuredClone(fixture); edit(changed); assert.throws(() => m.validatePilotFixture(changed))
  }
})
await check('매번 새 복제본을 반환하므로 다른 화면에서 원본 시드를 바꿀 수 없다', () => {
  const changed = m.getPilotFixture(); changed.teachers[0].label = '변경'; assert.notEqual(m.getPilotFixture().teachers[0].label, '변경')
})
await check('명시한 후보 ID만 연결하고 동명이인 이름으로 자동 매칭하지 않는다', async () => {
  const selected = input(); selected.assignments[0].candidateId = 'member-3'
  const p = await m.previewRosterReplacement(fixture, roster, directory, selected, '2026-03-09')
  assert.equal(p.changes[0].after.candidateId, 'member-3'); assert.equal(p.changes[0].after.label, '같은 이름')
  selected.assignments[0].candidateId = 'same-name'
  await assert.rejects(() => m.previewRosterReplacement(fixture, roster, directory, selected, '2026-03-09'), error => error.code === 'UNKNOWN_REGISTERED_TEACHER')
})
await check('미리보기는 원본을 수정하지 않고 적용 수업 수와 전후 담당을 담는다', async () => {
  const before = JSON.stringify([fixture, roster, directory]); const p = await preview()
  assert.ok(p.affectedWeeklyLessons > 0); assert.equal(p.changes[0].before.kind, 'virtual'); assert.equal(p.changes[0].after.kind, 'registered-reference')
  assert.equal(JSON.stringify([fixture, roster, directory]), before)
})
await check('학교가 다르거나 정지한 후보·위조 지문을 차단한다', async () => {
  for (const edit of [d => { d.schoolId = 'other' }, d => { d.teachers[0].label = '바뀜' }, d => { d.teachers[0].active = false }]) {
    const changed = structuredClone(directory); edit(changed)
    await assert.rejects(() => m.previewRosterReplacement(fixture, roster, changed, input(), '2026-03-09'))
  }
  const inactive = await m.createRegisteredTeacherDirectory(fixture.schoolId, 2, [{ ...candidate(), active: false }])
  await assert.rejects(() => m.previewRosterReplacement(fixture, roster, inactive, input(), '2026-03-09'), error => error.code === 'INACTIVE_TEACHER')
})
await check('원본·명단·판이 바뀌면 기존 미리보기를 확정하지 않는다', async () => {
  const p = await preview()
  const laterDirectory = await m.createRegisteredTeacherDirectory(fixture.schoolId, 2, directory.teachers)
  await assert.rejects(() => m.commitRosterReplacement(fixture, roster, laterDirectory, p, '2026-03-09'), error => error.code === 'DIRECTORY_CHANGED')
  const changedFixture = structuredClone(fixture); changedFixture.revision++
  await assert.rejects(() => m.commitRosterReplacement(changedFixture, roster, directory, p, '2026-03-09'), error => error.code === 'SOURCE_CHANGED')
  const stale = input(); stale.expectedVersion++
  await assert.rejects(() => m.previewRosterReplacement(fixture, roster, directory, stale, '2026-03-09'), error => error.code === 'ROSTER_CHANGED')
})
await check('같은 교사로 중복 역할을 묶어 동시간 수업이 겹치면 거부한다', async () => {
  const command = input(); command.assignments.push({ roleId: fixture.teachers[6].id, candidateId: 'member-1' })
  await assert.rejects(() => m.previewRosterReplacement(fixture, roster, directory, command, '2026-03-09'), error => error.code === 'TEACHER_TIME_CONFLICT')
})
await check('시간이 겹치지 않는 역할은 같은 실교사로 명시 매핑할 수 있다', async () => {
  const compact = structuredClone(fixture)
  compact.lessons = compact.lessons.slice(0, 2); compact.teachers = compact.teachers.filter(t => compact.lessons.some(l => l.teacherId === t.id))
  const r = await m.createPilotRoster(compact)
  const command = { ...input(), sourceFingerprint: r.revisions[0].sourceFingerprint, assignments: compact.teachers.map(t => ({ roleId: t.id, candidateId: 'member-1' })) }
  const p = await m.previewRosterReplacement(compact, r, directory, command, '2026-03-09')
  assert.equal(p.changes.length, 2)
})
await check('적용일 전 담당과 과거 원문을 보존하고 이후에만 새 판을 선택한다', async () => {
  const before = JSON.stringify(roster), p = await preview(), next = await m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-09')
  assert.equal(next.version, 2); assert.equal(JSON.stringify(roster), before)
  assert.deepEqual(next.revisions[0], roster.revisions[0]); assert.deepEqual(next.revisions[1].request, m.rosterReplacementInput(input()))
  assert.equal(m.rosterBindingsOn(next, '2026-03-15')[0].kind, 'virtual')
  assert.equal(m.rosterBindingsOn(next, '2026-03-16')[0].candidateId, 'member-1')
})
await check('원래 요청 번호의 재시도는 명단이 바뀌어도 기존 확정을 반복하지 않는다', async () => {
  const p = await preview(), next = await m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-09')
  assert.deepEqual(await m.commitRosterReplacement(fixture, next, null, p, '2026-03-10'), next)
})
await check('같은 적용일의 후속 교정은 새 판으로 쌓고 앞선 요청 원문을 보존한다', async () => {
  const p = await preview(), next = await m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-09')
  const command = { ...input(), expectedVersion: 2, requestKey: 'replace-2', assignments: [{ roleId: fixture.teachers[0].id, candidateId: 'member-2' }] }
  const nextPreview = await m.previewRosterReplacement(fixture, next, directory, command, '2026-03-09')
  const corrected = await m.commitRosterReplacement(fixture, next, directory, nextPreview, '2026-03-09')
  assert.equal(corrected.version, 3); assert.deepEqual(corrected.revisions[1], next.revisions[1])
  assert.equal(m.rosterBindingsOn(corrected, '2026-03-16')[0].candidateId, 'member-2')
})
await check('시간표 기준판 교체 뒤에도 기존 교사 연결과 과거 판을 보존한다', async () => {
  const p = await preview(), next = await m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-09')
  const updatedFixture = structuredClone(fixture); updatedFixture.revision++; updatedFixture.lessons[0].subject = '국어 심화'
  const rebased = await m.rebasePilotRoster(fixture, updatedFixture, next, '2026-03-23', '2026-03-09')
  assert.equal(rebased.version, 3); assert.deepEqual(rebased.revisions.slice(0, 2), next.revisions)
  assert.equal(rebased.revisions[2].request.kind, 'basis-rebase')
  assert.equal(m.rosterBindingsOn(rebased, '2026-03-23')[0].candidateId, 'member-1')
  const command = { ...input(), expectedVersion: 3, sourceFingerprint: await m.fingerprintPilotFixture(updatedFixture), effectiveFrom: '2026-03-30', requestKey: 'replace-after-basis', assignments: [{ roleId: fixture.teachers[0].id, candidateId: 'member-2' }] }
  assert.equal((await m.previewRosterReplacement(updatedFixture, rebased, directory, command, '2026-03-09')).changes[0].before.candidateId, 'member-1')
})
await check('교사 교체 이력의 원래 명령과 다른 연결을 주입하면 거부한다', async () => {
  const next = await m.commitRosterReplacement(fixture, roster, directory, await preview(), '2026-03-09')
  next.revisions[1].bindings[0].candidateId = 'member-2'
  await assert.rejects(() => m.previewRosterReplacement(fixture, next, directory, { ...input(), expectedVersion: 2, requestKey: 'replace-2' }, '2026-03-09'), error => error.code === 'HISTORY_CHANGED')
})
await check('미리보기 담당·적용일·변경 수를 조작하면 거부한다', async () => {
  for (const edit of [p => { p.changes[0].after.candidateId = 'member-2' }, p => { p.input.effectiveFrom = '2026-03-17' }, p => { p.affectedWeeklyLessons++ }]) {
    const p = await preview(); edit(p); await assert.rejects(() => m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-09'), error => error.code === 'PREVIEW_CHANGED')
  }
})
await check('과거 적용·범위 밖 날짜·지난 미리보기의 늦은 확정을 차단한다', async () => {
  for (const date of ['2026-03-01', '2026-03-08', '2026-08-16']) {
    await assert.rejects(() => m.previewRosterReplacement(fixture, roster, directory, { ...input(), effectiveFrom: date }, '2026-03-09'))
  }
  const p = await preview(); await assert.rejects(() => m.commitRosterReplacement(fixture, roster, directory, p, '2026-03-17'), error => error.code === 'INVALID_EFFECTIVE_DATE')
})
await check('관리자 CSV는 정확한 ID·학교·상태를 요구하고 이메일 열을 받지 않는다', async () => {
  const csv = '\uFEFFid,schoolId,label,active\r\nmember-1,pilot-daedong,"교사, 한 명",true\r\n'
  const result = await m.parseRegisteredTeacherCsv(csv, fixture.schoolId); assert.equal(result.teachers[0].label, '교사, 한 명'); assert.equal(result.source, 'administrator-csv')
  for (const bad of [csv.replace('label,active', 'label,email'), csv.replace('true', '예'), csv.replace('pilot-daedong', 'other'), csv + 'member-1,pilot-daedong,중복,true', csv.replace('"교사, 한 명"', '"끝나지 않음')]) {
    await assert.rejects(() => m.parseRegisteredTeacherCsv(bad, fixture.schoolId))
  }
})
await check('내보내기는 연락처·회원ID를 제외하고 수식 시작 문자를 문자로 처리한다', async () => {
  const d = await m.createRegisteredTeacherDirectory(fixture.schoolId, 1, [candidate('member-1', '=SUM(1,2)')])
  const p = await m.previewRosterReplacement(fixture, roster, d, input(), '2026-03-09'), r = await m.commitRosterReplacement(fixture, roster, d, p, '2026-03-09')
  const csv = m.exportPilotRosterCsv(r, '2026-03-16')
  assert.ok(csv.includes("'=SUM(1,2)")); assert.ok(!csv.includes('member-1')); assert.ok(!csv.includes('email'))
})
console.log(`\n시간표 운영 연습 원본·교사 교체 ${count}개 통과`)
