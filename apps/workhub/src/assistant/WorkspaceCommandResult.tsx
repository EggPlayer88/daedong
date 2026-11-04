import { searchKindLabels, type SearchItem } from '../search/contracts'
import type { AssistantWorkspaceSearchResult } from './workspace-model'
import type { TaskChangeCommand } from './task-change-command'

export function WorkspaceCommandResult({ prompt, query, result, disabled, onOpen, taskChange, onDismiss }: {
  prompt: string
  query: string
  result: AssistantWorkspaceSearchResult
  disabled: boolean
  onOpen: (item: SearchItem) => void
  taskChange?: TaskChangeCommand
  onDismiss?: () => void
}) {
  const items = taskChange ? result.items.filter(item => item.kind === 'task' &&
    Number.isSafeInteger(item.version) && item.version! > 0) : result.items
  return (
    <section className="assistant-workspace-result" aria-label={taskChange ? '변경할 내 할 일' : '대화에서 찾은 자료'}>
      <p className="assistant-command-question">{prompt}</p>
      <div className="assistant-workspace-result-heading">
        <h3>{taskChange ? '변경할 내 할 일 선택' : query + ' 검색 결과'}</h3><span>추가 AI 호출 없음</span>
      </div>
      {taskChange && <p>업무를 선택하면 변경 전후를 확인할 수 있습니다.</p>}
      {items.length ? <ul className="assistant-resource-list">
        {items.map((item) => <li key={`${item.kind}:${item.id}:${item.version ?? ''}`}>
          <button type="button" disabled={disabled} onClick={() => onOpen(item)}>
            <span className="assistant-resource-kind">{searchKindLabels[item.kind]}</span>
            <strong>{item.title}</strong>
            {item.description && <span className="assistant-resource-description">{item.description}</span>}
            {item.meta && <span className="assistant-resource-meta">{item.meta}</span>}
            {taskChange && <span className="assistant-resource-meta">{item.date ? '기한 ' + item.date : '기한 없음'} · v{item.version}
              {items.some(other => other !== item && other.title === item.title) &&
                ' · 번호 ' + (items.some(other => other !== item && other.id.endsWith(item.id.slice(-6))) ? item.id : item.id.slice(-6))}
            </span>}
            <span className="assistant-resource-open">{taskChange ? '변경 내용 보기' : '열기 →'}</span>
          </button>
        </li>)}
      </ul> : <p>{taskChange ? '이번 조회 범위에서 변경할 개인 할 일을 찾지 못했습니다.' : '이번 조회 범위에서 일치하는 자료를 찾지 못했습니다.'}</p>}
      {result.hasMore && <p className="assistant-hint">일부 결과를 먼저 표시했습니다. 검색어를 좁히거나 해당 메뉴에서 더 확인해 주세요.</p>}
      {result.coverage.length > 0 && <details className="assistant-result-coverage">
        <summary>조회 범위</summary>
        <ul>{result.coverage.map((text, index) => <li key={index}>{text}</li>)}</ul>
      </details>}
      {taskChange && <button className="assistant-quiet" type="button" disabled={disabled} onClick={onDismiss}>할 일 선택 취소</button>}
    </section>
  )
}
