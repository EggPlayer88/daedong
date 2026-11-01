import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { ServiceError } from '../services/service-values'
import { type GuidedService } from './guided-adapter'
import {
  type GeneratedDocument,
  type GuidedCommand,
  type Question,
  type TemplateDetail,
} from './guided-contracts'
import type { DocumentAiRequest } from './contracts'
import { type GuidedAiOrigin, type GuidedAiRequest, type GuidedAiSuggestion } from './guided-ai'
import type {
  GuidedSetupAiOrigin,
  GuidedSetupAiRequest,
  GuidedSetupAiSuggestion,
} from './guided-setup-ai'
export type Pending =
  | { kind: 'upload'; key: string; file: File; title: string; inspectKey: string }
  | { kind: 'command'; key: string; command: GuidedCommand }
  | {
      kind: 'render'
      key: string
      templateId: string
      templateVersion: number
      responseId: string
      responseVersion: number
    }
export type Memory = {
  selected: TemplateDetail | null
  title: string
  questions: Question[]
  input: Record<string, string>
  pending: Pending | null
  folded: boolean
  aiOrigin?: GuidedAiOrigin
  dismissed?: string
  uploadTitle?: string
  setupOrigin?: GuidedSetupAiOrigin
}
export interface GuidedWorkspaceProps {
  connection: SupabaseConnection
  member: Membership
  date: string
  revision?: number
  onNavigationLockChange?: (locked: boolean) => void
  onRequestAi?: (request: DocumentAiRequest) => void
  onRequestGuidedAi?: (request: GuidedAiRequest) => void
  onRequestGuidedSetupAi?: (request: GuidedSetupAiRequest) => void
  setupAiSuggestion?: GuidedSetupAiSuggestion
  onOpenFileCollections?: () => void
  aiSuggestion?: GuidedAiSuggestion
  onOpenCollection?: (requestId: string) => void
  onUseGenerated?: (file: GeneratedDocument) => void
  service?: GuidedService
}
export const errorOf = (error: unknown) =>
  error instanceof ServiceError ? error : new ServiceError('QUERY_FAILED')
