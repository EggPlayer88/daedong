import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { loadSecrets,connectSandbox,assertMarker } from './environment.mjs'

// 실제 운영 SQL 파일은 고치지 않는다. 복제 DB에만 적용할 차이를 원문 해시와 함께 기록한다.
export const replacements = {
 legacy_gate: [["public.is_approved() AND public.get_my_role() IS NOT DISTINCT FROM 'superadmin'", 'public.is_approved() AND sandbox_private.allowed()']],
 today_in: [['statement_timestamp()', 'sandbox_private.domain_now()']],
 p6_window: [['workhub_private.today_in(s.timezone)', '(statement_timestamp() AT TIME ZONE s.timezone)::date']],
 p2_member_reachable: [["u.role = 'superadmin'", "EXISTS(SELECT 1 FROM sandbox_private.cohort sc WHERE sc.user_id=a.auth_user_id AND sc.expires_at>statement_timestamp())"]],
 op1_actor: [["public.get_my_role()='superadmin'", "sandbox_private.allowed()"]],
 mp1_actor: [["public.get_my_role()='superadmin'", "sandbox_private.allowed()"]],
 t2_vlesson: [['l.starts_at > p_at','l.starts_at > sandbox_private.domain_at(p_at)']],
 t2_publish_plan: [['(e_row).starts_at <= p_cutoff','(e_row).starts_at <= sandbox_private.domain_at(p_cutoff)']],
 t2_exchange_calc: [['a.starts_at <= p_at','a.starts_at <= sandbox_private.domain_at(p_at)'],["workhub_private.t2_parse_ts(i #> '{target,startsAt}', true) <= p_at", "workhub_private.t2_parse_ts(i #> '{target,startsAt}', true) <= sandbox_private.domain_at(p_at)"],['o.starts_at <= p_at','o.starts_at <= sandbox_private.domain_at(p_at)']],
 t2_school_day_execute: [["(ch #>> '{before,time,startsAt}')::timestamptz <= v_at","(ch #>> '{before,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"],["(ch #>> '{after,time,startsAt}')::timestamptz <= v_at","(ch #>> '{after,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"]],
 t2_req_live: [['r.expires_at > p_at','r.expires_at > sandbox_private.domain_at(p_at)']],
 t2_publish_commit: [["(x ->> 's')::timestamptz <= v_at","(x ->> 's')::timestamptz <= sandbox_private.domain_at(v_at)"],["(x #>> '{before,time,startsAt}')::timestamptz <= v_at","(x #>> '{before,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"]],
 t2_recommend: [['a.starts_at <= v_now','a.starts_at <= sandbox_private.domain_at(v_now)'],["(t ->> 'startsAt')::timestamptz > v_now","(t ->> 'startsAt')::timestamptz > sandbox_private.domain_at(v_now)"],['o.starts_at > v_now','o.starts_at > sandbox_private.domain_at(v_now)']],
 t2_school_day_calc: [['vl.starts_at <= p_created','vl.starts_at <= sandbox_private.domain_at(p_created)'],["(c #>> '{after,time,startsAt}')::timestamptz <= p_created","(c #>> '{after,time,startsAt}')::timestamptz <= sandbox_private.domain_at(p_created)"]],
 t2_action: [['rq.expires_at <= v_at','rq.expires_at <= sandbox_private.domain_at(v_at)'],["(ch #>> '{before,time,startsAt}')::timestamptz <= v_at","(ch #>> '{before,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"],["(ch #>> '{after,time,startsAt}')::timestamptz <= v_at","(ch #>> '{after,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"]],
 t2_submit: [["(ch #>> '{before,time,startsAt}')::timestamptz <= v_at","(ch #>> '{before,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"],["(ch #>> '{after,time,startsAt}')::timestamptz <= v_at","(ch #>> '{after,time,startsAt}')::timestamptz <= sandbox_private.domain_at(v_at)"]],
 t2_exec_get: [['l.ends_at <= v_at','l.ends_at <= sandbox_private.domain_at(v_at)']],
 t2_exec_record: [['l.ends_at > v_at','l.ends_at > sandbox_private.domain_at(v_at)']],
 t3_live: [['r.expires_at>p_at','r.expires_at>sandbox_private.domain_at(p_at)']],
 t2_req_view: [['r.expires_at <= p_at','r.expires_at <= sandbox_private.domain_at(p_at)']],
 t3_execute: [["(a->>'starts_at')::timestamptz<=at","(a->>'starts_at')::timestamptz<=sandbox_private.domain_at(at)"]],
 t3_plan: [['n.starts_at<=p_at','n.starts_at<=sandbox_private.domain_at(p_at)'],['l.starts_at<=p_at','l.starts_at<=sandbox_private.domain_at(p_at)']],
 t3_view: [['r.expires_at<=p_at','r.expires_at<=sandbox_private.domain_at(p_at)']],
 c_cmd_withdraw: [['clock_timestamp() >= c.due_at','sandbox_private.domain_now() >= c.due_at']],
 c_cmd_submit: [['v_now timestamptz := clock_timestamp()','v_now timestamptz := sandbox_private.domain_now()']],
}
const hash = s=>createHash('sha256').update(s).digest('hex')
export function patchDefinition(name,source) {
 let result=source
 for(const [from,to] of replacements[name]??[]){if(!result.includes(from))throw new Error(`${name}: 기준 구문을 찾지 못했습니다: ${from}`);result=result.replaceAll(from,to)}
 return result
}
export async function applyOverrides(path) {
const c=await connectSandbox(loadSecrets(path))
try {
 await assertMarker(c)
 const exists=await c.query("select to_regclass('sandbox_private.clock_state') t")
 if(!exists.rows[0].t) await c.query(readFileSync(new URL('../../sandbox/school-year/SB-01_시험시계_누적예산.sql',import.meta.url),'utf8'))
 await c.query('begin')
 const originals=JSON.parse(readFileSync(new URL('../../sandbox/school-year/override-originals.json',import.meta.url),'utf8'))
 for(const [name] of Object.entries(replacements)){
  const original=originals.find(x=>x.name===name);if(!original)throw new Error('원문 없음 '+name)
  const result=patchDefinition(name,original.definition)
  const live=await c.query('select pg_get_functiondef($1::regprocedure) definition',[original.signature])
  const recorded=await c.query('select * from sandbox_private.overrides where signature=$1',[original.signature])
  if(recorded.rowCount){if(hash(live.rows[0].definition)!==recorded.rows[0].after_sha256)throw new Error('기존 변경과 다름 '+name);if(hash(result)===hash(live.rows[0].definition))continue}
  else if(hash(live.rows[0].definition)!==hash(original.definition))throw new Error('SQL 원문 변경 '+name)
  await c.query(result)
  const after=await c.query('select pg_get_functiondef($1::regprocedure) definition',[original.signature])
  await c.query('insert into sandbox_private.overrides values($1,$2,$3,$4) on conflict(signature) do update set after_sha256=excluded.after_sha256',[original.signature,hash(original.definition),hash(after.rows[0].definition),'전용 가명 시험 계정과 업무 시간만 변경. 로그인·임대·정산은 실제 시계 유지'])
 }
 await c.query('commit');console.log('시험 전용 계정·시계 차이 적용 완료')
}catch(e){await c.query('rollback');throw e}finally{await c.end()}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) await applyOverrides(process.argv[2])
