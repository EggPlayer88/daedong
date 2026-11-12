import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// PR #126부터 앱도 서버의 판·접수 시각을 반환한다. PR #125의 축약 결과로 자동 후퇴하지 않는다.
export const TRANSITION_CAPTURE_MODE = 'receipt-metadata-v1'
const sqlCommit = '5c05c2d78af44e4b10455ba06291d93971f7628e'
const specs = {
  p7: {
    path: 'database/workhub/p7/test/app_contract_p7.ts',
    sha256: '226ddfd45767dbc98b11520a71fb46379e103242bc2103f316bbe750c9defacf',
    before: 'same = c.raw.data && { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state }',
    after: 'same = c.raw.data && { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state, version: c.raw.data.version, recordedAt: c.raw.data.recordedAt }',
  },
  p8: {
    path: 'database/workhub/p8/test/app_contract_p8.ts',
    sha256: 'f90655cd7bc32e7eee0335d1b527c5edc461ccac7a2f9ce37d4cebb2aa9cc6fa',
    before: 'same = { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state, legacyDutyReceipt: false }',
    after: 'same = { requestKey: c.raw.data.requestKey, recordId: c.raw.data.recordId, state: c.raw.data.state, legacyDutyReceipt: false, version: c.raw.data.version, recordedAt: c.raw.data.recordedAt }',
  },
}
const hash = value => createHash('sha256').update(value).digest('hex')
const failure = code => Object.assign(new Error(code), { code })

// SQL·권한 조건·원본 검증기는 보존하고, 실행할 임시 사본의 기대 접수증 두 곳만 확장한다.
export function transitionCaptureMetadataSource(suite, source, mode) {
  if (mode !== TRANSITION_CAPTURE_MODE) throw failure('INVALID_RECEIPT_CAPTURE_MODE')
  const spec = specs[suite]
  if (!spec || typeof source !== 'string') throw failure('INVALID_RECEIPT_CAPTURE_SOURCE')
  if (hash(source.replace(/\r\n/g, '\n')) !== spec.sha256 || source.split(spec.before).length !== 2)
    throw failure('UNEXPECTED_RECEIPT_CAPTURE_SOURCE')
  return source.replace(spec.before, spec.after)
}

export function prepareTransitionCaptureMetadata(snapshotPath, manifestPath, mode) {
  if (mode !== TRANSITION_CAPTURE_MODE) throw failure('INVALID_RECEIPT_CAPTURE_MODE')
  const snapshot = realpathSync(snapshotPath), manifestFile = realpathSync(manifestPath), run = dirname(snapshot)
  if (basename(snapshot) !== 'source' || !/^run-/.test(basename(run)) ||
      !/^workhub-release-r0-verify/.test(basename(dirname(run))) ||
      manifestFile !== join(run, 'reports', 'source-manifest.json')) throw failure('INVALID_RECEIPT_CAPTURE_PATH')
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
  if (manifest.schemaVersion !== 1 || manifest.sqlCommit !== sqlCommit || !Array.isArray(manifest.files) || manifest.transitionReceiptMetadata)
    throw failure('INVALID_RECEIPT_CAPTURE_MANIFEST')
  // 두 사본과 manifest를 모두 확인한 뒤에만 쓰기 시작한다. 불일치 때 부분 보정이나 fallback은 없다.
  const updates = Object.entries(specs).map(([suite, spec]) => {
    const path = join(snapshot, spec.path)
    if (realpathSync(path) !== path) throw failure('INVALID_RECEIPT_CAPTURE_PATH')
    const rows = manifest.files.filter(row => row.path === spec.path)
    const original = readFileSync(path), before = hash(original)
    if (rows.length !== 1 || rows[0].sourceSha256 !== before || rows[0].testedSha256 !== before)
      throw failure('INVALID_RECEIPT_CAPTURE_MANIFEST')
    const adapted = transitionCaptureMetadataSource(suite, original.toString('utf8'), mode)
    return { path, row: rows[0], adapted, before, after: hash(adapted) }
  })
  for (const update of updates) update.row.testedSha256 = update.after
  manifest.transitionReceiptMetadata = {
    mode,
    reason: '앱의 version·recordedAt을 실제 서버 접수증과 그대로 대조한다. SQL과 원본 시험 파일은 변경하지 않는다.',
    files: updates.map(update => ({ path: update.row.path, originalSha256: update.before, testedSha256: update.after })),
  }
  for (const update of updates) writeFileSync(update.path, update.adapted, 'utf8')
  writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  return manifest.transitionReceiptMetadata
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    if (process.argv.length !== 5) throw failure('INVALID_ARGUMENTS')
    const [, , snapshot, manifest, mode] = process.argv
    const result = prepareTransitionCaptureMetadata(snapshot, manifest, mode)
    console.log(`인계 접수증 대조: ${result.mode} · 시험 사본 ${result.files.length}개 · SQL 변경 0`)
  } catch (error) {
    console.error(JSON.stringify({ code: typeof error?.code === 'string' && /^[A-Z_]+$/.test(error.code) ? error.code : 'RECEIPT_CAPTURE_PREPARATION_FAILED' }))
    process.exitCode = 1
  }
}
