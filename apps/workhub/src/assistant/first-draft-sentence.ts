import { validCollectionComposeText } from '../collections/compose-text'
import { SEARCH_LIMITS } from '../search/limits'
import type { DraftFirstTurn, DraftResult } from './draft-commands'
import { draftDateWords, resolveDraftDate } from './draft-date'
import { assistantRequestEnding, hasMultipleAssistantRequests } from './request-expression'

type Kind = 'messageDraft' | 'collectionDraft'
interface Fields { content: string; people?: string; deadline?: string; instructions?: string }

const hint = (message: string): DraftResult => ({ kind: 'clarify', message })
const personHint = '교사 이름을 적어 주세요. 여러 명은 쉼표로 구분한 뒤 후보에서 직접 선택할 수 있습니다.'
const dateHint = '제출 기한을 하나의 날짜로 다시 적어 주세요. 예: 내일, 다음 주 금요일.'
const singleRequest = '한 번에 초안 한 건을 요청해 주세요. 전송·저장·공개는 기존 작성 화면에서 확인합니다.'
const action = new RegExp(String.raw`^(?<lead>[\s\S]*?)(?<kind>메시지|(?:자료\s*)?수합)(?:\s*초안)?(?:을|를|으로)?\s*(?:(?:하나|한\s*건)\s*)?(?:(?:만들어|작성해|써|준비해)\s*${assistantRequestEnding}|(?:만들고|작성하고|준비하고)\s*싶(?:어|어요|습니다))[.!?。！？]*$`)
const collect = new RegExp(String.raw`^([\s\S]*?)\s*수합(?:해|\s*요청해|\s*받아)\s*${assistantRequestEnding}[.!?。！？]*$`)
const labelled = /^(메시지|(?:자료\s*)?수합)\s*초안\s*[:：]([\s\S]*)$/
const outsideCommand = /[;；]|(?:보내고|전송하고|공개하고|게시하고|저장하고|만들고(?!\s*싶)|작성하고(?!\s*싶)|하지\s*말고|말고|대신|제외하고|하지\s*마)|(?:다음|이어서|그리고)\s+.{1,40}(?:해줘|주세요)|(?:일정|메시지|수합)\s*초안\s*[:：]/
const quotes = /“([^”]*)”|‘([^’]*)’|"([^"]*)"|'([^']*)'/g

function namesFrom(raw: string): string[] | null {
  const parts = raw.trim().split(/\s*[,，、]\s*|\s+(?:및|그리고)\s+|(?:과|와|하고|랑)\s+/)
  const names = parts.map(part => part.trim().replace(/\s*(?:선생님|교사|부장님)$/, '').trim())
  if (names.some(name => !name || Array.from(name).length > SEARCH_LIMITS.queryChars ||
      !/^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u.test(name) ||
      /(?:전체|전원|모두|모든|아무나|누구나|제외|말고|담임들|선생님들|교사들|에게|한테|께)/.test(name))) return null
  return names
}

function finish(kind: Kind, fields: Fields, prompt: string, basisDate: string): DraftResult {
  const names = fields.people?.trim() ? namesFrom(fields.people) : []
  if (!names) return hint(personHint)
  const firstTurn: DraftFirstTurn = { names }
  if (fields.deadline?.trim()) {
    if (kind !== 'collectionDraft') return hint('메시지 본문에 날짜를 넣을 수 있습니다. 제출 기한은 수합에서 사용합니다.')
    const token = fields.deadline.trim().replace(/\s*까지$/, '').trim()
    const date = resolveDraftDate(token, basisDate)
    if (date && date >= basisDate) firstTurn.dueDate = date
    else firstTurn.dateIssue = dateHint
  }
  if (kind === 'messageDraft') return { kind, prompt, body: fields.content, firstTurn }
  const instructions = fields.instructions ?? ''
  if (!validCollectionComposeText(fields.content || '제목', instructions)) return hint('수합 제목과 안내의 길이·줄바꿈을 확인해 주세요.')
  return { kind, prompt, title: fields.content, instructions, firstTurn }
}

function maskQuotes(text: string, keepDelimiters: boolean) {
  const literals: string[] = []
  const masked = text.replace(quotes, (match, a, b, c, d) => {
    literals.push(keepDelimiters ? match : a ?? b ?? c ?? d)
    return '\x01' + (literals.length - 1) + '\x02'
  })
  const restore = (part: string) => part.replace(/\x01(\d+)\x02/g, (_match, index) => literals[Number(index)])
  return { masked, restore, literals }
}

