import limits from '../../../main/api/workhub-documents/_assets/guided-limits.json'
import fileLimits from '../../../main/api/collections/_assets/hwpx-basic.json'
import type { Membership } from '../contracts'
import { canonical, exact, identifier, isoDate, object, ServiceError, text, version } from '../services/scoped-rpc'
export const GUIDED_LIMITS = limits
export const GUIDED_CONTRACT = 'guided.v1'
export const GUIDED_BUCKET = 'workhub-document-files'
export type QuestionKind = 'text' | 'longtext' | 'number' | 'date' | 'select'
export interface Anchor { id: string; section: string; paragraph: number; sourceText: string; sourceHash: string; cell: { row: string; column: string } | null }
export interface Inspection { profile: 'explicit_paragraph_v1'; templateSha256: string; anchors: Anchor[]; unsupportedParagraphs: number }
export interface Question { id: string; label: string; kind: QuestionKind; required: boolean; maxLength: number; options: string[]; anchorId: string; sourceText: string; sourceHash: string }
export interface Mapping { profile: 'explicit_paragraph_v1'; templateSha256: string; questions: Question[] }
export interface Template { id: string; schoolId: string; ownerMemberId: string; title: string; version: number; state: 'draft' | 'published'; inspection: Inspection | null; mapping: Mapping | null; collectionRequestId: string | null; canManage: boolean }
export interface Artifact { artifactId: string; templateId: string; templateVersion: number; responseId: string; responseVersion: number; bytes: number; sha256: string }
export interface GuidedResponse { id: string; templateId: string; templateVersion: number; schoolId: string; ownerMemberId: string; version: number; answers: Record<string,string>; preview: boolean; artifact: Artifact | null }
export interface TemplateDetail { template: Template; response: GuidedResponse | null }
export interface CollectionTarget { requestId: string; title: string; version: number; publication?:{state:'draft'|'published';dueDate:string;unitLabels:string[];recipientCount:number} }
export type GuidedCommand =
 | {kind:'save_mapping';templateId:string;expectedVersion:number;title:string;mapping:Mapping}
 | {kind:'publish'|'publish_collection';templateId:string;expectedVersion:number;previewArtifactId:string;collectionRequestId:string;collectionVersion:number}
 | {kind:'save_answers';templateId:string;templateVersion:number;responseId:string|null;expectedVersion:number;answers:Record<string,string>;preview:boolean}
