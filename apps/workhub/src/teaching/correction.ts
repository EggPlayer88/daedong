import { TeachingError,type ActivityCorrectionCommand,type ActivitySnapshot } from './contracts'
import { validateActivityInput } from './csv'
import { object,identifier,text,integer,hash,array,unique } from './validation'
const bad=(message='정정 전후의 모든 행과 처리 사유를 확인해 주세요.'):never=>{throw new TeachingError('INVALID_INPUT',message)}
function exact(v:Record<string,unknown>,keys:string[]){if(Object.keys(v).some(k=>!keys.includes(k))||keys.some(k=>!(k in v)))bad()}
export function validateActivityCorrection(raw:unknown,previous?:ActivitySnapshot):ActivityCorrectionCommand{
 const c=object(raw);exact(c,['kind','courseId','assignmentId','previousImportId','expectedVersion','expectedFileHash','input','correspondence']);if(c.kind!=='activity_correct')bad();identifier(c.courseId);identifier(c.assignmentId);identifier(c.previousImportId);integer(c.expectedVersion);hash(c.expectedFileHash)
 const input=object(c.input);exact(input,['label','occurredOn','questionVersion','questionSnapshot','kind','parserVersion','rawCsv','fileHash','headers','rows','supersedesImportId']);validateActivityInput(input as never);if(input.supersedesImportId!==c.previousImportId)bad('정정 대상 활동 ID가 다릅니다.');if(input.fileHash===c.expectedFileHash)bad('같은 원문 파일입니다. 학생 연결만 고칠 때는 연결 변경 기능을 사용해 주세요.')
 const map=object(c.correspondence);exact(map,['reason','previousRows','rows','omitted']);text(map.reason,2000)
 const old=unique(array(map.previousRows,500).map(raw=>{const r=object(raw);exact(r,['itemId','itemVersion']);identifier(r.itemId);integer(r.itemVersion);return r}),r=>String(r.itemId));if(!old.length)bad()
 const rows=unique(array(map.rows,500).map(raw=>{const r=object(raw);exact(r,['rowNumber','previousItemId','reason']);integer(r.rowNumber,2,501);if(r.previousItemId!==null)identifier(r.previousItemId);text(r.reason,2000,r.previousItemId!==null);if(r.previousItemId!==null&&!old.some(o=>o.itemId===r.previousItemId))bad();return r}),r=>String(r.rowNumber))
 unique(rows.filter(r=>r.previousItemId!==null),r=>String(r.previousItemId))
 const omitted=unique(array(map.omitted,500).map(raw=>{const r=object(raw);exact(r,['itemId','reason']);identifier(r.itemId);text(r.reason,2000);if(!old.some(o=>o.itemId===r.itemId))bad();return r}),r=>String(r.itemId))
 const nextRows=input.rows as {rowNumber:number}[];if(rows.length!==nextRows.length||rows.some(r=>!nextRows.some(n=>n.rowNumber===r.rowNumber)))bad('정정판의 일부 행이 대응 표에서 빠졌습니다.')
 for(const item of old){const mappings=rows.filter(r=>r.previousItemId===item.itemId).length,omissions=omitted.filter(r=>r.itemId===item.itemId).length;if(mappings+omissions!==1)bad('이전의 모든 행을 새 행에 연결하거나 제외 사유를 적어 주세요.')}
 if(previous){if(previous.state!=='active'||previous.importId!==c.previousImportId||previous.courseId!==c.courseId||previous.version!==c.expectedVersion||previous.fileHash!==c.expectedFileHash)bad('이전 활동 원문판이 달라졌습니다. 새 정정을 시작해 주세요.');if(previous.kind!==input.kind)bad('수업 CSV 형식은 원문 정정에서 바꿀 수 없습니다.');if(old.length!==previous.items.length||old.some(o=>!previous.items.some(i=>i.id===o.itemId&&i.version===o.itemVersion)))bad('정정 준비 이후 학생 연결이 바뀌었습니다. 원문을 다시 확인해 주세요.')}
 return structuredClone(c) as unknown as ActivityCorrectionCommand
}
