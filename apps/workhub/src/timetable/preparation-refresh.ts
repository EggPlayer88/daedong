import { ServiceError } from '../services/scoped-rpc'
import { preparationDraft, type PreparationDraft, type PreparationSource } from './preparation'

export interface PreparationSession {
  sourceRevision: number; sourceFingerprint: string; termId: string
  draftId: string | null; revision: number | null; draft: PreparationDraft; dirty: boolean
  reviewedSource?: PreparationSource
}
export interface PreparationSourceChange { label: string; before: string; after: string }
export interface PreparationRefreshReview { allowed: boolean; reason: string; changes: PreparationSourceChange[]; previousKnown: boolean }

/** 시수·일과를 자동 이관하지 않고, 최신 공식 관계를 비교한 뒤 사용자가 채택하도록 한다. */
export function reviewPreparationRefresh(session: PreparationSession, source: PreparationSource): PreparationRefreshReview {
  const old = session.reviewedSource
  const changes: PreparationSourceChange[] = []
  const add = (label: string, before: string, after: string) => { if (before !== after) changes.push({ label, before, after }) }
  const resourceText = (value: PreparationSource['resources'][number]) => `${value.label} [${value.id}] · ${value.kind} · 동시 ${value.capacity}`
  const courseText = (value: PreparationSource['courses'][number], basis: PreparationSource) => `${value.label} [${value.id}] · 기준 시수 ${value.requiredPeriods ?? '직접 입력'} · ${value.resourceIds.map(id => { const row = basis.resources.find(item => item.id === id); return row ? `${row.label} [${id}]` : `[${id}]` }).join(', ') || '연결 없음'}`
  add('학교급·학기', old ? `${old.schoolLevel} · ${old.termLabel} · ${old.firstDay} ~ ${old.lastDay}` : '이전 상세 없음', `${source.schoolLevel} · ${source.termLabel} · ${source.firstDay} ~ ${source.lastDay}`)
  for (const id of new Set([...(old?.resources.map(row => row.id) ?? []), ...source.resources.map(row => row.id)])) {
    const before = old?.resources.find(row => row.id === id), after = source.resources.find(row => row.id === id)
    add(`교사·학급·공간 [${id}]`, before ? resourceText(before) : old ? '없음' : '이전 상세 없음', after ? resourceText(after) : '없음')
  }
  for (const id of new Set([...(old?.courses.map(row => row.id) ?? []), ...source.courses.map(row => row.id)])) {
    const before = old?.courses.find(row => row.id === id), after = source.courses.find(row => row.id === id)
    add(`수업 [${id}]`, before && old ? courseText(before, old) : old ? '없음' : '이전 상세 없음', after ? courseText(after, source) : '없음')
  }
  add('기준판 생성 제한', old ? old.unsupportedFeatures.join(' · ') || '없음' : '이전 상세 없음', source.unsupportedFeatures.join(' · ') || '없음')
  const result = (allowed: boolean, reason: string) => ({ allowed, reason, changes, previousKnown: Boolean(old) })
  if (!source.canEdit) return result(false, '현재 계정에 준비 자료 편집 권한이 없습니다. 입력은 보관됩니다.')
  if (session.termId !== source.termId || old && (old.schoolId !== source.schoolId || old.termId !== source.termId)) return result(false, '학기 또는 학교가 달라 이전 시수·일과를 자동 연결할 수 없습니다. 입력은 보관됩니다.')
  if (session.draftId !== (source.savedDraft?.id ?? null) || session.revision !== (source.savedDraft?.revision ?? null)) return result(false, '서버의 준비 초안도 변경되었습니다. 다른 사람의 초안을 덮어쓰지 않도록 보관한 입력의 재사용을 중지했습니다.')
  try { preparationDraft(session.draft, source) } catch { return result(false, '공식 수업 목록이나 기준 시수가 달라 현재 입력을 그대로 연결할 수 없습니다. 입력을 확인한 뒤 현재 자료로 다시 시작해 주세요.') }
  return result(true, '작성한 시수·일과·수업 활동은 그대로 두고, 아래의 현재 교사·학급·공간 관계를 사용합니다. 채택 후 초안을 저장하고 기준판을 다시 확인해야 합니다.')
}

export function adoptPreparationSource(session: PreparationSession, source: PreparationSource): PreparationSession {
  if (!reviewPreparationRefresh(session, source).allowed) throw new ServiceError('CONFLICT')
  return { ...structuredClone(session), sourceRevision: source.sourceRevision, sourceFingerprint: source.sourceFingerprint, termId: source.termId, reviewedSource: structuredClone(source), dirty: true }
}

/** 조회만으로 기준을 바꾸거나 원래 입력을 잃지 않는다. */
export function retainPreparationSession(session: PreparationSession | undefined, source: PreparationSource): boolean {
  return Boolean(session && (session.dirty || session.sourceFingerprint !== source.sourceFingerprint || session.sourceRevision !== source.sourceRevision || session.termId !== source.termId))
}
