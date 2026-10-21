import limits from '../../../main/api/workhub-ai/_assets/assistant-limits.json';
import routing from '../../../main/api/workhub-ai/_assets/model-routing.json';
export const ASSISTANT_ROUTING = routing;
import { normalizeTaskInput, TASK_INPUT_LIMITS } from '../tasks/validation';
export { TASK_INPUT_LIMITS };
import type { EvidenceReference } from '../teaching/evidence';
import { canonical, exact, identifier, isoDate, object } from '../services/scoped-rpc';
export const ASSISTANT_LIMITS = limits;
export const ASSISTANT_CONTRACT = 'assistant.v1';
export type AssistantIntent = 'school_advice' | 'personal_assistant' | 'document_draft' | 'student_record_draft' | 'guided_collection';
export type AssistantMode = 'school' | 'personal';
export type AssistantQuality = 'quick' | 'review';
export interface AssistantReviewOf { requestKey: string; exchangeId: string }
export interface AssistantExecution { quality: AssistantQuality; model: string; reviewOf: AssistantReviewOf | null }
export type ResourceReference = {
    kind: 'knowledge' | 'calendar' | 'task' | 'collection' | 'document';
    id: string;
    version: number;
};
export type AssistantReference = ResourceReference | EvidenceReference;
export interface StudentContext {
    studentId: string;
    courseId: string;
    evidence: EvidenceReference[];
}
export interface AssistantContextRequest {
    mode: AssistantMode;
    intent: AssistantIntent;
    prompt?: string;
    references: ResourceReference[];
    studentContext: StudentContext | null;
}
export interface AssistantInput extends Omit<AssistantContextRequest, 'prompt'> {
    prompt: string;
    threadId: string | null;
    expectedVersion: number;
    // 과거 원요청은 필드를 덧붙이지 않는다. 새 요청만 실행 등급을 명시한다.
    quality?: AssistantQuality;
    reviewOf?: AssistantReviewOf | null;
}
export interface Citation {
    reference: AssistantReference;
    title: string;
    locator: string;
}
export interface AnswerSegment {
    text: string;
    citations: Citation[];
}
export interface TaskDraft {
    title: string;
    notes: string;
    dueDate: string;
}
export interface TaskProposal {
    id: string;
    version: number;
    kind: 'create_personal_task';
    input: TaskDraft;
    status: 'pending' | 'applied';
    resourceId: string | null;
}
export interface Exchange {
    execution?: AssistantExecution;
    id: string;
    requestKey: string;
    intent: AssistantIntent;
    prompt: string;
    segments: AnswerSegment[];
    proposal: TaskProposal | null;
    createdAt: string;
    studentContext: StudentContext | null;
}
export interface AssistantThread {
    id: string;
    mode: AssistantMode;
    version: number;
    title: string;
    exchanges: Exchange[];
    nextCursor: string | null;
}
export interface ThreadSummary {
    id: string;
    mode: AssistantMode;
    version: number;
    title: string;
    updatedAt: string;
}
export type Readiness = {
    available: true;
} | {
    available: false;
    reason: 'not_configured' | 'not_allowed' | 'budget_exhausted';
};
export type AskResult = {
    state: 'completed';
    requestKey: string;
    thread: AssistantThread;
} | {
    state: 'pending';
    requestKey: string;
    reason: 'in_progress' | 'provider_unknown';
} | {
    state: 'rejected';
    requestKey: string;
    code: 'OUTPUT_INVALID' | 'PROVIDER_REJECTED' | 'TRUNCATED' | 'INPUT_TOO_LARGE' | 'COUNT_FAILED';
};
export type AssistantCloseResult = AskResult | {state:'closed';requestKey:string};
export interface ConfirmTask {
    threadId: string;
    proposalId: string;
    expectedVersion: number;
    input: TaskDraft;
}
export interface TaskReceipt {
    requestKey: string;
    proposalId: string;
    proposalVersion: number;
    taskId: string;
    taskVersion: number;
    threadVersion: number;
}
export interface AssistantServer {
    readiness(memberId: string): Promise<Readiness>;
    list(memberId: string, mode: AssistantMode, cursor?: string | null): Promise<{
        items: ThreadSummary[];
        nextCursor: string | null;
    }>;
    get(memberId: string, id: string, cursor?: string | null): Promise<AssistantThread>;
    ask(memberId: string, input: AssistantInput, key: string): Promise<AskResult>;
    close?(memberId: string, input: AssistantInput, key: string): Promise<AssistantCloseResult>;
    confirmTask(memberId: string, input: ConfirmTask, key: string): Promise<TaskReceipt>;
}
export type AssistantCode = 'COUNT_FAILED' | 'INPUT_TOO_LARGE' | 'KEY_UNAVAILABLE' | 'KEY_MISSING' | 'NOT_READY' | 'FORBIDDEN' | 'INACTIVE_MEMBERSHIP' | 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'IDEMPOTENCY_CONFLICT' | 'BUDGET_EXCEEDED' | 'CANCELLED' | 'QUERY_FAILED' | 'RESULT_UNKNOWN' | 'INVALID_RESPONSE';
const messages: Record<AssistantCode, string> = { COUNT_FAILED: '사용량을 미리 계산하지 못해 유료 답변 생성을 시작하지 않았습니다. 입력을 유지했습니다.', INPUT_TOO_LARGE: '선택한 자료가 처리 한도를 넘었습니다. 범위를 줄인 뒤 다시 요청해 주세요.', KEY_UNAVAILABLE: '학교 API 키를 읽을 수 없어 요청을 시작하지 않았습니다. 학교 관리 담당자에게 키 설정 확인을 요청해 주세요.', KEY_MISSING: '학교 API 키가 아직 등록되지 않았습니다. 학교 AI 이용 설정에서 등록해 주세요.', NOT_READY: 'Claude 비서의 서버 연결과 승인된 이용 설정을 준비 중입니다.', FORBIDDEN: '현재 계정으로 이 요청을 처리할 수 없습니다.', INACTIVE_MEMBERSHIP: '학교 소속을 다시 확인해 주세요.', INVALID_INPUT: '입력 내용과 선택한 근거를 확인해 주세요.', NOT_FOUND: '현재 사용할 수 있는 근거 또는 대화가 아닙니다.', CONFLICT: '대화나 근거가 변경되었습니다. 최신 자료를 확인한 뒤 다시 요청해 주세요.', IDEMPOTENCY_CONFLICT: '기존 요청 번호와 내용이 달라 처리하지 않았습니다.', BUDGET_EXCEEDED: '승인된 AI 이용 한도에 도달했습니다. 설정을 확인해 주세요.', CANCELLED: '계정 또는 학교 권한이 바뀌어 이전 응답을 닫았습니다.', QUERY_FAILED: '대화를 불러오지 못했습니다. 입력은 유지됩니다.', RESULT_UNKNOWN: '결과를 확인하지 못했습니다. 같은 요청으로 상태를 확인해 주세요.', INVALID_RESPONSE: '응답 형식을 확인하지 못했습니다.' };
export class AssistantError extends Error {
    constructor(readonly code: AssistantCode) { super(messages[code]); this.name = 'AssistantError'; }
}
export const assistantError = (error: unknown, fallback: AssistantCode = 'QUERY_FAILED') => new AssistantError(object(error) && typeof error.code === 'string' && Object.hasOwn(messages, error.code) ? error.code as AssistantCode : fallback);
export const executionNotStartedFailure = (error: unknown) => error instanceof AssistantError && ['COUNT_FAILED','INPUT_TOO_LARGE','KEY_UNAVAILABLE','KEY_MISSING'].includes(error.code);
export const definiteFailure = (error: unknown) => error instanceof AssistantError && ['COUNT_FAILED', 'INPUT_TOO_LARGE', 'KEY_UNAVAILABLE', 'KEY_MISSING', 'INVALID_INPUT', 'NOT_FOUND', 'CONFLICT', 'IDEMPOTENCY_CONFLICT', 'BUDGET_EXCEEDED'].includes(error.code);
function fail(): never { throw new AssistantError('INVALID_RESPONSE'); }
function txt(value: unknown, max: number, required = true): string { if (typeof value !== 'string' || Array.from(value).length > max || (required && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))
    fail(); for (const c of value) {
    if (c.length === 1 && c.charCodeAt(0) >= 0xd800 && c.charCodeAt(0) <= 0xdfff)
        fail();
} return value; }
function int(value: unknown, min = 0): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min)
    fail(); return value; }
