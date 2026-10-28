// 빌드 결과의 첫 진입 의존 그래프와 로컬 Chrome 콜드 로딩을 측정한다. 운영 로그인·API는 사용하지 않는다.
import { createServer } from 'node:http'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, join, extname, sep } from 'node:path'
import { gzipSync } from 'node:zlib'
import { launchBrowser } from '../tests/browser/launch-browser.mjs'

const directories = process.argv.slice(2).filter(arg => !arg.startsWith('--'))
if (!directories.length) throw Error('vite build --manifest로 만든 폴더를 지정하세요.')
const browser = await launchBrowser(), reports = []
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]
try {
  for (const directory of directories) {
    const root = resolve(directory), manifest = JSON.parse(readFileSync(join(root,'.vite/manifest.json'),'utf8')), visited = new Set()
    function collect(key) { if (visited.has(key)) return; visited.add(key); for (const next of manifest[key]?.imports??[]) collect(next) }
    collect('index.html')
    const initial = [...visited].map(key=>manifest[key].file).filter(file=>file.endsWith('.js')).map(file=>{const bytes=readFileSync(join(root,file));return{file,bytes:bytes.length,gzipBytes:gzipSync(bytes).length}})
    const server = createServer((request,response)=>{
      let path; try {path=resolve(root,'.'+decodeURIComponent(new URL(request.url,'http://localhost').pathname))} catch {response.writeHead(400);response.end();return}
      if (path !== root && !path.startsWith(root+sep)) {response.writeHead(403);response.end();return}
      if (path===root || !existsSync(path)) path=join(root,'index.html')
      const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[extname(path)]??'application/octet-stream'
      const data=readFileSync(path);response.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Cache-Control':'no-store'});response.end(gzipSync(data))
    })
    await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${server.address().port}`, samples=[]
    try {
      for(let i=0;i<5;i++) {
        const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),outside=[],errors=[]
        page.on('pageerror',error=>errors.push(error.message))
        try {
        await context.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){outside.push(new URL(route.request().url()).origin);return route.abort()}return route.continue()})
        const cdp=await context.newCDPSession(page)
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
        await cdp.send('Network.enable')
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:60,downloadThroughput:200000,uploadThroughput:100000,connectionType:'wifi'})
        await page.goto(origin+'/',{waitUntil:'load'});await page.getByRole('heading',{name:'대동여중 업무혁신시스템',exact:true}).waitFor()
        await page.evaluate(()=>document.fonts.ready)
        samples.push(await page.evaluate(()=>({domMs:Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),fcpMs:Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime??0),scriptBytes:performance.getEntriesByType('resource').filter(e=>e.initiatorType==='script').reduce((sum,e)=>sum+e.encodedBodySize,0)})))
        if(outside.length)throw Error('외부 연결 시도가 있어 측정을 중단합니다.')
        if(errors.length)throw Error(errors.join('\n'))
        console.log(`${directory} ${i+1}/5: ${JSON.stringify(samples.at(-1))}`)
        } catch(error) {
          console.error({directory,errors,body:await page.locator('body').innerText()})
          throw error
        } finally {await context.close()}
      }
    } finally {server.closeAllConnections();await new Promise(done=>server.close(done))}
    reports.push({directory,conditions:{runs:5,cpuSlowdown:4,latencyMs:60,downloadBytesPerSecond:200000,cache:'새 컨텍스트·no-store',source:'로컬 빌드·비로그인'},initialJavaScript:{bytes:initial.reduce((n,x)=>n+x.bytes,0),gzipBytes:initial.reduce((n,x)=>n+x.gzipBytes,0),files:initial},medians:{domMs:median(samples.map(x=>x.domMs)),fcpMs:median(samples.map(x=>x.fcpMs))},samples})
    console.log(JSON.stringify(reports.at(-1),null,2))
  }
  const destination=process.env.SITE_LOADING_REPORT
  if(destination)writeFileSync(destination,JSON.stringify(reports,null,2))
} finally {await browser.close()}
