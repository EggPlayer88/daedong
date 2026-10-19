import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { guidance, render } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { collectionSubmissionGuidance } from '../apps/workhub/src/collections/submission-guidance'
  import { CollectionSubmissionGuide } from '../apps/workhub/src/collections/CollectionSubmissionGuide'
  export const guidance = collectionSubmissionGuidance
  export const render = value => renderToStaticMarkup(<CollectionSubmissionGuide guidance={value} />)
`)
const file = { id: 'file-one', name: '수합.hwpx', extension: 'hwpx', bytes: 100, sha256: 'a'.repeat(64) }
const input = () => ({ text: '완료', number: 0, files: [structuredClone(file)] })
const draft = () => ({ ...input(), id: 'draft-one', unitId: 'unit-one', version: 2, lastEditorMemberId: 'member-one' })
const options = () => ({ input: input(), saved: draft(), requiredFiles: true, textLabel: '전달 사항', textRequired: true, numberLabel: '수량', numberRequired: true, responsible: true, hadSubmission: false, reason: '', needsSupplement: false, correctionRequestId: '', pendingFile: false })
let count = 0
function check(name, action) { action(); count++; console.log(`  ✓ ${name}`) }

check('필수 응답과 저장본이 같으면 0을 유효하게 인정하고 최종 제출 단계로 안내한다', () => {
  const result = guidance(options())
  assert.deepEqual({ canSubmit: result.canSubmit, savedCurrent: result.savedCurrent, stage: result.stage, reasons: result.reasons }, { canSubmit: true, savedCurrent: true, stage: 'submit', reasons: [] })
  assert.match(result.message, /최종 제출할 준비/)
})
check('필수 내용을 작성했어도 서버에 저장한 초안이 없으면 먼저 저장하도록 안내한다', () => {
  const result = guidance({ ...options(), saved: null })
  assert.equal(result.canSubmit, false); assert.equal(result.savedCurrent, false); assert.equal(result.stage, 'save')
  assert.match(result.message, /먼저 초안에 저장/)
})
check('저장 뒤 글·숫자·파일 변경은 각기 다시 저장해야 한다', () => {
  for (const changed of [{ ...input(), text: '수정' }, { ...input(), number: 1 }, { ...input(), files: [{ ...file, sha256: 'b'.repeat(64) }] }]) {
    const result = guidance({ ...options(), input: changed })
    assert.equal(result.canSubmit, false); assert.equal(result.savedCurrent, false); assert.equal(result.stage, 'save')
    assert.match(result.message, /변경한 내용을 초안에 저장/)
  }
})
check('파일의 이름·크기·ID·순서를 바꾸면 저장본과 같다고 표시하지 않는다', () => {
  for (const changed of [{ ...file, id: 'file-two' }, { ...file, name: '바뀐이름.hwpx' }, { ...file, bytes: 101 }]) assert.equal(guidance({ ...options(), input: { ...input(), files: [changed] } }).savedCurrent, false)
  const second = { ...file, id: 'file-two', name: '둘째.hwpx' }
  assert.equal(guidance({ ...options(), input: { ...input(), files: [second, file] }, saved: { ...draft(), files: [file, second] } }).savedCurrent, false)
})
check('필수 응답 검사와 별개로 앞뒤 공백 변경도 저장 전에는 제출하지 못하게 안내한다', () => {
  const result = guidance({ ...options(), input: { ...input(), text: ' 완료 ' } })
  assert.equal(result.savedCurrent, false); assert.equal(result.stage, 'save')
})
check('공백뿐인 필수 글과 누락한 필수 숫자는 작성 단계에 남는다', () => {
  const result = guidance({ ...options(), input: { ...input(), text: ' \n ', number: null } })
  assert.equal(result.stage, 'write'); assert.equal(result.canSubmit, false)
  assert.match(result.message, /전달 사항 항목을 입력/)
  assert.ok(result.reasons.some(reason => /수량.*0도 응답값/.test(reason)))
})
check('필수 파일을 지운 상태의 저장본도 제출 준비 완료로 안내하지 않는다', () => {
  const result = guidance({ ...options(), input: { ...input(), files: [] }, saved: { ...draft(), files: [] } })
  assert.equal(result.savedCurrent, true); assert.equal(result.canSubmit, false); assert.equal(result.stage, 'write')
  assert.match(result.message, /HWPX 파일을 첨부/)
})
check('선택 응답은 빈칸을 허용하고 files 누락과 빈 배열을 같은 내용으로 비교한다', () => {
  const result = guidance({ ...options(), textRequired: false, numberRequired: false, requiredFiles: false, input: { text: '', number: null }, saved: { ...draft(), text: '', number: null, files: [] } })
  assert.equal(result.canSubmit, true); assert.equal(result.savedCurrent, true)
})
check('선택 숫자라도 NaN·무한대·문자열이면 유효한 저장값으로 안내하지 않는다', () => {
  for (const number of [NaN, Infinity, -Infinity, '0', undefined]) {
    const result = guidance({ ...options(), numberRequired: false, input: { ...input(), number }, saved: { ...draft(), number } })
    assert.equal(result.canSubmit, false); assert.equal(result.savedCurrent, false); assert.equal(result.stage, 'write')
    assert.ok(result.reasons.some(reason => /올바른 숫자/.test(reason)))
  }
})
check('파일 처리 중에는 이미 저장된 내용도 최종 제출 대기로 표시한다', () => {
  const result = guidance({ ...options(), pendingFile: true })
  assert.equal(result.savedCurrent, true); assert.equal(result.canSubmit, false); assert.equal(result.stage, 'write')
  assert.match(result.message, /파일 처리가 끝난 뒤/)
})
check('공동 작성자에게는 저장 가능과 책임 교사의 최종 제출을 구분해 안내한다', () => {
  const result = guidance({ ...options(), responsible: false })
  assert.equal(result.canSubmit, false); assert.equal(result.savedCurrent, true)
  assert.match(result.message, /공동 작성자는 초안까지 저장.*최종 제출은 책임 교사/)
})
check('재제출은 사유가 있어야 준비 완료이며 사유 입력만으로 초안을 다시 저장하라고 하지 않는다', () => {
  const empty = guidance({ ...options(), hadSubmission: true, reason: '  ' })
  assert.equal(empty.canSubmit, false); assert.equal(empty.stage, 'submit'); assert.match(empty.message, /재제출 사유/)
  const ready = guidance({ ...options(), hadSubmission: true, reason: '오탈자 정정' })
  assert.equal(ready.canSubmit, true); assert.equal(ready.savedCurrent, true); assert.match(ready.message, /다시 제출/)
})
check('보완 요청이 있을 때만 응답할 요청 선택을 요구한다', () => {
  const required = guidance({ ...options(), needsSupplement: true, correctionRequestId: '  ' })
  assert.equal(required.canSubmit, false); assert.match(required.message, /보완 요청을 선택/)
  assert.equal(guidance({ ...options(), needsSupplement: true, correctionRequestId: 'supplement-one' }).canSubmit, true)
  assert.equal(guidance(options()).canSubmit, true)
})
check('손상된 입력·저장본과 파일 배열은 예외 없이 제출 준비 미완료로 안내한다', () => {
  for (const value of [null, { text: null, number: null }, { ...input(), files: '문자열' }, { ...input(), files: [null] }, { ...input(), files: [{ ...file, bytes: NaN }] }]) {
    const result = guidance({ ...options(), input: value, saved: value })
    assert.equal(result.canSubmit, false); assert.equal(result.savedCurrent, false)
    assert.doesNotThrow(() => render(result))
  }
  assert.equal(guidance({ ...options(), saved: null }).canSubmit, false)
})
check('SSR 단계는 순서 목록과 하나의 현재 단계로 읽히며 저장과 제출의 차이를 알린다', () => {
  const html = render(guidance(options())).replace(/<style>[\s\S]*?<\/style>/g, '')
  assert.match(html, /<aside[^>]*aria-label="제출 준비 안내"/)
  assert.match(html, /<ol aria-label="제출 순서">/)
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1)
  assert.match(html, /aria-current="step"[^>]*><span[^>]*>3<\/span>최종 제출/)
  assert.match(html, /초안 저장만으로 제출되지는 않습니다/)
  assert.match(html, /최종 제출은 책임 교사만/)
  assert.match(html, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.doesNotMatch(html, /<details|<button|제출되었습니다/)
})
check('여러 미완료 조건은 첫 안내와 닫힌 상세 목록으로 나누고 불필요한 경고를 늘리지 않는다', () => {
  const result = guidance({ ...options(), saved: null, input: { text: '', number: null, files: [] } })
  const html = render(result).replace(/<style>[\s\S]*?<\/style>/g, '')
  assert.match(html, /<details><summary>제출 전 확인할 사항/)
  assert.doesNotMatch(html, /<details open|role="alert"/)
  assert.equal(html.split(result.message).length - 1, 1)
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1)
})
check('표시용 깨진 안내도 SSR을 중단하지 않으며 문항 이름은 HTML로 실행하지 않는다', () => {
  assert.doesNotThrow(() => render({ reasons: '잘못된 배열', stage: 'unknown', message: null }))
  const escaped = render(guidance({ ...options(), textLabel: '<script>문항</script>', input: { ...input(), text: '' } }))
  assert.match(escaped, /&lt;script&gt;문항&lt;\/script&gt;/)
  assert.doesNotMatch(escaped, /<script>/)
})
console.log(`제출 준비 안내 ${count}건 통과`)
