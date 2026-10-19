// 합성 네트워크를 사용하는 실제 연결 어댑터·신원 확인·페이지 검증의 짧은 회귀다.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root=fileURLToPath(new URL('../',import.meta.url))
function run(args){
  const output=execFileSync(process.execPath,['scripts/benchmark-workhub-timetable-publication.mjs',...args],{cwd:root,encoding:'utf8',timeout:30000})
  return JSON.parse(output.trim().split(/\r?\n/).at(-1))
}
const success=run(['--pages','2','--delay-ms','5'])
assert.equal(success.outcome,'success');assert.equal(success.verifiedPages,2)
assert.equal(success.pageCalls,2);assert.equal(success.profiles,6)
assert.ok(success.elapsedMs>=40);assert.ok(success.remainingMs>0)
console.log('  ✓ 실제 연결 경로에서 페이지마다 신원을 세 번 재확인하며 전체 검증한다')
const expired=run(['--pages','2','--delay-ms','50','--lifetime-ms','100','--expect','CONFLICT'])
assert.equal(expired.outcome,'CONFLICT');assert.ok(expired.elapsedMs>=100)
assert.equal(expired.verifiedPages,0);assert.equal(expired.pageCalls,1);assert.equal(expired.profiles,3)
console.log('  ✓ 실제 시계·전송 지연으로 만료된 첫 페이지를 버리고 다음 조회·완료를 하지 않는다')
console.log('시간표 대용량 검증 실제 지연 경로: 2개 통과')
