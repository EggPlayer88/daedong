import type { PageId } from '../modules'
import { HOME_KINDS, type HomeKind, type HomeOverview } from './overview'

// 수합과 보완은 겹칠 수 있다. 종류별 원본 수만 표시하고 서로 더하지 않는다.
export const homeCountLabels: Record<HomeKind, { label: string; unit: string; page: PageId; destination: string }> = {
  collection: { label: '미제출 수합', unit: '건', page: 'collections', destination: '자료 수합' },
  supplement: { label: '보완할 수합', unit: '건', page: 'collections', destination: '자료 수합' },
  message: { label: '안 읽은 대화', unit: '개', page: 'messages', destination: '메시지' },
  student_followup: { label: '기록 확인할 수업', unit: '개', page: 'students', destination: '수업·학생' },
  cooperation: { label: '확인할 협업', unit: '건', page: 'cooperation', destination: '협업' },
}
export function homeCountRows(data: HomeOverview) {
  return HOME_KINDS.map(kind => ({ kind, ...homeCountLabels[kind], count: data.counts[kind] }))
}
export function homeOverviewEmpty(data: HomeOverview): boolean {
  return !data.items.length && !data.unavailable.length && HOME_KINDS.every(kind => data.counts[kind] === 0)
}
