import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const api = await loadBrowserModule(`
export * from '../apps/workhub/src/timetable/import-contracts'
export * from '../apps/workhub/src/timetable/import-csv'
export * from '../apps/workhub/src/timetable/import-server'
export * from '../apps/workhub/src/timetable/import-workbook'
export * from '../apps/workhub/src/timetable/pilot/fixture'
`)
const source = () => ({
  schoolId:'school',schoolLevel:'middle',termId:'term',termLabel:'1학기',firstDay:'2027-03-01',lastDay:'2027-08-12',sourceRevision:1,sourceFingerprint:'a'.repeat(64),
  canEdit:true,canConfirm:true,resources:[{id:'teacher',kind:'teacher',label:'교사',capacity:1},{id:'class',kind:'class',label:'학급',capacity:1},{id:'room',kind:'room',label:'교실',capacity:1}],
  courses:[{id:'course',label:'국어',requiredPeriods:1,resourceIds:['teacher','class','room']}],unsupportedFeatures:[],savedDraft:null,
})
const csv = (rows=['lesson,course,1,1교시,09:00,09:45,1,teacher,class,room']) => ['lessonId,courseId,day,label,start,end,periods,teacherIds,classIds,roomIds',...rows].join('\n')
const review = text => api.reviewTimetableImport(source(), text, '1학기 입력')
const command = async () => ({previewId:'preview',fingerprint:'b'.repeat(64),input:await review(csv())})
const receipt = (c,key) => ({requestKey:key,previewId:c.previewId,termId:'term',basisId:'basis',basisRevision:1,draftId:'draft',draftVersion:1,lessonCount:1,recordedAt:'2026-10-20T12:00:00Z',published:false})
let count=0
async function test(name, fn) { await fn(); count++; console.log('  ✓ '+name) }
await test('명시 ID 연결과 CSV 배치를 준비 기준판·초안으로 변환',async()=>{
 const value=await review(csv());assert.equal(value.preparation.kind,'confirm');assert.equal(value.placements.length,1)
 assert.equal(value.preparation.draft.plans[0].weeklyPeriods,1);assert.equal(value.fileHash.length,64)
})
await test('교사와 공간의 이름이 같아도 ID로만 매칭',async()=>{
 await assert.rejects(review(csv(['lesson,course,1,1교시,09:00,09:45,1,교사,class,room'])))
 await assert.rejects(review(csv(['lesson,course,1,1교시,09:00,09:45,1,room,class,teacher'])))
})
await test('일부 수업만 가져와 기존 시수를 누락시키지 않음',async()=>{
 const s=source();s.courses.push({...s.courses[0],id:'second'});await assert.rejects(api.reviewTimetableImport(s,csv(),'전체'))
})
await test('시수·시각·요일·중복 활동·참조 없는 수업 거부',async()=>{
 for(const row of [
  'lesson,course,1,1교시,09:00,09:45,2,teacher,class,room',
  'lesson,course,1,1교시,09:00,08:45,1,teacher,class,room',
  'lesson,course,1,1교시,24:00,24:00,1,teacher,class,room',
  'lesson,course,8,1교시,09:00,09:45,1,teacher,class,room',
  'lesson,missing,1,1교시,09:00,09:45,1,teacher,class,room',
 ])await assert.rejects(review(csv([row])))
 await assert.rejects(review(csv(['lesson,course,1,1교시,09:00,09:45,1,teacher,class,room','lesson,course,2,1교시,09:00,09:45,1,teacher,class,room'])))
})
await test('다른 수업의 교사·학급 동시 배치 충돌 검출',async()=>{
 const s=source();s.courses.push({...s.courses[0],id:'second'})
 await assert.rejects(api.reviewTimetableImport(s,csv(['a,course,1,1교시,09:00,09:45,1,teacher,class,room','b,second,1,1교시,09:00,09:45,1,teacher,class,room']),'충돌'))
})
await test('학교 양식은 공식 ID를 포함하고 가상 배치는 실제 ID를 채우지 않음',async()=>{
 const template=await api.timetableImportTemplate(source());assert.match(template,/"teacher","class","room"/)
 const pilot=api.timetableImportPilotTemplate(api.getPilotFixture());assert.equal(pilot.split('\r\n').length,280)
 assert.match(pilot.split('\r\n')[1],/,"",/);assert.ok(!pilot.includes('registered-reference'))
})
await test('수업 순서가 바뀌거나 긴 ID여도 활동 ID는 안정적으로 유지',async()=>{
 const s=source();s.courses.push({...s.courses[0],id:'x'.repeat(100)})
 const a=await api.timetableImportTemplate(s),b=await api.timetableImportTemplate({...s,courses:[...s.courses].reverse()})
 assert.deepEqual(a.split('\r\n').slice(1).sort(),b.split('\r\n').slice(1).sort())
 assert.ok(a.split('\r\n').slice(1).every(row=>row.split(',')[0].length<100))
})
await test('자료가 바뀌면 기존 공식 연결과 다른 가져오기 거부',async()=>{
 const s=source();s.resources.push({id:'new-teacher',kind:'teacher',label:'새 교사',capacity:1});s.courses[0].resourceIds=['new-teacher','class','room']
 await assert.rejects(api.reviewTimetableImport(s,csv(),'이전 배치'))
})
await test('수업 초안 접수증을 공개 완료로 위조하면 거부',async()=>{
 const c=await command(),r=receipt(c,'request-0001')
 assert.deepEqual(api.timetableImportReceipt(r,c,'request-0001'),r)
 for(const patch of [{published:true},{draftVersion:2},{lessonCount:2},{termId:'other'},{previewId:'wrong'},{recordedAt:'bad'},{recordedAt:'2026-02-30T12:00:00Z'},{recordedAt:'2026-10-20T12:00:00'}])assert.throws(()=>api.timetableImportReceipt({...r,...patch},c,'request-0001'))
})
await test('닫힘과 이미 저장됨을 구분하고 원접수증 검증',async()=>{
 const c=await command(),key='request-0001'
 assert.equal(api.timetableImportClose({requestKey:key,outcome:'closed',receipt:null},c,key).outcome,'closed')
 assert.throws(()=>api.timetableImportClose({requestKey:key,outcome:'closed',receipt:receipt(c,key)},c,key))
 assert.throws(()=>api.timetableImportClose({requestKey:key,outcome:'applied',receipt:null},c,key))
})
await test('같은 원키의 재확인과 닫기는 원문을 변경하지 않음',async()=>{
 const member={id:'manager',schoolId:'school',userId:'user',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
 const c=await command(),calls=[]
 const connection={info:()=>({memberships:[member],schools:[{id:'school'}],basisDate:'2026-10-20'}),getIdentity:async()=>({userId:'user',approved:true,profile:{role:'superadmin',is_active:true,extra_permissions:[]}}),
  rpcVerified:async(name,args)=>{calls.push({name,args});return{contract:'timetable-import.v1',schoolId:'school',memberId:'manager',data:name.endsWith('_close')?{requestKey:args.p_request_key,outcome:'applied',receipt:receipt(c,args.p_request_key)}:receipt(c,args.p_request_key)}}}
 const server=api.createTimetableImportServer(connection)
 await server.commit('manager',c,'request-0001');await server.commit('manager',c,'request-0001');await server.close('manager',c,'request-0001')
 assert.equal(calls.length,3);for(const call of calls)assert.deepEqual(call.args.p_command,c)
 await assert.rejects(server.commit('manager',{...c,input:{...c.input,title:'다름'}},'request-0001'),e=>e.code==='IDEMPOTENCY_CONFLICT')
 assert.equal(calls.length,3)
})
await test('학교 엑셀 양식은 학기 지문과 공식 ID·동명이인 구분을 함께 보존',async()=>{
 const s=source();s.resources[0].label='동일';s.resources[1].label='동일'
 const sheets=await api.timetableImportWorkbookSheets(s),input=sheets.find(v=>v.name==='시간표입력')
 assert.equal(input.rows[1][7],'teacher');assert.match(input.rows[1][11],/동일 \[teacher\]/);assert.match(input.rows[1][12],/동일 \[class\]/)
 assert.equal(sheets.find(v=>v.name==='_학교연결').hidden,true)
 input.rows[1].splice(2,5,'1','국어 1회','09:00','09:45','1')
 const result=await api.reviewTimetableImport(s,api.timetableImportWorkbookCsv(sheets,s),'엑셀')
 assert.equal(result.placements.length,1);assert.equal((await api.timetableImportWorkbook(s)).slice(0,2).toString(),'80,75')
})
await test('다른 학교·학기·오래된 지문과 망가진 열은 엑셀 입력으로 채택하지 않음',async()=>{
 for(const key of ['schoolId','termId','sourceFingerprint']){
  const s=source(),sheets=await api.timetableImportWorkbookSheets(s)
  sheets.find(v=>v.name==='_학교연결').rows.find(row=>row[0]===key)[1]='other'
  assert.throws(()=>api.timetableImportWorkbookCsv(sheets,s),e=>e.code==='INVALID_INPUT')
 }
 const s=source(),sheets=await api.timetableImportWorkbookSheets(s)
 sheets[0].rows[0].reverse();assert.throws(()=>api.timetableImportWorkbookCsv(sheets,s))
})
await test('엑셀 시각 소수를 짐작하지 않고 참고 이름은 실제 배정에 사용하지 않음',async()=>{
 const s=source(),sheets=await api.timetableImportWorkbookSheets(s),row=sheets[0].rows[1]
 row.splice(2,5,'1','국어','0.375','09:45','1');assert.throws(()=>api.timetableImportWorkbookCsv(sheets,s),/09:00/)
 row[4]='09:00';row[11]='다른 교사';const content=api.timetableImportWorkbookCsv(sheets,s)
 const result=await api.reviewTimetableImport(s,content,'공식');assert.equal(result.placements.length,1)
 const display=api.timetableImportDisplayRows(content,s);assert.match(display[0].teachers,/교사 \[teacher\]/);assert.equal(display[0].day,'월')
})
await test('엑셀의 빈 뒷행은 무시하지만 수업 누락·ID 변조는 기존 검증을 통과하지 못함',async()=>{
 const s=source(),sheets=await api.timetableImportWorkbookSheets(s),row=sheets[0].rows[1]
 row.splice(2,5,'1','국어','09:00','09:45','1');sheets[0].rows.push(['','',''])
 assert.equal((await api.reviewTimetableImport(s,api.timetableImportWorkbookCsv(sheets,s),'정상')).placements.length,1)
 row[7]='wrong';await assert.rejects(api.reviewTimetableImport(s,api.timetableImportWorkbookCsv(sheets,s),'변조'))
 sheets[0].rows=[sheets[0].rows[0],[]];assert.throws(()=>api.timetableImportWorkbookCsv(sheets,s))
})
if(process.env.T4_CAPTURE) {
 const captures=JSON.parse(await readFile(process.env.T4_CAPTURE,'utf8'))
 for(const [index,c] of captures.entries())await test(`PostgreSQL 실제 ${c.kind} 응답 대조 ${index+1}`,()=>{
  if(c.kind==='source')api.timetableImportSource(c.raw.data,c.raw.schoolId)
  if(c.kind==='preview')api.timetableImportPreview(c.raw.data,c.input)
  if(c.kind==='receipt')api.timetableImportReceipt(c.raw.data,c.command,c.key)
  if(c.kind==='close')api.timetableImportClose(c.raw.data,c.command,c.key)
 })
}
console.log(`시간표 실제 가져오기: ${count}건 통과`)
