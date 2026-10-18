import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { useEditDraft } from '../app/edit-drafts'
import type { CpSatRequest, CpSatResponse } from '../../../../packages/timetable/src/cpSat'
import { chooseLocalJobs, supportsLocalJobs, terminalJob, type JobStatus, type LocalEngineJobs } from './engine-jobs'

interface SavedJob { queueId: string; request: CpSatRequest; status?: JobStatus; delivered?: boolean; cancelRequested?: boolean }
interface Props { member: Membership; disabled: boolean; requestId?: string; current: boolean; onCreate: () => Promise<CpSatRequest | null>; onResult: (request: CpSatRequest, response: CpSatResponse) => boolean; onRequestLockChange?: (locked: boolean) => void }
const stateLabel = { queued: '계산 대기', running: '계산 중', cancel_requested: '취소 확인 중', succeeded: '계산 완료', failed: '계산 실패', cancelled: '취소 완료', timed_out: '실행 시간 한도 도달', interrupted: '계산기 중단 · 자동 재실행 안 함' }
const failureMessage = (failure: unknown) => failure instanceof Error ? failure.message : '작업 폴더를 읽지 못했습니다. 원래 계산 요청은 보존했습니다.'
const failureActions: Record<string, string> = {
  STORE_FULL: '결과를 저장할 공간이 부족합니다. 완료 작업과 보존 격리 자료를 확인해 공간을 확보한 뒤 새 계산을 시작해 주세요.',
  QUEUE_FULL: '대기 한도를 넘었습니다. 앞선 계산을 완료하거나 취소한 뒤 새 계산을 시작해 주세요.',
  INVALID_REQUEST: '계산 요청의 내용이 올바르지 않습니다. 편성 기준과 조건을 확인한 뒤 새 계산 요청을 만들어 주세요.',
  INVALID_BASIS: '편성 기준에 맞지 않는 값이 있습니다. 준비 화면에서 기준과 조건을 확인해 주세요.',
  RESULT_TOO_LARGE: '계산 결과가 보관 한도를 넘었습니다. 비교할 후보 수를 줄여 새로 계산해 주세요.',
  INVALID_RESULT: '계산 결과 검증을 통과하지 못했습니다. 현재 배치는 유지하며, 요청 번호와 작업 폴더를 담당자에게 알려 주세요.',
  ENGINE_EXITED: '계산기가 정상적으로 결과를 내지 못했습니다. 설치 환경과 요청 번호를 확인해 주세요.',
  ENGINE_START_FAILED: '계산기를 실행하지 못했습니다. Python 설치 환경과 작업 폴더 권한을 확인해 주세요.',
  FILE_LIMIT: '작업 파일이 크기 한도를 넘었습니다. 원래 파일을 보관하고 요청 번호와 함께 담당자에게 알려 주세요.',
  FILE_UNREADABLE: '작업 파일을 온전히 읽지 못했습니다. 폴더 연결과 파일 상태를 확인해 주세요. 손상된 원본을 자동으로 덮어쓰지 않습니다.',
  REQUEST_CONFLICT: '접수한 요청과 현재 파일이 다릅니다. 원래 요청 번호와 파일을 보존하고 복구 절차를 확인해 주세요.',
  IO_ERROR: '작업 파일을 기록하지 못했습니다. 폴더 권한과 디스크 공간을 확인해 주세요. 원래 파일은 자동으로 삭제하지 않습니다.',
  RECOVERY_REQUIRED: '이전 실행이 끝났는지 확인해야 합니다. 계산기를 중지하고 원래 요청의 상태를 복구한 뒤 진행해 주세요.',
}
const failureAction = (code: string | null) => code && Object.hasOwn(failureActions, code) ? failureActions[code] : '실패 원인을 자동으로 판단하지 못했습니다. 요청 번호와 아래 진단 코드를 보관하고 작업 폴더를 확인해 주세요. 현재 배치는 유지합니다.'

