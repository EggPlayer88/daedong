import { resolveAssistantDueDate } from './task-change-command'

export interface DailyCommand { kind: 'daily'; view: 'overview' | 'meals' | 'notifications'; date: string }
type Clarification = { kind: 'clarify'; message: string }

// 학교 원본을 조회하는 입구만 정한다. 일반 조언이나 조회 문장 속 실행 요청을 처리하지 않는다.
export function parseDailyCommand(text: string, basisDate: string): DailyCommand | Clarification | null {
  const end = '(?:보여|알려|확인해|요약해|열어)\\s*(?:줘|주세요|줄래|줄래요|주십시오|주시겠어요)'
  const overview = new RegExp(`^(?:오늘(?:의)?\\s*)?(?:내(?:가)?\\s*)?(?:할\\s*일(?:과\\s*일정)?|일정과\\s*할\\s*일|업무|확인할\\s*일|홈)(?:\\s*(?:요약|현황))?\\s*(?:을|를)?\\s*${end}$`)
  const notification = new RegExp(`^(?:내\\s*)?(?:업무\\s*)?알림(?:\\s*(?:목록|현황))?\\s*(?:을|를)?\\s*${end}$`)
  if (notification.test(text)) return { kind: 'daily', view: 'notifications', date: basisDate }
  // '할 일 보여줘'는 기존 전체 할 일 메뉴로 남기고 '오늘/요약/현황'이 있을 때 요약으로 구별한다.
  if (overview.test(text) && /오늘|요약|현황|확인할/.test(text)) return { kind: 'daily', view: 'overview', date: basisDate }
  const meal = text.match(new RegExp(`^(.*?)\\s*급식(?:\\s*(?:메뉴|식단))?(?:은|는|을|를)?\\s*(?:${end}|뭐야|뭐예요|뭔가요)$`))
  if (!meal) return null
  const token = meal[1].trim().replace(/의$/, '').trim()
  const date = resolveAssistantDueDate(token || '오늘', basisDate)
  if (!date) return { kind: 'clarify', message: '급식 날짜를 오늘·내일 또는 YYYY-MM-DD로 적어 주세요.' }
  return { kind: 'daily', view: 'meals', date }
}
