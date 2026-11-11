// 실제 React 메신저의 확인·복구·읽음·파일 동선을 합성 서버로 검사한다. 운영 DB에는 연결하지 않는다.
import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'

const bundle = buildSync({ stdin: { contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{MessagingWorkspace}from'./apps/workhub/src/messaging/MessagingWorkspace';
import{MessagingError}from'./apps/workhub/src/messaging/contracts';
import{EditDraftsProvider,createEditDrafts}from'./apps/workhub/src/app/edit-drafts';
import{PendingRequestsProvider,createPendingRequests}from'./apps/workhub/src/app/pending-requests';
const clone=value=>structuredClone(value),now='2026-10-16T12:00:00+09:00';
const member={id:'teacher',userId:'user',schoolId:'school',name:'나',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const recipients=[{memberId:'kim',schoolId:'school',name:'김교사',department:'교무부',version:1},{memberId:'lee',schoolId:'school',name:'이교사',department:'연구부',version:1}];
const thread={id:'thread',schoolId:'school',kind:'direct',title:'김교사와의 대화',participants:[{memberId:'teacher',schoolId:'school',name:'나',department:'',version:1},recipients[0]],version:1,latestSequence:2,readSequence:0,unreadCount:1,updatedAt:now,canSend:true};
const message={id:'message',schoolId:'school',threadId:'thread',senderMemberId:'kim',senderName:'김교사',sequence:2,body:'회의자료를 확인해 주세요.',createdAt:now,attachments:[]};
const notifications=[{id:'notice',schoolId:'school',ownerMemberId:'teacher',title:'수합 제출 기한',body:'학급 자료를 제출해 주세요.',createdAt:now,readAt:null,version:1,source:{module:'collections',id:'collection-one'}},{id:'student-notice',schoolId:'school',ownerMemberId:'teacher',title:'학생 확인',body:'학생 기록 원본을 확인해 주세요.',createdAt:now,readAt:null,version:1,source:{module:'students',id:'student-one'}},{id:'cooperation-notice',schoolId:'school',ownerMemberId:'teacher',title:'협업 요청 도착',body:'최신 담당자와 상태를 원본에서 확인해 주세요.',createdAt:now,readAt:null,version:1,source:{module:'cooperation',id:'cooperation-one'}}];
window.calls=[];window.delivered=0;window.readWrites=0;window.sourceError=null;window.sourceDeferred=false;window.fileCalls=[];window.fileUploaded=false;window.fileFailed=false;window.sources=[];window.listFailed=false;window.saved=new Map();window.pending=createPendingRequests();window.drafts=createEditDrafts();window.readinessCalls=0;window.replayOptions=[];
function receipt(command,key){return{requestKey:key,kind:command.kind,recordedAt:now,deliveries:command.kind==='start'?(command.mode==='individual'?command.recipients.map((r,i)=>({threadId:'thread-'+i,messageId:'sent-'+i,recipientMemberIds:[r.memberId],sequence:3})):[{threadId:'thread',messageId:'sent',recipientMemberIds:command.recipients.map(r=>r.memberId),sequence:3}]):command.kind==='reply'?[{threadId:'thread',messageId:'sent',recipientMemberIds:command.recipientMemberIds,sequence:3}]:[],threadId:['reply','read_thread'].includes(command.kind)?command.threadId:null,throughSequence:command.kind==='read_thread'?command.throughSequence:null,noticeId:command.kind==='read_notice'?command.noticeId:null,version:command.kind==='read_notice'?command.expectedVersion+1:null}}
const server={async readiness(){window.readinessCalls++;if(window.forceDisabled)return{available:false,reason:'disabled',limits:null,attachments:'not_configured'};if(window.scenario==='missing')throw new MessagingError('QUERY_FAILED');return{available:true,reason:'ready',limits:{bodyCharacters:2000,titleCharacters:100,recipients:window.recipientLimit ?? 50},attachments:window.scenario==='files'?'hwpx_basic_v1':'not_configured'}},async recipients(member,query,cursor){if(window.recipientQueryFail)throw new MessagingError('QUERY_FAILED');return{items:clone(recipients.filter(r=>(r.name+r.department).includes(query))),nextCursor:null}},async threads(){if(window.listFailed)throw new MessagingError('QUERY_FAILED');return{items:[clone(thread)],nextCursor:null}},async messages(){return{thread:clone(thread),items:[clone(message)],nextCursor:null}},async inbox(member,unread){return{items:clone(notifications.filter(n=>!unread||!n.readAt)),nextCursor:null}},async mutate(member,command,key,options){window.replayOptions.push(clone(options));window.calls.push(clone({member,command,key}));if(window.scenario==='conflict'&&command.kind==='reply'&&thread.version===1){thread.version=2;thread.kind='group';thread.participants.push(recipients[1]);throw new MessagingError('CONFLICT')}if(window.saved.has(key))return clone(window.saved.get(key));if(window.scenario==='notice_conflict'&&command.kind==='read_notice'&&!window.readConflict){window.readConflict=true;notifications.find(n=>n.id===command.noticeId).version=2;throw new MessagingError('CONFLICT')}const result=receipt(command,key);if(command.kind==='start'||command.kind==='reply')window.delivered++;if(command.kind==='read_thread')thread.readSequence=command.throughSequence;if(command.kind==='read_notice'){window.readWrites++;const n=notifications.find(n=>n.id===command.noticeId);n.readAt=now;n.version++}window.saved.set(key,result);if((window.scenario==='unknown'||window.scenario==='notice_unknown')&&!window.failed){window.failed=true;throw new MessagingError('RESULT_UNKNOWN')}return clone(result)}};
const ref={id:'message-file',name:'학급자료.hwpx',bytes:7,sha256:'a'.repeat(64),profile:'hwpx_basic_v1'};
const fileServer={async readiness(){return{available:true,reason:'ready',policy:{extensions:['hwpx'],maxFileBytes:1024,maxFiles:2}}},async prepare(member,file,policy,key,options){window.fileCalls.push({options,kind:'prepare',key,name:file.name});return{fileId:ref.id,bucket:'workhub-message-files',path:'school/teacher/message-file/original.hwpx',expiresAt:'2099-10-16T12:00:00Z',state:'awaiting_upload'}},async upload(){window.fileCalls.push({kind:'upload'});window.fileUploaded=true},async complete(member,fileId,key){window.fileCalls.push({kind:'complete',key,fileId});if(!window.fileUploaded)return{fileId,state:'awaiting_upload',file:null,storageObjectId:null};if(!window.fileFailed){window.fileFailed=true;throw new MessagingError('RESULT_UNKNOWN')}return{fileId,state:'ready',file:ref,storageObjectId:'object'}},async status(){window.fileCalls.push({kind:'status',fileId:ref.id});return{fileId:ref.id,state:'ready',file:ref,storageObjectId:'object'}},async download(){return new Blob(['파일'])}};
window.recipientRows=recipients;window.listQueries=0;for(const method of ['threads','inbox']){const original=server[method];server[method]=async(...args)=>{window.listQueries++;return original(...args)}}
function App(){const[ai,setAi]=useState(undefined);window.proposeMessage=value=>setAi({id:'ai-request',schoolId:'school',memberId:'teacher',body:'AI가 작성한 안내 초안',...value});const[revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[current,setCurrent]=useState(member);window.refresh=()=>setRevision(v=>v+1);window.unmount=()=>setMounted(false);window.remount=()=>setMounted(true);window.changeScope=()=>setCurrent({...member,id:'other-member',userId:'other-user',schoolId:'other-school'});return<EditDraftsProvider store={window.drafts}><PendingRequestsProvider store={window.pending}>{mounted&&<MessagingWorkspace presentation={window.presentation} composeRequest={ai} onComposeRequestConsumed={()=>setAi(undefined)} connection={{}} server={server} fileServer={fileServer} member={current} date='2026-10-16' revision={revision} onNavigationLockChange={v=>window.locked=v} canOpenSource={source=>['collections','cooperation'].includes(source.module)} onOpenSource={async source=>{window.sources.push(source);if(source.module==='cooperation'&&window.sourceError)throw Object.assign(new Error('원본 조회 실패'),{code:window.sourceError});if(window.sourceDeferred)await new Promise(resolve=>window.resolveSource=resolve)}}/>}</PendingRequestsProvider></EditDraftsProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`, resolveDir: fileURLToPath(new URL('../../', import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'import.meta.env': '{}', 'process.env.NODE_ENV': '"development"' }, logLevel: 'silent' })
const browser = await launchBrowser(), context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage()
const errors = [], external = [], passed = [], output = process.env.WORKHUB_QA_OUTPUT
page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message))
await context.route('**/*', route => {
  if (!route.request().url().startsWith('http://127.0.0.1:5179/')) { external.push(route.request().url()); return route.abort() }
  return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>' })
})
async function start(scenario = '', presentation = 'page') { await page.goto('http://127.0.0.1:5179/messages'); await page.evaluate(value => { window.scenario = value.scenario; window.presentation=value.presentation }, {scenario,presentation}); await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.getByRole('heading', { name: presentation==='assistant'?'메시지 보내기':'메시지와 알림',exact:true }).waitFor(); if (scenario !== 'missing' && presentation !== 'assistant') await page.getByRole('button', { name: /김교사와의 대화/ }).waitFor() }
async function test(name, run, scenario = '', presentation = 'page') { await start(scenario,presentation); try { await run() } catch (error) { console.error('실패 화면:', await page.locator('body').innerText()); console.error('입력 상태:', await page.locator('textarea').evaluateAll(items => items.map(i => ({html:i.outerHTML,labels:[...i.labels].map(l=>l.outerHTML)})))); throw error } passed.push(name); console.log('  ✓ ' + name) }
async function compose() { await page.getByRole('button', { name: '새 메시지', exact: true }).click(); await page.getByLabel('김교사 · 교무부', { exact: true }).check(); await page.getByLabel('메시지', { exact: true }).fill('확인 부탁드립니다.') }
try {
  await test('AI 메시지 초안은 사용자 선택 뒤 불러오고 받는 사람은 자동 선택하지 않는다',async()=>{
    await page.evaluate(()=>window.proposeMessage({}));assert.equal(await page.getByLabel('메시지',{exact:true}).count(),0)
    await page.getByRole('button',{name:'전달받은 메시지 초안 사용',exact:true}).click()
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'AI가 작성한 안내 초안')
    assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0);assert.equal(await page.evaluate(()=>window.calls.length),0)
    await page.getByLabel('김교사 · 교무부',{exact:true}).check();await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click()
    assert.equal(await page.evaluate(()=>window.calls.length),0);await page.getByRole('button',{name:'확인한 내용 보내기'}).click();await page.getByText(/메시지를 보냈습니다/).waitFor()
  })
  const kim = { memberId: 'kim', schoolId: 'school', name: '김교사', department: '교무부', version: 1 }
  const lee = { memberId: 'lee', schoolId: 'school', name: '이교사', department: '연구부', version: 1 }
  const offer = people => page.evaluate(recipients => window.proposeMessage({
    basisDate: '2026-10-16', body: '회의 안건을 확인해 주세요.', recipients,
  }), people)
  const accept = () => page.getByRole('button', { name: '전달받은 메시지 초안 사용', exact: true })
  await test('대화에서 고른 두 수신자를 개별 대화 작성으로 넘기고 미리보기까지 전송하지 않는다', async () => {
    await offer([lee, kim])
    await accept().click()
    await page.getByRole('form', { name: '새 메시지 작성' }).waitFor()
    assert.equal(await page.getByLabel('보내는 방식').inputValue(), 'individual')
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 2)
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '회의 안건을 확인해 주세요.')
    await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click()
    assert.match(await page.getByRole('region', { name: '보내기 전 확인' }).innerText(), /각 교사와의 개별 대화/)
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('수신자 재조회 실패에는 초안을 보존하고 판이 바뀐 사람이 있으면 전원을 다시 선택한다', async () => {
    await offer([kim, { ...lee, version: 2 }])
    await page.evaluate(() => { window.recipientQueryFail = true })
    await accept().click()
    await page.getByText(/서버에 연결하지 못했습니다/).waitFor()
    assert.equal(await page.getByRole('form', { name: '새 메시지 작성' }).count(), 0)
    assert.equal(await accept().isEnabled(), true)
    await page.evaluate(() => { window.recipientQueryFail = false })
    await accept().click()
    await page.getByText(/받는 사람 정보가 바뀌었습니다/).waitFor()
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0)
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '회의 안건을 확인해 주세요.')
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('수신자 수 정책이 줄면 본문만 유지하고 수신자를 다시 고르게 한다', async () => {
    await page.evaluate(() => { window.recipientLimit = 1; window.refresh() })
    await offer([lee, kim])
    await accept().click()
    await page.getByText(/현재 수신자 한도를 넘었습니다/).waitFor()
    assert.equal(await page.getByRole('checkbox', { checked: true }).count(), 0)
    assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '회의 안건을 확인해 주세요.')
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('중복·본인·다른 학교 수신자는 메시지 작성기로 넘기지 않는다', async () => {
    for (const people of [[kim, kim], [{ ...kim, memberId: 'teacher' }], [{ ...kim, schoolId: 'elsewhere' }]]) {
      await offer(people)
      assert.equal(await accept().isDisabled(), true)
      assert.equal(await page.getByRole('form', { name: '새 메시지 작성' }).count(), 0)
    }
    assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('AI 초안 도착은 기존 입력과 미확정 요청을 덮어쓰지 않는다',async()=>{
    await compose();await page.evaluate(()=>window.proposeMessage({}));assert.equal(await page.getByRole('button',{name:'전달받은 메시지 초안 사용'}).isDisabled(),true)
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'확인 부탁드립니다.')
  })
  await test('다른 학교 AI 초안은 표시하지 않고 긴 초안은 전송 전 길이 확인을 요구한다',async()=>{
    await page.evaluate(()=>window.proposeMessage({schoolId:'other'}));assert.equal(await page.getByRole('button',{name:'전달받은 메시지 초안 사용'}).count(),0)
    await page.evaluate(()=>window.proposeMessage({body:'가'.repeat(2001)}));await page.getByRole('button',{name:'전달받은 메시지 초안 사용'}).click();await page.getByLabel('김교사 · 교무부',{exact:true}).check()
    await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click();await page.getByText('받는 사람과 메시지 내용을 확인해 주세요.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),0)
  })
  await test('1:1 메시지는 최종 확인 전 전송하지 않고 확인된 명단과 본문만 보낸다', async () => {
    await compose(); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.equal(await page.evaluate(() => window.calls.length), 0)
    await page.getByRole('region', { name: '보내기 전 확인' }).waitFor(); await page.getByRole('button', { name: '확인한 내용 보내기' }).click(); await page.getByText(/메시지를 보냈습니다/).waitFor()
    const [call] = await page.evaluate(() => window.calls); assert.equal(call.command.mode, 'direct'); assert.equal(call.command.body, '확인 부탁드립니다.'); assert.deepEqual(call.command.recipients.map(r => r.memberId), ['kim']); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  })
  await test('개별 일괄 전송과 단체 대화는 다른 공개 범위를 확인한다', async () => {
    await compose(); await page.getByLabel('보내는 방식').selectOption('individual'); await page.getByLabel('이교사 · 연구부', { exact: true }).check(); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.match(await page.getByRole('region', { name: '보내기 전 확인' }).innerText(), /각 교사와의 개별 대화/)
    await page.getByRole('button', { name: '내용 수정', exact: true }).click(); await page.getByLabel('보내는 방식').selectOption('group'); await page.getByLabel('대화 제목', { exact: true }).fill('수업 협의'); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.match(await page.getByRole('region', { name: '보내기 전 확인' }).innerText(), /참여자 이름과 답장이 서로에게/); assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('응답 유실 후 접기·화면 재연결에도 원문과 원래 요청 번호를 보존한다', async () => {
    await compose(); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); await page.getByRole('button', { name: '확인한 내용 보내기' }).click(); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor(); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.getByRole('button', { name: '입력 접고 목록 보기', exact: true }).click(); await page.evaluate(() => window.unmount()); await page.getByRole('heading', { name: '메시지와 알림' }).waitFor({ state: 'detached' }); await page.evaluate(() => window.remount()); await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).waitFor()
    await page.getByRole('button', { name: '보관한 입력 보기' }).click(); assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '확인 부탁드립니다.'); assert.equal(await page.getByLabel('메시지', { exact: true }).isDisabled(), true)
    await page.getByRole('button', { name: '이전 요청 그대로 다시 확인' }).click(); await page.getByText(/메시지를 보냈습니다/).waitFor(); const calls = await page.evaluate(() => window.calls); assert.equal(calls.length, 2); assert.deepEqual(calls[0], calls[1]); assert.equal(await page.evaluate(() => window.delivered), 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
  }, 'unknown')
  await test('배경 목록 오류와 재조회는 입력과 선택 범위를 유지한다', async () => {
    await compose(); const input = page.getByLabel('메시지', { exact: true }); await input.evaluate(element => { element.focus(); element.setSelectionRange(2, 5) }); await page.evaluate(() => { window.listFailed = true; window.refresh() }); await page.getByRole('region', { name: '대화 목록' }).getByRole('alert').waitFor()
    assert.equal(await input.inputValue(), '확인 부탁드립니다.'); assert.deepEqual(await input.evaluate(element => [element.selectionStart, element.selectionEnd]), [2, 5]); assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('답장 참여자 충돌은 내용을 보존하고 최신 명단 확인 후 새 키로 전송한다', async () => {
    await page.getByRole('button', { name: /김교사와의 대화/ }).click(); await page.getByText('회의자료를 확인해 주세요.', { exact: true }).waitFor(); await page.getByRole('button', { name: '답장', exact: true }).click(); await page.getByLabel('메시지', { exact: true }).fill('내 답장'); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); await page.getByRole('button', { name: '확인한 내용 보내기' }).click(); await page.getByRole('button', { name: '현재 참여자 다시 확인' }).click(); assert.equal(await page.getByLabel('메시지', { exact: true }).inputValue(), '내 답장')
    await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.match(await page.getByRole('region', { name: '보내기 전 확인' }).innerText(), /김교사, 이교사/); await page.getByRole('button', { name: '확인한 내용 보내기' }).click(); await page.getByText(/메시지를 보냈습니다/).waitFor(); const calls = await page.evaluate(() => window.calls); assert.notEqual(calls[0].key, calls[1].key); assert.equal(calls[1].command.expectedVersion, 2); assert.equal(calls[1].command.body, '내 답장')
  }, 'conflict')
  await test('대화를 읽기만 하면 변경하지 않고 읽음 버튼만 화면 순번을 기록한다', async () => {
    await page.getByRole('button', { name: /김교사와의 대화/ }).click(); await page.getByText('회의자료를 확인해 주세요.', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => window.calls.length), 0); await page.getByRole('button', { name: '화면에 연 메시지까지 읽음 표시' }).click(); await page.getByText(/읽음으로 표시했습니다/).waitFor(); const calls = await page.evaluate(() => window.calls); assert.deepEqual(calls.map(c => c.command.kind), ['read_thread']); assert.equal(calls[0].command.throughSequence, 2)
  })
  await test('알림 읽음은 제출하지 않으며 지원하는 원본 자원만 링크한다', async () => {
    await page.getByRole('button', { name: '업무 알림', exact: true }).click(); assert.equal(await page.getByRole('button', { name: /원본 열기/ }).count(), 2); await page.getByRole('button', { name: '문서 수합 원본 열기' }).click(); assert.deepEqual(await page.evaluate(() => window.sources), [{ module: 'collections', id: 'collection-one' }]); await page.getByRole('article').filter({ has: page.getByRole('heading', { name: '수합 제출 기한' }) }).getByRole('button', { name: '읽음으로 표시' }).click(); await page.getByText('읽음', { exact: true }).waitFor(); assert.deepEqual(await page.evaluate(() => window.calls.map(c => c.command.kind)), ['read_notice'])
  })
  await test('협업 알림 원본 열기와 읽음은 협업 상태를 자동 변경하지 않는다', async () => {
    await page.getByRole('button',{name:'업무 알림',exact:true}).click();const item=page.getByRole('article').filter({has:page.getByRole('heading',{name:'협업 요청 도착'})});await item.getByRole('button',{name:'협업 요청 원본 열기'}).click();assert.deepEqual(await page.evaluate(()=>window.sources),[{module:'cooperation',id:'cooperation-one'}]);assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await item.getByRole('button',{name:'읽음으로 표시'}).count(),1);
    await item.getByRole('button',{name:'읽음으로 표시'}).click();await item.getByText('읽음',{exact:true}).waitFor();assert.deepEqual(await page.evaluate(()=>window.calls.map(c=>c.command)),[{kind:'read_notice',noticeId:'cooperation-notice',expectedVersion:1}]);assert.match(await page.getByRole('region',{name:'내 업무 알림'}).innerText(),/협업 수락·완료 확인/)
  })
  for(const failure of ['NOT_FOUND','FORBIDDEN','QUERY_FAILED'])await test('협업 원본 오류는 알림을 보존하고 읽음이나 완료로 바꾸지 않는다: '+failure,async()=>{
    await page.getByRole('button',{name:'업무 알림',exact:true}).click();await page.evaluate(value=>window.sourceError=value,failure);const item=page.getByRole('article').filter({has:page.getByRole('heading',{name:'협업 요청 도착'})});await item.getByRole('button',{name:'협업 요청 원본 열기'}).click();await item.getByRole('alert').waitFor();assert.equal(await item.getByRole('button',{name:'읽음으로 표시'}).count(),1);assert.equal(await page.evaluate(()=>window.calls.length),0);assert.equal(await page.getByRole('heading',{name:'수합 제출 기한'}).count(),1)
  })
  await test('협업 원본 조회 중 여러 번 눌러도 한 번만 열기를 요청한다',async()=>{
    await page.getByRole('button',{name:'업무 알림',exact:true}).click();await page.evaluate(()=>window.sourceDeferred=true);const button=page.getByRole('button',{name:'협업 요청 원본 열기'});await button.evaluate(element=>{element.click();element.click()});await page.getByRole('button',{name:'협업 요청 원본 확인 중…'}).waitFor();assert.equal(await page.evaluate(()=>window.sources.length),1);assert.equal(await page.evaluate(()=>window.calls.length),0);await page.evaluate(()=>window.resolveSource());await page.getByRole('button',{name:'협업 요청 원본 열기'}).waitFor()
  })
  await test('협업 알림 읽음 응답 유실은 원래 요청 번호로 한 번만 기록한다',async()=>{
    await page.getByRole('button',{name:'업무 알림',exact:true}).click();const item=page.getByRole('article').filter({has:page.getByRole('heading',{name:'협업 요청 도착'})});await item.getByRole('button',{name:'읽음으로 표시'}).evaluate(element=>{element.click();element.click()});await page.getByRole('button',{name:'이전 요청 그대로 다시 확인'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),1);assert.equal(await page.evaluate(()=>window.pending.count()),1);await page.getByRole('button',{name:'이전 요청 그대로 다시 확인'}).click();await page.waitForFunction(()=>window.pending.count()===0);const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls[0],calls[1]);assert.equal(await page.evaluate(()=>window.readWrites),1);assert.deepEqual(calls.map(c=>c.command.kind),['read_notice','read_notice'])
  },'notice_unknown')
  await test('협업 알림 읽음 판 충돌은 최신 판 재조회 뒤 사용자 확인으로만 다시 기록한다',async()=>{
    await page.getByRole('button',{name:'업무 알림',exact:true}).click();const item=page.getByRole('article').filter({has:page.getByRole('heading',{name:'협업 요청 도착'})});await item.getByRole('button',{name:'읽음으로 표시'}).click();await page.getByText(/알림의 읽음 상태가 변경되었습니다/).waitFor();await page.waitForFunction(()=>window.readinessCalls>=3);await item.getByRole('button',{name:'읽음으로 표시'}).click();await item.getByText('읽음',{exact:true}).waitFor();const calls=await page.evaluate(()=>window.calls);assert.deepEqual(calls.map(c=>c.command.expectedVersion),[1,2]);assert.notEqual(calls[0].key,calls[1].key);assert.equal(await page.evaluate(()=>window.readWrites),1)
  },'notice_conflict')
  await test('소속 변경 렌더는 이전 학교의 작성 내용을 즉시 제거한다', async () => {
    await compose(); await page.evaluate(() => window.changeScope()); await page.getByLabel('메시지', { exact: true }).waitFor({state:'detached'}); assert.equal(await page.getByLabel('메시지', { exact: true }).count(), 0); assert.doesNotMatch(await page.locator('body').innerText(), /확인 부탁드립니다\./); assert.equal(await page.evaluate(() => window.calls.length), 0)
  })
  await test('미연결 서버를 대화 없음이나 사용 가능으로 보이지 않는다', async () => {
    await page.getByRole('button', { name: '연결 다시 확인' }).waitFor(); assert.equal(await page.getByRole('button', { name: '새 메시지', exact: true }).isDisabled(), true); assert.doesNotMatch(await page.locator('body').innerText(), /조건에 맞는 대화가 없습니다/)
  }, 'missing')
  await test('HWPX 확인 응답 유실은 파일 원본·두 요청 키를 보존하고 전송을 막는다', async () => {
    await compose(); await page.getByLabel('첨부할 HWPX 파일', { exact: true }).setInputFiles({ name: '학급자료.hwpx', mimeType: 'application/hwp+zip', buffer: Buffer.from([80, 75, 3, 4, 1, 2, 3]) }); await page.getByRole('button', { name: '같은 파일 확인 계속하기' }).waitFor(); assert.equal(await page.getByRole('button', { name: '받는 사람과 내용 확인' }).isDisabled(), true); assert.equal(await page.evaluate(() => window.pending.count()), 1)
    await page.getByRole('button', { name: '같은 파일 확인 계속하기' }).click(); await page.getByText(/기본 확인을 마쳤습니다/).waitFor(); await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === '받는 사람과 내용 확인' && !button.disabled)); assert.equal(await page.getByRole('button', { name: '받는 사람과 내용 확인' }).isEnabled(), true)
    const files = await page.evaluate(() => window.fileCalls), prepares = files.filter(c => c.kind === 'prepare'), completes = files.filter(c => c.kind === 'complete'); assert.equal(prepares.length, 1); assert.equal(files.filter(c => c.kind === 'status').length, 1); assert.equal(new Set(completes.map(c => c.key)).size, 1); assert.equal(files.filter(c => c.kind === 'upload').length, 1); assert.equal(await page.evaluate(() => window.pending.count()), 0)
    await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.match(await page.getByRole('region', { name: '보내기 전 확인' }).innerText(), /학급자료.hwpx/); await page.getByRole('button', { name: '확인한 내용 보내기' }).click(); await page.getByText(/메시지를 보냈습니다/).waitFor(); assert.deepEqual(await page.evaluate(() => window.calls[0].command.attachmentIds), ['message-file'])
  }, 'files')
  await test('서버 비활성화 중에도 미확정 전송은 조회 전용으로 접수증을 확인한다', async () => {
    await compose(); await page.getByRole('button', {name:'받는 사람과 내용 확인'}).click(); await page.getByRole('button', {name:'확인한 내용 보내기'}).click(); await page.getByRole('button', {name:'이전 요청 그대로 다시 확인'}).waitFor()
    await page.evaluate(() => { window.forceDisabled=true; window.refresh() }); await page.getByRole('button', {name:'연결 다시 확인'}).waitFor(); assert.equal(await page.getByRole('button', {name:'새 메시지', exact:true}).isDisabled(),true)
    await page.getByRole('button', {name:'이전 요청 그대로 다시 확인'}).click(); await page.getByText(/메시지를 보냈습니다/).waitFor(); assert.equal(await page.evaluate(() => window.replayOptions[1].replayOnly),true); assert.equal(await page.evaluate(() => window.delivered),1)
  }, 'unknown')
  await test('첨부 준비가 중단되어도 원래 예약의 기존 파일 상태를 조회할 수 있다', async () => {
    await compose(); await page.getByLabel('첨부할 HWPX 파일',{exact:true}).setInputFiles({name:'학급자료.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])}); await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).waitFor()
    await page.evaluate(() => {window.forceDisabled=true;window.refresh()});await page.getByRole('button',{name:'연결 다시 확인'}).waitFor();await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click();await page.waitForFunction(()=>window.pending.count()===0);await page.evaluate(()=>{window.forceDisabled=false;window.refresh()});await page.getByRole('button',{name:'학급자료.hwpx 첨부에서 제외'}).waitFor()
    const calls=await page.evaluate(()=>window.fileCalls);assert.equal(calls.filter(c=>c.kind==='prepare').length,1);assert.equal(calls.filter(c=>c.kind==='status').length,1);assert.equal(calls.filter(c=>c.kind==='upload').length,1);assert.equal(await page.evaluate(()=>window.pending.count()),0)
  }, 'files')
  await test('학교 소속이 바뀌면 미확정 첨부가 있어도 이전 학교의 파일과 입력을 표시하지 않는다', async () => {
    await compose(); await page.getByLabel('첨부할 HWPX 파일',{exact:true}).setInputFiles({name:'학급자료.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])}); await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).waitFor()
    await page.evaluate(() => window.changeScope()); await page.getByLabel('메시지',{exact:true}).waitFor({state:'detached'}); assert.doesNotMatch(await page.locator('body').innerText(), /학급자료\.hwpx|확인 부탁드립니다\./); assert.equal(await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).count(),0); assert.equal(await page.evaluate(()=>window.calls.length),0)
  }, 'files')
  await test('첨부 서버 준비 전 파일 선택기를 열지 않고 본문 전송은 사용할 수 있다', async () => {
    await compose(); assert.equal(await page.getByLabel('첨부할 HWPX 파일', { exact: true }).count(), 0); assert.match(await page.getByRole('region', { name: '메시지 HWPX 첨부' }).innerText(), /파일 첨부 없이 메시지를 보낼 수/)
  })
  await test('320px 화면에서도 작성·최종 확인의 본문과 버튼이 가로로 넘치지 않는다', async () => {
    await page.setViewportSize({ width: 320, height: 740 }); await compose(); await page.getByLabel('메시지', { exact: true }).fill('가'.repeat(150)); await page.getByRole('button', { name: '받는 사람과 내용 확인' }).click(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    if (output) { mkdirSync(output, { recursive: true }); await page.screenshot({ path: join(output, 'messaging-320.png'), fullPage: true }) }
    await page.setViewportSize({ width: 390, height: 844 })
  })
  await test('대화 안 메시지는 선택한 대상·본문으로 열리고 최종 확인 전에는 전송하지 않는다', async () => {
    await offer([kim,lee]); await page.getByLabel('메시지',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'회의 안건을 확인해 주세요.')
    assert.equal(await page.getByLabel('보내는 방식').inputValue(),'individual')
    assert.equal(await page.getByRole('region',{name:'대화 목록'}).count(),0)
    assert.equal(await page.getByRole('button',{name:'업무 알림',exact:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.listQueries),0)
    assert.equal(await page.evaluate(()=>window.calls.length),0)
    await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click()
    await page.getByRole('region',{name:'보내기 전 확인'}).waitFor()
    assert.equal(await page.getByRole('form',{name:'새 메시지 작성'}).isVisible(),false)
    assert.equal(await page.evaluate(()=>window.calls.length),0)
    await page.getByRole('button',{name:'확인한 내용 보내기'}).click()
    await page.getByRole('region',{name:'최근 발송 결과'}).waitFor()
    const calls=await page.evaluate(()=>window.calls)
    assert.equal(calls.length,1);assert.equal(calls[0].command.mode,'individual')
    assert.deepEqual(calls[0].command.recipients.map(p=>p.memberId),['kim','lee'])
  },'','assistant')
  await test('대화 안 초안의 수신자 판이 바뀌면 본문을 보존하고 다시 선택하게 한다', async () => {
    await page.evaluate(()=>{window.recipientRows[0].version=2})
    await offer([kim,lee]);await page.getByText(/받는 사람 정보가 바뀌었습니다/).waitFor()
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'회의 안건을 확인해 주세요.')
    assert.equal(await page.getByRole('checkbox',{checked:true}).count(),0)
    assert.equal(await page.evaluate(()=>window.calls.length),0)
  },'','assistant')
  await test('대화 안 메시지의 미확정 결과는 재진입과 모듈 중지 뒤에도 원래 요청으로만 확인한다', async () => {
    await offer([kim]);await page.getByLabel('메시지',{exact:true}).waitFor()
    await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click()
    await page.getByRole('button',{name:'확인한 내용 보내기'}).click()
    await page.getByRole('button',{name:'이전 요청 그대로 다시 확인'}).waitFor()
    await page.evaluate(()=>window.unmount());await page.getByRole('heading',{name:'메시지 보내기',exact:true}).waitFor({state:'detached'})
    await page.evaluate(()=>{window.forceDisabled=true;window.remount()})
    await page.getByRole('button',{name:'연결 다시 확인'}).waitFor()
    await page.getByRole('button',{name:'이전 요청 그대로 다시 확인'}).click()
    await page.getByText(/메시지를 보냈습니다/).waitFor()
    const calls=await page.evaluate(()=>window.calls)
    assert.equal(calls.length,2);assert.deepEqual(calls[0],calls[1])
    assert.equal(await page.evaluate(()=>window.delivered),1)
    assert.equal(await page.evaluate(()=>window.replayOptions[1].replayOnly),true)
    assert.equal(await page.evaluate(()=>window.pending.count()),0)
  },'unknown','assistant')
  await test('대화 안 HWPX 첨부도 검사 미확정 동안 전송을 막고 원래 파일을 복구한다', async () => {
    await offer([kim]);await page.getByLabel('메시지',{exact:true}).waitFor()
    await page.locator('.messaging-attachment-editor>summary').click()
    await page.getByLabel('첨부할 HWPX 파일',{exact:true}).setInputFiles({name:'학급자료.hwpx',mimeType:'application/hwp+zip',buffer:Buffer.from([80,75,3,4,1,2,3])})
    await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).waitFor()
    assert.equal(await page.getByRole('button',{name:'받는 사람과 내용 확인'}).isDisabled(),true)
    assert.equal(await page.evaluate(()=>window.calls.length),0)
    await page.getByRole('button',{name:'같은 파일 확인 계속하기'}).click()
    await page.getByText(/기본 확인을 마쳤습니다/).waitFor()
    await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click()
    assert.match(await page.getByRole('region',{name:'보내기 전 확인'}).innerText(),/학급자료.hwpx/)
    await page.getByRole('button',{name:'확인한 내용 보내기'}).click()
    await page.getByText(/메시지를 보냈습니다/).waitFor()
    assert.deepEqual(await page.evaluate(()=>window.calls[0].command.attachmentIds),['message-file'])
    const files=await page.evaluate(()=>window.fileCalls)
    assert.equal(files.filter(row=>row.kind==='prepare').length,1)
    assert.equal(files.filter(row=>row.kind==='upload').length,1)
  },'files','assistant')
  await test('대화 안 초안 조회 실패는 자동 반복하지 않고 사용자가 다시 확인할 수 있다', async () => {
    await page.evaluate(()=>{window.recipientQueryFail=true});await offer([kim])
    await page.getByText(/서버에 연결하지 못했습니다/).waitFor()
    assert.equal(await page.getByRole('form',{name:'새 메시지 작성'}).count(),0)
    assert.equal(await page.evaluate(()=>window.calls.length),0)
    await page.evaluate(()=>{window.recipientQueryFail=false});await accept().click()
    await page.getByLabel('메시지',{exact:true}).waitFor()
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'회의 안건을 확인해 주세요.')
  },'','assistant')
  await test('대화 안에 이미 작성한 본문은 새 대화 초안이 덮어쓰지 않는다', async () => {
    await offer([kim]);await page.getByLabel('메시지',{exact:true}).waitFor()
    await page.getByLabel('메시지',{exact:true}).fill('아직 보내지 않은 개인 입력')
    await page.evaluate(()=>window.proposeMessage({id:'new-offer',body:'새 제안',basisDate:'2026-10-16'}))
    assert.equal(await page.getByLabel('메시지',{exact:true}).inputValue(),'아직 보내지 않은 개인 입력')
    assert.equal(await page.evaluate(()=>window.calls.length),0)
  },'','assistant')
  await test('대화 안 작성·최종 확인은 320px와 큰 글씨에서도 가로로 넘치지 않는다', async () => {
    await page.setViewportSize({width:320,height:740});await page.addStyleTag({content:'html{font-size:200%}'})
    await offer([kim,lee]);await page.getByLabel('메시지',{exact:true}).waitFor()
    await page.getByRole('button',{name:'받는 사람과 내용 확인'}).click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    if(output){mkdirSync(output,{recursive:true});await page.screenshot({path:join(output,'assistant-message-review-320.png'),fullPage:true})}
    await page.setViewportSize({width:390,height:844})
  },'','assistant')
  assert.deepEqual(errors, []); assert.deepEqual(external, [])
  if (output) { mkdirSync(output, { recursive: true }); writeFileSync(join(output, 'results.json'), JSON.stringify({ passed, pageErrors: errors, externalRequests: external }, null, 2)) }
  console.log(`메신저·알림 브라우저 ${passed.length}건 통과`)
} finally { await browser.close() }





