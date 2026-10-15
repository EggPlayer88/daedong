import { collectionUnitLimit } from './entry-guide'
import type { UnitInput } from './types'

export interface Recipient { id: string; name: string }
export interface RecipientContext {
  members: unknown; schoolId: string; date: string; units: unknown; reviewerMemberId?: string
}
export interface RecipientRoster { candidates: Recipient[]; skipped: number; error: string }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && value.trim() === value && value.length > 0 && Array.from(value).length <= 200 && !value.includes('\0')
const realDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
const unitArray = (value: unknown): value is UnitInput[] => Array.isArray(value) && value.every(unit => record(unit)
  && typeof unit.label === 'string' && typeof unit.responsibleMemberId === 'string'
  && Array.isArray(unit.contributorMemberIds) && unit.contributorMemberIds.every(id => typeof id === 'string'))

/** 추가 후보만 계산한다. 실제 저장·게시 권한 검사는 기존 store가 담당한다. */
export function collectionRecipients(context: RecipientContext): RecipientRoster {
  const { members, schoolId, date, units, reviewerMemberId } = context
  if (!identifier(schoolId) || !realDate(date) || !Array.isArray(members)) return { candidates: [], skipped: 0, error: '학교와 교사 명부를 다시 확인해 주세요.' }
  if (!unitArray(units)) return { candidates: [], skipped: 0, error: '기존 제출 단위를 확인해 주세요. 일괄 추가하지 않았습니다.' }
  const counts = new Map<string, number>()
  for (const member of members) if (record(member) && identifier(member.id)) counts.set(member.id, (counts.get(member.id) ?? 0) + 1)
  const assigned = new Set(units.map(unit => unit.responsibleMemberId))
  const candidates: Recipient[] = []
  let skipped = 0
  for (const member of members) {
    // 중복 ID는 어느 행이 맞는지 추정하지 않고 모두 제외한다.
    if (!record(member) || !identifier(member.id) || !identifier(member.schoolId) || !identifier(member.userId)
      || typeof member.name !== 'string' || !member.name.trim() || member.name.includes('\0')
      || typeof member.active !== 'boolean' || !realDate(member.validFrom) || !realDate(member.validThrough)
      || member.validFrom > member.validThrough || counts.get(member.id) !== 1) { skipped++; continue }
    if (member.schoolId !== schoolId || !member.active || date < member.validFrom || date > member.validThrough
      || assigned.has(member.id) || member.id === reviewerMemberId) continue
    candidates.push({ id: member.id, name: member.name.trim() })
  }
  candidates.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
  return { candidates, skipped, error: '' }
}

export function filterCollectionRecipients(candidates: readonly Recipient[], query: string): Recipient[] {
  const term = query.trim().normalize('NFC').toLocaleLowerCase('ko')
  return candidates.filter(member => member.name.normalize('NFC').toLocaleLowerCase('ko').includes(term))
}

/** 소속·명부·검토자·기존 책임자가 달라진 경우 남아 있는 선택을 다시 제한한다. */
export function currentRecipientSelection(ids: readonly string[], candidates: readonly Recipient[]): string[] {
  const available = new Set(candidates.map(member => member.id))
  return [...new Set(ids)].filter(id => available.has(id))
}

function uniqueLabel(name: string, labels: Set<string>): string {
  const points = Array.from(name.trim())
  let suffix = '', ordinal = 1
  let label = points.slice(0, 100).join('').trimEnd()
  while (labels.has(label)) {
    suffix = ` (${++ordinal})`
    label = points.slice(0, 100 - Array.from(suffix).length).join('') + suffix
  }
  labels.add(label)
  return label
}

export function appendCollectionRecipients(context: RecipientContext, selectedIds: readonly string[]): { units: UnitInput[]; added: number } {
  const roster = collectionRecipients(context)
  if (roster.error || !unitArray(context.units)) throw new Error(roster.error || '기존 제출 단위를 확인해 주세요.')
  const selected = new Set(currentRecipientSelection(selectedIds, roster.candidates))
  const additions = roster.candidates.filter(member => selected.has(member.id))
  if (context.units.length + additions.length > collectionUnitLimit) throw new Error(`제출 단위는 최대 ${collectionUnitLimit}개입니다. ${Math.max(0, collectionUnitLimit - context.units.length)}명까지 추가할 수 있습니다.`)
  if (!additions.length) throw new Error('현재 추가할 수 있는 교사를 선택해 주세요.')
  // 한도와 현재 후보를 모두 확인한 뒤 복사본에 한 번에 추가한다. 원본 배열은 건드리지 않는다.
  const units = context.units.map(unit => ({ ...unit, contributorMemberIds: [...unit.contributorMemberIds] }))
  const labels = new Set(units.map(unit => unit.label.trim()))
  for (const member of additions) units.push({ label: uniqueLabel(member.name, labels), responsibleMemberId: member.id, contributorMemberIds: [] })
  return { units, added: additions.length }
}
