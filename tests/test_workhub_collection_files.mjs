import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { createPreviewFileRepository, previewFixturePolicy: policy, normalizeFilePolicy, validateFileReferences, FileError, FILE_TECHNICAL_LIMITS, createStoredZip, buildStoredZip, requestBlobDownload, storedZipEntryName } = await loadBrowserModule(`
export * from '../apps/workhub/src/files/contracts.ts';export * from '../apps/workhub/src/files/validation.ts';
export * from '../apps/workhub/src/files/preview-repository.ts';export * from '../apps/workhub/src/files/download.ts';`)
const owner = { schoolId: 'school-fixture', memberId: 'member-fixture' }, scope = { schoolId: owner.schoolId, memberIds: [owner.memberId] }
const pdf = (name = '계획.pdf', contents = '%PDF-1.4\n합성 문서\n%%EOF') => new File([contents], name, { type: 'application/pdf' })
const code = expected => error => error instanceof FileError && error.code === expected && !error.message.includes('RAW_SECRET')
let passed = 0, failed = 0
async function test(name, run) { try { await run(); passed++; console.log('  ✓ ' + name) } catch (error) { failed++; console.error('  ✗ ' + name + ': ' + error.stack) } }
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), originalFetch = globalThis.fetch
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('파일 모듈은 localStorage에 접근하면 안 된다') } })
globalThis.fetch = () => { throw Error('파일 모듈은 네트워크에 접근하면 안 된다') }
try {
  await test('파일 정책은 필수이며 지원 형식·크기·개수의 명시 값을 복사한다', () => {
    for (const invalid of [null, {}, { ...policy, maxFiles: 0 }, { ...policy, extensions: ['exe'] }, { ...policy, extra: true }, { ...policy, maxFileBytes: Infinity }]) assert.throws(() => normalizeFilePolicy(invalid), code('FILE_POLICY_INVALID'))
    const copy = normalizeFilePolicy(policy); copy.extensions.pop(); assert.equal(policy.extensions.length, 6)
  })
  await test('실제 File을 읽어 SHA-256과 바이트를 보존하고 원본을 다시 내려받는다', async () => {
    const repo = createPreviewFileRepository(), source = pdf(), ref = await repo.stage(source, policy, owner)
    assert.equal(ref.sha256, createHash('sha256').update(Buffer.from(await source.arrayBuffer())).digest('hex')); assert.equal(ref.bytes, source.size)
    repo.check([ref], policy, scope); const stored = await repo.read(ref, scope)
    assert.equal(await stored.text(), await source.text()); assert.equal(stored.type, source.type)
  })
  await test('경로·제어문자·예약 이름과 과도하게 긴 파일명을 거부한다', async () => {
    const repo = createPreviewFileRepository()
    for (const name of ['../계획.pdf', '경로\\계획.pdf', 'CON.pdf', '숨김\u202e.pdf', ' '.repeat(4), '가'.repeat(100) + '.pdf']) await assert.rejects(repo.stage(pdf(name), policy, owner), code('FILE_NAME_INVALID'))
  })
  await test('각 허용 확장자의 기본 표식을 검사하되 빈 MIME도 파일 내용으로 확인한다', async () => {
    const repo = createPreviewFileRepository()
    for (const extension of policy.extensions) {
      const bytes = extension === 'pdf' ? new TextEncoder().encode('%PDF-1.4') : extension === 'hwp' ? Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) : Uint8Array.from([0x50, 0x4b, 3, 4])
      const ref = await repo.stage(new File([bytes], '양식.' + extension), policy, owner); assert.equal(ref.extension, extension)
    }
    await assert.rejects(repo.stage(new File(['%PDF-1.4'], '위장.docx'), policy, owner), code('FILE_SIGNATURE_MISMATCH'))
    await assert.rejects(repo.stage(new File(['%PDF-1.4'], '위장.pdf', { type: 'text/html' }), policy, owner), code('FILE_MIME_MISMATCH'))
    await assert.rejects(repo.stage(new File(['%PDF-1.4'], '실행.exe'), policy, owner), code('FILE_TYPE_UNSUPPORTED'))
  })
  await test('빈 파일과 정책 크기 초과는 원본을 읽기 전에 거부한다', async () => {
    const repo = createPreviewFileRepository()
    await assert.rejects(repo.stage(new File([], '빈파일.pdf'), policy, owner), code('FILE_SIZE_LIMIT'))
    await assert.rejects(repo.stage(pdf(), { ...policy, maxFileBytes: 4 }, owner), code('FILE_SIZE_LIMIT'))
    await assert.rejects(repo.stage({}, policy, owner), code('FILE_UNAVAILABLE'))
  })
  await test('참조의 개수·ID·이름·본문 중복을 제출 전에 거부한다', async () => {
    const repo = createPreviewFileRepository(), one = await repo.stage(pdf(), policy, owner)
    const two = await repo.stage(pdf('다른이름.pdf'), policy, owner), other = await repo.stage(pdf('다른내용.pdf', '%PDF-1.4 other'), policy, owner)
    assert.throws(() => repo.check([one, one], policy, scope), code('FILE_DUPLICATE'))
    assert.throws(() => repo.check([one, two], policy, scope), code('FILE_DUPLICATE'))
    assert.throws(() => validateFileReferences([one, { ...other, name: one.name }], policy), code('FILE_DUPLICATE'))
    assert.throws(() => repo.check([one, other], { ...policy, maxFiles: 1 }, scope), code('FILE_COUNT_LIMIT'))
  })
  await test('참조 필드 변조·알 수 없는 필드·사라진 파일은 실물과 일치하지 않아 읽지 못한다', async () => {
    const repo = createPreviewFileRepository(), ref = await repo.stage(pdf(), policy, owner)
    for (const changes of [{ id: 'missing' }, { name: '바꿈.pdf' }, { extension: 'hwpx' }, { bytes: ref.bytes + 1 }, { sha256: '0'.repeat(64) }, { extra: true }]) await assert.rejects(repo.read({ ...ref, ...changes }, scope), code('FILE_UNAVAILABLE'))
    const lost = { ...ref, id: 'missing' }; assert.throws(() => repo.check([lost], policy, scope), code('FILE_UNAVAILABLE'))
  })
  await test('다른 학교·허용되지 않은 소유자 접근을 막고 공동작성자의 명시 범위를 허용한다', async () => {
    const repo = createPreviewFileRepository(), ref = await repo.stage(pdf(), policy, owner)
    for (const denied of [{ schoolId: 'other', memberIds: [owner.memberId] }, { schoolId: owner.schoolId, memberIds: ['other'] }, { schoolId: owner.schoolId, memberIds: [] }]) { await assert.rejects(repo.read(ref, denied), code('FILE_SCOPE_DENIED')); assert.throws(() => repo.check([ref], policy, denied), code('FILE_SCOPE_DENIED')) }
    assert.ok(await repo.read(ref, { ...scope, memberIds: ['collaborator', owner.memberId] }))
  })
  await test('입력 owner와 반환 참조를 바꿔도 내부 원본의 소유·메타데이터는 변하지 않는다', async () => {
    const repo = createPreviewFileRepository(), identity = { ...owner }, ref = await repo.stage(pdf(), policy, identity), original = { ...ref }
    identity.schoolId = 'other'; ref.name = '변경.pdf'
    assert.equal(await (await repo.read(original, scope)).text(), await pdf().text())
    await assert.rejects(repo.read(ref, scope), code('FILE_UNAVAILABLE'))
  })
  await test('초기화는 기존 참조와 진행 중 파일의 늦은 복귀를 무효화한다', async () => {
    const repo = createPreviewFileRepository(), ref = await repo.stage(pdf(), policy, owner)
    let release
    class Delayed extends File { stream() { return new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode('%PDF-1.4')); controller.close() } } }) } }
    const pending = repo.stage(new Delayed(['%PDF-1.4'], '지연.pdf'), policy, owner)
    await Promise.resolve(); repo.reset(); release()
    await assert.rejects(pending, code('FILE_UNAVAILABLE')); await assert.rejects(repo.read(ref, scope), code('FILE_UNAVAILABLE'))
    assert.throws(() => repo.check([ref], policy, scope), code('FILE_UNAVAILABLE'))
  })
  await test('취소된 stage/read와 처리 중 취소는 고정 오류를 반환한다', async () => {
    const repo = createPreviewFileRepository(), ref = await repo.stage(pdf(), policy, owner), controller = new AbortController(); controller.abort('RAW_SECRET')
    await assert.rejects(repo.stage(pdf(), policy, owner, controller.signal), code('FILE_ABORTED'))
    await assert.rejects(repo.read(ref, scope, controller.signal), code('FILE_ABORTED'))
    const active = new AbortController(); let cancelled = false
    class Pending extends File { stream() { return new ReadableStream({ cancel() { cancelled = true } }) } }
    const task = repo.stage(new Pending(['%PDF-1.4'], '지연.pdf'), policy, owner, active.signal)
    await Promise.resolve(); active.abort('RAW_SECRET'); await assert.rejects(task, code('FILE_ABORTED')); assert.equal(cancelled, true)
  })
  await test('읽기 실패와 정지된 스트림 timeout을 구분하고 원시 오류를 노출하지 않는다', async () => {
    class Broken extends File { stream() { throw Error('RAW_SECRET') } }
    await assert.rejects(createPreviewFileRepository().stage(new Broken(['%PDF-1.4'], '실패.pdf'), policy, owner), code('FILE_READ_FAILED'))
    let cancelled = false
    class Stalled extends File { stream() { return new ReadableStream({ cancel() { cancelled = true; return new Promise(() => {}) } }) } }
    await assert.rejects(createPreviewFileRepository({ timeoutMs: 10 }).stage(new Stalled(['%PDF-1.4'], '지연.pdf'), policy, owner), code('FILE_TIMEOUT')); assert.equal(cancelled, true)
  })
  await test('동시에 읽는 파일까지 예약량에 포함하고 실패 후 메모리를 회복한다', async () => {
    let release
    class Pending extends File { stream() { return new ReadableStream({ start(controller) { release = () => { controller.enqueue(new TextEncoder().encode('%PDF-1.4')); controller.close() } } }) } }
    const repo = createPreviewFileRepository({ maxTotalBytes: 8 }), task = repo.stage(new Pending(['%PDF-1.4'], '예약.pdf'), policy, owner)
    await Promise.resolve(); await assert.rejects(repo.stage(new File(['%PDF-1.4'], '추가.pdf'), policy, owner), code('FILE_MEMORY_LIMIT'))
    release(); await task; repo.reset(); assert.ok(await repo.stage(new File(['%PDF-1.4'], '다시.pdf'), policy, owner))
  })
  await test('경계 내 병렬 stage가 모두 완료되고 재선택마다 독립 참조를 발급한다', async () => {
    const a = new File(['%PDF-1.4 A'], 'A.pdf'), b = new File(['%PDF-1.4 B'], 'B.pdf'), repo = createPreviewFileRepository({ maxTotalBytes: 2 * a.size })
    const refs = await Promise.all([repo.stage(a, policy, owner), repo.stage(b, policy, owner)])
    repo.check(refs, policy, scope)
    const roomy = createPreviewFileRepository(), first = await roomy.stage(a, policy, owner), again = await roomy.stage(a, policy, owner); assert.notEqual(first.id, again.id)
  })
  await test('실패한 선택 배치만 회수해 메모리를 재사용하고 기존 선택·제출 원본은 보존한다', async () => {
    const source = new File(['%PDF-1.4'], '같은파일.pdf'), repo = createPreviewFileRepository({ maxTotalBytes: source.size * 2 })
    const kept = await repo.stage(source, policy, owner)
    for (let iteration = 0; iteration < 5; iteration++) {
      const temporary = await repo.stage(source, policy, owner)
      assert.notEqual(temporary.id, kept.id)
      assert.throws(() => repo.check([kept, temporary], policy, scope), code('FILE_DUPLICATE'))
      repo.discardStaged([temporary, temporary], owner)
      await assert.rejects(repo.read(temporary, scope), code('FILE_UNAVAILABLE'))
      assert.equal(await (await repo.read(kept, scope)).text(), '%PDF-1.4')
    }
    repo.discardStaged([], owner)
    const extra = await repo.stage(new File(['%PDF-1.5'], '다른파일.pdf'), policy, owner)
    assert.throws(() => repo.discardStaged([extra], { schoolId: owner.schoolId, memberId: 'other' }), code('FILE_SCOPE_DENIED'))
    assert.throws(() => repo.discardStaged([extra, { ...kept, bytes: 100 }], owner), code('FILE_UNAVAILABLE'))
    assert.ok(await repo.read(extra, scope)); repo.reset(); repo.discardStaged([extra], owner)
  })
  await test('암호화 기능이나 secure context가 없으면 해시를 가장하지 않는다', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'isSecureContext')
    Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: false })
    try { await assert.rejects(createPreviewFileRepository().stage(pdf(), policy, owner), code('FILE_CRYPTO_UNAVAILABLE')) }
    finally { if (descriptor) Object.defineProperty(globalThis, 'isSecureContext', descriptor); else delete globalThis.isSecureContext }
  })
  await test('한글·중복·경로 포함 이름의 ZIP을 Python 표준 zipfile로 열어 원문·CRC를 검증한다', async () => {
    const longName = storedZipEntryName('긴 제출 단위'.repeat(30) + '_계획.hwpx', 300)
    assert.ok(new TextEncoder().encode(longName).length <= FILE_TECHNICAL_LIMITS.nameBytes); assert.match(longName, /^301_.*\.hwpx$/)
    const source = '%PDF-1.4 합성원문', zipped = await createStoredZip([{ name: '../자료/계획.pdf', blob: new Blob([source]) }, { name: '../자료/계획.pdf', blob: new Blob(['두 번째 자료']) }])
    const run = spawnSync('python', ['-c', 'import sys,json,base64,zipfile,io; z=zipfile.ZipFile(io.BytesIO(base64.b64decode(sys.stdin.read()))); print(json.dumps({"bad":z.testzip(),"names":z.namelist(),"texts":[z.read(n).decode("utf-8") for n in z.namelist()],"methods":[i.compress_type for i in z.infolist()]},ensure_ascii=True))'], { input: Buffer.from(await zipped.arrayBuffer()).toString('base64'), encoding: 'utf8' })
    assert.equal(run.status, 0, run.stderr); const result = JSON.parse(run.stdout)
    assert.equal(result.bad, null); assert.deepEqual(result.texts, [source, '두 번째 자료']); assert.deepEqual(result.methods, [0, 0])
    assert.equal(new Set(result.names).size, 2); assert.ok(result.names.every(name => !/[\\/]/.test(name))); assert.match(result.names[0], /계획.pdf$/)
  })
  await test('300개 완료본과 현황표를 묶을 수 있고 초과·취소·읽기 실패는 파일을 만들지 않는다', async () => {
    const entries = Array.from({ length: 301 }, (_, index) => ({ name: '문서' + index + '.pdf', bytes: new TextEncoder().encode('%PDF-1.4') }))
    assert.ok(buildStoredZip(entries).size > 0); assert.equal(FILE_TECHNICAL_LIMITS.zipEntries, 512)
    assert.throws(() => buildStoredZip([]), code('FILE_ZIP_LIMIT')); assert.throws(() => buildStoredZip(Array(513).fill(entries[0])), code('FILE_ZIP_LIMIT'))
    const large = new Blob([new Uint8Array(5 * 1024 * 1024)])
    await assert.rejects(createStoredZip(Array(21).fill({ name: '큰문서.pdf', blob: large })), code('FILE_ZIP_LIMIT'))
    const cancelled = new AbortController(); cancelled.abort(); await assert.rejects(createStoredZip([{ name: '문서.pdf', blob: pdf() }], cancelled.signal), code('FILE_ABORTED'))
    class Broken extends Blob { stream() { throw Error('RAW_SECRET') } }
    await assert.rejects(createStoredZip([{ name: '문서.pdf', blob: new Broken(['a']) }]), code('FILE_READ_FAILED'))
  })
  await test('원본 다운로드 성공·클릭 실패 모두 object URL과 임시 링크를 정리한다', () => {
    const original = { document: globalThis.document, create: URL.createObjectURL, revoke: URL.revokeObjectURL, timer: globalThis.setTimeout }, revoked = [], clicks = [], callbacks = []; let removed = 0, fail = false
    URL.createObjectURL = () => 'blob:fixture'; URL.revokeObjectURL = value => revoked.push(value)
    globalThis.setTimeout = callback => { callbacks.push(callback); return 1 }
    globalThis.document = { body: { append() {} }, createElement() { return { set href(value) {}, set download(value) { clicks.push(value) }, click() { if (fail) throw Error('RAW_SECRET') }, remove() { removed++ } } } }
    try {
      requestBlobDownload(pdf(), '../계획.pdf'); assert.equal(removed, 1); callbacks[0](); assert.deepEqual(revoked, ['blob:fixture']); assert.ok(!/[\\/]/.test(clicks[0]))
      fail = true; assert.throws(() => requestBlobDownload(pdf(), '실패.pdf'), code('FILE_DOWNLOAD_FAILED')); assert.equal(removed, 2); assert.equal(revoked.length, 2)
      URL.createObjectURL = () => { throw Error('RAW_SECRET') }; assert.throws(() => requestBlobDownload(pdf(), '실패.pdf'), code('FILE_DOWNLOAD_FAILED'))
    } finally { globalThis.document = original.document; URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; globalThis.setTimeout = original.timer }
  })
} finally { if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage); else delete globalThis.localStorage; globalThis.fetch = originalFetch }
console.log('\n수합 파일 모듈 ' + passed + '개 통과, ' + failed + '개 실패')
if (failed) process.exitCode = 1
