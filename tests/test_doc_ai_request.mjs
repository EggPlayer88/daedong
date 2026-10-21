import assert from 'node:assert/strict'
import {createDocAiAttempt,docAiRequestBody,classifyDocAiReply,saveDocAiSession,readDocAiSession} from '../apps/main/src/lib/docAiRequest.js'
let passed=0;const test=(name,run)=>{run();passed++;console.log('  ✓ '+name)}
const messages=[{role:'user',content:'보존할 질문'}],key='request-key-one'
test('기본 요청과 복구는 번호·내용·선택 방식을 유지한다',()=>{const a=createDocAiAttempt(messages,'review',key);messages[0].content='바꾼 입력';assert.deepEqual(docAiRequestBody(a,true),{requestKey:key,quality:'review',messages:[{role:'user',content:'보존할 질문'}],recoverOnly:true})})
test('형식·한도 오류를 전송 전에 거절한다',()=>{for(const v of [[],[{role:'system',content:'x'}],[{role:'user',content:''}],[{role:'user',content:'x'.repeat(80001)}],Array(81).fill({role:'user',content:'x'})])assert.throws(()=>createDocAiAttempt(v,'quick',key));assert.throws(()=>createDocAiAttempt(messages,'expensive',key))})
test('완료 접수는 원번호·정상응답형식을 요구한다',()=>{const good={state:'completed',requestKey:key,reply:'답변',stop_reason:'end_turn'};assert.equal(classifyDocAiReply(good,key),'completed');assert.equal(classifyDocAiReply({...good,requestKey:'another'},key),'unknown');assert.equal(classifyDocAiReply({...good,reply:null},key),'unknown')})
test('missing은 같은키 재접수만, 원장 종료만 잠금해제 판정한다',()=>{assert.equal(classifyDocAiReply({state:'missing',requestKey:key},key),'missing');assert.equal(classifyDocAiReply({state:'pending',requestKey:key},key),'unknown');assert.equal(classifyDocAiReply({state:'failed',requestKey:key,code:'COUNT_FAILED'},key),'failed');assert.equal(classifyDocAiReply({state:'failed',requestKey:key},key),'unknown')})
test('현재탭 기억은 계정별로 분리하고 저장입력 참조를 공유하지 않는다',()=>{const a={messages:[{role:'user',content:'학교 자료'}]};saveDocAiSession('user-one',a);a.messages[0].content='변경';assert.equal(readDocAiSession('user-one').messages[0].content,'학교 자료');assert.equal(readDocAiSession('user-two'),undefined)})
console.log('평가계획 AI 원요청 '+passed+'건 통과')
