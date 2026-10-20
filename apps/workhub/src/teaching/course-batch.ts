import { TeachingError, type TeachingCatalog, type TeachingCommand, type MutationReceipt, type TeachingScope } from './contracts'
import { validateCommand } from './commands'
import { parseCsv, safeCsv } from './csv'
import { receiptResponse } from './validation'
import policy from './policy.json'
import fields from './course-batch-fields.json'

export type CourseCreateCommand = Extract<TeachingCommand, { kind:'course_create' }>
export interface CourseBatchRow {
  rowNumber:number; label:string; term:string; subject:string; teachers:string[]; validFrom:string; validThrough:string
}
export interface CourseBatchMapping { terms:Record<string,string>; subjects:Record<string,string>; teachers:Record<string,string> }
export interface CourseBatchReview { row:CourseBatchRow; command:CourseCreateCommand|null; problems:string[] }
export interface CourseBatchAttempt {
  rowNumber:number; key:string; command:CourseCreateCommand; status:'unknown'|'saved'|'rejected'; message:string; receipt?:MutationReceipt
}
export interface CourseBatchDraft {
  raw:string; mapping:CourseBatchMapping; selected:number[]; attempts:CourseBatchAttempt[]
}
export const courseBatchLimit = Math.min(policy.limits.csvRows, policy.limits.catalogEntries)
export const courseBatchHeaders = fields.headers
export const blankCourseBatch = ():CourseBatchDraft => ({raw:'',mapping:{terms:{},subjects:{},teachers:{}},selected:[],attempts:[]})
export const courseBatchTemplate = () => safeCsv(fields.headers,[])
export const courseBatchRowsCsv = (rows:CourseBatchRow[]) => safeCsv(fields.headers,rows.map(r=>[r.label,r.term,r.subject,r.teachers.join(fields.teacherSeparator),r.validFrom,r.validThrough]))
export function courseBatchResultsCsv(rows:CourseBatchRow[],attempts:CourseBatchAttempt[]):string {
  return safeCsv(fields.resultHeaders,rows.map(row=>{
    const a=attempts.find(a=>a.rowNumber===row.rowNumber)
    return [String(row.rowNumber),row.label,a?.status==='saved'?'저장 확인':a?.status==='unknown'?'결과 미확인':a?.status==='rejected'?'거절':'미전송',a?.key??'',a?.receipt?.entityId??'',a?.message??'']
  }))
}
const fail=(message:string):never=>{throw new TeachingError('INVALID_INPUT',message)}

