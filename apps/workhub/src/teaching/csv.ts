import { studentGradeLimit } from './school-limits'
import policy from './policy.json'
import { TeachingError, type ActivityKind, type ActivityRow, type ActivityImportInput, type RosterRow, type Student } from './contracts'
const fail = (message: string): never => { throw new TeachingError('INVALID_INPUT', message) }

// RFC 4180의 따옴표·셀 안 줄바꿈을 읽는다. 정정과 출처 대조를 위해 원문 자체는 바꾸지 않는다.
export function parseCsv(raw: string): string[][] {
  if(typeof raw!=='string'||new TextEncoder().encode(raw).length>policy.limits.csvBytes) return fail('CSV는 2 MiB 이하로 나누어 올려 주세요.')
  const input=raw.startsWith('\uFEFF')?raw.slice(1):raw
  const rows:string[][]=[];let row:string[]=[],cell='',state:'start'|'plain'|'quoted'|'closed'='start'
  const finishCell=()=>{if(cell.length>policy.limits.cellCharacters)fail('한 칸의 내용이 너무 깁니다. 원본을 확인해 주세요.');row.push(cell);cell='';state='start';if(row.length>100)fail('열이 너무 많습니다.')}
  const finishRow=()=>{finishCell();rows.push(row);row=[];if(rows.length>policy.limits.csvRows+1)fail('한 번에 500행까지 가져올 수 있습니다.')}
  for(let i=0;i<input.length;i++) {const ch=input[i]
    if(ch==='\u0000')return fail('CSV에 읽을 수 없는 문자가 있습니다.')
    if(state==='quoted') {if(ch==='"') {if(input[i+1]==='"'){cell+='"';i++}else state='closed'}else cell+=ch;continue}
    if(ch===','){finishCell();continue}
    if(ch==='\r'||ch==='\n'){if(ch==='\r'&&input[i+1]==='\n')i++;finishRow();continue}
    if(state==='closed')return fail('닫는 따옴표 뒤에 잘못된 내용이 있습니다.')
    if(ch==='"'){if(state!=='start')return fail('CSV 따옴표 형식이 올바르지 않습니다.');state='quoted';continue}
    cell+=ch;state='plain'
    if(cell.length>policy.limits.cellCharacters)return fail('한 칸의 내용이 너무 깁니다.')
  }
  if(state==='quoted')return fail('CSV의 닫는 따옴표가 없습니다.')
  if(cell!==''||row.length||state==='closed'||input.endsWith(','))finishRow()
  if(!rows.length||rows[0].every(v=>v===''))return fail('CSV의 첫 행에 항목 이름이 필요합니다.')
  if(new Set(rows[0]).size!==rows[0].length||rows[0].some(v=>!v))return fail('빈 항목 이름이나 중복된 항목 이름이 있습니다.')
  if(rows.some(r=>r.length!==rows[0].length))return fail('행마다 열 개수가 다릅니다. 원본 CSV를 확인해 주세요.')
  return rows
}
function profileMatches(headers: string[], expected: readonly string[]): boolean {return headers.length===expected.length&&headers.every((h,i)=>h===expected[i])}
export function parseRosterCsv(raw: string): RosterRow[] {
  const [headers,...rows]=parseCsv(raw)
  if(!profileMatches(headers,policy.rosterHeaders))return fail('명부 항목은 학교내학생번호, 이름, 학년, 반, 번호 순서여야 합니다.')
  if(!rows.length)return fail('가져올 학생이 없습니다.')
  const ids=new Set<string>(), seats=new Set<string>()
  return rows.map(([schoolStudentKey,name,gradeText,classLabel,seatText],i)=>{
    if(!schoolStudentKey.trim()||schoolStudentKey.length>120||!name.trim()||name.length>120||!classLabel.trim()||classLabel.length>40||!/^[1-9]\d*$/.test(gradeText)||!/^[1-9]\d*$/.test(seatText))return fail(`${i+2}행의 학생 번호·이름·학년·반·번호를 확인해 주세요.`)
    const grade=Number(gradeText),seatNumber=Number(seatText);if(grade>studentGradeLimit||seatNumber>999)return fail(`${i+2}행의 학년이나 번호를 확인해 주세요.`)
    if(ids.has(schoolStudentKey))return fail(`${i+2}행의 학교내학생번호가 중복됩니다.`)
    const seat=JSON.stringify([grade,classLabel,seatNumber]);if(seats.has(seat))return fail(`${i+2}행의 학년·반·번호가 중복됩니다.`)
    ids.add(schoolStudentKey);seats.add(seat)
    return {schoolStudentKey,name,grade,classLabel,seatNumber}
  })
}
export function parseActivityCsv(rawCsv: string, kind: ActivityKind): { headers: string[]; rows: ActivityRow[] } {
  if(!Object.hasOwn(policy.activityProfiles,kind))return fail('확인된 수업 CSV 형식을 선택해 주세요.')
  const [headers,...values]=parseCsv(rawCsv)
  if(!profileMatches(headers,policy.activityProfiles[kind]))return fail('선택한 수업의 CSV 항목과 다릅니다. 현재는 자율주행·의료 AI와 AI 수행평가 형식을 지원합니다. 개인정보 수업 등 다른 형식은 변환하지 않고 원본을 유지해 주세요.')
  if(!values.length)return fail('가져올 학생 활동이 없습니다.')
  return {headers,rows:values.map((values,i)=>({rowNumber:i+2,alias:values[0],values,disposition:'hold',studentId:null,courseMembershipId:null,reason:''}))}
}
export async function csvHash(raw: string): Promise<string> { const bytes=new TextEncoder().encode(raw);const result=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('') }
export async function readCsvFile(file: File): Promise<string> { if(file.size>policy.limits.csvBytes||!file.name.toLowerCase().endsWith('.csv'))return fail('UTF-8 CSV 파일을 선택해 주세요. 최대 2 MiB입니다.');try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer())}catch{return fail('UTF-8로 저장한 CSV가 필요합니다. 엑셀에서 CSV UTF-8 형식으로 다시 저장해 주세요.')} }
export function validateActivityInput(input: ActivityImportInput, students?: readonly Student[]): ActivityImportInput {
  const parsed=parseActivityCsv(input.rawCsv,input.kind)
  if(input.parserVersion!=='digital-ethics.csv.v1'||!input.label?.trim()||input.label.length>120||!input.questionVersion?.trim()||input.questionVersion.length>120||!input.questionSnapshot?.trim()||input.questionSnapshot.length>policy.limits.recordCharacters||!/^\d{4}-\d{2}-\d{2}$/.test(input.occurredOn)||!Number.isFinite(Date.parse(input.occurredOn))||new Date(input.occurredOn).toISOString().slice(0,10)!==input.occurredOn||!/^[a-f0-9]{64}$/.test(input.fileHash))return fail('활동 이름·날짜·질문판과 질문 원문을 확인해 주세요.')
  if(JSON.stringify(parsed.headers)!==JSON.stringify(input.headers)||!Array.isArray(input.rows)||input.rows.length!==parsed.rows.length)return fail('CSV 원문과 확인 목록이 다릅니다.')
  const used=new Map<string,ActivityRow[]>()
  input.rows.forEach((row,i)=>{
    const original=parsed.rows[i]
    if(!row||typeof row!=='object'||Object.keys(row).some(k=>!['rowNumber','alias','values','disposition','studentId','courseMembershipId','reason'].includes(k)))return fail('행의 처리 정보가 올바르지 않습니다.')
    if(row.rowNumber!==original.rowNumber||row.alias!==original.alias||JSON.stringify(row.values)!==JSON.stringify(original.values)||!['hold','adopt','exclude'].includes(row.disposition)||typeof row.reason!=='string'||row.reason.length>2000)return fail('활동 원문이나 처리 상태가 올바르지 않습니다.')
    if(row.disposition==='adopt') {
      if(!row.studentId||!row.courseMembershipId)return fail(`${row.rowNumber}행을 채택할 학생을 직접 확인해 주세요.`)
      if(students) {const s=students.find(s=>s.id===row.studentId&&s.courseMembershipId===row.courseMembershipId);if(!s||input.occurredOn<s.validFrom||input.occurredOn>s.validThrough)return fail(`${row.rowNumber}행의 수강 학생과 활동 날짜를 확인해 주세요.`)}
      used.set(row.studentId,[...(used.get(row.studentId)??[]),row])
    } else {if(row.studentId!==null||row.courseMembershipId!==null)return fail('보류·제외한 행은 학생과 연결하지 않습니다.');if(row.disposition==='exclude'&&!row.reason.trim())return fail(`${row.rowNumber}행의 제외 사유를 적어 주세요.`)}
  })
  for(const rows of used.values())if(rows.length>1&&rows.some(r=>!r.reason.trim()))return fail('여러 별명을 같은 학생에게 연결할 때는 각 행에 확인 사유가 필요합니다.')
  return structuredClone(input)
}
export function assessmentActivityCells(headers: readonly string[], values: readonly string[]): {label:string;value:string}[] {return headers.flatMap((label,i)=>i<3||policy.assessmentExcludedHeaders.includes(label)||!values[i]?.trim()?[]:[{label,value:values[i]}])}
export function safeCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {const cell=(value:unknown)=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,"'$&").replaceAll('"','""')+'"';return '\uFEFF'+[headers,...rows].map(r=>r.map(cell).join(',')).join('\r\n')}
