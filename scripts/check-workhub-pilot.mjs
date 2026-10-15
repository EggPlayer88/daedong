// 전체 시범 구축의 원본 보존·보류 범위 검사. DB나 외부 설정을 변경하지 않는다.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
export function verifyPilot({root=defaultRoot,inventory,r2}={}){
 const read=path=>readFileSync(resolve(root,path),'utf8')
 inventory??=JSON.parse(read('docs/workhub/pilot-completion/inventory.json'))
 r2??=JSON.parse(read('docs/workhub/integration-r2/pr-inventory.json'))
 const git=(...args)=>execFileSync('git',['-c','core.quotePath=false',...args],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}).trimEnd()
 const split=s=>s.split('\0').filter(Boolean),ancestor=new Set(git('rev-list','HEAD').split('\n'))
 assert.equal(git('ls-files','--unmerged'),'','해결하지 않은 충돌')
 assert.equal(git('rev-parse','--is-shallow-repository'),'false','전체 Git 이력 필요')
 assert.equal(inventory.version,1)
 assert.deepEqual(inventory.app_ancestors.map(x=>x.number),[43,45,46],'앱 통합 목록 누락')
 assert.deepEqual(inventory.excluded.map(x=>x.number),[44],'별도 검사기 보류 목록 누락')
 assert.deepEqual(r2.included.map(x=>x.number).sort((a,b)=>a-b),Array.from({length:17},(_,i)=>i+26),'2차 통합 목록 누락')
 assert.deepEqual(r2.deferred.map(x=>x.number),[3,5],'기존 보류 목록 누락')
 assert.match(inventory.base,/^[a-f0-9]{40}$/)
 assert(ancestor.has(inventory.base),'앱 기준 이력 누락')
 for(const row of [...inventory.app_ancestors,...r2.included,...r2.preserved])assert(ancestor.has(row.sha),`포함 이력 누락 #${row.number}`)
 for(const row of [...inventory.excluded,...r2.deferred])assert(!ancestor.has(row.sha),`보류 이력 포함 #${row.number}`)
 const paths=[...new Set([...split(git('diff','--name-only','-z',inventory.base)),...split(git('ls-files','--others','--exclude-standard','-z'))])]
 const frozen=/^(?:packages\/shared\/|migrations\/|database\/|apps\/main\/api\/(?:doc-ai|_hwpx)\/|doc-ai-templates-v4\/|apps\/main\/public\/examples\/|examples\/|workers\/|apps\/main\/src\/(?:lib\/(?:modules\.js|AuthContext\.jsx)|pages\/LoginPage\.jsx)$)/
 assert.deepEqual(paths.filter(p=>frozen.test(p)),[],'기존 인증·SQL·양식·파일검사 작업자 원문 변경')
 const apiChanges=paths.filter(p=>p.startsWith('apps/main/api/'))
 assert.deepEqual(apiChanges.filter(p=>!/^apps\/main\/api\/(?:collections\/(?:_hwpx_basic\.py|check-hwpx\.py|_assets\/hwpx-basic\.json)$|(?:messages|workhub-ai|workhub-documents)\/)/.test(p)),[],'승인 범위 밖 API 변경')
 assert.deepEqual(paths.filter(p=>/^(?:apps|packages|workers|scripts)\/.*(?:timetable|keepalive)/i.test(p)),[],'보류 시간표·자동화 변경')
 assert.deepEqual(paths.filter(p=>p.startsWith('.github/workflows/')&&p!=='.github/workflows/test.yml'),[],'새 운영 워크플로 변경')
 const trigger=s=>{const a=s.replace(/\r\n/g,'\n').split('\n'),start=a.findIndex(l=>/^(?:on|"on"|'on')\s*:/.test(l));assert(start>=0);const end=a.findIndex((l,i)=>i>start&&/^[^\s#]/.test(l));return a.slice(start,end<0?undefined:end).join('\n').trimEnd()}
 assert.equal(trigger(read('.github/workflows/test.yml')),trigger(git('show',inventory.base+':.github/workflows/test.yml')),'시험 트리거 변경')
 for(const source of r2.sql_sources){assert.deepEqual(split(git('diff','--name-only','-z',source.sha,'--',source.path)),[],'R0/R1 원문 변경')}
 const modules=read('apps/workhub/src/modules.ts')
 const items=[...modules.matchAll(/\{ id: '[^']+'[^\n]+/g)]
 assert(items.length>=11&&items.every(m=>m[0].includes("visibility: 'superadmin'")&&m[0].includes('productionEnabled: false')),'신규 메뉴 공개 범위 변경')
 return {base:inventory.base,app_ancestors:inventory.app_ancestors,legacy_included:r2.included.length,first_integration_preserved:r2.preserved.length,excluded:[...r2.deferred,...inventory.excluded].map(x=>x.number),r1s:'별도 SQL PR · 이 작업에서 적용하지 않음',changedPaths:paths.length,protected:true}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyPilot(),null,2))}catch(e){console.error('전체 시범 보존 검사 실패:',e.message);process.exitCode=1}}
