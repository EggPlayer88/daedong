// app_contract_r1s 전용: 앱의 실제 Supabase 연결 모듈 대신 묶는다. 시험은 연결·Storage·확인 API 를 모두 대역으로 넘기므로 부르지 않는다.
const never = () => { throw new Error('시험에서 실제 Supabase 연결을 쓰면 안 됩니다') }
export const getSession = never
export const supabase = new Proxy({}, { get: never })
