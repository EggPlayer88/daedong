import { readFileSync,writeFileSync,existsSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join,dirname } from 'node:path'
import { loadSecrets,connectSandbox,assertMarker,SANDBOX_REF } from './environment.mjs'
const config=loadSecrets(process.argv[2]),privatePath=join(dirname(process.argv[2]),'accounts.json')
const roster=JSON.parse(readFileSync(new URL('../../sandbox/school-year/roster.json',import.meta.url)))
const saved=existsSync(privatePath)?JSON.parse(readFileSync(privatePath,'utf8')):[]
const client=await connectSandbox(config)
try{
 await assertMarker(client)
 for(const teacher of roster.teachers){
  let row=saved.find(x=>x.teacherId===teacher.id)
  if(!row){row={teacherId:teacher.id,name:teacher.name,role:teacher.role,email:`${teacher.id.toLowerCase()}-20261028@daedong-sandbox.example.com`,password:randomBytes(24).toString('base64url')};saved.push(row);writeFileSync(privatePath,JSON.stringify(saved,null,2),{mode:0o600})}
  const existing=await client.query('select id from auth.users where email=$1',[row.email])
  if(existing.rowCount)row.userId=existing.rows[0].id
  else{
   const response=await fetch(`https://${SANDBOX_REF}.supabase.co/auth/v1/admin/users`,{method:'POST',headers:{apikey:config.serviceRoleKey,Authorization:`Bearer ${config.serviceRoleKey}`,'content-type':'application/json'},body:JSON.stringify({email:row.email,password:row.password,email_confirm:true,user_metadata:{name:row.name,full_name:row.name,sandbox_teacher_id:row.teacherId}})})
   if(!response.ok)throw new Error('시험 계정 생성 실패: '+response.status)
   row.userId=(await response.json()).id
  }
  writeFileSync(privatePath,JSON.stringify(saved,null,2),{mode:0o600})
  await client.query('update public.users set name=$1,is_active=true,role=$2 where id=$3',[row.name,row.role==='administrator_teacher'?'superadmin':'teacher',row.userId])
 }
 const admin=saved.find(x=>x.role==='administrator_teacher')
 const school=await client.query('select id from workhub.schools')
 if(!school.rowCount){
  await client.query('select workhub_private.bootstrap_first_school($1::jsonb)',[JSON.stringify({admin_user_id:admin.userId,approval_ref:'2026-10-28 계란 요청: 별도 가상 학교 연간 시험',school_code:'daedong-sandbox',school_name:'대동여자중학교 · 가상 연간 시험',school_level:'middle',grade_count:'3',timezone:'Asia/Seoul',school_year:'2027',year_first_day:'2027-03-01',year_last_day:'2028-02-29',terms:[{term_no:1,label:'합성 1학기',first_day:'2027-03-01',last_day:'2027-08-15'},{term_no:2,label:'합성 2학기',first_day:'2027-08-16',last_day:'2028-02-29'}]})])
 }
 console.log('시험 계정 22명 생성·승인 및 시험 학교 초기 설정 완료. 비밀번호는 비공개 accounts.json에만 저장했습니다.')
}finally{await client.end()}