export function parseCourseBatch(raw:string):CourseBatchRow[] {
  const [headers,...rows]=parseCsv(raw)
  if(headers.length!==fields.headers.length||headers.some((h,i)=>h!==fields.headers[i]))return fail(`첫 행은 ${fields.headers.join(', ')} 순서여야 합니다.`)
  if(!rows.length)return fail('등록할 수업을 한 행 이상 입력해 주세요.')
  if(rows.length>courseBatchLimit)return fail(`한 번에 ${courseBatchLimit}개 수업까지 나누어 입력해 주세요.`)
  return rows.map(([label,term,subject,teachers,validFrom,validThrough],i)=>({
    rowNumber:i+2,label:label.trim(),term:term.trim(),subject:subject.trim(),
    teachers:teachers.split(fields.teacherSeparator).map(t=>t.trim()),validFrom:validFrom.trim(),validThrough:validThrough.trim(),
  }))
}
export function courseBatchTokens(rows:CourseBatchRow[]) {
  return {
    terms:[...new Set(rows.map(r=>r.term).filter(Boolean))],
    subjects:[...new Set(rows.map(r=>r.subject).filter(Boolean))],
    teachers:[...new Set(rows.flatMap(r=>r.teachers).filter(Boolean))],
  }
}
function sameCourse(a:CourseCreateCommand['input'],b:{label:string;termId:string;subjectId:string;validFrom:string;validThrough:string}) {
  return a.label.trim().normalize('NFC')===b.label.trim().normalize('NFC')&&a.termId===b.termId&&a.subjectId===b.subjectId&&a.validFrom<=b.validThrough&&b.validFrom<=a.validThrough
}
// 명칭으로 추정하지 않고 사용자가 지정한 공식 식별자와 현재 목록을 함께 검증한다.
export function reviewCourseBatch(rows:CourseBatchRow[],mapping:CourseBatchMapping,catalog:TeachingCatalog):CourseBatchReview[] {
  const own=(table:Record<string,string>,token:string)=>Object.hasOwn(table,token)?table[token]:''
  const reviews=rows.map(row=>{
    const problems:string[]=[]
    const term=catalog.terms.find(t=>t.id===own(mapping.terms,row.term))
    const subject=catalog.subjects.find(s=>s.id===own(mapping.subjects,row.subject))
    const teachers=row.teachers.map(t=>catalog.approvedTeachers.find(x=>x.id===own(mapping.teachers,t)))
    if(!catalog.canManageCourses)problems.push('현재 계정의 수업 등록 권한을 확인해 주세요.')
    if(!term)problems.push('학기를 공식 목록에서 연결해 주세요.')
    if(!subject)problems.push('교과를 공식 목록에서 연결해 주세요.')
    if(!row.teachers.length||teachers.some(t=>!t))problems.push('담당 교사를 공식 목록에서 모두 연결해 주세요.')
    let command:CourseCreateCommand|null=null
    if(term&&subject&&teachers.length&&teachers.every(t=>t)) {
      try {
        command=validateCommand({kind:'course_create',input:{label:row.label,termId:term.id,subjectId:subject.id,teacherMemberIds:teachers.map(t=>t!.id).sort(),validFrom:row.validFrom,validThrough:row.validThrough}}) as CourseCreateCommand
        if(row.validFrom<term.firstDay||row.validThrough>term.lastDay)problems.push(`기간은 선택한 학기(${term.firstDay} ~ ${term.lastDay}) 안이어야 합니다.`)
        if(catalog.courses.some(c=>sameCourse(command!.input,c)))problems.push('같은 이름·학기·교과의 기간이 겹치는 수업이 이미 있습니다. 기존 수업을 확인해 주세요.')
      }catch(f){problems.push(f instanceof TeachingError?f.message:'수업 이름·담당·기간을 확인해 주세요.')}
    }
    return {row,command,problems}
  })
  for(let i=0;i<reviews.length;i++)for(let j=i+1;j<reviews.length;j++) {
    const a=reviews[i],b=reviews[j]
    if(a.command&&b.command&&sameCourse(a.command.input,b.command.input)) {
      a.problems.push(`${b.row.rowNumber}행과 수업 이름·학기·교과·기간이 겹칩니다.`)
      b.problems.push(`${a.row.rowNumber}행과 수업 이름·학기·교과·기간이 겹칩니다.`)
    }
  }
  return reviews
}
export function courseBatchBasis(catalog:TeachingCatalog):string {
  const byId=<T extends {id:string}>(values:T[])=>[...values].sort((a,b)=>a.id.localeCompare(b.id))
  return JSON.stringify({
    schoolId:catalog.schoolId,memberId:catalog.memberId,ownerUserId:catalog.ownerUserId,canManageCourses:catalog.canManageCourses,
    terms:byId(catalog.terms),subjects:byId(catalog.subjects),approvedTeachers:byId(catalog.approvedTeachers),courses:byId(catalog.courses),
  })
}
export function startCourseBatchAttempt(review:CourseBatchReview,key:string,attempts:CourseBatchAttempt[]):CourseBatchAttempt {
  if(!review.command||review.problems.length)return fail('오류 없는 수업만 선택해 주세요.')
  if(attempts.some(a=>a.status==='unknown'))return fail('결과를 모르는 수업의 원래 요청부터 확인해 주세요.')
  if(attempts.some(a=>a.rowNumber===review.row.rowNumber&&a.status==='saved'))return fail('이미 저장한 수업은 다시 보내지 않습니다.')
  if(attempts.some(a=>a.key===key))return fail('이미 사용한 요청 번호입니다.')
  return {rowNumber:review.row.rowNumber,key,command:structuredClone(review.command),status:'unknown',message:'서버의 저장 결과를 확인하고 있습니다.'}
}
export function finishCourseBatchAttempt(attempt:CourseBatchAttempt,value:unknown,scope:TeachingScope):CourseBatchAttempt {
  // 어댑터 대체/시험에서도 다른 행의 접수증으로 완료 처리되지 않게 한다.
  try {
    const receipt=receiptResponse(value,scope,attempt.command,attempt.key)
    return {...attempt,status:'saved',message:'서버 저장 확인',receipt}
  }catch {throw new TeachingError('SAVE_UNCERTAIN','수업 접수증이 원래 요청과 맞지 않습니다. 원래 번호로 결과를 다시 확인해 주세요.')}
}
export function failCourseBatchAttempt(attempt:CourseBatchAttempt,failure:unknown,recovering:boolean):CourseBatchAttempt {
  const definitive=!recovering&&failure instanceof TeachingError&&['INVALID_INPUT','NOT_FOUND','CONFLICT','FORBIDDEN','UNAVAILABLE'].includes(failure.code)
  return {...attempt,status:definitive?'rejected':'unknown',message:failure instanceof TeachingError?failure.message:'서버 결과를 확인하지 못했습니다. 원래 요청 번호를 보존했습니다.'}
}
