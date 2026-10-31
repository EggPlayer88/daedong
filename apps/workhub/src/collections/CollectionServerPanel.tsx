import { recoveryScope } from '../app/pending-requests'
import { CollectionServerPanelProps } from './collection-editor-model'
import { useCollectionEditor } from './useCollectionEditor'
import { CollectionEditorView } from './CollectionEditorView'
export function CollectionServerPanel(props: CollectionServerPanelProps) { return <CollectionScope key={recoveryScope(props.member)} {...props} /> }
function CollectionScope(props: CollectionServerPanelProps) {
 return <CollectionEditorView model={useCollectionEditor(props)} />;
}

export type { CollectionServerPanelProps } from './collection-editor-model'
