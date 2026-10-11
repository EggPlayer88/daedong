export interface WorkhubModule { id: string; title: string; visibility: 'superadmin'; productionEnabled: false }

// 개발 기능 목록이다. 실제 진입 권한은 main의 모듈 레지스트리와 서버가 판단한다.
export const workhubModules: readonly WorkhubModule[] = [
  { id: 'home', title: '오늘', visibility: 'superadmin', productionEnabled: false },
  { id: 'calendar', title: '학교 일정', visibility: 'superadmin', productionEnabled: false },
  { id: 'tasks', title: '내 업무', visibility: 'superadmin', productionEnabled: false },
  { id: 'collections', title: '자료 수합', visibility: 'superadmin', productionEnabled: false },
  { id: 'students', title: '수업과 학생', visibility: 'superadmin', productionEnabled: false },
]
