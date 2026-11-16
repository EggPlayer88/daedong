import { useEffect, useLayoutEffect, useRef, useState, useId } from 'react'
import type { CalendarEvent, Membership } from '../contracts'
import { canEdit } from '../domain'
import { ModuleError } from '../cooperation/protocol'
import { usePendingRequest, recoveryScope } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import type { WorkflowResultListener } from '../app/workflow-results'
import type { CalendarAdapter } from './contracts'
import { cancelCommand, type CalendarCancelCommand } from './lifecycle'
import { eventTiming } from './formatting'

export interface CalendarCancelDraft { eventId: string; reason: string }

export function CalendarCancellation({ eventId, member, date, adapter, onClose, onCancelled, onNavigationLockChange, onWorkflowResult }: {
  eventId: string; member: Membership; date: string; adapter: CalendarAdapter; onClose: () => void;
  onCancelled: (event: CalendarEvent) => void; onNavigationLockChange?: (locked: boolean) => void; onWorkflowResult?: WorkflowResultListener
}) {
  const reasonId = useId()
  const recovery = usePendingRequest(member, 'calendarLifecycle')
  const memory = useEditDraft<CalendarCancelDraft>(member, 'calendar-cancel')
  const [reason, setReason] = useState(memory.initial?.eventId === eventId ? memory.initial.reason : '')
  const [event, setEvent] = useState<CalendarEvent>()
  const [checked, setChecked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const inFlight = useRef(false), finished = useRef(false), alive = useRef(true), epoch = useRef(0)
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = recovery.request
  const locked = busy || Boolean(pending) || Boolean(reason.trim())
  useEffect(() => { onNavigationLockChange?.(locked); return () => onNavigationLockChange?.(false) }, [locked,onNavigationLockChange])
  useLayoutEffect(() => { if (!finished.current) memory.save({eventId,reason}, Boolean(reason.trim())) }, [memory,eventId,reason])
  useEffect(() => {
    alive.current = true
    const element=dialog.current, root=element?.getRootNode()
    const previous=(root instanceof ShadowRoot ? root.activeElement : document.activeElement) as HTMLElement | null
    element?.showModal()
    return () => { alive.current=false; epoch.current++; element?.close(); if (previous?.isConnected) previous.focus() }
  }, [])
  useEffect(() => {
    let active=true
    inFlight.current=false; setBusy(false)
    setLoading(true); setEvent(undefined); setChecked(false)
    adapter.get(member.id,eventId).then(value => { if (active) setEvent(value) }).catch(() => { if (active) setError('일정 원본을 불러오지 못했습니다. 이전 요청이 있다면 같은 번호로 결과를 확인할 수 있습니다.') }).finally(() => { if(active)setLoading(false) })
    return () => { active=false; epoch.current++ }
  }, [adapter,member.id,eventId,date,refresh])
  function close() { if (busy || pending) return; finished.current=true; memory.remove(); onClose() }
  async function send(mode: 'new'|'recover'|'retry') {
    if (inFlight.current || !adapter.lifecycle) return
    if (mode==='new' && (pending || !event || !checked || !canEdit(event,member,date) || loading)) return
    if (mode!=='new' && !pending) return
    let command:CalendarCancelCommand, key:string
    try {
      command=cancelCommand(mode==='new' ? {eventId,expectedVersion:event!.version,reason:reason.trim()} : pending!.command)
      if(command.eventId!==eventId)throw Error('다른 일정의 보관 요청입니다. 목록에서 원래 요청을 확인해 주세요.')
      key=mode==='new' ? crypto.randomUUID() : pending!.key
    } catch(failure) { setError(failure instanceof Error ? failure.message : '취소 입력을 확인해 주세요.'); return }
    const generation=epoch.current, current=()=>alive.current&&epoch.current===generation
    inFlight.current=true; setBusy(true); setError(''); recovery.put({command,key})
    try {
      const receipt=await (mode==='recover' ? adapter.lifecycle.recoverCancel(member.id,command,key) : adapter.lifecycle.cancel(member.id,command,key))
      if(!current())return
      recovery.remove(key); finished.current=true; memory.remove()
      if(onWorkflowResult)try { onWorkflowResult({kind:'calendar',action:'cancel',scope:recoveryScope(member),key,recordedAt:receipt.recordedAt,eventId:receipt.event.id,eventVersion:receipt.event.version}) } catch { /* 보조 결과 표시 실패로 취소를 재실행하지 않는다. */ }
      try { onCancelled(receipt.event) } catch { setEvent(receipt.event); setError('일정 취소는 완료했습니다. 목록을 다시 확인해 주세요.') }
    } catch(failure) {
      if(!current())return
      // 미접수 조회는 늦은 최초 요청의 실패를 뜻하지 않는다. 명시된 확정 거절만 원키를 해제한다.
      if(failure instanceof ModuleError && failure.definitive) { recovery.remove(key); setChecked(false); setBusy(false); setRefresh(value=>value+1) }
      setError(failure instanceof Error ? failure.message : '취소 결과를 확인하지 못했습니다. 원래 요청을 보관했습니다.')
    } finally { if(current()) { inFlight.current=false; setBusy(false) } }
  }
  return <dialog ref={dialog} className="detail-dialog" aria-labelledby="calendar-cancel-title" onCancel={e=>{e.preventDefault();close()}}>
    <header className="dialog-header"><h2 id="calendar-cancel-title">일정 취소</h2><button type="button" className="icon-button" aria-label="일정 취소 창 닫기" disabled={busy||Boolean(pending)} onClick={close}>✕</button></header>
    <div className="dialog-body">
      {error&&<p className="error-box" role="alert">{error}</p>}
      {loading?<p role="status">일정 확인 중…</p>:event?<><h3>{event.title}</h3><p>{eventTiming(event).description}{event.location ? ` · ${event.location}` : ''}</p>
        {event.status==='cancelled'&&<p className="notice-box">취소된 일정 · {event.cancelReason}</p>}</>:<button className="secondary" disabled={busy} onClick={()=>setRefresh(n=>n+1)}>원본 다시 확인</button>}
      {pending?<section className="notice-box" aria-label="일정 취소 결과 확인"><h3>{busy?'취소 요청을 확인하고 있습니다':'취소 결과를 먼저 확인해 주세요'}</h3><p>원래 요청 번호를 보관했습니다. 결과 확인은 조회만 하며, 재전송도 같은 번호를 사용합니다.</p>
        <button className="primary" disabled={busy} onClick={()=>void send('recover')}>취소 결과 확인</button>
        <button className="secondary" disabled={busy} onClick={()=>void send('retry')}>같은 취소 요청 다시 보내기</button></section>
        :event&&event.status!=='cancelled'&&canEdit(event,member,date)?<><label htmlFor={reasonId}>취소 사유</label><textarea id={reasonId} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);setChecked(false)}} rows={3}/><p className="hint">일정과 취소 이력은 남고, 진행 예정 일정에서는 빠집니다.</p><label><input type="checkbox" checked={checked} disabled={busy} onChange={e=>setChecked(e.target.checked)}/>위 일정과 취소 사유를 확인했습니다.</label></>:!loading&&event&&event.status!=='cancelled'?<p>현재 계정으로 이 일정을 취소할 수 없습니다.</p>:null}
      {!adapter.lifecycle&&<p role="status">일정 취소 연결을 준비하고 있습니다.</p>}
    </div>
    <footer className="dialog-footer"><button className="secondary" disabled={busy} onClick={pending ? onClose : close}>{pending ? '요청 보관하고 닫기' : '돌아가기'}</button>{!pending&&event&&canEdit(event,member,date)&&<button className="primary" disabled={busy||loading||!checked||!reason.trim()||!adapter.lifecycle} onClick={()=>void send('new')}>이 일정 취소</button>}</footer>
  </dialog>
}
