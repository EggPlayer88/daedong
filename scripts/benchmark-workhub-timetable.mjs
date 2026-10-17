// 학교 실제 자료를 읽지 않는 합성 부하 측정. 시간 기준으로 시험을 실패시키지 않는다.
import { loadBrowserModule } from '../tests/helpers/load-browser-module.mjs'
const {solveTimetable,validatePlacements}=await loadBrowserModule(`export * from '../packages/timetable/src/solver';export * from '../packages/timetable/src/validate';`)
function problem(classes,teachers,periods){
  const resources=[...Array.from({length:classes},(_,i)=>({id:`c${i}`,kind:'class',label:`합성 학급 ${i+1}`,capacity:1})),...Array.from({length:teachers},(_,i)=>({id:`t${i}`,kind:'teacher',label:`합성 교사 ${i+1}`,capacity:1}))]
  const slots=Array.from({length:periods},(_,i)=>({id:`s${i}`,day:Math.floor(i/6)+1,label:`${i%6+1}교시`,startMinute:540+i%6*55,endMinute:585+i%6*55,periods:1}))
  const lessons=Array.from({length:classes*periods},(_,i)=>{const c=Math.floor(i/periods),p=i%periods;return{id:`lesson-${String(i).padStart(4,'0')}`,courseId:`course-${i}`,label:`합성 수업 ${i+1}`,periods:1,resourceIds:[`c${c}`,`t${(c+p)%teachers}`],allowedSlotIds:slots.map(s=>s.id)}})
  return{schemaVersion:1,id:'benchmark',revision:1,schoolId:'synthetic',termId:'term',sourceFingerprint:'a'.repeat(64),schoolLevel:'middle',unsupportedFeatures:[],resources,slots,lessons,courseLoads:lessons.map(l=>({courseId:l.courseId,periods:1})),fixed:[],unavailable:[],preferences:[]}
}
const results=[]
for(const classes of [6,12,24]){
  const b=problem(classes,30,30),result=solveTimetable(b,{maxMs:1500,maxNodes:50000})
  results.push({classes,teachers:30,lessons:b.lessons.length,status:result.status,validated:result.status==='feasible'?validatePlacements(b,result.placements).valid:null,...result.stats})
}
console.log(JSON.stringify({note:'합성 단순 제약 자료. 실제 학교 성능 또는 최적성을 뜻하지 않음.',results},null,2))