// 명시한 필드 줄만 분리한다. 일반 본문에 들어간 날짜·이름은 해석하지 않는다.
function readLabels(kind: Kind, raw: string, prompt: string, basisDate: string): DraftResult | null {
  const { masked, restore } = maskQuotes(raw, true)
  const marks = [...masked.matchAll(/(?:^|\r\n|\n|\r|[,，][ \t]+)[ \t]*(받는\s*사람|수신자|제출\s*대상|대상(?:자)?|제출\s*기한|기한|마감(?:일)?|안내(?:문)?|본문|제목|첨부(?:\s*파일)?|공개\s*범위)\s*[:：][ \t]*/g)]
  if (!marks.some(m => !/^(?:안내|안내문)$/.test(m[1]))) return null
  const fields: Fields = { content: restore(masked.slice(0, marks[0].index).trim()) }
  const seen = new Set<string>(fields.content ? ['content'] : [])
  for (const [i, mark] of marks.entries()) {
    const value = restore(masked.slice(mark.index + mark[0].length, marks[i + 1]?.index ?? masked.length).trim())
    const label = mark[1].replace(/\s/g, '')
    let field: keyof Fields
    if (/^(?:대상자?|수신자|받는사람|제출대상)$/.test(label)) field = 'people'
    else if (/^(?:기한|제출기한|마감일?)$/.test(label)) field = 'deadline'
    else if (kind === 'collectionDraft' && /^안내문?$/.test(label)) field = 'instructions'
    else if ((kind === 'messageDraft' && label === '본문') || (kind === 'collectionDraft' && label === '제목')) field = 'content'
    else return hint(singleRequest)
    if (seen.has(field)) return hint('같은 항목에 값이 두 개 있습니다. 한 값으로 정리해 주세요.')
    seen.add(field)
    fields[field] = value
  }
  if (/(?:메시지|수합|일정)\s*초안\s*[:：]/.test(fields.content + '\n' + (fields.instructions ?? ''))) return hint(singleRequest)
  return finish(kind, fields, prompt, basisDate)
}

// 한국어 목적격 조사는 명확할 때만 제거한다. 예를 들어 '마을'의 마지막 글자는 제목이다.
function objectTitle(text: string) {
  if (!/[을를]$/.test(text) || text.length < 2) return text
  const previous = text.charCodeAt(text.length - 2) - 0xac00
  if (previous >= 0 && previous <= 11171 && text.at(-1) !== (previous % 28 ? '을' : '를')) return text
  return text.slice(0, -1)
}

