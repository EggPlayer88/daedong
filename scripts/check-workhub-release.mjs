// 이번 통합 후보의 이력·SQL 원본·공개 범위를 확인한다. 외부 서비스에는 접근하지 않는다.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
export function verifyRelease({root=defaultRoot}={}){
 const read=path=>readFileSync(resolve(root,path),'utf8')
 const manifest=JSON.parse(read('docs/workhub/release-candidate/inventory.json'))
 const pilot=JSON.parse(read('docs/workhub/pilot-completion/inventory.json'))
 const r2=JSON.parse(read('docs/workhub/integration-r2/pr-inventory.json'))
 const git=(...args)=>execFileSync('git',['-c','core.quotePath=false',...args],{cwd:root,encoding:'utf8',maxBuffer:32*1024*1024}).trimEnd()
 const split=text=>text.split('\0').filter(Boolean)
 assert.equal(git('ls-files','--unmerged'),'','해결하지 않은 충돌')
 assert.equal(git('rev-parse','--is-shallow-repository'),'false','전체 Git 이력이 필요합니다')
 assert.equal(manifest.version,1)
 assert.equal(manifest.app.number,63);assert.equal(manifest.sql.number,61);assert.equal(manifest.sql.path,'database/workhub')
 for(const key of ['dbAppliedByThisWork','teacherVisibilityExpanded','costConfigurationChanged'])assert.equal(manifest[key],false,key)
 const ancestors=new Set(git('rev-list','HEAD').split('\n'))
 const included=[manifest.app,manifest.sql,...pilot.app_ancestors,...r2.included,...r2.preserved]
 for(const source of included){assert.match(source.sha,/^[a-f0-9]{40}$/);assert(ancestors.has(source.sha),`포함 이력 누락 #${source.number}`)}
 assert(ancestors.has(manifest.baselineMain),'main 기준 이력 누락')
 const excluded=[...r2.deferred,...pilot.excluded,...manifest.excluded]
 assert.deepEqual(excluded.map(x=>x.number).sort((a,b)=>a-b),[3,5,44,54,56])
 for(const row of excluded)assert(!ancestors.has(row.sha),`보류 이력 포함 #${row.number}`)
 assert.deepEqual(split(git('diff','--name-only','-z',manifest.sql.sha,'--',manifest.sql.path)),[],'Claude SQL 원문 변경')
 assert.deepEqual(split(git('ls-files','--others','--exclude-standard','-z','--',manifest.sql.path)),[],'Claude 원본에 없는 SQL 추가')
 const sqlPackage=JSON.parse(read('docs/workhub/release-candidate/sql-package.json'))
 assert.equal(sqlPackage.sourceCommit,manifest.sql.sha,'실행 파일 목록의 SQL 기준이 다릅니다')
 const sqlPaths=split(git('ls-tree','-r','--name-only','-z',manifest.sql.sha,'--',manifest.sql.path)).filter(path=>path.endsWith('.sql')&&!path.includes('/test/'))
 assert.deepEqual(sqlPackage.files.map(item=>item.path),sqlPaths,'실행 파일 해시 목록 누락')
 for(const item of sqlPackage.files){const bytes=execFileSync('git',['show',manifest.sql.sha+':'+item.path],{cwd:root,maxBuffer:8*1024*1024});assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,`SQL 원문 해시 불일치 ${item.path}`)}
 const paths=[...new Set([...split(git('diff','--name-only','-z',manifest.app.sha)),...split(git('ls-files','--others','--exclude-standard','-z'))])]
 const protectedPath=/^(?:packages\/shared\/|migrations\/|apps\/main\/api\/|doc-ai-templates-v4\/|apps\/main\/public\/examples\/|examples\/|workers\/|apps\/main\/src\/(?:lib\/(?:modules\.js|AuthContext\.jsx)|pages\/LoginPage\.jsx)$)/
 assert.deepEqual(paths.filter(path=>protectedPath.test(path)),[],'기존 인증·공개 범위·확정 문서·API 비용·작업자 변경')
 assert.deepEqual(paths.filter(path=>/^(?:apps|packages|workers|scripts)\/.*(?:timetable|keepalive)/i.test(path)),[],'보류 시간표·운영 자동화 변경')
 assert.deepEqual(paths.filter(path=>path.startsWith('.github/workflows/')&&path!=='.github/workflows/test.yml'),[],'운영 워크플로 추가')
 const triggers=source=>{const lines=source.replace(/\r\n/g,'\n').split('\n'),start=lines.findIndex(line=>/^(?:on|"on"|'on')\s*:/.test(line));assert(start>=0);const end=lines.findIndex((line,index)=>index>start&&/^[^\s#]/.test(line));return lines.slice(start,end<0?undefined:end).join('\n').trimEnd()}
 assert.equal(triggers(read('.github/workflows/test.yml')),triggers(git('show',manifest.app.sha+':.github/workflows/test.yml')),'자동 실행 범위 변경')
 const modules=[...read('apps/workhub/src/modules.ts').matchAll(/\{ id: '[^']+'[^\n]+/g)]
 assert.equal(modules.length,11)
 assert(modules.every(item=>item[0].includes("visibility: 'superadmin'")&&item[0].includes('productionEnabled: false')),'신규 메뉴 공개 범위 변경')
 return{app:manifest.app,sql:manifest.sql,sqlFiles:sqlPaths.length,historySources:included.length,excluded:excluded.map(x=>x.number),protected:true,changedPaths:paths.length}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){try{console.log(JSON.stringify(verifyRelease(),null,2))}catch(error){console.error('통합 후보 보존 검사 실패:',error.message);process.exitCode=1}}
