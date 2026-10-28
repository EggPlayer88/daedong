import { businessTime, isSchoolSandbox } from '../sandbox/clock'
// 기존 서버의 Asia/Seoul 기준과 같은 날짜가 바뀌었는지만 감지한다.
// 화면/권한의 기준일을 기기 시계로 덮어쓰지 않고 기존 서버 조회를 요청한다.
const dateFormat = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
export function schoolDate(now = Date.now()): string {
  const parts = dateFormat.formatToParts(businessTime(now))
  const value = (type: string) => parts.find(part => part.type === type)!.value
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function watchSchoolDay(host: Window, onChange: () => void, readBasisDate?: () => string | undefined): () => void {
  let observed = schoolDate(), active = true
  // PC 시계가 조금 빠르면 첫 응답은 아직 전날일 수 있다. 1·5·15분에만 추가 확인한다.
  // 날짜가 계속 다르다는 이유로 매분 무한 조회하지 않는다. 실패/권한 폐기 시에는 중단한다.
  const retryAfter = [60_000, 5 * 60_000, 15 * 60_000]
  let pending: { basisDate: string; startedAt: number; attempt: number } | undefined
  const check = () => {
    if (!active || host.document.visibilityState === 'hidden') return
    const now = Date.now(), next = schoolDate(now)
    if (next !== observed) {
      observed = next
      const basisDate = readBasisDate?.()
      pending = basisDate ? { basisDate, startedAt: now, attempt: 0 } : undefined
      onChange()
      return
    }
    if (!pending) return
    const current = readBasisDate?.()
    if (!current || current !== pending.basisDate) { pending = undefined; return }
    if (now < pending.startedAt + retryAfter[pending.attempt]) return
    pending.attempt += 1
    if (pending.attempt === retryAfter.length) pending = undefined
    onChange()
  }
  // 시계 변경·절전에도 다음 확인에서 복구하며 날짜 변화가 없으면 서버를 호출하지 않는다.
  const timer = host.setInterval(check, isSchoolSandbox() ? 2_000 : 60_000)
  host.document.addEventListener('visibilitychange', check)
  host.addEventListener('pageshow', check)
  return () => {
    active = false; pending = undefined
    host.clearInterval(timer)
    host.document.removeEventListener('visibilitychange', check)
    host.removeEventListener('pageshow', check)
  }
}
