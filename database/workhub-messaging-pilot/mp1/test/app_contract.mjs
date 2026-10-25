import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {loadBrowserModule} from '../../../../tests/helpers/load-browser-module.mjs'
const fixture=JSON.parse(readFileSync(process.argv[2],'utf8'))
const m=await loadBrowserModule(`
 export {parseMessagingPilot} from '../apps/main/src/lib/messaging-pilot.js';
 export {createSupabaseConnection} from '../apps/workhub/src/connection/supabase-connection.ts';
 export {createSupabaseMessagingServer} from '../apps/workhub/src/messaging/supabase-messaging.ts';
 export {createMessageFileServer} from '../apps/workhub/src/messaging/files.ts';
`,{env:{MODE:'test',VITE_SUPABASE_URL:'https://example.invalid',VITE_SUPABASE_ANON_KEY:'synthetic'}})
assert.ok(m.parseMessagingPilot(fixture.access,fixture.profile,fixture.profile.id))
const responses={workhub_messaging_pilot_context:fixture.context,workhub_messaging_readiness:fixture.readiness,workhub_message_recipients:fixture.recipients,workhub_message_threads:fixture.threads,workhub_message_get:fixture.thread,workhub_message_file_readiness:fixture.fileReadiness}
const calls=[]
const c=m.createSupabaseConnection({getSession:async()=>({user:{id:fixture.profile.id}}),fetchMyProfile:async()=>({...fixture.profile,department_id:null}),rpc:async name=>{calls.push(name);assert.ok(name in responses,name);return{data:responses[name],error:null}}},{messagingPilot:true})
const context=await c.loadContext(fixture.schoolId)
assert.equal(context.memberships.length,1);assert.equal(context.memberships[0].id,fixture.memberId)
const server=m.createSupabaseMessagingServer(c)
assert.ok((await server.readiness(fixture.memberId)).available)
assert.ok((await server.recipients(fixture.memberId,'')).items.length>0)
const threads=await server.threads(fixture.memberId,'',false);assert.ok(threads.items.length>0)
const messages=await server.messages(fixture.memberId,fixture.thread.data.thread.id);assert.ok(messages.items.length>0)
assert.ok((await m.createMessageFileServer(c).readiness(fixture.memberId)).available)
assert.equal(calls.includes('workhub_context'),false)
console.log('PASS 실제 SQL 응답→일반 교사 앱 허용·단일 소속·메시지·첨부 parser 7종')
