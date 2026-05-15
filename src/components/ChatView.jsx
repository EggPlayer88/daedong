// ═══════════════════════════════════════════════════════════════════
//  ChatView — AI 업무 비서 챗봇 (정리 작업 2-B 에서 App.jsx 에서 분리)
// ═══════════════════════════════════════════════════════════════════
//  두 곳에서 사용:
//    1) 사이드바 메뉴 "🤖 AI 업무 비서" (case "chat") — 큰 화면 단독 페이지
//    2) 대시보드 오른쪽 하단 (DashboardPage 의 AIPanel) — 위젯 임베드
//
//  props:
//    - teacher: 현재 사용자 (id, name, dept, area, subject, role, homeroom)
//    - compact: true 면 위젯 임베드 모드 (헤더/패딩 축소, 예시 질문 노출 X)
//    - onOpenFull: compact 모드에서 "큰 화면 ↗" 클릭 시 호출
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

export default function ChatView({ teacher, compact = false, onOpenFull }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: compact
        ? `${teacher.name} 선생님, 무엇이든 질문해 주세요.`
        : `${teacher.name} 선생님, 안녕하세요! 대동여중 AI 업무 비서입니다. 😊\n\n아래와 같은 도움을 드릴 수 있습니다:\n📋 업무 절차·규정 안내\n📝 문서 작성 (계획서, 보고서, 가정통신문 등)\n🔍 작성한 문서 검토\n📅 일정 안내 및 조언\n✅ 할 일 정리 및 우선순위\n\n무엇이든 질문해 주세요!`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [contextInfo, setContextInfo] = useState(null);
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const examples = [
    '수행평가 업무 절차를 단계별로 알려줘',
    '이번 달 내가 해야 할 일 정리해줘',
    '수행평가 안내 가정통신문 초안 작성해줘',
    '학교폭력 발생 시 처리 절차는?',
    '이번 주 학교 일정 알려줘',
  ];

  const send = async () => {
    if (!input.trim() || loading) return;
    const userText = input.trim();
    setInput('');

    const newMessages = [...messages, { role: 'user', text: userText }];
    setMessages(newMessages);
    setLoading(true);
    setContextInfo(null);

    try {
      const apiMessages = newMessages
        .filter(m => m.role !== 'system')
        .map(m => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.text,
        }));

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          teacher: {
            id: teacher.id,
            name: teacher.name,
            dept: teacher.dept,
            area: teacher.area,
            subject: teacher.subject,
            role: teacher.role,
            homeroom: teacher.homeroom,
          },
          useContext: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || '오류가 발생했습니다');
      }

      const data = await res.json();
      setMessages(m => [...m, { role: 'assistant', text: data.content }]);
      if (data.contextUsed) setContextInfo(data.contextUsed);
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: `⚠️ 오류: ${e.message}\n\nAPI 연결을 확인해주세요.` }]);
    } finally {
      setLoading(false);
    }
  };

  // 위젯 모드는 헤더와 패딩을 작게
  const headerPadding = compact ? '10px 14px 8px' : '16px 24px 12px';
  const bodyPadding   = compact ? '12px 14px'     : '20px 24px';
  const footerPadding = compact ? '8px 14px 12px' : '0 24px 20px';
  const examplesPad   = compact ? '6px 14px'      : '8px 24px';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', fontFamily: font }}>
      {/* 헤더 */}
      <div style={{ padding: headerPadding, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: compact ? 13 : 17, fontWeight: 800, color: C.text }}>🤖 AI 업무 비서</h2>
          {!compact && (
            <p style={{ margin: '3px 0 0', fontSize: 11, color: C.textDim }}>Claude AI · 학교 업무 전문 · 실시간 답변</p>
          )}
        </div>
        {compact && onOpenFull ? (
          <button
            onClick={onOpenFull}
            style={{ padding: '4px 10px', borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, color: C.textMid, fontSize: 11, cursor: 'pointer', fontFamily: font }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}
          >
            큰 화면 ↗
          </button>
        ) : (
          !compact && (
            <span style={{ padding: '3px 10px', borderRadius: 20, background: C.green + '15', color: C.green, fontSize: 11, fontWeight: 600, border: `1px solid ${C.green}25` }}>● 온라인</span>
          )
        )}
      </div>

      {/* 메시지 영역 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: bodyPadding, display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, minHeight: 0 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start', gap: 8, alignItems: 'flex-start' }}>
            {m.role === 'assistant' && (
              <div style={{ width: compact ? 22 : 28, height: compact ? 22 : 28, borderRadius: '50%', background: C.accent + '20', border: `1px solid ${C.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2, fontSize: compact ? 12 : 14 }}>🤖</div>
            )}
            <div style={{ maxWidth: '82%', padding: compact ? '8px 12px' : '12px 16px', borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px', background: m.role === 'user' ? C.accent : C.card, color: C.text, fontSize: compact ? 12 : 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', fontFamily: font, border: m.role === 'user' ? 'none' : `1px solid ${C.border}` }}>
              {m.text.split(/(\*\*.*?\*\*)/).map((p, j) =>
                p.startsWith('**') && p.endsWith('**')
                  ? <strong key={j} style={{ color: m.role === 'user' ? '#dbeafe' : C.accent }}>{p.slice(2, -2)}</strong>
                  : <span key={j}>{p}</span>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: compact ? 22 : 28, height: compact ? 22 : 28, borderRadius: '50%', background: C.accent + '20', border: `1px solid ${C.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: compact ? 12 : 14 }}>🤖</div>
            <div style={{ display: 'flex', gap: 5, padding: '12px 16px', background: C.card, borderRadius: '14px 14px 14px 4px', border: `1px solid ${C.border}` }}>
              {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: C.accent, animation: `chatBounce .6s ${i * .2}s infinite alternate` }} />)}
            </div>
          </div>
        )}
        {contextInfo && (contextInfo.documents > 0 || contextInfo.schedules > 0 || contextInfo.tasks > 0) && (
          <div style={{ display: 'flex', gap: 6, padding: '4px 0', marginTop: -8, flexWrap: 'wrap' }}>
            {contextInfo.tasks > 0 && <span style={{ fontSize: 10, color: C.yellow, background: C.yellow + '12', padding: '2px 8px', borderRadius: 10 }}>📋 업무 {contextInfo.tasks}건 참고</span>}
            {contextInfo.documents > 0 && <span style={{ fontSize: 10, color: C.green, background: C.green + '12', padding: '2px 8px', borderRadius: 10 }}>📄 문서 {contextInfo.documents}건 참고</span>}
            {contextInfo.schedules > 0 && <span style={{ fontSize: 10, color: C.accent, background: C.accentSoft, padding: '2px 8px', borderRadius: 10 }}>📅 일정 {contextInfo.schedules}건 참고</span>}
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* 예시 질문 (큰 화면 모드에서만) */}
      {!compact && (
        <div style={{ padding: examplesPad, flexShrink: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
            {examples.map((ex, i) => (
              <button
                key={i}
                onClick={() => setInput(ex)}
                style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${C.border}`, background: C.card, color: C.textMid, fontSize: 11, cursor: 'pointer', fontFamily: font, transition: 'all .15s' }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.color = C.text; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMid; }}
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 입력창 */}
      <div style={{ padding: footerPadding, display: 'flex', gap: 8, flexShrink: 0 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={compact ? '질문을 입력하세요...' : '업무, 규정, 문서 작성 등 무엇이든 질문하세요...'}
          disabled={loading}
          style={{ flex: 1, padding: compact ? '8px 12px' : '12px 16px', borderRadius: compact ? 8 : 12, border: `1px solid ${C.border}`, background: C.card, color: C.text, fontSize: compact ? 12 : 13, outline: 'none', fontFamily: font, minWidth: 0 }}
          onFocus={e => e.target.style.borderColor = C.accent}
          onBlur={e => e.target.style.borderColor = C.border}
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          style={{ padding: compact ? '8px 14px' : '12px 22px', borderRadius: compact ? 8 : 12, border: 'none', background: loading || !input.trim() ? C.textDim : C.accent, color: '#fff', fontSize: compact ? 12 : 13, fontWeight: 700, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', fontFamily: font }}
        >
          전송
        </button>
      </div>
      <style>{`@keyframes chatBounce{to{transform:translateY(-6px);opacity:.3}}`}</style>
    </div>
  );
}
