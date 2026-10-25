// 서버가 현재 로그인 사용자에게 반환한 메신저 시범 허용만 읽는다. 회원 역할을 바꾸지 않는다.
export function parseMessagingPilot(value, profile, userId, now = Date.now()) {
  if (!profile || profile.id !== userId || profile.role !== 'teacher' || profile.is_active !== true) return null
  if (!value || value.contract !== 'messaging.pilot.v1' || value.userId !== userId || value.allowed !== true) return null
  if (Object.keys(value).sort().join(',') !== ['allowed','contract','expiresAt','memberId','revision','schoolId','userId'].sort().join(',')) return null
  if (![value.schoolId, value.memberId].every(id => typeof id === 'string' && id.length > 0 && id.length <= 200)) return null
  if (!Number.isSafeInteger(value.revision) || value.revision < 1 || typeof value.expiresAt !== 'string') return null
  const expires = Date.parse(value.expiresAt)
  if (!Number.isFinite(expires) || expires <= now) return null
  return { ...value }
}

export function hasMessagingPilot(profile, access, now = Date.now()) {
  return Boolean(parseMessagingPilot(access, profile, profile?.id, now))
}
