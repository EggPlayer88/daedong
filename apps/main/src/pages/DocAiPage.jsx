import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { splitPlan } from '../lib/planMarker.js'
// 필드 라벨의 진실의 원천은 manifest 하나 (P5). 서버(chat/generate)와 같은 파일을 읽는다.
import manifest from '../../api/doc-ai/_assets/template-manifest.json'

// 대화 시작용 첫 사용자 메시지 (API 는 첫 메시지가 user 여야 한다)
const OPENING = '평가계획서 작성을 시작하려고 합니다.'

function labelOf(key) {
  const f = manifest.fields.find((x) => x.key === key)
  if (f) return f.label
  if (manifest.repeating_group?.key === key) return manifest.repeating_group.label
  return key
}

export default function DocAiPage() {
  const { session } = useAuth()
  const token = session?.access_token

  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(null) // 확인 카드에 띄울 확정 JSON
  const [notice, setNotice] = useState(null) // 양식 준비 중 등 안내
  const bottomRef = useRef(null)
  const started = useRef(false)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy, plan])

  // 첫 진입 시 대화 시작
  useEffect(() => {
    if (started.current || !token) return
    started.current = true
    sendHistory([{ role: 'user', content: OPENING }])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  /**
   * 보낼 대화 전체(history)를 명시적으로 받는다.
   * ⚠ messages 상태를 읽어서 조립하지 않는다 — 자동 재시도처럼 한 턴 안에서
   *   연속 호출할 때 stale closure 로 직전 메시지가 누락된다.
   * retry: JSON 형식 오류 자동 재요청은 1회만 (무한 루프 방지)
   */
  async function sendHistory(history, { retry = 0 } = {}) {
    setMessages(history)
    setBusy(true)
    setError(null)

    try {
      const r = await fetch('/api/doc-ai/chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ messages: history }),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`)

      const reply = data.reply || ''
      const withReply = [...history, { role: 'assistant', content: reply }]
      setMessages(withReply)

      const { text: visible, json, broken } = splitPlan(reply)

      if (json) {
        setPlan(json)
      } else if (broken && retry < 1) {
        setError('내용 정리 중 형식 오류가 생겼습니다. 다시 확정하는 중입니다…')
        await sendHistory(
          [
            ...withReply,
            {
              role: 'user',
              content:
                '방금 JSON 형식이 깨졌습니다. ===PLAN_READY=== 블록만 다시 정확히 출력해 주세요.',
            },
          ],
          { retry: retry + 1 }
        )
        return
      } else if (broken) {
        setError('형식 오류가 반복됩니다. "이대로 생성해줘" 라고 한 번 더 말씀해 주세요.')
      } else if (!visible) {
        setError('응답이 비어 있습니다. 다시 시도해 주세요.')
      }
    } catch (e) {
      setError(e.message) // 보낸 메시지는 남겨두어 그대로 재시도할 수 있게 한다
    } finally {
      setBusy(false)
    }
  }

  function onSubmit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setPlan(null)
    setNotice(null)
    setInput('')
    sendHistory([...messages, { role: 'user', content: text }])
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const r = await fetch('/api/doc-ai/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ fields: plan }),
      })
      const data = await r.json()

      if (r.status === 409 && data.error === 'TEMPLATE_MISSING') {
        setNotice(
          '양식 준비 중입니다 — 내용은 확정됐으니 양식 등록 후 다시 생성해 주세요.'
        )
        return
      }
      if (!r.ok) throw new Error(data.error || `생성 실패 (${r.status})`)

      // base64 → Blob 다운로드 (한글 파일명 헤더 인코딩 회피)
      const bin = atob(data.base64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const url = URL.createObjectURL(
        new Blob([bytes], { type: 'application/haansofthwpx' })
      )
      const a = document.createElement('a')
      a.href = url
      a.download = data.filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setNotice(`다운로드했습니다: ${data.filename}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  // 화면에 보일 대화만 (PLAN_READY 블록은 카드로 대체)
  const visible = messages.map((m) =>
    m.role === 'assistant' ? { ...m, content: splitPlan(m.content).text } : m
  )

  return (
    <div className="page docai">
      <h2>문서 작성 AI — {manifest.doc_title}</h2>
      <p className="muted small">
        대화로 내용을 확정하면 통일된 양식의 한글 파일(.hwpx)을 만들어 드립니다.
        대화는 저장되지 않습니다 — 새로고침하면 처음부터 시작합니다.
      </p>

      <div className="chat">
        {visible.map((m, i) =>
          m.content ? (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          ) : null
        )}
        {busy && <div className="msg assistant muted">…</div>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {plan && (
        <div className="card plan">
          <h3>이 내용으로 만듭니다</h3>
          <table className="table">
            <tbody>
              {manifest.fields.map((f) =>
                plan[f.key] === undefined || plan[f.key] === '' ? null : (
                  <tr key={f.key}>
                    <th>{f.label}</th>
                    <td>{String(plan[f.key])}</td>
                  </tr>
                )
              )}
            </tbody>
          </table>

          {Array.isArray(plan[manifest.repeating_group?.key]) && (
            <>
              <h4>{labelOf(manifest.repeating_group.key)}</h4>
              <table className="table">
                <thead>
                  <tr>
                    {manifest.repeating_group.item_fields.map((it) => (
                      <th key={it.key}>{it.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {plan[manifest.repeating_group.key].map((row, i) => (
                    <tr key={i}>
                      {manifest.repeating_group.item_fields.map((it) => (
                        <td key={it.key}>{String(row[it.key] ?? '')}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          <div className="row">
            <button className="btn-google" onClick={generate} disabled={busy}>
              한글파일 생성
            </button>
            <button className="btn-plain" onClick={() => setPlan(null)} disabled={busy}>
              대화로 계속 수정
            </button>
          </div>
        </div>
      )}

      <form className="composer" onSubmit={onSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? '응답을 기다리는 중…' : '메시지를 입력하세요'}
          disabled={busy}
        />
        <button className="btn-google" type="submit" disabled={busy || !input.trim()}>
          전송
        </button>
      </form>
    </div>
  )
}
