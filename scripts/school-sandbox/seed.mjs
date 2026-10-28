import {readFileSync,writeFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {createHash} from 'node:crypto'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'
const config=loadSecrets(process.argv[2]),privateDir=dirname(process.argv[2])
const people=JSON.parse(readFileSync(join(privateDir,'accounts.json')))
const roster=JSON.parse(readFileSync(new URL('../../sandbox/school-year/roster.json',import.meta.url)))
const c=await connectSandbox(config)
const id=(s)=>{const h=createHash('sha256').update('daedong-year-sandbox:'+s).digest('hex');return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`}
let bulk=false
const queued=new Map()
async function insert(table,row){
 if(bulk){if(!queued.has(table))queued.set(table,[]);queued.get(table).push(row);return}
 const keys=Object.keys(row);await c.query(`insert into workhub.${table}(${keys.join(',')}) values(${keys.map((_,i)=>'$'+(i+1)).join(',')}) on conflict do nothing`,Object.values(row))
}
async function flush(){for(const [table,rows] of queued)for(let at=0;at<rows.length;at+=100){
 const part=rows.slice(at,at+100),keys=Object.keys(part[0]),values=part.flatMap(r=>keys.map(k=>r[k]))
 const tuples=part.map((_,i)=>'('+keys.map((_,j)=>'$'+(i*keys.length+j+1)).join(',')+')')
 await c.query(`insert into workhub.${table}(${keys.join(',')}) values ${tuples.join(',')} on conflict do nothing`,values)
}}
try{
 await assertMarker(c);await c.query('begin')
 const school=(await c.query('select * from workhub.schools')).rows[0],year=(await c.query('select * from workhub.academic_years')).rows[0]
 const terms=(await c.query('select *,starts_on::text first_day,ends_on::text last_day from workhub.terms order by term_no')).rows
 const admin=people.find(x=>x.role==='administrator_teacher')
 const adminMember=(await c.query('select m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=$1',[admin.userId])).rows[0].id
 const base={school_id:school.id},actor={created_by_membership_id:adminMember},yearly={valid_from:'2027-03-01',valid_to:'2028-03-01'}
 await c.query("update workhub.memberships set valid_from='2027-03-01',valid_to='2028-03-01' where id=$1",[adminMember])
 await c.query("update workhub.membership_roles set valid_from='2027-03-01',valid_to='2028-03-01' where membership_id=$1",[adminMember])
 await insert('role_catalog',{role_code:'sandbox_timetable_manager',label:'시험 시간표 담당자',description:'가상 학교의 편성·승인 담당. 기존 year.manage 계약을 사용합니다.',grantable_by:'school_admin',allowed_scopes:['school']})
 await insert('role_permissions',{role_code:'sandbox_timetable_manager',permission:'year.manage'})
 for(const p of people){
  await c.query('insert into sandbox_private.cohort(user_id,teacher_id,purpose) values($1,$2,$3) on conflict do nothing',[p.userId,p.teacherId,p.role])
  let account=(await c.query('select id from workhub.accounts where auth_user_id=$1',[p.userId])).rows[0]?.id
  if(!account){account=id('account:'+p.teacherId);await insert('accounts',{id:account,auth_user_id:p.userId,legacy_user_id:p.userId,legacy_link_method:'same_auth_user',legacy_linked_at:new Date().toISOString(),display_name:p.name,email:p.email,status:'active',legacy_approval_state:'approved'})}
  let member=(await c.query('select id from workhub.memberships where account_id=$1',[account])).rows[0]?.id
  if(!member){member=id('member:'+p.teacherId);await insert('memberships',{id:member,...base,account_id:account,status:'active',employment_type:'teacher',...yearly,decided_by_membership_id:adminMember,decided_at:new Date().toISOString(),decision_note:'별도 가상 학교 시험 계정'})}
  p.accountId=account;p.memberId=member
  if(p.role==='timetable_manager_teacher')await insert('membership_roles',{id:id('role:'+p.teacherId),...base,membership_id:member,role_code:'sandbox_timetable_manager',scope_type:'school',...yearly,granted_by_membership_id:adminMember})
 }
 // 30명씩 270명은 부하·일상 업무 시험을 위한 가명 자료이며 실제 재학생 수가 아니다.
 bulk=true
 const pupils=new Map(),classIds=new Map(),spaces=new Map()
 for(let i=1;i<=9;i++){
  const grade=Math.ceil(i/3),num=(i-1)%3+1,label=`${grade}-${num}`,classId=id('class:'+i),room=id('room:'+i)
  classIds.set('C'+i,classId);spaces.set('C'+i,room)
  await insert('year_classes',{id:classId,...base,academic_year_id:year.id,grade,class_no:num,name:label,kind:'regular',sort_order:i})
  await insert('staff_assignments',{id:id('homeroom:'+i),...base,academic_year_id:year.id,membership_id:people[i-1].memberId,kind:'homeroom',class_id:classId,label:`${label} 시험 담임`,...yearly,assigned_by_membership_id:adminMember})
  await insert('timetable_spaces',{id:room,...base,kind:'room',label:`${label} 교실`,capacity:1,...actor,updated_by_membership_id:adminMember})
  const list=[]
  for(let seat=1;seat<=30;seat++){
   const sid=id(`student:${i}:${seat}`),eid=id(`enrollment:${i}:${seat}`)
   await insert('students',{id:sid,...base,school_student_key:`가상-${grade}${num}${String(seat).padStart(2,'0')}`,name:`가상학생 ${label}-${String(seat).padStart(2,'0')}`,...actor})
   await insert('student_enrollments',{id:eid,...base,student_id:sid,academic_year_id:year.id,grade,class_label:label,seat_number:seat,...yearly,...actor});list.push({sid,eid})
  }pupils.set('C'+i,list)
 }
 const subjects=[...new Set(roster.allocations.map(x=>x.subject))]
 for(const [i,name] of subjects.entries())await insert('year_subjects',{id:id('subject:'+name),...base,academic_year_id:year.id,name,sort_order:i})
 const courses=[]
 for(const term of terms)for(const allocation of roster.allocations)for(const [index,periods] of allocation.hours.entries()){
  if(!periods)continue
  const classKey='C'+(index+1)
  const teacher=allocation.teacherId==='HOMEROOM'?people[Number(classKey.slice(1))-1]:people.find(p=>p.teacherId===allocation.teacherId)
  const cid=id(`course:${term.term_no}:${allocation.sourceRow}:${classKey}`),dates={valid_from:term.first_day,valid_to:new Date(Date.parse(term.last_day+'T00:00:00Z')+86400000).toISOString().slice(0,10)}
  const classId=classIds.get(classKey),label=`${Math.ceil(Number(classKey.slice(1))/3)}-${(Number(classKey.slice(1))-1)%3+1} ${allocation.subject} · ${teacher.teacherId}`
  await insert('courses',{id:cid,...base,academic_year_id:year.id,term_id:term.id,subject_id:id('subject:'+allocation.subject),label,...dates,...actor})
  await insert('course_assignments',{id:id('assignment:'+cid),...base,course_id:cid,membership_id:teacher.memberId,account_id:teacher.accountId,...dates,...actor})
  for(const {sid,eid} of pupils.get(classKey))await insert('course_memberships',{id:id('course-student:'+cid+sid),...base,course_id:cid,student_id:sid,enrollment_id:eid,...dates,...actor})
  await insert('timetable_course_links',{...base,course_id:cid,academic_year_id:year.id,student_group:false,updated_by_membership_id:adminMember})
  await insert('timetable_course_link_classes',{...base,course_id:cid,academic_year_id:year.id,class_id:classId})
  await insert('timetable_course_link_spaces',{...base,course_id:cid,space_id:spaces.get(classKey)})
  courses.push({id:cid,termId:term.id,termNo:term.term_no,teacherId:teacher.teacherId,classKey,periods,label})
 }
 if(!courses.length)throw new Error('수업 목록이 비어 있습니다. 원본 계약을 확인하세요.')
 await flush();await c.query('commit')
 writeFileSync(join(privateDir,'accounts.json'),JSON.stringify(people,null,2),{mode:0o600})
 writeFileSync(join(privateDir,'school.json'),JSON.stringify({schoolId:school.id,yearId:year.id,adminId:admin.userId,adminMemberId:adminMember,terms:terms.map(t=>({id:t.id,termNo:t.term_no,firstDay:t.first_day,lastDay:t.last_day})),courses},null,2),{mode:0o600})
 console.log(`학교 자료 입력 완료: 교사 ${people.length}명, 학급 9개, 가명 학생 270명, 수업 ${courses.length}개(두 학기)`)
}catch(e){await c.query('rollback');throw e}finally{await c.end()}
