import type { Assessment, CourseSnapshot, Observation, Rubric, Student, TeachingAdapter, TeachingScope } from './contracts'
import { TeachingError } from './contracts'
import { courseResponse, range, rubricValue, studentResponse } from './validation'
import { scoreStateLabels, validateScores } from './assessment'
import { csvHash, safeCsv } from './csv'
import { canonical } from '../services/scoped-rpc'
import policy from './record-export-policy.json'

export const RECORD_EXPORT_NOTICE = '선택한 수업·학생·기간에서 현재 계정이 조회할 수 있는 관찰·평가의 현재 판입니다. 상담, 활동 원문, 이전 정정판 전체 이력은 포함하지 않습니다. 공식 생활기록부 제출 양식이 아닙니다.'
export interface RecordExportSelection { firstDay:string; lastDay:string; observations:boolean; assessments:boolean; includeWithdrawn:boolean }
export interface RecordExportRow {
  id:string; kind:'observation'|'assessment'; occurredOn:string; state:'active'|'withdrawn'; version:number;
  sourceReviewRequired:boolean; confirmed:boolean|null; text:string; rubricLabel:string; rubricVersion:number|null;
  scores:string[]; total:number|null; revisionId:string; contentHash:string; epoch:number; rubricRevisionId:string|null;
}
export interface RecordExportReport { courseId:string; courseLabel:string; student:Student; selection:RecordExportSelection; rows:RecordExportRow[]; fingerprint:string; checkedAt:string }
export class RecordExportError extends Error {
  constructor(readonly code:'INPUT'|'CHANGED'|'INCOMPLETE'|'RESPONSE'|'CANCELLED'|'POPUP',message:string){super(message);this.name='RecordExportError'}
}
export function validateExportSelection(value:RecordExportSelection):RecordExportSelection {
  try {
    if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['firstDay','lastDay','observations','assessments','includeWithdrawn'].includes(k))||typeof value.observations!=='boolean'||typeof value.assessments!=='boolean'||typeof value.includeWithdrawn!=='boolean'||(!value.observations&&!value.assessments))throw new Error()
    range(value.firstDay,value.lastDay)
    return structuredClone(value)
  } catch { throw new RecordExportError('INPUT','시작일·종료일을 확인하고 출력할 기록 종류를 하나 이상 선택해 주세요.') }
}
function response<T>(read:()=>T):T {
  try{return read()}catch(f){if(f instanceof TeachingError&&f.code==='FORBIDDEN')throw f;throw new RecordExportError('RESPONSE','받은 기록의 학생·수업·판 또는 형식을 확인할 수 없어 출력을 중단했습니다. 자료를 다시 확인해 주세요.')}
}
function changed():never {throw new RecordExportError('CHANGED','조회 중 학생·수업 또는 기록이 달라졌습니다. 미리보기를 다시 만들어 주세요.')}
const context=(snapshot:CourseSnapshot,student:Student)=>({course:snapshot.course,student})
export async function readRecordExport(adapter:TeachingAdapter,scope:TeachingScope,courseId:string,studentId:string,input:RecordExportSelection,isCurrent:()=>boolean=()=>true):Promise<RecordExportReport> {
  const selection=validateExportSelection(input)
  const guard=()=>{if(!isCurrent())throw new RecordExportError('CANCELLED','학교·학생 또는 조회 상태가 달라져 출력을 중단했습니다.')}
  const readCourse=async()=>{guard();const raw=await adapter.course(scope.memberId,courseId);guard();return response(()=>courseResponse(raw,scope,courseId))}
  const course=await readCourse(),student=course.students.find(s=>s.id===studentId)
  if(!student)throw new TeachingError('FORBIDDEN','현재 수업에서 이 학생의 기록을 확인할 수 없습니다.')
  const initialContext=canonical(context(course,student)),seen=new Set<string>(),cursors=new Set<string>(),rows:RecordExportRow[]=[],rubrics=new Map<string,Rubric>()
  let cursor:string|null=null,pages=0,count=0,bytes=0,firstPage=''
  const readPage=async(value:string|null)=>{guard();const raw=await adapter.student(scope.memberId,courseId,studentId,value);guard();return response(()=>studentResponse(raw,scope,courseId,studentId))}
  const selected=(r:Observation|Assessment)=>r.occurredOn>=selection.firstDay&&r.occurredOn<=selection.lastDay&&(selection.includeWithdrawn||r.state==='active')
  const encoder=new TextEncoder()
  do {
    if(++pages>policy.limits.pages)throw new RecordExportError('INCOMPLETE','한 번에 확인할 수 있는 페이지 수를 넘었습니다. 일부 기록만 전체처럼 출력하지 않습니다.')
    const page=await readPage(cursor)
    if(pages===1)firstPage=canonical(page)
    for(const [kind,records] of [['observation',page.observations],['assessment',page.assessments]] as const) {
      for(const record of records) {
        const key=kind+':'+record.id
        if(seen.has(key))changed()
        seen.add(key);count++;bytes+=encoder.encode(canonical(record)).byteLength
        if(count>policy.limits.records||bytes>policy.limits.textBytes)throw new RecordExportError('INCOMPLETE','한 번에 확인할 수 있는 기록 용량을 넘었습니다. 일부 기록만 전체처럼 출력하지 않습니다.')
        if(!selected(record)||(kind==='observation'?!selection.observations:!selection.assessments))continue
        const common={id:record.id,kind,occurredOn:record.occurredOn,state:record.state,version:record.version,sourceReviewRequired:record.sourceReviewRequired,revisionId:record.revisionId,contentHash:record.contentHash,epoch:record.epoch}
        if(kind==='observation'){rows.push({...common,text:(record as Observation).text,confirmed:null,rubricLabel:'',rubricVersion:null,rubricRevisionId:null,scores:[],total:null});continue}
        const assessment=record as Assessment,rubricKey=assessment.rubricId+':'+assessment.rubricRevisionId
        let rubric=rubrics.get(rubricKey)
        if(!rubric){
          rubric=course.rubrics.find(r=>r.id===assessment.rubricId&&r.revisionId===assessment.rubricRevisionId)
          if(!rubric){guard();rubric=await adapter.rubricRevision(scope.memberId,courseId,assessment.rubricId,assessment.rubricRevisionId);guard()}
          const candidate=rubric
          rubric=response(()=>{const r=rubricValue(candidate,scope,courseId);if(r.id!==assessment.rubricId||r.revisionId!==assessment.rubricRevisionId)throw new Error();return r})
          rubrics.set(rubricKey,rubric)
        }
        response(()=>validateScores(assessment.scores,rubric.criteria))
        const scores=rubric.criteria.map(c=>{const s=assessment.scores.find(s=>s.criterionKey===c.key)!;return c.label+' · '+scoreStateLabels[s.state]+(s.points===null?'':' '+s.points+' / '+c.maximum+'점')})
        rows.push({...common,text:assessment.comment,confirmed:assessment.confirmed,rubricLabel:rubric.label,rubricVersion:rubric.version,rubricRevisionId:rubric.revisionId,scores,total:assessment.total})
      }
    }
    cursor=page.nextCursor
    if(cursor!==null){if(cursors.has(cursor))changed();cursors.add(cursor)}
  } while(cursor!==null)
  // 순차 조회 중 명부 변경과 첫 페이지 이동을 발견하면 불완전한 출력을 만들지 않는다.
  const finalCourse=await readCourse(),finalStudent=finalCourse.students.find(s=>s.id===studentId)
  if(!finalStudent||canonical(context(finalCourse,finalStudent))!==initialContext)changed()
  if(canonical(await readPage(null))!==firstPage)changed()
  rows.sort((a,b)=>a.occurredOn.localeCompare(b.occurredOn)||a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id))
  const contents={courseId,courseLabel:course.course.label,student,selection,rows}
  const fingerprint=await csvHash(canonical(contents));guard()
  return {...contents,fingerprint,checkedAt:new Date().toISOString()}
}
export const recordStateLabel=(row:RecordExportRow)=>row.state==='withdrawn'?'철회됨 · 참고용':'유효'
export const recordReviewLabel=(row:RecordExportRow)=>row.sourceReviewRequired?'근거 재검토 필요':'재검토 표시 없음'
export const recordConfirmationLabel=(row:RecordExportRow)=>row.confirmed===null?'해당 없음':row.confirmed?'교사 확인 완료':'교사 미확인'
// 공백·개행 뒤의 수식 시작도 보호한 뒤 공통 CSV 따옴표 처리를 사용한다.
export function recordExportCsv(report:RecordExportReport):string {
  const protect=(v:string|number|null)=>typeof v==='string'&&/^\s*[=+@-]/u.test(v)?"'"+v:v
  const rows=report.rows.map(r=>[report.courseLabel,report.student.name,report.student.grade,report.student.classLabel,report.student.seatNumber,report.selection.firstDay,report.selection.lastDay,r.kind==='observation'?'관찰':'평가',r.occurredOn,recordStateLabel(r),r.version,recordReviewLabel(r),recordConfirmationLabel(r),r.text,r.rubricLabel,r.rubricVersion,r.scores.join('\n'),r.total,RECORD_EXPORT_NOTICE].map(protect))
  return safeCsv(policy.headers,rows)
}
