import { resolveAssistantDueDate } from './task-change-command'

export const draftDateWords = /(?<!\d)(?:(?:\d{4}년|올해|내년|내후년|작년)\s*)?\d{1,2}월\s*\d{1,2}일|(?<!\d)\d{4}[-./]\d{1,2}[-./]\d{1,2}(?!\d)|(?:이번\s*주\s*|다음\s*주\s*)?[월화수목금토일]요일|오늘|내일|모레/g

export function resolveDraftDate(token: string, basisDate: string): string | null {
  const localized = /^(?:(\d{4})년\s*|(올해|내년|내후년|작년)\s*)?(\d{1,2})월\s*(\d{1,2})일$/.exec(token)
  if (!localized) return resolveAssistantDueDate(token, basisDate)
  const offset: Record<string, number> = { 올해: 0, 내년: 1, 내후년: 2, 작년: -1 }
  const year = localized[1] ?? Number(basisDate.slice(0, 4)) + (offset[localized[2]] ?? 0)
  return resolveAssistantDueDate([year, localized[3], localized[4]].join('-'), basisDate)
}
