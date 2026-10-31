import type { useGuidedEditor } from './useGuidedEditor'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function GuidedPublicationSection({
  model,
}: {
  model: Pick<
    ReturnType<typeof useGuidedEditor>,
    | 'command'
    | 'currentArtifact'
    | 'dirty'
    | 'download'
    | 'editable'
    | 'id'
    | 'input'
    | 'locked'
    | 'onOpenCollection'
    | 'onUseGenerated'
    | 'publishConfirmed'
    | 'reviewed'
    | 'setPublishConfirmed'
    | 'setTarget'
    | 'target'
    | 'targets'
    | 'template'
    | 'title'
  >
}) {
  const {
    command,
    currentArtifact,
    dirty,
    download,
    editable,
    id,
    input,
    locked,
    onOpenCollection,
    onUseGenerated,
    publishConfirmed,
    reviewed,
    setPublishConfirmed,
    setTarget,
    target,
    targets,
    template,
    title,
  } = model
  if (!template) return null
  return (
    <>
      {currentArtifact && (editable || template.collectionRequestId) && (
        <section
          className="documents-editor"
          data-document-step="connect"
          tabIndex={-1}
          aria-label={editable ? '수합 연결과 게시' : '수합에 첨부'}
        >
          <h4>{editable ? '수합 연결과 게시' : '수합에 첨부'}</h4>
          {editable ? (
            <>
              {!targets.length && (
                <p className="documents-muted" role="status">
                  연결 가능한 수합이 없습니다. 본인이 관리하는 파일형 수합을 먼저 초안으로 저장해
                  주세요. 마감·보관된 수합과 이미 양식이 연결된 수합은 제외합니다.
                </p>
              )}
              <label htmlFor={`${id}-target`}>
                연결할 파일형 수합 요청
                <select
                  aria-label="연결할 파일형 수합 요청"
                  id={`${id}-target`}
                  value={target}
                  disabled={locked}
                  onChange={(e) => {
                    setTarget(e.target.value)
                    setPublishConfirmed(false)
                  }}
                >
                  <option value="">수합 요청 선택</option>
                  {targets.map((t) => (
                    <option key={t.requestId} value={t.requestId}>
                      {t.title}
                      {t.publication?.state === 'draft' ? ' · 담당자 초안' : ''}
                    </option>
                  ))}
                </select>
              </label>
              {targets.find((t) => t.requestId === target)?.publication && (
                <div className="documents-status" aria-label="함께 게시할 수합 확인">
                  {(() => {
                    const p = targets.find((t) => t.requestId === target)!.publication!
                    return (
                      <>
                        <p>
                          {p.state === 'draft'
                            ? '양식과 수합을 함께 공개합니다.'
                            : '이미 공개한 수합에 양식을 게시합니다.'}
                        </p>
                        <p>
                          마감일 {p.dueDate} · 대상 {p.recipientCount}명
                        </p>
                        <ul>
                          {p.unitLabels.map((label, index) => (
                            <li key={index}>{label}</li>
                          ))}
                        </ul>
                        <label className="documents-check">
                          <input
                            type="checkbox"
                            checked={publishConfirmed}
                            disabled={locked}
                            onChange={(e) => setPublishConfirmed(e.target.checked)}
                          />
                          수합 제목·마감일·대상을 확인했습니다
                        </label>
                      </>
                    )
                  })()}
                </div>
              )}
              <button
                type="button"
                className="documents-primary"
                disabled={
                  locked ||
                  !reviewed ||
                  !targets.some((t) => t.requestId === target) ||
                  Boolean(
                    targets.find((t) => t.requestId === target)?.publication && !publishConfirmed,
                  )
                }
                onClick={() => {
                  const t = targets.find((t) => t.requestId === target)!
                  command({
                    kind: t.publication?.state === 'draft' ? 'publish_collection' : 'publish',
                    templateId: template.id,
                    expectedVersion: template.version,
                    previewArtifactId: currentArtifact.artifactId,
                    collectionRequestId: t.requestId,
                    collectionVersion: t.version,
                  })
                }}
              >
                {targets.find((t) => t.requestId === target)?.publication?.state === 'draft'
                  ? '양식과 수합 함께 게시'
                  : '확인한 양식 게시'}
              </button>
              <p className="documents-muted">
                게시 후 질문·위치는 이 판에 고정됩니다. 변경할 양식은 새로 등록해 기존 응답과
                분리합니다.
              </p>
            </>
          ) : (
            template.collectionRequestId && (
              <div className="documents-actions">
                {onUseGenerated && (
                  <button
                    type="button"
                    className="documents-primary"
                    disabled={locked || !reviewed}
                    onClick={() => void download(currentArtifact, true)}
                  >
                    확인한 파일을 수합에 첨부하기
                  </button>
                )}
                {onOpenCollection && (
                  <button
                    type="button"
                    disabled={locked || dirty}
                    onClick={() => onOpenCollection(template.collectionRequestId!)}
                  >
                    연결된 수합 요청 열기
                  </button>
                )}
                <p className="documents-muted">
                  첨부 후 수합 화면에서 대상과 파일을 확인하고 최종 제출합니다.
                </p>
              </div>
            )
          )}
        </section>
      )}
    </>
  )
}
