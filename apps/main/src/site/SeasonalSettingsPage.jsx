import { useState } from 'react'
import { can } from '@daedong/shared'
import { useAuth } from '../lib/AuthContext.jsx'
import { PageHeading } from '../components/PageFrame.jsx'
import { useSeasonalWork } from './SeasonalWorkProvider.jsx'

export default function SeasonalSettingsPage() {
  const { profile } = useAuth(),
    setting = useSeasonalWork()
  const [choice, setChoice] = useState(null)
  if (!can(profile, 'users.manage'))
    return <p role="alert">관리자만 기간 업무 메뉴를 설정할 수 있습니다.</p>
  const { state, busy, pending, loading, error, refresh, save } = setting
  const enabled = pending?.enabled ?? choice ?? state?.enabled ?? false
  return (
    <section className="page site-page seasonal-settings" aria-label="기간 업무 관리">
      <PageHeading
        title="기간 업무 관리"
        description="필요한 기간에만 교사 메뉴에 업무를 표시합니다."
      />
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {loading && !state && <p role="status">메뉴 설정을 확인하고 있습니다…</p>}
      <section className="card">
        <h3>평가계획서 제출</h3>
        <p>평가계획서 AI 작성과 제출 메뉴를 함께 표시합니다.</p>
        <p role="status">
          현재 상태: {state ? (state.enabled ? '메뉴에 표시 중' : '메뉴에서 숨김') : '확인 중'}
        </p>
        <label className="seasonal-switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!state?.canManage || busy || Boolean(pending)}
            onChange={(event) => setChoice(event.target.checked)}
          />
          교사 메뉴에 평가계획서 업무 표시
        </label>
        <p className="muted">
          숨겨도 제출 자료와 AI 작성 기록은 유지됩니다. 이미 열어 둔 화면이나 저장한 주소에서의 접근
          권한은 바뀌지 않습니다.
        </p>
        <p className="muted">
          현재 평가계획서 서비스 전체에 적용하는 표시 설정입니다. 학교 소속 연결이나 다른 업무의
          공개 범위를 바꾸지 않습니다.
        </p>
        <div className="seasonal-actions">
          <button
            className="btn-google"
            disabled={!state?.canManage || busy || Boolean(pending) || enabled === state.enabled}
            onClick={() => {
              setChoice(null)
              void save(enabled)
            }}
          >
            {busy ? '설정 저장 중…' : '메뉴 표시 저장'}
          </button>
          <button
            className="btn-plain"
            disabled={busy}
            onClick={() => {
              setChoice(null)
              void refresh()
            }}
          >
            현재 설정 다시 확인
          </button>
        </div>
        {pending && (
          <div role="status">
            <p>저장 결과를 확인 중입니다. 새 설정을 보내지 않고 같은 요청으로 확인합니다.</p>
            <button
              className="btn-plain"
              disabled={busy}
              onClick={() => void save(pending.enabled, true)}
            >
              같은 요청으로 결과 확인
            </button>
          </div>
        )}
      </section>
      <p className="muted">
        다음 문서 업무는 별도 검토 후 추가합니다. 현재 등록된 기간 업무는 평가계획서 한 가지입니다.
      </p>
    </section>
  )
}
