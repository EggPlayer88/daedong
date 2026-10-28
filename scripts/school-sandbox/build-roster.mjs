import { readFileSync, writeFileSync } from 'node:fs'
// xlrd로 읽은 로컬 원본에서 이름을 제거한 교과 배정만 내보낸다. 원본은 Git에 넣지 않는다.
const source=JSON.parse(readFileSync(process.argv[2],'utf8')), sheet=source.sheets.find(s=>s.name==='교사별시수표')
if(!sheet||sheet.rows!==37||source.sha256!=='927bcae7b5d3d478fc78e087b5da757a6dc040039d9b114b7c3541b2f5d506a9')throw new Error('검토한 시수표와 다릅니다.')
const names=[...new Set(sheet.values.slice(3,36).map(r=>r[3]).filter(n=>n&&n!=='담임'))]
if(names.length!==22)throw new Error('실명 교사 22명과 담임 공통 행을 확인하세요.')
const classes=Array.from({length:9},(_,i)=>({id:`C${i+1}`,grade:Math.floor(i/3)+1,number:i%3+1,label:`${Math.floor(i/3)+1}-${i%3+1}`}))
const teachers=names.map((_,i)=>({id:`T${String(i+1).padStart(2,'0')}`,name:`시험 교사 ${String(i+1).padStart(2,'0')}`,role:i===8?'administrator_teacher':i===0?'timetable_manager_teacher':'teacher'}))
const allocations=sheet.values.slice(3,36).map((r,i)=>({sourceRow:i+4,subject:r[1],shortName:r[2],teacherId:r[3]==='담임'?'HOMEROOM':teachers[names.indexOf(r[3])].id,hours:r.slice(4,13).map(x=>x===''?0:Number(x))}))
const roster={contract:'school-sandbox.roster.v1',source:{file:'2026학년도 2학기(08.13.)교사별시수표_컴시간용2학기(담임 창체 포함) (1).xls',sha256:source.sha256,sheet:sheet.name,range:'A1:N37'},teachers,classes,allocations,
  homerooms:classes.map((c,i)=>({classId:c.id,teacherId:teachers[i].id})),
  assumptions:['담임 행은 추가 교사가 아닌 학급별 창체 1시간이다.','담임과 시간표 담당자 배정은 시험용이며 실제 보직을 뜻하지 않는다.','자료가 2학기분이므로 두 학기의 배정에 같은 시수를 쓰는 합성 연간 시나리오이다.','학사 일정·교시·학생은 합성이며 운영 자료로 가져오지 않는다.']}
if(classes.some((_,i)=>allocations.reduce((n,r)=>n+r.hours[i],0)!==32))throw new Error('학급당 32시간이 아닙니다.')
writeFileSync('sandbox/school-year/roster.json',JSON.stringify(roster,null,2)+'\n')
console.log('가명 교사 22명, 9학급, 288시간')
