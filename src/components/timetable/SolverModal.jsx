// ═══════════════════════════════════════════════════════════════════
//  SolverModal — 2-스텝 시간표 생성 Wizard (정리 2-C)
// ═══════════════════════════════════════════════════════════════════
//  Step 1: 초기설정 확인 (InitSettingsView read-only) — "이 데이터로 만든다" 확인
//  Step 2: 솔버 실행 + 결과 미리보기 + 드래프트 저장
//
//  사용 위치: TimetablesListPage 의 "+ 새 드래프트 만들기" 버튼.
//  저장 성공 시 onSavedDraft(savedRow) 콜백 → 목록 새로고침 → 모달 닫기.
//
//  솔버 결과는 모달 닫을 때까지 보존 (Step 1 ↔ Step 2 이동해도 유지).
//  결과 있는 상태에서 외부 클릭/ESC 시 confirm.
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  DAYS, SBJ, CLS, TCH, CLR, gS, gT, gC, isV, getSP,
} from '../../lib/timetableData';
import {
  buildLessons, cpSolve, buildTTfromCP, calcTotalPenalty, localSearch,
} from '../../lib/solver';
import { saveTimetable } from '../../lib/timetablesAPI';
import { exportTimetableToExcel, defaultExportFilename } from '../../lib/timetableExport';
import InitSettingsView from './InitSettingsView';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

function Badge({ label, color, small }) {
  return (
    <span style={{
      display: 'inline-block', padding: small ? '1px 7px' : '3px 10px',
      borderRadius: 6, fontSize: small ? 10 : 11, fontWeight: 600,
      background: color + '15', color, border: `1px solid ${color}25`,
      fontFamily: font,
    }}>{label}</span>
  );
}

