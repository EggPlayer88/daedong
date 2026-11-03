// 현재 운영의 읽기 전용 점검 원문만 내보낸다. 실행·설치·활성화 기능은 없다.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSqlBytes } from './check-workhub-sql-package.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const inventoryPath = 'database/workhub-current/int11/sql-package.json'
export const currentCheckSources = [
  'database/workhub-current/int11/INT-11_SQL편집기용_통합점검.sql',
  'database/workhub-annual/af1/AF1-05_사후점검.sql',
  'database/workhub-annual/af2/AF2-02_사후점검.sql',
  'database/site-presentation/sp1/SP1-02_사후점검.sql',
]
export const currentCheckFiles = currentCheckSources.map(source => basename(source))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

export function currentChecks(sourceRoot = root) {
  const manifest = JSON.parse(readFileSync(join(sourceRoot, inventoryPath), 'utf8'))
  assert.equal(manifest.version, 2, '현재 점검 목록 버전이 다릅니다.')
  assert.equal(manifest.postcheck, 'INT-11', '현재 전체 점검 기준이 다릅니다.')
  // 목록을 조작해 설치 SQL이나 다른 경로를 추가해도 내보내지 않는다.
  assert.deepEqual(manifest.files.map(row => row.source), currentCheckSources, '점검 파일 기록과 허용 경로가 다릅니다.')
  return currentCheckSources.map((source, index) => {
    const expected = manifest.files[index]
    const file = currentCheckFiles[index]
    assert.equal(expected.file, file, `점검 파일 기록을 확인하세요: ${file}`)
    assert.equal(expected.rows, [18, 8, 4, 7][index], `점검 행 기록을 확인하세요: ${file}`)
    const bytes = normalizeSqlBytes(readFileSync(join(sourceRoot, source)))
    assert.equal(bytes.length, expected.bytes, `파일 크기가 다릅니다: ${file}`)
    assert.equal(digest(bytes), expected.sha256, `파일 내용이 다릅니다: ${file}`)
    return { file, bytes, sha256: expected.sha256 }
  })
}

export function exportCurrentChecks(outputParent, sourceRoot = root) {
  // 전부 검증한 뒤 새 폴더를 만든다. 이전 실행본은 덮어쓰지 않는다.
  const files = currentChecks(sourceRoot)
  const output = mkdtempSync(join(realpathSync(outputParent), 'workhub-current-checks-'))
  for (const entry of files) writeFileSync(join(output, entry.file), entry.bytes)
  writeFileSync(join(output, 'SHA256SUMS'), files.map(entry => `${entry.sha256}  ${entry.file}`).join('\n') + '\n')
  writeFileSync(join(output, 'README.txt'), [
    '2026-11-03 현재 운영 읽기 전용 점검 묶음 — AF1·AF2·SP1 적용 기준',
    '이 도구는 SQL을 실행하지 않습니다. 설치·활성화·권한 변경 양식도 포함하지 않습니다.',
    '이미 설치된 DB를 확인할 때만 사용합니다. 새 설치나 재설치 순서가 아닙니다.',
    '1. INT-11: 전체 구조 18행, 12·13은 info, 나머지는 ok. 01은 48단계가 모두 설치돼야 ok입니다.',
    '2. AF1-05: 연간 운영 8행 모두 ok.',
    '3. AF2-02: 수합 상태·양식 게시 4행 모두 ok.',
    '4. SP1-02: 기간 업무 표시 7행, 01~06 ok·07 info. visible은 현재 관리자 설정에 따릅니다.',
    'FAIL이나 실행 오류가 있으면 원인을 확인합니다. 예상하지 않은 차이를 정상으로 간주하지 않습니다.',
    'INT-10·OP1-02는 AF1 이전 원문을 비교하므로 현재 정상 DB에서도 FAIL이 날 수 있습니다. 이 묶음으로 대신 점검합니다.',
    'INT-11은 OP1의 표·함수·실효 권한과 AF1·AF2·SP1을 함께 검사합니다. 기존 확정 파일은 수정하지 않았습니다.',
    '구조·권한 점검 통과는 업무 저장·파일 왕복·AI 호출·현재 정책 활성화 성공을 증명하지 않습니다.',
    '기간 제한 계정은 기한이 끝나면 이용할 수 없습니다. 자동 연장하지 않습니다.',
    '운영 기준: docs/workhub/construction-closeout/current-status.md',
  ].join('\n') + '\n')
  return { output, postcheck: 'INT-11', files: files.map(({ file, sha256 }) => ({ file, sha256 })), executedSql: false }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.length === 0) console.log(JSON.stringify({ postcheck: 'INT-11', files: currentChecks().map(({ file, sha256 }) => ({ file, sha256 })), executedSql: false }, null, 2))
  else if (args.length === 2 && args[0] === '--output-parent') console.log(JSON.stringify(exportCurrentChecks(args[1]), null, 2))
  else throw Error('--output-parent 기존폴더만 지정할 수 있습니다. SQL 실행 옵션은 없습니다.')
}
