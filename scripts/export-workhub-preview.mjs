import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 외부 요청 없이 열리는 합성 자료 전용 HTML을 만든다. 운영 연결 파일은 포함하지 않는다.
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(process.argv[2] || resolve(root, 'dist/workhub-preview.html'))
const result = await build({
  absWorkingDir: root,
  stdin: { contents: `import React from 'react'; import { createRoot } from 'react-dom/client'; import './apps/workhub/src/style.css'; import { DemoBootstrap } from './apps/workhub/src/preview/DemoBootstrap'; createRoot(document.getElementById('root')).render(<React.StrictMode><DemoBootstrap /></React.StrictMode>);`, resolveDir: root, loader: 'tsx' },
  bundle: true, write: false, outfile: 'preview.js', format: 'iife', jsx: 'automatic',
  minify: true, define: { 'process.env.NODE_ENV': '"production"' },
})
const js = result.outputFiles.find(file => file.path.endsWith('.js'))?.text
const css = result.outputFiles.find(file => file.path.endsWith('.css'))?.text || ''
if (!js) throw new Error('미리보기 스크립트를 생성하지 못했습니다.')
if (js.includes('workhub_calendar_list') || js.includes('createSupabaseConnection')) throw new Error('운영 연결이 미리보기에 포함되었습니다.')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>학교업무혁신시스템 · 2차 개발 미리보기</title><link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='16' fill='%23265e50'/%3E%3Ctext x='32' y='44' text-anchor='middle' font-size='40' fill='white'%3E學%3C/text%3E%3C/svg%3E"><style>${css.replaceAll('</style', '<\\/style')}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, html, 'utf8')
console.log(`미리보기 저장: ${destination} (${Buffer.byteLength(html).toLocaleString()} bytes)`)
