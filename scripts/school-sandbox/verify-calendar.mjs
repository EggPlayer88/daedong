import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'

// 휴업·교환 시나리오를 시작하기 전의 초기 자료를 모든 날짜·수업 ID까지 대조한다.
const path=process.argv[2],root=dirname(path),school=JSON.parse(readFileSync(join(root,'school.json'))),states=JSON.parse(readFileSync(join(root,'timetables.json')))
const c=await connectSandbox(loadSecrets(path))
try{await assertMarker(c)
 const rows=(await c.query("select term_id,activity_id,occurrence_date::text as day from workhub.timetable_lessons where school_id=$1 and state<>'cancelled'",[school.schoolId])).rows
 const actual=new Set(rows.map(r=>[r.term_id,r.day,r.activity_id].join(':'))),expected=new Set()
 assert.equal(actual.size,rows.length,'같은 날짜 수업 중복')
 for(const term of school.terms){const state=states[term.termNo],slots=new Map(state.basis.slots.map(s=>[s.id,s]))
  for(let t=Date.parse(term.firstDay);t<Date.parse(term.lastDay);t+=86400000){const d=new Date(t),day=d.toISOString().slice(0,10),weekday=d.getUTCDay()
   for(const p of state.placements){if(slots.get(p.slotId)?.day===weekday)expected.add([term.id,day,p.lessonId].join(':'))}
  }
 }
 assert.equal(actual.size,expected.size,'연간 수업 수');for(const key of expected)assert.ok(actual.has(key),'누락 '+key)
 const result={at:new Date().toISOString(),lessons:actual.size,terms:school.terms.length,firstDay:school.terms[0].firstDay,until:school.terms.at(-1).lastDay,result:'PASS'}
 writeFileSync(join(root,'calendar-verification.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
}finally{await c.end()}
