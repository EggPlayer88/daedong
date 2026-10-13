import { useEffect, useId, useRef, useState } from 'react'
import { normalizeAppearancePreferences, type AppearancePreferences } from './preferences'
import appearanceStyles from './appearance.css?inline'

type AppearancePanelProps = {
  preferences: AppearancePreferences
  onChange: (patch: Partial<AppearancePreferences>) => void
  onReset: () => void
  persistenceError?: string
}

const themes = [
  { value: 'light', label: '화이트', description: '밝고 또렷한 기본 화면' },
  { value: 'warm', label: '웜 페이퍼', description: '부드럽고 따뜻한 화면' },
  { value: 'dark', label: '차콜', description: '차분한 어두운 화면' },
] as const
const densities = [{ value: 'comfortable', label: '여유롭게', description: '편안한 간격' }, { value: 'compact', label: '촘촘하게', description: '한눈에 더 많이' }] as const
const textSizes = [{ value: 'standard', label: '기본', description: '기본 글자 크기' }, { value: 'large', label: '크게', description: '더 편하게 읽기' }] as const

export function AppearancePanel(props: AppearancePanelProps) {
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  return <>
    <style>{appearanceStyles}</style>
    <button ref={trigger} type="button" className="appearance-trigger" aria-haspopup="dialog" onClick={() => setOpen(true)}>
      <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg>
      <span>화면 설정</span>
    </button>
    {open && <AppearanceDialog {...props} onClose={() => setOpen(false)} returnFocus={trigger.current} />}
  </>
}

// 별도 컴포넌트로 두어 닫을 때마다 초점과 대화상자 상태가 함께 정리된다.
export function AppearanceDialog({ preferences: input, onChange, onReset, persistenceError, onClose, returnFocus }: AppearancePanelProps & { onClose: () => void; returnFocus?: HTMLElement | null }) {
  const preferences = normalizeAppearancePreferences(input)
  const dialog = useRef<HTMLDialogElement>(null)
  const id = useId()
  const [resetNotice, setResetNotice] = useState(false)
  useEffect(() => {
    const element = dialog.current
    const root = element?.getRootNode()
    const active = typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot ? root.activeElement : typeof document !== 'undefined' ? document.activeElement : null
    const previouslyFocused = returnFocus ?? (active instanceof HTMLElement ? active : null)
    element?.showModal()
    element?.querySelector<HTMLInputElement>('input[name="' + id + '-theme"]:checked')?.focus()
    return () => { element?.close(); if (previouslyFocused?.isConnected) previouslyFocused.focus() }
  }, [id, returnFocus])
  function change(patch: Partial<AppearancePreferences>) { setResetNotice(false); onChange(patch) }
  const summary = `${themes.find(item => item.value === preferences.theme)?.label} · ${densities.find(item => item.value === preferences.density)?.label} · ${textSizes.find(item => item.value === preferences.textSize)?.description}`
  return <dialog ref={dialog} className="appearance-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`} onCancel={event => { event.preventDefault(); onClose() }}>
    <header className="appearance-header"><div><h2 id={`${id}-title`}>화면 설정</h2><p id={`${id}-help`}>색상과 글자 크기를 편하게 바꿔 보세요.</p></div><button type="button" className="appearance-close" aria-label="화면 설정 닫기" onClick={onClose}><svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div className="appearance-body">
      <fieldset className="appearance-fieldset"><legend>화면 색상</legend><div className="appearance-options appearance-theme-options">{themes.map(option => <label key={option.value} className="appearance-option" data-selected={preferences.theme === option.value}>
        <span className="appearance-theme-swatch" data-preview-theme={option.value} aria-hidden="true"><i/><i/><i/></span>
        <span className="appearance-option-title"><input type="radio" name={`${id}-theme`} value={option.value} checked={preferences.theme === option.value} onChange={() => change({ theme: option.value })}/>{option.label}</span><span className="appearance-option-description">{option.description}</span>
      </label>)}</div></fieldset>
      <fieldset className="appearance-fieldset"><legend>정보 간격</legend><div className="appearance-options">{densities.map(option => <label key={option.value} className="appearance-option" data-selected={preferences.density === option.value}><span className="appearance-option-title"><input type="radio" name={`${id}-density`} value={option.value} checked={preferences.density === option.value} onChange={() => change({ density: option.value })}/>{option.label}</span><span className="appearance-option-description">{option.description}</span></label>)}</div></fieldset>
      <fieldset className="appearance-fieldset"><legend>글자 크기</legend><div className="appearance-options">{textSizes.map(option => <label key={option.value} className="appearance-option" data-selected={preferences.textSize === option.value}><span className="appearance-option-title"><input type="radio" name={`${id}-text-size`} value={option.value} checked={preferences.textSize === option.value} onChange={() => change({ textSize: option.value })}/>{option.label}</span><span className="appearance-option-description">{option.description}</span></label>)}</div></fieldset>
      <p className="appearance-status" role="status">{resetNotice ? '기본 화면 설정을 적용했습니다. ' : ''}{summary}</p>
      <p className="appearance-storage-note">변경은 바로 적용되며, 이 브라우저에만 저장합니다.</p>
      {typeof persistenceError === 'string' && persistenceError && <p className="appearance-storage-error" role="alert">{persistenceError}</p>}
    </div>
    <footer className="appearance-footer"><button type="button" className="appearance-reset" onClick={() => { onReset(); setResetNotice(true) }}>기본 설정으로</button><button type="button" className="appearance-done" onClick={onClose}>완료</button></footer>
  </dialog>
}
