import { useCallback, useRef, useState } from 'react'

export type AppearancePreferences = {
  theme: 'light' | 'warm' | 'dark'
  density: 'comfortable' | 'compact'
  textSize: 'standard' | 'large'
}

export const APPEARANCE_STORAGE_KEY = 'workhub:appearance:v1'
export const DEFAULT_APPEARANCE: Readonly<AppearancePreferences> = Object.freeze({ theme: 'light', density: 'comfortable', textSize: 'standard' })
const themes = ['light', 'warm', 'dark'] as const
const densities = ['comfortable', 'compact'] as const
const textSizes = ['standard', 'large'] as const
const readError = '저장된 화면 설정을 읽지 못해 기본 화면을 적용했습니다. 설정을 다시 선택할 수 있습니다.'
const writeError = '화면은 바뀌었지만 이 브라우저에 설정을 저장하지 못했습니다. 새로 열면 이전 설정이나 기본 화면으로 돌아갈 수 있습니다.'

type ReadStorage = Pick<Storage, 'getItem'>
type WriteStorage = Pick<Storage, 'setItem'>
type AppearanceState = { preferences: AppearancePreferences; persistenceError: string }
const defaultState = (): AppearanceState => ({ preferences: { ...DEFAULT_APPEARANCE }, persistenceError: '' })
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

// 허용된 화면 값만 돌려준다. 저장소의 다른 키나 개인 자료를 가져오지 않는다.
export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  if (!isRecord(value)) return { ...DEFAULT_APPEARANCE }
  return {
    theme: themes.includes(value.theme as AppearancePreferences['theme']) ? value.theme as AppearancePreferences['theme'] : DEFAULT_APPEARANCE.theme,
    density: densities.includes(value.density as AppearancePreferences['density']) ? value.density as AppearancePreferences['density'] : DEFAULT_APPEARANCE.density,
    textSize: textSizes.includes(value.textSize as AppearancePreferences['textSize']) ? value.textSize as AppearancePreferences['textSize'] : DEFAULT_APPEARANCE.textSize,
  }
}

export function readAppearancePreferences(storage: ReadStorage | null): AppearanceState {
  if (!storage) return defaultState()
  try {
    const raw = storage.getItem(APPEARANCE_STORAGE_KEY)
    if (raw === null) return defaultState()
    const parsed: unknown = JSON.parse(raw)
    const preferences = normalizeAppearancePreferences(parsed)
    const valid = isRecord(parsed) && parsed.theme === preferences.theme && parsed.density === preferences.density && parsed.textSize === preferences.textSize
    return valid ? { preferences, persistenceError: '' } : { ...defaultState(), persistenceError: readError }
  } catch {
    return { ...defaultState(), persistenceError: readError }
  }
}

export function writeAppearancePreferences(storage: WriteStorage | null, preferences: unknown): string {
  if (!storage) return writeError
  try {
    storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearancePreferences(preferences)))
    return ''
  } catch {
    return writeError
  }
}

function readBrowserPreferences(): AppearanceState {
  if (typeof window === 'undefined') return defaultState()
  try { return readAppearancePreferences(window.localStorage) }
  catch { return { ...defaultState(), persistenceError: readError } }
}

function saveBrowserPreferences(preferences: AppearancePreferences): string {
  if (typeof window === 'undefined') return writeError
  try { return writeAppearancePreferences(window.localStorage, preferences) }
  catch { return writeError }
}

export function useAppearancePreferences() {
  const [state, setState] = useState<AppearanceState>(readBrowserPreferences)
  const current = useRef(state.preferences)
  const apply = useCallback((preferences: AppearancePreferences) => {
    current.current = preferences
    const persistenceError = saveBrowserPreferences(preferences)
    // 저장소가 막혀도 현재 화면은 계속 바꿀 수 있다.
    setState({ preferences, persistenceError })
  }, [])
  const update = useCallback((patch: Partial<AppearancePreferences>) => apply(normalizeAppearancePreferences({ ...current.current, ...patch })), [apply])
  const reset = useCallback(() => apply({ ...DEFAULT_APPEARANCE }), [apply])
  return { ...state, update, reset }
}
