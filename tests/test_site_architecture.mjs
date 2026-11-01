import assert from 'node:assert/strict'
import ts from 'typescript'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
const root = resolve('apps/workhub/src'),
  files = []
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (/\.tsx?$/.test(p) && !p.endsWith('.d.ts')) files.push(p)
  }
}
walk(root)
let count = 0
function check(name, fn) {
  fn()
  count++
  console.log('  ✓ ' + name)
}
const graph = new Map()
for (const file of files) {
  const raw = readFileSync(file, 'utf8'),
    js = ts.transpileModule(raw, {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.Preserve,
        verbatimModuleSyntax: false,
      },
    }).outputText
  const parsed = ts.createSourceFile(file, js, 99, true, 4),
    imports = []
  for (const n of parsed.statements) {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteral(n.moduleSpecifier) &&
      n.moduleSpecifier.text.startsWith('.')
    ) {
      const p = resolve(dirname(file), n.moduleSpecifier.text)
      const found = [
        p,
        p + '.ts',
        p + '.tsx',
        resolve(p, 'index.ts'),
        resolve(p, 'index.tsx'),
      ].find((f) => files.includes(f))
      if (found) imports.push(found)
    }
  }
  graph.set(file, imports)
}
check('운영 업무 코드의 정적 실행 의존성에 순환 import가 없다', () => {
  const active = new Set(),
    done = new Set(),
    trail = []
  function visit(f) {
    if (active.has(f))
      throw new Error(
        '순환 import: ' + [...trail, f].map((x) => x.slice(root.length + 1)).join(' → '),
      )
    if (done.has(f)) return
    active.add(f)
    trail.push(f)
    for (const dep of graph.get(f) || []) visit(dep)
    trail.pop()
    active.delete(f)
    done.add(f)
  }
  for (const f of files) visit(f)
})
check('공통 값과 복구 식별 규칙은 React와 전송 모듈에 의존하지 않는다', () => {
  for (const name of ['services/service-values.ts', 'services/recovery-scope.ts'])
    assert.deepEqual(graph.get(resolve(root, name)), [])
})
check('전송·계약의 순수 TS 모듈은 복구 React 화면을 역으로 불러오지 않는다', () => {
  for (const f of files.filter(
    (f) =>
      !f.endsWith('.tsx') &&
      !/[/\\]app[/\\]/.test(f) &&
      !readFileSync(f, 'utf8').includes("from 'react'"),
  ))
    assert.ok(!(graph.get(f) || []).some((p) => p.endsWith('pending-requests.tsx')), f)
})
check('핵심 다섯 화면 진입점과 컨트롤러·표시 영역의 경계가 유지된다', () => {
  for (const [dir, entry, hook, view] of [
    ['collections', 'CollectionServerPanel', 'useCollectionEditor', 'CollectionEditorView'],
    ['documents', 'GuidedWorkspace', 'useGuidedEditor', 'GuidedEditorView'],
    ['timetable', 'TimetableWorkspace', 'useTimetableDesigner', 'TimetableDesignerView'],
    ['messaging', 'MessagingWorkspace', 'useMessagingWorkspace', 'MessagingView'],
    ['assistant', 'AssistantPanel', 'useAssistantWorkspace', 'AssistantView'],
  ]) {
    const base = resolve(root, dir)
    assert.ok(
      readFileSync(resolve(base, entry + '.tsx'), 'utf8').length < 10000,
      entry + ' 진입점이 다시 비대해졌다',
    )
    assert.ok(existsSync(resolve(base, hook + '.ts')))
    assert.ok(existsSync(resolve(base, view + '.tsx')))
    assert.ok(
      !(graph.get(resolve(base, hook + '.ts')) || []).includes(resolve(base, view + '.tsx')),
      '컨트롤러가 표시 화면을 역으로 불러온다',
    )
  }
})
console.log(`전부 통과 (${count})`)
