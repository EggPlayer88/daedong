export interface WorkhubModule { id: string; title: string; visibility: 'superadmin'; productionEnabled: false }

// 운영 앱의 모듈 레지스트리를 바꾸지 않는 개발 계약 선언이다.
export const workhubModules: readonly WorkhubModule[] = [
  { id: 'home', title: '오늘', visibility: 'superadmin', productionEnabled: false },
  { id: 'calendar', title: '학교 일정', visibility: 'superadmin', productionEnabled: false },
]
