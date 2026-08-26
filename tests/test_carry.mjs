// 작년 그대로 계승 — **참조로 받고 서버가 원문을 넣는다** (2026-08-26 504 대응)
//
// 왜 바꿨나: 모델이 작년 원문을 통째로 PLAN_READY JSON 에 되받아써서 출력이 교과
//   크기에 비례했다. 큰 교과(사회 1학년 9,816자 · 디지털 리터러시 8,980자)만
//   응답이 maxDuration 60초를 넘겨 504 로 죽었다 — "교과 특이 크래시" 의 정체.
//
// 이 테스트가 지키는 것:
//   1. 계승 diff 0 — 펼친 값이 작년 원문과 **글자 하나까지 같다**
//      (옮겨 적지 않으므로 틀릴 수가 없다는 주장을 실제로 검증한다)
//   2. 출력이 교과 크기와 무관하다 — carry JSON 길이가 팩 크기에 비례하지 않는다
//   3. 못 펼친 참조를 **조용히 버리지 않는다** (제0원칙)
//   4. perf_plans 는 계승 대상이 아니다 (구조화된 원본이 없다 — 있는 척하지 않는다)
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const mod = await import(`${ROOT}/apps/main/api/doc-ai/chat.js`)
const {
  prefillIndex, buildPrefillDoc, buildCarryDoc, carryable,
  expandCarry, expandReply, parseCarryPath, CARRY_SOURCES, manifest: M,
} = mod

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }
const flat = (s) => String(s ?? '').replace(/\s+/g, '')
const packs = [...prefillIndex.entries()].map(([k, e]) => ({ key: k, pre: e, d: e.data }))
const free = packs.filter((p) => p.d.type === 'free_semester')

/** 계승만 하는 계획을 만든다 (이 팩에서 실제로 가능한 참조 전부) */
function carryOnly(p) {
  const refs = carryable(p.pre, M).map((x) => x.field)
  const plan = { year: 2026, semester: 2, grade: p.d.grade, subject: p.d.subject, carry: refs }
  return { plan, refs, ...expandCarry(plan, p.pre, M) }
}

console.log('\n[참조 문법]')
ck('필드 / 배열 칸 / 칸 안의 항목', () => {
  A(parseCarryPath('free_activities')?.field === 'free_activities', '필드')
  const a = parseCarryPath('monthly_plan[2]')
  A(a.field === 'monthly_plan' && a.index === 2 && a.sub === null, JSON.stringify(a))
  const b = parseCarryPath('monthly_plan[0].units')
  A(b.field === 'monthly_plan' && b.index === 0 && b.sub === 'units', JSON.stringify(b))
})
ck('문법 밖은 받지 않는다', () => {
  for (const bad of ['', '  ', 'a b', 'x[]', 'x[-1]', 'x.y.z', '../etc', 'x[1][2]']) {
    A(parseCarryPath(bad) === null, `통과됨: ${JSON.stringify(bad)}`)
  }
})

