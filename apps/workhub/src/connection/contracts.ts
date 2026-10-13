import type { Membership, School } from '../contracts'

export interface LegacyProfile {
  id: string; name: string; email: string; role: string
  extra_permissions: string[]; department_id: string | null; is_active: boolean
}
export interface LegacyIdentity { userId: string; profile: LegacyProfile | null; approved: boolean }
export interface RelationLabel { id: string; name: string }
export interface RelationLabels { departmentIds: RelationLabel[]; gradeIds: RelationLabel[]; subjectIds: RelationLabel[] }
export interface ConnectionContext {
  schools: School[]; memberships: Membership[]; basisDate: string
  relationLabels: RelationLabels; schoolLabels: Record<string, RelationLabels>
}
export interface LegacySession { user: { id: string }; access_token?: string }
export interface RpcError { message?: string; details?: string; code?: string }
export interface LegacyServices {
  getSession(): Promise<LegacySession | null>
  fetchMyProfile(id: string): Promise<LegacyProfile | null>
  onAuthStateChange(callback: (session: LegacySession | null) => void): () => void
  signInWithGoogle(): Promise<unknown>
  signOut(): Promise<unknown>
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>
}
