import { recoveryScope } from '../app/pending-requests'
import { CollectionServerPanelProps } from './collection-editor-model'
import { useCollectionEditor } from './useCollectionEditor'
import { CollectionEditorView } from './CollectionEditorView'
import { CollectionConversationView } from './CollectionConversationView'
export function CollectionServerPanel(props: CollectionServerPanelProps) { return <CollectionScope key={recoveryScope(props.member)} {...props} /> }
function CollectionScope(props: CollectionServerPanelProps) {
 const model = useCollectionEditor(props)
 return props.presentation === 'assistant'
   ? <CollectionConversationView model={model} />
   : <CollectionEditorView model={model} />;
}

export type { CollectionComposeRequest, CollectionServerPanelProps } from './collection-editor-model'
