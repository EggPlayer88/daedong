import { validCollectionComposeText } from '../collections/compose-text'
import { COLLECTION_TEXT_LIMITS } from '../collections/text-limits'

export type DirectDraftCommand =
  | { kind: 'messageDraft'; prompt: string; body: string }
  | { kind: 'collectionDraft'; prompt: string; title: string; instructions: string }

type DraftResult = DirectDraftCommand | { kind: 'clarify'; message: string }
const clarify = (message: string): DraftResult => ({ kind: 'clarify', message })
const oneDraft = '초안 한 건의 내용만 적어 주세요. 대상 선택과 발송·공개는 원래 화면에서 확인해 주세요.'
const collectionHint = '수합 제목을 첫 줄에 적어 주세요. 안내를 덧붙이려면 다음 줄을 “안내:”로 시작해 주세요.'
const label = /^(메시지|(?:자료\s*)?수합)\s*초안\s*[:：]([\s\S]*)$/
const natural = /^([\s\S]+?)\s*이?라는\s*(내용|제목)으로\s*(메시지|(?:자료\s*)?수합)\s*초안(?:을|를)?\s*(?:만들어|작성해|써)\s*(?:줘|주세요|주십시오|줄래요?)[.!?。！？]*$/
const draftName = /(?:메시지|(?:자료\s*)?수합)\s*초안/
const commandQuestion = /(?:라고|라는)\s*(?:(?:입력하면|말하면|하면)\s*(?:어떻게|무슨|무엇|뭐|어떤|어디|되나)|(?:표현|명령어|뜻)(?:이|은|는|가)?\s*(?:무엇|뭐|맞|괜찮|자연스러|적절))[^\r\n]*(?:[?？]|돼(?:요)?|되나요|될까요|인가요|하나요|있나요)[.。]*$/
const recipient = /^(?:(?:모든|전체|전)\s*(?:교사|선생님)?(?:들)?|전원|.+?(?:선생님|부장님|교사))\s*(?:에게|한테|께)/
const externalAction = /(?:보내|발송해|전송해|게시해|공개해|배포해|제출해|저장해)\s*(?:줘|주세요|주십시오|줄래요?)[\s.!?。！？]*$/
const sendOrPublish = /(?:전송해|발송해|게시해|공개해|자동\s*(?:으로\s*)?제출해|보내\s*줘|(?:메시지|초안)(?:을|를)?\s*보내)\s*(?:줘|주세요|주십시오|줄래요?)?[\s.!?。！？]*$/
const compound = /[;；]|(?:만들고|작성하고|발송하고|전송하고|게시하고|공개하고|보내고|만들어\s*주고|작성해\s*주고)|(?:그리고|그다음|이어서)\s*.*(?:해|보내|만들어|열어)\s*(?:줘|주세요)/
const additionalCommand = /(?:메시지\s*초안|(?:자료\s*)?수합\s*초안|일정\s*초안|할\s*일\s*(?:추가|등록)|검색|찾기)\s*[:：]/
const quoteEnds: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }
const extraField = /^[ \t]*(?:대상(?:자)?|수신자|받는\s*사람|기한|마감(?:일)?|첨부(?:\s*파일)?|공개\s*범위)\s*[:：]/m

// 콜론 뒤 본문과 명시한 안내만 복사한다. 수신자·날짜·첨부는 해석하지 않는다.
export function parseDraftCommand(prompt: string): DraftResult | null {
  const text = prompt.trim().replace(/^(?:비서야|AI야|부탁인데)\s*[,，]?\s*/, '')
  if (!draftName.test(text) || /^(?:예시\s*[:：]|예를\s*들어|(?:학생\s*기록|참고\s*자료|AI\s*답변)\s*[:：])/.test(text))
    return null

  const prefix = text.match(label), request = text.match(natural)
  // 따옴표로 둘러싼 요청이나 설명 문장에서 일부만 실행하지 않는다.
  if (!prefix && !request) {
    if (!/^["'“‘\x60]/.test(text) && externalAction.test(text) && !/(?:않|아니라|지\s*마|지\s*말)/.test(text))
      return clarify(oneDraft)
    return null
  }
  const name = prefix?.[1] ?? request![3]
  const isMessage = name === '메시지'
  if (request && request[2] !== (isMessage ? '내용' : '제목')) return null
  let raw = (prefix?.[2] ?? request![1]).trim()
  if (request && quoteEnds[raw[0]]) {
    if (!raw.endsWith(quoteEnds[raw[0]])) return null
    raw = raw.slice(1, -1).trim()
  }
  // 내용 자체의 종결 문장부호와 줄바꿈은 보존한다. 두 번째 명령·대상 지시는 접수하지 않는다.
  if (compound.test(raw) || sendOrPublish.test(raw) || recipient.test(raw) ||
      extraField.test(raw) || additionalCommand.test(raw))
    return clarify(oneDraft)
  // 콜론 표기를 인용해 사용법을 묻는 바깥 질문만 제외한다. 초안 안의 ‘사용법’, ‘하지 말고’는 본문이다.
  if (prefix && commandQuestion.test(raw)) return null
  if (isMessage)
    return raw ? { kind: 'messageDraft', prompt, body: raw } : clarify('메시지 초안에 넣을 본문을 적어 주세요.')

  const end = raw.search(/[\r\n]/)
  const title = (end < 0 ? raw : raw.slice(0, end)).trim()
  const details = end < 0 ? '' : raw.slice(end).trim()
  const guidance = /^안내(?:문)?\s*[:：]\s*([\s\S]*)$/.exec(details)
  if (!title || /^안내(?:문)?\s*[:：]/.test(title) || (details && !guidance)) return clarify(collectionHint)
  const instructions = guidance?.[1].trim() ?? ''
  if (!validCollectionComposeText(title, instructions))
    return clarify('수합 제목은 탭·줄바꿈 없이 ' + COLLECTION_TEXT_LIMITS.title + '자, 안내는 ' + COLLECTION_TEXT_LIMITS.instructions + '자 이내로 적어 주세요.')
  return { kind: 'collectionDraft', prompt, title, instructions }
}
