import type { SearchItem, SearchKind } from './contracts'

const normalize = (value: string) => value.normalize('NFC').toLocaleLowerCase('ko').trim().replace(/\s+/gu, ' ')
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
    const haystack = normalize(`${item.title} ${item.description} ${item.meta}`)
    return words.every(word => haystack.includes(word))
  })
  const rank = (item: SearchItem) => !phrase ? 0 : normalize(item.title) === phrase ? 0 : normalize(item.title).startsWith(phrase) ? 1 : normalize(item.title).includes(phrase) ? 2 : 3
  return matches.sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title, 'ko') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
}
