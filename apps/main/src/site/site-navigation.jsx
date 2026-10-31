import { NavLink, useLocation } from 'react-router-dom'
import { SiteNavigationContext } from '../../../workhub/src/app/site-navigation'
import { visibleModules } from '../lib/modules.js'
import { useAuth } from '../lib/AuthContext.jsx'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { useSeasonalWork } from './SeasonalWorkProvider.jsx'

export function SiteNavigationProvider({ children }) {
  const { profile } = useAuth(),
    { access } = useMessagingPilot(),
    { pathname } = useLocation()
  const seasonal = useSeasonalWork()
  const modules = visibleModules(profile, access)
  const link = (item) => (
    <NavLink key={item.key} to={item.to} end={item.end} className="ws-menu-button ws-site-link">
      {item.label}
    </NavLink>
  )
  const visible = seasonal.state?.enabled === true
  const current = modules.find((item) => item.to === pathname)
  const value = {
    current:
      pathname === '/workhub' ? undefined : { key: pathname, title: current?.label ?? '학교 업무' },
    seasonal: visible
      ? modules.filter((item) => ['doc-ai', 'submissions'].includes(item.key)).map(link)
      : undefined,
    utilities: modules
      .filter((item) =>
        ['account', 'admin-users', 'workhub-setup', 'calendar', 'seasonal-settings'].includes(
          item.key,
        ),
      )
      .map(link),
    home: modules.some((item) => item.key === 'workhub')
      ? undefined
      : link(modules.find((item) => item.key === 'dashboard')),
  }
  return <SiteNavigationContext.Provider value={value}>{children}</SiteNavigationContext.Provider>
}
