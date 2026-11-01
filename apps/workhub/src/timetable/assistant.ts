import type { TimetableBasis, Placement } from '../../../../packages/timetable/src/types'
import { validateBasis, validatePlacements } from '../../../../packages/timetable/src/validate'
import { canonical, exact, identifier, text, ServiceError, object } from '../services/service-values'
import { timetableConditions } from './server'
import type { TimetableConditions } from './contracts'
import limits from './limits.json'
import enginePolicy from '../../../../packages/timetable/_assets/browser-policy.json'
import { strongerPreferenceWeight } from './condition-policy'
import { reviewTimetablePreflight } from './preflight'
export type TimetableAiStage = 'setup' | 'adjust'
export interface TimetableAiContext {
  contract: 'timetable-assistant.v1'; stage: TimetableAiStage; basisId: string; basisRevision: number
  sourceFingerprint: string; contextFingerprint: string; prompt: string; basis: TimetableBasis; placements: Placement[]
}
export type TimetableAiChange = {kind:'fix';lessonId:string;slotId:string} | {kind:'block';resourceId:string;slotId:string} | {kind:'prefer';lessonId:string;slotId:string;weight:number}
export interface TimetableAiProposal {
  contract:'timetable-assistant.v1'; stage:TimetableAiStage; basisId:string; basisRevision:number
  sourceFingerprint:string; contextFingerprint:string; summary:string; questions:string[]; changes:TimetableAiChange[]
}
const fail = ():never => { throw new ServiceError('INVALID_INPUT') }
async function fingerprint(value: unknown): Promise<string> {
  const bytes=new TextEncoder().encode(canonical(value))
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('')
}
export async function buildTimetableAiContext(basis:TimetableBasis,conditions:TimetableConditions,stage:TimetableAiStage,prompt:string,placements:Placement[]=[]):Promise<TimetableAiContext> {
  if(!['setup','adjust'].includes(stage))fail()
  text(prompt,limits.assistantText,true)
  const input={...basis,...timetableConditions(conditions,basis)}
  if(!validateBasis(input).valid || input.unsupportedFeatures.length)fail()
  if(stage==='setup' ? placements.length!==0 : !validatePlacements(input,placements).valid)fail()
  const data={contract:'timetable-assistant.v1' as const,stage,basisId:basis.id,basisRevision:basis.revision,sourceFingerprint:basis.sourceFingerprint,prompt,basis:structuredClone(input),placements:structuredClone(placements)}
  return {...data,contextFingerprint:await fingerprint(data)}
}
export function parseTimetableAiProposal(raw:unknown,context:TimetableAiContext):TimetableAiProposal {
  exact(raw,['contract','stage','basisId','basisRevision','sourceFingerprint','contextFingerprint','summary','questions','changes'])
  for(const key of ['contract','stage','basisId','basisRevision','sourceFingerprint','contextFingerprint'] as const)if(raw[key]!==context[key])throw new ServiceError('CONFLICT')
  text(raw.summary,limits.assistantText,true)
  const questions=raw.questions,values=raw.changes
  if(!Array.isArray(questions)||questions.length>limits.proposalQuestions || !Array.isArray(values)||values.length>limits.proposalChanges)return fail()
  questions.forEach(q=>text(q,limits.questionText,true))
  const changes=values.map((value:unknown)=>{
    if(!object(value))return fail()
    const kind=value.kind
    identifier(value.slotId)
    if(kind==='fix'||kind==='prefer'){
      exact(value,kind==='fix'?['kind','lessonId','slotId']:['kind','lessonId','slotId','weight'])
      const lesson=context.basis.lessons.find(l=>l.id===value.lessonId)
      if(!lesson||!lesson.allowedSlotIds.includes(String(value.slotId)))fail()
      if(kind==='prefer'&&(!Number.isSafeInteger(value.weight)||(value.weight as number)<0||(value.weight as number)>enginePolicy.maxWeight))fail()
    }else if(kind==='block'){
      exact(value,['kind','resourceId','slotId']);identifier(value.resourceId)
      if(!context.basis.resources.some(r=>r.id===value.resourceId)||!context.basis.slots.some(s=>s.id===value.slotId))fail()
    }else fail()
    return structuredClone(value) as TimetableAiChange
  })
  if(new Set(changes.map(canonical)).size!==changes.length)fail()
  return {...raw,changes} as unknown as TimetableAiProposal
}
export interface TimetableAiPreview {
  conditions: TimetableConditions
  preferences: { index: number; before: number | null; proposed: number; after: number }[]
  warnings: string[]
}
/** 제안 전체를 미리 검사한다. 표시와 반영은 같은 규칙을 쓰며 원래 조건은 변경하지 않는다. */
export function previewTimetableAiProposal(raw: unknown, context: TimetableAiContext): TimetableAiPreview {
  const proposal=parseTimetableAiProposal(raw,context), currentBasis=context.basis
  if(proposal.questions.length)fail()
  const next=timetableConditions({fixed:currentBasis.fixed,unavailable:currentBasis.unavailable,preferences:currentBasis.preferences},currentBasis)
  const preferences: TimetableAiPreview['preferences']=[]
  for(const [index,change] of proposal.changes.entries()){
    if(change.kind==='fix'){
      const old=next.fixed.find(p=>p.lessonId===change.lessonId)
      if(old&&old.slotId!==change.slotId)fail()
      if(!old)next.fixed.push({lessonId:change.lessonId,slotId:change.slotId})
    }else if(change.kind==='block'){
      const slot=currentBasis.slots.find(s=>s.id===change.slotId)!
      const blocked={resourceId:change.resourceId,day:slot.day,startMinute:slot.startMinute,endMinute:slot.endMinute}
      if(!next.unavailable.some(row=>canonical(row)===canonical(blocked)))next.unavailable.push(blocked)
    }else{
      const old=next.preferences.find(p=>p.lessonId===change.lessonId&&p.slotId===change.slotId)
      const weight=strongerPreferenceWeight(old?.weight,change.weight)
      preferences.push({index,before:old?.weight??null,proposed:change.weight,after:weight})
      next.preferences=next.preferences.filter(p=>p.lessonId!==change.lessonId||p.slotId!==change.slotId)
      next.preferences.push({lessonId:change.lessonId,slotId:change.slotId,weight})
    }
  }
  const conditions=timetableConditions(next,currentBasis),proof=reviewTimetablePreflight({...currentBasis,...conditions})
  return {conditions,preferences,warnings:proof.issues.map(issue=>issue.message)}
}
// AI는 조건 제안만 한다. 사람 확인 후에도 엔진 검증을 통과해야 초안을 저장할 수 있다.
export async function applyTimetableAiProposal(raw:unknown,context:TimetableAiContext,currentBasis:TimetableBasis,currentConditions:TimetableConditions,currentPlacements:Placement[],confirmed:boolean):Promise<TimetableConditions> {
  if(confirmed!==true)fail()
  raw=structuredClone(raw);context=structuredClone(context);currentBasis=structuredClone(currentBasis);currentConditions=structuredClone(currentConditions);currentPlacements=structuredClone(currentPlacements)
  const fresh=await buildTimetableAiContext(currentBasis,currentConditions,context.stage,context.prompt,currentPlacements)
  if(fresh.contextFingerprint!==context.contextFingerprint)throw new ServiceError('CONFLICT')
  return previewTimetableAiProposal(raw,fresh).conditions
}
// 실제 Claude 연결은 기존 비용 승인·단일 실행권을 확장한 별도 서버 계약으로 붙인다.
// 이 인터페이스에는 저장·공개·메시지 전송 도구를 주지 않는다.
export interface TimetableAiGateway { propose(context: TimetableAiContext,requestKey: string):Promise<unknown> }
export async function requestTimetableAiProposal(gateway:TimetableAiGateway,context:TimetableAiContext,requestKey:string):Promise<TimetableAiProposal>{
  text(requestKey,200,true);if(requestKey.length<8)fail()
  context=structuredClone(context)
  const {contextFingerprint,...payload}=context
  if(await fingerprint(payload)!==contextFingerprint)fail()
  return parseTimetableAiProposal(await gateway.propose(structuredClone(context),requestKey),context)
}
