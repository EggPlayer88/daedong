import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,dirname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {createDeploymentPackage} from '../scripts/export-workhub-deployment.mjs'
const root=fileURLToPath(new URL('../',import.meta.url)),inventoryPath='docs/workhub/deployment-preparation/sql-inventory.json'
const inventory=JSON.parse(readFileSync(join(root,inventoryPath),'utf8'))
const source=mkdtempSync(join(tmpdir(),'deployment-source-')),outputParent=mkdtempSync(join(tmpdir(),'deployment-packages-'))
for(const path of [...inventory.files.map(row=>row.path),inventoryPath,'docs/workhub/deployment-preparation/README.md','docs/workhub/deployment-preparation/runbook.md','docs/workhub/deployment-preparation/verification.md','database/workhub-deployment/integration/README.md','database/workhub-deployment/integration/test/RESULTS.md']){
 const target=join(source,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(root,path),target)
}
writeFileSync(join(source,'.env'),'TEST_ONLY_NOT_A_REAL_SECRET=do-not-package\n')
let count=0,result
function test(name,fn){fn();count++;console.log('  ✓ '+name)}
test('허용 목록 SQL만 분리해 내보내고 해시는 실제 UTF-8/LF 바이트와 일치한다',()=>{
 result=createDeploymentPackage({sourceRoot:source,outputParent})
 assert.equal(result.manifest.kind,'review_only_not_approved');assert.equal(result.manifest.productionDbApplied,false)
 assert.equal(result.manifest.files.length,inventory.files.length)
 for(const item of result.manifest.files){
  const bytes=readFileSync(join(result.output,item.path));assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256)
  assert.equal(bytes.includes(Buffer.from('\r\n')),false)
  if(item.kind==='approval')assert.match(item.path,/^(03-approval-only|05-deferred)\//)
  if(item.phase==='baseline')assert.match(item.path,/^00-baseline-read-only\//)
 }
 assert(!readdirSync(result.output).includes('.env'))
 assert.equal(readFileSync(join(result.output,'SHA256SUMS'),'utf8').trim().split('\n').length,inventory.files.length)
 assert.match(readFileSync(join(result.output,'README.txt'),'utf8'),/파일명 정렬로 실행하지 마세요/)
 assert.match(readFileSync(join(result.output,'database/workhub-deployment/integration/test/RESULTS.md'),'utf8'),/116/)
})
test('같은 상위폴더로 다시 만들어도 기존 검토본이나 사용자 파일을 덮어쓰지 않는다',()=>{
 writeFileSync(join(result.output,'사용자메모.txt'),'보존할 메모')
 const next=createDeploymentPackage({sourceRoot:source,outputParent})
 assert.notEqual(next.output,result.output);assert.equal(readFileSync(join(result.output,'사용자메모.txt'),'utf8'),'보존할 메모')
})
test('원문이 달라진 SQL은 새 검토 폴더를 만들기 전에 거절한다',()=>{
 const path=join(source,inventory.files.find(row=>row.kind==='install').path),before=readFileSync(path),directories=readdirSync(outputParent)
 writeFileSync(path,Buffer.concat([before,Buffer.from('\n-- changed fixture\n')]))
 try{assert.throws(()=>createDeploymentPackage({sourceRoot:source,outputParent}));assert.deepEqual(readdirSync(outputParent),directories)}finally{writeFileSync(path,before)}
})
test('승인 양식을 설치로 위장한 목록은 내보내지 않는다',()=>{
 const path=join(source,inventoryPath),modified=structuredClone(inventory),directories=readdirSync(outputParent)
 modified.files.find(row=>row.kind==='approval').kind='install';writeFileSync(path,JSON.stringify(modified))
 try{assert.throws(()=>createDeploymentPackage({sourceRoot:source,outputParent}));assert.deepEqual(readdirSync(outputParent),directories)}finally{writeFileSync(path,JSON.stringify(inventory))}
})
console.log('검토용 배포 자료 내보내기 '+count+'건 통과')
