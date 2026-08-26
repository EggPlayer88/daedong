// 평가계획 제출·수합 (005_doc_submissions).
//
// 지키는 것:
//   · 파일 규칙(hwpx·30MB)과 storage 경로 규약
//   · 재제출은 옛 행을 지우지 않고 'replaced' 로 넘긴다 (수합 기록이다)
//   · 제출 현황 매트릭스가 prefill 목록 기준으로 제출/미제출을 가른다
//   · RLS — 교사는 본인 것만, 담당자(admin·superadmin)만 전체
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL = join(ROOT, 'migrations/005_doc_submissions.sql')
const ASSETS = join(ROOT, 'apps/main/api/doc-ai/_assets')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

// 브라우저 모듈이라 번들해서 돌린다 (entry 는 repo 안 — tmp 는 node_modules 를 못 찾는다)
const work = mkdtempSync(join(tmpdir(), 'subm-'))
const entry = join(ROOT, 'tests', '.subm-entry.jsx')
writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server'
import SubmissionsPage from '../apps/main/src/pages/SubmissionsPage.jsx'
import * as lib from '../apps/main/src/lib/submissions.js'
export { renderToStaticMarkup, SubmissionsPage, lib }
`)
const bundle = join(work, 'b.cjs')
try {
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
    '--loader:.jsx=jsx', '--define:import.meta.env={"MODE":"test","VITE_SUPABASE_URL":"http://x","VITE_SUPABASE_ANON_KEY":"k"}',
    `--outfile=${bundle}`, '--log-level=error',
  ])
} finally {
  rmSync(entry, { force: true })
}
const { lib } = await import(bundle)
const catalog = JSON.parse(readFileSync(join(ASSETS, 'prefill-catalog.json'), 'utf-8'))

console.log('\n[교과 목록 — prefill 색인에서 파생]')
ck('catalog 가 prefill 폴더와 일치한다', async () => {
  const { buildCatalog } = await import(`${ROOT}/scripts/build-prefill-catalog.mjs`)
  const fresh = buildCatalog()
  A(JSON.stringify(fresh) === JSON.stringify(catalog),
    'prefill 이 바뀌었는데 catalog 를 다시 만들지 않았다 (node scripts/build-prefill-catalog.mjs)')
})
ck('35블록 · 학년 1~3', () => {
  A(catalog.length >= 35, `${catalog.length}건`)
  A(new Set(catalog.map((c) => c.grade)).size === 3, '학년이 3개가 아님')
})

console.log('\n[파일 규칙]')
const f = (name, size) => ({ name, size })
ck('hwpx 만 받는다', () => {
  A(lib.validateFile(f('계획.pdf', 100)).includes('hwpx'), 'pdf 가 통과')
  A(lib.validateFile(f('계획.hwpx', 100)) === null, 'hwpx 가 막힘')
  A(lib.validateFile(f('계획.HWPX', 100)) === null, '대문자 확장자가 막힘')
})
ck('30MB 상한', () => {
  A(lib.validateFile(f('a.hwpx', lib.MAX_BYTES)) === null, '경계값이 막힘')
  A(lib.validateFile(f('a.hwpx', lib.MAX_BYTES + 1)).includes('너무 큽니다'), '초과가 통과')
})
ck('파일 없이 제출 불가', () => A(lib.validateFile(null).includes('선택'), '빈 제출이 통과'))

console.log('\n[storage 경로 규약: {user_id}/{uuid}.hwpx — 키에 파일명을 넣지 않는다]')
// Supabase Storage 키는 ASCII 안전 문자만 받는다. 한글 파일명이 키에 들어가면
// "Invalid key" 로 업로드가 통째로 막힌다 (평가계획서 파일명은 전부 한글이다).
const ASCII_SAFE = /^[A-Za-z0-9!\-_.*'()/]+$/
ck('사용자 폴더 아래 uuid.hwpx', () => {
  const p = lib.storagePath('u-1')
  A(p.startsWith('u-1/'), p)
  A(p.endsWith('.hwpx'), p)
  A(p.split('/').length === 2, `폴더가 갈렸다: ${p}`)
  A(p.split('/')[1].replace(/\.hwpx$/, '').length >= 8, 'uuid 가 너무 짧다')
})
ck('키에 원본 파일명이 남지 않는다 (한글·괄호·공백)', () => {
  const p = lib.storagePath('u-1')
  A(ASCII_SAFE.test(p), `ASCII 안전 문자가 아니다: ${p}`)
  A(!/[가-힣()\s]/.test(p), `파일명 흔적이 남았다: ${p}`)
})
ck('storagePath 는 파일명을 받지 않는다 (넘겨도 키에 안 섞인다)', () => {
  const p = lib.storagePath('u-1', '2026학년도_수학_2학년_평가계획서(초안).hwpx')
  A(ASCII_SAFE.test(p), `파일명이 키로 새어 들어갔다: ${p}`)
})
ck('같은 파일을 두 번 올려도 경로가 다르다', () => {
  A(lib.storagePath('u-1') !== lib.storagePath('u-1'), '경로가 겹친다')
})
ck('Storage 정책((foldername)[1]=uid) 이 새 키에서도 성립', () => {
  // storage.foldername(name)[1] = 첫 슬래시 앞 조각
  const p = lib.storagePath('a1b2-uid')
  A(p.split('/')[0] === 'a1b2-uid', p)
})

console.log('\n[다운로드 파일명 — 원본 한글 이름 그대로]')
ck('원본 이름을 그대로 쓴다', () => {
  const n = '2026학년도 2학기_수학(2학년) 평가계획서.hwpx'
  A(lib.downloadName(n) === n, lib.downloadName(n))
})
ck('헤더를 깨뜨리는 문자만 걷어낸다', () => {
  A(lib.downloadName('a"b\nc/d.hwpx') === 'abcd.hwpx', lib.downloadName('a"b\nc/d.hwpx'))
})
ck('쓸 이름이 없으면 null (지어내지 않는다)', () => {
  A(lib.downloadName('') === null, '빈 이름이 통과')
  A(lib.downloadName(null) === null, 'null 이 통과')
})

console.log('\n[파일명에서 교과·학년 제안]')
const subjects = [...new Set(catalog.map((c) => c.subject))]
ck('생성물 파일명에서 읽는다', () => {
  const g = lib.guessFromFilename('2026학년도_2학기_수학_2학년_평가계획서(초안).hwpx', subjects)
  A(g.subject === '수학' && g.grade === 2, JSON.stringify(g))
})
ck("'2026학년도' 의 6 을 학년으로 읽지 않는다", () => {
  for (const [name, want] of [
    ['2026학년도_2학기_음악_1학년_평가계획서(초안).hwpx', 1],
    ['2026학년도_2학기_체육_3학년_평가계획서(초안).hwpx', 3],
    ['2026학년도_2학기_국어_평가계획서.hwpx', null],   // 학년이 없으면 없는 대로
  ]) {
    A(lib.guessFromFilename(name, subjects).grade === want, `${name} → ${lib.guessFromFilename(name, subjects).grade}`)
  }
})
ck('긴 교과명이 먼저 (기술가정 vs 기술)', () => {
  const g = lib.guessFromFilename('2026_기술가정_3학년.hwpx', subjects)
  A(g.subject === '기술가정', g.subject)
})
ck('표기가 달라도 잡는다 (진로와 직업)', () => {
  const g = lib.guessFromFilename('진로와직업_1학년_계획.hwpx', subjects)
  A(g.subject === '진로와 직업', g.subject)
})
ck('못 읽으면 빈 값 (지어내지 않는다)', () => {
  const g = lib.guessFromFilename('평가계획서.hwpx', subjects)
  A(g.subject === '' && g.grade === null, JSON.stringify(g))
})

console.log('\n[제출 현황 매트릭스]')
const rows = [
  { subject: '수학', grade: 2, status: 'submitted', file_name: 'a.hwpx' },
  { subject: '수학', grade: 2, status: 'replaced', file_name: 'old.hwpx' },
  { subject: '음악', grade: 1, status: 'submitted', file_name: 'b.hwpx' },
  { subject: '없는과목', grade: 3, status: 'submitted', file_name: 'c.hwpx' },
]
const mx = lib.buildMatrix(rows, catalog)
ck('최신 제출만 센다 (replaced 제외)', () => {
  const math = mx.cells.find((c) => c.subject === '수학').byGrade.find((g) => g.grade === 2)
  A(math.row?.file_name === 'a.hwpx', JSON.stringify(math.row))
  A(mx.done === 2, `done=${mx.done}`)
  A(mx.expected === catalog.length, `expected=${mx.expected}`)
})
ck('미제출 칸이 구분된다', () => {
  const kor = mx.cells.find((c) => c.subject === '국어').byGrade.find((g) => g.grade === 2)
  A(kor.expected === true && kor.row === null, JSON.stringify(kor))
})
ck('해당 학년에 없는 교과는 빈칸', () => {
  const arts = mx.cells.find((c) => c.subject === '미술')
  const g3 = arts.byGrade.find((g) => g.grade === 3)
  A(g3.expected === false, '미술 3학년이 기대 목록에 있음')
})
ck('목록에 없는 제출은 숨기지 않고 따로 센다', () => {
  A(mx.extra.length === 1 && mx.extra[0].subject === '없는과목', JSON.stringify(mx.extra))
})
ck('깨진 입력에도 죽지 않는다', () => {
  A(lib.buildMatrix(null, catalog).done === 0, 'rows null')
  A(lib.buildMatrix([{ subject: null, grade: null }], catalog).done === 0, '빈 행')
})

console.log('\n[RLS — 교사 본인 / 담당자 전체]')
const sql = readFileSync(SQL, 'utf-8')
ck('본인 조회 + 담당자 조회가 나뉘어 있다', () => {
  A(/subm_select_own[\s\S]*user_id = auth\.uid\(\)::text/.test(sql), '본인 조회 정책 없음')
  A(/subm_select_admin[\s\S]*role IN \('admin','superadmin'\)/.test(sql), '담당자 조회 정책 없음')
})
ck('제출은 승인자만 (D20) + 본인 행만', () => {
  A(/subm_insert[\s\S]*is_approved\(\)[\s\S]*user_id = auth\.uid\(\)::text/.test(sql), 'insert 게이트 없음')
})
ck('storage 도 본인 폴더 + 담당자 열람', () => {
  A(/subm_storage_insert[\s\S]*foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(sql), '업로드 폴더 제한 없음')
  A(sql.includes('subm_storage_select_admin'), '담당자 다운로드 정책 없음')
  A(/bucket_id = 'submissions'/.test(sql), '버킷 한정 없음')
})
ck('버킷은 비공개', () => {
  A(/INSERT INTO storage\.buckets[\s\S]*'submissions'[\s\S]*false/.test(sql), '공개 버킷')
  A(sql.includes('REVOKE ALL ON public.doc_submissions FROM anon'), 'anon REVOKE 없음')
})
ck('삭제 정책이 없다 (제출 기록은 지우지 않는다)', () => {
  A(!/FOR DELETE/.test(sql), '삭제 경로가 열려 있음')
})

console.log('\n[재제출 — 옛 행을 지우지 않는다]')
const src = readFileSync(join(ROOT, 'apps/main/src/lib/submissions.js'), 'utf-8')
ck("status='replaced' 로 넘긴다", () => {
  A(/update\(\{ status: 'replaced' \}\)/.test(src), 'replaced 처리 없음')
  A(!/\.delete\(\)/.test(src), '행 삭제 경로가 있음')
})
ck('새 행을 만든 뒤에 옛 행을 넘긴다', () => {
  A(src.indexOf('.insert(') < src.indexOf("status: 'replaced'"), "순서가 반대 — 잠깐 '제출 없음' 이 된다")
})
ck('행을 못 만들면 올린 파일을 치운다', () => {
  A(/if \(insErr\)[\s\S]*storage[\s\S]*remove\(\[path\]\)/.test(src), '고아 파일 방지 없음')
})

console.log('\n[회귀 E2E — 한글 파일명 업로드·다운로드 (fetch 를 가로채 실제 요청을 본다)]')
// Supabase 클라이언트를 그대로 태우고 네트워크만 가짜로 받는다.
// 라이브러리가 실제로 만드는 URL·본문을 보는 것이라, 규약을 되돌리면 여기서 걸린다.
const HANGUL = '2026학년도_2학기_수학 (2학년) 평가계획서(초안).hwpx'
const calls = []
const origFetch = globalThis.fetch
const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === 'string' ? input : input.url
  const method = String(init.method || (typeof input === 'string' ? 'GET' : input.method) || 'GET').toUpperCase()
  let body = init.body
  if (body && typeof body !== 'string' && typeof body.text === 'function' && !(body instanceof FormData)) {
    body = await body.text()
  }
  calls.push({ url, method, body })
  if (url.includes('/storage/v1/object/sign/')) {
    return json({ signedURL: '/object/sign/submissions/k.hwpx?token=tok' })
  }
  if (url.includes('/storage/v1/object/')) return json({ Id: 'id', Key: 'submissions/k.hwpx' })
  return new Response(null, { status: 201 })   // postgrest insert/update (반환 없음)
}

let subm, signed
try {
  const file = new File([new Uint8Array([1, 2, 3])], HANGUL, { type: 'application/haansofthwpx' })
  subm = await lib.submit({ userId: 'uid-9', file, subject: '수학', grade: 2, note: '' })
  signed = await lib.downloadUrl('uid-9/abc.hwpx', HANGUL)
} finally {
  globalThis.fetch = origFetch
}

const upload = calls.find((c) => c.method === 'POST' && /\/storage\/v1\/object\/submissions\//.test(c.url))
const insert = calls.find((c) => c.method === 'POST' && c.url.includes('doc_submissions'))
const sign = calls.find((c) => c.url.includes('/storage/v1/object/sign/'))

ck('한글 파일명 제출이 성공한다', () => {
  A(!subm?.error, `제출 실패: ${subm?.error?.message}`)
})
ck('업로드 요청 URL 이 ASCII 안전 (Invalid key 재발 방지)', () => {
  A(upload, `업로드 요청이 없다: ${calls.map((c) => c.url).join(' | ')}`)
  const key = upload.url.split('/storage/v1/object/submissions/')[1]
  A(ASCII_SAFE.test(key), `키가 ASCII 안전하지 않다: ${key}`)
  A(!/%/.test(key), `키에 인코딩된 문자가 있다 (파일명이 새어 들어감): ${key}`)
  A(/^uid-9\/[^/]+\.hwpx$/.test(key), key)
})
ck('원본 한글 파일명은 doc_submissions.file_name 에 남는다', () => {
  A(insert, '행 생성 요청이 없다')
  const row = JSON.parse(insert.body)
  A(row.file_name === HANGUL, row.file_name)
  A(row.file_path.startsWith('uid-9/') && ASCII_SAFE.test(row.file_path), row.file_path)
  A(!row.file_path.includes(HANGUL), '경로에 파일명이 들어갔다')
})
ck('다운로드는 원본 이름으로 내려온다 (Content-Disposition)', () => {
  A(sign, '서명 URL 요청이 없다')
  A(signed?.url, `서명 URL 없음: ${signed?.error?.message}`)
  const q = signed.url.split('?')[1] || ''
  const raw = /(?:^|&)download=([^&]*)/.exec(q)?.[1]
  A(raw, `download 파라미터가 없다: ${signed.url}`)
  // 서버는 쿼리를 한 번만 디코드한다 — 이중 인코딩(%25)이면 '%EC%88%98...' 이 파일명이 된다
  A(!raw.includes('%25'), `이중 인코딩됐다 (storage-js download 옵션 회귀): ${raw}`)
  A(decodeURIComponent(raw) === HANGUL, `다운로드 이름이 원본과 다르다: ${decodeURIComponent(raw)}`)
})
ck('서명 URL 자체는 키만 담는다 (한글 없음)', () => {
  A(ASCII_SAFE.test(signed.url.split('?')[0].replace('http://', '')), signed.url)
})

console.log('\n[화면]')
const page = readFileSync(join(ROOT, 'apps/main/src/pages/SubmissionsPage.jsx'), 'utf-8')
ck('담당자 화면은 권한으로 가린다', () => {
  A(page.includes("can(profile, 'users.manage')"), '권한 판정 없음')
  A(page.includes('{isAdmin && ('), '담당자 전용 구역이 없음')
})
ck('교과·학년은 고칠 수 있다 (제안일 뿐)', () => {
  A(page.includes('setSubject(e.target.value)'), '교과 수정 불가')
  A(page.includes('파일명에서 교과·학년을 다 읽지 못했습니다'), '못 읽었을 때 안내 없음')
})
ck('다운로드에 원본 파일명을 넘긴다', () => {
  A(/downloadUrl\(row\.file_path, row\.file_name\)/.test(page),
    '파일명 없이 서명 URL 을 만들면 uuid.hwpx 로 내려간다')
})
ck('메뉴에 등록돼 있다', () => {
  // 메뉴·라우트는 lib/modules.js 한 표에서 나온다 (공개 범위 게이팅)
  const mods = readFileSync(join(ROOT, 'apps/main/src/lib/modules.js'), 'utf-8')
  A(mods.includes("to: '/submissions', label: '평가계획 제출'"), '모듈 표에 없음')
  const app = readFileSync(join(ROOT, 'apps/main/src/App.jsx'), 'utf-8')
  A(new RegExp(`['"]?submissions['"]?:`).test(app), 'SCREENS 에 화면이 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
