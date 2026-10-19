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
try {
  await vite.listen()
  const address=vite.httpServer.address(), origin=`http://127.0.0.1:${address.port}`
  browser=await launchBrowser()
  const page=await browser.newPage(), errors=[], workerUrls=[]
  page.on('pageerror',error=>errors.push(error.message))
  page.on('worker',worker=>workerUrls.push(worker.url()))
  await page.goto(`${origin}/__timetable_worker_test`)
  await page.waitForFunction(()=>window.workerReady===true)
  // 개발 서버의 첫 Worker 모듈 변환이 계산 제한시간에 섞이지 않도록 실제 HTTP·JS 준비를 별도로 확인한다.
  // 고정 대기나 재시도는 하지 않는다. 준비 자체도 일반 Playwright 시작 대기와 같은 30초 안에 끝나야 한다.
  // 아래 계산은 생산 Worker와 원래 6,500ms 제한을 그대로 사용한다. cold-start 성능 시험을 뜻하지 않는다.
  const moduleResponse=await page.request.get(`${origin}/apps/workhub/src/timetable/worker.ts?worker_file&type=module`,{timeout:30000})
  assert.equal(moduleResponse.status(),200,'실제 Worker 모듈이 HTTP 200으로 준비되어야 한다')
  assert.match(moduleResponse.headers()['content-type']??'',/(?:java|ecma)script/i,'Worker 모듈은 JavaScript여야 한다')
  const moduleSource=await moduleResponse.text()
  assert.match(moduleSource,/solveTimetable/,'실제 계산기 import가 있는 Worker여야 한다')
  assert.match(moduleSource,/self\.onmessage/,'실제 메시지 처리기가 있는 Worker여야 한다')
  await moduleResponse.dispose()
  assert.deepEqual(await page.evaluate(()=>window.runActualWorker()),{status:'feasible',valid:true,count:6})
  assert.ok(workerUrls.some(value=>value.includes('/apps/workhub/src/timetable/worker.ts')))
  console.log('  ✓ Vite가 만든 실제 module Worker에서 계산하고 독립 검증한다')
  assert.equal(await page.evaluate(()=>window.cancelActualWorker()),'CANCELLED')
  console.log('  ✓ 실제 module Worker 취소는 작업자를 종료하고 입력 요청을 실패로 되돌린다')
  assert.deepEqual(errors,[])
  console.log('실제 시간표 계산 작업자 브라우저 검사: 2개 통과')
} finally { await browser?.close(); await vite.close() }
