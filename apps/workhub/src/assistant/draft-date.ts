// 모든 날짜 입력은 학교 기준일을 사용한다. 빠진 연도·월은 현재 값이며 다음 기간으로 몰래 넘기지 않는다.
const absoluteDate = '(?:(?<![\\d/.-])\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}(?![\\d/.-])|(?<!\\d)(?:(?:\\d{4}년|올해|내년|내후년|작년)\\s*)?\\d{1,2}월\\s*\\d{1,2}일(?!\\d)|(?<![\\d/.-])\\d{1,2}/\\d{1,2}(?![\\d/.-])|(?<![\\p{L}\\d])\\d{1,2}일(?!\\d))'
const weekdaySuffix = '(?:\\s*(?:[월화수목금토일]요일|\\([월화수목금토일](?:요일)?\\)))?'
export const draftDateWords = new RegExp(absoluteDate + weekdaySuffix + '|(?:이번\\s*주\\s*|다음\\s*주\\s*)?[월화수목금토일]요일|오늘|내일|모레', 'gu')
const weekdayIndex = '일월화수목금토'

function validDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return null
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export function resolveDraftDate(token: string, basisDate: string): string | null {
  const base = validDate(basisDate)
  if (!base) return null
  let text = token.trim()
  const suffix = /\s*(?:([월화수목금토일])요일|\(([월화수목금토일])(?:요일)?\))$/.exec(text)
  const relativeWeekday = /^(?:(이번|다음)\s*주\s*)?([월화수목금토일])요일$/.exec(text)
  let expectedWeekday: number | undefined
  // 단독 요일과 '다음 주 요일'은 부가 표시가 아니라 날짜 표현 자체다.
  if (suffix && !relativeWeekday) {
    expectedWeekday = weekdayIndex.indexOf(suffix[1] ?? suffix[2])
    text = text.slice(0, suffix.index).trim()
  }
  const localized = /^(?:(\d{4})년\s*|(올해|내년|내후년|작년)\s*)?(\d{1,2})월\s*(\d{1,2})일$/.exec(text)
  const numeric = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(text)
  const monthDay = /^(\d{1,2})\/(\d{1,2})$/.exec(text)
  const dayOnly = /^(\d{1,2})일$/.exec(text)
  const relative: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 }
  let resolved: Date | null = null
  if (localized || numeric || monthDay || dayOnly) {
    const offsets: Record<string, number> = { 올해: 0, 내년: 1, 내후년: 2, 작년: -1 }
    const year = Number(numeric?.[1] ?? localized?.[1] ?? base.getUTCFullYear() + (offsets[localized?.[2] ?? ''] ?? 0))
    const month = Number(numeric?.[2] ?? localized?.[3] ?? monthDay?.[1] ?? base.getUTCMonth() + 1)
    const day = Number(numeric?.[3] ?? localized?.[4] ?? monthDay?.[2] ?? dayOnly?.[1])
    resolved = validDate(`${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`)
  } else if (relative[text] !== undefined || relativeWeekday) {
    const weekday = relativeWeekday ? weekdayIndex.indexOf(relativeWeekday[2]) : 0
    const current = base.getUTCDay()
    const offset = relative[text] ?? (relativeWeekday![1]
      ? (weekday + 6) % 7 - (current + 6) % 7 + (relativeWeekday![1] === '다음' ? 7 : 0)
      : (weekday - current + 7) % 7)
    base.setUTCDate(base.getUTCDate() + offset)
    resolved = base
  }
  if (!resolved || expectedWeekday !== undefined && resolved.getUTCDay() !== expectedWeekday) return null
  return resolved.toISOString().slice(0, 10)
}
