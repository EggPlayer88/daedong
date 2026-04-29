// ═══════════════════════════════════════════════════════════════════
//  TimetableAIPanel.jsx
//  시간표 페이지 우측 사이드 챗봇 (모바일은 슬라이드)
// ═══════════════════════════════════════════════════════════════════
//  - 데스크탑: 우측 고정 패널 (토글 가능, 너비 360px)
//  - 모바일: 우측에서 슬라이드 인/아웃, 풀스크린에 가깝게
//  - 시간표 컨텍스트(주차, 사용자, 교사 목록)을 매 요청에 포함
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { TCH } from '../lib/timetableData';
import { fmtDate } from '../lib/timetableEngine';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

// 모바일 감지 (간단 width 기반, 768px 미만이면 모바일)
function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}


export default function TimetableAIPanel({ open, onClose, currentUser, weekDates }) {
  const isMobile = useIsMobile();
  const [messages, setMessages] = useState([
    { role: 'assistant', content: '안녕하세요! 시간표 전용 AI 비서입니다.\n시간표 조회, 변동 요청 안내, 통계 등을 도와드릴 수 있어요.\n\n예시 질문:\n· "박영어 선생님 이번 주 시간표"\n· "이번 학기 변동 통계"\n· "보강 어떻게 신청해?"' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const scrollRef = useRef(null);

  // 새 메시지 시 스크롤 하단으로
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setError(null);

    const userMsg = { role: 'user', content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setBusy(true);

    try {
      // 컨텍스트로 보낼 정보 준비
      const weekStart = weekDates ? fmtDate(weekDates[0]) : null;
      const weekEnd   = weekDates ? fmtDate(weekDates[4]) : null;
      const allTeachers = TCH.map(t => ({
        id: t.id, name: t.name, subject: t.subject, dept: t.dept,
      }));

      const res = await fetch('/api/timetable-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
          currentUser: {
            id: currentUser?.id,
            name: currentUser?.name,
            subject: currentUser?.subject,
            dept: currentUser?.dept,
          },
          weekStart, weekEnd,
          allTeachers,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `서버 오류 (${res.status})`);
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content || '(빈 응답)' }]);

    } catch (e) {
      setError(e.message);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 오류: ${e.message}`,
        isError: true,
      }]);
    } finally {
      setBusy(false);
    }
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // 패널 스타일 (데스크탑 vs 모바일)
  const panelStyle = isMobile ? {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: '100%', maxWidth: 420,
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.3s ease',
    zIndex: 1000,
    background: C.card,
    borderLeft: `1px solid ${C.border}`,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
    display: 'flex', flexDirection: 'column',
  } : {
    position: 'fixed', top: 0, right: 0, bottom: 0,
    width: 360,
    transform: open ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 0.3s ease',
    zIndex: 100,
    background: C.card,
    borderLeft: `1px solid ${C.border}`,
    boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
    display: 'flex', flexDirection: 'column',
  };

  return (
    <>
      {/* 모바일에서만 백드롭 */}
      {isMobile && open && (
        <div onClick={onClose} style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 999,
        }}/>
      )}

      <div style={panelStyle}>
        {/* 헤더 */}
        <div style={{
          padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: C.accentSoft, color: C.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
          }}>AI</div>
          <div style={{ flex: 1, fontFamily: font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>시간표 AI 비서</div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>일반 교사용 · 시간표 도메인 특화</div>
          </div>
          <button onClick={onClose} style={{
            width: 28, height: 28, borderRadius: 6, border: 'none',
            background: 'transparent', color: C.textMid, cursor: 'pointer',
            fontSize: 16, fontFamily: font,
          }}>✕</button>
        </div>

        {/* 메시지 영역 */}
        <div ref={scrollRef} style={{
          flex: 1, overflowY: 'auto', padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 10,
          fontFamily: font,
        }}>
          {messages.map((m, i) => (
            <div key={i} style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '10px 14px',
              borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
              background: m.isError ? '#f8717115' : m.role === 'user' ? C.accent : C.bg,
              color: m.isError ? C.red : m.role === 'user' ? '#fff' : C.text,
              fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
              border: m.isError ? `1px solid ${C.red}40` : 'none',
            }}>
              {m.content}
            </div>
          ))}
          {busy && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
              background: C.bg, color: C.textDim, fontSize: 12, fontStyle: 'italic',
            }}>생각 중...</div>
          )}
        </div>

        {/* 입력창 */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="시간표 관련 질문 입력..."
              rows={1}
              style={{
                flex: 1, padding: '8px 12px', fontSize: 12.5, fontFamily: font,
                background: C.bg, color: C.text,
                border: `1px solid ${C.border}`, borderRadius: 8, resize: 'none',
                lineHeight: 1.5, maxHeight: 100,
              }}
            />
            <button onClick={send} disabled={busy || !input.trim()} style={{
              padding: '8px 14px', fontSize: 12, fontFamily: font, fontWeight: 600,
              background: input.trim() && !busy ? C.accent : C.bg,
              color: input.trim() && !busy ? '#fff' : C.textDim,
              border: `1px solid ${C.border}`, borderRadius: 8,
              cursor: input.trim() && !busy ? 'pointer' : 'not-allowed',
            }}>전송</button>
          </div>
          {error && (
            <div style={{ fontSize: 10, color: C.red, marginTop: 6 }}>{error}</div>
          )}
        </div>
      </div>
    </>
  );
}


// ─── 토글 버튼 (TimetableViewer 에서 import 해서 사용) ───
export function TimetableAIToggleButton({ open, onClick }) {
  if (open) return null;
  return (
    <button onClick={onClick} style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 99,
      width: 56, height: 56, borderRadius: '50%',
      background: '#4f8cff', color: '#fff',
      border: 'none', cursor: 'pointer',
      boxShadow: '0 4px 16px rgba(79, 140, 255, 0.4)',
      fontSize: 14, fontWeight: 700, fontFamily: font,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} title="시간표 AI 비서">
      AI
    </button>
  );
}
