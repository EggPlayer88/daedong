import { ContractError } from './contracts'

// 전송 계층을 가져오지 않고도 같은 응답 오류와 기본 형식을 검증한다.
export const bad = (): never => { throw new ContractError('QUERY_FAILED', '서버 응답 형식을 확인할 수 없습니다. 다시 연결해 주세요.') }
export const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : bad()
export const str = (value: unknown, max = 200): string => typeof value === 'string' && value.length > 0 && Array.from(value).length <= max ? value : bad()
