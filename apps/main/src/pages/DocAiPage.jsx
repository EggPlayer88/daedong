import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../lib/AuthContext.jsx'
import { splitPlan } from '../lib/planMarker.js'
import PlanCard from '../components/PlanCard.jsx'
import ConversationList from '../components/ConversationList.jsx'
import { PageHeading, SectionLinks } from '../components/PageFrame.jsx'
import { REF_PREFIX, buildTitle, deriveMeta } from '../lib/docAiMeta.js'
// 서버가 JSON 이 아닌 오류 페이지를 돌려줄 때를 한 자리에서 처리한다 (lib/api.js 주석 참조)
import { postJson } from '../lib/api.js'
import { readDocAiSession, saveDocAiSession, createDocAiAttempt, docAiRequestBody, classifyDocAiReply } from '../lib/docAiRequest.js'
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

// 배포용 예시 (계란님 최종본). public/examples 에 그대로 있고 브라우저가 바로 받는다.
// 대화를 시작하기 전에 완성 모습을 보면 무엇을 물어볼지 교사가 미리 안다.
const EXAMPLES = [
  { grade: 1, label: '1학년 (자유학기)', file: '예시_2026학년도_2학기_1학년_수학_평가계획서_자유학기.hwpx' },
  { grade: 2, label: '2학년', file: '예시_2026학년도_2학기_2학년_수학_평가계획서.hwpx' },
  { grade: 3, label: '3학년', file: '예시_2026학년도_2학기_3학년_수학_평가계획서.hwpx' },
]

/** 서버 게이트(D20) 응답이면 안내 문구를 돌려준다 */
function pendingMessage(status, data) {
  if (status === 403 && data?.error === 'PENDING_APPROVAL') {
    return data.message || '승인 대기중입니다. 관리자 승인 후 이용할 수 있습니다.'
  }
  return null
}