console.log('\n[계승 diff 0 — 펼친 값이 작년 원문과 같다]')
ck('월별 계획: 단원·성취기준·평가요소가 글자 하나까지 같다', () => {
  for (const p of packs) {
    const rows = p.d.monthly_plan
    if (!Array.isArray(rows) || !rows.length) continue
    const { plan } = expandCarry({ carry: ['monthly_plan'] }, p.pre, M)
    A(plan.monthly_plan.length === rows.length, `${p.key}: 행 수 ${plan.monthly_plan.length}/${rows.length}`)
    rows.forEach((src, i) => {
      for (const f of ['units', 'standards', 'eval_elements']) {
        A(plan.monthly_plan[i][f] === String(src[f] ?? ''), `${p.key} [${i}].${f} 어긋남`)
      }
    })
  }
})
ck('월 라벨·시수는 계승하지 않는다 (서버가 올해 값으로 넣는다)', () => {
  // 작년 표기에는 "12월1월" 처럼 합쳐진 달이 있다 — 그대로 물려받으면 안 된다
  const p = packs.find((x) => (x.d.monthly_plan || []).some((r) => /\d월.*\d월/.test(r.month || '')))
  A(p, '합쳐진 월 표기를 가진 팩이 없다 — 이 테스트의 전제가 깨졌다')
  const { plan } = expandCarry({ carry: ['monthly_plan'] }, p.pre, M)
  for (const r of plan.monthly_plan) {
    A(!('month' in r), `month 가 계승됐다: ${r.month}`)
    A(!('hours_cum' in r), 'hours_cum 이 계승됐다')
  }
})
ck('자유학기 활동: 이름·과제·성취기준·A~E 가 원문 그대로', () => {
  for (const p of free) {
    const acts = p.d.activities
    if (!acts?.length) continue
    const { plan } = expandCarry({ carry: ['free_activities'] }, p.pre, M)
    A(plan.free_activities.length === acts.length, `${p.key}: 개수`)
    acts.forEach((src, i) => {
      const got = plan.free_activities[i]
      for (const f of ['name', 'task', 'standards']) {
        A(got[f] === String(src[f] ?? ''), `${p.key} 활동${i + 1}.${f} 어긋남`)
      }
      for (const [lv, t] of Object.entries(src.levels || {})) {
        A(got.levels[lv] === t, `${p.key} 활동${i + 1} ${lv} 어긋남`)
      }
    })
  }
})
ck('평가방법 ☑ 가 정확히 옮겨진다 (이름은 manifest 어휘로)', () => {
  const norm = (x) => String(x ?? '').replace(/[\s·･・.ㆍ]/g, '')
  let checked = 0
  for (const p of free) {
    const acts = p.d.activities || []
    if (!acts.length) continue
    const { plan } = expandCarry({ carry: ['free_activities'] }, p.pre, M)
    acts.forEach((src, i) => {
      const got = new Set(plan.free_activities[i].methods)
      for (const n of [1, 2]) {
        const line = src[`methods${n}`]
        const opts = M.methods_lines?.[`line${n}`]?.options_order || []
        if (typeof line !== 'string' || !line.trim()) continue
        const fl = norm(line)
        for (const o of opts) {
          const at = fl.indexOf(norm(o))
          if (at <= 0) continue
          checked += 1
          const want = fl[at - 1] !== '□'
          A(got.has(o) === want, `${p.key} 활동${i + 1} '${o}': ☑=${want} 인데 결과=${got.has(o)}`)
        }
      }
      // 이름은 반드시 manifest 어휘여야 한다 (원문에서 잘라 오면 서버 치환이 못 알아본다)
      const vocab = new Set([1, 2].flatMap((n) => M.methods_lines?.[`line${n}`]?.options_order || []))
      for (const x of got) A(vocab.has(x), `${p.key} 활동${i + 1}: 어휘 밖 '${x}'`)
    })
  }
  A(checked > 50, `대조한 항목이 ${checked}개뿐 — 표본이 너무 작다`)
})
ck('학기 성취수준·평가 목적·지도 방안은 통째로 같다', () => {
  for (const p of packs) {
    const { plan } = expandCarry(
      { carry: ['achievement_levels', 'eval_purpose', 'min_achievement_plan'] }, p.pre, M
    )
    const alv = p.d.achievement_levels_last_year
    if (alv && ['A', 'B', 'C', 'D', 'E'].some((k) => alv[k] != null)) {
      A(JSON.stringify(plan.achievement_levels) === JSON.stringify(alv), `${p.key}: 성취수준 어긋남`)
    }
    if (p.d.eval_purpose?.length) {
      A(JSON.stringify(plan.eval_purpose) === JSON.stringify(p.d.eval_purpose), `${p.key}: 평가 목적`)
    }
    if (p.d.min_achievement_plan) {
      A(plan.min_achievement_plan === p.d.min_achievement_plan, `${p.key}: 지도 방안`)
    }
  }
})
ck('35개 팩 전부 — 가능한 참조를 전부 걸어도 미해결 0', () => {
  for (const p of packs) {
    const { unresolved } = carryOnly(p)
    A(!unresolved.length, `${p.key}: ${unresolved.join(' | ')}`)
  }
})

