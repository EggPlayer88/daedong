import { buildSync } from 'esbuild'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 파일 경로를 명령으로 실행하지 않아 Windows와 POSIX에서 같은 검사를 수행한다.
// 가상 진입점은 tests/ 기준으로 해석하고, 저장소에 임시 JSX 파일을 남기지 않는다.
export async function loadBrowserModule(contents, { env = { MODE: 'test' }, tempRoot = tmpdir() } = {}) {
  const work = mkdtempSync(join(tempRoot, 'school-tests-'))
  try {
    const outfile = join(work, 'bundle.cjs')
    buildSync({
      stdin: { contents, resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
      bundle: true,
      platform: 'node',
      format: 'cjs',
      jsx: 'automatic',
      loader: { '.jsx': 'jsx', '.css': 'text' },
      define: { 'import.meta.env': JSON.stringify(env) },
      outfile,
      logLevel: 'silent',
    })
    return await import(pathToFileURL(outfile).href)
  } finally {
    // 이 호출에서 생성한 폴더만 지운다. 빌드와 모듈 로딩 실패도 동일하게 정리한다.
    rmSync(work, { recursive: true, force: true })
  }
}
