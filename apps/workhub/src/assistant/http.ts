import type { LegacySession } from '../connection/contracts';
import { ASSISTANT_LIMITS, AssistantError, assistantError } from './contracts';
export interface AssistantHttpPort {
    send(payload: unknown, expectedUserId: string, writing: boolean): Promise<unknown>;
}
// 기존 로그인 세션만 전달한다. 사용자·학교 ID와 근거 본문을 임의로 인증하지 않는다.
export function createAssistantHttp(options: {
    getSession(): Promise<LegacySession | null>;
    fetch?: typeof fetch;
    timeoutMs?: number;
    endpoint?: '/api/workhub-ai/chat' | '/api/workhub-ai/settings' | '/api/workhub-ai/operations';
}): AssistantHttpPort {
    if (options.endpoint && !['/api/workhub-ai/chat', '/api/workhub-ai/settings', '/api/workhub-ai/operations'].includes(options.endpoint)) throw new AssistantError('INVALID_INPUT');
    const send = options.fetch ?? globalThis.fetch, timeout = options.timeoutMs ?? ASSISTANT_LIMITS.clientTimeoutMs;
    if (!Number.isFinite(timeout) || timeout < 1 || timeout > 60000)
        throw new AssistantError('INVALID_INPUT');
    return { async send(payload, expectedUserId, writing) {
            const body = JSON.stringify(payload), controller = new AbortController();
            let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined, expired = false;
            const failure = () => new AssistantError(writing ? 'RESULT_UNKNOWN' : 'QUERY_FAILED'), guard = () => { if (expired)
                throw failure(); }, stop = () => { controller.abort(); if (reader)
                void reader.cancel().catch(() => { }); };
            async function same() { let session: LegacySession | null; try {
                session = await options.getSession();
            }
            catch {
                throw failure();
            } guard(); if (!session || session.user.id !== expectedUserId || !session.access_token)
                throw new AssistantError('CANCELLED'); return session; }
            async function run() {
                try {
                    const session = await same(), response = await send(options.endpoint ?? '/api/workhub-ai/chat', { method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body });
                    guard();
                    await same();
                    if (!response.body)
                        throw failure();
                    reader = response.body.getReader();
                    let size = 0;
                    const chunks: Uint8Array[] = [];
                    while (true) {
                        const chunk = await reader.read();
                        guard();
                        if (chunk.done)
                            break;
                        size += chunk.value.byteLength;
                        if (size > ASSISTANT_LIMITS.responseBytes)
                            throw failure();
                        chunks.push(chunk.value);
                    }
                    const bytes = new Uint8Array(size);
                    let offset = 0;
                    for (const chunk of chunks) {
                        bytes.set(chunk, offset);
                        offset += chunk.byteLength;
                    }
                    const data: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
                    await same();
                    if (!response.ok) {
                        const code = (data as {
                            error?: {
                                code?: unknown;
                            };
                        } | null)?.error?.code;
                        if (typeof code === 'string' && ['COUNT_FAILED', 'INPUT_TOO_LARGE', 'KEY_UNAVAILABLE', 'KEY_MISSING', 'NOT_READY', 'FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXCEEDED'].includes(code))
                            throw assistantError({ code });
                        throw failure();
                    }
                    return data;
                }
                catch (error) {
                    guard();
                    if (error instanceof AssistantError && error.code === 'CANCELLED')
                        throw error;
                    await same();
                    throw error instanceof AssistantError ? error : failure();
                }
            }
            try {
                return await Promise.race([run(), new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; stop(); reject(failure()); }, timeout); })]);
            }
            finally {
                clearTimeout(timer);
                stop();
            }
        } };
}
