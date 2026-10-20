import type {SupabaseConnection} from '../connection/supabase-connection'
import {createScopedRpc,ServiceError} from '../services/scoped-rpc'
import {SCHOOL_DATA_CONTRACT,maintenanceSnapshot,maintenanceIntent,maintenancePreview,maintenanceCommand,maintenanceReceipt,maintenanceClose,type SchoolDataMaintenanceServer} from './school-data-maintenance-contracts'
export function createSchoolDataMaintenanceServer(connection:SupabaseConnection,options:{timeoutMs?:number}={}):SchoolDataMaintenanceServer {
 const rpc=createScopedRpc(connection,SCHOOL_DATA_CONTRACT,options)
 const key=(k:string)=>{if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(k))throw new ServiceError('INVALID_INPUT')}
 return {get:(member,course)=>rpc.call(member,'workhub_school_data_get',{p_course_id:course},raw=>{
  const snapshot=maintenanceSnapshot(raw)
  // 직접 연결한 수업 대신 다른 상세가 온 경우에는 정정 버튼을 열지 않는다.
  if(course&&snapshot.course&&snapshot.course.id!==course)throw new ServiceError('INVALID_RESPONSE')
  return snapshot
 }),
 preview(member,input){const intent=maintenanceIntent(input);return rpc.call(member,'workhub_school_data_preview',{p_intent:intent},raw=>maintenancePreview(raw,intent))},
 commit(member,input,k){key(k);const command=maintenanceCommand(input);return rpc.call(member,'workhub_school_data_commit',{p_command:command,p_request_key:k},raw=>maintenanceReceipt(raw,command,k),true)},
 close(member,input,k){key(k);const command=maintenanceCommand(input);return rpc.call(member,'workhub_school_data_close',{p_command:command,p_request_key:k},raw=>maintenanceClose(raw,command,k),true)}}
}
