import type { CalendarAdapter } from '../calendar/contracts'
import type { CollectionServer } from '../collections/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { ContractError, type Membership } from '../contracts'
import type { CooperationAdapter } from '../cooperation/contracts'
import type { DocumentsService } from '../documents/adapter'
import { activeAt } from '../domain'
import type { KnowledgeService } from '../knowledge/adapter'
import type { MessagingServer } from '../messaging/contracts'
import type { TaskAdapter } from '../tasks/contracts'
import type { TeachingAdapter } from '../teaching/contracts'
import { recoveryScope } from '../app/pending-requests'
import type { SearchItem, SearchKind, SearchLoadOptions, SearchPage, SearchSource } from './contracts'
import { SEARCH_LIMITS } from './limits'
import { calendarSearchSource, menuSearchSource, taskSearchSource } from './sources'

type Reader<T> = () => Promise<T>
export interface SearchReaders {
  collections: Reader<Pick<CollectionServer, 'list'>>
  documents: Reader<Pick<DocumentsService, 'list'>>
  knowledge: Reader<Pick<KnowledgeService, 'list'>>
  cooperation: Reader<Pick<CooperationAdapter, 'list'>>
  messages: Reader<Pick<MessagingServer, 'threads'>>
  teaching: Reader<Pick<TeachingAdapter, 'catalog'>>
}

const invalid = () => new ContractError('INVALID_INPUT', '검색어와 조회 범위를 다시 확인해 주세요.')
const invalidPage = () => new ContractError('QUERY_FAILED', '검색 목록의 범위를 확인하지 못했습니다. 다시 검색해 주세요.')
const cancelled = () => new ContractError('CANCELLED', '계정 또는 학교가 바뀌어 이전 검색 결과를 닫았습니다.')
function queryValue(options?: SearchLoadOptions): string {
  const raw = options?.query ?? ''
  if (typeof raw !== 'string' || raw.length > SEARCH_LIMITS.queryChars || /[\u0000-\u001f\u007f\u0085]|[\uD800-\uDFFF]/u.test(raw)) throw invalid()
  return raw.normalize('NFC').trim()
}
function serverCursor(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= 2048)
}

// 여러 함의 다음 쪽을 한 번에 표시하되 끝난 함은 다시 읽지 않는다. 커서는 검색어·학교에 묶는다.
function cursors(options: SearchLoadOptions | undefined, kind: SearchKind, member: Membership, query: string, count: number): (string | null)[] | null {
  const raw = options?.cursor
  if (raw === undefined || raw === null) return null
  if (typeof raw !== 'string' || !raw || raw.length > SEARCH_LIMITS.cursorChars) throw invalid()
  let value: Record<string, unknown>
  try { value = JSON.parse(raw) } catch { throw invalid() }
  if (!value || Array.isArray(value) || typeof value !== 'object' || Object.keys(value).sort().join(',') !== 'kind,member,parts,query,school,v'
    || value.v !== 1 || value.kind !== kind || value.member !== member.id || value.school !== member.schoolId || value.query !== query
    || !Array.isArray(value.parts) || value.parts.length !== count || !value.parts.every(serverCursor) || value.parts.every(part => part === null)) throw invalid()
  return value.parts as (string | null)[]
}
function nextCursor(kind: SearchKind, member: Membership, query: string, parts: (string | null)[]): string | null {
  if (!parts.every(serverCursor)) throw invalidPage()
  if (parts.every(part => part === null)) return null
  const cursor = JSON.stringify({ v: 1, kind, member: member.id, school: member.schoolId, query, parts })
  if (cursor.length > SEARCH_LIMITS.cursorChars) throw invalidPage()
  return cursor
}
function page<T>(raw: { items: T[]; nextCursor: string | null }, previous?: string | null): { items: T[]; nextCursor: string | null } {
  if (!raw || !Array.isArray(raw.items) || raw.items.length > SEARCH_LIMITS.pageItems || !serverCursor(raw.nextCursor)
    || (raw.nextCursor !== null && raw.nextCursor === previous)) throw invalidPage()
  return raw
}
// 원문 전체를 검색 화면 메모리에 복제하지 않는다. 정밀 검색은 기존 목록 RPC의 query를 사용한다.
export function searchExcerpt(body: string, query: string): string {
  const value = body.normalize('NFC').replace(/\s+/gu, ' ').trim()
  const phrase = query.replace(/\s+/gu, ' ').trim()
  const at = phrase ? value.toLocaleLowerCase('ko').indexOf(phrase.toLocaleLowerCase('ko')) : 0
  let start = Math.max(0, at - 48)
  // UTF-16 위치가 이모지의 뒤쪽 코드에 걸려도 잘린 서로게이트를 만들지 않는다.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(value[start])) start--
  const excerpt = Array.from(value.slice(start)).slice(0, 320).join('')
  return `${start ? '…' : ''}${excerpt}${start + excerpt.length < value.length ? '…' : ''}`
}
const sourceStatus = { draft: '초안', published: '게시', retired: '종료 자료' }
const documentStatus = { draft: '초안', confirmed: '확정', archived: '보관' }
const cooperationStatus = { requested: '응답 대기', accepted: '진행 중', declined: '반려', completion_requested: '완료 확인 대기', completed: '완료 확인됨', cancelled: '취소됨' }

