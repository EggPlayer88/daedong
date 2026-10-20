// 시간표 승인 범위만 검사한다. #64 통합 후보의 보류 규칙과 SQL 기준은 바꾸지 않는다.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {fileURLToPath} from 'node:url'
const root=fileURLToPath(new URL('../',import.meta.url)),git=(...args)=>execFileSync('git',['-c','core.quotePath=false',...args],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd()
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8'),split=s=>s.split('\0').filter(Boolean)
try{
const inventory=JSON.parse(read('docs/workhub/timetable/completion-inventory.json')),ancestors=new Set(git('rev-list','HEAD').split('\n'))
assert.equal(git('ls-files','--unmerged'),'')
assert(ancestors.has(inventory.baseline),'보호 경계 기준이 현재 이력에 없습니다')
for(const row of inventory.included)assert(ancestors.has(row.sha),`포함 이력 누락 #${row.number}`)
const deferred=JSON.parse(read('docs/workhub/integration-r2/pr-inventory.json')).deferred.concat(JSON.parse(read('docs/workhub/pilot-completion/inventory.json')).excluded)
for(const row of deferred)assert(!ancestors.has(row.sha),`보류 이력 포함 #${row.number}`)
const paths=[...split(git('diff','--name-only','-z',inventory.baseline)),...split(git('ls-files','--others','--exclude-standard','-z'))]
const protectedPath=/^(?:database\/|migrations\/|packages\/shared\/|apps\/main\/api\/|workers\/|docs\/workhub\/release-candidate\/|scripts\/(?:verify-workhub-release-sql\.sh|check-workhub-release\.mjs)$|apps\/main\/src\/(?:lib\/(?:modules\.js|AuthContext\.jsx)|pages\/LoginPage\.jsx)$)/
assert.deepEqual(paths.filter(p=>protectedPath.test(p)),[],'SQL·인증·공개·비용·기존 통합 후보 변경')
assert.deepEqual(paths.filter(p=>p.startsWith('.github/workflows/')&&p!=='.github/workflows/test.yml'),[],'운영 자동화 변경')
const modules=[...read('apps/workhub/src/modules.ts').matchAll(/\{ id: '[^']+'[^\n]+/g)]
assert.equal(modules.length,12);assert(modules.every(r=>r[0].includes("visibility: 'superadmin'")&&r[0].includes('productionEnabled: false')))
for(const name of ['dbApplied','costChanged','teacherVisibilityExpanded'])assert.equal(inventory[name],false)
console.log(JSON.stringify({included:inventory.included.map(r=>r.number),deferred:deferred.map(r=>r.number),protected:true,changedPaths:new Set(paths).size},null,2))
}catch(error){console.error('시간표 구축 범위 검사 실패:',error.message);process.exitCode=1}
