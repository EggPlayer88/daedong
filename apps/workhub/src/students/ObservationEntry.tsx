import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { activityInputIssues, observationInputIssues, observationLimits, type EntryIssue, type ObservationInput } from './entry'

interface Target { student: string; course: string; date: string; valid: boolean }
function focusIssue(container: HTMLElement | null, issue?: EntryIssue) {
  if (!container || !issue) return
  const target = container.querySelector<HTMLElement>(`[data-entry-field="${issue.field}"]`)
  target?.focus(); target?.scrollIntoView({ block: 'nearest' })
}
function EntryIssues({ issues, container }: { issues: EntryIssue[]; container: React.RefObject<HTMLElement> }) {
  return issues.length ? <div className="students-entry-errors" role="alert"><strong>저장 전에 확인해 주세요.</strong><ul>{issues.map(issue => <li key={issue.field}><button type="button" onClick={() => focusIssue(container.current, issue)}>{issue.message}</button></li>)}</ul></div> : null
}
function TargetSummary({ target, editing }: { target: Target; editing?: boolean }) {
  return <div className={`students-entry-target ${target.valid ? '' : 'unavailable'}`} tabIndex={-1} data-entry-field="target"><span>{editing ? '정정하는 기록의 대상' : '이번에 기록할 대상'}</span><strong>{target.student}</strong><p>{target.course} · {target.date}</p>{!target.valid && <p>해당 날짜의 수업·명부를 확인할 수 없어 저장할 수 없습니다.</p>}</div>
}

export function ObservationEntry({ input, target, version, dirty, resetToken, onChange, onSave, onCancel }: {
  input: ObservationInput; target: Target; version?: number; dirty: boolean; resetToken: number
  onChange: (patch: Partial<ObservationInput>) => void; onSave: () => void; onCancel: () => void
}) {
  const id = useId(), container = useRef<HTMLElement>(null), [attempted, setAttempted] = useState(false)
  useEffect(() => setAttempted(false), [resetToken, version])
  const issues = observationInputIssues(input, target.valid, Boolean(version)), visible = attempted ? issues : []
  const issue = (field: EntryIssue['field']) => visible.find(item => item.field === field)
  function submit(event: FormEvent) { event.preventDefault(); setAttempted(true); if (issues.length) focusIssue(container.current, issues[0]); else onSave() }
  return <article className="students-card students-entry" ref={container}><h2>{version ? `관찰 기록 정정 · v${version} 기준` : '빠른 관찰 기록'}</h2>
    <TargetSummary target={target} editing={Boolean(version)} /><p className="students-muted">관찰일에 직접 확인한 말이나 행동을 적습니다. {version ? '이전 내용은 보존하고 새 개정본으로 저장합니다.' : '저장 후에도 선택한 학생과 수업을 유지합니다.'}</p>
    <form className="students-form" noValidate onSubmit={submit}>
      <EntryIssues issues={visible} container={container} />
      <label>활동<input aria-label="활동" data-entry-field="activity" name="student-activity" value={input.activity} maxLength={observationLimits.activity} onChange={event => onChange({ activity: event.target.value })} placeholder="예: 자료 공유 토의" required aria-invalid={Boolean(issue('activity'))} aria-describedby={`${id}-activity-help`} /></label><p id={`${id}-activity-help`} className="students-field-help">{issue('activity')?.message ?? '어떤 수업 활동에서 관찰했는지 적어 주세요.'}<span>{input.activity.length} / {observationLimits.activity}자</span></p>
      <label>직접 확인한 사실<textarea aria-label="직접 확인한 사실" data-entry-field="content" name="student-observation" rows={4} value={input.content} maxLength={observationLimits.content} onChange={event => onChange({ content: event.target.value })} placeholder="학생이 실제로 말하거나 수행한 내용을 적어 주세요." required aria-invalid={Boolean(issue('content'))} aria-describedby={`${id}-content-help`} /></label><p id={`${id}-content-help`} className="students-field-help">{issue('content')?.message ?? '성격이나 능력을 추정하지 않고 관찰한 사실을 남겨 주세요.'}<span>{input.content.length} / {observationLimits.content}자</span></p>
      {version && <><label>정정 사유<input aria-label="정정 사유" data-entry-field="reason" name="student-reason" value={input.reason} onChange={event => onChange({ reason: event.target.value })} maxLength={observationLimits.reason} required aria-invalid={Boolean(issue('reason'))} aria-describedby={`${id}-reason-help`} /></label><p id={`${id}-reason-help`} className="students-field-help">{issue('reason')?.message ?? '어떤 사실을 다시 확인해 수정하는지 남겨 주세요.'}<span>{input.reason.length} / {observationLimits.reason}자</span></p></>}
      <label className="students-check"><input data-entry-field="confirmed" type="checkbox" checked={input.confirmed} onChange={event => onChange({ confirmed: event.target.checked })} aria-invalid={Boolean(issue('confirmed'))} aria-describedby={issue('confirmed') ? `${id}-confirmed-error` : undefined} />직접 확인한 사실이며 이 학생의 기록임을 확인했습니다.</label>{issue('confirmed') && <p id={`${id}-confirmed-error`} className="students-field-error">{issue('confirmed')!.message}</p>}
      <div className="button-row"><button className="primary" type="submit">{version ? '새 개정본 저장' : '관찰 저장'}</button>{dirty && <button className="secondary" type="button" onClick={onCancel}>{version ? '정정 취소' : '기록 입력 취소'}</button>}</div>
    </form>
  </article>
}

