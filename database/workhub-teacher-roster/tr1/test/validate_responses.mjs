import { readFileSync } from 'node:fs'
import { loadBrowserModule } from '../../../../tests/helpers/load-browser-module.mjs'
const m=await loadBrowserModule(`export * from '../apps/workhub/src/teacher-roster/contracts'; export * from '../apps/workhub/src/teacher-roster/published'`)
let n=0
for(const {name,args,data} of JSON.parse(readFileSync(process.argv[2],'utf8'))){
 if(name.endsWith('_get'))m.snapshot(data)
 else if(name.endsWith('_preview'))m.preview(data,args[1])
 else if(name.endsWith('_commit'))m.receipt(data,args[1],args[2])
 else if(name.endsWith('_close'))m.closeResult(data,args[1],args[2])
 else if(name.endsWith('_published'))m.published(data,args[1])
 else throw Error(name)
 n++
}
console.log('실제 PostgreSQL 응답 × 앱 parser',n,'통과')
