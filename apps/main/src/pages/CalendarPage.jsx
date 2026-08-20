import { useCallback, useEffect, useMemo, useState } from 'react'
import { can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  EVENT_TYPES,
  iso,
  SCOPE_ICON,
  SCOPE_LABEL,
  create,
  currentTerm,
  deletedOnly,
  knownLabels,
  list,
  monthGrid,
  restore,
  softDelete,
  update,
  validate,
} from '../lib/calendar.js'
import { WEEKLY_RANGE, hoursTable, noClassBreakdown } from '../lib/school-days.js'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
// ⚠ toISOString() 은 UTC 라 한국 시간 기준으로 하루 밀린다 (calendar.js 의 iso 사용)
const today = () => iso(new Date())

function blank(scope = 'shared') {
  return {
    scope, title: '', event_type: '기타', labels: [], start_date: today(),
    end_date: today(), grades: [1, 2, 3], no_class: false, description: '',
  }
}

export default function CalendarPage() {
  const { session, profile } = useAuth()
  const userId = session?.user?.id
  const isAdmin = can(profile, 'users.manage') // 학사일정 쓰기 = admin·superadmin

  const now = new Date()
  const [year, setYear] = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [view, setView] = useState('month') // month | list | hours | trash
  const [rows, setRows] = useState([])
  const [term, setTerm] = useState(null)
  const [editing, setEditing] = useState(null)
  const [labelText, setLabelText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  const load = useCallback(async () => {
    const t = await currentTerm()
    if (t.term) setTerm(t.term)
    const { rows: r, error: e } = await list()
    if (e) setError(e.message)
    else {
      setRows(r)
      setError(null)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const grid = useMemo(() => monthGrid(rows, year, month), [rows, year, month])
  const labels = useMemo(() => knownLabels(rows), [rows])
  const trash = useMemo(() => deletedOnly(rows), [rows])
  const listRows = useMemo(
    () => rows.filter((r) => !r.deleted_at).sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [rows]
  )
  // 파생 계산 — 원천은 official 뿐 (school-days.js 가 그 경계를 지킨다)
  const hours = useMemo(() => (term ? hoursTable(rows, term) : null), [rows, term])
  const skipped = useMemo(() => (term ? noClassBreakdown(rows, term) : []), [rows, term])

  function move(delta) {
    const d = new Date(year, month - 1 + delta, 1)
    setYear(d.getFullYear())
    setMonth(d.getMonth() + 1)
  }

  function openNew(scope) {
    setError(null)
    setNotice(null)
    setLabelText('')
    setEditing({ ...blank(scope), term_id: term?.id || null })
  }

  function openEdit(ev) {
    setError(null)
    setNotice(null)
    setLabelText((ev.labels || []).join(', '))
    setEditing({ ...ev })
  }

  async function save(e) {
    e.preventDefault()
    if (busy || !editing) return
    const payload = {
      ...editing,
      labels: labelText.split(',').map((s) => s.trim()).filter(Boolean),
    }
    const bad = validate(payload)
    if (bad) {
      setError(bad)
      return
    }
    setBusy(true)
    const { error: err } = payload.id
      ? await update(payload.id, payload, userId)
      : await create(payload, userId)
    if (err) setError(err.message)
    else {
      setNotice(payload.id ? '수정했습니다.' : '추가했습니다.')
      setEditing(null)
      await load()
    }
    setBusy(false)
  }

  async function remove(ev) {
    if (busy) return
    if (!window.confirm(`'${ev.title}' 을(를) 삭제할까요? 휴지통에서 되돌릴 수 있습니다.`)) return
    setBusy(true)
    const { error: err } = await softDelete(ev.id, userId)
    if (err) setError(err.message)
    else {
      setNotice('삭제했습니다. 관리자가 휴지통에서 되돌릴 수 있습니다.')
      setEditing(null)
      await load()
    }
    setBusy(false)
  }

  async function undo(ev) {
    setBusy(true)
    const { error: err } = await restore(ev.id, userId)
    if (err) setError(err.message)
    else {
      setNotice('되돌렸습니다.')
      await load()
    }
    setBusy(false)
  }

  // official 은 admin 만 손댈 수 있다. 화면에서 가리되 막는 것은 RLS 다
  const canEdit = (ev) => (ev.scope === 'official' ? isAdmin : true)

  return (
    <div className="page calendar">
      <h2>학사일정 · 캘린더</h2>
      <p className="muted small">
        {SCOPE_ICON.official} <b>학사일정</b>은 학교 공식 일정입니다 (관리자만 편집).{' '}
        {SCOPE_ICON.shared} <b>공유</b>는 선생님들이 함께 쓰는 칸으로 누구나 고칠 수 있습니다.
        {term && ` · ${term.year}학년도 ${term.semester}학기 (${term.start_date} ~ ${term.end_date})`}
      </p>

      <div className="cal-bar">
        <div className="cal-move">
          <button type="button" className="btn-plain" onClick={() => move(-1)}>
            ‹
          </button>
          <b>
            {year}년 {month}월
          </b>
          <button type="button" className="btn-plain" onClick={() => move(1)}>
            ›
          </button>
        </div>
        <div className="cal-views">
          {[
            ['month', '월간'],
            ['list', '목록'],
            ['hours', '수업일수·시수'],
            ...(isAdmin ? [['trash', `휴지통 (${trash.length})`]] : []),
          ].map(([v, label]) => (
            <button
              key={v}
              type="button"
              className={view === v ? 'btn-plain on' : 'btn-plain'}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="cal-add">
          <button type="button" className="btn-plain" onClick={() => openNew('shared')}>
            + 공유 일정
          </button>
          {isAdmin && (
            <button type="button" className="btn-google" onClick={() => openNew('official')}>
              + 학사일정
            </button>
          )}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      {view === 'month' && (
        <div className="scroll-x">
          <table className="table cal-grid">
            <thead>
              <tr>
                {WEEKDAYS.map((w) => (
                  <th key={w}>{w}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.map((week, i) => (
                <tr key={i}>
                  {week.map((cell) => (
                    <td key={cell.date} className={cell.inMonth ? '' : 'cal-out'}>
                      <div className="cal-day">{cell.day}</div>
                      {cell.events.map((ev) => (
                        <button
                          type="button"
                          key={ev.id}
                          className={`cal-chip ${ev.scope}`}
                          onClick={() => openEdit(ev)}
                          title={`${SCOPE_LABEL[ev.scope]} · ${ev.event_type}${ev.no_class ? ' · 수업 없음' : ''}`}
                        >
                          {SCOPE_ICON[ev.scope]} {ev.title}
                        </button>
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'list' && (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>구분</th>
                <th>기간</th>
                <th>제목</th>
                <th>유형</th>
                <th>학년</th>
                <th>라벨</th>
                <th>수업</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {listRows.length === 0 && (
                <tr>
                  <td colSpan={8} className="muted small">
                    등록된 일정이 없습니다.
                  </td>
                </tr>
              )}
              {listRows.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    {SCOPE_ICON[ev.scope]} {SCOPE_LABEL[ev.scope]}
                  </td>
                  <td>
                    {ev.start_date}
                    {ev.end_date !== ev.start_date ? ` ~ ${ev.end_date}` : ''}
                  </td>
                  <td>{ev.title}</td>
                  <td>{ev.event_type}</td>
                  <td>{(ev.grades || []).join('·')}</td>
                  <td>{(ev.labels || []).join(', ') || '—'}</td>
                  <td>{ev.no_class ? '없음' : '있음'}</td>
                  <td>
                    <button
                      type="button"
                      className="btn-plain"
                      onClick={() => openEdit(ev)}
                      disabled={!canEdit(ev)}
                      title={canEdit(ev) ? '편집' : '학사일정은 관리자만 편집합니다'}
                    >
                      편집
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'hours' && (
        <div className="cal-hours">
          {!term && <p className="muted small">학기(academic_terms)가 없어 계산할 수 없습니다.</p>}
          {term && hours && (
            <>
              <p className="muted small">
                <b>학사일정(📌)만</b> 계산에 씁니다 — 공유 칸(🗒️)에 무엇을 적어도 시수는 흔들리지
                않습니다. 수업일 = {term.start_date} ~ {term.end_date} 안의 평일 − &lsquo;수업
                없음&rsquo; 으로 표시된 학사일정.
              </p>

              <h3>월별 수업일수</h3>
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      {hours.monthly.map((m) => (
                        <th key={m.ym}>{m.label}</th>
                      ))}
                      <th>합계</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {hours.monthly.map((m) => (
                        <td key={m.ym}>
                          {m.days}일
                          {m.absorbed.length > 0 && (
                            <span className="muted small">
                              {' '}
                              (
                              {m.absorbed.map((a) => `${a.label} ${a.days}일 포함`).join(', ')})
                            </span>
                          )}
                        </td>
                      ))}
                      <td>
                        <b>{hours.total_class_days}일</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                표는 <b>5행 고정</b>입니다 (학년 무관). 학기 마지막 달 뒤에 남는 달(1월)은 행을
                만들지 않고 마지막 칸에 합칩니다 — 양식에 6번째 행이 없기 때문입니다.
              </p>

              <h3>주당 시수별 월 시수 / 누계</h3>
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>주당</th>
                      {hours.months.map((m) => (
                        <th key={m}>{m}</th>
                      ))}
                      <th>합계</th>
                      <th>최소 기준</th>
                    </tr>
                  </thead>
                  <tbody>
                    {WEEKLY_RANGE.map((w) => {
                      const r = hours.variants[String(w)]
                      return (
                        <tr key={w}>
                          <td>{w}시간</td>
                          {r.months.map((cell, i) => (
                            <td key={hours.months[i]}>{cell}</td>
                          ))}
                          <td>
                            <b>{r.total}</b>
                          </td>
                          <td className={r.ok ? 'muted small' : 'review-mark small'}>
                            {r.min_required}
                            {r.ok ? '' : ' ⚠ 미달'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                누계 = ⌊주당시수 × 누적 수업일수 ÷ 5⌋. 달마다 남는 소수는 버리지 않고 다음 달로
                넘깁니다. 실제 시수는 교과의 요일 배정에 따라 달라질 수 있어, 이 표는{' '}
                <b>제안값</b>입니다.
              </p>

              <h3>수업이 빠진 날 ({skipped.length}건)</h3>
              <p className="muted small">
                위 숫자가 어떻게 나왔는지 눈으로 확인하는 칸입니다. 빠져야 할 날이 없거나 빠지면 안
                되는 날이 있으면 <b>목록</b> 뷰에서 해당 일정의 &lsquo;수업 없음&rsquo; 을 고치면
                이 표가 따라 바뀝니다.
              </p>
              <div className="scroll-x">
                <table className="table">
                  <thead>
                    <tr>
                      <th>기간</th>
                      <th>제목</th>
                      <th>유형</th>
                      <th>빠진 평일</th>
                      <th>해당 날짜</th>
                    </tr>
                  </thead>
                  <tbody>
                    {skipped.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted small">
                          &lsquo;수업 없음&rsquo; 으로 표시된 학사일정이 없습니다.
                        </td>
                      </tr>
                    )}
                    {skipped.map((s) => (
                      <tr key={s.id || `${s.start_date}-${s.title}`}>
                        <td>
                          {s.start_date}
                          {s.end_date !== s.start_date ? ` ~ ${s.end_date}` : ''}
                        </td>
                        <td>{s.title}</td>
                        <td>{s.event_type}</td>
                        <td>{s.weekdays}일</td>
                        <td className="muted small">
                          {s.dates.length ? s.dates.join(', ') : '주말·학기 밖 — 영향 없음'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <p className="muted small">
                ⚠ 평가계획서에 실제로 들어가는 시수는 <b>자산 파일</b>(fixed-hours)에서 나옵니다.
                이 화면은 캘린더에서 지금 계산한 값이라, 자산과 다를 수 있습니다. 자산을 다시 찍는
                것은 <code>node scripts/build-fixed-hours.mjs</code> 이며, 차이가 있으면 그
                스크립트가 어느 칸이 왜 다른지 보고합니다.
              </p>
            </>
          )}
        </div>
      )}

      {view === 'trash' && isAdmin && (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th>구분</th>
                <th>기간</th>
                <th>제목</th>
                <th>삭제 시각</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trash.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted small">
                    삭제된 일정이 없습니다.
                  </td>
                </tr>
              )}
              {trash.map((ev) => (
                <tr key={ev.id}>
                  <td>
                    {SCOPE_ICON[ev.scope]} {SCOPE_LABEL[ev.scope]}
                  </td>
                  <td>{ev.start_date}</td>
                  <td>{ev.title}</td>
                  <td>{ev.deleted_at?.slice(0, 16).replace('T', ' ')}</td>
                  <td>
                    <button type="button" className="btn-plain" onClick={() => undo(ev)} disabled={busy}>
                      되돌리기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <form className="card cal-form" onSubmit={save}>
          <h3>
            {SCOPE_ICON[editing.scope]} {SCOPE_LABEL[editing.scope]} {editing.id ? '수정' : '추가'}
          </h3>
          {editing.scope === 'official' && !isAdmin && (
            <p className="error">학사일정은 관리자만 편집할 수 있습니다.</p>
          )}

          <div className="row-field">
            <label htmlFor="cal-title">제목</label>
            <input
              id="cal-title"
              value={editing.title}
              onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            />
          </div>

          <div className="row-field two">
            <div>
              <label htmlFor="cal-type">유형</label>
              <select
                id="cal-type"
                value={editing.event_type}
                onChange={(e) => setEditing({ ...editing, event_type: e.target.value })}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label>대상 학년</label>
              <div className="grade-picks">
                {[1, 2, 3].map((g) => (
                  <label key={g} className="grade-pick">
                    <input
                      type="checkbox"
                      checked={(editing.grades || []).includes(g)}
                      onChange={(e) => {
                        const set = new Set(editing.grades || [])
                        if (e.target.checked) set.add(g)
                        else set.delete(g)
                        setEditing({ ...editing, grades: [...set].sort() })
                      }}
                    />
                    {g}
                  </label>
                ))}
              </div>
            </div>
          </div>

          <div className="row-field two">
            <div>
              <label htmlFor="cal-start">시작일</label>
              <input
                id="cal-start"
                type="date"
                value={editing.start_date}
                onChange={(e) => setEditing({ ...editing, start_date: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="cal-end">종료일</label>
              <input
                id="cal-end"
                type="date"
                value={editing.end_date}
                onChange={(e) => setEditing({ ...editing, end_date: e.target.value })}
              />
            </div>
          </div>

          <div className="row-field">
            <label htmlFor="cal-labels">라벨 (쉼표로 구분 · 기존 라벨 자동완성)</label>
            <input
              id="cal-labels"
              list="cal-label-list"
              value={labelText}
              onChange={(e) => setLabelText(e.target.value)}
              placeholder="예: 교무, 성적, 3학년"
            />
            <datalist id="cal-label-list">
              {labels.map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
          </div>

          <div className="row-field">
            <label htmlFor="cal-desc">설명 (선택)</label>
            <input
              id="cal-desc"
              value={editing.description || ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
          </div>

          {/* no_class 는 시수·수업일수 계산의 원천이라 학사일정에서만 쓴다 */}
          {editing.scope === 'official' && (
            <div className="row-field">
              <label className="grade-pick">
                <input
                  type="checkbox"
                  checked={!!editing.no_class}
                  onChange={(e) => setEditing({ ...editing, no_class: e.target.checked })}
                />
                이 기간은 <b>수업 없음</b> (시수·수업일수 계산에 반영됩니다)
              </label>
            </div>
          )}

          <div className="row">
            <button className="btn-google" type="submit" disabled={busy || !canEdit(editing)}>
              {busy ? '저장 중…' : '저장'}
            </button>
            <button type="button" className="btn-plain" onClick={() => setEditing(null)} disabled={busy}>
              취소
            </button>
            {editing.id && canEdit(editing) && (
              <button type="button" className="btn-plain" onClick={() => remove(editing)} disabled={busy}>
                삭제
              </button>
            )}
          </div>

          {editing.updated_by && (
            <p className="muted small">
              마지막 수정: {editing.updated_at?.slice(0, 16).replace('T', ' ')}
            </p>
          )}
        </form>
      )}
    </div>
  )
}
