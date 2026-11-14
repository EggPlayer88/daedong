import { SEARCH_LIMITS } from '../search/limits'
import type { Recipient } from '../messaging/contracts'
import type { DirectDraftCommand } from './draft-commands'
import { draftDateWords, resolveDraftDate } from './draft-date'
import { validWorkspaceText } from './workspace-commands'

export interface DraftPerson {
  memberId: string
  displayName: string
  detail?: string
  recipient?: Recipient
}

export interface DraftFollowup {
  command: DirectDraftCommand
  selected: DraftPerson[]
  pendingNames?: string[]
  dueDate?: string
  scope: string
  basisDate: string
}

export interface DraftPeople {
  query: string
  items: DraftPerson[]
  hasMore?: boolean
}

type DraftReply =
  | { kind: 'fields'; query?: string; dueDate?: string }
  | { kind: 'clarify'; message: string }
  | { kind: 'cancel' }

const explain = (message: string): DraftReply => ({ kind: 'clarify', message })
const dateHint = '제출 기한을 날짜 하나로 적어 주세요. 예: 11월 18일 수요일, 11/18, 18일, 내일.'
const nameHint = '대상 교사의 이름을 한 분씩 적고 검색 결과에서 선택해 주세요.'
const dueLabel = /^(?:제출\s*기한|기한|마감(?:일|날짜)?)\s*(?:은|는|[:：])?\s*/
const personLabel = /^(?:받는\s*사람|수신자|제출\s*대상|대상(?:자)?)\s*(?:은|는|[:：])?\s*/
const dateResidue = /[0-9][/.:-]|\d+\s*(?:일|월|년|시|분)|내일모레|글피|올해|내년|내후년|작년|이번\s*주|다음\s*주|(?:지난|다음|이번)\s*달|오전|오후|자정/
const unsafeAction = /[?？;；“”‘’"`]|보내\s*줘|(?:전송|발송|공개|게시|저장|작성|취소|삭제|열어)\s*(?:해|하|줘)|하지\s*마|말고|아니라/
const broadGroup = /(?:^|\s)(?:전원|모두|전체|모든\s*교사|전\s*교사|아무나|누구나)(?:$|\s|에게|한테|께)/

// 명시된 접수 기한과 검색어만 읽는다. 검색 결과 하나도 사람의 선택 전에는 수신자가 되지 않는다.
export function parseDraftReply(draft: DraftFollowup, reply: string): DraftReply {
  if (typeof reply !== 'string' || !validWorkspaceText(reply)) return explain('입력한 글자와 길이를 확인해 주세요.')
  const text = reply.trim().replace(/[.!。！]+$/, '').trim()
  if (/^(?:취소|그만|(?:메시지|수합|초안|대화)(?:\s*초안)?\s*취소(?:해\s*(?:줘|주세요))?)$/.test(text)) return { kind: 'cancel' }
  if (!text || unsafeAction.test(text) || broadGroup.test(text))
    return explain('교사 이름이나 수합 기한을 입력해 주세요. 전송·저장·공개는 작성 화면에서 확인합니다.')

  const dates = [...text.matchAll(draftDateWords)]
  if (dates.length > 1) return explain(dateHint)
  let remainder = text, dueDate: string | undefined
  if (dates.length) {
    if (draft.command.kind !== 'collectionDraft') return explain('메시지를 받을 교사의 이름을 적어 주세요.')
    const found = dates[0], date = resolveDraftDate(found[0], draft.basisDate)
    if (!date || date < draft.basisDate) return explain('제출 기한은 오늘 이후의 실제 날짜여야 하며, 적은 요일도 날짜와 같아야 합니다.')
    dueDate = date
    const before = text.slice(0, found.index).replace(/(?:제출\s*기한|기한|마감(?:일|날짜)?)\s*(?:은|는|[:：])?\s*$/, '')
    const after = text.slice(found.index + found[0].length).replace(/^(?:까지)?(?:(?:로|으로)(?:\s*해\s*(?:줘|주세요))?|에)?(?:입니다|예요|이에요|요)?(?=$|[\s,，])/, '')
    remainder = (before + ' ' + after).trim().replace(/^[,，\s]+|[,，\s]+$/g, '')
  }
  if (dueLabel.test(remainder) || dateResidue.test(remainder)) return explain(dateHint)
  if (!remainder && dueDate) return { kind: 'fields', dueDate }
  const query = remainder.replace(personLabel, '').trim().replace(/(?:입니다|이에요|예요|이야|야)$/, '').trim()
    .replace(/\s*(?:추가해|찾아)\s*(?:줘|주세요)$/, '')
    .replace(/(?:에게|한테|께)(?:요)?$/, '')
    .replace(/\s*(?:선생님|교사)(?:도|으로|으로요|이요|요)?$/, '').trim()
  if (!query || [...query].length > SEARCH_LIMITS.queryChars || !/^[\p{L}\p{N}][\p{L}\p{N} .·'-]*$/u.test(query) ||
      /(?:선생님|에게|한테|추가해|(?:^|\s)도\s|해줘|해\s*주세요|주세요|그리고|(?:\S[와과랑])\s)/.test(query)) return explain(nameHint)
  return { kind: 'fields', query, ...(dueDate ? { dueDate } : {}) }
}
