import assert from 'node:assert/strict'
import {neisDatabase} from './helpers/neis-db.mjs'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule("export * from '../apps/workhub/src/neis/contracts'")
const {db,uid,year,member,value,as,before}=await neisDatabase()
let count=0
const ck=async(name,fn)=>{await fn();count++;console.log('  ✓ '+name)}
const a=year+'-03-01',b=(year+1)+'-02-28',school=member.school_id,mid=member.id
const context=await as('authenticated',()=>value('workhub_context')),members=context.memberships,actor=members.find(x=>x.id===mid),r={kind:'schedule',year,from:a,to:b}
const status=()=>as('authenticated',()=>value('workhub_neis_status',[mid,'schedule',year,a,b]))
const item=(patch={})=>({identity:'a'.repeat(64),contentHash:'b'.repeat(64),loadedOn:a,date:year+'-11-20',title:'합성 학사일정',content:'학사 내용',grades:[1,2,3],dayKind:'해당없음',course:'중학교',session:'주간',...patch})
async function update(items,error=null){
 await db.query("UPDATE neis_private.datasets SET attempted_at=now()-interval '1 hour',lease_until=now()-interval '1 minute'")
 const claim=await as('service_role',()=>value('workhub_neis_claim',[school,'schedule',year,a,b]))
 return as('service_role',()=>value('workhub_neis_finish',[school,'schedule',year,a,b,claim.leaseId,items,error]))
}
const selected=s=>({id:s.id,version:s.version,decision:'apply',eventId:s.eventId,eventVersion:s.current?.version??null,replaces:null,overwrite:false})
const apply=(selections,key)=>as('authenticated',()=>value('workhub_neis_apply',[mid,selections,key]))
try{
 await ck('기존 R0 public·내부 함수 원문을 변경하지 않는다',async()=>{
 const after=(await db.query("SELECT md5(string_agg(pg_get_functiondef(p.oid),'' ORDER BY p.oid)) hash FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('workhub_private','public') AND p.proname NOT LIKE 'workhub_neis_%'")).rows[0].hash
 assert.equal(before,after)
 })
 await ck('API 역할의 표 직접 접근·익명·서비스 함수 오용을 거부한다',async()=>{
 for(const role of ['anon','authenticated','service_role'])await assert.rejects(as(role,()=>db.query('SELECT * FROM neis_private.connections')),/permission denied/)
 await assert.rejects(as('anon',()=>value('workhub_neis_status',[mid,'schedule',year,a,b])),/permission denied/)
 await assert.rejects(as('authenticated',()=>value('workhub_neis_claim',[school,'schedule',year,a,b])),/permission denied/)
 await assert.rejects(as('service_role',()=>value('workhub_neis_status',[mid,'schedule',year,a,b])),/permission denied/)
 })
 await ck('나이스 저장은 기존 일정에 쓰지 않고 완전한 비교 자료만 만든다',async()=>{
 await update([item()]);assert.equal((await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n,0)
 const s=await status();assert.equal(m.snapshot(s,r,actor,members).rows.length,1)
 })
 await ck('같은 범위 재조회는 임대·30분 제한으로 외부 호출을 중복하지 않는다',async()=>{
 const c=await as('service_role',()=>value('workhub_neis_claim',[school,'schedule',year,a,b]));assert.equal(c.leaseId,null)
 await assert.rejects(value('workhub_neis_finish',[school,'schedule',year,a,b,'00000000-0000-4000-8000-000000000001',[],null]),/CONFLICT/)
 })
 let row=(await status()).rows[0],choice=selected(row),receipt
 await ck('명시 반영은 기존 일정 저장 함수·접수증을 사용하고 앱 parser와 일치한다',async()=>{
 receipt=await apply([choice],'first-request')
 assert.equal(m.receipt(receipt,'first-request',[choice],actor,members).items.length,1)
 assert.equal(receipt.items[0].event.title,item().title);assert.equal(receipt.items[0].event.visibility,'school')
 })
 await ck('응답 유실 재전송은 같은 접수증이고 다른 내용 재사용은 거부한다',async()=>{
 assert.deepEqual(await apply([choice],'first-request'),receipt)
 await assert.rejects(apply([{...choice,overwrite:true}],'first-request'),/IDEMPOTENCY_CONFLICT/)
 assert.equal((await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n,1)
 })
 let current=receipt.items[0].event
 await ck('원본이 같으면 사이트에서 고친 제목·시간·장소를 보존한다',async()=>{
 const local={...current,title:'담당자가 정한 제목',location:'회의실',allDay:false,startTime:'10:00',endTime:'11:00'};for(const key of ['id','schoolId','authorMemberId','version','updatedAt'])delete local[key]
 current=await as('authenticated',()=>value('workhub_calendar_save',[mid,{id:current.id,expectedVersion:current.version,idempotencyKey:'local-edit',draft:local}]))
 await update([item()]);row=(await status()).rows[0];assert.equal(m.comparison(row).state,'same')
 const next=await apply([selected(row)],'keep-local-request');assert.equal(next.items[0].event.title,local.title);assert.equal(next.items[0].event.location,'회의실');assert.equal(next.items[0].event.startTime,'10:00')
 })
 await ck('나이스와 사이트가 같은 설명을 각각 수정하면 충돌하고 자료가 그대로다',async()=>{
 row=(await status()).rows[0];current=row.current;const local={...current,description:'담당자 메모'};for(const k of ['id','schoolId','authorMemberId','version','updatedAt'])delete local[k]
 await as('authenticated',()=>value('workhub_calendar_save',[mid,{id:current.id,expectedVersion:current.version,idempotencyKey:'local-description',draft:local}]))
 await update([item({content:'나이스 변경',contentHash:'c'.repeat(64)})]);row=(await status()).rows[0]
 assert.ok(m.comparison(row).conflicts.includes('description'))
 await assert.rejects(apply([selected(row)],'conflict-request'),/CONFLICT/)
 assert.equal((await status()).rows[0].current.description,'담당자 메모')
 const result=await apply([{...selected(row),overwrite:true}],'confirmed-conflict');assert.match(result.items[0].event.description,/나이스 변경/);assert.equal(result.items[0].event.title,'담당자가 정한 제목');assert.equal(result.items[0].event.startTime,'10:00')
 })
 await ck('중간 통신 실패와 잘못된 중복 응답은 마지막 성공 자료를 유지한다',async()=>{
 const before=await status();await update(null,'UPSTREAM_UNAVAILABLE');const after=await status()
 assert.deepEqual(after.rows,before.rows);assert.equal(after.version,before.version);assert.equal(after.errorCode,'UPSTREAM_UNAVAILABLE')
 await assert.rejects(update([item(),item()]),/INVALID_INPUT/)
 })
 await ck('원본 누락은 삭제하지 않고 새 날짜·제목은 관리자 연결로 같은 일정에 반영한다',async()=>{
 await update([item({identity:'d'.repeat(64),contentHash:'e'.repeat(64),date:year+'-11-21',title:'날짜 바뀐 행사'})])
 const rows=(await status()).rows,old=rows.find(x=>!x.present),next=rows.find(x=>x.present)
 assert.equal(rows.length,2);assert.ok(old.current)
 const result=await apply([{...selected(next),eventId:old.eventId,eventVersion:old.current.version,replaces:old.id,overwrite:true}],'relink-request')
 assert.equal(result.items[0].event.id,old.eventId);assert.equal(result.items[0].event.startDate,year+'-11-21')
 assert.equal((await status()).rows.length,1);assert.equal((await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n,1)
 })
 await ck('이전에 다른 원본으로 연결한 일정이 원래 이름으로 돌아오면 다시 비교할 수 있다',async()=>{
 await update([item()])
 const rows=(await status()).rows,old=rows.find(x=>!x.present),returned=rows.find(x=>x.present)
 assert.equal(rows.length,2);assert.equal(returned.data.title,item().title);assert.ok(old.eventId)
 const result=await apply([{...selected(returned),eventId:old.eventId,eventVersion:old.current.version,replaces:old.id,overwrite:true}],'relink-back-request')
 assert.equal(result.items[0].event.id,old.eventId);assert.equal((await status()).rows.length,1)
 })
 await ck('같은 내용으로 먼저 등록된 일정은 덮어쓰기 승인 없이 연결한다',async()=>{
 const same=item({identity:'9'.repeat(64),contentHash:'8'.repeat(64),title:'기존 같은 행사'})
 const existing=await as('authenticated',()=>value('workhub_calendar_save',[mid,{id:null,expectedVersion:null,idempotencyKey:'existing-identical',draft:m.incoming(same)}]))
 await update([item(),same]);const source=(await status()).rows.find(s=>s.data.identity===same.identity)
 const target={...selected(source),eventId:existing.id,eventVersion:existing.version}
 assert.deepEqual(m.comparison(source,existing).conflicts,[])
 const result=await apply([target],'link-identical-request');assert.equal(result.items[0].event.id,existing.id)
 })
 await ck('범위·타인 소속·오래된 판·null 결정값을 차단한다',async()=>{
 await assert.rejects(as('authenticated',()=>value('workhub_neis_status',['other','schedule',year,a,b])),/INACTIVE_MEMBERSHIP/)
 await assert.rejects(as('service_role',()=>value('workhub_neis_claim',[school,'timetable',year,a,b])),/INVALID_INPUT/)
 row=(await status()).rows[0]
 for(const patch of [{version:0},{version:'1'},{decision:null},{overwrite:null},{eventVersion:'1'}])await assert.rejects(apply([{...selected(row),...patch}],'invalid-request'),/INVALID_INPUT/)
 await assert.rejects(apply([{...selected(row),version:9999}],'old-version-request'),/CONFLICT/)
 })
 await ck('새 일정 중복·일괄 일부 실패는 전체 반영을 되돌린다',async()=>{
 await update([item({identity:'1'.repeat(64),title:'중복 검사',contentHash:'2'.repeat(64)}),item({identity:'3'.repeat(64),title:'중복 검사',contentHash:'4'.repeat(64)})])
 const rows=(await status()).rows.filter(x=>x.present)
 const before=(await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n
 await assert.rejects(apply(rows.map(selected),'duplicate-batch'),/CONFLICT/)
 assert.equal((await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n,before)
 })
 await ck('누락 보류는 확인 목록에서 끝나며 다시 나타난 원본은 재확인을 요구한다',async()=>{
 await update([]);let s=(await status()).rows.find(x=>!x.present)
 await apply([{...selected(s),decision:'ignore'}],'ignore-missing-request')
 s=(await status()).rows.find(x=>x.id===s.id);assert.equal(m.comparison(s).state,'ignored')
 await update([s.data]);s=(await status()).rows.find(x=>x.id===s.id)
 assert.equal(s.present,true);assert.equal(s.dismissed,false)
 })
 await ck('원본 중지 후 기존 접수증 복구는 가능하고 새 저장은 막힌다',async()=>{
 await db.query('UPDATE neis_private.connections SET active=false')
 assert.deepEqual(await apply([choice],'first-request'),receipt)
 await assert.rejects(apply([choice],'disabled-request'),/FORBIDDEN/)
 assert.equal((await status()).rows.length,0)
 })
 await ck('닫기와 늦게 도착한 원 명령은 둘 중 하나로 끝나며 같은 번호 복구를 보존한다',async()=>{
 const closed=await as('authenticated',()=>value('workhub_neis_close',[mid,[choice],'abandoned-request']))
 assert.equal(m.closed(closed,'abandoned-request',[choice],actor,members).outcome,'closed')
 await assert.rejects(apply([choice],'abandoned-request'),/CONFLICT/)
 assert.deepEqual(await as('authenticated',()=>value('workhub_neis_close',[mid,[choice],'abandoned-request'])),closed)
 const applied=await as('authenticated',()=>value('workhub_neis_close',[mid,[choice],'first-request']))
 assert.deepEqual(m.closed(applied,'first-request',[choice],actor,members).receipt,receipt)
 })
 await ck('사후 점검이 RLS·역할별 실행권한·검색경로를 확인한다',async()=>{
 const rows=(await db.query((await import('node:fs')).readFileSync(new URL('../database/workhub-neis/n1/N1-02_사후점검.sql',import.meta.url),'utf8'))).rows
 assert.ok(rows.every(x=>x.status==='ok'||x.status==='info'),JSON.stringify(rows));assert.equal(rows.length,9)
 })
 console.log('전부 통과 ('+count+')')
}catch(e){console.error(e.message,e.detail??'',e.where??'');process.exitCode=1}finally{await db.close()}
