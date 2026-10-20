import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { AssistantError, type AssistantServer } from '../assistant/contracts'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import type { InterventionsView } from './interventions-contracts'
import type { OperationsView } from './operations-contracts'
import { buildOperationsAiRequest, operationsAiFingerprint, parseOperationsAiAnswer, type OperationsAiProposal, type OperationsAiRequest } from './interventions-assistant'

export function InterventionAssistantPanel({ member, server, source, exchanges = null, selectedLessonId, disabled, draftFingerprint, onProposal, onLockChange }: {
  member: Membership; server?: AssistantServer; source?: InterventionsView; exchanges?: OperationsView | null
  selectedLessonId: string; disabled: boolean; onProposal: (input: OperationsAiProposal) => void; onLockChange?: (locked: boolean) => void
  draftFingerprint?: string
}) {
  const memory = useEditDraft<string>(member, 'timetable-operations-ai-input'), recovery = usePendingRequest(member, 'timetableOperationsAssistant')
  const [prompt, setPrompt] = useState(memory.initial ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [answer, setAnswer] = useState<ReturnType<typeof parseOperationsAiAnswer>>(), [basis, setBasis] = useState<string>(), [confirmed, setConfirmed] = useState(false)
  const [expanded, setExpanded] = useState(Boolean(recovery.request))
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)
  const life = useRef(0), running = useRef(false), current = useRef({ source, exchanges, selectedLessonId, disabled })
  const currentDraft = useRef(draftFingerprint); currentDraft.current = draftFingerprint
  current.current = { source, exchanges, selectedLessonId, disabled }
  const pending = recovery.request, locked = busy || !!pending, sourceKey = canonical([source, exchanges])
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { onLockChange?.(locked); return () => onLockChange?.(false) }, [locked, onLockChange])
  useEffect(() => { memory.save(prompt || undefined, !!prompt.trim()) }, [prompt, memory])
  useEffect(() => { if (pending) setExpanded(true) }, [pending?.key])
  useEffect(() => { setAnswer(undefined); setBasis(undefined); setConfirmed(false) }, [sourceKey, selectedLessonId])
  useEffect(() => { setReplaceConfirmed(false) }, [draftFingerprint, answer])
  async function send(request: OperationsAiRequest, key: string, recovering: boolean) {
    if (!server || running.current) return
    const epoch = life.current; running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const result = await server.ask(member.id, request.input, key)
      if (epoch !== life.current) return
      if (result.state === 'pending') { setNotice(result.reason === 'provider_unknown' ? 'AI 처리 결과가 아직 확인되지 않았습니다. 새 요청 대신 원래 번호로 확인합니다.' : '원래 AI 요청을 처리 중입니다.'); return }
      if (result.state === 'rejected') { recovery.remove(key); setError('답변으로 채택되지 않았습니다. 입력과 수업은 그대로입니다.'); return }
      const received = parseOperationsAiAnswer(result, request, key)
      recovery.remove(key)
      const latest = current.current, snapshot = canonical(latest)
      const fingerprint = latest.source ? await operationsAiFingerprint(latest.source, latest.exchanges) : undefined
      if (epoch !== life.current) return
      if (snapshot !== canonical(current.current) || latest.disabled || latest.selectedLessonId !== request.selectedLessonId || fingerprint !== request.fingerprint) { setNotice('요청 뒤 수업이나 교사 기준이 바뀌었습니다. 이전 답변을 현재 입력에 적용하지 않았습니다.'); return }
      setAnswer(received); setBasis(fingerprint); setConfirmed(false)
    } catch (e) {
      if (epoch !== life.current) return
      setError(e instanceof Error ? e.message : 'AI 결과를 확인하지 못했습니다.')
      if (!recovering && e instanceof AssistantError && ['NOT_READY', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'BUDGET_EXCEEDED'].includes(e.code)) recovery.remove(key)
    } finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  async function ask() {
    if (!server || locked || disabled || !source || !selectedLessonId || !prompt.trim()) return
    const epoch = life.current, before = sourceKey
    running.current = true; setBusy(true); setError(''); setAnswer(undefined); setConfirmed(false)
    let request: OperationsAiRequest | undefined
    try {
      const ready = await server.readiness(member.id)
      if (epoch !== life.current) return
      if (!ready.available) { setNotice('학교에서 승인한 Claude 연결과 이용 설정이 준비되면 사용할 수 있습니다. 수업은 직접 입력할 수 있습니다.'); return }
      request = await buildOperationsAiRequest(source, exchanges, selectedLessonId, prompt)
      if (current.current.disabled || canonical([current.current.source, current.current.exchanges]) !== before || current.current.selectedLessonId !== selectedLessonId) request = undefined
    } catch (e) { if (epoch === life.current) setError(e instanceof Error ? e.message : '질문의 범위를 확인해 주세요.') }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
    if (request && epoch === life.current) { const key = crypto.randomUUID(); recovery.put({ command: request, key }); await send(request, key, false) }
  }
  async function apply() {
    if (!answer?.proposal || !basis || !confirmed || draftFingerprint && !replaceConfirmed || disabled || locked || running.current) return
    const epoch = life.current, originalDraft = draftFingerprint; running.current = true; setBusy(true)
    try {
      const latest = current.current, snapshot = canonical(latest)
      if (!latest.source) throw new ServiceError('NOT_READY')
      const value = await operationsAiFingerprint(latest.source, latest.exchanges)
      if (epoch !== life.current) return
      if (snapshot !== canonical(current.current) || current.current.disabled || value !== basis || originalDraft !== currentDraft.current) throw new ServiceError('CONFLICT')
      onProposal(answer.proposal); setAnswer(undefined); setConfirmed(false); setPrompt(''); memory.remove(); setNotice('제안을 요청 입력에 채웠습니다. 서버 변경 확인을 거쳐 직접 제출해 주세요.')
    } catch (e) { if (epoch === life.current) setError(e instanceof Error ? e.message : '현재 수업 기준을 확인해 주세요.') }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  return <details className="timetable-card" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Claude와 수업 변경 상담하기</summary><p>선택한 수업과 조회 범위 일부를 참고해 입력을 제안합니다. 이름·개인 사유를 추가로 적을 필요는 없습니다. 제안은 서버 검사와 교사 동의·승인 뒤에만 반영됩니다.</p>
    <label>도움받을 내용<textarea aria-label="도움받을 내용" rows={2} maxLength={900} value={prompt} disabled={locked || disabled} onChange={e => { setPrompt(e.target.value); setAnswer(undefined); setConfirmed(false) }} /></label>
    <div className="timetable-actions"><button type="button" disabled={!server || locked || disabled || !source || !prompt.trim() || !selectedLessonId} onClick={() => void ask()}>Claude에게 변경 상담</button><button type="button" disabled={locked} onClick={() => { setPrompt(''); setAnswer(undefined); setConfirmed(false); memory.remove() }}>상담 입력 비우기</button>{pending && <button type="button" disabled={busy || !server} onClick={() => void send(pending.command as OperationsAiRequest, pending.key, true)}>원래 AI 요청 결과 확인</button>}</div>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {answer && <section aria-label="AI 수업 변경 제안"><p>{answer.summary}</p>{answer.questions.length > 0 && <ul>{answer.questions.map((question, index) => <li key={index}>{question}</li>)}</ul>}{answer.proposal ? <><p>제안 종류: {({ substitute: '대강', cancel: '휴강', makeup: '보강', reopen: '휴업 취소', move: '이동', swap: '교환' })[answer.proposal.kind]}</p><p>{answer.proposal.reason}</p><label><input type="checkbox" checked={confirmed} disabled={locked || disabled} onChange={e => setConfirmed(e.target.checked)} />AI 제안을 입력란에 채우고 서버에서 변경 영향을 확인하겠습니다.</label>{draftFingerprint && <label><input type="checkbox" checked={replaceConfirmed} disabled={locked || disabled} onChange={e => setReplaceConfirmed(e.target.checked)} />작성 중인 변경 입력을 이 제안으로 바꿉니다.</label>}<button type="button" disabled={!confirmed || !!draftFingerprint && !replaceConfirmed || locked || disabled} onClick={() => void apply()}>확인한 제안을 입력에 채우기</button></> : <p>지금은 적용할 제안이 없습니다. 질문에 답하거나 직접 입력해 주세요.</p>}<details><summary>받은 답변 보기</summary><p style={{ whiteSpace: 'pre-wrap' }}>{answer.text}</p></details></section>}
  </details>
}
