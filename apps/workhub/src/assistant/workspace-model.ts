import type { WorkspacePlan } from './workspace-plan'
import type { DailyCommand } from './daily-command'
import type { MemoryService } from './memory-contracts'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { canonical } from '../services/service-values'
import {
  assistantInput,
  confirmTask,
  AssistantError,
  type AnswerSegment,
  type AssistantContextRequest,
  type AssistantInput,
  type AssistantIntent,
  type AssistantMode,
  type AssistantServer,
  type AssistantThread,
  type ConfirmTask,
  type StudentContext,
  type TaskProposal,
} from './contracts'
import type { SchoolAiSettingsServer } from './school-settings-contracts'
import { type KnowledgeAssistantRequest } from '../knowledge/assistant-links'
import type { PageId } from '../modules'
import type { SearchItem, SearchKind } from '../search/contracts'
import type { WorkspaceCommand } from './workspace-commands'
import type { DraftFollowup, DraftPeople } from './draft-followup'
import type { DirectDraftCommand } from './draft-commands'
import type { TaskChangeCommand } from './task-change-command'
import type { ConversationFocus } from './conversation-guidance'
import type { WorkspaceOperationReview, WorkspaceOperationReceipt } from './workspace-operations'
import type { SpecialistCommand } from './specialist-workflows'
export type CalendarWorkspaceCommand = Extract<WorkspaceCommand, { kind: 'calendar' }>
export interface AssistantWorkspaceSearchResult {
  items: SearchItem[]
  coverage: string[]
  hasMore: boolean
}
export interface AssistantWorkspaceActions {
  deliveryInConversation?: boolean
  specialist?: (command: SpecialistCommand) => boolean
  daily?: (command: DailyCommand) => boolean
  navigate: (page: PageId) => boolean
  search: (query: string, kinds: SearchKind[], signal: AbortSignal) => Promise<AssistantWorkspaceSearchResult>
  open: (item: SearchItem) => boolean
  calendar: (command: CalendarWorkspaceCommand) => boolean
  findDraftPeople?: (kind: DirectDraftCommand['kind'], query: string, signal: AbortSignal) => Promise<DraftPeople & { limit: number }>
  prepareDraft?: (command: DirectDraftCommand, followup?: DraftFollowup) => boolean
  changeTask?: (command: TaskChangeCommand, selected: SearchItem) => boolean
  operations?: {
    prepareTask: (command: TaskChangeCommand, selected: SearchItem) => Promise<WorkspaceOperationReview>
    prepareCalendar: (command: CalendarWorkspaceCommand) => Promise<WorkspaceOperationReview>
    execute: (review: WorkspaceOperationReview, retry: boolean) => Promise<WorkspaceOperationReceipt>
  }
}
export interface AssistantDraftReady {
  intent: AssistantIntent
  segments: AnswerSegment[]
  requestKey: string
  threadId: string
  studentContext: StudentContext | null
}
export interface AssistantPanelProps {
  workActive?: boolean
  connection: SupabaseConnection
  member: Membership
  date: string
  revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onUpdated?: () => void
  contextRequest?: {
    id: string
    request: AssistantContextRequest
  }
  onDraftReady?: (draft: AssistantDraftReady, contextId?: string) => void
  onComposeMessage?: (draft: { requestId: string; body: string }) => void
  onOpenTask?: (taskId: string) => void
  onOpenKnowledgeCitation?: (request: KnowledgeAssistantRequest) => void | Promise<void>
  workspaceActions?: AssistantWorkspaceActions
  server?: AssistantServer
  settingsServer?: SchoolAiSettingsServer
  memoryServer?: MemoryService
}
export type Pending =
  | {
      kind: 'ask'
      input: AssistantInput
    }
  | {
      kind: 'confirmTask'
      input: ConfirmTask
    }
export type Session = {
  mode: AssistantMode
  intent: AssistantIntent
  prompt: string
  conversationFocus?: ConversationFocus
  workspacePlan?: { plan: WorkspacePlan; scope: string; selectedId?: string }
  draftDialogue?: DraftFollowup
  calendarDialogue?: { command: CalendarWorkspaceCommand; basisDate: string; scope: string }
  references: AssistantContextRequest['references']
  studentContext: StudentContext | null
  thread?: AssistantThread
  proposal?: TaskProposal
  taskReview?: boolean
  contextId?: string
  requestContexts?: Record<string, string>
}
export const initial: Session = {
  mode: 'school',
  intent: 'school_advice',
  prompt: '',
  references: [],
  studentContext: null,
}
export const intentLabels: Record<AssistantIntent, string> = {
  school_advice: '학교 업무 안내',
  personal_assistant: '내 업무와 할 일',
  document_draft: '문서 내용 초안',
  student_record_draft: '학생 기록 초안',
  guided_collection: '문답형 수합 초안',
}
export function pendingCommand(raw: unknown): Pending {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AssistantError('INVALID_INPUT')
  const value = raw as Record<string, unknown>
  if (Object.keys(value).length !== 2) throw new AssistantError('INVALID_INPUT')
  if (value.kind === 'ask') return { kind: 'ask', input: assistantInput(value.input) }
  if (value.kind === 'confirmTask') {
    const checked = confirmTask(value.input)
    // 새 규칙으로 원 요청을 바꾸지 않는다. 과거 미확정 요청은 원형을 보관한 채 확인이 필요하다.
    if (canonical(checked) !== canonical(value.input)) throw new AssistantError('INVALID_INPUT')
    return { kind: 'confirmTask', input: checked }
  }
  throw new AssistantError('INVALID_INPUT')
}
export const newKey = () => globalThis.crypto.randomUUID()
