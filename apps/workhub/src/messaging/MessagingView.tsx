import { type MessageDraft } from './composer'
import { MessagePreview } from './MessagePreview'
import { SentDeliveryPanel } from './SentDeliveryPanel'
import { recipientLabel } from './deliveries'
import { MessageAttachments } from './MessageAttachments'
import messagingStyles from './messaging.css?inline'
import composerStyles from '../app/composer-layout.css?inline'
import inboxStyles from './inbox-ui.css?inline'
import { timeLabel, sourceLabels } from './workspace-model'
import type { useMessagingWorkspace } from './useMessagingWorkspace'
export function MessagingView({ model }: { model: ReturnType<typeof useMessagingWorkspace> }) {
  const {
    busy,
    canOpenSource,
    canRead,
    checking,
    chooseRecipient,
    closeComposer,
    closeThread,
    composeRequest,
    composerInput,
    composing,
    conflict,
    delivered,
    denied,
    dirty,
    discardConfirm,
    downloadMessageFile,
    draft,
    enabled,
    error,
    fileLocked,
    fileRecovery,
    fileServer,
    focusThread,
    folded,
    heading,
    id,
    inbox,
    inboxError,
    loadInbox,
    loadMessages,
    loadRecipients,
    loadThreads,
    loadingInbox,
    loadingMessages,
    loadingRecipients,
    loadingThreads,
    locked,
    mark,
    member,
    messageCursor,
    messageError,
    messages,
    navigationLocked,
    notice,
    onOpenSource,
    onReturnToSource,
    openDeliveredThread,
    openNoticeSource,
    openRequest,
    openThread,
    openedId,
    openingSource,
    pending,
    prepare,
    preview,
    query,
    readiness,
    readyError,
    recipientError,
    recipientPeers,
    recipientQuery,
    recipients,
    refreshReplyParticipants,
    selected,
    selectedSequence,
    send,
    setDelivered,
    setDraft,
    setFileLocked,
    setFolded,
    setPreview,
    setQuery,
    setRecipientQuery,
    setRecipientRefresh,
    setRecipientSearch,
    setRefresh,
    setSearch,
    setTab,
    setUnreadOnly,
    sourceError,
    start,
    tab,
    threadError,
    threadHeading,
    threads,
    unreadOnly,
    usable,
    useAiDraft,
    waitingOpen,
  } = model
  return (
    <section className="messaging-workspace" aria-labelledby={`${id}-heading`}>
      <style>{messagingStyles + composerStyles + inboxStyles}</style>
      <header className="messaging-header">
        <div>
          <h2 id={`${id}-heading`} tabIndex={-1} ref={heading}>
            메시지와 알림
          </h2>
          <p>학교 선생님과 대화하고, 내 업무 알림을 확인합니다.</p>
        </div>
        <button
          type="button"
          className="messaging-primary"
          disabled={!usable || locked || dirty}
          onClick={() => start()}
        >
          새 메시지
        </button>
      </header>
      {openRequest && onReturnToSource && (
        <div className="messaging-actions">
          <button type="button" disabled={navigationLocked} onClick={onReturnToSource}>
            홈으로 돌아가기
          </button>
          <p className="messaging-muted">대화를 열어도 자동으로 읽음 처리하지 않습니다.</p>
        </div>
      )}
      {waitingOpen && usable && navigationLocked && (
        <section className="messaging-status" aria-label="요청한 대화 열기">
          <p>작성 중인 입력과 이전 요청은 보관합니다. 입력을 접은 뒤 요청한 대화를 열어 주세요.</p>
          <button
            type="button"
            disabled={busy || fileLocked || Boolean(preview)}
            onClick={() => setFolded(true)}
          >
            입력 접고 요청한 대화 열기
          </button>
        </section>
      )}
      {composeRequest?.schoolId === member.schoolId && composeRequest.memberId === member.id && (
        <section className="messaging-status" aria-label="AI 메시지 초안">
          <p>
            AI가 작성한 메시지 초안이 있습니다. 받는 사람은 직접 선택하고 보내기 전에 내용을
            확인하세요.{dirty && ' 현재 작성 중인 메시지를 먼저 마무리해 주세요.'}
          </p>
          <button type="button" disabled={!usable || locked || dirty} onClick={useAiDraft}>
            전달받은 메시지 초안 사용
          </button>
        </section>
      )}
      {checking && <p role="status">메시지 연결을 확인하는 중…</p>}
      {notice && (
        <div className="messaging-status" role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className="messaging-status" role="alert">
          {error}
        </div>
      )}
      {!usable && !checking && (
        <div className="messaging-status" role="alert">
          <p>
            {readyError ||
              (!enabled || denied
                ? '현재 학교의 메시지 이용 권한을 다시 확인해 주세요.'
                : '메시지와 알림의 서버 연결을 준비하고 있습니다. 준비되지 않은 대화를 빈 목록으로 표시하지 않습니다.')}
          </p>
          <button type="button" onClick={() => setRefresh((value) => value + 1)}>
            연결 다시 확인
          </button>
        </div>
      )}
      {pending && (
        <section className="messaging-status messaging-recovery" aria-label="이전 메시지 요청 확인">
          <h3>이전 요청의 결과를 먼저 확인해 주세요</h3>
          <p>
            같은 내용과 요청 번호로 다시 확인합니다. 확인 전에는 새 메시지 전송을 멈춥니다. 보관
            정보는 현재 탭에만 남습니다. 연결 준비를 확인하지 못한 경우에는 기존 접수증만
            조회합니다.
          </p>
          <div className="messaging-actions">
            <button
              type="button"
              className="messaging-primary"
              disabled={busy || !enabled || denied}
              onClick={() => void send(pending, true)}
            >
              이전 요청 그대로 다시 확인
            </button>
            <button type="button" disabled={busy} onClick={() => setFolded((value) => !value)}>
              {folded ? '보관한 입력 보기' : '입력 접고 목록 보기'}
            </button>
          </div>
        </section>
      )}
      {!usable && !denied && enabled && fileRecovery.request && (
        <MessageAttachments
          server={fileServer}
          member={member}
          enabled={false}
          disabled={busy || Boolean(pending)}
          files={draft.attachments}
          onChange={(files) => setDraft((value) => ({ ...value, attachments: files }))}
          onLockChange={setFileLocked}
        />
      )}
      {usable && (
        <>
          {delivered && !checking && (
            <SentDeliveryPanel
              key={delivered.receipt.requestKey}
              record={delivered}
              disabled={locked}
              hasDraft={dirty}
              onOpen={openDeliveredThread}
              onDismiss={() => setDelivered(null)}
            />
          )}
          <div className="messaging-tabs" role="group" aria-label="메시지 분류">
            <button
              type="button"
              aria-pressed={tab === 'messages'}
              onClick={() => setTab('messages')}
            >
              대화
            </button>
            <button type="button" aria-pressed={tab === 'inbox'} onClick={() => setTab('inbox')}>
              업무 알림
            </button>
          </div>
          {composing && (
            <form
              hidden={folded}
              className="messaging-compose wh-composer"
              onSubmit={prepare}
              aria-label={draft.thread ? '답장 작성' : '새 메시지 작성'}
            >
              <header className="wh-compose-heading">
                <span className="wh-compose-eyebrow">메시지 작성</span>
                <h3>{draft.thread ? '답장 작성' : '새 메시지 작성'}</h3>
                <p>받는 사람과 내용을 확인한 뒤 전송합니다.</p>
              </header>
              {conflict && (
                <div className="messaging-status" role="alert">
                  <p>
                    {draft.thread
                      ? '참여자가 바뀌었습니다. 아래 버튼으로 현재 참여자를 확인한 뒤 다시 보내 주세요.'
                      : '받는 사람 정보를 다시 확인해 주세요. 교사 명단을 다시 조회하고 받는 사람을 다시 선택하면 최신 정보를 사용합니다. 메시지 내용은 유지됩니다.'}
                  </p>
                  {draft.thread && (
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => void refreshReplyParticipants()}
                    >
                      현재 참여자 다시 확인
                    </button>
                  )}
                </div>
              )}
              <div className="messaging-compose-grid">
                <fieldset disabled={locked} className="messaging-to wh-compose-body">
                  <legend className="messaging-sr-only">받는 사람과 내용</legend>
                  <div className="wh-compose-label">
                    <h4>받는 사람</h4>
                    <span>
                      {draft.thread
                        ? draft.thread.participants.filter((item) => item.memberId !== member.id)
                            .length
                        : draft.recipients.length}
                      명 선택
                    </span>
                  </div>
                  {draft.thread ? (
                    <p>
                      받는 사람:{' '}
                      {draft.thread.participants
                        .filter((item) => item.memberId !== member.id)
                        .map((item) => item.name)
                        .join(', ')}
                    </p>
                  ) : (
                    <>
                      <label htmlFor={`${id}-mode`}>
                        보내는 방식
                        <select
                          id={`${id}-mode`}
                          value={draft.mode}
                          onChange={(event) =>
                            setDraft((value) => ({
                              ...value,
                              mode: event.target.value as MessageDraft['mode'],
                              recipients:
                                event.target.value === 'direct'
                                  ? value.recipients.slice(0, 1)
                                  : value.recipients,
                            }))
                          }
                        >
                          <option value="direct">1:1 메시지</option>
                          <option value="group">함께 보는 단체 대화</option>
                          <option value="individual">각자에게 개별 전송</option>
                        </select>
                      </label>
                      <p className="messaging-muted">
                        {draft.mode === 'group'
                          ? '단체 대화에서는 참여자와 답장을 서로 볼 수 있습니다.'
                          : draft.mode === 'individual'
                            ? '같은 내용을 각 교사와의 개별 대화에 보냅니다.'
                            : '한 명의 교사와 대화합니다.'}
                      </p>
                      <div className="messaging-filters">
                        <label htmlFor={`${id}-recipient-search`}>
                          교사 이름·부서 검색
                          <input
                            id={`${id}-recipient-search`}
                            value={recipientQuery}
                            onChange={(event) => setRecipientQuery(event.target.value)}
                            maxLength={200}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={loadingRecipients}
                          onClick={() => {
                            setRecipientSearch(recipientQuery)
                            setRecipientRefresh((value) => value + 1)
                          }}
                        >
                          교사 찾기
                        </button>
                      </div>
                      {recipientError && (
                        <div role="alert">
                          {recipientError}
                          <button type="button" onClick={() => void loadRecipients(false)}>
                            받는 사람 다시 조회
                          </button>
                        </div>
                      )}
                      {loadingRecipients && <p role="status">교사 명단 확인 중…</p>}
                      <ul className="messaging-recipient-list" aria-label="받는 사람 선택">
                        {recipients.items.map((recipient) => (
                          <li key={recipient.memberId}>
                            <label>
                              <input
                                type="checkbox"
                                aria-describedby={`${id}-person-${recipient.memberId}`}
                                checked={draft.recipients.some(
                                  (item) => item.memberId === recipient.memberId,
                                )}
                                disabled={
                                  !draft.recipients.some(
                                    (item) => item.memberId === recipient.memberId,
                                  ) &&
                                  draft.mode !== 'direct' &&
                                  draft.recipients.length >= (readiness?.limits?.recipients ?? 0)
                                }
                                onChange={() => chooseRecipient(recipient)}
                              />
                              <span>{recipientLabel(recipient, recipientPeers)}</span>
                            </label>
                            <details className="messaging-person-id">
                              <summary>소속 번호 보기</summary>
                              <small id={`${id}-person-${recipient.memberId}`}>
                                소속 번호: {recipient.memberId}
                              </small>
                            </details>
                          </li>
                        ))}
                      </ul>
                      {!loadingRecipients && !recipientError && recipients.items.length === 0 && (
                        <p className="messaging-muted">검색 조건에 맞는 교사가 없습니다.</p>
                      )}
                      {recipients.nextCursor && (
                        <button
                          type="button"
                          disabled={loadingRecipients}
                          onClick={() => void loadRecipients(true)}
                        >
                          교사 더 보기
                        </button>
                      )}
                      <div
                        className="messaging-selected"
                        aria-label={`선택한 받는 사람 ${draft.recipients.length}명`}
                      >
                        {draft.recipients.map((recipient) => (
                          <button
                            type="button"
                            key={recipient.memberId}
                            onClick={() => chooseRecipient(recipient)}
                            aria-label={`${recipientLabel(recipient, recipientPeers)} 받는 사람에서 제외`}
                          >
                            {recipientLabel(recipient, recipientPeers)} ×
                          </button>
                        ))}
                      </div>
                      {draft.mode === 'group' && (
                        <label htmlFor={`${id}-title`}>
                          대화 제목
                          <input
                            id={`${id}-title`}
                            value={draft.title}
                            maxLength={readiness?.limits?.titleCharacters}
                            required
                            onChange={(event) =>
                              setDraft((value) => ({ ...value, title: event.target.value }))
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                </fieldset>
                <div className="messaging-compose-content wh-compose-body">
                  <fieldset disabled={locked} className="messaging-body-fields">
                    <legend className="messaging-sr-only">메시지 내용</legend>
                    <div>
                      <label htmlFor={`${id}-body`}>메시지</label>
                      <textarea
                        id={`${id}-body`}
                        ref={composerInput}
                        placeholder="전달할 내용을 적어 주세요."
                        rows={6}
                        value={draft.body}
                        maxLength={readiness?.limits?.bodyCharacters}
                        required={!draft.attachments.length}
                        onChange={(event) =>
                          setDraft((value) => ({ ...value, body: event.target.value }))
                        }
                      />
                    </div>
                    <p className="messaging-muted">
                      {Array.from(draft.body).length.toLocaleString()} /{' '}
                      {readiness?.limits?.bodyCharacters.toLocaleString()}자
                    </p>
                  </fieldset>
                  <MessageAttachments
                    server={fileServer}
                    member={member}
                    enabled={readiness?.attachments === 'hwpx_basic_v1'}
                    disabled={busy || Boolean(pending || preview)}
                    files={draft.attachments}
                    onChange={(files) => setDraft((value) => ({ ...value, attachments: files }))}
                    onLockChange={setFileLocked}
                  />
                </div>
              </div>
              {!pending && !preview && (
                <footer className="wh-compose-footer">
                  <p>다음 화면에서 최종 확인 후 보냅니다.</p>
                  <div className="messaging-actions">
                    <button
                      className="messaging-primary"
                      type="submit"
                      disabled={busy || fileLocked || (conflict && Boolean(draft.thread))}
                    >
                      받는 사람과 내용 확인
                    </button>
                    <button type="button" disabled={busy || fileLocked} onClick={closeComposer}>
                      {discardConfirm ? '작성한 입력 버리고 닫기' : '작성 닫기'}
                    </button>
                    {dirty && (
                      <button type="button" disabled={busy} onClick={() => setFolded(true)}>
                        입력 접고 목록 보기
                      </button>
                    )}
                  </div>
                </footer>
              )}
              {discardConfirm && (
                <p role="status">닫기를 한 번 더 누르면 아직 보내지 않은 입력을 버립니다.</p>
              )}
            </form>
          )}
          {composing && folded && !pending && (
            <div className="messaging-status">
              <p>작성 중인 메시지를 현재 탭에 보관했습니다.</p>
              <button type="button" onClick={() => setFolded(false)}>
                작성 계속하기
              </button>
            </div>
          )}
          {preview && (
            <MessagePreview
              attempt={preview}
              busy={busy}
              onConfirm={() => void send(preview)}
              onEdit={() => setPreview(null)}
            />
          )}
          <div className="messaging-filters">
            <label className="messaging-check">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(event) => setUnreadOnly(event.target.checked)}
              />
              읽지 않은 항목만
            </label>
            <button
              type="button"
              disabled={busy || loadingThreads || loadingInbox}
              onClick={() => setRefresh((value) => value + 1)}
            >
              새로고침
            </button>
          </div>
          {tab === 'messages' ? (
            <div className="messaging-grid">
              <section className="messaging-panel" aria-label="대화 목록">
                <form
                  className="messaging-filters"
                  onSubmit={(event) => {
                    event.preventDefault()
                    setSearch(query)
                  }}
                >
                  <label htmlFor={`${id}-search`}>
                    대화 검색
                    <input
                      type="search"
                      id={`${id}-search`}
                      placeholder="대화 제목·참여자"
                      value={query}
                      maxLength={200}
                      onChange={(event) => setQuery(event.target.value)}
                    />
                  </label>
                  <button type="submit">검색</button>
                </form>
                {threadError && <p role="alert">{threadError}</p>}
                {loadingThreads && <p role="status">대화를 불러오는 중…</p>}
                <ul className="messaging-list">
                  {threads.items.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        aria-current={selected?.id === thread.id}
                        onClick={() => openThread(thread.id)}
                      >
                        <strong>
                          {thread.title ||
                            thread.participants
                              .filter((item) => item.memberId !== member.id)
                              .map((item) => item.name)
                              .join(', ')}
                        </strong>
                        <small>
                          {timeLabel(thread.updatedAt)} ·{' '}
                          {thread.kind === 'group' ? '단체 대화' : '1:1 대화'}
                        </small>
                        {thread.unreadCount > 0 && (
                          <span className="messaging-badge">
                            읽지 않은 메시지 {thread.unreadCount}개
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
                {!loadingThreads && !threadError && !threads.items.length && (
                  <div className="messaging-empty">
                    <strong>조건에 맞는 대화가 없습니다.</strong>
                    <p>검색어나 읽지 않은 항목만 보기 조건을 확인해 주세요.</p>
                  </div>
                )}
                {threads.nextCursor && (
                  <button
                    type="button"
                    disabled={loadingThreads}
                    onClick={() => void loadThreads(true)}
                  >
                    대화 더 보기
                  </button>
                )}
              </section>
              <section className="messaging-panel" aria-label="선택한 대화">
                {openedId && (
                  <div className="messaging-actions">
                    <button type="button" onClick={closeThread}>
                      대화 목록으로 돌아가기
                    </button>
                  </div>
                )}
                {selected ? (
                  <>
                    <h3 ref={threadHeading} tabIndex={-1}>
                      {selected.title ||
                        selected.participants
                          .filter((item) => item.memberId !== member.id)
                          .map((item) => item.name)
                          .join(', ')}
                    </h3>
                    <p className="messaging-muted">
                      참여자: {selected.participants.map((item) => item.name).join(', ')}
                    </p>
                    {messageError && (
                      <div role="alert">
                        {messageError}
                        <button type="button" onClick={() => void loadMessages(selected.id, false)}>
                          대화 다시 불러오기
                        </button>
                      </div>
                    )}
                    {messageCursor && (
                      <button
                        type="button"
                        disabled={loadingMessages}
                        onClick={() => void loadMessages(selected.id, true)}
                      >
                        이전 메시지 보기
                      </button>
                    )}
                    <ol className="messaging-messages" aria-label="메시지 내용">
                      {messages.map((message) => (
                        <li key={message.id} data-own={message.senderMemberId === member.id}>
                          <div className="messaging-message-meta">
                            <strong>{message.senderName}</strong>
                            <time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time>
                          </div>
                          <p className="messaging-body">{message.body}</p>
                          {message.attachments.map((file) => (
                            <button
                              type="button"
                              disabled={busy || readiness?.attachments !== 'hwpx_basic_v1'}
                              key={file.id}
                              onClick={() => void downloadMessageFile(message, file)}
                            >
                              {file.name} 내려받기
                            </button>
                          ))}
                        </li>
                      ))}
                    </ol>
                    {loadingMessages && <p role="status">메시지를 불러오는 중…</p>}
                    <div className="messaging-actions">
                      <button
                        type="button"
                        className="messaging-primary"
                        disabled={
                          locked ||
                          dirty ||
                          !selected.canSend ||
                          loadingMessages ||
                          Boolean(messageError)
                        }
                        onClick={() => start(selected)}
                      >
                        답장
                      </button>
                      <button
                        type="button"
                        disabled={locked || !canRead || loadingMessages || Boolean(messageError)}
                        onClick={() =>
                          mark({
                            kind: 'read_thread',
                            threadId: selected.id,
                            throughSequence: selectedSequence,
                          })
                        }
                      >
                        화면에 연 메시지까지 읽음 표시
                      </button>
                    </div>
                    {!selected.canSend && (
                      <p className="messaging-muted">현재 대화에 답장할 수 없습니다.</p>
                    )}
                  </>
                ) : openedId ? (
                  <>
                    <h3 ref={threadHeading} tabIndex={-1}>
                      요청한 대화
                    </h3>
                    {loadingMessages && <p role="status">대화를 확인하는 중…</p>}
                    {messageError && (
                      <div role="alert">
                        <p>{messageError}</p>
                        <button
                          type="button"
                          disabled={loadingMessages}
                          onClick={() => {
                            focusThread.current = true
                            void loadMessages(openedId, false)
                          }}
                        >
                          요청한 대화 다시 확인
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="messaging-empty">
                    <strong>대화를 선택해 주세요.</strong>
                    <p>목록에서 대화를 열면 메시지와 첨부 파일을 확인할 수 있습니다.</p>
                  </div>
                )}
              </section>
            </div>
          ) : (
            <section className="messaging-panel messaging-inbox" aria-label="내 업무 알림">
              <p className="messaging-muted messaging-inbox-guidance">
                알림을 읽거나 원본을 열어도 협업 수락·완료 확인, 업무 완료, 수합 제출, 승인 상태가
                바뀌지는 않습니다. 협업의 현재 담당자와 처리 상태는 원본에서 확인해 주세요.
              </p>
              {inboxError && <p role="alert">{inboxError}</p>}
              {loadingInbox && <p role="status">알림을 불러오는 중…</p>}
              {inbox.items.map((item) => (
                <article
                  key={item.id}
                  className="messaging-notice"
                  data-read={Boolean(item.readAt)}
                >
                  <div className="messaging-notice-meta">
                    <span className="messaging-notice-state">
                      {item.readAt ? '읽음' : '읽지 않음'}
                    </span>
                    {item.source && <span>{sourceLabels[item.source.module]}</span>}
                    <time dateTime={item.createdAt}>{timeLabel(item.createdAt)}</time>
                  </div>
                  <h3>{item.title}</h3>
                  <p className="messaging-body">{item.body}</p>
                  <div className="messaging-actions">
                    {!item.readAt && (
                      <button
                        type="button"
                        disabled={locked}
                        onClick={() =>
                          mark({
                            kind: 'read_notice',
                            noticeId: item.id,
                            expectedVersion: item.version,
                          })
                        }
                      >
                        읽음으로 표시
                      </button>
                    )}
                    {item.source && onOpenSource && canOpenSource?.(item.source) && (
                      <button
                        type="button"
                        className="messaging-notice-open"
                        disabled={navigationLocked || Boolean(openingSource)}
                        onClick={() => void openNoticeSource(item)}
                      >
                        {openingSource === item.id
                          ? `${sourceLabels[item.source.module]} 원본 확인 중…`
                          : `${sourceLabels[item.source.module]} 원본 열기`}
                      </button>
                    )}
                  </div>
                  {sourceError?.noticeId === item.id && <p role="alert">{sourceError.message}</p>}
                </article>
              ))}
              {!loadingInbox && !inboxError && inbox.items.length === 0 && (
                <div className="messaging-empty">
                  <strong>조건에 맞는 알림이 없습니다.</strong>
                  <p>
                    {unreadOnly
                      ? '읽지 않은 항목만 보기를 해제하면 읽은 알림도 확인할 수 있습니다.'
                      : '새 알림이 도착하면 이곳에서 확인할 수 있습니다.'}
                  </p>
                </div>
              )}
              {inbox.nextCursor && (
                <button type="button" disabled={loadingInbox} onClick={() => void loadInbox(true)}>
                  알림 더 보기
                </button>
              )}
            </section>
          )}
        </>
      )}
    </section>
  )
}
