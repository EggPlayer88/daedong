// prefill 주입 (마스터플랜 Phase B) — 작년 데이터 팩이 프롬프트에 제대로 들어가는지.
//
// 지키는 것:
//   · 해당 교과·학년 **한 건만** 주입된다 (다른 교과가 초안에 섞이면 안 된다)
//   · 작년 값을 그대로 쓰면 안 되는 것(시험 시기·시수·배점 3분류)이 명시된다
//   · 파서가 자신 없다고 표시한 부분(_warnings)은 교사 확인으로 넘어간다
//   · prefill 이 없으면 지금까지처럼 백지 모드
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
const DIR = `${API}/_assets/prefill`
const mod = await import(`${API}/chat.js`)
const { pickPrefill, buildPrefillDoc, buildPrefillIndex, prefillIndex, manifest: M } = mod

let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }
const say = (...t) => t.map((content) => ({ role: 'user', content }))
const docFor = (t) => buildPrefillDoc(pickPrefill(say(t)))

console.log('\n[배치 · 색인]')
ck('파일이 _assets/prefill 에 있다 (배포 번들 포함 경로)', () => {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.json'))
  A(files.length >= 20, `${files.length}개뿐`)
})
ck('색인은 파일명이 아니라 파일 안의 subject/grade 를 믿는다', () => {
  // '진로와 직업' 은 띄어쓰기 변형 파일이 둘 있다 — 같은 교과로 묶여야 한다
  const keys = [...prefillIndex.keys()]
  const jinro = keys.filter((k) => k.startsWith('진로와'))
  A(jinro.length === 1, `같은 교과가 ${jinro.length}건으로 갈림: ${jinro}`)
  A(jinro[0] === '진로와 직업|2', jinro[0])
})
ck('중복 파일은 정보가 더 많은 쪽을 쓴다', () => {
  const hit = prefillIndex.get('진로와 직업|2')
  A(hit, '진로와 직업 색인 없음')
  const other = JSON.parse(readFileSync(join(DIR, '진로와직업_2.json'), 'utf-8'))
  A(Object.keys(hit.data).length >= Object.keys(other).length, '적은 쪽을 골랐다')
})
ck('깨진 파일 하나가 전체를 막지 않는다', () => {
  // 존재하지 않는 폴더 → 빈 색인 (예외 아님)
  A(buildPrefillIndex(`${DIR}-없음`).size === 0, '없는 폴더에서 터짐')
})

console.log('\n[선택 — 교과·학년이 드러날 때만]')
ck('"3학년 수학" → 수학_3', () => A(pickPrefill(say('3학년 수학이요')).file === '수학_3.json'))
ck('학년만 있으면 안 고른다', () => A(pickPrefill(say('3학년이요')) === null, '교과 없이 골랐다'))
ck('교과만 있으면 안 고른다', () => A(pickPrefill(say('수학입니다')) === null, '학년 없이 골랐다'))
ck('팩이 없는 조합은 백지 모드', () => A(pickPrefill(say('1학년 수학')) === null, '없는 팩을 골랐다'))
ck('참고자료 전문은 교과 추측에서 제외', () => {
  const ref = { role: 'user', content: '[참고자료: 2025-2 전교.hwpx]\n국어 영어 수학 3학년 …' }
  A(pickPrefill([ref]) === null, '참고자료가 교과를 정해버림')
})
ck('assistant 발화로는 고르지 않는다', () => {
  A(pickPrefill([{ role: 'assistant', content: '3학년 수학은 보통…' }]) === null, 'AI 말로 골랐다')
})
ck('긴 교과명이 먼저 (기술가정 vs 기술)', () => {
  const hit = pickPrefill(say('2학년 기술가정'))
  A(hit?.file === '기술가정_2.json', hit?.file)
})

console.log('\n[주입 내용 — 한 건만, 그대로]')
const doc = docFor('3학년 수학이요')
const d = pickPrefill(say('3학년 수학이요')).data
ck('작년 요약 → "같나요?" → 다른 것만', () => {
  A(doc.includes('작년과 같나요? 달라진 것만 알려주세요.'), '확인 질문 없음')
  A(doc.includes('더 묻지 않고'), '무질문 통과 없음')
  A(doc.includes('처음부터 다시 훑지 않는다'), '재질문 금지 없음')
})
ck('작년 값이 원문 그대로 들어간다', () => {
  for (const r of d.monthly_plan) A(doc.includes(r.units), `단원 누락: ${r.units}`)
  for (const a of d.perf_areas) A(doc.includes(a.name), `수행평가 누락: ${a.name}`)
  A(doc.includes(d.min_achievement_plan), '지도 방안 누락')
})
ck('다른 교과가 섞이지 않는다', () => {
  const others = ['국어', '영어', '과학', '역사', '체육', '음악']
  for (const s of others) A(!doc.includes(`— ${s} 3학년`), `${s} 가 섞임`)
})

