// 합성 Git 원본을 실제로 변조해 원본 보존 검사가 변경을 잡는지 확인한다.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join,resolve,dirname} from 'node:path'
import {verifyPilot} from '../scripts/check-workhub-pilot.mjs'
const root=mkdtempSync(join(tmpdir(),'workhub-pilot-guard-'))
const git=(...args)=>execFileSync('git',['-c','core.autocrlf=false',...args],{cwd:root,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim()
const put=(path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body)}
let failed=0,inventory,r2
const check=()=>verifyPilot({root,inventory,r2})
function test(name,fn){try{fn();console.log('  ✓ '+name)}catch(e){failed++;console.error('  ✗ '+name+': '+e.stack)}}
function changed(path,body,pattern){const target=join(root,path),old=existsSync(target)?readFileSync(target):undefined;try{put(path,body);assert.throws(check,pattern)}finally{if(old)writeFileSync(target,old);else rmSync(target)}}
try{
 git('init','--quiet');git('config','user.name','Pilot fixture');git('config','user.email','test@example.invalid')
 put('.github/workflows/test.yml','on:\n  pull_request:\njobs: {}\n');put('packages/shared/auth.js','// 고정\n');put('database/workhub/r0/base.sql','select 1;\n');put('database/workhub/r1/base.sql','select 1;\n');put('apps/main/api/doc-ai/_assets/fixed.json','{}\n');put('apps/workhub/src/modules.ts',Array.from({length:11},(_,i)=>`{ id: 'm${i}', visibility: 'superadmin', productionEnabled: false }`).join('\n'))
 git('add','.');git('commit','--quiet','-m','합성 기준');const base=git('rev-parse','HEAD'),outside=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-m','보류 합성')
 inventory={version:1,base,app_ancestors:[43,45,46].map(number=>({number,sha:base})),excluded:[{number:44,sha:outside}]}
 r2={included:Array.from({length:17},(_,i)=>({number:i+26,sha:base})),preserved:[{number:2,sha:base}],deferred:[3,5].map(number=>({number,sha:outside})),sql_sources:[{sha:base,path:'database/workhub/r0'},{sha:base,path:'database/workhub/r1'}]}
 test('검토한 원본과 포함·보류 이력은 통과한다',()=>assert.equal(check().protected,true))
 test('승인된 신축 API 추가는 기존 인증 변경으로 오인하지 않는다',()=>{put('apps/main/api/messages/check.py','# 새 파일\n');try{check()}finally{rmSync(join(root,'apps/main/api/messages/check.py'))}})
 test('인증 원본·기존 SQL·확정 자산 수정은 모두 거부한다',()=>{changed('packages/shared/auth.js','// 변경',/원문 변경/);changed('database/workhub/r0/base.sql','select 99;',/원문 변경/);changed('apps/main/api/doc-ai/_assets/fixed.json','{"changed":true}',/원문 변경/)})
 test('미추적 migration과 별도검사기·시간표 추가도 거부한다',()=>{changed('migrations/999.sql','select 1;',/원문 변경/);changed('workers/new.py','# 변경',/원문 변경/);changed('apps/workhub/new-timetable.ts','// 엔진',/보류 시간표/)})
 test('승인 범위 밖 API와 운영 예약 실행은 거부한다',()=>{changed('apps/main/api/other.py','# 변경',/범위 밖 API/);changed('.github/workflows/test.yml','on: {schedule: []}\njobs: {}',/트리거 변경/)})
 test('메뉴 전교사 공개와 통합목록 누락은 거부한다',()=>{changed('apps/workhub/src/modules.ts',readFileSync(join(root,'apps/workhub/src/modules.ts'),'utf8').replace("visibility: 'superadmin'","visibility: 'all'"),/공개 범위/);const old=inventory.app_ancestors;inventory.app_ancestors=[];try{assert.throws(check,/목록 누락/)}finally{inventory.app_ancestors=old}})
 test('보류한 검사기 커밋을 조상으로 끼우면 거부한다',()=>{inventory.excluded[0].sha=base;try{assert.throws(check,/보류 이력 포함/)}finally{inventory.excluded[0].sha=outside}})
}finally{const resolved=resolve(root);if(dirname(resolved)!==resolve(tmpdir())||!resolved.includes('workhub-pilot-guard-'))throw Error('시험 경로 확인 실패');rmSync(resolved,{recursive:true,force:true})}
if(failed)process.exitCode=1
