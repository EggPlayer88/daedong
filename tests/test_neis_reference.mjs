import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {neisDatabase} from './helpers/neis-db.mjs'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'
const {db,member,value,as,sql}=await neisDatabase()
const m=await loadBrowserModule("export * from '../apps/workhub/src/neis/contracts'")
let count=0
const ck=async(name,fn)=>{await fn();count++;console.log('  ✓ '+name)}
try{
 await db.query("UPDATE workhub.schools SET name='대동여자중학교' WHERE id=$1",[member.school_id])
 await db.query("UPDATE neis_private.connections SET school_name='대동여자중학교' WHERE school_id=$1",[member.school_id])
 const context=await as('authenticated',()=>value('workhub_context')),actor=context.memberships.find(x=>x.id===member.id)
 const base='docs/neis/reference-2026/',manifest=JSON.parse(sql(base+'manifest.json'))
 for(const dataset of manifest.datasets)await ck('공개 '+dataset.kind+' 원본 '+dataset.rows+'건 적재·앱 대조·중복 거절',async()=>{
  const json=sql(base+dataset.kind+'.json')
  assert.equal(createHash('sha256').update(json).digest('hex'),dataset.jsonSha256)
  await db.exec(sql(base+dataset.sqlFile))
  const r={kind:dataset.kind,year:2026,from:dataset.from,to:dataset.to}
  const status=await as('authenticated',()=>value('workhub_neis_status',[member.id,r.kind,r.year,r.from,r.to]))
  assert.equal(m.snapshot(status,r,actor,context.memberships).rows.length,dataset.rows)
  await assert.rejects(db.exec(sql(base+dataset.sqlFile)),/이미 있습니다/)
  await db.exec('ROLLBACK')
 })
 await ck('초기 원본 준비는 기존 일정과 수업에 반영하지 않는다',async()=>{
  assert.equal((await db.query('SELECT count(*) n FROM workhub.events')).rows[0].n,0)
  assert.equal((await db.query('SELECT count(*) n FROM neis_private.schedule_sources WHERE event_id IS NOT NULL')).rows[0].n,0)
  const timetable=JSON.parse(sql(base+'timetable.json'));assert.ok(timetable.every(x=>x.semester===2))
  assert.equal(new Set(timetable.map(x=>x.grade+':'+x.className)).size,9)
 })
 console.log('전부 통과 ('+count+')')
}catch(e){console.error(e.message);process.exitCode=1}finally{await db.close()}
