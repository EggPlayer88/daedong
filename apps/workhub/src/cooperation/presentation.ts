// 저장된 접수 시각은 유지하고 알림과 같은 한국시간으로만 표시한다.
const historyTimeFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})
export function cooperationHistoryTime(value: string): string {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '시각 확인 필요'
  const parts = historyTimeFormat.formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}
