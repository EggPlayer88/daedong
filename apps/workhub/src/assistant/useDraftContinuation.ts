import { useEffect, useRef, useState, type RefObject } from 'react'
import { parseDraftReply, type DraftFollowup, type DraftPeople, type DraftPerson } from './draft-followup'
import type { DirectDraftCommand } from './draft-commands'
import type { AssistantWorkspaceActions, Session } from './workspace-model'

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
}
interface Matches {
  prompt: string
  people: DraftPeople & { limit: number }
  revision: number
}

// 본문·기한·명시 선택만 탭 초안에 보관한다. 검색 후보는 당시 화면에서만 사용한다.
export function useDraftContinuation({ session, latest, update, scope, basisDate, active, editable, revision,
  actions, feedback, opened }: Options) {
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
    update({ ...current, prompt: '', draftDialogue: { command, selected: [], scope, basisDate } })
    feedback('')
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
    const result = parseDraftReply(followup, current.prompt)
    if (result.kind === 'cancel') { cancelDraftFollowup(); return }
    clearMatches()
    if (result.kind === 'clarify') { feedback(result.message); return }
    const next: DraftFollowup = result.dueDate ? { ...followup, dueDate: result.dueDate } : followup
    update({ ...current, draftDialogue: next, prompt: result.query ? current.prompt : '' })
    feedback('')
    if (!result.query) return
    const controller = new AbortController()
    flight.current = controller
    setSearching(true)
    try {
      const people = await actions.findDraftPeople(next.command.kind, result.query, controller.signal)
      if (!controller.signal.aborted && latest.current?.prompt === current.prompt)
        setMatches({ prompt: current.prompt, people, revision })
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
    update({ ...current, prompt: '', draftDialogue: { ...followup, selected: [...followup.selected, person] } })
    clearMatches()
    feedback('')
  }
  function removeDraftPerson(id: string) {
    if (!editable || !latest.current || !followup || flight.current) return
    update({ ...latest.current, draftDialogue: { ...followup, selected: followup.selected.filter(person => person.memberId !== id) } })
    feedback('')
  }
  function dismissDraftPeople() {
    if (!editable || !latest.current || !followup) return
    clearMatches()
    update({ ...latest.current, prompt: '' })
    feedback('')
  }
  function openDraftForm() {
    if (!editable || !latest.current || !followup || latest.current.prompt.trim() || flight.current || visibleMatches) return
    if (!actions?.prepareDraft?.(followup.command, followup)) {
      feedback('작성 화면을 열 수 없습니다. 작성 중인 입력이나 확인할 요청을 마친 뒤 다시 시도해 주세요. 초안은 유지했습니다.')
      return
    }
    opened(followup.command)
  }
  return { draftFollowup: followup, draftPeople: visibleMatches?.people, draftSearching: searching,
    startDraftFollowup, selectDraftPerson, removeDraftPerson, cancelDraftFollowup, dismissDraftPeople, openDraftForm, reply }
}
