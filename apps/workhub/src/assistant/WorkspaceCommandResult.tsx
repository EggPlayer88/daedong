import { searchKindLabels, type SearchItem } from '../search/contracts'
import type { AssistantWorkspaceSearchResult } from './workspace-model'

export function WorkspaceCommandResult({ prompt, query, result, disabled, onOpen }: {
  prompt: string
  query: string
  result: AssistantWorkspaceSearchResult
  disabled: boolean
  onOpen: (item: SearchItem) => void
}) {
  return (
    <section className="assistant-workspace-result" aria-label="대화에서 찾은 자료">
      <p className="assistant-command-question">{prompt}</p>
      <div className="assistant-workspace-result-heading">
        <h3>{query} 검색 결과</h3><span>추가 AI 호출 없음</span>
      </div>
      {result.items.length ? <ul className="assistant-resource-list">
        {result.items.map((item) => <li key={`${item.kind}:${item.id}:${item.version ?? ''}`}>
          <button type="button" disabled={disabled} onClick={() => onOpen(item)}>
            <span className="assistant-resource-kind">{searchKindLabels[item.kind]}</span>
            <strong>{item.title}</strong>
            {item.description && <span className="assistant-resource-description">{item.description}</span>}
            {item.meta && <span className="assistant-resource-meta">{item.meta}</span>}
            <span className="assistant-resource-open">열기 →</span>
          </button>
        </li>)}
      </ul> : <p>이번 조회 범위에서 일치하는 자료를 찾지 못했습니다.</p>}
      {result.hasMore && <p className="assistant-hint">일부 결과를 먼저 표시했습니다. 검색어를 좁히거나 해당 메뉴에서 더 확인해 주세요.</p>}
      {result.coverage.length > 0 && <details className="assistant-result-coverage">
        <summary>조회 범위</summary>
        <ul>{result.coverage.map((text, index) => <li key={index}>{text}</li>)}</ul>
      </details>}
    </section>
  )
}
