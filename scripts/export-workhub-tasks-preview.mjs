import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 실제 내 업무 컴포넌트에 합성 저장소만 주입한다. 계정·외부 서버·학생 자료는 사용하지 않는다.
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(process.argv[2] || resolve(root, 'dist/workhub-tasks-preview.html'))
const source = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {TaskPanel} from './apps/workhub/src/tasks/TaskPanel';
import {TaskError} from './apps/workhub/src/tasks/contracts';
import {createWorkflowStore} from './apps/workhub/src/workflows/store';
import {fixtureData} from './apps/workhub/src/preview/fixtures';
import theme from './apps/workhub/src/style.css';
const store=createWorkflowStore({members:fixtureData.memberships,date:fixtureData.basisDate});
store.createTask('gaon-soyeon',{title:'체험학습 사전 안내 준비',notes:'학급별 확인 항목을 정리하고 안내문 초안을 준비합니다.',dueDate:'2026-10-19'},'seed-1');
const draft=store.createTask('gaon-soyeon',{title:'수업 활동지 최종 점검',notes:'수업 목표와 활동 시간을 확인합니다.',dueDate:'2026-10-18'},'seed-2');
store.setTaskStatus('gaon-soyeon',draft.id,'doing',draft.version,'seed-3');
store.createTask('gaon-soyeon',{title:'다음 주 협의 메모',notes:'기한이 없어도 잊지 않도록 남겨 둡니다.',dueDate:''},'seed-4');
store.createTask('nuri-soyeon',{title:'겸임 학교 수업 준비',notes:'학교마다 할 일이 분리됩니다.',dueDate:'2026-10-20'},'seed-5');
let dropNext=false;
async function execute(action,memberId,taskId,write=false){
  await new Promise(resolve=>setTimeout(resolve,180));
  try{
    const result=action();
    if(write&&dropNext){dropNext=false;throw new TaskError('QUERY_FAILED','저장은 처리했지만 응답이 끊긴 합성 상황입니다. 같은 요청으로 재시도해 보세요.');}
    return result;
  }catch(error){
    if(error instanceof TaskError)throw error;
    const conflict=error.code==='VERSION_CONFLICT';
    throw new TaskError(conflict?'CONFLICT':error.code||'QUERY_FAILED',error.message,conflict?store.listTasks(memberId).find(task=>task.id===taskId):undefined);
  }
}
const adapter={
  list:memberId=>execute(()=>store.listTasks(memberId),memberId),
  get:(memberId,id)=>execute(()=>{const task=store.listTasks(memberId).find(task=>task.id===id);if(!task)throw new TaskError('NOT_FOUND','할 일이 없습니다.');return task;},memberId,id),
  create:(memberId,input,key)=>execute(()=>store.createTask(memberId,input,key),memberId,undefined,true),
  update:(memberId,id,input,version,key)=>execute(()=>store.updateTask(memberId,id,input,version,key),memberId,id,true),
  setStatus:(memberId,id,status,version,key)=>execute(()=>store.setTaskStatus(memberId,id,status,version,key),memberId,id,true),
};
function Preview(){
  const [memberId,setMemberId]=useState('gaon-soyeon');
  const [compact,setCompact]=useState(false);
  const [notice,setNotice]=useState('');
  const [navigationLocked,setNavigationLocked]=useState(false);
  const member=fixtureData.memberships.find(value=>value.id===memberId);
  function conflict(){const task=store.listTasks(memberId)[0];if(!task)return;store.updateTask(memberId,task.id,{title:task.title,notes:task.notes+'\\n다른 창에서 추가한 합성 메모',dueDate:task.dueDate},task.version,crypto.randomUUID());setNotice('첫 번째 할 일을 다른 창에서 수정한 상황입니다. 이전 원본으로 저장하면 충돌을 확인할 수 있습니다.');}
  return <><style>{theme}</style><div className="preview-banner"><strong>4차 개발 · 합성 자료 시연</strong><span>실제 서버에 접속하지 않습니다. 새로고침하면 초기화됩니다.</span></div><main className="task-preview-main"><header className="page-header"><div><p className="eyebrow">학교업무혁신시스템</p><h1>내 할 일을 한곳에서</h1><p>등록부터 완료까지, 홈과 내 업무가 같은 자료를 사용합니다.</p></div></header><div className="task-preview-controls"><label>가상 학교<select disabled={navigationLocked} value={memberId} onChange={event=>{setMemberId(event.target.value);setNotice('')}}><option value="gaon-soyeon">가온가상중학교</option><option value="nuri-soyeon">누리가상중학교</option></select></label><button className="secondary" disabled={navigationLocked} onClick={()=>setCompact(value=>!value)}>{compact?'내 업무 전체 보기':'홈 요약 보기'}</button></div><TaskPanel key={memberId+':'+compact} member={member} date={fixtureData.basisDate} adapter={adapter} onNavigationLockChange={setNavigationLocked} compact={compact} onOpenTasks={()=>setCompact(false)}/><details className="task-preview-tests"><summary>저장 실패·동시 수정 시험하기</summary><p>모두 이 파일 안에서만 일어나는 합성 상황입니다.</p><div className="button-row"><button className="secondary" onClick={()=>{dropNext=true;setNotice('다음 저장은 처리 후 응답만 끊깁니다. 입력을 유지한 재시도로 중복이 없는지 확인할 수 있습니다.')}}>다음 저장 응답 끊기</button><button className="secondary" onClick={conflict}>첫 할 일을 다른 창에서 수정</button></div>{notice&&<p role="status">{notice}</p>}</details><footer className="workspace-footer">현재 학교·본인 할 일만 표시 · 기준일 2026-10-19<span>운영 서버 적용과 실제 계정 시험은 별도 진행</span></footer></main></>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
`
const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', minify: true, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } })
const js = result.outputFiles[0].text
if (js.includes('signInWithOAuth') || js.includes('supabase.auth')) throw new Error('실제 인증 클라이언트가 시연에 포함되었습니다.')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학교업무혁신시스템 · 내 업무 시연</title><link rel="icon" href="data:,"><style>.task-preview-main{max-width:1120px;margin:36px auto;padding:0 26px}.task-preview-controls{display:flex;align-items:end;gap:16px;margin:24px 0}.task-preview-controls label{max-width:320px;flex:1;font-size:14px}.task-preview-controls select{display:block;width:100%;min-height:44px;margin-top:8px}.task-preview-tests{margin:32px 0;padding:18px;border:1px solid #dce5e1;border-radius:12px;font-size:13px}.task-preview-tests summary{cursor:pointer;font-weight:600}.task-preview-tests p{margin:15px 0}.task-preview-tests .button-row{flex-wrap:wrap}@media(max-width:600px){.task-preview-main{padding:0 16px;margin-top:26px}.task-preview-controls{align-items:stretch;flex-direction:column}.task-preview-controls label{max-width:none}}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, html, 'utf8')
console.log(`내 업무 시연 저장: ${destination} (${Buffer.byteLength(html).toLocaleString()} bytes)`)
