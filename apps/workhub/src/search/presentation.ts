import type { SearchItem, SearchKind } from './contracts'

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko').trim().replace(/\s+/gu, ' ')
const compact = (value: string) => value.replace(/\s/gu, '')
export function filterSearchItems(items: readonly SearchItem[], query: string, kind?: SearchKind): SearchItem[] {
  if (!Array.isArray(items)) return []
  const phrase = normalize(typeof query === 'string' ? query : '')
  const words = phrase ? phrase.split(' ') : []
  const seen = new Set<string>()
  const matches = items.filter(item => {
    if (!item || typeof item.id !== 'string' || !item.id || !['calendar', 'task', 'collection'].includes(item.kind)
      || typeof item.title !== 'string' || typeof item.description !== 'string' || typeof item.meta !== 'string') return false
    if (kind && item.kind !== kind) return false
    const key = JSON.stringify([item.kind, item.id, item.unitId ?? ''])
    if (seen.has(key)) return false
    seen.add(key)
    // 표시용 문구(예: 나만 보는 업무)가 모든 결과를 일치시키지 않게 원문만 검사한다.
    const values = [item.title, item.description, typeof item.date === 'string' ? item.date : '',
      ...(Array.isArray(item.searchValues) ? item.searchValues.filter((value: unknown): value is string => typeof value === 'string') : [])]
      .map(normalize)
    return words.every(word => values.some(value => value.includes(word) || compact(value).includes(compact(word))))
  })
  const rank = (item: SearchItem) => {
    const title = compact(normalize(item.title)), query = compact(phrase)
    return !query || title === query ? 0 : title.startsWith(query) ? 1 : title.includes(query) ? 2 : 3
  }
  return matches.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'ko') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}
