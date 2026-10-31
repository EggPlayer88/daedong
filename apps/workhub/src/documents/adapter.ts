import type { SupabaseConnection } from '../connection/supabase-connection'
import { exact, identifier, ServiceError, text, version } from '../services/service-values'
import { createScopedRpc } from '../services/scoped-rpc'
import { DOCUMENT_CONTRACT, documentCommand, documentList, documentReceipt, libraryDocument, type DocumentCommand } from './contracts'

export function createDocumentsService(connection: SupabaseConnection) {
  const rpc = createScopedRpc(connection, DOCUMENT_CONTRACT)
  return {
    list(memberId: string, query: string, archived: boolean, cursor: string | null = null) {
      if (typeof archived !== 'boolean') throw new ServiceError('INVALID_INPUT')
      return rpc.call(memberId, 'workhub_document_list', { p_query: text(query, 200).trim(), p_archived: archived, p_cursor: cursor === null ? null : text(cursor, 2000, true) }, documentList)
    },
    get(memberId: string, documentId: string, requestedVersion?: number) {
      return rpc.call(memberId, 'workhub_document_get', { p_document_id: identifier(documentId), p_version: requestedVersion === undefined ? null : version(requestedVersion) }, (value, member) => libraryDocument(value, member, documentId, requestedVersion))
    },
    history(memberId: string, documentId: string) {
      return rpc.call(memberId, 'workhub_document_history', { p_document_id: identifier(documentId) }, value => {
        exact(value, ['documentId', 'versions'])
        if (value.documentId !== documentId || !Array.isArray(value.versions) || value.versions.length > 500) throw new ServiceError('INVALID_RESPONSE')
        const items = value.versions.map(item => { exact(item, ['version', 'recordedAt', 'status']); if (typeof item.recordedAt !== 'string' || !Number.isFinite(Date.parse(item.recordedAt)) || !['draft', 'confirmed', 'archived'].includes(String(item.status))) throw new ServiceError('INVALID_RESPONSE'); return { version: version(item.version), recordedAt: item.recordedAt, status: item.status as 'draft' | 'confirmed' | 'archived' } })
        if (items.some((item, index) => index > 0 && item.version >= items[index - 1].version)) throw new ServiceError('INVALID_RESPONSE')
        return items
      })
    },
    mutate(memberId: string, command: DocumentCommand, key: string) {
      const checked = documentCommand(command)
      return rpc.call(memberId, 'workhub_document_mutate', { p_command: checked, p_request_key: key }, value => documentReceipt(value, key, checked), true)
    },
    recover(memberId: string, command: DocumentCommand, key: string) {
      const checked = documentCommand(command)
      // 서버 상태가 준비 전으로 바뀌어도 기존 접수증 조회는 새 쓰기를 하지 않는다.
      return rpc.call(memberId, 'workhub_document_request_get', { p_command: checked, p_request_key: text(key, 200, true) }, value => documentReceipt(value, key, checked))
    },
  }
}
export type DocumentsService = ReturnType<typeof createDocumentsService>
