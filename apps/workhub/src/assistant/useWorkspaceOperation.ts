import { useEffect, useRef, useState } from 'react'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import type { Membership } from '../contracts'
import { activeAt } from '../domain'
import type { AssistantWorkspaceActions } from './workspace-model'
import { WorkspaceOperationError, type WorkspaceOperationReview, type WorkspaceOperationReceipt } from './workspace-operations'

type OperationState = {
  review: WorkspaceOperationReview
  prompt: string
  status: 'review' | 'saving' | 'pending' | 'saved' | 'error'
  receipt?: WorkspaceOperationReceipt
  error?: string
}

// 확정 전 비교표와 미확정 원요청은 대화 답변과 분리한다. 모델 출력으로 저장을 실행하지 않는다.
export function useWorkspaceOperation({ member, date, actions, onSaved }: {
  member: Membership; date: string; actions?: AssistantWorkspaceActions['operations']
  onSaved: (prompt: string) => void
}) {
  const recovery = usePendingRequest(member, 'assistantOperation')
  const draft = useEditDraft<OperationState>(member, 'assistant-operation')
  const scope = recoveryScope(member)
  const [state, setState] = useState<OperationState | undefined>(() => {
    if (recovery.request) {
      const value = recovery.request.command as OperationState
      if (value?.review?.key === recovery.request.key && typeof value.prompt === 'string')
        return { ...value, status: 'pending' }
    }
    return draft.initial
  })
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState('')
  const current = useRef(state), flight = useRef(false), life = useRef(0)
  const latest = useRef({ actions, member, date, onSaved })
  latest.current = { actions, member, date, onSaved }
  useEffect(() => () => { life.current++ }, [scope])
  function store(value: OperationState | undefined) {
    current.current = value
    draft.save(value, Boolean(value && value.status !== 'saved'))
    setState(value)
  }
  const hasPending = Boolean(recovery.request)
  const locked = preparing || hasPending || Boolean(state && state.status !== 'saved')

  async function prepare(prompt: string, create: () => Promise<WorkspaceOperationReview>) {
    if (flight.current || hasPending || current.current && current.current.status !== 'saved' || !actions || !activeAt(member, date)) return
    const epoch = life.current
    flight.current = true; setPreparing(true); setError('')
    try {
      const review = await create()
      if (epoch !== life.current) return
      store({ review, prompt, status: 'review' })
    } catch (cause) {
      if (epoch === life.current) setError(cause instanceof Error ? cause.message : '변경할 내용을 확인하지 못했습니다. 입력은 유지됩니다.')
    } finally {
      if (epoch === life.current) { flight.current = false; setPreparing(false) }
    }
  }
  async function confirm(retry = false) {
    const saved = current.current, context = latest.current
    if (flight.current || !saved || !context.actions || !activeAt(context.member, context.date) ||
      (retry ? !recovery.request : Boolean(recovery.request) || saved.status !== 'review')) return
    const epoch = life.current
    flight.current = true; setError('')
    // 원키·원문을 전송 전에 저장한다. 재확인에는 이 사본을 그대로 사용한다.
    const original = retry ? recovery.request!.command as OperationState : structuredClone(saved)
    if (!original.review || original.review.key !== (retry ? recovery.request!.key : saved.review.key)) {
      flight.current = false; setError('보관한 요청을 읽지 못했습니다. 새 요청을 보내지 않고 원래 요청을 유지합니다.'); return
    }
    recovery.put({ key: original.review.key, command: original })
    store({ ...original, status: 'saving', error: undefined })
    try {
      const receipt = await context.actions.execute(original.review, retry)
      if (epoch !== life.current) return
      recovery.remove(original.review.key)
      store({ ...original, status: 'saved', receipt, error: undefined })
      context.onSaved(original.prompt)
    } catch (cause) {
      if (epoch !== life.current) return
      const definite = cause instanceof WorkspaceOperationError && cause.outcome === 'not_saved'
      if (definite) recovery.remove(original.review.key)
      store({ ...original, status: definite ? 'error' : 'pending', error: cause instanceof Error ? cause.message : '처리 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.' })
    } finally { if (epoch === life.current) flight.current = false }
  }
  function cancel() {
    if (flight.current || recovery.request) return
    store(undefined); setError('')
  }
  return {
    state, preparing, locked, error, prepare, confirm: () => void confirm(), retry: () => void confirm(true), cancel,
    unreadable: hasPending && !state,
  }
}
