import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { compareCollectionInputs, resolveCollectionInputs, compareAnswerInputs, resolveAnswerInputs, renderCollection, renderAnswer } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { CollectionInputComparison, AnswerInputComparison } from '../apps/workhub/src/collections/CollectionInputComparison'
  export * from '../apps/workhub/src/collections/conflict-comparison'
  const noResolve = () => { throw new Error('렌더 중 입력 변경 금지') }
  export function renderCollection(props) { return renderToStaticMarkup(<CollectionInputComparison {...props} onResolve={noResolve} />).replace(/<style>[\\s\\S]*?<\\/style>/g, '') }
  export function renderAnswer(props) { return renderToStaticMarkup(<AnswerInputComparison {...props} onResolve={noResolve} />).replace(/<style>[\\s\\S]*?<\\/style>/g, '') }
`)
const file = (rest = {}) => ({ id: 'file-one', name: '양식.pdf', extension: 'pdf', bytes: 1024, sha256: 'a'.repeat(64), ...rest })
const unit = (rest = {}) => ({ label: '1학년', responsibleMemberId: 'a', contributorMemberIds: ['b'], ...rest })
const baseInput = (rest = {}) => ({
  title: '계획서 수합', instructions: '학년별로 제출', dueDate: '2026-10-31',
  reviewMode: 'none', reviewerMemberId: '', textLabel: '비고', textRequired: false, numberLabel: '학생 수', numberRequired: false,
  units: [unit()], fileCollection: { policy: { extensions: ['pdf', 'hwpx'], maxFileBytes: 1024 * 1024, maxFiles: 3 }, required: true, templates: [file()] },
  ...rest,
})
const member = (id, name) => ({ id, name, active: true, schoolId: 's', userId: 'user-' + id, role: 'teacher', validFrom: '', validThrough: '', departmentIds: [], gradeIds: [], subjectIds: [] })
const members = [member('a', '김교사'), member('b', '박교사'), member('c', '이교사'), member('d', '정교사')]
let failed = 0
function test(name, run) { try { run(); console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
function frozen(value) { if (value && typeof value === 'object') { Object.values(value).forEach(frozen); Object.freeze(value) } return value }

test('내 제목 수정과 서버의 검토·입력 조건·단위·정책 수정이 함께 보존된다', () => {
  const base = baseInput(), latest = baseInput({ reviewMode: 'required', reviewerMemberId: 'c', textLabel: '수정 비고', textRequired: true, numberLabel: '신청 수', numberRequired: true, units: [unit({ contributorMemberIds: ['d'] })], fileCollection: { policy: { extensions: ['pdf'], maxFileBytes: 512, maxFiles: 1 }, required: false, templates: [file({ id: 'new', name: '변경 양식.pdf', sha256: 'b'.repeat(64) })] } })
  const merged = resolveCollectionInputs(base, latest, baseInput({ title: '내 제목 수정' }))
  assert.deepEqual(merged, { ...latest, title: '내 제목 수정' })
})
test('양쪽이 서로 다른 안내 내용을 바꾸면 명시 선택 전 병합할 수 없다', () => {
  const base = baseInput(), latest = baseInput({ instructions: '다른 담당자 안내' }), mine = baseInput({ instructions: '내 안내' })
  assert.equal(resolveCollectionInputs(base, latest, mine), null)
  assert.equal(resolveCollectionInputs(base, latest, mine, { instructions: 'invalid' }), null)
  assert.equal(resolveCollectionInputs(base, latest, mine, { instructions: 'latest' }).instructions, latest.instructions)
  assert.equal(resolveCollectionInputs(base, latest, mine, { instructions: 'mine' }).instructions, mine.instructions)
})
test('한 충돌을 선택해도 남은 충돌을 자동 덮어쓰지 않는다', () => {
  const base = baseInput(), latest = baseInput({ title: '서버 제목', dueDate: '2026-11-02' }), mine = baseInput({ title: '내 제목', dueDate: '2026-11-03' })
  assert.equal(resolveCollectionInputs(base, latest, mine, { title: 'mine' }), null)
  const merged = resolveCollectionInputs(base, latest, mine, { title: 'mine', dueDate: 'latest' })
  assert.equal(merged.title, '내 제목'); assert.equal(merged.dueDate, '2026-11-02')
})
test('검토 설정만 바뀐 원본도 비교 목록에서 누락되지 않는다', () => {
  const fields = compareCollectionInputs(baseInput(), baseInput({ reviewMode: 'required', reviewerMemberId: 'c' }), baseInput())
  assert.equal(fields.find(field => field.key === 'reviewMode').state, 'latest')
  assert.equal(fields.find(field => field.key === 'reviewerMemberId').state, 'latest')
})
test('전체 입력 키가 비교 대상에 있고 선택하지 않은 서버 변경을 덮어쓸 수 없다', () => {
  const base = baseInput()
  const fields = compareCollectionInputs(base, base, base)
  assert.deepEqual(fields.map(field => field.key).sort(), Object.keys(base).sort())
  const latest = baseInput({ title: '서버 변경' })
  assert.equal(resolveCollectionInputs(base, latest, base, { title: 'mine' }).title, '서버 변경')
})
test('같은 인원 수로 공동 작성자만 교체해도 양쪽 변경을 구분한다', () => {
  const base = baseInput(), latest = baseInput({ units: [unit({ contributorMemberIds: ['c'] })] }), mine = baseInput({ units: [unit({ contributorMemberIds: ['d'] })] })
  assert.equal(compareCollectionInputs(base, latest, mine).find(field => field.key === 'units').state, 'conflict')
  assert.equal(resolveCollectionInputs(base, latest, mine), null)
  assert.deepEqual(resolveCollectionInputs(base, latest, mine, { units: 'latest' }).units, latest.units)
})
test('단위 이름·책임자·공동 작성자를 각각 바꿔도 변경을 감지한다', () => {
  for (const units of [[unit({ label: '2학년' })], [unit({ responsibleMemberId: 'c' })], [unit({ contributorMemberIds: ['c'] })]]) {
    const latest = baseInput({ units })
    assert.equal(compareCollectionInputs(baseInput(), latest, baseInput()).find(field => field.key === 'units').state, 'latest')
    assert.deepEqual(resolveCollectionInputs(baseInput(), latest, baseInput()).units, units)
  }
})
test('파일의 이름이 같아도 ID·해시·크기·확장자 변경을 놓치지 않는다', () => {
  for (const patch of [{ id: 'new' }, { sha256: 'b'.repeat(64) }, { bytes: 1025 }, { extension: 'hwpx' }]) {
    const latest = baseInput(); latest.fileCollection.templates = [file(patch)]
    assert.equal(compareCollectionInputs(baseInput(), latest, baseInput()).find(field => field.key === 'fileCollection').state, 'latest')
  }
})
test('파일 정책과 양식이 양쪽에서 바뀌면 묶음 선택 없이 섞지 않는다', () => {
  const base = baseInput(), latest = baseInput(), mine = baseInput()
  latest.fileCollection.policy.maxFiles = 1
  mine.fileCollection.templates = [file({ id: 'mine', name: '내 양식.pdf' })]
  assert.equal(resolveCollectionInputs(base, latest, mine), null)
  assert.deepEqual(resolveCollectionInputs(base, latest, mine, { fileCollection: 'latest' }).fileCollection, latest.fileCollection)
})
test('파일 수합 사용 해제와 양식 수정도 충돌로 다룬다', () => {
  const base = baseInput(), latest = baseInput({ fileCollection: undefined }), mine = baseInput()
  mine.fileCollection.required = false
  assert.equal(resolveCollectionInputs(base, latest, mine), null)
  assert.equal(resolveCollectionInputs(base, latest, mine, { fileCollection: 'latest' }).fileCollection, undefined)
})
test('양쪽이 같은 내용으로 바꾼 항목은 불필요한 선택 없이 유지한다', () => {
  const base = baseInput(), latest = baseInput({ title: '같은 제목' }), mine = baseInput({ title: '같은 제목' })
  assert.equal(compareCollectionInputs(base, latest, mine).find(field => field.key === 'title').state, 'same')
  assert.equal(resolveCollectionInputs(base, latest, mine).title, '같은 제목')
})
test('객체 속성 선언 순서가 다른 동일 값은 가짜 충돌을 만들지 않는다', () => {
  const base = baseInput(), latest = baseInput()
  latest.fileCollection = { templates: [Object.fromEntries(Object.entries(file()).reverse())], required: true, policy: { maxFiles: 3, maxFileBytes: 1024 * 1024, extensions: ['pdf', 'hwpx'] } }
  assert.equal(compareCollectionInputs(base, latest, base).find(field => field.key === 'fileCollection').state, 'unchanged')
})
test('병합 결과 편집은 원본·서버 값·내 보관 입력을 바꾸지 않는다', () => {
  const base = frozen(baseInput()), latest = frozen(baseInput()), mine = frozen(baseInput({ title: '내 제목' }))
  const merged = resolveCollectionInputs(base, latest, mine)
  merged.units[0].contributorMemberIds.push('c')
  merged.fileCollection.policy.extensions.push('hwp')
  merged.fileCollection.templates[0].name = '새 이름'
  for (const input of [base, latest, mine]) { assert.deepEqual(input.units[0].contributorMemberIds, ['b']); assert.deepEqual(input.fileCollection.policy.extensions, ['pdf', 'hwpx']); assert.equal(input.fileCollection.templates[0].name, '양식.pdf') }
})
test('서버가 숫자만 바꾸고 내가 답변만 바꾸면 둘 다 보존한다', () => {
  const merged = resolveAnswerInputs({ text: '원본', number: 10, files: [] }, { text: '원본', number: 15, files: [] }, { text: '내 답변', number: 10, files: [] })
  assert.deepEqual(merged, { text: '내 답변', number: 15, files: [] })
})
test('숫자 답변의 양쪽 수정은 0·NULL도 구별하고 선택을 요구한다', () => {
  const base = { text: '', number: 2 }, latest = { text: '', number: null }, mine = { text: '', number: 0 }
  assert.equal(resolveAnswerInputs(base, latest, mine), null)
  assert.equal(resolveAnswerInputs(base, latest, mine, { number: 'latest' }).number, null)
  assert.equal(resolveAnswerInputs(base, latest, mine, { number: 'mine' }).number, 0)
})
test('서버의 파일 교체를 내가 수정하지 않은 답변으로 덮어쓰지 않는다', () => {
  const base = { text: '', number: null, files: [file()] }, latest = { ...base, files: [file({ id: 'server-file', sha256: 'b'.repeat(64) })] }, mine = { ...base, text: '내 메모' }
  assert.deepEqual(resolveAnswerInputs(base, latest, mine), { ...latest, text: '내 메모' })
})
test('양쪽이 다른 파일을 올리면 첨부 묶음을 직접 선택해야 한다', () => {
  const base = { text: '', number: null, files: [] }, latest = { ...base, files: [file()] }, mine = { ...base, files: [file({ id: 'mine' })] }
  assert.equal(resolveAnswerInputs(base, latest, mine), null)
  const merged = resolveAnswerInputs(base, latest, mine, { files: 'mine' }); assert.deepEqual(merged.files, mine.files)
  merged.files[0].name = '편집'; assert.equal(mine.files[0].name, '양식.pdf')
})
test('이전 답변의 files 생략과 빈 배열은 같은 내용으로 비교한다', () => {
  const base = { text: '', number: null }, latest = { ...base, files: [] }
  assert.equal(compareAnswerInputs(base, latest, base).find(field => field.key === 'files').state, 'unchanged')
  assert.deepEqual(compareAnswerInputs(base, latest, base).map(field => field.key), ['text', 'number', 'files'])
})
test('손상된 수합 입력은 빈 배열·기본값으로 복구하거나 조용히 병합하지 않는다', () => {
  for (const broken of [null, 'bad', baseInput({ units: null }), baseInput({ units: [null] }), baseInput({ units: [unit({ contributorMemberIds: [null] })] }), baseInput({ textRequired: 'true' }), baseInput({ fileCollection: { policy: null, required: true, templates: [] } }), baseInput({ fileCollection: { policy: { extensions: [null], maxFileBytes: 1, maxFiles: 1 }, required: true, templates: [] } })]) {
    assert.throws(() => compareCollectionInputs(broken, baseInput(), baseInput()))
    const html = renderCollection({ base: broken, latest: baseInput(), mine: baseInput(), members })
    assert.match(html, /role="alert"/); assert.doesNotMatch(html, /비교한 내용으로 편집 계속/)
  }
})
test('손상된 숫자·파일 입력은 비교를 멈추고 보관 입력을 유지한다', () => {
  const base = { text: '', number: null, files: [] }
  for (const broken of [null, { ...base, number: NaN }, { ...base, number: Infinity }, { ...base, files: 'bad' }, { ...base, files: [null] }, { ...base, files: Array(1) }, { ...base, text: null }]) {
    assert.throws(() => compareAnswerInputs(base, broken, base))
    const html = renderAnswer({ base, latest: broken, mine: base })
    assert.match(html, /입력을 자동으로 바꾸지 않았습니다/); assert.doesNotMatch(html, /비교한 내용으로 편집 계속/)
  }
})
test('SSR은 누락됐던 검토자·필수 답변·전체 교사·파일 정책을 빠짐없이 보여준다', () => {
  const latest = baseInput({ reviewMode: 'required', reviewerMemberId: 'c', textLabel: '담당 메모', textRequired: true, numberLabel: '신청 인원', numberRequired: true, units: [unit({ contributorMemberIds: ['d'] })] })
  latest.fileCollection.required = false; latest.fileCollection.policy.maxFiles = 1; latest.fileCollection.templates = [file({ id: 'new-file', name: '최신 양식.pdf', sha256: 'b'.repeat(64) })]
  const html = renderCollection({ base: baseInput(), latest, mine: baseInput(), members })
  for (const value of ['제출 후 검토 방식', '검토 교사', '이교사', '담당 메모', '추가 답변 필수 여부', '신청 인원', '숫자 답변 필수 여부', '정교사', '박교사', '파일 첨부', '허용 형식', '파일당 최대 크기', '최대 파일 수', '최신 양식.pdf', 'new-file', 'b'.repeat(64)]) assert(html.includes(value), value)
  assert.match(html, /다른 사람이 바꾼 현재 서버 내용을 유지합니다/); assert.match(html, /변경되지 않은 항목/); assert.match(html, /아직 저장하지 않습니다/)
})
test('SSR 충돌은 접근 가능한 그룹·선택 이름과 선택 전 비활성 버튼을 제공한다', () => {
  const base = baseInput(), latest = baseInput({ instructions: '서버 안내' }), mine = baseInput({ instructions: '내 안내' })
  const html = renderCollection({ base, latest, mine, members })
  assert.match(html, /<legend>안내 내용<\/legend>/)
  assert.match(html, /type="radio"[^>]*aria-label="안내 내용 · 현재 서버 내용 사용"/)
  assert.match(html, /type="radio"[^>]*aria-label="안내 내용 · 내 입력 사용"/)
  assert.doesNotMatch(html, /type="radio"[^>]*checked/)
  assert.match(html, /<button[^>]*disabled=""[^>]*>비교한 내용으로 편집 계속/)
  assert.match(html, /role="status" aria-live="polite"/)
})
test('SSR 숫자 비교는 실제 항목 이름과 0·미입력·원본 숫자를 구분한다', () => {
  const html = renderAnswer({ base: { text: '', number: 2 }, latest: { text: '', number: null }, mine: { text: '', number: 0 }, labels: { number: '신청 인원' } })
  assert.match(html, /<legend>신청 인원<\/legend>/); assert.match(html, /aria-label="신청 인원 · 내 입력 사용"/)
  assert.match(html, /<p>0<\/p>/); assert.match(html, /<p>미입력<\/p>/); assert.match(html, /<p>2<\/p>/)
})
test('SSR에서 명부에 없는 교사·동명이인을 서로 구별할 수 있다', () => {
  const base = baseInput(), latest = baseInput({ units: [unit({ responsibleMemberId: 'gone', contributorMemberIds: ['a', 'c'] })] })
  const html = renderCollection({ base, latest, mine: base, members: [member('a', '동명이인'), member('c', '동명이인')] })
  assert.match(html, /현재 명부에 없는 교사 · gone/); assert.match(html, /동명이인 · 동명이인 1/); assert.match(html, /동명이인 · 동명이인 2/)
  assert.doesNotThrow(() => renderCollection({ base, latest, mine: base, members: null }))
})
test('SSR에서 비활성 상태와 악성 HTML 문자열을 안전하게 표시한다', () => {
  const base = baseInput(), latest = baseInput({ instructions: '<script>서버</script>' }), mine = baseInput({ instructions: '<img src=x onerror=alert(1)>' })
  const html = renderCollection({ base, latest, mine, members, disabled: true })
  assert.match(html, /<fieldset[^>]*disabled=""/); assert.match(html, /<button[^>]*disabled=""[^>]*>비교한 내용으로 편집 계속/)
  assert.doesNotMatch(html, /<script>|<img src=/); assert.match(html, /&lt;script&gt;/)
})
test('SSR에서 양쪽 변화가 없으면 확인 후 편집을 계속할 수 있다', () => {
  const base = baseInput()
  const html = renderCollection({ base, latest: base, mine: base, members })
  assert.match(html, /입력 내용은 달라지지 않았습니다/); assert.doesNotMatch(html, /<button[^>]*disabled/); assert.equal((html.match(/<legend>/g) || []).length, 11)
})
if (failed) process.exit(1)
