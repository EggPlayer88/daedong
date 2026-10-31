import { recoveryScope } from '../app/pending-requests'
import { MessageComposeRequest, MessagingWorkspaceProps } from './workspace-model'
import { useMessagingWorkspace } from './useMessagingWorkspace'
import { MessagingView } from './MessagingView'
export function MessagingWorkspace(props: MessagingWorkspaceProps) {
  return <MessagingWorkspaceScope key={recoveryScope(props.member)} {...props} />
}
function MessagingWorkspaceScope(props: MessagingWorkspaceProps) {
 return <MessagingView model={useMessagingWorkspace(props)} />;
}

export type { MessageComposeRequest, MessagingWorkspaceProps } from './workspace-model'
