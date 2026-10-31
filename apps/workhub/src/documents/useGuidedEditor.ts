import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { usePendingRequest } from '../app/pending-requests'
import { useEditDraft } from '../app/edit-drafts'
import { canonical, ServiceError } from '../services/service-values'
import { requestBlobDownload, safeDownloadName } from '../files/download'
import { activeAt } from '../domain'
import { createGuidedService } from './guided-adapter'
import {
  answers,
  GUIDED_LIMITS,
  questionMapping,
  type Artifact,
  type CollectionTarget,
  type GuidedCommand,
  type Question,
  type Template,
  type TemplateDetail,
} from './guided-contracts'
import { makeGuidedAiRequest, type GuidedAiOrigin } from './guided-ai'
import type { GuidedSetupAiOrigin, GuidedSetupAiRequest } from './guided-setup-ai'
import { Pending, Memory, GuidedWorkspaceProps, errorOf } from './guided-editor-model'
export function useGuidedEditor({
  connection,
  member,
  date,
  revision = 0,
  onNavigationLockChange,
  onRequestAi,
  onRequestGuidedAi,
  onRequestGuidedSetupAi,
  setupAiSuggestion,
  onOpenFileCollections,
  aiSuggestion,
  onOpenCollection,
  onUseGenerated,
  service: provided,
}: GuidedWorkspaceProps) {
  const service = useMemo(
      () => provided ?? createGuidedService(connection),
      [provided, connection],
    ),
    memory = useEditDraft<Memory>(member, 'guided-documents'),
    selection = useEditDraft<{ templateId: string }>(member, 'guided-document-selection'),
    recovery = usePendingRequest(member, 'guidedDocuments'),
    id = useId()
  const [saved] = useState(() => memory.initial),
    [selected, setSelected] = useState<TemplateDetail | null>(saved?.selected ?? null),
    [title, setTitle] = useState(saved?.title ?? ''),
    [questions, setQuestions] = useState<Question[]>(saved?.questions ?? []),
    [input, setInput] = useState<Record<string, string>>(saved?.input ?? {})
  const [pending, setPending] = useState<Pending | null>(
      () => (recovery.request?.command as Pending | undefined) ?? saved?.pending ?? null,
    ),
    [folded, setFolded] = useState(saved?.folded ?? false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [loadError, setLoadError] = useState(''),
    [notice, setNotice] = useState(''),
    [loading, setLoading] = useState(true),
    [denied, setDenied] = useState(false)
  const [items, setItems] = useState<Template[]>([]),
    [cursor, setCursor] = useState<string | null>(null),
    [canCreate, setCanCreate] = useState(false),
    [uploadTitle, setUploadTitle] = useState(saved?.uploadTitle ?? ''),
    [targets, setTargets] = useState<CollectionTarget[]>([]),
    [target, setTarget] = useState(''),
    [reviewed, setReviewed] = useState(false),
    [downloaded, setDownloaded] = useState(false),
    [conflict, setConflict] = useState(false)
  const [aiOrigin, setAiOrigin] = useState<GuidedAiOrigin | undefined>(saved?.aiOrigin),
    [aiBusy, setAiBusy] = useState(false),
    [dismissed, setDismissed] = useState(saved?.dismissed ?? '')
  const [publishConfirmed, setPublishConfirmed] = useState(false)
  const targetsFor = (id: string) =>
    service.publicationTargets ? service.publicationTargets(id) : service.targets(id)
  const [setupOrigin, setSetupOrigin] = useState<GuidedSetupAiOrigin | undefined>(
      saved?.setupOrigin,
    ),
    [setupBusy, setSetupBusy] = useState(false)
  const [resumeId, setResumeId] = useState(() =>
      saved?.selected || recovery.request ? null : (selection.initial?.templateId ?? null),
    ),
    [restoring, setRestoring] = useState(() =>
      Boolean(!saved?.selected && !recovery.request && selection.initial?.templateId),
    ),
    [resumeError, setResumeError] = useState('')
  const alive = useRef(true),
    writing = useRef(false),
    generation = useRef(0),
    selectionGeneration = useRef(0)
  const template = selected?.template,
    response = selected?.response,
    editable = Boolean(template?.canManage && template.state === 'draft'),
    dirty = Boolean(
      template &&
        (title !== template.title ||
          canonical(questions) !== canonical(template.mapping?.questions ?? []) ||
          canonical(input) !== canonical(response?.answers ?? {})),
    ),
    locked = busy || Boolean(pending) || aiBusy || setupBusy || restoring,
    navigationLocked =
      busy || aiBusy || setupBusy || restoring || (!folded && (dirty || Boolean(pending)))
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      generation.current++
      selectionGeneration.current++
    }
  }, [service])
  useEffect(() => {
    onNavigationLockChange?.(navigationLocked)
    return () => onNavigationLockChange?.(false)
  }, [navigationLocked, onNavigationLockChange])
  // 선택한 문서를 열었다 돌아와도 아직 올리지 않은 양식 이름을 같은 학교·현재 탭에 보관한다.
  useEffect(() => {
    memory.save(
      dirty || pending || aiOrigin || setupOrigin
        ? {
            selected,
            title,
            questions,
            input,
            pending,
            folded,
            aiOrigin,
            dismissed,
            uploadTitle,
            setupOrigin,
          }
        : dismissed || uploadTitle
          ? {
              selected: null,
              title: '',
              questions: [],
              input: {},
              pending: null,
              folded: false,
              dismissed,
              uploadTitle,
            }
          : undefined,
      dirty || Boolean(pending) || Boolean(uploadTitle),
    )
  }, [
    selected,
    title,
    questions,
    input,
    pending,
    folded,
    dirty,
    aiOrigin,
    dismissed,
    uploadTitle,
    setupOrigin,
    memory,
  ])
  function fail(error: unknown, load = false) {
    if (!alive.current) return
    const problem = errorOf(error)
    ;(load ? setLoadError : setError)(problem.message)
    if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP'].includes(problem.code)) {
      setDenied(true)
      setSelected(null)
      setInput({})
      setQuestions([])
      setPending(null)
      recovery.remove()
      memory.remove()
      selection.remove()
      setResumeId(null)
      selectionGeneration.current++
      setRestoring(false)
      setBusy(false)
      setItems([])
    }
    if (problem.code === 'CANCELLED') {
      setItems([])
    }
  }
  async function load(more = false) {
    const current = ++generation.current
    setLoading(true)
    setLoadError('')
    try {
      const result = await service.list(member.id, more ? cursor : null)
      if (!alive.current || current !== generation.current) return
      setItems((previous) =>
        more
          ? [...new Map([...previous, ...result.items].map((t) => [t.id, t])).values()]
          : result.items,
      )
      setCursor(result.nextCursor)
      setCanCreate(result.canCreate)
      setDenied(false)
    } catch (error) {
      if (current === generation.current) fail(error, true)
    } finally {
      if (alive.current && current === generation.current) setLoading(false)
    }
  }
  useEffect(() => {
    if (activeAt(member, date)) void load()
    else setDenied(true)
    return () => {
      generation.current++
    }
  }, [service, revision, date])
  function useDetail(value: TemplateDetail) {
    setPublishConfirmed(false)
    setSelected(value)
    setItems((previous) =>
      previous.map((item) => (item.id === value.template.id ? value.template : item)),
    )
    setTitle(value.template.title)
    setQuestions(value.template.mapping?.questions ?? [])
    setInput(value.response?.answers ?? {})
    setReviewed(false)
    setDownloaded(false)
    setConflict(false)
    setTarget(value.template.collectionRequestId ?? '')
    setTargets([])
    selection.save({ templateId: value.template.id }, false)
    setResumeId(null)
    setResumeError('')
  }
  // 저장한 본문·파일은 캐시로 되살리지 않고, 원래 양식 번호만 같은 학교 범위에 기억한다.
  async function restoreSelection() {
    if (!resumeId || writing.current) return
    const current = ++selectionGeneration.current
    setRestoring(true)
    setBusy(true)
    setError('')
    setResumeError('')
    try {
      const value = await service.get(member.id, resumeId)
      if (!alive.current || current !== selectionGeneration.current) return
      useDetail(value)
      setFolded(false)
      if (value.template.canManage) {
        try {
          const choices = await targetsFor(member.id)
          if (alive.current && current === selectionGeneration.current) setTargets(choices)
        } catch (error) {
          fail(error)
        }
      }
    } catch (error) {
      if (!alive.current || current !== selectionGeneration.current) return
      const problem = errorOf(error)
      setResumeError(problem.message)
      if (['NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CANCELLED'].includes(problem.code)) {
        selection.remove()
        setResumeId(null)
        if (['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CANCELLED'].includes(problem.code)) fail(problem)
      }
    } finally {
      if (alive.current && current === selectionGeneration.current) {
        setRestoring(false)
        setBusy(false)
      }
    }
  }
  useEffect(() => {
    if (resumeId && activeAt(member, date)) void restoreSelection()
    else setRestoring(false)
  }, [service])
  async function open(item: Template, replace = false) {
    if (locked || (dirty && !replace)) return
    setBusy(true)
    setError('')
    try {
      const value = await service.get(member.id, item.id)
      if (!alive.current) return
      useDetail(value)
      if (value.template.canManage) {
        try {
          const choices = await targetsFor(member.id)
          if (alive.current) setTargets(choices)
        } catch (error) {
          fail(error)
        }
      }
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  async function execute(next: Pending, retry = false) {
    if (writing.current || denied) return
    writing.current = true
    setBusy(true)
    setError('')
    setNotice('')
    setPending(next)
    recovery.put({ key: next.key, command: next })
    try {
      let templateId: string
      if (next.kind === 'upload') {
        const replayOnly = retry && Boolean(loadError),
          reserved = await service.prepare(member.id, next.file, next.title, next.key, replayOnly)
        if (replayOnly) {
          await service.recoverOperation(member.id, {
            action: 'inspect',
            templateId: reserved.templateId,
            templateVersion: reserved.templateVersion,
            responseId: null,
            responseVersion: null,
            requestKey: next.inspectKey,
          })
        } else {
          if (!reserved.uploaded) await service.upload(member.id, reserved.templateId, next.file)
          await service.inspect(
            member.id,
            reserved.templateId,
            reserved.templateVersion,
            next.inspectKey,
          )
        }
        templateId = reserved.templateId
      } else if (next.kind === 'render') {
        if (retry && loadError)
          await service.recoverOperation(member.id, {
            action: 'render',
            templateId: next.templateId,
            templateVersion: next.templateVersion,
            responseId: next.responseId,
            responseVersion: next.responseVersion,
            requestKey: next.key,
          })
        else
          await service.render(
            member.id,
            next.templateId,
            next.templateVersion,
            next.responseId,
            next.responseVersion,
            next.key,
          )
        templateId = next.templateId
      } else {
        const receipt =
          retry && loadError
            ? await service.recover(member.id, next.command, next.key)
            : await service.mutate(member.id, next.command, next.key)
        templateId = receipt.templateId
      }
      if (!alive.current) return
      setPending(null)
      recovery.remove(next.key)
      if (next.kind === 'upload') setUploadTitle('')
      setNotice(
        next.kind === 'upload'
          ? '양식의 실제 문단을 읽었습니다. 질문과 채울 칸을 직접 확인해 주세요.'
          : next.kind === 'render'
            ? '확인한 칸만 채운 HWPX를 생성했습니다. 파일을 내려받아 확인해 주세요.'
            : '저장을 확인했습니다. 파일 제출은 별도 수합 화면에서 최종 확인합니다.',
      )
      // 내 답변 저장이 확정되면 이전 답변판의 AI 비교를 마친다. 미상·실패 때에는 그대로 보관한다.
      if (
        next.kind === 'command' &&
        next.command.kind === 'save_answers' &&
        aiSuggestion?.origin.templateId === next.command.templateId
      ) {
        setDismissed(aiSuggestion.requestId)
        setAiOrigin(undefined)
      }
      try {
        const value = await service.get(member.id, templateId)
        if (alive.current) {
          useDetail(value)
          if (value.template.canManage)
            try {
              const choices = await targetsFor(member.id)
              if (alive.current) setTargets(choices)
            } catch {
              if (alive.current) {
                setTargets([])
                setError('저장은 확인했습니다. 연결할 수합 목록은 다시 열어 확인해 주세요.')
              }
            }
        }
      } catch {
        if (alive.current) setNotice('처리는 확인했습니다. 목록에서 원본을 다시 열어 주세요.')
      }
      void load()
    } catch (error) {
      if (!alive.current) return
      const problem = errorOf(error)
      if (
        ['INVALID_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'CONFLICT'].includes(
          problem.code,
        )
      ) {
        setPending(null)
        recovery.remove(next.key)
      }
      if (problem.code === 'CONFLICT') setConflict(true)
      fail(problem)
    } finally {
      writing.current = false
      if (alive.current) setBusy(false)
    }
  }
  const command = (value: GuidedCommand) =>
    void execute({ kind: 'command', command: value, key: `guided-${crypto.randomUUID()}` })
  function saveMapping() {
    try {
      if (!template?.inspection) return
      const mapped = questionMapping(template.inspection, questions)
      command({
        kind: 'save_mapping',
        templateId: template.id,
        expectedVersion: template.version,
        title,
        mapping: mapped,
      })
    } catch (error) {
      fail(error)
    }
  }
  function saveAnswers() {
    try {
      if (!template?.mapping) return
      const checked = answers(template.mapping, input, false)
      command({
        kind: 'save_answers',
        templateId: template.id,
        templateVersion: template.version,
        responseId: response?.id ?? null,
        expectedVersion: response?.version ?? 0,
        answers: checked,
        preview: editable,
      })
    } catch (error) {
      fail(error)
    }
  }
  function render() {
    try {
      if (!template?.mapping || !response) return
      answers(template.mapping, input, true)
      if (canonical(input) !== canonical(response.answers)) throw new ServiceError('CONFLICT')
      void execute({
        kind: 'render',
        key: `render-${crypto.randomUUID()}`,
        templateId: template.id,
        templateVersion: template.version,
        responseId: response.id,
        responseVersion: response.version,
      })
    } catch (error) {
      fail(error)
    }
  }
  async function download(result: Artifact, handoff = false) {
    if (!template) return
    setBusy(true)
    setError('')
    try {
      const blob = await service.download(member.id, result.artifactId)
      if (!alive.current) return
      const fileName = safeDownloadName(`${template.title}.hwpx`)
      if (handoff && template.collectionRequestId && onUseGenerated) {
        setFolded(true)
        onUseGenerated({
          requestId: template.collectionRequestId,
          artifactId: result.artifactId,
          templateId: template.id,
          templateVersion: template.version,
          blob,
          fileName,
        })
      } else {
        requestBlobDownload(blob, fileName)
        setDownloaded(true)
        setNotice('생성 파일 내려받기를 요청했습니다. 한글에서 칸 배치와 내용을 확인해 주세요.')
      }
    } catch (error) {
      fail(error)
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  function addQuestion(anchorId: string) {
    if (!template?.inspection) return
    const anchor = template.inspection.anchors.find((a) => a.id === anchorId)
    if (
      !anchor ||
      questions.length >= GUIDED_LIMITS.maxQuestions ||
      questions.some((q) => q.anchorId === anchorId)
    )
      return
    setQuestions((value) => [
      ...value,
      {
        id: `q-${crypto.randomUUID()}`,
        label: '',
        kind: 'text',
        required: true,
        maxLength: 500,
        options: [],
        anchorId,
        sourceText: anchor.sourceText,
        sourceHash: anchor.sourceHash,
      },
    ])
    setReviewed(false)
  }
  const changeQuestion = (index: number, patch: Partial<Question>) => {
    setQuestions((value) => value.map((q, i) => (i === index ? { ...q, ...patch } : q)))
    setReviewed(false)
  }
  function requestSetupHelp(next: GuidedSetupAiRequest) {
    if (!onRequestGuidedSetupAi || !selected) return
    memory.save(
      {
        selected,
        title,
        questions,
        input,
        pending,
        folded: true,
        aiOrigin,
        dismissed,
        uploadTitle,
        setupOrigin: next.origin,
      },
      dirty || Boolean(uploadTitle),
    )
    onRequestGuidedSetupAi(next)
    setSetupOrigin(next.origin)
    setFolded(true)
  }
  useEffect(() => {
    if (
      setupAiSuggestion &&
      setupOrigin?.id === setupAiSuggestion.origin.id &&
      template?.id === setupOrigin.templateId
    )
      setFolded(false)
  }, [setupAiSuggestion?.requestId, setupOrigin?.id, template?.id])
  function requestHelp() {
    if (locked || loading || loadError || denied || !selected || !template?.mapping) return
    try {
      const next = makeGuidedAiRequest(member, selected, input, `guided-ai-${crypto.randomUUID()}`)
      setAiOrigin(next.origin)
      setDismissed('')
      setFolded(true)
      memory.save(
        {
          selected,
          title,
          questions,
          input,
          pending,
          folded: true,
          aiOrigin: next.origin,
          uploadTitle,
        },
        dirty || Boolean(uploadTitle),
      )
      if (onRequestGuidedAi) onRequestGuidedAi(next)
      else onRequestAi?.(next.request)
    } catch {
      setError('질문과 답변의 형식·길이를 확인해 주세요. 현재 답변은 유지했습니다.')
    }
  }
  const workflowRoot = useRef<HTMLElement>(null)
  const mapDirty = Boolean(
      template &&
        (title !== template.title ||
          canonical(questions) !== canonical(template.mapping?.questions ?? [])),
    ),
    answerDirty = canonical(input) !== canonical(response?.answers ?? {}),
    currentArtifact = !mapDirty && !answerDirty ? response?.artifact : null
  const steps = [
    ...(editable
      ? [{ id: 'mapping', label: '질문 연결', available: Boolean(template?.inspection) }]
      : []),
    { id: 'answers', label: '답변 작성', available: Boolean(template?.mapping) },
    { id: 'file', label: '파일 확인', available: Boolean(currentArtifact) },
    {
      id: 'connect',
      label: editable ? '수합에 게시' : '수합에 첨부',
      available: Boolean(currentArtifact && (editable || template?.collectionRequestId)),
    },
  ]
  const currentStep =
    editable && (!template?.mapping || mapDirty)
      ? 'mapping'
      : !response || answerDirty || !currentArtifact
        ? 'answers'
        : !reviewed
          ? 'file'
          : 'connect'
  const nextHint = pending
    ? busy
      ? '문서 요청을 처리하고 있습니다. 잠시 기다려 주세요.'
      : '이전 요청의 결과를 먼저 확인해 주세요.'
    : conflict
      ? '보관한 입력과 최신 원본을 먼저 확인해 주세요.'
      : currentStep === 'mapping'
        ? '원본 위치와 질문을 연결하고 저장해 주세요.'
        : currentStep === 'answers'
          ? !response || answerDirty
            ? '필요한 내용을 답하고 임시 저장해 주세요.'
            : '저장한 답변으로 HWPX를 생성해 주세요.'
          : !reviewed
            ? '파일을 내려받아 내용과 칸 배치를 확인해 주세요.'
            : editable
              ? '수합 요청을 선택한 뒤 확인한 양식을 게시해 주세요.'
              : '확인한 파일을 수합에 첨부하고, 수합 화면에서 최종 제출해 주세요.'
  // 단계 이동은 초점을 옮길 뿐 입력·요청 번호·저장 상태를 바꾸지 않는다.
  function moveToStep(step: string) {
    const section = workflowRoot.current?.querySelector<HTMLElement>(
      `[data-document-step="${step}"]`,
    )
    section?.focus({ preventScroll: true })
    section?.scrollIntoView({ block: 'start', behavior: 'auto' })
  }

  return {
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
  }
}
