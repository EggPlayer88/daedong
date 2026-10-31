import { useNavigate } from 'react-router-dom'
import { WorkspaceShell } from '../../../workhub/src/app/WorkspaceShell'
import { enabledModules } from '../../../workhub/src/modules'
import { useAuth } from '../lib/AuthContext.jsx'
import { useMessagingPilot } from '../lib/MessagingPilotContext.jsx'
import { hasWorkhubParticipant } from '../lib/workhub-participant.js'
import { hasMessagingPilot } from '../lib/messaging-pilot.js'
import { participantPage } from '../../../workhub/src/participation/page'
import { AppearanceSurface } from './AppearanceSurface.jsx'

export default function UnifiedPageShell({ children }) {
  const { profile } = useAuth(),
    { access } = useMessagingPilot(),
    navigate = useNavigate()
  const participant = hasWorkhubParticipant(profile, access),
    messaging = hasMessagingPilot(profile, access)
  const allowed = enabledModules('connected').filter(
    (item) =>
      profile?.role === 'superadmin' ||
      (participant
        ? access.scopes.map(participantPage).includes(item.id)
        : messaging && item.id === 'messages'),
  )
  return (
    <AppearanceSurface>
      <WorkspaceShell
        mode="connected"
        page="home"
        memberName={profile?.name ?? '선생님'}
        schoolName="학교 업무"
        participant={profile?.role !== 'superadmin'}
        navigationModules={allowed}
        onNavigate={(page) => navigate(`/workhub?view=${page}`)}
      >
        <div className="site-legacy-surface">{children}</div>
      </WorkspaceShell>
    </AppearanceSurface>
  )
}