// 목록 전용 포트다. 상세 본문·학생·상담·읽음 쓰기·파일 다운로드·AI 호출은 포함하지 않는다.
export function createModuleSearchSources(member: Membership, date: string, readers: SearchReaders, assertCurrent: () => void = () => {}): SearchSource[] {
  function guard(options?: SearchLoadOptions) {
    if (options?.signal?.aborted) throw cancelled()
    if (!activeAt(member, date)) throw new ContractError('INACTIVE_MEMBERSHIP', '현재 이용 가능한 학교 소속을 확인해 주세요.')
    assertCurrent()
  }
  function source(kind: SearchKind, label: string, coverage: string, count: number,
    load: (query: string, previous: (string | null)[] | null, check: () => void) => Promise<{ items: SearchItem[]; parts: (string | null)[]; scanned: number }>): SearchSource {
    return { kind, label, async load(options): Promise<SearchPage> {
      guard(options)
      const query = queryValue(options), previous = cursors(options, kind, member, query, count)
      const value = await load(query, previous, () => guard(options))
      guard(options)
      return { items: value.items, nextCursor: nextCursor(kind, member, query, value.parts), coverage, scanned: value.scanned }
    } }
  }
  return [
    source('collection', '자료 수합', '수합 제목·안내 · 조회한 목록에서 검색하며 다음 목록은 더 보기', 1, async (_query, previous, check) => {
      const server = await readers.collections(); check()
      const value = page(await server.list(member.id, previous?.[0] ?? undefined), previous?.[0]); check()
      return { scanned: value.items.length, parts: [value.nextCursor], items: value.items.map(request => ({
        kind: 'collection', id: request.id, title: request.title, description: request.instructions, date: request.dueDate,
        meta: `${request.dueDate}까지 · ${request.status === 'draft' ? '요청 초안' : '공개된 수합'} · ${request.managerMemberId === member.id ? '내가 만든 수합' : '참여하는 수합'}`,
      })) }
    }),
    source('document', '문서함', '현재·보관 일반 문서 · 자료 검색은 제목·본문의 입력 문구, 화면 필터는 제목·요약 · 학생 기록 문서 제외', 2, async (query, previous, check) => {
      const service = await readers.documents(); check()
      const values = await Promise.all([false, true].map(async (archived, index) => {
        if (previous && previous[index] === null) return { items: [], nextCursor: null }
        const value = page(await service.list(member.id, query, archived, previous?.[index] ?? null), previous?.[index]); check(); return value
      }))
      return { scanned: values.reduce((sum, value) => sum + value.items.length, 0), parts: values.map(value => value.nextCursor),
        items: values.flatMap(value => value.items.filter(document => document.kind !== 'student_record' && document.studentContext === null).map(document => ({
          kind: 'document', id: document.id, title: document.title, description: searchExcerpt(document.body, query), version: document.version, date: document.basisDate,
          meta: `${documentStatus[document.status]} · v${document.version} · ${document.visibility === 'private' ? '개인 문서' : '학교 공유'}`,
        }))) }
    }),
    source('knowledge', '학교 자료', '현재 판 제목·원문·위치 · 자료 검색은 입력 문구, 화면 필터는 제목·요약 · 과거 판은 자료에서 열기', 1, async (query, previous, check) => {
      const service = await readers.knowledge(); check()
      const value = page(await service.list(member.id, query, previous?.[0] ?? null), previous?.[0]); check()
      return { scanned: value.items.length, parts: [value.nextCursor], items: value.items.map(item => ({
        kind: 'knowledge', id: item.id, title: item.title, description: searchExcerpt(item.body, query), version: item.version, locator: item.locator,
        date: item.effectiveFrom, searchValues: [item.locator, item.effectiveThrough],
        meta: `${sourceStatus[item.status]} · v${item.version} · ${item.locator} · ${item.effectiveFrom}${item.effectiveThrough ? ` ~ ${item.effectiveThrough}` : '부터'}`,
      })) }
    }),
    source('cooperation', '협업 요청', '내가 받은·보낸 요청 제목·내용의 입력 문구 · 각 목록은 더 보기로 이어서 조회', 2, async (query, previous, check) => {
      const adapter = await readers.cooperation(); check()
      const values = await Promise.all((['received', 'sent'] as const).map(async (box, index) => {
        if (previous && previous[index] === null) return { items: [], nextCursor: null }
        const value = page(await adapter.list(member.id, { box, query, status: 'all', cursor: previous?.[index] ?? null }), previous?.[index]); check(); return value
      }))
      return { scanned: values.reduce((sum, value) => sum + value.items.length, 0), parts: values.map(value => value.nextCursor),
        items: values.flatMap(value => value.items.map(request => ({
          kind: 'cooperation', id: request.id, title: request.title, description: request.description, date: request.dueDate || undefined,
          searchValues: [request.senderName, request.recipientName],
          meta: `${cooperationStatus[request.status]} · ${request.senderName} → ${request.recipientName}${request.dueDate ? ` · ${request.dueDate}까지` : ''}`,
        }))) }
    }),
    source('message', '대화', '참여 중인 대화 제목·다른 참여자 이름 · 메시지 본문과 첨부는 검색하지 않음', 1, async (query, previous, check) => {
      const server = await readers.messages(); check()
      const value = page(await server.threads(member.id, query, false, previous?.[0] ?? undefined), previous?.[0]); check()
      return { scanned: value.items.length, parts: [value.nextCursor], items: value.items.map(thread => {
        const names = thread.participants.filter(participant => participant.memberId !== member.id).map(participant => participant.name)
        return { kind: 'message', id: thread.id, title: thread.title || names.join(', ') || '대화', description: names.join(' · '),
          meta: `${thread.kind === 'direct' ? '1:1 대화' : '그룹 대화'} · 안 읽은 메시지 ${thread.unreadCount}개`, searchValues: names }
      }) }
    }),
    source('course', '수업', '현재 열람 가능한 수업 목록의 수업명·교과·학기 · 학생 명단·평가·상담은 검색하지 않음', 0, async (_query, _previous, check) => {
      const adapter = await readers.teaching(); check()
      const catalog = await adapter.catalog(member.id); check()
      const terms = new Map(catalog.terms.map(term => [term.id, term.label])), subjects = new Map(catalog.subjects.map(subject => [subject.id, subject.label]))
      return { scanned: catalog.courses.length, parts: [], items: catalog.courses.map(course => ({
        kind: 'course', id: course.id, title: course.label, description: [subjects.get(course.subjectId), terms.get(course.termId)].filter(Boolean).join(' · '),
        date: course.validFrom, searchValues: [course.validThrough], meta: `${course.validFrom} ~ ${course.validThrough}`,
      })) }
    }),
  ]
}

