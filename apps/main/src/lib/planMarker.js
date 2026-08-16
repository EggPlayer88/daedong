// PLAN_READY 마커 프로토콜 파서.
//
// chat.js 의 시스템 프롬프트가 AI 에게 지시하는 형식:
//   ===PLAN_READY===
//   { ...JSON... }
//   ===END===
//
// 이 파싱이 조용히 실패하면 "확인 카드가 안 뜨는" 증상으로만 드러나므로
// 화면 코드와 분리해 단위 테스트 대상으로 둔다.

export const MARK_START = '===PLAN_READY==='
export const MARK_END = '===END==='

/**
 * @returns {{ text: string, json: object|null, raw: string|null, broken?: boolean }}
 *   text   — 마커 앞의 일반 대화 텍스트 (채팅에 표시)
 *   json   — 파싱 성공한 확정 필드
 *   broken — 마커는 있는데 JSON 파싱에 실패 (재요청 신호)
 */
export function splitPlan(reply) {
  const src = typeof reply === 'string' ? reply : ''
  const i = src.indexOf(MARK_START)
  if (i === -1) return { text: src.trim(), json: null, raw: null }

  const after = src.slice(i + MARK_START.length)
  const j = after.indexOf(MARK_END)
  let raw = (j === -1 ? after : after.slice(0, j)).trim()
  const text = src.slice(0, i).trim()

  // AI 가 습관적으로 감싸는 코드펜스를 걷어낸다 (```json … ```)
  const fence = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/)
  if (fence) raw = fence[1].trim()

  if (!raw) return { text, json: null, raw, broken: true }

  try {
    const json = JSON.parse(raw)
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
      return { text, json: null, raw, broken: true }
    }
    return { text, json, raw }
  } catch {
    return { text, json: null, raw, broken: true }
  }
}
