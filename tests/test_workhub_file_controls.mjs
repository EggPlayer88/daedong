import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { selection, downloads, formatFileBytes } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {FileSelection,FileDownloads} from '../apps/workhub/src/files/FileControls.tsx'
  export {formatFileBytes} from '../apps/workhub/src/files/FileControls.tsx'
  const repository={stage:async()=>{throw Error('SSR에서 파일을 읽으면 안 됨')},check:()=>{},read:async()=>{throw Error('SSR에서 파일을 읽으면 안 됨')},discardStaged:()=>{},reset:()=>{}}
  const policy={extensions:['pdf','hwpx'],maxFileBytes:2097152,maxFiles:3}
  export const selection = (props={}) => renderToStaticMarkup(<FileSelection repository={repository} policy={policy} owner={{schoolId:'school',memberId:'teacher'}} files={[]} onChange={()=>{}} label="양식 파일" {...props}/>)
  export const downloads = files => renderToStaticMarkup(<FileDownloads files={files} read={repository.read} label="제출 파일"/>)
`)
const reference = (name = '합성 양식.pdf') => ({ id: 'file-1', name, extension: 'pdf', bytes: 1024, sha256: 'a'.repeat(64) })
let passed = 0, failed = 0
function test(name, run) { try { run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }

test('파일 선택 이름과 입력 연결·복수 선택·허용 확장자가 전달된다', () => {
  const html = selection()
  assert.match(html, /양식 파일 선택/)
  const labelId = html.match(/<label[^>]*for="([^"]+)"/)?.[1]
  assert(labelId); assert(html.includes(`id="${labelId}"`))
  assert.match(html, /type="file"/); assert.match(html, /multiple=""/); assert.match(html, /accept=".pdf,.hwpx"/)
})
test('주입받은 형식·파일당 한도·개수를 안내한다', () => {
  const html = selection({ policy: { extensions: ['docx'], maxFileBytes: 4096, maxFiles: 2 } })
  assert.match(html, /DOCX · 파일당 4KB 이하 · 최대 2개/)
  assert(!html.includes('PDF ·'))
})
test('정책이 없거나 손상되면 선택을 잠그고 확인 안내를 보여 준다', () => {
  for (const policy of [null, {}, { extensions: [], maxFileBytes: 5, maxFiles: 1 }, { extensions: ['pdf'], maxFileBytes: 0, maxFiles: 1 }]) {
    const html = selection({ policy })
    assert.match(html, /type="file"[^>]*disabled=""/)
    assert.match(html, /파일 형식과 용량 기준을 확인할 수 없습니다/)
  }
})
test('선택된 파일은 이름·크기·총개수·총용량과 최종 제출 전 상태를 보인다', () => {
  const html = selection({ files: [reference(), { ...reference('다른 문서.pdf'), id: 'file-2', bytes: 2048, sha256: 'b'.repeat(64) }] })
  assert.match(html, /2개 · 3KB/); assert.match(html, /합성 양식.pdf/); assert.match(html, /다른 문서.pdf/)
  assert.match(html, /aria-label="합성 양식.pdf 제거"/)
  assert.match(html, /최종 제출 전/)
  assert(!html.includes('서버 검사 완료')); assert(!html.includes('제출 완료'))
})
test('disabled 설정은 파일 선택·바꾸기·제거를 모두 잠근다', () => {
  const html = selection({ files: [reference()], disabled: true })
  for (const name of ['합성 양식.pdf 바꾸기', '합성 양식.pdf 제거']) assert.match(html, new RegExp(`disabled="" aria-label="${name}"`))
  assert.match(html, /type="file"[^>]*disabled=""/)
  assert.match(html, /hidden="" type="file"[^>]*disabled=""/)
})

test('파일 교체는 파일별 이름이 있는 버튼과 단일 파일 입력을 제공한다', () => {
  const html = selection({ files: [reference()] })
  assert.match(html, /aria-label="합성 양식.pdf 바꾸기"/)
  const replacement = html.match(/<input[^>]*hidden=""[^>]*>/)?.[0]
  assert(replacement); assert.match(replacement, /aria-label="양식 파일 교체 파일 선택"/)
  assert(!replacement.includes('multiple=')); assert.match(replacement, /accept=".pdf,.hwpx"/)
})
test('파일 목록의 손상된 값은 화면을 죽이거나 빈 정상값으로 표시하지 않는다', () => {
  const circular = reference(); circular.extra = circular
  for (const files of [null, '깨짐', [null], [{ id: 'missing' }], [circular]]) {
    const html = selection({ files })
    assert.match(html, /첨부 파일 목록을 확인할 수 없습니다/)
    assert.match(html, /role="alert"/); assert.match(html, /type="file"[^>]*disabled=""/)
  }
})
test('파일 이름은 HTML로 실행하지 않고 제거·다운로드에 정확히 표시한다', () => {
  const file = reference('<img src=x onerror=alert(1)>.pdf')
  for (const html of [selection({ files: [file] }), downloads([file])]) {
    assert(!html.includes('<img')); assert(html.includes('&lt;img'))
  }
})
test('다운로드는 파일별 접근 가능한 이름과 명시 버튼을 제공한다', () => {
  const html = downloads([reference()])
  assert.match(html, /aria-label="합성 양식.pdf 다운로드"/)
  assert.match(html, /type="button"/); assert.match(html, /1KB/)
  assert(!html.includes('href="blob:')); assert(!html.includes('다운로드 완료'))
})
test('다운로드 빈 목록과 손상된 목록은 서로 다른 안내다', () => {
  assert.match(downloads([]), /첨부된 파일이 없습니다/)
  assert.match(downloads(null), /첨부 파일 목록을 확인할 수 없습니다/)
})
test('진행·오류 설명은 입력과 연결하고 상태 알림을 제공한다', () => {
  const html = selection({ files: null })
  const description = html.match(/aria-describedby="([^"]+)"/)?.[1]
  assert(description)
  for (const id of description.split(' ')) assert(html.includes(`id="${id}"`))
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/)
})
test('크기 단위는 작은 파일과 표시 경계를 구분한다', () => {
  assert.equal(formatFileBytes(0), '0B'); assert.equal(formatFileBytes(1000), '1,000B')
  assert.equal(formatFileBytes(1024), '1KB'); assert.equal(formatFileBytes(1048576), '1MB')
})

console.log(`파일 선택·다운로드 화면: ${passed}개 통과, ${failed}개 실패`)
if (failed) process.exitCode = 1
