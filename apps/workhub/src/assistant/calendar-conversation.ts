import {
  parseCalendarFields, parseWorkspaceCommand, validWorkspaceText, type WorkspaceCommand,
} from './workspace-commands'

export type CalendarWorkspaceCommand = Extract<WorkspaceCommand, { kind: 'calendar' }>
export type CalendarContinuation =
  | { kind: 'calendar'; command: CalendarWorkspaceCommand }
  | { kind: 'clarify'; message: string }
  | { kind: 'cancel' }

export function calendarQuestion(draft: CalendarWorkspaceCommand): string | null {
  if (!draft.title) return '일정 제목은 무엇인가요?'
  if (!draft.date) return '어느 날짜에 열리는 일정인가요?'
  if (draft.allDay) return null
  if (!draft.startTime && !draft.endTime)
    return '몇 시부터 몇 시까지인가요? 하루 일정이면 “종일”이라고 답해 주세요.'
  if (!draft.startTime) return '몇 시부터 시작하나요?'
  if (!draft.endTime) return '몇 시에 끝나나요?'
  return null
}

const clarify = (message: string): CalendarContinuation => ({ kind: 'clarify', message })
const fields = ['title', 'date', 'startTime', 'endTime'] as const
const fieldLabels = { title: '제목', date: '날짜', startTime: '시작 시각', endTime: '종료 시각' }
const cancelReply = /^(?:그만|그만할래(?:요)?|취소|(?:일정(?:\s*초안)?\s*)?취소해\s*(?:줘|주세요))$/

// 새 명령이나 질문을 기존 초안의 제목으로 받아들이지 않는다. 취소할 때까지 모든 답은 여기서 처리한다.
const notFieldReply = /[?？;；“”‘’"'`]|(?:어떻게|알려\s*줘|해\s*주세요|해\s*줘|해\s*줄래|해\s*봐|말하면|입력하면|하지\s*마|아니라|지\s*않|말고|무엇|언제인가|안녕|모르겠|아무거나|알아서)/
const anotherRequest = /(?:줘|주세요|주십시오|줄래|하자|할까|인가요|인가|할래|해줘요|해요|입니다만)$/

function parseReply(text: string, date: string, draft: CalendarWorkspaceCommand): CalendarContinuation {
  if (notFieldReply.test(text) || anotherRequest.test(text) || parseWorkspaceCommand(text, date))
    return clarify('지금 작성 중인 일정의 빠진 정보만 답해 주세요. 다른 업무를 시작하려면 먼저 취소해 주세요.')
  const label = /^(제목|날짜|시작(?:\s*(?:시각|시간))?|종료(?:\s*(?:시각|시간))?|끝(?:나는\s*시간)?)\s*(?:은|는|[:：])\s*/.exec(text)
  const raw = (label ? text.slice(label[0].length) : text)
    .replace(/(?:입니다|이에요|예요)$/, '').replace(/(까지|부터|종일|시|분|내일|오늘|모레)(?:이요|요)$/, '$1').trim()
  if (!raw) return clarify('입력할 값을 함께 적어 주세요.')
  if (/^(?:아니|다른\s*(?:일정|업무)|다음\s*주$|이번\s*주$)/.test(raw))
    return clarify('현재 일정의 제목, 날짜 또는 시각을 알려 주세요.')
  const parsed = label?.[1] === '제목'
    ? { kind: 'calendar' as const, title: raw, date: null, startTime: null, endTime: null, allDay: false, prompt: text }
    : parseCalendarFields(text, raw, date)
  if (parsed.kind === 'clarify') return parsed
  if (parsed.title && Array.from(parsed.title).length > 100) return clarify('일정 제목은 100자 이내로 적어 주세요.')
  if (label?.[1] === '날짜' && (!parsed.date || parsed.title || parsed.startTime || parsed.endTime || parsed.allDay))
    return clarify('날짜에는 하루만 적어 주세요. 예를 들어 “내일” 또는 “2026-11-05”라고 답해 주세요.')
  const endLabel = label?.[1].startsWith('종료') || label?.[1].startsWith('끝')
  const startLabel = label?.[1].startsWith('시작')
  const singleTime = Boolean(parsed.startTime) !== Boolean(parsed.endTime)
  if ((endLabel || startLabel) && (parsed.title || parsed.date || parsed.allDay || !singleTime))
    return clarify('시각 하나를 알려 주세요. 예를 들어 “오후 4시”라고 답해 주세요.')
  // '오후 4시까지'는 종료다. 시작을 받은 뒤 “몇 시에 끝나나요?”에 답한 단일 시각도 종료다.
  if ((startLabel && parsed.endTime) || (endLabel && /부터/.test(raw)))
    return clarify('시작 시각인지 종료 시각인지 확인해 주세요.')
  if (parsed.startTime && !parsed.endTime &&
      (endLabel || (!startLabel && !/부터/.test(raw) && draft.startTime && !draft.endTime))) {
    parsed.endTime = parsed.startTime
    parsed.startTime = null
  }
  return { kind: 'calendar', command: parsed }
}

export function continueCalendar(
  draft: CalendarWorkspaceCommand, reply: string, basisDate: string,
): CalendarContinuation {
  if (typeof reply !== 'string' || !validWorkspaceText(reply)) return clarify('답변의 길이와 문자를 확인해 주세요.')
  const text = reply.trim().replace(/\s+/g, ' ').replace(/[.!。！]+$/, '').trim()
  if (cancelReply.test(text)) return { kind: 'cancel' }
  const question = calendarQuestion(draft)
  if (!text || !question) return clarify('현재 초안에 필요한 정보를 확인해 주세요.')
  const result = parseReply(text, basisDate, draft)
  if (result.kind !== 'calendar') return result
  const answer = result.command
  if ((answer.allDay && (draft.startTime || draft.endTime)) || (draft.allDay && (answer.startTime || answer.endTime)))
    return clarify('이미 입력한 시각과 종일 설정이 달라요. 초안을 취소한 뒤 새로 시작해 주세요.')
  const different = fields.find(field => draft[field] && answer[field] && draft[field] !== answer[field])
  if (different)
    return clarify(`앞서 입력한 ${fieldLabels[different]}과 달라요. 기존 값을 유지했어요. 빠진 정보만 답하거나 취소 후 새로 시작해 주세요.`)
  const changed = fields.some(field => answer[field] && !draft[field]) || answer.allDay && !draft.allDay
  if (!changed) return clarify(question)
  const command: CalendarWorkspaceCommand = {
    ...draft, prompt: draft.prompt + '\n' + reply.trim(), title: draft.title || answer.title,
    date: draft.date ?? answer.date, startTime: draft.startTime ?? answer.startTime,
    endTime: draft.endTime ?? answer.endTime, allDay: draft.allDay || answer.allDay,
  }
  if (!validWorkspaceText(command.prompt)) return clarify('대화가 길어졌어요. 답을 짧게 적거나 초안을 새로 시작해 주세요.')
  if (command.startTime && command.endTime && command.endTime <= command.startTime)
    return clarify('종료 시각은 시작 시각보다 늦어야 해요. 하루 안의 시각을 알려 주세요.')
  return { kind: 'calendar', command }
}
