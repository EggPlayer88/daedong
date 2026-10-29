import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../helpers/load-browser-module.mjs'
const a=await loadBrowserModule(`export * from '../apps/workhub/src/collections/presentation';export {publicationTargets,guidedCommand,guidedReceipt} from '../apps/workhub/src/documents/guided-contracts'`)
const rows=JSON.parse(readFileSync(process.argv[2],'utf8'));assert(rows.length>20)
let count=0,errors=0
for(const r of rows){assert.equal(r.raw.contract,'collection.presentation.v1');if(r.raw.error){assert.equal(typeof r.raw.error.code,'string');errors++;continue}const d=r.raw.data;if(r.op==='statuses')a.parseCollectionStatuses(d,r.input.ids);else if(r.op==='targets')a.publicationTargets(d);else if(r.op==='publish'||r.op==='recover')a.guidedReceipt(d,r.key,a.guidedCommand(r.input));else throw Error('unknown capture');count++}
assert(count>=10);assert(errors>=10)
console.log(`AF2 PostgreSQL 실제 응답 → 앱: ${count} PASS · 오류 응답 ${errors}건`)
