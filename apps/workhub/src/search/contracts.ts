export type SearchKind = 'calendar' | 'task' | 'collection'

// 검색은 현재 화면이 읽을 수 있는 목록의 표시 모델이며 별도 자료 원장을 만들지 않는다.
export interface SearchItem {
  id: string
  kind: SearchKind
  title: string
  description: string
  meta: string
  // 장소·기간처럼 원본에 있는 값만 넣는다. 상태/공개 범위 안내는 meta 표시 전용이다.
  searchValues?: readonly string[]
  date?: string
  unitId?: string
}
export interface SearchSource {
  kind: SearchKind
  label: string
  load: () => Promise<SearchItem[]>
}

export interface ResourceOpenRequest { key: string; id: string }
