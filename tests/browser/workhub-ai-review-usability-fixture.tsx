import {createRoot} from 'react-dom/client'
import {AssistantPanel} from '../../apps/workhub/src/assistant/AssistantPanel'
import {AssistantDock} from '../../apps/workhub/src/app/AssistantDock'
import type {Membership} from '../../apps/workhub/src/contracts'
import type {AssistantServer, AssistantThread} from '../../apps/workhub/src/assistant/contracts'
const config=(window as any).reviewConfig??{},qa=(window as any).qa={calls:[] as any[],closed:0,delivered:0}
const member:Membership={id:'m',userId:'u',schoolId:'s',name:'가상 교사',role:'teacher',active:true,validFrom:'2026-01-01',validThrough:'2027-02-28',gradeIds:[],subjectIds:[],departmentIds:[]}
const thread:AssistantThread={id:'thread',version:1,mode:'school',title:'검토용 답변',nextCursor:null,exchanges:[{
  id:'answer',requestKey:'original-ask',intent:config.guided?'guided_collection':'document_draft',prompt:'학교 업무 안내문 초안',createdAt:'2026-11-13T00:00:00Z',studentContext:null,proposal:null,
  segments:[{text:'첫 번째 일반 안내',citations:[]},{text:'두 번째 일반 안내',citations:[]},{text:'세 번째 일반 안내',citations:[]}],
}]}
const server:AssistantServer={readiness:async()=>({available:true}),list:async()=>({items:[{id:thread.id,version:1,mode:'school',title:thread.title,updatedAt:'2026-11-13T00:00:00Z'}],nextCursor:null}),
  get:async()=>structuredClone(thread),ask:async()=>{throw Error('이 시험에서는 유료 호출 금지')},confirmTask:async()=>{throw Error('이 시험에서는 저장 금지')}}
const connection:any={info:()=>({schools:[],memberships:[member],basisDate:'2026-11-13'}),getIdentity:async()=>({userId:member.userId,approved:true})}
createRoot(document.getElementById('root')!).render(<AssistantDock open contextLabel="시험" onClose={()=>qa.closed++}>
 <AssistantPanel memoryEnabled={false} connection={connection} member={member} date="2026-11-13" server={server}
   settingsServer={{status:async()=>{throw Error('합성 예산') }} as any} guidedDraftContextIds={[]}
   onDraftReady={()=>{qa.delivered++;throw Error('원본 양식을 다시 선택해 주세요. 답변은 유지했습니다.')}}
   workspaceActions={{availablePages:['assistant','tasks','calendar','messages','collections','timetable'],availableSearchKinds:['task'],operations:{prepareTask:async()=>{throw Error('조회만 시험')},prepareCalendar:async()=>{throw Error('조회만 시험')},execute:async()=>{throw Error('저장 금지')}},navigate:()=>true,calendar:()=>true,open:()=>true,
     search:async(query,kinds)=>{qa.calls.push({query,kinds});return{items:[],coverage:[],hasMore:false}}}} />
</AssistantDock>)
