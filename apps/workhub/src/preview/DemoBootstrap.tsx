import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react'
import { PreviewApp } from './PreviewApp'
import { acquireDemoLease, createDemoPersistence, type DemoLease, type DemoPersistence } from './persistence'

export function downloadSyntheticBackup(persistence: DemoPersistence) {
  const blob = new Blob([persistence.exportRaw()], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = '학교업무혁신_합성자료_백업.json'; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

class DemoBoundary extends Component<{ persistence: DemoPersistence; children: ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  componentDidCatch(_error: Error, _info: ErrorInfo) { /* 합성 자료 오류이며 원본을 자동 삭제하지 않는다. */ }
  recover(action: () => void) { try { action() } catch (error) { this.setState({ error: error instanceof Error ? error.message : '개발 자료 복구 작업을 완료하지 못했습니다.' }) } }
  render() {
    if (!this.state.error) return this.props.children
    return <main className="production"><h1>개발 자료를 확인해 주세요</h1><p role="alert">{this.state.error}</p><p>기존 자료를 유지했습니다. 합성 자료를 내보내거나 개발 자료만 초기화할 수 있습니다.</p><div className="button-row"><button className="secondary" onClick={() => this.recover(() => downloadSyntheticBackup(this.props.persistence))}>합성 자료 내보내기</button><button className="secondary" onClick={() => this.recover(() => { this.props.persistence.clear(); location.reload() })}>개발 자료만 초기화</button></div></main>
  }
}

export function DemoBootstrap() {
  const [ready, setReady] = useState<{ lease: DemoLease; persistence: DemoPersistence }>()
  useEffect(() => {
    let active = true
    let lease: DemoLease | undefined
    // StrictMode의 즉시 재마운트가 자기 잠금을 다른 창으로 오인하지 않게 예약한다.
    const timer = setTimeout(() => { void acquireDemoLease(navigator.locks).then(value => {
      lease = value
      if (!active) { value.release(); return }
      let storage: Storage | undefined
      try { if (value.status === 'persistent') storage = window.localStorage } catch { /* 사용 불가 시 메모리 저장 안내 */ }
      setReady({ lease: value, persistence: createDemoPersistence(storage) })
    }) }, 0)
    return () => { active = false; clearTimeout(timer); lease?.release() }
  }, [])
  if (!ready) return <main className="production" role="status"><h1>업무실 준비 중</h1><p>개발 자료의 저장 상태를 확인하고 있습니다.</p></main>
  if (ready.lease.status === 'busy') return <main className="production"><h1>미리보기가 다른 창에서 열려 있습니다</h1><p>동시에 저장해서 내용을 덮어쓰지 않도록 한 창에서만 편집합니다. 먼저 열린 미리보기를 닫고 다시 열어 주세요.</p><button className="secondary" onClick={() => location.reload()}>다시 열기</button></main>
  return <DemoBoundary persistence={ready.persistence}><PreviewApp persistence={ready.persistence} /></DemoBoundary>
}
