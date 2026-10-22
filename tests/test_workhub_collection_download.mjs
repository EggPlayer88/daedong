import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { collectionDownloadFailure: message, CollectionServerError, FileError } = await loadBrowserModule(`
 export {collectionDownloadFailure} from '../apps/workhub/src/collections/download-feedback';
 export {CollectionServerError} from '../apps/workhub/src/collections/contracts';
 export {FileError} from '../apps/workhub/src/files/contracts';`)
for (const code of ['FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','CANCELLED','CONFLICT','INVALID_RESPONSE','FILE_FAILED','QUERY_FAILED']) {
 const text=message(new CollectionServerError(code,'secret-token/raw-server-error'))
 assert(!text.includes('secret')&&!text.includes('raw-server'))
 assert.equal(text.includes('권한'),['FORBIDDEN','INACTIVE_MEMBERSHIP','NOT_FOUND','CANCELLED'].includes(code))
 console.log('  ✓ 다운로드 '+code+' 고정 안내와 원문 비노출')
}
assert.match(message(new FileError('FILE_DOWNLOAD_FAILED')),/브라우저/)
console.log('  ✓ 브라우저 파일 저장 실패는 저장소 권한과 구분')
assert.match(message(new Error('private path')),/연결/)
console.log('  ✓ 알 수 없는 오류는 권한 문제로 단정하지 않음')
