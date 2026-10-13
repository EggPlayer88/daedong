import type { ListWindowInfo } from './list-window'
import styles from './list-pagination.css?inline'

export function ListPagination({ label, window: page, onPageChange, disabled = false }: { label: string; window: ListWindowInfo; onPageChange: (page: number) => void; disabled?: boolean }) {
  if (page.pages <= 1) return null
  return <nav className="list-pagination" aria-label={label}>
    <style>{styles}</style>
    <p role="status" aria-atomic="true">총 {page.total.toLocaleString()}개 중 {page.start.toLocaleString()}–{page.end.toLocaleString()}개 표시 · {page.page + 1} / {page.pages}쪽</p>
    <div className="list-pagination-actions">
      <button type="button" disabled={disabled || page.page === 0} onClick={() => onPageChange(0)}>처음</button>
      <button type="button" disabled={disabled || page.page === 0} onClick={() => onPageChange(page.page - 1)}>이전</button>
      <button type="button" disabled={disabled || page.page >= page.pages - 1} onClick={() => onPageChange(page.page + 1)}>다음</button>
      <button type="button" disabled={disabled || page.page >= page.pages - 1} onClick={() => onPageChange(page.pages - 1)}>마지막</button>
    </div>
  </nav>
}
