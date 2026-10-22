// 검토 목록 검사는 저장소·임시 파일만 읽으며 운영 연결이나 SQL 실행을 하지 않는다.
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,copyFileSync,renameSync,symlinkSync,unlinkSync} from 'node:fs'
import {join,dirname,resolve,basename} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {verifyDeployment,normalizeSqlBytes,DEPLOYMENT_INVENTORY} from '../scripts/check-workhub-sql-package.mjs'

const repo=fileURLToPath(new URL('../',import.meta.url)),inventory=JSON.parse(readFileSync(join(repo,DEPLOYMENT_INVENTORY),'utf8'))
const task=mkdtempSync(join(tmpdir(),'workhub-sql-package-')),root=join(task,'검증 사본');mkdirSync(root)
for(const file of inventory.files){const target=join(root,file.path);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(repo,file.path),target)}
mkdirSync(dirname(join(root,DEPLOYMENT_INVENTORY)),{recursive:true});writeFileSync(join(root,DEPLOYMENT_INVENTORY),JSON.stringify(inventory))
let passed=0
function test(name,fn){fn();passed++;console.log('  ✓ '+name)}
function rejects(change,pattern){const candidate=structuredClone(inventory);change(candidate);assert.throws(()=>verifyDeployment({root,inventory:candidate}),pattern)}