function choice<T extends string>(value: unknown, values: readonly T[]): T { if (typeof value !== 'string' || !values.includes(value as T))
    fail(); return value as T; }
function rows(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max)
    fail(); return value; }
function unique(value: unknown[]) { if (new Set(value.map(canonical)).size !== value.length)
    fail(); }
function stamp(value: unknown) { const result = txt(value, 40); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || !Number.isFinite(Date.parse(result)))
    fail(); isoDate(result.slice(0, 10)); return result; }
const mode = (value: unknown) => choice(value, ['school', 'personal'] as const);
const intent = (value: unknown) => choice(value, limits.intents as AssistantIntent[]);
const cursor = (value: unknown) => value === null ? null : txt(value, 2000);
export function assistantReference(raw: unknown): AssistantReference { if (!object(raw))
    fail(); if (['knowledge', 'calendar', 'task', 'collection', 'document'].includes(raw.kind as string)) {
    exact(raw, ['kind', 'id', 'version']);
    return { kind: raw.kind as ResourceReference['kind'], id: identifier(raw.id), version: int(raw.version, 1) };
} exact(raw, ['kind', 'id', 'revisionId', 'sourceHash', 'epoch', 'start', 'end']); const ref = { kind: choice(raw.kind, ['observation', 'assessment'] as const), id: identifier(raw.id), revisionId: identifier(raw.revisionId), sourceHash: txt(raw.sourceHash, 64), epoch: int(raw.epoch), start: int(raw.start), end: int(raw.end, 1) }; if (!/^[0-9a-f]{64}$/.test(ref.sourceHash) || ref.start >= ref.end)
    fail(); return ref; }
