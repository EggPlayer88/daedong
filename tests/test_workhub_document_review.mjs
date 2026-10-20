import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/documents/document-review'`)
const member={id:'member',schoolId:'school',userId:'user',name:'교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
const document={id:'doc',schoolId:'school',ownerMemberId:'member',version:2,latestVersion:2,status:'confirmed',updatedAt:'2026-10-21T00:00:00Z',canEdit:true,origin:null,title:'새 제목',kind:'event_report',body:'새 본문',visibility:'private',sources:[{kind:'knowledge',sourceId:'source',sourceVersion:2,locator:'2쪽',quote:'새 인용'}],basisDate:'2026-10-21',studentContext:null}
const before={...document,version:1,canEdit:false,title:'이전 제목',kind:'event_plan',body:'이전 본문',visibility:'school',status:'draft',sources:[],basisDate:'2026-10-20',origin:{documentId:'original',version:1}}
let count=0
async function check(name,fn){await fn();count++;console.log('  ✓ '+name)}
await check('제목·종류·본문·기준일·범위·상태·근거·사본 출처를 비교한다',()=>{assert.deepEqual(m.documentFieldChanges(before,document).map(c=>c.label),['제목','문서 종류','기준일','공개 범위','문서 상태','본문','연결한 근거','사본 출처'])})
await check('다른 문서·학교·작성자와 역순 판을 비교하지 않는다',()=>{for(const patch of [{id:'other'},{schoolId:'other'},{ownerMemberId:'other'},{version:2}])assert.throws(()=>m.documentFieldChanges({...before,...patch},document))})
await check('내용과 근거가 같으면 저장시각만으로 변경했다고 표시하지 않는다',()=>{assert.deepEqual(m.documentFieldChanges({...document,version:1,updatedAt:'2026-10-20T00:00:00Z'},document),[])})
await check('근거 위치·인용·판의 변경을 원문 그대로 보존한다',()=>{const changes=m.documentFieldChanges({...before,sources:[{...document.sources[0],sourceVersion:1,locator:'1쪽',quote:'<이전>\n인용'}]},document);assert.match(changes.find(c=>c.label==='연결한 근거').before,/<이전>\n인용/);assert.match(changes.find(c=>c.label==='연결한 근거').after,/v2/)})
await check('학생 근거의 개정·해시·세대·구간도 비교한다',()=>{const c={studentId:'student',courseId:'course',evidence:[{kind:'observation',id:'observation',revisionId:'rev',sourceHash:'a'.repeat(64),epoch:1,start:0,end:5}]};const changes=m.documentFieldChanges({...before,studentContext:c},{...document,studentContext:{...c,evidence:[{...c.evidence[0],epoch:2}]}});assert.match(changes.find(c=>c.label==='학생 근거').after,/세대 2/)})
await check('출력 전 조회는 정확한 문서 ID와 저장판을 전달한다',async()=>{const calls=[];const result=await m.readSavedDocument({get:async(...args)=>{calls.push(args);return document}},member,document);assert.deepEqual(calls,[['member','doc',2]]);assert.deepEqual(result,document)})
await check('최신 판 증가·수정 가능 변경은 선택한 저장판 원문과 구분한다',async()=>{const newer={...document,latestVersion:3,canEdit:false};assert.equal(m.documentVersionFingerprint(newer),m.documentVersionFingerprint(document));assert.equal((await m.readSavedDocument({get:async()=>newer},member,document)).version,2)})
await check('같은 판으로 본문·상태·근거가 바뀐 응답은 출력하지 않는다',async()=>{for(const patch of [{body:'다른 내용'},{status:'archived'},{sources:[]}])await assert.rejects(m.readSavedDocument({get:async()=>({...document,...patch})},member,document))})
await check('다른 ID·버전·학교 응답을 정확판 출력으로 받지 않는다',async()=>{for(const patch of [{id:'other'},{version:1,canEdit:false},{schoolId:'other'}])await assert.rejects(m.readSavedDocument({get:async()=>({...document,...patch})},member,document))})
await check('조회 권한 실패를 이전 저장판 성공으로 바꾸지 않는다',async()=>{await assert.rejects(m.readSavedDocument({get:async()=>{throw Error('denied')}},member,document))})
await check('학생 초안은 단순 문서 조회로 인쇄할 수 없다',()=>{assert.doesNotThrow(()=>m.assertDocumentPrintable(document));assert.throws(()=>m.assertDocumentPrintable({...document,kind:'student_record'}));assert.throws(()=>m.assertDocumentPrintable({...document,studentContext:{studentId:'student'}}))})
await check('비교는 원본문서와 저장된 근거를 수정하지 않는다',()=>{const a=structuredClone(before),b=structuredClone(document);m.documentFieldChanges(a,b);assert.deepEqual(a,before);assert.deepEqual(b,document)})
console.log(`문서 저장판 비교·인쇄 ${count}건 통과`)
