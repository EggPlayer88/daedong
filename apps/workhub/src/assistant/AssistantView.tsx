import { WorkspacePlanCard } from './WorkspacePlanCard'
import { AiMemoryPanel } from './AiMemoryPanel'
import { WorkspaceIcon } from '../app/WorkspaceIcon'
import { composeMemoryPrompt } from './memory-prompt'
import {
  ASSISTANT_ROUTING,
  AssistantError,
  TASK_INPUT_LIMITS,
  type AnswerSegment,
  type AssistantIntent,
} from './contracts'
import { SchoolAiBudget } from './SchoolAiSettingsPanel'
import styles from './assistant.css?inline'
import type { Citation } from './contracts'
import { intentLabels } from './workspace-model'
import type { useAssistantWorkspace } from './useAssistantWorkspace'
import { WorkspaceCommandResult } from './WorkspaceCommandResult'
import { CalendarFollowupCard } from './CalendarFollowupCard'
import { DraftFollowupCard } from './DraftFollowupCard'
import { CONVERSATION_PROFILES, readConversationPrompt } from './conversation-guidance'
import { WorkspaceOperationCard } from './WorkspaceOperationCard'
import { specialistStarters } from './specialist-workflows'
export function AssistantView({ model }: { model: ReturnType<typeof useAssistantWorkspace> }) {
  const {
    addTask,
    applyContext,
    ask,
    canChangeConversationFocus,
    canSubmit,
    calendarFollowup,
    cancelCalendar,
    draftFollowup,
    draftPeople,
    draftSearching,
    startDraftFollowup,
    selectDraftPerson,
    removeDraftPerson,
    cancelDraftFollowup,
    openDraftForm,
    dismissDraftPeople,
    retryDraftName,
    dismissTaskMatches,
    baseEditable,
    budgetError,
    busy,
    changeIntent,
    changeMode,
    connection,
    conversationFocus,
    conversationProfile,
    contextRequest,
    date,
    draft,
    editable,
    enabled,
    error,
    execute,
    latest,
    loadThread,
    loading,
    locked,
    member,
    memoryLocked,
    memoryServer,
    moreMessages,
    moreThreads,
    nextCursor,
    notice,
    onComposeMessage,
    onDraftReady,
    onOpenKnowledgeCitation,
    onOpenTask,
    openKnowledgeCitation,
    openTask,
    openWorkspaceItem,
    openingCitation,
    operation,
    pending,
    readError,
    ready,
    recovery,
    reviewAnswer,
    reviewConfirm,
    reviewTask,
    revision,
    schoolStatus,
    server,
    session,
    submitLabel,
    setError,
    setConversationFocus,
    setMemoryLocked,
    setNotice,
    setRefresh,
    setReviewConfirm,
    taskIssue,
    threads,
    uid,
    update,
    workspaceActions,
    workspaceActionNotice,
    workspaceCommand,
    workspaceEditable,
    workspaceResult,
    workspaceSearching,
  } = model
  const continuing = Boolean(calendarFollowup || draftFollowup)
  const canContinueDraft = !continuing && workspaceActions?.findDraftPeople && (
    workspaceCommand?.kind === 'messageDraft' || workspaceCommand?.kind === 'collectionDraft') && !workspaceCommand.firstTurn
  return (
    <section className="assistant-workspace" aria-labelledby={`${uid}-title`}>
      <style>{styles}</style>
      <header className="assistant-header">
        <div className="assistant-brand">
          <span className="assistant-brand-icon"><WorkspaceIcon name="assistant" /></span>
          <h2 id={`${uid}-title`}>AI 비서</h2>
        </div>
      </header>
      <div className="assistant-scope-bar">
        <p className="assistant-scope-current">
          <WorkspaceIcon name="school" />
          <span>자료 범위 · <strong>{session.mode === 'school' ? '학교 공통 자료' : '내가 볼 수 있는 자료와 업무'}</strong></span>
        </p>
        <details className="assistant-scope-settings">
          <summary>자료 범위 변경</summary>
          <div className="assistant-modes" role="group" aria-label="비서의 자료 범위">
            <button
              type="button"
              aria-pressed={session.mode === 'school'}
              disabled={locked}
              onClick={() => changeMode('school')}
            >
              학교 업무 안내
            </button>
            <button
              type="button"
              aria-pressed={session.mode === 'personal'}
              disabled={locked}
              onClick={() => changeMode('personal')}
            >
              내 개인 비서
            </button>
          </div>
          <p className="assistant-scope">
            {session.mode === 'school'
              ? '현재 학교에서 열람 가능한 공통 자료만 사용합니다.'
              : '내가 볼 수 있는 학교 자료와 내 업무를 사용합니다. 상담 기록은 자동으로 가져오지 않습니다.'}
          </p>
        </details>
      </div>
      {loading && <p role="status">대화 연결을 확인하고 있습니다.</p>}
      {ready && !ready.available && (
        <div role="status" className="assistant-status">
          <h3>AI 비서 연결 준비 중</h3>
          <p>
            {ready.reason === 'budget_exhausted'
              ? '승인된 이용 한도에 도달했습니다.'
              : '학교 자료 연결과 승인된 AI 이용 설정이 완료되면 사용할 수 있습니다.'}
          </p>
          <p>{workspaceActions ? '메뉴 이동과 자료 찾기는 계속 사용할 수 있습니다.' : '작성한 입력은 이 탭에 유지됩니다.'}</p>
        </div>
      )}
      {readError && <p role="alert">{readError}</p>}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {contextRequest && contextRequest.id !== session.contextId && (
        <div className="assistant-context">
          <p>다른 화면에서 전달받은 요청이 있습니다.</p>
          <button type="button" disabled={locked || busy} onClick={applyContext}>
            전달받은 요청 사용
          </button>
          {locked && <p>현재 입력과 미확정 요청을 먼저 마무리해 주세요.</p>}
        </div>
      )}
      <div className="assistant-thread-heading">
        <h3>
          {readError ? '대화 연결을 다시 확인해 주세요' : (session.thread?.title ?? '무엇을 도와드릴까요?')}
        </h3>
        <button
          type="button"
          className="assistant-quiet"
          disabled={locked || busy}
          onClick={() => update({ ...latest.current, thread: undefined, contextId: undefined })}
        >
          새 대화
        </button>
      </div>
      {recovery.request && (
        <section className="assistant-pending" aria-label="미확정 요청">
          <h3>기존 요청 결과 확인</h3>
          <p>
            요청 번호: <code>{recovery.request.key}</code>
          </p>
          {pending?.kind === 'confirmTask' && (
            <p>
              개인 할 일: {pending.input.input.title} ·{' '}
              {pending.input.input.dueDate || '마감일 없음'}
            </p>
          )}
          <p>
            입력과 요청 번호를 보관했습니다. 결과가 확정될 때까지 새 요청이나 입력 버리기를 진행하지
            않습니다.
          </p>
          <button
            type="button"
            disabled={
              busy ||
              !pending ||
              !enabled ||
              (recovery.request.closeState === 'closing' && !server.close)
            }
            onClick={() => pending && void execute(pending, recovery.request!.key)}
          >
            {recovery.request.closeState === 'closing'
              ? '같은 번호로 AI 닫기 결과 확인'
              : '같은 요청으로 결과 확인'}
          </button>
          {pending?.kind === 'ask' && server.close && recovery.request.closeState !== 'closing' && (
            <>
              <p>
                요청 닫기는 AI를 새로 호출하지 않습니다. 이미 완료되었으면 원래 답변을 확인하고,
                아직 시작하지 않았으면 늦은 실행도 막습니다. 이미 실행 중이면 결과 확인을
                계속합니다.
              </p>
              <button
                type="button"
                disabled={busy || !enabled}
                onClick={() => void execute(pending, recovery.request!.key, true)}
              >
                새 호출 없이 요청 닫기
              </button>
            </>
          )}
          {!pending && (
            <p role="alert">
              기존 요청 형식을 확인할 수 없습니다. 원 요청을 유지한 채 관리자에게 확인해 주세요.
            </p>
          )}
        </section>
      )}
      <div className="assistant-layout">
        <div className="assistant-main">
          <div
            className="assistant-conversation"
            hidden={
              Boolean(readError) ||
              (!session.thread?.exchanges.length && !session.thread?.nextCursor)
            }
          >
            {!readError && session.thread?.nextCursor && (
              <button type="button" disabled={!editable} onClick={() => void moreMessages()}>
                앞선 답변 더 보기
              </button>
            )}
            {!readError &&
              session.thread?.exchanges.map((exchange) => (
                <article className="assistant-exchange" key={exchange.id}>
                  <div className="assistant-question">
                    <h4>내 질문</h4>
                    <p className="assistant-text">{readConversationPrompt(exchange.prompt).prompt}</p>
                  </div>
                  <div className="assistant-answer-heading">
                    <h4>AI 답변</h4>
                    {exchange.execution && (
                      <p className="assistant-execution">
                        {exchange.execution.quality === 'quick'
                          ? ASSISTANT_ROUTING.models.quick.label + ' 기본 답변'
                          : ASSISTANT_ROUTING.models.review.label +
                            (exchange.execution.reviewOf ? ' 정밀 검토' : ' 학생 기록 초안')}
                      </p>
                    )}
                  </div>
                  <AnswerView
                    segments={exchange.segments}
                    onOpenKnowledgeCitation={
                      onOpenKnowledgeCitation
                        ? (citation) => void openKnowledgeCitation(citation)
                        : undefined
                    }
                    disabled={!editable || locked || loading || openingCitation}
                  />
                  {exchange.execution?.quality === 'quick' &&
                    exchange.execution.model === ASSISTANT_ROUTING.models.quick.id &&
                    exchange.intent !== 'student_record_draft' && (
                      <div className="assistant-review">
                        <button
                          type="button"
                          disabled={!editable || locked}
                          onClick={() => setReviewConfirm(exchange.id)}
                        >
                          이 답변 정밀 검토
                        </button>
                        {reviewConfirm === exchange.id && (
                          <div role="group" aria-label="정밀 검토 비용 확인">
                            <p>
                              이 답변을 Sonnet으로 다시 검토하며 학교 예산을 사용합니다. 계속할까요?
                            </p>
                            <button
                              type="button"
                              disabled={!editable || locked}
                              onClick={() => {
                                setReviewConfirm(undefined)
                                reviewAnswer(exchange)
                              }}
                            >
                              비용 사용 확인하고 정밀 검토
                            </button>
                            <button type="button" onClick={() => setReviewConfirm(undefined)}>
                              정밀 검토 취소
                            </button>
                          </div>
                        )}
                        <span className="assistant-hint">{ASSISTANT_ROUTING.models.review.label} · 학교 예산에서 비용 사용</span>
                      </div>
                    )}
                  {exchange.proposal && (
                    <div className="assistant-proposal">
                      <strong>{exchange.proposal.input.title}</strong>
                      <p>
                        {exchange.proposal.status === 'applied'
                          ? '개인 할 일에 추가된 제안입니다.'
                          : '개인 할 일 제안입니다. 확인하기 전에는 저장되지 않습니다.'}
                      </p>
                      {exchange.proposal.status === 'pending' && (
                        <button
                          type="button"
                          disabled={
                            !editable || continuing || Boolean(session.proposal) || Boolean(session.prompt.trim())
                          }
                          onClick={() =>
                            update({
                              ...latest.current,
                              proposal: structuredClone(exchange.proposal!),
                              taskReview: false,
                            })
                          }
                        >
                          할 일 제안 검토
                        </button>
                      )}
                      {exchange.proposal.status === 'applied' &&
                        exchange.proposal.resourceId &&
                        onOpenTask &&
                        !recovery.request && (
                          <button
                            type="button"
                            disabled={!editable || locked || loading}
                            onClick={() => openTask(exchange.proposal!)}
                          >
                            추가한 할 일 열기
                          </button>
                        )}
                    </div>
                  )}
                  {['document_draft', 'student_record_draft', 'guided_collection'].includes(
                    exchange.intent,
                  ) && (
                    <div className="assistant-actions">
                      <button
                        type="button"
                        onClick={() => {
                          try {
                            const blob = new Blob(
                                [
                                  exchange.segments
                                    .map(
                                      (row) =>
                                        row.text +
                                        '\n' +
                                        row.citations
                                          .map((c) => '근거: ' + c.title + ' · ' + c.locator)
                                          .join('\n'),
                                    )
                                    .join('\n\n'),
                                ],
                                { type: 'text/plain;charset=utf-8' },
                              ),
                              url = URL.createObjectURL(blob),
                              anchor = document.createElement('a')
                            anchor.href = url
                            anchor.download = '검토용-내용초안.txt'
                            anchor.click()
                            setTimeout(() => URL.revokeObjectURL(url), 0)
                          } catch {
                            setError('초안 파일을 내려받지 못했습니다.')
                          }
                        }}
                      >
                        내용 초안 내려받기
                      </button>
                      {onDraftReady && (
                        <button
                          type="button"
                          disabled={!editable || locked}
                          onClick={() =>
                            onDraftReady(
                              {
                                intent: exchange.intent,
                                segments: structuredClone(exchange.segments),
                                requestKey: exchange.requestKey,
                                threadId: session.thread!.id,
                                studentContext: exchange.studentContext,
                              },
                              session.requestContexts?.[exchange.requestKey],
                            )
                          }
                        >
                          이 초안을 작성 화면으로 보내기
                        </button>
                      )}
                    </div>
                  )}
                  {onComposeMessage &&
                    exchange.intent !== 'student_record_draft' &&
                    !exchange.studentContext && (
                      <div className="assistant-actions">
                        <button
                          type="button"
                          disabled={!editable || locked}
                          onClick={() =>
                            onComposeMessage({
                              requestId: exchange.requestKey,
                              body: exchange.segments.map((segment) => segment.text).join('\n\n'),
                            })
                          }
                        >
                          메시지 초안으로 사용
                        </button>
                        <span className="assistant-hint">
                          메신저에서 받는 사람과 내용을 확인한 뒤 전송합니다.
                        </span>
                      </div>
                    )}
                </article>
              ))}
          </div>
          {model.workspaceOperation.preparing && <p role="status">저장 전에 현재 내용을 확인하고 있습니다…</p>}
          {(model.workspaceOperation.error || model.workspaceOperation.unreadable) && <p role="alert">{model.workspaceOperation.error || '보관한 저장 요청을 읽지 못했습니다. 원래 요청을 유지하며 새 저장을 막았습니다.'}</p>}
          {model.workspaceOperation.state && enabled && <WorkspaceOperationCard {...model.workspaceOperation.state}
            onConfirm={model.workspaceOperation.confirm} onRetry={model.workspaceOperation.retry} onCancel={model.workspaceOperation.cancel}
            onOpenResult={model.workspaceOperation.state.receipt ? () => {
              const receipt = model.workspaceOperation.state?.receipt
              if (receipt) workspaceActions?.open({ kind: receipt.kind === 'taskChange' ? 'task' : 'calendar', id: receipt.id,
                title: receipt.title, description: '', meta: '', version: receipt.version })
            } : undefined} />}
          {enabled && <WorkspacePlanCard model={model.workspacePlan} hasInput={Boolean(session.prompt.trim())} />}
          {workspaceSearching && <p role="status" className="assistant-workspace-searching">열람 가능한 자료를 찾고 있습니다.</p>}
          {workspaceActionNotice && enabled && <section className="assistant-workspace-result" aria-label="대화 업무 처리 안내">
            <p className="assistant-command-question">{workspaceActionNotice.prompt}</p>
            <p role="status">{workspaceActionNotice.message}</p>
          </section>}
          {workspaceResult && enabled && <WorkspaceCommandResult {...workspaceResult}
            disabled={!workspaceEditable || Boolean(session.prompt.trim())}
            onDismiss={dismissTaskMatches} onOpen={openWorkspaceItem} />}
          {calendarFollowup && <CalendarFollowupCard command={calendarFollowup} disabled={!workspaceEditable} onCancel={cancelCalendar} />}
          {draftFollowup && <DraftFollowupCard inConversation={workspaceActions?.deliveryInConversation} draft={draftFollowup} result={draftPeople}
            disabled={!workspaceEditable || draftSearching} searching={draftSearching}
            pendingInput={Boolean(session.prompt.trim())} onSelect={selectDraftPerson}
            onRemove={removeDraftPerson} onDismiss={dismissDraftPeople} onRetry={retryDraftName} canRetry={!session.prompt.trim() || draftFollowup.pendingNames?.[0] === session.prompt} onCancel={cancelDraftFollowup}
            onOpen={openDraftForm} />}
          <form
            className="assistant-compose"
            onSubmit={(event) => {
              event.preventDefault()
              ask()
            }}
          >
            <div className="assistant-compose-heading">
              <div className="assistant-focus-control">
                <label htmlFor={`${uid}-focus`}>대화 분야</label>
                <select
                  id={`${uid}-focus`}
                  disabled={!canChangeConversationFocus}
                  value={conversationFocus}
                  onChange={(event) => setConversationFocus(event.target.value as typeof conversationFocus)}
                >
                  <option value="auto">{conversationFocus === 'auto' ? `자동 · ${conversationProfile.label}` : '자동'}</option>
                  {CONVERSATION_PROFILES.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}
                </select>
              </div>
            </div>
            <details className="assistant-request-settings">
              <summary>요청 설정 <span>{intentLabels[session.intent]}</span><span className="assistant-compose-model"> · {calendarFollowup ? '일정' : draftFollowup ? '초안' : session.intent === 'student_record_draft' ? ASSISTANT_ROUTING.models.review.label : ASSISTANT_ROUTING.models.quick.label}</span></summary>
              <div className="assistant-intent-row">
                <label htmlFor={`${uid}-intent`}>요청 종류</label>
                <select
                  id={`${uid}-intent`}
                  disabled={!editable || Boolean(draft) || continuing}
                  value={session.intent}
                  onChange={(event) => changeIntent(event.target.value as AssistantIntent)}
                >
                  {Object.entries(intentLabels)
                    .filter(
                      ([key]) =>
                        session.mode === 'personal' ||
                        (key !== 'personal_assistant' && key !== 'student_record_draft'),
                    )
                    .map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                </select>
              </div>
              <p className="assistant-hint">대화 분야는 답변의 관점을 정합니다. 사용할 자료 범위는 위에서 직접 선택합니다.</p>
            </details>
            {(session.references.length > 0 || session.studentContext) && (
              <div className="assistant-context">
                <p>
                  선택한 근거{' '}
                  {session.references.length + (session.studentContext?.evidence.length ?? 0)}개
                </p>
                <ul>
                  {session.references.map((ref) => (
                    <li key={`${ref.kind}:${ref.id}`}>
                      {ref.kind} · {ref.id} · 판 {ref.version}
                    </li>
                  ))}
                  {session.studentContext?.evidence.map((ref) => (
                    <li key={`${ref.kind}:${ref.id}:${ref.start}`}>
                      {ref.kind === 'observation' ? '관찰' : '평가'} · {ref.id} · 개정{' '}
                      {ref.revisionId} · 구간 {ref.start}–{ref.end}
                    </li>
                  ))}
                </ul>
                <button
                  type="button"
                  disabled={!editable}
                  onClick={() =>
                    update({ ...latest.current, references: [], studentContext: null })
                  }
                >
                  선택한 근거 비우기
                </button>
              </div>
            )}
            {session.intent === 'student_record_draft' && (
              <p className="assistant-hint">
                등록된 학생 번호·이름과 선택한 수업·평가 근거가 AI에 전달됩니다. 상담 기록은
                제외합니다.
              </p>
            )}
            {session.intent === 'student_record_draft' && !session.studentContext && (
              <p>학생 관리 화면에서 확인한 관찰·평가 근거를 먼저 선택해 주세요.</p>
            )}
            <label htmlFor={`${uid}-prompt`}>질문 또는 부탁할 일</label>
            <textarea
              id={`${uid}-prompt`}
              rows={3}
              aria-describedby={`${uid}-prompt-hint`}
              aria-invalid={Array.from(session.prompt).length > model.promptLimit}
              placeholder={draftFollowup ? (draftFollowup.command.kind === 'messageDraft' ? '예: 김민지 선생님' : '예: 다음 주 금요일, 김민지 선생님') : calendarFollowup ? '빠진 정보만 답해 주세요.' : '필요한 일이나 궁금한 점을 편하게 적어 주세요.'}
              disabled={busy || draftSearching || memoryLocked || Boolean(recovery.request) || Boolean(draft) || model.workspaceOperation.locked}
              value={session.prompt}
              onChange={(event) => update({ ...latest.current, prompt: event.target.value })}
            />
            {workspaceActions && !continuing && !session.contextId && !session.references.length && !session.studentContext && (
              <details className="assistant-command-help">
                <summary>대화로 할 수 있는 일</summary>
                <div className="assistant-command-examples">
                {['오늘 업무 요약해줘', '내일 급식 알려줘', '업무 알림 보여줘', '할 일 제출 자료 확인 제목을 자료 점검으로 바꿔줘', '할 일 자료 점검 다시 시작해줘', '시간표 열어줘', '학교 자료에서 출장 찾아줘', '제출 자료 확인을 할 일로 추가해줘', '제출 자료 확인을 금요일까지로 바꿔줘', '내일 회의 일정 잡아줘', '김민지 선생님에게 “내일 회의 자료를 확인해 주세요”라는 메시지 초안 만들어줘', '금요일까지 김민지 선생님에게 현장체험학습 계획서 수합 초안 만들어줘'].map((text) => (
                  <button type="button" key={text} disabled={!workspaceEditable || Boolean(session.prompt.trim())}
                    onClick={() => update({ ...latest.current, prompt: text })}>{text}</button>
                ))}
                </div>
              </details>
            )}
            <span id={`${uid}-prompt-hint`} className="assistant-hint">
              {Array.from(session.prompt).length} / {model.promptLimit}자 · 상담·건강
              정보는 입력하지 마세요.
            </span>
            {Array.from(session.prompt).length > model.promptLimit && (
              <p role="alert">
                질문은 {model.promptLimit}자 이내로 줄여 주세요. 입력은 자동으로 자르지
                않습니다.
              </p>
            )}
            <div className="assistant-actions">
              {canContinueDraft && <button type="button" className="assistant-primary" disabled={!workspaceEditable} onClick={startDraftFollowup}>
                {workspaceCommand?.kind === 'messageDraft' ? '수신자 이어서 선택' : '기한·대상 이어서 입력'}
              </button>}
              <button
                type="submit"
                className={canContinueDraft ? 'assistant-quiet' : 'assistant-primary'}
                disabled={
                  !canSubmit || draftSearching ||
                  Boolean(draft) ||
                  Array.from(session.prompt).length > model.promptLimit ||
                  !session.prompt.trim() ||
                  (session.intent === 'student_record_draft' && !session.studentContext && !workspaceCommand)
                }
              >
                {submitLabel}
              </button>
              {workspaceCommand && workspaceCommand.kind !== 'task' && <span className="assistant-hint">AI 사용료 없이 처리</span>}
              <button
                type="button"
                className="assistant-quiet"
                disabled={busy || draftSearching || memoryLocked || Boolean(recovery.request) || !session.prompt || model.workspaceOperation.locked}
                onClick={() => update({ ...latest.current, prompt: '' })}
              >
                질문 비우기
              </button>
            </div>
          </form>
          {!readError && !loading && !workspaceResult && !session.workspacePlan && !continuing && !session.thread?.exchanges.length && !session.thread?.nextCursor && !recovery.request && !draft && (
            <div className="assistant-welcome">
              <h3>이렇게 시작해 보세요</h3>
              <div className="assistant-starters" aria-label="대화 시작 예시">
                {(workspaceActions?.specialist ? specialistStarters(conversationProfile.id) ?? conversationProfile.starterPrompts : conversationProfile.starterPrompts).slice(0, 3).map((prompt) => (
                  <button type="button" key={prompt} disabled={(!editable && !workspaceEditable) || Boolean(session.prompt.trim())}
                    onClick={() => update({ ...latest.current, prompt })}>
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}
          {draft && (
            <section className="assistant-task-editor" aria-labelledby={`${uid}-task`}>
              <h3 id={`${uid}-task`}>개인 할 일 확인</h3>
              <p id={`${uid}-task-hint`} className="assistant-hint">
                제목 {TASK_INPUT_LIMITS.titleChars}자 · 메모 {TASK_INPUT_LIMITS.notesChars}자까지
                저장합니다. 앞뒤 공백도 글자 수에 포함하며, 내용 확인 때 공백을 정리합니다. 긴
                제안은 자동으로 자르지 않습니다.
              </p>
              <label htmlFor={`${uid}-task-title`}>할 일 제목</label>
              <input
                id={`${uid}-task-title`}
                aria-describedby={`${uid}-task-hint ${uid}-title-count`}
                aria-invalid={
                  !draft.input.title.trim() ||
                  Array.from(draft.input.title).length > TASK_INPUT_LIMITS.titleChars
                }
                disabled={!editable || session.taskReview}
                value={draft.input.title}
                onChange={(event) =>
                  update({
                    ...latest.current,
                    proposal: { ...draft, input: { ...draft.input, title: event.target.value } },
                  })
                }
              />
              <span id={`${uid}-title-count`} className="assistant-hint">
                {Array.from(draft.input.title).length} / {TASK_INPUT_LIMITS.titleChars}자
              </span>
              <label htmlFor={`${uid}-task-notes`}>할 일 메모</label>
              <textarea
                id={`${uid}-task-notes`}
                aria-describedby={`${uid}-task-hint ${uid}-notes-count`}
                aria-invalid={Array.from(draft.input.notes).length > TASK_INPUT_LIMITS.notesChars}
                disabled={!editable || session.taskReview}
                value={draft.input.notes}
                onChange={(event) =>
                  update({
                    ...latest.current,
                    proposal: { ...draft, input: { ...draft.input, notes: event.target.value } },
                  })
                }
              />
              <span id={`${uid}-notes-count`} className="assistant-hint">
                {Array.from(draft.input.notes).length} / {TASK_INPUT_LIMITS.notesChars}자
              </span>
              <label htmlFor={`${uid}-task-date`}>할 일 마감일</label>
              <input
                type="date"
                id={`${uid}-task-date`}
                disabled={!editable || session.taskReview}
                value={draft.input.dueDate}
                onChange={(event) =>
                  update({
                    ...latest.current,
                    proposal: { ...draft, input: { ...draft.input, dueDate: event.target.value } },
                  })
                }
              />
              {taskIssue && <p role="alert">{taskIssue}</p>}
              {session.taskReview ? (
                <>
                  <p>위 내용을 개인 할 일에 추가합니다. 다른 교사에게 전송하지 않습니다.</p>
                  <button
                    type="button"
                    disabled={!editable || Boolean(taskIssue)}
                    onClick={addTask}
                  >
                    확인한 할 일 추가
                  </button>
                  <button
                    type="button"
                    disabled={!editable}
                    onClick={() => update({ ...latest.current, taskReview: false })}
                  >
                    다시 수정
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={!editable || Boolean(taskIssue)}
                  onClick={reviewTask}
                >
                  추가할 내용 확인
                </button>
              )}
              <button
                type="button"
                disabled={busy || Boolean(recovery.request)}
                onClick={() => {
                  if (!busy && !recovery.request)
                    update({ ...latest.current, proposal: undefined, taskReview: false })
                }}
              >
                제안 검토 닫기
              </button>
            </section>
          )}
        </div>
        <aside className="assistant-tools" aria-label="AI 대화 도구">
          <h3>{model.memoryEnabled ? '대화와 기억' : '대화'}</h3>
          <button type="button" className="assistant-quiet assistant-reconnect" disabled={busy || loading || memoryLocked} onClick={() => setRefresh((value) => value + 1)}>연결 다시 확인</button>
          <details className="assistant-budget-disclosure">
            <summary>학교 AI 예산 · 기본 {ASSISTANT_ROUTING.models.quick.label}</summary>
            {schoolStatus ? (
              <SchoolAiBudget status={schoolStatus} />
            ) : (
              <p role="status">{budgetError || '학교 예산을 확인하고 있습니다.'}</p>
            )}
            <p className="assistant-hint">
              정밀 검토는 완료된 기본 답변에서 직접 요청합니다. 학생 기록 초안은 처음부터{' '}
              {ASSISTANT_ROUTING.models.review.label}으로 작성합니다.
            </p>
          </details>
          <details className="assistant-history">
            <summary>이전 대화 {threads.length}개</summary>
            {!loading && !readError && ready?.available && !threads.length && (
              <p className="assistant-hint">
                아직 저장된 대화가 없습니다. 첫 답변을 받은 뒤 여기서 다시 열 수 있습니다.
              </p>
            )}
            <ul>
              {threads.map((row) => (
                <li key={row.id}>
                  <button
                    type="button"
                    disabled={!editable || locked}
                    aria-current={session.thread?.id === row.id ? 'true' : undefined}
                    onClick={() => void loadThread(row.id)}
                  >
                    {row.title}
                  </button>
                </li>
              ))}
            </ul>
            {nextCursor && (
              <button type="button" disabled={loading || busy} onClick={() => void moreThreads()}>
                이전 대화 더 보기
              </button>
            )}
          </details>
          {model.memoryEnabled && <AiMemoryPanel
            connection={connection}
            member={member}
            date={date}
            revision={revision}
            service={memoryServer}
            blocked={busy || Boolean(recovery.request) || Boolean(draft) || continuing || openingCitation}
            canUse={
              baseEditable &&
              !continuing &&
              !draft &&
              ['school_advice', 'personal_assistant', 'document_draft'].includes(session.intent)
            }
            onLockChange={setMemoryLocked}
            onUse={(items) => {
              const current = latest.current
              if (
                !baseEditable ||
                continuing ||
                current.proposal ||
                operation.current ||
                !['school_advice', 'personal_assistant', 'document_draft'].includes(current.intent)
              )
                throw new AssistantError('INVALID_INPUT')
              const prompt = composeMemoryPrompt(current.prompt, items)
              update({ ...current, prompt })
              setNotice('선택한 기억을 질문에 넣었습니다. 전송할 내용을 확인해 주세요.')
            }}
          />}
        </aside>
      </div>
    </section>
  )
}
export function AnswerView({
  segments,
  onOpenKnowledgeCitation,
  disabled = false,
}: {
  segments: AnswerSegment[]
  onOpenKnowledgeCitation?: (citation: Citation) => void
  disabled?: boolean
}) {
  return (
    <div className="assistant-answer">
      {segments.map((segment, index) => (
        <div className="assistant-answer-segment" key={index}>
          <p className="assistant-text">{segment.text}</p>
          {segment.citations.length > 0 ? (
            <details className="assistant-citations">
              <summary>근거 {segment.citations.length}개</summary>
              <ul>
                {segment.citations.map((source, i) => (
                  <li key={i}>
                    <div className="assistant-source-heading">
                      <strong>{source.title}</strong>
                      <span className="assistant-source-version">
                        {'version' in source.reference
                          ? '판 ' + source.reference.version
                          : '개정 ' + source.reference.revisionId}
                      </span>
                    </div>
                    <p className="assistant-source-locator">{source.locator}</p>
                    <div className="assistant-source-actions">
                      {onOpenKnowledgeCitation && source.reference.kind === 'knowledge' && (
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => onOpenKnowledgeCitation(source)}
                        >
                          인용 원문 보기
                        </button>
                      )}
                      <details className="assistant-source-id">
                        <summary>출처 식별 정보</summary>
                        <p>
                          {source.reference.kind} · {source.reference.id}
                          {'revisionId' in source.reference
                            ? ' · 구간 ' + source.reference.start + '–' + source.reference.end
                            : ''}
                        </p>
                      </details>
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <p className="assistant-hint assistant-no-source">
              연결된 학교 근거가 없는 일반 안내입니다.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}