// 요청 입력에서만 검증 오류를 입력 오류로 바꾼다. 같은 파서를 쓰는 응답 검증은 그대로 둔다.
export function assistantLocalInput<T>(parse: () => T): T {
    try { return parse(); } catch { throw new AssistantError('INVALID_INPUT'); }
}
export function assistantInput(raw: unknown): AssistantInput { return assistantLocalInput(() => parseAssistantInput(raw)); }
function parseAssistantInput(raw: unknown): AssistantInput {
    const withExecution = object(raw) && (Object.hasOwn(raw, 'quality') || Object.hasOwn(raw, 'reviewOf'));
    exact(raw, ['mode', 'intent', 'prompt', 'threadId', 'expectedVersion', 'references', 'studentContext', ...(withExecution ? ['quality', 'reviewOf'] : [])]); const result: AssistantInput = { mode: mode(raw.mode), intent: intent(raw.intent), prompt: txt(raw.prompt, limits.promptChars), threadId: raw.threadId === null ? null : identifier(raw.threadId), expectedVersion: int(raw.expectedVersion), references: rows(raw.references, limits.references).map(assistantReference) as ResourceReference[], studentContext: null }; if (result.references.some(ref => !('version' in ref)) || ((result.threadId === null) !== (result.expectedVersion === 0)))
    fail(); unique(result.references); if (raw.studentContext !== null) {
    const s = raw.studentContext;
    exact(s, ['studentId', 'courseId', 'evidence']);
    const evidence = rows(s.evidence, limits.references).map(assistantReference);
    if (!evidence.length || evidence.some(ref => 'version' in ref) || result.intent !== 'student_record_draft' || result.mode !== 'personal')
        fail();
    unique(evidence);
    result.studentContext = { studentId: identifier(s.studentId), courseId: identifier(s.courseId), evidence: evidence as EvidenceReference[] };
}
else if (result.intent === 'student_record_draft')
    fail(); if (result.intent === 'personal_assistant' && result.mode !== 'personal')
    fail(); if (withExecution) {
    result.quality = choice(raw.quality, ['quick', 'review'] as const);
    result.reviewOf = reviewReference(raw.reviewOf);
    if ((result.quality === 'review') !== Boolean(result.reviewOf) || (result.reviewOf && !result.threadId)) fail();
} return result; }
function reviewReference(raw: unknown): AssistantReviewOf | null {
    if (raw === null) return null; exact(raw, ['requestKey', 'exchangeId']);
    return { requestKey: identifier(raw.requestKey), exchangeId: identifier(raw.exchangeId) };
}
function execution(raw: unknown): AssistantExecution {
    exact(raw, ['quality', 'model', 'reviewOf']);
    const result = { quality: choice(raw.quality, ['quick', 'review'] as const), model: txt(raw.model, 150), reviewOf: reviewReference(raw.reviewOf) };
    if (!/^[A-Za-z0-9_.-]{1,150}$/.test(result.model) || (result.quality === 'quick' && result.reviewOf !== null)) fail();
    return result;
}
export function freshAssistantInput(value: Omit<AssistantInput, 'quality' | 'reviewOf'>): AssistantInput {
    return assistantInput({ ...value, quality: 'quick', reviewOf: null });
}
export function precisionReviewInput(thread: AssistantThread, source: Exchange): AssistantInput {
    return assistantLocalInput(() => {
        const saved = thread.exchanges.find(row => row.id === source.id && row.requestKey === source.requestKey);
        if (!saved || canonical(saved) !== canonical(source) || source.execution?.quality !== 'quick' || source.execution.model !== routing.models.quick.id || source.intent === 'student_record_draft') fail();
        // 원래 전체 근거는 서버가 원요청에서 복원한다. 답변 인용을 원참조 전체로 추정하지 않는다.
        return assistantInput({ mode: thread.mode, intent: source.intent, prompt: source.prompt, threadId: thread.id, expectedVersion: thread.version, references: [], studentContext: source.studentContext, quality: 'review', reviewOf: { requestKey: source.requestKey, exchangeId: source.id } });
    });
}
// 과거 대화의 긴 제안은 읽기만 허용한다. 새 확정은 기존 업무 규칙으로 다시 검사한다.
export function taskDraft(raw: unknown): TaskDraft { exact(raw, ['title', 'notes', 'dueDate']); return { title: txt(raw.title, TASK_INPUT_LIMITS.legacyAssistantRead.titleChars), notes: txt(raw.notes, TASK_INPUT_LIMITS.legacyAssistantRead.notesChars, false), dueDate: raw.dueDate === '' ? '' : isoDate(raw.dueDate) }; }
export function answerSegments(raw: unknown): AnswerSegment[] { const result = rows(raw, limits.segments).map(row => { exact(row, ['text', 'citations']); return { text: txt(row.text, limits.segmentChars), citations: rows(row.citations, limits.sources).map(c => { exact(c, ['reference', 'title', 'locator']); return { reference: assistantReference(c.reference), title: txt(c.title, 200), locator: txt(c.locator, 500) }; }) }; }); if (!result.length || result.reduce((n, row) => n + Array.from(row.text).length, 0) > limits.answerChars)
    fail(); return result; }
