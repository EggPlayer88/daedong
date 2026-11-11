// 기존 실제 HWPX 왕복 fixture를 재사용하고 AI 응답 전송만 합성한다.
import './workhub-document-collection-flow-fixture'
import { fixtureData } from '../../apps/workhub/src/preview/fixtures'
import { ASSISTANT_ROUTING } from '../../apps/workhub/src/assistant/contracts'

const w=window as any,flow=w.flow,copy=structuredClone
let thread:any=null
const envelope=(member:any,data:any)=>({contract:'assistant.v1',schoolId:member.schoolId,memberId:member.id,data:copy(data)})
flow.aiCalls=[]
w.flowRpcHook=(name:string,_args:any,member:any)=>{
 if(name==='workhub_ai_policy_threads_list')return envelope(member,{items:[],nextCursor:null})
 if(name==='workhub_ai_policy_thread_get')return envelope(member,thread)
 return undefined
}
const originalHttp=flow.handleHttp
flow.handleHttp=async(path:string,p:any)=>{
 if(path==='/api/workhub-ai/settings'||path==='/api/workhub-ai/operations')return {status:503,body:{error:{code:'NOT_READY'}}}
 if(path!=='/api/workhub-ai/chat')return originalHttp(path,p)
 const member=fixtureData.memberships.find(m=>m.id===p.memberId)
 if(!member)throw Error('시험 소속이 아닌 AI 요청')
 if(p.action==='readiness')return {body:envelope(member,{available:true})}
 if(p.action!=='ask'||p.input.intent!=='guided_collection')throw Error('예상하지 않은 AI 요청')
 flow.aiCalls.push(copy(p))
 thread={id:'guided-ai-thread',mode:p.input.mode,title:'문서 질문 검토',version:(thread?.version??0)+1,nextCursor:null,exchanges:[...(thread?.exchanges??[]),{
  id:'exchange-'+p.requestKey,requestKey:p.requestKey,intent:p.input.intent,prompt:p.input.prompt,
  segments:[{text:'입력한 학교 자료를 확인했습니다.',citations:[]}],proposal:null,createdAt:new Date().toISOString(),studentContext:null,
  ...(p.input.quality?{execution:{quality:p.input.quality,model:ASSISTANT_ROUTING.models[p.input.quality as 'quick'|'review'].id,reviewOf:p.input.reviewOf}}:{})
 }]}
 return {body:envelope(member,{state:'completed',requestKey:p.requestKey,thread})}
}
