import assert from 'node:assert/strict'
import {buildSync} from 'esbuild'
import {readFileSync,mkdirSync,mkdtempSync} from 'node:fs'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {fileURLToPath} from 'node:url'
import {launchBrowser} from './launch-browser.mjs'

const bundle=buildSync({stdin:{contents:readFileSync(new URL('./workhub-timetable-setup-fixture.tsx',import.meta.url),'utf8'),loader:'tsx',resolveDir:fileURLToPath(new URL('.',import.meta.url))},bundle:true,format:'iife',write:false,jsx:'automatic',loader:{'.css':'text'},define:{'import.meta.env':'{}','process.env.NODE_ENV':'"development"'},logLevel:'silent'})
const output=process.env.WORKHUB_QA_OUTPUT||mkdtempSync(join(tmpdir(),'workhub-timetable-setup-'));mkdirSync(output,{recursive:true})
const browser=await launchBrowser(),page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[]
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000)
await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0;padding:12px"><div id="root"></div></body></html>'}))
let count=0
const button=name=>page.getByRole('button',{name,exact:true}), field=name=>page.getByLabel(name,{exact:true})
const row=name=>page.getByRole('listitem',{name,exact:true})
const roomEditor=()=>page.getByRole('region',{name:'공간 입력',exact:true})
const courseEditor=()=>page.getByRole('region',{name:'수업 연결 입력',exact:true})
async function start(mode='setup'){await page.setViewportSize({width:1280,height:900});await page.goto('http://127.0.0.1:5179/setup');await page.evaluate(mode=>window.mode=mode,mode);await page.addScriptTag({content:bundle.outputFiles[0].text});if(mode==='workspace')await page.getByRole('heading',{name:'시간표 기초 자료를 준비하고 있습니다',exact:true}).waitFor();if(mode==='preparation'||mode==='workspace'){await page.getByText('학교 편성 자료 준비',{exact:true}).click();await field('준비 자료 이름').waitFor()};await page.getByText('공간·수업 연결 관리',{exact:true}).click();await button('공간 추가').waitFor()}
async function test(name,run,mode='setup'){await start(mode);await run();count++;console.log('  ✓ '+name)}
async function editRoom(id='room-free',name='다목적실'){await row(name+' ['+id+']').getByRole('button',{name:'공간 수정',exact:true}).click();await field('공간 이름').waitFor()}
async function editCourse(id='course-a'){await row('국어 ['+id+']').getByRole('button',{name:'연결 편집',exact:true}).click();await courseEditor().waitFor()}
async function preview(){await button('변경 내용 확인').click();await page.getByRole('region',{name:'저장 전 변경 비교',exact:true}).waitFor()}
async function save(){await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click();await page.waitForFunction(()=>window.saved>0)}
async function executeCalls(){return page.evaluate(()=>window.calls.filter(call=>call.name==='workhub_timetable_setup_execute'))}
async function uploadBatch(){
  await page.getByText('엑셀로 공간·수업 연결 한 번에 준비',{exact:true}).click()
  const buffer=Buffer.from(await page.evaluate(()=>window.makeBatchFile()))
  await field('편집한 준비 입력 엑셀 가져오기').setInputFiles({name:'일괄준비.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer})
  await button('선택한 항목 순서대로 저장').waitFor()
}
async function beginBatch(){await field('변경 내용과 일부만 저장될 수 있음을 확인했습니다').check();await button('선택한 항목 순서대로 저장').click()}
async function reload(){await button('준비 입력 자료 다시 확인').click()}
try{
  await test('정원이 비어 있는 새 공간을 1로 추정하지 않고 명시 확인 뒤 null로 저장한다',async()=>{
    await button('공간 추가').click();await field('공간 이름').fill('새 특별실')
    assert.equal(await field('동시 수업 수').inputValue(),'');await preview()
    await page.screenshot({path:join(output,'setup-desktop.png'),fullPage:true})
    assert.equal(await button('확인한 내용 저장').isDisabled(),true);assert.equal((await executeCalls()).length,0)
    await save();const calls=await executeCalls();assert.equal(calls.length,1);assert.deepEqual(calls[0].args.p_command,{kind:'space_save',spaceId:null,expectedVersion:null,input:{kind:'room',label:'새 특별실',capacity:null}})
    assert.equal(await page.evaluate(()=>window.actualWrites),1)
  })
  await test('동시 수업 수는 좌석 수와 구분하고 변경 전후를 확인한 현재 판으로 저장한다',async()=>{
    await editRoom();await field('동시 수업 수').fill('2');await preview()
    const comparison=page.getByRole('region',{name:'저장 전 변경 비교',exact:true});assert.match(await comparison.innerText(),/2/)
    await save();const command=(await executeCalls())[0].args.p_command
    assert.equal(command.spaceId,'room-free');assert.equal(command.expectedVersion,1);assert.equal(command.input.capacity,2)
    assert.equal(await page.evaluate(()=>window.view.spaces.find(space=>space.id==='room-free').capacity),2)
  })
  await test('0과 소수 정원은 서버에 보내지 않고 입력을 유지한다',async()=>{
    await editRoom();await field('동시 수업 수').fill('0');await button('변경 내용 확인').click()
    assert.equal((await executeCalls()).length,0);assert.equal(await field('동시 수업 수').inputValue(),'0');assert.equal(await button('확인한 내용 저장').count(),0)
    await field('동시 수업 수').fill('1.5');await button('변경 내용 확인').click();assert.equal((await executeCalls()).length,0);assert.equal(await button('확인한 내용 저장').count(),0)
  })
  await test('동명 수업과 학급을 ID로 구별하고 선택한 학급·공간만 연결한다',async()=>{
    await editCourse();const editor=courseEditor()
    await editor.getByRole('radio',{name:'공식 학급 선택',exact:true}).check()
    await editor.getByRole('checkbox',{name:'1학년 1반 [class-a]',exact:true}).check();await editor.getByRole('checkbox',{name:'다목적실 [room-free] · 미입력',exact:true}).check()
    assert.equal(await editor.getByRole('checkbox',{name:'2학년 1반 [class-b]',exact:true}).isChecked(),false);await preview();await save()
    const command=(await executeCalls())[0].args.p_command
    assert.equal(command.courseId,'course-a');assert.equal(command.expectedVersion,null);assert.deepEqual(command.input,{classIds:['class-a'],studentGroup:false,spaceIds:['room-free']})
    assert.deepEqual(await page.evaluate(()=>window.view.courses.find(course=>course.id==='course-b').link.classIds),['class-b'])
  })
  await test('별도 수강집단과 공식 학급은 함께 보내지 않는다',async()=>{
    await editCourse();const editor=courseEditor()
    await editor.getByRole('radio',{name:'공식 학급 선택',exact:true}).check();await editor.getByRole('checkbox',{name:'1학년 1반 [class-a]',exact:true}).check()
    await editor.getByRole('radio',{name:'이 수업의 별도 수강집단',exact:true}).check();await preview();await save()
    const command=(await executeCalls())[0].args.p_command;assert.equal(command.input.studentGroup,true);assert.deepEqual(command.input.classIds,[])
  })
  await test('미연결 공간 삭제는 확인 전 실행하지 않고 연결된 공간은 삭제를 막는다',async()=>{
    await editRoom();await button('공간 삭제 검토').click()
    await page.getByRole('region',{name:'저장 전 변경 비교',exact:true}).waitFor()
    assert.equal(await button('확인한 공간 삭제').isDisabled(),true);assert.equal((await executeCalls()).length,0)
    await field('변경 내용을 확인했습니다').check();await button('확인한 공간 삭제').click();await page.waitForFunction(()=>window.saved===1)
    assert.equal(await page.evaluate(()=>window.view.spaces.some(space=>space.id==='room-free')),false)
    await editRoom('room-used','과학실');const linked=button('공간 삭제 검토');assert.equal(await linked.isDisabled(),true);assert.equal(await page.evaluate(()=>window.actualWrites),1)
  })
  await test('검색과 쪽 이동으로 편집 중 수업이 가려져도 선택과 잠금을 유지한다',async()=>{
    await page.evaluate(()=>{for(let i=1;i<=24;i++)window.view.courses.push({id:'extra-'+i,label:'추가 수업 '+String(i).padStart(2,'0'),inTimetable:true,teacherLabels:['추가 교사'],studentCount:0,link:null})})
    await reload();await button('다음 수업').waitFor();await editCourse();await courseEditor().getByRole('radio',{name:'공식 학급 선택',exact:true}).check();await courseEditor().getByRole('checkbox',{name:'1학년 1반 [class-a]',exact:true}).check()
    await button('다음 수업').click();await field('수업 검색').fill('없는 수업')
    assert.equal(await courseEditor().getByRole('checkbox',{name:'1학년 1반 [class-a]',exact:true}).isChecked(),true);assert.equal(await page.evaluate(()=>window.locked),true)
    await preview();await save();assert.equal((await executeCalls())[0].args.p_command.courseId,'course-a')
  })
  await test('동시 수정 충돌에서는 내 입력을 보관하고 최신 판과 비교한 뒤 새 요청으로 저장한다',async()=>{
    await editRoom();await field('공간 이름').fill('내가 고친 공간');await field('동시 수업 수').fill('2');await preview()
    await page.evaluate(()=>{const room=window.view.spaces.find(row=>row.id==='room-free');room.label='다른 담당자가 고친 공간';room.capacity=3;room.version=2;window.view.sourceRevision=2;window.view.sourceFingerprint='b'.repeat(64)})
    await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click()
    await button('내 입력을 최신 자료에 이어서 편집').waitFor();assert.equal(await page.evaluate(()=>window.actualWrites),0)
    await button('내 입력을 최신 자료에 이어서 편집').click();assert.equal(await field('공간 이름').inputValue(),'내가 고친 공간');assert.equal(await field('동시 수업 수').inputValue(),'2')
    await preview();assert.equal(await field('변경 내용을 확인했습니다').isChecked(),false);assert.match(await page.getByRole('region',{name:'저장 전 변경 비교',exact:true}).innerText(),/다른 담당자가 고친 공간/)
    await save();const calls=await executeCalls();assert.equal(calls.length,2);assert.notEqual(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.equal(calls[1].args.p_command.expectedVersion,2)
  })
  await test('조회가 실패하면 이전 목록과 입력을 숨기고 재연결 후 입력을 복원한다',async()=>{
    await editRoom();await field('공간 이름').fill('복원할 공간 이름');await page.evaluate(()=>window.failRead=true);await reload()
    await page.getByRole('alert').waitFor();assert.equal(await field('공간 이름').count(),0);assert.equal(await row('과학실 [room-used]').count(),0);assert.equal(await page.evaluate(()=>window.locked),true)
    await page.evaluate(()=>window.failRead=false);await reload();await field('공간 이름').waitFor();assert.equal(await field('공간 이름').inputValue(),'복원할 공간 이름')
  })
  await test('응답 유실·재마운트 뒤 같은 번호와 명령으로 조회만 복구하고 이중 저장하지 않는다',async()=>{
    await editRoom();await field('동시 수업 수').fill('2');await preview();await page.evaluate(()=>window.dropOnce=true);await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click()
    await button('원래 저장 요청 결과 확인').waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1);assert.equal(await page.evaluate(()=>window.locked),true);assert.equal(await page.evaluate(()=>window.actualWrites),1)
    await page.evaluate(()=>{window.failRead=true;window.root.unmount();window.mount()});await button('원래 저장 요청 결과 확인').waitFor();await page.evaluate(()=>window.beforeRecover=window.calls.length)
    await button('원래 저장 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0&&window.saved===1)
    const calls=await executeCalls();assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.deepEqual(calls[0].args.p_command,calls[1].args.p_command);assert.equal(calls[1].args.p_recover_only,true)
    assert.equal(await page.evaluate(()=>window.calls[window.beforeRecover].name),'workhub_timetable_setup_execute');assert.equal(await page.evaluate(()=>window.actualWrites),1)
  })
  await test('추가 중 공간의 이름과 빈 정원을 탭 메모리에서 복원한다',async()=>{
    await button('공간 추가').click();await field('공간 이름').fill('아직 저장하지 않은 공간');assert.equal(await page.evaluate(()=>window.locked),true)
    await page.evaluate(()=>{window.root.unmount();window.mount()});await field('공간 이름').waitFor();assert.equal(await field('공간 이름').inputValue(),'아직 저장하지 않은 공간');assert.equal(await field('동시 수업 수').inputValue(),'')
    assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);assert.equal((await executeCalls()).length,0)
  })
  await test('RPC 미설치는 준비 중 안내로 끝나고 저장 요청을 보내지 않는다',async()=>{
    await page.evaluate(()=>window.missing=true);await reload();await page.getByRole('alert').waitFor();assert.match(await page.locator('body').innerText(),/준비/);assert.equal(await button('공간 추가').count(),0);assert.equal((await executeCalls()).length,0)
  })
  await test('320px와 200% 글자에서 명시 확인을 키보드로 수행한다',async()=>{
    await page.setViewportSize({width:320,height:800});await page.addStyleTag({content:'html{font-size:200%}input,select,button{font-size:inherit!important}'})
    await button('공간 추가').click();await field('공간 이름').fill('작은 화면에서 입력한 특별실');await field('동시 수업 수').fill('2');await preview()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true)
    await page.screenshot({path:join(output,'setup-mobile-200.png'),fullPage:true})
    await field('변경 내용을 확인했습니다').focus();await page.keyboard.press('Space');await button('확인한 내용 저장').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>window.saved===1);assert.equal(await page.evaluate(()=>window.actualWrites),1)
  })
  await test('공간 변경 뒤 시수·일과·활동 ID를 자동 초기화하지 않고 공식 자료를 확인해 채택한다',async()=>{
    await editRoom();await page.getByText('공간·수업 연결 작업을 마치면 시수·일과 준비를 이어갈 수 있습니다.',{exact:true}).waitFor();assert.equal(await field('준비 자료 이름').isDisabled(),true);await field('동시 수업 수').fill('2');await preview();await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click()
    await page.getByRole('region',{name:'공식 자료 변경 확인',exact:true}).waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'보존할 시수와 일과');assert.equal(await button('입력 보존하고 현재 자료 채택').isDisabled(),true);assert.equal(await button('준비 초안 서버에 저장').isDisabled(),true)
    await field('변경된 공식 자료를 확인했고 기존 시수·일과를 이어서 사용합니다').check();await button('입력 보존하고 현재 자료 채택').click();await button('준비 초안 서버에 저장').click();await page.waitForFunction(()=>window.prepWrites===1)
    assert.deepEqual(await page.evaluate(()=>window.savedPreparation.draft),await page.evaluate(()=>window.initialPreparation.draft));assert.equal(await page.evaluate(()=>window.savedPreparation.sourceFingerprint),await page.evaluate(()=>window.view.sourceFingerprint));assert.equal(await page.evaluate(()=>window.confirmed),0)
  },'preparation')
  await test('명시한 수업·학급 연결을 준비 원본으로 다시 읽고 재검사한 기준판에 포함한다',async()=>{
    await editCourse();await courseEditor().getByRole('checkbox',{name:'1학년 1반 [class-a]',exact:true}).check();await preview();await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click();await page.getByRole('region',{name:'공식 자료 변경 확인',exact:true}).waitFor()
    await field('변경된 공식 자료를 확인했고 기존 시수·일과를 이어서 사용합니다').check();await button('입력 보존하고 현재 자료 채택').click();await page.getByRole('navigation',{name:'편성 준비 입력 이동',exact:true}).getByRole('button',{name:/기준판 검토/}).click();await page.getByText('기초 자료의 시수·배정·시간대 검사 통과',{exact:true}).waitFor()
    await field('시수·교사 배정·학년별 시간대를 확인했으며 이 자료를 새 편성 기준판으로 만듭니다').check();await button('확인한 편성 기준판 만들기').click();await page.waitForFunction(()=>window.confirmed===1)
    const result=await page.evaluate(()=>Object.values(window.receipts).find(value=>value.kind==='confirm'));assert.deepEqual(result.basis.lessons.find(lesson=>lesson.id==='block-a1').resourceIds,['teacher-a','class-a']);assert.equal(result.basis.courseLoads.find(load=>load.courseId==='course-a').periods,2);assert.equal(result.basis.slots[0].id,'slot-mon')
  },'preparation')
  await test('공간 수정 중 다른 담당자가 준비 초안을 바꾸면 이전 시수의 채택과 덮어쓰기를 막는다',async()=>{
    await editRoom();await field('동시 수업 수').fill('2');await preview();await page.evaluate(()=>{window.savedPreparation.revision=2;window.savedPreparation.draft.title='다른 담당자의 새 준비 초안'})
    await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click();await page.getByRole('region',{name:'공식 자료 변경 확인',exact:true}).waitFor()
    await page.getByText('서버의 준비 초안도 변경되었습니다. 다른 사람의 초안을 덮어쓰지 않도록 보관한 입력의 재사용을 중지했습니다.',{exact:true}).waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'보존할 시수와 일과');assert.equal(await button('입력 보존하고 현재 자료 채택').count(),0);assert.equal(await button('준비 초안 서버에 저장').isDisabled(),true);assert.equal(await page.evaluate(()=>window.prepWrites),0);assert.equal(await page.evaluate(()=>window.savedPreparation.draft.title),'다른 담당자의 새 준비 초안')
  },'preparation')
  await test('준비 부모 화면을 다시 열어도 저장 전 공간 편집을 접힌 영역에 숨기지 않는다',async()=>{
    await editRoom();await field('공간 이름').fill('상위 화면에서도 복원할 공간');await page.evaluate(()=>{window.root.unmount();window.mount()});await field('공간 이름').waitFor();assert.equal(await field('공간 이름').inputValue(),'상위 화면에서도 복원할 공간');await page.getByText('공간·수업 연결 작업을 마치면 시수·일과 준비를 이어갈 수 있습니다.',{exact:true}).waitFor();assert.equal(await field('준비 자료 이름').isDisabled(),true);assert.equal(await page.evaluate(()=>window.actualWrites),0)
  },'preparation')
  await test('공식 자료 지문이 같아도 내 미저장 입력으로 다른 담당자가 올린 준비 초안을 덮어쓰지 않는다',async()=>{
    await field('준비 자료 이름').fill('내 미저장 준비 초안')
    await page.evaluate(()=>{window.savedPreparation.revision=2;window.savedPreparation.draft.title='타인의 새 준비 초안'})
    await button('공식 자료 다시 확인').click();await page.getByText('서버의 준비 초안 판이 바뀌었습니다. 작성한 입력을 보관했으며 다른 사람의 초안을 덮어쓰지 않습니다.',{exact:true}).waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'내 미저장 준비 초안');assert.equal(await field('준비 자료 이름').isDisabled(),true);assert.equal(await button('입력 보존하고 현재 자료 채택').count(),0);assert.equal(await page.evaluate(()=>window.prepWrites),0)
  },'preparation')
  await test('공간 저장 뒤 준비 재조회가 실패해도 이전 시수 초안은 복구 때 다시 확인한다',async()=>{
    await editRoom();await field('동시 수업 수').fill('2');await preview();await page.evaluate(()=>window.failPrepRead=true);await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click()
    await page.getByRole('alert').filter({hasText:'시간표 준비 조회 기능의 설치·권한을 확인'}).waitFor();assert.equal(await field('준비 자료 이름').count(),0);assert.equal(await page.evaluate(()=>window.actualWrites),1)
    await page.evaluate(()=>window.failPrepRead=false);await button('공식 자료 다시 확인').click();await page.getByRole('region',{name:'공식 자료 변경 확인',exact:true}).waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'보존할 시수와 일과');assert.equal(await page.evaluate(()=>window.prepWrites),0)
  },'preparation')
  await test('준비 저장 응답을 잃고 최신 초안을 조회해도 최초 입력과 요청 번호로 복구한다',async()=>{
    await field('준비 자료 이름').fill('원래 요청에 담긴 준비 초안');await page.evaluate(()=>window.dropPrepOnce=true);await button('준비 초안 서버에 저장').click();await button('원래 준비 요청 결과 확인').waitFor();assert.equal(await page.evaluate(()=>window.pending.count()),1)
    await page.evaluate(()=>{window.root.unmount();window.mount()});await button('원래 준비 요청 결과 확인').waitFor();await button('원래 준비 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0);await field('준비 자료 이름').waitFor();assert.equal(await field('준비 자료 이름').inputValue(),'원래 요청에 담긴 준비 초안')
    const calls=await page.evaluate(()=>window.calls.filter(call=>call.name==='workhub_timetable_preparation_execute'));assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.deepEqual(calls[0].args.p_input,calls[1].args.p_input);assert.equal(calls[1].args.p_recover_only,true);assert.equal(await page.evaluate(()=>window.prepWrites),1)
  },'preparation')
  await test('기준판이 없는 실제 시간표 메뉴에서도 준비 RPC로 진입하고 공간 편집 중 다른 작업을 잠근다',async()=>{
    assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='workhub_timetable_readiness')),true);assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='workhub_timetable_setup_get')),true);assert.equal(await page.evaluate(()=>window.calls.some(call=>call.name==='workhub_timetable_get')),false)
    assert.equal(await button('확정·공유·교환').isDisabled(),false);await editRoom();await field('공간 이름').fill('실제 메뉴에서 입력 중');await page.waitForFunction(()=>window.locked===true)
    assert.equal(await button('확정·공유·교환').isDisabled(),true);assert.equal(await button('예시로 편성 연습').isDisabled(),true);assert.equal(await button('학교 기초 자료 열기').isDisabled(),true);assert.equal(await field('준비 자료 이름').isDisabled(),true);assert.equal(await page.evaluate(()=>window.actualWrites),0)
  },'workspace')
  await test('실제 시간표 메뉴의 응답 유실 요청은 재진입 뒤에도 이동을 막고 원래 번호로만 복구한다',async()=>{
    await editRoom();await field('동시 수업 수').fill('2');await preview();await page.evaluate(()=>window.dropOnce=true);await field('변경 내용을 확인했습니다').check();await button('확인한 내용 저장').click();await button('원래 저장 요청 결과 확인').waitFor()
    await page.evaluate(()=>{window.root.unmount();window.mount()});await button('원래 저장 요청 결과 확인').waitFor();await page.waitForFunction(()=>window.locked===true);assert.equal(await button('확정·공유·교환').isDisabled(),true);assert.equal(await button('예시로 편성 연습').isDisabled(),true)
    await button('원래 저장 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0);const calls=await executeCalls();assert.equal(calls.length,2);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.deepEqual(calls[0].args.p_command,calls[1].args.p_command);assert.equal(calls[1].args.p_recover_only,true);assert.equal(await page.evaluate(()=>window.actualWrites),1)
  },'workspace')
  await test('점검 항목에서 정확한 동명 수업의 연결 편집을 열고 키보드 초점을 옮긴다',async()=>{
    await page.getByText('편성 전 확인할 항목 1건',{exact:true}).click()
    await button('국어 [course-a] 연결 확인').click();await courseEditor().waitFor()
    assert.match(await courseEditor().getByRole('heading').innerText(),/course-a/)
    assert.equal(await courseEditor().evaluate(node=>node===document.activeElement),true)
    assert.equal(await page.evaluate(()=>window.locked),true);assert.equal((await executeCalls()).length,0)
  })
  await test('공간 정원과 공식 교사 진단을 구별하고 준비 점검표를 내려받는다',async()=>{
    await page.evaluate(()=>{window.view.spaces[0].capacity=null;window.view.findings=[{code:'TEACHER_LEAVES_IN_TERM',targetId:'course-b',message:'학기 중 교사 배정을 확인하세요.',blocksConfirm:true}]})
    await reload();await page.getByText('편성 전 확인할 항목 3건',{exact:true}).click()
    await field('준비 점검 항목').selectOption('official');await button('공식 자료 학교 관리에서 확인').click();assert.equal(await page.evaluate(()=>window.openedAdmin),1)
    await button('준비 점검표 내려받기').click();const report=await page.evaluate(()=>window.lastBlob.text());assert.match(report,/학기 중 교사 배정/);assert.match(report,/과학실/);assert.match(report,/확정을 증명하지 않습니다/)
    await field('준비 점검 항목').selectOption('capacity');await button('과학실 [room-used] 동시 수업 수 확인').click();await roomEditor().waitFor();assert.equal(await field('동시 수업 수').inputValue(),'');assert.equal((await executeCalls()).length,0)
  })
  await test('실제 시간표 메뉴에서 엑셀 미리보기와 선택을 재진입 후 보존하고 다른 편집을 잠근다',async()=>{
    await uploadBatch();await page.waitForFunction(()=>window.locked===true)
    assert.equal(await button('공간 추가').isDisabled(),true);assert.equal(await button('확정·공유·교환').isDisabled(),true);assert.equal(await field('준비 자료 이름').isDisabled(),true)
    await page.getByRole('checkbox',{name:/국어.*course-a/}).uncheck()
    await page.evaluate(()=>{window.root.unmount();window.mount()});await button('선택한 항목 순서대로 저장').waitFor()
    assert.equal(await page.getByRole('checkbox',{name:/국어.*course-a/}).isChecked(),false);assert.equal(await field('변경 내용과 일부만 저장될 수 있음을 확인했습니다').isChecked(),false)
    await beginBatch();await page.getByText('선택한 1건을 저장했습니다.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.actualWrites),1);assert.equal(await page.evaluate(()=>window.view.courses[0].link),null)
  },'workspace')
  await test('일괄 공간·수업 저장 후에도 이전 시수·일과를 보존하고 명시적으로 새 원본을 채택한다',async()=>{
    await uploadBatch();await beginBatch();await page.getByText('선택한 2건을 저장했습니다.',{exact:true}).waitFor()
    await page.getByRole('region',{name:'공식 자료 변경 확인',exact:true}).waitFor();assert.equal(await button('준비 초안 서버에 저장').isDisabled(),true)
    await field('변경된 공식 자료를 확인했고 기존 시수·일과를 이어서 사용합니다').check();await button('입력 보존하고 현재 자료 채택').click()
    await button('준비 초안 서버에 저장').click();await page.waitForFunction(()=>window.prepWrites===1)
    assert.deepEqual(await page.evaluate(()=>window.savedPreparation.draft),await page.evaluate(()=>window.initialPreparation.draft));assert.deepEqual(await page.evaluate(()=>window.view.courses[0].link.spaceIds),['room-free']);assert.equal(await page.evaluate(()=>window.confirmed),0)
  },'preparation')
  await test('실제 시간표 메뉴에서 일괄 응답 유실을 재진입 뒤 조회 실패 중에도 원래 번호로 복구한다',async()=>{
    await uploadBatch();await page.evaluate(()=>window.dropOnce=true);await beginBatch();await button('원래 일괄 저장 요청 결과 확인').waitFor()
    assert.equal(await page.evaluate(()=>window.actualWrites),1);await page.evaluate(()=>{window.failRead=true;window.root.unmount();window.mount()})
    await button('원래 일괄 저장 요청 결과 확인').waitFor();await page.waitForFunction(()=>window.locked===true);assert.equal(await button('확정·공유·교환').isDisabled(),true)
    await button('원래 일괄 저장 요청 결과 확인').click();await page.waitForFunction(()=>window.pending.count()===0)
    const calls=await executeCalls();assert.equal(calls.length,2);assert.equal(calls[1].args.p_recover_only,true);assert.equal(calls[0].args.p_request_key,calls[1].args.p_request_key);assert.deepEqual(calls[0].args.p_command,calls[1].args.p_command);assert.equal(await page.evaluate(()=>window.actualWrites),1)
    assert.equal(await button('남은 항목 다시 확인하고 이어 저장').isDisabled(),true)
    await page.evaluate(()=>window.failRead=false);await reload();await button('공간 추가').waitFor()
    await field('변경 내용과 일부만 저장될 수 있음을 확인했습니다').check();await button('남은 항목 다시 확인하고 이어 저장').click();await page.getByText('선택한 2건을 저장했습니다.',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.actualWrites),2)
  },'workspace')
  assert.deepEqual(errors,[]);console.log('시간표 공간·수업 연결 브라우저 검사: '+count+'개 통과 · 화면: '+output)
}catch(error){console.log(await page.locator('body').innerText());throw error}finally{await browser.close()}
