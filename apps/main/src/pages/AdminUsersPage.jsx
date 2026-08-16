import { useEffect, useState } from 'react'
import { supabase, can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { RoleBadge } from '../components/Layout.jsx'

// Phase 0 뼈대: 목록 조회 + 역할 표기까지. 역할 변경 UI 는 Phase 1 이후.
// (users_select 는 USING(true) 라 조회 자체는 누구나 되지만, 이 화면은 admin+ 전용)
export default function AdminUsersPage() {
  const { profile } = useAuth()
  const allowed = can(profile, 'users.manage')

  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!allowed) {
      setLoading(false)
      return
    }

    let alive = true
    supabase
      .from('users')
      .select('id, email, name, role, extra_permissions, is_active, departments(name)')
      .order('name')
      .then(({ data, error }) => {
        if (!alive) return
        if (error) setError(error)
        else setRows(data ?? [])
        setLoading(false)
      })

    return () => {
      alive = false
    }
  }, [allowed])

  if (!allowed) {
    return (
      <div className="page">
        <h2>사용자 관리</h2>
        <p className="error">이 화면은 관리자 이상만 볼 수 있습니다.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <h2>사용자 관리</h2>

      {error && <p className="error">불러오지 못했습니다: {error.message}</p>}
      {loading && <p className="muted">불러오는 중…</p>}

      {!loading && !error && (
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
            {rows.map((u) => (
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
                <td>{u.is_active ? '재직' : '비활성'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  사용자가 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <p className="muted small">
        Phase 0 뼈대 — 역할·부서 변경 UI 는 이후 단계에서 추가합니다.
      </p>
    </div>
  )
}
