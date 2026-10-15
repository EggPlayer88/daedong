import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { summarizeCollectionSubmission: summarize, formatCollectionRecordedTime: recordedTime, render, renderEntries, elements } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server'
  import {CollectionSubmissionHistory, CollectionSubmissionHistoryEntries} from '../apps/workhub/src/collections/CollectionSubmissionHistory'
  import {summarizeCollectionSubmission} from '../apps/workhub/src/collections/submission-summary'
  export {summarizeCollectionSubmission, formatCollectionRecordedTime} from '../apps/workhub/src/collections/submission-summary'
  export const render = props => renderToStaticMarkup(<CollectionSubmissionHistory {...props} />)
  export const elements = props => CollectionSubmissionHistoryEntries({...props, summary: summarizeCollectionSubmission(props.detail, props.unit, props.date)})
  export const renderEntries = props => renderToStaticMarkup(elements(props))
`)
const file = (id, name = id + '.pdf') => ({ id, name, extension: 'pdf', bytes: 10, sha256: 'a'.repeat(64) })
const submission = (id, revision, extra = {}) => ({ id, unitId: 'unit-a', revision, submittedBy: 'member-a', receiptAt: '2026-10-15T15:05:00Z', receiptDate: '2026-10-16', dueSnapshot: '2026-10-15', initiallyLate: false, correctionReason: '', previousSubmissionId: revision > 1 ? 'submission-1' : null, reviewMode: 'required', requestKey: `key-${id}`, text: '', number: null, files: [file(`file-${id}`)], ...extra })
const unit = { id: 'unit-a', requestId: 'request-a', schoolId: 'school-a', label: '교무부', responsibleMemberId: 'member-a', members: [{ id: 'member-a', userId: 'user-a', name: '교사 가' }], version: 7, currentSubmissionId: 'submission-3', effectiveSubmissionId: 'submission-1', withdrawnSubmissionIds: ['submission-2'], correctionUntil: '2026-10-16', correctionReason: '오류 수정' }
const detail = {
  request: { id: 'request-a', schoolId: 'school-a', managerMemberId: 'member-manager', title: '제출 이력 검사', instructions: '', dueDate: '2026-10-15', reviewMode: 'required', reviewerMemberId: 'member-reviewer', textLabel: '설명', textRequired: false, numberLabel: '학생 수', numberRequired: false, units: [], status: 'published', version: 3, publishedAt: '2026-10-14T01:00:00Z' },
  units: [unit],
  submissions: [submission('submission-1', 1), submission('submission-2', 2), submission('submission-3', 3, { number: 0, text: '<script>alert(1)</script>', correctionReason: '수치 정정', files: [file('latest-file', '<img src=x>.pdf')] }), submission('foreign', 4, { unitId: 'unit-b', text: '다른 단위 비공개 내용' })],
  reviews: [{ id: 'review-1', unitId: 'unit-a', submissionId: 'submission-1', reviewerMemberId: 'member-reviewer', decision: 'accepted', note: '첫 판 확인', recordedAt: '2026-10-15T01:00:00Z' }, { id: 'foreign-review', unitId: 'unit-b', submissionId: 'foreign', reviewerMemberId: 'member-b', decision: 'accepted', note: '다른 단위 검토', recordedAt: '2026-10-15T02:00:00Z' }],
  supplements: [{ id: 'supplement-1', unitId: 'unit-a', submissionId: 'submission-2', dueDate: '2026-10-16', fulfilledSubmissionId: 'submission-3', fulfilledAt: '2026-10-15T15:05:00Z' }],
  withdrawals: [{ id: 'withdrawal-2', unitId: 'unit-a', submissionId: 'submission-2', actorMemberId: 'member-a', reason: '파일 누락', recordedAt: '2026-10-15T14:00:00Z' }],
}
const clone = value => structuredClone(value)
const check = (label, callback) => { callback(); console.log('  ✓ ' + label) }
const props = (source = detail, extra = {}) => ({ detail: source, unit: source.units[0], date: '2026-10-16', onDownload() { throw new Error('렌더 중 다운로드 금지') }, ...extra })
const withoutStyles = html => html.replace(/<style>[\s\S]*?<\/style>/g, '')

check('서버 제출 이력은 현재 제출과 이전 완료본을 구분한다', () => {
  const summary = summarize(detail, unit, '2026-10-16')
  assert.equal(summary.current.id, 'submission-3')
  assert.equal(summary.effective.id, 'submission-1')
  assert.equal(summary.reviewState, 'pending')
  assert.deepEqual(summary.history.map(value => value.revision), [3, 2, 1])
  assert.deepEqual(summary.withdrawnSubmissionIds, ['submission-2'])
})
check('다른 단위와 연결되지 않은 검토·보완·철회는 요약에 섞이지 않는다', () => {
  const input = clone(detail)
  input.reviews.push({ ...input.reviews[0], id: 'orphan', submissionId: 'missing' })
  input.supplements.push({ ...input.supplements[0], id: 'foreign', unitId: 'unit-b', submissionId: 'foreign' })
  input.withdrawals.push({ ...input.withdrawals[0], id: 'foreign', unitId: 'unit-b', submissionId: 'foreign' })
  const summary = summarize(input, unit, '2026-10-16')
  assert.equal(summary.reviews.length, 1)
  assert.equal(summary.supplements.length, 1)
  assert.equal(summary.withdrawals.length, 1)
})
check('요약은 원본 제출 배열과 판 번호·이력을 변경하지 않는다', () => {
  const before = JSON.stringify(detail)
  summarize(detail, unit, '2026-10-16')
  assert.equal(JSON.stringify(detail), before)
})
check('검토 없는 수합의 완료와 검토 완료본의 상태를 구분한다', () => {
  const input = clone(detail), target = input.units[0]
  target.effectiveSubmissionId = target.currentSubmissionId
  assert.equal(summarize(input, target, '2026-10-16').reviewState, 'accepted')
  input.submissions.find(value => value.id === target.currentSubmissionId).reviewMode = 'none'
  input.request.reviewMode = 'none'
  assert.equal(summarize(input, target, '2026-10-16').reviewState, 'complete')
})
check('현재 판의 보완 의견만 현재 상태로 표시한다', () => {
  const input = clone(detail)
  input.reviews.push({ ...input.reviews[0], id: 'review-3', submissionId: 'submission-3', decision: 'changes_requested', note: '세부 수치 확인', recordedAt: '2026-10-16T01:00:00Z' })
  assert.equal(summarize(input, input.units[0], '2026-10-16').reviewState, 'changes_requested')
  input.reviews[1].decision = 'changes_requested'
  assert.equal(summarize(detail, unit, '2026-10-16').reviewState, 'pending')
})
check('보완 응답 제출은 검토 완료로 바꾸지 않고 남은 요청을 따로 센다', () => {
  const input = clone(detail)
  input.supplements.push({ ...input.supplements[0], id: 'pending-1', dueDate: '2026-10-15', fulfilledSubmissionId: null, fulfilledAt: null })
  input.supplements.push({ ...input.supplements[0], id: 'pending-2', dueDate: '2026-10-17', fulfilledSubmissionId: null, fulfilledAt: null })
  const summary = summarize(input, input.units[0], '2026-10-16')
  assert.equal(summary.reviewState, 'pending')
  assert.deepEqual(summary.pendingSupplements.map(value => value.id), ['pending-1', 'pending-2'])
  assert.equal(summary.supplementOverdue, true)
})
check('정정 종료일 당일은 열림이며 다음 날부터 종료로 요약한다', () => {
  assert.equal(summarize(detail, unit, '2026-10-16').correctionOpen, true)
  assert.equal(summarize(detail, unit, '2026-10-16').correctionExpired, false)
  assert.equal(summarize(detail, unit, '2026-10-17').correctionOpen, false)
  assert.equal(summarize(detail, unit, '2026-10-17').correctionExpired, true)
  assert.equal(summarize(detail, { ...unit, correctionUntil: '' }, '2026-10-16').correctionOpen, false)
  assert.equal(summarize(detail, unit, '2026-02-30').correctionOpen, false)
})
check('실제 미제출과 현재 판 연결 유실은 서로 다른 상태로 표시한다', () => {
  assert.equal(summarize(detail, { ...unit, currentSubmissionId: null, effectiveSubmissionId: null }, '2026-10-16').reviewState, 'unsubmitted')
  assert.equal(summarize(detail, { ...unit, currentSubmissionId: 'missing' }, '2026-10-16').reviewState, 'unavailable')
  assert.equal(summarize(detail, { ...unit, currentSubmissionId: 'submission-2' }, '2026-10-16').reviewState, 'unavailable')
})
check('다른 학교·수합 또는 접근 DTO에 없는 단위는 이력을 노출하지 않는다', () => {
  for (const target of [{ ...unit, schoolId: 'school-b' }, { ...unit, requestId: 'request-b' }, { ...unit, id: 'unit-b' }]) {
    const summary = summarize(detail, target, '2026-10-16')
    assert.equal(summary.reviewState, 'unavailable')
    assert.equal(summary.history.length, 0)
  }
})
check('기록 시각은 브라우저 시간대와 무관한 한국시간으로 표시한다', () => {
  assert.match(recordedTime('2026-10-15T15:05:00Z'), /2026년 10월 16일/)
  assert.match(recordedTime('2026-10-15T15:05:00Z'), /00:05/)
  assert.equal(recordedTime('잘못된 시각'), '시각 확인 필요')
})
check('서버 제출 이력은 기본 접힘·명시적 시간 기준·기존 완료본을 제공한다', () => {
  const html = withoutStyles(render(props()))
  assert.match(html, /<details class="csh-details">/)
  assert.doesNotMatch(html, /<details[^>]* open/)
  assert.match(html, /현재 제출<\/dt><dd>v3 · 검토 대기/)
  assert.match(html, /완료본<\/dt><dd>v1/)
  assert.doesNotMatch(html, /<button|<ol/)
  const content = renderEntries(props())
  assert.match(content, /보완 응답 v3 제출/)
  assert.match(content, /검토 결과는 해당 제출판/)
})
check('이력의 숫자 0을 보존하고 사용자 내용과 파일 이름을 HTML로 실행하지 않는다', () => {
  const html = renderEntries(props())
  assert.match(html, /학생 수<\/strong>: 0/)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.match(html, /&lt;img src=x&gt;\.pdf/)
  assert.doesNotMatch(html, /<script>|<img src=x>/)
  assert.doesNotMatch(html, /다른 단위 비공개 내용|다른 단위 검토/)
})
check('철회된 판에는 파일 다운로드 버튼을 제공하지 않는다', () => {
  const html = renderEntries(props())
  assert.match(html, /제출 v2 · 철회됨/)
  assert.match(html, /파일 누락/)
  assert.doesNotMatch(html, /aria-label="제출 v2 [^"]* 내려받기"/)
  assert.match(html, /aria-label="제출 v1 [^"]* 내려받기"/)
  assert.match(html, /aria-label="제출 v3 [^"]* 내려받기"/)
})
check('파일 다운로드 콜백은 선택한 정확한 과거 판과 원본 참조를 전달한다', () => {
  const calls = []
  const visit = node => {
    if (!node || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (node.type === 'button') node.props.onClick()
    visit(node.props?.children)
  }
  visit(elements(props(detail, { onDownload: (parent, ref) => calls.push({ parent, ref }) })))
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map(value => value.parent), [
    { kind: 'submission', requestId: 'request-a', unitId: 'unit-a', submissionId: 'submission-3' },
    { kind: 'submission', requestId: 'request-a', unitId: 'unit-a', submissionId: 'submission-1' },
  ])
  assert.equal(calls[0].ref, detail.submissions[2].files[0])
  assert.equal(calls[1].ref, detail.submissions[0].files[0])
})
check('저장·다운로드 중에는 모든 이력 다운로드 버튼이 비활성화된다', () => {
  const html = renderEntries(props(detail, { disabled: true }))
  assert.equal((html.match(/<button type="button" disabled=""/g) || []).length, 2)
})
check('누락·깨진 배열과 파일은 렌더를 중단시키거나 미제출로 오인하지 않는다', () => {
  const broken = { ...detail, submissions: null, reviews: '깨짐', supplements: null, withdrawals: {} }
  assert.match(withoutStyles(render(props(broken))), /제출 상태 확인 필요/)
  const input = clone(detail)
  input.units[0].members = null
  input.submissions[2].files = [null, '문자열', { id: 'bad', name: '나쁜 파일', bytes: null }]
  input.reviews = [null]
  input.supplements = [null]
  input.withdrawals = [null]
  const html = renderEntries(props(input))
  assert.match(html, /교사 이름 확인 불가/)
  assert.doesNotMatch(html, /나쁜 파일/)
})
check('긴 제출 이력은 열린 범위에서 20판씩 나누어 표시한다', () => {
  const input = clone(detail)
  input.submissions = Array.from({ length: 1000 }, (_, index) => submission(`page-${index + 1}`, index + 1, { files: [] }))
  input.units[0].currentSubmissionId = 'page-1000'
  input.units[0].effectiveSubmissionId = null
  assert.equal((renderEntries(props(input)).match(/<h5>/g) || []).length, 20)
  assert.equal((renderEntries(props(input, { visibleCount: 40 })).match(/<h5>/g) || []).length, 40)
  assert.doesNotMatch(withoutStyles(render(props(input))), /제출 v1000/)
})
check('단위 밖 검토자의 이름은 현재 학교 활성 명부에서 표시하고 제출 단위 기록 이름을 우선한다', () => {
  const member = { id: 'member-reviewer', schoolId: 'school-a', userId: 'user-reviewer', name: '검토 교사', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
  const html = renderEntries(props(detail, { members: [member, { ...member, id: 'member-a', name: '새로 바뀐 이름' }] }))
  assert.match(html, /검토자 검토 교사/)
  assert.match(html, /제출자 교사 가/)
  assert.doesNotMatch(html, /새로 바뀐 이름/)
})
check('다른 학교·비활성·기간 종료 명부의 이름은 이력 표시에서 사용하지 않는다', () => {
  const member = { id: 'member-reviewer', schoolId: 'school-a', userId: 'user-reviewer', name: '공개하면 안 되는 이름', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: [], gradeIds: [], subjectIds: [] }
  for (const candidate of [{ ...member, schoolId: 'school-b' }, { ...member, active: false }, { ...member, validThrough: '2026-10-15' }]) {
    const html = renderEntries(props(detail, { members: [candidate] }))
    assert.match(html, /검토자 교사 이름 확인 불가/)
    assert.doesNotMatch(html, /공개하면 안 되는 이름/)
  }
})
