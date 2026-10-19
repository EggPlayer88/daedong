import type { TeachingRelation, RelationsSnapshot } from './relations-contracts'

export type RelationStatus = 'active' | 'scheduled' | 'ended' | 'cancelled'
export type RelationStatusFilter = 'all' | RelationStatus
export const RELATION_STATUS_LABELS: Record<RelationStatusFilter, string> = {
  all: '전체', active: '현재 유효', scheduled: '시작 예정', ended: '종료', cancelled: '시작 전 취소',
}

// 날짜 양 끝을 포함하는 기존 계약을 따른다. 화면에서 종료일·변경 권한을 다시 계산하지 않는다.
export function relationStatus(relation: TeachingRelation, basisDate: string): RelationStatus {
  if (relation.effectiveThrough === null) return 'cancelled'
  if (relation.effectiveThrough < basisDate) return 'ended'
  if (relation.validFrom > basisDate) return 'scheduled'
  return 'active'
}

function matches(name: string, query: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko-KR').trim().replace(/\s+/gu, ' ')
  const value = normalize(name)
  return normalize(query).split(' ').every(term => value.includes(term))
}

export function filterAssignments(rows: readonly TeachingRelation[], basisDate: string, query: string, status: RelationStatusFilter): TeachingRelation[] {
  return rows.filter(row => matches(row.label, query) && (status === 'all' || relationStatus(row, basisDate) === status))
}

export function filterRelationStudents(rows: readonly RelationsSnapshot['students'][number][], basisDate: string, query: string, status: RelationStatusFilter): RelationsSnapshot['students'] {
  // 학생 목록의 상태 필터는 선택 수업의 수강 기준이다. 학교 학적은 별도 상태로 표시한다.
  return rows.filter(row => matches(row.name, query) && (status === 'all' || relationStatus(row.membership, basisDate) === status))
}
