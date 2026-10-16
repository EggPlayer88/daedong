import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { TimetableBasis, Placement } from '../../../../packages/timetable/src/types'
import { validatePlacements } from '../../../../packages/timetable/src/validate'
import type { TimetableConditions } from './contracts'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { AssistantError, assistantInput, type AssistantServer } from '../assistant/contracts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { applyTimetableAiProposal, buildTimetableAiContext, type TimetableAiProposal, type TimetableAiContext } from './assistant'
import { timetableAssistantRequest, timetableAssistantAnswer, TimetableAssistantInputError, type TimetableAssistantRequest } from './assistant-bridge'

interface Props {
  server?: AssistantServer; member: Membership; basis: TimetableBasis | null; conditions: TimetableConditions | null; placements: Placement[]
  disabled: boolean; onApply: (conditions: TimetableConditions) => void; onLockChange?: (locked: boolean) => void
}
const message = (error: unknown) => error instanceof AssistantError || error instanceof ServiceError || error instanceof TimetableAssistantInputError ? error.message : 'AI 답변을 확인하지 못했습니다. 원래 요청과 입력은 유지됩니다.'
export function TimetableAssistantPanel(props: Props) {
  const id = useId(), recovery = usePendingRequest(props.member, 'timetableAssistant'), memory = useEditDraft<{ prompt: string; resourceId: string; stage?: 'setup' | 'adjust' }>(props.member, 'timetable-assistant-input')
  const [prompt, setPrompt] = useState(memory.initial?.prompt ?? ''), [resourceId, setResourceId] = useState(memory.initial?.resourceId ?? '')
  const [stage, setStage] = useState<'setup' | 'adjust'>(memory.initial?.stage ?? 'setup')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [rawAnswer, setRawAnswer] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [proposal, setProposal] = useState<{ value: TimetableAiProposal; context: TimetableAiContext }>(), [confirmed, setConfirmed] = useState(false)
  const current = useRef(props), life = useRef(0), operation = useRef(false); current.current = props
  const pending = recovery.request, locked = busy || !!pending
  const canReview = !!props.basis && !!props.conditions && validatePlacements({ ...props.basis, ...props.conditions }, props.placements).valid
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { props.onLockChange?.(locked); return () => props.onLockChange?.(false) }, [locked, props.onLockChange])
  useEffect(() => { memory.save(prompt || resourceId ? { prompt, resourceId, stage } : undefined, !!prompt.trim()) }, [prompt, resourceId, stage, memory])
  useEffect(() => { setProposal(undefined); setConfirmed(false); setRawAnswer('') }, [props.disabled, canonical([props.basis, props.conditions, props.placements])])
  async function send(request: TimetableAssistantRequest, key: string, recovering: boolean) {
    if (!current.current.server || operation.current) return
    const epoch = life.current; operation.current = true; setBusy(true); setError(''); setNotice('')
    try {
      // 복구에서는 새 기준으로 명령을 만들거나 준비 상태를 앞세우지 않는다.
      assistantInput(request.input)
      const result = await current.current.server.ask(props.member.id, request.input, key)
      if (epoch !== life.current) return
      if (result.state === 'pending') { setNotice(result.reason === 'provider_unknown' ? 'AI 제공자의 처리 결과를 아직 모릅니다. 같은 요청으로만 확인합니다.' : '원래 AI 요청을 처리 중입니다. 잠시 후 같은 요청으로 확인해 주세요.'); return }
      if (result.state === 'rejected') { recovery.remove(key); setError('이번 AI 요청은 답변으로 채택되지 않았습니다. 입력은 유지했으며 조건은 변경하지 않았습니다.'); return }
      const answer = timetableAssistantAnswer(result, request, key)
      recovery.remove(key); setRawAnswer(answer.text)
      const latest = current.current
      if (latest.disabled || !latest.basis || !latest.conditions) { setNotice('답변은 도착했지만 현재 기준자료를 다시 확인한 뒤 사용해 주세요. 조건은 변경하지 않았습니다.'); return }
      const checked = canonical([latest.basis, latest.conditions, latest.placements])
      const refreshed = await buildTimetableAiContext(latest.basis, latest.conditions, request.context.stage, request.context.prompt, request.context.stage === 'adjust' ? latest.placements : [])
      if (epoch !== life.current) return
      if (current.current.disabled || checked !== canonical([current.current.basis, current.current.conditions, current.current.placements]) || refreshed.contextFingerprint !== request.context.contextFingerprint) { setNotice('요청한 뒤 기준자료나 조건이 바뀌었습니다. 이전 답변을 현재 조건에 반영하지 않았습니다.'); return }
      if (answer.proposal) { setProposal({ value: answer.proposal, context: request.context }); setConfirmed(false); setNotice('AI 제안을 확인해 주세요. 아직 조건에 반영하지 않았습니다.') }
      else setNotice('답변을 받았지만 조건 제안 형식이나 선택 범위와 맞지 않습니다. 답변을 참고해 직접 입력할 수 있습니다.')
    } catch (failure) {
      if (epoch !== life.current) return
      setError(message(failure))
      // 처음 요청의 확정 거절만 해제한다. 원키 복구 실패는 최초 실행 여부의 증거가 아니다.
      if (!recovering && failure instanceof AssistantError && ['NOT_READY', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'BUDGET_EXCEEDED'].includes(failure.code)) recovery.remove(key)
    } finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  async function ask() {
    if (operation.current || locked || props.disabled || !props.server || !props.basis || !props.conditions || !prompt.trim()) return
    if (stage === 'adjust' && !canReview) { setError('현재 배치의 필수조건 검사를 먼저 통과해 주세요. 작성한 질문은 유지됩니다.'); return }
    const epoch = life.current, before = canonical([props.basis, props.conditions, props.placements])
    operation.current = true; setBusy(true); setError(''); setNotice(''); setProposal(undefined); setConfirmed(false)
    let request: TimetableAssistantRequest | undefined
    try {
      const ready = await props.server.readiness(props.member.id)
      if (epoch !== life.current) return
      if (!ready.available) { setNotice('학교의 Claude 비서 연결·이용 설정이 준비되면 사용할 수 있습니다. 지금은 조건을 직접 입력할 수 있습니다.'); return }
      const context = await buildTimetableAiContext(props.basis, props.conditions, stage, prompt, stage === 'adjust' ? props.placements : [])
      if (epoch !== life.current || current.current.disabled || canonical([current.current.basis, current.current.conditions, current.current.placements]) !== before) return
      request = timetableAssistantRequest(context, resourceId)
    } catch (failure) { if (epoch === life.current) setError(message(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
    if (request && epoch === life.current) { const key = crypto.randomUUID(); recovery.put({ command: request, key }); await send(request, key, false) }
  }
  async function recover() {
    if (!pending || locked && busy) return
    const value = pending.command as TimetableAssistantRequest
    if (!value || !value.input || !value.context || typeof value.resourceId !== 'string') { setError('보관된 요청을 확인할 수 없습니다. 새 요청으로 대체하지 말고 담당자에게 문의해 주세요.'); return }
    await send(value, pending.key, true)
  }
  async function apply() {
    if (operation.current || !proposal || !confirmed || locked || props.disabled || !props.basis || !props.conditions) return
    const epoch = life.current, before = canonical([props.basis, props.conditions, props.placements]); operation.current = true; setBusy(true)
    try {
      const next = await applyTimetableAiProposal(proposal.value, proposal.context, props.basis, props.conditions, proposal.context.stage === 'adjust' ? props.placements : [], true)
      if (epoch !== life.current || current.current.disabled || canonical([current.current.basis, current.current.conditions, current.current.placements]) !== before) return
      props.onApply(next); setProposal(undefined); setConfirmed(false); setPrompt(''); setNotice('확인한 제안을 편성 조건에 반영했습니다. 배치와 확정은 담당자가 검토합니다.')
    } catch (failure) { if (epoch === life.current) setError(message(failure)) }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
  }
  const selected = props.basis?.resources.find(r => r.id === resourceId)
  return <details className="timetable-card" open={expanded || !!pending} onToggle={event => setExpanded(event.currentTarget.open)}><summary>Claude와 조건 정리하기</summary>
    <p>교사·학급·공간을 고르고 필요한 조건을 말로 설명해 주세요. 답변은 확인 후 반영하며 수업을 자동으로 옮기거나 요청을 보내지 않습니다.</p>
    {!props.server && <p>실제 학교 연결에서 사용할 수 있습니다. 편성 연습에서는 AI를 호출하지 않습니다.</p>}
    <label htmlFor={`${id}-stage`}>AI와 할 작업</label><select id={`${id}-stage`} value={stage} disabled={locked || props.disabled} onChange={event => { setStage(event.target.value as 'setup' | 'adjust'); setProposal(undefined); setConfirmed(false) }}><option value="setup">편성 조건 정리</option><option value="adjust" disabled={!canReview}>현재 배치 피드백</option></select>
    {stage === 'adjust' && <p>선택한 대상의 현재 배치를 함께 보냅니다. AI 설명은 참고이며, 수업 이동과 최종 판정은 담당자 확인과 프로그램 검사를 거칩니다.</p>}
    <label htmlFor={`${id}-target`}>AI에게 설명할 대상</label><select id={`${id}-target`} value={resourceId} disabled={locked || props.disabled} onChange={e => { setResourceId(e.target.value); setProposal(undefined) }}><option value="">대상을 선택해 주세요</option>{props.basis?.resources.filter(r => r.kind !== 'equipment').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
    <label htmlFor={`${id}-prompt`}>시간표 조건 요청</label><textarea id={`${id}-prompt`} rows={3} maxLength={900} value={prompt} disabled={locked || props.disabled} onChange={e => { setPrompt(e.target.value); setProposal(undefined) }} placeholder="예: 이번 학기 수요일 1교시를 가능하면 피하고 싶어요." />
    <p className="timetable-muted">선택한 대상의 수업명·시간대·요청 내용을 학교가 승인한 Claude 연결로 보냅니다. 의료·가족 사정 등 개인의 상세 사유는 적지 않아도 됩니다.</p>
    <div className="timetable-actions"><button type="button" disabled={locked || props.disabled || !props.server || !selected || !prompt.trim()} onClick={() => void ask()}>Claude에게 조건 정리 요청</button><button type="button" className="secondary" disabled={locked} onClick={() => { setPrompt(''); setResourceId(''); setProposal(undefined); setRawAnswer(''); setError(''); setNotice('') }}>AI 입력 비우기</button>{pending && <button type="button" disabled={busy || !props.server} onClick={() => void recover()}>원래 AI 요청 결과 확인</button>}</div>
    {busy && <p role="status">원래 요청과 기준자료를 확인하고 있습니다…</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {proposal && <section aria-label="AI 조건 제안"><h3>제안 검토</h3><p>{proposal.value.summary}</p>{proposal.value.questions.length ? <><ul>{proposal.value.questions.map((q, i) => <li key={i}>{q}</li>)}</ul><p>질문의 답을 요청에 보완한 뒤 다시 확인해 주세요. 아직 반영할 조건은 없습니다.</p></> : <><ul>{proposal.value.changes.map((c, i) => { const slot = props.basis?.slots.find(s => s.id === c.slotId); const target = 'resourceId' in c ? props.basis?.resources.find(r => r.id === c.resourceId)?.label : props.basis?.lessons.find(l => l.id === c.lessonId)?.label; return <li key={i}>{target} · {slot ? `${['', '월', '화', '수', '목', '금', '토', '일'][slot.day]} ${slot.label}` : '시간대 확인 필요'} · {c.kind === 'fix' ? '반드시 배치' : c.kind === 'block' ? '배치 불가' : `가능하면 피하기 ${c.weight}`}</li> })}</ul><label><input type="checkbox" checked={confirmed} disabled={locked || props.disabled} onChange={e => setConfirmed(e.target.checked)} />필수·선호와 적용 대상을 확인했습니다</label><button type="button" disabled={!confirmed || locked || props.disabled || !proposal.value.changes.length} onClick={() => void apply()}>확인한 조건 제안 반영</button></>}</section>}
    {rawAnswer && !proposal && <details><summary>받은 답변 살펴보기</summary><p style={{ whiteSpace: 'pre-wrap' }}>{rawAnswer}</p></details>}
  </details>
}
