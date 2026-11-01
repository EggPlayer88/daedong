import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { canonical, ServiceError } from '../services/service-values'
import type { GuidedService } from './guided-adapter'
import type { TemplateDetail } from './guided-contracts'
import { applyGuidedAiAnswer, guidedAiSuggestion, verifyGuidedAiSource, type GuidedAiOrigin, type GuidedAiSuggestion } from './guided-ai'

interface Props {
  member: Membership; origin: GuidedAiOrigin; suggestion: GuidedAiSuggestion; selected: TemplateDetail
  input: Record<string, string>; service: GuidedService; disabled: boolean
  onBusyChange: (busy: boolean) => void; onApply: (input: Record<string, string>) => void; onDismiss: () => void
}

export function GuidedAiReview(props: Props) {
  const id = useId(), [questionId, setQuestionId] = useState(''), [body, setBody] = useState(''), [confirmed, setConfirmed] = useState(''), [checking, setChecking] = useState(false), [verified, setVerified] = useState(''), [error, setError] = useState(''), [retry, setRetry] = useState(0)
  const latest = useRef(props), epoch = useRef(0), running = useRef(false)
  latest.current = props
  let suggestion: GuidedAiSuggestion | undefined
  try {
    suggestion = guidedAiSuggestion(props.suggestion, props.member)
    if (canonical(suggestion.origin) !== canonical(props.origin)) suggestion = undefined
  } catch { /* 다른 범위와 손상된 제안의 본문은 표시하지 않는다. */ }
  const sourceKey = canonical([suggestion?.requestId, props.origin, props.selected, props.disabled]), fingerprint = canonical([sourceKey, questionId, body, props.input])
  useEffect(() => { setBody(suggestion?.body ?? ''); setQuestionId(''); setConfirmed('') }, [suggestion?.requestId])
  useEffect(() => {
    const turn = ++epoch.current
    setVerified(''); setError('')
    if (!suggestion || props.disabled) { setChecking(false); return }
    setChecking(true)
    void props.service.get(props.member.id, props.origin.templateId).then(value => {
      verifyGuidedAiSource(props.origin, value, props.member)
      verifyGuidedAiSource(props.origin, props.selected, props.member)
      if (epoch.current === turn) setVerified(sourceKey)
    }).catch(() => { if (epoch.current === turn) setError('원래 양식과 저장 답변의 판을 확인하지 못했습니다. 기존 입력은 유지합니다.') }).finally(() => { if (epoch.current === turn) setChecking(false) })
    return () => { epoch.current++ }
  }, [sourceKey, retry, props.service, props.member])
  useEffect(() => () => { epoch.current++; props.onBusyChange(false) }, [])
  let inputProblem = ''
  if (questionId) { try { applyGuidedAiAnswer(props.origin, props.input, questionId, body) } catch { inputProblem = '선택한 질문의 형식과 글자 수를 확인해 주세요. 제안은 자동으로 자르지 않습니다.' } }
  async function apply() {
    if (!suggestion || running.current || props.disabled || verified !== sourceKey || confirmed !== fingerprint || !questionId || inputProblem) return
    const turn = epoch.current, before = canonical([latest.current.origin, latest.current.selected, latest.current.input, latest.current.suggestion])
    running.current = true; props.onBusyChange(true); setChecking(true); setError('')
    try {
      const fresh = await props.service.get(props.member.id, props.origin.templateId)
      verifyGuidedAiSource(props.origin, fresh, props.member)
      if (turn !== epoch.current || latest.current.disabled || before !== canonical([latest.current.origin, latest.current.selected, latest.current.input, latest.current.suggestion])) return
      props.onApply(applyGuidedAiAnswer(props.origin, latest.current.input, questionId, body))
      setConfirmed(''); setError('선택한 질문의 입력에 반영했습니다. 답변 저장과 파일 생성은 별도로 진행해 주세요.')
    } catch { if (turn === epoch.current) { setVerified(''); setError('양식이나 저장 답변이 바뀌었거나 확인에 실패했습니다. 입력을 반영하지 않았습니다.') } }
    finally { running.current = false; props.onBusyChange(false); if (turn === epoch.current) setChecking(false) }
  }
  if (!suggestion) return <section role="alert">이 양식으로 돌아온 제안인지 확인하지 못했습니다. 현재 답변은 유지합니다.</section>
  const ready = verified === sourceKey && !props.disabled && !checking
  return <section className="documents-panel" aria-label="질문별 AI 제안 비교">
    <h3>원래 양식의 답변과 비교</h3><p>AI 제안은 자동으로 질문에 배정하지 않습니다. 반영할 질문과 내용을 직접 확인해 주세요.</p>
    {checking && <p role="status">원래 양식과 저장 답변을 다시 확인하는 중…</p>}{error && <p role="status">{error}</p>}
    {!ready && !checking && <button type="button" disabled={props.disabled} onClick={() => setRetry(value => value + 1)}>양식과 답변 다시 확인</button>}
    {ready && <><p>양식 v{props.origin.templateVersion} · 도움을 요청할 때의 답변판 {props.origin.responseVersion || '저장 전'}</p>
      <label htmlFor={`${id}-question`}>제안을 반영할 질문<select aria-label="제안을 반영할 질문" id={`${id}-question`} value={questionId} onChange={event => { setQuestionId(event.target.value); setConfirmed('') }}><option value="">질문을 직접 선택해 주세요</option>{props.origin.mapping.questions.map(q => <option key={q.id} value={q.id}>{q.label}</option>)}</select></label>
      {questionId && <div className="documents-comparison"><div><h4>현재 작성 중인 답변</h4><p className="documents-body">{props.input[questionId] || '(비어 있음)'}</p><h4>도움을 요청할 때의 답변</h4><p className="documents-body">{props.origin.answers[questionId] || '(비어 있음)'}</p></div><div><label htmlFor={`${id}-body`}>선택한 질문에 반영할 내용<textarea aria-label="선택한 질문에 반영할 내용" id={`${id}-body`} rows={6} value={body} onChange={event => { setBody(event.target.value); setConfirmed('') }}/></label><p>질문에 맞는 부분만 남기고 사실·숫자·날짜를 직접 확인해 주세요.</p></div></div>}
      {inputProblem && <p role="alert">{inputProblem}</p>}
      <label className="documents-check"><input type="checkbox" disabled={!questionId || Boolean(inputProblem)} checked={confirmed === fingerprint} onChange={event => setConfirmed(event.target.checked ? fingerprint : '')}/>선택한 질문과 현재 답변을 비교했습니다</label>
      <button type="button" disabled={!questionId || Boolean(inputProblem) || confirmed !== fingerprint} onClick={() => void apply()}>선택한 질문에만 반영</button>
    </>}
    {ready && <details><summary>돌아온 AI 제안 원문</summary><p className="documents-body">{suggestion.body}</p></details>}
    <button type="button" disabled={checking || props.disabled} onClick={props.onDismiss}>제안 닫고 답변 계속 작성</button>
  </section>
}
