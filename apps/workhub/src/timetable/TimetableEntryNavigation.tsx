type Mode = 'editor' | 'operations' | 'pilot' | 'import' | 'roster'
export function TimetableEntryNavigation({ mode, locked, canManage, editorRecovery, importRecovery, managementError, onRetry, onNavigate }: {
  mode: Mode; locked: boolean; canManage: boolean; editorRecovery: boolean; importRecovery: boolean; managementError: boolean
  onRetry: () => void; onNavigate: (mode: Mode) => void
}) {
  return <nav aria-label="시간표 작업 구분" className="timetable-entry-navigation">
    <button type="button" className="secondary" aria-pressed={mode === 'operations'} disabled={locked && mode !== 'operations'} onClick={() => onNavigate('operations')}>시간표 보기</button>
    {(canManage || editorRecovery) && <button type="button" className="secondary" aria-pressed={mode === 'editor'} disabled={locked && mode !== 'editor'} onClick={() => onNavigate('editor')}>{canManage ? '편성 관리' : '편성 요청 결과 확인'}</button>}
    <button type="button" className="secondary" aria-pressed={mode === 'roster'} disabled={locked} onClick={() => onNavigate('roster')}>기본 주간표</button>
    {(canManage || importRecovery) && <details className="timetable-entry-tools" open={mode === 'pilot' || mode === 'import' || undefined}>
      <summary>{canManage ? '시간표 관리 도구' : '가져오기 요청 확인'}</summary><div>
        {canManage && <button type="button" className="secondary" aria-pressed={mode === 'pilot'} disabled={locked && mode !== 'pilot'} onClick={() => onNavigate('pilot')}>9학급 운영 연습</button>}
        <button type="button" className="text-button" aria-pressed={mode === 'import'} disabled={locked && mode !== 'import'} onClick={() => onNavigate('import')}>{canManage ? '실제 시간표 가져오기' : '가져오기 요청 결과 확인'}</button>
      </div></details>}
    {managementError && <button type="button" disabled={locked} onClick={onRetry}>관리 도구 권한 다시 확인</button>}
  </nav>
}
