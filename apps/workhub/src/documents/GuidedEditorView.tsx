import { DocumentPaneSection } from './DocumentPaneSection'
import { GuidedMappingSection } from './GuidedMappingSection'
import { GuidedAnswersSection } from './GuidedAnswersSection'
import { GuidedFileSection } from './GuidedFileSection'
import { GuidedPublicationSection } from './GuidedPublicationSection'
import libraryStyles from './library-ui.css?inline'
import { GUIDED_LIMITS, type Question } from './guided-contracts'
import { GuidedAiReview } from './GuidedAiReview'
import { GuidedAnchorPicker } from './GuidedAnchorPicker'
import { GuidedSetupPanel } from './GuidedSetupPanel'
import type { useGuidedEditor } from './useGuidedEditor'
export function GuidedEditorView({ model, presentation = 'page' }: { model: ReturnType<typeof useGuidedEditor>; presentation?: 'page' | 'assistant' }) {
  const {
    addQuestion,
    aiBusy,
    aiOrigin,
    aiSuggestion,
    answerDirty,
    busy,
    canCreate,
    changeQuestion,
    command,
    conflict,
    currentArtifact,
    currentStep,
    cursor,
    denied,
    dirty,
    dismissed,
    download,
    downloaded,
    editable,
    error,
    execute,
    folded,
    id,
    input,
    items,
    load,
    loadError,
    loading,
    locked,
    mapDirty,
    member,
    moveToStep,
    nextHint,
    notice,
    onOpenCollection,
    onOpenFileCollections,
    onRequestAi,
    onRequestGuidedAi,
    onRequestGuidedSetupAi,
    onUseGenerated,
    open,
    pending,
    publishConfirmed,
    questions,
    render,
    requestHelp,
    requestSetupHelp,
    response,
    restoreSelection,
    restoring,
    resumeError,
    resumeId,
    reviewed,
    revision,
    saveAnswers,
    saveMapping,
    selected,
    service,
    setAiBusy,
    setAiOrigin,
    setDismissed,
    setDownloaded,
    setFolded,
    setInput,
    setPublishConfirmed,
    setQuestions,
    setReviewed,
    setSetupBusy,
    setTarget,
    setTitle,
    setUploadTitle,
    setupAiSuggestion,
    setupOrigin,
    steps,
    target,
    targets,
    template,
    title,
    uploadTitle,
    workflowRoot,
  } = model
  return (
    <section
      ref={workflowRoot}
      className={`documents-workspace document-library-ui${presentation === 'assistant' ? ' documents-assistant-pane' : ''}`}
      aria-label="질문형 수합 양식"
    >
      <style>{libraryStyles}</style>
      <header className="documents-header ws-page-intro">
        <div>
          <h2>질문으로 채우는 HWPX</h2>
          <p className="documents-muted">질문에 답하면 양식의 빈칸을 채웁니다.</p>
        </div>
        <button type="button" disabled={loading || busy} onClick={() => void load()}>
          양식 새로고침
        </button>
      </header>
      {notice && (
        <p className="documents-status" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="documents-status" role="alert">
          {error}
        </p>
      )}
      {loadError && (
        <p className="documents-status" role="alert">
          {loadError}
        </p>
      )}
      {restoring && (
        <p className="documents-status" role="status">
          이전에 작업한 양식과 저장한 답변을 다시 확인하고 있습니다…
        </p>
      )}
      {resumeError && (
        <section className="documents-status" aria-label="이전 양식 다시 열기">
          <p role="alert">이전에 작업한 양식을 열지 못했습니다. {resumeError}</p>
          {resumeId && (
            <button
              type="button"
              disabled={busy || restoring || Boolean(pending) || denied}
              onClick={() => void restoreSelection()}
            >
              이전 양식 다시 확인
            </button>
          )}
        </section>
      )}
      {aiSuggestion && aiSuggestion.requestId !== dismissed && (
        <>
          {aiOrigin && selected ? (
            <GuidedAiReview
              key={aiSuggestion.requestId}
              member={member}
              origin={aiOrigin}
              suggestion={aiSuggestion}
              selected={selected}
              input={input}
              service={service}
              disabled={
                busy || Boolean(pending) || denied || loading || Boolean(loadError) || mapDirty
              }
              onBusyChange={setAiBusy}
              onApply={(next) => {
                setInput(next)
                setReviewed(false)
                setDownloaded(false)
                setFolded(false)
              }}
              onDismiss={() => {
                setDismissed(aiSuggestion.requestId)
                setAiOrigin(undefined)
                setFolded(false)
              }}
            />
          ) : (
            <p role="alert">
              도움을 요청한 원래 양식 입력을 확인하지 못했습니다. 다른 양식에는 제안을 반영하지
              않습니다.
            </p>
          )}
        </>
      )}
      {pending && (
        <section className="documents-status" aria-label="질문형 문서 처리 결과 확인">
          <h3 role="status">
            {busy ? '문서 요청을 처리하고 있습니다' : '원래 요청 결과를 확인해 주세요'}
          </h3>
          <p>
            {busy
              ? '원본 파일·입력·요청 번호를 보관하고 처리 결과를 기다립니다.'
              : '원본 파일·입력·요청 번호를 현재 탭에 보관했습니다.'}
          </p>
          <div className="documents-actions">
            <button
              type="button"
              disabled={busy || denied}
              onClick={() => void execute(pending, true)}
            >
              {busy ? '처리 결과 확인 중…' : '같은 양식 요청 다시 확인'}
            </button>
            <button type="button" disabled={busy} onClick={() => setFolded((value) => !value)}>
              {folded ? '보관한 입력 보기' : '입력 접고 목록 보기'}
            </button>
          </div>
        </section>
      )}
      {denied ? (
        <p role="alert">현재 학교의 양식 이용 권한을 다시 확인해 주세요.</p>
      ) : (
        <>
          {canCreate && (
            <DocumentPaneSection compact={presentation === 'assistant'} expanded={Boolean(uploadTitle)} summary="새 HWPX 양식 등록"><section className="documents-editor library-upload" aria-label="새 양식 올리기">
              <h3>새 양식 올리기</h3>
              <p className="documents-muted">
                HWPX 원본을 그대로 보관하고 입력 가능한 단순 문단·표 안 문단을 찾아 보여줍니다.
              </p>
              <label htmlFor={`${id}-upload-title`}>
                양식 이름
                <input
                  id={`${id}-upload-title`}
                  value={uploadTitle}
                  maxLength={200}
                  disabled={locked || dirty}
                  onChange={(e) => setUploadTitle(e.target.value)}
                />
              </label>
              <label htmlFor={`${id}-file`}>
                HWPX 양식 선택
                <input
                  id={`${id}-file`}
                  type="file"
                  accept=".hwpx"
                  disabled={locked || dirty || !uploadTitle.trim() || Boolean(loadError)}
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    event.target.value = ''
                    if (file)
                      void execute({
                        kind: 'upload',
                        key: `template-${crypto.randomUUID()}`,
                        inspectKey: `inspect-${crypto.randomUUID()}`,
                        file,
                        title: uploadTitle,
                      })
                  }}
                />
              </label>
            </section></DocumentPaneSection>
          )}
          <div className="documents-grid">
            <DocumentPaneSection compact={presentation === 'assistant'} expanded={!template} summary="다른 질문형 양식 찾기"><section className="documents-panel" aria-label="질문형 양식 목록">
              <div className="library-list-heading">
                <h3>질문형 양식</h3>
                {!loading && !loadError && <span>불러온 양식 {items.length}개</span>}
              </div>
              {loading && <p role="status">양식을 불러오는 중…</p>}
              <ul className="documents-list">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      disabled={locked || dirty}
                      aria-current={template?.id === item.id}
                      onClick={() => void open(item)}
                    >
                      <strong>{item.title}</strong>
                      <span>
                        v{item.version} ·{' '}
                        {item.state === 'published' ? '답변 가능' : '담당자 준비 중'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {!loading && !loadError && !items.length && (
                <p className="documents-muted">사용할 수 있는 질문형 양식이 없습니다.</p>
              )}
              {cursor && (
                <button type="button" disabled={loading} onClick={() => void load(true)}>
                  양식 더 보기
                </button>
              )}
            </section></DocumentPaneSection>
            <section className="documents-panel" aria-label="선택한 질문형 양식">
              {!template ? (
                <div className="ws-selection-empty"><span aria-hidden="true">📝</span><h3>사용할 양식을 선택하세요</h3><p className="documents-muted">답변을 작성하고 HWPX로 내려받을 수 있어요.</p></div>
              ) : (
                <>
                  <h3>
                    {template.title} · v{template.version}
                  </h3>
                  {folded ? (
                    <button type="button" onClick={() => setFolded(false)}>
                      보관한 양식 입력 계속하기
                    </button>
                  ) : (
                    <>
                      <div className="library-step-guide">
                        <p>
                          <strong>지금 할 일</strong> · {nextHint}
                        </p>
                        <nav className="library-steps" aria-label="질문형 양식 작업 단계">
                          {steps.map((step, index) => (
                            <button
                              type="button"
                              key={step.id}
                              disabled={!step.available}
                              aria-current={
                                !pending && !conflict && currentStep === step.id
                                  ? 'step'
                                  : undefined
                              }
                              onClick={() => moveToStep(step.id)}
                            >
                              <span aria-hidden="true">{index + 1}</span>
                              {step.label}
                            </button>
                          ))}
                        </nav>
                      </div>
                      {conflict && (
                        <div className="documents-status">
                          <p>
                            내 입력을 유지했습니다. 최신 원본을 다시 열면 지금 입력 대신 서버에
                            저장된 내용을 사용합니다.
                          </p>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void open(template, true)}
                          >
                            최신 원본으로 다시 열기
                          </button>
                        </div>
                      )}
                      {editable && template.inspection && selected && (
                        <GuidedSetupPanel
                          key={`${template.id}:${template.version}`}
                          member={member}
                          revision={revision}
                          selected={selected}
                          questions={questions}
                          title={title}
                          service={service}
                          disabled={
                            busy ||
                            Boolean(pending) ||
                            aiBusy ||
                            restoring ||
                            loading ||
                            Boolean(loadError) ||
                            denied ||
                            dirty
                          }
                          origin={setupOrigin}
                          suggestion={setupAiSuggestion}
                          onBusyChange={setSetupBusy}
                          onApply={(next) => {
                            setQuestions(next)
                            setReviewed(false)
                            setDownloaded(false)
                          }}
                          onRequestAi={onRequestGuidedSetupAi ? requestSetupHelp : undefined}
                          onOpenFileCollections={onOpenFileCollections}
                        />
                      )}
                      <GuidedMappingSection model={model} />
                      <GuidedAnswersSection model={model} />
                      <GuidedFileSection model={model} />
                      <GuidedPublicationSection model={model} />
                      {(dirty || pending) && (
                        <button type="button" disabled={busy} onClick={() => setFolded(true)}>
                          입력 보관하고 접기
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  )
}
