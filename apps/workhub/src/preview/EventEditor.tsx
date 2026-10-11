import type { ComponentProps } from 'react'
import { EventEditor as CalendarEditor } from '../calendar/EventEditor'
import { relationLabels } from './fixtures'

// 기존 개발 진입의 기본값을 보존한다. 실제 연결은 이 파일을 import하지 않는다.
export { dateLabel, eventTime, visibilityLabels } from '../calendar/EventEditor'
export type { Adapter } from '../calendar/EventEditor'
export function EventEditor(props: ComponentProps<typeof CalendarEditor>) {
  return <CalendarEditor relationLabels={relationLabels} demo storageLabel="가상 메모리에 저장" {...props} />
}