export default function DocAiPage() {
  const { session } = useAuth()
  return <DocAiScope key={session?.user?.id ?? 'signed-out'} session={session}/>
}
function DocAiScope({ session }) {
  const token = session?.access_token
  const userId = session?.user?.id
  const initial = useRef(readDocAiSession(userId)).current

  const [messages, setMessages] = useState(initial?.messages ?? [])
  const [input, setInput] = useState(initial?.input ?? '')
  const [quality, setQuality] = useState(initial?.quality ?? 'quick')
  const [pendingRequest, setPendingRequest] = useState(initial?.pendingRequest ?? null)
  const [canResend, setCanResend] = useState(false)
  const [repairNeeded, setRepairNeeded] = useState(initial?.repairNeeded ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [plan, setPlan] = useState(initial?.plan ?? null) // 확인 카드에 띄울 확정 JSON
  const [notice, setNotice] = useState(null) // 양식 준비 중 등 안내
  const [notices, setNotices] = useState([]) // 생성 후 "문서에 안 들어간 것" 안내
  const [findings, setFindings] = useState([]) // 규정 검증 결과 (WARN/FLAG)
  const [planNotices, setPlanNotices] = useState([]) // 생성 전 안내 (횟수 세트 등)
  const [levels, setLevels] = useState(null) // 양식 유형이 정한 성취수준 단계 (서버 판정)
  const [scoring, setScoring] = useState(true) // 자유학기면 false — 배점 절을 그리지 않는다
  const bottomRef = useRef(null)
  const epoch = useRef(0), flight = useRef(false)
  const fileRef = useRef(null)

  // 대화 저장 (004). 저장은 보조 기능이라 실패해도 대화를 막지 않는다.
  const [convId, setConvId] = useState(initial?.convId ?? newConversationId)
  const [convs, setConvs] = useState([])
  const [convError, setConvError] = useState(null)
  // 확정 plan 은 제목·교과·학년의 우선 출처다. 저장 시점의 최신값이 필요해 ref 로도 든다
  const planRef = useRef(initial?.plan ?? null)
  const locked = busy || !!pendingRequest
  useEffect(() => () => { epoch.current++ }, [])
  useEffect(() => { saveDocAiSession(userId, { convId, messages, input, quality, pendingRequest, plan, repairNeeded }) }, [userId,convId,messages,input,quality,pendingRequest,plan,repairNeeded])
  useEffect(() => {
    if (!pendingRequest && !input.trim()) return
    const warn = event => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pendingRequest,input])

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

  /**
   * 보낼 대화 전체(history)를 명시적으로 받는다.
   * ⚠ messages 상태를 읽어서 조립하지 않는다 — 자동 재시도처럼 한 턴 안에서
   *   연속 호출할 때 stale closure 로 직전 메시지가 누락된다.
   * 원 요청 번호와 내용은 결과를 확인할 때까지 유지한다. 형식 재작성도 교사가 명시 요청한다.
   */
  async function sendHistory(history, { attempt = null, recoverOnly = false, cancelOnly = false } = {}) {
    if (flight.current || !token || !userId || pendingRequest && !attempt) return
    let original
    try { original = attempt ? { ...attempt, ...(cancelOnly || attempt.closing ? { closing: true } : {}) } : createDocAiAttempt(history, quality) } catch (e) { setError(e.message); return }
    const startedEpoch = epoch.current
    flight.current = true
    saveDocAiSession(userId, { convId, messages: original.messages, input, quality, pendingRequest: original, plan, repairNeeded })
    setPendingRequest(original); setCanResend(false)
    history = original.messages
    setMessages(history)
    setBusy(true)
    setError(null)

    try {
      const r = await postJson('/api/doc-ai/chat', docAiRequestBody(original, original.closing ? false : recoverOnly, !!original.closing), token)
      if (startedEpoch !== epoch.current) return
      const { data } = r
      const pending = pendingMessage(r.status, data)
      if (pending) {
        setError(pending)
        return
      }
      if (!r.ok) throw new Error(data.message || data.error || `요청 실패 (${r.status})`)
      const state = classifyDocAiReply(data, original.requestKey)
      if (state === 'missing' && !original.closing) { setCanResend(true); setError('아직 접수 결과가 없습니다. 원래 번호와 내용으로 다시 접수할 수 있습니다.'); return }
      if (state === 'failed') { setPendingRequest(null); if(data.state==='closed'){setError(null);setNotice('아직 시작하지 않은 요청을 닫았습니다. 작성 내용은 그대로 유지했습니다.')}else setError(`요청이 완료되지 않았습니다 (${data.code}). 내용을 유지했습니다. 설정과 예산을 확인한 뒤 다시 요청해 주세요.`); return }
      if (state !== 'completed') { setError('처리 결과를 아직 확인하지 못했습니다. 같은 요청 번호로 결과만 다시 확인해 주세요.'); return }
      setPendingRequest(null)

      const reply = data.reply || ''
      const withReply = [...history, { role: 'assistant', content: reply }]
      setMessages(withReply)

      const { text: visible, json, broken } = splitPlan(reply)

      if (json) {
        planRef.current = json
        setPlan(json)
        checkRegulation(json)
      } else if (broken) {
        setRepairNeeded(true)
        setError('내용 정리 형식을 확인하지 못했습니다. 아래에서 재작성을 요청하면 AI를 한 번 더 사용합니다.')
      } else if (!visible) {
        setError('응답이 비어 있습니다. 다시 시도해 주세요.')
      }

      persist(withReply)
    } catch (e) {
      if (startedEpoch === epoch.current) setError(e.message) // 원 번호·내용은 그대로 유지한다.
    } finally {
      if (startedEpoch === epoch.current) { flight.current = false; setBusy(false) }
    }
  }

  /** 화면을 비운다 (새 대화·다른 대화 열기 공통) */
  function resetView() {
    setPlan(null)
    planRef.current = null
    setLevels(null)
    setScoring(true)
    setNotice(null)
    setNotices([])
    setFindings([])
    setPlanNotices([])
    setError(null)
    setInput('')
    setRepairNeeded(false)
  }

  function startNew() {
    if (locked) return
    resetView()
    setConvId(newConversationId())
    setMessages([])
  }

  /** 저장된 대화를 그대로 되살린다. 서버를 다시 부르지 않는다 — 마지막 답변이 이미 있다 */
  async function openConversation(id) {
    if (locked || id === convId) return
    const startedEpoch = epoch.current
    setBusy(true)
    resetView()
    try {
      const { row, error: e } = await loadConversation(id)
      if (startedEpoch !== epoch.current) return
      if (e || !row) throw new Error(e?.message || '대화를 찾지 못했습니다.')
      const history = Array.isArray(row.messages) ? row.messages : []
      setConvId(row.id)
      setMessages(history)
      // 마지막 assistant 응답에 확정 JSON 이 있으면 확인 카드도 되살린다
      const last = [...history].reverse().find((m) => m.role === 'assistant')
      const json = last ? splitPlan(last.content).json : null
      if (json) {
        planRef.current = json
        setPlan(json)
        checkRegulation(json)
      }
    } catch (err) {
      if (startedEpoch === epoch.current) setError(err.message)
    } finally {
      if (startedEpoch === epoch.current) setBusy(false)
    }
  }

  async function removeConversation(c) {
    if (locked) return
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
    if (!text || locked) return
    let attempt
    try { attempt = createDocAiAttempt([...messages, { role: 'user', content: text }], quality) }
    catch (failure) { setError(failure.message); return }
    setPlan(null)
    setNotice(null)
    setNotices([])
    setFindings([])
    setInput('')
    setRepairNeeded(false)
    sendHistory(attempt.messages, { attempt })
  }

  /**
   * 규정 검증만 돌린다 (check_only) — 문서를 만들지 않고 확인 카드에 표시할 판정을 받는다.
   * ⚠ 규칙을 프론트에 복제하지 않는다. 서버 검증기 하나가 유일한 근거다.
   */
  async function checkRegulation(fields) {
    const startedEpoch = epoch.current
    setFindings([])
    setPlanNotices([])
    setLevels(null)
    setScoring(true)
    try {
      const r = await postJson('/api/doc-ai/generate', { fields, check_only: true }, token)
      if (startedEpoch !== epoch.current) return
      const { data } = r
      if (r.status === 400 && data.error === 'REGULATION_VIOLATION') {
        setFindings(data.findings || [])
        return
      }
      if (r.ok) {
        setFindings(data.findings || [])
        // 규정 위반은 아니지만 알려야 하는 것 (횟수 세트 밖, 작년과 달라진 조합)
        setPlanNotices(Array.isArray(data.notices) ? data.notices : [])
        // 예체능판은 A~C 3단계 — 어느 유형인지는 서버가 정한다
        setLevels(Array.isArray(data.levels) ? data.levels : null)
        setScoring(data.scoring !== false)
      }
    } catch {
      // 판정을 못 받아도 대화는 계속된다 — 생성 시 서버가 다시 검사한다
    }
  }

  async function generate() {
    if (locked) return
    const startedEpoch = epoch.current
    setBusy(true)
    setError(null)
    setNotice(null)
    setNotices([])
    try {
      const r = await postJson('/api/doc-ai/generate', { fields: plan }, token)
      if (startedEpoch !== epoch.current) return
      const { data } = r

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
      if (startedEpoch === epoch.current) setError(e.message)
    } finally {
      if (startedEpoch === epoch.current) setBusy(false)
    }
  }

  /** 참고자료 hwpx 첨부 → 텍스트 추출 → 대화에 user 메시지로 삽입 */
  async function attach(file) {
    if (!file || locked) return
    const startedEpoch = epoch.current
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

      const r = await postJson(
        '/api/doc-ai/extract',
        { filename: file.name, base64: btoa(bin) },
        token
      )
      const { data } = r
      if (startedEpoch !== epoch.current) return
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
      if (startedEpoch === epoch.current) setError(e.message)
    } finally {
      if (startedEpoch === epoch.current) setBusy(false)
    }
  }

  // 화면에 보일 대화만 (PLAN_READY 블록은 카드로 대체)
  const visible = messages.map((m) =>
    m.role === 'assistant' ? { ...m, content: splitPlan(m.content).text } : m
  )

  return (
    <div className="page docai site-page">
      <PageHeading title={`문서 작성 AI — ${manifest.doc_title}`} description="대화로 내용을 정하고, 완성된 평가계획서를 확인하세요." />
      <SectionLinks items={[{ id: 'docai-compose', label: '메시지 작성' }, { id: 'docai-history', label: '저장된 대화' }, ...(plan ? [{ id: 'docai-result', label: '생성 전 내용 확인' }] : [])]} />
      <p className="muted small">
        대화로 내용을 확정하면 통일된 양식의 한글 파일(.hwpx)을 만들어 드립니다.
        대화는 자동 저장되며 <b>본인만</b> 볼 수 있습니다 — 나중에 이어서 작성할 수 있습니다.
      </p>

      <p className="examples">
        <span className="muted small">예시 파일 보기 (수학):</span>
        {EXAMPLES.map((e) => (
          <a
            key={e.grade}
            className="example-link"
            href={`/examples/${encodeURIComponent(e.file)}`}
            download={e.file}
          >
            {e.label}
          </a>
        ))}
        <span className="muted small">완성 모습을 먼저 보시면 무엇을 정해야 하는지 감이 잡힙니다.</span>
      </p>

      <div className="docai-body">
      <div className="docai-main">
      {convs.find(item => item.id === convId)?.title && <p className="docai-current-title"><span>이어서 작성 중</span><strong>{convs.find(item => item.id === convId).title}</strong></p>}
      <fieldset disabled={locked} className="docai-quality"><legend>AI 요청 방식</legend><label><input type="radio" name="docai-quality" value="quick" checked={quality==='quick'} onChange={()=>setQuality('quick')}/> 기본 작성 · Haiku</label>{' '}<label><input type="radio" name="docai-quality" value="review" checked={quality==='review'} onChange={()=>setQuality('review')}/> 정밀 검토 · Sonnet</label><p className="muted small">학교의 월 공통 AI 예산을 사용합니다. 정밀 검토는 필요할 때 직접 선택하세요.</p></fieldset>
      {!messages.length&&<section className="docai-welcome"><p>교과·학년과 필요한 내용을 입력하거나 안내 대화를 시작하세요. 버튼을 누르기 전에는 AI를 호출하지 않습니다.</p><button type="button" className="btn-plain" disabled={locked||!token} onClick={()=>void sendHistory([{role:'user',content:OPENING}])}>안내 대화 시작</button></section>}
      <div className="chat" role="region" aria-label="평가계획 작성 대화" tabIndex={0} hidden={!visible.some(message => message.content) && !busy}>
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

      {error && <p className="error" role="alert">{error}</p>}
      {pendingRequest&&<section role="status" aria-label="AI 요청 결과 확인"><p>이 요청의 결과를 확인하는 동안 새 요청은 보내지 않습니다. 입력과 요청 번호는 현재 탭에 보관됩니다.</p><p style={{overflowWrap:'anywhere'}}>요청 번호: {pendingRequest.requestKey}</p><button type="button" disabled={busy} onClick={()=>void sendHistory(pendingRequest.messages,{attempt:pendingRequest,recoverOnly:true})}>{pendingRequest.closing?'닫기 결과 다시 확인':'같은 요청 결과 확인'}</button>{canResend&&!pendingRequest.closing&&<button type="button" disabled={busy} onClick={()=>void sendHistory(pendingRequest.messages,{attempt:pendingRequest})}>원래 요청 다시 접수</button>}{!pendingRequest.closing&&<details><summary>이 요청을 더 진행하지 않으려면</summary><p>아직 AI가 시작하지 않은 요청만 닫습니다. 이미 처리 중이면 결과 확인을 계속해야 합니다.</p><button type="button" disabled={busy} onClick={()=>void sendHistory(pendingRequest.messages,{attempt:pendingRequest,cancelOnly:true})}>새 호출 없이 요청 닫기</button></details>}</section>}
      {repairNeeded&&!pendingRequest&&<button type="button" disabled={busy} onClick={()=>{setRepairNeeded(false);void sendHistory([...messages,{role:'user',content:'방금 JSON 형식이 깨졌습니다. ===PLAN_READY=== 블록만 다시 정확히 출력해 주세요.'}])}}>형식 재작성 요청 · AI 추가 사용</button>}
      {notice && <p className="notice" role="status">{notice}</p>}
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
        <section id="docai-result" tabIndex={-1} aria-label="생성 전 내용 확인">
        <PlanCard
          manifest={manifest}
          plan={plan}
          findings={findings}
          notices={planNotices}
          levels={levels}
          scoring={scoring}
          busy={locked}
          onGenerate={generate}
          onEdit={() => setPlan(null)}
        />
        </section>
      )}

      <form className="composer" onSubmit={onSubmit} aria-label="평가계획 메시지 작성">
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
          disabled={locked}
          title="지난 학기 평가계획서(.hwpx)를 올리면 초안 품질이 크게 좋아집니다"
        >
          📎 참고자료
        </button>
        <input
          id="docai-compose"
          aria-label="평가계획 메시지"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={busy ? '응답을 기다리는 중…' : '메시지를 입력하세요'}
          disabled={locked}
        />
        <button className="btn-google" type="submit" disabled={locked || !input.trim()}>
          전송
        </button>
      </form>
      </div>
      <ConversationList
        rows={convs}
        currentId={convId}
        busy={locked}
        error={convError}
        onOpen={openConversation}
        onNew={startNew}
        onDelete={removeConversation}
      />

      </div>
    </div>
  )
}
