import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const source = fileURLToPath(new URL('../docs/workhub/database-integrated/', import.meta.url))
const { validateDesignConstraints } = require(join(source, 'design-constraints.cjs'))
const baselineBytes = readFileSync(join(source, 'source-baseline.json'))
const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''))
const baseline = read(join(source, 'source-baseline.json'))
const tokens = ['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']
let passed = 0, failures = 0
function test(name, run) {
  try { run(); passed++; console.log('  ✓ ' + name) }
  catch (error) { failures++; console.error('  ✗ ' + name + ': ' + error.stack) }
}
function withBuild(mutate = () => {}) {
  const temporary = mkdtempSync(join(tmpdir(), 'workhub-design-constraints-'))
  try {
    cpSync(source, temporary, { recursive: true })
    const edit = (file, fn) => {
      const path = join(temporary, file), data = read(path)
      fn(data)
      writeFileSync(path, JSON.stringify(data, null, 2) + '\n')
    }
    mutate(edit)
    const run = spawnSync(process.execPath, ['build-design.cjs'], { cwd: temporary, encoding: 'utf8' })
    assert.equal(run.error, undefined)
    const result = { status: run.status, report: read(join(temporary, 'validation-result.json')), schema: read(join(temporary, 'schema-contract.json')), output: run.stdout + run.stderr }
    assert.deepEqual(readFileSync(join(temporary, 'source-baseline.json')), baselineBytes, '격리 생성 중 baseline이 바뀌면 안 된다')
    return result
  } finally {
    // 이번 시험이 만든 전용 임시 폴더임을 확인한 뒤 그 경로만 정리한다.
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
    assert.ok(basename(temporary).startsWith('workhub-design-constraints-'))
    rmSync(temporary, { recursive: true, force: true })
  }
}
const table = (schema, name) => schema.tables.find(item => item.name === name)
const change = (data, name) => data.changes.find(item => item.table.replace(/^workhub\./, '') === name)
function assertTokenDefaults(schema) {
  const usage = table(schema, 'usage_events')
  for (const name of tokens) {
    const column = usage.columns.find(item => item.name === name)
    assert.equal(column.nullable, true, name + '.nullable')
    assert.equal(column.default, null, name + '.default: 미확인량에 기본값 0을 넣지 않는다')
  }
}
const built = withBuild()
test('실제 변경 목록과 확장 계약을 격리 생성하면 정합성 검사를 통과한다', () => {
  assert.equal(built.status, 0, built.output)
  assert.equal(built.report.passed, true)
  assert.deepEqual(built.report.errors, [])
  assert.deepEqual(built.report.warnings, [])
})
test('삭제한 수합 공개 열의 정확한 네 제약과 FK 투영을 함께 대체한다', () => {
  const collections = table(built.schema, 'collections')
  const names = ['collections_check', 'collections_visibility_check', 'collections_visibility_not_null', 'collections_school_id_view_audience_set_id_fkey']
  assert.deepEqual(collections.superseded_constraints.map(item => item.name), names)
  for (const name of names) assert.ok(!collections.inherited_constraints.some(item => item.name === name))
  assert.ok(!collections.inherited_foreign_keys.some(item => item.name === names[3]))
  assert.equal(collections.superseded_foreign_keys[0].name, names[3])
  assert.ok(collections.mandatory_constraints.some(item => item.includes('FOREIGN KEY(school_id,request_audience_set_id)')))
  assert.ok(collections.mandatory_constraints.some(item => item.includes('FOREIGN KEY(school_id,result_audience_set_id)')))
})
test('서비스 접수의 옛 사람 PK·NOT NULL·PK 인덱스를 명시적으로 대체한다', () => {
  const receipt = table(built.schema, 'idempotency_receipts')
  assert.equal(receipt.columns.find(item => item.name === 'actor_account_id').nullable, true)
  assert.ok(receipt.mandatory_constraints.some(item => item.startsWith('PRIMARY KEY(actor_key,scope_key,operation,idem_key)')))
  assert.ok(receipt.mandatory_constraints.includes('num_nonnulls(actor_account_id,actor_service_principal_id)=1'))
  assert.ok(!receipt.inherited_constraints.some(item => ['idempotency_receipts_pkey', 'idempotency_receipts_actor_account_id_not_null'].includes(item.name)))
  assert.ok(!receipt.inherited_indexes.some(item => item.name === 'idempotency_receipts_pkey'))
  assert.ok(receipt.superseded_indexes.some(item => item.name === 'idempotency_receipts_pkey'))
})
test('책임자 공백의 NULL을 허용하면서 기존 책임자 FK를 유지한다', () => {
  const units = table(built.schema, 'collection_units')
  assert.equal(units.columns.find(item => item.name === 'responsible_membership_id').nullable, true)
  assert.ok(!units.inherited_constraints.some(item => item.name === 'collection_units_responsible_membership_id_not_null'))
  assert.ok(units.inherited_foreign_keys.some(item => item.name === 'collection_units_school_id_responsible_membership_id_fkey'))
  assert.ok(units.mandatory_constraints.includes('assigned and not needs_owner이면 현재 유효 책임자 필수'))
})
test('토큰 네 열의 NULL과 실제 0을 구분하고 음수 차단 CHECK는 유지한다', () => {
  assertTokenDefaults(built.schema)
  const usage = table(built.schema, 'usage_events')
  for (const name of tokens) {
    assert.ok(!usage.inherited_constraints.some(item => item.name === 'usage_events_' + name + '_not_null'))
    assert.ok(usage.inherited_constraints.some(item => item.name === 'usage_events_' + name + '_check'))
  }
})
test('명시한 모순 이외의 원본 제약과 인덱스를 추정 삭제하지 않는다', () => {
  const removed = {
    collections: ['collections_check', 'collections_visibility_check', 'collections_visibility_not_null', 'collections_school_id_view_audience_set_id_fkey'],
    collection_units: ['collection_units_responsible_membership_id_not_null'],
    usage_events: tokens.map(name => 'usage_events_' + name + '_not_null'),
    idempotency_receipts: ['idempotency_receipts_actor_account_id_not_null', 'idempotency_receipts_pkey'],
  }
  for (const [name, names] of Object.entries(removed)) {
    const before = baseline.tables.find(item => item.name === name), after = table(built.schema, name)
    assert.deepEqual(after.inherited_constraints, before.constraints.filter(item => !names.includes(item.name)))
    assert.deepEqual(after.inherited_indexes, before.indexes.filter(item => name !== 'idempotency_receipts' || item.name !== 'idempotency_receipts_pkey'))
  }
})
test('수합 삭제 열의 옛 CHECK를 되살리면 생성이 실패한다', () => {
  const result = withBuild(edit => edit('workflows-changes.json', data => {
    const item = change(data, 'collections')
    item.supersedes_constraints = item.supersedes_constraints.filter(name => name !== 'collections_check')
  }))
  assert.equal(result.status, 1)
  assert.ok(result.report.errors.some(error => error.includes('collections.collections_check') && error.includes('삭제 열')))
})
test('책임자 NOT NULL을 되살리면 정확한 제약 이름으로 실패한다', () => {
  const result = withBuild(edit => edit('workflows-changes.json', data => { change(data, 'collection_units').supersedes_constraints = [] }))
  assert.equal(result.status, 1)
  assert.ok(result.report.errors.some(error => error.includes('NULL 허용과 상속 NOT NULL 충돌: collection_units.collection_units_responsible_membership_id_not_null')))
})
test('명시 NOT NULL을 없애도 옛 사람 PK가 남으면 생성이 실패한다', () => {
  const result = withBuild(edit => edit('student-ai-changes.json', data => {
    const item = change(data, 'idempotency_receipts')
    item.supersedes_constraints = item.supersedes_constraints.filter(name => name !== 'idempotency_receipts_pkey')
  }))
  assert.equal(result.status, 1)
  assert.ok(result.report.errors.some(error => error.includes('NULL 허용과 상속 PK 충돌: idempotency_receipts.idempotency_receipts_pkey')))
})
test('기본값 제거를 생략해 0이 되살아나면 토큰 계약 회귀가 잡는다', () => {
  const result = withBuild(edit => edit('student-ai-changes.json', data => {
    for (const column of change(data, 'usage_events').columns) if (tokens.includes(column.name)) delete column.default
  }))
  // 생략 자체는 다른 열에서 합법적이므로 일반 검사 대신 이 업무의 독립 기대값으로 검출한다.
  assert.equal(result.status, 0, result.output)
  assert.throws(() => assertTokenDefaults(result.schema), /default/)
})
test('존재하지 않는 제약 이름은 자동 무시하지 않는다', () => {
  const result = withBuild(edit => edit('workflows-changes.json', data => {
    change(data, 'collections').supersedes_constraints.push('collections_does_not_exist')
  }))
  assert.equal(result.status, 1)
  assert.ok(result.report.errors.some(error => error.includes('대체할 제약 없음: collections collections_does_not_exist')))
})
test('옛 FK 투영만 되살려도 삭제 열과 대체 FK 잔존을 검출한다', () => {
  const schema = structuredClone(built.schema), collections = table(schema, 'collections')
  collections.inherited_foreign_keys.push(structuredClone(collections.superseded_foreign_keys[0]))
  const errors = validateDesignConstraints(schema.tables).errors
  assert.ok(errors.some(error => error.includes('상속 FK의 로컬 열 없음: collections.collections_school_id_view_audience_set_id_fkey')))
  assert.ok(errors.some(error => error.includes('대체 FK가 상속 투영에 남음')))
})
test('생성 결과가 명시 default:null을 무시하면 일반 변경값 검사에서 실패한다', () => {
  const schema = structuredClone(built.schema)
  table(schema, 'usage_events').columns.find(item => item.name === 'input_tokens').default = '0'
  const changes = [{ table: 'workhub.usage_events', columns: [{ name: 'input_tokens', default: null }] }]
  assert.ok(validateDesignConstraints(schema.tables, changes).errors.includes('명시 열 변경값 불일치: usage_events.input_tokens.default'))
})
test('상속 FK의 대상 열이 없어졌을 때도 로컬 열과 별도로 검출한다', () => {
  const schema = structuredClone(built.schema)
  const foreignKey = table(schema, 'collection_units').inherited_foreign_keys.find(item => item.name === 'collection_units_school_id_responsible_membership_id_fkey')
  foreignKey.target_columns = ['school_id', 'missing_member_id']
  assert.ok(validateDesignConstraints(schema.tables).errors.some(error => error.includes('상속 FK의 대상 열 없음: collection_units.collection_units_school_id_responsible_membership_id_fkey')))
})
test('문자열·달러 문자열·주석·긴 식별자를 삭제 열로 오판하지 않는다', () => {
  const fixture = {
    name: 'example', columns: [{ name: 'caption', nullable: false }, { name: 'other_visibility', nullable: true }],
    removed_columns: ['visibility'],
    inherited_constraints: [{ name: 'safe_check', kind: 'c', definition: "CHECK (caption <> 'visibility' AND caption <> $$visibility$$ AND caption <> $body$visibility$body$ AND other_visibility IS NULL) /* visibility /* visibility */ */ -- visibility" }],
    inherited_indexes: [{ name: 'visibility', definition: "CREATE INDEX visibility ON workhub.example USING btree (caption) WHERE caption <> 'visibility'" }],
  }
  assert.deepEqual(validateDesignConstraints([fixture]), { errors: [], warnings: [] })
  fixture.inherited_constraints.push({ name: 'bad_quoted', kind: 'c', definition: 'CHECK ("visibility" IS NOT NULL)' })
  assert.ok(validateDesignConstraints([fixture]).errors.some(error => error.includes('example.bad_quoted')))
})
test('NULL을 허용하는 UNIQUE는 PK와 달리 잘못 거부하지 않는다', () => {
  const fixture = { name: 'example', columns: [{ name: 'optional_id', nullable: true }], inherited_constraints: [{ name: 'optional_key', kind: 'u', definition: 'UNIQUE (optional_id)' }] }
  assert.deepEqual(validateDesignConstraints([fixture]), { errors: [], warnings: [] })
})
test('검사와 격리 생성이 저장소 원본 baseline을 바꾸지 않는다', () => {
  assert.deepEqual(readFileSync(join(source, 'source-baseline.json')), baselineBytes)
})

console.log('\n설계 제약 회귀: ' + passed + ' 통과, ' + failures + ' 실패 (실제 DB 시험 아님)')
if (failures) process.exitCode = 1

