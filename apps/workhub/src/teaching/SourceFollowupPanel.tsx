import { useEffect, useRef, useState } from 'react'
import type { CourseSnapshot, TeachingAdapter, TeachingScope } from './contracts'
import { TeachingError } from './contracts'
import { findSourceFollowup, type SourceFollowup } from './source-followup'

const BATCH_SIZE = 10
type Checked = { studentId: string; target: SourceFollowup | null; error?: string }
export function SourceFollowupPanel({ adapter, scope, course, disabled, onOpen, onClose }: {
  adapter: TeachingAdapter; scope: TeachingScope; course: CourseSnapshot; disabled: boolean
  onOpen: (target: SourceFollowup) => void; onClose: () => void
}) {
  const [checked, setChecked] = useState<Checked[]>([]), [busy, setBusy] = useState(false)
  const generation = useRef(0), running = useRef(false)
  const current = useRef({ course, disabled }); current.current = { course, disabled }
  useEffect(() => () => { generation.current++ }, [])
  useEffect(() => { generation.current++; running.current = false; setBusy(false); setChecked([]) }, [course])
  useEffect(() => { if (disabled) { generation.current++; running.current = false; setBusy(false) } }, [disabled])
  const remaining = course.students.filter(s => !checked.some(c => c.studentId === s.id))
  const failed = checked.filter(c => c.error), targets = checked.filter(c => c.target)
  async function scan(retry = false) {
    if (running.current || disabled) return
    const ids = retry ? new Set(failed.map(c => c.studentId)) : new Set(remaining.map(s => s.id))
    const batch = course.students.filter(s => ids.has(s.id)).slice(0, BATCH_SIZE)
    if (!batch.length) return
    const version = ++generation.current
    const valid = () => generation.current === version && current.current.course === course && !current.current.disabled
    running.current = true; setBusy(true)
    try {
      for (const student of batch) {
        if (!valid()) return
        let result: Checked
        try { result = { studentId: student.id, target: await findSourceFollowup(adapter, scope, course, student, valid) } }
        catch (error) {
          if (!valid()) return
          result = { studentId: student.id, target: null, error: error instanceof Error ? error.message : '기록을 확인하지 못했습니다.' }
          if (error instanceof TeachingError && ['FORBIDDEN', 'CANCELLED'].includes(error.code)) {
            setChecked([result]); return
          }
        }
        if (!valid()) return
        setChecked(previous => [...previous.filter(c => c.studentId !== student.id), result])
      }
    } finally { if (generation.current === version) { running.current = false; setBusy(false) } }
  }
  function stop() { generation.current++; running.current = false; setBusy(false) }
  return <section className="teaching-card" aria-label="학생 기록 근거 확인">
    <h3>근거가 바뀐 관찰 기록</h3>
    <p>이 수업에서 내가 쓴 관찰 중 재검토 표시가 있는 학생을 찾습니다. 상담은 열지 않습니다.</p>
    <p role="status">{course.students.length}명 중 {checked.length - failed.length}명 확인 · 재검토 학생 {targets.length}명{failed.length ? ` · 확인 실패 ${failed.length}명` : ''}{busy ? ' · 확인 중…' : ''}</p>
    {!remaining.length && !failed.length && !busy && !targets.length && <p>현재 명부에서 재검토할 관찰 기록을 찾지 못했습니다.</p>}
    <ul>{targets.map(({ target }) => {
      const student = course.students.find(s => s.id === target!.studentId)!
      return <li key={student.id}><button type="button" className="secondary" disabled={disabled || busy} onClick={() => onOpen(target!)}>
        {student.name} · {student.grade}학년 {student.classLabel}반 {student.seatNumber}번 · {target!.occurredOn} 기록 열기
      </button></li>
    })}</ul>
    {failed.length > 0 && <details><summary>확인하지 못한 학생 {failed.length}명</summary><ul>{failed.map(item => <li key={item.studentId}>{course.students.find(s => s.id === item.studentId)?.name} · {item.error}</li>)}</ul></details>}
    <div className="teaching-actions">
      {busy ? <button type="button" className="secondary" onClick={stop}>확인 중단</button> : <>
        {remaining.length > 0 && <button type="button" disabled={disabled} onClick={() => void scan()}>{checked.length ? '다음' : '처음'} {Math.min(BATCH_SIZE, remaining.length)}명 확인</button>}
        {failed.length > 0 && <button type="button" className="secondary" disabled={disabled} onClick={() => void scan(true)}>실패한 학생 다시 확인</button>}
      </>}
      <button type="button" className="secondary" disabled={disabled} onClick={() => { stop(); onClose() }}>근거 확인 닫기</button>
    </div>
    <small>재검토가 필요한 학생당 첫 관찰을 표시합니다. 수업 자료가 새로 조회되면 확인 목록도 새로 확인합니다.</small>
  </section>
}
