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
  A(P.includes('각 회차** — 선택형 + 단답형·완성형 + 서·논술형 = 100'), '회차 규칙 없음')
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

console.log('\n[서·논술형 30% — 유형 기반 (교과명 분류는 강등)]')
ck('적용 여부는 유형이 정한다', () => {
  A(P.includes('교과명이 아니라 평가 유형'), '유형 기준 문구 없음')
  A(P.includes('유형 C(수행 100%)·D(자유학기)는 제외'), '제외 유형 없음')
})
ck('교과 목록은 "작년 선택 유형" 짐작용으로만', () => {
  A(P.includes('작년 선택 유형 (짐작용 — 확정 아님)'), '강등 표기 없음')
  A(P.includes('올해 유형은 교사가 고른다'), '단정 금지 없음')
  A(!P.includes('30% 이상 의무 교과'), '옛 의무/예외 분류가 남음')
})
ck('합계는 서버가 재계산', () => {
  A(P.includes('합계는 서버가 재계산'), '재계산 명시 없음')
})

console.log('\n[규정 한계선 — V01~V18 근거]')
ck('유형 A~D 와 한계선', () => {
  for (const t of ['A. 일반형', 'B. 지필 1회형', 'C. 수행 100%형', 'D. 자유학기형']) {
    A(P.includes(t), `유형 누락: ${t}`)
  }
  A(P.includes('임의규정'), '임의규정 명시 없음')
  A(P.includes('유형을 단정해 밀어붙이지 않는다'), '강제 금지 없음')
})
ck('수치 제안 시 권한 고지 (7-1)', () => {
  A(P.includes('규정 적합 범위 내 예시이며, 확정 권한은 교과협의회에 있습니다'), '권한 고지 없음')
})
ck('수행 100% → 최소 3개 영역 산수 안내 (R3)', () => {
  A(P.includes('최소 3개 영역이 필요하다'), '산수 안내 없음')
  A(P.includes('40 + 40 = 80 < 100'), '근거 산수 없음')
})
ck('서논술 30% 분모 = 학기말 총 배점 (7-4)', () => {
  A(P.includes('학기말 총 배점(지필 환산 + 수행 환산)'), '분모 설명 없음')
  A(P.includes('정기시험 안에서 30% 가 아니다'), '오해 방지 문구 없음')
  A(P.includes('9+9=18%'), '예시 없음')
})
ck('V16·V17 을 대화 중 부드럽게 (지적 아닌 제안)', () => {
  A(P.includes('영역명이 추상적일 때'), 'V16 안내 없음')
  A(P.includes('결시자·학적변동자 처리 기준이 비었을 때'), 'V17 안내 없음')
  A(P.includes('지적이 아니라 제안으로 말한다'), '어조 지시 없음')
})
ck('심의 절차를 되묻지 않는다 (V09 비활성)', () => {
  A(!P.includes('학업성적관리위원회 심의 대상'), '심의 표식이 프롬프트에 남음')
  A(!P.includes('위원회 심의 필요'), '유형 설명에 심의 딱지가 남음')
  A(P.includes('교과 교사의 재량'), '재량 명시 없음')
  A(P.includes('심의·결재 절차를 되묻지 않는다'), '되묻기 금지 없음')
})
ck('규정 안내는 한 줄 (조문 나열 금지)', () => {
  A(P.includes('규정 안내는 **한 줄**'), '한 줄 규칙 없음')
  A(P.includes('조문 번호를 늘어놓지 않는다'), '나열 금지 없음')
})
ck('답변 분량 규칙 (실사용 피드백)', () => {
  A(P.includes('한 턴 3~5문장'), '분량 규칙 없음')
  A(P.includes('계산 과정을 대화에 펼치지 않는다'), '계산 전개 금지 없음')
  A(P.includes('질문은 한 턴에 1~2개'), '질문 수 제한 없음')
  A(P.includes('자세한 내용은 확인 카드에서'), '요약 후 넘기기 문구 없음')
})
ck('한계선이 규정 자산에서 파생', () => {
  const r2 = JSON.parse(JSON.stringify(mod.regulation))
  r2.thresholds.perf_area_max = 25
  r2.thresholds.essay_total_min = 45
  const p2 = mod.buildRegulationDoc(r2)
  A(p2.includes('한 영역 ≤ 25%'), '상한 변경 미반영')
  A(p2.includes('서·논술형 **≥ 45%**'), '기준 변경 미반영')
  A(p2.includes('최소 4개 영역'), '산수가 상수를 따라가지 않음')
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
  delete m2.variant_routing.items.grade1_free
  const p2 = mod.buildVariantDoc(m2)
  A(!p2.includes('자유학기 — 물어볼 것이 다르다'), '유형 제거가 반영 안 됨')
})

