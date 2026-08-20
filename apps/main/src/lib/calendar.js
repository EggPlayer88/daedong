// 학사일정(official) + 공유 캘린더(shared) — 006_calendar.
//
// ⚠ **파생 계산(시수·수업일수)의 원천은 official 뿐이다.**
//    shared 는 교사들이 자유롭게 쓰는 메모판이라, 누가 무엇을 적든 시수가 흔들리면
//    안 된다. 이 파일에서 파생용 조회는 반드시 scope='official' 만 본다
//    (officialOnly / noClassDates). 테스트가 이 경계를 고정한다.
//
// 권한 판정은 RLS 가 한다. 화면은 버튼을 가릴 뿐이고, 데이터는 정책이 막는다.

import { supabase } from '@daedong/shared'
// 날짜 계산과 파생(수업일수·시수)은 school-days.js 가 홀로 맡는다 — 두 곳에
// 같은 산식이 있으면 한쪽만 고쳐지고 조용히 갈라진다. 여기서는 조회만 한다.
import { eachDate, iso, noClassDates } from './school-days.js'

export { eachDate, iso, noClassDates }

const TABLE = 'calendar_events'
const COLUMNS =
  'id, term_id, scope, title, event_type, labels, start_date, end_date, grades, ' +
  'no_class, description, created_by, created_at, updated_by, updated_at, deleted_at'

export const SCOPES = ['official', 'shared']
export const EVENT_TYPES = ['행사', '휴업일', '재량휴업', '고사', '마감', '수업일수조정', '기타']
export const SCOPE_LABEL = { official: '학사일정', shared: '공유' }
// 공식/공유를 한눈에 가르는 표식 — 색만으로 구분하면 흑백 인쇄·색각에서 사라진다
export const SCOPE_ICON = { official: '📌', shared: '🗒️' }

/** 살아 있는 일정만 (soft delete 제외) */
export const alive = (rows) => (rows || []).filter((r) => r && !r.deleted_at)

/** 파생 계산용 — **official 만.** shared 는 절대 섞지 않는다 */
export const officialOnly = (rows) => alive(rows).filter((r) => r.scope === 'official')

/** 그 달에 걸치는 일정 (기간 일정 포함) */
export function inMonth(rows, year, month) {
  const first = `${year}-${String(month).padStart(2, '0')}-01`
  const last = iso(new Date(year, month, 0))
  return alive(rows).filter((r) => r.start_date <= last && r.end_date >= first)
}

/** 월간 격자 — 일요일 시작 6주. 각 칸은 그날에 걸치는 일정 목록을 든다 */
export function monthGrid(rows, year, month) {
  const first = new Date(year, month - 1, 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  const events = inMonth(rows, year, month)
  const weeks = []
  for (let w = 0; w < 6; w += 1) {
    const days = []
    for (let i = 0; i < 7; i += 1) {
      const d = new Date(start)
      d.setDate(start.getDate() + w * 7 + i)
      const date = iso(d)
      days.push({
        date,
        day: d.getDate(),
        inMonth: d.getMonth() === month - 1,
        weekday: d.getDay(),
        events: events.filter((r) => r.start_date <= date && r.end_date >= date),
      })
    }
    weeks.push(days)
  }
  return weeks
}

/** 이미 쓰인 라벨 (자유 입력 + 자동완성용). 빈도 높은 것부터 */
export function knownLabels(rows) {
  const count = new Map()
  for (const r of alive(rows)) {
    for (const l of r.labels || []) {
      const t = String(l).trim()
      if (t) count.set(t, (count.get(t) || 0) + 1)
    }
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko')).map(([l]) => l)
}

export function validate(ev) {
  if (!ev?.title?.trim()) return '제목을 입력해 주세요.'
  if (!SCOPES.includes(ev.scope)) return '구분(학사일정/공유)을 골라 주세요.'
  if (!ev.start_date) return '시작일을 입력해 주세요.'
  const end = ev.end_date || ev.start_date
  if (end < ev.start_date) return '종료일이 시작일보다 빠릅니다.'
  if (ev.event_type && !EVENT_TYPES.includes(ev.event_type)) return '유형이 올바르지 않습니다.'
  if (!Array.isArray(ev.grades) || ev.grades.length === 0) return '대상 학년을 하나 이상 골라 주세요.'
  // no_class 는 파생 계산에 쓰이므로 official 에서만 의미가 있다
  if (ev.scope !== 'official' && ev.no_class) return '수업 없음 표시는 학사일정에만 쓸 수 있습니다.'
  return null
}

export async function list(termId) {
  let q = supabase.from(TABLE).select(COLUMNS).order('start_date', { ascending: true })
  if (termId) q = q.eq('term_id', termId)
  const { data, error } = await q
  return { rows: data ?? [], error }
}

export async function currentTerm() {
  const { data, error } = await supabase
    .from('academic_terms')
    .select('id, year, semester, start_date, end_date, is_current')
    .eq('is_current', true)
    .maybeSingle()
  return { term: data ?? null, error }
}

export async function create(ev, userId) {
  const bad = validate(ev)
  if (bad) return { error: new Error(bad) }
  const { error } = await supabase.from(TABLE).insert({
    term_id: ev.term_id || null,
    scope: ev.scope,
    title: ev.title.trim(),
    event_type: ev.event_type || '기타',
    labels: ev.labels || [],
    start_date: ev.start_date,
    end_date: ev.end_date || ev.start_date,
    grades: ev.grades,
    no_class: ev.scope === 'official' ? !!ev.no_class : false,
    description: ev.description?.trim() || null,
    created_by: userId,
  })
  return { error }
}

/** 수정 — 누가 고쳤는지 남긴다 (shared 는 남의 일정도 고칠 수 있다) */
export async function update(id, patch, userId) {
  const bad = validate(patch)
  if (bad) return { error: new Error(bad) }
  const { error } = await supabase
    .from(TABLE)
    .update({
      title: patch.title.trim(),
      event_type: patch.event_type || '기타',
      labels: patch.labels || [],
      start_date: patch.start_date,
      end_date: patch.end_date || patch.start_date,
      grades: patch.grades,
      no_class: patch.scope === 'official' ? !!patch.no_class : false,
      description: patch.description?.trim() || null,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
  return { error }
}

/** 삭제는 표시만 — 물리 DELETE 는 정책 자체가 없다 (실수 복구 여지) */
export async function softDelete(id, userId) {
  const { error } = await supabase
    .from(TABLE)
    .update({ deleted_at: new Date().toISOString(), updated_by: userId })
    .eq('id', id)
  return { error }
}

export async function restore(id, userId) {
  const { error } = await supabase
    .from(TABLE)
    .update({ deleted_at: null, updated_by: userId })
    .eq('id', id)
  return { error }
}

export const deletedOnly = (rows) => (rows || []).filter((r) => r?.deleted_at)
