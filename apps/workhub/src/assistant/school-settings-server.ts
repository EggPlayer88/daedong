import type { LegacyIdentity } from '../connection/contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { recoveryScope } from '../app/pending-requests'
import { activeAt } from '../domain'
import { canonical, identifier, object } from '../services/scoped-rpc'
import { ASSISTANT_LIMITS, AssistantError, assistantError, assistantLocalInput } from './contracts'
import type { AssistantHttpPort } from './http'
import {schoolAiStatus,schoolAiReceipt,schoolAiKeyCommand,schoolAiRequestKey,schoolAiRawKey,type SchoolAiSettingsServer} from './school-settings-contracts'
export function createSchoolAiSettingsServer(connection:SupabaseConnection,http:AssistantHttpPort,options:{timeoutMs?:number}={}):SchoolAiSettingsServer {
 const timeoutMs=options.timeoutMs??ASSISTANT_LIMITS.clientTimeoutMs+5000;
 if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new AssistantError('INVALID_INPUT');
    function scope(memberId: string) { assistantLocalInput(() => identifier(memberId)); const context = connection.info(), member = context.memberships.find(row => row.id === memberId); if (!member || !context.schools.some(s => s.id === member.schoolId) || !activeAt(member, context.basisDate))
        throw new AssistantError('INACTIVE_MEMBERSHIP'); return { member, fingerprint: recoveryScope(member) }; }
    async function send(memberId: string, payload: unknown, writing = false) {
        const initial = scope(memberId);
        let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
        const guard = () => { if (expired) throw new AssistantError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED'); };
        const access = (identity: LegacyIdentity) => canonical([identity.userId,identity.approved,identity.profile?.role,identity.profile?.is_active,identity.profile?.department_id,[...(identity.profile?.extra_permissions??[])].sort()]);
        async function current() {
            guard();
            const identity = await connection.getIdentity();
            guard();
            if (!identity || identity.userId !== initial.member.userId || scope(memberId).fingerprint !== initial.fingerprint) throw new AssistantError('CANCELLED');
            if (!identity.approved) throw new AssistantError(writing ? 'CANCELLED' : 'FORBIDDEN');
            return identity;
        }
        async function run() {
            try {
                const before = await current();
                guard();
                const raw = await http.send(structuredClone(payload), initial.member.userId, writing);
                guard();
                if (access(await current()) !== access(before)) throw new AssistantError('CANCELLED');
                return {raw, expected:{schoolId:initial.member.schoolId,memberId}};
            } catch (error) {
                guard();
                try { await current(); } catch { throw new AssistantError('CANCELLED'); }
                const mapped = assistantError(error, writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED');
                if (writing && ['INVALID_RESPONSE','QUERY_FAILED'].includes(mapped.code)) throw new AssistantError('RESULT_UNKNOWN');
                throw mapped;
            }
        }
        try {
            return await Promise.race([run(), new Promise<never>((_, reject) => {
                timer = setTimeout(() => { expired = true; reject(new AssistantError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED')); }, timeoutMs);
            })]);
        } finally { expired = true; clearTimeout(timer); }
    }

 async function parsed<T>(memberId:string,payload:unknown,parse:(raw:unknown,expected:{schoolId:string;memberId:string})=>T,writing=false):Promise<T>{
  const {raw,expected}=await send(memberId,payload,writing);
  if(object(raw)&&Object.hasOwn(raw,'error')){if(raw.contract!=='assistant.school.v1'||raw.schoolId!==expected.schoolId||raw.memberId!==memberId||Object.keys(raw).length!==4||!object(raw.error)||Object.keys(raw.error).length!==1)throw new AssistantError(writing?'RESULT_UNKNOWN':'INVALID_RESPONSE');throw assistantError(raw.error,writing?'RESULT_UNKNOWN':'INVALID_RESPONSE')}
  try{return parse(raw,expected)}catch{throw new AssistantError(writing?'RESULT_UNKNOWN':'INVALID_RESPONSE')}
 }
 return {
  status(memberId){return parsed(memberId,{action:'status',memberId},schoolAiStatus)},
  saveKey(memberId,raw,key,apiKey){const command=schoolAiKeyCommand(raw),requestKey=schoolAiRequestKey(key),secret=schoolAiRawKey(apiKey);return parsed(memberId,{action:'save_key',memberId,...command,requestKey,apiKey:secret},(value,expected)=>schoolAiReceipt(value,expected,command,requestKey),true)},
  recoverKey(memberId,raw,key){const command=schoolAiKeyCommand(raw),requestKey=schoolAiRequestKey(key);return parsed(memberId,{action:'recover_key',memberId,requestKey,...command},(value,expected)=>schoolAiReceipt(value,expected,command,requestKey),true)},
  closeKey(memberId,raw,key){const command=schoolAiKeyCommand(raw),requestKey=schoolAiRequestKey(key);return parsed(memberId,{action:'close_key',memberId,requestKey,...command},(value,expected)=>schoolAiReceipt(value,expected,command,requestKey),true)}
 }
}
