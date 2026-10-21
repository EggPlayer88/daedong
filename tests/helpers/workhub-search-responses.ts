import type { Membership } from '../../apps/workhub/src/contracts'

// 목록 RPC의 합성 응답만 제공한다. 실제 계정·파일·유료 AI를 사용하지 않는다.
export function createSearchResponses(member: Membership, date = '2026-10-21') {
  const schoolId = member.schoolId, otherId = 'search-other-teacher', at = `${date}T00:00:00.000Z`
  const scoped = (contractVersion: string) => ({ contractVersion, schoolId, memberId: member.id, ownerUserId: member.userId })
  const p4 = (contract: string, data: unknown) => ({ contract, schoolId, memberId: member.id, data })
  const file = (data: unknown) => ({ contractVersion: 1, schoolId, memberId: member.id, userId: member.userId, ok: true, data })
  const collection = { id: 'search-collection', schoolId, managerMemberId: member.id, title: '통합검색 수합', instructions: '통합검색 제출 안내', dueDate: date, status: 'published', version: 1, publishedAt: at, reviewMode: 'none', reviewerMemberId: '', textLabel: '확인 내용', textRequired: true, numberLabel: '', numberRequired: false, units: [{ label: '합성 제출 단위', responsibleMemberId: member.id, contributorMemberIds: [] }] }
  const document = { id: 'search-document', schoolId, ownerMemberId: member.id, version: 3, latestVersion: 3, status: 'draft', updatedAt: at, canEdit: true, origin: null, title: '통합검색 문서', kind: 'general', body: '통합검색 문서 본문', visibility: 'private', sources: [], basisDate: date, studentContext: null }
  const knowledge = { id: 'search-knowledge', schoolId, authorMemberId: member.id, version: 4, status: 'published', updatedAt: at, title: '통합검색 학교 지침', body: '통합검색 학교 자료 원문', kind: 'school_guide', locator: '업무 지침 3쪽', effectiveFrom: date, effectiveThrough: '' }
  const cooperation = { id: 'search-cooperation', schoolId, version: 1, senderMemberId: otherId, recipientMemberId: member.id, senderName: '합성 동료', recipientName: member.name || '합성 교사', title: '통합검색 협업', description: '통합검색 협업 내용', dueDate: date, status: 'requested', createdAt: at, updatedAt: at, taskLink: null }
  const thread = { id: 'search-thread', schoolId, kind: 'direct', title: '통합검색 대화', participants: [{ memberId: member.id, schoolId, name: member.name || '합성 교사', department: '', version: 1 }, { memberId: otherId, schoolId, name: '합성 동료', department: '교무부', version: 1 }], version: 2, latestSequence: 2, readSequence: 0, unreadCount: 1, updatedAt: at, canSend: true }
  const course = { id: 'search-course', schoolId, version: 1, label: '통합검색 국어 수업', termId: 'search-term', subjectId: 'search-subject', assignmentId: 'search-assignment', validFrom: date, validThrough: '2026-12-31', canRecord: true, canCounsel: false, canManageRoster: false }
  function respond(name: string, args: Record<string, unknown>) {
    if (args.p_member_id !== member.id) throw new Error('합성 소속 범위가 다릅니다.')
    if (name === 'workhub_collection_list') return { contractVersion: 1, schoolId, memberId: member.id, data: { items: [collection], nextCursor: null } }
    if (name === 'workhub_document_list') return p4('documents.v1', { items: args.p_archived ? [] : [document], nextCursor: null, canShare: true })
    if (name === 'workhub_knowledge_list') return p4('knowledge.v1', { items: [knowledge], nextCursor: null, canManage: true })
    if (name === 'workhub_cooperation_list') return { ...scoped('cooperation.v1'), ok: true, items: (args.p_filter as { box: string }).box === 'received' ? [cooperation] : [], nextCursor: null }
    if (name === 'workhub_message_threads') return file({ items: [thread], nextCursor: null })
    if (name === 'workhub_teaching_catalog') return { ...scoped('teaching.v1'), courses: [course], terms: [{ id: 'search-term', schoolId, version: 1, label: '2026 2학기', firstDay: date, lastDay: '2026-12-31' }], subjects: [{ id: 'search-subject', label: '국어' }], approvedTeachers: [], canManageCourses: false }
    throw new Error(`목록 검색에서 허용하지 않은 합성 호출: ${name}`)
  }
  return { collection, document, knowledge, cooperation, thread, course, respond }
}