export default function SolverModal({ open, onClose, onSavedDraft }) {
  const [step, setStep] = useState(1);
  const [result, setResult] = useState(null);  // { tt, placed, penalty, ... }

  // 모달 열릴 때 상태 초기화
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setResult(null);
  }, [open]);

  // 진짜 닫기 (결과 있으면 확인)
  const handleClose = useCallback(() => {
    if (result) {
      if (!window.confirm('생성된 시간표가 있습니다. 저장하지 않고 닫으시겠습니까?')) return;
    }
    onClose?.();
  }, [result, onClose]);

  // ESC 키
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') handleClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, handleClose]);

  if (!open) return null;

  return (
    <div
      onClick={handleClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        fontFamily: font,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: C.bg, border: `1px solid ${C.border}`, borderRadius: 14,
          width: '92vw', maxWidth: 1100, height: '88vh',
          display: 'flex', flexDirection: 'column', color: C.text,
          boxShadow: '0 20px 60px rgba(0,0,0,.5)',
        }}
      >
        {/* 헤더 (스텝 표시 + 닫기) */}
        <div style={{
          padding: '14px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>✨ 새 드래프트 만들기</div>
            <StepIndicator step={step}/>
          </div>
          <button onClick={handleClose} style={{
            background: 'transparent', border: 'none', color: C.textDim,
            fontSize: 22, cursor: 'pointer', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* 본문 */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
          {step === 1 && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>
                Step 1/2 — 초기설정 확인
              </div>
              <InitSettingsView/>
            </div>
          )}
          {step === 2 && (
            <SolverStep2
              result={result}
              onResult={setResult}
              onSavedDraft={(saved) => { onSavedDraft?.(saved); onClose?.(); }}
            />
          )}
        </div>

        {/* 푸터 (네비) */}
        <div style={{
          padding: '12px 20px', borderTop: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            {step === 2 && (
              <button onClick={() => setStep(1)} style={{
                padding: '8px 16px', borderRadius: 8, border: `1px solid ${C.border}`,
                background: 'transparent', color: C.textMid, fontSize: 12, cursor: 'pointer',
                fontFamily: font,
              }}>← 이전</button>
            )}
          </div>
          <div>
            {step === 1 && (
              <button onClick={() => setStep(2)} style={{
                padding: '9px 20px', borderRadius: 8, border: 'none',
                background: C.accent, color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: 'pointer', fontFamily: font,
              }}>다음: 시간표 생성 →</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 스텝 표시 ───
function StepIndicator({ step }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
      <span style={{
        padding: '3px 10px', borderRadius: 10,
        background: step === 1 ? C.accent : C.border,
        color: step === 1 ? '#fff' : C.textMid,
        fontWeight: 700,
      }}>1</span>
      <span style={{ color: step === 1 ? C.text : C.textDim, fontWeight: step === 1 ? 600 : 400 }}>초기설정</span>
      <span style={{ color: C.textDim }}>→</span>
      <span style={{
        padding: '3px 10px', borderRadius: 10,
        background: step === 2 ? C.accent : C.border,
        color: step === 2 ? '#fff' : C.textMid,
        fontWeight: 700,
      }}>2</span>
      <span style={{ color: step === 2 ? C.text : C.textDim, fontWeight: step === 2 ? 600 : 400 }}>시간표 생성</span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
//  Step 2 — 솔버 실행 + 결과 + 저장
// ═══════════════════════════════════════════════════════════════════
function SolverStep2({ result, onResult, onSavedDraft }) {
  const [phase, setPhase] = useState(result ? 'done' : 'idle');  // idle | running | done
  const [attempt, setAttempt] = useState(0);
  const [logs, setLogs] = useState([]);
  const cancelRef = useRef(false);

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev.slice(-30), msg]);
  }, []);

  const startGenerate = async () => {
    setPhase('running');
    setLogs([]);
    setAttempt(0);
    cancelRef.current = false;

    const lessons = buildLessons();
    addLog(`수업 카드 ${lessons.length}장 생성`);
    addLog('CP-SAT 백트래킹 시작...');
    await new Promise(r => setTimeout(r, 30));

    let found = false;
    for (let a = 1; a <= 50 && !found && !cancelRef.current; a++) {
      setAttempt(a);
      await new Promise(r => setTimeout(r, 0));
      const res = cpSolve(lessons, 120000);
      if (res.success) {
        const penBefore = calcTotalPenalty(lessons, res.asgn);
        addLog(`✅ ${a}번째 시도 성공! (${res.nodes.toLocaleString()} 노드) | 초기 페널티 ${penBefore}`);
        addLog('🔧 로컬 서치 최적화 중...');
        await new Promise(r => setTimeout(r, 0));
        const ls = localSearch(lessons, res.asgn, 4000);
        const penFinal = calcTotalPenalty(lessons, res.asgn);
        addLog(`완료 — 페널티 ${penBefore} → ${penFinal} (${ls.improved}회 개선)`);
        const tt = buildTTfromCP(lessons, res.asgn);
        onResult({
          tt, placed: 279, penalty: penFinal, penaltyBefore: penBefore,
          lsImproved: ls.improved, attempts: a,
        });
        found = true;
      } else {
        if (a % 5 === 0) addLog(`시도 ${a}: 최대 ${res.maxD}/279`);
      }
    }
    if (!found && !cancelRef.current) addLog('⚠️ 50회 내 완전 배정 실패. 재시도해주세요.');
    setPhase('done');
  };

  const penColor = result
    ? (result.penalty === 0 ? C.green : result.penalty < 30 ? C.yellow : C.red)
    : C.textDim;

  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 12 }}>
        Step 2/2 — 시간표 생성
      </div>

      {/* 솔버 실행 헤더 */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 10, marginBottom: 14,
        padding: '12px 14px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>CP-SAT 백트래킹 알고리즘</div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>9학급 · 24교사 · 279수업 · 최대 50회 재시작</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {result && <Badge label={`페널티 ${result.penalty}`} color={penColor}/>}
          {result && <Badge label="✅ 279/279" color={C.green}/>}
          <button
            onClick={startGenerate}
            disabled={phase === 'running'}
            style={{
              padding: '9px 18px', borderRadius: 8, border: 'none',
              fontFamily: font, fontSize: 13, fontWeight: 700,
              background: phase === 'running' ? C.textDim : C.accent, color: '#fff',
              cursor: phase === 'running' ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'running'
              ? '⏳ 생성 중...'
              : (result ? '🔁 다시 생성' : '✨ 시간표 생성')}
          </button>
        </div>
      </div>

      {/* 실행 로그 */}
      {(phase === 'running' || (phase === 'done' && logs.length > 0)) && (
        <div style={{
          padding: 12, marginBottom: 14, background: '#080b14',
          border: `1px solid ${C.border}`, borderRadius: 10,
        }}>
          {phase === 'running' && (
            <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 800, color: C.accent }}>{attempt}</div>
                <div style={{ fontSize: 10, color: C.textDim }}>시도 횟수</div>
              </div>
            </div>
          )}
          <div style={{
            background: C.bg, borderRadius: 6, padding: '8px 12px',
            fontFamily: 'monospace', fontSize: 11, color: '#00e676',
            maxHeight: 110, overflowY: 'auto', lineHeight: 1.7,
          }}>
            {logs.map((l, i) => <div key={i}>&gt; {l}</div>)}
          </div>
        </div>
      )}

      {/* 결과: 통계 + 미리보기 + 저장 */}
      {result && (
        <>
          <ResultSummary result={result} penColor={penColor}/>
          <ResultPreview result={result}/>
          <ResultStats result={result}/>
          <SaveDraftPanel result={result} onSavedDraft={onSavedDraft}/>
        </>
      )}

      {/* 솔버 안 돌렸을 때 안내 */}
      {!result && phase === 'idle' && (
        <div style={{
          padding: 20, textAlign: 'center', color: C.textDim,
          background: C.card, border: `1px dashed ${C.border}`, borderRadius: 10,
          fontSize: 13, lineHeight: 1.8,
        }}>
          위의 <strong style={{ color: C.accent }}>✨ 시간표 생성</strong> 버튼을 눌러 솔버를 실행하세요.<br/>
          학교 설정(Step 1) 기준으로 충돌 없는 시간표를 자동으로 만듭니다.
        </div>
      )}
    </div>
  );
}

// ─── 결과 요약 카드 ───
function ResultSummary({ result, penColor }) {
  return (
    <div style={{
      padding: 14, marginBottom: 14, background: C.card,
      border: `1px solid ${C.green}30`, borderRadius: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.green, marginBottom: 10 }}>
        ✅ 시간표 생성 완료
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {[
          { label: '배정 완료',    value: '279/279',                color: C.green },
          { label: '소프트 페널티', value: result.penalty,           color: penColor },
          { label: '로컬서치 개선', value: `${result.lsImproved}회`, color: C.accent },
          { label: '시도 횟수',    value: `${result.attempts}회`,   color: C.textMid },
        ].map((s, i) => (
          <div key={i} style={{
            textAlign: 'center', padding: 10, background: C.bg, borderRadius: 8,
          }}>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 결과 미리보기 (학급/교사 토글 + 간단 그리드) ───
function ResultPreview({ result }) {
  const [mode, setMode] = useState('class');
  const [entityId, setEntityId] = useState('c1');

  return (
    <div style={{
      padding: 14, marginBottom: 14, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>📅 결과 미리보기</div>
        <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
          <SegBtn active={mode==='class'} onClick={()=>{ setMode('class'); setEntityId('c1'); }}>학급별</SegBtn>
          <SegBtn active={mode==='teacher'} onClick={()=>{ setMode('teacher'); setEntityId('t1'); }}>교사별</SegBtn>
        </div>
        <button
          onClick={() => {
            try { exportTimetableToExcel(result.tt, defaultExportFilename()); }
            catch (e) { alert('엑셀 다운로드 실패: ' + (e.message || e)); }
          }}
          style={{
            marginLeft: 'auto', padding: '6px 14px', borderRadius: 6, border: 'none',
            background: C.green, color: '#04140d', fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: font,
          }}
        >📥 엑셀 다운로드</button>
        <select value={entityId} onChange={e => setEntityId(e.target.value)} style={{
          padding: '5px 10px', borderRadius: 6, border: `1px solid ${C.border}`,
          background: C.bg, color: C.text, fontSize: 12, fontFamily: font, outline: 'none',
        }}>
          {mode === 'class'
            ? CLS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)
            : TCH.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
          }
        </select>
      </div>
      <TTGrid tt={result.tt} mode={mode} entityId={entityId}/>
    </div>
  );
}

function SegBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', border: 'none',
      background: active ? C.accent : 'transparent',
      color: active ? '#fff' : C.textMid,
      fontSize: 11, fontWeight: active ? 700 : 500,
      cursor: 'pointer', fontFamily: font,
    }}>{children}</button>
  );
}

function TTGrid({ tt, mode, entityId }) {
  if (!tt) return null;
  const rows = [];
  for (let p = 1; p <= 7; p++) {
    const cells = DAYS.map(d => {
      if (!isV(d, p)) {
        return <td key={d} style={{ background: '#080b14', opacity: .25, border: `1px solid ${C.border}`, height: 42, minWidth: 64 }}/>;
      }
      const sl = `${d}-${p}`;
      const sp = getSP(d, p);
      let entry = null;
      let eid = entityId;
      if (mode === 'class') {
        entry = tt[entityId]?.[sl];
      } else {
        CLS.forEach(c => {
          const x = tt[c.id]?.[sl];
          if (x && x.tid === entityId) { entry = x; eid = c.id; }
        });
      }
      if (sp && entry?.type === 'special') {
        const lbl = mode === 'class' ? gT(entry.tid)?.name : gC(eid)?.name;
        return (
          <td key={d} style={{ border: `1px solid ${C.border}`, background: '#1a1530', textAlign: 'center', height: 42, minWidth: 64 }}>
            <div style={{ fontSize: 9, color: '#a78bfa', fontWeight: 700 }}>창체</div>
            <div style={{ fontSize: 8, color: '#7c6fcc' }}>{lbl}</div>
          </td>
        );
      }
      if (sp && !entry) {
        return (
          <td key={d} style={{ border: `1px solid ${C.border}`, background: '#1a1530', textAlign: 'center', height: 42, minWidth: 64, opacity: .4 }}>
            <div style={{ fontSize: 8, color: '#7c6fcc' }}>창체</div>
          </td>
        );
      }
      if (entry && !entry.type) {
        const s = gS(entry.sid);
        const clr = CLR[s?.ci || 0];
        const lbl = mode === 'class' ? gT(entry.tid)?.name : gC(eid)?.name;
        return (
          <td key={d} style={{
            border: `1px solid ${C.border}`, height: 42, minWidth: 64,
            background: clr.bg + '22', borderLeft: `3px solid ${clr.bg}`,
          }}>
            <div style={{ textAlign: 'center', padding: '2px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: clr.bg }}>{s?.name}</div>
              <div style={{ fontSize: 9, color: clr.bg, opacity: .8 }}>{lbl}</div>
            </div>
          </td>
        );
      }
      return (
        <td key={d} style={{ border: `1px solid ${C.border}`, height: 42, minWidth: 64, background: '#1a0000', textAlign: 'center' }}>
          <span style={{ fontSize: 8, color: C.red }}>빈칸</span>
        </td>
      );
    });
    if (p === 5) {
      rows.push(<tr key="div"><td colSpan={6} style={{ height: 2, background: C.border, padding: 0 }}/></tr>);
    }
    rows.push(
      <tr key={p}>
        <td style={{ padding: '3px 7px', background: '#0d1020', border: `1px solid ${C.border}`, textAlign: 'center', minWidth: 46, whiteSpace: 'nowrap' }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: C.textMid }}>{p}교시</div>
        </td>
        {cells}
      </tr>
    );
  }
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontFamily: font }}>
        <thead>
          <tr>
            <th style={{ padding: '6px', background: '#0d1020', border: `1px solid ${C.border}`, color: C.textMid, fontSize: 10 }}/>
            {DAYS.map(d => (
              <th key={d} style={{ padding: '6px', background: '#0d1020', border: `1px solid ${C.border}`, color: C.text, fontSize: 11, fontWeight: 700 }}>{d}</th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// ─── 결과 통계 (교사별/학급별) ───
function ResultStats({ result }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      marginBottom: 14, background: C.card,
      border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden',
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', padding: '12px 14px', textAlign: 'left',
          background: 'transparent', border: 'none', color: C.text,
          fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: font,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}
      >
        📊 상세 통계 (교사별·학급별 시수 검증)
        <span style={{ color: C.textDim }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ padding: 14, borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>교사별 배치 현황</div>
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 10, fontFamily: font }}>
              <thead>
                <tr style={{ background: '#0d1020' }}>
                  <th style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>교사</th>
                  <th style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid }}>목표</th>
                  {DAYS.map(d => <th key={d} style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid }}>{d}</th>)}
                  <th style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {TCH.map(t => {
                  const target = t.as.reduce((s, a) => s + a.h, 0);
                  const dayCnt = DAYS.map(d => {
                    let cnt = 0;
                    CLS.forEach(c => {
                      Object.entries(result.tt[c.id] || {}).forEach(([sl, e]) => {
                        if (e && !e.type && e.tid === t.id && sl.startsWith(d + '-')) cnt++;
                      });
                    });
                    return cnt;
                  });
                  const total = dayCnt.reduce((s, v) => s + v, 0);
                  return (
                    <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '5px 8px', color: C.text, fontWeight: 600 }}>{t.name}</td>
                      <td style={{ padding: 5, textAlign: 'center', color: C.textDim }}>{target}</td>
                      {dayCnt.map((cnt, i) => (
                        <td key={i} style={{ padding: 5, textAlign: 'center', color: cnt > 0 ? C.text : C.textDim }}>{cnt || '-'}</td>
                      ))}
                      <td style={{ padding: 5, textAlign: 'center', fontWeight: 700, color: total === target ? C.green : C.red }}>{total}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: C.textMid, marginBottom: 8 }}>학급별 과목 시수</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 10, fontFamily: font }}>
              <thead>
                <tr style={{ background: '#0d1020' }}>
                  <th style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>과목</th>
                  {CLS.map(c => <th key={c.id} style={{ padding: 6, border: `1px solid ${C.border}`, color: C.textMid }}>{c.name}</th>)}
                </tr>
              </thead>
              <tbody>
                {SBJ.filter(s => Object.values(s.gh).some(v => v > 0)).map(s => {
                  const clr = CLR[s.ci];
                  return (
                    <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                      <td style={{ padding: '5px 8px' }}>
                        <span style={{ background: clr.bg + '22', color: clr.bg, padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600 }}>{s.name}</span>
                      </td>
                      {CLS.map(c => {
                        let cnt = 0;
                        Object.values(result.tt[c.id] || {}).forEach(e => {
                          if (e && !e.type && e.sid === s.id) cnt++;
                        });
                        const exp = s.gh[c.g] || 0;
                        if (!exp && !cnt) return <td key={c.id} style={{ padding: 5, textAlign: 'center', color: C.textDim, border: `1px solid ${C.border}` }}>-</td>;
                        return (
                          <td key={c.id} style={{ padding: 5, textAlign: 'center', fontWeight: cnt === exp ? 400 : 700, color: cnt === exp ? C.green : C.red, border: `1px solid ${C.border}` }}>{cnt}</td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 드래프트 저장 패널 ───
function SaveDraftPanel({ result, onSavedDraft }) {
  const defaultName = `${new Date().getFullYear()}학년도 시간표 (${new Date().toLocaleDateString('ko-KR')})`;
  const today = new Date().toISOString().slice(0, 10);

  const [name, setName] = useState(defaultName);
  const [effectiveFrom, setEffectiveFrom] = useState(today);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const canSave = !!name.trim() && !!effectiveFrom && !submitting;

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      const saved = await saveTimetable(result.tt, {
        name: name.trim(),
        effective_from: effectiveFrom,
        asActive: false,  // 항상 드래프트로 저장. 활성화는 목록 페이지에서.
      });
      onSavedDraft?.(saved);
    } catch (e) {
      setError(e.message || '저장 실패');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      padding: 14, background: C.card,
      border: `1px solid ${C.accent}40`, borderRadius: 10,
    }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
        📥 드래프트로 저장
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 12, lineHeight: 1.6 }}>
        드래프트 상태로 저장됩니다. 검토 후 시간표 관리 페이지에서 "활성화" 버튼으로 적용하세요.
      </div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 2, minWidth: 220 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>이름</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              fontSize: 12, background: C.bg, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: font, outline: 'none',
            }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <div style={{ fontSize: 10, color: C.textDim, marginBottom: 4 }}>발효일</div>
          <input
            type="date"
            value={effectiveFrom}
            onChange={e => setEffectiveFrom(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              fontSize: 12, background: C.bg, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 6, fontFamily: font, outline: 'none',
            }}
          />
        </div>
      </div>
      {error && (
        <div style={{ padding: '8px 12px', background: '#f8717115', color: C.red, borderRadius: 6, fontSize: 11, marginBottom: 10 }}>
          ⚠️ {error}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            padding: '9px 20px', borderRadius: 8, border: 'none',
            background: canSave ? C.accent : C.textDim, color: '#fff',
            fontSize: 13, fontWeight: 700, fontFamily: font,
            cursor: canSave ? 'pointer' : 'not-allowed',
          }}
        >
          {submitting ? '저장 중...' : '📥 드래프트로 저장'}
        </button>
      </div>
    </div>
  );
}
