import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import { canonical } from '../services/scoped-rpc'
import { requestBlobDownload } from '../files/download'
import { buildCpSatRequest, parseCpSatResponse, type CpSatRequest, type CpSatResponse } from '../../../../packages/timetable/src/cpSat'
import { validatePlacements } from '../../../../packages/timetable/src/validate'
import enginePolicy from '../../../../packages/timetable/_assets/engine-policy.json'
import type { Placement, TimetableBasis } from './contracts'
import type { PreviousTimetable } from '../../../../packages/timetable/src/quality'
import { prepareScopedSolve } from './foundation'
import { TimetableCandidateReview } from './TimetableCandidateReview'
import { reviewTimetablePreflight } from './preflight'
import { LocalTimetableEngine } from './LocalTimetableEngine'

interface EngineSession { fingerprint: string; request: CpSatRequest; response?: CpSatResponse; scope: 'all' | 'selected' }
interface Props {
  member: Membership; basis: TimetableBasis; placements: Placement[] | null; lockedLessonIds: string[]; scopeResourceId: string
  disabled: boolean; onAdopt: (placements: Placement[]) => void
  previous?: PreviousTimetable
}
const resultLabels: Record<CpSatResponse['status'], string> = {
  feasible: '검사를 통과한 후보를 찾았습니다', infeasible: '요청한 조건으로 가능한 배치가 없다고 엔진이 판정했습니다', unknown: '계산 한도 안에 결론을 내리지 못했습니다', invalid: '요청 자료를 먼저 확인해 주세요', unsupported: '지원하지 않는 조건이 있습니다', error: '계산 중 오류가 발생했습니다',
}
export function TimetableEnginePanel(props: Props) {
  const id = useId(), memory = useEditDraft<EngineSession>(props.member, 'timetable-cpsat')
  const [session, setSession] = useState<EngineSession | undefined>(memory.initial), [scope, setScope] = useState<'all' | 'selected'>(memory.initial?.scope ?? 'all')
  const [seconds, setSeconds] = useState(String(memory.initial?.request.options.maxSeconds ?? enginePolicy.defaultMaxSeconds)), [candidates, setCandidates] = useState(String(memory.initial?.request.options.maxCandidates ?? 1))
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [selected, setSelected] = useState(0), [confirmed, setConfirmed] = useState(false)
  const [localLocked, setLocalLocked] = useState(false), localLock = useRef(false)
  const changeLocalLock = useCallback((locked: boolean) => { localLock.current = locked; setLocalLocked(locked) }, [])
  const life = useRef(0), operation = useRef(false), latest = useRef(props), input = useRef<HTMLInputElement>(null)
  latest.current = props
  const fingerprint = canonical([props.basis, props.placements, props.previous ?? null, props.lockedLessonIds, scope, scope === 'selected' ? props.scopeResourceId : '', seconds, candidates])
  const latestFingerprint = useRef(fingerprint); latestFingerprint.current = fingerprint
  const latestSession = useRef(session); latestSession.current = session
  const current = Boolean(session && session.fingerprint === fingerprint), candidate = current ? session?.response?.candidates[selected] : undefined
  useEffect(() => () => { life.current++ }, [])
  useEffect(() => { setConfirmed(false) }, [fingerprint, props.disabled])
  function keep(value: EngineSession | undefined) { latestSession.current = value; setSession(value); memory.save(value, false) }
  function downloadRequest(request: CpSatRequest) {
    requestBlobDownload(new Blob([JSON.stringify(request, null, 2)], { type: 'application/json' }), `timetable-request-${request.requestId}.json`)
  }
  async function prepare(download = true): Promise<CpSatRequest | null> {
    if (latest.current.disabled || operation.current || localLock.current || scope === 'selected' && !props.scopeResourceId) return null
    const prepared = prepareScopedSolve(props.basis, props.placements, props.lockedLessonIds, scope === 'selected' ? props.scopeResourceId : '')
    if (!prepared.basis) { setError(prepared.issues.map(issue => issue.message).join(' ')); return null }
    const preflight = reviewTimetablePreflight(prepared.basis)
    if (!preflight.canCalculate) { setError(preflight.issues.map(issue => issue.message).join(' ')); return null }
    const epoch = life.current, source = fingerprint
    operation.current = true; setBusy(true); setError(''); setNotice(''); setConfirmed(false)
    try {
      const previous = props.previous && validatePlacements(props.previous.basis, props.previous.placements).valid ? props.previous : props.placements && validatePlacements(props.basis, props.placements).valid ? { basis: props.basis, placements: props.placements } : null
      const request = await buildCpSatRequest(prepared.basis, crypto.randomUUID(), previous, { maxSeconds: Number(seconds), maxCandidates: Number(candidates) })
      if (epoch !== life.current || latest.current.disabled || latestFingerprint.current !== source) return null
      keep({ fingerprint: source, request, scope }); setSelected(0)
      if (download) { downloadRequest(request); setNotice('계산 요청 파일의 내려받기를 요청했습니다. 아직 계산하거나 학교에 저장한 결과는 아닙니다.') }
      return request
    } catch (failure) { if (epoch === life.current) setError(failure instanceof Error ? failure.message : '계산 요청 파일을 준비하지 못했습니다.') }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false) } }
    return null
  }
  function receiveLocalResult(request: CpSatRequest, response: CpSatResponse) {
    const original = latestSession.current
    if (latest.current.disabled || !original || original.request.requestId !== request.requestId || original.request.inputHash !== request.inputHash || original.fingerprint !== latestFingerprint.current) return false
    keep({ ...original, response }); setSelected(0); setConfirmed(false); setError(''); setNotice('PC 계산 결과를 검증했습니다. 후보를 비교한 뒤 직접 채택해 주세요.')
    return true
  }
  async function load(file: File | undefined) {
    if (!file || !session || !current || latest.current.disabled || operation.current || localLock.current) return
    if (!/\.json$/i.test(file.name) || file.size > enginePolicy.maximumRequestBytes) { setError('계산 엔진에서 만든 한도 이내의 JSON 결과 파일을 선택해 주세요.'); return }
    const epoch = life.current, source = fingerprint, original = session
    operation.current = true; setBusy(true); setError(''); setNotice(''); setConfirmed(false)
    try {
      const response = await parseCpSatResponse(original.request, JSON.parse(await file.text()))
      if (epoch !== life.current || latest.current.disabled || latestFingerprint.current !== source) return
      keep({ ...original, response }); setSelected(0); setNotice('원래 계산 요청과 후보 전체를 다시 검사했습니다. 후보를 선택하고 직접 반영해 주세요.')
    } catch (failure) { if (epoch === life.current) setError(failure instanceof Error ? failure.message : '계산 결과 파일을 확인하지 못했습니다. 현재 초안은 유지합니다.') }
    finally { if (epoch === life.current) { operation.current = false; setBusy(false); if (input.current) input.current.value = '' } }
  }
  function adopt() {
    if (!confirmed || !candidate || !current || props.disabled || busy || !validatePlacements(props.basis, candidate.placements).valid) return
    props.onAdopt(structuredClone(candidate.placements)); keep(undefined); setConfirmed(false); setNotice('선택한 후보를 작업 초안에 반영했습니다. 학교 서버 저장과 확정은 별도입니다.')
  }
  return <details className="timetable-card"><summary>최적화 엔진으로 계산·후보 비교</summary>
    <p>브라우저 계산과 같은 공식 자료·필수조건으로 최적화 후보를 비교합니다. 담당자 PC의 계산기를 연결하거나 계산 파일을 직접 주고받을 수 있습니다.</p>
    <fieldset disabled={props.disabled || busy || localLocked}><div className="timetable-grid"><label>최적화 범위<select aria-label="최적화 범위" value={scope} onChange={event => setScope(event.target.value as typeof scope)}><option value="all">전체 · 작업 고정 유지</option><option value="selected" disabled={!props.scopeResourceId}>현재 선택 대상만</option></select></label><label>계산 시간 한도(초)<input type="number" min="1" max={enginePolicy.maximumMaxSeconds} value={seconds} onChange={event => setSeconds(event.target.value)} /></label><label>비교할 후보 수<select value={candidates} onChange={event => setCandidates(event.target.value)}>{Array.from({ length: enginePolicy.maximumCandidates }, (_, index) => <option key={index} value={index + 1}>{index + 1}개 이내</option>)}</select></label></div><button type="button" onClick={() => void prepare()}>최적화 요청 파일 만들기</button></fieldset>
    <LocalTimetableEngine member={props.member} disabled={props.disabled} requestId={session?.request.requestId} current={current} onCreate={() => prepare(false)} onResult={receiveLocalResult} onRequestLockChange={changeLocalLock} />
    {localLocked && <p className="timetable-notice">원래 PC 계산의 결과를 확인하거나 작업 연결을 정리한 뒤 새 계산 요청을 만들 수 있습니다.</p>}
    {busy && <p role="status">요청 지문과 전체 후보를 검사하는 중…</p>}{error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {session && !current && <p className="timetable-notice">기준자료·조건·현재 배치 또는 계산 설정이 바뀌었습니다. 이전 결과를 채택하지 않습니다. 새 요청 파일을 만들어 주세요.</p>}
    {session && current && <section aria-label="최적화 계산 요청"><p className="timetable-muted">요청 번호 {session.request.requestId} · 후보가 없는 경우도 정상적인 결과입니다.</p><details><summary>계산 파일 실행 방법</summary><p>저장소의 시간표 엔진 실행 안내대로 Python 환경을 준비한 뒤 요청 JSON을 실행합니다. 실행 결과 JSON을 아래에 가져와 주세요. 파일에는 교사·학급 정보가 포함됩니다.</p><pre>python packages/timetable/engine/runner.py --input "요청.json" --output "결과.json"</pre><p>요청·결과 이름은 내려받은 실제 파일명으로 바꿔 주세요. 기존 결과 파일은 덮어쓰지 않습니다. 서버 연결 이후에는 같은 요청·결과 계약으로 이 단계를 자동화합니다.</p></details><button type="button" className="secondary" disabled={props.disabled || busy} onClick={() => downloadRequest(session.request)}>같은 계산 요청 파일 다시 받기</button><label htmlFor={`${id}-result`}>최적화 결과 JSON 가져오기</label><input id={`${id}-result`} ref={input} type="file" accept=".json,application/json" disabled={props.disabled || busy || localLocked} onChange={event => void load(event.target.files?.[0])} />
      {session.response && <><h3>{resultLabels[session.response.status]}</h3><p className="timetable-muted">엔진 {session.response.engineVersion} · {Math.round(session.response.stats.elapsedMs)}ms · {session.response.stats.stoppedByLimit ? '계산 한도 도달' : '계산 종료'}</p>{session.response.status === 'unknown' && <p>시간표가 불가능하다는 뜻은 아닙니다. 계산 시간이나 조건을 검토해 주세요.</p>}{session.response.issues.length > 0 && <ul>{session.response.issues.map((issue, index) => <li key={index}>{issue.message}</li>)}</ul>}
      {session.response.candidates.length > 0 && <><div className="timetable-engine-candidates">{session.response.candidates.map((value, index) => <label className="timetable-engine-candidate" key={index}><input type="radio" name={`${id}-candidate`} value={index} checked={selected === index} disabled={props.disabled || busy} onChange={() => { setSelected(index); setConfirmed(false) }} /><span><strong>후보 {index + 1}</strong><span>선호 벌점 {value.objective.preferencePenalty} · 교사 하루 최대 {value.objective.teacherPeakPeriods}차시</span><span>{session.request.previous ? `기존 대비 변경 ${value.objective.changedLessons}개` : '처음 편성 · 변경 비교 없음'} · 같은 교과의 같은 날 추가 배치 {value.objective.courseRepeats}개</span><small>{value.optimal ? index === 0 ? '엔진이 이 실행의 목적함수 최적값을 확인했습니다.' : '앞 후보를 제외한 범위에서 목적함수 최적값을 확인했습니다.' : '유효한 후보이며 최적해 증명은 없습니다.'}</small></span></label>)}</div><TimetableCandidateReview key={`${session.request.requestId}:${selected}`} request={session.request} response={session.response} selected={selected} /><label className="timetable-check"><input type="checkbox" checked={confirmed} disabled={props.disabled || busy} onChange={event => setConfirmed(event.target.checked)} />선택한 후보로 현재 작업 배치를 바꿉니다. 기존 배치는 직전 배치로 보관합니다.</label><button type="button" disabled={!confirmed || props.disabled || busy} onClick={adopt}>검사한 후보를 초안에 반영</button></>}</>}
    </section>}
    {session && <button type="button" className="secondary" disabled={busy || localLocked} onClick={() => { if (localLock.current) return; keep(undefined); setConfirmed(false); setNotice('계산 요청·결과 검토 자료를 정리했습니다. 현재 작업 배치는 유지됩니다.') }}>계산 검토 자료 정리</button>}
  </details>
}
