import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const {createTabCheckpoint,createEditDrafts,createPendingRequests,recoveryScope}=await loadBrowserModule(`
export * from '../apps/workhub/src/app/tab-checkpoint.ts';
export * from '../apps/workhub/src/app/edit-drafts.tsx';
export * from '../apps/workhub/src/app/pending-requests.tsx';`)
const member={userId:'user-a',schoolId:'school-a',id:'member-a',active:true,role:'teacher',validFrom:'2026-01-01',validThrough:'2026-12-31',departmentIds:[],gradeIds:[],subjectIds:[]},scope=recoveryScope(member)
function storage(){const rows=new Map();return {get length(){return rows.size},key:i=>[...rows.keys()][i]??null,getItem:k=>rows.get(k)??null,setItem:(k,v)=>rows.set(k,v),removeItem:k=>rows.delete(k),rows}}
const request=()=>({key:'original-request-key',command:{kind:'create',input:{title:'원래 할 일',notes:'원래 본문',dueDate:'2026-11-18'}}})
function open(port,clock=()=>1000000){const checkpoint=createTabCheckpoint(member.userId,port,clock);return {checkpoint,drafts:createEditDrafts(true,checkpoint),pending:createPendingRequests(checkpoint)}}
function activate(stores,who=scope){stores.pending.retainScopes([who]);stores.drafts.activate(who)}
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
test('새로고침 후 신원·소속 검증과 명시 복원 전에는 저장한 본문을 노출하지 않는다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'messaging-composer').save({draft:{body:'보관한 메시지'},composing:true,pending:null,folded:true});
 const b=open(port);assert.equal(b.drafts.restoreCount(scope),0);assert.equal(b.drafts.bind(scope,'messaging-composer').initial,undefined);activate(b);
 assert.equal(b.drafts.restoreCount(scope),1);assert.equal(b.drafts.bind(scope,'messaging-composer').initial,undefined);assert.equal(b.drafts.restore(scope),true);
 assert.deepEqual(b.drafts.bind(scope,'messaging-composer').initial,{draft:{body:'보관한 메시지'},composing:true,pending:null,folded:true});assert.equal(b.drafts.restoreCount(scope),0)
})
test('미확정 원키·본문은 일반 입력과 분리하고 복원만으로 실행하거나 버리지 않는다',()=>{
 const port=storage(),a=open(port);activate(a);a.pending.put(scope,'task',request());a.drafts.bind(scope,'task-editor').save({title:'후속 입력'});
 const b=open(port);activate(b);assert.equal(b.pending.count(),0);assert.equal(b.pending.get(scope,'task'),undefined);assert.equal(b.pending.restoreCount(scope),1);
 b.drafts.discardRestore(scope);assert.equal(b.pending.restoreCount(scope),1);assert.equal(typeof b.pending.discardRestore,'undefined');b.pending.restore(scope);
 assert.deepEqual(b.pending.get(scope,'task'),request());b.pending.remove(scope,'task','wrong');assert.equal(b.pending.count(),1);b.pending.remove(scope,'task','original-request-key');
 const c=open(port);activate(c);assert.equal(c.pending.restoreCount(scope),0)
})
test('일시 재검증 실패는 숨겼다가 같은 범위로 되돌리고 로그아웃·권한 변경은 폐기한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'남은 질문',studentContext:null});a.pending.put(scope,'task',request());a.drafts.suspend();
 assert.equal(a.drafts.bind(scope,'assistant').initial,undefined);activate(a);assert.equal(a.drafts.bind(scope,'assistant').initial.prompt,'남은 질문');
 const changed=recoveryScope({...member,role:'calendar_manager'}),b=open(port);activate(b,changed);assert.equal(b.pending.restoreCount(scope),0);assert.equal(b.drafts.restoreCount(scope),0);
 const c=open(port);activate(c);assert.equal(c.drafts.restoreCount(scope),0);assert.equal(c.pending.restoreCount(scope),0);
 c.drafts.bind(scope,'assistant').save({prompt:'로그아웃 폐기'});c.pending.put(scope,'task',request());c.drafts.clear();c.pending.clear();const d=open(port);activate(d);assert.equal(d.drafts.restoreCount(scope),0);assert.equal(d.pending.restoreCount(scope),0)
})
test('같은 탭에서 다른 계정으로 바뀌면 이전 계정 보관함을 제거한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'이전 사용자'});createTabCheckpoint('user-b',port);assert.equal(port.length,0);
 const b=open(port);activate(b);assert.equal(b.drafts.restoreCount(scope),0)
})
test('일반 초안은 12시간 뒤 만료하지만 미확정 요청 번호는 결과 확인까지 유지한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'calendar-editor').save({draft:{title:'기한 경과'}});a.pending.put(scope,'task',request());
 const b=open(port,()=>1000000+13*3600000);activate(b);assert.equal(b.drafts.restoreCount(scope),0);assert.equal(b.pending.restoreCount(scope),1);b.pending.restore(scope);assert.equal(b.pending.get(scope,'task').key,'original-request-key')
})
test('File·Blob·선택 파일은 저장하지 않고 수합 제목·기한·본문은 유지한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'collection-editor').save({editor:{input:{title:'보관할 수합',dueDate:'2026-11-18'},staged:[{id:'x',file:new Blob(['파일'])}],saving:true},upload:{file:new Blob(['본문'])},parked:true});
 const b=open(port);activate(b);b.drafts.restore(scope);assert.deepEqual(b.drafts.bind(scope,'collection-editor').initial,{editor:{input:{title:'보관할 수합',dueDate:'2026-11-18'},staged:[]},parked:true})
})
test('AI 입력은 보관하되 이전 답변·학생 근거 원문과 API 비밀값은 보관하지 않는다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'작성 중 질문',thread:{body:'학생 근거 원문'},studentContext:{records:['학생 상세']}});
 a.drafts.bind(scope,'task-editor').save({password:'보관 금지'});a.drafts.bind(scope,'calendar-editor').save({key:'sk-ant-test-secret'});a.drafts.bind(scope,'assistant-school-settings').save({apiKey:'키'});
 const text=[...port.rows.values()].join('');assert.doesNotMatch(text,/학생 근거 원문|학생 상세|보관 금지|sk-ant-test-secret|apiKey/);assert.match(text,/작성 중 질문/)
})
test('변조 형식·다른 소속 범위·중복·원키 누락은 복구 명령으로 열지 않는다',()=>{
 for(const change of [x=>x.items[0].scope='foreign',x=>x.items.push(structuredClone(x.items[0])),x=>delete x.items[0].value.key]){
  const port=storage(),a=open(port);activate(a);a.pending.put(scope,'task',request());const key=port.key(0),raw=JSON.parse(port.getItem(key));change(raw);port.setItem(key,JSON.stringify(raw));const b=open(port);activate(b);assert.equal(b.pending.restoreCount(scope),0)
 }
})
test('용량·저장소 실패 때 이전 값으로 복원한다고 속이지 않고 현재 탭 메모리는 유지한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'이전 질문'});port.setItem=()=>{throw Error('quota')};a.drafts.bind(scope,'assistant').save({prompt:'새 질문'});
 assert.equal(a.checkpoint.status(),'unavailable');assert.equal(a.drafts.bind(scope,'assistant').initial.prompt,'새 질문');assert.equal(port.length,0)
})
test('복원 후 이전 세대의 비동기 저장이 복구한 입력을 덮어쓰지 못한다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'원래 입력'});const b=open(port);activate(b);const late=b.drafts.bind(scope,'assistant');b.drafts.restore(scope);late.save({prompt:'늦은 이전 입력'});assert.equal(b.drafts.bind(scope,'assistant').initial.prompt,'원래 입력')
})
test('빈 화면·저장 완료의 위치 정보만으로는 새로고침 복원 안내를 만들지 않는다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'assistant').save({prompt:'',studentContext:null},false);a.drafts.bind(scope,'calendar-panel').save({importing:false},false);
 const b=open(port);activate(b);assert.equal(b.drafts.restoreCount(scope),0);
 a.drafts.bind(scope,'assistant').save({prompt:'미저장 입력',studentContext:null},true);assert.equal(port.length,1);a.drafts.bind(scope,'assistant').save({prompt:'',studentContext:null},false);
 const c=open(port);activate(c);assert.equal(c.drafts.restoreCount(scope),0)
})

