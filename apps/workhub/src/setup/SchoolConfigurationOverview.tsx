import { useState } from 'react'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import type { SchoolAdminSnapshot } from './school-admin-contract'

const groups = [{ key: 'terms', label: '학기' }, { key: 'classes', label: '학급' }, { key: 'subjects', label: '교과' }, { key: 'departments', label: '부서' }] as const
type Group = typeof groups[number]['key']

/** 조회 목록만 좁힌다. 구성 수정·저장은 기존 편집과 확인 절차에서 처리한다. */
export function SchoolConfigurationOverview({ snapshot }: { snapshot: SchoolAdminSnapshot }) {
  const [group, setGroup] = useState<Group>('terms'), [query, setQuery] = useState(''), [page, setPage] = useState(0)
  const { configuration: c, subjects } = snapshot
  const rows: Record<Group, { id: string; label: string; detail: string }[]> = {
    terms: c.terms.map(r => ({ id: r.id, label: r.name, detail: `${r.startsOn} ~ ${r.lastDay}` })),
    classes: c.classes.map(r => ({ id: r.id, label: r.name, detail: `${r.grade}학년${r.classNo ? ` · ${r.classNo}반` : ''}` })),
    subjects: subjects.map(r => ({ id: r.id, label: r.name, detail: '' })),
    departments: c.departments.map(r => ({ id: r.id, label: r.name, detail: '' })),
  }
  const label = groups.find(g => g.key === group)!.label
  const needle = query.trim().toLocaleLowerCase('ko-KR')
  const matching = rows[group].filter(r => `${r.label} ${r.detail} ${r.id}`.toLocaleLowerCase('ko-KR').includes(needle))
  const window = listWindow(matching, page)
  return <section className="school-configuration-overview" aria-label="등록한 학교 구성">
    <div className="school-configuration-counts" role="group" aria-label="구성 목록 선택">
      {groups.map(g => <button type="button" key={g.key} aria-pressed={group === g.key} aria-label={`${g.label} ${rows[g.key].length}개 보기`} onClick={() => { setGroup(g.key); setQuery(''); setPage(0) }}><span>{g.label}</span><strong>{rows[g.key].length}<small>개</small></strong></button>)}
    </div>
    <div className="school-configuration-list-heading"><h3>{label} 목록</h3><label className="setup-field"><span>{label} 찾기</span><input type="search" value={query} onChange={e => { setQuery(e.target.value); setPage(0) }} placeholder="이름 또는 식별 번호" /></label></div>
    <p className="school-records-muted" role="status">{query ? `검색 결과 ${matching.length}개 · 전체 ${rows[group].length}개` : `등록된 ${label} ${rows[group].length}개`}</p>
    {window.items.length ? <ul className="school-configuration-items">{window.items.map(r => <li key={r.id}><strong>{r.label}</strong>{r.detail && <span>{r.detail}</span>}</li>)}</ul> : <p className="setup-empty">{query ? '검색 조건에 맞는 항목이 없습니다.' : `등록된 ${label} 항목이 없습니다.`}</p>}
    <ListPagination label={`${label} 조회 목록 페이지`} window={window} onPageChange={setPage} />
  </section>
}
