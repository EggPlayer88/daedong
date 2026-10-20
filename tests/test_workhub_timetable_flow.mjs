import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { flow, command, matches, canonical, snapshot } = await loadBrowserModule(`export { timetableFlowGuidance as flow, timetableDraftCommand as command, matchesSavedTimetableDraft as matches } from '../apps/workhub/src/timetable/flow'; export { canonical } from '../apps/workhub/src/services/scoped-rpc'; export { timetablePracticeSnapshot as snapshot } from '../apps/workhub/src/timetable/sample'`)
const base = { step: 'basis', pending: false, busy: false, stale: false, conditionPending: false, basisValid: true, foundationReady: true, canCalculate: true, checkingRequired: false, hasPlacements: false, valid: false, missingCount: 0, dirty: false, practice: false, canSave: true, saved: false }
let count = 0
function check(name, run) { run(); count++; console.log('  ✓ ' + name) }
check('결과 미상은 모든 다음 행동보다 원래 요청 확인을 우선한다', () => { const row = flow({ ...base, pending: true, stale: true }); assert.match(row.title, /원래 저장/); assert.equal(row.target, undefined) })
check('진행 중인 계산은 새 작업을 안내하지 않는다', () => assert.equal(flow({ ...base, busy: true }).target, undefined))
check('옛 기준의 성공 배치도 새 기초자료 확인으로 보낸다', () => assert.equal(flow({ ...base, stale: true, hasPlacements: true, valid: true }).target, 'basis'))
check('미추가 조건이 있으면 생성·저장 안내보다 조건 작성이 먼저다', () => assert.equal(flow({ ...base, conditionPending: true, hasPlacements: true, valid: true }).target, 'conditions'))
check('잘못된 기초·미지원 기초는 생성 가능으로 표시하지 않는다', () => { for (const key of ['basisValid', 'foundationReady']) assert.equal(flow({ ...base, [key]: false }).target, 'basis') })
check('확정 충돌은 조건을 직접 검토하도록 하며 자동 완화하지 않는다', () => assert.equal(flow({ ...base, canCalculate: false }).target, 'conditions'))
check('조건 변경 후 보관 배치는 검사 단계로 이동한다', () => assert.equal(flow({ ...base, checkingRequired: true, hasPlacements: true, valid: true }).target, 'compose'))
check('기초 확인 다음은 조건 수집이고 계산 성공을 약속하지 않는다', () => assert.equal(flow(base).target, 'conditions'))
check('조건이 준비되면 생성 화면으로 안내하며 그 화면에서는 중복 이동 버튼이 없다', () => { assert.equal(flow({ ...base, step: 'conditions' }).target, 'compose'); assert.equal(flow({ ...base, step: 'compose' }).target, undefined) })
check('부분 배치와 충돌 배치는 저장으로 넘기지 않는다', () => { assert.match(flow({ ...base, hasPlacements: true, missingCount: 3 }).title, /3개/); assert.equal(flow({ ...base, hasPlacements: true }).target, 'compose') })
check('필수조건 통과 뒤 검토 단계로 안내하며 자동 저장하지 않는다', () => assert.equal(flow({ ...base, step: 'compose', hasPlacements: true, valid: true }).target, 'publish'))
check('연습·저장권한 없음·미저장 상태에서 확정 이동을 안내하지 않는다', () => { for (const patch of [{ practice: true }, { canSave: false }, { dirty: true }, { saved: false }]) assert.notEqual(flow({ ...base, step: 'publish', hasPlacements: true, valid: true, saved: true, ...patch }).target, 'handoff') })
check('접수증에 연결된 깨끗한 배치만 확정 화면으로 안내한다', () => assert.equal(flow({ ...base, step: 'publish', hasPlacements: true, valid: true, saved: true }).target, 'handoff'))
const basis = snapshot('2026-10-19').basis, session = { title: ' 비교 초안 ', conditions: { fixed: [], unavailable: [], preferences: [] }, placements: [{ lessonId: basis.lessons[0].id, slotId: basis.slots[0].id }] }
const input = command(basis, session), saved = { id: 'draft', version: 1, commandKey: canonical(input) }
check('서버에 보낸 것과 같은 제목 정규화·기초판·지문으로 저장 접수증을 대조한다', () => { assert.equal(input.title, '비교 초안'); assert(matches(saved, command(basis, session))) })
check('제목·조건·배치 어느 하나라도 바뀌면 저장한 초안으로 간주하지 않는다', () => { for (const patch of [{ title: '다른 초안' }, { conditions: { ...session.conditions, preferences: [{ lessonId: basis.lessons[0].id, slotId: basis.slots[0].id, weight: 2 }] } }, { placements: [] }]) assert.equal(matches(saved, command(basis, { ...session, ...patch })), false) })
check('기초판·지문 변경과 배치 없음은 저장 초안 연결을 끊는다', () => { assert.equal(matches(saved, command({ ...basis, revision: 2 }, session)), false); assert.equal(matches(saved, command({ ...basis, sourceFingerprint: 'b'.repeat(64) }, session)), false); assert.equal(command(basis, { ...session, placements: null }), null); assert.equal(matches(undefined, input), false) })
console.log('시간표 흐름 검사: ' + count + '개 통과')
