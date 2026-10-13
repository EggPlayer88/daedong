import { useEffect, useId, useRef, useState } from 'react'
import { exportReport, type ReadinessReport, type ReadinessStage } from '../connection/readiness'
import readinessStyles from './connection-readiness.css?inline'

export interface ConnectionReadinessPanelProps {
  runCheck: () => Promise<ReadinessReport>
  expectedUserId?: string
  onDownload?: (json: string, filename: string) => void | Promise<void>
}

const labels = ['로그인 확인', '기존 가입 승인', '이용 권한 확인', '학교 소속과 조회 기반']
type CheckState = 'confirmed' | 'attention' | 'unverified'
type StageCopy = { title: string; description: string; next: string; confirmed: number; attention?: number; detail: string }
const copy: Record<ReadinessStage, StageCopy> = {
  logged_out: { title: '로그인 상태를 먼저 확인해 주세요', description: '현재 브라우저에서 로그인한 계정을 확인하지 못했습니다.', next: '기존 사이트의 로그인 상태를 확인한 뒤 다시 확인해 주세요.', confirmed: 0, attention: 0, detail: '기존 로그인 세션이 없습니다. 이 진단은 로그인을 시작하거나 계정을 새로 만들지 않습니다.' },
  profile_missing: { title: '기존 가입 정보를 확인해야 합니다', description: '로그인한 계정에 연결된 기존 가입 정보를 찾지 못했습니다.', next: '학교 관리자에게 기존 가입 정보의 연결 상태를 확인해 달라고 요청해 주세요.', confirmed: 1, attention: 1, detail: '로그인 계정과 연결된 회원 프로필이 조회되지 않았습니다. 진단 과정에서 회원을 생성하거나 변경하지 않습니다.' },
  pending: { title: '가입 승인이 아직 확인되지 않았습니다', description: '현재 계정의 기존 가입 승인이 확인되어야 다음 단계로 진행할 수 있습니다.', next: '학교 관리자에게 가입 승인 상태를 확인한 뒤 다시 확인해 주세요.', confirmed: 1, attention: 1, detail: '기존 회원의 승인 값이 true인 경우에만 승인 완료로 확인합니다.' },
  forbidden: { title: '현재 계정의 이용 권한을 확인해 주세요', description: '현재 계정으로는 이 시험 화면을 이용할 수 없습니다.', next: '학교 관리자에게 현재 계정의 이용 범위를 확인해 달라고 요청해 주세요.', confirmed: 2, attention: 2, detail: '신축 시험 화면은 승인된 슈퍼관리자만 이용합니다. 계정 역할 또는 서버의 접근 허용 상태를 확인해야 합니다.' },
  invalid_configuration: { title: '사이트 연결 설정을 확인해야 합니다', description: '이 화면에서 학교 서버에 연결할 준비가 확인되지 않았습니다.', next: '지원용 진단 파일을 내려받아 사이트 관리자에게 전달해 주세요.', confirmed: 0, detail: '현재 화면의 연결 설정 또는 진단 실행 옵션을 확인해야 합니다. 이 화면에서는 설정을 수정하지 않습니다.' },
  foundation_missing: { title: '학교 조회 기능의 준비 상태를 확인해야 합니다', description: '학교 연결을 확인하는 조회 기능을 현재 서버에서 찾지 못했습니다.', next: '지원용 진단 파일을 내려받아 사이트 관리자에게 전달해 주세요.', confirmed: 3, attention: 3, detail: '학교 조회 함수가 아직 없거나 서버의 설정 정보가 갱신되지 않았을 수 있습니다. SQL 미실행으로 단정하지 않습니다. 관리자가 배포 상태와 조회 함수의 등록 상태를 확인해야 합니다.' },
  no_membership: { title: '현재 이용할 학교 소속이 없습니다', description: '현재 계정으로 이용할 수 있는 학교 소속이 확인되지 않았습니다.', next: '학교 관리자에게 학교 소속과 이용 기간을 확인해 달라고 요청한 뒤 다시 확인해 주세요.', confirmed: 3, attention: 3, detail: '조회된 정보에서 현재 계정의 활성 소속이 없거나, 서버가 이용 가능한 소속이 없다고 응답했습니다.' },
  ready: { title: '학교 소속 조회까지 확인했습니다', description: '현재 계정의 로그인, 기존 가입 승인, 이용 권한과 학교 소속 조회를 확인했습니다.', next: '이번 결과는 아래에 표시한 조회 범위까지의 확인 결과입니다.', confirmed: 4, detail: '기존 세션과 승인된 슈퍼관리자 프로필을 확인하고 학교 조회 응답에서 본인의 활성 소속을 확인했습니다. 일정 목록 조회나 저장 요청은 실행하지 않았습니다.' },
  unavailable: { title: '지금은 연결 상태를 확인하지 못했습니다', description: '확인을 마치지 못해 이전 결과를 그대로 표시하지 않습니다.', next: '인터넷 연결을 확인하고 잠시 뒤 다시 확인해 주세요. 계속되면 지원용 진단 파일을 사이트 관리자에게 전달해 주세요.', confirmed: 0, detail: '응답 지연, 연결 실패, 계정 변경 또는 올바르지 않은 응답 등이 원인일 수 있습니다. 원문 오류와 계정 정보는 화면이나 파일에 표시하지 않습니다.' },
}

