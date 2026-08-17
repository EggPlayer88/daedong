import { useCallback, useEffect, useState } from 'react'
import { supabase, can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { RoleBadge } from '../components/Layout.jsx'

// Phase 0 뼈대 + D20 가입 승인.
// (users_select 는 승인자에게 전체 open 이지만, 이 화면은 admin+ 전용)
//
// ⚠ is_active 는 D20 이후 이중 의미다 (승인 대기 / 퇴직·전출).
//   승인 UPDATE 자체는 001 의 protect_privileged_columns 트리거가 admin+ 로 강제한다.

const COLUMNS = 'id, email, name, role, extra_permissions, is_active, created_at, departments(name)'

function fmtDate(s) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function AdminUsersPage() {
  const { profile } = useAuth()
  const allowed = can(profile, 'users.manage')

  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState(null) // 처리 중인 사용자 id

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('users')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
    if (error) setError(error)
    else {
      setRows(data ?? [])
      setError(null)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!allowed) {
      setLoading(false)
      return
    }
    load()
  }, [allowed, load])

  async function approve(user) {
    setApproving(user.id)
    setError(null)
    try {
      const { error } = await supabase
        .from('users')
        .update({ is_active: true })
        .eq('id', user.id)
      if (error) throw error
      await load()
    } catch (e) {
      setError(
        new Error(
          `${user.name || user.email} 승인에 실패했습니다: ${e.message}` +
            ' (관리자 권한이 있는지, 003 마이그레이션이 실행됐는지 확인해 주세요)'
        )
      )
    } finally {
      setApproving(null)
    }
  }

  if (!allowed) {
    return (
      <div className="page">
        <h2>사용자 관리</h2>
        <p className="error">이 화면은 관리자 이상만 볼 수 있습니다.</p>
      </div>
    )
  }

  const pending = rows.filter((u) => u.is_active === false)
  const active = rows.filter((u) => u.is_active !== false)

  return (
    <div className="page">
      <h2>사용자 관리</h2>

      {error && <p className="error">불러오지 못했습니다: {error.message}</p>}
      {loading && <p className="muted">불러오는 중…</p>}

      {!loading && (
        <>
          <section className="plan-sec" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
            <h3 className="sec-title">
              가입 대기 {pending.length > 0 && <span className="count">{pending.length}</span>}
            </h3>
            {pending.length === 0 ? (
              <p className="muted small">승인을 기다리는 가입 요청이 없습니다.</p>
            ) : (
              <>
                <p className="muted small">
                  승인해야 사이트를 이용할 수 있습니다. 모르는 계정이면 승인하지 마세요.
                </p>
                <table className="table">
                  <thead>
                    <tr>
                      <th>이름</th>
                      <th>이메일</th>
                      <th>가입 시각</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {pending.map((u) => (
                      <tr key={u.id}>
                        <td>{u.name}</td>
                        <td className="muted">{u.email}</td>
                        <td className="muted">{fmtDate(u.created_at)}</td>
                        <td>
                          <button
                            className="btn-google approve"
                            onClick={() => approve(u)}
                            disabled={approving === u.id}
                          >
                            {approving === u.id ? '처리 중…' : '승인'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>

          <section className="plan-sec">
            <h3 className="sec-title">
              사용자 <span className="count">{active.length}</span>
            </h3>
            <table className="table">
              <thead>
                <tr>
                  <th>이름</th>
                  <th>이메일</th>
                  <th>역할</th>
                  <th>부서</th>
                  <th>추가 권한</th>
                  <th>상태</th>
                </tr>
              </thead>
              <tbody>
                {active.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td className="muted">{u.email}</td>
                    <td>
                      <RoleBadge role={u.role} />
                    </td>
                    <td>{u.departments?.name ?? '—'}</td>
                    <td className="muted">
                      {u.extra_permissions?.length ? u.extra_permissions.join(', ') : '—'}
                    </td>
                    <td>
                      <span className="badge active-badge">활성</span>
                    </td>
                  </tr>
                ))}
                {active.length === 0 && (
                  <tr>
                    <td colSpan={6} className="muted">
                      활성 사용자가 없습니다.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>

          <p className="muted small">
            Phase 0 뼈대 — 역할·부서 변경, 비활성 처리(퇴직·전출) UI 는 이후 단계에서 추가합니다.
          </p>
        </>
      )}
    </div>
  )
}
