// 기간 업무의 메뉴 표시만 저장한다. 기존 평가계획서 API와 권한은 바꾸지 않는다.
export const SEASONAL_WORK = Object.freeze({
  id: 'assessment-plan',
  title: '평가계획서 제출',
  modules: ['doc-ai', 'submissions'],
})
export function parseSeasonalStatus(value) {
  if (
    !value ||
    value.contract !== 'site.seasonal.v1' ||
    value.feature !== SEASONAL_WORK.id ||
    typeof value.enabled !== 'boolean' ||
    !Number.isSafeInteger(value.version) ||
    value.version < 1 ||
    typeof value.canManage !== 'boolean' ||
    (value.updatedAt !== null &&
      (typeof value.updatedAt !== 'string' || !Number.isFinite(Date.parse(value.updatedAt))))
  )
    throw new Error('메뉴 설정 응답을 확인하지 못했습니다.')
  return { ...value }
}
export function createSeasonalService(client, { timeoutMs = 10000 } = {}) {
  async function call(name, args) {
    let timer
    try {
      const result = await Promise.race([
        client.rpc(name, args),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('설정 결과를 확인하지 못했습니다.')), timeoutMs)
        }),
      ])
      if (result.error) {
        const code =
          result.error.code === 'PGRST202'
            ? 'NOT_INSTALLED'
            : ['FORBIDDEN', 'CONFLICT', 'INVALID_INPUT', 'IDEMPOTENCY_CONFLICT'].includes(
                  result.error.message,
                )
              ? result.error.message
              : 'UNKNOWN'
        throw Object.assign(
          new Error(
            code === 'NOT_INSTALLED'
              ? '기간 업무 설정 SQL 설치가 필요합니다.'
              : code === 'CONFLICT'
                ? '다른 관리자가 설정을 변경했습니다. 최신 상태를 확인해 주세요.'
                : code === 'FORBIDDEN'
                  ? '현재 계정으로 메뉴 설정을 변경할 수 없습니다.'
                  : '설정 결과를 확인하지 못했습니다.',
          ),
          { code },
        )
      }
      return parseSeasonalStatus(result.data)
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    read: () => call('site_seasonal_status', {}),
    save: (command) =>
      call('site_seasonal_set', {
        p_feature: SEASONAL_WORK.id,
        p_enabled: command.enabled,
        p_expected_version: command.version,
        p_request_key: command.key,
      }),
  }
}
