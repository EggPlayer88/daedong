import { createContext, createElement, lazy, useContext, type ComponentProps, type ComponentType, type LazyExoticComponent } from 'react'

// Suspense가 최초 렌더를 보류해도 같은 시도에서는 동일한 lazy를 사용한다.
// 실패한 경계의 명시적 재시도만 새 토큰을 받으며, 다른 화면의 입력은 재마운트하지 않는다.
export const ModuleLoadAttempt = createContext<object>({})

export function retryableLazy<T extends ComponentType<any>>(load: () => Promise<{ default: T }>): ComponentType<ComponentProps<T>> {
  const attempts = new WeakMap<object, LazyExoticComponent<T>>()
  return function RetryableModule(props: ComponentProps<T>) {
    const attempt = useContext(ModuleLoadAttempt)
    let Screen = attempts.get(attempt)
    if (!Screen) { Screen = lazy(load); attempts.set(attempt, Screen) }
    return createElement(Screen as ComponentType<ComponentProps<T>>, props)
  }
}
