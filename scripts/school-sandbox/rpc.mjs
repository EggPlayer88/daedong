// 접수·권한 판정을 우회하지 않고 공개 RPC를 현재 가명 계정의 JWT 문맥으로 호출한다.
export async function rpc(client,userId,name,args={}) {
 if(!/^workhub_[a-z0-9_]+$/.test(name)||Object.keys(args).some(k=>!/^p_[a-z0-9_]+$/.test(k)))throw new Error('RPC 이름 오류')
 await client.query('begin')
 try{
  await client.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);await client.query('set local role authenticated')
  const entries=Object.entries(args),q=`select public.${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')}) value`
  const value=(await client.query(q,entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value))).rows[0].value
  await client.query('commit')
  if(value?.error)throw new Error(`${name}: ${JSON.stringify(value.error)}`)
  return value
 }catch(e){await client.query('rollback');throw e}
}
