import type { Membership } from '../contracts'
import type { ConnectionContext } from '../connection/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import type { CollectionServer } from '../collections/contracts'
import { collectionDraftTargetOptions } from '../collections/unit-inputs'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { collectionUnitLimit } from '../workflows/entry-guide'
import { createSupabaseMessagingServer } from '../messaging/supabase-messaging'
import type { DirectDraftCommand } from '../assistant/draft-commands'

export async function findDraftPeople(kind: DirectDraftCommand['kind'], query: string, signal: AbortSignal,
    connection: SupabaseConnection, collections: CollectionServer, member: Membership, context: ConnectionContext) {
  signal.throwIfAborted()
  if (kind === 'messageDraft') {
    const server = createSupabaseMessagingServer(connection)
    const ready = await server.readiness(member.id)
    if (!ready.available || !ready.limits) throw new Error('메시지 작성 권한을 확인해 주세요.')
    signal.throwIfAborted()
    const page = await server.recipients(member.id, query)
    signal.throwIfAborted()
    const items = page.items.map(person => {
      const ambiguous = page.nextCursor || page.items.some(other => other.memberId !== person.memberId && other.name === person.name)
      const detail = [person.department, ambiguous ? '소속 번호 ' + person.memberId : ''].filter(Boolean).join(' · ')
      return { memberId: person.memberId, displayName: person.name, detail, recipient: person }
    })
    return { query, items, hasMore: Boolean(page.nextCursor), limit: ready.limits.recipients }
  }
  const ready = await collections.readiness(member.id)
  if (!ready.available || !ready.policy) throw new Error('수합 작성 권한을 확인해 주세요.')
  hwpxCollectionPolicy(ready.policy)
  signal.throwIfAborted()
  await collections.list(member.id)
  signal.throwIfAborted()
  const membersById = new Map(context.memberships.map(person => [person.id, person]))
  const departments = context.schoolLabels[member.schoolId]?.departmentIds ?? []
  const options = collectionDraftTargetOptions(context.memberships, member, context.basisDate)
  const items = options.filter(person => person.label.includes(query)).map(person => {
    const source = membersById.get(person.id)
    const displayName = source?.name.trim() ?? person.label
    const details = departments.filter(dept => source?.departmentIds.includes(dept.id)).map(dept => dept.name)
    if (person.label !== displayName) details.push('소속 번호 ' + person.id)
    return { memberId: person.id, displayName, detail: details.join(' · ') }
  })
  return { query, items, hasMore: false, limit: collectionUnitLimit }
}
