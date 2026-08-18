// users ↔ departments embed 모호성 회귀 방지.
//
// 001 이 FK 를 두 개 만든다 (users.department_id → departments,
// departments.head_id → users). PostgREST 는 `departments(name)` 같은 모호한
// embed 를 "more than one relationship was found" 로 거부한다.
// → 모든 embed 는 `대상!FK제약이름` 으로 명시돼야 한다.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'apps/main/src')
const MIGRATION = join(ROOT, 'migrations/001_users_departments.sql')

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

function walk(dir) {
  const out = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (/\.(jsx?|mjs)$/.test(f)) out.push(p)
  }
  return out
}
const files = walk(SRC)
const sql = readFileSync(MIGRATION, 'utf-8')

console.log('\n[모호성의 근거 — 001 에 FK 가 정말 2개인가]')
ck('users.department_id → departments', () =>
  A(/department_id\s+TEXT\s+REFERENCES\s+public\.departments\(id\)/.test(sql), '정의를 찾지 못함'))
ck('departments.head_id → users', () =>
  A(/ADD COLUMN head_id TEXT REFERENCES public\.users\(id\)/.test(sql), '정의를 찾지 못함'))
ck('→ 두 테이블 사이 관계가 2개이므로 embed 는 반드시 명시해야 한다', () => {
  const refs = (sql.match(/REFERENCES\s+public\.(users|departments)\(id\)/g) || [])
  A(refs.length >= 2, `관계 ${refs.length}개`)
})

console.log('\n[프론트의 embed 표기]')
// 예: departments!users_department_id_fkey(name)  /  금지: departments(name)
const AMBIGUOUS = /(?<![!\w])departments\s*\(/g
const EXPLICIT = /departments!(\w+)\s*\(/g

ck('모호한 departments( 임베드가 없다', () => {
  const bad = []
  for (const f of files) {
    const s = readFileSync(f, 'utf-8')
    // 주석 줄은 제외 (설명에 예시로 적을 수 있다)
    const code = s.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*')).join('\n')
    if (AMBIGUOUS.test(code)) bad.push(relative(ROOT, f))
    AMBIGUOUS.lastIndex = 0
  }
  A(bad.length === 0, `모호한 embed: ${bad.join(', ')}`)
})

ck('사용된 FK 제약 이름이 001 의 컬럼과 맞는다', () => {
  const used = new Set()
  for (const f of files) {
    const s = readFileSync(f, 'utf-8')
    let m
    EXPLICIT.lastIndex = 0
    while ((m = EXPLICIT.exec(s))) used.add(m[1])
  }
  A(used.size > 0, 'departments embed 를 아예 찾지 못함 (테스트가 무의미해짐)')
  for (const name of used) {
    // PostgreSQL 기본 규칙: <table>_<column>_fkey
    const m = /^(\w+?)_(\w+)_fkey$/.exec(name)
    A(m, `제약 이름 형식이 아님: ${name}`)
    const [, table, column] = m
    A(table === 'users' && column === 'department_id',
      `예상과 다른 FK: ${name} (users_department_id_fkey 여야 한다)`)
    // 001 에 그 컬럼이 실제로 있는지
    A(new RegExp(`${column}\\s+TEXT\\s+REFERENCES`).test(sql),
      `001 에 ${column} 컬럼 정의가 없다 — 컬럼명이 바뀌면 FK 이름도 바뀐다`)
  }
})

ck('사용자 관리 화면이 부서 embed 를 실제로 쓴다', () => {
  const s = readFileSync(join(SRC, 'pages/AdminUsersPage.jsx'), 'utf-8')
  A(s.includes('departments!users_department_id_fkey(name)'), '명시 embed 없음')
  A(s.includes('${DEPT_EMBED}') || s.includes('DEPT_EMBED'), 'embed 를 상수로 두지 않음')
  // 대기 목록과 활성 목록이 같은 select 를 쓰는지 (한쪽만 고치는 사고 방지)
  const selects = (s.match(/\.select\(/g) || []).length
  A(selects === 1, `select 가 ${selects}개 — 목록마다 따로 조회하면 한쪽만 고칠 위험이 있다`)
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
