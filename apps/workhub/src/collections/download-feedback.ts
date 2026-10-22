import { CollectionServerError } from './contracts'
import { FileError } from '../files/contracts'

// 전송·내용 확인 실패를 사용자 권한 문제로 단정하지 않는다. 원시 서버 오류는 노출하지 않는다.
export function collectionDownloadFailure(error: unknown): string {
  if (error instanceof FileError && error.code === 'FILE_DOWNLOAD_FAILED') return '파일은 확인했지만 브라우저에 저장하지 못했습니다. 브라우저의 다운로드 설정을 확인한 뒤 다시 눌러 주세요.'
  if (error instanceof CollectionServerError) {
    if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND', 'CANCELLED'].includes(error.code)) return '현재 계정의 파일 열람 권한을 확인하지 못했습니다. 학교와 소속을 다시 확인해 주세요.'
    if (error.code === 'CONFLICT') return '수합이나 파일이 변경되었습니다. 새로 확인한 뒤 다시 내려받아 주세요.'
    if (error.code === 'INVALID_RESPONSE') return '서버가 보낸 파일 정보를 확인하지 못했습니다. 새로 확인한 뒤 다시 내려받아 주세요.'
    if (error.code === 'FILE_FAILED') return '파일을 전송하거나 내용을 확인하는 중 오류가 발생했습니다. 다시 시도해도 같으면 관리자에게 알려 주세요.'
  }
  return '파일 내려받기 연결을 확인하지 못했습니다. 잠시 뒤 다시 눌러 주세요.'
}
