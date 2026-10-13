import type { Membership } from '../contracts'
import { StudentError, type ActivityEvent, type EvidenceRef, type Observation, type ObservationDraft, type ObservationView, type Period, type SourceItem, type SourceView, type StudentSnapshot, type StudentStoreOptions } from './contracts'

const copy = <T,>(value: T): T => structuredClone(value)
export function validStudentDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}
export const within = (date: string, period: Period) => validStudentDate(date) && period.from <= date && date < period.until
const fail = (code: ConstructorParameters<typeof StudentError>[0], message: string): never => { throw new StudentError(code, message) }
const requireText = (value: unknown, label: string, max = 4000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_INPUT', `${label}을(를) 확인해 주세요.`)
  return (value as string).trim()
}
const last = <T,>(rows: T[]) => rows[rows.length - 1]

// 이 자료는 로컬 개발용 합성 명부다. 담당 배정도 실제 권한 승인을 뜻하지 않는다.
export function createStudentFixture(members: Membership[], date: string): StudentSnapshot {
  if (!validStudentDate(date)) fail('INVALID_INPUT', '기준일을 확인해 주세요.')
  const year = Number(date.slice(0, 4)) - (date.slice(5) < '03-01' ? 1 : 0)
  const period = { from: `${year}-03-01`, until: `${year + 1}-03-01` }
  const state: StudentSnapshot = { kind: 'synthetic-students-v1', schemaVersion: 1, serial: 0, students: [], classes: [], enrollments: [], courses: [], assignments: [], courseMemberships: [], observations: [], sources: [], receipts: [] }
  for (const schoolId of new Set(members.map(member => member.schoolId))) {
    const classId = `${schoolId}:class:${year}:1`
    state.classes.push({ id: classId, schoolId, year, label: '가상 1학년 1반' })
    for (const number of [1, 2, 3]) {
      const studentId = `${schoolId}:student:${number}`
      const enrollmentId = `${classId}:enrollment:${number}`
      state.students.push({ id: studentId, schoolId, name: `가상 학생 ${['가', '나', '다'][number - 1]}`, status: 'enrolled' })
      state.enrollments.push({ id: enrollmentId, schoolId, studentId, classId, number, ...period })
    }
    for (const member of members.filter(item => item.schoolId === schoolId && item.active)) {
      const courseId = `${schoolId}:course:${member.id}`
      state.courses.push({ id: courseId, schoolId, classId, label: '가상 디지털 시민 수업' })
      state.assignments.push({ courseId, schoolId, userId: member.userId, approved: true, ...period })
      state.courseMemberships.push(...state.enrollments.filter(item => item.classId === classId).map(item => ({ courseId, schoolId, studentId: item.studentId, enrollmentId: item.id, ...period })))
    }
  }
  return state
}

