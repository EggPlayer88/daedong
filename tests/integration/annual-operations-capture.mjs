import assert from 'node:assert/strict'
import{readFileSync}from'node:fs'
import{loadBrowserModule}from'../helpers/load-browser-module.mjs'
const a=await loadBrowserModule(`export * from '../apps/workhub/src/timetable/annual-operations';export * from '../apps/workhub/src/administration/annual-continuity'`)
const rows=JSON.parse(readFileSync(process.argv[2],'utf8'));assert(rows.length>10)
let count=0
for(const r of rows){const d=r.raw.data;if(r.kind==='preview')a.parsePeriodPreview(d,a.periodInput(r.input));else if(r.kind==='review')a.parseAnnualReview(d,r.input.from,r.input.until);else if(r.kind==='readiness')a.parseAnnualReadiness(d,d.from,d.until);else if(r.kind==='execute'){const c=a.annualCommand(r.input);assert.equal(d.requestKey,r.key);assert.equal(d.kind,c.kind);assert.equal(d.id,c.previewId??c.lessonId??c.changeId)}else throw Error('unknown capture');count++}
console.log(`AF1 PostgreSQL 실제 응답 → 앱: ${count} PASS`)