test('AI 업무 단계 원문·완료 접수증과 복구 비교표의 요청 번호를 그대로 유지한다',()=>{
 const port=storage(),a=open(port);activate(a);
 const plan={id:'plan-1',source:'할 일과 일정',selected:'step-2',steps:[{id:'step-1',status:'confirmed',receipt:{id:'task-1',version:1}},{id:'step-2',status:'pending',requestKey:'root-result-key'}]};
 const operation={review:{key:'root-operation-key',kind:'taskUpdate',command:{kind:'update',taskId:'task-1',expectedVersion:1,input:{title:'수정 제목'}}},prompt:'할 일 고쳐줘',status:'review'};
 a.drafts.bind(scope,'assistant').save({prompt:'',studentContext:null,workspacePlan:plan,taskPlanOrigins:{'root-result-key':{planId:'plan-1',stepId:'step-2'}}});
 a.drafts.bind(scope,'assistant-operation').save(operation);a.pending.put(scope,'assistantOperation',{key:'root-operation-key',command:operation});
 const b=open(port);activate(b);b.drafts.restore(scope);b.pending.restore(scope);
 assert.deepEqual(b.drafts.bind(scope,'assistant').initial.workspacePlan,plan);
 assert.deepEqual(b.drafts.bind(scope,'assistant').initial.taskPlanOrigins,{'root-result-key':{planId:'plan-1',stepId:'step-2'}});
 assert.deepEqual(b.pending.get(scope,'assistantOperation'),{key:'root-operation-key',command:operation});
 assert.deepEqual(b.drafts.bind(scope,'assistant-operation').initial,operation)
})

test('저장소에 남은 일시 저장 플래그도 복원 시 제거해 파일 단계 자동 실행을 재개하지 않는다',()=>{
 const port=storage(),a=open(port);activate(a);a.drafts.bind(scope,'collection-editor').save({editor:{input:{title:'재확인할 수합'},staged:[]}});
 const key=port.key(0),raw=JSON.parse(port.getItem(key));raw.items[0].value.editor.saving=true;port.setItem(key,JSON.stringify(raw));
 const b=open(port);activate(b);b.drafts.restore(scope);assert.equal(b.drafts.bind(scope,'collection-editor').initial.editor.saving,undefined);assert.deepEqual(b.drafts.bind(scope,'collection-editor').initial.editor.staged,[])
})
console.log('같은 탭 새로고침 복구 '+passed+'건 통과, '+failed+'건 실패');if(failed)process.exitCode=1