export function assistantThread(raw: unknown): AssistantThread { exact(raw, ['id', 'mode', 'version', 'title', 'exchanges', 'nextCursor']); const m = mode(raw.mode), exchanges = rows(raw.exchanges, 50).map(row => { exact(row, ['id', 'requestKey', 'intent', 'prompt', 'segments', 'proposal', 'createdAt', 'studentContext', ...(object(row) && Object.hasOwn(row, 'execution') ? ['execution'] : [])]); const input = parseAssistantInput({ mode: m, intent: row.intent, prompt: row.prompt, threadId: null, expectedVersion: 0, references: [], studentContext: row.studentContext }); const segments = answerSegments(row.segments); if (segments.some(s => s.citations.some(c => !('version' in c.reference) && (!input.studentContext || !input.studentContext.evidence.some(e => canonical(e) === canonical(c.reference))))))
    fail(); if (input.intent === 'student_record_draft' && segments.some(s => !s.citations.some(c => !('version' in c.reference))))
    fail(); let proposal: TaskProposal | null = null; if (row.proposal !== null) {
    const p = row.proposal;
    exact(p, ['id', 'version', 'kind', 'input', 'status', 'resourceId']);
    proposal = { id: identifier(p.id), version: int(p.version, 1), kind: choice(p.kind, ['create_personal_task']), input: taskDraft(p.input), status: choice(p.status, ['pending', 'applied']), resourceId: p.resourceId === null ? null : identifier(p.resourceId) };
    if ((proposal.status === 'applied') !== (proposal.resourceId !== null) || m !== 'personal' || input.intent !== 'personal_assistant')
        fail();
} const executed = Object.hasOwn(row, 'execution') ? execution(row.execution) : undefined; if (executed && executed.quality === 'review' && !executed.reviewOf && input.intent !== 'student_record_draft') fail(); return { id: identifier(row.id), requestKey: identifier(row.requestKey), intent: input.intent, prompt: input.prompt, segments, proposal, createdAt: stamp(row.createdAt), studentContext: input.studentContext, ...(executed ? { execution: executed } : {}) }; }); unique(exchanges.map(row => row.id)); unique(exchanges.map(row => row.requestKey)); return { id: identifier(raw.id), mode: m, version: int(raw.version, 1), title: txt(raw.title, 200), exchanges, nextCursor: cursor(raw.nextCursor) }; }
export function askResult(raw: unknown, key: string): AskResult { if (!object(raw) || raw.requestKey !== key)
    fail(); if (raw.state === 'completed') {
    exact(raw, ['state', 'requestKey', 'thread']);
    const thread = assistantThread(raw.thread);
    if (!thread.exchanges.some(row => row.requestKey === key))
        fail();
    return { state: 'completed', requestKey: key, thread };
} if (raw.state === 'pending') {
    exact(raw, ['state', 'requestKey', 'reason']);
    return { state: 'pending', requestKey: key, reason: choice(raw.reason, ['in_progress', 'provider_unknown']) };
} exact(raw, ['state', 'requestKey', 'code']); if (raw.state !== 'rejected')
    fail(); return { state: 'rejected', requestKey: key, code: choice(raw.code, ['OUTPUT_INVALID', 'PROVIDER_REJECTED', 'TRUNCATED', 'INPUT_TOO_LARGE', 'COUNT_FAILED']) }; }
