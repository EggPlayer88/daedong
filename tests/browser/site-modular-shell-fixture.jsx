import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthContext } from '../../apps/main/src/lib/AuthContext.jsx'
import { SeasonalWorkProvider } from '../../apps/main/src/site/SeasonalWorkProvider.jsx'
import SeasonalSettingsPage from '../../apps/main/src/site/SeasonalSettingsPage.jsx'
import Layout from '../../apps/main/src/components/Layout.jsx'
import { WorkspaceShell } from '../../apps/workhub/src/app/WorkspaceShell'
import { enabledModules } from '../../apps/workhub/src/modules'
import styles from '../../apps/main/src/styles.css?inline'
const snapshot = {
  contract: 'site.seasonal.v1',
  feature: 'assessment-plan',
  enabled: false,
  version: 1,
  canManage: true,
  updatedAt: null,
}
const receipts = new Map()
window.scenario = {
  writes: [],
  lose: false,
  change: () => {
    snapshot.enabled = !snapshot.enabled
    snapshot.version++
  },
}
function Fixture() {
  const [role, setRole] = useState('superadmin')
  window.scenario.role = setRole
  const service = React.useMemo(
    () => ({
      read: async () => ({ ...snapshot, canManage: role === 'superadmin' }),
      save: async (command) => {
        window.scenario.writes.push(structuredClone(command))
        if (role !== 'superadmin')
          throw Object.assign(new Error('권한 없음'), { code: 'FORBIDDEN' })
        if (receipts.has(command.key)) return receipts.get(command.key)
        if (command.version !== snapshot.version)
          throw Object.assign(new Error('다른 관리자가 설정을 변경했습니다.'), { code: 'CONFLICT' })
        snapshot.enabled = command.enabled
        snapshot.version++
        snapshot.updatedAt = new Date().toISOString()
        const result = { ...snapshot }
        receipts.set(command.key, result)
        if (window.scenario.lose) {
          window.scenario.lose = false
          throw new Error('저장 결과 확인 필요')
        }
        return result
      },
    }),
    [role],
  )
  const profile = {
    id: 'teacher-' + role,
    role,
    name: role === 'superadmin' ? '시험 관리자' : '시험 교사',
    email: 'example@example.com',
    is_active: true,
  }
  return (
    <AuthContext.Provider
      value={{ session: { user: { id: profile.id } }, profile, loading: false }}
    >
      <SeasonalWorkProvider service={service}>
        <BrowserRouter>
          <style>{styles}</style>
          <Routes>
            <Route element={<Layout />}>
              <Route
                path="/"
                element={
                  <section className="page site-page">
                    <h2>오늘의 업무</h2>
                    <p>이용 가능한 업무를 선택해 주세요.</p>
                  </section>
                }
              />
              <Route
                path="/workhub"
                element={
                  <WorkspaceShell
                    mode="connected"
                    page="home"
                    memberName={profile.name}
                    schoolName="가상 학교 · UI 검증"
                    navigationModules={enabledModules('connected')}
                    onNavigate={() => {}}
                  >
                    <main className="main-content">
                      <h1>오늘</h1>
                      <p>공통 화면과 기간 업무 메뉴 검증</p>
                    </main>
                  </WorkspaceShell>
                }
              />
              <Route
                path="/doc-ai"
                element={
                  <section className="page site-page">
                    <h2>평가계획서 작성</h2>
                    <label>
                      보존할 문서 입력
                      <textarea defaultValue="작성 중인 내용" />
                    </label>
                  </section>
                }
              />
              <Route
                path="/submissions"
                element={
                  <section className="page site-page">
                    <h2>평가계획서 제출</h2>
                    <p>기존 제출 내역</p>
                  </section>
                }
              />
              <Route path="/admin/seasonal" element={<SeasonalSettingsPage />} />
              <Route path="/account" element={<h2>내 계정</h2>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </SeasonalWorkProvider>
    </AuthContext.Provider>
  )
}
createRoot(document.getElementById('root')).render(<Fixture />)
