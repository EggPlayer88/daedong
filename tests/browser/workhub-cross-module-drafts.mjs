import assert from 'node:assert/strict'
import { assertDraftOnlyCheckpoint } from '../helpers/tab-checkpoint.mjs'
import { join } from 'node:path'
import { checkFirstDraftSentence } from './workhub-cross-module-first-draft.mjs'
import { checkDraftFollowup } from './workhub-cross-module-draft-followup.mjs'

// 실제 연결 셸에서 교사가 입력한 초안을 전달한다. 합성 RPC·Storage·AI 호출은 각각 기록한다.
export async function checkExplicitDrafts({ page, go, test, output }) {
  const button = name => page.getByRole('button', { name, exact: true })
  const prompt = () => page.getByLabel('질문 또는 부탁할 일', { exact: true })
  const collectionCard = () => page.getByRole('region', { name: '전달받은 수합 초안', exact: true })
  const collectionForm = () => page.getByRole('form', { name: '수합 초안 작성', exact: true })
  const messageForm = () => page.getByRole('form', { name: '새 메시지 작성', exact: true })
  const message = '내일 회의 자료를 확인해 주세요'
  const title = '현장체험학습 계획서'
  const instructions = '학급별 계획을 확인해 주세요.\n변경된 시간도 적어 주세요.'

  async function request(text, label) {
    if (!await prompt().isVisible()) await go('AI 비서')
    await prompt().fill(text)
    await button(label).click()
  }
  async function noSideEffects() {
    const result = await page.evaluate(() => ({
      asks: window.cross.aiCalls, writes: window.cross.writes, storage: window.cross.storageCalls,
      files: window.cross.calls.filter(row => row.name.startsWith('workhub_file_')),
    }))
    assert.deepEqual(result, { asks: [], writes: [], storage: [], files: [] })
    await assertDraftOnlyCheckpoint(page, { memberId: await page.getByLabel('사용할 학교').inputValue(), slots: ['assistant', 'messaging-composer', 'collection-editor', 'calendar-panel', 'calendar-browse', 'calendar-assistant-view', 'task-panel'] })
  }

  await checkFirstDraftSentence({ page, test, request, noSideEffects })
  await checkDraftFollowup({ page, go, test, request, noSideEffects, output })

  await test('명시한 메시지 본문을 한 번만 편집기에 옮기고 받는 사람은 교사가 선택한다', async () => {
    await page.evaluate(() => { window.cross.budgetExhausted = true })
    await go('AI 비서')
    await page.getByText('승인된 이용 한도에 도달했습니다.', { exact: true }).waitFor()
    await request('메시지 초안: ' + message, '메시지 초안 열기')
    const accept = button('전달받은 메시지 초안 사용')
    await messageForm().waitFor()
    await noSideEffects()
    assert.equal(await page.locator('.messaging-workspace').getAttribute('data-presentation'), 'assistant')
    assert.equal(await page.getByRole('region', {name:'대화 목록',exact:true}).count(), 0)
    assert.equal(await accept.count(), 0)
    assert.equal(await messageForm().getByLabel('메시지', { exact: true }).inputValue(), message)
    const recipient = messageForm().getByLabel('이민준 · 교무부', { exact: true })
    await recipient.waitFor()
    assert.equal(await recipient.isChecked(), false)
    assert.equal(await messageForm().locator('input[type="checkbox"]:checked').count(), 0)
    await page.screenshot({ path: join(output, 'explicit-message-draft.png'), fullPage: true })
    await button('작성 닫기').click()
    await button('작성한 입력 버리고 닫기').click()
    await messageForm().waitFor({ state: 'detached' })
    await go('오늘')
    await go('메시지와 알림')
    await button('새 메시지').waitFor()
    assert.equal(await accept.count(), 0)
    await noSideEffects()
  })

  await test('수합 초안의 제목·여러 줄 안내만 가져오고 기한·대상·검토자·양식은 비워 둔다', async () => {
    await request('수합 초안: ' + title + '\n안내: ' + instructions, '수합 초안 열기')
    await collectionCard().waitFor()
    assert.equal(await collectionForm().count(), 0)
    await noSideEffects()
    await collectionCard().getByRole('button', { name: '수합 초안 사용', exact: true }).click()
    const form = collectionForm()
    await form.waitFor()
    assert.equal(await collectionCard().count(), 0)
    assert.equal(await form.getByLabel('수합 제목', { exact: true }).inputValue(), title)
    assert.equal(await form.getByLabel('안내 내용', { exact: true }).inputValue(), instructions)
    assert.equal(await form.getByLabel('제출 기한', { exact: true }).inputValue(), '')
    assert.equal(await form.getByLabel('제출 후 검토', { exact: true }).inputValue(), '')
    assert.match(await form.innerText(), /0부 선택/)
    assert.equal(await form.getByRole('list', { name: '선택한 양식' }).getByRole('listitem').count(), 0)
    assert.equal(await form.getByLabel('양식 파일 선택', { exact: true }).evaluate(node => node.files.length), 0)
    assert.equal(await form.getByRole('button', { name: '수합 초안 저장' }).isDisabled(), true)
    await page.screenshot({ path: join(output, 'explicit-collection-draft.png'), fullPage: true })
    await noSideEffects()
  })

  await test('접어 둔 메시지가 있으면 새 로컬 명령과 기존 수신자·본문을 각각 보존한다', async () => {
    const original = '담당자와 확인하던 원래 입력'
    await go('메시지와 알림')
    await button('새 메시지').click()
    await page.getByLabel('이민준 · 교무부', { exact: true }).check()
    await page.getByLabel('메시지', { exact: true }).fill(original)
    await button('입력 접고 목록 보기').click()
    const command = '메시지 초안: ' + message
    await request(command, '메시지 초안 열기')
    await page.getByRole('region', { name: 'AI 비서', exact: true }).getByRole('alert').waitFor()
    assert.equal(await prompt().inputValue(), command)
    await button('질문 비우기').click()
    await go('메시지와 알림')
    await button('작성 계속하기').click()
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), original)
    assert.equal(await page.getByLabel('이민준 · 교무부', { exact: true }).isChecked(), true)
    assert.equal(await button('전달받은 메시지 초안 사용').count(), 0)
    await noSideEffects()
  })

  await test('수합 연결 실패와 복구 뒤에도 자동으로 작성하지 않고 취소한 초안을 재사용하지 않는다', async () => {
    await page.evaluate(() => { window.cross.collectionUnavailable = true })
    await request('수합 초안: ' + title, '수합 초안 열기')
    await button('준비 상태 다시 확인').waitFor()
    const accept = button('수합 초안 사용')
    assert.ok(!await accept.count() || await accept.isDisabled())
    assert.equal(await page.getByText(title, { exact: true }).count(), 0)
    assert.equal(await collectionForm().count(), 0)
    await page.evaluate(() => { window.cross.collectionUnavailable = false })
    await button('준비 상태 다시 확인').click()
    await accept.and(page.locator(':enabled')).waitFor()
    assert.equal(await collectionForm().count(), 0)
    await button('전달받은 수합 초안 닫기').click()
    await collectionCard().waitFor({ state: 'detached' })
    await go('오늘')
    await go('자료 수합')
    await button('새 수합 만들기').waitFor()
    assert.equal(await collectionCard().count(), 0)
    assert.equal(await collectionForm().count(), 0)
    await noSideEffects()
  })

  await test('목록 권한이 거절되면 수합 작성 폼과 저장을 열 수 없다', async () => {
    await page.evaluate(() => { window.cross.denyCollectionList = true })
    await request('수합 초안: ' + title, '수합 초안 열기')
    await button('연결과 원본 다시 확인').waitFor()
    const accept = button('수합 초안 사용')
    assert.ok(!await accept.count() || await accept.isDisabled())
    assert.equal(await page.getByText(title, { exact: true }).count(), 0)
    assert.equal(await collectionForm().count(), 0)
    await noSideEffects()
  })

  for (const offer of [
    { name: '메시지', content: message, accept: '전달받은 메시지 초안 사용', editor: messageForm, ready: '새 메시지', file: 'message', page: '메시지와 알림' },
    { name: '수합', content: title, accept: '수합 초안 사용', editor: collectionForm, ready: '새 수합 만들기', file: 'collection', page: '자료 수합' },
  ]) {
    await test(offer.name + ' 미전송 초안은 동일 소속 재연결 때 복구하고 승인 철회 뒤에는 폐기한다', async () => {
      const accept = button(offer.accept)
      const errorPanel = page.getByRole('heading', { name: '학교 연결을 완료하지 못했습니다', exact: true })
      const assertPrepared = async () => {
        if (offer.file === 'message') {
          await offer.editor().waitFor()
          assert.equal(await offer.editor().getByLabel('메시지', {exact:true}).inputValue(), offer.content)
          assert.equal(await accept.count(), 0)
        } else {
          await accept.and(page.locator(':enabled')).waitFor()
          await collectionCard().getByText(offer.content, {exact:true}).waitFor()
          assert.equal(await offer.editor().count(), 0)
        }
      }
      await request(offer.name + ' 초안: ' + offer.content, offer.name + ' 초안 열기')
      await assertPrepared()
      await page.evaluate(() => { window.cross.failContext = true; window.dispatchEvent(new Event('focus')) })
      await errorPanel.waitFor()
      assert.equal(await accept.count(), 0)
      assert.equal(await offer.editor().count(), 0)
      await page.evaluate(() => { window.cross.failContext = false })
      await button('학교 연결 다시 확인').click()
      await assertPrepared()
      await page.screenshot({ path: join(output, 'explicit-' + offer.file + '-reconnected-offer.png'), fullPage: true })
      await page.evaluate(() => { window.cross.approvalRevoked = true; window.dispatchEvent(new Event('focus')) })
      await errorPanel.waitFor()
      assert.equal(await offer.editor().count(), 0)
      await page.evaluate(() => { window.cross.approvalRevoked = false })
      await button('학교 연결 다시 확인').click()
      await go(offer.page)
      await button(offer.ready).and(page.locator(':enabled')).waitFor()
      assert.equal(await accept.count(), 0)
      assert.equal(await page.getByText(offer.content, {exact:true}).count(), 0)
      assert.equal(await offer.editor().count(), 0)
      await noSideEffects()
    })
  }

  await test('다른 학교로 바꾼 뒤에는 이전 학교의 미사용 수합 초안을 표시하지 않는다', async () => {
    await request('수합 초안: ' + title, '수합 초안 열기')
    await collectionCard().waitFor()
    await page.getByLabel('사용할 학교').selectOption('nuri-soyeon')
    await go('자료 수합')
    await button('새 수합 만들기').and(page.locator(':enabled')).waitFor()
    assert.equal(await collectionCard().count(), 0)
    assert.equal(await collectionForm().count(), 0)
    assert.doesNotMatch(await page.getByRole('main').innerText(), new RegExp(title))
    const member = await page.evaluate(() => window.cross.calls.filter(row => row.name === 'workhub_collection_list').at(-1).args.p_member_id)
    assert.equal(member, 'nuri-soyeon')
    await noSideEffects()
  })

  await test('직접 전송·공개 요청은 확인 안내에서 멈추고 일반 작성 요청만 AI에 한 번 보낸다', async () => {
    for (const text of ['교사들에게 메시지를 전송해줘', '수합을 공개해줘']) {
      await request(text, '요청 확인')
      assert.equal(await prompt().inputValue(), text)
      assert.equal(await messageForm().count() + await collectionForm().count(), 0)
      await noSideEffects()
    }
    const text = '현장체험학습 안내 메시지를 짧게 작성해 주세요.'
    await request(text, 'AI에게 요청')
    await page.getByRole('heading', { name: 'AI 답변', exact: true }).waitFor()
    // 자동 전문 관점은 전달 꼬리표만 더하며 사용자에게는 같은 원문을 보여 준다.
    assert.deepEqual(await page.evaluate(() => window.cross.aiCalls.map(call => call.input.prompt)), [text + '\n\n[[:2:]]'])
    assert.equal(await page.locator('.assistant-question .assistant-text').innerText(), text)
    assert.deepEqual(await page.evaluate(() => window.cross.writes), [])
  })
}
