const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=__dirname;
const {release,extensions}=require('./integrate-extensions.cjs');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,''));
const write=(name,value)=>fs.writeFileSync(path.join(root,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');
const short=x=>x.replace(/^workhub\./,'');
const list=x=>Array.isArray(x)?x:x==null?[]:[x];
const esc=x=>String(x??'—').replaceAll('|','\\|').replaceAll('\n',' ');
const base=read('source-baseline.json');
const apis=read('api-contracts.json').apis,modules=read('site-modules.json').modules,tests=read('acceptance-tests.json').tests;
const blueprint=read('blueprint-contracts.json');
const errors=[],warnings=[];
const changes=[];
for(const f of ['foundation-changes.json','workflows-changes.json','student-ai-changes.json']){
 for(const c of read(f).changes)changes.push({...c,table:short(c.table),source_file:f});
}
const duplicate=changes.map(c=>c.table).filter((n,i,a)=>a.indexOf(n)!==i);
if(duplicate.length)errors.push('중복 table 변경: '+duplicate.join(','));
for(const ext of extensions)for(const c of ext.changes)changes.push({...c,table:short(c.table),source_file:ext.source_file,extension_domain:ext.domain,extend:true});
const map=new Map(base.tables.map(t=>[t.name,{
 name:t.name,schema:'workhub',origin:'claude_baseline',status:'integrated_design_not_ddl',
 columns:t.columns.map(c=>({...c,source:'baseline'})),
 inherited_constraints:t.constraints,inherited_foreign_keys:t.foreign_keys,
 inherited_indexes:t.indexes,
 source_policies_not_target:t.policies,
 mandatory_constraints:[],mandatory_rules:[],required_indexes:[],tests:[],
 read_policy:'01 공통 권한과 해당 도메인 문서 + 원본 현재권한. 원본 정책 SQL을 무검토 복사하지 않는다.',
 changed:false
}]));
for(const c of changes){
 if(c.action==='add' && map.has(c.table)){errors.push('이미 있는 표 add: '+c.table);continue;}
 if(c.action==='alter'&&!map.has(c.table)){errors.push('없는 표 alter: '+c.table);continue;}
 if(!['add','alter'].includes(c.action))errors.push('action 불명: '+c.table);
 const t=map.get(c.table)||{name:c.table,schema:'workhub',origin:'integrated_addition',status:'integrated_design_not_ddl',columns:[],inherited_constraints:[],inherited_foreign_keys:[],inherited_indexes:[],source_policies_not_target:[]};
 t.changed=true;t.change_source=c.source_file;
 t.change_sources=[...new Set([...(t.change_sources||[]),c.source_file])];
 if(c.action==='add'&&c.extension_domain)t.extension_domain=c.extension_domain;
 for(const drop of c.drop_columns||[]){
  if(!t.columns.some(col=>col.name===drop))errors.push('없는 열 drop: '+c.table+'.'+drop);
  t.columns=t.columns.filter(col=>col.name!==drop);
 }
 t.removed_columns=[...new Set([...(t.removed_columns||[]),...(c.drop_columns||[])])];
 for(const col of c.columns||[]){
  if(!col.name||!col.type||typeof col.nullable!=='boolean')errors.push('열 명세 누락: '+c.table+'.'+col.name);
  const i=t.columns.findIndex(x=>x.name===col.name);
  const merged={...(i>=0?t.columns[i]:{}),...col,source:i>=0?'integrated_override':'integrated_addition'};
  if(i>=0)t.columns[i]=merged;else t.columns.push(merged);
 }
 const add=(before,after)=>[...new Set([...(c.extend?list(before):[]),...list(after)])];
 for(const removed of c.supersedes_constraints||[]){
  const inherited=list(t.inherited_constraints).find(x=>x.name===removed);
  if(!list(t.mandatory_constraints).includes(removed)&&!inherited)errors.push('대체할 제약 없음: '+c.table+' '+removed);
  t.superseded_constraints=[...list(t.superseded_constraints),inherited||{name:removed,definition:removed}];
  t.inherited_constraints=list(t.inherited_constraints).filter(x=>x.name!==removed);
  t.mandatory_constraints=list(t.mandatory_constraints).filter(x=>x!==removed);
 }
 t.contract_overrides=[...list(t.contract_overrides),...list(c.contract_overrides)];
 t.mandatory_constraints=add(t.mandatory_constraints,c.constraints);
 t.mandatory_rules=add(t.mandatory_rules,c.rules);
 t.required_indexes=add(t.required_indexes,c.indexes);
 for(const removed of c.supersedes_indexes||[]){
  const inherited=list(t.inherited_indexes).find(x=>x.name===removed||x.indexname===removed);
  if(!list(t.required_indexes).includes(removed)&&!inherited)errors.push('대체할 인덱스 없음: '+c.table+' '+removed);
  t.superseded_indexes=[...list(t.superseded_indexes),inherited||{name:removed,definition:removed}];
  t.inherited_indexes=list(t.inherited_indexes).filter(x=>x.name!==removed&&x.indexname!==removed);
  t.required_indexes=list(t.required_indexes).filter(x=>x!==removed);
 }
 t.tests=add(t.tests,c.tests);
 t.read_policy=c.read_policy||t.read_policy;
 map.set(c.table,t);
}
const domainGroups={
 foundation:['accounts','account_settings','schools','memberships','membership_roles','role_catalog','role_permissions','school_join_codes','departments','profile_claims','school_features','school_feature_pilots','service_features','service_switches','service_operators','operator_grants','service_principals','service_principal_scopes','policy_catalog','school_policies','policy_versions','support_sessions','membership_home_layouts'],
 calendar:['events','event_revisions','calendar_days','calendar_day_grade_overrides','audience_sets','audience_groups','audience_conditions','audience_members','source_connections','source_connection_mappings','source_records','source_record_snapshots','import_runs','import_rows','import_row_candidates'],
 workflow:['tasks','duties','assignments','duty_notes','cooperation_requests','handovers','handover_items','handover_acceptances'],
 collection:['collections','collection_schemas','collection_fields','collection_reviewers','collection_units','collection_unit_members','collection_due_changes','unit_drafts','submission_versions','submission_files','submission_reviews','correction_requests','correction_windows','collection_correction_fulfillments','export_manifests','export_manifest_items'],
 document:['file_objects','file_links','file_access_grants','documents','document_packs','document_revisions','document_inputs','document_actions','document_validations','document_revision_sources'],
 communication:['notices','notice_receipts','notifications','notification_kinds','notification_preferences','quiet_hours','push_subscriptions','feedback','feedback_events'],
 knowledge:['knowledge_documents','knowledge_revisions','knowledge_chunks','knowledge_conflicts'],
 ai:['conversations','messages','ai_runs','ai_run_sources','ai_policy_versions','tool_proposals','tool_runs','memories','usage_events'],
 student:['academic_years','terms','subjects','academic_classes','students','student_enrollments','course_memberships','observations','observation_revisions','counselling_records','counselling_revisions','rubrics','rubric_revisions','assessment_activities','assessments','assessment_revisions','record_rule_sets','record_drafts','record_draft_revisions','record_sentences','evidence_links','record_exports','record_correction_approvals','student_evidence_gates'],
 classroom:['activity_instances','classroom_imports','classroom_connections','classroom_event_receipts','source_items','source_item_revisions','participant_mappings','participant_mapping_revisions','inbox_items','adoptions','source_actions','impact_items'],
 timetable:['spaces','bell_schedules','bell_periods','term_day_templates','course_groups','course_group_classes','course_group_teachers','constraint_sets','timetable_constraints','teacher_unavailability','timetable_compositions','timetable_candidates','timetable_versions','timetable_placements','timetable_version_impacts','lesson_instances','lesson_instance_teachers','space_reservations','resource_occupancy','timetable_change_sets','timetable_change_items','timetable_change_participants','lesson_executions','lesson_execution_teachers','cover_ledger','school_timetable_types'],
 operations:['jobs','job_attempts','job_external_calls','idempotency_receipts','audit_events','outbox','object_revisions','migration_runs','migration_items','migration_checks','data_write_authority','legacy_access_gates','retention_rules','retention_holds','resource_classes','deletion_ledger','restoration_ledger','recovery_sets','restore_runs']
};
for(const t of map.values())if(t.extension_domain){if(!domainGroups[t.extension_domain])errors.push('확장 도메인 없음: '+t.name);else if(!domainGroups[t.extension_domain].includes(t.name))domainGroups[t.extension_domain].push(t.name);}
const labels={foundation:'계정·학교·권한',calendar:'일정·시트',workflow:'업무·인계',collection:'수합',document:'파일·문서',communication:'메신저·전달·알림',knowledge:'학교 지식',ai:'Claude·기억',student:'학생·평가·생기부',classroom:'수업 앱 연결',timetable:'시간표',operations:'작업·이관·복구'};
for(const [d,names]of Object.entries(domainGroups)){
 for(const n of names){
  if(!map.has(n)){errors.push('도메인에 없는 표: '+n);continue;}
  if(map.get(n).domain)errors.push('도메인 중복: '+n);
  map.get(n).domain=d;
 }
}
for(const t of map.values()){
 if(!t.domain)errors.push('도메인 미배정: '+t.name);
 const names=t.columns.map(c=>c.name);
 if(new Set(names).size!==names.length)errors.push('열 중복: '+t.name);
 for(const c of t.columns){
  if(!c.references)continue;
  for(const ref of Array.isArray(c.references)?c.references:[c.references]){
   const parts=ref.split('.');
   if(parts.length!==3){errors.push('참조형식: '+t.name+'.'+c.name+' → '+ref);continue;}
   const[s,tn,cn]=parts;
   if(s==='workhub'){
    const target=map.get(tn);
    if(!target||!target.columns.some(x=>x.name===cn))errors.push('참조 없음: '+t.name+'.'+c.name+' → '+ref);
   }else if(!['auth.users.id','public.users.id'].includes(ref))errors.push('알 수 없는 외부 참조: '+ref);
  }
 }
 if(t.origin==='integrated_addition' && (!t.read_policy||!t.mandatory_constraints.length||!t.tests.length))errors.push('신규표 계약 누락: '+t.name);
}
for(const a of apis){
 for(const n of a.tables)if(!map.has(n))errors.push(a.id+' 없는표 '+n);
 if(!a.commands.length||!a.authorization||!a.input||!a.result||!a.tests)errors.push('API 미완 '+a.id);
 for(const mid of a.modules)if(!modules.some(m=>m.id===mid))errors.push('API 모듈 없음 '+a.id+' '+mid);
}
for(const m of modules){
 for(const n of m.tables)if(!map.has(n))errors.push(m.id+' 없는표 '+n);
 for(const a of m.apis)if(!apis.some(x=>x.id===a))errors.push(m.id+' 없는API '+a);
}
for(const t of tests)if(!fs.existsSync(path.join(root,t.contract)))errors.push(t.id+' 명세파일 없음');
if(modules.length!==release.expected_modules||new Set(modules.map(m=>m.id)).size!==release.expected_modules)errors.push('모듈 수 불일치');
if(apis.length!==release.expected_api_groups||new Set(apis.map(a=>a.id)).size!==release.expected_api_groups)errors.push('API 수 불일치');
for(let i=1;i<=release.expected_api_groups;i++)if(!apis.some(a=>a.id==='API-'+String(i).padStart(2,'0')))errors.push('API 번호 누락: '+i);
const tickets=read('implementation-backlog.json').tickets;
if(new Set(tickets.map(t=>t.id)).size!==tickets.length)errors.push('구현 티켓 중복');
for(const ticket of tickets){
 if(!ticket.title||!ticket.deliverables?.length||!ticket.acceptance?.length)errors.push('구현 티켓 미완: '+ticket.id);
 for(const dep of ticket.depends_on||[])if(!tickets.some(t=>t.id===dep)&&!/^T\d{2}$|^P[0-7]$/.test(dep))errors.push('티켓 선행 항목 미정의: '+ticket.id+' → '+dep);
}
const visited=new Set(),visiting=new Set();
function visit(id){if(visiting.has(id)){errors.push('티켓 순환: '+id);return;}if(visited.has(id))return;visiting.add(id);for(const dep of tickets.find(t=>t.id===id)?.depends_on||[])if(tickets.some(t=>t.id===dep))visit(dep);visiting.delete(id);visited.add(id);}
tickets.forEach(t=>visit(t.id));
for(const ext of extensions){
 if(!ext.tests.length||!ext.tickets.length)errors.push('확장 시험/티켓 없음: '+ext.source_file);
 for(const c of ext.changes)if(c.action==='add'&&!list(c.constraints).some(x=>/PRIMARY KEY/.test(x)))errors.push('신규 표 PK 없음: '+c.table);
 for(const test of ext.tests)if(!test.given||!test.expected||!test.layer||!test.status.includes('not_run'))errors.push('확장 시험 명세/미실행 상태 오류: '+test.id);
}
for(let i=1;i<=12;i++)if(!tests.some(t=>t.id==='R'+String(i).padStart(2,'0')))errors.push('반례 R'+i+' 누락');
for(const [key,prefix,count]of [['common','C',12],['acceptance','V',48]]){
 const entries=blueprint[key]||[];
 if(entries.length!==count||new Set(entries.map(e=>e.id)).size!==count)errors.push(prefix+' 원본 계약 수 불일치');
 for(let i=1;i<=count;i++)if(!entries.some(e=>e.id===prefix+String(i).padStart(2,'0')))errors.push(prefix+i+' 원본 계약 누락');
 for(const e of entries){
  if(!e.tests?.length)errors.push(e.id+' 검증 연결 없음');
  for(const test of e.tests||[])if(!tests.some(t=>t.id===test))errors.push(e.id+' 없는 시험 '+test);
  for(const f of e.contracts||[])if(!fs.existsSync(path.join(root,f)))errors.push(e.id+' 없는 명세 '+f);
 }
}
if(new Set(tests.map(t=>t.id)).size!==tests.length)errors.push('중복 중앙 시험 ID');
const tables=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name));
const result={version:release.version,status:'design_contract_only_not_executable_ddl',source_baseline_sha256:base.source_sha256,extensions:release.extensions,implementation_status:release.implementation_status,
 precedence:['이 통합 도메인 명세와 mandatory_*','통합 columns와 정형 변경 목록','변경하지 않은 원본 관계는 새 공통 계약과 함께 계승'],
 reference_semantics:'columns.references는 대상 위치이며 단일열 FK 선언이 아님. 실제 복합키·scope·owner·판 제약은 mandatory_constraints와 도메인 문서가 정한다.',
counts:{baseline_tables:base.tables.length,added_tables:tables.filter(t=>t.origin==='integrated_addition').length,total_tables:tables.length,changed_existing_tables:tables.filter(t=>t.changed&&t.origin==='claude_baseline').length,columns:tables.reduce((n,t)=>n+t.columns.length,0),modules:modules.length,api_groups:apis.length,blueprint_common_contracts:blueprint.common.length,blueprint_acceptance_cases:blueprint.acceptance.length,central_acceptance_cases:tests.length},
 domains:Object.entries(domainGroups).map(([id,names])=>({id,label:labels[id],tables:names})),tables};
