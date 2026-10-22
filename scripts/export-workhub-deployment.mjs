// 검토 자료만 복사한다. SQL 실행·배포·키 조회·승인 양식 채우기를 하지 않는다.
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {dirname,join,resolve,relative,isAbsolute,sep} from 'node:path'
import {fileURLToPath} from 'node:url'
import {execFileSync} from 'node:child_process'
import {normalizeSqlBytes,verifyDeployment} from './check-workhub-sql-package.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const groups={install:'01-install',check:'02-check',approval:'03-approval-only',stop:'04-stop-only'}
const documentation=['docs/workhub/deployment-preparation/README.md','docs/workhub/deployment-preparation/runbook.md','docs/workhub/deployment-preparation/verification.md','docs/workhub/deployment-preparation/sql-inventory.json','database/workhub-deployment/integration/README.md','database/workhub-deployment/integration/test/RESULTS.md']
export function createDeploymentPackage({sourceRoot=root,outputParent=tmpdir()}={}){
 const checked=verifyDeployment({root:sourceRoot}),base=realpathSync(sourceRoot),parent=realpathSync(outputParent)
 // 판정 실패 때 빈 배포 폴더조차 만들지 않는다.
 const output=mkdtempSync(join(parent,'workhub-deployment-review-')),entries=[]
 function owned(path){const full=realpathSync(join(base,path)),inside=relative(base,full);if(inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))throw new Error('저장소 밖의 파일은 배포 묶음에 넣지 않습니다.');return full}
 for(const item of checked.inventory.files){
  if(!groups[item.kind])throw new Error('분류되지 않은 SQL은 내보낼 수 없습니다: '+item.id)
  const area=item.phase==='baseline'?'00-baseline-read-only':item.phase==='deferred'?'05-deferred':groups[item.kind]
  const path=area+'/'+item.path,target=join(output,path),bytes=normalizeSqlBytes(readFileSync(owned(item.path)))
  const sha256=createHash('sha256').update(bytes).digest('hex')
  if(sha256!==item.sha256)throw new Error('검증 뒤 SQL 원문이 바뀌었습니다: '+item.id)
  mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes)
  entries.push({id:item.id,path,kind:item.kind,phase:item.phase,sha256})
 }
 for(const path of documentation){const target=join(output,path);mkdirSync(dirname(target),{recursive:true});copyFileSync(owned(path),target)}
 writeFileSync(join(output,'sql-inventory.json'),JSON.stringify(checked.inventory,null,2)+'\n')
 let sourceCommit=null,workingTreeClean=false
 try{sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:base,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();workingTreeClean=!execFileSync('git',['status','--porcelain'],{cwd:base,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()}catch{/* Git 메타데이터가 없는 사본은 원본 커밋 미확인으로 표시한다. */}
 const manifest={kind:'review_only_not_approved',sourceCommit,workingTreeClean,sqlHashNormalization:'utf8-lf',productionDbApplied:false,realMembersLinked:false,files:entries}
 writeFileSync(join(output,'package-manifest.json'),JSON.stringify(manifest,null,2)+'\n')
 writeFileSync(join(output,'SHA256SUMS'),entries.map(row=>row.sha256+'  '+row.path).join('\n')+'\n')
 writeFileSync(join(output,'README.txt'),[
  '학교업무혁신시스템 검토용 배포 자료 — 실행 승인 아님',
  'SQL을 자동 실행하는 도구나 운영 접속 정보는 포함하지 않습니다.',
  '00: 기존 기준선 읽기 전용 / 01: 미적용 설치 / 02: 점검 / 03: 별도 승인 / 04: 중지 양식 / 05: 보류',
  '폴더 번호나 파일명 정렬로 실행하지 마세요. sql-inventory.json의 installOrder와 단계별 checkpoints, runbook이 기준입니다.',
  '승인·회원 연결·기능 켜기·중지 양식은 설치 순서에 포함되지 않습니다. 모든 입력 칸은 원문 그대로입니다.',
  'SQL은 UTF-8, LF로 내보냈습니다. SHA256SUMS는 이 묶음 파일의 실제 바이트 해시입니다.',
  '문서와 inventory의 저장소 경로는 package-manifest.json의 path에 분류 폴더를 붙인 경로로 대응됩니다.',
  '실제 설치 전 운영 기준선과 이미 적용한 단계부터 확인하고, 사용자가 승인한 파일만 한 단계씩 처리합니다.',
  'AI 정책 SQL은 설치만으로 기존 AI 경로에 영향을 줍니다. 앱/키/회원 연결과 같은 전환 작업으로 준비해야 합니다.',
  '실제 DB 적용·회원 연결·Claude 최종 검토는 별도로 남아 있습니다.',
 ].join('\n')+'\n')
 return{output,manifest,counts:checked.counts}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2)
 if(args.length&&!(args.length===2&&args[0]==='--output-parent'))throw new Error('--output-parent 기존폴더만 지정할 수 있습니다. SQL 실행 옵션은 없습니다.')
 const result=createDeploymentPackage({outputParent:args[1]?resolve(args[1]):tmpdir()})
 console.log(JSON.stringify({output:result.output,counts:result.counts,kind:result.manifest.kind,productionDbApplied:false},null,2))
}
