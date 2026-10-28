// 복제 빌드와 전용 DB 주소가 동시에 일치할 때만 가속 시간을 사용한다.
// Date.now 자체를 바꾸지 않는다. 로그인·재시도·파일 임대·정산은 실제 시간이다.
const environment = import.meta.env ?? {}
export const SANDBOX_REF = 'vfnemvoszjglfblsrzoh'
export const isSchoolSandbox = () => environment.VITE_SCHOOL_SANDBOX === SANDBOX_REF && environment.VITE_SUPABASE_URL === `https://${SANDBOX_REF}.supabase.co`
export interface ClockSegment { realAt: string; virtualAt: string; running: boolean }
export interface SandboxClock { contract: 'school-sandbox.v1'; projectRef: string; revision: number; realNow: string; virtualNow: string; startAt: string; endAt: string; speed: number; running: boolean; canControl: boolean; segments: ClockSegment[]; ai: { enabled: boolean; capMicroUsd: number; reservedCeilingMicroUsd: number; availableCeilingMicroUsd: number } }
let clock: SandboxClock | undefined
export function acceptSandboxClock(raw: SandboxClock) {
 const start=Date.parse(raw?.startAt),end=Date.parse(raw?.endAt)
 if (!isSchoolSandbox() || raw?.contract !== 'school-sandbox.v1' || raw.projectRef !== SANDBOX_REF || !Number.isInteger(raw.revision) || raw.revision<1 || !Number.isFinite(start) || !Number.isFinite(end) || end<=start || !Number.isFinite(raw.speed) || raw.speed!==(end-start)/3600000 || raw.speed <= 0 || raw.speed > 9000 || !Array.isArray(raw.segments) || raw.segments.length!==raw.revision || raw.segments.some((s,i) => !Number.isFinite(Date.parse(s.realAt)) || !Number.isFinite(Date.parse(s.virtualAt)) || typeof s.running!=='boolean' || Date.parse(s.virtualAt)<start || Date.parse(s.virtualAt)>end || i>0&&(Date.parse(s.realAt)<Date.parse(raw.segments[i-1].realAt)||Date.parse(s.virtualAt)<Date.parse(raw.segments[i-1].virtualAt)))) throw new Error('시험 시계 응답을 확인하지 못했습니다.')
 // 이전 조회가 늦게 도착해 새로 진행한 시계를 되감지 않는다.
 if(clock&&raw.revision<clock.revision)return false
 clock=structuredClone(raw);return true
}
export function clearSandboxClock() { clock=undefined }
export function businessTime(real = Date.now()): number {
 if (!isSchoolSandbox()) return real
 if (!clock) throw new Error('시험 시계를 먼저 확인해 주세요.')
 const segment=[...clock.segments].reverse().find(s=>Date.parse(s.realAt)<=real) ?? clock.segments[0]
 return Math.min(Date.parse(clock.endAt),Date.parse(segment.virtualAt)+(segment.running?Math.max(0,real-Date.parse(segment.realAt))*clock.speed:0))
}
export const businessIso = (real: string) => new Date(businessTime(Date.parse(real))).toISOString()
