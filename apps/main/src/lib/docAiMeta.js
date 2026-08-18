// 대화에서 교과·학년을 뽑아 목록 제목을 만든다.
//
// 왜 필요한가: 저장된 대화가 여러 개 쌓이면 "언제 뭘 쓰던 것인지" 를 구분해야 하는데,
// 교사에게 제목을 따로 입력받는 것은 군더더기다. 교과·학년은 어차피 대화 초반에 나온다.
//
// ⚠ 확정된 plan(PLAN_READY) 이 있으면 **언제나 그쪽이 이긴다.** 아래 추측은 plan 이
//   나오기 전 목록에 표시할 임시 이름을 위한 것이다. 틀려도 문서에는 영향이 없다.

import manifest from '../../api/doc-ai/_assets/template-manifest.json'
import regulation from '../../api/doc-ai/_assets/regulation-2026.json'
import constants from '../../api/doc-ai/_assets/school-constants-2026-2.json'

// 참고자료 삽입 형식 — prompt-rules.v2.md 2단계가 이 블록을 인식한다.
// 이 접두로 시작하는 메시지는 작년 문서 전문이라 교과명 추측에서 제외한다
// (전교 문서면 다른 교과명이 잔뜩 들어 있다).
export const REF_PREFIX = '[참고자료: '

/**
 * 교과명 후보 — 자산에서 모은다. 교과 목록을 이 파일에 적으면 자산이 바뀌어도
 * 화면이 따라가지 않는다(P5 하드코딩 금지).
 */
export const SUBJECTS = (() => {
  const el = regulation?.eligibility || {}
  const hint = constants?.essay_ratio_rule?.last_year_type_hint || {}
  const all = [
    ...(hint.typically_A || []),
    ...(hint.typically_C || []),
    ...(el.type_b_subjects || []),
    ...(el.type_c_subjects || []),
    ...(el.arts_pe_subjects || []),
    ...(manifest?.variants?.arts_subjects || []),
  ].filter((s) => typeof s === 'string' && s.length >= 2)
  // 긴 이름을 먼저 본다 — '기술·가정' 이 '기술' 에 먹히지 않게
  return [...new Set(all)].sort((a, b) => b.length - a.length)
})()

const GRADE_RE = /([1-3])\s*학년/

/**
 * 대화 + 확정 plan 에서 { subject, grade } 를 정한다.
 * plan 값이 있으면 그것을 쓰고, 없을 때만 교사가 쓴 문장에서 찾는다.
 */
export function deriveMeta(messages, plan, subjects = SUBJECTS) {
  const list = Array.isArray(messages) ? messages : []
  let subject = typeof plan?.subject === 'string' ? plan.subject.trim() : ''
  let grade = Number.parseInt(plan?.grade, 10)

  if (!subject || !Number.isInteger(grade)) {
    for (const m of list) {
      const text = typeof m?.content === 'string' ? m.content : ''
      if (!text || m.role !== 'user' || text.startsWith(REF_PREFIX)) continue
      if (!subject) subject = subjects.find((s) => text.includes(s)) || ''
      if (!Number.isInteger(grade)) {
        const g = GRADE_RE.exec(text)
        if (g) grade = Number(g[1])
      }
      if (subject && Number.isInteger(grade)) break
    }
  }
  return {
    subject: subject || null,
    grade: Number.isInteger(grade) ? grade : null,
  }
}

/** 목록에 뜰 제목. 아직 아무것도 모르면 "새 평가계획" */
export function buildTitle({ subject, grade } = {}) {
  const bits = []
  if (Number.isInteger(grade)) bits.push(`${grade}학년`)
  if (subject) bits.push(subject)
  return bits.length ? `${bits.join(' ')} 평가계획` : '새 평가계획'
}
