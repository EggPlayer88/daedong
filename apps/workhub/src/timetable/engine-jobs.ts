import { buildCpSatRequest, canonicalTimetableJson, parseCpSatResponse, type CpSatRequest, type CpSatResponse } from '../../../../packages/timetable/src/cpSat'
import policy from '../../../../packages/timetable/_assets/engine-policy.json'
import jobPolicy from '../../../../packages/timetable/_assets/job-policy.json'

export const JOB_CONTRACT = 'timetable.jobs.v1' as const
export interface JobQueue { contract: typeof JOB_CONTRACT; queueId: string; createdAt: string; policyVersion: 1 }
export type JobState = 'queued' | 'running' | 'cancel_requested' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out' | 'interrupted'
export interface JobStatus { contract: typeof JOB_CONTRACT; queueId: string; requestId: string; inputHash: string; sequence: number; state: JobState; queuedAt: string; updatedAt: string; startedAt: string | null; finishedAt: string | null; code: string | null }
export interface JobWorker { contract: typeof JOB_CONTRACT; queueId: string; workerId: string; state: 'ready' | 'busy' | 'stopped'; updatedAt: string; activeRequestId: string | null }
export interface JobFiles {
  read(path: string, maximumBytes: number): Promise<string | null>
  write(path: string, text: string): Promise<void>
  exclusive<T>(key: string, run: () => Promise<T>): Promise<T>
  list(path: string): Promise<{ name: string; kind: 'file' | 'directory'; size: number }[]>
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
export function parseJobStatus(raw: unknown, queue: JobQueue, request: Pick<CpSatRequest, 'requestId' | 'inputHash'>, previous?: JobStatus): JobStatus {
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
  async function capacity(request: CpSatRequest, hasRequest: boolean) {
    const entries = await files.list('jobs')
    const ignored = (entry: { name: string; kind: string }) => entry.kind === 'file' && ['.DS_Store', 'desktop.ini', 'Thumbs.db'].includes(entry.name)
    const directories = entries.filter(entry => !ignored(entry))
    if (directories.some(entry => entry.kind !== 'directory' || !uuid(entry.name))) fail('작업 폴더 구성이 올바르지 않습니다. 전용 폴더를 확인해 주세요.')
    const present = directories.some(entry => entry.name === request.requestId)
    if (directories.length + (present ? 0 : 1) > jobPolicy.maximumRetainedJobs) fail(`보관 작업 ${jobPolicy.maximumRetainedJobs}개 한도입니다. 완료 작업을 먼저 정리해 주세요.`)
    let size = entries.reduce((sum, entry) => sum + entry.size, 0), pending = 0
    function metadata(raw: string | null): unknown {
      if (raw === null) return null
      try { return JSON.parse(raw) } catch { return null }
    }
    function identity(value: unknown, id: string, hash?: string) {
      if (!object(value)) return
      // 쓰는 중인 JSON은 대기 한 자리로 남기지만, 읽힌 식별자의 불일치는 숨기지 않는다.
      for (const [key, expected] of [['contract', JOB_CONTRACT], ['queueId', queue.queueId], ['requestId', id]]) {
        if (Object.hasOwn(value, key) && value[key] !== expected) fail()
      }
      if (Object.hasOwn(value, 'inputHash') && (typeof value.inputHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputHash) || hash !== undefined && value.inputHash !== hash)) fail()
    }
    async function directoryBytes(path: string) {
      const items = await files.list(path)
      if (items.some(item => item.kind !== 'file' || !Number.isSafeInteger(item.size) || item.size < 0)) fail('작업 폴더 안의 파일 구성을 확인해 주세요.')
      return items.reduce((sum, item) => sum + item.size, 0)
    }
    // 미접수 원본의 보존 격리는 접수 건수에서 빼되 디스크 용량에서는 빼지 않는다.
    let quarantined: Awaited<ReturnType<JobFiles['list']>> = []
    try { quarantined = await files.list('.cleanup-orphans') }
    catch (error) { if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error }
    for (const entry of quarantined) {
      if (ignored(entry)) { size += entry.size; continue }
      if (entry.kind !== 'directory' || !uuid(entry.name)) fail('보존 격리 폴더 구성이 올바르지 않습니다. 전용 폴더를 확인해 주세요.')
      if (entry.name === request.requestId) fail('보존 격리된 요청 번호는 다시 접수하지 않습니다. 원본을 확인한 뒤 화면 연결만 정리하고 새 계산 요청을 만들어 주세요.')
      size += await directoryBytes(`.cleanup-orphans/${entry.name}`)
    }
    for (const directory of directories) {
      const path = `jobs/${directory.name}`
      size += await directoryBytes(path)
      const raw = await files.read(`${path}/ready.json`, jobPolicy.maximumMetadataBytes)
      if (raw === null) continue
      const ready = metadata(raw)
      identity(ready, directory.name)
      const statusText = await files.read(`${path}/status.json`, jobPolicy.maximumMetadataBytes)
      const status = metadata(statusText)
      identity(status, directory.name, object(ready) && typeof ready.inputHash === 'string' ? ready.inputHash : undefined)
      let finished = false
      if (exact(ready, ['contract', 'queueId', 'requestId', 'inputHash', 'queuedAt']) && typeof ready.inputHash === 'string' && stamp(ready.queuedAt)) {
        // 기존 작업을 실행하거나 복구하는 검증은 완화하지 않는다. 이곳은 새 접수의 개수 계산뿐이다.
        try {
          const value = parseJobStatus(status, queue, { requestId: directory.name, inputHash: ready.inputHash })
          finished = value.queuedAt === ready.queuedAt && terminalJob(value.state)
        } catch { /* 미완성 상태는 완료로 간주하지 않고 대기 한 건으로 센다. */ }
      }
      if (!finished) pending++
    }
    if (pending >= jobPolicy.maximumPendingJobs) fail(`대기·실행 작업 ${jobPolicy.maximumPendingJobs}개 한도입니다. 기존 계산을 완료하거나 취소한 뒤 접수해 주세요.`)
    const requestBytes = new TextEncoder().encode(canonicalTimetableJson(request)).byteLength
    const added = (hasRequest ? 0 : requestBytes) + jobPolicy.maximumMetadataBytes
    const reserve = requestBytes + 2 * jobPolicy.maximumResultBytes + 4 * jobPolicy.maximumMetadataBytes
    if (size + added + reserve > jobPolicy.maximumStoreBytes) fail('계산 결과를 안전하게 보관할 용량이 부족합니다. 완료 작업을 먼저 정리해 주세요.')
  }
  const api: LocalEngineJobs = {
    queue,
    async submit(request) {
      request = structuredClone(request)
      const rebuilt = await buildCpSatRequest(request.basis, request.requestId, request.previous, request.options)
      if (canonicalTimetableJson(request) !== canonicalTimetableJson(rebuilt)) fail()
      // 요청 번호가 다른 두 탭도 같은 한도를 보고 접수하지 않도록 폴더 단위로 직렬화한다.
      await files.exclusive(`${queue.queueId}:submit`, async () => {
        await sameQueue(); const path = jobPath(request), ready = await marker(request)
        const existing = await files.read(`${path}/request.json`, policy.maximumRequestBytes)
        if (existing !== null && canonicalTimetableJson(parse(existing)) !== canonicalTimetableJson(request)) fail()
        if (ready) { if (existing === null) fail(); return }
        if (await files.read(`${path}/status.json`, 16384) !== null) fail()
        await capacity(request, existing !== null)
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
interface LocalFile { getFile(): Promise<{ size: number; lastModified: number; text(): Promise<string> }>; createWritable(): Promise<WritableFile>; isSameEntry(other: LocalFile): Promise<boolean> }
export interface LocalDirectory { name: string; getDirectoryHandle(name: string, options?: { create: boolean }): Promise<LocalDirectory>; getFileHandle(name: string, options?: { create: boolean }): Promise<LocalFile>; removeEntry(name: string): Promise<void>; entries(): AsyncIterable<[string, { kind: 'file' | 'directory' }]> }
export function browserJobFiles(directory: LocalDirectory): JobFiles {
  async function folder(path: string, create = false) {
    const parts = path.split('/'); if (parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '..' || p === '.')) return fail()
    let parent = directory
    for (const part of parts) parent = await parent.getDirectoryHandle(part, { create })
    return parent
  }
  async function file(path: string, create: boolean) {
    const parts = path.split('/'); if (parts.some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '..' || p === '.')) return fail()
    let parent = directory
    for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create })
    return parent.getFileHandle(parts.at(-1)!, { create })
  }
  return {
    async list(path) {
      const parent = await folder(path), result: { name: string; kind: 'file' | 'directory'; size: number }[] = []
      for await (const [name, entry] of parent.entries()) {
        result.push({ name, kind: entry.kind, size: entry.kind === 'file' ? (await (await parent.getFileHandle(name)).getFile()).size : 0 })
      }
      return result
    },
    async read(path, maximumBytes) {
      try { const value = await (await file(path, false)).getFile(); if (value.size > maximumBytes) return fail('계산 파일 크기 한도를 넘었습니다. 작업 폴더를 확인해 주세요.'); return await value.text() }
      catch (error) { if (error instanceof DOMException && error.name === 'NotFoundError') return null; throw error }
    },
    async write(path, text) {
      const parts = path.split('/'), name = parts.pop()!
      if (!/^[A-Za-z0-9_.-]+$/.test(name) || name === '..' || name === '.') return fail()
      const parent = parts.length ? await folder(parts.join('/'), true) : directory
      let target: LocalFile, created = false, writer: WritableFile | undefined, emptyVersion: number | undefined
      try { target = await parent.getFileHandle(name) }
      catch (error) {
        if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error
        target = await parent.getFileHandle(name, { create: true }); created = true
      }
      try {
        if (created) { const initial = await target.getFile(); if (initial.size === 0) emptyVersion = initial.lastModified }
        writer = await target.createWritable()
        await writer.write(text); await writer.close()
      } catch (error) {
        try { await writer?.abort() } catch { /* 원래 실패를 유지한다. */ }
        if (created && emptyVersion !== undefined) {
          try {
            const current = await parent.getFileHandle(name), value = await current.getFile()
            // 원래 있던 빈 파일이나 다른 작업자가 완성·교체한 파일은 삭제하지 않는다.
            if (value.size === 0 && value.lastModified === emptyVersion && await target.isSameEntry(current)) await parent.removeEntry(name)
          } catch { /* 정리 실패도 원래 요청의 쓰기 실패로 남긴다. */ }
        }
        throw error
      }
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
