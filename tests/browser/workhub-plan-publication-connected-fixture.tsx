import './reset-fixture-checkpoint'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { ConnectedWorkspace } from '../../apps/workhub/src/app/ConnectedWorkspace'
import { createSupabaseConnection } from '../../apps/workhub/src/connection/supabase-connection'
import { fixtureData, relationLabels } from '../../apps/workhub/src/preview/fixtures'
import { canonical } from '../../apps/workhub/src/services/service-values'

// 실제 연결 셸·복합 계획·시간표 어댑터를 사용하고 학교 접속만 메모리 RPC로 대체한다.
const w = window as any, clone = structuredClone, date = '2026-11-12', stamp = date + 'T03:00:00.000Z'
const self = { ...fixtureData.memberships[0], id: 'member-one', userId: 'user-one', name: '가상 관리자', active: true, validFrom: '2026-01-01', validThrough: '2027-12-31' }
const context = { schools: fixtureData.schools, memberships: [self], basisDate: date, schoolLabels: Object.fromEntries(fixtureData.schools.map(s => [s.id, relationLabels])) }
const hash = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical(value)))), b => b.toString(16).padStart(2, '0')).join('')
const lesson = (id: string) => ({ id, version: 1, label: '목록에 복제하지 않을 수업 ' + id, time: { startsAt: '2026-11-13T00:00:00.000Z', endsAt: '2026-11-13T00:45:00.000Z' },
  teachers: [{ id: self.id, name: self.name }], groupNames: ['합성 학급'], roomNames: [], state: 'scheduled', canRequest: false, allowedTargets: [] })
const snapshot = { asOf: stamp, timeZone: 'Asia/Seoul', from: '2026-11-09', until: '2026-11-23', canPublish: true, canRequest: false,
  drafts: [{ id: 'draft-one', version: 2, title: '검토할 시간표 초안' }], lessons: [lesson('existing')], requests: [], publications: [] }
const receipts = new Map<string, any>()
let manifest: any, pages: any[], notify = () => {}, denied = false
w.qa = { calls: [], writes: 0, rejections: 0, unknown: false, badReceipt: false, reject: false, hold: false, release: () => {}, snapshot,
  deny() { denied = true; notify() }, setDate(value: string) { context.basisDate = value; notify() } }
const services: any = {
  getSession: async () => ({ user: { id: self.userId } }),
  fetchMyProfile: async () => ({ id: self.userId, name: self.name, email: 'synthetic@example.invalid', role: 'superadmin', extra_permissions: [], department_id: null, is_active: !denied }),
  onAuthStateChange(cb: any) { notify = () => cb({ user: { id: self.userId } }); return () => {} }, async signOut() {}, async signInWithGoogle() {},
  async rpc(name: string, args: any) {
    w.qa.calls.push(clone({ name, args }))
    const ok = (data: any) => ({ data: clone(data), error: null })
    const envelope = (contract: string, data: any) => ok({ contract, schoolId: self.schoolId, memberId: self.id, data })
    const failure = (contract: string, code: string) => ok({ contract, schoolId: self.schoolId, memberId: self.id, error: { code } })
    if (name === 'workhub_context') return ok(context)
    if (name === 'workhub_calendar_list' || name === 'workhub_task_list') return ok([])
    if (name === 'workhub_timetable_operations_readiness') return envelope('timetable-operations.v1', { available: true })
    if (name === 'workhub_timetable_operations_get') return envelope('timetable-operations.v1', { ...snapshot, from: args.p_from, until: args.p_until })
    if (name.endsWith('_references')) return envelope('timetable-operations.next.v1', { asOf: snapshot.asOf, from: args.p_from, until: args.p_until,
      lessons: snapshot.lessons.map(row => ({ lessonId: row.id, version: row.version, groups: [{ id: 'group-one', name: '합성 학급' }], rooms: [] })) })
    if (name === 'workhub_timetable_operations_publish_preview') return envelope('timetable-operations.v1', {
      previewId: 'preview', previewHash: 'a'.repeat(64), createdAt: stamp, expiresAt: '2026-11-12T03:10:00.000Z', input: args.p_input, complete: true,
      changes: [{ before: null, after: lesson('published-one') }, { before: null, after: lesson('published-two') }], participants: [{ id: self.id, name: self.name }],
      blockers: [], excludedDays: [], preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' },
    })
    if (name.endsWith('_publish_manifest')) {
      pages = [[{ before: null, after: lesson('published-one') }, { before: null, after: lesson('published-two') }, { before: null, after: lesson('published-three') }]]
      const unsigned = { previewId: 'manifest-preview', previewHash: 'b'.repeat(64), input: args.p_input, timeZone: 'Asia/Seoul', createdAt: stamp,
        expiresAt: '2026-11-12T03:10:00.000Z', basisFingerprint: 'c'.repeat(64), totalChanges: 3, pageSize: 200, pageHashes: await Promise.all(pages.map(hash)),
        blockerCount: 0, complete: true, preserved: { pastRecords: true, outsideRange: true, existingChanges: 'retained' } }
      manifest = { ...unsigned, manifestHash: await hash(unsigned) }; return envelope('timetable-operations.next.v1', manifest)
    }
    if (name.endsWith('_publish_page')) return envelope('timetable-operations.next.v1', { previewId: manifest.previewId, manifestHash: manifest.manifestHash,
      index: args.p_index, pageHash: manifest.pageHashes[args.p_index], changes: pages[args.p_index] })
    if (name === 'workhub_timetable_operations_execute' || name === 'workhub_timetable_publication_execute') {
      const contract = name === 'workhub_timetable_operations_execute' ? 'timetable-operations.v1' : 'timetable-publication.v1', c = args.p_command, key = args.p_request_key
      if (!receipts.has(key)) {
        if (args.p_recover_only) return failure(contract, 'NOT_FOUND')
        if (w.qa.reject) { w.qa.rejections++; return failure(contract, 'CONFLICT') }
        w.qa.writes++
        receipts.set(key, { requestKey: key, commandHash: await hash(c), kind: c.kind, entityId: 'publication-' + w.qa.writes,
          version: c.kind === 'publish' ? 1 : 4, status: 'published', recordedAt: stamp,
          ...(c.kind === 'publish' ? { changedLessons: [{ id: 'published-one', version: 1 }, { id: 'published-two', version: 1 }] }
            : { manifestHash: c.manifestHash, basisFingerprint: c.basisFingerprint, changedCount: c.totalChanges }) })
      }
      if (w.qa.hold) await new Promise<void>(resolve => { w.qa.release = resolve })
      if (w.qa.unknown) { w.qa.unknown = false; throw Error('합성 응답 유실') }
      return envelope(contract, w.qa.badReceipt ? { ...receipts.get(key), requestKey: 'wrong-request-key' } : receipts.get(key))
    }
    return { data: null, error: { message: 'NOT_READY' } }
  },
}
createRoot(document.getElementById('root')!).render(<ConnectedWorkspace expectedUserId={self.userId} legacyHomeHref="/" connection={createSupabaseConnection(services)} />)
