import { parseWorkspaceCommand, validWorkspaceText, type WorkspaceCommand } from './workspace-commands'
import { specialistWorkflow } from './specialist-workflows'
import { workhubModules } from '../modules'

// UI에서 한 번에 검토하는 업무 수다. 서버 일괄 실행이나 유료 호출 한도가 아니다.
export const WORKSPACE_PLAN_MAX_STEPS = 4
export type PlannedWorkspaceCommand = Exclude<WorkspaceCommand, { kind: 'clarify' }>
export interface WorkspacePlanStep {
  /** 화면 식별자이며 저장 요청 번호로 사용하지 않는다. */
  id: string
  prompt: string
  label: string
  command: PlannedWorkspaceCommand
}
export interface WorkspacePlan {
  kind: 'plan'
  prompt: string
  basisDate: string
  steps: WorkspacePlanStep[]
}
export type WorkspacePlanResult = WorkspacePlan | { kind: 'clarify'; message: string } | null

const quoteEnds: Readonly<Record<string, string>> = { '"': '"', "'": "'", '“': '”', '‘': '’', '`': '`' }
const dataPrefix = /^(?:(?:메시지|(?:자료\s*)?수합|일정)\s*초안|할\s*일\s*(?:추가|등록|작성)|(?:학교\s*자료(?:실)?|자료실|문서함?|자료\s*수합|수합|학교\s*일정|일정|내\s*업무|할\s*일|협업|메시지|메신저|수업|전체|자료)\s*(?:검색|찾기)|검색|찾기)\s*[:：]/
const badRequest = (message: string): Exclude<WorkspacePlanResult, WorkspacePlan | null> => ({ kind: 'clarify', message })
const oneByOne = '각 업무를 한 줄씩 완전한 요청으로 적어 주세요. 빠뜨린 단계 없이 확인한 뒤 하나씩 진행할게요.'
const explicitRequest = /(?:줘|주세요|주십시오|줄래요?)[.!?。！？]*$/

function stepLabel(command: PlannedWorkspaceCommand): string {
  switch (command.kind) {
    case 'navigate': return (workhubModules.find(module => module.id === command.page)?.title ?? '업무') + ' 열기'
    case 'specialist': return specialistWorkflow(command.task)?.title ?? '업무 검토'
    case 'search': return '자료 찾기 · ' + command.query
    case 'task': return '할 일 추가 검토'
    case 'taskChange': return command.change.kind === 'complete' ? '할 일 완료 검토' : '할 일 변경 검토'
    case 'calendar': return '일정 초안 · ' + (command.title || '제목 입력 필요')
    case 'messageDraft': return '메시지 초안'
    case 'collectionDraft': return '수합 초안 · ' + command.title
  }
}

// 인용문 안의 접속사와 줄바꿈은 데이터로 남긴다. 저장할 본문은 이 함수로 자르지 않는다.
function splitExplicitRequests(text: string): string[] | null {
  const parts: string[] = []
  let start = 0, closing: string | undefined, escaped = false
  for (let index = 0; index < text.length; index++) {
    const point = text[index]
    if (closing) {
      if (escaped) { escaped = false; continue }
      if (point === '\\') { escaped = true; continue }
      if (point === closing) closing = undefined
      continue
    }
    if (Object.hasOwn(quoteEnds, point)) { closing = quoteEnds[point]; continue }
    const separator = point === ';' || point === '；' ? point
      : point === '\n' || point === '\r' ? text.slice(index).match(/^(?:\r\n|\n|\r)/)![0]
      : index > 0 && /\s/.test(text[index - 1]) ? text.slice(index).match(/^(?:그리고|그\s*다음(?:에)?|이어서)(?=\s|$)/)?.[0] : undefined
    if (!separator) continue
    // 두 번째 이후 단계의 콜론 본문도 끝까지 한 덩어리다. 다음 업무를 구별하려면 번호 목록을 쓴다.
    if (dataPrefix.test(text.slice(start, index).trim())) return [...parts, text.slice(start).trim()]
    parts.push(text.slice(start, index).trim())
    index += separator.length - 1
    start = index + 1
  }
  if (!parts.length) return null
  parts.push(text.slice(start).trim())
  return parts
}

