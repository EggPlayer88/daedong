import { collectionStateLabel } from './presentation'
import { CollectionOperations } from './CollectionOperations'
import { type FilePolicy, type FileReference } from '../files/contracts'
import { formatFileBytes } from '../files/FileControls'
import { hwpxCollectionPolicy } from '../files/hwpx-basic-policy'
import { type CollectionFileParent } from './contracts'
import { CollectionUnitsEditor } from './CollectionUnitsEditor'
import { AnswerInputComparison, CollectionInputComparison } from './CollectionInputComparison'
import { CollectionSubmissionHistory } from './CollectionSubmissionHistory'
import { CollectionServerExport } from './CollectionServerExport'
import { formatCollectionRecordedTime, summarizeCollectionSubmission } from './submission-summary'
import { CollectionSubmissionGuide } from './CollectionSubmissionGuide'
import { CollectionUnitWorkbench } from './CollectionUnitWorkbench'
import styles from './collection-server.css?inline'
import composerStyles from '../app/composer-layout.css?inline'
import { ComposerOptions } from '../app/ComposerOptions'
import { blank, inputOf, same } from './collection-editor-model'
import type { useCollectionEditor } from './useCollectionEditor'
export function CollectionEditorView({ model }: { model: ReturnType<typeof useCollectionEditor> }) {
  const {
    allowedMembers,
    attachGenerated,
    blocked,
    busy,
    canRetainAction,
    canShowAnswer,
    canShowEditor,
    chooseFile,
    compareLatest,
    comparison,
    comparisonUnit,
    cursor,
    date,
    detail,
    dirty,
    download,
    enabled,
    error,
    exportBusy,
    focusNext,
    hadSubmission,
    hasWork,
    history,
    incomingFile,
    inputBlocked,
    list,
    loading,
    locked,
    managementUnit,
    member,
    memberLabel,
    members,
    mutate,
    newCollectionPolicy,
    notice,
    openAnswer,
    operationState,
    operations,
    panelRef,
    parkEditing,
    parked,
    pending,
    pickerId,
    publishReview,
    readError,
    readiness,
    reload,
    resetEditing,
    restoring,
    resumeEditing,
    retainComparedInput,
    revision,
    saveEditor,
    savingRequest,
    selectTemplates,
    selectedId,
    selectedUnit,
    server,
    session,
    setCursor,
    setDetail,
    setError,
    setExportBusy,
    setHistory,
    setNotice,
    setOperationState,
    setOperationsLocked,
    setPublishReview,
    setReload,
    setSession,
    statuses,
    submissionClosed,
    submissionGuide,
    submitManagement,
    unitValidation,
    uploadFile,
  } = model
  function filesView(
    files: FileReference[],
    parent?: CollectionFileParent,
    remove?: (id: string) => void,
    downloadable?: string[],
  ) {
    return (
      <ul className="cs-files">
        {files.map((file) => (
          <li key={file.id}>
            <span>
              {file.name} <small>{formatFileBytes(file.bytes)}</small>
            </span>
            <div>
              {parent && (!downloadable || downloadable.includes(file.id)) && (
                <button
                  type="button"
                  disabled={!!busy || exportBusy}
                  aria-label={`${file.name} 다운로드`}
                  onClick={() => {
                    void download(parent, file)
                  }}
                >
                  내려받기
                </button>
              )}
              {remove && (
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => remove(file.id)}
                  aria-label={`${file.name} 제거`}
                >
                  제거
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    )
  }
  function picker(label: string, parent: CollectionFileParent, files: FileReference[]) {
    const originalPolicy =
      parent.kind === 'template'
        ? session.editor?.input.fileCollection?.policy
        : detail?.request.fileCollection?.policy
    if (!originalPolicy) return null
    let filePolicy: FilePolicy
    try {
      filePolicy = hwpxCollectionPolicy(originalPolicy)
    } catch {
      return (
        <p className="cs-warning">
          이 수합의 파일 규칙에는 HWPX가 포함되어 있지 않습니다. 담당자가 규칙을 변경한 뒤 새 파일을
          올릴 수 있습니다. 기존 파일은 그대로 내려받을 수 있습니다.
        </p>
      )
    }
    const descriptionId = `${pickerId}-${parent.kind}-file-rule`
    return (
      <label className="cs-file-picker">
        {label}
        <input
          type="file"
          aria-label={label}
          aria-describedby={descriptionId}
          disabled={
            blocked ||
            (parent.kind === 'draft' && submissionClosed) ||
            files.length >= filePolicy.maxFiles
          }
          accept=".hwpx"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            chooseFile(file, parent, files, filePolicy)
          }}
        />
        <small id={descriptionId}>
          HWPX · 파일당 {formatFileBytes(filePolicy.maxFileBytes)} · 첨부 {files.length}/
          {filePolicy.maxFiles}개
          {files.length >= filePolicy.maxFiles
            ? ' · 다른 파일을 올리려면 기존 첨부 선택을 먼저 제거해 주세요.'
            : ' · 한글에서 HWPX 형식으로 저장한 파일을 선택하세요.'}
        </small>
      </label>
    )
  }
  return (
    <section ref={panelRef} className="collection-server" aria-label="서버 문서 수합">
      <style>{styles + composerStyles}</style>
      <header className="cs-heading">
        <div>
          <p>학교 업무</p>
          <h2>문서 수합</h2>
          <span>HWPX 양식을 나누고 작성한 파일을 모읍니다.</span>
        </div>
        {readiness?.available && !parked && (
          <div className="cs-actions">
            <button
              type="button"
              disabled={!!busy || !!pending || loading || exportBusy}
              onClick={() => setReload((value) => value + 1)}
            >
              새로 확인
            </button>
            <button
              type="button"
              className="cs-primary"
              data-cs-focus="create-button"
              disabled={locked || loading || !newCollectionPolicy}
              onClick={() => {
                if (!newCollectionPolicy) return
                focusNext('editor')
                setSession({
                  editor: {
                    staged: [],
                    input: {
                      ...blank(),
                      fileCollection: {
                        policy: newCollectionPolicy,
                        required: true,
                        templates: [],
                      },
                    },
                  },
                })
                setError('')
                setNotice('')
              }}
            >
              새 수합 만들기
            </button>
          </div>
        )}
      </header>
      {readiness?.available && !parked && !newCollectionPolicy && (
        <p className="cs-warning">
          HWPX 수합 규칙을 먼저 연결해야 새 수합을 만들 수 있습니다. 기존 기록은 확인할 수 있습니다.
        </p>
      )}
      {busy && <p role="status">{busy}</p>}
      {notice && (
        <p className="cs-notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="cs-error" role="alert">
          {error}
        </p>
      )}
      {parked && (
        <section className="cs-notice" aria-label="보관한 수합 작업">
          <h3>작성 중인 수합 작업을 보관했습니다</h3>
          <p>
            업무실 안의 다른 메뉴를 이용할 수 있습니다. 자료 수합으로 돌아와 보관한 입력
            {pending ? '과 기존 요청 번호로 결과를' : '을'} 다시 확인해 주세요.
          </p>
          <p>
            새로고침·탭 닫기·로그아웃·학교 변경 시 보관 내용이 사라질 수 있습니다. 이 보관은 서버
            저장이 아닙니다.
          </p>
          <button type="button" disabled={!!busy || exportBusy} onClick={resumeEditing}>
            보관한 입력과 요청 다시 열기
          </button>
        </section>
      )}
      {pending && !parked && (
        <section className="cs-warning" aria-label="수합 저장 결과 확인">
          <h3 role="status">
            {savingRequest ? '수합 요청을 처리하고 있습니다' : '이전 저장 결과 확인이 필요합니다'}
          </h3>
          <p>
            {savingRequest
              ? '입력과 요청 번호를 보관하고 처리 결과를 기다립니다.'
              : '같은 내용과 요청 번호로 다시 확인합니다. 결과를 확인하기 전에는 새 저장을 하지 않습니다. 서버 준비가 해제돼도 이전 요청의 결과는 다시 확인할 수 있습니다.'}
          </p>
          {session.recoveryConflict && (
            <p role="alert">
              기존 요청 기록과 일치하지 않아 자동으로 새 요청을 만들지 않습니다. 보관한 상태로
              관리자에게 확인해 주세요.
            </p>
          )}
          <button
            type="button"
            disabled={!!busy || !enabled}
            onClick={() => {
              void mutate(pending.command, pending.key)
            }}
          >
            {savingRequest ? '처리 결과 확인 중…' : '이전 요청 그대로 다시 확인'}
          </button>
        </section>
      )}
      {!parked && hasWork && (pending || !readiness?.available) && (
        <section className="cs-warning" aria-label="수합 입력 임시 보관">
          <p>
            지금 확인하기 어렵다면 입력과 기존 요청 번호를 이 탭에 보관하고 업무실 안의 다른 메뉴를
            이용할 수 있습니다. 새로고침하면 보관 내용이 사라집니다.
          </p>
          <button type="button" disabled={!!busy || exportBusy} onClick={parkEditing}>
            입력 보관하고 다른 메뉴 이용
          </button>
        </section>
      )}
      {readError && (
        <section className="cs-error" role="alert">
          <p>{readError}</p>
          <button type="button" disabled={!!busy} onClick={() => setReload((value) => value + 1)}>
            연결과 원본 다시 확인
          </button>
        </section>
      )}
      {loading && (
        <p className={list || detail || session.editor ? 'cs-sr-only' : undefined} role="status">
          수합 연결과 목록을 확인 중…
        </p>
      )}
      {!loading && !readiness?.available && (
        <section className="cs-empty">
          <h3>문서 수합 연결 준비가 필요합니다</h3>
          <p>HWPX 전용 수합 연결을 준비 중입니다.</p>
          <p>
            {!readiness
              ? '현재 연결을 확인하지 못해 원인을 확정할 수 없습니다.'
              : readiness.reason === 'database_missing'
                ? '문서 수합용 DB 함수가 아직 준비되지 않았습니다.'
                : readiness?.reason === 'storage_missing'
                  ? '문서 수합용 파일 저장소 연결이 아직 준비되지 않았습니다.'
                  : readiness?.reason === 'verification_missing'
                    ? 'HWPX 파일의 기본 확인 기능이 아직 연결되지 않았습니다.'
                    : '학교의 파일 허용 정책을 먼저 설정해야 합니다.'}
          </p>
          <p>
            새 등록·업로드·제출은 준비 후 이용할 수 있습니다. 기존 자료는 현재 읽기 권한에 따라
            조회하고 내려받을 수 있습니다.
          </p>
          <button type="button" onClick={() => setReload((value) => value + 1)}>
            준비 상태 다시 확인
          </button>
        </section>
      )}
      {!parked &&
        (!readiness?.available || (readError && !detail && !restoring)) &&
        dirty &&
        !pending &&
        (!session.upload || session.upload.cancelable || session.upload.rejected) && (
          <button
            type="button"
            disabled={!!busy}
            onClick={() => {
              resetEditing()
              setNotice('보관한 입력을 버렸습니다. 다른 메뉴로 이동할 수 있습니다.')
            }}
          >
            입력 버리고 닫기
          </button>
        )}
      {enabled && !parked && (
        <>
          {session.conflict && (
            <section className="cs-warning" aria-label="수합 변경 충돌">
              <h3>최신 내용과 내 입력을 비교해 주세요</h3>
              {comparison ? (
                <>
                  {session.editor?.original ? (
                    <CollectionInputComparison
                      base={inputOf(session.editor.original)}
                      latest={inputOf(comparison.detail.request)}
                      mine={session.editor.input}
                      members={members.filter((person) => person.schoolId === member.schoolId)}
                      disabled={!!busy || !!pending}
                      onResolve={(input) => retainComparedInput({ editor: input })}
                    />
                  ) : session.answer ? (
                    <AnswerInputComparison
                      base={
                        session.answer.confirmedInput ?? {
                          text: session.answer.original?.text ?? '',
                          number: session.answer.original?.number ?? null,
                          files: session.answer.original?.files ?? [],
                        }
                      }
                      latest={{
                        text: comparison.draft?.text ?? '',
                        number: comparison.draft?.number ?? null,
                        files: comparison.draft?.files ?? [],
                      }}
                      mine={session.answer.input}
                      labels={{
                        text: comparison.detail.request.textLabel,
                        number: comparison.detail.request.numberLabel,
                      }}
                      disabled={!!busy || !!pending}
                      onResolve={(input) => retainComparedInput({ answer: input })}
                    />
                  ) : (
                    <>
                      <div className="cs-comparison">
                        <div>
                          <h4>현재 서버 내용</h4>
                          <p>
                            {comparisonUnit?.label ?? '현재 열람할 수 없는 제출 단위'} · 상태{' '}
                            {comparisonUnit?.version ?? '확인 필요'}판
                          </p>
                          <p>
                            현재 제출:{' '}
                            {comparison.detail.submissions.find(
                              (value) => value.id === comparisonUnit?.currentSubmissionId,
                            )?.revision ?? '없음'}
                            판
                          </p>
                          <p>정정 기한: {comparisonUnit?.correctionUntil || '설정 없음'}</p>
                          <p>{comparisonUnit?.correctionReason}</p>
                        </div>
                        <div>
                          <h4>내 입력</h4>
                          {session.management ? (
                            <>
                              <p>
                                {session.management.kind === 'withdraw' ? '철회' : '정정 허용'}{' '}
                                사유: {session.management.reason}
                              </p>
                              <p>
                                {session.management.dueDate &&
                                  `정정 기한: ${session.management.dueDate}`}
                              </p>
                            </>
                          ) : (
                            <p>검토 의견: {session.review?.note || '없음'}</p>
                          )}
                        </div>
                      </div>
                      {canRetainAction ? (
                        <button
                          type="button"
                          disabled={!!busy}
                          onClick={() => retainComparedInput()}
                        >
                          최신 버전 확인 · 내 입력 유지
                        </button>
                      ) : (
                        <p role="alert">
                          대상 제출 또는 변경 권한이 달라졌습니다. 이 입력을 새 제출에 적용할 수
                          없습니다. 기존 작성을 닫고 최신 제출을 확인해 주세요.
                        </p>
                      )}
                    </>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() => {
                    void compareLatest()
                  }}
                >
                  최신 원본과 비교
                </button>
              )}
              <button
                type="button"
                disabled={!!busy || !!pending}
                onClick={() => {
                  resetEditing(selectedId)
                  setReload((value) => value + 1)
                }}
              >
                내 변경 버리고 다시 열기
              </button>
            </section>
          )}
          {session.upload && (
            <section className="cs-warning" aria-label="서버 파일 확인">
              <h3>{session.upload.file.name}</h3>
              <p>
                {session.upload.rejected
                  ? '이 파일은 사용할 수 없습니다.'
                  : 'HWPX 기본 형식과 업로드 완료 여부를 확인하고 있습니다. 완료되면 양식이나 제출 파일로 저장할 수 있습니다.'}
              </p>
              {session.upload.rejected ? (
                <button
                  type="button"
                  disabled={!!busy}
                  onClick={() =>
                    setSession({
                      ...session,
                      upload: undefined,
                      editor: session.editor
                        ? {
                            ...session.editor,
                            saving: false,
                            staged: session.editor.staged?.filter(
                              (value) => value.id !== session.upload?.stagedId,
                            ),
                          }
                        : undefined,
                    })
                  }
                >
                  거부된 파일 선택 해제
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!!busy || restoring}
                    onClick={() => {
                      void uploadFile(session.upload!)
                    }}
                  >
                    {session.upload.phase === 'upload'
                      ? '같은 파일 전송 재시도'
                      : '같은 파일 상태 다시 확인'}
                  </button>
                  {session.upload.cancelable && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => {
                        setSession({
                          ...session,
                          upload: undefined,
                          editor: session.editor
                            ? {
                                ...session.editor,
                                saving: false,
                                staged: session.editor.staged?.filter(
                                  (value) => value.id !== session.upload?.stagedId,
                                ),
                              }
                            : undefined,
                        })
                        setNotice('이 파일의 첨부 선택을 취소했습니다.')
                      }}
                    >
                      첨부 선택 취소
                    </button>
                  )}
                </>
              )}
            </section>
          )}
          {canShowEditor && (
            <form
              className="cs-card cs-composer wh-composer"
              data-cs-form="editor"
              aria-label="수합 초안 작성"
              onSubmit={saveEditor}
            >
              <div className="cs-composer-heading wh-compose-heading">
                <span className="cs-draft-badge">담당자 초안 · 공개 전</span>
                <h3 tabIndex={-1} data-cs-focus="editor">
                  {session.editor!.original ? '수합 초안 수정' : '새 수합 초안'}
                </h3>
                <p className="cs-muted">
                  내용과 양식을 한 번에 저장하세요. 공개는 저장 후 따로 결정합니다.
                </p>
              </div>
              <fieldset disabled={inputBlocked}>
                <legend className="cs-sr-only">수합 내용</legend>
                <section className="cs-compose-section">
                  <h4>수합 내용</h4>
                  <div className="cs-basics">
                    <label>
                      수합 제목
                      <input
                        placeholder="예: 1학기 학급 운영계획"
                        required
                        value={session.editor!.input.title}
                        onChange={(event) =>
                          setSession({
                            ...session,
                            editor: {
                              ...session.editor!,
                              input: { ...session.editor!.input, title: event.target.value },
                            },
                          })
                        }
                      />
                    </label>
                    <label>
                      제출 기한
                      <input
                        type="date"
                        required
                        value={session.editor!.input.dueDate}
                        onChange={(event) =>
                          setSession({
                            ...session,
                            editor: {
                              ...session.editor!,
                              input: { ...session.editor!.input, dueDate: event.target.value },
                            },
                          })
                        }
                      />
                    </label>
                  </div>
                  <label>
                    안내 내용
                    <textarea
                      aria-label="안내 내용"
                      rows={2}
                      placeholder="작성 방법이나 꼭 알려야 할 내용을 적어 주세요."
                      value={session.editor!.input.instructions}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: { ...session.editor!.input, instructions: event.target.value },
                          },
                        })
                      }
                    />
                  </label>
                </section>
                <div className="cs-compose-columns">
                  <section className="cs-compose-section">
                    <h4>
                      제출 대상 <small>{session.editor!.input.units.length}부 선택</small>
                    </h4>
                    <CollectionUnitsEditor
                      units={session.editor!.input.units}
                      members={allowedMembers}
                      reviewerMemberId={session.editor!.input.reviewerMemberId}
                      disabled={inputBlocked}
                      onChange={(units) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: { ...session.editor!.input, units },
                          },
                        })
                      }
                    />
                  </section>
                  <section className="cs-compose-section">
                    <h4>
                      나눠 줄 양식 <small>선택</small>
                    </h4>
                    <p className="cs-muted">
                      {session.editor!.staged !== undefined
                        ? '양식이 있으면 선택하세요. 저장할 때 HWPX 검사와 업로드를 진행합니다.'
                        : '양식을 선택하고 검사 완료 후 초안 변경을 저장하세요.'}
                    </p>
                    {session.editor!.staged !== undefined ? (
                      <>
                        <label className="cs-file-picker cs-template-picker">
                          <span className="cs-template-prompt">HWPX 양식 선택</span>
                          <input
                            className="cs-sr-only"
                            type="file"
                            aria-label="양식 파일 선택"
                            aria-describedby={`${pickerId}-staged-rule`}
                            accept=".hwpx"
                            multiple
                            onChange={(event) => {
                              const files = Array.from(event.target.files ?? [])
                              event.target.value = ''
                              selectTemplates(files)
                            }}
                          />
                          <small id={`${pickerId}-staged-rule`}>
                            HWPX · 파일당{' '}
                            {formatFileBytes(
                              session.editor!.input.fileCollection!.policy.maxFileBytes,
                            )}{' '}
                            · 최대 {session.editor!.input.fileCollection!.policy.maxFiles}개 ·
                            선택한 파일은 아래에 표시됩니다.
                          </small>
                        </label>
                        <ul className="cs-files" aria-label="선택한 양식">
                          {session.editor!.staged.map((item) => (
                            <li key={item.id}>
                              <span>
                                {item.file.name}
                                <small> · {formatFileBytes(item.file.size)} · 저장 대기</small>
                              </span>
                              <button
                                type="button"
                                aria-label={`${item.file.name} 선택 취소`}
                                onClick={() =>
                                  setSession({
                                    ...session,
                                    editor: {
                                      ...session.editor!,
                                      staged: session.editor!.staged!.filter(
                                        (value) => value.id !== item.id,
                                      ),
                                    },
                                  })
                                }
                              >
                                선택 취소
                              </button>
                            </li>
                          ))}
                        </ul>
                      </>
                    ) : (
                      session.editor!.original &&
                      picker(
                        '양식 파일 선택',
                        {
                          kind: 'template',
                          requestId: session.editor!.original.id,
                          version: session.editor!.original.version,
                        },
                        session.editor!.input.fileCollection?.templates ?? [],
                      )
                    )}
                    {filesView(
                      session.editor!.input.fileCollection?.templates ?? [],
                      session.editor!.original
                        ? {
                            kind: 'template',
                            requestId: session.editor!.original.id,
                            version: session.editor!.original.version,
                          }
                        : undefined,
                      (id) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: {
                              ...session.editor!.input,
                              fileCollection: {
                                ...session.editor!.input.fileCollection!,
                                templates: session.editor!.input.fileCollection!.templates.filter(
                                  (file) => file.id !== id,
                                ),
                              },
                            },
                          },
                        }),
                      session.editor!.original?.fileCollection?.templates.map((file) => file.id) ??
                        [],
                    )}
                  </section>
                </div>
                <ComposerOptions
                  className="cs-optional"
                  initialOpen={session.editor!.input.reviewMode === 'required'}
                  summary="선택 설정 · 제출 후 담당자 검토"
                >
                  <p className="cs-muted">
                    검토자를 지정하면 제출한 파일을 확인하고 보완을 요청할 수 있습니다.
                  </p>
                  <label>
                    제출 후 검토
                    <select
                      aria-label="제출 후 검토"
                      value={session.editor!.input.reviewerMemberId}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: {
                              ...session.editor!.input,
                              reviewerMemberId: event.target.value,
                              reviewMode: event.target.value ? 'required' : 'none',
                            },
                          },
                        })
                      }
                    >
                      <option value="">검토 없이 제출 완료</option>
                      {session.editor!.input.reviewerMemberId &&
                        !allowedMembers.some(
                          (person) => person.id === session.editor!.input.reviewerMemberId,
                        ) && (
                          <option value={session.editor!.input.reviewerMemberId}>
                            기존 검토자 · 현재 명부에 없음
                          </option>
                        )}
                      {allowedMembers
                        .filter(
                          (person) =>
                            person.id === session.editor!.input.reviewerMemberId ||
                            !session.editor!.input.units.some(
                              (unit) => unit.responsibleMemberId === person.id,
                            ),
                        )
                        .map((person) => (
                          <option key={person.id} value={person.id}>
                            {memberLabel(person)} 검토
                          </option>
                        ))}
                    </select>
                  </label>
                </ComposerOptions>
                <ComposerOptions
                  className="cs-optional"
                  initialOpen={Boolean(
                    session.editor!.input.textLabel || session.editor!.input.numberLabel,
                  )}
                  summary="함께 받을 답변 · 글과 숫자"
                >
                  <p className="cs-muted">
                    파일과 함께 필요한 답변만 요청하세요. 질문을 비우면 해당 항목은 표시하지
                    않습니다.
                  </p>
                  <label>
                    글 응답 질문
                    <input
                      maxLength={120}
                      value={session.editor!.input.textLabel}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: {
                              ...session.editor!.input,
                              textLabel: event.target.value,
                              textRequired: event.target.value.trim()
                                ? session.editor!.input.textRequired
                                : false,
                            },
                          },
                        })
                      }
                    />
                  </label>
                  <label className="cs-confirmation">
                    <input
                      type="checkbox"
                      checked={session.editor!.input.textRequired}
                      disabled={!session.editor!.input.textLabel.trim()}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: { ...session.editor!.input, textRequired: event.target.checked },
                          },
                        })
                      }
                    />
                    글 응답 필수
                  </label>
                  <label>
                    숫자 응답 질문
                    <input
                      maxLength={120}
                      value={session.editor!.input.numberLabel}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: {
                              ...session.editor!.input,
                              numberLabel: event.target.value,
                              numberRequired: event.target.value.trim()
                                ? session.editor!.input.numberRequired
                                : false,
                            },
                          },
                        })
                      }
                    />
                  </label>
                  <label className="cs-confirmation">
                    <input
                      type="checkbox"
                      checked={session.editor!.input.numberRequired}
                      disabled={!session.editor!.input.numberLabel.trim()}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          editor: {
                            ...session.editor!,
                            input: {
                              ...session.editor!.input,
                              numberRequired: event.target.checked,
                            },
                          },
                        })
                      }
                    />
                    숫자 응답 필수 · 0도 유효한 응답
                  </label>
                </ComposerOptions>
              </fieldset>
              <footer className="cs-compose-footer wh-compose-footer">
                <p role="status">
                  {session.editor!.saving
                    ? session.upload
                      ? '양식을 확인 중입니다. 완료된 파일만 초안에 연결합니다.'
                      : '초안과 양식을 저장 중입니다…'
                    : session.editor!.createdId
                      ? '초안은 만들어졌습니다. 남은 양식을 확인한 뒤 같은 초안에 저장합니다.'
                      : '저장해도 교사에게 공개되지 않습니다.'}
                </p>
                <div className="cs-actions">
                  <button
                    type="submit"
                    className="cs-primary"
                    disabled={blocked || !unitValidation?.valid}
                  >
                    {session.editor!.original ? '수합 초안 변경 저장' : '수합 초안 저장'}
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      focusNext(session.editor?.original ? 'edit-button' : 'create-button')
                      resetEditing(session.editor?.original?.id)
                    }}
                  >
                    작성 취소
                  </button>
                </div>
              </footer>
            </form>
          )}
          {restoring && (
            <p className={detail ? 'cs-sr-only' : undefined} role="status">
              수합 원본과 보관한 입력의 접근 권한을 다시 확인 중…
            </p>
          )}
          {detail && !session.editor && (
            <section className="cs-card" aria-label="수합 상세">
              <div className="cs-heading">
                <div>
                  <h3 tabIndex={-1} data-cs-focus="detail">
                    {detail.request.title}
                  </h3>
                  <p>
                    {detail.request.dueDate}까지 ·{' '}
                    {detail.request.status === 'draft'
                      ? '담당자 초안'
                      : submissionClosed
                        ? operationState?.phase === 'archived'
                          ? '보관'
                          : '마감'
                        : detail.request.dueDate < date
                          ? '공개됨 · 기한 지남'
                          : '공개됨'}{' '}
                    · v{detail.request.version}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    focusNext('list-item', detail.request.id)
                    resetEditing()
                    setDetail(undefined)
                  }}
                >
                  목록으로
                </button>
              </div>
              <p className="cs-instructions">{detail.request.instructions}</p>
              {incomingFile?.requestId === detail.request.id && (
                <p className="cs-notice" role="status">
                  문서함에서 만든 {incomingFile.fileName} 파일이 있습니다. 내 제출 파일 작성을 열고
                  첨부한 뒤 최종 제출을 확인하세요.
                </p>
              )}
              {operations && detail.request.status === 'published' && (
                <CollectionOperations
                  key={detail.request.id}
                  server={operations}
                  member={member}
                  requestId={detail.request.id}
                  date={date}
                  disabled={Boolean(
                    busy ||
                      pending ||
                      session.editor ||
                      session.answer ||
                      session.upload ||
                      session.review ||
                      session.management ||
                      session.conflict ||
                      exportBusy,
                  )}
                  revision={reload + revision}
                  onLock={setOperationsLocked}
                  onState={setOperationState}
                  onChanged={() => setReload((value) => value + 1)}
                />
              )}
              {filesView(detail.request.fileCollection?.templates ?? [], {
                kind: 'template',
                requestId: detail.request.id,
                version: detail.request.version,
              })}
              {detail.request.status === 'published' &&
                detail.request.managerMemberId === member.id &&
                detail.request.fileCollection && (
                  <CollectionServerExport
                    server={server}
                    member={member}
                    requestId={detail.request.id}
                    date={date}
                    disabled={Boolean(busy || pending || dirty || restoring || !enabled)}
                    onBusyChange={setExportBusy}
                  />
                )}
              {detail.request.status === 'draft' &&
                detail.request.managerMemberId === member.id && (
                  <div className="cs-actions">
                    <button
                      type="button"
                      data-cs-focus="edit-button"
                      disabled={locked || !readiness?.available}
                      onClick={() => {
                        focusNext('editor')
                        setSession({
                          selectedId: detail.request.id,
                          editor: {
                            original: detail.request,
                            input: structuredClone(inputOf(detail.request)),
                          },
                        })
                      }}
                    >
                      양식 추가·초안 수정
                    </button>
                    <button
                      type="button"
                      className="cs-primary"
                      disabled={locked || !readiness?.available}
                      onClick={() => setPublishReview(structuredClone(detail.request))}
                    >
                      대상 교사에게 공개
                    </button>
                  </div>
                )}
              {submissionClosed && (
                <p className="cs-warning" role="status">
                  {operationState?.phase === 'archived' ? '보관 중인' : '마감된'} 수합입니다. 새
                  제출과 정정 기간 설정은 접수를 재개한 뒤 가능합니다. 남은 보완 요청도 담당자가
                  접수 상태와 기한을 확인해야 합니다. 기존 제출본은 내려받을 수 있습니다.
                </p>
              )}
              {publishReview && (
                <section className="cs-card" aria-label="수합 공개 전 확인">
                  <h4>대상과 양식을 확인해 주세요</h4>
                  <p>
                    {publishReview.title} · {publishReview.dueDate}까지 · {publishReview.version}판
                  </p>
                  <ul>
                    {publishReview.units.map((unit, index) => (
                      <li key={index}>{unit.label}</li>
                    ))}
                  </ul>
                  <p>양식 {publishReview.fileCollection?.templates.length ?? 0}개</p>
                  <ul>
                    {publishReview.fileCollection?.templates.map((file) => (
                      <li key={file.id}>{file.name}</li>
                    ))}
                  </ul>
                  {!same(publishReview, detail.request) && (
                    <p role="alert">
                      초안이 변경되었습니다. 확인을 닫고 최신 내용을 다시 확인해 주세요.
                    </p>
                  )}
                  <div className="cs-actions">
                    <button
                      type="button"
                      disabled={Boolean(busy || pending)}
                      onClick={() => setPublishReview(undefined)}
                    >
                      공개 취소
                    </button>
                    <button
                      type="button"
                      className="cs-primary"
                      disabled={Boolean(
                        busy ||
                          pending ||
                          loading ||
                          restoring ||
                          readError ||
                          !readiness?.available ||
                          !same(publishReview, detail.request),
                      )}
                      onClick={() => {
                        const request = publishReview
                        setPublishReview(undefined)
                        void mutate({
                          kind: 'publish',
                          requestId: request.id,
                          expectedVersion: request.version,
                        })
                      }}
                    >
                      대상·양식 확인 후 공개
                    </button>
                  </div>
                </section>
              )}
              {detail.request.status === 'published' && (
                <CollectionUnitWorkbench
                  detail={detail}
                  memberId={member.id}
                  date={date}
                  locked={locked}
                  activeUnitId={
                    session.answer?.unitId ?? session.review?.unitId ?? session.management?.unitId
                  }
                >
                  {(unit) => {
                    const submission = detail.submissions.find(
                        (value) => value.id === unit.currentSubmissionId,
                      ),
                      withdrawn = Boolean(
                        submission && unit.withdrawnSubmissionIds.includes(submission.id),
                      )
                    const review =
                        submission &&
                        detail.reviews.find((value) => value.submissionId === submission.id),
                      participant = unit.members.some((value) => value.id === member.id)
                    const supplements = detail.supplements.filter(
                      (value) => value.unitId === unit.id && !value.fulfilledSubmissionId,
                    )
                    const summary = summarizeCollectionSubmission(detail, unit, date)
                    return (
                      <article
                        className="cs-unit"
                        key={unit.id}
                        aria-label={`${unit.label} 제출 현황`}
                      >
                        <h4>{unit.label}</h4>
                        <CollectionSubmissionHistory
                          detail={detail}
                          unit={unit}
                          members={allowedMembers}
                          date={date}
                          disabled={locked}
                          onDownload={(parent, file) => {
                            void download(parent, file)
                          }}
                        />
                        {submission && (
                          <p className="cs-muted">
                            제출 v{submission.revision} · 서버 접수{' '}
                            <time dateTime={submission.receiptAt}>
                              {formatCollectionRecordedTime(submission.receiptAt)}
                            </time>
                          </p>
                        )}
                        {submission &&
                          !withdrawn &&
                          filesView(submission.files ?? [], {
                            kind: 'submission',
                            requestId: detail.request.id,
                            unitId: unit.id,
                            submissionId: submission.id,
                          })}
                        {participant && (
                          <button
                            type="button"
                            data-cs-focus="answer-button"
                            data-cs-key={unit.id}
                            disabled={locked || !readiness?.available || submissionClosed}
                            onClick={() => {
                              void openAnswer(unit.id)
                            }}
                          >
                            내 제출 파일 작성
                          </button>
                        )}
                        {supplements.length > 0 && (
                          <p className="cs-warning">
                            보완 요청 {supplements.length}건이 있습니다. 제출 파일을 작성하고 응답할
                            보완 건을 선택해 주세요.
                          </p>
                        )}
                        <div className="cs-actions">
                          {submission &&
                            !withdrawn &&
                            unit.responsibleMemberId === member.id &&
                            summary.reviewState !== 'accepted' && (
                              <button
                                type="button"
                                data-cs-focus="manage-button"
                                data-cs-key={`${unit.id}-withdraw`}
                                disabled={locked || !readiness?.available}
                                onClick={() => {
                                  focusNext('management')
                                  setSession({
                                    selectedId: detail.request.id,
                                    management: {
                                      kind: 'withdraw',
                                      unitId: unit.id,
                                      submissionId: submission.id,
                                      expectedVersion: unit.version,
                                      reason: '',
                                      dueDate: '',
                                      confirmed: false,
                                    },
                                  })
                                }}
                              >
                                제출 철회
                              </button>
                            )}
                          {detail.request.managerMemberId === member.id && (
                            <button
                              type="button"
                              data-cs-focus="manage-button"
                              data-cs-key={`${unit.id}-open_correction`}
                              disabled={locked || !readiness?.available || submissionClosed}
                              onClick={() => {
                                focusNext('management')
                                setSession({
                                  selectedId: detail.request.id,
                                  management: {
                                    kind: 'open_correction',
                                    unitId: unit.id,
                                    submissionId: null,
                                    expectedVersion: unit.version,
                                    reason: '',
                                    dueDate:
                                      unit.correctionUntil >= date ? unit.correctionUntil : '',
                                    confirmed: false,
                                  },
                                })
                              }}
                            >
                              정정 기간 설정
                            </button>
                          )}
                        </div>
                        {submission &&
                          !withdrawn &&
                          detail.request.reviewerMemberId === member.id &&
                          !review &&
                          (session.review?.unitId === unit.id &&
                          session.review.submissionId === submission.id ? (
                            <div className="cs-review">
                              <p className="cs-muted" tabIndex={-1} data-cs-focus="review">
                                검토 대상: 제출 v{submission.revision}
                              </p>
                              <label>
                                검토 의견
                                <textarea
                                  aria-label="검토 의견"
                                  maxLength={1000}
                                  value={session.review.note}
                                  disabled={blocked}
                                  onChange={(event) =>
                                    setSession({
                                      ...session,
                                      review: { ...session.review!, note: event.target.value },
                                    })
                                  }
                                />
                              </label>
                              <label>
                                보완 기한
                                <input
                                  type="date"
                                  min={date}
                                  value={session.review.dueDate}
                                  disabled={blocked}
                                  onChange={(event) =>
                                    setSession({
                                      ...session,
                                      review: { ...session.review!, dueDate: event.target.value },
                                    })
                                  }
                                />
                              </label>
                              <div className="cs-actions">
                                <button
                                  type="button"
                                  disabled={blocked}
                                  onClick={() => {
                                    void mutate({
                                      kind: 'review',
                                      requestId: detail.request.id,
                                      unitId: unit.id,
                                      submissionId: session.review!.submissionId,
                                      expectedVersion: session.review!.expectedVersion,
                                      decision: 'accepted',
                                      note: session.review!.note,
                                      dueDate: '',
                                    })
                                  }}
                                >
                                  검토 완료
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    blocked ||
                                    !session.review.note.trim() ||
                                    !session.review.dueDate ||
                                    session.review.dueDate < date
                                  }
                                  onClick={() => {
                                    void mutate({
                                      kind: 'review',
                                      requestId: detail.request.id,
                                      unitId: unit.id,
                                      submissionId: session.review!.submissionId,
                                      expectedVersion: session.review!.expectedVersion,
                                      decision: 'changes_requested',
                                      note: session.review!.note,
                                      dueDate: session.review!.dueDate,
                                    })
                                  }}
                                >
                                  보완 요청
                                </button>
                                <button
                                  type="button"
                                  disabled={blocked}
                                  onClick={() => {
                                    focusNext('review-button', unit.id)
                                    resetEditing(detail.request.id)
                                  }}
                                >
                                  검토 작성 취소
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              data-cs-focus="review-button"
                              data-cs-key={unit.id}
                              disabled={locked || !readiness?.available}
                              onClick={() => {
                                focusNext('review')
                                setSession({
                                  selectedId: detail.request.id,
                                  review: {
                                    unitId: unit.id,
                                    submissionId: submission.id,
                                    expectedVersion: unit.version,
                                    note: '',
                                    dueDate: '',
                                  },
                                })
                              }}
                            >
                              제출물 검토
                            </button>
                          ))}
                      </article>
                    )
                  }}
                </CollectionUnitWorkbench>
              )}
            </section>
          )}
          {session.management && managementUnit && detail && (
            <form
              className="cs-card"
              data-cs-form="management"
              aria-label="제출 관리"
              onSubmit={submitManagement}
            >
              <h3 tabIndex={-1} data-cs-focus="management">
                {managementUnit.label} ·{' '}
                {session.management.kind === 'withdraw' ? '제출 철회 확인' : '정정 기간 설정'}
              </h3>
              <p>
                {session.management.kind === 'withdraw'
                  ? '현재 제출의 철회를 요청합니다. 접수·검토·철회 이력은 남습니다. 처리 후 현재 제출과 완료본을 다시 확인해 주세요.'
                  : '이 제출 단위의 정정 허용 기간을 설정합니다. 전체 수합 기한은 바뀌지 않습니다.'}
              </p>
              <fieldset disabled={inputBlocked}>
                <legend className="cs-sr-only">관리 입력</legend>
                <label>
                  {session.management.kind === 'withdraw' ? '철회 사유' : '정정 허용 사유'}
                  <textarea
                    required
                    maxLength={1000}
                    value={session.management.reason}
                    onChange={(event) =>
                      setSession({
                        ...session,
                        management: {
                          ...session.management!,
                          reason: event.target.value,
                          confirmed: false,
                        },
                      })
                    }
                  />
                </label>
                {session.management.kind === 'open_correction' && (
                  <label>
                    정정 종료일
                    <input
                      type="date"
                      required
                      min={date}
                      value={session.management.dueDate}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          management: {
                            ...session.management!,
                            dueDate: event.target.value,
                            confirmed: false,
                          },
                        })
                      }
                    />
                  </label>
                )}
                <label className="cs-confirmation">
                  <input
                    type="checkbox"
                    checked={session.management.confirmed}
                    onChange={(event) =>
                      setSession({
                        ...session,
                        management: { ...session.management!, confirmed: event.target.checked },
                      })
                    }
                  />
                  대상과 처리 내용을 확인했습니다
                </label>
              </fieldset>
              <p className="cs-muted">
                처리 가능 여부와 기한은 서버에서 현재 권한·상태를 기준으로 확인합니다.
              </p>
              <div className="cs-actions">
                <button
                  type="submit"
                  className="cs-primary"
                  disabled={
                    blocked ||
                    !session.management.confirmed ||
                    !session.management.reason.trim() ||
                    (session.management.kind === 'open_correction' &&
                      (submissionClosed ||
                        !session.management.dueDate ||
                        session.management.dueDate < date))
                  }
                >
                  {session.management.kind === 'withdraw'
                    ? '확인한 제출 철회 요청'
                    : '정정 기간 저장'}
                </button>
                <button
                  type="button"
                  disabled={blocked}
                  onClick={() => {
                    focusNext(
                      'manage-button',
                      `${session.management!.unitId}-${session.management!.kind}`,
                    )
                    resetEditing(detail.request.id)
                  }}
                >
                  관리 작성 취소
                </button>
              </div>
            </form>
          )}
          {canShowAnswer && (
            <form
              className="cs-card cs-answer wh-composer"
              data-cs-form="answer"
              noValidate
              aria-label="제출 파일 작성"
              onSubmit={(event) => {
                event.preventDefault()
                if (!blocked && !submissionClosed)
                  void mutate({
                    kind: 'save_draft',
                    requestId: session.answer!.requestId,
                    unitId: session.answer!.unitId,
                    expectedVersion: session.answer!.original?.version ?? 0,
                    input: session.answer!.input,
                  })
              }}
            >
              <header className="wh-compose-heading">
                <span className="wh-compose-eyebrow">제출 파일 작성</span>
                <h3 tabIndex={-1} data-cs-focus="answer">
                  {selectedUnit!.label} · 제출 준비
                </h3>
                <p>파일을 저장한 뒤 최종 제출해 주세요.</p>
              </header>
              {submissionGuide && <CollectionSubmissionGuide guidance={submissionGuide} />}
              {submissionClosed && (
                <p role="status" className="cs-warning">
                  접수가 마감되었거나 보관 중입니다. 작성한 입력은 유지되며 새 저장·제출은 담당자가
                  접수를 재개한 뒤 할 수 있습니다.
                </p>
              )}
              <fieldset className="wh-compose-body" disabled={inputBlocked}>
                <legend className="cs-sr-only">제출 파일</legend>
                {picker(
                  '제출 파일 선택',
                  {
                    kind: 'draft',
                    requestId: session.answer!.requestId,
                    unitId: session.answer!.unitId,
                    version: session.answer!.original?.version ?? 0,
                  },
                  session.answer!.input.files ?? [],
                )}
                {incomingFile?.requestId === session.answer!.requestId && (
                  <button
                    type="button"
                    disabled={blocked || submissionClosed || !detail!.request.fileCollection}
                    onClick={attachGenerated}
                  >
                    문서함에서 만든 HWPX 첨부
                  </button>
                )}
                {session.answer!.input.files?.some((file) => file.extension !== 'hwpx') && (
                  <p className="cs-warning">
                    이 초안에는 HWPX가 아닌 기존 파일이 있습니다. 새로 저장하거나 제출하려면 해당
                    첨부 선택을 빼고 HWPX 파일로 바꿔 주세요. 과거 제출본은 그대로 보존됩니다.
                  </p>
                )}
                {filesView(session.answer!.input.files ?? [], undefined, (id) =>
                  setSession({
                    ...session,
                    answer: {
                      ...session.answer!,
                      input: {
                        ...session.answer!.input,
                        files: session.answer!.input.files?.filter((file) => file.id !== id),
                      },
                    },
                  }),
                )}
                {detail!.request.textLabel && (
                  <label>
                    {detail!.request.textLabel}
                    <textarea
                      maxLength={5000}
                      aria-label={detail!.request.textLabel}
                      value={session.answer!.input.text}
                      required={detail!.request.textRequired}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          answer: {
                            ...session.answer!,
                            input: { ...session.answer!.input, text: event.target.value },
                          },
                        })
                      }
                    />
                  </label>
                )}
                {detail!.request.numberLabel && (
                  <label>
                    {detail!.request.numberLabel}
                    <input
                      type="number"
                      step="any"
                      value={session.answer!.input.number ?? ''}
                      required={detail!.request.numberRequired}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          answer: {
                            ...session.answer!,
                            input: {
                              ...session.answer!.input,
                              number: event.target.value === '' ? null : Number(event.target.value),
                            },
                          },
                        })
                      }
                    />
                  </label>
                )}
                {hadSubmission && (
                  <label>
                    재제출 사유
                    <input
                      maxLength={1000}
                      value={session.answer!.reason}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          answer: { ...session.answer!, reason: event.target.value },
                        })
                      }
                    />
                  </label>
                )}
                {detail!.supplements.some(
                  (value) => value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId,
                ) && (
                  <label>
                    응답할 보완 요청
                    <select
                      aria-label="응답할 보완 요청"
                      value={session.answer!.correctionRequestId}
                      onChange={(event) =>
                        setSession({
                          ...session,
                          answer: { ...session.answer!, correctionRequestId: event.target.value },
                        })
                      }
                    >
                      <option value="">보완 요청을 선택해 주세요</option>
                      {detail!.supplements
                        .filter(
                          (value) =>
                            value.unitId === selectedUnit!.id && !value.fulfilledSubmissionId,
                        )
                        .map((value, index) => (
                          <option key={value.id} value={value.id}>
                            보완 {index + 1} · {value.dueDate}까지
                          </option>
                        ))}
                    </select>
                  </label>
                )}
              </fieldset>
              <footer className="wh-compose-footer">
                <p>초안 저장과 최종 제출은 별도입니다.</p>
                <div className="cs-actions">
                  <button
                    type="submit"
                    className={submissionGuide?.canSubmit ? undefined : 'cs-primary'}
                    disabled={blocked || submissionClosed}
                  >
                    제출 초안 저장
                  </button>
                  <button
                    type="button"
                    disabled={blocked}
                    onClick={() => {
                      focusNext('answer-button', session.answer!.unitId)
                      resetEditing(session.answer!.requestId)
                    }}
                  >
                    작성 닫기
                  </button>
                  {session.answer!.original && selectedUnit!.responsibleMemberId === member.id && (
                    <button
                      type="button"
                      className={submissionGuide?.canSubmit ? 'cs-primary' : undefined}
                      disabled={blocked || submissionClosed || !submissionGuide?.canSubmit}
                      onClick={() => {
                        void mutate({
                          kind: 'submit',
                          requestId: session.answer!.requestId,
                          unitId: session.answer!.unitId,
                          draftId: session.answer!.original!.id,
                          expectedDraftVersion: session.answer!.original!.version,
                          expectedVersion: selectedUnit!.version,
                          reason: session.answer!.reason,
                          ...(session.answer!.correctionRequestId
                            ? { correctionRequestId: session.answer!.correctionRequestId }
                            : {}),
                        })
                      }}
                    >
                      {hadSubmission ? '저장한 파일 다시 제출' : '저장한 파일 최종 제출'}
                    </button>
                  )}
                </div>
              </footer>
              <p className="cs-muted cs-answer-note">
                최종 제출은 책임 교사만 할 수 있습니다. 서버에서 권한과 최신 버전을 다시 확인합니다.
              </p>
            </form>
          )}
          {!session.editor && !selectedId && list && (
            <>
              <div className="cs-list" aria-label="수합 목록">
                {list.items.length ? (
                  list.items.map((request) => (
                    <button
                      type="button"
                      className="cs-list-item"
                      data-cs-focus="list-item"
                      data-cs-key={request.id}
                      key={request.id}
                      disabled={locked}
                      onClick={() => {
                        focusNext('detail')
                        setSession({ selectedId: request.id })
                        setError('')
                        setNotice('')
                      }}
                    >
                      <strong>{request.title}</strong>
                      <span>
                        {request.dueDate}까지 ·{' '}
                        {collectionStateLabel(
                          request.status,
                          request.dueDate,
                          statuses?.today ?? date,
                          statuses?.items.find(
                            (row) =>
                              row.requestId === request.id && row.version === request.version,
                          )?.phase,
                        )}
                      </span>
                    </button>
                  ))
                ) : (
                  <p className="cs-empty">현재 볼 수 있는 수합이 없습니다.</p>
                )}
              </div>
              <nav className="cs-actions" aria-label="수합 목록 페이지">
                <button
                  type="button"
                  disabled={locked || !history.length}
                  onClick={() => {
                    setCursor(history.at(-1))
                    setHistory(history.slice(0, -1))
                  }}
                >
                  이전 페이지
                </button>
                <span>{history.length + 1}쪽</span>
                <button
                  type="button"
                  disabled={locked || !list.nextCursor}
                  onClick={() => {
                    setHistory([...history, cursor])
                    setCursor(list.nextCursor!)
                  }}
                >
                  다음 페이지
                </button>
              </nav>
            </>
          )}
        </>
      )}
    </section>
  )
}
