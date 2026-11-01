// 응답 값·오류 분류는 전송과 React에 의존하지 않는다. 공개 이름과 판정은 유지한다.
export type ServiceCode =
  | 'NOT_READY'
  | 'FORBIDDEN'
  | 'INACTIVE_MEMBERSHIP'
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CANCELLED'
  | 'QUERY_FAILED'
  | 'RESULT_UNKNOWN'
  | 'INVALID_RESPONSE'
export const serviceMessages: Record<ServiceCode, string> = {
  NOT_READY: '이 기능의 서버 연결을 준비 중입니다. 기존 입력은 유지됩니다.',
  FORBIDDEN: '현재 계정으로 이 자료를 처리할 수 없습니다.',
  INACTIVE_MEMBERSHIP: '현재 학교 소속을 다시 확인해 주세요.',
  INVALID_INPUT: '입력 내용과 형식을 확인해 주세요.',
  NOT_FOUND: '현재 열람할 수 있는 자료가 아닙니다.',
  CONFLICT: '다른 곳에서 수정된 자료입니다. 내 입력을 보관한 뒤 최신 원본을 다시 확인해 주세요.',
  IDEMPOTENCY_CONFLICT:
    '원래 요청 번호의 내용이 달라 자동 재전송하지 않습니다. 기존 요청을 확인해 주세요.',
  CANCELLED: '학교 또는 계정이 바뀌어 이전 응답을 닫았습니다.',
  QUERY_FAILED: '자료를 불러오지 못했습니다. 다시 확인해 주세요.',
  RESULT_UNKNOWN: '저장 결과를 확인하지 못했습니다. 같은 내용과 요청 번호로 다시 확인해 주세요.',
  INVALID_RESPONSE: '서버 자료의 형식을 확인하지 못했습니다. 다시 조회해 주세요.',
}
export class ServiceError extends Error {
  constructor(readonly code: ServiceCode) {
    super(serviceMessages[code])
    this.name = 'ServiceError'
  }
}
// exact·version 등 응답 검증기를 재사용하는 경우, 전송 전 입력 검사 안에서만 오류를 구분한다.
export function validateLocalInput<T>(validate: () => T): T {
  try {
    return validate()
  } catch (error) {
    if (error instanceof ServiceError && error.code === 'INVALID_RESPONSE')
      throw new ServiceError('INVALID_INPUT')
    throw error
  }
}
export const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    throw new ServiceError('INVALID_RESPONSE')
}
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value))
    throw new ServiceError('INVALID_INPUT')
  return value
}
export function text(value: unknown, max: number, required = false): string {
  if (
    typeof value !== 'string' ||
    Array.from(value).length > max ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) ||
    (required && !value.trim())
  )
    throw new ServiceError('INVALID_INPUT')
  return value
}
export function version(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new ServiceError('INVALID_RESPONSE')
  return value as number
}
export function isoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value + 'T00:00:00Z')) ||
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new ServiceError('INVALID_INPUT')
  return value
}
export const canonical = (value: unknown): string =>
  Array.isArray(value)
    ? '[' + value.map(canonical).join(',') + ']'
    : object(value)
      ? '{' +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
          .join(',') +
        '}'
      : JSON.stringify(value)
