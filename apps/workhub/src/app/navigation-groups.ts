import type { PageId, WorkhubModule } from '../modules'

// 메뉴 배치만 묶는다. 실제 공개 범위는 enabledModules의 결과를 그대로 따른다.
export const navigationGroups: { label: string; home: PageId; pages: PageId[] }[] = [
  { label: '홈', home: 'home', pages: ['home', 'calendar'] },
  { label: '시간표', home: 'timetable', pages: ['timetable', 'students'] },
  { label: '업무', home: 'tasks', pages: ['tasks', 'collections', 'cooperation'] },
  { label: '자료', home: 'documents', pages: ['documents', 'knowledge'] },
]

export function availableNavigation(modules: readonly WorkhubModule[], page: PageId) {
  const primary = navigationGroups.flatMap(group => {
    const module = modules.find(item => item.id === group.home)
    return module ? [{ ...group, module, active: group.pages.includes(page) }] : []
  })
  if (!primary.some(group => group.home === 'timetable') && modules.some(item => item.id === 'calendar')) {
    const home = primary.find(group => group.home === 'home')
    if (home) { home.pages = ['home']; home.active = page === 'home' }
    primary.splice(1, 0, { label: '학교 일정', home: 'calendar', pages: ['calendar'], module: modules.find(item => item.id === 'calendar')!, active: page === 'calendar' })
  }
  const currentGroup = primary.find(group => group.active)
  const related = currentGroup ? currentGroup.pages.flatMap(id => modules.filter(item => item.id === id)) : []
  const additional = modules.filter(item => item.id !== 'assistant' && !primary.some(group => group.home === item.id))
  return { primary, related, additional }
}
