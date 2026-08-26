// 평가계획서 제출·수합 (005_doc_submissions).
//
// 교사는 자기 것만, 수합 담당자(admin·superadmin)는 전체를 본다 — 판정은 RLS 가 한다.
// 프론트에서 역할로 다시 거르지 않는다: 두 곳에서 거르면 한쪽이 바뀔 때 조용히 어긋난다.

import { supabase } from '@daedong/shared'

const TABLE = 'doc_submissions'
const BUCKET = 'submissions'
const COLUMNS = 'id, user_id, year, semester, subject, grade, file_name, file_path, note, status, submitted_at'

// 수합 대상에서 빠지는 상태. 행은 남지만 '낸 것'으로 세지 않는다 (007).
//   replaced = 같은 교과·학년을 다시 냈다 / deleted = 제출을 취소해 파일을 지웠다
// ⚠ 목록에서 숨기지 않는다 — 무엇을 언제 냈다 물렸는지가 곧 수합 이력이다
export const GONE_STATUSES = ['replaced', 'deleted']

/** 지금 수합 대상인 제출인가 (status NOT IN ('replaced','deleted')) */
export function isLive(row) {
  return !GONE_STATUSES.includes(row?.status)
}

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

/**
 * storage 경로 규약: {user_id}/{uuid}.hwpx
 *
 * ⚠ 키에 원본 파일명을 넣지 않는다. Supabase Storage 키는 ASCII 안전 문자만 받아
 * 한글 파일명이 들어가면 "Invalid key" 로 업로드 자체가 막힌다 — 평가계획서 파일명은
 * 전부 한글이므로 그게 곧 제출 기능 전체의 차단이었다.
 * 원본 이름은 doc_submissions.file_name 에 남고, 표시·다운로드는 그 값으로 한다.
 */
export function storagePath(userId) {
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `${userId}/${uuid}${ACCEPT}`
}

/**
 * 다운로드 시 붙일 파일명 — 원본 한글 이름 그대로 내려받게 한다.
 * 헤더(Content-Disposition)를 깨뜨리는 문자만 걷어낸다. 이름을 못 쓰겠으면 null 을
 * 돌려주고 기본 이름으로 내려받게 둔다 (지어내지 않는다).
 */
export function downloadName(fileName) {
  const safe = String(fileName || '')
    .replace(/[\\/\x00-\x1f\x7f"]/g, '')
    .trim()
  return safe || null
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

  const path = storagePath(userId)
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

/**
 * 다운로드용 임시 URL (비공개 버킷).
 * 키에는 파일명이 없으므로 download 옵션으로 원본 이름을 붙인다 — 그러지 않으면
 * 교사가 받는 파일이 uuid.hwpx 가 된다.
 */
export async function downloadUrl(path, fileName, seconds = 60) {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, seconds)
  let url = data?.signedUrl || null
  const name = downloadName(fileName)
  // ⚠ createSignedUrl 의 download 옵션을 쓰지 않는다 — storage-js 가 URLSearchParams 로
  // 인코딩한 뒤 URL 전체에 encodeURI 를 한 번 더 걸어 '%' 가 '%25' 가 된다.
  // 그러면 한글 이름이 '%EC%88%98...hwpx' 라는 글자 그대로 내려온다. 한 번만 인코딩해 붙인다.
  if (url && name) url += `${url.includes('?') ? '&' : '?'}download=${encodeURIComponent(name)}`
  return { url, error }
}

/**
 * 제출 취소 / 담당자 삭제 — 행은 남기고 파일 실물만 지운다 (007).
 *
 * 순서: 행을 deleted 로 먼저 넘기고 그 다음 파일을 지운다.
 * 파일 삭제가 실패해도 목록상 취소는 이미 성립하고, 남은 고아 파일은 재시도로 치운다.
 * 반대 순서면 파일은 없는데 목록엔 '제출됨' 으로 남는 구간이 생긴다 — 그쪽이 더 나쁘다.
 *
 * ⚠ 행을 지우지 않는다 (UPDATE 다). 005 의 "물리 DELETE 금지" 와 충돌하지 않는다.
 */
export async function cancelSubmission(row) {
  if (!row?.id) return { error: new Error('취소할 제출을 찾지 못했습니다.') }

  // .select() 로 되돌아온 행을 센다 — RLS 가 막으면 postgrest 는 에러 없이 0행을 준다.
  // 그걸 성공으로 보면 화면만 지워지고 DB 는 그대로인 조용한 거짓말이 된다
  const { data, error } = await supabase
    .from(TABLE)
    .update({ status: 'deleted' })
    .eq('id', row.id)
    .select('id')
  if (error) return { error }
  if (!data?.length) {
    return { error: new Error('삭제 권한이 없습니다 (본인 제출 또는 수합 담당자만 가능합니다).') }
  }

  const rm = await removeFile(row.file_path)
  return { error: null, orphan: rm.orphan, fileError: rm.error }
}

/**
 * 파일 실물 삭제. 지워졌는지까지 확인한다 —
 * Storage 는 정책에 막혀도 에러 없이 0건을 돌려주므로 결과 건수만 믿으면 안 된다.
 */
export async function removeFile(path) {
  if (!path) return { orphan: false, error: null }
  const { data, error } = await supabase.storage.from(BUCKET).remove([path])
  if (!error && data?.length) return { orphan: false, error: null }

  // 0건일 때: 이미 없어서인지, 못 지운 것인지 목록으로 확인한다 (추측하지 않는다)
  const still = await fileExists(path)
  if (still === false) return { orphan: false, error: null }
  return {
    orphan: true,
    error: error || new Error('파일을 지우지 못했습니다. 잠시 뒤 재시도해 주세요.'),
  }
}

/** 실물이 남아 있는가. 확인 자체가 실패하면 null — 모르면 모른다고 한다 */
async function fileExists(path) {
  const cut = String(path).lastIndexOf('/')
  const folder = cut > 0 ? path.slice(0, cut) : ''
  const name = cut > 0 ? path.slice(cut + 1) : path
  const { data, error } = await supabase.storage.from(BUCKET).list(folder, { search: name })
  if (error) return null
  return (data || []).some((o) => o?.name === name)
}

/**
 * 제출 현황 매트릭스 — 학년 × 교과.
 * 교과 목록은 prefill 색인에서 온다 (학교가 실제로 내는 과목이 거기 있다).
 */
export function buildMatrix(rows, catalog) {
  const live = (rows || []).filter((r) => r && isLive(r))
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