function numberedRequests(text: string): { parts: string[]; valid: boolean } | null {
  if (!/^\s*\d+[.)]\s+/.test(text)) return null
  const lines = text.split(/\r\n|\n|\r/), parts: string[] = []
  let current = '', number = 0, valid = true
  for (const line of lines) {
    const next = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
    if (next) {
      if (number) parts.push(current.trim())
      number++
      if (next[1] !== String(number)) valid = false
      current = next[2]
    } else current += '\n' + line
  }
  if (number) parts.push(current.trim())
  return { parts, valid }
}

/**
 * 사용자가 직접 쓴 명시적 복합 요청의 검토 목록만 만든다. 실행·요청 번호·성공 판정은 만들지 않는다.
 * 각 단계는 기존 단일 명령 경로에서 명시 선택하고, 원래 기준일/소속이 달라지면 다시 검토한다.
 * null이면 단일 요청/일반 대화 경로로 넘긴다. clarify이면 어느 단계도 실행하지 않는다.
 */
export function parseWorkspacePlan(prompt: string, basisDate: string): WorkspacePlanResult {
  if (typeof prompt !== 'string' || !validWorkspaceText(prompt))
    return badRequest('요청 길이와 문자를 확인해 주세요.')
  const text = prompt.trim().replace(/^(?:비서야|AI야|부탁인데)\s*[,，]?\s*/, '')
  if (!text || /^(?:["'“‘`]|예시\s*[:：]|예를\s*들어|(?:학생\s*기록|참고\s*자료|AI\s*답변)\s*[:：])/.test(text)) return null
  // 콜론 뒤는 본문/검색어다. 안에 완전한 명령이 들어 있어도 별개 업무로 승격하지 않는다.
  if (dataPrefix.test(text)) return null
  const numbered = numberedRequests(text)
  const parts = numbered?.parts ?? splitExplicitRequests(text)
  if (!parts || parts.length < 2) return null
  const commands = parts.map(part => part ? parseWorkspaceCommand(part, basisDate) : null)
  // 번호 목록은 질문을 정리하는 데도 쓰인다. 모두 일반 대화이면 업무 계획으로 가로채지 않는다.
  // 실행 가능한 명령이 없는 대화이며, 지원 업무나 입력 오류가 섞인 목록만 전체 보류한다.
  if (numbered && commands.every(command => command === null) && parts.every(Boolean)) return null
  // 일반 문장의 뒤쪽에서 우연히 찾은 명령만 떼어 실행하지 않는다.
  // 다만 앞부분도 완전한 부탁이거나 이미 입력 오류이면 지원하지 않는 단계까지 통째로 보류한다.
  if (!numbered && (!commands[0] || commands[0].kind === 'clarify')) {
    const explicitFirst = commands[0]?.kind === 'clarify' || explicitRequest.test(parts[0])
    return explicitFirst && commands.some(command => command && command.kind !== 'clarify') ? badRequest(oneByOne) : null
  }
  if (numbered && !numbered.valid) return badRequest('업무 번호를 1번부터 빠짐없이 적어 주세요.')
  if (parts.length > WORKSPACE_PLAN_MAX_STEPS)
    return badRequest(`한 번에 ${WORKSPACE_PLAN_MAX_STEPS}개 업무까지 검토할 수 있어요. 나머지는 다음 요청으로 나눠 주세요.`)
  if (commands.some(command => !command || command.kind === 'clarify')) return badRequest(oneByOne)
  return {
    kind: 'plan', prompt, basisDate,
    steps: commands.map((command, index) => ({
      id: `step-${index + 1}`, prompt: parts[index], label: stepLabel(command as PlannedWorkspaceCommand),
      command: command as PlannedWorkspaceCommand,
    })),
  }
}
