import { SEARCH_LIMITS } from '../search/limits'
import { TASK_INPUT_LIMITS } from '../tasks/validation'

export type TaskChange = { kind: 'dueDate'; value: string } | { kind: 'notes'; value: string } | { kind: 'complete' }
export interface TaskChangeCommand { kind: 'taskChange'; prompt: string; query: string; change: TaskChange }
type Clarification = { kind: 'clarify'; message: string }

const clarify = (message: string): Clarification => ({ kind: 'clarify', message })
const datePattern = /^(?:오늘|내일|모레|(?:이번\s*주\s*|다음\s*주\s*)?[월화수목금토일]요일|\d{4}[-./]\d{1,2}[-./]\d{1,2})$/
const weekdayIndex = '일월화수목금토'

function dueDateFrom(token: string, basisDate: string): string | null {
  if (!datePattern.test(token)) return null
  const base = new Date(basisDate + 'T00:00:00.000Z')
  if (!Number.isFinite(base.getTime()) || base.toISOString().slice(0, 10) !== basisDate) return null
  if (/^\d/.test(token)) {
    const [year, month, day] = token.split(/[-./]/)
    const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    const parsed = new Date(date + 'T00:00:00.000Z')
    return year !== '0000' && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
  }
  const relative: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 }
  const weekday = weekdayIndex.indexOf(token.at(-3) ?? '')
  const day = base.getUTCDay()
  // 요일만 말하면 오늘을 포함한 가장 가까운 요일, '이번 주/다음 주'는 월요일 기준이다.
  const offset = relative[token] ?? (token.startsWith('이번') || token.startsWith('다음')
    ? (weekday + 6) % 7 - (day + 6) % 7 + (token.startsWith('다음') ? 7 : 0)
    : (weekday - day + 7) % 7)
  base.setUTCDate(base.getUTCDate() + offset)
  return base.toISOString().slice(0, 10)
}

export function parseTaskChangeCommand(prompt: string, basisDate: string): TaskChangeCommand | Clarification | null {
  // 공통 분류기에서 인용·부정·설명·복합 요청을 먼저 제외한다. 이 함수는 대상을 조회할 의도만 만든다.
  const value = prompt.trim()
  const complete = value.match(/^(.*?)\s*(?:완료(?:\s*처리)?|완료로\s*변경)(?:해\s*(?:줘|주세요|주십시오)|해줘요)$/)
  const update = value.match(/^(.*?)\s*(?:바꿔|변경해|수정해)\s*(?:줘|주세요|주십시오)$/)
  if (!complete && !update) return null
  let rawTarget = '', change: TaskChange
  if (complete) {
    rawTarget = complete[1]
    change = { kind: 'complete' }
  } else {
    const body = update![1].trim()
    const memo = body.match(/^(.*?)\s*(?:의\s*)?메모(?:를|는)?\s+(.+?)(?:으)?로$/)
    const due = body.match(/^(.*?)\s+(?:((?:이번\s*주|다음\s*주)\s*[월화수목금토일]요일|\S+?))(?:까지)?(?:으)?로$/)
    if (memo) {
      rawTarget = memo[1]; const notes = memo[2].trim()
      if (!notes || Array.from(notes).length > TASK_INPUT_LIMITS.notesChars)
        return clarify(`메모를 ${TASK_INPUT_LIMITS.notesChars}자 이내로 적어 주세요.`)
      change = { kind: 'notes', value: notes }
    } else if (due) {
      rawTarget = due[1].replace(/(?:의\s*)?(?:기한|마감일?)(?:을|를|은|는)?$/, '')
      const date = dueDateFrom(due[2], basisDate)
      if (!date) return clarify('변경할 기한을 날짜나 요일로 적어 주세요. 예: 제출 자료 확인을 금요일까지로 바꿔줘')
      change = { kind: 'dueDate', value: date }
    } else return clarify('할 일 제목과 바꿀 기한 또는 메모를 알려 주세요. 예: 제출 자료 확인을 금요일까지로 바꿔줘')
  }
  const query = rawTarget.trim().replace(/^(?:내\s+)?(?:할\s*일|업무)\s+/, '').replace(/(?:을|를)$/, '').trim()
  if (!query || /^(?:내\s*)?(?:일|업무|할\s*일|전부|모두|전체|모든|이것|그것|이거|그거)$/.test(query)
    || /(?:모두|전부|전체)\s*(?:완료|처리)?$|(?:하고|한 뒤|변경하고|수정하고|완료하고)|[;；]/.test(query)
    || Array.from(query).length > SEARCH_LIMITS.queryChars) return clarify('변경할 개인 할 일의 제목을 한 가지 적어 주세요.')
  return { kind: 'taskChange', prompt, query, change }
}
