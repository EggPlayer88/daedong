// 격리 PostgreSQL이 만든 원 응답을 수정 없이 현재 앱 파서에 넣는다.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from '../helpers/load-browser-module.mjs'
if (!process.argv[2]) throw Error('T3 PostgreSQL 응답 캡처 JSON 경로가 필요합니다.')
const captures = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const api = await loadBrowserModule("export * from '../apps/workhub/src/timetable/interventions-domain'")
assert(Array.isArray(captures) && captures.length > 0)
let pass = 0, fail = 0
for (const [index, row] of captures.entries()) {
  try {
    assert.equal(row.raw.contract, 'timetable-interventions.v1'); assert.equal(row.raw.memberId, row.memberId); assert.equal(row.raw.schoolId, row.schoolId)
    assert.deepEqual(Object.keys(row.raw).sort(), ['contract', 'data', 'memberId', 'schoolId'])
    const value = row.raw.data
    if (row.kind === 'get') api.parseInterventionsView(value, row.memberId, row.range.from, row.range.until, row.now)
    else if (row.kind === 'preview') api.parseInterventionPreview(value, api.interventionInput(row.input), api.parseInterventionsView(row.source, row.memberId, row.source.from, row.source.until, row.now), row.now)
    else if (row.kind === 'execute' || row.kind === 'close') {
      const command = api.interventionCommand(row.command), hash = await api.interventionHash(command)
      if (row.kind === 'execute') api.parseInterventionReceipt(value, command, row.key, hash, row.now)
      else api.parseInterventionClose(value, command, row.key, hash, row.now)
    } else if (row.kind === 'readiness') api.parseInterventionsReadiness(value)
    else if (row.kind === 'resolve') api.parseInterventionSource(value)
    else if (row.kind === 'summary') api.parseInterventionsSummary(value, row.now)
    else throw Error('알 수 없는 캡처 종류')
    pass++
  } catch (error) { fail++; console.error(`FAIL ${index + 1} ${row.kind} ${row.input?.kind ?? row.command?.kind ?? ''}: ${error.code ?? error.message}`) }
}
console.log(`T3 실제 PostgreSQL → 앱 파서: ${pass} PASS / ${fail} FAIL`)
if (fail) process.exitCode = 1
