import '../app/navigation-bridge'
import { useState } from 'react'
import { useWorkspaceNavigation } from '../app/navigation'
import { SchoolSetupPanel } from './SchoolSetupPanel'

// 기존 SPA 이동 보호를 재사용한다. 이 화면은 학교 연결 없이 입력 준비만 한다.
export function SchoolSetupWorkspace() {
  const [dirty, setDirty] = useState(false)
  const navigation = useWorkspaceNavigation({ allowedPages: ['home'], locked: dirty })
  return <div className="school-setup-host">
    {dirty && navigation.announcement && <p className="school-setup-navigation-note" role="status">현재 입력을 보호하기 위해 이동을 멈췄습니다. 필요하면 초안 파일을 내려받고, ‘현재 초안 비우기’로 정리한 뒤 이동해 주세요.</p>}
    <SchoolSetupPanel onDirtyChange={setDirty} />
  </div>
}
