import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'

// 실제 연결 셸·학교 구성·자료 게시 파서를 사용하며 계정과 모든 RPC 원장은 메모리 합성이다.
const w = window as any, clone = structuredClone, date = '2026-11-12', stamp = date + 'T03:00:00.000Z'
const self = { ...fixtureData.memberships[0], id: 'member-one', userId: 'user-one', name: '가상 관리자', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31' }
const context = { schools: fixtureData.schools, memberships: [self], basisDate: date, schoolLabels: Object.fromEntries(fixtureData.schools.map(s => [s.id, relationLabels])) }
const configuration = (year: number) => ({ draftId: 'year-' + year, schoolName: '합성 중학교', schoolCode: 'synthetic-middle', schoolType: 'middle', gradeCount: '3', schoolYear: String(year),
  startsOn: `${year}-03-01`, lastDay: `${year + 1}-02-28`, terms: [{ id: 'term-one-' + year, termNo: '1', name: '1학기', startsOn: `${year}-03-01`, lastDay: `${year}-08-12` },
    { id: 'term-two-' + year, termNo: '2', name: '2학기', startsOn: `${year}-08-13`, lastDay: `${year + 1}-02-28` }],
  departments: [{ id: 'dept-' + year, name: '합성 부서' }], classes: [{ id: 'class-' + year, grade: '1', classNo: '1', name: '1학년 1반', kind: 'regular' }] })
const configurations = new Map([2026, 2027].map(year => [year, configuration(year)])), subjects = [{ id: 'subject-one', name: '도덕' }]
let version = 3
const sources: any[] = [], receipts = new Map<string, any>()
const qa = w.qa = { seedSources() { sources.push(...['검색 대상 학교 자료', '별도 학교 자료'].map((title, index) => ({ id: 'source-' + (index + 1), schoolId: self.schoolId, authorMemberId: self.id, title, kind: 'school_guide', body: '결과 목록에 복제하지 않을 원문', locator: '제3조', effectiveFrom: date, effectiveThrough: '', version: 1, status: 'draft', updatedAt: stamp }))) }, calls: [], writes: 0, configurationWrites: 0, knowledgeWrites: 0, unknown: '', sources, configurations }
const services: any = {
  getSession: async () => ({ user: { id: self.userId } }),
  fetchMyProfile: async () => ({ id: self.userId, name: self.name, email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: true }),
  onAuthStateChange() { return () => {} }, async signOut() {}, async signInWithGoogle() {},
  async rpc(name: string, args: any) {
    qa.calls.push(clone({ name, args }))
    const ok = (data: any) => ({ data: clone(data), error: null })
    const school = (data: any) => ok({ kind: 'workhub-school-admin', schemaVersion: 1, schoolId: self.schoolId, memberId: self.id, data })
    const knowledge = (data: any) => ok({ contract: 'knowledge.v1', schoolId: self.schoolId, memberId: self.id, data })
    if (name === 'workhub_context') return ok(context)
    if (name === 'workhub_calendar_list' || name === 'workhub_task_list') return ok([])
    if (name === 'workhub_school_admin_readiness') return school({ available: true })
    if (name === 'workhub_school_admin_get') return school({ version, asOfDate: date, availableYears: [...configurations.keys()], configuration: configurations.get(args.p_school_year ?? 2026), subjects,
      memberships: [{ id: self.id, name: self.name, status: 'active', startsOn: self.validFrom, lastDay: self.validThrough, version: 1 }], assignments: [], capabilities: { configuration: true, memberships: true, assignments: true } })
    if (name === 'workhub_school_admin_mutate') {
      const c = args.p_command, key = args.p_request_key
      if (receipts.has(key)) return school(receipts.get(key))
      if (c.kind !== 'save_configuration' || c.expectedVersion !== version) throw Error('합성 구성 명령 충돌')
      const year = Number(c.configuration.schoolYear); configurations.set(year, clone(c.configuration)); subjects.splice(0, subjects.length, ...clone(c.subjects)); version++
      const receipt = { requestKey: key, kind: c.kind, version, schoolYear: year, recordedAt: stamp }; receipts.set(key, receipt); qa.writes++; qa.configurationWrites++
      if (qa.unknown === 'configuration') { qa.unknown = ''; throw Error('합성 구성 접수 응답 유실') }
      return school(receipt)
    }
    if (name === 'workhub_knowledge_list') return knowledge({ items: sources.filter(row => !args.p_query || (row.title + row.body).includes(args.p_query)), nextCursor: null, canManage: true })
    if (name === 'workhub_knowledge_get') {
      const row = sources.find(row => row.id === args.p_source_id && row.version === args.p_source_version)
      return row ? knowledge({ source: row, isCurrent: true, canManage: true }) : { data: null, error: { message: 'NOT_FOUND' } }
    }
    if (name === 'workhub_knowledge_original_access') return ok({ contract: 'knowledge-import.v1', schoolId: self.schoolId, memberId: self.id, data: { available: false } })
    if (name === 'workhub_knowledge_history') { const row = sources.find(row => row.id === args.p_source_id)!; return knowledge({ sourceId: row.id, authorMemberId: row.authorMemberId,
      items: [{ version: row.version, status: row.status, title: row.title, recordedAt: row.updatedAt, isCurrent: true }], nextBeforeVersion: null, canManage: true }) }
    if (name === 'workhub_knowledge_mutate') {
      const c = args.p_command, key = args.p_request_key
      if (receipts.has(key)) return knowledge(receipts.get(key))
      let row = sources.find(row => row.id === c.id)
      if (c.kind === 'create') { row = { ...clone(c.input), id: 'source-' + (sources.length + 1), schoolId: self.schoolId, authorMemberId: self.id, version: 1, status: 'draft', updatedAt: stamp }; sources.push(row) }
      else {
        if (!row || row.version !== c.expectedVersion) throw Error('합성 자료 원본 충돌')
        row.version++; row.updatedAt = stamp
        if (c.kind === 'update') Object.assign(row, clone(c.input)); else row.status = c.kind === 'publish' ? 'published' : 'retired'
      }
      const receipt = { id: row.id, version: row.version, requestKey: key, recordedAt: stamp }; receipts.set(key, receipt); qa.writes++; qa.knowledgeWrites++
      if (qa.unknown === 'knowledge') { qa.unknown = ''; throw Error('합성 자료 접수 응답 유실') }
      return knowledge(receipt)
    }
    return { data: null, error: { message: 'NOT_READY' } }
  },
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={self.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)} />)
