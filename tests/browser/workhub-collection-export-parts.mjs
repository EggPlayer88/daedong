// 실제 다운로드 UI·분할·해시·ZIP을 실행한다. 보관된 PDF와 RPC는 가상이며 DB 적용은 없다.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {unzipSync} from 'fflate'
import {launchBrowser} from './launch-browser.mjs'

const bodies=Array.from({length:540},(_,i)=>'%PDF-1.7\n가상 교사 '+Math.floor(i/15)+' · 자료 '+i+'\n%%EOF'),files=bodies.map((body,i)=>({id:'file-'+String(i).padStart(4,'0'),name:'자료'+i%15+'.pdf',extension:'pdf',bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')}))
const bundle=buildSync({stdin:{contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import{CollectionServerExport}from'./apps/workhub/src/collections/CollectionServerExport';
import{CollectionServerError}from'./apps/workhub/src/collections/contracts';
import theme from'./apps/workhub/src/style.css?inline';
const files=${JSON.stringify(files)},bodies=${JSON.stringify(bodies)},date='2026-10-21',now=date+'T01:00:00Z',clone=v=>structuredClone(v);
const member={id:'manager',schoolId:'school',userId:'manager-user',name:'가상 담당자',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};
const units=Array.from({length:36},(_,i)=>({id:'unit-'+String(i).padStart(3,'0'),requestId:'request',schoolId:'school',label:Math.floor(i%9/3)+1+'학년 '+(i%3+1)+'반 · 가상교사'+i,responsibleMemberId:'teacher-'+i,members:[{id:'teacher-'+i,userId:'user-'+i,name:'가상교사'+i}],version:2,currentSubmissionId:'submission-'+i,effectiveSubmissionId:'submission-'+i,withdrawnSubmissionIds:[],correctionUntil:'',correctionReason:''}));
const request={id:'request',schoolId:'school',managerMemberId:'manager',status:'published',version:2,publishedAt:now,title:'36명 가상 수합',instructions:'기존 보관 자료',dueDate:'2026-10-31',reviewMode:'none',reviewerMemberId:'',textLabel:'',textRequired:false,numberLabel:'',numberRequired:false,units:units.map(u=>({label:u.label,responsibleMemberId:u.responsibleMemberId,contributorMemberIds:[]})),fileCollection:{policy:{extensions:['pdf'],maxFileBytes:1048576,maxFiles:15},required:true,templates:[]}};
const submissions=units.map((u,i)=>({id:'submission-'+i,unitId:u.id,revision:1,submittedBy:u.responsibleMemberId,receiptAt:now,receiptDate:date,dueSnapshot:'2026-10-31',initiallyLate:false,correctionReason:'',previousSubmissionId:null,reviewMode:'none',requestKey:'submit-key-'+i,text:'',number:null,files:files.slice(i*15,i*15+15)}));
window.state={request,units,submissions,reviews:[],supplements:[],withdrawals:[]};window.calls=[];window.fail='';window.locked=false;
const server={async detail(){return clone(window.state)},async download(actor,parent,file){window.calls.push(file.id);if(window.fail===file.id)throw new CollectionServerError('QUERY_FAILED','비공개 오류');return new Blob([bodies[Number(file.id.slice(5))]])}};
function App(){const[disabled,setDisabled]=useState(false);window.setDisabled=setDisabled;return <><style>{theme}{'body{margin:0;padding:12px}main{max-width:700px;margin:auto;min-width:0}'}</style><main><CollectionServerExport server={server} member={member} requestId="request" date={date} disabled={disabled} onBusyChange={value=>window.locked=value}/></main></>}
createRoot(document.getElementById('root')).render(<App/>);
`,resolveDir:fileURLToPath(new URL('../../',import.meta.url)),loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:960,height:850},acceptDownloads:true}),page=await context.newPage(),results=[],errors=[],external=[]
page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message))
await context.route('**/*',route=>{if(!route.request().url().startsWith('http://127.0.0.1:5189/')){external.push(route.request().url());return route.abort()}return route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div></body></html>'})})
const button=name=>page.getByRole('button',{name,exact:true}),zip=n=>button(n+'/2 ZIP 내려받기'),ready=n=>zip(n).and(page.locator(':enabled')).waitFor()
async function receive(n){const wait=page.waitForEvent('download');await zip(n).click();const value=await wait;assert.match(value.suggestedFilename(),new RegExp('_묶음00'+n+'-002.zip$'));return unzipSync(readFileSync(await value.path()))}
async function test(name,run){await page.setViewportSize({width:960,height:850});await page.goto('http://127.0.0.1:5189/');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText('제출 파일 모아 받기',{exact:true}).click();try{await run()}catch(e){console.error(await page.locator('body').innerText());throw e}results.push(name);console.log('  ✓ '+name)}
try{
 await test('36명 540개 자료를 2개 ZIP으로 나누고 각 CSV·파일 해시를 모두 대조한다',async()=>{
  await button('최신 현황으로 묶음 준비').click();await ready(1);await page.getByText(/다운로드 요청 0\/2개/).waitFor();const a=await receive(1);await page.getByText(/다운로드 요청 1\/2개 · 1번/).waitFor();await button('다음 묶음 준비').click();await ready(2);const b=await receive(2);await page.getByText(/다운로드 요청 2\/2개 · 1, 2번/).waitFor()
  const received=[];for(const zip of[a,b]){const csv=Object.entries(zip).find(([name])=>name.endsWith('.csv'));assert.ok(csv);const text=new TextDecoder().decode(csv[1]);for(const[name,bytes]of Object.entries(zip).filter(([name])=>name.endsWith('.pdf'))){const hash=createHash('sha256').update(bytes).digest('hex');assert.ok(text.includes(name));assert.ok(text.includes(hash));received.push(hash)}}assert.equal(Object.keys(a).length,512);assert.equal(Object.keys(b).length,30);assert.deepEqual(received.sort(),files.map(f=>f.sha256).sort());assert.equal(await page.evaluate(()=>window.locked),false)
 })
 await test('받지 않은 묶음을 건너뛰어도 완료로 표시하지 않고 이전 묶음을 다시 준비한다',async()=>{await button('최신 현황으로 묶음 준비').click();await ready(1);await button('다음 묶음 준비').click();await ready(2);await page.getByText(/다운로드 요청 0\/2개/).waitFor();await receive(2);await page.getByText(/다운로드 요청 1\/2개 · 2번/).waitFor();await button('이전 묶음 준비').click();await ready(1);await page.getByText(/다운로드 요청 1\/2개 · 2번/).waitFor()})
 await test('묶음 사이에 제출 현황이 바뀌면 기존 다운로드 표시와 남은 ZIP을 무효화한다',async()=>{await button('최신 현황으로 묶음 준비').click();await ready(1);await receive(1);await page.evaluate(()=>window.state.units[35].version++);const calls=await page.evaluate(()=>window.calls.length);await button('다음 묶음 준비').click();await page.getByRole('alert').filter({hasText:'제출 현황이나 접근 범위가 바뀌었습니다'}).waitFor();assert.equal(await page.evaluate(()=>window.calls.length),calls);assert.equal(await page.getByRole('region',{name:'나누어 받는 ZIP 현황'}).count(),0);assert.equal(await zip(2).count(),0)})
 await test('다음 묶음의 한 파일 실패는 그 파일만 재시도하고 이전 요청 표시를 보존한다',async()=>{await button('최신 현황으로 묶음 준비').click();await ready(1);await receive(1);await page.evaluate(()=>window.fail='file-0539');await button('다음 묶음 준비').click();await button('실패한 파일 다시 확인').waitFor();assert.equal(await zip(2).count(),0);await page.getByText(/다운로드 요청 1\/2개 · 1번/).waitFor();const count=await page.evaluate(()=>window.calls.length);await page.evaluate(()=>window.fail='');await button('실패한 파일 다시 확인').click();await ready(2);assert.equal(await page.evaluate(()=>window.calls.length),count+1)})
 await test('320px·키보드에서 다음 묶음을 고르고 편집이 시작되면 준비한 파일을 버린다',async()=>{await page.setViewportSize({width:320,height:760});await button('최신 현황으로 묶음 준비').click();await ready(1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await button('다음 묶음 준비').focus();await page.keyboard.press('Enter');await ready(2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);if(process.env.WORKHUB_QA_OUTPUT){mkdirSync(process.env.WORKHUB_QA_OUTPUT,{recursive:true});await page.screenshot({path:join(process.env.WORKHUB_QA_OUTPUT,'partition-320.png'),fullPage:true})}await page.evaluate(()=>window.setDisabled(true));await zip(2).waitFor({state:'detached'});assert.equal(await page.getByRole('region',{name:'나누어 받는 ZIP 현황'}).count(),0)})
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 if(process.env.WORKHUB_QA_OUTPUT)writeFileSync(join(process.env.WORKHUB_QA_OUTPUT,'results.json'),JSON.stringify({passed:results.length,results},null,2))
 console.log('\n분할 수합 ZIP 브라우저 '+results.length+'개 통과')
}finally{await context.close();await browser.close()}
