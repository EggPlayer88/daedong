import data from './guide-data.json'
import { workhubModules, type PageId } from '../modules'

export interface WorkspaceGuide { id: string; title: string; summary: string; page: PageId; keywords: string[]; steps: [string, string, string]; note: string }

// 안내에서 새 주소나 권한을 만들지 않고 기존 메뉴 목록만 사용한다.
export const workspaceGuides: readonly WorkspaceGuide[] = data.map(item => {
  if (!workhubModules.some(module => module.id === item.page) || item.steps.length !== 3) throw new Error('업무실 안내 자산을 확인해 주세요.')
  return { ...item, page: item.page as PageId, steps: item.steps as [string, string, string] }
})
export function findGuides(query: string): readonly WorkspaceGuide[] {
  const words = query.normalize('NFKC').trim().toLocaleLowerCase('ko').split(/\s+/).filter(Boolean)
  return workspaceGuides.filter(guide => {
    const text = [guide.title, guide.summary, ...guide.keywords, ...guide.steps, guide.note].join(' ').normalize('NFKC').toLocaleLowerCase('ko')
    return words.every(word => text.includes(word))
  })
}
export function guidePageTitle(page: PageId): string { return workhubModules.find(module => module.id === page)?.title ?? '해당 메뉴' }