// 서비스와 같은 화이트리스트를 통과한 보고서만 화면과 다운로드에 사용한다.
function safeReport(report: ReadinessReport): ReadinessReport {
  return JSON.parse(exportReport(report)) as ReadinessReport
}
function failedReport(code: ReadinessReport['code']): ReadinessReport {
  return { stage: 'unavailable', code, checkedAt: new Date().toISOString(), readySchoolCount: 0 }
}
function reportCopy(report: ReadinessReport): StageCopy {
  if (report.code === 'NETWORK_OFFLINE') return { ...copy.unavailable, title: '인터넷 연결을 확인해 주세요', description: '현재 브라우저가 오프라인 상태여서 학교 서버에 확인을 요청하지 않았습니다.', next: '인터넷에 연결한 뒤 다시 확인해 주세요.', detail: '브라우저가 오프라인 상태라고 보고했습니다. 다른 원인까지 확인한 결과는 아닙니다.' }
  if (report.code === 'SESSION_CHANGED') return { ...copy.unavailable, title: '계정이 바뀌어 확인을 중단했습니다', description: '이전 계정의 진단 결과를 표시하지 않습니다.', next: '현재 사용할 계정으로 다시 확인해 주세요.' }
  if (report.code === 'CANCELLED') return { ...copy.unavailable, title: '연결 확인을 중단했습니다', description: '중단된 진단의 결과는 사용하지 않습니다.', next: '필요할 때 연결 상태를 다시 확인해 주세요.' }
  if (report.code === 'SERVER_FORBIDDEN') return { ...copy.forbidden, confirmed: 1, detail: '서버가 접근을 허용하지 않았습니다. 기존 가입 승인과 현재 이용 권한이 유지되는지 관리자가 확인해야 합니다.' }
  if (report.code === 'TIMEOUT') return { ...copy.unavailable, title: '확인에 시간이 오래 걸리고 있습니다', description: '정해진 시간 안에 확인을 마치지 못했습니다.', next: '인터넷 연결을 확인하고 잠시 뒤 다시 확인해 주세요.' }
  return copy[report.stage]
}

export function ReadinessReportView({ report }: { report: ReadinessReport }) {
  const safe = safeReport(report)
  const text = reportCopy(safe)
  return <div className="readiness-result" data-readiness-stage={safe.stage}>
    <div className={`readiness-summary ${safe.stage === 'ready' ? 'readiness-confirmed' : ''}`} role="status" aria-live="polite">
      <h3>{text.title}</h3><p>{text.description}</p>
      {safe.stage === 'ready' && <p>확인된 학교 소속: <strong>{safe.readySchoolCount}곳</strong></p>}
    </div>
    <ol className="readiness-checks" aria-label="단계별 연결 확인 결과">{labels.map((label, index) => {
      const state: CheckState = index < text.confirmed ? 'confirmed' : index === text.attention ? 'attention' : 'unverified'
      const status = state === 'confirmed' ? '확인됨' : state === 'attention' ? '확인 필요' : '미확인'
      return <li key={label} data-check-state={state}><span className="readiness-step" aria-hidden="true">{index + 1}</span><span>{label}</span><strong>{status}</strong></li>
    })}</ol>
    <p className="readiness-next"><strong>다음에 할 일</strong>{text.next}</p>
    <details className="readiness-detail"><summary>관리자용 진단 정보</summary><p>{text.detail}</p><dl><div><dt>진단 코드</dt><dd>{safe.code}</dd></div><div><dt>확인 시각</dt><dd><time dateTime={safe.checkedAt}>{safe.checkedAt}</time></dd></div></dl></details>
  </div>
}

