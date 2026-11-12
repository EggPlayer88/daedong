import type {Membership} from '../contracts'
import {recoveryScope} from '../services/recovery-scope'
import type {WorkflowResult,WorkflowResultListener} from '../app/workflow-results'
import type {KnowledgeReceipt} from './contracts'

export function reportKnowledgeResult(listener:WorkflowResultListener|undefined,member:Membership,
 action:Extract<WorkflowResult,{kind:'knowledge'}>['action'],receipt:KnowledgeReceipt){
 try{listener?.({kind:'knowledge',action,scope:recoveryScope(member),key:receipt.requestKey,recordedAt:receipt.recordedAt,sourceId:receipt.id,sourceVersion:receipt.version})}catch{
  // 보조 목록 표시 실패가 확인한 저장을 미확정으로 되돌리거나 원문을 다시 보내지 않는다.
 }
}
