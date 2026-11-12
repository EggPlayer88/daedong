// AI에는 현재 표시 중인 기간 업무의 기존 주소만 넘긴다. 역할 판정과 라우트는 모듈 표가 맡는다.
const evaluationModules = Object.freeze({ authoring: 'doc-ai', submissions: 'submissions' })

export function buildLegacyEvaluationLinks(modules, seasonal, hrefs) {
  if (seasonal?.state?.enabled !== true || seasonal.loading !== false || seasonal.error) return {}
  const result = {}
  for (const [kind, key] of Object.entries(evaluationModules)) {
    if (!Array.isArray(modules) || !modules.some(module => module?.key === key)) continue
    if (typeof hrefs?.[kind] === 'string' && hrefs[kind].trim()) result[kind] = hrefs[kind]
  }
  return result
}
