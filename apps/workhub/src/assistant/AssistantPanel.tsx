import { AiMemoryPanel } from './AiMemoryPanel';
import { composeMemoryPrompt } from './memory-prompt';
import type { MemoryService } from './memory-contracts';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Membership } from '../contracts';
import type { SupabaseConnection } from '../connection/supabase-connection';
import { recoveryScope, usePendingRequest } from '../app/pending-requests';
import { useEditDraft } from '../app/edit-drafts';
import { activeAt } from '../domain';
import { canonical } from '../services/scoped-rpc';
import { assistantInput, freshAssistantInput, precisionReviewInput, ASSISTANT_ROUTING, confirmTask, AssistantError, assistantError, definiteFailure, ASSISTANT_LIMITS, TASK_INPUT_LIMITS, type AnswerSegment, type AssistantContextRequest, type AssistantInput, type AssistantIntent, type AssistantMode, type AssistantServer, type AssistantThread, type ConfirmTask, type Readiness, type StudentContext, type TaskProposal, type ThreadSummary, type Exchange } from './contracts';
import { createAssistantServer } from './server';
import { SchoolAiBudget } from './SchoolAiSettingsPanel';
import { createSchoolAiSettingsServer } from './school-settings-server';
import type { SchoolAiSettingsServer, SchoolAiStatus } from './school-settings-contracts';
import { legacySchoolAiHttp } from './legacy-http';
import { legacyAssistantHttp } from './legacy-http';
import styles from './assistant.css?inline';
import { knowledgeCitationRequest, type KnowledgeAssistantRequest } from '../knowledge/assistant-links';
import type { Citation } from './contracts';
export interface AssistantDraftReady {
    intent: AssistantIntent;
    segments: AnswerSegment[];
    requestKey: string;
    threadId: string;
    studentContext: StudentContext | null;
}
export interface AssistantPanelProps {
    connection: SupabaseConnection;
    member: Membership;
    date: string;
    revision?: number;
    onNavigationLockChange?: (locked: boolean) => void;
    onUpdated?: () => void;
    contextRequest?: {
        id: string;
        request: AssistantContextRequest;
    };
    onDraftReady?: (draft: AssistantDraftReady, contextId?: string) => void;
    onComposeMessage?: (draft: { requestId: string; body: string }) => void;
    onOpenTask?: (taskId: string) => void;
    onOpenKnowledgeCitation?: (request: KnowledgeAssistantRequest) => void | Promise<void>;
    server?: AssistantServer;
    settingsServer?: SchoolAiSettingsServer;
    memoryServer?: MemoryService;
}
type Pending = {
    kind: 'ask';
    input: AssistantInput;
} | {
    kind: 'confirmTask';
    input: ConfirmTask;
};
type Session = {
    mode: AssistantMode;
    intent: AssistantIntent;
    prompt: string;
    references: AssistantContextRequest['references'];
    studentContext: StudentContext | null;
    thread?: AssistantThread;
    proposal?: TaskProposal;
    taskReview?: boolean;
    contextId?: string;
    requestContexts?: Record<string, string>;
};
const initial: Session = { mode: 'school', intent: 'school_advice', prompt: '', references: [], studentContext: null };
const intentLabels: Record<AssistantIntent, string> = { school_advice: '학교 업무 안내', personal_assistant: '내 업무와 할 일', document_draft: '문서 내용 초안', student_record_draft: '학생 기록 초안', guided_collection: '문답형 수합 초안' };
function pendingCommand(raw: unknown): Pending { if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new AssistantError('INVALID_INPUT'); const value = raw as Record<string, unknown>; if (Object.keys(value).length !== 2)
    throw new AssistantError('INVALID_INPUT'); if (value.kind === 'ask')
    return { kind: 'ask', input: assistantInput(value.input) }; if (value.kind === 'confirmTask') {
    const checked = confirmTask(value.input);
    // 새 규칙으로 원 요청을 바꾸지 않는다. 과거 미확정 요청은 원형을 보관한 채 확인이 필요하다.
    if (canonical(checked) !== canonical(value.input)) throw new AssistantError('INVALID_INPUT');
    return { kind: 'confirmTask', input: checked };
}  throw new AssistantError('INVALID_INPUT'); }
const newKey = () => globalThis.crypto.randomUUID();
export function AssistantPanel(props: AssistantPanelProps) { return <AssistantScope key={recoveryScope(props.member)} {...props}/>; }
function AssistantScope({ connection, member, date, revision = 0, onNavigationLockChange, onUpdated, contextRequest, onDraftReady, onComposeMessage, onOpenTask, onOpenKnowledgeCitation, server: provided, settingsServer: providedSettings, memoryServer }: AssistantPanelProps) {
    const server = useMemo(() => provided ?? createAssistantServer(connection, legacyAssistantHttp, {policyReads:true}), [provided, connection]), memory = useEditDraft<Session>(member, 'assistant'), recovery = usePendingRequest(member, 'assistant');
    const [session, setSession] = useState<Session>(() => { const saved = memory.initial ?? initial; if (recovery.request) {
        try {
            const command = pendingCommand(recovery.request.command);
            if (command.kind === 'ask')
                return { ...saved, mode: command.input.mode, intent: command.input.intent, prompt: command.input.prompt, references: command.input.references, studentContext: command.input.studentContext };
        }
        catch { }
    } return saved; }), latest = useRef(session), life = useRef(0), operation = useRef(false), uid = useId();
    const [ready, setReady] = useState<Readiness>(), [threads, setThreads] = useState<ThreadSummary[]>([]), [nextCursor, setNextCursor] = useState<string | null>(null), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState(''), [readError, setReadError] = useState('');
    const settingsServer = useMemo(() => providedSettings ?? createSchoolAiSettingsServer(connection, legacySchoolAiHttp), [providedSettings, connection]);
    const [schoolStatus, setSchoolStatus] = useState<SchoolAiStatus>(), [budgetError, setBudgetError] = useState('');
    useEffect(() => { let cancelled = false; setSchoolStatus(undefined); setBudgetError(''); if (!activeAt(member, date)) return; void settingsServer.status(member.id).then(value => { if (!cancelled) setSchoolStatus(value); }).catch(() => { if (!cancelled) setBudgetError('학교 예산을 확인하지 못했습니다. 요청 시 서버에서 이용 가능 여부를 다시 확인합니다.'); }); return () => { cancelled = true; }; }, [settingsServer, member.id, date, revision, refresh]);
    const [openingCitation, setOpeningCitation] = useState(false), citationFlight = useRef(false);
    let pending: Pending | undefined;
    try {
        if (recovery.request)
            pending = pendingCommand(recovery.request.command);
    }
    catch { /* 보존한 원문이 읽히지 않으면 임의로 지우지 않는다. */ }
    const [memoryLocked, setMemoryLocked] = useState(false);
    const enabled = activeAt(member, date), locked = Boolean(session.prompt.trim() || session.proposal || recovery.request || busy || memoryLocked), baseEditable = enabled && ready?.available === true && !busy && !recovery.request && !readError, editable = baseEditable && !memoryLocked;
    function update(value: Session) { latest.current = value; memory.save(value, Boolean(value.prompt.trim() || value.proposal)); setSession(value); }
    useEffect(() => () => { life.current++; }, [server]);
    useEffect(() => { onNavigationLockChange?.(locked); return () => onNavigationLockChange?.(false); }, [locked, onNavigationLockChange]);
    useEffect(() => { if (!locked)
        return; const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [locked]);
    useEffect(() => { let cancelled = false; setLoading(true); setReadError(''); if (!enabled) {
        setReady(undefined);
        setReadError('학교 소속 기간을 확인해 주세요.');
        setLoading(false);
        return;
    } void server.readiness(member.id).then(async (value) => { if (cancelled)
        return; setReady(value); if (!value.available) {
        setThreads([]);
        return;
    } const result = await server.list(member.id, session.mode); if (!cancelled) {
        setThreads(result.items);
        setNextCursor(result.nextCursor);
    } const selected = latest.current.thread; if (selected) {
        const current = await server.get(member.id, selected.id);
        if (current.mode !== session.mode)
            throw new AssistantError('INVALID_RESPONSE');
        if (!cancelled && latest.current.thread?.id === selected.id && latest.current.thread.version === selected.version)
            update({ ...latest.current, thread: current });
    } }).catch(failure => { if (!cancelled) {
        setReadError(assistantError(failure).message);
        setThreads([]);
    } }).finally(() => { if (!cancelled)
        setLoading(false); }); return () => { cancelled = true; }; }, [server, member.id, enabled, session.mode, revision, refresh]);
    async function loadThread(id: string) { if (!editable || locked || operation.current)
        return; operation.current = true; setBusy(true); setError(''); const epoch = life.current; try {
        const value = await server.get(member.id, id);
        if (life.current === epoch && value.mode === latest.current.mode)
            update({ ...latest.current, thread: value });
    }
    catch (failure) {
        if (life.current === epoch)
            setError(assistantError(failure).message);
    }
    finally {
        if (life.current === epoch) {
            operation.current = false;
            setBusy(false);
        }
    } }
    async function moreThreads() { if (!nextCursor || loading || operation.current)
        return; const epoch = life.current; operation.current = true; setLoading(true); try {
        const value = await server.list(member.id, latest.current.mode, nextCursor);
        if (life.current !== epoch)
            return;
        setThreads(previous => [...previous, ...value.items.filter(row => !previous.some(old => old.id === row.id))]);
        setNextCursor(value.nextCursor);
    }
    catch (failure) {
        if (life.current === epoch)
            setReadError(assistantError(failure).message);
    }
    finally {
        if (life.current === epoch) {
            operation.current = false;
            setLoading(false);
        }
    } }
    async function moreMessages() { const current = latest.current.thread; if (!current?.nextCursor || !editable || operation.current)
        return; operation.current = true; setBusy(true); const epoch = life.current; try {
        const value = await server.get(member.id, current.id, current.nextCursor);
        if (life.current !== epoch)
            return;
        if (value.version !== current.version)
            throw new AssistantError('CONFLICT');
        update({ ...latest.current, thread: { ...value, exchanges: [...value.exchanges.filter(row => !current.exchanges.some(old => old.id === row.id)), ...current.exchanges] } });
    }
    catch (failure) {
        if (life.current === epoch)
            setError(assistantError(failure).message);
    }
    finally {
        if (life.current === epoch) {
            operation.current = false;
            setBusy(false);
        }
    } }
    async function execute(command: Pending, key: string, closing = false) {
        if (operation.current || !enabled)
            return;
        operation.current = true;
        setBusy(true);
        setError('');
        setNotice('');
        const epoch = life.current, isClosing = command.kind === 'ask' && (closing || recovery.request?.closeState === 'closing');
        recovery.put({ command, key, ...(isClosing ? {closeState:'closing' as const} : {}) });
        try {
            if (command.kind === 'ask') {
                const result = isClosing ? await server.close!(member.id, command.input, key) : await server.ask(member.id, command.input, key);
                if (life.current !== epoch)
                    return;
                if (result.state === 'closed') { recovery.remove(key); setNotice('AI 요청을 닫았습니다. 늦게 도착한 요청은 새 답변을 만들지 않습니다. 작성한 입력은 유지합니다.'); return; }
                if (isClosing && result.state === 'rejected') { setError('원래 요청이 종료되었으나 닫힘 또는 완료 확인이 필요합니다. 같은 번호로 닫기 결과를 다시 확인해 주세요.'); return; }
                if (result.state === 'pending') {
                    setNotice(result.reason === 'provider_unknown' ? 'AI 응답 여부를 확인 중입니다. 같은 요청을 확인해도 AI를 새로 호출하지 않습니다.' : '기존 요청을 처리 중입니다. 잠시 뒤 같은 요청으로 확인해 주세요.');
                    return;
                }
                recovery.remove(key);
                if (result.state === 'rejected') {
                    setError(result.code === 'COUNT_FAILED' ? '사용량을 미리 계산하지 못해 유료 답변 생성을 시작하지 않았습니다. 입력을 유지했습니다.' : result.code === 'INPUT_TOO_LARGE' ? '선택한 자료가 한 번에 처리할 수 있는 범위를 넘었습니다. 범위를 줄여 다시 요청해 주세요.' : result.code === 'TRUNCATED' ? '답변 길이 제한으로 초안을 완료하지 못했습니다. 요청 범위를 줄여 다시 요청해 주세요.' : result.code === 'OUTPUT_INVALID' ? '근거와 형식 검증을 통과하지 못했습니다. 답변을 저장하지 않았습니다.' : 'AI 요청이 거절되었습니다. 설정과 이용 가능 상태를 확인해 주세요.');
                    return;
                }
                update({ ...latest.current, thread: result.thread, prompt: '', references: [], studentContext: null, proposal: undefined, taskReview: false });
                setNotice('답변과 근거를 확인해 주세요.');
                setRefresh(value => value + 1);
            }
            else {
                const result = await server.confirmTask(member.id, command.input, key);
                if (life.current !== epoch)
                    return;
                recovery.remove(key);
                const current = latest.current;
                update({ ...current, proposal: undefined, taskReview: false, thread: current.thread ? { ...current.thread, version: result.threadVersion, exchanges: current.thread.exchanges.map(row => row.proposal?.id === result.proposalId ? { ...row, proposal: { ...row.proposal, status: 'applied', version: result.proposalVersion, resourceId: result.taskId } } : row) } : undefined });
                setNotice('개인 할 일에 추가했습니다.');
                onUpdated?.();
            }
        }
        catch (failure) {
            if (life.current !== epoch)
                return;
            const mapped = assistantError(failure, 'RESULT_UNKNOWN');
            if (!isClosing && definiteFailure(mapped))
                recovery.remove(key);
            setError(mapped.message);
        }
        finally {
            if (life.current === epoch) {
                operation.current = false;
                setBusy(false);
            }
        }
    }
    function ask() { if (!editable || operation.current)
        return; try {
        const current = latest.current, input = freshAssistantInput({ mode: current.mode, intent: current.intent, prompt: current.prompt, threadId: current.thread?.id ?? null, expectedVersion: current.thread?.version ?? 0, references: current.references, studentContext: current.studentContext });
        const key = newKey();
        if (current.contextId) update({ ...current, requestContexts: { ...current.requestContexts, [key]: current.contextId } });
        void execute({ kind: 'ask', input }, key);
    }
    catch {
        setError('질문 내용과 선택한 근거를 확인해 주세요.');
    } }
    function reviewAnswer(source: Exchange) {
        if (!editable || locked || operation.current || !latest.current.thread) return;
        try {
            const current = latest.current, input = precisionReviewInput(current.thread!, source), key = newKey();
            const contextId = current.requestContexts?.[source.requestKey];
            if (contextId) update({ ...current, requestContexts: { ...current.requestContexts, [key]: contextId } });
            void execute({ kind: 'ask', input }, key);
        } catch { setError('정밀 검토할 원래 답변과 대화 상태를 다시 확인해 주세요.'); }
    }
    function applyContext() { if (!contextRequest || locked || operation.current)
        return; const request = contextRequest.request; try {
        const input = assistantInput({ ...request, prompt: request.prompt?.trim() || '선택한 자료를 바탕으로 초안을 작성해 주세요.', threadId: null, expectedVersion: 0 });
        update({ ...initial, mode: input.mode, intent: input.intent, prompt: request.prompt ?? '', references: input.references, studentContext: input.studentContext, contextId: contextRequest.id });
        setError('');
        setNotice('전달받은 요청을 불러왔습니다. 내용을 확인한 뒤 보내 주세요.');
    }
    catch {
        setError('전달받은 근거의 형식을 확인해 주세요.');
    } }
    function changeMode(mode: AssistantMode) { if (locked || operation.current)
        return; update({ ...initial, mode, intent: mode === 'school' ? 'school_advice' : 'personal_assistant' }); setError(''); setNotice(''); }
    function changeIntent(intent: AssistantIntent) { if (!editable)
        return; update({ ...latest.current, intent, studentContext: intent === 'student_record_draft' ? latest.current.studentContext : null }); }
    async function openKnowledgeCitation(citation: Citation) {
        if (!onOpenKnowledgeCitation || !editable || locked || loading || citationFlight.current) return;
        const epoch = life.current; citationFlight.current = true; setOpeningCitation(true); setError('');
        try { await onOpenKnowledgeCitation(knowledgeCitationRequest(citation, member)); }
        catch { if (epoch === life.current) setError('인용 원문을 열지 못했습니다. 답변과 작성 중인 입력은 그대로 유지했습니다.'); }
        finally { citationFlight.current = false; if (epoch === life.current) setOpeningCitation(false); }
    }
    function openTask(proposal: TaskProposal) {
        if (!onOpenTask || !editable || locked || loading || operation.current) return;
        const current = latest.current.thread?.exchanges.find(row => row.proposal?.id === proposal.id)?.proposal;
        if (current?.status !== 'applied' || !current.resourceId || current.resourceId !== proposal.resourceId) return;
        // 서버가 확인한 원본 번호로만 이동한다. 이동을 위해 제안을 다시 저장하지 않는다.
        try { onOpenTask(current.resourceId); }
        catch { setError('추가한 할 일을 열지 못했습니다. 답변과 작성 중인 입력은 그대로 유지했습니다.'); }
    }
    const draft = session.proposal;
    let taskIssue = '';
    if (draft) {
        if (!draft.input.title.trim()) taskIssue = '할 일 제목을 입력해 주세요.';
        else if (Array.from(draft.input.title).length > TASK_INPUT_LIMITS.titleChars) taskIssue = `할 일 제목은 ${TASK_INPUT_LIMITS.titleChars}자 이내로 줄여 주세요. 원문은 그대로 보관합니다.`;
        else if (Array.from(draft.input.notes).length > TASK_INPUT_LIMITS.notesChars) taskIssue = `할 일 메모는 ${TASK_INPUT_LIMITS.notesChars}자 이내로 줄여 주세요. 원문은 그대로 보관합니다.`;
        else { try { confirmTask({ threadId: session.thread?.id, proposalId: draft.id, expectedVersion: draft.version, input: draft.input }); } catch { taskIssue = '할 일 제목·메모의 문자와 날짜를 확인해 주세요.'; } }
    }
    function reviewTask() {
        if (!draft || !editable || taskIssue) return;
        try {
            const checked = confirmTask({ threadId: session.thread?.id, proposalId: draft.id, expectedVersion: draft.version, input: draft.input });
            update({ ...latest.current, proposal: { ...draft, input: checked.input }, taskReview: true });
            setError('');
        } catch { setError('할 일 제목·메모의 문자와 날짜를 확인해 주세요.'); }
    }
    function addTask() {
        if (!draft || !editable || taskIssue || !session.taskReview) return;
        try {
            const checked = confirmTask({ threadId: session.thread?.id, proposalId: draft.id, expectedVersion: draft.version, input: draft.input });
            void execute({ kind: 'confirmTask', input: checked }, newKey());
        } catch { setError('할 일 제목·메모의 문자와 날짜를 확인해 주세요.'); }
    }
    return <section className="assistant-workspace" aria-labelledby={`${uid}-title`}><style>{styles}</style>
  <header className="assistant-header"><div><h2 id={`${uid}-title`}>Claude 비서</h2><p>학교 자료를 확인하고, 내 업무와 초안을 함께 정리합니다.</p></div><button type="button" disabled={busy || loading || memoryLocked} onClick={() => setRefresh(value => value + 1)}>연결 다시 확인</button></header>
  <details className="assistant-budget-disclosure"><summary>학교 AI 예산 · 기본 {ASSISTANT_ROUTING.models.quick.label}</summary>{schoolStatus ? <SchoolAiBudget status={schoolStatus}/> : <p role="status">{budgetError || '학교 예산을 확인하고 있습니다.'}</p>}<p className="assistant-hint">정밀 검토는 완료된 기본 답변에서 직접 요청합니다. 학생 기록 초안은 처음부터 {ASSISTANT_ROUTING.models.review.label}으로 작성합니다.</p></details>
  <div className="assistant-modes" role="group" aria-label="비서의 자료 범위"><button type="button" aria-pressed={session.mode === 'school'} disabled={locked} onClick={() => changeMode('school')}>학교 업무 안내</button><button type="button" aria-pressed={session.mode === 'personal'} disabled={locked} onClick={() => changeMode('personal')}>내 개인 비서</button></div>
  <p className="assistant-scope">{session.mode === 'school' ? '현재 학교에서 열람 가능한 공통 자료만 사용합니다.' : '내가 볼 수 있는 학교 자료와 내 업무를 사용합니다. 상담 기록은 자동으로 가져오지 않습니다.'}</p>
  {loading && <p role="status">대화 연결을 확인하고 있습니다.</p>}
  {ready && !ready.available && <div role="status" className="assistant-status"><h3>Claude 비서 연결 준비 중</h3><p>{ready.reason === 'budget_exhausted' ? '승인된 이용 한도에 도달했습니다.' : '학교 자료 연결과 승인된 AI 이용 설정이 완료되면 사용할 수 있습니다.'}</p><p>작성한 입력은 이 탭에 유지됩니다.</p></div>}
  {readError && <p role="alert">{readError}</p>}{error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  {contextRequest && contextRequest.id !== session.contextId && <div className="assistant-context"><p>다른 화면에서 전달받은 요청이 있습니다.</p><button type="button" disabled={locked || busy} onClick={applyContext}>전달받은 요청 사용</button>{locked && <p>현재 입력과 미확정 요청을 먼저 마무리해 주세요.</p>}</div>}
  <details className="assistant-history"><summary>이전 대화 {threads.length}개</summary><ul>{threads.map(row => <li key={row.id}><button type="button" disabled={!editable || locked} aria-current={session.thread?.id === row.id ? 'true' : undefined} onClick={() => void loadThread(row.id)}>{row.title}</button></li>)}</ul>{nextCursor && <button type="button" disabled={loading || busy} onClick={() => void moreThreads()}>이전 대화 더 보기</button>}</details>
  <div className="assistant-conversation"><div className="assistant-thread-heading"><h3>{readError ? '대화 연결을 다시 확인해 주세요' : session.thread?.title ?? '새 대화'}</h3><button type="button" disabled={locked || busy} onClick={() => update({ ...latest.current, thread: undefined })}>새 대화</button></div>
   {!readError && session.thread?.nextCursor && <button type="button" disabled={!editable} onClick={() => void moreMessages()}>앞선 답변 더 보기</button>}
   {!readError && session.thread?.exchanges.map(exchange => <article className="assistant-exchange" key={exchange.id}><h4>내 질문</h4><p className="assistant-text">{exchange.prompt}</p><h4>Claude 답변</h4>{exchange.execution && <p className="assistant-execution">{exchange.execution.quality === 'quick' ? ASSISTANT_ROUTING.models.quick.label + ' 기본 답변' : ASSISTANT_ROUTING.models.review.label + (exchange.execution.reviewOf ? ' 정밀 검토' : ' 학생 기록 초안')}</p>}<AnswerView segments={exchange.segments} onOpenKnowledgeCitation={onOpenKnowledgeCitation ? citation => void openKnowledgeCitation(citation) : undefined} disabled={!editable || locked || loading || openingCitation}/>{exchange.execution?.quality === 'quick' && exchange.execution.model === ASSISTANT_ROUTING.models.quick.id && exchange.intent !== 'student_record_draft' && <div className="assistant-review"><button type="button" disabled={!editable || locked} onClick={() => reviewAnswer(exchange)}>이 답변 정밀 검토</button><span className="assistant-hint">{ASSISTANT_ROUTING.models.review.label}으로 새 요청을 보내며 학교 예산에서 비용을 사용합니다.</span></div>}{exchange.proposal && <div className="assistant-proposal"><strong>{exchange.proposal.input.title}</strong><p>{exchange.proposal.status === 'applied' ? '개인 할 일에 추가된 제안입니다.' : '개인 할 일 제안입니다. 확인하기 전에는 저장되지 않습니다.'}</p>{exchange.proposal.status === 'pending' && <button type="button" disabled={!editable || Boolean(session.proposal) || Boolean(session.prompt.trim())} onClick={() => update({ ...latest.current, proposal: structuredClone(exchange.proposal!), taskReview: false })}>할 일 제안 검토</button>}{exchange.proposal.status === 'applied' && exchange.proposal.resourceId && onOpenTask && !recovery.request && <button type="button" disabled={!editable || locked || loading} onClick={() => openTask(exchange.proposal!)}>추가한 할 일 열기</button>}</div>}
   {['document_draft', 'student_record_draft', 'guided_collection'].includes(exchange.intent) && <div className="assistant-actions"><button type="button" onClick={() => { try {
            const blob = new Blob([exchange.segments.map(row => row.text + '\n' + row.citations.map(c => '근거: ' + c.title + ' · ' + c.locator).join('\n')).join('\n\n')], { type: 'text/plain;charset=utf-8' }), url = URL.createObjectURL(blob), anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = '검토용-내용초안.txt';
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 0);
        }
        catch {
            setError('초안 파일을 내려받지 못했습니다.');
        } }}>내용 초안 내려받기</button>{onDraftReady && <button type="button" disabled={!editable || locked} onClick={() => onDraftReady({ intent: exchange.intent, segments: structuredClone(exchange.segments), requestKey: exchange.requestKey, threadId: session.thread!.id, studentContext: exchange.studentContext }, session.requestContexts?.[exchange.requestKey])}>이 초안을 작성 화면으로 보내기</button>}</div>}{onComposeMessage && exchange.intent !== 'student_record_draft' && !exchange.studentContext && <div className="assistant-actions"><button type="button" disabled={!editable || locked} onClick={() => onComposeMessage({ requestId: exchange.requestKey, body: exchange.segments.map(segment => segment.text).join('\n\n') })}>메시지 초안으로 사용</button><span className="assistant-hint">메신저에서 받는 사람과 내용을 확인한 뒤 전송합니다.</span></div>}</article>)}
  </div>
  {draft && <section className="assistant-task-editor" aria-labelledby={`${uid}-task`}>
   <h3 id={`${uid}-task`}>개인 할 일 확인</h3>
   <p id={`${uid}-task-hint`} className="assistant-hint">제목 {TASK_INPUT_LIMITS.titleChars}자 · 메모 {TASK_INPUT_LIMITS.notesChars}자까지 저장합니다. 앞뒤 공백도 글자 수에 포함하며, 내용 확인 때 공백을 정리합니다. 긴 제안은 자동으로 자르지 않습니다.</p>
   <label htmlFor={`${uid}-task-title`}>할 일 제목</label>
   <input id={`${uid}-task-title`} aria-describedby={`${uid}-task-hint ${uid}-title-count`} aria-invalid={!draft.input.title.trim() || Array.from(draft.input.title).length > TASK_INPUT_LIMITS.titleChars} disabled={!editable || session.taskReview} value={draft.input.title} onChange={event => update({ ...latest.current, proposal: { ...draft, input: { ...draft.input, title: event.target.value } } })}/>
   <span id={`${uid}-title-count`} className="assistant-hint">{Array.from(draft.input.title).length} / {TASK_INPUT_LIMITS.titleChars}자</span>
   <label htmlFor={`${uid}-task-notes`}>할 일 메모</label>
   <textarea id={`${uid}-task-notes`} aria-describedby={`${uid}-task-hint ${uid}-notes-count`} aria-invalid={Array.from(draft.input.notes).length > TASK_INPUT_LIMITS.notesChars} disabled={!editable || session.taskReview} value={draft.input.notes} onChange={event => update({ ...latest.current, proposal: { ...draft, input: { ...draft.input, notes: event.target.value } } })}/>
   <span id={`${uid}-notes-count`} className="assistant-hint">{Array.from(draft.input.notes).length} / {TASK_INPUT_LIMITS.notesChars}자</span>
   <label htmlFor={`${uid}-task-date`}>할 일 마감일</label><input type="date" id={`${uid}-task-date`} disabled={!editable || session.taskReview} value={draft.input.dueDate} onChange={event => update({ ...latest.current, proposal: { ...draft, input: { ...draft.input, dueDate: event.target.value } } })}/>
   {taskIssue && <p role="alert">{taskIssue}</p>}
   {session.taskReview ? <><p>위 내용을 개인 할 일에 추가합니다. 다른 교사에게 전송하지 않습니다.</p><button type="button" disabled={!editable || Boolean(taskIssue)} onClick={addTask}>확인한 할 일 추가</button><button type="button" disabled={!editable} onClick={() => update({ ...latest.current, taskReview: false })}>다시 수정</button></> : <button type="button" disabled={!editable || Boolean(taskIssue)} onClick={reviewTask}>추가할 내용 확인</button>}
   <button type="button" disabled={busy || Boolean(recovery.request)} onClick={() => { if (!busy && !recovery.request) update({ ...latest.current, proposal: undefined, taskReview: false }); }}>제안 검토 닫기</button>
  </section>}
  <AiMemoryPanel connection={connection} member={member} date={date} revision={revision} service={memoryServer} blocked={busy || Boolean(recovery.request) || Boolean(draft) || openingCitation} canUse={baseEditable && !draft && ['school_advice','personal_assistant','document_draft'].includes(session.intent)} onLockChange={setMemoryLocked} onUse={items => {
    const current = latest.current;
    if (!baseEditable || current.proposal || operation.current || !['school_advice','personal_assistant','document_draft'].includes(current.intent)) throw new AssistantError('INVALID_INPUT');
    const prompt = composeMemoryPrompt(current.prompt, items);
    update({ ...current, prompt });
    setNotice('선택한 기억을 질문에 넣었습니다. 전송할 내용을 확인해 주세요.');
  }}/>
  <form className="assistant-compose" onSubmit={event => { event.preventDefault(); ask(); }}><label htmlFor={`${uid}-intent`}>요청 종류</label><select id={`${uid}-intent`} disabled={!editable || Boolean(draft)} value={session.intent} onChange={event => changeIntent(event.target.value as AssistantIntent)}>{Object.entries(intentLabels).filter(([key]) => session.mode === 'personal' || key !== 'personal_assistant' && key !== 'student_record_draft').map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
   {(session.references.length > 0 || session.studentContext) && <div className="assistant-context"><p>선택한 근거 {session.references.length + (session.studentContext?.evidence.length ?? 0)}개</p><ul>{session.references.map(ref => <li key={`${ref.kind}:${ref.id}`}>{ref.kind} · {ref.id} · 판 {ref.version}</li>)}{session.studentContext?.evidence.map(ref => <li key={`${ref.kind}:${ref.id}:${ref.start}`}>{ref.kind === 'observation' ? '관찰' : '평가'} · {ref.id} · 개정 {ref.revisionId} · 구간 {ref.start}–{ref.end}</li>)}</ul><button type="button" disabled={!editable} onClick={() => update({ ...latest.current, references: [], studentContext: null })}>선택한 근거 비우기</button></div>}
   {session.intent === 'student_record_draft' && <p className="assistant-hint">등록된 학생 번호·이름과 선택한 수업·평가 근거가 AI에 전달됩니다. 상담 기록은 제외합니다.</p>}
   {session.intent === 'student_record_draft' && !session.studentContext && <p>학생 관리 화면에서 확인한 관찰·평가 근거를 먼저 선택해 주세요.</p>}
   <label htmlFor={`${uid}-prompt`}>질문 또는 부탁할 일</label><textarea id={`${uid}-prompt`} rows={5} aria-describedby={`${uid}-prompt-hint`} aria-invalid={Array.from(session.prompt).length > ASSISTANT_LIMITS.promptChars} placeholder="예: 선택한 학교 규정에서 제출 절차를 알려 주세요." disabled={busy || memoryLocked || Boolean(recovery.request) || Boolean(draft)} value={session.prompt} onChange={event => update({ ...latest.current, prompt: event.target.value })}/><span id={`${uid}-prompt-hint`} className="assistant-hint">{Array.from(session.prompt).length} / {ASSISTANT_LIMITS.promptChars}자 · 상담·건강 정보는 입력하지 마세요.</span>
   {Array.from(session.prompt).length > ASSISTANT_LIMITS.promptChars && <p role="alert">질문은 {ASSISTANT_LIMITS.promptChars}자 이내로 줄여 주세요. 입력은 자동으로 자르지 않습니다.</p>}
   <div className="assistant-actions"><button type="submit" className="assistant-primary" disabled={!editable || Boolean(draft) || Array.from(session.prompt).length > ASSISTANT_LIMITS.promptChars || !session.prompt.trim() || session.intent === 'student_record_draft' && !session.studentContext}>Claude에게 요청</button><button type="button" disabled={busy || memoryLocked || Boolean(recovery.request) || !session.prompt} onClick={() => update({ ...latest.current, prompt: '' })}>질문 비우기</button></div>
  </form>
  {recovery.request && <section className="assistant-pending" aria-label="미확정 요청"><h3>기존 요청 결과 확인</h3><p>요청 번호: <code>{recovery.request.key}</code></p>{pending?.kind === 'confirmTask' && <p>개인 할 일: {pending.input.input.title} · {pending.input.input.dueDate || '마감일 없음'}</p>}<p>입력과 요청 번호를 보관했습니다. 결과가 확정될 때까지 새 요청이나 입력 버리기를 진행하지 않습니다.</p><button type="button" disabled={busy || !pending || !enabled || recovery.request.closeState === 'closing' && !server.close} onClick={() => pending && void execute(pending, recovery.request!.key)}>{recovery.request.closeState === 'closing' ? '같은 번호로 AI 닫기 결과 확인' : '같은 요청으로 결과 확인'}</button>{pending?.kind === 'ask' && server.close && recovery.request.closeState !== 'closing' && <><p>요청 닫기는 AI를 새로 호출하지 않습니다. 이미 완료되었으면 원래 답변을 확인하고, 아직 시작하지 않았으면 늦은 실행도 막습니다. 이미 실행 중이면 결과 확인을 계속합니다.</p><button type="button" disabled={busy || !enabled} onClick={() => void execute(pending, recovery.request!.key, true)}>새 호출 없이 요청 닫기</button></>}{!pending && <p role="alert">기존 요청 형식을 확인할 수 없습니다. 원 요청을 유지한 채 관리자에게 확인해 주세요.</p>}</section>}
 </section>;
}
export function AnswerView({ segments, onOpenKnowledgeCitation, disabled = false }: {
    segments: AnswerSegment[];
    onOpenKnowledgeCitation?: (citation: Citation) => void;
    disabled?: boolean;
}) { return <div className="assistant-answer">{segments.map((segment, index) => <div key={index}><p className="assistant-text">{segment.text}</p>{segment.citations.length > 0 ? <details><summary>근거 {segment.citations.length}개</summary><ul>{segment.citations.map((source, i) => <li key={i}><strong>{source.title}</strong><span>{source.locator}</span><small>{source.reference.kind} · {source.reference.id} · {'version' in source.reference ? '판 ' + source.reference.version : '개정 ' + source.reference.revisionId + ' · 구간 ' + source.reference.start + '–' + source.reference.end}</small>{onOpenKnowledgeCitation && source.reference.kind === 'knowledge' && <button type="button" disabled={disabled} onClick={() => onOpenKnowledgeCitation(source)}>인용 원문 보기</button>}</li>)}</ul></details> : <p className="assistant-hint">연결된 학교 근거가 없는 일반 안내입니다.</p>}</div>)}</div>; }
