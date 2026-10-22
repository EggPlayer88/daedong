export const SEARCH_KINDS = ['menu', 'calendar', 'task', 'collection', 'document', 'knowledge', 'cooperation', 'message', 'course'] as const
export type SearchKind = typeof SEARCH_KINDS[number]
export const searchKindLabels: Record<SearchKind, string> = {
  menu: '메뉴', calendar: '학교 일정', task: '내 업무', collection: '자료 수합', document: '문서함',
  knowledge: '학교 자료', cooperation: '협업 요청', message: '대화', course: '수업',
}

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
  // 문서·학교 자료는 검색 당시 판을 열며 최신 판으로 조용히 바꾸지 않는다.
  version?: number
  locator?: string
}
export interface SearchLoadOptions { query?: string; cursor?: string | null; signal?: AbortSignal }
export interface SearchPage {
  items: SearchItem[]
  nextCursor: string | null
  // 서버 오류 원문 대신 각 자료원이 정한 조회 범위를 표시한다.
  coverage: string
  scanned?: number
}
export interface SearchSource {
  kind: SearchKind
  label: string
  load: (options?: SearchLoadOptions) => Promise<SearchItem[] | SearchPage>
}

export interface ResourceOpenRequest { key: string; id: string }