console.log('\n[출력이 교과 크기와 무관해진다]')
ck('carry JSON 이 작년 원문보다 훨씬 짧다 (전 팩)', () => {
  let worst = 0
  for (const p of packs) {
    const { plan, refs } = carryOnly(p)
    if (!refs.length) continue
    const compact = JSON.stringify({ carry: refs }).length
    const full = JSON.stringify(
      Object.fromEntries(carryable(p.pre, M).map((x) => [x.field, x.value]))
    ).length
    if (!full) continue
    A(compact < full / 5, `${p.key}: 참조 ${compact}자 / 원문 ${full}자 — 줄지 않았다`)
    worst = Math.max(worst, compact)
    void plan
  }
  A(worst < 400, `가장 긴 carry 배열이 ${worst}자 — 교과 크기를 따라간다`)
})
ck('가장 큰 교과와 가장 작은 교과의 carry 길이 차이가 작다', () => {
  const lens = packs
    .map((p) => JSON.stringify({ carry: carryOnly(p).refs }).length)
    .filter((n) => n > 12)
  const spread = Math.max(...lens) - Math.min(...lens)
  A(spread < 200, `carry 길이 편차 ${spread}자 — 교과 크기에 비례한다`)
})

console.log('\n[못 펼친 참조를 조용히 버리지 않는다]')
ck('알 수 없는 대상은 미해결로 남고 본문에 뜬다', () => {
  const p = free[0]
  const reply = `정리했습니다.\n\n===PLAN_READY===\n${JSON.stringify({
    subject: p.d.subject, grade: p.d.grade, carry: ['perf_plans', 'monthly_plan'],
  })}\n===END===`
  const r = expandReply(reply, p.pre, M)
  A(r.carry.applied.includes('monthly_plan'), '멀쩡한 참조까지 버림')
  A(r.carry.unresolved.some((u) => u.startsWith('perf_plans')), '미해결에 없음')
  A(r.reply.includes('공란으로 나갑니다'), '교사에게 보이지 않음')
  A(r.reply.includes('perf_plans'), '무엇이 빠졌는지 안 적음')
})
ck('작년 자료가 없는 대화에서 참조하면 그 사실을 말한다', () => {
  const { unresolved, plan } = expandCarry({ carry: ['monthly_plan'] }, null, M)
  A(unresolved.length === 1 && unresolved[0].includes('작년 자료가 없습니다'), unresolved.join())
  A(plan.carry === undefined, 'carry 키가 남았다')
})
ck('작년 자료에 없는 칸을 참조하면 몇 번째인지 말한다', () => {
  const p = free[0]
  const n = p.d.activities.length
  const { unresolved } = expandCarry({ carry: [`free_activities[${n + 3}]`] }, p.pre, M)
  A(unresolved.length === 1, unresolved.join())
  A(unresolved[0].includes(`${n + 4}번째`), unresolved[0])
})
ck('carry 키는 언제나 제거된다 (generate 가 막는 값이다)', () => {
  for (const refs of [['monthly_plan'], ['없는필드'], []]) {
    const { plan } = expandCarry({ a: 1, carry: refs }, free[0].pre, M)
    A(refs.length === 0 || plan.carry === undefined, `carry 남음: ${JSON.stringify(refs)}`)
  }
})

console.log('\n[부분 계승 — 바꾼 것만 직접 쓴다]')
ck('배열 일부만 참조하면 나머지 직접 값이 살아 있다', () => {
  const p = free.find((x) => (x.d.activities || []).length >= 3)
  const 신규 = { name: '새 활동', task: '새 과제', standards: '[9임01]', levels: { A: 'a' }, methods: ['프로젝트'] }
  const { plan, unresolved } = expandCarry(
    { free_activities: [null, 신규, null], carry: ['free_activities[0]', 'free_activities[2]'] },
    p.pre, M
  )
  A(!unresolved.length, unresolved.join())
  A(plan.free_activities.length === 3, `${plan.free_activities.length}개`)
  A(plan.free_activities[1].name === '새 활동', '직접 쓴 활동이 덮였다')
  A(plan.free_activities[0].name === String(p.d.activities[0].name ?? ''), '0번 계승 어긋남')
  A(plan.free_activities[2].name === String(p.d.activities[2].name ?? ''), '2번 계승 어긋남')
})
ck('행의 한 칸만 참조하면 그 칸만 바뀐다', () => {
  const p = packs.find((x) => (x.d.monthly_plan || []).length >= 3)
  const { plan } = expandCarry(
    { monthly_plan: [{ units: '올해 단원', standards: '올해 성취기준' }], carry: ['monthly_plan[0].units'] },
    p.pre, M
  )
  A(plan.monthly_plan[0].units === String(p.d.monthly_plan[0].units ?? ''), '계승 안 됨')
  A(plan.monthly_plan[0].standards === '올해 성취기준', '직접 쓴 칸이 덮였다')
})
ck('뒤에 오는 참조가 앞을 덮는다 (문서화된 순서)', () => {
  const p = free.find((x) => (x.d.activities || []).length >= 2)
  const { plan } = expandCarry(
    { free_activities: [{ name: '직접' }], carry: ['free_activities[0]', 'free_activities'] }, p.pre, M
  )
  A(plan.free_activities.length === p.d.activities.length, '통째 참조가 이기지 않음')
})

