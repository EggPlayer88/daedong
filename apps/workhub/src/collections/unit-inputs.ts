import type { Membership } from '../contracts'
import { collectionUnitLimit } from '../workflows/entry-guide'
import type { UnitInput } from '../workflows/types'

export interface CollectionUnitIssue { unitIndex: number | null; field: 'units' | 'label' | 'responsible' | 'contributors' | 'members'; message: string }
export interface CollectionUnitValidation { valid: boolean; issues: CollectionUnitIssue[] }
export interface CollectionUnitMemberOption { id: string; label: string }
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const identifier = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(value)
const validName = (value: unknown): value is string => typeof value === 'string' && !!value.trim() && !/[\x00-\x1f\x7f]/u.test(value)

export function isCollectionUnitInputs(value: unknown): value is UnitInput[] {
  return Array.isArray(value) && Array.from(value).every(unit => record(unit) && typeof unit.label === 'string' && typeof unit.responsibleMemberId === 'string'
    && Array.isArray(unit.contributorMemberIds) && Array.from(unit.contributorMemberIds).every(id => typeof id === 'string'))
}

function roster(members: unknown) {
  if (!Array.isArray(members)) return { options: [] as CollectionUnitMemberOption[], invalid: true }
  const ids = new Map<string, number>()
  for (const member of members) if (record(member) && identifier(member.id)) ids.set(member.id, (ids.get(member.id) ?? 0) + 1)
  let invalid = false
  const available: { id: string; name: string }[] = []
  for (const member of members) {
    if (!record(member) || !identifier(member.id) || !validName(member.name) || typeof member.active !== 'boolean' || ids.get(member.id) !== 1) { invalid = true; continue }
    // 학교와 기준일 필터는 부모가 담당한다. 중단된 소속은 방어적으로 다시 제외한다.
    if (member.active) available.push({ id: member.id, name: member.name.trim() })
  }
  available.sort((a, b) => a.name.localeCompare(b.name, 'ko') || a.id.localeCompare(b.id))
  const counts = new Map<string, number>(), ordinals = new Map<string, number>()
  for (const member of available) counts.set(member.name, (counts.get(member.name) ?? 0) + 1)
  return { invalid, options: available.map(member => {
    const ordinal = (ordinals.get(member.name) ?? 0) + 1; ordinals.set(member.name, ordinal)
    return { id: member.id, label: (counts.get(member.name) ?? 0) > 1 ? `${member.name} · 동명이인 ${ordinal}` : member.name }
  }) }
}

export function collectionUnitMemberOptions(members: unknown): CollectionUnitMemberOption[] { return roster(members).options }

/** 화면에서 저장을 막는 입력 검사다. 학교 권한·검토자 자기검토의 최종 판정은 서버가 한다. */
export function validateCollectionUnitInputs(units: unknown, members: unknown): CollectionUnitValidation {
  const issues: CollectionUnitIssue[] = [], current = roster(members)
  const issue = (unitIndex: number | null, field: CollectionUnitIssue['field'], message: string) => issues.push({ unitIndex, field, message })
  if (current.invalid) issue(null, 'members', '교사 명부를 확인하지 못했습니다. 새로 확인한 뒤 저장해 주세요.')
  if (!isCollectionUnitInputs(units)) { issue(null, 'units', '제출 단위 형식이 올바르지 않습니다. 원본을 다시 확인해 주세요.'); return { valid: false, issues } }
  if (!units.length) issue(null, 'units', '제출할 교사를 선택하거나 공동 제출 단위를 추가해 주세요.')
  if (units.length > collectionUnitLimit) issue(null, 'units', `제출 단위는 최대 ${collectionUnitLimit}개입니다.`)
  const ids = new Set(current.options.map(member => member.id)), labels = new Map<string, number[]>()
  units.forEach((unit, index) => {
    if (!validName(unit.label) || unit.label.length > 100) issue(index, 'label', '제출 단위 이름을 100자 이내로 입력해 주세요.')
    const label = unit.label.trim(), same = labels.get(label) ?? []; same.push(index); labels.set(label, same)
    if (!identifier(unit.responsibleMemberId) || !ids.has(unit.responsibleMemberId)) issue(index, 'responsible', '책임 교사를 현재 명부에서 선택해 주세요. 기존 대상의 소속이 종료되었을 수 있습니다.')
    if (unit.contributorMemberIds.some(id => !identifier(id) || !ids.has(id))) issue(index, 'contributors', '현재 명부에 없는 공동 작성자가 있습니다. 해당 선택을 직접 해제하거나 명부를 다시 확인해 주세요.')
    if (new Set(unit.contributorMemberIds).size !== unit.contributorMemberIds.length) issue(index, 'contributors', '같은 공동 작성자가 중복 선택되어 있습니다. 해당 선택을 해제한 뒤 다시 선택해 주세요.')
    if (new Set([unit.responsibleMemberId, ...unit.contributorMemberIds]).size > collectionUnitLimit || unit.contributorMemberIds.length > collectionUnitLimit) issue(index, 'contributors', `제출 단위의 교사는 최대 ${collectionUnitLimit}명입니다.`)
  })
  for (const [label, indexes] of labels) if (label && indexes.length > 1) for (const index of indexes) issue(index, 'label', `같은 제출 단위 이름이 있습니다: ${label}`)
  return { valid: !issues.length, issues }
}

function uniqueLabel(proposed: string, units: UnitInput[]): string {
  const labels = new Set(units.map(unit => unit.label.trim()))
  let label = proposed.slice(0, 100).trimEnd(), ordinal = 1
  while (labels.has(label)) { const suffix = ` (${++ordinal})`; label = proposed.slice(0, 100 - suffix.length).trimEnd() + suffix }
  return label
}

/** 기존 단위의 이름·책임자·공동 작성자를 변경하지 않고 한 부만 추가한다. */
export function appendPersonalCollectionUnit(units: UnitInput[], members: Membership[], memberId: string, reviewerMemberId = ''): UnitInput[] {
  if (!isCollectionUnitInputs(units) || roster(members).invalid || units.length >= collectionUnitLimit) throw new Error('현재 명부와 제출 단위 개수를 확인해 주세요.')
  const person = collectionUnitMemberOptions(members).find(member => member.id === memberId)
  if (!person || person.id === reviewerMemberId || units.some(unit => unit.responsibleMemberId === person.id)) throw new Error('현재 추가할 수 있는 교사를 선택해 주세요.')
  return [...structuredClone(units), { label: uniqueLabel(person.label, units), responsibleMemberId: person.id, contributorMemberIds: [] }]
}

export function appendSharedCollectionUnit(units: UnitInput[]): UnitInput[] {
  if (!isCollectionUnitInputs(units) || units.length >= collectionUnitLimit) throw new Error('현재 제출 단위 개수를 확인해 주세요.')
  return [...structuredClone(units), { label: uniqueLabel('공동 제출', units), responsibleMemberId: '', contributorMemberIds: [] }]
}