export interface ConnectedSearchOptions { calendarAdapter: CalendarAdapter; taskAdapter: TaskAdapter; collectionServer: CollectionServer }
export function createConnectedSearchSources(connection: SupabaseConnection, member: Membership, date: string, options: ConnectedSearchOptions): SearchSource[] {
  const originalScope = recoveryScope(member)
  const current = () => {
    const context = connection.info(), active = context.memberships.find(item => item.id === member.id)
    if (!active || !activeAt(active, context.basisDate) || !context.schools.some(school => school.id === member.schoolId) || recoveryScope(active) !== originalScope) throw cancelled()
  }
  // 코드는 지연 로딩하고 조회 어댑터는 요청마다 만든다. 대화 목록 캐시를 닫힌 검색 밖에 보관하지 않는다.
  // 동적 import는 런타임이 재사용하며 유료 AI를 시작하지 않는다.
  const lazy = <T,>(load: () => Promise<T>): Reader<T> => load
  const readers: SearchReaders = {
    collections: async () => options.collectionServer,
    documents: lazy(() => import('../documents/adapter').then(module => module.createDocumentsService(connection))),
    knowledge: lazy(() => import('../knowledge/adapter').then(module => module.createKnowledgeService(connection))),
    cooperation: lazy(() => import('../cooperation/adapter').then(module => module.createCooperationAdapter(connection))),
    messages: lazy(() => import('../messaging/supabase-messaging').then(module => module.createSupabaseMessagingServer(connection))),
    teaching: lazy(() => import('../teaching/adapter').then(module => module.createTeachingAdapter(connection))),
  }
  return [menuSearchSource('connected'), calendarSearchSource(options.calendarAdapter, member, date), taskSearchSource(options.taskAdapter, member, date),
    ...createModuleSearchSources(member, date, readers, current)]
}