console.log('\n[작년 값을 그대로 쓰면 안 되는 것]')
ck('시험 시기는 올해 학사일정', () => {
  A(doc.includes('올해 시기는'), '시기 교체 지시 없음')
  A(doc.includes('exam_schedule'), '출처 명시 없음')
})
ck('시수는 서버 고정표', () => A(doc.includes('서버가 올해 학사일정 고정표로 자동 입력'), '시수 지시 없음'))
ck('배점은 3분류로 나눠 받는다', () => {
  A(doc.includes('작년은 2분류'), '2분류 사실 없음')
  A(doc.includes('네가 임의로 나누지 않는다'), '임의 분배 금지 없음')
})
ck('2학년(2022 개정)은 성취기준 복사 금지', () => {
  const g2 = docFor('2학년 수학')
  A(g2.includes('교육과정이 바뀌었다'), '교육과정 경고 없음')
  A(g2.includes('코드를 그대로 복사하지 않는다'), '복사 금지 없음')
  A(g2.includes('2022 재선정 결과가 아직 주입되지 않았다'), '미주입 사실을 숨김')
})
ck('3학년(2015 유지)은 그 경고가 없다', () => {
  A(!doc.includes('교육과정이 바뀌었다'), '3학년에 불필요한 경고')
})
ck('재선정 결과가 오면 ●▲✗ 규칙이 켜진다', () => {
  const pre = JSON.parse(JSON.stringify(pickPrefill(say('2학년 수학'))))
  pre.data.standards_2022 = [
    { match: '●', old: '[9수03-07]', new: '[9수02-01]' },
    { match: '▲', old: '[9수03-08]', candidates: ['[9수02-02]', '[9수02-03]'] },
    { match: '✗', old: '[9수03-09]' },
  ]
  const p2 = buildPrefillDoc(pre)
  A(p2.includes('확정본이다'), '● 규칙 없음')
  A(p2.includes('후보를 함께 보여주고'), '▲ 규칙 없음')
  A(p2.includes('DB 밖의 코드를 지어내지 않는다'), '✗ 규칙 없음')
  A(p2.includes('[9수02-02] / [9수02-03]'), '후보 목록 미출력')
  A(!p2.includes('2022 재선정 결과가 아직 주입되지 않았다'), '미주입 안내가 남음')
})

console.log('\n[파서가 자신 없다고 한 것 · 보정한 것]')
ck('_warnings 는 교사 확인으로 넘긴다', () => {
  const w = docFor('3학년 도덕')
  A(w.includes('작년 자료 분리 미완'), '경고 절 없음')
  A(w.includes('확정처럼 제시하지 않는다'), '확정 금지 없음')
})
ck('_match_report(보정 내역)를 숨기지 않는다', () => {
  const w = docFor('3학년 도덕')
  A(w.includes('작년 원본에서 보정한 값'), '보정 내역 없음')
})
ck('경고가 없는 교과에는 그 절이 없다', () => {
  A(!doc.includes('작년 자료 분리 미완'), '없는 경고가 붙음')
})

console.log('\n[서·논술형 30% — 작년 값이 못 미칠 때 미리 알린다]')
const NEED = mod.regulation?.thresholds?.essay_total_min
ck('작년이 30% 미만이면 요약 단계에서 알린다', () => {
  A(doc.includes(`올해 규정(${NEED}%)에 못 미친다`), '미달 안내 없음')
  A(doc.includes('생성 단계에서 막힌다'), '결과 예고 없음')
  A(doc.includes('임의로 숫자를 올려 채우지 않는다'), '임의 보정 금지 없음')
})
ck('작년 자료에 값이 아예 없으면 0% 로 단정하지 않는다', () => {
  const e3 = docFor('3학년 영어')
  A(e3.includes('0% 로 단정하지 않는다'), '단정 금지 없음')
})
ck('시험 0회(유형 C)는 서·논술 안내를 하지 않는다', () => {
  const mus = docFor('2학년 음악')
  A(!mus.includes('올해 규정'), '수행 100% 교과에 불필요한 안내')
})

console.log('\n[수행평가 3분기 — 유지/변경/신규]')
ck('세 갈래를 묻는다', () => {
  A(doc.includes('[유지 / 변경 / 신규]'), '분기 없음')
  A(doc.includes('그대로 갈까요, 바꿀까요, 새로 만들까요?'), '질문 문구 없음')
})
ck('유지는 raw 에서 그대로 뽑는다 (요약 금지)', () => {
  A(doc.includes('그대로 뽑아'), '추출 지시 없음')
  A(doc.includes('요약하거나 다듬지 않는다'), '요약 금지 없음')
  A(doc.includes('작년에 결재된 문장'), '이유 없음')
})
ck('raw 전문이 실제로 주입된다', () => {
  const raw = d.perf_plans[0].raw
  for (const line of raw.slice(0, 8)) A(doc.includes(line), `raw 누락: ${line}`)
})
ck('☑ 해석 규칙과 미응시자 점수', () => {
  A(doc.includes('"☑" 는 선택된 평가방법이다'), '체크 해석 없음')
  A(doc.includes(d.perf_plans[0].absent_points), '작년 미응시자 점수 없음')
})

console.log('\n[성취수준]')
ck('작년 소스가 없다는 사실과 검토 필요를 함께 알린다', () => {
  A(doc.includes(d.achievement_levels._note), '파서 메모 누락')
  A(doc.includes('검토가 필요하다는 점을 반드시 알린다'), '검토 안내 없음')
})

console.log('\n[백지 모드 보존]')
ck('prefill 이 없으면 빈 문자열 (프롬프트 그대로)', () => {
  A(buildPrefillDoc(null) === '', '없는데 무언가 붙음')
  A(docFor('1학년 수학') === '', '팩 없는 조합에 붙음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
