import scopes from '../../../workhub/src/participation/scopes.json' with { type: 'json' }

// 허용 목록과 의존 범위는 SQL 생성기와 같은 자산을 사용한다.
export function validParticipantScopes(value) {
  return Array.isArray(value) && value.length > 0 && new Set(value).size === value.length &&
    value.every(id => scopes.some(scope => scope.id === id && scope.requires.every(required => value.includes(required))))
}
export function parseWorkhubParticipant(value, profile, userId, now = Date.now()) {
  if (!profile || profile.id !== userId || profile.role !== 'teacher' || profile.is_active !== true) return null
  if (!value || value.contract !== 'workhub.participant.v1' || value.allowed !== true || value.userId !== userId) return null
  if (Object.keys(value).sort().join(',') !== ['allowed','contract','expiresAt','memberId','revision','schoolId','scopes','userId'].sort().join(',')) return null
  if (![value.schoolId,value.memberId].every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id))) return null
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !validParticipantScopes(value.scopes)) return null
  if (typeof value.expiresAt !== 'string' || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= now) return null
  return { ...value, scopes: [...value.scopes] }
}
export const hasWorkhubParticipant = (profile, value, now = Date.now()) => Boolean(parseWorkhubParticipant(value, profile, profile?.id, now))
