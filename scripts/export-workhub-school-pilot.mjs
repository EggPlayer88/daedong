// 운영 로그인 없이 실제 운영 연습 컴포넌트를 확인하는 로컬 산출물이다.
import { buildSync } from 'esbuild'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(process.argv[2] || '시간표운영_미리보기.html')
const bundle = buildSync({
  stdin: {
    contents: `import {createRoot} from 'react-dom/client';import {TimetablePilotPanel} from './apps/workhub/src/timetable/pilot/TimetablePilotPanel';createRoot(document.getElementById('root')).render(<TimetablePilotPanel scope="local-preview:school-timetable-pilot-v1"/>);`,
    loader: 'tsx', resolveDir: root,
  },
  bundle: true, write: false, format: 'iife', jsx: 'automatic', loader: { '.css': 'text' },
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' },
  minify: true,
})
const font = readFileSync(new URL('../apps/workhub/src/assets/fonts/PretendardVariable.woff2', import.meta.url)).toString('base64')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>대동여중 · 9학급 시간표 운영 연습</title><style>
@font-face{font-family:Pretendard;src:url(data:font/woff2;base64,${font}) format('woff2')}
*{box-sizing:border-box}body{margin:0;background:#f6f7f9;color:#172a3e;font-family:Pretendard,sans-serif}main{max-width:1320px;margin:auto;padding:20px}button,input,select,textarea{font:inherit;border:1px solid #c9d1dc;border-radius:7px;padding:8px}button{cursor:pointer}button:disabled{cursor:default;opacity:.5}textarea{min-height:84px}header.preview-title{max-width:1320px;margin:auto;padding:18px 20px 0;font-size:14px;color:#5c6c80}a{color:#215daf}
</style></head><body><header class="preview-title">대동여중 업무혁신시스템 · 구축 중인 시간표 운영 화면</header><main id="root"></main><script>${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`
mkdirSync(dirname(destination), { recursive: true })
writeFileSync(destination, html)
console.log(`미리보기: ${destination}\n실제 React 화면입니다. 운영 Supabase와 연결하지 않으며 현재 브라우저에 가상 운영 기록만 저장합니다.`)
