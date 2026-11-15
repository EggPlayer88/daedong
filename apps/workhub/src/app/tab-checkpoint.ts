// 동일 탭의 새로고침 복구만 지원한다. 인증·권한 근거나 자동 실행 큐로 사용하지 않는다.
export type CheckpointChannel = 'drafts' | 'pending'
export type CheckpointItem = { slot: string; value: unknown; warn: boolean }
type SavedItem = CheckpointItem & { scope: string; channel: CheckpointChannel; savedAt: number }
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<Pick<Storage, 'key' | 'length'>>
const draftSlots = new Set(['assistant', 'assistant-operation', 'messaging-composer', 'collection-editor', 'calendar-editor', 'calendar-panel', 'calendar-browse', 'calendar-assistant-view', 'task-editor', 'task-panel'])
const pendingSlots = new Set(['assistant', 'assistantOperation', 'messaging', 'collection', 'calendar', 'task'])
const DRAFT_LIFETIME = 12 * 60 * 60 * 1000
const MAX_BYTES = 1024 * 1024
const secretField = /^(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|service[_-]?role[_-]?key|secret)$/i
const secretText = /\b(?:sk-ant-|sk-proj-|sb_secret_)[A-Za-z0-9_-]+|[?&](?:token|signature|apikey|api_key)=/i
const allowed = (channel: CheckpointChannel, slot: string) => (channel === 'drafts' ? draftSlots : pendingSlots).has(slot)

// 로그아웃 버튼에서 호출한다. 로그인·세션 판정은 기존 인증 경로가 맡는다.
export function clearTabCheckpoints(storage?: StoragePort) {
  try {
    const port = storage ?? (typeof window === 'undefined' ? undefined : window.sessionStorage)
    if (!port?.key || typeof port.length !== 'number') return
    const keys: string[] = []
    for (let i = 0; i < port.length; i++) { const key = port.key(i); if (key?.startsWith('workhub:tab-checkpoint:v1:')) keys.push(key) }
    for (const key of keys) port.removeItem(key)
  } catch { /* 브라우저 저장소가 차단돼도 기존 로그아웃은 계속 진행한다. */ }
}
const pendingValue = (slot: string, value: unknown) => {
  if (!value || typeof value !== 'object') throw Error('원 요청 형식')
  const request = value as Record<string, unknown>, command = request.command
  if (!command || typeof command !== 'object' || Array.isArray(command)) throw Error('원 명령 형식')
  const key = slot === 'calendar' ? (command as Record<string, unknown>).idempotencyKey : request.key
  if (typeof key !== 'string' || !key.length || key.length > 160) throw Error('원 요청 번호 필요')
  return jsonValue(value)
}

function jsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): unknown {
  if (++budget.nodes > 20000 || depth > 24) throw Error('복구 자료 한도')
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length <= 200000 && !secretText.test(value)) return value
  if (Array.isArray(value)) return value.map(item => jsonValue(item, depth + 1, budget))
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) throw Error('문자 입력만 보관')
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (secretField.test(key) || ['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('비밀값 보관 금지')
    if (item !== undefined) result[key] = jsonValue(item, depth + 1, budget)
  }
  return result
}

function draftValue(slot: string, value: unknown) {
  if (slot === 'assistant' && value && typeof value === 'object') {
    const { thread: _thread, studentContext: _studentContext, ...input } = value as Record<string, unknown>
    // 이전 답변·학생 원문은 다시 조회한다. 작성 중인 질문과 업무 초안만 복구한다.
    return jsonValue({ ...input, studentContext: null })
  }
  if (slot !== 'collection-editor' || !value || typeof value !== 'object') return jsonValue(value)
  // 업로드 중인 파일/선택한 원본은 브라우저가 다시 골라야 한다. 본문·대상·기한은 함께 유지한다.
  const { upload: _upload, ...rest } = value as Record<string, unknown>
  if (rest.editor && typeof rest.editor === 'object') {
    const { staged: _staged, saving: _saving, ...editor } = rest.editor as Record<string, unknown>
    // 새로고침 복원은 단계별 자동 저장을 다시 시작하지 않는다. 미확정 쓰기는 원키 복구가 맡는다.
    rest.editor = { ...editor, ...(Array.isArray(_staged) ? { staged: [] } : {}) }
  }
  return jsonValue(rest)
}

