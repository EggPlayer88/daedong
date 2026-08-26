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
const {
  pickPrefill, buildPrefillDoc, buildPrefillIndex, prefillIndex, manifest: M,
  findPrefill, normSubject, dbSubject, standardsDb,
} = mod

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
  // 파일명은 '진로와직업_2.json' 인데 안의 subject 는 '진로와 직업' 이다
  const keys = [...prefillIndex.keys()]
  // 학년별로 한 건씩만 있어야 한다 (파일명 띄어쓰기 변형으로 갈리면 두 건이 된다)
  const jinro = keys.filter((k) => k.startsWith('진로와'))
  A(jinro.length === 2, `학년별 1건이 아님: ${jinro}`)
  A(jinro.every((k) => k.startsWith('진로와 직업|')), jinro.join(','))
  A(!readdirSync(DIR).includes('진로와 직업_2.json'), '구버전 중복 파일이 남아 있다')
})
ck('깨진 파일 하나가 전체를 막지 않는다', () => {
  // 존재하지 않는 폴더 → 빈 색인 (예외 아님)
  A(buildPrefillIndex(`${DIR}-없음`).size === 0, '없는 폴더에서 터짐')
})

console.log('\n[선택 — 교과·학년이 드러날 때만]')
ck('"3학년 수학" → 수학_3', () => A(pickPrefill(say('3학년 수학이요')).file === '수학_3.json'))
ck('학년만 있으면 안 고른다', () => A(pickPrefill(say('3학년이요')) === null, '교과 없이 골랐다'))
ck('교과만 있으면 안 고른다', () => A(pickPrefill(say('수학입니다')) === null, '학년 없이 골랐다'))
// ⚠ 전 학년 35블록이 들어와 '1학년 수학' 도 이제 팩이 있다 — 진짜 없는 조합으로 본다
ck('팩이 없는 조합은 백지 모드', () => A(pickPrefill(say('3학년 정보')) === null, '없는 팩을 골랐다'))
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
const g2 = docFor('2학년 수학')
ck('2학년(2022 개정)은 성취기준 복사 금지', () => {
  A(g2.includes('교육과정이 바뀌었다'), '교육과정 경고 없음')
  A(g2.includes('코드를 그대로 복사하지 않는다'), '복사 금지 없음')
})
ck('3학년(2015 유지)은 그 경고가 없다', () => {
  A(!doc.includes('교육과정이 바뀌었다'), '3학년에 불필요한 경고')
})
ck('●▲✗ 3분기 규칙', () => {
  A(g2.includes('**●** — 확정본이다'), '● 규칙 없음')
  A(g2.includes('**▲** — 후보다'), '▲ 규칙 없음')
  A(g2.includes('**✗** — 매칭 실패다'), '✗ 규칙 없음')
  A(g2.includes('DB 밖의 코드를 지어내지 않는다'), 'DB 한정 지시 없음')
  A(g2.includes('원문 대조 확인 필요'), '확인 표식 지시 없음')
})
ck('재선정 결과가 원문 그대로 주입된다 (선정본 + 후보 + 유사도)', () => {
  const st = pickPrefill(say('2학년 수학')).data.standards_2022
  const first = st.by_month.flatMap((m) => m.originals)[0]
  A(g2.includes(first.original_2015), '작년 원문 누락')
  A(g2.includes(`[${first.selected.code}]`), '선정 코드 누락')
  const cand = first.candidates.find((c) => c.code !== first.selected.code)
  A(g2.includes(`[${cand.code}]`), '후보 코드 누락')
  A(g2.includes(`유사도 ${cand.score}`), '유사도 누락')
})

