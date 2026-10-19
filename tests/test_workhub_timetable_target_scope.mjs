import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'
const { scopeTimetableServers } = await loadBrowserModule(`export * from '../apps/workhub/src/timetable/target-scope';`)
const original = { termId:'old', selectedTermId:null, automaticTermId:'old', version:0, terms:[] }
const later = { ...original,termId:'next',selectedTermId:'next',version:1 }
const code = value => error => error?.code === value
let passed=0
async function check(name,run){await run();passed++;console.log('  ✓ '+name)}
function fixture(initial=original){
 const state={checking:false,snapshot:initial&&structuredClone(initial)},calls=[],observed=[]
 let fresh=structuredClone(initial), term='old', failure, pause
 const target={get:async()=>{calls.push('target');if(pause)await pause;if(failure)throw failure;return structuredClone(fresh)}}
 const base={readiness:async()=>({available:true}),get:async()=>{calls.push('timetable-get');if(pause)await pause;return {basis:{termId:term}}},saveDraft:async(...args)=>{calls.push(['save',args]);return 'saved'},recoverDraft:async(...args)=>{calls.push(['recover',args]);return 'old-receipt'}}
 const preparation={get:async()=>{calls.push('preparation-get');if(pause)await pause;return {termId:term}},execute:async(...args)=>{calls.push(['preparation-write',args]);return 'saved'},recover:async(...args)=>{calls.push(['preparation-recover',args]);return 'old-receipt'}}
 const setup={get:async()=>{calls.push('setup-get');if(pause)await pause;return {termId:term}},execute:async(...args)=>{calls.push(['setup-write',args]);return 'saved'},recover:async(...args)=>{calls.push(['setup-recover',args]);return 'old-receipt'}}
 const scoped=scopeTimetableServers({target,state:()=>state,observe:value=>{observed.push(value);state.snapshot=value;state.checking=false},mismatch:()=>calls.push('mismatch'),timetable:base,preparation,setup})
 return {state,calls,observed,scoped,setFresh:value=>fresh=value,setTerm:value=>term=value,fail:value=>failure=value,hold:value=>pause=value}
}
await check('선택 계약이 없는 T1은 기존 조회·저장을 유지한다',async()=>{const f=fixture(null);await f.scoped.timetable.saveDraft('m',{},'key');assert.deepEqual(f.calls,[['save',['m',{},'key']]])})
await check('같은 준비 학기는 공간·준비·편성 저장을 유지한다',async()=>{const f=fixture();await f.scoped.setup.get('m');await f.scoped.setup.execute('m',{kind:'space_save'},'key');await f.scoped.preparation.execute('m',{termId:'old'},'key2');await f.scoped.timetable.saveDraft('m',{},'key3');assert.equal(f.calls.filter(Array.isArray).length,3)})
await check('다른 담당자의 학기 변경을 새 저장 전 잡고 원본 명령을 보내지 않는다',async()=>{const f=fixture();f.setFresh(later);await assert.rejects(f.scoped.preparation.execute('m',{termId:'old'},'key'),code('CONFLICT'));assert.deepEqual(f.observed,[later]);assert.equal(f.calls.filter(Array.isArray).length,0)})
await check('선택 재확인 중에는 새 명령을 보내지 않는다',async()=>{const f=fixture();f.state.checking=true;await assert.rejects(f.scoped.timetable.saveDraft('m',{},'key'),code('CONFLICT'));assert.deepEqual(f.calls,[])})
await check('명령 직전 선택 재조회 실패는 실제 쓰기를 보내지 않는다',async()=>{const f=fixture();f.fail(new Error('offline'));await assert.rejects(f.scoped.setup.execute('m',{},'key'),/offline/);assert.equal(f.calls.filter(Array.isArray).length,0)})
await check('현재 선택과 다른 학기의 준비·공간·기준판 응답은 표시하지 않는다',async()=>{const f=fixture(later);for(const query of [()=>f.scoped.setup.get('m'),()=>f.scoped.preparation.get('m'),()=>f.scoped.timetable.get('m','week')])await assert.rejects(query(),code('CONFLICT'))})
await check('조회 중 학기가 바뀌면 늦은 응답을 거절한다',async()=>{const f=fixture();let release;f.hold(new Promise(done=>release=done));const query=f.scoped.preparation.get('m');f.state.snapshot=later;release();await assert.rejects(query,code('CONFLICT'))})
await check('같은 학기로 돌아와도 선택 판이 달라지면 공간 원본을 다시 읽어야 한다',async()=>{const f=fixture();await f.scoped.setup.get('m');const returned={...original,version:2};f.state.snapshot=returned;f.setFresh(returned);await assert.rejects(f.scoped.setup.execute('m',{},'key'),code('CONFLICT'));assert.equal(f.calls.filter(Array.isArray).length,0)})
await check('전환 후 현재 학기 자료를 다시 읽으면 정상 저장한다',async()=>{const f=fixture(later);f.setTerm('next');await f.scoped.setup.get('m');assert.equal(await f.scoped.setup.execute('m',{capacity:2},'key'),'saved')})
await check('학기 선택 상태가 바뀌어도 세 종류 원키 복구는 재조회 없이 그대로 호출한다',async()=>{const f=fixture();f.state.checking=true;f.state.snapshot=later;f.fail(new Error('offline'));const input={termId:'old'},source={termId:'old'};assert.equal(await f.scoped.preparation.recover('m',input,'original',source),'old-receipt');await f.scoped.setup.recover('m',input,'original');await f.scoped.timetable.recoverDraft('m',input,'original');assert.equal(f.calls.filter(x=>x==='target').length,0);assert.deepEqual(f.calls[0],['preparation-recover',['m',input,'original',source]])})
await check('읽은 공간 원본 없이 새 대상 학기에 쓰지 않는다',async()=>{const f=fixture(later);await assert.rejects(f.scoped.setup.execute('m',{},'key'),code('CONFLICT'));assert.equal(f.calls.filter(Array.isArray).length,0)})
console.log('대상 학기 연결 경계: '+passed+'개 통과')
