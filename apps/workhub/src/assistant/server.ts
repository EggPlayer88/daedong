import type { LegacyIdentity } from '../connection/contracts';
import type { SupabaseConnection } from '../connection/supabase-connection';
import { recoveryScope } from '../app/pending-requests';
import { activeAt } from '../domain';
import { canonical, createScopedRpc, identifier } from '../services/scoped-rpc';
import { ASSISTANT_LIMITS, assistantEnvelope, assistantInput, assistantThread, askResult, AssistantError, assistantError, confirmTask, readiness, taskReceipt, threadList, type AssistantServer, type AssistantMode } from './contracts';
import type { AssistantHttpPort } from './http';
export function createAssistantServer(connection: SupabaseConnection, http: AssistantHttpPort, options: { timeoutMs?: number } = {}): AssistantServer {
    const timeoutMs = options.timeoutMs ?? ASSISTANT_LIMITS.clientTimeoutMs + 5000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new AssistantError('INVALID_INPUT');
    const rpc = createScopedRpc(connection, 'assistant.v1'), attempts = new Map<string, string>();
    function scope(memberId: string) { identifier(memberId); const context = connection.info(), member = context.memberships.find(row => row.id === memberId); if (!member || !context.schools.some(s => s.id === member.schoolId) || !activeAt(member, context.basisDate))
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
                return assistantEnvelope(raw, { schoolId: initial.member.schoolId, memberId });
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
    function parsed<T>(run: () => Promise<unknown>, parse: (raw: unknown) => T, writing = false): Promise<T> { return run().then(value => { try {
        return parse(value);
    }
    catch {
        throw new AssistantError(writing ? 'RESULT_UNKNOWN' : 'INVALID_RESPONSE');
    } }).catch(error => { throw assistantError(error, writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED'); }); }
    function keyFor(memberId: string, key: string, input: unknown) { identifier(key); if (key.length < 8)
        throw new AssistantError('INVALID_INPUT'); const id = scope(memberId).fingerprint + ':' + key, body = canonical(input); if (attempts.has(id) && attempts.get(id) !== body)
        throw new AssistantError('IDEMPOTENCY_CONFLICT'); attempts.set(id, body); }
    return {
        readiness(memberId) { return parsed(() => send(memberId, { action: 'readiness', memberId }), readiness); },
        list(memberId, mode: AssistantMode, cursor = null) { if (!['school', 'personal'].includes(mode))
            return Promise.reject(new AssistantError('INVALID_INPUT')); return parsed(() => rpc.call(memberId, 'workhub_ai_threads_list', { p_mode: mode, p_cursor: cursor }, data => data), raw => threadList(raw, mode)); },
        get(memberId, id, cursor = null) { identifier(id); return parsed(() => rpc.call(memberId, 'workhub_ai_thread_get', { p_thread_id: id, p_cursor: cursor }, data => data), raw => { const result = assistantThread(raw); if (result.id !== id)
            throw new AssistantError('INVALID_RESPONSE'); return result; }); },
        ask(memberId, input, key) { let checked; try {
            checked = assistantInput(input);
            keyFor(memberId, key, { kind: 'ask', input: checked });
        }
        catch (error) {
            throw assistantError(error, 'INVALID_INPUT');
        } return parsed(() => send(memberId, { action: 'ask', memberId, input: checked, requestKey: key }, true), raw => { const result = askResult(raw, key); if (result.state === 'completed') {
            const exchange = result.thread.exchanges.find(e => e.requestKey === key)!;
            if (result.thread.mode !== checked.mode || result.thread.version !== checked.expectedVersion + 1 || (checked.threadId !== null && result.thread.id !== checked.threadId) || exchange.prompt !== checked.prompt || exchange.intent !== checked.intent || canonical(exchange.studentContext) !== canonical(checked.studentContext))
                throw new AssistantError('INVALID_RESPONSE');
        } return result; }, true); },
        confirmTask(memberId, input, key) { let checked; try {
            checked = confirmTask(input);
            keyFor(memberId, key, { kind: 'confirmTask', input: checked });
        }
        catch (error) {
            throw assistantError(error, 'INVALID_INPUT');
        } return parsed(() => rpc.call(memberId, 'workhub_ai_confirm_task', { p_input: checked, p_request_key: key }, data => data, true), raw => taskReceipt(raw, checked, key), true); },
    };
}
