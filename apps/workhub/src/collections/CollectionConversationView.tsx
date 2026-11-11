import { CollectionEditorView } from './CollectionEditorView'
import type { useCollectionEditor } from './useCollectionEditor'
import styles from './collection-conversation.css?inline'

// 페이지와 대화는 같은 편집기·요청 저장소를 사용하고 표시만 달리한다.
export function CollectionConversationView({ model }: { model: ReturnType<typeof useCollectionEditor> }) {
  const next = model.pending
    ? '원래 요청의 결과를 확인하세요'
    : model.session.upload
      ? 'HWPX 확인을 마친 뒤 이어갑니다'
      : model.publishReview
        ? '대상과 양식을 확인하고 공개하세요'
        : model.session.editor
          ? '내용과 대상을 확인하고 초안을 저장하세요'
          : model.session.answer
            ? '파일을 저장한 뒤 최종 제출을 확인하세요'
            : model.detail?.request.status === 'draft'
              ? '저장한 초안을 확인하고 공개할 수 있어요'
              : model.detail
                ? '내 제출 파일과 접수 결과를 확인하세요'
                : '수합을 선택하거나 새 초안을 준비하세요'
  return <div className="collection-conversation" aria-label="대화로 수합 처리">
    <style>{styles}</style>
    <p className="collection-conversation-next">{next}</p>
    <CollectionEditorView model={model} presentation="assistant" />
  </div>
}
