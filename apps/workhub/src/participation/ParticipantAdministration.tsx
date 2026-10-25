import { useEffect, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { exact, identifier, text, version, ServiceError } from '../services/scoped-rpc'
import definitions from './scopes.json'

type Grant={memberId:string;name:string;scopes:string[];active:boolean;effective:boolean;expiresAt:string;revision:number}
export function participantAdministration(value:unknown,member:Membership){
 exact(value,['contract','schoolId','memberId','grants','timetableApprovers','interventionsReady'])
 if(value.contract!=='workhub.participant-admin.v1'||value.schoolId!==member.schoolId||value.memberId!==member.id||!Array.isArray(value.grants)||!Number.isSafeInteger(value.timetableApprovers)||(value.timetableApprovers as number)<0||typeof value.interventionsReady!=='boolean')throw new ServiceError('INVALID_RESPONSE')
 const seen=new Set<string>()
 const grants=value.grants.map(g=>{
  exact(g,['memberId','name','scopes','active','effective','expiresAt','revision'])
  const id=identifier(g.memberId);if(seen.has(id))throw new ServiceError('INVALID_RESPONSE');seen.add(id)
  if(!Array.isArray(g.scopes)||!g.scopes.length||new Set(g.scopes).size!==g.scopes.length||g.scopes.some(s=>!definitions.some(d=>d.id===s&&d.requires.every(r=>(g.scopes as unknown[]).includes(r))))||typeof g.active!=='boolean'||typeof g.effective!=='boolean'||(g.effective&&!g.active)||typeof g.expiresAt!=='string'||!Number.isFinite(Date.parse(g.expiresAt)))throw new ServiceError('INVALID_RESPONSE')
  return {memberId:id,name:text(g.name,200,true),scopes:g.scopes as string[],active:g.active,effective:g.effective,expiresAt:g.expiresAt,revision:version(g.revision)} as Grant
 })
 return {grants,timetableApprovers:value.timetableApprovers as number,interventionsReady:value.interventionsReady}
}
export function ParticipantAdministration({connection,member}:{connection:SupabaseConnection;member:Membership}){
 const [data,setData]=useState<ReturnType<typeof participantAdministration>>(),[error,setError]=useState(''),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0)
 const sequence=useRef(0)
 useEffect(()=>{
  let alive=true;const n=++sequence.current;setData(undefined);setError('');setLoading(true)
  const deadline=setTimeout(()=>{if(alive&&n===sequence.current){sequence.current++;setLoading(false);setError('조회 시간이 길어지고 있습니다. 다시 확인해 주세요.')}},10000)
  void connection.rpcVerified('workhub_participant_administration',{p_member_id:member.id}).then(value=>{
   if(alive&&n===sequence.current)setData(participantAdministration(value,member))
  }).catch(()=>{if(alive&&n===sequence.current)setError('업무 참여 설정을 불러오지 못했습니다. OP1 설치와 현재 관리 권한을 확인해 주세요.')}).finally(()=>{if(alive&&n===sequence.current){clearTimeout(deadline);setLoading(false)}})
  const stop=connection.subscribeInvalidation(()=>{sequence.current++;setData(undefined);setLoading(false);setError('계정 또는 학교 권한을 다시 확인해 주세요.')})
  return()=>{alive=false;sequence.current++;clearTimeout(deadline);stop()}
 },[connection,member.id,member.schoolId,member.userId,attempt])
 return <section aria-label="업무 참여 설정"><h3>업무 참여 설정</h3><p>지정 계정의 이용 범위와 만료를 조회합니다. 이 화면에서 회원 역할이나 허용 목록을 바꾸지 않습니다.</p><button disabled={loading} onClick={()=>setAttempt(n=>n+1)}>현재 설정 다시 확인</button>
 {loading&&<p role="status">설정을 확인하고 있습니다…</p>}{error&&<p role="alert">{error}</p>}
 {data&&<><p>허용 중 {data.grants.filter(g=>g.effective).length}명 · 등록 {data.grants.length}명</p><p>시간표 승인 담당 {data.timetableApprovers}명 · 대강·보강 운영 {data.interventionsReady?'준비됨':'추가 설정 필요'}</p>
 <p>승인 담당자가 2명이어도 요청자·영향 교사를 제외한 독립 승인자가 있어야 해당 요청을 승인할 수 있습니다.</p>
 {data.grants.length?<table><thead><tr><th>참여자</th><th>허용 업무</th><th>상태</th><th>종료 시각</th><th>판</th></tr></thead><tbody>{data.grants.map(g=><tr key={g.memberId}><td>{g.name}<small> [{g.memberId}]</small></td><td>{g.scopes.map(s=>definitions.find(d=>d.id===s)?.label).join(' · ')}</td><td>{g.effective?'이용 가능':g.active?'기간·소속 확인 필요':'중지'}</td><td>{new Date(g.expiresAt).toLocaleString('ko-KR')}</td><td>{g.revision}</td></tr>)}</tbody></table>:<p>지정한 참여 계정이 없습니다. 기존 관리자 이용 범위는 유지됩니다.</p>}
 <p>참여 허용은 수업 담당 배정이나 관리자 승인을 대신하지 않습니다. 메신저만 허용한 MP1 계정은 이 목록과 별도입니다.</p></>}
 </section>
}