export function readiness(raw: unknown): Readiness { if (object(raw) && raw.available === true) {
    exact(raw, ['available']);
    return { available: true };
} exact(raw, ['available', 'reason']); if (raw.available !== false)
    fail(); return { available: false, reason: choice(raw.reason, ['not_configured', 'not_allowed', 'budget_exhausted']) }; }
export function threadList(raw: unknown, expected: AssistantMode) { exact(raw, ['items', 'nextCursor']); const items = rows(raw.items, 50).map(row => { exact(row, ['id', 'mode', 'version', 'title', 'updatedAt']); if (row.mode !== expected)
    fail(); return { id: identifier(row.id), mode: mode(row.mode), version: int(row.version, 1), title: txt(row.title, 200), updatedAt: stamp(row.updatedAt) }; }); unique(items.map(row => row.id)); return { items, nextCursor: cursor(raw.nextCursor) }; }
export function confirmTask(raw: unknown): ConfirmTask { return assistantLocalInput(() => {
    exact(raw, ['threadId', 'proposalId', 'expectedVersion', 'input']);
    const value = raw.input;
    exact(value, ['title', 'notes', 'dueDate']);
    // 원문의 코드포인트 수와 저장 가능한 문자를 먼저 검사하고, 기존 업무와 같은 trim을 적용한다.
    txt(value.title, TASK_INPUT_LIMITS.titleChars);
    txt(value.notes, TASK_INPUT_LIMITS.notesChars, false);
    return { threadId: identifier(raw.threadId), proposalId: identifier(raw.proposalId), expectedVersion: int(raw.expectedVersion, 1), input: normalizeTaskInput(value) };
}); }
export function taskReceipt(raw: unknown, input: ConfirmTask, key: string): TaskReceipt { exact(raw, ['requestKey', 'proposalId', 'proposalVersion', 'taskId', 'taskVersion', 'threadVersion']); if (raw.requestKey !== key || raw.proposalId !== input.proposalId || int(raw.proposalVersion, 1) !== input.expectedVersion + 1)
    fail(); return { requestKey: key, proposalId: input.proposalId, proposalVersion: raw.proposalVersion as number, taskId: identifier(raw.taskId), taskVersion: int(raw.taskVersion, 1), threadVersion: int(raw.threadVersion, 1) }; }
export function assistantEnvelope(raw: unknown, scope: {
    schoolId: string;
    memberId: string;
}): unknown { if (!object(raw) || raw.contract !== ASSISTANT_CONTRACT || raw.schoolId !== scope.schoolId || raw.memberId !== scope.memberId)
    fail(); if (Object.hasOwn(raw, 'error')) {
    exact(raw, ['contract', 'schoolId', 'memberId', 'error']);
    exact(raw.error, ['code']);
    if (typeof raw.error.code !== 'string' || !Object.hasOwn(messages, raw.error.code))
        fail();
    throw new AssistantError(raw.error.code as AssistantCode);
} exact(raw, ['contract', 'schoolId', 'memberId', 'data']); return raw.data; }
