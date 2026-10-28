import {readFileSync,writeFileSync,existsSync} from 'node:fs'
import {dirname,join,resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {spawnSync} from 'node:child_process'
import {build} from 'esbuild'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'
import {rpc} from './rpc.mjs'
import {publicationRanges} from './calendar.mjs'

// 공개 함수와 원래 앱 검증기를 거쳐 두 학기의 가명 시간표를 확정한다.
const secretPath=process.argv[2],root=dirname(secretPath),school=JSON.parse(readFileSync(join(root,'school.json')))
const bundle=join(root,'timetable-tools.mjs')
await build({stdin:{contents:`export * from './apps/workhub/src/timetable/preparation';export * from './apps/workhub/src/timetable/server';export * from './apps/workhub/src/timetable/operations-server';export * from './packages/timetable/src/cpSat';export * from './packages/timetable/src/validate';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:bundle,define:{'import.meta.env':'{}'}})
const tools=await import(pathToFileURL(resolve(bundle)).href),c=await connectSandbox(loadSecrets(secretPath))
const stateFile=join(root,'timetables.json'),state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile)):{}
const save=()=>writeFileSync(stateFile,JSON.stringify(state,null,2))
const call=async(name,args={})=>(await rpc(c,school.adminId,name,{p_member_id:school.adminMemberId,...args})).data
try {
 await assertMarker(c)
 for(const term of school.terms){
  const record=state[term.termNo]??={};save()
  const target=await call('workhub_timetable_target_get')
  if(target.termId!==term.id)await call('workhub_timetable_target_set',{p_input:{termId:term.id,expectedVersion:target.version},p_request_key:`sandbox-term-${term.termNo}-${target.version}`,p_recover_only:false})
  if(!record.basis){
   const source=tools.preparationSource(await call('workhub_timetable_preparation_get'),school.schoolId)
   const counts=[6,7,6,7,6],starts=[540,595,650,705,810,865,920]
   const slots=counts.flatMap((count,d)=>Array.from({length:count},(_,p)=>({id:`D${d+1}P${p+1}`,day:d+1,label:`${p+1}교시`,startMinute:starts[p],endMinute:starts[p]+45,periods:1})))
   const draft={title:`가상 ${term.termNo}학기 · 자료 시수 기반`,slots,plans:source.courses.map(course=>{
    const load=school.courses.find(x=>x.id===course.id);if(!load)throw new Error('시수 원본 없음')
    return {courseId:course.id,weeklyPeriods:load.periods,blocks:Array.from({length:load.periods},(_,n)=>({id:`L_${course.id}_${n+1}`,periods:1,allowedSlotIds:slots.map(s=>s.id)}))}
   })}
   const input={kind:'confirm',sourceRevision:source.sourceRevision,sourceFingerprint:source.sourceFingerprint,termId:term.id,draftId:source.savedDraft?.id??null,expectedDraftRevision:source.savedDraft?.revision??null,draft}
   tools.preparationInput(input,source)
   const key=`sandbox-basis-${term.termNo}`,receipt=await call('workhub_timetable_preparation_execute',{p_input:input,p_request_key:key,p_recover_only:false})
   tools.preparationReceipt(receipt,input,key,source);record.basis=receipt.basis;record.lastDay=source.lastDay;save();console.log('기준판 확정',term.termNo,record.basis.lessons.length)
  }
  if(!record.placements){
   const request=await tools.buildCpSatRequest(record.basis,`sandbox-solve-${term.termNo}`,null,{maxSeconds:120,maxCandidates:1,seed:2027,minimizeChanges:false,improveTeacherBalance:false,spreadCourses:false})
   const input=join(root,`solve-${term.termNo}.json`),output=join(root,`result-${term.termNo}.json`)
   writeFileSync(input,JSON.stringify(request))
   if(!existsSync(output)){
    const result=spawnSync(process.env.TIMETABLE_PYTHON??process.env.PYTHON??'python',['packages/timetable/engine/runner.py','--input',input,'--output',output],{encoding:'utf8',timeout:180000,windowsHide:true,env:{...process.env,PYTHONUTF8:'1'}})
    if(result.status!==0)throw new Error('시간표 엔진 실패 '+result.stderr.slice(-2000))
   }
   const response=await tools.parseCpSatResponse(request,JSON.parse(readFileSync(output)))
   if(response.status!=='feasible')throw new Error('시간표 유효 해 없음: '+response.status)
   record.placements=response.candidates[0].placements;record.solve=response.stats;save();console.log('독립 검증 통과',term.termNo,record.placements.length)
  }
  if(!record.draft){
   const b=record.basis,input={basisId:b.id,basisRevision:b.revision,sourceFingerprint:b.sourceFingerprint,title:`가상 ${term.termNo}학기 확정 시간표`,conditions:{fixed:b.fixed,unavailable:b.unavailable,preferences:b.preferences},placements:record.placements}
   tools.timetableSaveInput(input,b)
   const key=`sandbox-save-${term.termNo}`,receipt=await call('workhub_timetable_save_draft',{p_input:input,p_request_key:key,p_recover_only:false})
   tools.timetableReceipt(receipt,input,key);record.draft=receipt;save()
  }
  record.publications??=[]
  // 한 번에 2주씩 실제 서버가 검증·공개한다. 결과가 끊긴 명령은 원키로 복구한다.
  for(const {from,until} of publicationRanges(term.firstDay,record.lastDay)){
   if(!record.publications.some(p=>p.from===from&&p.until===until)){
    const input={draftId:record.draft.draftId,draftVersion:record.draft.version,from,until},key=`sandbox-publish-v2-${term.termNo}-${from}`
    let command=record.pending?.key===key?record.pending.command:null,receipt
    if(command)receipt=await call('workhub_timetable_operations_execute',{p_command:command,p_request_key:key,p_recover_only:true})
    else {
     const raw=await call('workhub_timetable_operations_publish_preview',{p_input:input})
     const preview=tools.parsePublishPreview(raw,input,'Asia/Seoul',Date.now())
     if(!preview.changes.length&&preview.blockers.every(b=>b.code==='NO_CHANGES')){record.publications.push({from,until,unchanged:true});save();continue}
     if(preview.blockers.length)throw new Error('공개 차단 '+JSON.stringify(preview.blockers))
     command=tools.publishCommand(preview);record.pending={key,command};save()
     receipt=await call('workhub_timetable_operations_execute',{p_command:command,p_request_key:key,p_recover_only:false})
    }
    record.publications.push({from,until,receipt});delete record.pending;save();console.log('날짜별 공개',term.termNo,from,until)
   }
  }
 }
 const target=await call('workhub_timetable_target_get')
 if(target.selectedTermId!==null)await call('workhub_timetable_target_set',{p_input:{termId:null,expectedVersion:target.version},p_request_key:`sandbox-term-auto-${target.version}`,p_recover_only:false})
 console.log('두 학기 편성·날짜별 공개 완료')
} finally {await c.end()}