export function LocalTimetableEngine(props: Props) {
  const memory = useEditDraft<SavedJob>(props.member, 'timetable-local-engine')
  const [job, setJob] = useState<SavedJob | undefined>(memory.initial), [connection, setConnection] = useState<{ jobs: LocalEngineJobs; name: string }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [watch, setWatch] = useState(false)
  const [workerNote, setWorkerNote] = useState(''), [discard, setDiscard] = useState(false)
  const latest = useRef(props), currentJob = useRef(job), running = useRef(false), life = useRef(0)
  latest.current = props; currentJob.current = job
  const active = !!job && (!job.status || !terminalJob(job.status.state)), sameRequest = !!job && props.current && props.requestId === job.request.requestId
  useEffect(() => () => { life.current++ }, [])
  const requestLocked = !!job && !job.delivered
  useEffect(() => { props.onRequestLockChange?.(requestLocked); return () => props.onRequestLockChange?.(false) }, [requestLocked, props.onRequestLockChange])
  function keep(value: SavedJob | undefined) { currentJob.current = value; setJob(value); memory.save(value, !!value && (!value.status || !terminalJob(value.status.state))) }
  async function connect() {
    if (running.current || props.disabled) return
    const epoch = life.current; running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const next = await chooseLocalJobs()
      if (epoch !== life.current || latest.current.disabled) return
      if (currentJob.current && next.jobs.queue.queueId !== currentJob.current.queueId) throw new Error('진행했던 계산의 작업 폴더가 아닙니다. 원래 폴더를 선택해 주세요.')
      setConnection(next); setWatch(!!currentJob.current)
      setNotice('계산 폴더를 연결했습니다. 계산은 이 PC에서 실행하며 학교 서버에는 저장하지 않습니다.')
      const worker = await next.jobs.worker()
      if (epoch !== life.current) return
      setWorkerNote(worker && worker.state !== 'stopped' && Math.abs(Date.now() - Date.parse(worker.updatedAt)) < 15000 ? '로컬 계산기의 최근 실행 상태를 확인했습니다.' : '실행 중인 계산기를 아직 확인하지 못했습니다. 이 폴더를 지정해 계산기를 실행해 주세요.')
    } catch (failure) { if (epoch === life.current && !(failure instanceof DOMException && failure.name === 'AbortError')) setError(failureMessage(failure)) }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  async function start() {
    if (!connection || currentJob.current || running.current || props.disabled) return
    const epoch = life.current; running.current = true; setBusy(true); setError(''); setNotice('')
    try {
      const request = await latest.current.onCreate()
      if (!request || epoch !== life.current || latest.current.disabled) return
      // 파일 저장 결과를 잃어도 새 번호로 실행하지 않도록 원본을 먼저 보관한다.
      const saved = { queueId: connection.jobs.queue.queueId, request }; keep(saved)
      await connection.jobs.submit(request)
      if (epoch !== life.current) return
      setWatch(true); setNotice('같은 요청 번호로 계산을 접수했습니다. 결과는 검사를 거쳐 후보로만 가져옵니다.')
    } catch (failure) { if (epoch === life.current) { setError(failureMessage(failure)); setWatch(false) } }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  async function inspect(repairSubmission = false) {
    const saved = currentJob.current
    if (!connection || !saved || running.current || latest.current.disabled) return
    const epoch = life.current; running.current = true
    if (repairSubmission) { setBusy(true); setError(''); setNotice('') }
    try {
      if (repairSubmission) await connection.jobs.submit(saved.request)
      const status = await connection.jobs.status(saved.request, saved.status)
      if (epoch !== life.current || latest.current.disabled || currentJob.current?.request.requestId !== saved.request.requestId) return
      const next = { ...saved, ...(status ? { status } : {}) }; keep(next)
      if (!status || !terminalJob(status.state)) {
        const worker = await connection.jobs.worker()
        if (epoch !== life.current || latest.current.disabled) return
        setWorkerNote(worker && worker.state !== 'stopped' && Math.abs(Date.now() - Date.parse(worker.updatedAt)) < 15000 ? '로컬 계산기의 최근 실행 상태를 확인했습니다.' : '계산기의 최근 실행을 확인하지 못했습니다. 같은 폴더로 계산기를 다시 실행하고 원래 요청을 확인해 주세요.')
      }
      if (status && terminalJob(status.state)) {
        setWatch(false)
        if (status.state === 'succeeded' && !saved.delivered) {
          const response = await connection.jobs.result(saved.request)
          if (epoch !== life.current || latest.current.disabled || currentJob.current?.request.requestId !== saved.request.requestId) return
          const accepted = latest.current.onResult(saved.request, response)
          keep({ ...next, delivered: accepted }); setNotice(accepted ? '원래 요청과 후보 전체를 검사했습니다. 비교한 뒤 직접 초안에 반영해 주세요.' : '계산은 끝났지만 작업 기준이 바뀌었습니다. 현재 배치에 반영하지 않았습니다. 원래 결과는 작업 폴더에 남아 있습니다.')
        } else setNotice(stateLabel[status.state] + '. 현재 배치는 유지합니다.')
      } else if (repairSubmission) { setWatch(true); setNotice('새 요청을 만들지 않고 원래 계산 상태를 다시 확인합니다.') }
    } catch (failure) { if (epoch === life.current) { setWatch(false); setError(failureMessage(failure)) } }
    finally { if (epoch === life.current) { running.current = false; if (repairSubmission) setBusy(false) } }
  }
  useEffect(() => {
    if (!watch || !connection || !job || props.disabled) return
    const timer = window.setInterval(() => void inspect(), 1000)
    return () => window.clearInterval(timer)
  }, [watch, connection, job?.request.requestId, props.disabled])
  async function cancel() {
    const saved = currentJob.current
    if (!connection || !saved || !active || running.current || props.disabled) return
    const epoch = life.current; running.current = true; setBusy(true); setError('')
    try {
      await connection.jobs.cancel(saved.request)
      if (epoch !== life.current) return
      keep({ ...saved, cancelRequested: true }); setWatch(true); setNotice('취소를 요청했습니다. 계산기의 최종 상태가 확인되기 전에는 취소 완료로 표시하지 않습니다.')
    } catch (failure) { if (epoch === life.current) { setError(failureMessage(failure)); setWatch(false) } }
    finally { if (epoch === life.current) { running.current = false; setBusy(false) } }
  }
  return <section aria-label="이 PC에서 최적화 계산" className="timetable-local-engine">
    <h3>이 PC에서 계산하기</h3>
    <p>준비한 계산기를 한 번 실행하고 전용 작업 폴더를 연결하면 요청·결과 파일을 자동으로 주고받습니다. 계산 결과는 직접 확인한 뒤 채택합니다.</p>
    <details><summary>처음 연결하는 방법</summary><ol><li>Python 환경에 저장소의 <code>packages/timetable/requirements.txt</code>를 설치합니다.</li><li>비어 있는 전용 작업 폴더를 만들고 아래 초기 설정을 한 번 실행합니다.</li><li>계산기를 실행해 둔 뒤 같은 폴더를 선택합니다. 교사·학급 자료가 남으므로 개인이 관리하는 폴더를 사용합니다.</li></ol><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{'python packages/timetable/engine/jobs.py init --store "시간표작업폴더"\npython packages/timetable/engine/jobs.py work --store "시간표작업폴더"'}</pre><p>폴더 권한은 브라우저가 직접 확인합니다. 지원하지 않는 브라우저에서는 아래 계산 파일 방식을 사용할 수 있습니다. 이 연결은 학교 서버 배포나 다른 교사에게 공유하는 기능이 아닙니다.</p></details>
    {!supportsLocalJobs() && <p role="status">이 브라우저에서는 폴더 연결을 지원하지 않습니다. 계산 파일 방식을 이용해 주세요.</p>}
    <div className="timetable-actions"><button type="button" className="secondary" disabled={busy || props.disabled || !supportsLocalJobs()} onClick={() => void connect()}>{connection ? '작업 폴더 다시 연결' : '계산 작업 폴더 연결'}</button><button type="button" disabled={!connection || !!job || busy || props.disabled} onClick={() => void start()}>이 PC에서 최적화 시작</button></div>
    {connection && <p className="timetable-muted">연결한 폴더: {connection.name} · {workerNote}</p>}
    {error && <p role="alert" className="timetable-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {job && <section aria-label="로컬 계산 작업 상태"><h4>{job.status ? stateLabel[job.status.state] : '원래 요청 접수 확인 중'}</h4><p className="timetable-muted">진행률을 추정하지 않습니다. 계산기는 실행 단계와 최종 결과를 알려 줍니다.</p><details><summary>원래 계산 요청 번호</summary><code style={{ overflowWrap: 'anywhere' }}>{job.request.requestId}</code></details>
      {job.status?.state === 'failed' && <div role="alert" className="timetable-error"><p>{failureAction(job.status.code)}</p><p>진단 코드: <code>{job.status.code ?? '코드 없음'}</code></p></div>}
      {!sameRequest && <p className="timetable-notice">현재 편성 기준이나 계산 설정이 다릅니다. 이전 결과를 자동 채택하지 않습니다.</p>}
      {!connection && <p>원래 작업 폴더를 다시 연결하면 같은 요청의 상태를 확인할 수 있습니다.</p>}
      {job.cancelRequested && active && <p role="status">취소 요청의 처리 결과를 기다리고 있습니다.</p>}
      <div className="timetable-actions"><button type="button" className="secondary" disabled={!connection || busy || props.disabled} onClick={() => void inspect(true)}>같은 계산 상태 다시 확인</button><button type="button" className="secondary" disabled={!connection || !active || busy || props.disabled} onClick={() => void cancel()}>이 계산 취소 요청</button></div>
      {job.status && terminalJob(job.status.state) && <button type="button" className="secondary" disabled={busy || props.disabled} onClick={() => { keep(undefined); setWatch(false); setDiscard(false); setNotice('완료된 작업의 화면 연결을 정리했습니다. 계산 파일과 현재 배치는 유지됩니다.') }}>완료 작업 연결 정리</button>}
      {active && <details><summary>연결을 복구할 수 없는 경우</summary><p>화면 연결을 정리해도 PC 계산기는 계속 실행될 수 있습니다. 계산기를 직접 중지하거나 작업 폴더에서 상태를 확인한 뒤 정리해 주세요. 학교 서버에는 저장되지 않습니다.</p><label><input type="checkbox" checked={discard} onChange={event => setDiscard(event.target.checked)} />작업 번호를 보관했고, 화면 연결 정리가 계산 취소가 아님을 확인했습니다</label><button type="button" className="secondary" disabled={!discard || busy || props.disabled} onClick={() => { keep(undefined); setWatch(false); setDiscard(false); setNotice('화면 연결만 정리했습니다. 로컬 계산과 파일은 자동 삭제하지 않았습니다.') }}>화면 연결만 정리</button></details>}
    </section>}
  </section>
}
