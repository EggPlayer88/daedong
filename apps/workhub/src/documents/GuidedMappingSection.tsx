import { GUIDED_LIMITS, type Question } from './guided-contracts'
import { GuidedAnchorPicker } from './GuidedAnchorPicker'
import type { useGuidedEditor } from './useGuidedEditor'

// 상태·명령은 컨트롤러가 소유하고 이 단계는 표시와 사용자 입력 전달만 맡는다.
export function GuidedMappingSection({
  model,
}: {
  model: Pick<
    ReturnType<typeof useGuidedEditor>,
    | 'addQuestion'
    | 'changeQuestion'
    | 'editable'
    | 'id'
    | 'input'
    | 'locked'
    | 'mapDirty'
    | 'questions'
    | 'saveMapping'
    | 'setQuestions'
    | 'setTitle'
    | 'target'
    | 'template'
    | 'title'
  >
}) {
  const {
    addQuestion,
    changeQuestion,
    editable,
    id,
    input,
    locked,
    mapDirty,
    questions,
    saveMapping,
    setQuestions,
    setTitle,
    target,
    template,
    title,
  } = model
  if (!template) return null
  return (
    <>
      {editable && template.inspection && (
        <section
          className="documents-editor"
          data-document-step="mapping"
          tabIndex={-1}
          aria-label="질문과 실제 칸 연결"
        >
          <h4>질문과 실제 칸 연결</h4>
          <label htmlFor={`${id}-title`}>
            양식 이름
            <input
              id={`${id}-title`}
              disabled={locked}
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p className="documents-muted">
            칸의 원문과 위치를 확인한 뒤 질문을 추가합니다. 이미 있는 글은 답변으로 바뀝니다.
            지원하지 않는 복합 문단 {template.inspection.unsupportedParagraphs}개는 원형을
            유지합니다.
          </p>
          <GuidedAnchorPicker
            key={`${template.id}:${template.version}`}
            inspection={template.inspection}
            questions={questions}
            locked={locked}
            onAdd={addQuestion}
          />
          {questions.map((q, index) => (
            <fieldset className="guided-question" key={q.id} disabled={locked}>
              <legend>질문 {index + 1}</legend>
              <details className="documents-muted">
                <summary>연결한 원본 위치</summary>
                <code>{q.anchorId}</code>
              </details>
              <p className="documents-body">바뀔 원문: {q.sourceText || '(빈 칸)'}</p>
              <label htmlFor={`${id}-${q.id}-label`}>
                질문 내용
                <input
                  id={`${id}-${q.id}-label`}
                  value={q.label}
                  maxLength={200}
                  onChange={(e) => changeQuestion(index, { label: e.target.value })}
                />
              </label>
              <label htmlFor={`${id}-${q.id}-kind`}>
                답변 형식
                <select
                  id={`${id}-${q.id}-kind`}
                  value={q.kind}
                  onChange={(e) =>
                    changeQuestion(index, {
                      kind: e.target.value as Question['kind'],
                      options: e.target.value === 'select' ? [''] : [],
                    })
                  }
                >
                  <option value="text">짧은 글</option>
                  <option value="longtext">여러 줄 글</option>
                  <option value="number">숫자</option>
                  <option value="date">날짜</option>
                  <option value="select">선택 항목</option>
                </select>
              </label>
              <label className="documents-check">
                <input
                  type="checkbox"
                  checked={q.required}
                  onChange={(e) => changeQuestion(index, { required: e.target.checked })}
                />
                필수 질문
              </label>
              <label htmlFor={`${id}-${q.id}-max`}>
                최대 글자 수
                <input
                  id={`${id}-${q.id}-max`}
                  type="number"
                  min={1}
                  max={GUIDED_LIMITS.maxAnswerCharacters}
                  value={q.maxLength}
                  onChange={(e) => changeQuestion(index, { maxLength: Number(e.target.value) })}
                />
              </label>
              {q.kind === 'select' && (
                <label htmlFor={`${id}-${q.id}-options`}>
                  선택 항목 · 한 줄에 하나
                  <textarea
                    id={`${id}-${q.id}-options`}
                    value={q.options.join('\n')}
                    onChange={(e) => changeQuestion(index, { options: e.target.value.split('\n') })}
                  />
                </label>
              )}
              <button
                type="button"
                className="guided-question-delete"
                onClick={() => setQuestions((value) => value.filter((_, i) => i !== index))}
              >
                이 질문 삭제
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="documents-primary"
            disabled={locked || !questions.length || !mapDirty}
            onClick={saveMapping}
          >
            질문과 입력 위치 저장
          </button>
        </section>
      )}
    </>
  )
}
