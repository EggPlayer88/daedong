import {readFileSync} from 'node:fs'
import {dirname,join} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'
const path=process.argv[2],deployment=process.argv[3]
if(!deployment||(deployment!=='local-build'&&!/^https:\/\/daedong-year-sandbox[\w.-]*\.vercel\.app$/.test(deployment)))throw new Error('검증한 로컬 빌드 또는 확인한 복제 배포 URL이 필요합니다.')
const school=JSON.parse(readFileSync(join(dirname(path),'school.json'))),people=JSON.parse(readFileSync(join(dirname(path),'accounts.json')))
const c=await connectSandbox(loadSecrets(path))
const common={approver_user_id:school.adminId,approval_ref:'2026-10-28 계란 요청: 별도 가상 학교 전체 기능 시험',app_deploy_ref:deployment==='local-build'?'2026-10-28 복제용 로컬 앱 빌드·실제 DB 연결 검증. 외부 배포는 본인 확인 대기':deployment}
const forms=[
 ['database/workhub/p1/P1-04_학교활성화_양식.sql',{}],
 ['database/workhub/p2/P2-04_모듈활성화_양식.sql',{modules:['calendar_batch','cooperation']}],
 ['database/workhub/p3/P3-04_메시지활성화_양식.sql',{body_characters:5000,title_characters:100,recipients:100}],
 ['database/workhub/p4/P4-04_자료문서함활성화_양식.sql',{document_school_share:'school_admin'}],
 ['database/workhub/p5/P5-04_수업모듈활성화_양식.sql',{counseling_scope:'off'}],
 ['database/workhub/p7/P7-04_모듈활성화_양식.sql',{modules:['collection_ops','home','transitions','duty_handover']}],
 ['database/workhub/p8/P8-06_정책모듈활성화_양식.sql',{modules:['cooperation_notices','duty_admin_review','teaching_relations']}],
 ['database/workhub-timetable/t1/T1-05_시간표활성화_양식.sql',{}],
 ['database/workhub-timetable/t2/T2-08_시간표운영활성화_양식.sql',{}],
 ['database/workhub-participation/op1/OP1-05_시간표참여_시범승인양식.sql',{school_code:'daedong-sandbox',allowed_user_ids:people.map(x=>x.userId),expected_revision:0,enable:true}],
]
try{await assertMarker(c);await c.query('create table if not exists sandbox_private.activations(path text primary key,applied_at timestamptz not null default clock_timestamp());alter table sandbox_private.activations enable row level security;revoke all on sandbox_private.activations from public,anon,authenticated,service_role')
for(const [file,extra]of forms){
 if((await c.query('select 1 from sandbox_private.activations where path=$1',[file])).rowCount)continue
 let sql=readFileSync(file,'utf8').replaceAll('\r\n','\n')
 const pattern=/((?:p|i)\s+jsonb\s*:=\s*)\$(\w*)\$([\s\S]*?)\$\2\$::jsonb/
 const match=sql.match(pattern);if(!match)throw new Error('승인 양식 형식 확인 필요 '+file)
 const input={...JSON.parse(match[3]),...common,...extra}
 sql=sql.replace(pattern,(_,prefix,tag)=>prefix+'$'+tag+'$'+JSON.stringify(input)+'$'+tag+'$::jsonb')
 await assertMarker(c);await c.query(sql);await c.query('insert into sandbox_private.activations(path)values($1)',[file]);console.log('활성화 '+file)
}
}finally{await c.end()}
