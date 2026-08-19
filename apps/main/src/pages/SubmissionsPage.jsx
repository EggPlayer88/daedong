import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  ACCEPT,
  MAX_BYTES,
  buildMatrix,
  downloadUrl,
  guessFromFilename,
  listAll,
  listMine,
  submit,
  validateFile,
} from '../lib/submissions.js'
// 교과 목록의 진실의 원천은 prefill 색인이다 — 학교가 실제로 내는 과목이 거기 있다
import catalogRaw from '../../api/doc-ai/_assets/prefill-catalog.json'

const YEAR = 2026
const SEMESTER = 2
const CATALOG = Array.isArray(catalogRaw) ? catalogRaw : []
const SUBJECTS = [...new Set(CATALOG.map((c) => c.subject))].sort((a, b) => a.localeCompare(b, 'ko'))

function fmt(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function SubmissionsPage() {
  const { session, profile } = useAuth()
  const userId = session?.user?.id
  const isAdmin = can(profile, 'users.manage') // 수합 담당자 = admin·superadmin

  const [file, setFile] = useState(null)
  const [subject, setSubject] = useState('')
  const [grade, setGrade] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  const [mine, setMine] = useState([])
  const [all, setAll] = useState([])
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    if (!userId) return
    const m = await listMine(userId)
    if (m.error) setError(m.error.message)
    else setMine(m.rows)
    if (isAdmin) {
      const a = await listAll(YEAR, SEMESTER)
      if (!a.error) setAll(a.rows)
    }
  }, [userId, isAdmin])

  useEffect(() => {
    load()
  }, [load])

  function onPick(f) {
    setError(null)
    setNotice(null)
    setFile(f || null)
    if (!f) return
    const bad = validateFile(f)
    if (bad) {
      setError(bad)
      return
    }
    // 파일명에서 교과·학년을 제안한다. 틀릴 수 있으므로 그대로 고칠 수 있게 둔다
    const g = guessFromFilename(f.name, SUBJECTS)
    if (g.subject) setSubject(g.subject)
    if (g.grade) setGrade(String(g.grade))
    if (!g.subject || !g.grade) {
      setNotice('파일명에서 교과·학년을 다 읽지 못했습니다. 아래에서 골라 주세요.')
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: err } = await submit({
      userId, file, subject, grade, note, year: YEAR, semester: SEMESTER,
    })
    if (err) setError(err.message)
    else {
      setNotice(`제출했습니다: ${file.name}`)
      setFile(null)
      setNote('')
      if (fileRef.current) fileRef.current.value = ''
      await load()
    }
    setBusy(false)
  }

  async function open(row) {
    const { url, error: err } = await downloadUrl(row.file_path)
    if (err || !url) {
      setError(err?.message || '파일 주소를 만들지 못했습니다.')
      return
    }
    window.open(url, '_blank', 'noopener')
  }

  const matrix = useMemo(() => buildMatrix(all, CATALOG), [all])

  return (
    <div className="page submissions">
      <h2>평가계획 제출</h2>
      <p className="muted small">
        완성한 평가계획서(.hwpx)를 올려 주세요. 같은 교과·학년을 다시 올리면 이전 제출은
        <b> 이전 제출</b>로 표시되고 최신본이 수합 대상이 됩니다.
      </p>

      <form className="card submit-form" onSubmit={onSubmit}>
        <div className="row-field">
          <label htmlFor="subm-file">파일 (.hwpx, 최대 {MAX_BYTES / 1024 / 1024}MB)</label>
          <input
            id="subm-file"
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => onPick(e.target.files?.[0])}
            disabled={busy}
          />
        </div>

        <div className="row-field two">
          <div>
            <label htmlFor="subm-subject">교과</label>
            <input
              id="subm-subject"
              list="subm-subjects"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="예: 수학"
              disabled={busy}
            />
            <datalist id="subm-subjects">
              {SUBJECTS.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="subm-grade">학년</label>
            <select
              id="subm-grade"
              value={grade}
              onChange={(e) => setGrade(e.target.value)}
              disabled={busy}
            >
              <option value="">선택</option>
              {[1, 2, 3].map((g) => (
                <option key={g} value={g}>
                  {g}학년
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="row-field">
          <label htmlFor="subm-note">메모 (선택)</label>
          <input
            id="subm-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="담당자에게 남길 말이 있으면 적어 주세요"
            disabled={busy}
          />
        </div>

        {error && <p className="error">{error}</p>}
        {notice && <p className="notice">{notice}</p>}

        <button className="btn-google" type="submit" disabled={busy || !file || !subject || !grade}>
          {busy ? '올리는 중…' : '제출'}
        </button>
      </form>

      <section className="plan-sec">
        <h4>내 제출 ({mine.length}건)</h4>
        {mine.length === 0 ? (
          <p className="muted small">아직 제출한 파일이 없습니다.</p>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th>교과·학년</th>
                  <th>파일</th>
                  <th>메모</th>
                  <th>제출 시각</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <tr key={r.id} className={r.status === 'replaced' ? 'muted' : ''}>
                    <td>
                      {r.subject} {r.grade}학년
                    </td>
                    <td>
                      <button type="button" className="btn-plain" onClick={() => open(r)}>
                        {r.file_name}
                      </button>
                    </td>
                    <td>{r.note || '—'}</td>
                    <td>{fmt(r.submitted_at)}</td>
                    <td>{r.status === 'replaced' ? '이전 제출' : '제출됨'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {isAdmin && (
        <>
          <section className="plan-sec">
            <h4>
              제출 현황 — {matrix.done}/{matrix.expected}
              <span className="muted small"> (학년 × 교과, 최신 제출 기준)</span>
            </h4>
            <div className="scroll-x">
              <table className="table matrix">
                <thead>
                  <tr>
                    <th>교과</th>
                    {matrix.grades.map((g) => (
                      <th key={g}>{g}학년</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {matrix.cells.map((row) => (
                    <tr key={row.subject}>
                      <th>{row.subject}</th>
                      {row.byGrade.map((c) => (
                        <td key={c.grade} className={c.row ? 'cell-done' : c.expected ? 'cell-todo' : ''}>
                          {c.row ? '제출' : c.expected ? '미제출' : '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {matrix.extra.length > 0 && (
              <p className="muted small">
                목록에 없는 교과 제출 {matrix.extra.length}건:{' '}
                {matrix.extra.map((r) => `${r.subject} ${r.grade}학년`).join(', ')}
              </p>
            )}
            <p className="muted small">전체 zip 내려받기는 준비 중입니다.</p>
          </section>

          <section className="plan-sec">
            <h4>전체 제출 ({all.filter((r) => r.status === 'submitted').length}건)</h4>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>교과·학년</th>
                    <th>파일</th>
                    <th>메모</th>
                    <th>제출 시각</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <tr key={r.id} className={r.status === 'replaced' ? 'muted' : ''}>
                      <td>
                        {r.subject} {r.grade}학년
                      </td>
                      <td>
                        <button type="button" className="btn-plain" onClick={() => open(r)}>
                          {r.file_name}
                        </button>
                      </td>
                      <td>{r.note || '—'}</td>
                      <td>{fmt(r.submitted_at)}</td>
                      <td>{r.status === 'replaced' ? '이전 제출' : '제출됨'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
