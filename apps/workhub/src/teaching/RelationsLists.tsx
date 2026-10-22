import { useEffect, useId, useRef, useState } from 'react'
import { ListPagination } from '../app/ListPagination'
import { listWindow } from '../app/list-window'
import type { RelationIntentKind, RelationsSnapshot, TeachingRelation } from './relations-contracts'
import { filterAssignments, filterRelationStudents, relationStatus, RELATION_STATUS_LABELS, type RelationStatusFilter } from './relations-list'
import styles from './relations-list.css?inline'

export function RelationsLists({ snapshot, disabled, editing, stale, onBegin, focusStudentId }: {
  focusStudentId?:string; snapshot: RelationsSnapshot; disabled: boolean; editing: boolean; stale: boolean
  onBegin: (kind: RelationIntentKind, relation: TeachingRelation) => void
}) {
  const id = useId(), teacherHeading = useRef<HTMLHeadingElement>(null), studentHeading = useRef<HTMLHeadingElement>(null)
  const [teacherQuery, setTeacherQuery] = useState(''), [studentQuery, setStudentQuery] = useState('')
  const [teacherStatus, setTeacherStatus] = useState<RelationStatusFilter>('all'), [studentStatus, setStudentStatus] = useState<RelationStatusFilter>('all')
  const [teacherPage, setTeacherPage] = useState(0), [studentPage, setStudentPage] = useState(0)
  const teachers = filterAssignments(snapshot.assignments, snapshot.basisDate, teacherQuery, teacherStatus)
  const students = filterRelationStudents(focusStudentId?snapshot.students.filter(s=>s.studentId===focusStudentId):snapshot.students, snapshot.basisDate, studentQuery, studentStatus)
  const teacherWindow = listWindow(teachers, teacherPage), studentWindow = listWindow(students, studentPage)
  useEffect(() => { if (teacherPage !== teacherWindow.page) setTeacherPage(teacherWindow.page) }, [teacherPage, teacherWindow.page])
  useEffect(() => { if (studentPage !== studentWindow.page) setStudentPage(studentWindow.page) }, [studentPage, studentWindow.page])
  const manageable = (r: TeachingRelation) => Boolean(r.effectiveThrough && r.effectiveThrough > snapshot.basisDate && r.effectiveThrough > r.validFrom)
  const options = Object.entries(RELATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)
  const statusLabel = (r: TeachingRelation) => RELATION_STATUS_LABELS[relationStatus(r, snapshot.basisDate)]
  return <div className="relation-lists">
    <style>{styles}</style>
    <p className="relation-list-help">현재 조회된 수업 관계에서 찾습니다. 학생 상태는 이 수업의 수강 기준이며, 학적 상태는 따로 표시합니다.</p>
    {!focusStudentId&&<details open={!editing || stale}>
      <summary>교사 담당 {snapshot.assignments.length}건</summary>
      <h4 ref={teacherHeading} tabIndex={-1}>교사 담당 찾기</h4>
      <div className="relation-list-filters">
        <label htmlFor={`${id}-teacher-query`}>담당 교사 이름 검색<input id={`${id}-teacher-query`} type="search" value={teacherQuery} disabled={disabled} onChange={e => { setTeacherQuery(e.target.value); setTeacherPage(0) }}/></label>
        <label htmlFor={`${id}-teacher-status`}>담당 상태<select id={`${id}-teacher-status`} aria-label="담당 상태" value={teacherStatus} disabled={disabled} onChange={e => { setTeacherStatus(e.target.value as RelationStatusFilter); setTeacherPage(0) }}>{options}</select></label>
        <button type="button" className="secondary" disabled={disabled || (!teacherQuery && teacherStatus === 'all')} onClick={() => { setTeacherQuery(''); setTeacherStatus('all'); setTeacherPage(0) }}>교사 검색 초기화</button>
      </div>
      <p role="status" aria-atomic="true">교사 담당 전체 {snapshot.assignments.length}건 · 검색 결과 {teachers.length}건 · {teacherWindow.start}–{teacherWindow.end}건 표시</p>
      <div className="relation-list-items" aria-label="교사 담당 검색 결과">{teacherWindow.items.map(r => <article key={r.id}>
        <h4>{r.label}</h4><span className="relation-list-state">{statusLabel(r)}</span>
        <p>{r.validFrom} ~ {r.effectiveThrough ?? '시작 전 취소'} · 관계 {r.version}판</p>
        {snapshot.capabilities.manageAssignments && <div className="teaching-actions">
          <button type="button" className="secondary" disabled={disabled || editing || !manageable(r)} onClick={() => onBegin('assignment_replace', r)}>담당 교체 · {r.label}</button>
          <button type="button" className="secondary" disabled={disabled || editing || !manageable(r)} onClick={() => onBegin('assignment_end', r)}>담당 종료 · {r.label}</button>
        </div>}
      </article>)}</div>
      {!teachers.length && <p>{snapshot.assignments.length ? '검색 조건에 맞는 담당 교사가 없습니다.' : '등록된 담당 관계가 없습니다.'}</p>}
      <ListPagination label="교사 담당 검색 결과 페이지" window={teacherWindow} disabled={disabled} onPageChange={page => { setTeacherPage(page); teacherHeading.current?.focus() }}/>
    </details>}
    <details open={!editing || stale}>
      <summary>학생 수강 {snapshot.students.length}명</summary>
      <h4 ref={studentHeading} tabIndex={-1}>학생 수강 찾기</h4>
      <div className="relation-list-filters">
        <label htmlFor={`${id}-student-query`}>수강 학생 이름 검색<input id={`${id}-student-query`} type="search" value={studentQuery} disabled={disabled} onChange={e => { setStudentQuery(e.target.value); setStudentPage(0) }}/></label>
        <label htmlFor={`${id}-student-status`}>수강 상태<select id={`${id}-student-status`} aria-label="수강 상태" value={studentStatus} disabled={disabled} onChange={e => { setStudentStatus(e.target.value as RelationStatusFilter); setStudentPage(0) }}>{options}</select></label>
        <button type="button" className="secondary" disabled={disabled || (!studentQuery && studentStatus === 'all')} onClick={() => { setStudentQuery(''); setStudentStatus('all'); setStudentPage(0) }}>학생 검색 초기화</button>
      </div>
      <p role="status" aria-atomic="true">학생 수강 전체 {snapshot.students.length}명 · 검색 결과 {students.length}명 · {studentWindow.start}–{studentWindow.end}명 표시</p>
      <div className="relation-list-items" aria-label="학생 수강 검색 결과">{studentWindow.items.map(s => <article key={s.studentId}>
        <h4>{s.name}{focusStudentId&&` · 학생 ID ${s.studentId}`}</h4><span className="relation-list-state">수강: {statusLabel(s.membership)} · 학적: {statusLabel(s.enrollment)}</span>
        <p>수강 {s.membership.validFrom} ~ {s.membership.effectiveThrough ?? '시작 전 취소'} · 관계 {s.membership.version}판</p>
        <div className="teaching-actions">
          {snapshot.capabilities.endMemberships && <button type="button" className="secondary" disabled={disabled || editing || !manageable(s.membership)} onClick={() => onBegin('membership_end', s.membership)}>수강 종료 · {s.name}</button>}
          {!focusStudentId && snapshot.capabilities.transferStudents && <button type="button" className="secondary" disabled={disabled || editing || !manageable(s.enrollment)} onClick={() => onBegin('student_transfer_out', s.enrollment)}>전출 처리 · {s.name}</button>}
        </div>
      </article>)}</div>
      {!students.length && <p>{snapshot.students.length ? '검색 조건에 맞는 학생이 없습니다.' : '등록된 수강 관계가 없습니다.'}</p>}
      <ListPagination label="학생 수강 검색 결과 페이지" window={studentWindow} disabled={disabled} onPageChange={page => { setStudentPage(page); studentHeading.current?.focus() }}/>
    </details>
  </div>
}
