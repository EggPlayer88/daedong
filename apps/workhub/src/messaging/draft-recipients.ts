import type { Membership } from '../contracts'
import { MessagingError, type MessagingServer, type Recipient } from './contracts'
import { recipient } from './validation'

export function parseDraftRecipients(value: unknown, member: Membership): Recipient[] | null {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > 500) return null
  try {
    const scope = { schoolId: member.schoolId, memberId: member.id, userId: member.userId }
    const choices = value.map(person => recipient(person, scope))
    const ids = new Set(choices.map(person => person.memberId))
    return ids.has(member.id) || ids.size !== choices.length ? null : choices
  } catch {
    return null
  }
}

/** 대화에서 선택한 스냅샷과 동일한 수신자만 가져온다. 일부만 남아도 임의로 대상 범위를 좁히지 않는다. */
export async function currentDraftRecipients(
  server: Pick<MessagingServer, 'recipients'>,
  memberId: string,
  choices: readonly Recipient[],
  current: () => boolean,
): Promise<boolean> {
  const pending = new Map(choices.map(person => [person.memberId, person]))
  const query = choices.length === 1 ? choices[0].name : ''
  const seen = new Set<string>()
  let cursor: string | undefined
  while (pending.size) {
    if (!current()) throw new MessagingError('CANCELLED')
    const page = await server.recipients(memberId, query, cursor)
    for (const person of page.items) {
      const selected = pending.get(person.memberId)
      if (!selected) continue
      if (person.schoolId !== selected.schoolId || person.version !== selected.version ||
          person.name !== selected.name || person.department !== selected.department) return false
      pending.delete(person.memberId)
    }
    if (!pending.size) return true
    if (!page.nextCursor) return false
    if (seen.has(page.nextCursor)) throw new MessagingError('INVALID_RESPONSE')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return true
}
