import assert from 'node:assert/strict'
import { buildSync } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { launchBrowser } from './launch-browser.mjs'
const python=[process.env.TIMETABLE_PYTHON,process.env.PYTHON,resolve('tests/.venv/Scripts/python.exe'),resolve('tests/.venv/bin/python'),'python3','python'].filter(Boolean).find(p=>(!/[\\/]/.test(p)||existsSync(p))&&spawnSync(p,['-c','import ortools;assert ortools.__version__ == "9.15.6755"'],{stdio:'ignore',windowsHide:true}).status===0)
assert.ok(python,'고정 버전 OR-Tools가 필요합니다: pip install -r packages/timetable/requirements.txt')
const bundle=buildSync({stdin:{contents:`
import React,{useState}from'react';import{createRoot}from'react-dom/client';import{TimetableEnginePanel}from'./apps/workhub/src/timetable/TimetableEnginePanel';import{timetablePracticeSnapshot}from'./apps/workhub/src/timetable/sample';
const member={id:'m',schoolId:'s',userId:'u',name:'합성교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]};window.adopted=[];
function App(){const[basis,setBasis]=useState(timetablePracticeSnapshot('2026-10-17').basis);window.changeBasis=()=>setBasis(old=>({...old,revision:old.revision+1}));return <section className="timetable-workspace"><TimetableEnginePanel member={member} basis={basis} placements={null} lockedLessonIds={[]} scopeResourceId="" disabled={false} onAdopt={placements=>window.adopted.push(placements)}/></section>};createRoot(document.getElementById('root')).render(<App/>);
`,loader:'tsx',resolveDir:fileURLToPath(new URL('../../',import.meta.url))},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const browser=await launchBrowser(),context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true}),page=await context.newPage(),errors=[],passed=[]
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
await context.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><div id="root"></div></html>'}))
async function start(){await page.goto('http://127.0.0.1:5179/engine');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.getByText('최적화 엔진으로 계산·후보 비교',{exact:true}).click()}
async function check(name,run){await start();await run();passed.push(name);console.log('  ✓ '+name)}
async function request(){const wait=page.waitForEvent('download');await page.getByRole('button',{name:'최적화 요청 파일 만들기',exact:true}).click();const file=await wait;return JSON.parse(readFileSync(await file.path(),'utf8'))}
function runEngine(input){const r=spawnSync(python,['packages/timetable/engine/runner.py'],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:16000000,timeout:150000,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)}
const upload=value=>page.getByLabel('최적화 결과 JSON 가져오기',{exact:true}).setInputFiles({name:'result.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))})
try{
await check('화면에서 내려받은 요청을 실제 Python으로 계산하고 세 후보를 검증·선택한다',async()=>{await page.getByLabel('비교할 후보 수',{exact:false}).selectOption('3');const input=await request();assert.equal(input.options.maxCandidates,3);const response=runEngine(input);assert.equal(response.candidates.length,3);await upload(response);await page.getByRole('heading',{name:'검사를 통과한 후보를 찾았습니다',exact:true}).waitFor();assert.equal(await page.getByRole('radio').count(),3);assert.equal(await page.getByRole('button',{name:'검사한 후보를 초안에 반영',exact:true}).isDisabled(),true);await page.getByRole('radio').nth(1).check();await page.getByLabel('선택한 후보로 현재 작업 배치를 바꿉니다. 기존 배치는 직전 배치로 보관합니다.',{exact:true}).check();await page.getByRole('button',{name:'검사한 후보를 초안에 반영',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.adopted[0]),response.candidates[1].placements)})
await check('다른 계산 요청의 결과를 가져오면 후보 전체를 거부하고 현재안을 유지한다',async()=>{const input=await request(),response=runEngine(input);response.inputHash='0'.repeat(64);await upload(response);await page.getByRole('alert').filter({hasText:'원래 요청 또는 독립 검증'}).waitFor();assert.equal(await page.getByRole('radio').count(),0);assert.equal(await page.evaluate(()=>window.adopted.length),0)})
await check('요청 후 기준판이 바뀌면 이전 계산 결과 입력과 채택을 닫는다',async()=>{await request();await page.evaluate(()=>window.changeBasis());await page.getByText('기준자료·조건·현재 배치 또는 계산 설정이 바뀌었습니다.',{exact:false}).waitFor();assert.equal(await page.getByLabel('최적화 결과 JSON 가져오기',{exact:true}).count(),0);assert.equal(await page.evaluate(()=>window.adopted.length),0)})
await check('계산 요청 재다운로드는 새 요청번호나 입력 지문을 만들지 않는다',async()=>{const input=await request();const wait=page.waitForEvent('download');await page.getByRole('button',{name:'같은 계산 요청 파일 다시 받기',exact:true}).click();const file=await wait;assert.deepEqual(JSON.parse(readFileSync(await file.path(),'utf8')),input)})
assert.deepEqual(errors,[]);console.log(`시간표 Python 엔진 파일 왕복 브라우저 검사: ${passed.length}개 통과`)
}catch(error){console.log(await page.locator('body').innerText());throw error}finally{await browser.close()}
