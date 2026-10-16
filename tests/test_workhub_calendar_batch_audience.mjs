import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const m = await loadBrowserModule(`
 export * from '../apps/workhub/src/calendar/batch-domain';
 export * from '../apps/workhub/src/calendar/batch-adapter';
 export * from '../apps/workhub/src/cooperation/protocol';
`)
const member = { id:'m1', schoolId:'s1', userId:'u1', name:'합성 교사', role:'teacher', active:true,
 validFrom:'2026-01-01', validThrough:'2027-12-31', departmentIds:[], gradeIds:[], subjectIds:[] }
const members = [member, ...['m-a','m-Z','m-2','m-10','m-_','m-가','m-\ue000','m-𐀀'].map((id,index)=>({ ...member,id,userId:'user-'+index }))]
const scope = { schoolId:'s1',memberId:'m1',ownerUserId:'u1' }
const env = () => ({ ok:true,contractVersion:'calendar-batch.v1',...scope })
const now = '2026-10-16T00:00:00Z'
const draft = () => ({ title:'교과 협의',description:'일정 설명',location:'회의실',startDate:'2026-10-20',endDate:'2026-10-20',
 allDay:true,startTime:'',endTime:'',visibility:'audience',audience:{ all:false,
 groups:[{departmentIds:['dept-a','dept-z'],gradeIds:['1','2'],subjectIds:[]}],
 includeMemberIds:['m-a','m-Z','m-2','m-10'],excludeMemberIds:['m-a','m-_'] } })
async function input(d=draft()) { return {sourceKey:'annual-2026',sourceLabel:'연간 계획',fileHash:'f'.repeat(64),omittedColumns:[],rows:[{
 key:'row-1',line:2,sourceId:'A-001',sourceHash:await m.sha256(m.canonical(d)),draft:structuredClone(d) }] } }
