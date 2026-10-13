// 같은 합성 자료를 이전 커밋과 현재 화면에 넣어 DOM 표시량을 비교한다. 운영 자료·서버는 사용하지 않는다.
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'

const require = createRequire(import.meta.url), { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const root = fileURLToPath(new URL('../../', import.meta.url)), baseline = '137a871'
const common = `
  import React,{useState} from 'react';import{createRoot}from'react-dom/client';
  import{fixtureData}from'./apps/workhub/src/preview/fixtures';import{EditSession}from'./apps/workhub/src/app/EditSession';
  const members=fixtureData.memberships,date=fixtureData.basisDate,teacher=members.find(m=>m.id==='gaon-soyeon'),manager=members.find(m=>m.id==='gaon-minjun');
  const qa=window.qa={calls:{}};
  function instrument(store,names){for(const name of names){const original=store[name];store[name]=(...args)=>{qa.calls[name]=(qa.calls[name]||0)+1;return original(...args)}}return store}
  const ignoreLock=()=>{};function mount(children){createRoot(document.getElementById('root')).render(<EditSession onLockChange={ignoreLock}>{children}</EditSession>)}
`
const fixtures = {
  tasks1000: common + `
    import{TaskPanel}from'./apps/workhub/src/tasks/TaskPanel';
    const rows=Array.from({length:1000},(_,i)=>({id:'scale-task-'+i,title:'합성 업무 '+i,notes:'합성 메모',dueDate:date,status:'todo',version:1,schoolId:teacher.schoolId,ownerMemberId:teacher.id}));
    const adapter={async list(){return structuredClone(rows)},async get(memberId,id){return structuredClone(rows.find(row=>row.id===id))}};
    mount(<TaskPanel member={teacher} date={date} adapter={adapter}/>);
  `,
  students1000: common + `
    import{StudentsPanel}from'./apps/workhub/src/students/StudentsPanel';import{createStudentStore}from'./apps/workhub/src/students/store';
    const initial=createStudentStore({members,date}),course=initial.listCourses(teacher.id)[0],student=initial.listStudents(teacher.id,course.id)[0];
    const record=initial.createObservation(teacher.id,{studentId:student.id,enrollmentId:student.enrollmentId,courseId:course.id,observedAt:date,activity:'합성 관찰',content:'직접 확인한 합성 사실',confirmed:true},'seed');
    const source=initial.receiveActivity(teacher.id,{eventId:'seed',sourceSystem:'synthetic-scale',activityId:'activity',itemId:'item',revision:1,operation:'upsert',courseId:course.id,occurredAt:date,questionVersion:'q1',question:'합성 질문',answer:'합성 응답',alias:'합성 별명'});
    initial.confirmMapping(teacher.id,source.id,1,student.id,student.enrollmentId,0,'map');const mapped=initial.listActivities(teacher.id)[0],snapshot=initial.exportState();snapshot.receipts=[];snapshot.serial=10000;
    snapshot.sources=Array.from({length:1000},(_,i)=>({id:'scale-source-'+i,schoolId:teacher.schoolId,ownerUserId:teacher.userId,revisions:[{...mapped.current,eventId:'event-'+i,itemId:'item-'+i,alias:'합성 별명 '+i}],mappings:mapped.mappings}));
    snapshot.observations=Array.from({length:1000},(_,i)=>({id:'scale-record-'+i,schoolId:teacher.schoolId,authorUserId:teacher.userId,authorMemberId:teacher.id,revisions:[1,2,3].map(version=>({...record.current,version,activity:'합성 관찰 '+i,content:'합성 사실 '+i,reason:'합성 개정 '+version}))}));
    const store=instrument(createStudentStore({members,date,snapshot}),['listRecords','listActivities','listStudents','listCourses']);
    mount(<StudentsPanel member={teacher} members={members} date={date} store={store}/>);
  `,
  requests1000: common + `
    import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
    const initial=createWorkflowStore({members,date});let request=initial.createCollection(manager.id,{title:'합성 수합',instructions:'합성 자료',dueDate:date,reviewMode:'none',reviewerMemberId:'',textLabel:'내용',textRequired:false,numberLabel:'수량',numberRequired:true,units:[{label:'합성 단위',responsibleMemberId:teacher.id,contributorMemberIds:[]}]},'create');
    initial.publishCollection(manager.id,request.id,request.version,'publish');const snapshot=initial.exportState(),r=snapshot.requests[0],u=snapshot.units[0];snapshot.receipts=[];
    snapshot.requests=Array.from({length:1000},(_,i)=>({...r,id:'scale-request-'+i,title:'합성 수합 '+i}));snapshot.units=Array.from({length:1000},(_,i)=>({...u,id:'scale-unit-'+i,requestId:snapshot.requests[i].id}));
    const store=instrument(createWorkflowStore({members,date,snapshot}),['listCollections','listUnits','unitSummary','getSubmissions']);
    mount(<WorkflowPanel member={teacher} members={members} date={date} store={store} page="collections"/>);
  `,
  units100: common + `
    import{WorkflowPanel}from'./apps/workhub/src/workflows/WorkflowPanel';import{createWorkflowStore}from'./apps/workhub/src/workflows/store';
    const initial=createWorkflowStore({members,date});let request=initial.createCollection(manager.id,{title:'합성 수합',instructions:'합성 자료',dueDate:date,reviewMode:'none',reviewerMemberId:'',textLabel:'내용',textRequired:false,numberLabel:'수량',numberRequired:true,units:[{label:'합성 단위',responsibleMemberId:teacher.id,contributorMemberIds:[]}]},'create');
    request=initial.publishCollection(manager.id,request.id,request.version,'publish');const unit=initial.listUnits(teacher.id,request.id)[0];
    for(let version=1;version<=3;version++){const old=initial.getDraft(teacher.id,unit.id),draft=initial.saveDraft(teacher.id,unit.id,{text:'합성 제출',number:version},old?.version??0,'draft-'+version);initial.submit(teacher.id,unit.id,draft.version,initial.unitSummary(teacher.id,unit.id).unit.version,'submit-'+version,version>1?'합성 정정':'')}
    const snapshot=initial.exportState(),u=snapshot.units[0],submissions=snapshot.submissions;snapshot.receipts=[];snapshot.drafts=[];
    snapshot.requests[0].units=Array.from({length:100},(_,i)=>({label:'합성 단위 '+i,responsibleMemberId:teacher.id,contributorMemberIds:[]}));
    snapshot.units=Array.from({length:100},(_,i)=>({...u,id:'scale-unit-'+i,label:'합성 단위 '+i,currentSubmissionId:'scale-submission-'+i+'-3',effectiveSubmissionId:'scale-submission-'+i+'-3'}));
    snapshot.submissions=snapshot.units.flatMap((unit,i)=>submissions.map(row=>({...row,id:'scale-submission-'+i+'-'+row.revision,unitId:unit.id,requestKey:'scale-key-'+i+'-'+row.revision,previousSubmissionId:row.revision===1?null:'scale-submission-'+i+'-'+(row.revision-1)})));
    const store=instrument(createWorkflowStore({members,date,snapshot}),['listCollections','listUnits','unitSummary','getSubmissions']);
    mount(<WorkflowPanel member={manager} members={members} date={date} store={store} page="collections" initialRequestId={request.id}/>);
  `,
}

const baselineFiles = new Map()
async function bundle(source, revision) {
  const plugins = revision ? [{ name: '기준-커밋-읽기', setup(builder) {
    builder.onLoad({ filter: /[\\/]apps[\\/]workhub[\\/]src[\\/].*\.(tsx?|css)$/ }, args => {
      const path = relative(root, args.path).replaceAll('\\', '/')
      if (!baselineFiles.has(path)) baselineFiles.set(path, execFileSync('git', ['show', `${revision}:${path}`], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }))
      const contents = baselineFiles.get(path)
      return { contents, loader: path.endsWith('.css') ? 'text' : path.endsWith('.tsx') ? 'tsx' : 'ts' }
    })
  } }] : []
  return (await build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, plugins, bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent' })).outputFiles[0].text
}
const browser = await chromium.launch({ channel: 'chrome', headless: true }), measurements = {}, errors = []
async function read(page, selector) {
  return page.evaluate(selector => ({ cards: document.querySelectorAll(selector).length, elements: document.querySelectorAll('#root *').length, historyItems: document.querySelectorAll('.students-history li,.wf-history > div').length, calls: { ...qa.calls } }), selector)
}
try {
  for (const revision of [baseline, null]) {
    const label = revision || 'working-tree'; measurements[label] = {}
    for (const [fixture, source] of Object.entries(fixtures)) {
      const page = await browser.newPage(); page.setDefaultTimeout(30000)
      page.on('pageerror', error => errors.push(`${label}/${fixture}: ${error.message}`))
      page.on('console', message => { if (message.type() === 'error') errors.push(`${label}/${fixture}: ${message.text()}`) })
      await page.route('**/*', route => route.abort())
      await page.route('http://127.0.0.1:5176/scale-synthetic', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ko"><meta charset="utf-8"><body><main id="root"></main></body></html>' }))
      await page.goto('http://127.0.0.1:5176/scale-synthetic')
      await page.addScriptTag({ content: await bundle(source, revision) })
      const selector = fixture === 'tasks1000' ? '.task-card' : fixture === 'students1000' ? '.students-record' : fixture === 'requests1000' ? '.wf-request-card' : '.wf-unit'
      try { await page.locator(selector).first().waitFor() }
      catch (failure) { console.error(label, fixture, errors, (await page.locator('body').innerText()).slice(-1500)); throw failure }
      // 초기 effect에 의한 재표시까지 끝낸 같은 상태에서 개수만 비교한다.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      measurements[label][fixture === 'students1000' ? 'records1000' : fixture] = await read(page, selector)
      console.log('  측정 완료: ' + label + ' / ' + fixture)
      if (fixture === 'students1000') {
        await page.evaluate(() => { qa.calls = {} })
        await page.getByRole('button', { name: /^수업 활동 받은함/ }).click(); await page.locator('.students-source').first().waitFor()
        measurements[label].activities1000 = await read(page, '.students-source')
      }
      await page.close()
    }
  }
  assert.deepEqual(errors, [])
  for (const key of ['tasks1000', 'records1000', 'activities1000', 'requests1000', 'units100']) {
    const before = measurements[baseline][key], after = measurements['working-tree'][key]
    assert.equal(before.cards, key === 'units100' ? 100 : 1000)
    assert.equal(after.cards, 20)
    assert(after.elements < before.elements / 2, `${key} DOM이 절반 미만이어야 함`)
    assert.equal(after.historyItems, 0)
  }
  const result = { baseline, current: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim() + '+working-tree', measurements, errors, note: '동일 합성 자료·Chrome·root 하위 DOM 개수. 운영 속도·서버 조회량·p95 측정이 아니다. 학생 기록과 제출 이력은 각각 3개 개정본이다.' }
  if (process.env.WORKHUB_QA_OUTPUT) { mkdirSync(process.env.WORKHUB_QA_OUTPUT, { recursive: true }); writeFileSync(join(process.env.WORKHUB_QA_OUTPUT, 'scale-baseline-results.json'), JSON.stringify(result, null, 2)) }
  console.log(JSON.stringify(result, null, 2))
  console.log('\n대량 목록 이전/현재 5종 DOM 비교 통과')
} catch (error) { console.error(error); process.exitCode = 1 }
finally { await browser.close() }
