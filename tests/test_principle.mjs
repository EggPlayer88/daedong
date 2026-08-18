// 제0원칙 + 배점 규칙이 프롬프트에 들어갔는지, 서버 검증기와 어긋나지 않는지
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const API = `${ROOT}/apps/main/api/doc-ai`
const mod = await import(`${API}/chat.js`)
const P = mod.SYSTEM_PROMPT, M = mod.manifest
let fail = 0
const ck = (n, fn) => { try { fn(); console.log(`  ✓ ${n}`) } catch (e) { fail++; console.log(`  ✗ ${n}: ${e.message}`) } }
const A = (c, m) => { if (!c) throw new Error(m) }

console.log('\n[제0원칙]')
ck('프롬프트 최상위에 위치 (제1원칙보다 앞)', () => {
  const i0 = P.indexOf('제0원칙'), i1 = P.indexOf('제1원칙')
  A(i0 !== -1, '제0원칙 없음'); A(i1 !== -1, '제1원칙 없음')
  A(i0 < i1, `순서 뒤바뀜 (${i0} > ${i1})`)
  A(i0 < 500, `너무 뒤에 있음 (${i0}자 지점)`)
})
ck('핵심 문구', () => {
  A(P.includes('안 되는 걸 되는 것처럼 하지 않는다'), '표어 없음')
  A(P.includes('빈손으로 돌려보내지 않는다'), '생성은 진행한다는 단서 없음')
  A(P.includes('한글에서 직접 편집'), '편집 안내 없음')
})
ck('한도 초과 시 계획을 축소시키지 않는다', () => {
  A(P.includes('계획을 축소시키지 않는다'), '축소 금지 문구 없음')
  A(P.includes('잘라내는 일은 서버가 하고'), '역할 분담 없음')
  A(!P.includes('PLAN_READY JSON 에는 2개까지만 넣는다'), '옛 지시(잘라서 넣기)가 남음')
})

console.log('\n[배점 규칙 — 프롬프트 ↔ 서버 검증기]')
ck('각 평가가 각각 100점 만점 (합이 아니다)', () => {
  A(P.includes('각 회차** — 선택형 만점 + 서·논술형 만점 = 100'), '회차 규칙 없음')
  A(P.includes('영역마다 만점 100점'), '수행 규칙 없음')
  A(P.includes('나눠 갖지 않는다'), '합 방식이 아님을 명시하지 않음')
  A(!P.includes('영역 만점의 합이 100점'), '옛 규약이 남음')
})
ck('가중치는 반영비율로만', () => A(P.includes('반영비율(%)로만'), '문구 없음'))
ck('표기는 서버가 조립 (AI 는 반영비율만)', () => {
  A(P.includes('서버가 조립한다'), '조립 주체 명시 없음')
  A(P.includes('100(40%)'), '표기 예시 없음')
  A(P.includes('반영비율(ratio)** 만'), 'AI 가 줄 것이 명시되지 않음')
})
ck('서·논술형 비율 필수 + 30% 검증 유지', () => {
  A(P.includes('반드시 수집'), '필수 수집 문구 없음')
  A(P.includes('30% 미만'), '30% 규칙 없음')
  const r = M.exam.rounds.item_fields.find(f => f.key === 'essay_ratio')
  const a = M.perf_summary.item_fields.find(f => f.key === 'essay_ratio')
  A(r?.required === true, 'rounds.essay_ratio 필수 아님')
  A(a?.required === true, 'perf_areas.essay_ratio 필수 아님')
  A(P.includes('서·논술형 반영비율(회차)') && P.includes('필수'), '프롬프트에 필수 표기 없음')
})
ck('거부 메시지 형식을 미리 알림', () => A(P.includes('어느 합이 몇 점/몇 %인지'), '안내 없음'))
ck('수집 라벨이 새 규약을 반영', () => {
  A(P.includes('선택형 만점(N점)'), 'mc 라벨 없음')
  A(P.includes('영역 만점 (항상 100'), 'perf points 라벨 미갱신')
  A(P.includes('영역 반영비율(%)'), 'ratio 필드 없음')
})

