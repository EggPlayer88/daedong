import type { WorkflowStore } from './store'
import { WorkflowError } from './types'
import type { FileReference } from '../files/contracts'
import { storedZipEntryName } from '../files/download'

export type FileExportMode = 'effective' | 'current'
export interface FileExportJob { unitId: string; submissionId: string; revision: number; unitLabel: string; file: FileReference; name: string }
export interface FileExportPlan {
  requestId: string; title: string; mode: FileExportMode; fingerprint: string
  jobs: FileExportJob[]; csv: string; totalUnits: number; includedUnits: number
}
const states: Record<string, string> = { not_started: '미제출', not_required: '응답 완료', pending: '검토 대기', changes_requested: '보완 요청', accepted: '검토 완료' }

// 따옴표 이스케이프와 별개로 스프레드시트 수식 실행을 막는다.
function cell(value: string | number) {
  let text = String(value)
  if (/^[\s\u0000-\u001f]*[=+\-@]/u.test(text)) text = "'" + text
  return '"' + text.replace(/"/g, '""') + '"'
}
export function fileExportPlan(store: WorkflowStore, memberId: string, requestId: string, mode: FileExportMode): FileExportPlan {
  const request = store.getCollection(memberId, requestId)
  if (request.managerMemberId !== memberId || request.status !== 'published' || !request.fileCollection || !['effective', 'current'].includes(mode))
    throw new WorkflowError('FORBIDDEN', '이 수합의 담당자만 제출 파일을 모을 수 있습니다.')
  const summaries = store.listUnits(memberId, requestId).map(unit => store.unitSummary(memberId, unit.id))
  const jobs: FileExportJob[] = [], rows: (string | number)[][] = [['제출 단위', '다운로드 기준', '포함 여부', '선택한 제출판', '현재 제출 상태', '원본 파일명', '묶음 안 파일명', 'SHA-256']]
  let includedUnits = 0
  for (const [unitIndex, summary] of summaries.entries()) {
    const selected = mode === 'effective' ? summary.effective : summary.current
    const files = selected?.files ?? []
    if (files.length) includedUnits++
    const common = [summary.unit.label, mode === 'effective' ? '완료본' : '최신 제출본', files.length ? '포함' : selected ? '첨부 파일 없음' : mode === 'effective' ? '완료본 없음' : '미제출', selected ? 'v' + selected.revision : '', states[summary.reviewState] ?? summary.reviewState]
    if (!files.length) rows.push([...common, '', '', ''])
    for (const file of files) {
      const name = String(unitIndex + 1).padStart(3, '0') + '_' + summary.unit.label + '_v' + selected!.revision + '_' + file.name
      // ZIP 첫 항목은 현황표이므로 파일의 인덱스는 1부터 시작한다.
      rows.push([...common, file.name, storedZipEntryName(name, jobs.length + 1), file.sha256])
      jobs.push({ unitId: summary.unit.id, unitLabel: summary.unit.label, submissionId: selected!.id, revision: selected!.revision, file, name })
    }
  }
  // 관련 없는 개인 할 일의 변경은 막지 않지만 제출·철회·검토 변경은 다시 준비하게 한다.
  const fingerprint = JSON.stringify({ request, units: summaries.map(s => ({ unit: s.unit, current: s.current, effective: s.effective, state: s.reviewState, supplements: s.supplements })) })
  return { requestId, title: request.title, mode, fingerprint, jobs, csv: '\ufeff' + rows.map(row => row.map(cell).join(',')).join('\r\n'), totalUnits: summaries.length, includedUnits }
}
export function assertFileExportCurrent(store: WorkflowStore, memberId: string, plan: FileExportPlan): void {
  if (fileExportPlan(store, memberId, plan.requestId, plan.mode).fingerprint !== plan.fingerprint)
    throw new WorkflowError('VERSION_CONFLICT', '제출 또는 검토 상태가 바뀌었습니다. 최신 현황으로 다시 준비해 주세요.')
}
