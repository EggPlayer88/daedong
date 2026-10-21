// 검색은 사용자 요청으로 한 쪽씩 읽는다. 반복 조회·무제한 목록 수집을 하지 않는다.
export const SEARCH_LIMITS = Object.freeze({
  queryChars: 200,
  pagesPerSource: 20,
  itemsPerSource: 4000,
  concurrentSources: 3,
  pageItems: 200,
  cursorChars: 6000,
})
