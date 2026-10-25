import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {prepareP7Bridge} from '../scripts/prepare-workhub-p7-05.mjs'

const original=readFileSync(new URL('../database/workhub/p7/P7-05_R1_P2_보강_별도승인.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n')
let count=0
const check=(name,run)=>{run();count++;console.log('  ✓ '+name)}
check('확정 원본과 다른 실행문을 입력하면 준비 단계부터 거부한다',()=>{
 assert.throws(()=>prepareP7Bridge(original.replace('due_change_revision >= 1','due_change_revision >= 0'),'시험','승인'),/확정 원본/)
 assert.throws(()=>prepareP7Bridge(original+'\n','시험','승인'),/확정 원본/)
})
check('LF와 CRLF 원본에서 같은 실행본을 만들고 승인 두 칸만 채운다',()=>{
 const result=prepareP7Bridge(original,'시험','명시 승인')
 assert.equal(result,prepareP7Bridge(original.replace(/\n/g,'\r\n'),'시험','명시 승인'))
 const restore=result.replace("md5(replace(prosrc, E'\\r\\n', E'\\n'))",'md5(prosrc)').replace(/DECLARE p jsonb := '[^\n]*'::jsonb;/,original.match(/DECLARE p jsonb := \$json\$\n[\s\S]*?\n\$json\$::jsonb;/)[0])
 assert.equal(restore,original)
})
check('운영에서 관찰한 CRLF 지문과 승인된 LF 지문은 같은 본문이다',()=>{
 const r1=readFileSync(new URL('../database/workhub/r1/R1-02_수합_원본.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n')
 const body=r1.match(/CREATE FUNCTION workhub_private\.collections_guard\(\)[\s\S]*?AS \$\$([\s\S]*?)\$\$/)?.[1]
 assert.ok(body,'R1 collections_guard 원본 본문')
 const hash=text=>createHash('md5').update(text).digest('hex')
 assert.equal(hash(body),'192396592ea201a158dcadb4b92d7b33')
 assert.equal(hash(body.replace(/\n/g,'\r\n')),'835e7055c3ae358acdc94f780a887a9e')
 assert.notEqual(hash((body+' ').replace(/\r\n/g,'\n')),hash(body))
 assert.notEqual(hash(body.replace(/\n/,'\r').replace(/\r\n/g,'\n')),hash(body))
})
check('승인 누락·한도 초과·입력 칸 표시는 거부하고 따옴표는 SQL 문자열 안에 보존한다',()=>{
 for(const args of [['','승인'],['시험',''],['시험','<미입력>'],['시험','a'.repeat(201)],['시험','승인\n줄']])assert.throws(()=>prepareP7Bridge(original,...args))
 const result=prepareP7Bridge(original,"교사's",'승인 $&')
 assert.ok(result.includes('"approved_by":"교사\'\'s"'))
 assert.ok(result.includes('"approval_ref":"승인 $&"'))
})
console.log(`P7 보강 실행본 ${count}건 통과`)