export function parseFirstDraftSentence(text: string, prompt: string, basisDate: string): DraftResult | null {
  const prefix = labelled.exec(text)
  if (prefix) return readLabels(prefix[1] === '메시지' ? 'messageDraft' : 'collectionDraft', prefix[2], prompt, basisDate)
  // 요청 뒤의 별도 문장도 명시한 대상/기한만 잇는다. 같은 필드를 덮어쓰거나 실행 명령을 섞지 않는다.
  const supplementalText = maskQuotes(text, true)
  const supplementary = /[.!。！]\s*(?=(?:대상(?:자)?|제출\s*대상|수신자|받는\s*사람|제출\s*기한|기한|마감(?:일)?)\s*(?:은|는|[:：]))/.exec(supplementalText.masked)
  if (supplementary) {
    const initial = parseFirstDraftSentence(supplementalText.restore(supplementalText.masked.slice(0, supplementary.index)), prompt, basisDate)
    if (!initial || initial.kind === 'clarify') return initial
    const firstTurn: DraftFirstTurn = { names: initial.firstTurn?.names ?? [], ...initial.firstTurn }
    const parts = supplementalText.restore(supplementalText.masked.slice(supplementary.index + supplementary[0].length)).trim().replace(/[.!。！]+$/, '')
      .split(/[.!。！]\s*(?=(?:대상|제출|수신자|받는|기한|마감))/)
    for (const part of parts) {
      const field = /^(대상(?:자)?|제출\s*대상|수신자|받는\s*사람|제출\s*기한|기한|마감(?:일)?)\s*(?:은|는|[:：])\s*(.+)$/.exec(part.trim())
      if (!field) return hint(singleRequest)
      const value = field[2].trim().replace(/(?:입니다|이에요|예요|이야|야)$/, '').trim()
      if (/기한|마감/.test(field[1])) {
        if (initial.kind !== 'collectionDraft' || firstTurn.dueDate || firstTurn.dateIssue) return hint(singleRequest)
        const date = resolveDraftDate(value.replace(/까지$/, '').trim(), basisDate)
        if (date && date >= basisDate) firstTurn.dueDate = date
        else firstTurn.dateIssue = dateHint
      } else {
        const names = namesFrom(value)
        if (!names || firstTurn.names.length) return hint(personHint)
        firstTurn.names = names
      }
    }
    return { ...initial, firstTurn }
  }
  const request = action.exec(text), short = !request && collect.exec(text)
  if (!request && !short) return null
  if (hasMultipleAssistantRequests(text)) return hint(singleRequest)
  const kind: Kind = request?.groups?.kind === '메시지' ? 'messageDraft' : 'collectionDraft'
  const lead = (request?.groups?.lead ?? (short ? short[1] : '')).trim()
  // 인용 속 '까지', '에게' 등을 필드로 읽지 않는다. 자리 표시자는 사용자가 입력할 수 없는 제어 문자다.
  const { masked, restore, literals } = maskQuotes(lead, false)
  let rest = masked.trim()
  if (/["“”‘’']/.test(rest)) return hint('따옴표가 닫혔는지 확인해 주세요.')
  if (outsideCommand.test(rest)) return hint(singleRequest)
  // '공지 마감', '제출하지 않은 자료'는 본문이다. 작성 동사의 실행 부정 접속만 차단한다.
  if (/(?:만들|작성하|준비하|등록하|추가하)지\s*않고(?=\s|$)/.test(rest)) return hint(singleRequest)
  const fields: Fields = { content: '' }
  let objectBeforeName = false
  let quotedInstructions: string | undefined
  if (kind === 'collectionDraft') {
    const guide = /(?:^|\s|[,，])안내(?:문)?\s*(?:는|로|[:：])?\s*\x01(\d+)\x02\s*$/.exec(rest)
    if (guide) { quotedInstructions = literals[Number(guide[1])]; rest = rest.slice(0, guide.index).trim().replace(/[,，]$/, '').trim() }
    const date = '(?:' + draftDateWords.source + ')'
    const markedDate = '(?:제출\\s*기한|기한|마감(?:일)?)\\s*(?:은|는|[:：])?\\s*(' + date + ')(?:\\s*까지|(?:으?로)(?:\\s*하고)?)?'
    const deadline = new RegExp('(?<![\\p{L}\\p{N}])(?:' + markedDate + '|(' + date + ')\\s*까지)(?=$|[\\s,，])', 'gu')
    const deadlines = [...rest.matchAll(deadline)]
    if (deadlines.length) {
      fields.deadline = deadlines.map(d => d[1] ?? d[2]).join(' ')
      for (const d of deadlines.reverse()) {
        const before = rest.slice(0, d.index)
        rest = before + ' ' + rest.slice(d.index + d[0].length).replace(/^\s*[,，]\s*/, '')
      }
      rest = rest.trim()
    }
    // 불명확한 날짜는 미정으로 두고 제목과 대상은 그대로 복구한다.
    const vagueDate = /(?:이번\s*달\s*말|다음\s*주\s*중|내일모레|글피|주말)\s*까지/.exec(rest)
    if (vagueDate) {
      fields.deadline = vagueDate[0]
      rest = (rest.slice(0, vagueDate.index) + ' ' + rest.slice(vagueDate.index + vagueDate[0].length)).trim()
    }
    if (rest.includes('까지')) return hint(dateHint)
  }
  const person = /^(.+?)(에게서|한테서|에게|한테|께|(?:을|를)?\s*대상으로)(?:는)?(?=[\s,，]|$)[\s,，]*/.exec(rest)
  if (person) {
    if (kind === 'messageDraft' && person[2].endsWith('서')) return hint(personHint)
    const objectFirst = /^(.*?[을를])\s+(.+)$/.exec(person[1])
    objectBeforeName = Boolean(objectFirst)
    fields.people = restore(objectFirst?.[2] ?? person[1]).replace(/^(?:제출\s*대상|대상|수신자|받는\s*사람)(?:은|는|[:：])\s*/, '')
    const beforeName = kind === 'collectionDraft' ? (objectFirst ? objectTitle(objectFirst[1]) : undefined) : objectFirst?.[1]
    rest = [beforeName, rest.slice(person[0].length).trim()].filter(Boolean).join(' ')
  }
  // 명시한 필드가 없는 기존 문체·일반 AI 글쓰기 요청은 원래 분류기로 보낸다.
  const legacyContent = /이?라는\s*(?:내용|제목)으로$/.test(rest)
  if (lead && !person && fields.deadline === undefined && !short && !quotedInstructions &&
      (legacyContent || (kind === 'messageDraft' && !literals.length && !/달라는$/.test(rest)))) return null
  if (/(?:에게|한테|께|대상으로)(?=[\s,，]|$)/.test(rest)) return hint(personHint)
  // 따옴표 밖의 조사만 제거하고 원문 안의 '으로' 등은 그대로 복원한다.
  rest = rest.replace(/(\x02)\s*(?:라는\s*내용의|내용으로|제목으로|으로|로)\s*$/, '$1')
  if (kind === 'messageDraft') {
    rest = rest.replace(/달라는(?:\s*내용으로)?$/, '주세요').replace(/(?:이?라는\s*내용으로|이?라고(?:\s*(?:하는|적은))?|라는)\s*$/, '')
  } else {
    rest = rest.replace(/(?:이?라는\s*제목으로|이라는|라는)$/, '')
    if (short && !objectBeforeName) rest = objectTitle(rest)
  }
  fields.instructions = quotedInstructions
  fields.content = restore(rest.trim())
  return finish(kind, fields, prompt, basisDate)
}