function validateSnapshot(value: StudentSnapshot): StudentSnapshot {
  if (!value || value.kind !== 'synthetic-students-v1' || value.schemaVersion !== 1 || !Number.isInteger(value.serial) || value.serial < 0) fail('INVALID_INPUT', '학생 미리보기 저장 형식이 다릅니다. 합성 자료를 초기화해 주세요.')
  for (const field of ['students', 'classes', 'enrollments', 'courses', 'assignments', 'courseMemberships', 'observations', 'sources', 'receipts'] as const) {
    if (!Array.isArray(value[field]) || value[field].some(row => !row || typeof row !== 'object')) fail('INVALID_INPUT', '학생 미리보기 저장 자료가 손상되었습니다.')
  }
  for (const field of ['students', 'classes', 'enrollments', 'courses', 'observations', 'sources'] as const) {
    if (new Set(value[field].map(row => row.id)).size !== value[field].length || value[field].some(row => typeof row.id !== 'string' || typeof row.schoolId !== 'string')) fail('INVALID_INPUT', '중복 식별자 또는 학교 범위가 없는 자료입니다.')
  }
  for (const row of [...value.enrollments, ...value.assignments, ...value.courseMemberships]) {
    if (!validStudentDate(row.from) || !validStudentDate(row.until) || row.from >= row.until) fail('INVALID_INPUT', '학적·배정 기간이 잘못되었습니다.')
  }
  for (const row of value.observations) {
    if (!Array.isArray(row.revisions) || !row.revisions.length || row.revisions.some((revision, index) => !revision || revision.version !== index + 1 || !validStudentDate(revision.observedAt) || typeof revision.content !== 'string')) fail('INVALID_INPUT', '관찰 개정 이력이 잘못되었습니다.')
  }
  for (const row of value.sources) if (!Array.isArray(row.revisions) || !row.revisions.length || !Array.isArray(row.mappings)) fail('INVALID_INPUT', '활동 원자료 이력이 잘못되었습니다.')
  const invalid = () => fail('INVALID_INPUT', '학생 저장 자료의 학교·참조·개정 계약이 맞지 않습니다. 합성 자료를 초기화해 주세요.')
  const text = (input: unknown) => typeof input === 'string' && input.trim().length > 0
  const enrollmentMatches = (schoolId: string, studentId: string, enrollmentId: string, courseId: string, date: string) => {
    const course = value.courses.find(item => item.id === courseId && item.schoolId === schoolId)
    const enrollment = value.enrollments.find(item => item.id === enrollmentId && item.schoolId === schoolId && item.studentId === studentId && item.classId === course?.classId)
    return Boolean(course && enrollment && within(date, enrollment) && value.courseMemberships.some(item => item.courseId === courseId && item.schoolId === schoolId && item.studentId === studentId && item.enrollmentId === enrollmentId && within(date, item)))
  }
  for (const row of value.students) if (!text(row.name) || !['enrolled', 'transferred'].includes(row.status)) invalid()
  for (const row of value.classes) if (!Number.isInteger(row.year) || !text(row.label)) invalid()
  for (const row of value.enrollments) {
    if (!Number.isInteger(row.number) || row.number < 1 || !value.students.some(item => item.id === row.studentId && item.schoolId === row.schoolId) || !value.classes.some(item => item.id === row.classId && item.schoolId === row.schoolId)) invalid()
  }
  const overlaps = (a: Period, b: Period) => a.from < b.until && b.from < a.until
  if (value.enrollments.some((row, index) => value.enrollments.slice(index + 1).some(other => row.schoolId === other.schoolId && overlaps(row, other) && (row.studentId === other.studentId || (row.classId === other.classId && row.number === other.number))))) invalid()
  for (const row of value.courses) if (!text(row.label) || !value.classes.some(item => item.id === row.classId && item.schoolId === row.schoolId)) invalid()
  for (const row of value.assignments) if (typeof row.approved !== 'boolean' || !text(row.userId) || !value.courses.some(item => item.id === row.courseId && item.schoolId === row.schoolId)) invalid()
  for (const row of value.courseMemberships) {
    const course = value.courses.find(item => item.id === row.courseId && item.schoolId === row.schoolId)
    const enrollment = value.enrollments.find(item => item.id === row.enrollmentId && item.schoolId === row.schoolId && item.studentId === row.studentId && item.classId === course?.classId)
    if (!course || !enrollment || row.from < enrollment.from || row.until > enrollment.until) invalid()
  }
  if (value.courseMemberships.some((row, index) => value.courseMemberships.slice(index + 1).some(other => row.schoolId === other.schoolId && row.courseId === other.courseId && row.studentId === other.studentId && overlaps(row, other)))) invalid()
  for (const source of value.sources) {
    if (!text(source.ownerUserId)) invalid()
    let previous = 0
    const first = source.revisions[0]
    for (const revision of source.revisions) {
      if (!revision || !Number.isInteger(revision.revision) || revision.revision <= previous || !['upsert', 'withdraw', 'delete'].includes(revision.operation) || !validStudentDate(revision.occurredAt) || ['eventId', 'sourceSystem', 'activityId', 'itemId', 'courseId', 'questionVersion', 'question', 'alias', 'receivedAt'].some(field => !text((revision as unknown as Record<string, unknown>)[field])) || typeof revision.answer !== 'string') invalid()
      if (['sourceSystem', 'activityId', 'itemId', 'courseId', 'occurredAt'].some(field => (revision as unknown as Record<string, unknown>)[field] !== (first as unknown as Record<string, unknown>)[field]) || !value.courses.some(item => item.id === revision.courseId && item.schoolId === source.schoolId)) invalid()
      if (previous && source.revisions.find(item => item.revision === previous)?.operation === 'delete') invalid()
      previous = revision.revision
    }
    if (first.operation !== 'upsert') invalid()
    for (let index = 0; index < source.mappings.length; index++) {
      const mapping = source.mappings[index]
      const sourceRevision = source.revisions.find(item => item.revision === mapping?.sourceRevision && item.operation === 'upsert')
      if (!mapping || mapping.revision !== index + 1 || !sourceRevision || !enrollmentMatches(source.schoolId, mapping.studentId, mapping.enrollmentId, sourceRevision.courseId, sourceRevision.occurredAt)) invalid()
    }
  }
  for (const record of value.observations) {
    if (!text(record.authorUserId) || !text(record.authorMemberId)) invalid()
    for (const revision of record.revisions) {
      if (!['active', 'withdrawn'].includes(revision.state) || revision.confirmed !== true || !text(revision.activity) || !text(revision.content) || !text(revision.reason) || !text(revision.createdAt) || !enrollmentMatches(record.schoolId, revision.studentId, revision.enrollmentId, revision.courseId, revision.observedAt)) invalid()
      if (!value.assignments.some(item => item.schoolId === record.schoolId && item.userId === record.authorUserId && item.courseId === revision.courseId && item.approved && within(revision.observedAt, item))) invalid()
      if (revision.source) {
        const source = value.sources.find(item => item.id === revision.source?.sourceId && item.schoolId === record.schoolId && item.ownerUserId === record.authorUserId)
        const mapping = source?.mappings.find(item => item.revision === revision.source?.mappingRevision && item.sourceRevision === revision.source?.sourceRevision)
        if (!mapping || mapping.studentId !== revision.studentId || mapping.enrollmentId !== revision.enrollmentId) invalid()
      }
    }
    if (record.revisions.some((revision, index) => index > 0 && record.revisions[index - 1].state === 'withdrawn')) invalid()
  }
  const keys = new Set<string>()
  for (const receipt of value.receipts) {
    if (!text(receipt.key) || !text(receipt.payload) || !text(receipt.resultId) || keys.has(receipt.key)) invalid()
    keys.add(receipt.key)
    let scope: unknown; let payload: unknown
    try { scope = JSON.parse(receipt.key); payload = JSON.parse(receipt.payload) } catch { invalid() }
    if (!Array.isArray(scope) || scope.length !== 4 || !scope.every(text) || !payload || typeof payload !== 'object') invalid()
    const [schoolId, userId, action] = scope as string[]
    if (!['create', 'revise', 'withdraw', 'activity', 'mapping', 'adopt'].includes(action)) invalid()
    const exists = ['activity', 'mapping'].includes(action)
      ? value.sources.some(item => item.id === receipt.resultId && item.schoolId === schoolId && item.ownerUserId === userId)
      : value.observations.some(item => item.id === receipt.resultId && item.schoolId === schoolId && item.authorUserId === userId)
    if (!exists) invalid()
  }
  return copy(value)
}

