import type { EventDraft, Membership } from '../contracts'
import { ContractError } from '../contracts'
import { activeAt } from '../domain'
import type { RelationOptions } from './contracts'

export type AssistantAudienceDecisions = Record<string, string | null>
const normalized = (name: string) => name.trim().replace(/\s+/g, '').toLocaleLowerCase()
export function assistantAudienceCandidates(query: string, members: Membership[], member: Membership, date: string) {
  const name = normalized(query)
  return name ? members.filter(item => item.schoolId === member.schoolId && activeAt(item, date) && normalized(item.name).includes(name)) : []
}

// 후보 선택 버튼을 누른 뒤에만 기존 일정의 관련 대상·공유 설정을 바꾼다.
export function selectAssistantAudience(draft: EventDraft, query: string, selectedId: string, members: Membership[], member: Membership, date: string): EventDraft {
  const chosen = assistantAudienceCandidates(query, members, member, date).find(item => item.id === selectedId)
  if (!chosen) throw new ContractError('INVALID_INPUT', '현재 학교에서 이 교사 후보를 확인하지 못했습니다. 다시 선택해 주세요.')
  return { ...draft, visibility: 'audience', audience: { ...draft.audience,
    includeMemberIds: [...new Set([...draft.audience.includeMemberIds, chosen.id])],
    excludeMemberIds: draft.audience.excludeMemberIds.filter(id => id !== chosen.id),
  } }
}

export function AssistantAudienceCandidates({ queries, decisions, members, member, date, relations, onChoose }: {
  queries: string[]; decisions: AssistantAudienceDecisions; members: Membership[]; member: Membership; date: string;
  relations: RelationOptions; onChoose: (query: string, id: string | null) => void
}) {
  if (!queries.length) return null
  return <section className="notice-box" aria-label="대화에서 요청한 일정 대상"><h4>말씀하신 교사를 선택해 주세요</h4>
    <p>이름만으로 자동 배정하지 않습니다. 선택하면 해당 교사를 포함한 관련 대상에게 공개됩니다.</p>
    {queries.map(query => {
      const candidates = assistantAudienceCandidates(query, members, member, date)
      const decided = Object.prototype.hasOwnProperty.call(decisions, query)
      return <div key={query}><strong>{query}</strong>{decided && <span>{decisions[query] === null ? ' · 이번 일정에서 제외' : ' · 선택함'}</span>}
        {candidates.length ? <div className="button-row">{candidates.map(item => {
          const labels = [...item.departmentIds.map(id => relations.departmentIds.find(row => row.id === id)?.name),
            ...item.subjectIds.map(id => relations.subjectIds.find(row => row.id === id)?.name)].filter(Boolean)
          return <button key={item.id} type="button" className="secondary small" aria-pressed={decisions[query] === item.id}
            onClick={() => onChoose(query, item.id)}>{item.name}{labels.length ? ' · ' + labels.join(' · ') : ''} · 대상에 포함</button>
        })}</div> : <p>현재 연결된 학교에서 후보를 찾지 못했습니다. 아래 대상 설정에서 확인하거나 이번 일정에서 제외해 주세요.</p>}
        <button type="button" className="text-button" aria-pressed={decided && decisions[query] === null} onClick={() => onChoose(query, null)}>‘{query}’ 대상 요청 제외</button>
      </div>
    })}
  </section>
}
