import { draftDateWords, resolveDraftDate } from './draft-date'
import type { EvaluationTarget } from './evaluation-workspace'
import { parseDraftCommand, type DirectDraftCommand } from './draft-commands'
import { parseTaskChangeCommand, type TaskChangeCommand } from './task-change-command'
import { parseSpecialistCommand, type SpecialistCommand } from './specialist-workflows'
import type { PageId } from '../modules'
import type { SearchKind } from '../search/contracts'
import { SEARCH_LIMITS } from '../search/limits'
import { parseDailyCommand, type DailyCommand } from './daily-command'
import limits from '../../../main/api/workhub-ai/_assets/assistant-limits.json'

export type WorkspaceCommand =
  | { kind: 'evaluation'; target: EvaluationTarget }
  | DailyCommand
  | SpecialistCommand
  | DirectDraftCommand
  | TaskChangeCommand
  | { kind: 'navigate'; page: PageId }
  | { kind: 'search'; query: string; kinds: SearchKind[] }
  | { kind: 'task'; prompt: string }
  | {
      kind: 'calendar'; prompt: string; title: string; date: string | null
      startTime: string | null; endTime: string | null; allDay: boolean
      location?: string; audienceQueries?: string[]
    }
  | { kind: 'clarify'; message: string }

const menus: ReadonlyArray<[PageId, readonly string[]]> = [
  ['home', ['홈', '오늘', '대시보드']],
  ['timetable', ['시간표', '내 시간표']],
  ['calendar', ['학교 일정', '일정', '일정표', '캘린더']],
  ['tasks', ['내 업무', '내 할 일', '할 일', '할 일 목록', '업무 목록']],
  ['collections', ['자료 수합', '문서 수합', '수합']],
  ['documents', ['문서함']],
  ['knowledge', ['학교 자료', '학교 자료실', '자료실']],
  ['messages', ['메시지와 알림', '메신저', '메시지', '알림']],
  ['schoolAdmin', ['학교 관리', '학교 자료 관리']],
  ['students', ['수업과 학생', '수업', '학생 기록']],
  ['cooperation', ['협업 요청', '협업']],
  ['assistant', ['AI 비서', '비서']],
]
const searchScopes: ReadonlyArray<[string, SearchKind[]]> = [
  ['학교 자료', ['knowledge']], ['자료실', ['knowledge']], ['학교 자료실', ['knowledge']],
  ['문서함', ['document']], ['문서', ['document']], ['수합', ['collection']],
  ['자료 수합', ['collection']], ['학교 일정', ['calendar']], ['일정', ['calendar']],
  ['할 일', ['task']], ['내 업무', ['task']], ['협업', ['cooperation']],
  ['메시지', ['message']], ['메신저', ['message']], ['수업', ['course']],
  ['전체', ['calendar', 'task', 'collection', 'document', 'knowledge', 'cooperation', 'message', 'course']],
  ['자료', ['knowledge', 'document']],
]
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*')
const askEnd = '(?:줘|주세요|주십시오|주시겠어요|줄래|줄래요|줄 수 있어|줄 수 있나요|주실래요)'
const moveEnd = `(?:열어|보여|이동해|가|띄워)\\s*${askEnd}`
const findEnd = `(?:찾아|검색해|조회해)\\s*${askEnd}`
const makeEnd = `(?:(?:만들어|작성해|추가해|등록해|잡아|넣어)\\s*${askEnd}|(?:만들고|작성하고|추가하고|등록하고|잡고|넣고)\\s*싶(?:어|어요|습니다))`
const clarification = (message: string): Extract<WorkspaceCommand, { kind: 'clarify' }> => ({ kind: 'clarify', message })

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value + 'T00:00:00.000Z')
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}
function intactText(value: string): boolean {
  // 깨진 UTF-16과 숨은 제어 문자는 명령으로 해석하지 않는다.
  for (const point of value) {
    const code = point.codePointAt(0)!
    if ((code >= 0xd800 && code <= 0xdfff) || (code < 0x20 && ![9, 10, 13].includes(code)) || (code >= 0x7f && code <= 0x9f))
      return false
  }
  return true
}
export function validWorkspaceText(value: string): boolean {
  return Array.from(value).length <= limits.promptChars && intactText(value)
}
function queryCommand(raw: string, kinds: SearchKind[]): WorkspaceCommand {
  let query = raw.trim()
  if (/^(["'“‘]).+(["'”’])$/.test(query)) query = query.slice(1, -1).trim()
  if (!query || Array.from(query).length > SEARCH_LIMITS.queryChars)
    return clarification(`찾을 내용을 ${SEARCH_LIMITS.queryChars}자 이내로 적어 주세요.`)
  return { kind: 'search', query, kinds: [...kinds] }
}

export function parseCalendarFields(prompt: string, raw: string, basisDate: string): Extract<WorkspaceCommand, { kind: 'calendar' | 'clarify' }> {
  if (!validDate(basisDate)) return clarification('학교 기준 날짜를 다시 확인한 뒤 일정 초안을 만들어 주세요.')
  if (/(?:매일|매주|매월|반복|마다|다음\s*달|다음\s*학기|주말|오늘밤|내일모레|글피|자정|정오)/.test(raw))
    return clarification('일정의 날짜와 시작·종료 시각을 적어 주세요. 반복 일정은 일정 화면에서 확인해 주세요.')
  if (/(?:전교사|모든\s*교사|학교\s*전체|전원|공개|비공개|대상자)/.test(raw))
    return clarification('일정 제목·날짜·시각으로 초안을 만든 뒤, 일정 화면에서 공개 범위와 대상을 선택해 주세요.')
  // 시험 표식과 인용한 제목의 숫자·날짜를 일정 정보로 소비하지 않는다.
  const literals: string[] = []
  let text = raw.trim().replace(/\[[^\]\r\n]*\]|“[^”]*”|‘[^’]*’|"[^"\r\n]*"|'[^'\r\n]*'/g, literal => {
    literals.push(literal); return '\x01' + (literals.length - 1) + '\x02'
  })
  const restore = (value: string) => value.replace(/\x01(\d+)\x02/g, (_match, index) => literals[Number(index)])
  let date: string | null = null
  const dates = [...text.matchAll(draftDateWords)]
  if (dates.length > 1) return clarification('한 번에 한 날짜의 일정 초안을 만들 수 있어요. 사용할 날짜를 하나만 적어 주세요.')
  if (dates[0]) {
    const token = dates[0][0]
    if (/^[월화수목금토일]요일$/.test(token))
      return clarification('이번 주인지 다음 주인지 알려 주세요. 날짜로 적어도 됩니다. 예: 11월 18일 수요일')
    date = resolveDraftDate(token, basisDate)
    if (!date) return clarification('실제 날짜와 요일이 맞는지 확인해 주세요. 예: 11월 18일 수요일 또는 2026-11-18')
    text = text.replace(token, ' ').trim()
  }
  // 인식하지 못한 날짜를 제목으로 옮기지 않는다. 기준일·다음 해를 임의로 선택하지 않는다.
  if (/\d{1,4}\s*(?:년|월|일)|\d+[-/.]\d+|[월화수목금토일]요일|내후년|내년|올해|작년|금년|익년|[~～-]\s*\d{1,2}(?:일)?(?=\s|$)/.test(text))
    return clarification('날짜를 하나만 적어 주세요. 예: 11월 18일 수요일, 11/18, 18일, 내일.')

  const allDay = /(?:하루\s*)?종일/.test(text)
  text = text.replace(/(?:하루\s*)?종일/g, ' ')
  if (/\d+:\d+:|\d+\s*초/.test(text))
    return clarification('일정 시각은 분 단위로 적어 주세요. 예: 15:00~16:00')
  const times = [...text.matchAll(/(?<!\d)(?:(오전|오후)\s*)?(\d{1,2})(?::(\d{2})(?!\d)|시(?:\s*(반|\d{1,2}\s*분))?)/g)]
  if (times.length > 2 || (allDay && times.length)) return clarification('종일 일정 또는 시작·종료 시각 중 한 가지 방식으로 적어 주세요.')
  let period: string | undefined, startTime: string | null = null, endTime: string | null = null
  const values: string[] = []
  for (const time of times) {
    const hour = Number(time[2]), minute = time[3] ? Number(time[3]) : time[4] === '반' ? 30 : Number(time[4]?.match(/\d+/)?.[0] ?? 0)
    const explicitPeriod = time[1]
    if (explicitPeriod) period = explicitPeriod
    // 24시간 표기 또는 명시한 오전/오후만 사용한다. 두 번째 시각은 같은 구절의 오전/오후를 따른다.
    if (hour > 23 || minute > 59 || (period && (hour < 1 || hour > 12)))
      return clarification('시각을 확인해 주세요. 예: 오후 3시부터 4시까지 또는 15:00~16:00')
    if (!time[3] && hour >= 1 && hour <= 12 && !period)
      return clarification('오전인지 오후인지 함께 적어 주세요. 예: 오후 3시부터 4시까지')
    const converted = period ? (hour % 12) + (period === '오후' ? 12 : 0) : hour
    values.push(`${String(converted).padStart(2, '0')}:${String(minute).padStart(2, '0')}`)
    text = text.replace(time[0], ' ')
  }
  const onlyEnd = times.length === 1 && /^\s*까지/.test(raw.slice(raw.indexOf(times[0][0]) + times[0][0].length))
  if (values.length && !onlyEnd) startTime = values[0]
  if (onlyEnd) endTime = values[0]
  if (values.length === 2) endTime = values[1]
  if (startTime && endTime && endTime <= startTime)
    return clarification('종료 시각은 시작 시각보다 늦어야 해요. 여러 날 일정은 일정 화면에서 작성해 주세요.')
  if (/(?:오전|오후|\d+\s*(?:시|분|초)|\d+:)/.test(text))
    return clarification('시각을 HH:MM 또는 오전·오후 몇 시로 적어 주세요.')
  text = text.replace(/(?:부터|까지|에)(?=\s|$)|[~～]/g, ' ').replace(/\s+/g, ' ').trim()
  // '2층 협의실에서'처럼 장소가 명시된 부분만 분리한다. 남은 제목은 요약하지 않는다.
  const place = /(?:^|\s)((?:\d+층\s+|(?:본관|신관|별관)\s+)?(?:[^\s]+(?:실|관)|[^\s]*(?:운동장|강당)))에서(?=\s|$)/.exec(text)
  const location = place?.[1]
  if (place) text = (text.slice(0, place.index) + ' ' + text.slice(place.index + place[0].length)).replace(/\s+/g, ' ').trim()
  text = text.replace(/^(?:나의|내)\s+/, '').replace(/(?:을|를)$/, '').trim()
  return { kind: 'calendar', prompt, title: restore(text), date, startTime, endTime, allDay, ...(location ? { location: restore(location) } : {}) }
}

