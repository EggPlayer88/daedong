export function publishedFixture() {
  const row = (id, date, hour, teacher, group, state = 'scheduled') => ({ id, version: 1, label: id === 'first' ? '=HYPERLINK("bad") <script>bad()</script>' : '수업 ' + id, time: { startsAt: `${date}T${hour}:00:30.000Z`, endsAt: `${date}T${hour}:45:30.000Z` }, teachers: [{ id: teacher, name: '같은 이름' }], groupNames: ['같은 학급'], roomNames: ['교실'], state, canRequest: false, allowedTargets: [] })
  const lessons = [row('first', '2026-10-19', '00', 'teacher-a', 'group-a'), row('second', '2026-10-19', '01', 'teacher-b', 'group-b'), row('cancelled', '2026-10-20', '00', 'teacher-a', 'group-a', 'cancelled'), row('performed', '2026-10-21', '00', 'teacher-a', 'group-a', 'performed'), row('later', '2026-10-26', '00', 'teacher-a', 'group-a')]
  lessons[0].allowedTargets = [structuredClone(lessons[0].time)]
  const before = structuredClone(lessons[0]); before.time = { startsAt: '2026-10-19T02:00:30.000Z', endsAt: '2026-10-19T02:45:30.000Z' }; lessons[0].version = 2
  const request = { id: 'request', version: 3, proposalHash: 'b'.repeat(64), state: 'applied', kind: 'move', requester: { id: 'teacher-a', name: '같은 이름' }, requesterIsViewer: true, createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-18T00:00:00.000Z', reason: '내보내면 안 되는 개인 사유', changes: [{ before, after: structuredClone(lessons[0]) }], participants: [{ id: 'teacher-a', name: '같은 이름', response: 'accepted', respondedAt: '2026-10-17T01:00:00.000Z' }], actions: [] }
  const view = { asOf: '2026-10-18T00:00:00.000Z', timeZone: 'Asia/Seoul', from: '2026-10-19', until: '2026-11-02', canPublish: false, canRequest: false, drafts: [], lessons, requests: [request], publications: [{ id: 'publication', version: 1, title: '확정본', from: '2026-08-13', until: '2027-01-07', publishedAt: '2026-10-17T00:00:00.000Z' }] }
  const references = { asOf: view.asOf, from: view.from, until: view.until, lessons: lessons.map(lesson => ({ lessonId: lesson.id, version: lesson.version, groups: [{ id: lesson.id === 'second' ? 'group-b' : 'group-a', name: '같은 학급' }], rooms: [{ id: 'room', name: '교실' }] })) }
  return { view, references, selection: { mode: 'week', date: '2026-10-19', teacherId: 'teacher-a', groupId: '' } }
}

export function publishedInterventionsFixture() {
  const fixture = publishedFixture(), person = (id, name) => ({ id, name })
  const teacher = person('teacher-a', '같은 이름'), replacement = person('replacement', '대강 교사')
  const rows = [], requests = [], reason = '출력하면 안 되는 대강 개인 사유'
  const add = (kind, before, after, input) => {
    const people = [...new Map([...(before?.teachers ?? []), ...after.teachers].map(row => [row.id, row])).values()]
    requests.push({ id: 'intervention-' + kind, version: 3, proposalHash: 'a'.repeat(64), state: 'applied', kind, input: { kind, ...input, reason }, requester: teacher, requesterIsViewer: true,
      createdAt: '2026-10-17T00:00:00.000Z', expiresAt: '2026-10-18T00:00:00.000Z', reason, changes: [{ before, after: structuredClone(after) }],
      participants: people.map(row => ({ ...row, response: 'accepted', respondedAt: '2026-10-17T01:00:00.000Z' })), actions: [] })
    rows.push(after)
  }
  const base = { ...structuredClone(fixture.view.lessons[0]), canRequest: false, allowedTargets: [], version: 1, label: '국어' }
  add('substitute', structuredClone(base), { ...structuredClone(base), version: 2, teachers: [replacement] }, { lessonId: base.id, expectedVersion: 1, substituteTeacherId: replacement.id })
  const cancelled = { ...structuredClone(base), id: 'cancelled', version: 2, state: 'cancelled' }
  add('cancel', { ...structuredClone(cancelled), version: 1, state: 'scheduled' }, cancelled, { lessonId: 'cancelled', expectedVersion: 1 })
  const makeup = { ...structuredClone(base), id: 'makeup', version: 1, time: { startsAt: '2026-10-20T00:00:30.000Z', endsAt: '2026-10-20T00:45:30.000Z' } }
  add('makeup', null, makeup, { lessonId: 'cancelled', expectedVersion: 2, target: makeup.time })
  const reopened = { ...structuredClone(base), id: 'reopened', version: 3 }
  add('reopen', { ...structuredClone(reopened), version: 2, state: 'cancelled' }, reopened, { schoolDayChangeId: 'closure-one' })
  fixture.view.lessons = structuredClone(rows); fixture.view.requests = []
  fixture.references.lessons = rows.map(row => ({ lessonId: row.id, version: row.version, groups: [{ id: 'group-a', name: '같은 학급' }], rooms: [{ id: 'room', name: '교실' }] }))
  fixture.selection.teacherId = ''
  fixture.interventions = { asOf: fixture.view.asOf, timeZone: fixture.view.timeZone, from: fixture.view.from, until: fixture.view.until, lessons: structuredClone(rows), teachers: [teacher, replacement], closures: [], requests }
  return fixture
}
