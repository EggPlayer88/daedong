import { recoveryScope } from '../app/pending-requests'
import { AssistantDraftReady, AssistantPanelProps } from './workspace-model'
import { useAssistantWorkspace } from './useAssistantWorkspace'
import { AssistantView } from './AssistantView'
export function AssistantPanel(props: AssistantPanelProps) { return <AssistantScope key={recoveryScope(props.member)} {...props}/>; }
export { AnswerView } from './AssistantView'
function AssistantScope(props: AssistantPanelProps) {
 return <AssistantView model={useAssistantWorkspace(props)} />;
}

export type { AssistantDraftReady, AssistantPanelProps } from './workspace-model'
