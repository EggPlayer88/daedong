// 대화 저장 (004_doc_ai_conversations) — 제목 생성·목록 화면·RLS 전제.
//
// 지키는 것:
//   · 목록 제목이 교과·학년에서 자동으로 나온다 (교사에게 제목을 묻지 않는다)
//   · 참고자료 전문이 교과명 추측을 오염시키지 않는다
//   · 확정 plan 이 있으면 언제나 그쪽이 이긴다
//   · RLS 는 personal — admin 열람 경로가 생기지 않았는지 SQL 로 확인
//   · 목록 화면이 깨진 입력에도 죽지 않는다
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SQL = join(ROOT, 'migrations/004_doc_ai_conversations.sql')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

// ── 브라우저 모듈은 번들해서 node 로 돌린다 (JSX·JSON import 해석용).
//    ⚠ entry 는 **repo 안**에 둬야 한다 — tmp 에 두면 node_modules 를 못 찾는다.
const work = mkdtempSync(join(tmpdir(), 'convtest-'))
const entry = join(ROOT, 'tests', '.conv-entry.jsx')
writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server'
import ConversationList from '../apps/main/src/components/ConversationList.jsx'
import * as meta from '../apps/main/src/lib/docAiMeta.js'
export { renderToStaticMarkup, ConversationList, meta }
`)
const bundle = join(work, 'bundle.cjs')
try {
  execFileSync(join(ROOT, 'node_modules/.bin/esbuild'), [
    entry, '--bundle', '--platform=node', '--format=cjs', '--jsx=automatic',
    '--loader:.jsx=jsx', '--define:import.meta.env={"MODE":"test"}',
    `--outfile=${bundle}`, '--log-level=error',
  ])
} finally {
  rmSync(entry, { force: true })
}
const { renderToStaticMarkup: render, ConversationList, meta } = await import(bundle)
const { deriveMeta, buildTitle, SUBJECTS, REF_PREFIX } = meta
const h = (props) => render(ConversationList({ onOpen() {}, onNew() {}, onDelete() {}, ...props }))

console.log('\n[제목 자동 생성 — 교사에게 묻지 않는다]')
ck('교사 문장에서 교과·학년을 뽑는다', () => {
  const m = deriveMeta([{ role: 'user', content: '2학년 수학 평가계획서 쓰려고요' }], null)
  A(m.grade === 2 && m.subject === '수학', JSON.stringify(m))
  A(buildTitle(m) === '2학년 수학 평가계획', buildTitle(m))
})
ck('확정 plan 이 언제나 이긴다', () => {
  const msgs = [{ role: 'user', content: '1학년 국어입니다' }]
  const m = deriveMeta(msgs, { subject: '음악', grade: 3 })
  A(m.subject === '음악' && m.grade === 3, JSON.stringify(m))
})
ck('assistant 발화는 근거로 쓰지 않는다', () => {
  // AI 가 예시로 다른 교과를 말할 수 있다 — 교사가 말한 것만 본다
  const m = deriveMeta([{ role: 'assistant', content: '3학년 영어는 보통 이렇게 합니다' }], null)
  A(m.subject === null && m.grade === null, JSON.stringify(m))
})
ck('참고자료 전문은 교과명 추측에서 제외', () => {
  const ref = `${REF_PREFIX}2025-2 평가계획서.hwpx]\n국어 영어 수학 사회 과학 3학년 …`
  const m = deriveMeta([{ role: 'user', content: ref }], null)
  A(m.subject === null && m.grade === null, `참고자료가 오염시킴: ${JSON.stringify(m)}`)
})
ck('긴 교과명이 먼저 잡힌다 (기술·가정 vs 기술)', () => {
  const i = SUBJECTS.indexOf('기술·가정')
  const j = SUBJECTS.indexOf('기술')
  if (i >= 0 && j >= 0) A(i < j, '짧은 이름이 먼저라 부분 일치로 먹힌다')
  const m = deriveMeta([{ role: 'user', content: '2학년 기술·가정입니다' }], null)
  if (i >= 0) A(m.subject === '기술·가정', m.subject)
})
ck('아직 모르면 빈 제목이 아니라 "새 평가계획"', () => {
  A(buildTitle(deriveMeta([], null)) === '새 평가계획', buildTitle(deriveMeta([], null)))
  A(buildTitle({ subject: '수학', grade: null }) === '수학 평가계획')
  A(buildTitle({ subject: null, grade: 3 }) === '3학년 평가계획')
})
ck('교과 목록이 자산에서 온다 (하드코딩 아님)', () => {
  for (const s of ['국어', '수학', '음악', '체육']) A(SUBJECTS.includes(s), `누락: ${s}`)
  A(SUBJECTS.length >= 10, `후보가 ${SUBJECTS.length}개뿐`)
})

console.log('\n[목록 화면]')
ck('제목·교과·학년·수정시각이 보인다', () => {
  const html = h({ rows: [{ id: 'a', title: '3학년 수학 평가계획', subject: '수학', grade: 3, status: 'active', updated_at: '2026-08-18T01:00:00Z' }] })
  A(html.includes('3학년 수학 평가계획'), '제목 없음')
  A(html.includes('수학 · 3학년'), '교과·학년 없음')
})
ck('생성 완료 대화는 구분된다', () => {
  const html = h({ rows: [{ id: 'a', title: 'x', status: 'completed', updated_at: '2026-08-18T01:00:00Z' }] })
  A(html.includes('생성 완료'), '완료 표시 없음')
})
ck('[새 대화] 와 삭제 버튼이 있다', () => {
  const html = h({ rows: [{ id: 'a', title: 'x', status: 'active' }] })
  A(html.includes('+ 새 대화'), '새 대화 버튼 없음')
  A(html.includes('삭제'), '삭제 버튼 없음')
})
ck('비어 있으면 자동 저장된다는 사실을 알린다', () => {
  const html = h({ rows: [] })
  A(html.includes('자동으로 저장'), '안내 없음')
})
ck('현재 대화는 다시 열 수 없다 (중복 로드 방지)', () => {
  const html = h({ rows: [{ id: 'a', title: 'x' }], currentId: 'a' })
  A(html.includes('conv-item on'), '현재 표시 없음')
  A(/<button[^>]*class="conv-open"[^>]*disabled/.test(html), '현재 대화 버튼이 열려 있음')
})
ck('깨진 입력에도 죽지 않는다', () => {
  A(h({ rows: '배열아님' }).length > 10, 'rows 문자열')
  A(h({ rows: [{ id: 'a' }] }).length > 10, '필드 전부 없음')
  A(h({ rows: [{ id: 'a', grade: '삼학년' }] }).includes('교과 미정'), 'grade 문자열')
})

console.log('\n[RLS — personal (admin 열람 없음)]')
const sql = readFileSync(SQL, 'utf-8')
ck('정책 4개 전부 본인 행으로 제한', () => {
  for (const p of ['docai_conv_select', 'docai_conv_insert', 'docai_conv_update', 'docai_conv_delete']) {
    A(sql.includes(p), `정책 없음: ${p}`)
  }
  const guards = sql.match(/user_id = auth\.uid\(\)::text/g) || []
  A(guards.length >= 5, `본인 제한이 ${guards.length}곳뿐`)
})
ck('admin 우회 경로가 없다', () => {
  for (const fn of ['is_admin', 'is_dept_head', 'atleast', 'at_least']) {
    A(!sql.toLowerCase().includes(fn), `권한 상승 함수 사용됨: ${fn}`)
  }
})
ck('insert 는 승인 게이트도 통과해야 한다 (D20)', () => {
  A(/docai_conv_insert[\s\S]*is_approved\(\)/.test(sql), 'insert 에 is_approved 없음')
})
ck('RLS 가 켜져 있고 anon 은 차단', () => {
  A(sql.includes('ENABLE ROW LEVEL SECURITY'), 'RLS 미설정')
  A(/REVOKE ALL ON public\.doc_ai_conversations FROM anon/.test(sql), 'anon REVOKE 없음')
})

console.log('\n[저장 계층]')
const store = readFileSync(join(ROOT, 'apps/main/src/lib/docAiStore.js'), 'utf-8')
ck('목록 조회는 본문(messages)을 싣지 않는다', () => {
  const m = /LIST_COLUMNS = '([^']+)'/.exec(store)
  A(m, 'LIST_COLUMNS 없음')
  A(!m[1].includes('messages'), `목록에 본문이 실림: ${m[1]}`)
})
ck('저장 실패가 예외로 터지지 않는다 (대화가 끊기면 안 된다)', () => {
  A(!/throw /.test(store.replace(/new Error\([^)]*\)/g, '')), '던지는 경로가 있음')
  A(store.includes('return { error }'), 'error 반환 형태가 아님')
})
ck('upsert 로 매 교환 저장 (insert/update 를 나누지 않는다)', () => {
  A(/upsert\(row, \{ onConflict: 'id' \}\)/.test(store), 'upsert 아님')
})

const page = readFileSync(join(ROOT, 'apps/main/src/pages/DocAiPage.jsx'), 'utf-8')
ck('인사만 오간 대화는 저장하지 않는다', () => {
  A(page.includes("m.content !== OPENING"), '빈 대화 저장 방지 없음')
})
ck('문서 생성 완료 시 status 를 바꾼다', () => {
  A(page.includes('markCompleted(convId)'), 'completed 전환 없음')
})
ck('삭제는 한 번 묻는다 (되돌릴 수 없다)', () => {
  A(page.includes('window.confirm'), '확인 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
