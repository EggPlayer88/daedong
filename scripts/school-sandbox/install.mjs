import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve,relative,isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSecrets, connectSandbox, assertMarker, SANDBOX_REF, RUN_ID } from './environment.mjs'

const root=fileURLToPath(new URL('../../',import.meta.url))
export async function install(config,manifest){
  const client=await connectSandbox(config)
  try{
    const existing=await client.query("select to_regclass('sandbox_private.environment') marker")
    if(!existing.rows[0].marker){
      const empty=await client.query("select (select count(*) from auth.users) users,(select count(*) from pg_tables where schemaname in ('public','workhub')) tables")
      if(Number(empty.rows[0].users)||Number(empty.rows[0].tables))throw new Error('빈 시험 DB에서만 초기 설치할 수 있습니다.')
      await client.query(`begin; create schema sandbox_private;
        revoke all on schema sandbox_private from public,anon,authenticated,service_role;
        create table sandbox_private.environment(singleton boolean primary key default true check(singleton),project_ref text not null,run_id text not null);
        create table sandbox_private.installs(path text primary key,sha256 text not null,installed_at timestamptz not null default now());
        alter table sandbox_private.environment enable row level security;alter table sandbox_private.installs enable row level security;
        revoke all on all tables in schema sandbox_private from public,anon,authenticated,service_role;commit;`)
      await client.query('insert into sandbox_private.environment values(true,$1,$2)',[SANDBOX_REF,RUN_ID])
    }
    await assertMarker(client)
    for(const item of manifest){
      const absolute=resolve(root,item.path)
      if(!['migrations','database'].some(folder=>{const rel=relative(resolve(root,folder),absolute);return rel&&!rel.startsWith('..')&&!isAbsolute(rel)}))throw new Error('설치 경로 범위 오류')
      let sql=readFileSync(absolute,'utf8')
      const hash=createHash('sha256').update(sql).digest('hex')
      if(hash!==item.sha256)throw new Error('SQL 원문 해시 불일치: '+item.path)
      sql=sql.replaceAll('\r\n','\n')
      const prior=await client.query('select sha256 from sandbox_private.installs where path=$1',[item.path])
      if(prior.rowCount){if(prior.rows[0].sha256!==hash)throw new Error('이미 설치한 SQL이 변경됐습니다.');continue}
      if(item.path.includes('P7-05_'))sql=sql.replace('"<승인한 사람(예: 계란)>"','"계란"').replace('"<승인 근거(날짜 · 대화 · 문서)>"','"2026-10-28 별도 가상 학교 복제 시험 요청"')
      // 확정 SQL의 내부 트랜잭션을 그대로 사용한다. 실패한 파일 뒤에는 진행하지 않는다.
      await assertMarker(client)
      console.log('설치 '+item.path)
      await client.query(sql)
      await client.query('insert into sandbox_private.installs(path,sha256) values($1,$2)',[item.path,hash])
    }
  }finally{await client.end()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const config=loadSecrets(process.argv[2]),manifest=JSON.parse(readFileSync(new URL('../../sandbox/school-year/install-order.json',import.meta.url)))
  const phase=process.argv[3]
  if(!['foundation','modules'].includes(phase))throw new Error('foundation 설치 → accounts.mjs → modules 설치 순서를 지정하세요.')
  const boundary=manifest.findIndex(x=>x.path.includes('/r1/'))
  if(boundary<1)throw new Error('R0/R1 설치 경계 확인 필요')
  await install(config,phase==='foundation'?manifest.slice(0,boundary):manifest.slice(boundary))
}