// 신뢰 경계가 없는 합성 계약 시뮬레이션이다. 실제 학생 자료·인증·서버 RLS를 연결하지 않는다.
export function createStudentStore(options: StudentStoreOptions) {
  let members = copy(options.members)
  let basisDate = options.date
  const seed = createStudentFixture(members, basisDate)
  let state = options.snapshot ? validateSnapshot(options.snapshot) : copy(seed)
  // 영속화 콜백이 실패하면 기록·버전·접수증을 함께 이전 상태로 유지한다.
  const commit = (next: StudentSnapshot) => { options.onChange?.(copy(next)); state = next }
  function actor(memberId: string): Membership {
    const member = members.find(item => item.id === memberId)
    // 공통 Membership.validThrough는 기존 셸의 '마지막 유효일'이다. 학적 Period.until은 종료 제외다.
    if (!member || !member.active || !validStudentDate(basisDate) || member.validFrom > basisDate || member.validThrough < basisDate) fail('INACTIVE_MEMBERSHIP', '현재 학교 소속이 종료되어 학생 자료를 열거나 저장할 수 없습니다.')
    return member!
  }
  function courseFor(member: Membership, id: string, date: string, data = state) {
    if (!validStudentDate(date)) fail('INVALID_INPUT', '수업 기준일을 확인해 주세요.')
    const course = data.courses.find(item => item.id === id && item.schoolId === member.schoolId)
    if (!course || !data.assignments.some(item => item.schoolId === member.schoolId && item.courseId === id && item.userId === member.userId && item.approved && within(date, item))) fail('NOT_FOUND', '해당 날짜에 승인된 내 수업이 없거나 열람할 수 없습니다.')
    return course!
  }
  function studentFor(member: Membership, draft: Pick<ObservationDraft, 'studentId' | 'enrollmentId' | 'courseId' | 'observedAt'>, data = state) {
    const course = courseFor(member, draft.courseId, draft.observedAt, data)
    const student = data.students.find(item => item.id === draft.studentId && item.schoolId === member.schoolId)
    const enrollment = data.enrollments.find(item => item.id === draft.enrollmentId && item.schoolId === member.schoolId && item.studentId === draft.studentId && item.classId === course.classId)
    const linked = data.courseMemberships.some(item => item.courseId === course.id && item.schoolId === member.schoolId && item.studentId === draft.studentId && item.enrollmentId === draft.enrollmentId && within(draft.observedAt, item))
    if (!student || !enrollment || !within(draft.observedAt, enrollment) || !linked) fail('PERIOD_MISMATCH', '학생·학적·수강 기간이 맞지 않습니다. 학생 연결을 다시 확인해 주세요.')
    return { student: student!, enrollment: enrollment!, course }
  }
  function normalize(member: Membership, draft: ObservationDraft): ObservationDraft {
    if (!draft || typeof draft !== 'object' || !validStudentDate(draft.observedAt) || draft.observedAt > basisDate) fail('INVALID_INPUT', '관찰일은 실제 존재하는 오늘 또는 과거 날짜여야 합니다.')
    if (draft.confirmed !== true) fail('INVALID_INPUT', '직접 확인한 사실인지 확인해 주세요.')
    const clean = { studentId: requireText(draft.studentId, '학생'), enrollmentId: requireText(draft.enrollmentId, '학적'), courseId: requireText(draft.courseId, '수업'), observedAt: draft.observedAt, activity: requireText(draft.activity, '활동', 150), content: requireText(draft.content, '관찰 내용'), confirmed: true }
    studentFor(member, clean)
    return clean
  }
  function ownRecord(member: Membership, id: string, data = state) {
    const record = data.observations.find(item => item.id === id && item.schoolId === member.schoolId && item.authorUserId === member.userId)
    if (!record) fail('NOT_FOUND', '본인이 작성한 기록이 없거나 열람할 수 없습니다.')
    return record!
  }
  function ownSource(member: Membership, id: string, data = state) {
    const source = data.sources.find(item => item.id === id && item.schoolId === member.schoolId && item.ownerUserId === member.userId)
    if (!source) fail('NOT_FOUND', '본인의 활동 원자료가 없거나 열람할 수 없습니다.')
    return source!
  }
  function sourceView(source: SourceItem): SourceView {
    const current = last(source.revisions)
    const mapping = last(source.mappings)
    const currentMapping = mapping?.sourceRevision === current.revision ? mapping : undefined
    let status: SourceView['state'] = current.operation === 'delete' ? 'deleted' : current.operation === 'withdraw' ? 'withdrawn' : currentMapping ? 'mapped' : 'received'
    if (status === 'mapped' && state.observations.some(item => last(item.revisions).state === 'active' && last(item.revisions).source?.sourceId === source.id && last(item.revisions).source?.sourceRevision === current.revision && last(item.revisions).source?.mappingRevision === currentMapping?.revision)) status = 'adopted'
    return { ...copy(source), current: copy(current), mapping: currentMapping ? copy(currentMapping) : undefined, state: status }
  }
  function stale(member: Membership, ref?: EvidenceRef) {
    if (!ref) return false
    const source = state.sources.find(item => item.id === ref.sourceId && item.schoolId === member.schoolId && item.ownerUserId === member.userId)
    if (!source) return true
    const view = sourceView(source)
    return view.current.operation !== 'upsert' || view.current.revision !== ref.sourceRevision || view.mapping?.revision !== ref.mappingRevision
  }
  function recordView(member: Membership, record: Observation): ObservationView {
    const current = last(record.revisions)
    return { ...copy(record), current: copy(current), needsReview: stale(member, current.source), studentName: state.students.find(student => student.schoolId === member.schoolId && student.id === current.studentId)?.name ?? '학생 연결 확인 필요' }
  }
  function command(member: Membership, key: string, kind: string, payload: unknown, apply: (next: StudentSnapshot) => string): string {
    requireText(key, '요청 번호', 200)
    const receiptKey = JSON.stringify([member.schoolId, member.userId, kind, key])
    const text = JSON.stringify(payload)
    const receipt = state.receipts.find(item => item.key === receiptKey)
    if (receipt) {
      if (receipt.payload !== text) fail('IDEMPOTENCY_CONFLICT', '같은 요청 번호에 다른 입력이 들어왔습니다.')
      return receipt.resultId
    }
    const next = copy(state)
    const resultId = apply(next)
    next.receipts.push({ key: receiptKey, payload: text, resultId })
    commit(next)
    return resultId
  }
  function checkVersion(actual: number, expected: number) {
    if (!Number.isInteger(expected) || expected < 1) fail('INVALID_INPUT', '기록 기준 버전을 확인해 주세요.')
    if (actual !== expected) fail('CONFLICT', '다른 화면에서 먼저 바뀐 기록입니다. 현재 버전을 확인한 뒤 다시 저장해 주세요.')
  }
  return {
    setContext(nextMembers: Membership[], date: string) { if (!validStudentDate(date)) fail('INVALID_INPUT', '기준일이 올바르지 않습니다.'); members = copy(nextMembers); basisDate = date },
    exportState: () => copy(state),
    reset() { commit(copy(seed)) },
    listCourses(memberId: string, date = basisDate) {
      const member = actor(memberId)
      if (!validStudentDate(date)) fail('INVALID_INPUT', '수업 기준일을 확인해 주세요.')
      return copy(state.courses.filter(course => course.schoolId === member.schoolId && state.assignments.some(item => item.schoolId === member.schoolId && item.courseId === course.id && item.userId === member.userId && item.approved && within(date, item))).map(course => ({ ...course, classLabel: state.classes.find(item => item.id === course.classId && item.schoolId === member.schoolId)?.label ?? '학급 확인 필요' })))
    },
    listStudents(memberId: string, courseId: string, date = basisDate) {
      const member = actor(memberId); courseFor(member, courseId, date)
      return copy(state.courseMemberships.filter(item => item.courseId === courseId && item.schoolId === member.schoolId && within(date, item)).flatMap(item => {
        try { const result = studentFor(member, { ...item, observedAt: date }); return [{ ...result.student, enrollmentId: result.enrollment.id, number: result.enrollment.number, enrollmentFrom: result.enrollment.from, enrollmentUntil: result.enrollment.until }] } catch { return [] }
      }).sort((a, b) => a.number - b.number))
    },
    listRecords(memberId: string) {
      const member = actor(memberId)
      return state.observations.filter(item => item.schoolId === member.schoolId && item.authorUserId === member.userId).map(item => recordView(member, item)).sort((a, b) => b.current.observedAt.localeCompare(a.current.observedAt) || b.id.localeCompare(a.id))
    },
    getRecord(memberId: string, id: string) { const member = actor(memberId); return recordView(member, ownRecord(member, id)) },
    createObservation(memberId: string, draft: ObservationDraft, key: string) {
      const member = actor(memberId); const clean = normalize(member, draft)
      const id = command(member, key, 'create', clean, next => {
        const id = `student-observation-${++next.serial}`
        next.observations.push({ id, schoolId: member.schoolId, authorUserId: member.userId, authorMemberId: member.id, revisions: [{ ...clean, version: 1, reason: '최초 작성', state: 'active', createdAt: new Date().toISOString() }] })
        return id
      })
      return recordView(member, ownRecord(member, id))
    },
    reviseObservation(memberId: string, id: string, expectedVersion: number, draft: ObservationDraft, reason: string, key: string) {
      const member = actor(memberId); const clean = normalize(member, draft); const why = requireText(reason, '정정 사유', 300)
      command(member, key, 'revise', { id, expectedVersion, clean, why }, next => {
        const record = ownRecord(member, id, next); const current = last(record.revisions); checkVersion(current.version, expectedVersion)
        if (current.state === 'withdrawn') fail('CONFLICT', '철회한 기록은 되살리지 않습니다. 필요한 사실은 새 기록으로 작성해 주세요.')
        if (current.source) {
          const source = sourceView(ownSource(member, current.source.sourceId));
          if (stale(member, current.source) || source.mapping?.studentId !== clean.studentId || source.mapping.enrollmentId !== clean.enrollmentId || source.current.courseId !== clean.courseId) fail('STALE_SOURCE', '원자료 또는 학생 연결이 바뀌었습니다. 기존 기록을 철회하고 받은함에서 다시 확인·채택해 주세요.')
        }
        record.revisions.push({ ...clean, source: current.source ? copy(current.source) : undefined, version: current.version + 1, reason: why, state: 'active', createdAt: new Date().toISOString() })
        return id
      })
      return recordView(member, ownRecord(member, id))
    },
    withdrawObservation(memberId: string, id: string, expectedVersion: number, reason: string, key: string) {
      const member = actor(memberId); const why = requireText(reason, '철회 사유', 300)
      command(member, key, 'withdraw', { id, expectedVersion, why }, next => {
        const record = ownRecord(member, id, next); const current = last(record.revisions); checkVersion(current.version, expectedVersion)
        if (current.state === 'withdrawn') fail('CONFLICT', '이미 철회한 기록입니다.')
        record.revisions.push({ ...copy(current), version: current.version + 1, reason: why, state: 'withdrawn', createdAt: new Date().toISOString() }); return id
      })
      return recordView(member, ownRecord(member, id))
    },
    receiveActivity(memberId: string, event: ActivityEvent): SourceView {
      const member = actor(memberId)
      if (!event || typeof event !== 'object' || !Number.isInteger(event.revision) || event.revision < 1 || !['upsert', 'withdraw', 'delete'].includes(event.operation) || !validStudentDate(event.occurredAt) || event.occurredAt > basisDate) fail('INVALID_INPUT', '수업 활동 사건의 판·일자·유형을 확인해 주세요.')
      const clean: ActivityEvent = { eventId: requireText(event.eventId, '사건 ID', 200), sourceSystem: requireText(event.sourceSystem, '연결 ID', 100), activityId: requireText(event.activityId, '활동 ID', 200), itemId: requireText(event.itemId, '항목 ID', 200), revision: event.revision, operation: event.operation, courseId: requireText(event.courseId, '수업'), occurredAt: event.occurredAt, questionVersion: requireText(event.questionVersion, '질문 버전', 100), question: requireText(event.question, '질문'), answer: typeof event.answer === 'string' && event.answer.length <= 8000 ? event.answer : fail('INVALID_INPUT', '활동 답변을 확인해 주세요.'), alias: requireText(event.alias, '활동 별명', 100) }
      courseFor(member, clean.courseId, clean.occurredAt)
      const id = command(member, `${clean.sourceSystem}:${clean.eventId}`, 'activity', clean, next => {
        let source = next.sources.find(item => item.schoolId === member.schoolId && item.ownerUserId === member.userId && last(item.revisions).sourceSystem === clean.sourceSystem && last(item.revisions).activityId === clean.activityId && last(item.revisions).itemId === clean.itemId)
        if (source) {
          const current = last(source.revisions)
          if (current.operation === 'delete') fail('DELETED_SOURCE', '삭제 처리한 원자료입니다. 새 사건으로 자동 재생성하지 않습니다.')
          if (clean.revision <= current.revision) fail('STALE_SOURCE', '같거나 오래된 원자료 판입니다. 변경 내용을 확인해 주세요.')
          if (current.courseId !== clean.courseId || current.occurredAt !== clean.occurredAt) fail('INVALID_INPUT', '같은 원자료를 다른 수업·활동일로 옮길 수 없습니다.')
        } else {
          if (clean.operation !== 'upsert') fail('NOT_FOUND', '정정할 기존 원자료가 없습니다.')
          source = { id: `student-source-${++next.serial}`, schoolId: member.schoolId, ownerUserId: member.userId, revisions: [], mappings: [] }; next.sources.push(source)
        }
        source.revisions.push({ ...clean, receivedAt: new Date().toISOString() }); return source.id
      })
      return sourceView(ownSource(member, id))
    },
    listActivities(memberId: string) { const member = actor(memberId); return state.sources.filter(item => item.schoolId === member.schoolId && item.ownerUserId === member.userId).map(sourceView) },
    confirmMapping(memberId: string, sourceId: string, sourceRevision: number, studentId: string, enrollmentId: string, expectedMappingRevision: number, key: string) {
      const member = actor(memberId)
      command(member, key, 'mapping', { sourceId, sourceRevision, studentId, enrollmentId, expectedMappingRevision }, next => {
        const source = ownSource(member, sourceId, next); const current = last(source.revisions)
        if (current.operation !== 'upsert' || current.revision !== sourceRevision) fail('STALE_SOURCE', '활동 원자료가 바뀌었거나 철회되었습니다.')
        if ((last(source.mappings)?.revision ?? 0) !== expectedMappingRevision) fail('CONFLICT', '다른 화면에서 학생 연결을 변경했습니다.')
        studentFor(member, { studentId, enrollmentId, courseId: current.courseId, observedAt: current.occurredAt })
        const previous = last(source.mappings)
        if (previous?.sourceRevision === sourceRevision && previous.studentId === studentId && previous.enrollmentId === enrollmentId) return sourceId
        source.mappings.push({ studentId, enrollmentId, sourceRevision, revision: expectedMappingRevision + 1 }); return sourceId
      })
      return sourceView(ownSource(member, sourceId))
    },
    adoptActivity(memberId: string, sourceId: string, sourceRevision: number, mappingRevision: number, content: string, confirmed: boolean, key: string) {
      const member = actor(memberId); const fact = requireText(content, '교사가 확인한 관찰 내용')
      if (confirmed !== true) fail('INVALID_INPUT', '활동 답변을 직접 검토하고 확인해 주세요.')
      const id = command(member, key, 'adopt', { sourceId, sourceRevision, mappingRevision, fact, confirmed }, next => {
        const source = ownSource(member, sourceId, next); const current = last(source.revisions); const mapping = last(source.mappings)
        if (current.operation !== 'upsert' || current.revision !== sourceRevision || mapping?.sourceRevision !== current.revision || mapping.revision !== mappingRevision) fail('STALE_SOURCE', '원자료 또는 학생 연결이 달라졌습니다. 다시 확인해 주세요.')
        const clean = normalize(member, { studentId: mapping.studentId, enrollmentId: mapping.enrollmentId, courseId: current.courseId, observedAt: current.occurredAt, activity: `수업 활동 · ${current.activityId}`, content: fact, confirmed: true })
        const duplicate = next.observations.find(item => item.schoolId === member.schoolId && item.authorUserId === member.userId && last(item.revisions).state === 'active' && last(item.revisions).source?.sourceId === sourceId)
        if (duplicate) fail('CONFLICT', '이미 채택한 기록이 있습니다. 원자료 정정 시 기존 기록을 먼저 철회한 뒤 다시 채택해 주세요.')
        const id = `student-observation-${++next.serial}`
        next.observations.push({ id, schoolId: member.schoolId, authorUserId: member.userId, authorMemberId: member.id, revisions: [{ ...clean, source: { sourceId, sourceRevision, mappingRevision }, version: 1, reason: '원자료와 학생 연결 확인 후 채택', state: 'active', createdAt: new Date().toISOString() }] }); return id
      })
      return recordView(member, ownRecord(member, id))
    },
    exportEvidence(memberId: string) {
      const member = actor(memberId)
      const records = state.observations.filter(item => item.schoolId === member.schoolId && item.authorUserId === member.userId && last(item.revisions).state === 'active')
      if (records.some(item => stale(member, last(item.revisions).source))) fail('STALE_SOURCE', '원자료가 바뀐 기록이 있습니다. 철회·재확인 후 다시 내보내 주세요.')
      const lines = ['합성 자료 · 나의 관찰 근거 목록', '생기부 AI 초안이나 공식 입력 결과가 아닙니다.', `학교 범위: ${member.schoolId} / 기준일: ${basisDate}`, `본인 유효 기록: ${records.length}건`, '']
      for (const item of records) {
        const current = last(item.revisions)
        const student = state.students.find(row => row.id === current.studentId && row.schoolId === member.schoolId)
        lines.push(`[${item.id}@v${current.version}] ${current.observedAt} / ${student?.name ?? '학생 확인 필요'}`, `불변 학생 ID: ${current.studentId}`, `활동: ${current.activity}`, `확인한 사실: ${current.content}`, current.source ? `원자료: ${current.source.sourceId}@${current.source.sourceRevision} / 학생 연결 판 ${current.source.mappingRevision}` : '출처: 작성 교사가 직접 확인한 관찰', '')
      }
      return lines.join('\n')
    },
  }
}
export type StudentStore = ReturnType<typeof createStudentStore>