export function createTabCheckpoint(ownerId: string, storage?: StoragePort, clock: () => number = Date.now) {
  let port = storage
  try { port ??= typeof window === 'undefined' ? undefined : window.sessionStorage } catch { /* 저장 불가 브라우저는 탭 메모리만 사용한다. */ }
  const key = 'workhub:tab-checkpoint:v1:' + ownerId
  // 같은 탭에서 계정이 바뀌었으면 앞선 계정의 보관함은 즉시 지운다.
  try {
    if (port?.key && typeof port.length === 'number') {
      const remove: string[] = []
      for (let i = 0; i < port.length; i++) { const candidate = port.key(i); if (candidate?.startsWith('workhub:tab-checkpoint:v1:') && candidate !== key) remove.push(candidate) }
      for (const candidate of remove) port.removeItem(candidate)
    }
  } catch { port = undefined }
  const owned = (scope: string) => {
    try { const fields = JSON.parse(scope); return Array.isArray(fields) && fields.length === 10 && fields[0] === ownerId } catch { return false }
  }
  let disabled = false
  const listeners = new Set<() => void>()
  const unavailable = () => { if (!disabled) { disabled = true; for (const listener of listeners) listener() } }
  function clear() { try { port?.removeItem(key) } catch { unavailable() } }
  function read(): SavedItem[] {
    if (!port || disabled) return []
    try {
      const text = port.getItem(key)
      if (!text) return []
      if (text.length > MAX_BYTES) throw Error('복구 자료 한도')
      const data = JSON.parse(text)
      if (data?.version !== 1 || data.ownerId !== ownerId || !Array.isArray(data.items) || data.items.length > 48) throw Error('복구 자료 형식')
      const now = clock(), items: SavedItem[] = []
      for (const item of data.items) {
        if (!item || typeof item.scope !== 'string' || !owned(item.scope) || !['drafts', 'pending'].includes(item.channel) || !allowed(item.channel, item.slot) || typeof item.warn !== 'boolean' || !Number.isSafeInteger(item.savedAt) || item.savedAt > now + 60000) throw Error('복구 범위 불일치')
        if (item.channel === 'drafts' && now - item.savedAt > DRAFT_LIFETIME) continue
        // 미확정 원명령은 기한 경과만으로 버리지 않는다. 복원 뒤에도 서버 결과 확인이 먼저다.
        const value = item.channel === 'pending' ? pendingValue(item.slot, item.value) : draftValue(item.slot, item.value)
        if (items.some(row => row.scope === item.scope && row.channel === item.channel && row.slot === item.slot)) throw Error('복구 자료 중복')
        items.push({ ...item, value })
      }
      return items
    } catch { clear(); return [] }
  }
  function save(items: SavedItem[]) {
    if (!port || disabled) return
    try {
      if (!items.length) { clear(); return }
      const text = JSON.stringify({ version: 1, ownerId, items })
      if (text.length > MAX_BYTES) throw Error('복구 자료 한도')
      port.setItem(key, text)
    } catch { clear(); unavailable() }
  }
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    status: () => port && !disabled ? 'available' as const : 'unavailable' as const,
    read(channel: CheckpointChannel, scope: string): CheckpointItem[] {
      if (!owned(scope)) return []
      return read().filter(item => item.scope === scope && item.channel === channel).map(({ slot, value, warn }) => ({ slot, value, warn }))
    },
    write(channel: CheckpointChannel, scope: string, items: CheckpointItem[]) {
      if (!owned(scope)) return
      const kept = read().filter(item => item.scope !== scope || item.channel !== channel)
      // 빈 화면의 위치·모드만으로 다음 접속 때 복구 배너를 띄우지 않는다.
      const candidates = channel === 'drafts' && !items.some(item => item.warn && allowed(channel, item.slot)) ? [] : items
      for (const item of candidates) {
        if (!allowed(channel, item.slot)) continue
        try { kept.push({ ...item, scope, channel, savedAt: clock(), value: channel === 'drafts' ? draftValue(item.slot, item.value) : pendingValue(item.slot, item.value) }) } catch { /* 파일·비밀값·과대한 입력은 메모리에만 둔다. */ }
      }
      save(kept)
    },
    retainScopes(scopes: readonly string[]) { const keep = new Set(scopes.filter(owned)); save(read().filter(item => keep.has(item.scope))) },
    clear,
  }
}
export type TabCheckpoint = ReturnType<typeof createTabCheckpoint>
