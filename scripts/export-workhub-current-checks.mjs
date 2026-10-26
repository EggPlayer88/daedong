// 현재 운영 점검 파일만 묶는다. 설치·활성화 SQL과 접속 정보는 포함하지 않는다.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSqlBytes } from './check-workhub-sql-package.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const source = 'database/workhub-participation/op1'
export const currentCheckFiles = ['INT-10_SQL편집기용_통합점검.sql', 'OP1-02_사후점검.sql']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export function currentChecks(sourceRoot = root) {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, source, 'sql-package.json'), 'utf8'))
  assert.equal(manifest.postcheck, 'INT-10', '현재 전체 점검 기준이 다릅니다.')
  return currentCheckFiles.map(file => {
    const expected = manifest.files.filter(row => row.file === file)
    assert.equal(expected.length, 1, `점검 파일 기록을 확인하세요: ${file}`)
    const bytes = normalizeSqlBytes(readFileSync(join(sourceRoot, source, file)))
    assert.equal(bytes.length, expected[0].bytes, `파일 크기가 다릅니다: ${file}`)
    assert.equal(digest(bytes), expected[0].sha256, `파일 내용이 다릅니다: ${file}`)
    return { file, bytes, sha256: expected[0].sha256 }
  })
}

export function exportCurrentChecks(outputParent, sourceRoot = root) {
  // 해시 검사가 끝나야 폴더를 만든다. 기존 실행본은 덮어쓰지 않는다.
  const files = currentChecks(sourceRoot)
  const output = mkdtempSync(join(realpathSync(outputParent), 'workhub-current-checks-'))
  for (const entry of files) writeFileSync(join(output, entry.file), entry.bytes)
  writeFileSync(join(output, 'SHA256SUMS'), files.map(entry => `${entry.sha256}  ${entry.file}`).join('\n') + '\n')
  writeFileSync(join(output, 'README.txt'), [
    '2026-10-26 현재 운영 읽기 전용 점검 묶음',
    '이 도구는 SQL을 실행하지 않습니다. 설치·활성화·권한 변경 양식도 포함하지 않습니다.',
    '1. INT-10: 전체 18행, 12·13은 info, 나머지는 ok인지 확인합니다. FAIL은 멈추고 원인을 확인합니다.',
    '2. OP1-02: 8행, 01~06·08은 ok, 07은 info입니다. 등록 수와 현재 유효 수는 다를 수 있습니다.',
    'INT-10은 최근 S1·S2·S3·MP1·OP1 보강을 포함한 기준입니다. 이전 INT-05 설치 묶음을 재실행하지 마세요.',
    '이 결과는 구조·권한 점검이며 업무 저장·파일 왕복·AI 호출·사용 성공을 증명하지 않습니다.',
    '기간 제한 계정은 기한이 끝나면 이용할 수 없습니다. 등록 행의 active만으로 허용을 판단하지 마세요.',
    '운영 기준: docs/workhub/construction-closeout/README.md',
  ].join('\n') + '\n')
  return { output, files: files.map(({ file, sha256 }) => ({ file, sha256 })), executedSql: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 0) console.log(JSON.stringify({ postcheck: 'INT-10', files: currentChecks().map(({ file, sha256 }) => ({ file, sha256 })), executedSql: false }, null, 2))
  else if (args.length === 2 && args[0] === '--output-parent') console.log(JSON.stringify(exportCurrentChecks(args[1]), null, 2))
  else throw Error('--output-parent 기존폴더만 지정할 수 있습니다. SQL 실행 옵션은 없습니다.')
}
