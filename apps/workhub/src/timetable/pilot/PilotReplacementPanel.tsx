import { useEffect, useMemo, useRef, useState } from 'react'
import type { Membership } from '../../contracts'
import type { SupabaseConnection } from '../../connection/supabase-connection'
import { createSchoolRosterServer } from '../../setup/school-roster-server'
import { fingerprintPilotFixture, pilotDate, type PilotFixture } from './fixture'
import { createPilotRoster, createRegisteredTeacherDirectory, parseRegisteredTeacherCsv, previewRosterReplacement, commitRosterReplacement, rosterBindingsOn, exportPilotRosterCsv, rebasePilotRoster } from './roster'
import type { PilotRoster, RegisteredTeacherDirectory, RosterReplacementPreview } from './roster-contracts'
import { exportPilotTimetableCsv, previewTimetableReplacement, validateTimetableReplacementPreview, type TimetableReplacementPreview } from './timetable-replacement'
import type { PilotCommand, PilotState } from './operations'
import { downloadPilotText } from './download'

const message = (e: unknown) => e instanceof Error ? e.message : '자료를 확인하지 못했습니다.'
/** 복원·다른 탭 읽기로 여러 판이 바뀌어도 중간 기준판을 건너뛰지 않는다. */
export async function synchronizePilotRoster(previous: PilotFixture, current: PilotFixture, roster: PilotRoster, versions: PilotState['timetableVersions']): Promise<PilotRoster> {
  if (JSON.stringify(previous) === JSON.stringify(current)) return roster
  if (roster.version === 1 && roster.revisions[0].bindings.every(binding => binding.kind === 'virtual')) return createPilotRoster(current)
  let cursor = previous, result = roster
  const transitions = versions.filter(row => row.previousFixture.revision >= previous.revision && row.previousFixture.revision < current.revision)
  for (const [index, transition] of transitions.entries()) {
    const prior = { ...transition.previousFixture, schoolId: current.schoolId }
    const next = { ...(transitions[index + 1]?.previousFixture ?? current), schoolId: current.schoolId }
    if (JSON.stringify(prior) !== JSON.stringify(cursor)) throw new Error('중간 시간표 기준판이 일치하지 않습니다. 기존 연결 계획을 보관하고 현재 자료를 다시 확인해 주세요.')
    // 이미 반영된 시간표 이력을 따라가는 복원이다. 오늘 날짜로 과거 적용 이력을 막지 않는다.
    result = await rebasePilotRoster(cursor, next, result, transition.effectiveFrom, transition.effectiveFrom)
    cursor = next
  }
  if (JSON.stringify(cursor) !== JSON.stringify(current)) throw new Error('시간표 교체 이력을 모두 확인하지 못했습니다. 기존 교사 연결 계획은 보존했습니다.')
  return result
}
export function PilotReplacementPanel({ fixture, date, state, member, connection, canApply, execute, onNavigationLockChange }: {
  fixture: PilotFixture; date: string; state: PilotState; member?: Membership; connection?: SupabaseConnection; canApply: boolean
  execute: (command: PilotCommand) => Promise<boolean>; onNavigationLockChange?: (locked: boolean) => void
}) {
  // 실제 학교 후보를 연습 학교로 바꿔 위장하지 않고, 연결 계획 자체를 현재 학교에 한정한다.
  const fixtureKey = JSON.stringify(fixture)
  const mappingFixture = useMemo(() => ({ ...fixture, schoolId: member?.schoolId ?? fixture.schoolId }), [fixtureKey, member?.schoolId])
  const [roster, setRoster] = useState<PilotRoster>(), [directory, setDirectory] = useState<RegisteredTeacherDirectory>()
  const [assignments, setAssignments] = useState<Record<string, string>>({}), [effectiveFrom, setEffectiveFrom] = useState(date)
  const [preview, setPreview] = useState<RosterReplacementPreview>(), [tablePreview, setTablePreview] = useState<TimetableReplacementPreview>()
  const [csv, setCsv] = useState(''), [tableReason, setTableReason] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [teacherConfirmed, setTeacherConfirmed] = useState(false), [tableConfirmed, setTableConfirmed] = useState(false)
  const [rosterSourceKey, setRosterSourceKey] = useState('')
  const mappingKey = JSON.stringify(mappingFixture)
  const life = useRef(0)
  useEffect(() => () => { life.current++ }, [])
  const running = useRef(false), rosterRef = useRef(roster), previousFixture = useRef(mappingFixture)
  const pendingRebase = useRef<{ key: string; roster: PilotRoster }>()
  const context = useRef({ mappingKey, fixtureKey, directory, date, member, connection })
  context.current = { mappingKey, fixtureKey, directory, date, member, connection }
  rosterRef.current = roster
  useEffect(() => {
    let active = true
    const previous = previousFixture.current, old = rosterRef.current
    setPreview(undefined); setTablePreview(undefined); setTeacherConfirmed(false); setTableConfirmed(false)
    const action = pendingRebase.current?.key === mappingKey
      ? Promise.resolve(pendingRebase.current.roster)
      : old && previous.schoolId === mappingFixture.schoolId
        ? synchronizePilotRoster(previous, mappingFixture, old, state.timetableVersions)
        : createPilotRoster(mappingFixture)
    void action.then(value => {
      if (active) {
        rosterRef.current = value; previousFixture.current = mappingFixture
        setRoster(value); setRosterSourceKey(mappingKey)
        if (pendingRebase.current?.key === mappingKey) pendingRebase.current = undefined
      }
    }).catch(e => { if (active) setError(message(e)) })
    return () => { active = false }
  }, [mappingFixture])
  const rosterReady = !!roster && rosterSourceKey === mappingKey
  const validDate = useMemo(() => {
    try { return pilotDate(effectiveFrom) >= date && effectiveFrom <= fixture.dateRange.endsOn && effectiveFrom >= fixture.dateRange.startsOn }
    catch { return false }
  }, [effectiveFrom, date, fixture.dateRange.startsOn, fixture.dateRange.endsOn])
  const visibleBindings = useMemo(() => {
    if (!roster || !validDate) return []
    try { return rosterBindingsOn(roster, effectiveFrom) } catch { return [] }
  }, [roster, effectiveFrom, validDate])
  const dirty = Boolean(Object.keys(assignments).length || csv || tableReason)
  useEffect(() => { onNavigationLockChange?.(busy || dirty); return () => onNavigationLockChange?.(false) }, [busy, dirty, onNavigationLockChange])
  function discardTableReview() { setTablePreview(undefined); setTableConfirmed(false) }
  async function run(action: (guard: () => void) => Promise<void>) {
    if (running.current) return
    running.current = true
    const turn = life.current
    const guard = () => { if (turn !== life.current) throw new Error('학교 또는 계정이 바뀌어 이전 작업을 중단했습니다.') }
    setBusy(true); setError(''); setNotice('')
    try { await action(guard) } catch (e) { if (turn === life.current) setError(message(e)) }
    finally { if (turn === life.current) { running.current = false; setBusy(false) } }
  }
  async function readTeachers() {
    if (!connection || !member) { setError('가입 교사 조회는 로그인한 학교 업무실에서 사용할 수 있습니다. 여기서는 확인한 명단 CSV로 연결 계획을 만들 수 있습니다.'); return }
    await run(async guard => {
      const value = await createSchoolRosterServer(connection).get(member.id)
      guard()
      if (context.current.member?.id !== member.id || context.current.member.schoolId !== member.schoolId) throw new Error('학교 소속이 바뀌었습니다. 현재 계정에서 명단을 다시 확인해 주세요.')
      if (!value.available) throw new Error('학교별 교사 연결 SQL과 허용 명단을 준비해야 합니다. 학교 관리의 가입 교사 연결에서 먼저 확인해 주세요.')
      const list = await createRegisteredTeacherDirectory(member.schoolId, value.version, value.teachers.map(row => ({ id: row.id, schoolId: member.schoolId, label: row.label, active: true })))
      guard()
      if (context.current.member?.id !== member.id || context.current.member.schoolId !== member.schoolId) throw new Error('명단을 처리하는 동안 학교 소속이 바뀌었습니다. 현재 계정에서 다시 확인해 주세요.')
      setDirectory(list); setPreview(undefined); setTeacherConfirmed(false); discardTableReview()
      setNotice(`${list.teachers.length}명의 실제 소속 후보를 확인했습니다. 이름만으로 자동 배정하지 않습니다.`)
    })
  }
  async function readFile(file: File | undefined, kind: 'teachers' | 'table') {
    if (!file) return
    if (file.size > 1024 * 1024) { setError('CSV 파일은 1MB 이내로 선택해 주세요.'); return }
    await run(async guard => {
      const contents = await file.text()
      guard()
      if (context.current.mappingKey !== mappingKey) throw new Error('파일을 읽는 동안 시간표 기준이 바뀌었습니다. 같은 파일을 다시 선택해 주세요.')
      if (kind === 'teachers') {
        const list = await parseRegisteredTeacherCsv(contents, mappingFixture.schoolId, (directory?.revision ?? 0) + 1)
        guard()
        if (context.current.mappingKey !== mappingKey) throw new Error('학교 또는 시간표 기준이 바뀌었습니다. 명단을 다시 확인해 주세요.')
        setDirectory(list); setPreview(undefined); setTeacherConfirmed(false); discardTableReview()
        setNotice('확인한 명단을 현재 탭에서 읽었습니다. 서버의 재직 확인을 대신하지 않습니다.')
      } else { setCsv(contents); discardTableReview() }
    })
  }
  async function reviewTeachers() {
    if (!roster || !directory || !rosterReady || !validDate) return
    await run(async guard => {
      const value = await previewRosterReplacement(mappingFixture, roster, directory, { expectedVersion: roster.version, sourceFingerprint: await fingerprintPilotFixture(mappingFixture), effectiveFrom, requestKey: crypto.randomUUID(), assignments: Object.entries(assignments).map(([roleId, candidateId]) => ({ roleId, candidateId: candidateId || null })) }, date)
      guard()
      if (context.current.mappingKey !== mappingKey || context.current.date !== date || rosterRef.current?.version !== roster.version || context.current.directory?.fingerprint !== directory.fingerprint) throw new Error('교사 연결 기준이 바뀌었습니다. 변경 영향을 다시 확인해 주세요.')
      setPreview(value); setTeacherConfirmed(false)
    })
  }
  async function applyTeachers() {
    if (!roster || !directory || !preview || !teacherConfirmed || !rosterReady || !validDate) return
    await run(async guard => {
      const next = await commitRosterReplacement(mappingFixture, roster, directory, preview, date)
      guard()
      if (context.current.mappingKey !== mappingKey || context.current.date !== date || rosterRef.current?.version !== roster.version || context.current.directory?.fingerprint !== directory.fingerprint) throw new Error('교사 연결 기준이 바뀌었습니다. 변경 영향을 다시 확인해 주세요.')
      rosterRef.current = next; setRoster(next); setAssignments({}); setPreview(undefined); setTeacherConfirmed(false); discardTableReview()
      setNotice('교사 연결 계획을 새 판으로 보관했습니다. 아래 CSV를 내려받아 실제 배정 단계에서 사용하세요. 운영 DB에는 반영하지 않았습니다.')
    })
  }
  async function reviewTable() {
    if (!roster || !rosterReady || !validDate) return
    await run(async guard => {
      const bindings = rosterBindingsOn(roster, effectiveFrom)
      const result = await previewTimetableReplacement(fixture, csv, effectiveFrom, date, bindings)
      guard()
      if (context.current.fixtureKey !== fixtureKey || context.current.date !== date || rosterRef.current?.version !== roster.version) throw new Error('시간표 또는 교사 연결이 바뀌었습니다. 비교를 다시 실행해 주세요.')
      setTablePreview(result); setTableConfirmed(false)
    })
  }
  async function applyTable() {
    if (!roster || !rosterReady || !tablePreview || !tableConfirmed || !validDate || !canApply) return
    await run(async guard => {
      const currentRoster = rosterRef.current!
      const bindings = rosterBindingsOn(currentRoster, effectiveFrom)
      if (directory && bindings.some(binding => binding.candidateId !== null && !directory.teachers.some(teacher => teacher.id === binding.candidateId && teacher.active))) throw new Error('현재 명단에서 확인되지 않는 연결 교사가 있습니다. 교사 연결 계획을 먼저 정리해 주세요.')
      const verified = await validateTimetableReplacementPreview(fixture, tablePreview, date, bindings)
      const nextFixture = { ...mappingFixture, revision: mappingFixture.revision + 1, lessons: verified.lessons }
      const nextRoster = await rebasePilotRoster(mappingFixture, nextFixture, currentRoster, verified.effectiveFrom, date)
      guard()
      if (context.current.fixtureKey !== fixtureKey || context.current.date !== date || rosterRef.current?.version !== currentRoster.version || context.current.directory?.fingerprint !== directory?.fingerprint) throw new Error('반영 전에 시간표 또는 교사 연결이 바뀌었습니다. 비교를 다시 실행해 주세요.')
      const nextKey = JSON.stringify(nextFixture)
      pendingRebase.current = { key: nextKey, roster: nextRoster }
      const applied = await execute({ type: 'replace_timetable', preview: verified, reviewDate: date, reason: tableReason })
      guard()
      if (applied) {
        rosterRef.current = nextRoster; previousFixture.current = nextFixture
        setRoster(nextRoster); setRosterSourceKey(nextKey); setCsv(''); discardTableReview(); setTableReason('')
        setNotice('적용일 이후 시간표를 새 판으로 교체했습니다. 교사 연결 계획도 같은 기준판으로 보존했습니다.')
      } else pendingRebase.current = undefined
    })
  }
  return <section aria-label="실제 자료로 교체">
    <p className="pilot-banner">교사 연결 계획은 현재 열린 운영 연습 안에서만 보관합니다. 연습 메뉴 사이를 이동해도 유지되지만, 다른 작업으로 나가거나 새로고침하기 전에 연결 계획 CSV를 내려받아 주세요. 실제 교사의 이름과 회원 번호를 연습 백업이나 가상 승인 기록에 넣지 않습니다.</p>
    {error && <p className="pilot-error" role="alert">{error}</p>}{notice && <p className="pilot-success" role="status">{notice}</p>}
    <div className="pilot-toolbar"><label>새 자료 적용일<input type="date" min={date} max={fixture.dateRange.endsOn} value={effectiveFrom} disabled={busy} onChange={e => { setEffectiveFrom(e.target.value); setPreview(undefined); setTeacherConfirmed(false); discardTableReview() }} /></label></div>
    {!validDate && <p className="pilot-hint" role="status">현재 연습 날짜 이후의 유효한 적용일을 선택해 주세요. 날짜를 확인하기 전에는 교체하지 않습니다.</p>}
    {!rosterReady && <p className="pilot-hint" role="status">현재 시간표 기준판과 교사 연결 계획을 대조하고 있습니다. 기존 연결 계획은 보존합니다.</p>}
    <section className="pilot-card"><h3>1. 가상 교사를 실제 교사에 연결</h3><p className="pilot-hint">동일한 교사를 여러 역할에 연결할 수 있지만, 같은 시간에 두 수업이 생기면 확정할 수 없습니다. 기존 연결은 이전 날짜의 기록에 남습니다.</p>
      <div className="pilot-actions"><button disabled={busy} onClick={() => void readTeachers()}>가입 교사 목록 읽기</button><label>확인한 교사 명단 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void readFile(file, 'teachers') }} /></label></div>
      <details><summary>명단 CSV 형식</summary><p>첫 행: <code>id,schoolId,label,active</code></p><p>학교 번호: <code>{mappingFixture.schoolId}</code>. id는 확인한 소속 ID, active는 true 또는 false입니다. 이메일로 자동 매칭하지 않습니다.</p></details>
      <div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>현재 역할</th><th>연결할 교사</th></tr></thead><tbody>{fixture.teachers.map(row => <tr key={row.id}><td>{row.label}<small>{validDate ? visibleBindings.find(binding => binding.roleId === row.id)?.label ?? '확인 중' : '적용일 확인 필요'}</small></td><td><select aria-label={`${row.label} 연결`} disabled={busy || !directory || !rosterReady || !validDate} value={assignments[row.id] ?? '__keep'} onChange={e => { const next = { ...assignments }; if (e.target.value === '__keep') delete next[row.id]; else next[row.id] = e.target.value; setAssignments(next); setPreview(undefined); setTeacherConfirmed(false); discardTableReview() }}><option value="__keep">현재 연결 유지</option><option value="">가상 교사 유지</option>{directory?.teachers.filter(teacher => teacher.active).map(teacher => <option key={teacher.id} value={teacher.id}>{teacher.label} [{teacher.id}]</option>)}</select></td></tr>)}</tbody></table></div>
      <div className="pilot-actions"><button disabled={busy || !directory || !Object.keys(assignments).length || !rosterReady || !validDate} onClick={() => void reviewTeachers()}>교사 교체 영향 확인</button><button disabled={busy || !roster || !validDate} onClick={() => {
        if (roster) { try { downloadPilotText('교사_연결계획.csv', exportPilotRosterCsv(roster, effectiveFrom)) } catch (e) { setError(message(e)) } }
      }}>연결 계획 CSV</button><button disabled={busy} onClick={() => { setAssignments({}); setPreview(undefined); setTeacherConfirmed(false); setError('') }}>교사 선택 취소</button></div>
      {preview && <div className="pilot-card"><h3>교사 교체 확인</h3><p>적용일 {preview.input.effectiveFrom} · 주간 수업 {preview.affectedWeeklyLessons}개</p><ul>{preview.changes.map(row => <li key={row.roleId}>{row.before.label} → {row.after.label}</li>)}</ul><label><input type="checkbox" disabled={busy} checked={teacherConfirmed} onChange={e => setTeacherConfirmed(e.target.checked)} />서버 배정 전 연결 계획임을 확인했습니다.</label><button disabled={busy || !teacherConfirmed || !rosterReady || !validDate} onClick={() => void applyTeachers()}>연결 계획에 반영</button></div>}
    </section>
    <section className="pilot-card"><h3>2. 실제 주간 시간표로 바꾸기</h3><p className="pilot-hint">내려받은 CSV에서 배치를 바꾸고 다시 올립니다. 반·교사·공간의 중복, 누락된 수업과 기존 변경 이력을 확인합니다. 현재 계약은 9학급의 주간 279칸을 유지합니다.</p>
      <div className="pilot-actions"><button onClick={() => downloadPilotText('9학급_주간시간표.csv', exportPilotTimetableCsv(fixture))}>현재 주간 시간표 CSV</button><label>수정한 시간표 CSV<input type="file" accept=".csv,text/csv" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; void readFile(file, 'table') }} /></label></div>
      <label>교체 사유<textarea maxLength={1000} value={tableReason} disabled={busy} onChange={e => setTableReason(e.target.value)} /></label>
      <div className="pilot-actions"><button disabled={busy || !csv || !rosterReady || !validDate} onClick={() => void reviewTable()}>시간표 변경 비교</button><button disabled={busy} onClick={() => { setCsv(''); discardTableReview(); setTableReason(''); setError('') }}>시간표 선택 취소</button></div>
      {tablePreview && <div className="pilot-card"><h3>시간표 변경 {tablePreview.changes.length}칸</h3><p>{tablePreview.effectiveFrom}부터 새 기준판 적용 · 과거 수업과 원래 요청 보존</p><div className="pilot-table-wrap"><table className="pilot-table"><thead><tr><th>학급·교시</th><th>이전</th><th>변경</th></tr></thead><tbody>{tablePreview.changes.slice(0, 100).map(row => <tr key={`${row.classId}:${row.weekday}:${row.period}`}><td>{fixture.classes.find(group => group.id === row.classId)?.label} {'월화수목금'[row.weekday - 1]}{row.period}</td><td>{row.before}</td><td>{row.after}</td></tr>)}</tbody></table></div>{tablePreview.changes.length > 100 && <p>처음 100칸 표시 / 전체 {tablePreview.changes.length}칸은 모두 검사했습니다.</p>}<label><input type="checkbox" disabled={busy} checked={tableConfirmed} onChange={e => setTableConfirmed(e.target.checked)} />위 변경을 운영 연습에 반영합니다.</label>
        <p className="pilot-hint">담당자 역할에서 확정합니다. 실제 운영 서버 공개는 정식 편성·공개 경로를 사용합니다.</p>
        <button disabled={busy || !canApply || !tableConfirmed || !tableReason.trim() || !rosterReady || !validDate} onClick={() => void applyTable()}>운영 연습 시간표 교체</button>
      </div>}
    </section>
    <details className="pilot-card"><summary>실제 운영으로 넘길 때</summary><ol><li>학교 관리에서 확인한 가입 교사를 소속으로 연결합니다.</li><li>수업별 공식 담당을 배정하고 시간표 준비 화면의 공간·학급·시수를 확인합니다.</li><li>검증한 시간표를 정식 편성 화면에 가져온 뒤 적용 기간을 확인하고 공개합니다.</li><li>실제 교사의 동의와 담당자의 승인은 로그인한 각 계정에서 새로 받습니다.</li></ol><p>연습 {state.revision}판의 역할 수락·승인을 실제 운영 접수증으로 옮기지 않습니다.</p></details>
  </section>
}
