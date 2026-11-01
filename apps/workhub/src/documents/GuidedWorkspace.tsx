import { recoveryScope } from '../app/pending-requests'
import { GuidedWorkspaceProps } from './guided-editor-model'
import { useGuidedEditor } from './useGuidedEditor'
import { GuidedEditorView } from './GuidedEditorView'
export function GuidedWorkspace(props:GuidedWorkspaceProps){return <GuidedScope key={recoveryScope(props.member)} {...props}/>}
function GuidedScope(props: GuidedWorkspaceProps) {
 return <GuidedEditorView model={useGuidedEditor(props)} />;
}

export type { GuidedWorkspaceProps } from './guided-editor-model'
