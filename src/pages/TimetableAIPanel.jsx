// ═══════════════════════════════════════════════════════════════════
//  TimetableAIPanel.jsx — 시간표 AI 사이드 챗봇
//  Phase 2B: 일반 교사 AI 비서
//  Phase 3B: 관리자 모드 추가 (admin-chat 엔드포인트, 변경 제안 카드)
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef } from 'react';
import { TCH, SBJ, CLS, gT, gC, gS } from '../lib/timetableData';
import { fmtDate, fmtDateShort } from '../lib/timetableEngine';
import { createChangeRequest } from '../lib/changesAPI';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', red:'#f87171', purple:'#a78bfa', purpleSoft:'#a78bfa18',
  yellow:'#fbbf24',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

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


export default function TimetableAIPanel({ open, onClose, currentUser, weekDates, isAdminMode = false, onProposalApplied }) {
  const isMobile = useIsMobile();

  // 모드별 초기 환영 메시지
  const initialMessage = isAdminMode
    ? '안녕하세요. 관리자 AI 비서입니다.\n시간표 검증, 통계 분석, 변동 제안 등을 도와드릴 수 있어요.\n\n예시:\n· "현재 시간표 검증해줘"\n· "이번 학기 보강 부담 분석"\n· "수요일 3교시 빈 교사 찾아줘"\n· "박영어T 화요일 4교시를 자습으로 처리해줘"'
    : '안녕하세요! 시간표 전용 AI 비서입니다.\n시간표 조회, 변동 요청 안내, 통계 등을 도와드릴 수 있어요.\n\n예시 질문:\n· "박영어 선생님 이번 주 시간표"\n· "이번 학기 변동 통계"\n· "보강 어떻게 신청해?"';

  const [messages, setMessages] = useState([{ role: 'assistant', content: initialMessage }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [proposals, setProposals] = useState([]); // 활성 변경 제안들
  const scrollRef = useRef(null);

  // 모드 전환 시 메시지 초기화
  useEffect(() => {
    setMessages([{ role: 'assistant', content: initialMessage }]);
    setProposals([]);
  }, [isAdminMode]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, proposals]);

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
      const weekStart = weekDates ? fmtDate(weekDates[0]) : null;
      const weekEnd   = weekDates ? fmtDate(weekDates[4]) : null;
      const allTeachers = TCH.map(t => ({ id: t.id, name: t.name, subject: t.subject, dept: t.dept, as: t.as }));

      // 모드에 따라 다른 엔드포인트
      const endpoint = isAdminMode ? '/api/admin-chat' : '/api/timetable-chat';
      const body = isAdminMode
        ? {
            messages: newMessages.map(m => ({ role: m.role, content: m.content })),
            currentUser: { id: currentUser?.id, name: currentUser?.name },
            weekStart, weekEnd,
            allTeachers,
            allSubjects: SBJ,
            allClasses: CLS,
          }
        : {
            messages: newMessages.map(m => ({ role: m.role, content: m.content })),
            currentUser: {
              id: currentUser?.id, name: currentUser?.name,
              subject: currentUser?.subject, dept: currentUser?.dept,
            },
            weekStart, weekEnd,
            allTeachers,
          };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `서버 오류 (${res.status})`);
      }

      const data = await res.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.content || '(빈 응답)' }]);

      // 관리자 모드에서 propose_change 결과가 있으면 UI 카드로
      if (isAdminMode && data.proposals && data.proposals.length > 0) {
        setProposals(prev => [
          ...prev,
          ...data.proposals.map((p, i) => ({ ...p, _id: Date.now() + i, _applied: false })),
        ]);
      }

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

  // 제안 적용
  const applyProposal = async (proposal) => {
    if (!isAdminMode) return;
    if (!window.confirm('이 제안을 직권 변경으로 적용할까요?\n\n적용 즉시 시간표에 반영되고, 영향받는 교사들에게 사후 통보 알림이 발송됩니다.')) return;

    try {
      // proposal 의 partner_ids 추출 (사후 통보 대상)
      const partnerIds = [];
      if (proposal.type === 'swap' && proposal.payload?.partners) {
        proposal.payload.partners.forEach(p => {
          if (p.teacher_id && p.teacher_id !== proposal.source_teacher_id) {
            partnerIds.push(p.teacher_id);
          }
        });
      } else if (proposal.type === 'substitute' && proposal.payload?.substitute_teacher_id) {
        partnerIds.push(proposal.payload.substitute_teacher_id);
      } else if (proposal.type === 'self_study' && proposal.payload?.supervisor_teacher_id) {
        partnerIds.push(proposal.payload.supervisor_teacher_id);
      }

      await createChangeRequest({
        type: proposal.type,
        sourceDate: proposal.source_date,
        sourceClassId: proposal.source_class_id,
        sourceDay: proposal.source_day,
        sourcePeriod: proposal.source_period,
        sourceTeacherId: proposal.source_teacher_id,
        sourceSubjectId: proposal.source_subject_id || '',
        payload: proposal.payload || {},
        reason: proposal.reason,
        requesterId: currentUser.id,
        partnerIds,
        isAdminDirect: true,
      });

      // 제안 카드를 적용 완료 상태로
      setProposals(prev => prev.map(p =>
        p._id === proposal._id ? { ...p, _applied: true } : p
      ));

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '✓ 직권 변경이 적용되었습니다. 시간표에 즉시 반영되고, 관련 교사에게 통보 알림이 발송되었습니다.',
      }]);

      onProposalApplied?.();
    } catch (e) {
      alert(`적용 실패: ${e.message}`);
    }
  };

  const dismissProposal = (proposalId) => {
    setProposals(prev => prev.filter(p => p._id !== proposalId));
  };

  // 패널 색상 — 관리자 모드일 때 보라색 강조
  const accentColor = isAdminMode ? C.purple : C.accent;
  const accentSoft = isAdminMode ? C.purpleSoft : C.accentSoft;

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
    width: 380,
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
          background: isAdminMode ? `linear-gradient(90deg, ${C.purple}15 0%, transparent 100%)` : 'transparent',
        }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: accentSoft, color: accentColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700,
          }}>{isAdminMode ? '⚙️' : 'AI'}</div>
          <div style={{ flex: 1, fontFamily: font }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: isAdminMode ? C.purple : C.text }}>
              {isAdminMode ? '관리자 AI 비서' : '시간표 AI 비서'}
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 1 }}>
              {isAdminMode ? '시간표 검증·통계·변동 제안' : '일반 교사용 · 시간표 도메인'}
            </div>
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
              background: m.isError ? '#f8717115' : m.role === 'user' ? accentColor : C.bg,
              color: m.isError ? C.red : m.role === 'user' ? '#fff' : C.text,
              fontSize: 12.5, lineHeight: 1.55, whiteSpace: 'pre-wrap',
              border: m.isError ? `1px solid ${C.red}40` : 'none',
            }}>{m.content}</div>
          ))}

          {/* 활성 제안 카드들 (관리자 모드 전용) */}
          {isAdminMode && proposals.length > 0 && (
            <div style={{
              marginTop: 4, padding: '10px 12px',
              background: C.purpleSoft, borderRadius: 10,
              border: `1px solid ${C.purple}40`,
            }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.purple, marginBottom: 8 }}>
                💡 제안된 변동 ({proposals.filter(p => !p._applied).length}건 대기)
              </div>
              {proposals.map(p => (
                <ProposalCard key={p._id} proposal={p}
                  onApply={() => applyProposal(p)}
                  onDismiss={() => dismissProposal(p._id)}
                />
              ))}
            </div>
          )}

          {busy && (
            <div style={{
              alignSelf: 'flex-start',
              padding: '10px 14px', borderRadius: '14px 14px 14px 4px',
              background: C.bg, color: C.textDim, fontSize: 12, fontStyle: 'italic',
            }}>{isAdminMode ? '도구 실행 중...' : '생각 중...'}</div>
          )}
        </div>

        {/* 입력창 */}
        <div style={{ padding: '12px 14px', borderTop: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              placeholder={isAdminMode ? '검증/통계/제안 등 관리자 작업 입력...' : '시간표 관련 질문 입력...'}
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
              background: input.trim() && !busy ? accentColor : C.bg,
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


// ─── 제안 카드 ───
function ProposalCard({ proposal, onApply, onDismiss }) {
  const typeLabel = {
    swap: '교환수업', substitute: '보강',
    self_study: '결강/자습', period_move: '시수변경',
  }[proposal.type] || proposal.type;

  const sourceLabel = `${gC(proposal.source_class_id)?.name || proposal.source_class_id} ${proposal.source_day}${proposal.source_period}교시`;
  const sourceTeacher = gT(proposal.source_teacher_id)?.name || proposal.source_teacher_id;

  let detail = '';
  if (proposal.type === 'substitute') {
    const sub = gT(proposal.payload?.substitute_teacher_id)?.name;
    detail = `→ 보강: ${sub || '미지정'}`;
  } else if (proposal.type === 'self_study') {
    const sup = gT(proposal.payload?.supervisor_teacher_id)?.name;
    detail = sup ? `→ 자습 (감독: ${sup})` : '→ 결강 (감독 없음)';
  } else if (proposal.type === 'period_move') {
    const t = proposal.payload;
    detail = `→ ${gC(t?.target_class_id)?.name || t?.target_class_id} ${t?.target_day}${t?.target_period}교시`;
  } else if (proposal.type === 'swap') {
    const partners = proposal.payload?.partners || [];
    detail = '↔ ' + partners.map(p => `${gC(p.class_id)?.name} ${p.day}${p.period}`).join(' ↔ ');
  }

  return (
    <div style={{
      background: proposal._applied ? C.bg : C.card,
      border: `1px solid ${proposal._applied ? C.green + '40' : C.purple + '60'}`,
      borderRadius: 8, padding: '10px 12px', marginBottom: 6,
      opacity: proposal._applied ? 0.6 : 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{
          fontSize: 9, padding: '2px 6px', borderRadius: 4, fontWeight: 700,
          background: proposal._applied ? C.green + '30' : C.purple + '30',
          color: proposal._applied ? C.green : C.purple,
        }}>{proposal._applied ? '✓ 적용됨' : typeLabel}</span>
        <span style={{ fontSize: 10, color: C.textDim }}>{proposal.source_date}</span>
      </div>
      <div style={{ fontSize: 12, color: C.text, marginBottom: 3 }}>
        <strong>{sourceLabel}</strong> ({sourceTeacher}) {detail}
      </div>
      {proposal.reason && (
        <div style={{ fontSize: 10, color: C.textMid, marginBottom: 6 }}>사유: {proposal.reason}</div>
      )}
      {!proposal._applied && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onApply} style={{
            flex: 1, padding: '6px 10px', fontSize: 11, fontFamily: font, fontWeight: 600,
            background: C.purple, color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer',
          }}>직권 변경 적용</button>
          <button onClick={onDismiss} style={{
            padding: '6px 10px', fontSize: 11, fontFamily: font,
            background: 'transparent', color: C.textMid,
            border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
          }}>닫기</button>
        </div>
      )}
    </div>
  );
}


// ─── 토글 버튼 ───
export function TimetableAIToggleButton({ open, onClick, isAdminMode = false }) {
  if (open) return null;
  const color = isAdminMode ? C.purple : C.accent;
  return (
    <button onClick={onClick} style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 99,
      width: 56, height: 56, borderRadius: '50%',
      background: color, color: '#fff',
      border: 'none', cursor: 'pointer',
      boxShadow: `0 4px 16px ${color}66`,
      fontSize: 14, fontWeight: 700, fontFamily: font,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} title={isAdminMode ? '관리자 AI 비서' : '시간표 AI 비서'}>
      {isAdminMode ? '⚙️' : 'AI'}
    </button>
  );
}
