import { assistantRequestEnding } from './request-expression'
import { draftDateWords, resolveDraftDate } from './draft-date'
import { normalizeTaskInput } from '../tasks/validation'
import type { TaskDraft } from './contracts'
import { validWorkspaceText } from './workspace-commands'

export type DraftRevisionTarget = 'task' | 'calendar' | 'message' | 'collection'
export type DraftRevisionField = 'title' | 'notes' | 'dueDate' | 'date' | 'startTime' | 'endTime' | 'time' | 'location' | 'body' | 'instructions' | 'people'
export type DraftRevision = { kind: 'none' } | { kind: 'clarify'; message: string } |
  { kind: 'patch'; field: DraftRevisionField; value: string }
const aliases: Record<string, DraftRevisionField> = {
  제목: 'title', 메모: 'notes', 기한: 'dueDate', 마감: 'dueDate', 마감일: 'dueDate', 제출기한: 'dueDate',
  날짜: 'date', 시작: 'startTime', 시작시간: 'startTime', 시작시각: 'startTime', 종료: 'endTime', 종료시간: 'endTime', 종료시각: 'endTime',
  시간: 'time', 시각: 'time', 장소: 'location', 본문: 'body', 내용: 'body', 안내: 'instructions', 안내문: 'instructions',
  수신자: 'people', 받는사람: 'people', 대상: 'people', 대상자: 'people', 제출대상: 'people', 참석자: 'people', 참여자: 'people',
}
const allowed: Record<DraftRevisionTarget, readonly DraftRevisionField[]> = {
  task: ['title', 'notes', 'dueDate'], calendar: ['title', 'date', 'startTime', 'endTime', 'time', 'location', 'people'],
  message: ['body', 'people'], collection: ['title', 'instructions', 'dueDate', 'people'],
}
const labelPattern = '(제출\\s*기한|제출\\s*대상|받는\\s*사람|시작\\s*(?:시간|시각)|종료\\s*(?:시간|시각)|마감일|안내문|대상자|참석자|참여자|수신자|제목|메모|기한|마감|날짜|시작|종료|시간|시각|장소|본문|내용|안내|대상)'
const prefix = new RegExp('^' + labelPattern + '(만)?(?:(?:은|는|을|를)\\s*|\\s*[:：]\\s*|\\s+)')
const spokenEnd = new RegExp('(?:으로|로)\\s*(?:바꿔|변경해|수정해|해)\\s*' + assistantRequestEnding + '[.!?。！？]*$')
const clear = new RegExp('^(?:비워|지워)\\s*' + assistantRequestEnding + '[.!?。！？]*$')
const extraField = new RegExp('(?:[,，\\r\\n]|\\s+)' + labelPattern + '\\s*(?:은|는|[:：])')
const quotes: Record<string, string> = { '"': '"', "'": "'", '“': '”', '‘': '’' }
const explain = (message: string): DraftRevision => ({ kind: 'clarify', message })

// 필드 이름이 있는 요청만 현재 초안에 적용한다. 본문/메모의 명령어는 데이터이며 실행하지 않는다.
export function parseDraftRevision(reply: string, target: DraftRevisionTarget): DraftRevision {
  if (typeof reply !== 'string' || !validWorkspaceText(reply)) return explain('수정할 항목과 올바른 길이의 내용을 적어 주세요.')
  const text = reply.trim(), match = prefix.exec(text)
  if (!match) return { kind: 'none' }
  const field = aliases[match[1].replace(/\s/g, '')]
  if (!allowed[target].includes(field)) return explain('현재 초안에서 수정할 수 없는 항목입니다. 기존 내용은 유지했습니다.')
  const literal = /[:：]/.test(match[0])
  let value = text.slice(match[0].length).trim()
  if (!literal) {
    if (clear.test(value)) value = ''
    else {
      const ending = spokenEnd.exec(value)
      if (ending) value = value.slice(0, ending.index).trim()
      else if (match[2]) value = value.replace(/(?:으로|로)[.!。]*$/, '').trim()
      const closing = quotes[value[0]]
      if (closing) {
        if (!value.endsWith(closing)) return explain('따옴표 안의 내용을 끝까지 적어 주세요. 기존 내용은 유지했습니다.')
        value = value.slice(1, -1)
      } else if (extraField.test(value) || /[;；]|(?:그리고|이어서|말고|아니라|하지\s*마)|(?:바꾸지|수정하지)|(?:전송|저장|공개|삭제|추가)(?:해|하|해\s*줘)/.test(value)) {
        return explain('한 항목의 새 값만 적어 주세요. 본문 그대로 넣으려면 “본문:”처럼 콜론 뒤에 적어 주세요.')
      }
    }
  }
  return { kind: 'patch', field, value }
}

// 상대 날짜를 현재 학교 기준일에서 한 번만 해석한다. 여분의 시각·다른 필드를 버리지 않는다.
export function revisionDate(value: string, basisDate: string): string | null {
  const text = value.trim().replace(/(?:까지|입니다|이에요|예요|이요|요)[.!。]*$/, '').trim()
  const dates = [...text.matchAll(draftDateWords)]
  return dates.length === 1 && dates[0][0] === text ? resolveDraftDate(text, basisDate) : null
}

export function reviseTaskDraft(input: TaskDraft, reply: string, basisDate: string):
  { kind: 'revised'; input: TaskDraft } | Exclude<DraftRevision, {kind: 'patch'}> {
  const change = parseDraftRevision(reply, 'task')
  if (change.kind !== 'patch') return change
  let value = change.value
  if (change.field === 'dueDate' && value) {
    const date = revisionDate(value, basisDate)
    if (!date) return {kind: 'clarify', message: '기한에는 실제 날짜 하나만 적어 주세요. 기존 기한은 유지했습니다.'}
    value = date
  }
  try {
    const next = normalizeTaskInput({...input, [change.field]: value})
    return {kind: 'revised', input: next}
  } catch (error) {
    return {kind: 'clarify', message: (error instanceof Error ? error.message : '수정 내용을 확인해 주세요.') + ' 기존 내용은 유지했습니다.'}
  }
}
