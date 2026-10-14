import { supabase } from '@daedong/shared'
import { CollectionServerError } from './contracts'

// 기존 로그인 세션을 사용하는 단일 공용 인스턴스다. 공개 URL·덮어쓰기·삭제는 제공하지 않는다.
export const legacyStorage = {
  async upload(bucket: string, path: string, file: File): Promise<void> {
    const { error } = await supabase.storage.from(bucket).upload(path, file, {
      upsert: false, cacheControl: '0', contentType: file.type || 'application/octet-stream',
    })
    if (error) throw new CollectionServerError('RESULT_UNKNOWN', '파일 전송 결과를 확인하지 못했습니다. 같은 파일의 서버 상태를 다시 확인해 주세요.')
  },
  async download(bucket: string, path: string): Promise<Blob> {
    const { data, error } = await supabase.storage.from(bucket).download(path)
    if (error || !(data instanceof Blob)) throw new CollectionServerError('FILE_FAILED', '파일을 내려받지 못했습니다. 현재 권한과 파일 상태를 다시 확인해 주세요.')
    return data
  },
}
