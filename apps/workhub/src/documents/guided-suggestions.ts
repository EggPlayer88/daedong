import policy from '../../../main/api/workhub-documents/_assets/guided-suggestions.json'
import { exact, ServiceError, text, validateLocalInput } from '../services/service-values'
import {GUIDED_LIMITS,inspection as parseInspection,questionMapping,type Anchor,type Inspection,type Question,type QuestionKind} from './guided-contracts'

export const GUIDED_SUGGESTIONS_POLICY=policy
export interface GuidedCandidate {
 anchorId:string;sourceText:string;sourceHash:string;label:string;context:string
 kind:QuestionKind;required:boolean;maxLength:number;options:string[]
}
export interface GuidedModeRecommendation {
 mode:'guided'|'file'|'review';reasons:string[];blankCount:number;unlinkedBlankCount:number;unsupportedCount:number;remainingCapacity:number
}

function checkedSource(raw:Inspection,questions:Question[]){
 return validateLocalInput(()=>{
  const source=parseInspection(raw)
  if(!Array.isArray(questions)||questions.length>GUIDED_LIMITS.maxQuestions)throw new ServiceError('INVALID_INPUT')
  const existing=questions.length?questionMapping(source,questions).questions:[]
  return {source,existing,linked:new Set(existing.map(question=>question.anchorId))}
 })
}

export function recommendGuidedMode(inspection:Inspection,questions:Question[]):GuidedModeRecommendation{
 const {source,existing,linked}=checkedSource(inspection,questions)
 const blank=source.anchors.filter(anchor=>!anchor.sourceText.trim())
 const unlinked=blank.filter(anchor=>!linked.has(anchor.id)),remainingCapacity=GUIDED_LIMITS.maxQuestions-existing.length
 const result={blankCount:blank.length,unlinkedBlankCount:unlinked.length,unsupportedCount:source.unsupportedParagraphs,remainingCapacity}
 if(unlinked.length>GUIDED_LIMITS.maxQuestions){
  const reasons:string[]=[]
  reasons.push(`미연결 빈 문단 ${unlinked.length}개가 한 양식의 질문 한도 ${GUIDED_LIMITS.maxQuestions}개보다 많아 파일형 수합을 먼저 검토해 주세요.`)
  reasons.push('고정 안내문을 제외하고 일부 칸만 질문으로 받을 수도 있습니다. 원본을 보고 최종 방식을 정해 주세요.')
  return{...result,mode:'file',reasons}
 }
 if(!unlinked.length||!remainingCapacity)return{...result,mode:'review',reasons:[!unlinked.length?'새로 제안할 빈 문단이 없습니다. 기존 질문과 원본 위치를 직접 확인해 주세요.':`질문 ${GUIDED_LIMITS.maxQuestions}개가 이미 연결되어 있습니다. 새 질문을 추가하려면 기존 연결을 먼저 정리해 주세요.`]}
 if(source.unsupportedParagraphs>0)return{...result,mode:'review',reasons:[`빈 문단 후보 ${unlinked.length}개와 검사 범위 밖의 복합 문단 ${source.unsupportedParagraphs}개가 있습니다. 복합 문단은 원형을 유지합니다.`, '표를 감싼 문단도 복합 문단으로 셀 수 있으므로 문서 전체가 질문형에 부적합하다고 판단하지 않습니다. 필요한 칸의 위치와 보존할 서식을 확인해 주세요.']}
 const reasons=[`미연결 빈 문단 ${unlinked.length}개를 확인했습니다. 필요한 칸을 선택해 질문형 수합을 검토할 수 있습니다.`, '빈 문단이 입력란임을 보장하지 않습니다. 추천만으로 원문이나 질문을 바꾸지 않습니다.']
 if(unlinked.length>remainingCapacity)reasons.push(`현재 추가할 수 있는 질문은 ${remainingCapacity}개입니다. 필요한 칸만 선택해 주세요.`)
 return{...result,mode:'guided',reasons}
}

// 표 식별자가 없는 계약이므로 행·열만 보고 같은 표의 항목 이름이라고 단정하지 않는다.
function previousContext(source:Inspection,anchor:Anchor):string{
 const previous=source.anchors.find(item=>item.section===anchor.section&&item.paragraph===anchor.paragraph-1)
 if(!previous||Array.from(previous.sourceText).length>policy.contextCharacters)return ''
 return previous.sourceText
}
function suggestedLabel(context:string):string{
 const value=context.trim()
 if(!value||/[\r\n\u0085\u2028\u2029]/.test(context)||Array.from(value).length>policy.labelCharacters||!/[：:]$/.test(value))return ''
 return value.slice(0,-1).trim()
}

export function createGuidedCandidates(inspection:Inspection,questions:Question[]):GuidedCandidate[]{
 const {source,existing,linked}=checkedSource(inspection,questions)
 return source.anchors.filter(anchor=>!anchor.sourceText.trim()&&!linked.has(anchor.id)).slice(0,GUIDED_LIMITS.maxQuestions-existing.length).map(anchor=>{
  const context=previousContext(source,anchor)
  return{anchorId:anchor.id,sourceText:anchor.sourceText,sourceHash:anchor.sourceHash,label:suggestedLabel(context),context,kind:'text',required:false,maxLength:Math.min(policy.defaultAnswerCharacters,GUIDED_LIMITS.maxAnswerCharacters),options:[]}
 })
}

export function applyGuidedCandidates(inspection:Inspection,existingQuestions:Question[],selectedCandidates:GuidedCandidate[],makeId:()=>string=()=>`q-${crypto.randomUUID()}`):Question[]{
 return validateLocalInput(()=>{
  const {source,existing,linked}=checkedSource(inspection,existingQuestions)
  if(!Array.isArray(selectedCandidates)||!selectedCandidates.length||selectedCandidates.length+existing.length>GUIDED_LIMITS.maxQuestions||typeof makeId!=='function')throw new ServiceError('INVALID_INPUT')
  const used=new Set<string>()
  const selected=selectedCandidates.map(raw=>{
   exact(raw,['anchorId','sourceText','sourceHash','label','context','kind','required','maxLength','options'])
   const anchor=source.anchors.find(item=>item.id===raw.anchorId)
   if(!anchor||anchor.sourceText.trim()||anchor.sourceText!==raw.sourceText||anchor.sourceHash!==raw.sourceHash||linked.has(anchor.id))throw new ServiceError('CONFLICT')
   if(used.has(anchor.id))throw new ServiceError('INVALID_INPUT')
   used.add(anchor.id)
   if(text(raw.context,policy.contextCharacters)!==previousContext(source,anchor))throw new ServiceError('CONFLICT')
   return {id:makeId(),anchorId:anchor.id,sourceText:anchor.sourceText,sourceHash:anchor.sourceHash,label:raw.label,kind:raw.kind,required:raw.required,maxLength:raw.maxLength,options:raw.options}
  })
  // 기존 질문까지 한 번에 검사하며 실패하면 원래 배열과 입력을 그대로 둔다.
  return questionMapping(source,[...existing,...selected] as Question[]).questions
 })
}
