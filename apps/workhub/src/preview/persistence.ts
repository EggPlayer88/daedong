// 합성 자료 전용 저장소. 학생·활동 기록은 이 인스턴스의 메모리에만 보관한다.
const STORAGE_KEY = 'workhub:synthetic:v3:workspace'
const LEGACY_STORAGE_KEY = 'workhub:synthetic:v2:workspace'
const SECTIONS = ['calendar', 'workflows', 'students'] as const
export type DemoSection = typeof SECTIONS[number]
type PersistentSection = Exclude<DemoSection, 'students'>
export type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
export class DemoStorageError extends Error {
  constructor(message: string) { super(message); this.name = 'DemoStorageError' }
}

export function createDemoPersistence(storage?: StoragePort) {
  let observedRevision: number | undefined
  let students: unknown
  type Sections = Partial<Record<DemoSection, unknown>>
  type Envelope = { schema: 3; kind: 'synthetic-only'; revision: number; sections: Partial<Record<PersistentSection, unknown>> }
  function persistentSections(sections: Sections): Envelope['sections'] {
    return { ...(sections.calendar === undefined ? {} : { calendar: sections.calendar }), ...(sections.workflows === undefined ? {} : { workflows: sections.workflows }) }
  }
  function read(): Envelope {
    const empty: Envelope = { schema: 3, kind: 'synthetic-only', revision: 0, sections: {} }
    if (!storage) return empty
    let raw: string | null
    let legacy = false
    try {
      raw = storage.getItem(STORAGE_KEY)
      if (raw === null) { legacy = true; raw = storage.getItem(LEGACY_STORAGE_KEY) }
    } catch { throw new DemoStorageError('브라우저 저장소를 읽을 수 없습니다. 저장 내용을 지우지 않고 중단했습니다.') }
    if (raw === null) return empty
    try {
      const parsed = JSON.parse(raw)
      if (!parsed || parsed.schema !== (legacy ? 2 : 3) || parsed.kind !== 'synthetic-only' || !Number.isSafeInteger(parsed.revision) || parsed.revision < 1 || !parsed.sections || typeof parsed.sections !== 'object' || Array.isArray(parsed.sections) || Object.keys(parsed.sections).some(key => !(SECTIONS as readonly string[]).includes(key))) throw new Error()
      // 구버전의 학생 자료는 자동으로 열거나 새 저장키에 복사하지 않는다.
      // 구버전 원본은 그대로 두어 필요할 때 사용자가 명시적으로 내보낼 수 있다.
      return { schema: 3, kind: 'synthetic-only', revision: parsed.revision, sections: persistentSections(parsed.sections) }
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
    // 영속 허용 영역만 새 키에 쓴다. 기존 v2 자료와 로그인 키는 수정하지 않는다.
    try { storage.setItem(STORAGE_KEY, JSON.stringify({ schema: 3, kind: 'synthetic-only', revision, sections: persistentSections(sections) })) }
    catch { throw new DemoStorageError('브라우저에 저장하지 못했습니다. 용량·저장 설정을 확인해 주세요. 이번 변경은 확정하지 않았습니다.') }
    observedRevision = revision
  }
  return {
    persistent: Boolean(storage),
    load(section: DemoSection): unknown {
      if (section === 'students') return students
      return current().sections[section]
    },
    save(section: DemoSection, data: unknown) {
      if (section === 'students') { students = data; return }
      if (!storage) return
      const value = current()
      write({ ...value.sections, [section]: data }, value.revision + 1)
    },
    replaceAll(sections: Sections) {
      const value = current()
      write(persistentSections(sections), value.revision + 1)
      students = sections.students
    },
    exportRaw(): string {
      // 현재 학생 메모리는 내보내지 않는다. 이전 버전 원본 복구는 명시적 다운로드만 허용한다.
      return JSON.stringify({ kind: 'synthetic-only-recovery', workspace: storage?.getItem(STORAGE_KEY) ?? null, legacyWorkspace: storage?.getItem(LEGACY_STORAGE_KEY) ?? null }, null, 2)
    },
    clear() {
      // 빈 v3를 남겨 초기화 뒤 v2 일정/업무가 다시 자동 복원되지 않게 한다.
      // 복구 대상 v2 원본, auth 저장키와 다른 앱 자료는 삭제하지 않는다.
      let revision = (observedRevision ?? 0) + 1
      try { revision = Math.max(read().revision, observedRevision ?? 0) + 1 } catch { /* 명시적 초기화는 손상된 봉투를 읽지 못해도 진행한다. */ }
      try { write({}, revision) }
      catch { throw new DemoStorageError('개발 자료를 초기화하지 못했습니다. 기존 자료를 유지했습니다.') }
      students = undefined
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
