import type { Membership } from '../contracts'
import { answerSegments, assistantInput, type AssistantContextRequest } from '../assistant/contracts'
import type { AssistantDraftReady } from '../assistant/AssistantPanel'
import { documentAiDraft, type DocumentAiDraft, type DocumentAiRequest, type DocumentSource } from '../documents/contracts'
import type { StudentDraftSource } from '../teaching/TeachingWorkspace'
import { canonical, exact, identifier, object, ServiceError, text, version } from '../services/service-values'

// 이동할 때 필요한 근거만 현재 탭에서 전달한다. 원본 식별자는 URL에 넣지 않는다.
function contextRequest(value: AssistantContextRequest): AssistantContextRequest {
  try {
    const checked = assistantInput({ ...value, prompt: value.prompt ?? '', threadId: null, expectedVersion: 0 })
    return { mode: checked.mode, intent: checked.intent, prompt: checked.prompt, references: checked.references, studentContext: checked.studentContext }
  } catch { throw new ServiceError('INVALID_INPUT') }
}
export function documentAssistantRequest(input: DocumentAiRequest): AssistantContextRequest {
  if (!object(input) || !Object.keys(input).every(key => ['intent','sourceId','sourceVersion','title','details','studentContext'].includes(key)) ||
    !['document_draft','student_record_draft','guided_collection'].includes(input.intent)) throw new ServiceError('INVALID_INPUT')
  const hasSource = input.sourceId !== undefined, hasVersion = input.sourceVersion !== undefined
  if (hasSource !== hasVersion) throw new ServiceError('INVALID_INPUT')
  const references: AssistantContextRequest['references'] = hasSource ? [{kind:'document',id:identifier(input.sourceId),version:version(input.sourceVersion)}] : []
  // 긴 원문을 조용히 자르지 않는다. 문서 화면에서 저장된 원본/선택한 입력을 분명히 구별한다.
  const title = text(input.title,200,true), details = text(input.details,100000,true)
  return contextRequest({mode:'personal',intent:input.intent,prompt:`${title}\n\n${details}`.trim(),references,studentContext:input.studentContext ? structuredClone(input.studentContext) : null})
}
export function studentAssistantRequest(input: StudentDraftSource, member: Membership): AssistantContextRequest {
  exact(input,['schoolId','memberId','studentId','courseId','evidence'])
  if (input.schoolId !== member.schoolId || input.memberId !== member.id) throw new ServiceError('CANCELLED')
  return contextRequest({mode:'personal',intent:'student_record_draft',prompt:'선택한 관찰·평가 근거만 사용하여 학생 기록 검토 초안을 작성해 주세요. 근거 없는 성취나 활동은 추가하지 말고 확인할 부분을 표시해 주세요.',references:[],studentContext:{studentId:input.studentId,courseId:input.courseId,evidence:structuredClone(input.evidence)}})
}
export function assistantDocumentDraft(input: AssistantDraftReady, member: Membership): DocumentAiDraft {
  exact(input,['intent','segments','requestKey','threadId','studentContext'])
  if (!['document_draft','student_record_draft','guided_collection'].includes(input.intent)) throw new ServiceError('INVALID_INPUT')
  identifier(input.requestKey); identifier(input.threadId)
  const segments = answerSegments(input.segments)
  const context = contextRequest({mode:'personal',intent:input.intent,prompt:'초안 근거 확인',references:[],studentContext:input.studentContext})
  for (const segment of segments) {
    const evidence = segment.citations.filter(citation => !('version' in citation.reference))
    if (context.studentContext && !evidence.length) throw new ServiceError('INVALID_INPUT')
    for (const citation of evidence) {
      if (!context.studentContext?.evidence.some(reference => canonical(reference) === canonical(citation.reference))) throw new ServiceError('INVALID_INPUT')
    }
  }
  const sources = new Map<string,DocumentSource>()
  for (const segment of segments) for (const citation of segment.citations) {
    const ref = citation.reference
    if ('version' in ref) {
      const source = {kind:ref.kind,sourceId:ref.id,sourceVersion:ref.version,locator:citation.locator,quote:''}
      sources.set(canonical([ref.kind,ref.id,ref.version,citation.locator]),source)
    }
  }
  return documentAiDraft({requestId:input.requestKey,schoolId:member.schoolId,memberId:member.id,title:input.intent === 'student_record_draft' ? '학생 기록 검토 초안' : '문서 내용 초안',body:segments.map(item => item.text).join('\n\n'),sources:[...sources.values()],intent:input.intent,studentContext:context.studentContext},member)
}
