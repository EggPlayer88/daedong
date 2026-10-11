// 합성 자료 전용 저장소. 로그인 세션이나 실제 학교 자료를 저장하지 않는다.
const STORAGE_KEY = 'workhub:synthetic:v2:workspace'
const SECTIONS = ['calendar', 'workflows', 'students'] as const
export type DemoSection = typeof SECTIONS[number]
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export class DemoStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'DemoStorageError' }
}

export function createDemoPersistence(storage?: StoragePort) {
  let observedRevision: number | undefined
  type Envelope = { schema: 2; kind: 'synthetic-only'; revision: number; sections: Partial<Record<DemoSection, unknown>> }
  function read(): Envelope {
    const empty: Envelope = { schema: 2, kind: 'synthetic-only', revision: 0, sections: {} }
    if (!storage) return empty
    let raw: string | null
    try { raw = storage.getItem(STORAGE_KEY) } catch { throw new DemoStorageError('브라우저 저장소를 읽을 수 없습니다. 저장 내용을 지우지 않고 중단했습니다.') }
    if (raw === null) return empty
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.schema !== 2 || parsed.kind !== 'synthetic-only' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1 || !parsed.sections || typeof parsed.sections !== 'object' || Array.isArray(parsed.sections) || Object.keys(parsed.sections).some(key => !(SECTIONS as readonly string[]).includes(key))) throw new Error()
      return parsed
    } catch { throw new DemoStorageError('개발 자료의 형식을 읽을 수 없습니다. 원본을 유지했습니다. 합성 자료를 내보낸 뒤 초기화할 수 있습니다.') }
  }
  function current() {
    const value = read()
    if (observedRevision !== undefined && value.revision !== observedRevision) throw new DemoStorageError('다른 창에서 자료가 바뀌었습니다. 입력은 유지했습니다. 새로고침 후 다시 확인해 주세요.')
    observedRevision = value.revision
    return value
  }
  function write(sections: Envelope['sections'], revision: number) {
    if (!storage) return
    // 세 영역을 한 키로 저장해 일괄 초기화도 하나의 setItem 성공에 맞춰 확정한다.
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 2, kind: 'synthetic-only', revision, sections })) }
    catch { throw new DemoStorageError('브라우저에 저장하지 못했습니다. 용량·저장 설정을 확인해 주세요. 이번 변경은 확정하지 않았습니다.') }
    observedRevision = revision
  }
  return {
    persistent: Boolean(storage),
    load(section: DemoSection): unknown {
      return current().sections[section]
    },
    save(section: DemoSection, data: unknown) {
      if (!storage) return
      const value = current()
      write({ ...value.sections, [section]: data }, value.revision + 1)
    },
    replaceAll(sections: Envelope['sections']) {
      const value = current()
      write(sections, value.revision + 1)
    },
    exportRaw(): string {
      return JSON.stringify({ kind: 'synthetic-only-recovery', workspace: storage?.getItem(STORAGE_KEY) ?? null }, null, 2)
    },
    clear() {
      // auth 저장키 및 다른 앱 자료에는 접근하지 않는다.
      try { storage?.removeItem(STORAGE_KEY) }
      catch { throw new DemoStorageError('개발 자료를 초기화하지 못했습니다. 기존 자료를 유지했습니다.') }
      observedRevision = undefined
    },
  }
}

export type DemoPersistence = ReturnType<typeof createDemoPersistence>
export type DemoLease = { status: 'persistent' | 'memory' | 'busy'; release: () => void }

// localStorage의 탭 간 read/modify/write 경합을 피하려고 미리보기 한 창만 쓰기를 소유한다.
// Web Locks가 없는 환경은 영속 쓰기를 하지 않는다. CAS만으로 원자성을 주장하지 않는다.
export async function acquireDemoLease(locks?: LockManager): Promise<DemoLease> {
  if (!locks) return { status: 'memory', release() {} }
  return new Promise(resolve => {
    let finish: () => void = () => {}
    const held = new Promise<void>(release => { finish = release })
    void locks.request('workhub-synthetic-v2-writer', { ifAvailable: true }, async lock => {
      if (!lock) { resolve({ status: 'busy', release() {} }); return }
      resolve({ status: 'persistent', release: finish })
      await held
    }).catch(() => resolve({ status: 'memory', release() {} }))
  })
}