console.log('\n[성취기준 DB 주입 — 이 밖에서 고르지 않는다]')
ck('해당 교과 DB 만 붙는다', () => {
  const db = mod.dbSubject('수학')
  A(db && db.items.length > 0, 'DB 조회 실패')
  A(g2.includes(`수학 성취기준 DB (${db.curriculum}, ${db.items.length}개)`), 'DB 절 없음')
  for (const it of db.items.slice(0, 5)) A(g2.includes(`[${it.code}]`), `코드 누락: ${it.code}`)
})
ck('다른 교과 DB 는 섞이지 않는다', () => {
  const sci = mod.dbSubject('과학')
  A(!g2.includes(`[${sci.items[0].code}]`), '과학 코드가 수학 프롬프트에 섞임')
})
ck('교과명 표기가 달라도 찾는다 (진로와 직업 ↔ 진로와_직업)', () => {
  const db = mod.dbSubject('진로와 직업')
  A(db, 'DB 키 매칭 실패')
  A(docFor('2학년 진로와 직업').includes('성취기준 DB'), 'DB 미주입')
})
ck('재선정에 등장한 코드의 수준별 진술만 붙인다', () => {
  A(g2.includes('수준별 진술'), '수준 진술 절 없음')
  const st = pickPrefill(say('2학년 수학')).data.standards_2022
  const used = st.by_month.flatMap((m) => m.originals).map((o) => o.selected?.code).filter(Boolean)
  A(used.some((c) => g2.includes(`  [${c}]\n    A:`)), '선정 코드의 수준 진술이 없음')
  A(g2.includes('그대로 베끼지 말고'), '다듬기 지시 없음')
})
ck('3학년(2015 유지)에는 2022 DB 를 붙이지 않는다', () => {
  A(!doc.includes('성취기준 DB'), '3학년에 2022 DB 가 붙음')
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

console.log('\n[서·논술형 — 칸을 전부 세야 한다]')
const NEED = mod.regulation?.thresholds?.essay_total_min
ck('작년 합계는 essay_detail.computed_sum 이다 (첫 칸만 세지 않는다)', () => {
  const ed = d.essay_detail
  A(ed, 'essay_detail 없음')
  A(ed.perf_cells.length > 1, '수행 칸이 하나뿐 — 이 교과로는 회귀를 못 잡는다')
  A(doc.includes(`### 서·논술형 (작년 합계 ${ed.computed_sum}%)`), '합계 표기 없음')
  for (const c of [...ed.exam_cells, ...ed.perf_cells]) A(doc.includes(c), `칸 누락: ${c}`)
})
ck('작년 합계 칸과 계산 합을 함께 보여준다 (검산 근거)', () => {
  A(doc.includes(`작년 문서의 합계 칸: ${d.essay_detail.total_cell_last_year}`), '합계 칸 없음')
})
ck('수학 3학년은 33% 라 규정을 충족한다', () => {
  A(d.essay_detail.computed_sum >= NEED, `${d.essay_detail.computed_sum}%`)
  A(!doc.includes('규정(30%)에 못 미친다'), '충족인데 미달 안내가 뜸')
})
ck('% 표기가 없으면 "작년 값 확인 필요"', () => {
  const gt = docFor('2학년 기술가정')
  A(gt.includes('작년 값 확인 필요'), '확인 안내 없음')
  A(gt.includes('% 표기가 없다'), '이유 없음')
  A(gt.includes('확정처럼 제시하지 않는다'), '확정 금지 없음')
})
ck('% 표기가 온전한 교과에는 그 안내가 없다', () => {
  A(!doc.includes('작년 값 확인 필요'), '불필요한 확인 안내')
})
ck('시험 0회(유형 C)는 서·논술 절을 만들지 않는다', () => {
  const mus = docFor('2학년 음악')
  A(!mus.includes('### 서·논술형'), '수행 100% 교과에 불필요한 절')
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

console.log('\n[1학년 자유학기 팩 (type: free_semester)]')
const free = pickPrefill(say('1학년 과학'))
const fdoc = buildPrefillDoc(free)
ck('1학년 12블록이 색인에 있다', () => {
  const g1 = [...prefillIndex.keys()].filter((k) => k.endsWith('|1'))
  A(g1.length >= 12, `1학년 ${g1.length}건`)
  A(free?.data?.type === 'free_semester', free?.data?.type)
})
ck('점수형 절이 아예 없다', () => {
  // 절 제목으로 본다 — '작년 구성'·'반영비율' 은 "그런 것이 없다" 는 문장에도 나온다
  for (const s of ['### 작년 구성', '### 서·논술형', '정기시험 ', '수행평가 출제 계획']) {
    A(!fdoc.includes(s), `자유학기에 점수형 항목이 섞임: ${s}`)
  }
  A(fdoc.includes('점수·반영비율·미응시 점수는 **작년에도 없었다**'), '자유학기 명시 없음')
})
ck('작년 병합 월 표기는 계승하지 않는다 ("12, 1월")', () => {
  const last = free.data.monthly_plan.at(-1).month
  A(last.includes(','), `이 교과로는 합쳐진 달을 확인할 수 없다: ${last}`)
  A(fdoc.includes(`- ${last}:`), '작년 원문이 참고용으로도 없음')
  A(fdoc.includes('**계승하지 않는다.**'), '미계승 지시 없음')
  A(fdoc.includes('월 라벨은 서버가 행 순서로 넣는다'), '서버 고정 안내 없음')
  A(fdoc.includes('어느 행에 넣을지** 정하는 참고로만'), '참고 용도 명시 없음')
})
ck('자유학기 요약이 시수는 받는다고 말한다', () => {
  A(fdoc.includes('주당 시수는 받는다'), '시수 안내 없음')
  A(fdoc.includes('시수는 점수가 아니라 수업 계획'), '이유 없음')
})
ck('성취수준은 작년 원문을 칸 재료로 계승', () => {
  const alv = free.data.achievement_levels_last_year
  A(alv && alv.A.length, '작년 성취수준이 없다')
  A(fdoc.includes('원문 그대로 계승한다'), '계승 지시 없음')
  A(fdoc.includes('재선정이 필요 없다'), '2022 코드 근거 없음')
  A(fdoc.includes(`[A] ${alv.A.length}칸`), '칸 수 표기 없음')
  for (const t of alv.A) A(fdoc.includes(t), '작년 진술 누락')
  A(fdoc.includes(`최대 ${M.achievement_levels.cells}칸`), '칸 수가 manifest 에서 안 옴')
})
ck('작년 성취수준이 없으면 DB 경로로 넘긴다', () => {
  const pre = JSON.parse(JSON.stringify(free))
  delete pre.data.achievement_levels_last_year
  const d2 = buildPrefillDoc(pre)
  A(d2.includes('교과 DB 의 수준별 진술로 초안'), 'DB 경로 없음')
  A(d2.includes('검토 필요를 알린다'), '검토 안내 없음')
})
ck('활동은 [유지/변경/신규] 3분기', () => {
  A(fdoc.includes('[유지 / 변경 / 신규]'), '분기 없음')
  A(fdoc.includes('그대로 갈까요, 바꿀까요, 새로 만들까요?'), '질문 문구 없음')
  A(fdoc.includes('요약하거나 다듬지 않는다'), '요약 금지 없음')
  A(fdoc.includes('"☑" 가 선택된 항목'), '체크 해석 없음')
})
ck('활동 원문(과제·성취기준·A~E·방법)이 주입된다', () => {
  for (const a of free.data.activities) {
    A(fdoc.includes(a.task), `과제 누락: ${a.task.slice(0, 20)}`)
    A(fdoc.includes(a.standards), '성취기준 누락')
    for (const [lv, t] of Object.entries(a.levels)) A(fdoc.includes(`${lv}: ${t}`), `${lv} 누락`)
    if (a.methods1) A(fdoc.includes(a.methods1), '평가방법1 누락')
  }
})
ck('이름 빈 활동은 교사에게 받는다 (AI 가 짓지 않는다)', () => {
  const blank = free.data.activities.some((a) => !a.name)
  A(blank, '이 교과로는 확인할 수 없다 (이름이 다 있음)')
  A(fdoc.includes('작년 문서에 이름 칸이 비어 있음'), '빈 이름 표시 없음')
  A(fdoc.includes('네가 짓지 않는다'), '작명 금지 없음')
})
ck('활동 자료가 없는 교과는 처음부터 묻는다 (진로와 직업)', () => {
  const j = buildPrefillDoc(pickPrefill(say('1학년 진로와 직업')))
  A(j.includes('작년 활동 자료가 없다'), '미검출 안내 없음')
  A(j.includes('없는 활동을 지어내지 않는다'), '지어내기 금지 없음')
  A(j.includes('활동 블록 미검출'), '_warnings 원문 없음')
})
ck('2·3학년 팩은 점수형 흐름 그대로', () => {
  A(doc.includes('### 작년 구성'), '점수형 요약이 사라짐')
  A(!doc.includes('작년 자유학기 구성'), '자유학기 절이 섞임')
})

console.log('\n[교과명 표기 — 공백·가운뎃점이 갈려도 같은 교과다]')
// 2026-08-26: 교사가 '디지털리터러시' 라고 붙여 쓰면 작년 자료가 있는데도 백지로 시작했다.
//   prefill '디지털 리터러시' · 파일명 '디지털리터러시' · DB '진로와_직업' 처럼
//   같은 교과가 자리마다 다르게 적혀 있다.
ck('정규화는 공백·가운뎃점·밑줄만 지운다', () => {
  A(normSubject('디지털 리터러시') === '디지털리터러시', '공백')
  A(normSubject('기술·가정') === '기술가정', '가운뎃점')
  A(normSubject('진로와_직업') === '진로와직업', '밑줄')
  A(normSubject('수학') === '수학', '멀쩡한 이름을 건드림')
  A(normSubject(null) === '', 'null')
})
ck('붙여 쓴 교과명으로도 작년 자료를 찾는다', () => {
  for (const [typed, grade, want] of [
    ['디지털리터러시', 1, '디지털 리터러시'],
    ['디지털 리터러시', 1, '디지털 리터러시'],
    ['진로와직업', 2, '진로와 직업'],
    ['진로와·직업', 1, '진로와 직업'],
  ]) {
    const hit = pickPrefill(say(`${grade}학년 ${typed} 계획서 만들어줘`))
    A(hit, `${typed} ${grade}학년 미검출`)
    A(hit.data.subject === want, `${typed} → ${hit.data.subject}`)
    A(hit.data.grade === grade, `${typed} 학년 어긋남`)
  }
})
ck('표기를 지운 대조가 없던 일치를 만들지 않는다', () => {
  // 문장 전체에서 공백을 지우면 '한 문장' 이 '한문' 이 된다 — 구분자가 든 교과명에만 쓴다
  A(pickPrefill(say('1학년 이 한 문장을 평가에 넣고 싶습니다')) === null, "'한 문장' → 한문")
  A(pickPrefill(say('2학년 정 보고서 형식으로')) === null, "'정 보고서' → 정보")
  // 그래도 제대로 쓴 교과명은 찾는다
  A(pickPrefill(say('1학년 한문'))?.data.subject === '한문', '한문 미검출')
})
ck('findPrefill 은 정확일치를 먼저 본다', () => {
  A(findPrefill('디지털 리터러시', 1).file === '디지털리터러시_1.json', '정확일치')
  A(findPrefill('디지털리터러시', 1).file === '디지털리터러시_1.json', '정규화 일치')
  A(findPrefill('디지털 리터러시', 3) === null, '없는 학년에서 아무거나 집음')
  A(findPrefill('', 1) === null, '빈 교과명')
})
ck('DB 조회도 같은 정규화를 쓴다', () => {
  A(dbSubject('진로와 직업')?.key === '진로와_직업', 'DB 표기 변형')
  A(dbSubject('진로와직업')?.key === '진로와_직업', 'DB 붙여쓰기')
  A(dbSubject('디지털 리터러시') === null, 'DB 에 없는 교과가 잡힘')
})

console.log('\n[성취기준 DB 에 없는 교과 — 정직 경로]')
// 학교자율시간 과목(디지털 리터러시)·학교 개설 과목(보건)은 2022 개정 14개 교과 DB 밖이다.
// 없는 것을 없다고 말해야 모델이 코드를 지어내지 않는다 (제1원칙).
const DB_NAMES = new Set(Object.keys(standardsDb?.subjects || {}).map(normSubject))
const OUTSIDE = [...prefillIndex.values()]
  .map((e) => e.data.subject)
  .filter((s2, i, arr) => arr.indexOf(s2) === i && !DB_NAMES.has(normSubject(s2)))
ck('DB 밖 교과가 실제로 있다 (이 테스트의 전제)', () => {
  A(OUTSIDE.length > 0, 'DB 밖 교과가 하나도 없다')
  A(OUTSIDE.includes('디지털 리터러시'), `디지털 리터러시가 빠짐: ${OUTSIDE}`)
})
ck('DB 밖 교과에는 "DB 에 없다" 를 먼저 밝힌다', () => {
  const dl = docFor('1학년 디지털 리터러시')
  A(dl.includes('성취기준 DB 에 없다'), 'DB 부재 안내 없음')
  A(dl.includes('작년 자료와 선생님 입력으로 진행합니다'), '교사에게 할 말이 없음')
  A(dl.includes('DB 에서 고르는 경로'), 'DB 경로를 닫지 않음')
  A(dl.includes('공란은 실패가 아니다'), '제1원칙 연결 없음')
})
ck('DB 부재 안내는 대화를 막지 않는다 (작년 계승 경로는 그대로)', () => {
  const dl = docFor('1학년 디지털 리터러시')
  A(dl.includes('작년 활동 계획'), '작년 활동 계승 절이 사라짐')
  A(dl.includes('원문 그대로 계승한다'), '작년 성취수준 계승 절이 사라짐')
  const acts = findPrefill('디지털 리터러시', 1).data.activities
  A(acts.length === 3, `작년 활동 3건이 아님: ${acts.length}`)
  for (const a of acts) A(dl.includes(a.name), `활동 누락: ${a.name}`)
})
ck('DB 안의 교과에는 그 안내가 붙지 않는다', () => {
  for (const t of ['1학년 수학', '3학년 수학', '2학년 정보']) {
    A(!docFor(t).includes('성취기준 DB 에 없다'), `${t} 에 불필요한 안내`)
  }
})
ck('DB 밖 교과에게 "교과 DB 로 초안" 을 시키지 않는다', () => {
  // 자유학기 성취수준 분기 — DB 가 없으면 교사에게 받아야 한다
  const nodb = buildPrefillDoc({
    file: 'x.json',
    data: { subject: '없는교과', grade: 1, type: 'free_semester', monthly_plan: [], activities: [] },
  })
  A(nodb.includes('성취기준 DB 에도 없다'), 'DB 없는데 DB 초안을 지시')
  A(!nodb.includes('교과 DB 의 수준별 진술로 초안'), 'DB 초안 지시가 남음')
})
ck('DB 도 prefill 도 없으면 백지 모드 (크래시 아님)', () => {
  A(docFor('1학년 학교자율시간탐구') === '', '없는 교과에 무언가 붙음')
  A(pickPrefill(say('1학년 학교자율시간탐구')) === null, '엉뚱한 팩을 집음')
})

console.log('\n[백지 모드 보존]')
ck('prefill 이 없으면 빈 문자열 (프롬프트 그대로)', () => {
  A(buildPrefillDoc(null) === '', '없는데 무언가 붙음')
  A(docFor('3학년 정보') === '', '팩 없는 조합에 붙음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
