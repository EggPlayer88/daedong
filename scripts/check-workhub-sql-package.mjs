// 검토할 SQL의 목록·순서·원문만 확인한다. DB 접속이나 실행 기능은 없다.
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,readdirSync,realpathSync} from 'node:fs'
import {resolve,relative,isAbsolute,sep} from 'node:path'
import {fileURLToPath} from 'node:url'

const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
export const DEPLOYMENT_INVENTORY='docs/workhub/deployment-preparation/sql-inventory.json'
const registry=[
 ['school-p9','database/workhub-school-data/p9','P9',{1:'install',2:'install',3:'approval',4:'check',5:'check'}],
 ['school-p10','database/workhub-school-data/p10','P10',{1:'install',2:'install',3:'approval',4:'check',80:'stop'}],
 ['timetable-t3','database/workhub-timetable/t3','T3',{1:'install',2:'install',3:'install',4:'check',5:'approval'}],
 ['timetable-t4','database/workhub-timetable/t4','T4',{1:'install',2:'check'}],
 ['ai-p10','database/workhub-ai-policy/p10','P10',{1:'install',2:'install',3:'install',4:'check',5:'approval',6:'approval',7:'approval',8:'approval',9:'install',10:'install',11:'check'}],
 ['knowledge-k1','database/workhub-knowledge-history/k1','K1',{1:'install',2:'check'}],
 ['memory-m1','database/workhub-ai-memory/m1','M1',{0:'check',1:'install',2:'check',3:'approval'}],
]
const special=[
 ['baseline-t2-07','baseline','database/workhub-timetable/t2/T2-07_통합사후점검.sql','check','baseline'],
 ['deferred-r1s-04','deferred','database/workhub/r1s/R1S-04_학교활성화_양식.sql','approval','deferred'],
 ['deferred-p3-05','deferred','database/workhub/p3/P3-05_첨부활성화_양식.sql','approval','deferred'],
 ['deferred-p6-04','deferred','database/workhub/p6/P6-04_비서활성화_설정_양식.sql','approval','deferred'],
 ['deferred-t2-08','deferred','database/workhub-timetable/t2/T2-08_시간표운영활성화_양식.sql','approval','deferred'],
 ['integration-int05','integration','database/workhub-deployment/integration/INT-05_전체구축_통합점검.sql','check','pending'],
]
const installation=[
 'school-p9-01','school-p9-02','school-p10-01','school-p10-02',
 'timetable-t3-01','timetable-t3-02','timetable-t3-03','timetable-t4-01',
 'ai-p10-01','ai-p10-02','ai-p10-03','ai-p10-09','ai-p10-10','knowledge-k1-01','memory-m1-01',
]
const prechecks=[{beforeInstallId:'school-p9-01',checkIds:['baseline-t2-07']},{beforeInstallId:'memory-m1-01',checkIds:['memory-m1-00']}]
const packageDependencies={
 'school-p9':[], 'school-p10':['school-p9'], 'timetable-t3':['school-p10'],
 'timetable-t4':[], 'ai-p10':[], 'knowledge-k1':[], 'memory-m1':[],
}
const baselineDependencies={
 'school-p9':['T2'], 'school-p10':['T2'], 'timetable-t3':['T2'],
 'timetable-t4':['T1-07'], 'ai-p10':['P6-01','P6-02'], 'knowledge-k1':['P4'], 'memory-m1':['P6-01','P6-02'],
}
const checkpoints=[
 {afterInstallId:'school-p9-02',checkIds:['school-p9-04','school-p9-05']},
 {afterInstallId:'school-p10-02',checkIds:['school-p10-04']},
 {afterInstallId:'timetable-t3-03',checkIds:['timetable-t3-04']},
 {afterInstallId:'timetable-t4-01',checkIds:['timetable-t4-02']},
 {afterInstallId:'ai-p10-03',checkIds:['ai-p10-04']},
 {afterInstallId:'ai-p10-10',checkIds:['ai-p10-04','ai-p10-11']},
 {afterInstallId:'knowledge-k1-01',checkIds:['knowledge-k1-02']},
 {afterInstallId:'memory-m1-01',checkIds:['memory-m1-02','memory-m1-00','integration-int05']},
]
const nonempty=value=>typeof value==='string'&&Boolean(value.trim())

