import { buildCpSatRequest, canonicalTimetableJson, parseCpSatResponse, type CpSatRequest, type CpSatResponse } from '../../../../packages/timetable/src/cpSat'
import policy from '../../../../packages/timetable/_assets/engine-policy.json'

export const JOB_CONTRACT = 'timetable.jobs.v1' as const
export interface JobQueue { contract: typeof JOB_CONTRACT; queueId: string; createdAt: string; policyVersion: 1 }
export type JobState = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted'
export interface JobStatus { contract: typeof JOB_CONTRACT; queueId: string; requestId: string; inputHash: string; sequence: number; state: JobState; queuedAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null; code: string | null }
export interface JobWorker { contract: typeof JOB_CONTRACT; queueId: string; workerId: string; state: 'ready' | 'busy' | 'stopped'; updatedAt: string; activeRequestId: string | null }
export interface JobFiles {
  read(path: string, maximumBytes: number): Promise<string | null>
  write(path: string, text: string): Promise<void>
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>
}
export interface LocalEngineJobs {
  queue: JobQueue
  submit(request: CpSatRequest): Promise<void>
  status(request: CpSatRequest, previous?: JobStatus): Promise<JobStatus | null>
  cancel(request: CpSatRequest): Promise<void>
  result(request: CpSatRequest): Promise<CpSatResponse>
  worker(): Promise<JobWorker | null>
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> => object(v) && Object.keys(v).length === keys.length && keys.every(key => Object.hasOwn(v, key))
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v)
const stamp = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
const fail = (message = '로컬 계산 자료가 원래 요청과 다릅니다. 기존 요청을 보존하고 작업 폴더를 확인해 주세요.'): never => { throw new Error(message) }
const parse = (raw: string): unknown => { try { return JSON.parse(raw) } catch { return fail('계산 파일을 읽는 중입니다. 잠시 후 같은 요청을 다시 확인해 주세요.') } }
export const terminalJob = (state: JobState) => ['succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(state)
export function parseJobQueue(raw: unknown): JobQueue {
  if (!exact(raw, ['contract', 'queueId', 'createdAt', 'policyVersion']) || raw.contract !== JOB_CONTRACT || !uuid(raw.queueId) || !stamp(raw.createdAt) || raw.policyVersion !== 1) return fail('시간표 계산기가 초기화한 전용 작업 폴더를 선택해 주세요.')
  return raw as unknown as JobQueue
}
export function parseJobStatus(raw: unknown, queue: JobQueue, request: CpSatRequest, previous?: JobStatus): JobStatus {
  if (!exact(raw, ['contract', 'queueId', 'requestId', 'inputHash', 'sequence', 'state', 'queuedAt', 'updatedAt', 'startedAt', 'finishedAt', 'code']) || raw.contract !== JOB_CONTRACT || raw.queueId !== queue.queueId || raw.requestId !== request.requestId || raw.inputHash !== request.inputHash || !Number.isSafeInteger(raw.sequence) || Number(raw.sequence) < 1 || !['queued', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted'].includes(String(raw.state)) || !stamp(raw.queuedAt) || !stamp(raw.updatedAt) || raw.startedAt !== null && !stamp(raw.startedAt) || raw.finishedAt !== null && !stamp(raw.finishedAt) || raw.code !== null && (typeof raw.code !== 'string' || !/^[A-Z][A-Z0-9_]{0,99}$/.test(raw.code))) return fail()
  const value = raw as unknown as JobStatus
  if (value.updatedAt < value.queuedAt || value.startedAt !== null && (value.startedAt < value.queuedAt || value.startedAt > value.updatedAt) || value.finishedAt !== null && (value.finishedAt < (value.startedAt ?? value.queuedAt) || value.finishedAt > value.updatedAt) || terminalJob(value.state) !== (value.finishedAt !== null) || ['running', 'cancel_requested', 'timed_out'].includes(value.state) && value.startedAt === null || value.state === 'succeeded' && (value.startedAt === null || value.code !== null)) return fail()
  if (previous && (value.sequence < previous.sequence || value.updatedAt < previous.updatedAt || value.queuedAt !== previous.queuedAt || previous.startedAt !== null && value.startedAt !== previous.startedAt || value.sequence === previous.sequence && canonicalTimetableJson(value) !== canonicalTimetableJson(previous) || terminalJob(previous.state) && canonicalTimetableJson(value) !== canonicalTimetableJson(previous) || ['running', 'cancel_requested'].includes(previous.state) && value.state === 'queued')) return fail()
  if (previous?.state === 'cancel_requested' && value.state === 'running') return fail()
  return value
}
export async function connectLocalEngineJobs(files: JobFiles): Promise<LocalEngineJobs> {
  const queueText = await files.read('queue.json', 4096)
  if (queueText === null) return fail('계산기 초기 설정으로 만든 전용 작업 폴더를 선택해 주세요. 일반 폴더에는 계산 파일을 만들지 않습니다.')
  const queue = parseJobQueue(parse(queueText))
  async function sameQueue() {
    const current = await files.read('queue.json', 4096)
    if (current === null || canonicalTimetableJson(parseJobQueue(parse(current))) !== canonicalTimetableJson(queue)) fail('연결한 작업 폴더가 바뀌었습니다. 원래 폴더를 다시 선택해 주세요.')
  }
  function jobPath(request: CpSatRequest) { if (!uuid(request.requestId) || !/^[a-f0-9]{64}$/.test(request.inputHash)) fail(); return `jobs/${request.requestId}` }
  async function marker(request: CpSatRequest) {
    const raw = await files.read(`${jobPath(request)}/ready.json`, 4096)
    if (raw === null) return null
    const value = parse(raw)
    if (!exact(value, ['contract', 'queueId', 'requestId', 'inputHash', 'queuedAt']) || value.contract !== JOB_CONTRACT || value.queueId !== queue.queueId || value.requestId !== request.requestId || value.inputHash !== request.inputHash || !stamp(value.queuedAt)) return fail()
    return value
  }
  const api: LocalEngineJobs = {
    queue,
    async submit(request) {
      request = structuredClone(request)
      const rebuilt = await buildCpSatRequest(request.basis, request.requestId, request.previous, request.options)
      if (canonicalTimetableJson(request) !== canonicalTimetableJson(rebuilt)) fail()
      await files.exclusive(`${queue.queueId}:${request.requestId}`, async () => {
        await sameQueue(); const path = jobPath(request), ready = await marker(request)
        const existing = await files.read(`${path}/request.json`, policy.maximumRequestBytes)
        if (existing !== null && canonicalTimetableJson(parse(existing)) !== canonicalTimetableJson(request)) fail()
        if (ready) { if (existing === null) fail(); return }
        if (await files.read(`${path}/status.json`, 16384) !== null) fail()
        if (existing === null) await files.write(`${path}/request.json`, JSON.stringify(request))
        // 마지막 표식을 닫기 전까지 작업자는 이 요청을 실행하지 않는다.
        await files.write(`${path}/ready.json`, JSON.stringify({ contract: JOB_CONTRACT, queueId: queue.queueId, requestId: request.requestId, inputHash: request.inputHash, queuedAt: new Date().toISOString() }))
      })
    },
    async status(request, previous) {
      await sameQueue(); const ready = await marker(request)
      if (!ready) { if (previous) return fail('확인했던 계산 접수 자료가 사라졌습니다. 원래 요청을 보존하고 작업 폴더를 확인해 주세요.'); return null }
      const raw = await files.read(`${jobPath(request)}/status.json`, 16384)
      if (raw === null) { if (previous) return fail('확인했던 계산 상태가 사라졌습니다. 원래 요청을 보존하고 작업 폴더를 확인해 주세요.'); return null }
      const value = parseJobStatus(parse(raw), queue, request, previous)
      if (value.queuedAt !== ready.queuedAt) fail()
      return value
    },
    async cancel(request) {
      await files.exclusive(`${queue.queueId}:${request.requestId}`, async () => {
        await sameQueue(); if (!await marker(request)) fail('아직 접수 표식을 확인하지 못했습니다. 같은 요청 접수를 확인한 뒤 취소해 주세요.')
        const value = await api.status(request); if (value && terminalJob(value.state)) return
        await files.write(`${jobPath(request)}/cancel.json`, JSON.stringify({ contract: JOB_CONTRACT, queueId: queue.queueId, requestId: request.requestId, inputHash: request.inputHash, requestedAt: new Date().toISOString() }))
      })
    },
    async result(request) {
      const value = await api.status(request)
      if (value?.state !== 'succeeded') fail('계산 완료를 확인한 뒤 결과를 가져올 수 있습니다.')
      const raw = await files.read(`${jobPath(request)}/result.json`, policy.maximumRequestBytes)
      if (raw === null) return fail('계산 결과 파일을 아직 읽지 못했습니다. 같은 요청을 다시 확인해 주세요.')
      return parseCpSatResponse(request, parse(raw))
    },
    async worker() {
      await sameQueue(); const raw = await files.read('worker.json', 4096); if (raw === null) return null
      const value = parse(raw)
      if (!exact(value, ['contract', 'queueId', 'workerId', 'state', 'updatedAt', 'activeRequestId']) || value.contract !== JOB_CONTRACT || value.queueId !== queue.queueId || !uuid(value.workerId) || !['ready', 'busy', 'stopped'].includes(String(value.state)) || !stamp(value.updatedAt) || value.activeRequestId !== null && !uuid(value.activeRequestId)) return fail()
      return value as unknown as JobWorker
    },
  }
  return api
}

// 폴더 선택은 사용자의 클릭에서만 호출한다. 경로·키를 서버로 보내지 않는다.
interface WritableFile { write(text: string): Promise<void>; close(): Promise<void>; abort(): Promise<void> }
interface LocalFile { getFile(): Promise<{ size: number; text(): Promise<string> }>; createWritable(): Promise<WritableFile> }
export interface LocalDirectory { name: string; getDirectoryHandle(name: string, options?: { create: boolean }): Promise<LocalDirectory>; getFileHandle(name: string, options?: { create: boolean }): Promise<LocalFile> }
export function browserJobFiles(directory: LocalDirectory): JobFiles {
  async function file(path: string, create: boolean) {
    const parts = path.split('/'); if (parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '..' || p === '.')) return fail()
    let parent = directory
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create })
    return parent.getFileHandle(parts.at(-1)!, { create })
  }
  return {
    async read(path, maximumBytes) {
      try { const value = await (await file(path, false)).getFile(); if (value.size > maximumBytes) return fail('계산 파일 크기 한도를 넘었습니다. 작업 폴더를 확인해 주세요.'); return await value.text() }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
    },
    async write(path, text) {
      const writer = await (await file(path, true)).createWritable()
      try { await writer.write(text); await writer.close() } catch (error) { try { await writer.abort() } catch { /* 원래 실패를 유지한다. */ } throw error }
    },
    async exclusive(key, run) {
      if (!navigator.locks) return fail('이 브라우저에서는 로컬 계산 연결을 지원하지 않습니다. 기존 계산 파일 방식을 이용해 주세요.')
      return navigator.locks.request(`timetable-job:${key}`, run)
    },
  }
}
export function supportsLocalJobs() { return typeof window !== 'undefined' && 'showDirectoryPicker' in window && !!navigator.locks }
export async function chooseLocalJobs(): Promise<{ jobs: LocalEngineJobs; name: string }> {
  const picker = (window as unknown as { showDirectoryPicker(options: { id: string; mode: 'readwrite' }): Promise<LocalDirectory> }).showDirectoryPicker
  if (!supportsLocalJobs()) return fail('폴더 연결을 지원하는 PC 브라우저에서 이용하거나 계산 파일 방식을 사용해 주세요.')
  const directory = await picker.call(window, { id: 'school-timetable-jobs', mode: 'readwrite' })
  return { jobs: await connectLocalEngineJobs(browserJobFiles(directory)), name: directory.name }
}
