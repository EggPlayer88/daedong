export type PageId = 'home' | 'calendar' | 'tasks' | 'collections' | 'students' | 'knowledge' | 'messages' | 'schoolAdmin' | 'documents' | 'cooperation' | 'assistant'
export type WorkspaceMode = 'connected' | 'preview'
export type ModuleGroup = 'today' | 'school' | 'work' | 'teaching'
export interface WorkhubModule {
  id: PageId
  title: string
  group: ModuleGroup
  parentId?: PageId
  icon: string
  modes: readonly WorkspaceMode[]
  visibility: 'superadmin'
  productionEnabled: false
}

// 개발 기능 목록이다. 실제 진입 권한은 main의 모듈 레지스트리와 서버가 판단한다.
export const workhubModules: readonly WorkhubModule[] = [
  { id: 'home', title: '오늘', group: 'today', icon: '◷', modes: ['connected', 'preview'], visibility: 'superadmin', productionEnabled: false },
  { id: 'calendar', title: '학교 일정', group: 'school', icon: '▦', modes: ['connected', 'preview'], visibility: 'superadmin', productionEnabled: false },
  { id: 'tasks', title: '내 업무', group: 'today', parentId: 'home', icon: '✓', modes: ['connected', 'preview'], visibility: 'superadmin', productionEnabled: false },
  { id: 'collections', title: '자료 수합', group: 'work', icon: '▤', modes: ['connected', 'preview'], visibility: 'superadmin', productionEnabled: false },
  { id: 'documents', title: '문서함', group: 'work', icon: '▤', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'cooperation', title: '협업 요청', group: 'work', icon: '◇', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'assistant', title: 'AI 비서', group: 'work', icon: '□', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'knowledge', title: '학교 자료', group: 'work', icon: '▤', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'messages', title: '메시지와 알림', group: 'work', icon: '□', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'schoolAdmin', title: '학교 관리', group: 'work', icon: '◇', modes: ['connected'], visibility: 'superadmin', productionEnabled: false },
  { id: 'students', title: '수업과 학생', group: 'teaching', icon: '◎', modes: ['connected', 'preview'], visibility: 'superadmin', productionEnabled: false },
]

export const moduleGroupLabels: Readonly<Record<ModuleGroup, string>> = { today: '나의 하루', school: '학교', work: '업무', teaching: '나의 수업' }

// 메뉴 구성만 결정한다. 실제 접근 승인과 학교 범위 검사는 연결 계층이 담당한다.
export function enabledModules(mode: WorkspaceMode): readonly WorkhubModule[] {
  return workhubModules.filter(module => module.modes.includes(mode))
}