export function normalizeSqlBytes(bytes){
 assert(bytes instanceof Uint8Array,'SQL은 바이트로 읽어야 합니다')
 assert(!(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf),'SQL의 UTF-8 BOM을 허용하지 않습니다')
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes)
 assert(!text.includes('\u0000'),'SQL에 NUL이 있습니다')
 return Buffer.from(text.replace(/\r\n/g,'\n'),'utf8')
}
export function verifyDeployment({root=defaultRoot,inventory}={}){
 const absolute=realpathSync(root)
 function safe(path){
  assert(nonempty(path)&&!path.includes('\\')&&!path.includes(':')&&!path.startsWith('/')&&!path.split('/').some(part=>!part||part==='.'||part==='..'),'저장소 상대 경로만 허용합니다')
  const candidate=resolve(absolute,path),actual=realpathSync(candidate),local=relative(absolute,actual)
  assert(local&&!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep),'실제 파일 경로가 저장소 밖입니다')
  return candidate
 }
 const data=inventory??JSON.parse(readFileSync(safe(DEPLOYMENT_INVENTORY),'utf8'))
 assert.equal(data.version,1,'지원하지 않는 목록 판')
 assert.deepEqual({algorithm:data.hash?.algorithm,normalization:data.hash?.normalization},{algorithm:'sha256',normalization:'utf8-lf'},'원문 해시 규칙 변경')
 assert(nonempty(data.hash.description),'원문 정규화 경계를 설명해야 합니다')
 assert.equal(data.baseline?.liveDatabaseChecked,false,'운영 실조회로 표시하면 안 됩니다')
 assert.equal(data.baseline?.replayBaseline,false,'기존 적용 SQL 재실행 금지')
 assert.equal(data.baseline?.readOnlyCheckId,'baseline-t2-07')
 assert(nonempty(data.baseline.source)&&nonempty(data.baseline.note),'기준선 출처·한계 누락')
 for(const name of ['productionDbApplied','memberLinkingPerformed','automaticActivation','automaticDeployment','claudeReviewRequested'])assert.equal(data.execution?.[name],false,'보류 범위 변경: '+name)
 assert.deepEqual(data.pendingRoots,registry.map(row=>row[1]),'미적용 패키지 범위 누락·추가')
 assert(Array.isArray(data.packages)&&Array.isArray(data.files)&&Array.isArray(data.installOrder),'목록 모양이 잘못됐습니다')
 assert.deepEqual(data.packages.map(row=>[row.id,row.directory]),registry.map(row=>row.slice(0,2)),'패키지 식별/경로 불일치')
 const packages=new Map(data.packages.map(row=>[row.id,row])),files=new Map()
 for(const item of data.files){
  assert(nonempty(item.id)&&!files.has(item.id),'파일 ID 중복·누락')
  assert(Array.isArray(item.after)&&new Set(item.after).size===item.after.length,'선행 파일 중복·누락')
  assert(nonempty(item.notes),'파일별 영향·승인 설명 누락')
  safe(item.path)
  files.set(item.id,item)
 }
 assert.equal(new Set(data.files.map(item=>item.path)).size,data.files.length,'같은 원문 경로 중복')
 const expected=[]
 function sqlFiles(directory){
  const result=[]
  for(const item of readdirSync(safe(directory),{withFileTypes:true})){
   assert(!item.isSymbolicLink(),'SQL 폴더 안의 심볼릭 경로를 허용하지 않습니다')
   if(item.name==='test'&&item.isDirectory())continue
   const path=directory+'/'+item.name
   if(item.isDirectory())result.push(...sqlFiles(path))
   else if(item.name.endsWith('.sql')){safe(path);result.push(path)}
  }
  return result.sort()
 }
 for(const [id,directory,prefix,rules] of registry){
  const actual=sqlFiles(directory)
  const paths=[]
  for(const [number,kind] of Object.entries(rules)){
   const stem=prefix+'-'+number.padStart(2,'0')+'_',matching=actual.filter(path=>path.slice(directory.length+1).startsWith(stem))
   assert.equal(matching.length,1,'단계 원문은 하나여야 합니다: '+directory+'/'+stem)
   paths.push(matching[0]);expected.push([id+'-'+number.padStart(2,'0'),id,matching[0],kind,'pending'])
  }
  assert.deepEqual(actual,paths.sort(),'알려지지 않았거나 누락된 패키지 SQL: '+directory)
 }
 expected.push(...special)
 assert.equal(data.files.length,expected.length,'SQL 파일 개수 불일치')
 for(const [id,pkg,path,kind,phase] of expected){
  const item=files.get(id);assert(item,'필수 SQL 누락: '+id)
  assert.deepEqual([item.packageId,item.path,item.kind,item.phase],[pkg,path,kind,phase],'파일의 설치/점검/승인 분류 불일치: '+id)
  assert.match(item.sha256,/^[a-f0-9]{64}$/,'SHA-256 형식: '+id)
  assert.equal(createHash('sha256').update(normalizeSqlBytes(readFileSync(safe(item.path)))).digest('hex'),item.sha256,'SQL 원문 해시 불일치: '+id)
 }
 function acyclic(map,key){
  const done=new Set(),active=new Set()
  function visit(id){assert(map.has(id),'알 수 없는 선행 ID: '+id);if(done.has(id))return;assert(!active.has(id),'선행 의존성이 순환합니다');active.add(id);for(const next of map.get(id)[key])visit(next);active.delete(id);done.add(id)}
  for(const id of map.keys())visit(id)
 }
 for(const pkg of packages.values()){
  assert(Array.isArray(pkg.dependsOn)&&new Set(pkg.dependsOn).size===pkg.dependsOn.length,'패키지 의존성 형식 오류')
  assert(Array.isArray(pkg.installEffects)&&pkg.installEffects.length&&pkg.installEffects.every(nonempty),'설치 직후 영향 설명 누락')
 }
 acyclic(packages,'dependsOn');acyclic(files,'after')
 for(const pkg of packages.values()){
  assert.deepEqual(pkg.dependsOn,packageDependencies[pkg.id],'패키지 선행 설치 계약 불일치')
  assert.deepEqual(pkg.baselineRequires,baselineDependencies[pkg.id],'기존 기준선 의존성 누락·변경')
 }
 assert.deepEqual(data.installOrder,installation,'검증한 설치 순서가 바뀌었거나 승인/점검이 섞였습니다')
 for(let index=0;index<installation.length;index++){
  const id=installation[index],item=files.get(id)
  assert.equal(item.kind,'install','승인·점검 파일 자동 설치 금지')
  assert.equal(item.phase,'pending','기존 설치/보류 파일 재실행 금지')
  assert.deepEqual(item.after,[index?installation[index-1]:'baseline-t2-07'],'설치 선행 경계 불일치')
  for(const dep of packages.get(item.packageId).dependsOn){
   const dependency=installation.filter(value=>files.get(value).packageId===dep)
   assert(dependency.every(value=>installation.indexOf(value)<index),'패키지 선행 설치 순서 불일치')
  }
 }
 assert.deepEqual(data.preInstallChecks,prechecks,'사전 점검 순서 누락·변경')
 assert.deepEqual(data.checkpoints,checkpoints,'단계별 사후 점검 누락·변경')
 assert.equal(data.finalCheckId,'integration-int05');assert.deepEqual(files.get('integration-int05').after,installation,'최종 점검의 적용 범위 누락')
 assert(Array.isArray(data.deferredActions)&&data.deferredActions.length>=5,'보류 작업 설명 누락')
 return{inventory:data,counts:{packages:packages.size,files:files.size,installations:installation.length,checks:data.files.filter(row=>row.kind==='check').length,separateApprovals:data.files.filter(row=>row.kind==='approval').length,stops:data.files.filter(row=>row.kind==='stop').length},files:data.files,liveDatabaseChecked:false,executedSql:false}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const result=verifyDeployment();console.log(JSON.stringify({passed:true,...result.counts,hash:result.inventory.hash,liveDatabaseChecked:false,executedSql:false},null,2))}
 catch(error){console.error('배포 준비 목록 검사 실패:',error.message);process.exitCode=1}
}
