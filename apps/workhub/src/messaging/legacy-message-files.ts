import { getSession, supabase } from '@daedong/shared'
import { MessagingError } from './contracts'
import type { MessageFilePort } from './files'
import { createMessageFileCheck } from './message-file-check'

// 수합 저장소와 별도 권한을 쓰되 로그인은 기존 공용 인스턴스만 사용한다.
export const legacyMessageFiles: MessageFilePort = {
  async upload(bucket, path, file) {
    const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false, cacheControl: '0', contentType: file.type || 'application/octet-stream' })
    if (error) throw new MessagingError('RESULT_UNKNOWN')
  },
  async download(bucket, path) {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !(data instanceof Blob)) throw new MessagingError('QUERY_FAILED')
    return data
  },
  check: createMessageFileCheck({ getSession }).check,
}
