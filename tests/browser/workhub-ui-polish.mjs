// 실제 화면·전송 어댑터에 합성 응답만 제공한다. 운영 DB나 유료 AI에는 접속하지 않는다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchBrowser } from './launch-browser.mjs'
import { clickWorkspaceMenu } from '../helpers/workspace-menu.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bundle = await build({ entryPoints: [join(root, 'tests/browser/workhub-cross-module-fixture.tsx')], bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': JSON.stringify({ MODE: 'test', VITE_SUPABASE_URL: 'https://example.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic' }), 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent', plugins: [{ name: 'ui-polish-fixture', setup(builder) {
  builder.onLoad({ filter: /assistant[\\/]legacy-http\.ts$/ }, () => ({ contents: 'export const legacyAssistantHttp={send:payload=>window.cross.assistantHttp(payload)};export const legacySchoolAiHttp={send:async()=>{throw Error("synthetic settings unavailable")}};export const legacySchoolAiOperationsHttp={send:async()=>{throw Error("synthetic operations unavailable")}}', loader: 'ts' }))
  builder.onLoad({ filter: /workhub-cross-module-fixture\.tsx$/ }, args => {
    let contents = readFileSync(args.path, 'utf8')
    contents = `import {ParticipantWorkspace} from '../../apps/workhub/src/participation/ParticipantWorkspace';import {timetablePracticeSnapshot} from '../../apps/workhub/src/timetable/sample';\n` + contents
    contents = contents.replace("if(name==='workhub_calendar_list')", `if(name==='workhub_timetable_target_get')return envelope(member,'timetable.target.v1',{termId:'practice-term',automaticTermId:'practice-term',selectedTermId:null,version:0,terms:[{id:'practice-term',schoolYear:Number(data.basisDate.slice(0,4)),label:'시험 학기',firstDay:data.basisDate.slice(0,4)+'-01-01',lastDay:data.basisDate.slice(0,4)+'-12-31',state:'current',hasBasis:true,hasPreparationDraft:false}]});
      if(name==='workhub_timetable_readiness')return envelope(member,'timetable.v1',{available:true});
      if(name==='workhub_timetable_get'){const snapshot=timetablePracticeSnapshot(data.basisDate);snapshot.basis.schoolId=member.schoolId;snapshot.weekStart=args.p_week_start;snapshot.lessons=[];snapshot.canSave=true;return envelope(member,'timetable.v1',snapshot)}
      if(name==='workhub_calendar_list')`)
    contents = contents.replace("label:day+' '+member.name+' 원본 수업'", "label:'국어 1회'")
    contents = contents.replace('lessons.push(lesson(member,date))', "{for(let hour=0;hour<7;hour++){const value=lesson(member,date);lessons.push({...value,id:value.id+(hour?'-p'+hour:''),label:['국어 1회','수학 1회','영어 1회','과학 1회','체육 1회','사회 1회','음악 1회'][hour],time:span(date,hour),allowedTargets:[span(date,hour)]})}}")
    contents = contents.replace(/if\(name==='workhub_timetable_operations_references'\).*?\n/, `if(name==='workhub_timetable_operations_references'){const rows=[];for(let day=args.p_from;day<args.p_until;day=offset(day,1))for(let hour=0;hour<7;hour++)rows.push({lessonId:member.id+'-'+day+(hour?'-p'+hour:''),version:1,groups:[{id:'class-'+member.id,name:'1학년 1반'}],rooms:[{id:'room-'+member.id,name:'1반 교실'}]});return envelope(member,'timetable-operations.next.v1',{asOf:args.p_source_as_of,from:args.p_from,until:args.p_until,lessons:rows})}\n`)
    contents = contents.replace("createRoot(document.getElementById('root')!).render", `if(w.polishParticipant){identity.profile.role='teacher';connection.loadContext=async()=>({...copy(ctx),schools:ctx.schools.filter(s=>s.id===primary.schoolId),memberships:ctx.memberships.filter(m=>m.schoolId===primary.schoolId).map(m=>({...m,role:'teacher'}))});connection.subscribeInvalidation=fn=>{w.cross.invalidate=fn;return()=>{}}}
      createRoot(document.getElementById('root')!).render`)
    contents = contents.replace("<ConnectedWorkspace expectedUserId={identity.userId} legacyHomeHref='/legacy' connection={connection}/>", `<>{w.polishParticipant?<ParticipantWorkspace access={{userId:identity.userId,schoolId:primary.schoolId,memberId:primary.id,scopes:w.polishScopes,expiresAt:new Date(Date.now()+3600000).toISOString(),revision:1}} connection={connection}/>:<ConnectedWorkspace expectedUserId={identity.userId} legacyHomeHref='/legacy' connection={connection}/>}</>`)
    return { contents, loader: 'tsx' }
  })
} }] })
const output = process.env.WORKHUB_QA_OUTPUT || mkdtempSync(join(tmpdir(), 'workhub-ui-polish-'))
mkdirSync(output, { recursive: true })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 1440, height: 900 } }), page = await context.newPage()
const errors = [], external = [], results = []
page.setDefaultTimeout(12000); page.on('pageerror', e => errors.push(e.message))
await context.route('**/*', route => {
  const url = new URL(route.request().url())
  if (url.origin !== 'http://127.0.0.1:5187') { external.push(url.href); return route.abort() }
  const match = url.pathname.match(/(PretendardVariable|TossFaceFontMac-0[789])\.woff2$/)
  if (match) return route.fulfill({ contentType: 'font/woff2', body: readFileSync(join(root, 'apps/workhub/src/assets/fonts', match[1].startsWith('Toss') ? 'tossface' : '', match[0])) })
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div></body></html>' })
})
const allScopes = ['messages','tasks','calendar','cooperation','collections','transitions','teaching','timetable']
const ai = () => page.getByRole('dialog', { name: 'AI 옆자리', exact: true })
const nav = () => page.getByRole('navigation', { name: '허용된 업무', exact: true })
async function start(scopes) {
  await page.goto('http://127.0.0.1:5187/ui-polish')
  await page.evaluate(scopes => { window.polishParticipant = Boolean(scopes); window.polishScopes = scopes }, scopes)
  await page.addStyleTag({ content: readFileSync(join(root, 'apps/workhub/src/typography.css'), 'utf8') + readFileSync(join(root, 'apps/workhub/src/assets/fonts/tossface/tossface.css'), 'utf8') })
  await page.addScriptTag({ content: bundle.outputFiles[0].text })
  await page.getByRole('heading', { name: scopes ? '메시지와 알림' : '오늘', level: 1, exact: true }).waitFor()
  await page.evaluate(async () => { await document.fonts.load('24px Tossface', '🏠📋💬'); await document.fonts.ready })
}
async function screenshot(name) { await page.screenshot({ path: join(output, name + '.png'), fullPage: false }) }
async function fits() { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '문서 전체 가로 넘침') }
async function check(name, action) { await action(); results.push(name); console.log('  ✓ ' + name) }
try {
  await start()
  await check('빈 T1 수업 배열을 공개 수업 없음으로 오인하지 않고 편성부터 열며 공개 조회로 돌아온다', async () => {
    await clickWorkspaceMenu(page, '시간표')
    await page.getByRole('region', { name: '주간 시간표', exact: true }).getByRole('button', { name: /국어/ }).first().waitFor()
    await page.getByRole('button', { name: '편성 관리', exact: true }).click()
    await page.getByRole('heading', { name: '1. 기초 자료 확인', exact: true }).waitFor()
    await page.getByLabel('준비할 학기 선택', { exact: true }).waitFor()
    assert.equal(await page.getByRole('alert').count(), 0)
    assert.equal(await page.getByText('이 주에 공개된 내 수업이 없습니다', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '시간표 만들기', exact: true }).getAttribute('aria-pressed'), 'true')
    await screenshot('01-editor')
    await page.getByRole('button', { name: '공개 시간표 보기', exact: true }).click()
    await page.getByRole('region', { name: '주간 시간표', exact: true }).waitFor()
    assert.deepEqual(await page.evaluate(() => window.cross.writes), [])
  })
  await check('간결한 수업 표시에서도 전체 접근성 이름·선택·상세를 보존하고 반복 정보를 다시 펼칠 수 있다', async () => {
    const week = page.getByRole('region', { name: '주간 시간표', exact: true })
    const first = week.getByRole('button', { name: /국어/ }).first()
    const name = await first.getAttribute('aria-label')
    assert.match(name, /국어 1회.*1학년 1반.*09:00/)
    assert.equal(await first.locator('small').count(), 0)
    const compactHeight = (await first.boundingBox()).height
    await first.click()
    await page.getByRole('region', { name: '선택한 수업', exact: true }).waitFor()
    await screenshot('02-timetable-compact')
    await page.getByRole('button', { name: '수업 정보 자세히', exact: true }).click()
    assert.equal(await first.getAttribute('aria-label'), name)
    assert.equal(await first.getAttribute('aria-pressed'), 'true')
    assert(await first.locator('small').count() > 0)
    assert((await first.boundingBox()).height > compactHeight, '간결한 표시에서 반복 정보만큼 높이를 줄여야 한다')
    await page.getByRole('button', { name: '수업 정보 자세히', exact: true }).click()
    assert.equal(await first.getAttribute('aria-pressed'), 'true')
    await fits()
  })
  await check('AI 입력과 요청 버튼은 900px 데스크톱·844px 휴대폰의 첫 화면에 있고 자동 호출하지 않는다', async () => {
    await clickWorkspaceMenu(page, 'AI 비서')
    for (const viewport of [{width:1440,height:900}, {width:390,height:844}]) {
      await page.setViewportSize(viewport)
      const send = ai().getByRole('button', { name: 'Claude에게 요청', exact: true })
      await send.waitFor()
      const box = await send.boundingBox()
      assert(box.y >= 0 && box.y + box.height <= viewport.height, `요청 버튼이 첫 화면을 벗어남: ${JSON.stringify(box)}`)
      assert(await ai().locator('.assistant-compose').evaluate(el => Boolean(el.compareDocumentPosition(el.closest('.assistant-workspace').querySelector('.assistant-budget-disclosure')) & Node.DOCUMENT_POSITION_FOLLOWING)))
      await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).fill('자동으로 보내지 않는 보관 질문')
      await screenshot(viewport.width > 720 ? '03-ai-desktop' : '04-ai-mobile')
      await fits()
    }
    assert.deepEqual(await page.evaluate(() => window.cross.aiCalls), [])
    await ai().getByRole('button', { name: 'AI 옆자리 닫기', exact: true }).click()
    await page.getByRole('button', { name: 'AI 비서 열기', exact: true }).click()
    assert.equal(await ai().getByLabel('질문 또는 부탁할 일', { exact: true }).inputValue(), '자동으로 보내지 않는 보관 질문')
  })
  await check('시험 교사도 공통 셸을 쓰며 허용된 8개 업무만 탐색하고 AI·학교관리·공개 기능은 추가하지 않는다', async () => {
    await page.setViewportSize({width:1440,height:900}); await start(allScopes)
    assert(await page.locator('.ws-participant').isVisible())
    assert.deepEqual(await page.locator('.ws-primary-menus button').allTextContents(), ['💬메시지','🗓시간표','📋업무','📅일정'])
    assert.equal(await page.getByRole('button', { name: /AI 비서/ }).count(), 0)
    await nav().getByRole('button', {name:'더보기',exact:true}).click()
    const more = page.getByRole('dialog', {name:'더보기',exact:true})
    for (const name of ['협업 요청','자료 수합','업무 인계','수업과 평가']) assert(await more.getByRole('button',{name,exact:true}).isVisible())
    for (const name of ['학교 관리','문서함','학교 자료','AI 비서']) assert.equal(await more.getByRole('button',{name,exact:true}).count(),0)
    await more.getByRole('button',{name:'더보기 닫기',exact:true}).click()
    await nav().getByRole('button',{name:'시간표',exact:true}).click()
    await page.getByRole('region',{name:'주간 시간표',exact:true}).getByRole('button',{name:/국어/}).first().waitFor()
    assert.equal(await page.getByRole('button',{name:'편성 관리',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:/AI 추천/}).count(),0)
    assert.equal(await page.getByRole('heading',{level:1}).count(),1)
    await screenshot('05-participant-timetable'); await fits()
  })
  await check('시험 교사 메시지 작성 중에는 새 셸의 다른 메뉴도 잠기고 취소 후에만 풀린다', async () => {
    await nav().getByRole('button',{name:'메시지',exact:true}).click()
    await page.getByRole('button',{name:'새 메시지',exact:true}).click()
    await page.getByRole('textbox',{name:'메시지',exact:true}).fill('보관 중인 시험 교사 메시지')
    // 자식의 편집 상태가 effect를 거쳐 공통 메뉴에 반영된 뒤 실제 잠금 상태를 검사한다.
    await nav().locator('button[aria-label="시간표"]:disabled').waitFor()
    assert(await nav().getByRole('button',{name:'시간표',exact:true}).isDisabled())
    await nav().getByRole('button',{name:'더보기',exact:true}).click()
    assert(await page.getByRole('dialog',{name:'더보기',exact:true}).getByRole('button',{name:'자료 수합',exact:true}).isDisabled())
    await page.getByRole('button',{name:'더보기 닫기',exact:true}).click()
    assert.equal(await page.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'보관 중인 시험 교사 메시지')
    await page.getByRole('button',{name:'작성 닫기',exact:true}).click()
    assert(await nav().getByRole('button',{name:'시간표',exact:true}).isDisabled())
    assert.equal(await page.getByRole('textbox',{name:'메시지',exact:true}).inputValue(),'보관 중인 시험 교사 메시지')
    await page.getByRole('button',{name:'작성한 입력 버리고 닫기',exact:true}).click()
    await page.getByRole('textbox',{name:'메시지',exact:true}).waitFor({state:'hidden'})
    await nav().locator('button[aria-label="시간표"]:enabled').waitFor()
    assert(await nav().getByRole('button',{name:'시간표',exact:true}).isEnabled())
    await nav().getByRole('button',{name:'시간표',exact:true}).click()
    await page.getByRole('region',{name:'주간 시간표',exact:true}).getByRole('button',{name:/국어/}).first().waitFor()
    await nav().getByRole('button',{name:'메시지',exact:true}).click()
    await page.getByRole('button',{name:'새 메시지',exact:true}).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.cross.writes),[])
    await page.setViewportSize({width:390,height:844}); await screenshot('06-participant-mobile'); await fits()
    await page.setViewportSize({width:320,height:800})
    await page.locator('.ws-shell').evaluate(element=>{element.dataset.textSize='large';element.dataset.theme='dark'})
    await fits()
    for(const button of await nav().getByRole('button').all()) {
      if(!await button.isVisible())continue
      const box=await button.boundingBox();assert(box.x>=0&&box.x+box.width<=321)
    }
  })
  await check('메신저만 허용된 교사는 숨은 다른 메뉴가 없고 소속 무효화 때 이전 내용을 숨긴다', async () => {
    await start(['messages'])
    assert.equal(await nav().getByRole('button',{name:'시간표',exact:true}).count(),0)
    await nav().getByRole('button',{name:'더보기',exact:true}).click()
    const more=page.getByRole('dialog',{name:'더보기',exact:true})
    assert.equal(await more.locator('.ws-sheet-menus button').count(),0)
    await more.getByRole('button',{name:'더보기 닫기',exact:true}).click()
    await page.evaluate(()=>window.cross.invalidate())
    await page.getByRole('button',{name:'학교 소속 다시 확인',exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'새 메시지',exact:true}).count(),0)
    assert.equal(await page.getByRole('button',{name:/AI 비서/}).count(),0)
    await fits()
  })
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
} catch (error) {
  await screenshot('failure'); console.error((await page.locator('.ws-content').innerText()).slice(-3000)); throw error
} finally {
  writeFileSync(join(output, 'summary.json'), JSON.stringify({results,errors,external},null,2)); await browser.close()
}
console.log(`UI 후속 정리 브라우저 ${results.length}건 통과 · ${output}`)
