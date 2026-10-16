import type { EventDraft, Membership } from '../contracts'
import type { RelationOptions } from './contracts'
import { normalizeDraft } from '../domain'
import { parseImportTable, prepareImportRows, unmappedImportColumns, type ImportMapping } from './import-table'
import { canonical, sha256, object, exact, text, id, digest, array, integer, unique, invalid } from '../cooperation/protocol'
import { BATCH_LIMIT, type BatchInput, type BatchPreview, type BatchCommit, type BatchPreviewRow } from './batch-contracts'
function checkedBatchDraft(raw: unknown, member: Membership, members: Membership[]): EventDraft {
 const value = object(raw)
 exact(value, ['title','description','location','startDate','endDate','allDay','startTime','endTime','visibility','audience'])
 const audience = object(value.audience)
 exact(audience, ['all','groups','includeMemberIds','excludeMemberIds'])
 array(audience.groups, 100).forEach(raw => exact(object(raw), ['departmentIds','gradeIds','subjectIds']))
 return normalizeDraft(value as unknown as EventDraft, member, members)
}

// 대상 ID는 집합이다. 로캘에 따른 이름순 대신 PostgreSQL C 정렬과 같은 코드포인트 순을 쓴다.
// 포함·제외에 함께 있는 ID는 그대로 두어 서버의 제외 우선 규칙을 바꾸지 않는다.
function orderedMemberIds(values: string[]): string[] {
 return [...new Set(values)].sort((left, right) => {
  const a = Array.from(left), b = Array.from(right)
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
   const difference = a[index].codePointAt(0)! - b[index].codePointAt(0)!
   if (difference) return difference
  }
  return a.length - b.length
 })
}
function orderedBatchDraft(draft: EventDraft): EventDraft {
 return { ...draft, audience: { ...draft.audience,
  includeMemberIds: orderedMemberIds(draft.audience.includeMemberIds),
  excludeMemberIds: orderedMemberIds(draft.audience.excludeMemberIds),
 } }
}
export function batchDraft(raw: unknown, member: Membership, members: Membership[]): EventDraft {
 return orderedBatchDraft(checkedBatchDraft(raw, member, members))
}
export async function buildBatchInput({raw,mapping,sourceKey,sourceLabel,visibility,omissionsConfirmed,member,members}:{raw:string;mapping:ImportMapping;sourceKey:string;sourceLabel:string;visibility:'school'|'private';omissionsConfirmed:boolean;member:Membership;members:Membership[]}):Promise<{input:BatchInput;held:{line:number;sourceId:string;title:string;errors:string[]}[]}>{
 id(sourceKey);text(sourceLabel,160);if(!['school','private'].includes(visibility))invalid();const table=parseImportTable(raw),unmapped=unmappedImportColumns(table,mapping);if(mapping.sourceId<0)invalid('반복 가져오기는 고정된 원본 ID 열이 필요합니다.');if(unmapped.length&&!omissionsConfirmed)invalid('가져오지 않는 열을 확인해 주세요.');const parsed=prepareImportRows(table,mapping,member,members),held=[] as {line:number;sourceId:string;title:string;errors:string[]}[],rows=[] as BatchInput['rows']
 for(const row of parsed){if(!row.sourceId||!row.draft||row.errors.length){held.push({line:row.line,sourceId:row.sourceId,title:row.title,errors:row.sourceId?row.errors:['원본 ID가 없습니다.',...row.errors]});continue}if(row.sourceId.length>160||/[\u0000-\u001f]/.test(row.sourceId)){held.push({line:row.line,sourceId:row.sourceId,title:row.title,errors:['원본 ID는 제어문자 없이 160자 이하여야 합니다.']});continue}const draft=batchDraft({...row.draft,visibility},member,members);rows.push({key:row.key,line:row.line,sourceId:row.sourceId,sourceHash:await sha256(canonical(draft)),draft})}
 if(!rows.length)invalid('확인할 수 있는 일정이 없습니다. 보류된 행의 입력을 확인해 주세요.');if(rows.length>BATCH_LIMIT)invalid(`한 번에 ${BATCH_LIMIT}개 일정까지 비교합니다. 원본을 나누어 주세요.`)
 return {input:{sourceKey,sourceLabel,fileHash:await sha256(raw),omittedColumns:unmapped.map(c=>c.label),rows},held}
}
export async function validateBatchInput(raw: unknown, member: Membership, members: Membership[]): Promise<BatchInput> {
 const value = object(raw)
 exact(value, ['sourceKey','sourceLabel','fileHash','omittedColumns','rows'])
 id(value.sourceKey); text(value.sourceLabel, 160); digest(value.fileHash)
 array(value.omittedColumns, 30).forEach(item => text(item, 500, true))
 const rows = unique(array(value.rows, BATCH_LIMIT).map(raw => {
  const row = object(raw)
  exact(row, ['key','line','sourceId','sourceHash','draft'])
  id(row.key); integer(row.line, 2, 1000); text(row.sourceId, 160); digest(row.sourceHash)
  return { ...row, draft: checkedBatchDraft(row.draft, member, members) } as unknown as BatchInput['rows'][number]
 }), row => row.key)
 unique(rows, row => row.sourceId)
 if (!rows.length) invalid()
 // 새 비교 요청에서만 정렬한다. 먼저 받은 원문 지문을 확인해 변조를 정규화로 감추지 않는다.
 // 저장 결과가 미상인 commit의 sourceHash·previewHash·요청 번호는 이 경로를 거치지 않는다.
 for (const row of rows) {
  if (await sha256(canonical(row.draft)) !== row.sourceHash) invalid('일정 원문 지문이 다릅니다.')
  row.draft = orderedBatchDraft(row.draft)
  row.sourceHash = await sha256(canonical(row.draft))
 }
 return { ...structuredClone(value), rows } as BatchInput
}
export function batchCommit(preview:BatchPreview,selected:string[],confirmedConflicts:string[]):BatchCommit{const keys=unique(selected,id),conflicts=new Set(confirmedConflicts);const selections=keys.map(key=>{const row=preview.rows.find(r=>r.key===key);if(!row||['held','duplicate'].includes(row.state))return invalid();if(row.state==='conflict'&&!conflicts.has(key))invalid('충돌하는 일정은 전체 항목을 비교하고 교체에 동의해 주세요.');return {key:row.key,sourceId:row.sourceId,sourceHash:row.sourceHash,eventId:row.eventId,expectedVersion:row.expectedVersion,decision:row.state==='new'?'create' as const:row.state==='conflict'?'replace_conflict' as const:'update' as const}});return validateBatchCommit({kind:'calendar_batch_commit',prepareId:preview.prepareId,previewHash:preview.previewHash,selections})}
export function validateBatchCommit(raw:unknown):BatchCommit{const v=object(raw);exact(v,['kind','prepareId','previewHash','selections']);if(v.kind!=='calendar_batch_commit')invalid();id(v.prepareId);digest(v.previewHash);const selections=unique(array(v.selections,BATCH_LIMIT).map(raw=>{const s=object(raw);exact(s,['key','sourceId','sourceHash','eventId','expectedVersion','decision']);id(s.key);text(s.sourceId,160);digest(s.sourceHash);if(s.decision==='create'){if(s.eventId!==null||s.expectedVersion!==null)invalid()}else if(['update','replace_conflict'].includes(String(s.decision))){id(s.eventId);integer(s.expectedVersion)}else invalid();return s}),s=>String(s.key));unique(selections,s=>String(s.sourceId));if(!selections.length)invalid('저장할 일정을 직접 선택해 주세요.');return structuredClone(v) as unknown as BatchCommit}
function audienceLabel(d:EventDraft,members:Membership[],labels?:RelationOptions):string{const a=d.audience,names=(ids:string[])=>ids.map(id=>members.find(m=>m.id===id)?.name??`이름 확인 필요 (${id})`).join(', '),relation=(key:keyof RelationOptions,ids:string[])=>ids.map(id=>labels?.[key].find(v=>v.id===id)?.name??`이름 확인 필요 (${id})`).join(', ');const groups=a.groups.map((g,index)=>`조건 ${index+1}: `+([['departmentIds','부서'],['gradeIds','학년'],['subjectIds','교과']] as const).filter(([key])=>g[key].length).map(([key,name])=>`${name} ${relation(key,g[key])}`).join(' 및 '));return [a.all?'모든 교사 대상':'조건에 맞는 교사 대상',...groups,a.includeMemberIds.length?'직접 포함: '+names(a.includeMemberIds):'',a.excludeMemberIds.length?'직접 제외 우선: '+names(a.excludeMemberIds):''].filter(Boolean).join(' / ')}
export function comparisonFields(row:BatchPreviewRow,members:Membership[]=[],labels?:RelationOptions):{label:string;baseline:string;current:string;incoming:string}[]{const values=(d:EventDraft|null):string[]=>d?[d.title,d.description,d.location,d.startDate,d.endDate,d.allDay?'종일':'시간 지정',d.startTime,d.endTime,d.visibility==='school'?'학교 공개':d.visibility==='private'?'나만 보기':'대상 지정',audienceLabel(d,members,labels)]:Array(10).fill('없음');const before=values(row.baseline),current=values(row.current),incoming=values(row.incoming);return ['제목','설명','장소','시작일','종료일','시간 종류','시작 시간','종료 시간','공개 범위','대상 조건'].map((label,i)=>({label,baseline:before[i],current:current[i],incoming:incoming[i]}))}
