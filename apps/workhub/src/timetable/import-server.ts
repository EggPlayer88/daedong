import type { SupabaseConnection } from '../connection/supabase-connection'
import { createScopedRpc, identifier, object, ServiceError } from '../services/scoped-rpc'
import { TIMETABLE_IMPORT_CONTRACT, timetableImportSource, timetableImportInput, timetableImportPreview, timetableImportCommand, timetableImportReceipt, timetableImportClose, type TimetableImportServer } from './import-contracts'

export function createTimetableImportServer(connection: SupabaseConnection, options: { timeoutMs?: number } = {}): TimetableImportServer {
  const scoped: SupabaseConnection = { ...connection, async rpcVerified(name, args) {
    try { return await connection.rpcVerified(name, args) }
    catch (error) {
      if (object(error) && (error.code === 'PGRST202' || error.rpcCode === 'PGRST202')) {
        const member = connection.info().memberships.find(row => row.id === args?.p_member_id)
        return { contract: TIMETABLE_IMPORT_CONTRACT, schoolId: member?.schoolId, memberId: args?.p_member_id, error: { code: 'NOT_READY' } }
      }
      throw error
    }
  } }
  const rpc = createScopedRpc(scoped, TIMETABLE_IMPORT_CONTRACT, options)
  const keyCheck = (key: string) => { identifier(key); if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{7,79}$/.test(key)) throw new ServiceError('INVALID_INPUT') }
  return {
    get: memberId => rpc.call(memberId, 'workhub_timetable_import_get', {}, (raw, member) => timetableImportSource(raw, member.schoolId)),
    preview(memberId, input) {
      const normalized = timetableImportInput(input)
      return rpc.call(memberId, 'workhub_timetable_import_preview', { p_input: normalized }, raw => timetableImportPreview(raw, normalized))
    },
    commit(memberId, input, key) {
      keyCheck(key); const command = timetableImportCommand(input)
      // 복구도 같은 명령이다. 최신 원본·만료보다 먼저 원래 접수증을 확인하는 것은 서버의 책임이다.
      return rpc.call(memberId, 'workhub_timetable_import_commit', { p_command: command, p_request_key: key }, raw => timetableImportReceipt(raw, command, key), true)
    },
    close(memberId, input, key) {
      keyCheck(key); const command = timetableImportCommand(input)
      return rpc.call(memberId, 'workhub_timetable_import_close', { p_command: command, p_request_key: key }, raw => timetableImportClose(raw, command, key), true)
    },
  }
}