export function ActivityObservationEntry({ content, confirmed, target, sourceRevision, onChange, onSave, onCancel }: {
  content: string; confirmed: boolean; target: Target; sourceRevision: number
  onChange: (content: string, confirmed: boolean) => void; onSave: () => void; onCancel: () => void
}) {
  const id = useId(), container = useRef<HTMLDivElement>(null), [attempted, setAttempted] = useState(false)
  const issues = activityInputIssues(content, confirmed, target.valid), visible = attempted ? issues : []
  const factIssue = visible.find(item => item.field === 'content'), confirmIssue = visible.find(item => item.field === 'confirmed')
  return <div className="students-adopt-entry" ref={container}><TargetSummary target={target} /><p className="students-muted">학생 연결이 확정된 대상입니다. 원문 판 {sourceRevision}의 질문과 응답을 확인하고 본인 관찰로 채택합니다.</p>
    <form className="students-form" noValidate onSubmit={event => { event.preventDefault(); setAttempted(true); if (issues.length) focusIssue(container.current, issues[0]); else onSave() }}>
      <EntryIssues issues={visible} container={container} />
      <label>교사가 확인한 관찰 사실<textarea aria-label="교사가 확인한 관찰 사실" data-entry-field="content" rows={3} value={content} onChange={event => onChange(event.target.value, confirmed)} maxLength={observationLimits.content} required placeholder="답변에서 직접 확인한 사실을 적습니다." aria-invalid={Boolean(factIssue)} aria-describedby={`${id}-fact-help`} /></label><p id={`${id}-fact-help`} className="students-field-help">{factIssue?.message ?? '답변을 그대로 성취·인성으로 추정하지 않습니다.'}<span>{content.length} / {observationLimits.content}자</span></p>
      <label className="students-check"><input data-entry-field="confirmed" type="checkbox" checked={confirmed} onChange={event => onChange(content, event.target.checked)} aria-invalid={Boolean(confirmIssue)} aria-describedby={confirmIssue ? `${id}-confirmed-error` : undefined} />원문·질문·학생 연결을 직접 검토했습니다.</label>{confirmIssue && <p id={`${id}-confirmed-error`} className="students-field-error">{confirmIssue.message}</p>}
      <div className="button-row"><button className="primary" type="submit">내 관찰로 채택</button><button className="secondary" type="button" onClick={() => { setAttempted(false); onCancel() }}>활동 입력 취소</button></div>
    </form>
  </div>
}
