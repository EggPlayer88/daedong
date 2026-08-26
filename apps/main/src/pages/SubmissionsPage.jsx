import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import {
  ACCEPT,
  MAX_BYTES,
  buildMatrix,
  cancelSubmission,
  downloadUrl,
  guessFromFilename,
  isLive,
  listAll,
  listMine,
  removeFile,
  submit,
  validateFile,
} from '../lib/submissions.js'
// 교과 목록의 진실의 원천은 prefill 색인이다 — 학교가 실제로 내는 과목이 거기 있다
import catalogRaw from '../../api/doc-ai/_assets/prefill-catalog.json'

const YEAR = 2026
const SEMESTER = 2
const CATALOG = Array.isArray(catalogRaw) ? catalogRaw : []
const SUBJECTS = [...new Set(CATALOG.map((c) => c.subject))].sort((a, b) => a.localeCompare(b, 'ko'))

// 확인 문구는 한 곳에서만 쓴다 — 교사와 담당자가 같은 말을 보게
const CONFIRM_CANCEL = '파일이 삭제되며 미제출 상태가 됩니다. 계속할까요?'

function statusLabel(status) {
  if (status === 'replaced') return '이전 제출'
  if (status === 'deleted') return '취소됨'
  return '제출됨'
}

function fmt(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleString('ko-KR', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/**
 * 제출 한 줄. 내 제출·전체 제출이 같은 행을 쓴다 —
 * 두 벌로 두면 한쪽만 고쳐져 교사와 담당자가 다른 화면을 보게 된다.
 */
export function SubmissionRow({ row, busy, orphan, cancelLabel = '제출 취소', onOpen, onCancel, onRetryRemove }) {
  const deleted = row.status === 'deleted'
  const cls = deleted ? 'row-deleted' : row.status === 'replaced' ? 'muted' : ''
  return (
    <tr className={cls}>
      <td>
        {row.subject} {row.grade}학년
      </td>
      <td>
        {deleted ? (
          // 실물이 없으므로 누를 수 없다 — 이름만 이력으로 남긴다
          <span title="파일이 삭제되었습니다">{row.file_name}</span>
        ) : (
          <button type="button" className="btn-plain" onClick={() => onOpen(row)}>
            {row.file_name}
          </button>
        )}
      </td>
      <td>{row.note || '—'}</td>
      <td>{fmt(row.submitted_at)}</td>
      <td>{statusLabel(row.status)}</td>
      <td>
        {row.status === 'submitted' && (
          <button type="button" className="btn-danger" onClick={() => onCancel(row)} disabled={busy}>
            {cancelLabel}
          </button>
        )}
        {deleted && orphan && (
          <button type="button" className="btn-danger" onClick={() => onRetryRemove(row)} disabled={busy}>
            파일 삭제 재시도
          </button>
        )}
      </td>
    </tr>
  )
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
  // 고아 파일(행은 취소됐는데 실물이 남은 것) — DB 에 표시가 없으므로 이 화면에서만 기억한다
  const [orphans, setOrphans] = useState([])
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

  async function onCancel(row) {
    if (busy) return
    // 되돌릴 수 없다 — 파일이 실제로 지워진다. 묻고 나서 지운다
    if (typeof window !== 'undefined' && !window.confirm(CONFIRM_CANCEL)) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { error: err, orphan, fileError } = await cancelSubmission(row)
    if (err) setError(err.message)
    else {
      // 행은 남는다 (수합 이력) — 목록에서 사라지지 않고 '취소됨' 으로 보인다
      setNotice(
        orphan
          ? `제출을 취소했습니다. 다만 파일을 지우지 못했습니다 (${fileError?.message || '원인 미상'}) — 재시도해 주세요.`
          : `제출을 취소했습니다: ${row.file_name}`
      )
      setOrphans((prev) => (orphan ? [...new Set([...prev, row.id])] : prev.filter((id) => id !== row.id)))
      await load()
    }
    setBusy(false)
  }

  async function onRetryRemove(row) {
    if (busy) return
    setBusy(true)
    setError(null)
    setNotice(null)
    const { orphan, error: err } = await removeFile(row.file_path)
    if (orphan) setError(`파일을 지우지 못했습니다: ${err?.message || '원인 미상'}`)
    else {
      setNotice('남아 있던 파일을 지웠습니다.')
      setOrphans((prev) => prev.filter((id) => id !== row.id))
    }
    setBusy(false)
  }

  async function open(row) {
    const { url, error: err } = await downloadUrl(row.file_path, row.file_name)
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
                  <th>취소</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((r) => (
                  <SubmissionRow
                    key={r.id}
                    row={r}
                    busy={busy}
                    orphan={orphans.includes(r.id)}
                    onOpen={open}
                    onCancel={onCancel}
                    onRetryRemove={onRetryRemove}
                  />
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
            <h4>
              전체 제출 ({all.filter(isLive).length}건)
              <span className="muted small"> · 취소·이전 제출도 이력으로 함께 보입니다</span>
            </h4>
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th>교과·학년</th>
                    <th>파일</th>
                    <th>메모</th>
                    <th>제출 시각</th>
                    <th>상태</th>
                    <th>삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {all.map((r) => (
                    <SubmissionRow
                      key={r.id}
                      row={r}
                      busy={busy}
                      orphan={orphans.includes(r.id)}
                      onOpen={open}
                      cancelLabel="삭제"
                      onCancel={onCancel}
                      onRetryRemove={onRetryRemove}
                    />
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
