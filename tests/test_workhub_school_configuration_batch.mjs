import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
import {schoolBatchFixture} from './fixtures/school-configuration-batch.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/setup/school-configuration-batch';`)
const scope={schoolId:'school-one',schoolYear:'2026'}, input=(group,rows)=>({group,text:m.schoolBatchCsv([m.SCHOOL_BATCH_HEADERS[group],...rows])})
let passed=0,id=0
const preview=(i,v=schoolBatchFixture(),version=3)=>m.previewSchoolBatch(i,v,version,()=>`new-${++id}`)
async function test(name,run){await run();passed++;console.log('  ✓',name)}
await test('신규 9학급 입력은 기존 학급·교과·기간을 보존하고 서버 호출 없이 초안을 만든다',()=>{
 const v=schoolBatchFixture(),before=structuredClone(v);v.configuration.classes=[];const p=preview(input('classes',Array.from({length:9},(_,i)=>['',String(1+Math.floor(i/3)),String(i%3+1),`${1+Math.floor(i/3)}학년 ${i%3+1}반`,'regular'])),v)
 assert.equal(p.rows.length,9);assert.ok(p.rows.every(x=>x.state==='add'));assert.equal(p.next.configuration.classes.length,9);assert.equal(v.configuration.classes.length,0);assert.deepEqual(p.next.subjects,before.subjects)
})
await test('기존 ID 수정·동일·누락 유지를 구분하고 ID를 다시 만들지 않는다',()=>{
 const v=schoolBatchFixture();v.subjects.push({id:'subject-two',name:'국어'},{id:'subject-three',name:'영어'})
 const p=preview(input('subjects',[['subject-one','윤리'],['subject-two','국어'],['','수학']]),v)
 assert.deepEqual(p.rows.map(x=>x.state),['change','same','add']);assert.equal(p.kept,1);assert.deepEqual(p.next.subjects[0],{id:'subject-one',name:'윤리'});assert.equal(p.next.subjects[2].name,'영어');assert.equal(v.subjects[0].name,'도덕')
})
await test('이름만 같은 빈 ID 행·다른 학교 ID·중복 ID를 거부한다',()=>{
 assert.throws(()=>preview(input('subjects',[['','도덕']])),/이름으로 연결하지/);assert.throws(()=>preview(input('subjects',[['foreign','수학']])),/현재 교과에 없습니다/);assert.throws(()=>preview(input('subjects',[['subject-one','윤리'],['subject-one','도덕']])),/식별자가 중복/)
})
await test('기존 항목과 겹치는 학년반·중복 이름을 전체 구성에서 거부한다',()=>{
 assert.throws(()=>preview(input('classes',[['','1','1','새 이름','regular']])),/학년·반 번호/);assert.throws(()=>preview(input('subjects',[['','수학'],['','수학']])),/중복/);assert.throws(()=>preview(input('departments',[['','교육과정부']])),/이름으로 연결하지/)
})
await test('학교 학년 범위·반번호·유형·빈 이름을 원래 계약으로 검증한다',()=>{
 for(const row of [['','4','1','4학년','regular'],['','1','100','새 반','regular'],['','1','2','새 반','unknown'],['','1','2','','regular']])assert.throws(()=>preview(input('classes',[row])))
})
await test('새 학년도의 미완성 날짜는 일괄 초안만 만들고 최종 저장에서 검증하게 한다',()=>{
 const v=schoolBatchFixture();v.configuration.schoolYear='';v.configuration.startsOn='';v.configuration.lastDay='';v.configuration.terms=[]
 assert.equal(preview(input('subjects',[['','수학']]),v).rows.length,1);assert.equal(preview(input('classes',[['','2','1','2학년 1반','regular']]),v).rows.length,1)
})
await test('탭 붙여넣기와 CSV 따옴표는 값을 보존한다',()=>{
 assert.equal(preview({group:'subjects',text:'식별자\t이름\n\t"쉼표,교과"'}).next.subjects.at(-1).name,'쉼표,교과');assert.equal(preview(input('subjects',[['','"수학"']])).next.subjects.at(-1).name,'"수학"')
 assert.equal(preview({group:'subjects',text:'식별자\t이름\n\t기술,가정'}).next.subjects.at(-1).name,'기술,가정')
 assert.deepEqual(m.schoolBatchTable('식별자\t이름\r\n\t"따옴표""와\n줄바꿈,쉼표"','subjects'),[['','따옴표"와\n줄바꿈,쉼표']])
 assert.throws(()=>m.schoolBatchTable('식별자\t이름\n\t"닫힘"x','subjects'),/따옴표/);assert.throws(()=>m.schoolBatchTable('식별자\t이름\n\t"미완성','subjects'),/따옴표/)
})
await test('판 또는 구성 입력 변경 후에는 이전 비교를 적용하지 못한다',()=>{
 const v=schoolBatchFixture(),p=preview(input('subjects',[['','수학']]),v)
 assert.equal(m.applySchoolBatch(p,v,3).subjects.length,2);assert.throws(()=>m.applySchoolBatch(p,v,4),/바뀌었습니다/);v.configuration.schoolName='바뀐 학교명';assert.throws(()=>m.applySchoolBatch(p,v,3),/바뀌었습니다/)
})
await test('서로 다른 그룹의 ID 재사용과 잘못된 신규 ID를 막는다',()=>{
 const i=input('subjects',[['','수학']]);assert.throws(()=>m.previewSchoolBatch(i,schoolBatchFixture(),3,()=> 'class-one'),/식별자/);assert.throws(()=>m.previewSchoolBatch(i,schoolBatchFixture(),3,()=> '<bad>'),/식별자/)
})
await test('XLSX 현재 자료는 숨은 학교·학년도·종류와 기존 ID를 보존한다',()=>{
 const v=schoolBatchFixture(),s=m.schoolBatchSheets(scope,v,'classes',true),text=m.schoolBatchWorkbookText(s,scope,'classes')
 assert.equal(preview({group:'classes',text},v).rows[0].state,'same');assert.ok(m.schoolBatchWorkbook(scope,v,'classes',true).length>100);assert.equal(s[2].hidden,true)
})
await test('다른 학교·학년도·종류 XLSX 또는 누락 메타·추가 열을 거부한다',()=>{
 const s=m.schoolBatchSheets(scope,schoolBatchFixture(),'classes',true)
 for(const sc of [{...scope,schoolId:'other'},{...scope,schoolYear:'2027'}])assert.throws(()=>m.schoolBatchWorkbookText(s,sc,'classes'),/다른 학교/)
 assert.throws(()=>m.schoolBatchWorkbookText(s,scope,'subjects'),/다른 학교/);assert.throws(()=>m.schoolBatchWorkbookText(s.slice(0,2),scope,'classes'),/다른 학교/);s[0].rows[1].push('extra');assert.throws(()=>m.schoolBatchWorkbookText(s,scope,'classes'),/양식 밖/)
})
await test('원래 배열 한도와 빈 파일·헤더·CSV 크기 한도를 지킨다',()=>{
 const v=schoolBatchFixture();v.subjects=Array.from({length:200},(_,i)=>({id:'subject-'+i,name:'교과'+i}));assert.throws(()=>preview(input('subjects',[['','추가']]),v),/200개/);assert.throws(()=>preview(input('subjects',[])),/행/);assert.throws(()=>preview({group:'subjects',text:'이름,식별자\n수학,'}),/항목 이름/)
})
await test('잘못된 파일·UTF8 오류와 다른 양식은 기존 입력을 변형하지 않는다',async()=>{
 await assert.rejects(m.readSchoolBatchFile(new File(['x'],'a.xls'),scope,'subjects'),/XLSX/);await assert.rejects(m.readSchoolBatchFile(new File([new Uint8Array([0xff])],'a.csv'),scope,'subjects'),/UTF-8/)
 const text=input('subjects',[['','수학']]).text;assert.equal(await m.readSchoolBatchFile(new File([text],'a.csv'),scope,'subjects'),text)
})
console.log(`학교 구성 일괄 입력 ${passed}개 통과`)
