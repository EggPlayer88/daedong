import type { PublicationManifest } from './operations-next-contracts'

/** 전체 명세는 탭 메모리에서 복구 문맥으로 보관하고, 전송할 때는 고정 참조만 보낸다. */
export const TIMETABLE_PUBLICATION_API = 'timetable-publication.v1' as const
export interface PublicationCommitCommand { kind: 'publish_manifest'; manifest: PublicationManifest }
export interface PublicationCommitReference {
  kind: 'publish_manifest'; previewId: string; previewHash: string; manifestHash: string; basisFingerprint: string
  input: PublicationManifest['input']; expiresAt: string; totalChanges: number
}
export interface PublicationCommitReceipt {
  requestKey: string; commandHash: string; kind: 'publish_manifest'; entityId: string; version: number; status: 'published'
  recordedAt: string; manifestHash: string; basisFingerprint: string; changedCount: number
}
export interface PublicationExecutionServer {
  execute(memberId: string, command: PublicationCommitCommand, requestKey: string): Promise<PublicationCommitReceipt>
  recover(memberId: string, command: PublicationCommitCommand, requestKey: string): Promise<PublicationCommitReceipt>
}
