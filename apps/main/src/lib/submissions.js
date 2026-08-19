// 평가계획서 제출·수합 (005_doc_submissions).
//
// 교사는 자기 것만, 수합 담당자(admin·superadmin)는 전체를 본다 — 판정은 RLS 가 한다.
// 프론트에서 역할로 다시 거르지 않는다: 두 곳에서 거르면 한쪽이 바뀔 때 조용히 어긋난다.

import { supabase } from '@daedong/shared'

const TABLE = 'doc_submissions'
const BUCKET = 'submissions'
const COLUMNS = 'id, user_id, year, semester, subject, grade, file_name, file_path, note, status, submitted_at'

// hwpx 만. 30MB — 참고자료 첨부(extract)와 같은 상한이면 교사가 규칙을 하나만 기억한다
export const MAX_BYTES = 30 * 1024 * 1024
export const ACCEPT = '.hwpx'

/** 파일명에서 교과·학년을 짐작한다 (생성물 파일명 규약 기준). 틀려도 교사가 고친다 */
export function guessFromFilename(name, subjects = []) {
  const base = String(name || '').replace(/\.hwpx$/i, '')
  // ⚠ "2026학년도" 의 6 을 학년으로 읽으면 안 된다 — '학년도' 를 제외하고 1~3 만 본다
  const grade = /([1-3])\s*학년(?!도)/.exec(base)?.[1]
  // 긴 이름 먼저 — '기술가정' 이 '기술' 에 먹히지 않게
  const sorted = [...subjects].sort((a, b) => b.length - a.length)
  const norm = (x) => String(x).replace(/[\s·・･ㆍ]/g, '')
  const subject = sorted.find((s) => norm(base).includes(norm(s))) || ''
  return { subject, grade: grade ? Number(grade) : null }
}

/** storage 경로 규약: {user_id}/{uuid}_{원본파일명} */
export function storagePath(userId, fileName) {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  // 경로 조작·인코딩 사고를 막는다 (슬래시가 들어오면 폴더가 갈린다)
  const safe = String(fileName || 'plan.hwpx').replace(/[\\/\x00-\x1f]/g, '_')
  return `${userId}/${uuid}_${safe}`
}

export function validateFile(file) {
  if (!file) return '파일을 선택해 주세요.'
  if (!/\.hwpx$/i.test(file.name)) return 'hwpx 파일만 제출할 수 있습니다.'
  if (file.size > MAX_BYTES) {
    return `파일이 너무 큽니다 (${(file.size / 1024 / 1024).toFixed(1)}MB / 최대 ${MAX_BYTES / 1024 / 1024}MB).`
  }
  return null
}

/** 내 제출 목록 (최신순) */
export async function listMine(userId) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
  return { rows: data ?? [], error }
}

/** 전체 목록 — RLS 가 허용할 때만 행이 온다 (담당자) */
export async function listAll(year, semester) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(COLUMNS)
    .eq('year', year)
    .eq('semester', semester)
    .order('submitted_at', { ascending: false })
  return { rows: data ?? [], error }
}

/**
 * 제출. 같은 교과·학년의 기존 제출은 'replaced' 로 넘기고 새 행을 만든다.
 * ⚠ 옛 행을 지우지 않는다 — 무엇을 언제 냈는지가 수합 기록이다.
 */
export async function submit({ userId, file, subject, grade, note, year = 2026, semester = 2 }) {
  const bad = validateFile(file)
  if (bad) return { error: new Error(bad) }
  if (!userId) return { error: new Error('로그인이 필요합니다.') }
  if (!subject?.trim()) return { error: new Error('교과를 입력해 주세요.') }
  if (![1, 2, 3].includes(Number(grade))) return { error: new Error('학년을 1~3 중에서 골라 주세요.') }

  const path = storagePath(userId, file.name)
  const up = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: 'application/haansofthwpx', upsert: false })
  if (up.error) return { error: up.error }

  // 파일이 올라간 뒤에 행을 만든다 — 행만 있고 파일이 없는 상태를 만들지 않는다
  const { error: insErr } = await supabase.from(TABLE).insert({
    user_id: userId,
    year,
    semester,
    subject: subject.trim(),
    grade: Number(grade),
    file_name: file.name,
    file_path: path,
    note: note?.trim() || null,
  })
  if (insErr) {
    // 행을 못 만들었으면 올린 파일도 치운다 (고아 파일 방지)
    await supabase.storage.from(BUCKET).remove([path])
    return { error: insErr }
  }

  // 새 행이 생긴 뒤에 옛 행을 넘긴다 — 순서가 반대면 잠깐 '제출 없음' 상태가 된다
  const { error: repErr } = await supabase
    .from(TABLE)
    .update({ status: 'replaced' })
    .eq('user_id', userId)
    .eq('year', year)
    .eq('semester', semester)
    .eq('subject', subject.trim())
    .eq('grade', Number(grade))
    .eq('status', 'submitted')
    .neq('file_path', path)
  return { error: repErr || null }
}

/** 다운로드용 임시 URL (비공개 버킷) */
export async function downloadUrl(path, seconds = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  return { url: data?.signedUrl || null, error }
}

/**
 * 제출 현황 매트릭스 — 학년 × 교과.
 * 교과 목록은 prefill 색인에서 온다 (학교가 실제로 내는 과목이 거기 있다).
 */
export function buildMatrix(rows, catalog) {
  const live = (rows || []).filter((r) => r?.status === 'submitted')
  const key = (g, s) => `${g}|${s}`
  const byKey = new Map(live.map((r) => [key(r.grade, r.subject), r]))
  const grades = [...new Set(catalog.map((c) => c.grade))].sort((a, b) => a - b)
  const subjects = [...new Set(catalog.map((c) => c.subject))].sort((a, b) =>
    a.localeCompare(b, 'ko')
  )
  const cells = subjects.map((subject) => ({
    subject,
    byGrade: grades.map((grade) => ({
      grade,
      expected: catalog.some((c) => c.grade === grade && c.subject === subject),
      row: byKey.get(key(grade, subject)) || null,
    })),
  }))
  const expected = catalog.length
  const done = catalog.filter((c) => byKey.has(key(c.grade, c.subject))).length
  // 목록에 없는 교과가 제출될 수 있다 (신설 과목 등) — 숨기지 않고 따로 센다
  const extra = live.filter((r) => !catalog.some((c) => c.grade === r.grade && c.subject === r.subject))
  return { grades, cells, expected, done, extra }
}
