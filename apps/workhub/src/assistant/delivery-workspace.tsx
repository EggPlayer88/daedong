import { useEffect, useRef, type ReactNode } from 'react'
import type { SearchKind } from '../search/contracts'
import styles from './delivery-workspace.css?inline'
import { specialistWorkflow, type SpecialistTask } from './specialist-workflows'
import type { DailyCommand } from './daily-command'

export type DeliveryKind = 'messages' | 'collections' | 'documents' | 'timetable' | 'students' | 'schoolAdmin' | 'cooperation' | 'knowledge' | 'calendar' | 'tasks' | 'daily'
export interface DeliveryWorkspace {
  scope: string
  kind: DeliveryKind
  key: string
  request?: { key: string; id: string; version?: number }
  task?: SpecialistTask
  daily?: DailyCommand
  inbox?: boolean
  list?: boolean
}
export const deliveryLabels: Record<DeliveryKind, string> = { messages: '메시지 작성·확인', collections: '수합 작성·제출', documents: '문서 작성·파일 생성', timetable: '시간표 요청·확인', students: '수업·학생 기록', schoolAdmin: '학교 자료·인계', cooperation: '협업 요청·완료 확인', knowledge: '학교 자료·원문', calendar: '일정 작성·변경', tasks: '내 할 일', daily: '오늘 업무·급식' }
export const deliveryDraftSlots: Record<DeliveryKind, readonly string[]> = {
  messages: ['messaging-composer'], collections: ['collection-editor'],
  documents: ['document-editor', 'guided-documents'],
  timetable: ['timetable-', 'annual-operations'],
  students: ['teaching-', 'school-data-maintenance', 'student-'],
  calendar: ['calendar-'],
  tasks: ['task-editor'], daily: [],
  cooperation: ['cooperation.editor'], knowledge: ['knowledge-editor', 'knowledge-import'],
  schoolAdmin: ['school-admin-editor', 'school-roster', 'teacher-roster-', 'school-transitions', 'school-configuration', 'school-preparation', 'school-ai-'],
}
export function hasDeliveryDraft(kind: DeliveryKind, slots: readonly string[]): boolean {
  return slots.some(slot => deliveryDraftSlots[kind].some(prefix => prefix.endsWith('-') ? slot.startsWith(prefix) : slot === prefix))
}
export function isDeliveryKind(value: string): value is DeliveryKind { return Object.hasOwn(deliveryLabels, value) }
export function deliveryKind(kind: SearchKind): DeliveryKind | undefined {
  return kind === 'message' ? 'messages' : kind === 'collection' ? 'collections' : kind === 'document' ? 'documents' : kind === 'course' ? 'students' : kind === 'cooperation' ? 'cooperation' : kind === 'calendar' ? 'calendar' : kind === 'task' ? 'tasks' : undefined
}

// 대화와 업무 편집기는 각각 한 번만 마운트한다. 접어도 원문·요청 번호의 소유자는 바뀌지 않는다.
export function AssistantDeliveryFrame({ workspace, talking, locked, finishDisabled = false, error, onTalk, onResume, onClose, children, chat }: {
  workspace?: DeliveryWorkspace; talking: boolean; locked: boolean; finishDisabled?: boolean
  error?: string
  onTalk: () => void; onResume: () => void; onClose: () => void
  children?: ReactNode; chat: ReactNode
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const workflow = specialistWorkflow(workspace?.task)
  useEffect(() => { if (workspace && !talking) heading.current?.focus() }, [workspace?.key, talking])
  return <div className="assistant-delivery"><style>{styles}</style>
    {workspace && <header className="assistant-delivery-header">
      <div><span>대화에서 이어서</span><h2 tabIndex={-1} ref={heading}>{workspace.inbox ? '업무 알림' : workspace.daily?.view === 'meals' ? '학교 급식' : workflow?.title ?? deliveryLabels[workspace.kind]}</h2></div>
      <div className="assistant-delivery-controls">
        {talking ? <button type="button" disabled={locked} onClick={onResume}>작성하던 업무 보기</button>
          : <button type="button" disabled={locked} onClick={onTalk}>대화 보기</button>}
        <button type="button" disabled={locked || finishDisabled} onClick={onClose}>작업 마치기</button>
      </div>
    </header>}
    {workspace && workflow && !talking && <details className="assistant-specialist-plan"><summary>업무 진행 순서</summary>
      <ol className="assistant-specialist-steps" aria-label="업무 진행 순서">{workflow.steps.map(step => <li key={step}>{step}</li>)}</ol>
    </details>}
    {error && <p className="assistant-delivery-error" role="alert">{error}</p>}
    {workspace && <div className="assistant-delivery-work" hidden={talking}>{children}</div>}
    <div hidden={Boolean(workspace && !talking)}>{chat}</div>
  </div>
}