write('schema-contract.json',result);
let coverage='# 사이트 청사진과 통합 DB 대응표\n\n정확한 대상은 최종 업무혁신시스템 기획서 1.1의 M00~M15와 API-01~29다. 연결됨은 설계의 추적 가능성을 뜻하며 기능 구현 완료가 아니다.\n\n| 모듈 | 화면 | 주요 원본 | API | 보장할 규칙 |\n|---|---|---|---|---|\n';
for(const m of modules)coverage+='| '+[m.id+' '+m.name,m.screen,m.tables.join(', '),m.apis.join(', '),m.rule].map(esc).join(' | ')+' |\n';
coverage+='\n## 전체 표의 도메인 소유\n\n한 표의 정본은 하나다. 여러 화면에서 참조해도 복제 원장을 만들지 않는다. course_groups 등 공통 수업 기준은 시간표 구현 보류와 관계없이 학생/수합 FK의 선행 기준으로 먼저 생성한다.\n\n| 도메인 | 표 수 | 전체 표 |\n|---|---:|---|\n';
for(const[d,names]of Object.entries(domainGroups))coverage+='| '+labels[d]+' | '+names.length+' | '+names.join(', ')+' |\n';
coverage+='\n## 검토 범위와 수치\n\n원본 '+result.counts.baseline_tables+'표 중 '+result.counts.changed_existing_tables+'표를 명시 보강하고 '+result.counts.added_tables+'표를 추가한 목표 '+tables.length+'표, '+result.counts.columns+'열이다. 표 수 자체를 완성도 지표로 삼지 않는다. 신규 표는 정확한 정책/문항/채택 근거, 인계 수락, 외부 호출 경계 등 기존 반례를 닫거나 이미 기획된 기능의 최소 관계를 구현하기 위한 것이다.\n\n각 표의 최종 열은 09-table-dictionary.md, 기계 판독형 카탈로그는 schema-contract.json이다. 변경 JSON에 없는 원본 함수·정책도 통합 공통 계약을 따르도록 SQL 작성 단계에서 재검토한다.\n';
coverage+='\n## 청사진 공통 계약 C01~C12\n\n| ID | 계약 | 상세 명세 | 검증 |\n|---|---|---|---|\n';
for(const c of blueprint.common)coverage+='| '+[c.id,c.title,c.contracts.join(', '),c.tests.join(', ')].map(esc).join(' | ')+' |\n';
coverage+='\n## 청사진 수용 기준 V01~V48\n\n아래는 원문을 추적한 설계 연결이며 실제 기능 시험 통과를 뜻하지 않는다. 원문 지문은 blueprint-contracts.json에 기록했다.\n\n| ID | 상황 | 기대 결과 | 통합 시험 |\n|---|---|---|---|\n';
for(const v of blueprint.acceptance)coverage+='| '+[v.id,v.given,v.expected,v.tests.join(', ')].map(esc).join(' | ')+' |\n';
coverage+='\n## 2026-10-13 보강 추적\n\n| 영역 | 추가 API | 상세 시험 | 구현 티켓 | 작성 원본 |\n|---|---|---|---|---|\n';
for(const ext of extensions)coverage+='| '+[labels[ext.domain],ext.apis.map(a=>a.id).join(', '),ext.tests.map(t=>t.id).join(', '),ext.tickets.map(t=>t.id).join(', '),ext.source_file].map(esc).join(' | ')+' |\n';
coverage+='\n연결 여정은 15-implementation-handoff.md를 따른다. 기존 V01~V48의 원문 추적은 history의 v1.0 기획서이며 최신 보강은 extension JSON으로 추적한다. 운영 DB 시험은 미실행이다.\n';
write('08-coverage.md',coverage);
let dictionary='# 통합 테이블과 열 사전\n\n이 파일은 source-baseline.json의 실제 원본 열, 세 기본 변경 목록과 2026-10-13 확장 계약을 합쳐 생성했다. 실행 SQL이 아니다. 단일 열의 참조 표시는 탐색용이며 실제 FK는 학교·부모·작성자·판을 포함한 복합 제약을 따른다. 원본 CHECK/정책/트리거를 무검토로 그대로 적용하면 안 된다.\n\n추출 당시 원본은 '+base.tables.length+'표다. 통합 목표는 '+tables.length+'표와 '+result.counts.columns+'열이다. NULL=허용은 항상 그 상태에서 생략 가능하다는 뜻이 아니며 상태별 필수 조건이 추가된다. 생성식은 SQL 확정 때 검증한다.\n';
for(const t of tables){
 dictionary+='\n## workhub.'+t.name+'\n\n'+labels[t.domain]+' · '+(t.origin==='integrated_addition'?'신규':t.changed?'기존 보강':'기존 계승')+'\n\n열람: '+t.read_policy+'\n\n| 열 | 형식 | NULL | 기본값/생성식 | 참조 또는 설명 | 출처 |\n|---|---|---|---|---|---|\n';
 for(const c of t.columns)dictionary+='| '+[c.name,c.type,c.nullable?'허용':'불가',c.default??c.generated_expression??(c.generated?'생성식 확인':'—'),[c.references,c.description,c.immutable?'생성 후 불변':''].filter(Boolean).join(' · '),c.source==='baseline'?'원본':c.source==='integrated_override'?'통합 변경':'통합 추가'].map(esc).join(' | ')+' |\n';
 if(t.removed_columns?.length)dictionary+='\n제거/대체 대상: '+t.removed_columns.join(', ')+'\n';
 if(t.superseded_constraints?.length)dictionary+='\n이번 판에서 대체하는 원본 제약(그대로 적용 금지): '+t.superseded_constraints.map(x=>x.name).join(', ')+'\n';
 if(t.superseded_indexes?.length)dictionary+='\n이번 판에서 대체하는 인덱스(그대로 생성 금지): '+t.superseded_indexes.map(x=>x.name||x.indexname).join(', ')+'\n';
 if(t.contract_overrides?.length)dictionary+='\n이전 계약 대체 설명:\n\n'+t.contract_overrides.map(x=>'- '+(typeof x==='string'?x:JSON.stringify(x))).join('\n')+'\n';
 if(t.mandatory_constraints.length)dictionary+='\n통합 필수 제약:\n\n'+t.mandatory_constraints.map(x=>'- '+x).join('\n')+'\n';
 if(t.mandatory_rules.length)dictionary+='\n통합 동작 규칙:\n\n'+t.mandatory_rules.map(x=>'- '+x).join('\n')+'\n';
 if(t.required_indexes.length)dictionary+='\n인덱스: '+t.required_indexes.join('; ')+'\n';
 if(t.inherited_foreign_keys.length)dictionary+='\n기존 FK 관계(변경 계약과 충돌하면 대체):\n\n'+t.inherited_foreign_keys.map(f=>'- ('+f.columns.join(',')+') → '+f.target_table+'('+f.target_columns.join(',')+')').join('\n')+'\n';
 if(t.tests.length)dictionary+='\n필수 시험: '+t.tests.join('; ')+'\n';
}
write('09-table-dictionary.md',dictionary);
const report={checked_at:new Date().toISOString(),kind:'static_design_consistency_only',version:release.version,counts:result.counts,extension_tests:extensions.reduce((n,e)=>n+e.tests.length,0),implementation_tickets:tickets.length,checks:['원본표와 add/alter 대상 일치','표/열 중복 없음','신규 열의 참조 대상 존재','모든 표 도메인 소유','M00~M15와 API01~29 대응','C01~C12와 V01~V48 원본 계약 추적','신규 표의 PK/제약/권한/시험 명세','R01~R12 차단 시나리오 존재','확장 시험 미실행 상태·티켓 선행/순환 검사'],errors,warnings,passed:errors.length===0,not_proven:['통합 DDL 적재','RLS 동작','실제 두 연결 경합','Supabase Auth/Storage','worker 외부 호출','성능·복원·화면 종단']};
write('validation-result.json',report);
console.log(JSON.stringify(report,null,2));
if(errors.length)process.exitCode=1;