async function downloadFile(json: string, filename: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename
  try { document.body.appendChild(link); link.click() }
  finally { link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000) }
}

export function ConnectionReadinessPanel({ runCheck, expectedUserId, onDownload = downloadFile }: ConnectionReadinessPanelProps) {
  const headingId = useId()
  const generation = useRef(0)
  const alive = useRef(true)
  const currentUserId = useRef(expectedUserId)
  currentUserId.current = expectedUserId
  const [result, setResult] = useState<{ owner?: string; report: ReadinessReport }>()
  const [runningOwner, setRunningOwner] = useState<{ owner?: string }>()
  const [downloadStatus, setDownloadStatus] = useState<{ owner?: string; text: string }>()
  useEffect(() => {
    alive.current = true
    generation.current += 1
    setResult(undefined); setRunningOwner(undefined); setDownloadStatus(undefined)
    return () => { alive.current = false; generation.current += 1 }
  }, [expectedUserId])
  const running = !!runningOwner && runningOwner.owner === expectedUserId
  const report = result && result.owner === expectedUserId ? result.report : undefined
  const downloadMessage = downloadStatus && downloadStatus.owner === expectedUserId ? downloadStatus.text : ''
  async function check() {
    if (running) return
    const version = ++generation.current
    const owner = expectedUserId
    const current = () => alive.current && version === generation.current && owner === currentUserId.current
    setRunningOwner({ owner }); setResult(undefined); setDownloadStatus(undefined)
    try {
      const checked = typeof navigator !== 'undefined' && navigator.onLine === false ? failedReport('NETWORK_OFFLINE') : await runCheck()
      if (current()) setResult({ owner, report: safeReport(checked) })
    } catch {
      // 임의 예외 메시지에는 서버 원문이나 개인정보가 포함될 수 있어 표시하지 않는다.
      if (current()) setResult({ owner, report: failedReport('CONTEXT_READ_FAILED') })
    } finally { if (current()) setRunningOwner(undefined) }
  }
  async function download() {
    if (!report || running) return
    const owner = expectedUserId
    const version = generation.current
    try {
      await onDownload(exportReport(report), 'workhub-connection-readiness.json')
      if (alive.current && owner === currentUserId.current && version === generation.current) setDownloadStatus({ owner, text: '지원용 진단 파일의 내려받기를 요청했습니다.' })
    } catch {
      if (alive.current && owner === currentUserId.current && version === generation.current) setDownloadStatus({ owner, text: '파일을 내려받지 못했습니다. 다시 눌러 주세요.' })
    }
  }
  return <section className="connection-readiness" aria-labelledby={headingId} aria-busy={running}>
    <style>{readinessStyles}</style>
    <header><p className="readiness-kicker">현재 연결 살펴보기</p><h2 id={headingId}>연결 상태 확인</h2><p>버튼을 누르면 현재 계정과 학교 연결을 읽어서 확인합니다. 회원 정보나 학교 자료를 변경하지 않습니다.</p></header>
    <div className="readiness-actions"><button type="button" className="readiness-button" onClick={() => { void check() }} disabled={running}>{running ? '연결 상태 확인 중…' : report ? '연결 상태 다시 확인' : '연결 상태 확인'}</button>{report && <button type="button" className="readiness-button readiness-secondary" onClick={() => { void download() }} disabled={running}>지원용 진단 파일 내려받기</button>}</div>
    {running ? <p className="readiness-progress" role="status">현재 계정과 학교 연결을 확인하는 중입니다.</p> : report ? <ReadinessReportView report={report} /> : <p className="readiness-idle">아직 확인하지 않았습니다. 결과는 직접 확인을 실행한 뒤 표시됩니다.</p>}
    <p className="readiness-download-note">지원용 JSON 파일에는 진단 상태, 코드, 확인 시각, 연결된 학교 수만 담습니다. 이름, 이메일, 계정·학교 식별자, 일정 내용은 포함하지 않습니다.</p>
    {downloadMessage && <p role="status" className="readiness-download-status">{downloadMessage}</p>}
    <p className="readiness-limits"><strong>이번 확인의 범위</strong>로그인 상태와 가입 승인, 이용 권한, 학교 소속 조회까지만 확인합니다. 일정 목록 조회·저장, 실제 Google 로그인 절차, 기존 계정과 자료 전체의 보존 여부는 이 진단으로 검증하지 않습니다.</p>
  </section>
}