export interface GuidedReceipt {requestKey:string;templateId:string;templateVersion:number;responseId:string|null;responseVersion:number|null}
export type GuidedHttpInput={action:'inspect'|'render';memberId:string;templateId:string;templateVersion:number;responseId:string|null;responseVersion:number|null;requestKey:string}
export type GeneratedDocument={requestId:string;artifactId:string;templateId:string;templateVersion:number;blob:Blob;fileName:string}
export function sha(value:unknown):string {if(typeof value!=='string'||!/^[0-9a-f]{64}$/.test(value))throw new ServiceError('INVALID_RESPONSE');return value}
const integer=(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)throw new ServiceError('INVALID_RESPONSE');return value}
export function inspection(raw:unknown):Inspection{
 exact(raw,['profile','templateSha256','anchors','unsupportedParagraphs'])
 if(raw.profile!==limits.profile||!Array.isArray(raw.anchors)||!raw.anchors.length||raw.anchors.length>limits.maxAnchors)throw new ServiceError('INVALID_RESPONSE')
 const anchors=raw.anchors.map(a=>{exact(a,['id','section','paragraph','sourceText','sourceHash','cell']);const section=text(a.section,100,true),paragraph=integer(a.paragraph),id=text(a.id,120,true);if(!/^Contents\/section\d+\.xml$/.test(section)||id!==`${section}:p${String(paragraph).padStart(6,'0')}`)throw new ServiceError('INVALID_RESPONSE');let cell:Anchor['cell']=null;if(a.cell!==null){exact(a.cell,['row','column']);cell={row:text(a.cell.row,10),column:text(a.cell.column,10)};if(!/^\d*$/.test(cell.row)||!/^\d*$/.test(cell.column))throw new ServiceError('INVALID_RESPONSE')}return{id,section,paragraph,sourceText:text(a.sourceText,limits.maxSourceCharacters),sourceHash:sha(a.sourceHash),cell}})
 if(new Set(anchors.map(a=>a.id)).size!==anchors.length)throw new ServiceError('INVALID_RESPONSE')
 return{profile:'explicit_paragraph_v1',templateSha256:sha(raw.templateSha256),anchors,unsupportedParagraphs:integer(raw.unsupportedParagraphs)}
}
export function mapping(raw:unknown,source?:Inspection):Mapping{
 exact(raw,['profile','templateSha256','questions']);if(raw.profile!==limits.profile||!Array.isArray(raw.questions)||!raw.questions.length||raw.questions.length>limits.maxQuestions||source&&raw.templateSha256!==source.templateSha256)throw new ServiceError('INVALID_INPUT')
 const questions=raw.questions.map(q=>{exact(q,['id','label','kind','required','maxLength','options','anchorId','sourceText','sourceHash']);if(!['text','longtext','number','date','select'].includes(String(q.kind))||typeof q.required!=='boolean'||!Array.isArray(q.options)||q.options.length>limits.maxOptions)throw new ServiceError('INVALID_INPUT');const options=q.options.map(item=>text(item,200,true));if(new Set(options).size!==options.length||(q.kind==='select')!==Boolean(options.length))throw new ServiceError('INVALID_INPUT');const question:Question={id:identifier(q.id),label:text(q.label,200,true),kind:q.kind as QuestionKind,required:q.required,maxLength:integer(q.maxLength,1,limits.maxAnswerCharacters),options,anchorId:text(q.anchorId,120,true),sourceText:text(q.sourceText,limits.maxSourceCharacters),sourceHash:sha(q.sourceHash)};if(source){const anchor=source.anchors.find(a=>a.id===question.anchorId);if(!anchor||anchor.sourceText!==question.sourceText||anchor.sourceHash!==question.sourceHash)throw new ServiceError('CONFLICT')}return question})
 if(new Set(questions.map(q=>q.id)).size!==questions.length||new Set(questions.map(q=>q.anchorId)).size!==questions.length)throw new ServiceError('INVALID_INPUT')
 return{profile:'explicit_paragraph_v1',templateSha256:sha(raw.templateSha256),questions}
}
export function answers(map:Mapping,raw:unknown,complete=true):Record<string,string>{
 if(!object(raw)||Object.keys(raw).some(id=>!map.questions.some(q=>q.id===id)))throw new ServiceError('INVALID_INPUT')
 const result:Record<string,string>={};let length=0
 for(const q of map.questions){const value=text(raw[q.id]??'',q.maxLength,complete&&q.required);if(value){if(q.kind==='number'&&!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)||q.kind==='select'&&!q.options.includes(value)||q.kind!=='longtext'&&/[\r\n]/.test(value))throw new ServiceError('INVALID_INPUT');if(q.kind==='date')isoDate(value)}result[q.id]=value;length+=Array.from(value).length}
 if(length>limits.maxTotalAnswerCharacters)throw new ServiceError('INVALID_INPUT');return result
}
export function template(raw:unknown,member:Membership):Template{
 exact(raw,['id','schoolId','ownerMemberId','title','version','state','inspection','mapping','collectionRequestId','canManage'])
 if(raw.schoolId!==member.schoolId||!['draft','published'].includes(String(raw.state))||typeof raw.canManage!=='boolean'||raw.canManage&&raw.ownerMemberId!==member.id)throw new ServiceError('INVALID_RESPONSE')
 const inspected=raw.inspection===null?null:inspection(raw.inspection),map=raw.mapping===null?null:mapping(raw.mapping,inspected??undefined),requestId=raw.collectionRequestId===null?null:identifier(raw.collectionRequestId)
 if(map&&!inspected||raw.state==='published'&&(!map||!requestId)||raw.state==='draft'&&!raw.canManage)throw new ServiceError('INVALID_RESPONSE')
 return{id:identifier(raw.id),schoolId:member.schoolId,ownerMemberId:identifier(raw.ownerMemberId),title:text(raw.title,200,true),version:version(raw.version),state:raw.state as Template['state'],inspection:inspected,mapping:map,collectionRequestId:requestId,canManage:raw.canManage}
}
export function artifact(raw:unknown):Artifact{exact(raw,['artifactId','templateId','templateVersion','responseId','responseVersion','bytes','sha256']);return{artifactId:identifier(raw.artifactId),templateId:identifier(raw.templateId),templateVersion:version(raw.templateVersion),responseId:identifier(raw.responseId),responseVersion:version(raw.responseVersion),bytes:integer(raw.bytes,1,fileLimits.maxFileBytes),sha256:sha(raw.sha256)}}
export function detail(raw:unknown,member:Membership,id?:string):TemplateDetail{
 exact(raw,['template','response']);const t=template(raw.template,member);if(id&&t.id!==id)throw new ServiceError('INVALID_RESPONSE');let response:GuidedResponse|null=null
 if(raw.response!==null){const r=raw.response;exact(r,['id','templateId','templateVersion','schoolId','ownerMemberId','version','answers','preview','artifact']);if(r.schoolId!==member.schoolId||r.ownerMemberId!==member.id||r.templateId!==t.id||r.templateVersion!==t.version||typeof r.preview!=='boolean'||r.preview&&!t.canManage||!t.mapping)throw new ServiceError('INVALID_RESPONSE');const a=r.artifact===null?null:artifact(r.artifact);response={id:identifier(r.id),templateId:t.id,templateVersion:t.version,schoolId:member.schoolId,ownerMemberId:member.id,version:version(r.version),answers:answers(t.mapping,r.answers,false),preview:r.preview,artifact:a};if(a&&(a.templateId!==t.id||a.templateVersion!==t.version||a.responseId!==response.id||a.responseVersion!==response.version))throw new ServiceError('INVALID_RESPONSE')}
 return{template:t,response}
}
export function guidedCommand(raw:unknown):GuidedCommand{
 if(!object(raw))throw new ServiceError('INVALID_INPUT')
 if(raw.kind==='save_mapping'){exact(raw,['kind','templateId','expectedVersion','title','mapping']);return{kind:raw.kind,templateId:identifier(raw.templateId),expectedVersion:version(raw.expectedVersion),title:text(raw.title,200,true),mapping:mapping(raw.mapping)}}
 if(raw.kind==='publish'||raw.kind==='publish_collection'){exact(raw,['kind','templateId','expectedVersion','previewArtifactId','collectionRequestId','collectionVersion']);return{kind:raw.kind,templateId:identifier(raw.templateId),expectedVersion:version(raw.expectedVersion),previewArtifactId:identifier(raw.previewArtifactId),collectionRequestId:identifier(raw.collectionRequestId),collectionVersion:version(raw.collectionVersion)}}
 exact(raw,['kind','templateId','templateVersion','responseId','expectedVersion','answers','preview']);if(raw.kind!=='save_answers'||typeof raw.preview!=='boolean'||!object(raw.answers)||Object.keys(raw.answers).length>limits.maxQuestions)throw new ServiceError('INVALID_INPUT');const responseId=raw.responseId===null?null:identifier(raw.responseId),expectedVersion=integer(raw.expectedVersion);if((responseId===null)!==(expectedVersion===0))throw new ServiceError('INVALID_INPUT');return{kind:raw.kind,templateId:identifier(raw.templateId),templateVersion:version(raw.templateVersion),responseId,expectedVersion,answers:Object.fromEntries(Object.entries(raw.answers).map(([key,value])=>[identifier(key),text(value,limits.maxAnswerCharacters)])),preview:raw.preview}
}
export function guidedReceipt(raw:unknown,key:string,command:GuidedCommand):GuidedReceipt{exact(raw,['requestKey','templateId','templateVersion','responseId','responseVersion']);if(raw.requestKey!==key||raw.templateId!==command.templateId)throw new ServiceError('INVALID_RESPONSE');if(command.kind==='save_answers'){if(raw.templateVersion!==command.templateVersion||raw.responseVersion!==command.expectedVersion+1||command.responseId&&raw.responseId!==command.responseId)throw new ServiceError('INVALID_RESPONSE');identifier(raw.responseId)}else if(raw.templateVersion!==command.expectedVersion+1||raw.responseId!==null||raw.responseVersion!==null)throw new ServiceError('INVALID_RESPONSE');return{requestKey:key,templateId:command.templateId,templateVersion:version(raw.templateVersion),responseId:raw.responseId as string|null,responseVersion:raw.responseVersion as number|null}}
export const questionMapping=(inspection:Inspection,questions:Question[])=>mapping({profile:limits.profile,templateSha256:inspection.templateSha256,questions},inspection)
export const mappingChanged=(left:Mapping|null,right:Mapping|null)=>canonical(left)!==canonical(right)

export function publicationTargets(value:unknown):CollectionTarget[]{
 exact(value,['items']);if(!Array.isArray(value.items)||value.items.length>200)throw new ServiceError('INVALID_RESPONSE')
 const items=value.items.map(v=>{exact(v,['requestId','title','version','publication']);const p=v.publication;exact(p,['state','dueDate','unitLabels','recipientCount']);if(!['draft','published'].includes(String(p.state))||!Array.isArray(p.unitLabels)||p.unitLabels.length>100)throw new ServiceError('INVALID_RESPONSE');return{requestId:identifier(v.requestId),title:text(v.title,200,true),version:version(v.version),publication:{state:p.state as 'draft'|'published',dueDate:isoDate(p.dueDate),unitLabels:p.unitLabels.map(v=>text(v,200,true)),recipientCount:integer(p.recipientCount,1,10000)}}})
 if(new Set(items.map(t=>t.requestId)).size!==items.length)throw new ServiceError('INVALID_RESPONSE');return items
}