console.log('\n[프롬프트 규약]')
ck('실제로 있는 대상만 적는다 (없는 것을 참조하게 두지 않는다)', () => {
  for (const p of packs) {
    const doc = buildCarryDoc(p.pre, M).join('\n')
    const have = new Set(carryable(p.pre, M).map((x) => x.field))
    for (const field of Object.keys(CARRY_SOURCES)) {
      if (have.has(field)) A(doc.includes(`"${field}"`), `${p.key}: ${field} 누락`)
      else A(!doc.includes(`"${field}"`), `${p.key}: 없는 ${field} 를 적음`)
    }
  }
})
ck('perf_plans 는 계승 대상이 아니라고 못 박는다', () => {
  A(!('perf_plans' in CARRY_SOURCES), 'perf_plans 가 계승 표에 있다')
  const doc = buildCarryDoc(packs.find((p) => p.d.perf_plans)?.pre, M).join('\n')
  A(doc.includes('carry 대상이 아니다'), '금지 문구 없음')
  A(doc.includes('셀 좌표'), '이유(구조화된 원본 부재)를 안 밝힘')
})
ck('월 라벨·시수 계승 금지를 규약에도 적는다', () => {
  const doc = buildCarryDoc(free[0].pre, M).join('\n')
  A(doc.includes('month'), 'month 언급 없음')
  A(doc.includes('서버가 올해 값으로 넣는다'), '주체 명시 없음')
})
ck('규약이 프롬프트에 실제로 들어간다', () => {
  for (const p of packs) {
    const doc = buildPrefillDoc(p.pre, M)
    if (!carryable(p.pre, M).length) continue
    A(doc.includes('작년 그대로 계승'), `${p.key}: 규약 미주입`)
    A(doc.includes('"carry"'), `${p.key}: carry 키 미언급`)
  }
})
ck('작년 자료가 없으면 규약도 붙지 않는다 (백지 모드 보존)', () => {
  A(buildCarryDoc(null, M).length === 0, 'null 에 규약이 붙음')
  A(buildCarryDoc({ data: { subject: 'x', grade: 2 } }, M).length === 0, '빈 팩에 규약이 붙음')
})

console.log('\n[응답 재조립]')
ck('carry 가 없으면 응답을 손대지 않는다', () => {
  const reply = `요약\n\n===PLAN_READY===\n{"subject":"수학"}\n===END===`
  const r = expandReply(reply, free[0].pre, M)
  A(r.reply === reply, '원문이 바뀜')
  A(r.carry === null, 'carry 정보가 생김')
})
ck('PLAN_READY 가 없는 대화도 그대로 지나간다', () => {
  const r = expandReply('몇 가지 여쭙겠습니다. 주당 시수가 어떻게 되나요?', free[0].pre, M)
  A(r.reply.includes('주당 시수'), '본문이 사라짐')
  A(r.carry === null, 'carry 정보가 생김')
})
ck('펼친 응답은 다시 파싱된다 (프론트가 읽는 형식 그대로)', () => {
  const p = free[0]
  const reply = `요약입니다.\n\n===PLAN_READY===\n${JSON.stringify({
    subject: p.d.subject, grade: 1, carry: ['monthly_plan', 'free_activities'],
  })}\n===END===`
  const r = expandReply(reply, p.pre, M)
  const again = expandReply(r.reply, p.pre, M) // 두 번 펼쳐도 같아야 한다 (carry 가 없으므로)
  A(again.reply === r.reply, '두 번째 통과에서 바뀜')
  const json = JSON.parse(r.reply.split('===PLAN_READY===')[1].split('===END===')[0])
  A(json.monthly_plan.length === p.d.monthly_plan.length, '월별 누락')
  A(flat(r.reply).includes(flat(p.d.activities[0].task)), '활동 원문이 안 들어감')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
