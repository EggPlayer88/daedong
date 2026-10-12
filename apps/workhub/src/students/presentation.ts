import type { ObservationView } from './contracts'
import { validStudentDate, type StudentStore } from './store'

export type RosterStudent = ReturnType<StudentStore['listStudents']>[number]
export type RecordKind = 'all' | 'direct' | 'adopted'
export type RecordState = 'all' | 'ready' | 'review' | 'withdrawn'
export interface RecordFilters {
  scope: 'selected' | 'all'; studentId?: string; courseId?: string
  from: string; until: string; kind: RecordKind; state: RecordState
}

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR').trim().replace(/\s+/g, ' ')
export function searchRoster(input: unknown, query: string): RosterStudent[] {
  if (!Array.isArray(input)) return []
  const tokens = normalize(typeof query === 'string' ? query : '').split(' ').filter(Boolean)
  return input.filter((student): student is RosterStudent => {
    if (!student || typeof student.id !== 'string' || typeof student.name !== 'string' || !Number.isInteger(student.number)) return false
    const text = normalize(`${student.number}번 ${student.name}`)
    return tokens.every(token => text.includes(token))
  })
}

export function observationRows(input: unknown): ObservationView[] {
  if (!Array.isArray(input)) return []
  return input.filter((record): record is ObservationView => Boolean(record && typeof record.id === 'string' && typeof record.studentName === 'string'
    && typeof record.needsReview === 'boolean'
    && record.current && validStudentDate(record.current.observedAt) && ['active', 'withdrawn'].includes(record.current.state)
    && Number.isInteger(record.current.version) && record.current.version > 0
    && typeof record.current.studentId === 'string' && typeof record.current.courseId === 'string'
    && typeof record.current.activity === 'string' && typeof record.current.content === 'string' && typeof record.current.createdAt === 'string'
    && Array.isArray(record.revisions) && record.revisions.length > 0 && record.revisions.every((revision: ObservationView['current']) => revision
      && Number.isInteger(revision.version) && revision.version > 0 && ['active', 'withdrawn'].includes(revision.state)
      && typeof revision.content === 'string' && typeof revision.reason === 'string')))
}

export function readObservationRows(input: unknown): ObservationView[] {
  const rows = observationRows(input)
  if (!Array.isArray(input) || rows.length !== input.length) throw new Error('관찰 기록을 확인하지 못했습니다. 화면을 다시 열어 주세요.')
  return rows
}

export function evidenceSignature(input: unknown): string {
  return JSON.stringify(observationRows(input).map(record => [record.id, record.current.version, record.needsReview]))
}

export function recordStatus(record: ObservationView): Exclude<RecordState, 'all'> {
  return record.current.state === 'withdrawn' ? 'withdrawn' : record.needsReview ? 'review' : 'ready'
}

// 입력 순서와 원본 배열을 바꾸지 않고, 화면에 허용된 본인 기록만 다시 정리한다.
export function studentRecordWorkspace(input: unknown, filters: RecordFilters) {
  const invalidDate = (filters.from && !validStudentDate(filters.from)) || (filters.until && !validStudentDate(filters.until))
  const error = invalidDate ? '조회 기간에 실제 날짜를 입력해 주세요.' : filters.from && filters.until && filters.from > filters.until ? '조회 시작일은 종료일보다 늦을 수 없습니다.' : ''
  const counts = { all: 0, ready: 0, review: 0, withdrawn: 0 }
  if (error) return { records: [] as ObservationView[], counts, error }
  const rows = observationRows(input).filter(record => {
    const current = record.current
    if (filters.scope === 'selected' && (!filters.studentId || !filters.courseId || current.studentId !== filters.studentId || current.courseId !== filters.courseId)) return false
    if ((filters.from && current.observedAt < filters.from) || (filters.until && current.observedAt > filters.until)) return false
    if (filters.kind === 'direct' && current.source) return false
    if (filters.kind === 'adopted' && !current.source) return false
    return true
  })
  for (const row of rows) { counts.all++; counts[recordStatus(row)]++ }
  return {
    records: rows.filter(row => filters.state === 'all' || recordStatus(row) === filters.state)
      .sort((a, b) => b.current.observedAt.localeCompare(a.current.observedAt) || b.current.createdAt.localeCompare(a.current.createdAt) || a.id.localeCompare(b.id)),
    counts, error,
  }
}
