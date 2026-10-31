import type { useGuidedEditor } from './useGuidedEditor'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function GuidedAnswersSection({
  model,
}: {
  model: Pick<
    ReturnType<typeof useGuidedEditor>,
    | 'answerDirty'
    | 'denied'
    | 'editable'
    | 'id'
    | 'input'
    | 'loadError'
    | 'loading'
    | 'locked'
    | 'mapDirty'
    | 'onRequestAi'
    | 'onRequestGuidedAi'
    | 'questions'
    | 'render'
    | 'requestHelp'
    | 'response'
    | 'saveAnswers'
    | 'setInput'
    | 'setReviewed'
    | 'target'
    | 'template'
  >
}) {
  const {
    answerDirty,
    denied,
    editable,
    id,
    input,
    loadError,
    loading,
    locked,
    mapDirty,
    onRequestAi,
    onRequestGuidedAi,
    questions,
    render,
    requestHelp,
    response,
    saveAnswers,
    setInput,
    setReviewed,
    target,
    template,
  } = model
  if (!template) return null
  return (
    <>
      {template.mapping && (
        <section
          className="documents-editor"
          data-document-step="answers"
          tabIndex={-1}
          aria-label={editable ? '게시 전 시험 답변' : '내 질문 답변'}
        >
          <h4>{editable ? '게시 전 시험 답변' : '필요한 내용 답하기'}</h4>
          {editable && template.mapping.questions.some((q) => q.kind === 'number') && (
            <p className="documents-muted">
              숫자 답변도 연결한 문단 전체를 바꿉니다. 원본의 %, 명, 원 등 단위는 자동으로 남지
              않습니다. 단위까지 필요하면 글 질문으로 바꾸고 답변에 함께 입력한 뒤 생성 파일을
              확인해 주세요.
            </p>
          )}
          <p className="documents-muted">
            현재 고정된 v{template.version} 양식에 저장합니다. 응답 저장과 파일 제출은 다른
            단계입니다.
          </p>
          <fieldset disabled={locked || mapDirty}>
            {template.mapping.questions.map((q) => (
              <label key={q.id} htmlFor={`${id}-answer-${q.id}`}>
                {q.label}
                {q.required ? ' (필수)' : ''}
                {q.kind === 'select' ? (
                  <select
                    aria-label={`${q.label}${q.required ? ' (필수)' : ''}`}
                    id={`${id}-answer-${q.id}`}
                    value={input[q.id] ?? ''}
                    onChange={(e) => {
                      setInput((v) => ({ ...v, [q.id]: e.target.value }))
                      setReviewed(false)
                    }}
                  >
                    <option value="">선택해 주세요</option>
                    {q.options.map((option) => (
                      <option key={option}>{option}</option>
                    ))}
                  </select>
                ) : q.kind === 'longtext' ? (
                  <textarea
                    aria-label={`${q.label}${q.required ? ' (필수)' : ''}`}
                    id={`${id}-answer-${q.id}`}
                    value={input[q.id] ?? ''}
                    maxLength={q.maxLength}
                    onChange={(e) => {
                      setInput((v) => ({ ...v, [q.id]: e.target.value }))
                      setReviewed(false)
                    }}
                  />
                ) : (
                  <input
                    id={`${id}-answer-${q.id}`}
                    type={q.kind === 'date' ? 'date' : 'text'}
                    inputMode={q.kind === 'number' ? 'decimal' : 'text'}
                    value={input[q.id] ?? ''}
                    maxLength={q.maxLength}
                    onChange={(e) => {
                      setInput((v) => ({ ...v, [q.id]: e.target.value }))
                      setReviewed(false)
                    }}
                  />
                )}
              </label>
            ))}
          </fieldset>
          <div className="documents-actions">
            <button
              type="button"
              disabled={locked || mapDirty || (!answerDirty && Boolean(response))}
              onClick={saveAnswers}
            >
              답변 임시 저장
            </button>
            <button
              type="button"
              disabled={locked || mapDirty || answerDirty || !response}
              onClick={render}
            >
              저장한 답변으로 HWPX 생성
            </button>
            {(onRequestGuidedAi || onRequestAi) && (
              <button
                type="button"
                disabled={locked || mapDirty || loading || Boolean(loadError) || denied}
                onClick={requestHelp}
              >
                답변 작성 도움 받기
              </button>
            )}
          </div>
        </section>
      )}
    </>
  )
}