export function parseCalendarAudience(raw: string): string[] | null {
  const value = raw.trim().replace(/(?:입니다|이에요|예요|이야|야)$/, '').trim()
  const names = value.split(/\s*[,，]\s*|\s+(?:및|그리고)\s+|(?:과|와)\s+/)
    .map(name => name.trim().replace(/\s*(?:선생님|교사|부장님)$/, '').trim())
  return names.length && names.every(name => name && [...name].length <= SEARCH_LIMITS.queryChars &&
    /^[\p{L}\p{N}_-]+(?: [\p{L}\p{N}_-]+)*$/u.test(name) &&
    !/(?:모두|전체|전원|모든|전교사|누구나|아무나|말고|제외|보내|해줘|해주|공개|취소)/.test(name)) ? names : null
}

// 이 함수는 사용자가 직접 보낸 한 문장만 분류한다. 모델 답변·자료 본문에는 사용하지 않는다.
// 권한 검사와 저장은 각 원래 화면/서버가 맡고, 여기서는 요청 번호나 저장 성공을 만들지 않는다.
export function parseWorkspaceCommand(prompt: string, basisDate: string): WorkspaceCommand | null {
  if (typeof prompt !== 'string') return clarification('요청 내용을 확인해 주세요.')
  if (!validWorkspaceText(prompt))
    return clarification('요청 길이와 문자를 확인해 주세요. 한 번에 한 가지 업무를 적어 주세요.')
  const draft = parseDraftCommand(prompt, basisDate)
  if (draft) return draft
  let text = prompt.trim().replace(/\s+/g, ' ').replace(/[.!?。！？]+$/, '').trim()
  if (!text) return null
  // 인용·가정·부정·설명 요청을 실행 의사로 취급하지 않는다.
  if (/^(?:["'“‘`]|예시\s*[:：]|예를\s*들어)/.test(text) || /(?:라고|라는|말하면|입력하면|명령어|사용법|어떻게|가능한지|않|지\s*마|지\s*말|아니라)/.test(text))
    return null
  text = text.replace(/^(?:비서야|AI야|부탁인데)\s*[,，]?\s*/, '')
  if (/(?:열어|보여|찾아|검색해|등록해|추가해|만들어|이동해|수정해|완료해|변경해|바꿔|전송해|잡아)\s*(?:주고|줘서)|(?:열고|찾고|등록하고(?!\s*싶)|추가하고(?!\s*싶)|만들고(?!\s*싶)|이동하고|수정하고|완료하고|변경하고|바꾸고|전송하고|잡고(?!\s*싶))|[;；]/.test(text))
    return clarification('한 번에 한 가지 업무를 요청해 주세요. 먼저 할 메뉴 이동·검색·할 일·일정 초안을 적어 주세요.')
  const evaluation = text.match(new RegExp(`^평가\\s*계획서\\s*(작성|제출)(?:\\s*(?:메뉴|화면))?\\s*(?:을|를|으로|로)?\\s*${moveEnd}$`))
  if (evaluation) return {kind:'evaluation',target:evaluation[1] === '작성' ? 'authoring' : 'submissions'}
  const daily = parseDailyCommand(text, basisDate)
  if (daily) return daily
  for (const [page, aliases] of menus) {
    for (const alias of aliases) {
      if (new RegExp(`^${esc(alias)}(?:\\s*(?:메뉴|화면))?\\s*(?:을|를|으로|로)?\\s*${moveEnd}$`, 'i').test(text))
        return { kind: 'navigate', page }
    }
  }
  const specialist = parseSpecialistCommand(text)
  if (specialist) return specialist
  for (const [label, kinds] of searchScopes) {
    const pattern = esc(label)
    if (new RegExp(`^${pattern}\\s*(?:을|를)?\\s*${findEnd}$`).test(text))
      return clarification('찾을 자료의 제목이나 검색어를 함께 적어 주세요. 예: 학교 자료에서 출장 찾아줘')
    const match = text.match(new RegExp(`^${pattern}\\s*에서\\s*(.+?)\\s*${findEnd}$`))
      ?? text.match(new RegExp(`^${pattern}\\s*(?:검색|찾기)\\s*[:：]\\s*(.+)$`))
    if (match) return queryCommand(match[1].replace(/\s+(?:을|를)$/, ''), kinds)
    const reverse = text.match(new RegExp(`^(.+?)\\s+${pattern}\\s*(?:을|를)?\\s*${findEnd}$`))
    if (reverse) return queryCommand(reverse[1], kinds)
  }
  const anySearch = text.match(new RegExp(`^(?:검색|찾기)\\s*[:：]\\s*(.+)$`))
  if (anySearch) return queryCommand(anySearch[1], searchScopes.find(([label]) => label === '전체')![1])
  const taskChange = parseTaskChangeCommand(text, basisDate)
  if (taskChange) return taskChange
  const task = text.match(new RegExp(`^(.*?)\\s*(?:개인\\s*)?할\\s*일(?:로|에)?\\s*${makeEnd}$`))
    ?? text.match(new RegExp(`^할\\s*일\\s*(?:추가|등록|작성)\\s*[:：]\\s*(.+)$`))
  if (task) {
    if (!task[1].trim()) return clarification('추가할 할 일 내용을 적어 주세요. 예: 안내장 작성 할 일로 추가해줘')
    return { kind: 'task', prompt }
  }
  // 두 번째 문장의 대상은 검색 힌트일 뿐이다. 교사는 후보에서 직접 선택한다.
  const audience = /[.!。！]\s*(?:대상(?:자)?|참석자|참여자)(?:은|는|[:：])?\s*(.+)$/.exec(text)
  const calendarText = audience ? text.slice(0, audience.index).trim() : text
  const calendar = calendarText.match(new RegExp(`^(.*?)\\s*일정(?:\\s*초안)?(?:을|를)?\\s*${makeEnd}$`))
    ?? calendarText.match(new RegExp(`^일정\\s*초안\\s*[:：]\\s*(.+)$`))
  if (calendar) {
    const parsed = parseCalendarFields(prompt, calendar[1], basisDate)
    if (parsed.kind === 'clarify' || !audience) return parsed
    const names = parseCalendarAudience(audience[1])
    return names ? { ...parsed, audienceQueries: names } : clarification('일정 대상의 교사 이름을 적어 주세요. 전체 공개는 일정 화면에서 확인합니다.')
  }
  // '잡아줘'만으로는 일정인지 확실하지 않으므로 회의·연수처럼 일정 이름이 명시된 경우만 연다.
  const meeting = text.match(new RegExp(`^(.*?(?:회의|연수|면담|모임|상담))(?:을|를)?\\s+잡아\\s*${askEnd}$`))
  if (meeting) return parseCalendarFields(prompt, meeting[1], basisDate)
  if (/(?:삭제|수정|취소|승인|공개|전송|제출|확정)(?:해|해줘|해 주세요|해주세?요|해 주십시오)$/.test(text))
    return clarification('해당 업무 화면에서 대상과 내용을 확인한 뒤 처리해 주세요. 메뉴 이동이나 새 할 일·일정 초안은 여기서 도와드릴 수 있어요.')
  return null
}
