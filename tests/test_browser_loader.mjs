// 실제 번들 생성·모듈 실행을 통해 경로 인코딩과 실패 시 정리를 검증한다.
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const tempRoot = mkdtempSync(join(tmpdir(), '학교 테스트 # '))
try {
  const { render } = await loadBrowserModule(`
    import { renderToStaticMarkup } from 'react-dom/server'
    export const render = () => renderToStaticMarkup(<p>한글 보존</p>)
  `, { tempRoot })
  assert.equal(render(), '<p>한글 보존</p>')
  assert.deepEqual(readdirSync(tempRoot), [])
  console.log('  ✓ 공백·한글·# 경로에서 실제 JSX 렌더와 임시 폴더 정리')

  await assert.rejects(loadBrowserModule('export const broken = <', { tempRoot }))
  assert.deepEqual(readdirSync(tempRoot), [])
  console.log('  ✓ 빌드 실패 후 임시 폴더 정리')

  await assert.rejects(loadBrowserModule('throw new Error("실행 실패 확인")', { tempRoot }), /실행 실패 확인/)
  assert.deepEqual(readdirSync(tempRoot), [])
  console.log('  ✓ 모듈 실행 실패 후 임시 폴더 정리')
} finally {
  rmSync(tempRoot, { recursive: true, force: true })
}