console.log('\n[서·논술형 30% — 3분류]')
ck('의무 교과 6개', () => {
  for (const s of ['국어', '영어', '수학', '사회', '과학', '역사']) A(P.includes(s), `누락: ${s}`)
  A(P.includes('30% 이상 의무 교과'), '의무 분류 없음')
})
ck('예외 교과 3개', () => {
  A(P.includes('예외 교과 (30% 규정 미적용)'), '예외 분류 없음')
  for (const s of ['음악', '미술', '체육']) A(P.includes(s), `누락: ${s}`)
})
ck('그 외는 추정 금지 + 교사에게 질문', () => {
  A(P.includes('예외 여부가 확정되지 않았다'), '미확정 안내 없음')
  A(P.includes('추정하지 말고 교사에게 직접 묻는다'), '질문 지시 없음')
  A(!P.includes('TBD — 학업성적관리규정'), '옛 TBD 가 남음')
})
ck('분류가 상수에서 파생 (하드코딩 아님)', () => {
  const c2 = JSON.parse(JSON.stringify(mod.constants))
  c2.essay_ratio_rule.exempt_subjects = ['테스트교과']
  c2.essay_ratio_rule.min_percent = 45
  const p2 = mod.buildScaleDoc(c2)
  A(p2.includes('테스트교과'), '예외 목록 변경 미반영')
  A(p2.includes('45%'), '기준 변경 미반영')
})
console.log('\n[학년·교과군 기본값 — 제시 후 확인]')
ck('3학년 기본값 (1회 / 40:60 / 80+20)', () => {
  A(P.includes('정기시험 1회, 지필 40% : 수행 60%'), '3학년 기본값 없음')
  A(P.includes('선택형 80 + 서·논술형 20'), '지필 구성 없음')
  A(P.includes('영어') && P.includes('88'), '영어 예외 실측 없음')
})
ck('예체능·보건 기본값 (0회 / 100% / 3개 40·30·30)', () => {
  A(P.includes('정기시험 0회, 수행 100%'), '예체능 기본값 없음')
  A(P.includes('40/30/30'), '수행 패턴 없음')
  A(P.includes('현재 양식은 수행 2개까지 담긴다'), '양식 한도 경고 없음')
})
ck('단정 금지 — 제시하고 확인받는 흐름', () => {
  A(P.includes('단정 금지'), '단정 금지 문구 없음')
  A(P.includes('먼저 제시하고 맞는지 확인받은 뒤'), '확인 절차 없음')
  A(P.includes('규정이 아니므로'), '관행임을 밝히지 않음')
})
ck('기본값이 상수에서 파생', () => {
  const c2 = JSON.parse(JSON.stringify(mod.constants))
  c2.grade_defaults.grade3.ratio = { written: 55, performance: 45 }
  const p2 = mod.buildDefaultsDoc(c2)
  A(p2.includes('지필 55% : 수행 45%'), '상수 변경 미반영')
})

console.log('\n[양식 유형 분기]')
ck('결정 규칙이 프롬프트에 있음', () => {
  A(P.includes('## 양식 유형'), '유형 절 없음')
  for (const r of ['grade1_free', 'arts', 'grade3', 'default']) A(P.includes(r), `누락: ${r}`)
})
ck('미배치 유형이어도 대화는 끝까지', () => {
  A(P.includes('대화는 끝까지 진행해 내용을 확정해 둔다'), '안내 없음')
})
ck('자유학기: 묻지 않을 것이 명시됨', () => {
  A(P.includes('자유학기 — 물어볼 것이 다르다'), '자유학기 절 없음')
  for (const s of ['반영비율 (지필 : 수행)', '서·논술형 반영비율, 30% 규정', '정기시험 횟수·시기·배점']) {
    A(P.includes(s), `묻지 않을 항목 누락: ${s}`)
  }
})
ck('자유학기: 대신 물을 것 + 실측 근거', () => {
  A(P.includes('이수 여부 판단 기준과 피드백'), '대체 항목 없음')
  A(P.includes("'평정' 0회") || P.includes('"평정" 0회'), '실측 근거 없음')
})
ck('자유학기: 명세 미확정을 숨기지 않는다', () => {
  A(P.includes('상세 수집 항목은 아직 확정 대기'), '미확정 고지 없음')
  A(P.includes('지어내지 않는다'), '제1원칙 연결 없음')
})
ck('유형 분기가 manifest 에서 파생', () => {
  const m2 = JSON.parse(JSON.stringify(mod.manifest))
  delete m2.variants.items.grade1_free
  const p2 = mod.buildVariantDoc(m2)
  A(!p2.includes('자유학기 — 물어볼 것이 다르다'), '유형 제거가 반영 안 됨')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
