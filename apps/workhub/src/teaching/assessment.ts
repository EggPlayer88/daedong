import { TeachingError, type Criterion, type Score } from './contracts'
import policy from './policy.json'
const bad = (): never => { throw new TeachingError('INVALID_INPUT', '평가 기준과 점수 상태를 확인해 주세요. 0점·결시·미제출·미확인은 서로 다른 값입니다.') }
export function validateCriteria(value: unknown): Criterion[] {
  if (!Array.isArray(value) || !value.length || value.length>policy.limits.rubricCriteria) return bad()
  const keys=new Set<string>()
  for(const c of value) { if(!c||typeof c!=='object'||Object.keys(c).some(k=>!['key','label','maximum'].includes(k))||typeof c.key!=='string'||!/^criterion-[1-9][0-9]*$/.test(c.key)||keys.has(c.key)||typeof c.label!=='string'||!c.label.trim()||c.label.length>120||typeof c.maximum!=='number'||!Number.isFinite(c.maximum)||c.maximum<=0||c.maximum>policy.limits.criterionMaximum||Math.abs(Math.round(c.maximum*100)-c.maximum*100)>0.000001) return bad(); keys.add(c.key) }
  return structuredClone(value)
}
export function validateScores(value: unknown, criteria?: readonly Criterion[]): Score[] {
  if(!Array.isArray(value)||!value.length||value.length>policy.limits.rubricCriteria)return bad()
  const keys=new Set<string>()
  for(const s of value) {if(!s||typeof s!=='object'||Object.keys(s).some(k=>!['criterionKey','state','points'].includes(k))||typeof s.criterionKey!=='string'||!/^criterion-[1-9][0-9]*$/.test(s.criterionKey)||keys.has(s.criterionKey)||!['scored','absent','missing','unconfirmed'].includes(s.state))return bad();keys.add(s.criterionKey)
    if(s.state==='scored') {if(typeof s.points!=='number'||!Number.isFinite(s.points)||s.points<0||s.points>policy.limits.criterionMaximum||Math.abs(Math.round(s.points*100)-s.points*100)>0.000001)return bad()}
    else if(s.points!==null)return bad()
    if(criteria) {const c=criteria.find(c=>c.key===s.criterionKey);if(!c||(s.points!==null&&s.points>c.maximum))return bad()}
  }
  if(criteria&&(value.length!==criteria.length||criteria.some(c=>!keys.has(c.key))))return bad()
  return structuredClone(value)
}
// 미제출과 결시에 0점을 대입하지 않는다. 모든 항목이 채점된 경우에만 합계를 낸다.
export function assessmentTotal(scores: readonly Score[]): number | null { if(!scores.length||scores.some(s=>s.state!=='scored'||s.points===null))return null;return scores.reduce((sum,s)=>sum+Math.round(s.points!*100),0)/100 }
export function rubricMaximum(criteria: readonly Criterion[]): number {return criteria.reduce((sum,c)=>sum+Math.round(c.maximum*100),0)/100}
export const scoreStateLabels = { scored:'채점', absent:'결시', missing:'미제출', unconfirmed:'미확인' } as const
