import { createContext, useContext, type ReactNode } from 'react'

// 사이트가 구성한 표시 정보만 받는다. 이 문맥은 로그인·학교·권한을 부여하지 않는다.
export interface SiteNavigation {
  current?: { title: string; key: string }
  seasonal?: ReactNode
  utilities?: ReactNode
  home?: ReactNode
}
export const SiteNavigationContext = createContext<SiteNavigation>({})
export const useSiteNavigation = () => useContext(SiteNavigationContext)
