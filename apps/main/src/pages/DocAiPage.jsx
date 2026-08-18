import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { splitPlan } from '../lib/planMarker.js'
import PlanCard from '../components/PlanCard.jsx'
import ConversationList from '../components/ConversationList.jsx'
import { REF_PREFIX, buildTitle, deriveMeta } from '../lib/docAiMeta.js'
import {
  deleteConversation,
  listConversations,
  loadConversation,
  markCompleted,
  newConversationId,
  saveConversation,
} from '../lib/docAiStore.js'
// 필드 라벨의 진실의 원천은 manifest 하나 (P5). 서버(chat/generate)와 같은 파일을 읽는다.
import manifest from '../../api/doc-ai/_assets/template-manifest.json'

// 대화 시작용 첫 사용자 메시지 (API 는 첫 메시지가 user 여야 한다)
const OPENING = '평가계획서 작성을 시작하려고 합니다.'

/** 서버 게이트(D20) 응답이면 안내 문구를 돌려준다 */
function pendingMessage(status, data) {
  if (status === 403 && data?.error === 'PENDING_APPROVAL') {
    return data.message || '승인 대기중입니다. 관리자 승인 후 이용할 수 있습니다.'
  }
  return null
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
  const [notices, setNotices] = useState([]) // 생성 후 "문서에 안 들어간 것" 안내
  const [findings, setFindings] = useState([]) // 규정 검증 결과 (WARN/FLAG)
  const [planNotices, setPlanNotices] = useState([]) // 생성 전 안내 (횟수 세트 등)
  const bottomRef = useRef(null)
  const started = useRef(false)
  const fileRef = useRef(null)

  // 대화 저장 (004). 저장은 보조 기능이라 실패해도 대화를 막지 않는다.
  const [convId, setConvId] = useState(newConversationId)
  const [convs, setConvs] = useState([])
  const [convError, setConvError] = useState(null)
  // 확정 plan 은 제목·교과·학년의 우선 출처다. 저장 시점의 최신값이 필요해 ref 로도 든다
  const planRef = useRef(null)
  const userId = session?.user?.id

  const refreshConvs = useCallback(async () => {
    if (!userId) return
    const { rows, error } = await listConversations()
    if (error) setConvError(error.message)
    else {
      setConvs(rows)
      setConvError(null)
    }
  }, [userId])

  useEffect(() => {
    refreshConvs()
  }, [refreshConvs])

  /**
   * 매 교환 후 자동 저장. 제목·교과·학년은 대화에서 뽑되 확정 plan 이 있으면 그쪽이 이긴다.
   * ⚠ 실패해도 조용히 넘긴다 — 저장 오류 배너가 작성 흐름을 끊는 것이 더 나쁘다.
   *   대신 목록 갱신이 안 되므로 교사가 눈으로 알 수 있다.
   */
  const persist = useCallback(
    async (history, { status } = {}) => {
      if (!userId || !Array.isArray(history) || history.length === 0) return
      // 인사만 오간 대화는 저장하지 않는다 — /doc-ai 를 열 때마다 빈 행이 쌓인다
      const said = history.some((m) => m.role === 'user' && m.content !== OPENING)
      if (!said) return
      const meta = deriveMeta(history, planRef.current)
      const { error } = await saveConversation({
        id: convId,
        userId,
        messages: history,
        subject: meta.subject,
        grade: meta.grade,
        title: buildTitle(meta),
        status,
      })
      if (error) {
        setConvError(error.message)
        return
      }
      setConvError(null)
      refreshConvs()
    },
    [convId, userId, refreshConvs]
  )

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
      const pending = pendingMessage(r.status, data)
      if (pending) {
        setError(pending)
        return
      }
      if (!r.ok) throw new Error(data.error || `요청 실패 (${r.status})`)

      const reply = data.reply || ''
      const withReply = [...history, { role: 'assistant', content: reply }]
      setMessages(withReply)

      const { text: visible, json, broken } = splitPlan(reply)

      if (json) {
        planRef.current = json
        setPlan(json)
        checkRegulation(json)
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

      persist(withReply)
    } catch (e) {
      setError(e.message) // 보낸 메시지는 남겨두어 그대로 재시도할 수 있게 한다
    } finally {
      setBusy(false)
    }
  }

  /** 화면을 비운다 (새 대화·다른 대화 열기 공통) */
  function resetView() {
    setPlan(null)
    planRef.current = null
    setNotice(null)
    setNotices([])
    setFindings([])
    setPlanNotices([])
    setError(null)
    setInput('')
  }

  function startNew() {
    if (busy) return
    resetView()
    setConvId(newConversationId())
    setMessages([])
    started.current = true
    sendHistory([{ role: 'user', content: OPENING }])
  }

  /** 저장된 대화를 그대로 되살린다. 서버를 다시 부르지 않는다 — 마지막 답변이 이미 있다 */
  async function openConversation(id) {
    if (busy || id === convId) return
    setBusy(true)
    resetView()
    try {
      const { row, error: e } = await loadConversation(id)
      if (e || !row) throw new Error(e?.message || '대화를 찾지 못했습니다.')
      const history = Array.isArray(row.messages) ? row.messages : []
      setConvId(row.id)
      setMessages(history)
      started.current = true
      // 마지막 assistant 응답에 확정 JSON 이 있으면 확인 카드도 되살린다
      const last = [...history].reverse().find((m) => m.role === 'assistant')
      const json = last ? splitPlan(last.content).json : null
      if (json) {
        planRef.current = json
        setPlan(json)
        checkRegulation(json)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function removeConversation(c) {
    if (busy) return
    const label = c.title || '이 대화'
    // 되돌릴 수 없는 삭제라 한 번 묻는다
    if (!window.confirm(`'${label}' 을(를) 삭제할까요? 되돌릴 수 없습니다.`)) return
    const { error: e } = await deleteConversation(c.id)
    if (e) {
      setConvError(e.message)
      return
    }
    if (c.id === convId) startNew()
    else refreshConvs()
  }

  function onSubmit(e) {
    e.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    setPlan(null)
    setNotice(null)
    setNotices([])
    setFindings([])
    setInput('')
    sendHistory([...messages, { role: 'user', content: text }])
  }

  /**
   * 규정 검증만 돌린다 (check_only) — 문서를 만들지 않고 확인 카드에 표시할 판정을 받는다.
   * ⚠ 규칙을 프론트에 복제하지 않는다. 서버 검증기 하나가 유일한 근거다.
   */
  async function checkRegulation(fields) {
    setFindings([])
    setPlanNotices([])
    try {
      const r = await fetch('/api/doc-ai/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ fields, check_only: true }),
      })
      const data = await r.json()
      if (r.status === 400 && data.error === 'REGULATION_VIOLATION') {
        setFindings(data.findings || [])
        return
      }
      if (r.ok) {
        setFindings(data.findings || [])
        // 규정 위반은 아니지만 알려야 하는 것 (횟수 세트 밖, 작년과 달라진 조합)
        setPlanNotices(Array.isArray(data.notices) ? data.notices : [])
      }
    } catch {
      // 판정을 못 받아도 대화는 계속된다 — 생성 시 서버가 다시 검사한다
    }
  }

  async function generate() {
    setBusy(true)
    setError(null)
    setNotice(null)
    setNotices([])
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
        // 어느 유형의 양식이 준비 중인지까지 알린다 (템플릿 패밀리)
        setNotice(
          data.message ||
            '양식 준비 중입니다 — 내용은 확정됐으니 양식 등록 후 다시 생성해 주세요.'
        )
        return
      }
      const pending = pendingMessage(r.status, data)
      if (pending) {
        setError(pending)
        return
      }
      if (r.status === 400 && data.error === 'REGULATION_VIOLATION') {
        setFindings(data.findings || [])
        setError(
          '학업성적관리규정에 어긋나는 항목이 있어 생성하지 못했습니다. 아래 내용을 고쳐 주세요.'
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
      // 목록에서 "생성 완료" 로 구분되게 표시 (대화는 그대로 남아 다시 열 수 있다)
      markCompleted(convId).then(refreshConvs)
      // 양식에 담기지 못한 것이 있으면 숨기지 않고 그대로 알린다 (제0원칙)
      setNotices(Array.isArray(data.notices) ? data.notices : [])
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  /** 참고자료 hwpx 첨부 → 텍스트 추출 → 대화에 user 메시지로 삽입 */
  async function attach(file) {
    if (!file) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const buf = await file.arrayBuffer()
      // 큰 파일에서 String.fromCharCode(...array) 는 스택을 넘긴다 — 청크로 나눈다
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
      }

      const r = await fetch('/api/doc-ai/extract', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ filename: file.name, base64: btoa(bin) }),
      })
      const data = await r.json()
      const pending = pendingMessage(r.status, data)
      if (pending) {
        setError(pending)
        return
      }
      if (!r.ok) throw new Error(data.error || `추출 실패 (${r.status})`)

      setNotice(
        `참고자료를 읽었습니다: ${data.filename} (${data.chars.toLocaleString()}자` +
          `${data.truncated ? ', 앞부분만 사용' : ''})`
      )
      // 프롬프트 2단계가 기대하는 형식으로 대화에 넣는다
      await sendHistory([
        ...messages,
        { role: 'user', content: `${REF_PREFIX}${data.filename}]\n${data.text}` },
      ])
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
        대화는 자동 저장되며 <b>본인만</b> 볼 수 있습니다 — 나중에 이어서 작성할 수 있습니다.
      </p>

      <div className="docai-body">
      <ConversationList
        rows={convs}
        currentId={convId}
        busy={busy}
        error={convError}
        onOpen={openConversation}
        onNew={startNew}
        onDelete={removeConversation}
      />

      <div className="docai-main">
      <div className="chat">
        {visible.map((m, i) => {
          if (!m.content) return null
          // 참고자료는 본문이 길어 채팅에 그대로 펼치지 않고 요약 칩으로 보여준다
          // (AI 에게는 전문이 그대로 전달된다)
          if (m.role === 'user' && m.content.startsWith(REF_PREFIX)) {
            const head = m.content.slice(0, m.content.indexOf('\n'))
            const chars = m.content.length - head.length
            return (
              <div key={i} className="msg user ref-chip">
                📎 {head.slice(REF_PREFIX.length, -1)}
                <span className="muted small"> · {chars.toLocaleString()}자 전달됨</span>
              </div>
            )
          }
          return (
            <div key={i} className={`msg ${m.role}`}>
              {m.content}
            </div>
          )
        })}
        {busy && <div className="msg assistant muted">…</div>}
        <div ref={bottomRef} />
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}
      {notices.length > 0 && (
        <div className="card warn-card">
          <b>문서에 담기지 못한 내용이 있습니다</b>
          <ul>
            {notices.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
          <p className="muted small">
            내려받은 파일을 한글에서 열어 위 내용을 직접 추가해 주세요.
          </p>
        </div>
      )}

      {plan && (
        <PlanCard
          manifest={manifest}
          plan={plan}
          findings={findings}
          notices={planNotices}
          busy={busy}
          onGenerate={generate}
          onEdit={() => setPlan(null)}
        />
      )}

      <form className="composer" onSubmit={onSubmit}>
        <input
          ref={fileRef}
          type="file"
          accept=".hwpx"
          hidden
          onChange={(e) => {
            attach(e.target.files?.[0])
            e.target.value = '' // 같은 파일 다시 고를 수 있게
          }}
        />
        <button
          type="button"
          className="btn-plain attach"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          title="지난 학기 평가계획서(.hwpx)를 올리면 초안 품질이 크게 좋아집니다"
        >
          📎 참고자료
        </button>
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
      </div>
    </div>
  )
}
