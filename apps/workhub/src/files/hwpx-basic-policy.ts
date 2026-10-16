import limits from '../../../main/api/collections/_assets/hwpx-basic.json'
import { FileError, type FilePolicy } from './contracts'
import { normalizeFilePolicy } from './validation'

export const HWPX_BASIC_TIMEOUT_MS = limits.checkTimeoutMs
export const HWPX_BASIC_PROFILE = 'hwpx_basic_v1' as const
// 새 파일에만 적용한다. 과거 제출 파일의 읽기·다운로드 정책을 덮어쓰지 않는다.
export function hwpxCollectionPolicy(policy: FilePolicy): FilePolicy {
  const checked = normalizeFilePolicy(policy)
  if (!checked.extensions.includes('hwpx')) throw new FileError('FILE_TYPE_UNSUPPORTED')
  return { ...checked, extensions: ['hwpx'], maxFileBytes: Math.min(checked.maxFileBytes, limits.maxFileBytes) }
}
