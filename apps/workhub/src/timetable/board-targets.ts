// 조회된 이름만 검색하고, 선택값은 검색 결과 밖으로 나가도 같은 ID로 유지한다.
export function filterBoardTargets(rows: [string, string][], query: string, selectedId: string) {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase('ko').split(/\s+/).filter(Boolean)
  const matched = rows.filter(([id, name]) => {
    const source = `${name} ${id}`.normalize('NFKC').toLocaleLowerCase('ko')
    return words.every(word => source.includes(word))
  })
  const matches = new Set(matched.map(([id]) => id))
  return { matches: matched.length, rows: rows.filter(([id]) => matches.has(id) || id === selectedId) }
}
