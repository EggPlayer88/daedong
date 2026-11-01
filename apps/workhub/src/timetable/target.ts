import { exact, isoDate, ServiceError, validateLocalInput } from '../services/service-values'
import policy from './target-policy.json'

export const TARGET_CONTRACT = 'timetable.target.v1'
export interface TargetTerm { id: string; schoolYear: number; label: string; firstDay: string; lastDay: string; state: 'planning' | 'current'; hasBasis: boolean; hasPreparationDraft: boolean }
export interface TargetSnapshot { termId: string | null; automaticTermId: string | null; selectedTermId: string | null; version: number; terms: TargetTerm[] }
export interface TargetCommand { termId: string | null; expectedVersion: number }
export interface TargetReceipt { requestKey: string; termId: string | null; version: number; effectiveTermId: string | null }
export interface TargetServer {
  get(memberId: string): Promise<TargetSnapshot>
  execute(memberId: string, input: TargetCommand, key: string): Promise<TargetReceipt>
  recover(memberId: string, input: TargetCommand, key: string): Promise<TargetReceipt>
  resend(memberId: string, input: TargetCommand, key: string): Promise<TargetReceipt>
}
const fail = (): never => { throw new ServiceError('INVALID_RESPONSE') }
const id = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) ? value : fail()
const nullableId = (value: unknown) => value === null ? null : id(value)
const integer = (value: unknown, min = 0, max = policy.maxVersion): number => Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max ? value as number : fail()
const bool = (value: unknown): boolean => typeof value === 'boolean' ? value : fail()

export function targetSnapshot(raw: unknown): TargetSnapshot {
  try {
    exact(raw, ['termId', 'automaticTermId', 'selectedTermId', 'version', 'terms'])
    const termId = nullableId(raw.termId), automaticTermId = nullableId(raw.automaticTermId), selectedTermId = nullableId(raw.selectedTermId), version = integer(raw.version)
    if (!Array.isArray(raw.terms) || raw.terms.length > policy.maxTerms || (version === 0 && selectedTermId !== null)) fail()
    const terms: TargetTerm[] = (raw.terms as unknown[]).map((row: unknown) => {
      exact(row, ['id', 'schoolYear', 'label', 'firstDay', 'lastDay', 'state', 'hasBasis', 'hasPreparationDraft'])
      const firstDay = isoDate(row.firstDay), lastDay = isoDate(row.lastDay)
      if (firstDay > lastDay || !['planning', 'current'].includes(String(row.state))) fail()
      if (typeof row.label !== 'string' || !row.label.trim() || Array.from(row.label.trim()).length > policy.maxTermLabel) fail()
      return { id: id(row.id), schoolYear: integer(row.schoolYear, policy.minSchoolYear, policy.maxSchoolYear), label: row.label as string, firstDay, lastDay, state: row.state as TargetTerm['state'], hasBasis: bool(row.hasBasis), hasPreparationDraft: bool(row.hasPreparationDraft) }
    })
    if (new Set(terms.map(row => row.id)).size !== terms.length || terms.some((row, index) => index > 0 && row.firstDay < terms[index - 1].firstDay)) fail()
    if (selectedTermId === null && termId !== automaticTermId) fail()
    if (selectedTermId !== null && terms.some(row => row.id === selectedTermId) && termId !== selectedTermId) fail()
    // 목록은 20개로 제한되므로 선택값이 목록에 없다는 이유만으로 닫힌 학기라고 단정하지 않는다.
    if (termId !== selectedTermId && termId !== automaticTermId) fail()
    return { termId, automaticTermId, selectedTermId, version, terms }
  } catch { return fail() }
}
export function targetCommand(raw: unknown, source?: TargetSnapshot): TargetCommand {
  return validateLocalInput(() => {
    exact(raw, ['termId', 'expectedVersion'])
    const command = { termId: nullableId(raw.termId), expectedVersion: integer(raw.expectedVersion) }
    if (source) {
      if (command.expectedVersion !== source.version) throw new ServiceError('CONFLICT')
      if (command.termId !== null && !source.terms.some(row => row.id === command.termId)) throw new ServiceError('NOT_FOUND')
    }
    return command
  })
}
export function targetReceipt(raw: unknown, command: TargetCommand, key: string, source?: TargetSnapshot): TargetReceipt {
  exact(raw, ['requestKey', 'termId', 'version', 'effectiveTermId'])
  const termId = nullableId(raw.termId), effectiveTermId = nullableId(raw.effectiveTermId), version = integer(raw.version)
  if (raw.requestKey !== key || termId !== command.termId || (termId !== null && effectiveTermId !== termId)) fail()
  // 같은 선택은 판을 올리지 않는다. 복구는 당시 목록 없이 원래 접수증만 확인한다.
  if (version !== command.expectedVersion && version !== command.expectedVersion + 1) fail()
  if (command.expectedVersion === 0 && version !== (termId === null ? 0 : 1)) fail()
  // 선택 학기 삭제의 FK SET NULL은 판을 올리지 않는다. null 복귀의 정상 no-op만 좁게 허용한다.
  const deletedSelectionNoop = source && source.selectedTermId !== null && command.termId === null && version === source.version
  if (source && !deletedSelectionNoop && version !== source.version + (source.selectedTermId === command.termId ? 0 : 1)) fail()
  return { requestKey: key, termId, version, effectiveTermId }
}
export function targetTermLabel(term: TargetTerm): string { return `${term.schoolYear}학년도 ${term.label} (${term.firstDay} ~ ${term.lastDay}) [${term.id}]` }
