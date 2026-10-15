import { TeachingError, type Observation, type Assessment, type TeachingScope } from './contracts'
export interface RecordEvidence { kind:'observation'|'assessment'; id:string; revisionId:string; schoolId:string; ownerUserId:string; studentId:string; sourceHash:string; epoch:number; text:string }
export interface EvidenceReference {kind:RecordEvidence['kind'];id:string;revisionId:string;sourceHash:string;epoch:number;start:number;end:number}
export interface RecordSentence {text:string;evidence:EvidenceReference[]}
export function recordEvidence(observations:readonly Observation[],assessments:readonly Assessment[],scope:TeachingScope,studentId:string):RecordEvidence[]{
  const observationsOnly=observations.filter(r=>r.state==='active'&&r.sourceReviewRequired===false&&r.kind==='observation').map(r=>({kind:'observation' as const,id:r.id,revisionId:r.revisionId,schoolId:r.schoolId,ownerUserId:r.ownerUserId,studentId:r.studentId,sourceHash:r.contentHash,epoch:r.epoch,text:r.text}))
  const assessed=assessments.filter(r=>r.state==='active'&&r.sourceReviewRequired===false&&r.confirmed&&r.comment.trim()).map(r=>({kind:'assessment' as const,id:r.id,revisionId:r.revisionId,schoolId:r.schoolId,ownerUserId:r.ownerUserId,studentId:r.studentId,sourceHash:r.contentHash,epoch:r.epoch,text:r.comment}))
  return [...observationsOnly,...assessed].filter(r=>r.schoolId===scope.schoolId&&r.ownerUserId===scope.ownerUserId&&r.studentId===studentId)
}
export function evidenceReference(source:RecordEvidence):EvidenceReference{return {kind:source.kind,id:source.id,revisionId:source.revisionId,sourceHash:source.sourceHash,epoch:source.epoch,start:0,end:Array.from(source.text).length}}
// 상담이나 외부 수신 원문은 이 함수의 허용 근거 종류가 아니다. 출력 시 서버도 같은 판을 다시 확인한다.
export function validateSentence(sentence:RecordSentence,current:readonly RecordEvidence[]):void {if(!sentence.text.trim()||!sentence.evidence.length)throw new TeachingError('INVALID_INPUT','문장과 확인한 근거가 필요합니다.');for(const ref of sentence.evidence){const s=current.find(s=>s.kind===ref.kind&&s.id===ref.id&&s.revisionId===ref.revisionId&&s.sourceHash===ref.sourceHash&&s.epoch===ref.epoch);if(!s||!Number.isSafeInteger(ref.start)||!Number.isSafeInteger(ref.end)||ref.start<0||ref.start>=ref.end||ref.end>Array.from(s.text).length)throw new TeachingError('CONFLICT','근거가 변경되었거나 철회되었습니다. 최신 자료를 다시 선택해 주세요.')}}
export const utf8Bytes=(text:string):number=>new TextEncoder().encode(text).length
