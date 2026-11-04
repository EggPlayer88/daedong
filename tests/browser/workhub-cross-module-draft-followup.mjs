import assert from 'node:assert/strict'
import { join } from 'node:path'

export async function checkDraftFollowup({ page, test, request, noSideEffects, output }) {
  const button = name => page.getByRole('button', { name, exact: true })
  const editor = name => page.getByRole('form', { name, exact: true })
  const box = () => page.getByRole('textbox', { name: '질문 또는 부탁할 일', exact: true })
  const messageCard = () => page.getByRole('region', { name: '작성 중인 메시지', exact: true })
  const collectionCard = () => page.getByRole('region', { name: '작성 중인 수합', exact: true })
  const results = () => page.getByRole('region', { name: '교사 검색 결과', exact: true })
  const messages = () => editor('새 메시지 작성')
  const collections = () => editor('수합 초안 작성')
  const body = '첫 줄 회의 안내\n둘째 줄 자료 확인'
  const title = '현장체험학습 계획'
  const notes = '준비 내용을 적어 주세요.\n변동 사항도 적어 주세요.'
  const messagePrompt = '메시지 초안: ' + body
  const collectionPrompt = '수합 초안: ' + title + '\n안내: ' + notes

  async function reply(text) {
    await box().fill(text)
    await button('초안 정보 이어 입력').click()
  }
  async function selectNamesake() {
    await page.evaluate(() => { window.cross.namesake = true })
    await request(messagePrompt, '수신자 이어서 선택')
    await messageCard().waitFor()
    await reply('이민준 선생님')
    await results().getByRole('button', { name: /이민준.*교무부.*선택/ }).waitFor()
    assert.equal(await results().getByRole('button', { name: /이민준.*선택/ }).count(), 2)
    assert.match(await messageCard().innerText(), /받는 사람 · 0명/)
    assert.equal(await button('작성 화면에서 확인').isDisabled(), true)
    await results().getByRole('button', { name: /이민준.*연구부.*선택/ }).click()
    await messageCard().getByRole('list', { name: '받는 사람 선택 목록' }).waitFor()
    assert.equal(await box().inputValue(), '')
  }
  async function continueToMessage() {
    await button('작성 화면에서 확인').click()
    const accept = button('전달받은 메시지 초안 사용')
    await accept.waitFor()
    assert.equal(await messages().count(), 0)
    await accept.click()
    await messages().waitFor()
    assert.equal(await messages().getByLabel('메시지', { exact: true }).inputValue(), body)
  }

  await test('동명이인 중 직접 고른 수신자 한 명과 여러 줄 본문만 기존 메시지 작성 화면에 들어간다', async () => {
    await selectNamesake()
    await noSideEffects()
    await continueToMessage()
    const people = messages().getByLabel('선택한 받는 사람 1명',{exact:true})
    await people.waitFor()
    assert.match(await people.innerText(), /이민준 · 연구부/)
    assert.doesNotMatch(await people.innerText(), /교무부/)
    const selected = messages().getByRole('checkbox', { name: /이민준.*연구부.*gaon-minjun-alt/ })
    await selected.waitFor()
    assert.equal(await selected.isChecked(), true)
    assert.equal(await messages().getByRole('checkbox', { name: /이민준.*교무부/ }).isChecked(), false)
    await page.screenshot({path:join(output,'followup-message-recipient.png'),fullPage:true})
    await noSideEffects()
  })

  await test('같은 학교로 재연결되면 이미 고른 교사와 전송하지 않은 후속 입력을 유지한다', async () => {
    await selectNamesake()
    await box().fill('김서진 선생님')
    await page.evaluate(() => { window.cross.failContext=true; window.dispatchEvent(new Event('focus')) })
    const denied=page.getByRole('heading',{name:'학교 연결을 완료하지 못했습니다',exact:true})
    await denied.waitFor()
    assert.equal(await messageCard().count(),0)
    await page.evaluate(() => { window.cross.failContext=false })
    await button('학교 연결 다시 확인').click()
    await messageCard().waitFor()
    const chosen=messageCard().getByRole('list',{name:'받는 사람 선택 목록'})
    assert.match(await chosen.innerText(), /이민준.*연구부/)
    assert.equal(await box().inputValue(),'김서진 선생님')
    assert.equal(await button('작성 화면에서 확인').isDisabled(),true)
    await noSideEffects()
  })

  await test('선택 후 소속 판이 달라지면 이전 수신자를 넣지 않고 본문과 다시 선택할 수 있는 작성기를 유지한다', async () => {
    await selectNamesake()
    await page.evaluate(() => { window.cross.namesakeVersion = 2 })
    await continueToMessage()
    await page.getByText('받는 사람 정보가 바뀌었습니다. 본문은 유지했으니 받는 사람을 다시 선택해 주세요.', {exact:true}).waitFor()
    assert.equal(await messages().getByRole('checkbox', {checked:true}).count(), 0)
    await noSideEffects()
  })

  await test('교사 조회 실패 후 검색어·초안이 남고 취소하면 최초 메시지 원문으로 돌아온다', async () => {
    await request(messagePrompt, '수신자 이어서 선택')
    await page.evaluate(() => { window.cross.denyRecipientSearch = true })
    await reply('이민준')
    await page.getByText(/교사 목록을 확인하지 못했습니다/).waitFor()
    assert.equal(await box().inputValue(), '이민준')
    assert.match(await messageCard().innerText(), /첫 줄 회의 안내/)
    await page.evaluate(() => { window.cross.denyRecipientSearch = false })
    await button('초안 정보 이어 입력').click()
    await results().getByRole('button', { name: /이민준.*선택/ }).waitFor()
    await button('이어 입력 취소').click()
    await messageCard().waitFor({state:'detached'})
    assert.equal(await box().inputValue(), messagePrompt)
    assert.equal(await messages().count(), 0)
    await noSideEffects()
  })

  await test('같은 이름·소속 번호 끝자리인 수합 교사도 선택 후 번호가 남고 해당 교사 한 명에게만 한 부를 준비한다', async () => {
    await request(collectionPrompt, '기한·대상 이어서 입력')
    await reply('이한결 선생님')
    const [other,selected]=['gaon-peer-a-111111','gaon-peer-b-111111']
    const label = id => '이한결 · 연구부 · 소속 번호 ' + id
    for (const id of [other,selected]) {
      await results().getByRole('button',{name:label(id)+' 선택',exact:true}).waitFor()
    }
    assert.match(await collectionCard().innerText(),/제출 대상 · 0명/)
    await results().getByRole('button',{name:label(selected)+' 선택',exact:true}).click()
    const chosen=collectionCard().getByRole('list',{name:'제출 대상 선택 목록',exact:true})
    await chosen.getByRole('button',{name:label(selected)+' 선택 해제',exact:true}).waitFor()
    assert.equal((await chosen.innerText()).includes(other),false)
    await reply('내일')
    await button('작성 화면에서 확인').click()
    await button('수합 초안 사용').click()
    const form=collections()
    await form.waitFor()
    assert.equal(await form.getByLabel('책임 교사 1',{exact:true}).inputValue(),selected)
    assert.equal(await form.getByRole('heading',{name:'제출 대상 1부 선택',exact:true}).count(),1)
    assert.equal(await form.getByLabel('책임 교사 2',{exact:true}).count(),0)
    await noSideEffects()
  })

  await test('수합은 없는 날짜를 거절하고 기준일의 내일·선택한 교사 두 명·제목과 여러 줄 안내를 원래 폼에 옮긴다', async () => {
    await request(collectionPrompt, '기한·대상 이어서 입력')
    await collectionCard().waitFor()
    await reply('2027-02-30')
    await page.getByRole('region',{name:'AI 비서',exact:true}).getByRole('alert').waitFor()
    assert.equal(await box().inputValue(), '2027-02-30')
    assert.match(await collectionCard().innerText(), /제출 기한 · 미입력/)
    await reply('내일')
    const tomorrow = await page.evaluate(() => new Date(Date.parse(window.cross.basisDate+'T00:00:00Z')+86400000).toISOString().slice(0,10))
    await collectionCard().getByText(tomorrow, {exact:true}).waitFor()
    for (const [index,person] of ['이민준','김서진'].entries()) {
      await reply(person+' 선생님')
      const candidate = results().getByRole('button', { name:new RegExp(person+'.*선택') })
      await candidate.waitFor()
      assert.match(await collectionCard().innerText(), new RegExp('제출 대상 · '+index+'명'))
      await candidate.click()
    }
    await button('작성 화면에서 확인').click()
    const accept=button('수합 초안 사용')
    await accept.waitFor()
    assert.equal(await collections().count(), 0)
    await accept.click()
    const form=collections()
    await form.waitFor()
    assert.equal(await form.getByLabel('수합 제목',{exact:true}).inputValue(), title)
    assert.equal(await form.getByLabel('안내 내용',{exact:true}).inputValue(), notes)
    assert.equal(await form.getByLabel('제출 기한',{exact:true}).inputValue(), tomorrow)
    assert.equal(await form.getByLabel('책임 교사 1',{exact:true}).inputValue(), 'gaon-minjun')
    assert.equal(await form.getByLabel('책임 교사 2',{exact:true}).inputValue(), 'gaon-seojin')
    assert.equal(await form.getByRole('heading',{name:'제출 대상 2부 선택'}).count(), 1)
    await page.screenshot({path:join(output,'followup-collection-deadline-targets.png'),fullPage:true})
    await noSideEffects()
  })
}

