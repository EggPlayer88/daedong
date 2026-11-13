import assert from 'node:assert/strict'

// 새로고침 초안 보관만 허용한다. 단순 storage 개수 완화로 서버 응답·다른 계정 자료 저장을 놓치지 않는다.
export async function assertDraftOnlyCheckpoint(page, { memberId = 'gaon-soyeon', slots, requiredMessage } = {}) {
  const snapshot = await page.evaluate(() => ({
    local: Object.keys(localStorage), session: Object.entries(sessionStorage),
  }))
  assert.deepEqual(snapshot.local, [], '로컬 영구 저장소를 사용하면 안 됩니다')
  if (!snapshot.session.length) {
    assert.equal(requiredMessage, undefined, '작성한 메시지의 새로고침 복구 자료가 필요합니다')
    return []
  }
  assert.deepEqual(snapshot.session.map(([key]) => key), ['workhub:tab-checkpoint:v1:fixture-soyeon'])
  const raw = snapshot.session[0][1], saved = JSON.parse(raw)
  assert.deepEqual(Object.keys(saved).sort(), ['items', 'ownerId', 'version'])
  assert.equal(saved.version, 1); assert.equal(saved.ownerId, 'fixture-soyeon')
  assert.ok(Array.isArray(saved.items) && saved.items.length > 0 && saved.items.length <= 48)
  const gaon = memberId === 'gaon-soyeon'
  assert.ok(gaon || memberId === 'nuri-soyeon', '현재 fixture의 검증된 소속만 허용합니다')
  const scope = ['fixture-soyeon', gaon ? 'fixture-school-gaon' : 'fixture-school-nuri', memberId, true, '2020-01-01', '2099-12-31', 'teacher', [gaon ? 'curriculum' : 'research'], [gaon ? '2' : '1'], ['math']]
  const unique = new Set()
  for (const item of saved.items) {
    assert.deepEqual(Object.keys(item).sort(), ['channel', 'savedAt', 'scope', 'slot', 'value', 'warn'])
    assert.equal(item.channel, 'drafts', '조회·초안 준비만으로 미확정 쓰기 요청을 생성하면 안 됩니다')
    assert.deepEqual(JSON.parse(item.scope), scope)
    assert.ok(slots.includes(item.slot), '예상하지 않은 초안 슬롯: ' + item.slot)
    assert.ok(!unique.has(item.slot)); unique.add(item.slot)
    assert.equal(typeof item.warn, 'boolean'); assert.ok(Number.isSafeInteger(item.savedAt) && Math.abs(Date.now() - item.savedAt) < 60000)
    assert.ok(item.value && typeof item.value === 'object')
    if (item.slot === 'assistant') {
      assert.equal(item.value.thread, undefined); assert.equal(item.value.studentContext, null)
      assert.deepEqual(item.value.references, []); assert.equal(typeof item.value.prompt, 'string')
      if (item.value.draftDialogue) assert.deepEqual(JSON.parse(item.value.draftDialogue.scope), scope)
    }
    if (item.slot === 'messaging-composer') {
      assert.deepEqual(Object.keys(item.value).sort(), ['composing', 'draft', 'folded', 'pending'])
      assert.equal(item.value.pending, null); assert.equal(item.value.draft.thread, null)
      assert.deepEqual(item.value.draft.attachments, [])
      assert.equal(typeof item.value.draft.body, 'string')
      for (const recipient of item.value.draft.recipients) assert.equal(recipient.schoolId, scope[1])
    }
    if (item.slot === 'collection-editor') {
      assert.equal(item.value.upload, undefined); assert.equal(item.value.editor?.saving, undefined)
      if (item.value.editor) assert.deepEqual(item.value.editor.staged, [])
    }
  }
  assert.ok(saved.items.some(item => item.warn), '빈 화면 위치만 보관하지 않아야 합니다')
  assert.doesNotMatch(raw, /sk-ant-|sk-proj-|sb_secret_|[?&](?:token|signature|apikey|api_key)=|"(?:password|apiKey|access_token|refresh_token|authorization|authorizedEvidence|exchanges)"/i)
  assert.doesNotMatch(raw, /가온 홈 원본 내용|목록의 다른 대화 내용|저장된 계획|학생 근거 원문/)
  if (requiredMessage !== undefined) assert.equal(saved.items.find(item => item.slot === 'messaging-composer')?.value.draft.body, requiredMessage)
  return saved.items
}