test('현재 원문 전체와 분리된 15개 설치·승인·점검을 읽기 전용 검증한다',()=>{
 const result=verifyDeployment({root});assert.equal(result.counts.packages,7);assert.equal(result.counts.installations,15)
 assert.equal(result.executedSql,false);assert.equal(result.liveDatabaseChecked,false)
 assert.equal(result.files.length,inventory.files.length)
 assert(result.files.some(row=>row.id==='ai-p10-11'&&row.kind==='check'))
 assert(result.files.some(row=>row.id==='deferred-r1s-04'&&row.phase==='deferred'))
 assert(result.files.some(row=>row.id==='deferred-p3-05'&&row.phase==='deferred'))
})
test('잘못된 판·해시 정규화·모양을 거절한다',()=>{
 rejects(value=>value.version=2,/목록 판/);rejects(value=>value.hash.normalization='raw',/해시 규칙/)
 rejects(value=>value.files=null,/목록 모양/);rejects(value=>value.packages=[],/패키지/)
})
test('이번 준비를 운영 실조회·DB 적용·회원 연결·자동 활성화로 바꾸지 못한다',()=>{
 rejects(value=>value.baseline.liveDatabaseChecked=true,/운영 실조회/)
 rejects(value=>value.baseline.replayBaseline=true,/재실행/)
 for(const key of ['productionDbApplied','memberLinkingPerformed','automaticActivation','automaticDeployment','claudeReviewRequested'])rejects(value=>value.execution[key]=true,/보류 범위/)
})
test('같은 P10 번호라도 두 패키지를 섞거나 경로를 바꾸면 거절한다',()=>{
 rejects(value=>value.pendingRoots[4]=value.pendingRoots[1],/패키지 범위/)
 rejects(value=>value.files.find(row=>row.id==='ai-p10-01').packageId='school-p10',/분류/)
 rejects(value=>value.files.find(row=>row.id==='ai-p10-01').path=value.files.find(row=>row.id==='school-p10-01').path,/경로 중복/)
})
test('누락 파일·중복 ID·잘못된 해시를 거절한다',()=>{
 rejects(value=>value.files.pop(),/개수/)
 rejects(value=>value.files[1].id=value.files[0].id,/ID 중복/)
 rejects(value=>value.files[0].sha256='0'.repeat(64),/해시 불일치/)
 rejects(value=>value.files[0].sha256='확인 전',/SHA-256/)
})
test('승인 양식을 설치로 다시 분류하거나 설치 목록에 끼워 넣으면 거절한다',()=>{
 rejects(value=>value.files.find(row=>row.id==='school-p9-03').kind='install',/분류/)
 rejects(value=>value.installOrder.push('school-p9-03'),/설치 순서/)
 rejects(value=>value.installOrder.push('deferred-p3-05'),/설치 순서/)
 rejects(value=>value.installOrder.push('school-p10-80'),/설치 순서/)
})
test('이미 적용한 기준선이나 점검 SQL을 설치 목록으로 보내지 않는다',()=>{
 rejects(value=>value.installOrder.unshift('baseline-t2-07'),/설치 순서/)
 rejects(value=>value.installOrder.push('integration-int05'),/설치 순서/)
 rejects(value=>value.files.find(row=>row.id==='school-p9-01').phase='baseline',/분류/)
})
test('파일 선행 순환·알 수 없는 의존성을 거절한다',()=>{
 rejects(value=>value.files.find(row=>row.id==='school-p9-01').after=['school-p9-02'],/순환/)
 rejects(value=>value.files[0].after=['없는 파일'],/알 수 없는/)
 rejects(value=>value.files[0].after=['baseline-t2-07','baseline-t2-07'],/선행 파일 중복/)
})
test('패키지 의존 순환·잘못된 선행 순서·설치 영향 설명 누락을 거절한다',()=>{
 rejects(value=>value.packages[0].dependsOn=['school-p10'],/순환/)
 rejects(value=>value.packages[0].dependsOn=['memory-m1'],/선행 설치/)
 rejects(value=>value.packages[0].installEffects=[],/영향/)
})
test('선행 패키지와 기존 기준선 의존성을 임의로 빼지 못한다',()=>{
 rejects(value=>value.packages.find(row=>row.id==='school-p10').dependsOn=[],/선행 설치 계약/)
 rejects(value=>value.packages.find(row=>row.id==='ai-p10').baselineRequires=[],/기준선 의존성/)
})
test('설치 파일 순서와 사전·사후 점검 누락을 거절한다',()=>{
 rejects(value=>[value.installOrder[0],value.installOrder[1]]=[value.installOrder[1],value.installOrder[0]],/설치 순서/)
 rejects(value=>value.preInstallChecks.pop(),/사전 점검/)
 rejects(value=>value.checkpoints.pop(),/사후 점검/)
 rejects(value=>value.files.find(row=>row.id==='integration-int05').after=[],/적용 범위/)
})
test('저장소 밖·절대·역슬래시·빈 경로를 거절한다',()=>{
 for(const path of ['../outside.sql','/tmp/outside.sql','C:/outside.sql','database\\outside.sql','database//outside.sql','database/./outside.sql',''])rejects(value=>value.files[0].path=path,/상대 경로/)
})
test('SQL을 실제로 한 글자 바꾸면 해시가 맞지 않는다',()=>{
 const path=join(root,inventory.files[0].path),before=readFileSync(path)
 try{writeFileSync(path,Buffer.concat([before,Buffer.from('\n-- 검토되지 않은 변경\n')]));assert.throws(()=>verifyDeployment({root}),/원문 해시/)}finally{writeFileSync(path,before)}
})
test('Windows CRLF 체크아웃은 같은 LF 원문으로 검증하고 내보낼 수 있다',()=>{
 const path=join(root,inventory.files[0].path),before=readFileSync(path),canonical=normalizeSqlBytes(before)
 try{writeFileSync(path,canonical.toString('utf8').replace(/\n/g,'\r\n'));assert.deepEqual(normalizeSqlBytes(readFileSync(path)),canonical);assert.equal(verifyDeployment({root}).executedSql,false)}finally{writeFileSync(path,before)}
})
test('잘못된 UTF-8·BOM·NUL은 조용히 정규화하지 않는다',()=>{
 assert.throws(()=>normalizeSqlBytes(Buffer.from([0xc3,0x28])))
 assert.throws(()=>normalizeSqlBytes(Buffer.from([0xef,0xbb,0xbf,0x53])),/BOM/)
 assert.throws(()=>normalizeSqlBytes(Buffer.from('SELECT\0')),/NUL/)
 assert.deepEqual(normalizeSqlBytes(Buffer.from('SELECT 1;\r\n')),Buffer.from('SELECT 1;\n'))
})
test('패키지에 목록에 없는 SQL을 추가하면 놓치지 않는다',()=>{
 const path=join(root,inventory.pendingRoots[0],'P9-99_미등록.sql')
 try{writeFileSync(path,'SELECT 1;');assert.throws(()=>verifyDeployment({root}),/알려지지 않았거나 누락/)}finally{unlinkSync(path)}
})
test('같은 단계 번호의 두 원문이 있으면 임의로 하나를 선택하지 않는다',()=>{
 const path=join(root,inventory.pendingRoots[0],'P9-01_복제.sql')
 try{writeFileSync(path,'SELECT 1;');assert.throws(()=>verifyDeployment({root}),/단계 원문은 하나/)}finally{unlinkSync(path)}
})
test('시험 폴더 밖 하위 디렉터리의 미등록 SQL도 검출한다',()=>{
 const directory=join(root,inventory.pendingRoots[0],'별도 설치'),path=join(directory,'추가.sql');mkdirSync(directory)
 try{writeFileSync(path,'SELECT 1;');assert.throws(()=>verifyDeployment({root}),/알려지지 않았거나 누락/)}finally{unlinkSync(path)}
})
test('심볼릭 경로로 저장소 밖 SQL을 읽는 우회도 거절한다',()=>{
 const directory=join(root,inventory.pendingRoots[0]),parked=directory+'-원본',outside=join(task,'외부 SQL')
 mkdirSync(outside);renameSync(directory,parked);copyFileSync(join(parked,basename(inventory.files[0].path)),join(outside,basename(inventory.files[0].path)))
 try{symlinkSync(resolve(outside),directory,process.platform==='win32'?'junction':'dir');assert.throws(()=>verifyDeployment({root}),/실제 파일 경로가 저장소 밖/)}finally{try{unlinkSync(directory)}finally{renameSync(parked,directory)}}
})
console.log('배포 SQL 목록·해시·선행·보류 검사 '+passed+'건 통과')
