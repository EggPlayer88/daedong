import assert from 'node:assert/strict'
import {readFileSync}from'node:fs'
import{loadBrowserModule}from'../../../../tests/helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/timetable/roster-bridge-contracts'`)
const rows=JSON.parse(readFileSync(process.argv[2],'utf8'));let n=0
for(const r of rows){if(r.name==='get')m.rosterOperatingChoices(r.data);else if(r.name==='preview')m.rosterOperatingPreview(r.data,r.args[1]);else if(r.name==='commit')m.rosterOperatingReceipt(r.data,r.args[1],r.args[2]);else if(r.name==='close'){assert(['closed','applied'].includes(r.data.outcome));if(r.data.outcome==='applied')m.rosterOperatingReceipt(r.data.receipt,r.args[1],r.args[2]);else assert.equal(r.data.receipt,null)}else throw Error(r.name);n++}
console.log('TR2 실제 SQL 응답 × 앱 parser '+n+' 통과')
