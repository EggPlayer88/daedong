import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { launchBrowser } from './launch-browser.mjs'
const root=fileURLToPath(new URL('../../',import.meta.url))
const handler=(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body><h1>Timetable worker test</h1><script type="module">
import {startTimetableSolve} from '/apps/workhub/src/timetable/worker-client.ts';
import {timetablePracticeSnapshot} from '/apps/workhub/src/timetable/sample.ts';
import {validatePlacements} from '/packages/timetable/src/validate.ts';
window.runActualWorker=async()=>{const basis=timetablePracticeSnapshot('2026-10-16').basis;const task=startTimetableSolve(basis);const result=await task.promise;return {status:result.status,valid:validatePlacements(basis,result.placements).valid,count:result.placements.length}};
window.cancelActualWorker=async()=>{const basis=timetablePracticeSnapshot('2026-10-16').basis;const task=startTimetableSolve(basis);task.cancel();try{await task.promise;return 'unexpected'}catch(error){return error.code}};
window.workerReady=true;</script></body></html>`)}
const vite=await createServer({configFile:false,root,logLevel:'error',server:{host:'127.0.0.1',port:5197,strictPort:true},esbuild:{jsx:'automatic'},plugins:[{name:'owned-timetable-test',configureServer(server){server.middlewares.use('/__timetable_worker_test',handler)}}]})
let browser
try{await vite.listen();const address=vite.httpServer.address();const url=`http://127.0.0.1:${address.port}/__timetable_worker_test`;browser=await launchBrowser();const page=await browser.newPage(),errors=[],workerUrls=[];page.on('pageerror',error=>errors.push(error.message));page.on('worker',worker=>workerUrls.push(worker.url()));await page.goto(url);await page.waitForFunction(()=>window.workerReady===true);assert.deepEqual(await page.evaluate(()=>window.runActualWorker()),{status:'feasible',valid:true,count:6});assert.ok(workerUrls.some(value=>value.includes('/apps/workhub/src/timetable/worker.ts')));console.log('  ✓ Vite가 만든 실제 module Worker에서 계산하고 독립 검증한다');assert.equal(await page.evaluate(()=>window.cancelActualWorker()),'CANCELLED');console.log('  ✓ 실제 module Worker 취소는 작업자를 종료하고 입력 요청을 실패로 되돌린다');assert.deepEqual(errors,[]);console.log('실제 시간표 계산 작업자 브라우저 검사: 2개 통과')}
finally{await browser?.close();await vite.close()}