console.log('\n[예체능판 3수준 — v3.1]')
ck('예체능 교과 목록은 FINAL variants 에서 온다', () => {
  const subs = M.variants.arts.subjects
  A(subs.join(' · ') === '음악 · 미술 · 체육', subs.join(','))
  A(!subs.includes('보건'), '보건이 예체능판으로 들어감 (성취도 5단계다)')
})
ck('A~C 만 수집한다고 명시', () => {
  A(P.includes('성취수준 3단계'), '단계 수 표기 없음')
  A(P.includes('**성취수준은 A·B·C 3단계만 받는다.**'), '수집 범위 지시 없음')
  A(P.includes('D·E 진술을 묻지 말고'), '질문 금지 없음')
})
ck('보건·정보는 예외임을 못박는다', () => {
  A(P.includes('보건·정보는 여기 해당하지 않는다'), '예외 안내 없음')
  A(P.includes('5단계라 기본 양식을 쓴다'), '이유 없음')
})
ck('단계 수가 자산에서 파생 (하드코딩 아님)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.variants.arts.achievement_levels = ['A', 'B']
  const p2 = mod.buildVariantDoc(m2)
  A(p2.includes('성취수준 2단계'), '단계 수 변경 미반영')
  A(p2.includes('A·B 2단계만 받는다'), '수집 범위 미반영')
})
ck('성취수준 수집 항목이 유형 의존임을 밝힌다', () => {
  A(P.includes('단계 수는 양식 유형이 정한다'), '유형 의존 안내 없음')
})

console.log('\n[정기시험 3분류 — 2026 학교 확정]')
ck('3분류 명칭이 정확하다', () => {
  A(P.includes('선택형(객관식)'), 'mc 명칭 없음')
  A(P.includes('단답형·완성형(주관식)'), 'short 명칭 없음')
  A(P.includes('서·논술형(주관식)'), 'essay 명칭 없음')
  A(P.includes('**회차 100점 = 셋의 합**'), '100점 불변식 없음')
})
ck('30% 산입은 서·논술형만 (단답형·완성형 제외)', () => {
  A(P.includes('- 산입: 서·논술형'), '산입 목록 없음')
  A(P.includes('**미산입**: 선택형 · 단답형·완성형'), '미산입 목록 없음')
  A(P.includes('30% 계산에 넣지 않는다'), '제외 지시 없음')
})
ck('작년 2분류 → 올해 3분류 전환 질문', () => {
  A(P.includes('작년 자료는 2분류다'), '전환 절 없음')
  A(P.includes('올해부터 정기시험 배점을 선택형 / 단답형·완성형 / 서·논술형 3가지로 적습니다'), '질문 문구 없음')
  A(P.includes('네가 임의로 나누지 않는다'), '임의 분배 금지 없음')
  A(P.includes('모르겠다') && P.includes('공란'), '모를 때 처리 없음')
})
ck('3분류가 다 담기므로 과도기 안내는 없다 (v3 마스터)', () => {
  A(!P.includes('현행 양식에는 아직 칸이 없다'), '끝난 과도기 안내가 남음')
  A(!P.includes('문서에 들어가지 못한다'), '누락 안내가 남음')
})
ck('칸이 빠지면 안내가 되살아난다 (자산 파생)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.exam.template_categories = ['mc', 'essay']
  const p2 = mod.buildExamMethodDoc(m2)
  A(p2.includes('현행 양식에는 아직 칸이 없다'), '되살아나지 않음')
  A(p2.includes('네가 합치지 않는다'), '임의 합산 금지 없음')
})
ck('3분류가 manifest 에서 파생 (하드코딩 아님)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.exam.method_categories[1].short_label = '단답형'
  m2.exam.template_categories = ['mc', 'short', 'essay']
  const p2 = mod.buildExamMethodDoc(m2)
  A(p2.includes('**미산입**: 선택형 · 단답형'), '명칭 변경 미반영')
  A(!p2.includes('현행 양식에는 아직 칸이 없다'), '칸이 생겼는데 과도기 안내가 남음')
})
ck('수집 항목에 short 가 들어감', () => {
  const f = M.exam.rounds.item_fields.find(x => x.key === 'short')
  A(f, 'manifest 에 short 필드 없음')
  A(P.includes(f.label), `프롬프트에 라벨 없음: ${f.label}`)
})

