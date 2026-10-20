import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { SchoolPreparationPanel } from '../../apps/workhub/src/setup/SchoolPreparationPanel'
import { preparationMember, schoolPreparationFixture, schoolPreparationEnvelope, preparationRpcKeys } from '../fixtures/school-preparation.mjs'
import styles from '../../apps/workhub/src/setup/school-preparation.css'
const w = window as any
const sheet = document.createElement('style'); sheet.textContent = styles + 'body{font-family:Arial,sans-serif;margin:12px}button{cursor:pointer;padding:.45rem .7rem}*{box-sizing:border-box}'; document.head.append(sheet)
w.state = schoolPreparationFixture(); w.member = structuredClone(preparationMember); w.calls = []; w.destinations = []; w.fail = ''; w.delayImport = false; w.disabled = false
const connection: any = {
  info: () => ({ memberships: [w.member], schools: [{ id: w.member.schoolId }], basisDate: '2026-10-21' }),
  getIdentity: async () => ({ userId: w.member.userId, approved: true, profile: { id: w.member.userId, role: 'superadmin', is_active: true, department_id: null, extra_permissions: [] } }),
  rpcVerified: async (name: string, args: any) => {
    w.calls.push({ name, args }); if (w.fail === name) throw new Error('합성 연결 실패')
    const data = structuredClone(w.state[(preparationRpcKeys as any)[name]])
    if (name === 'workhub_teaching_catalog') { data.memberId = w.member.id; data.ownerUserId = w.member.userId }
    const response = schoolPreparationEnvelope(name, data, w.member)
    if (name === 'workhub_timetable_import_get' && w.delayImport) { w.delayImport = false; await new Promise(resolve => { w.release = resolve }) }
    return response
  },
}
function App() {
  const [member, setMember] = useState(w.member), [disabled, setDisabled] = useState(false)
  w.switchMember = () => { w.member = { ...w.member, id: 'new-member', userId: 'new-user' }; setMember(w.member) }
  w.setDisabled = setDisabled
  return <SchoolPreparationPanel connection={connection} member={member} disabled={disabled} onOpen={destination => w.destinations.push(destination)} />
}
createRoot(document.getElementById('root')!).render(<App />)
