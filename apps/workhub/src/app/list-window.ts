// 표시할 카드 수만 제한한다. 저장소 조회 범위와 전체 집계는 호출부의 계약을 따른다.
export const LIST_PAGE_SIZE = 20
export interface ListWindowInfo { page: number; pages: number; total: number; start: number; end: number; size: number }
export function listWindow<T>(input: readonly T[] | null | undefined, requestedPage = 0, requestedSize = LIST_PAGE_SIZE): ListWindowInfo & { items: T[] } {
  const rows = Array.isArray(input) ? input : []
  const size = Number.isSafeInteger(requestedSize) && requestedSize > 0 ? requestedSize : LIST_PAGE_SIZE
  const pages = Math.max(1, Math.ceil(rows.length / size))
  const page = Math.min(pages - 1, Math.max(0, Number.isSafeInteger(requestedPage) ? requestedPage : 0))
  const offset = page * size
  return { items: rows.slice(offset, offset + size), page, pages, total: rows.length, start: rows.length ? offset + 1 : 0, end: Math.min(offset + size, rows.length), size }
}
