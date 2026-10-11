import { ContractError, type CalendarEvent, type Membership, type PreviewData, type SaveCommand } from '../contracts'
import { activeAt, canEdit, canRead, normalizeDraft } from '../domain'

// 이 어댑터는 개발용 계약 시뮬레이션이다. 신뢰할 수 있는 인증·권한 계층이 아니다.
export function createMemoryAdapter(seed: PreviewData, latency = 250) {
  let data = structuredClone(seed)
  let serial = 0
  let failQuery = false
  let failSave = false
  let empty = false
  let generation = 0
  const receipts = new Map<string, { payload: string; result: CalendarEvent }>()
  const pause = async () => {
    const started = generation
    await new Promise(resolve => setTimeout(resolve, latency))
    if (started !== generation) throw new ContractError('CANCELLED', '합성 자료가 초기화되어 이전 요청을 취소했습니다.')
  }
  function memberFor(id: string): Membership {
    const member = data.memberships.find(item => item.id === id)
    if (!member || !activeAt(member, data.basisDate)) throw new ContractError('INACTIVE_MEMBERSHIP', '종료된 학교 소속입니다. 이 학교의 조회와 저장을 진행할 수 없습니다.')
    return member
  }
  function findVisible(id: string, member: Membership): CalendarEvent {
    const event = data.events.find(item => item.id === id)
    if (!event || !canRead(event, member, data.basisDate)) throw new ContractError('NOT_FOUND', '일정이 없거나 현재 소속으로 열람할 수 없습니다.')
    return event
  }
  return {
    info: () => structuredClone({ schools: data.schools, memberships: data.memberships, basisDate: data.basisDate }),
    async list(memberId: string) {
      await pause()
      const member = memberFor(memberId)
      if (failQuery) { failQuery = false; throw new ContractError('QUERY_FAILED', '일정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.') }
      return structuredClone(empty ? [] : data.events.filter(event => canRead(event, member, data.basisDate)))
    },
    async get(memberId: string, id: string) {
      await pause()
      return structuredClone(findVisible(id, memberFor(memberId)))
    },
    async save(memberId: string, command: SaveCommand): Promise<CalendarEvent> {
      await pause()
      const member = memberFor(memberId)
      if (!command || typeof command !== 'object' || typeof command.idempotencyKey !== 'string' || (command.id !== undefined && (typeof command.id !== 'string' || !command.id || !Number.isInteger(command.expectedVersion) || command.expectedVersion! < 1))) throw new ContractError('INVALID_INPUT', '저장 요청 형식을 확인해 주세요.')
      const draft = normalizeDraft(command.draft, member, data.memberships)
      if (!command.idempotencyKey.trim()) throw new ContractError('INVALID_INPUT', '저장 요청 번호가 필요합니다.')
      const receiptKey = `${member.schoolId}:${member.id}:${command.idempotencyKey}`
      const payload = JSON.stringify({ id: command.id, expectedVersion: command.expectedVersion, draft })
      const receipt = receipts.get(receiptKey)
      if (receipt) {
        if (receipt.payload !== payload) throw new ContractError('IDEMPOTENCY_CONFLICT', '같은 요청 번호에 다른 입력이 포함되었습니다. 새 저장 요청으로 다시 시도해 주세요.')
        // 이전 성공 응답도 현재의 열람 계약을 통과해야 돌려준다.
        findVisible(receipt.result.id, member)
        return structuredClone(receipt.result)
      }
      let original: CalendarEvent | undefined
      if (command.id) {
        original = findVisible(command.id, member)
        if (!canEdit(original, member, data.basisDate)) throw new ContractError('FORBIDDEN', '이 일정을 수정할 담당 권한이 없습니다.')
        if (original.version !== command.expectedVersion) throw new ContractError('CONFLICT', '다른 사람이 먼저 수정했습니다. 내 입력은 보존했습니다.', structuredClone(original))
        if (original.authorMemberId !== member.id && draft.visibility === 'private') throw new ContractError('FORBIDDEN', '다른 사람이 등록한 일정을 나만 보기로 바꿀 수 없습니다.')
      }
      if (failSave) { failSave = false; throw new ContractError('SAVE_FAILED', '저장하지 못했습니다. 입력을 유지했습니다. 다시 저장해 주세요.') }
      const result: CalendarEvent = { ...draft, id: original?.id ?? `preview-created-${++serial}`, schoolId: member.schoolId, authorMemberId: original?.authorMemberId ?? member.id, version: (original?.version ?? 0) + 1, updatedAt: new Date().toISOString() }
      if (original) data.events[data.events.findIndex(event => event.id === original.id)] = result
      else data.events.push(result)
      receipts.set(receiptKey, { payload, result: structuredClone(result) })
      return structuredClone(result)
    },
    failNextQuery() { failQuery = true },
    failNextSave() { failSave = true },
    setEmpty(value: boolean) { empty = value },
    endMembership(memberId: string) { const member = data.memberships.find(item => item.id === memberId); if (member) member.active = false },
    simulateConcurrentEdit(memberId: string, eventId: string) {
      const member = memberFor(memberId)
      const event = findVisible(eventId, member)
      if (!canEdit(event, member, data.basisDate)) throw new ContractError('FORBIDDEN', '수정 가능한 일정에서만 충돌을 시험할 수 있습니다.')
      event.title = `${event.title.replace(/ \(다른 교사 수정\)$/, '')} (다른 교사 수정)`
      event.version += 1
      event.updatedAt = new Date().toISOString()
      return structuredClone(event)
    },
    reset() { generation += 1; data = structuredClone(seed); serial = 0; failQuery = false; failSave = false; empty = false; receipts.clear() },
  }
}
