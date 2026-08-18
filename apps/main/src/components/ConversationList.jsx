// 내 대화 목록 — 이어서 작성 / 새 대화 / 삭제.
//
// 판단은 전부 부모(DocAiPage)가 한다. 이 컴포넌트는 받은 것을 그리기만 한다
// — 목록 화면이 저장 로직을 알면 두 곳에서 상태가 갈라진다.

function fmtWhen(s) {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return d.toLocaleString('ko-KR', {
    ...(sameDay ? {} : { month: '2-digit', day: '2-digit' }),
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function ConversationList({
  rows = [],
  currentId,
  busy,
  error,
  onOpen,
  onNew,
  onDelete,
}) {
  const list = Array.isArray(rows) ? rows : []
  return (
    <aside className="conv-list">
      <div className="conv-head">
        <b>내 대화</b>
        <button type="button" className="btn-plain" onClick={onNew} disabled={busy}>
          + 새 대화
        </button>
      </div>

      {error && <p className="muted small">목록을 불러오지 못했습니다: {error}</p>}

      {list.length === 0 && !error && (
        <p className="muted small">
          저장된 대화가 없습니다. 대화를 시작하면 자동으로 저장됩니다.
        </p>
      )}

      <ul>
        {list.map((c) => (
          <li key={c.id} className={c.id === currentId ? 'conv-item on' : 'conv-item'}>
            <button
              type="button"
              className="conv-open"
              onClick={() => onOpen(c.id)}
              disabled={busy || c.id === currentId}
              title={c.id === currentId ? '지금 보고 있는 대화입니다' : '이어서 작성'}
            >
              <span className="conv-title">{c.title || '새 평가계획'}</span>
              <span className="muted small">
                {[c.subject, Number.isInteger(c.grade) ? `${c.grade}학년` : null]
                  .filter(Boolean)
                  .join(' · ') || '교과 미정'}
                {' · '}
                {fmtWhen(c.updated_at)}
                {c.status === 'completed' ? ' · 생성 완료' : ''}
              </span>
            </button>
            <button
              type="button"
              className="btn-plain conv-del"
              onClick={() => onDelete(c)}
              disabled={busy}
              title="이 대화 삭제"
            >
              삭제
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