console.log('\n[횟수 세트 — 시험 횟수 × 수행 개수]')
ck('확정 세트 3줄이 그대로 있음', () => {
  A(P.includes('정기시험 0회 → 수행평가 3개 **(고정)**'), '0회 세트 없음')
  A(P.includes('정기시험 1회 → 수행평가 2개 **(고정)**'), '1회 세트 없음')
  A(P.includes('정기시험 2회 → 수행평가 1~2개'), '2회 세트 없음')
})
ck('제외 조합과 이유', () => {
  A(P.includes('정기시험 0회 × 수행 4개'), '0×4 제외 없음')
  A(P.includes('정기시험 1회 × 수행 3개'), '1×3 제외 없음')
  A(P.includes('유명무실'), '제외 이유 없음')
})
ck('세트 밖은 막지 않는다 (제0원칙 경로)', () => {
  A(P.includes('세트 밖을 교사가 원할 때'), '세트 밖 절 없음')
  A(P.includes('거부하지 않는다'), '거부 금지 문구 없음')
  A(P.includes('그래도 진행할까요?'), '확인 질문 없음')
  A(P.includes('자르고 알리는 일은 서버가 한다'), '역할 분담 없음')
})
ck('작년과 달라진 조합을 먼저 짚는다', () => {
  A(P.includes('2025-2 3학년 영어'), '전환 사례 없음')
  A(P.includes('작년 시험 1회 × 수행 3개 → 올해는 수행 2개'), '전환 내용 없음')
  A(P.includes('네가 골라 주지 않는다'), '임의 선택 금지 없음')
})
ck('세트가 상수에서 파생 (하드코딩 아님)', () => {
  const c2 = JSON.parse(JSON.stringify(mod.constants))
  c2.perf_count_rule.by_exams['2'] = { min: 1, max: 1 }
  c2.perf_count_rule.transition_notes = []
  const p2 = mod.buildCountSetDoc(c2)
  A(p2.includes('정기시험 2회 → 수행평가 1개'), '세트 변경 미반영')
  A(!p2.includes('작년과 달라진 조합'), '전환 안내 제거 미반영')
})

console.log('\n[물어보는 방식이 정해진 칸 — collection_guides]')
ck('지도 방안: 관행 문구를 먼저 제안한다', () => {
  const g = M.collection_guides_fields.min_achievement_plan
  A(P.includes(g.suggest_first), '관행 문구 없음')
  A(P.includes(g.ask), '질문 문구 없음')
  A(P.includes('먼저 제안하고 확인받는다'), '제안-확인 흐름 없음')
  A(P.includes('묻지 않고 넣지 않는다'), '무단 기재 금지 없음')
})
ck('미응시자 칸: 기준 문장이 아니라 점수', () => {
  const g = M.collection_guides_fields['perf_plans.absentee_points']
  A(P.includes('이 칸에 들어가는 것은 **점수**다'), '의미 명시 없음')
  A(P.includes(g.ask), '질문 문구 없음')
  A(P.includes(g.format), '형식 안내 없음')
  A(P.includes('공통이면 한 번만 묻고'), '공통 처리 없음')
  A(P.includes('미정이면 공란'), '미정 처리 없음')
})
ck('수집 필드도 "미응시자 점수" 로 바뀌었다', () => {
  const f = M.perf_plans.item_fields.find(x => x.key === 'absentee_points')
  A(f, 'absentee_points 필드 없음')
  A(f.label === '미응시자 점수', f.label)
  A(!M.perf_plans.item_fields.some(x => x.key === 'absentee_rule'), '옛 필드가 남음')
  A(P.includes('미응시자 점수'), '프롬프트 수집 목록에 없음')
})
ck('펼친 표가 FINAL 원문과 같은 것을 말한다', () => {
  // FINAL 의 collection_guides 는 산문, 우리 collection_guides_fields 는 구조화본이다.
  // 둘이 갈라지면 계약과 구현이 다른 말을 하게 되므로 핵심 문구를 대조한다.
  const prose = M.collection_guides
  const f = M.collection_guides_fields
  A(prose.MIN_ACH.includes(f.min_achievement_plan.suggest_first), '관행 문구 불일치')
  const ab = f['perf_plans.absentee_points']
  A(prose.PP_ABSENT.includes('점수'), 'FINAL 이 점수라고 말하지 않음')
  // FINAL 이 든 예시("각 영역당 20점")를 우리 질문 문구가 그대로 쓴다
  const example = /'([^']*각 영역당[^']*)'/.exec(prose.PP_ABSENT)?.[1]
  A(example, 'FINAL 에 예시가 없음')
  A(ab.ask.includes(example), `질문 문구가 FINAL 예시(${example})를 안 씀`)
  A(prose.PP_ABSENT.includes('미정이면 공란'), 'FINAL 의 미정 처리와 어긋남')
  A(ab.rule.includes('미정이면 공란'), '우리 규칙에 미정 처리 없음')
})
ck('안내 문구가 자산에서 파생 (하드코딩 아님)', () => {
  const m2 = JSON.parse(JSON.stringify(M))
  m2.collection_guides_fields.min_achievement_plan.suggest_first = '개별 상담 후 재평가'
  delete m2.collection_guides_fields['perf_plans.absentee_points']
  const p2 = mod.buildGuideDoc(m2)
  A(p2.includes('개별 상담 후 재평가'), '관행 문구 변경 미반영')
  A(!p2.includes('미응시자'), '삭제한 안내가 남음')
})

console.log('\n[v3 마스터 — 수행 성취기준 칸은 고정 문구]')
ck('영역별 성취기준을 따로 묻지 않는다', () => {
  A(!M.perf_summary.item_fields.some(f => f.key === 'standards'), '영역 성취기준 필드가 남음')
  A(M.perf_summary._standards_note.includes('수행평가 세부 기준 참고'), '고정 문구 근거 없음')
})

console.log()
if (fail) { console.log(`${fail}건 실패`); process.exit(1) }
console.log('전부 통과')
