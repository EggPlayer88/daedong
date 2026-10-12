// 설계 산출물 자체의 링크·원본 지문을 검사한다. DB 동작 검사와 구별한다.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=__dirname,errors=[];
const manifest=JSON.parse(fs.readFileSync(path.join(root,'source-manifest.json'),'utf8').replace(/^\uFEFF/,''));
const sourceRoot=process.env.WORKHUB_SOURCE_ROOT;
let sourceChecks=0;
if(sourceRoot)for(const f of manifest.files){const p=path.join(sourceRoot,f.path);if(!fs.existsSync(p)){errors.push('원본 없음: '+f.path);continue;}const hash=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');if(hash!==f.sha256)errors.push('원본 지문 변경: '+f.path);sourceChecks++;}
let links=0;
for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.md'))){const content=fs.readFileSync(path.join(root,name),'utf8');for(const match of content.matchAll(/\[[^\]\n]*\]\(([^)\n]+)\)/g)){let target=match[1].replace(/^<|>$/g,'').split('#')[0];if(!target||/^(https?:|app:|codex:|[A-Z]:)/i.test(target))continue;target=decodeURIComponent(target);if(!fs.existsSync(path.resolve(root,target)))errors.push(name+' 링크 없음: '+target);links++;}}
const schema=JSON.parse(fs.readFileSync(path.join(root,'schema-contract.json'),'utf8'));
const jobs=schema.tables.find(t=>t.name==='jobs').columns.find(c=>c.name==='scope_key');
assert.equal(jobs.default,null);assert.match(jobs.generated_expression,/svc/);
const purge=schema.tables.find(t=>t.name==='deletion_ledger').columns.find(c=>c.name==='job_scope_key');
assert.equal(purge.generated,'');
const report={kind:'artifact_links_and_source_integrity',source_files_verified:sourceChecks,local_markdown_links_checked:links,checks:['로컬 문서 링크','선택 시 원본 18개 지문','통합 생성열 메타 교체'],errors,passed:errors.length===0};
fs.writeFileSync(path.join(root,'delivery-qa.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));if(errors.length)process.exitCode=1;