function preview(value,baseline=m.batchDraft(draft(),member,members),patch={}) {
 const sent=value.rows[0],state=m.canonical(sent.draft)===m.canonical(baseline)?'duplicate':'changed'
 return {...env(),prepareId:'prepare-1',previewHash:'b'.repeat(64),sourceKey:value.sourceKey,fileHash:value.fileHash,
  expiresAt:'2030-10-16T00:00:00Z',rows:[{key:sent.key,line:sent.line,sourceId:sent.sourceId,sourceHash:sent.sourceHash,
   state,reason:'',incoming:structuredClone(sent.draft),baseline:structuredClone(baseline),eventId:'event-1',expectedVersion:2,
   current:{...structuredClone(baseline),id:'event-1',schoolId:'s1',authorMemberId:'m1',version:2,updatedAt:now},...patch}]}
}
function connection(response) {
 const calls=[]
 return {calls,info:()=>({memberships:members,schools:[{id:'s1'}],basisDate:'2026-10-16'}),
 getIdentity:async()=>({userId:'u1',approved:true,profile:{id:'u1',role:'teacher',is_active:true,department_id:null,extra_permissions:[]}}),
 rpcVerified:async(name,args)=>{calls.push(structuredClone({name,args}));return response(name,args)} }
}
let count=0
const check=async(name,fn)=>{await fn();count++;console.log('  ✓ '+name)}
await check('대상 ID의 순서·중복만 정규화하고 원본과 조건 묶음·포함/제외 겹침은 보존한다',()=>{
 const original=draft();original.audience.includeMemberIds.push('m-a');original.audience.groups[0].departmentIds.reverse();const saved=structuredClone(original)
 const normalized=m.batchDraft(original,member,members)
 assert.deepEqual(normalized.audience.includeMemberIds,['m-10','m-2','m-Z','m-a'])
 assert.deepEqual(normalized.audience.excludeMemberIds,['m-_','m-a'])
 assert.deepEqual(original,saved);assert.deepEqual(normalized.audience.groups,original.audience.groups)
 assert.equal(normalized.audience.all,false);assert.ok(normalized.audience.includeMemberIds.includes('m-a'))
 assert.ok(normalized.audience.excludeMemberIds.includes('m-a'))
})
await check('로캘·UTF-16 대신 UTF-8 C 정렬과 같은 코드포인트 순서로 비교한다',()=>{
 const d=draft();d.audience.includeMemberIds=['m-𐀀','m-\ue000','m-가','m-a','m-Z','m-_']
 assert.deepEqual(m.batchDraft(d,member,members).audience.includeMemberIds,['m-Z','m-_','m-a','m-가','m-\ue000','m-𐀀'])
})
await check('격리 PostgreSQL의 실제 DISTINCT·COLLATE C 결과와 포함·제외 목록이 같다',async()=>{
 const db=new PGlite()
 try {
  const d=draft();d.audience.includeMemberIds=['m-𐀀','m-\ue000','m-가','m-a','m-Z','m-_','m-a']
  d.audience.excludeMemberIds=['m-a','m-Z','m-a']
  const normalized=m.batchDraft(d,member,members)
  for(const key of ['includeMemberIds','excludeMemberIds']) {
   const result=await db.query(`SELECT COALESCE(jsonb_agg(value ORDER BY value COLLATE "C"),'[]'::jsonb) ids
    FROM (SELECT DISTINCT value FROM jsonb_array_elements_text($1::jsonb)) ids`,[JSON.stringify(d.audience[key])])
   assert.deepEqual(normalized.audience[key],result.rows[0].ids)
  }
 } finally {await db.close()}
})
await check('새 비교의 원문 지문을 먼저 확인한 뒤 새 복사본의 대상·지문만 정규화한다',async()=>{
 const raw=await input(),before=structuredClone(raw),value=await m.validateBatchInput(raw,member,members)
 assert.deepEqual(raw,before);assert.notEqual(value.rows[0].sourceHash,raw.rows[0].sourceHash)
 assert.equal(value.rows[0].sourceHash,await m.sha256(m.canonical(value.rows[0].draft)))
 assert.equal(value.fileHash,raw.fileHash);assert.equal(value.rows[0].sourceId,raw.rows[0].sourceId)
 const sorted=await input(m.batchDraft(draft(),member,members))
 assert.deepEqual(value,await m.validateBatchInput(sorted,member,members))
})
await check('변조한 sourceHash를 정렬 과정에서 새 지문으로 덮어 통과시키지 않는다',async()=>{
 const raw=await input();raw.rows[0].sourceHash='a'.repeat(64)
 const c=connection(()=>{throw Error('전송하면 안 됨')}),adapter=m.createCalendarBatchAdapter(c)
 await assert.rejects(()=>adapter.prepare('m1',raw),/원문 지문/);assert.equal(c.calls.length,0)
})
await check('동일 일정의 직접 포함·제외 순서만 다른 재가져오기는 실제 prepare 전송 후 duplicate가 된다',async()=>{
 const raw=await input(),other=structuredClone(raw.rows[0].draft)
 other.audience.includeMemberIds.reverse();other.audience.excludeMemberIds.reverse()
 const c=connection((name,args)=>{assert.equal(name,'workhub_calendar_batch_prepare');return preview(args.p_input)})
 const adapter=m.createCalendarBatchAdapter(c)
 for(const value of [raw,await input(other)]) {
  const result=await adapter.prepare('m1',value)
  assert.equal(result.rows[0].state,'duplicate')
  assert.throws(()=>m.batchCommit(result,['row-1'],[]))
 }
 assert.deepEqual(c.calls[0].args.p_input,c.calls[1].args.p_input)
 assert.equal(c.calls.filter(call=>call.name.endsWith('_commit')).length,0)
})
await check('실제 대상·전체 선택·조건 묶음 차이는 changed로 남고 지문이 구별된다',async()=>{
 const base=m.batchDraft(draft(),member,members),baseHash=await m.sha256(m.canonical(base))
 for(const change of [d=>d.audience.includeMemberIds.pop(),d=>d.audience.excludeMemberIds.pop(),d=>d.audience.all=true,
  d=>d.audience.groups[0].gradeIds=['3'],d=>d.visibility='school']) {
  const d=draft();change(d)
  const c=connection((name,args)=>preview(args.p_input,base)),adapter=m.createCalendarBatchAdapter(c)
  const result=await adapter.prepare('m1',await input(d))
  assert.equal(result.rows[0].state,'changed');assert.notEqual(result.rows[0].sourceHash,baseHash)
 }
})
await check('서버 현재 일정의 순서 차이는 비교하되 실제 대상 변경을 duplicate로 위장하면 거부한다',async()=>{
 const value=await m.validateBatchInput(await input(),member,members),p=preview(value)
 p.rows[0].current.audience.includeMemberIds.reverse();p.rows[0].current.audience.excludeMemberIds.reverse()
 const raw=structuredClone(p)
 assert.equal(m.previewResponse(p,scope,value,member,members).rows[0].state,'duplicate')
 assert.deepEqual(p,raw)
 p.rows[0].current.audience.excludeMemberIds=[]
 assert.throws(()=>m.previewResponse(p,scope,value,member,members))
})
await check('예전 비교에서 이미 보낸 결과 미상 commit은 원래 지문·선택 순서·요청 번호를 그대로 재전송한다',async()=>{
 const raw=await input(),legacyHash=raw.rows[0].sourceHash
 const selections=[{key:'row-z',sourceId:'source-z',sourceHash:legacyHash,eventId:'event-z',expectedVersion:4,decision:'update'},
  {key:'row-a',sourceId:'source-a',sourceHash:'c'.repeat(64),eventId:null,expectedVersion:null,decision:'create'}]
 const command={kind:'calendar_batch_commit',prepareId:'legacy-prepare',previewHash:'d'.repeat(64),selections},before=structuredClone(command)
 let attempt=0
 const c=connection((name,args)=>{
  assert.equal(name,'workhub_calendar_batch_commit')
  if(attempt++===0)throw Error('이미 저장했지만 응답 유실')
  return {...env(),requestKey:args.p_request_key,prepareId:command.prepareId,previewHash:command.previewHash,outcome:'replayed',appliedAt:now,
   items:[{key:'row-z',sourceId:'source-z',eventId:'event-z',version:5},{key:'row-a',sourceId:'source-a',eventId:'event-new',version:1}]}
 })
 const adapter=m.createCalendarBatchAdapter(c)
 await assert.rejects(()=>adapter.commit('m1',command,'legacy-request'),e=>e.code==='SAVE_UNCERTAIN')
 // 다른 새 비교를 정규화해도 기존 쓰기 요청을 갱신하거나 다시 비교하지 않는다.
 await m.validateBatchInput(raw,member,members)
 assert.equal((await adapter.commit('m1',command,'legacy-request')).outcome,'replayed')
 assert.deepEqual(c.calls[0],c.calls[1]);assert.deepEqual(command,before)
 assert.deepEqual(c.calls[1].args.p_command,before);assert.equal(c.calls[1].args.p_request_key,'legacy-request')
 assert.equal(c.calls[1].args.p_command.selections[0].sourceHash,legacyHash)
 assert.notEqual(legacyHash,await m.sha256(m.canonical(m.batchDraft(raw.rows[0].draft,member,members))))
})
console.log(`일정 일괄 대상 정렬 ${count}건 통과`)
