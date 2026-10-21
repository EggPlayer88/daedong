import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const {api,create}=await loadBrowserModule(`import * as api from '../apps/workhub/src/knowledge/contracts';export{api};export{createKnowledgeService as create}from'../apps/workhub/src/knowledge/adapter'`)
const member={id:'reader',schoolId:'school',userId:'user',name:'가상 교사',role:'teacher',active:true,validFrom:'2020-01-01',validThrough:'2099-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const source={id:'source',schoolId:'school',authorMemberId:'author',version:2,status:'published',title:'과거 규정',kind:'regulation',body:'과거 본문',locator:'제3조',effectiveFrom:'2020-03-01',effectiveThrough:'',updatedAt:'2026-10-01T00:00:00Z'}
const revision={source,isCurrent:false,canManage:false}
const item=v=>({version:v,status:'published',title:'규정 '+v,recordedAt:'2026-10-01T00:00:00Z',isCurrent:false})
const history={sourceId:'source',authorMemberId:'author',items:[item(2),item(1)],nextBeforeVersion:null,canManage:false}
let count=0
async function test(name,run){await run();count++;console.log('  ✓ '+name)}
function setup(data){let current=member,user='user';const calls=[];const connection={info:()=>({memberships:[current],schools:[{id:'school'}],basisDate:'2026-10-21'}),getIdentity:async()=>({userId:user,approved:true}),rpcVerified:async(name,args)=>{calls.push({name,args});return{contract:'knowledge.v1',schoolId:'school',memberId:'reader',data}}};return{connection,calls,service:create(connection),setMember:v=>current=v,setUser:v=>user=v}}
await test('과거 판은 요청 ID·판에 정확히 맞아야 읽는다',()=>{assert.deepEqual(api.knowledgeRevision(revision,member,'source',2),revision);for(const patch of [{id:'other'},{version:3},{schoolId:'other'}])assert.throws(()=>api.knowledgeRevision({...revision,source:{...source,...patch}},member,'source',2))})
await test('최신 여부·관리권한·초안 권한은 생략하거나 위조하지 못한다',()=>{for(const patch of [{isCurrent:null},{canManage:null},{extra:1}])assert.throws(()=>api.knowledgeRevision({...revision,...patch},member,'source',2));assert.throws(()=>api.knowledgeRevision({...revision,source:{...source,status:'draft'}},member,'source',2));assert.equal(api.knowledgeRevision({...revision,source:{...source,status:'draft'},canManage:true},member,'source',2).source.status,'draft')})
await test('판 목록은 ID·학교 범위와 내림차순·50건·배타적 커서를 확인한다',()=>{assert.deepEqual(api.knowledgeHistory(history,member,'source',null),history);for(const patch of [{sourceId:'other'},{items:[item(1),item(2)]},{items:[item(2),item(2)]},{items:Array.from({length:51},(_,i)=>item(51-i))},{nextBeforeVersion:1}])assert.throws(()=>api.knowledgeHistory({...history,...patch},member,'source',null));assert.throws(()=>api.knowledgeHistory(history,member,'source',2))})
await test('50판 페이지 끝만 다음 커서이며 최신 표시는 첫 페이지 첫 판만 가능하다',()=>{const rows=Array.from({length:50},(_,i)=>item(100-i));assert.equal(api.knowledgeHistory({...history,items:rows,nextBeforeVersion:51},member,'source',null).nextBeforeVersion,51);assert.throws(()=>api.knowledgeHistory({...history,items:rows,nextBeforeVersion:50},member,'source',null));assert.throws(()=>api.knowledgeHistory({...history,items:[{...item(2),isCurrent:true}]},member,'source',3));assert.throws(()=>api.knowledgeHistory({...history,items:[item(2),{...item(1),isCurrent:true}]},member,'source',null))})
await test('다른 작성자 초안의 제목도 이력에서 노출하지 않는다',()=>{assert.throws(()=>api.knowledgeHistory({...history,items:[{...item(1),status:'draft'}]},member,'source',null));assert.equal(api.knowledgeHistory({...history,authorMemberId:member.id,items:[{...item(1),status:'draft'}]},member,'source',null).items.length,1)})
await test('get·history RPC에는 정확한 ID·판·커서만 보내고 목록 대체 호출이 없다',async()=>{const x=setup(revision);assert.deepEqual(await x.service.get('reader','source',2),revision);assert.deepEqual(x.calls,[{name:'workhub_knowledge_get',args:{p_member_id:'reader',p_source_id:'source',p_source_version:2}}]);const y=setup(history);await y.service.history('reader','source',3);assert.equal(y.calls[0].args.p_before_version,3)})
await test('전송 전 잘못된 판·커서는 입력 오류로 처리하고 서버를 부르지 않는다',()=>{const x=setup(revision);for(const v of [0,-1,1.1,2147483648]){assert.throws(()=>x.service.get('reader','source',v),e=>e.code==='INVALID_INPUT');assert.throws(()=>x.service.history('reader','source',v),e=>e.code==='INVALID_INPUT')}assert.equal(x.calls.length,0)})
await test('미설치·권한 거절은 원문을 빈 성공이나 최신 판으로 바꾸지 않는다',async()=>{for(const code of ['NOT_READY','NOT_FOUND']){const x=setup(revision);x.connection.rpcVerified=async()=>({contract:'knowledge.v1',schoolId:'school',memberId:'reader',error:{code}});await assert.rejects(()=>x.service.get('reader','source',2),e=>e.code===code);assert.equal(x.calls.length,0)}})
await test('조회 중 계정·역할 범위가 바뀌면 늦은 원문을 폐기한다',async()=>{for(const changed of ['user','role']){const x=setup(revision);x.connection.rpcVerified=async()=>{if(changed==='user')x.setUser('other');else x.setMember({...member,role:'school_admin'});return{contract:'knowledge.v1',schoolId:'school',memberId:'reader',data:revision}};await assert.rejects(()=>x.service.get('reader','source',2),e=>e.code==='CANCELLED')}})
if(process.env.KNOWLEDGE_HISTORY_CAPTURE){
 const captures=JSON.parse(readFileSync(process.env.KNOWLEDGE_HISTORY_CAPTURE,'utf8'))
 for(const c of captures)await test('격리 PG17 실제 응답: '+c.name,()=>{
  const m={...member,id:c.memberId,schoolId:c.schoolId}
  const parsed=c.kind==='get'?api.knowledgeRevision(c.raw.data,m,c.sourceId,c.version):api.knowledgeHistory(c.raw.data,m,c.sourceId,c.before)
  assert.deepEqual(parsed,c.raw.data)
 })
}
console.log('학교 자료 과거 판 계약 '+count+'건 통과')
