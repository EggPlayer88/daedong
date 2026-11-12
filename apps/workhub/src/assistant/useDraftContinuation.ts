import { useEffect, useRef, useState, type RefObject } from 'react'
import { parseDraftReply, type DraftFollowup, type DraftPeople, type DraftPerson } from './draft-followup'
import { validCollectionComposeText } from '../collections/compose-text'
import { validWorkspaceText } from './workspace-commands'
import type { DirectDraftCommand } from './draft-commands'
import type { AssistantWorkspaceActions, Session } from './workspace-model'
import type { WorkflowResultListener } from '../app/workflow-results'

interface Options {
  session: Session
  latest: RefObject<Session>
  update: (next: Session) => void
  scope: string
  basisDate: string
  active: boolean
  editable: boolean
  revision: number
  actions?: AssistantWorkspaceActions
  feedback: (error: string, notice?: string) => void
  opened: (command: DirectDraftCommand) => void
  resultListener?: (prompt: string, target: { kind: string; id: string }) => WorkflowResultListener | undefined
}
interface Matches {
  prompt: string
  people: DraftPeople & { limit: number }
  revision: number
}

// 본문·기한·명시 선택만 탭 초안에 보관한다. 검색 후보는 당시 화면에서만 사용한다.
export function useDraftContinuation({ session, latest, update, scope, basisDate, active, editable, revision,
  actions, feedback, opened, resultListener }: Options) {
  const [matches, setMatches] = useState<Matches>()
  const [searching, setSearching] = useState(false)
  const flight = useRef<AbortController>()
  const followup = active && session.draftDialogue?.scope === scope && session.draftDialogue.basisDate === basisDate
    ? session.draftDialogue : undefined
  const visibleMatches = followup && matches?.revision === revision && matches.prompt === session.prompt ? matches : undefined
  useEffect(() => {
    setMatches(undefined)
    setSearching(false)
    return () => { flight.current?.abort(); flight.current = undefined }
  }, [scope, basisDate, active, revision])
  function clearMatches() {
    flight.current?.abort()
    flight.current = undefined
    setSearching(false)
    setMatches(undefined)
  }
  function startDraftFollowup(command: DirectDraftCommand) {
    const current = latest.current
    if (!editable || !current || current.draftDialogue || !actions?.findDraftPeople ||
        current.prompt.trim() !== command.prompt.trim()) return
    clearMatches()
    const first = command.firstTurn
    const next: DraftFollowup = { command, selected: [], scope, basisDate, dueDate: first?.dueDate, pendingNames: first?.names }
    showNextCandidate(current, next)
  }
  function cancelDraftFollowup() {
    const current = latest.current
    if (!editable || !current || !followup) return
    clearMatches()
    update({ ...current, prompt: followup.command.prompt, draftDialogue: undefined })
    feedback('', '이어서 입력을 닫았습니다. 원래 초안은 입력란에 남아 있습니다.')
  }
  async function reply() {
    const current = latest.current
    if (!editable || !current || !followup || !actions?.findDraftPeople || flight.current) return
    const requestedName = followup.pendingNames?.[0]
    const result = requestedName && requestedName === current.prompt
      ? { kind: 'fields' as const, query: requestedName, dueDate: undefined } : parseDraftReply(followup, current.prompt)
    if (result.kind === 'cancel') { cancelDraftFollowup(); return }
    clearMatches()
    const command = followup.command
    if (!followup.pendingNames?.length && !(command.kind === 'messageDraft' ? command.body : command.title)) {
      const content = current.prompt.trim()
      if (!content || !validWorkspaceText(content) ||
          (command.kind === 'collectionDraft' && !validCollectionComposeText(content, command.instructions))) {
        feedback(command.kind === 'messageDraft' ? '메시지에 넣을 본문을 적어 주세요.' : '수합 제목을 한 줄로 적어 주세요.')
        return
      }
      const filled = command.kind === 'messageDraft' ? { ...command, body: content } : { ...command, title: content }
      update({ ...current, prompt: '', draftDialogue: { ...followup, command: filled } })
      feedback('')
      return
    }
    if (result.kind === 'clarify') { feedback(result.message); return }
    const next: DraftFollowup = result.dueDate ? { ...followup, dueDate: result.dueDate } : followup
    const query = result.query ?? next.pendingNames?.[0]
    const prompt = result.query ? current.prompt : query ?? ''
    update({ ...current, draftDialogue: next, prompt })
    feedback('')
    if (query) await search(next, query, prompt)
  }
  function showNextCandidate(current: Session, next: DraftFollowup) {
    const query = next.pendingNames?.[0] ?? ''
    update({ ...current, draftDialogue: next, prompt: query })
    feedback('')
    if (query) void search(next, query, query)
  }
  async function search(next: DraftFollowup, query: string, prompt: string) {
    if (!actions?.findDraftPeople) return
    const controller = new AbortController()
    flight.current = controller
    setSearching(true)
    try {
      const people = await actions.findDraftPeople(next.command.kind, query, controller.signal)
      if (!controller.signal.aborted && latest.current?.draftDialogue === next && latest.current.prompt === prompt)
        setMatches({ prompt, people, revision })
    } catch {
      if (!controller.signal.aborted) feedback('교사 목록을 확인하지 못했습니다. 입력을 유지했으니 다시 검색해 주세요.')
    } finally {
      if (flight.current === controller) {
        flight.current = undefined
        setSearching(false)
      }
    }
  }
  function selectDraftPerson(person: DraftPerson) {
    const current = latest.current, match = visibleMatches?.people
    if (!editable || !followup || !current || !match?.items.includes(person) || flight.current) return
    if (followup.selected.some(item => item.memberId === person.memberId)) {
      feedback('이미 선택한 교사입니다.'); return
    }
    if (followup.selected.length >= match.limit) {
      feedback(`교사는 최대 ${match.limit}명까지 선택할 수 있습니다.`); return
    }
    clearMatches()
    showNextCandidate(current, { ...followup, selected: [...followup.selected, person], pendingNames: followup.pendingNames?.slice(1) })
  }
  function removeDraftPerson(id: string) {
    if (!editable || !latest.current || !followup || flight.current) return
    update({ ...latest.current, draftDialogue: { ...followup, selected: followup.selected.filter(person => person.memberId !== id) } })
    feedback('')
  }
  function retryDraftName() {
    const current = latest.current, name = followup?.pendingNames?.[0]
    if (!editable || !current || !followup || !name || flight.current ||
        (current.prompt.trim() && current.prompt !== name)) return
    clearMatches()
    showNextCandidate(current, followup)
  }
  function dismissDraftPeople() {
    if (!editable || !latest.current || !followup) return
    clearMatches()
    showNextCandidate(latest.current, { ...followup, pendingNames: followup.pendingNames?.slice(1) })
  }
  function openDraftForm() {
    if (!editable || !latest.current || !followup || latest.current.prompt.trim() || flight.current || visibleMatches || followup.pendingNames?.length) return
    if (!(followup.command.kind === 'messageDraft' ? followup.command.body : followup.command.title)) return
    const composeId = crypto.randomUUID()
    if (!actions?.prepareDraft?.(followup.command, followup, resultListener?.(followup.command.prompt, {kind: 'compose', id: composeId}), composeId)) {
      feedback('작성 화면을 열 수 없습니다. 작성 중인 입력이나 확인할 요청을 마친 뒤 다시 시도해 주세요. 초안은 유지했습니다.')
      return
    }
    opened(followup.command)
  }
  return { draftFollowup: followup, draftPeople: visibleMatches?.people, draftSearching: searching,
    startDraftFollowup, selectDraftPerson, removeDraftPerson, cancelDraftFollowup, dismissDraftPeople, retryDraftName, openDraftForm, reply }
}
