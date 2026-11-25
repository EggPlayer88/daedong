import type { ReactNode } from 'react'
import styles from './daily-overview-layout.css?inline'

interface DailyOverviewLayoutProps {
  presentation: 'home' | 'assistant'
  attention?: ReactNode
  lessons?: ReactNode
  calendar: ReactNode
  tasks?: ReactNode
  supplementary?: ReactNode
  children?: ReactNode
}

// 제목·조회 상태·동작은 각 원본 영역이 맡고, 홈과 대화는 같은 배치만 공유한다.
export function DailyOverviewLayout({ presentation, attention, lessons, calendar, tasks, supplementary, children }: DailyOverviewLayoutProps) {
  const slots = [
    { key: 'attention', homeClass: 'home-priority', content: attention },
    { key: 'lessons', homeClass: 'home-timetable-section', content: lessons },
    { key: 'calendar', homeClass: 'home-today', content: calendar },
    { key: 'tasks', homeClass: 'home-work-column', content: tasks },
  ]
  return <div className="daily-overview" data-daily-presentation={presentation}>
    <style>{styles}</style>
    <div className={`daily-overview-layout ${presentation === 'home' ? 'home-dashboard home-dashboard-grid' : 'assistant-daily-grid'}`}>
      {slots.map(({ key, homeClass, content }) => content && <div key={key} data-daily-slot={key} className={`daily-overview-card${presentation === 'home' ? ` home-dashboard-card ${homeClass}` : ''}`}>{content}</div>)}
      {children}
    </div>
    {supplementary && <div className="daily-overview-supplementary">{supplementary}</div>}
  </div>
}
