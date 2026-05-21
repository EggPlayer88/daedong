// ═══════════════════════════════════════════════════════════════════
//  InitSettingsView — 학교 초기설정 read-only 미리보기 (정리 2-C)
// ═══════════════════════════════════════════════════════════════════
//  데이터 출처: src/lib/timetableData.js 상수 (SBJ / CLS / TCH / DEPT)
//  사용 위치: SolverModal Step 1 — "시간표 생성 직전에 어떤 데이터 기준으로
//             돌릴지" 확인하는 단계.
//
//  read-only. 편집 기능은 Phase 5 의 학교 설정 페이지 부활 시 별도로.
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { DAYS, SBJ, CLS, TCH, CLR, DEPT, gC, getHR } from '../../lib/timetableData';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171',
  purple:'#a78bfa', teal:'#2dd4bf',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 16px', border: 'none', background: 'transparent',
      borderBottom: `2px solid ${active ? C.accent : 'transparent'}`,
      color: active ? C.accent : C.textMid,
      fontSize: 12, fontWeight: active ? 700 : 500,
      cursor: 'pointer', fontFamily: font, whiteSpace: 'nowrap',
    }}>{children}</button>
  );
}

export default function InitSettingsView() {
  const [subtab, setSubtab] = useState('subjects');

  return (
    <div style={{ fontFamily: font, color: C.text }}>
      <div style={{
        padding: '10px 14px', marginBottom: 14,
        background: C.accentSoft, color: C.accent,
        border: `1px solid ${C.accent}30`, borderRadius: 8,
        fontSize: 11, lineHeight: 1.6,
      }}>
        ℹ️ 현재 학교 설정(<code style={{ background:C.bg, padding:'1px 5px', borderRadius:4 }}>src/lib/timetableData.js</code>) 의 read-only 미리보기입니다.
        솔버는 이 데이터 기준으로 시간표를 생성합니다. 수정은 Phase 5 의 학교 설정 페이지가 부활하면 가능해집니다.
      </div>

      <div style={{ display: 'flex', gap: 0, borderBottom: `1px solid ${C.border}`, marginBottom: 14 }}>
        {[
          ['subjects', '📚 과목·시수'],
          ['classes',  '🏫 학급'],
          ['teachers', '👤 교사 배정'],
          ['depts',    '🏢 부서'],
        ].map(([id, lbl]) => (
          <TabBtn key={id} active={subtab===id} onClick={()=>setSubtab(id)}>{lbl}</TabBtn>
        ))}
      </div>

      {subtab==='subjects' && <SubjectsView/>}
      {subtab==='classes'  && <ClassesView/>}
      {subtab==='teachers' && <TeachersView/>}
      {subtab==='depts'    && <DeptsView/>}
    </div>
  );
}

function SubjectsView() {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>
        과목별 학년별 주간 표준시수 + 담당 교사
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12, fontFamily: font }}>
          <thead>
            <tr style={{ background: '#0d1020' }}>
              <th style={{ padding: '8px 12px', border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>과목</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'center' }}>1학년</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'center' }}>2학년</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'center' }}>3학년</th>
              <th style={{ padding: '8px 12px', border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>담당 교사</th>
            </tr>
          </thead>
          <tbody>
            {SBJ.map(s => {
              const clr = CLR[s.ci];
              const teachers = TCH.filter(t => t.as.some(a => a.s === s.id));
              return (
                <tr key={s.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ background: clr.bg+'22', color: clr.bg, padding: '2px 8px', borderRadius: 5, fontSize: 11, fontWeight: 600 }}>{s.name}</span>
                  </td>
                  <td style={{ padding: 8, textAlign: 'center', color: s.gh[1] ? C.text : C.textDim }}>{s.gh[1] || '-'}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: s.gh[2] ? C.text : C.textDim }}>{s.gh[2] || '-'}</td>
                  <td style={{ padding: 8, textAlign: 'center', color: s.gh[3] ? C.text : C.textDim }}>{s.gh[3] || '-'}</td>
                  <td style={{ padding: '8px 12px', fontSize: 11, color: C.textMid }}>{teachers.map(t => t.name).join(', ') || '-'}</td>
                </tr>
              );
            })}
            <tr style={{ background: '#0d1020', fontWeight: 700 }}>
              <td style={{ padding: '8px 12px', color: C.text }}>합계 (창체 포함)</td>
              {[1, 2, 3].map(g => (
                <td key={g} style={{ padding: 8, textAlign: 'center', color: C.green }}>
                  {SBJ.reduce((s, sub) => s + (sub.gh[g] || 0), 0) + 1}
                </td>
              ))}
              <td style={{ padding: '8px 12px', fontSize: 11, color: C.textDim }}>목7 창체 고정</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ClassesView() {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>
        학급 {CLS.length}개 — 담임 배정 현황
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {CLS.map(c => {
          const hr = getHR(c.id);
          return (
            <div key={c.id} style={{
              padding: '12px 14px', background: C.card, borderRadius: 10,
              border: `1px solid ${C.border}`,
            }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>{c.name}</div>
              <div style={{ fontSize: 11, color: C.textDim }}>담임: {hr?.name || '미배정'}</div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{c.g}학년</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TeachersView() {
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>
        교사 {TCH.length}명 — 담임/요일제한/시수/담당 학급
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11, fontFamily: font }}>
          <thead>
            <tr style={{ background: '#0d1020' }}>
              <th style={{ padding: '8px 10px', border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>교사</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid }}>담임</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid }}>요일 제한</th>
              <th style={{ padding: 8, border: `1px solid ${C.border}`, color: C.textMid }}>총 시수</th>
              <th style={{ padding: '8px 10px', border: `1px solid ${C.border}`, color: C.textMid, textAlign: 'left' }}>담당 학급</th>
            </tr>
          </thead>
          <tbody>
            {TCH.map(t => {
              const total = t.as.reduce((s, a) => s + a.h, 0);
              const dr = t.al ? t.al.map(d => DAYS[d]).join('·') + '만' : '제한없음';
              const cls = t.as.map(a => gC(a.c)?.name).join(', ');
              return (
                <tr key={t.id} style={{ borderBottom: `1px solid ${C.border}` }}>
                  <td style={{ padding: '7px 10px', color: C.text, fontWeight: 600 }}>{t.name}</td>
                  <td style={{ padding: 7, textAlign: 'center', color: t.hr ? C.green : C.textDim }}>
                    {t.hr ? gC(t.hc)?.name : '—'}
                  </td>
                  <td style={{ padding: 7, textAlign: 'center', color: t.al ? C.yellow : C.textDim, fontSize: 10 }}>{dr}</td>
                  <td style={{ padding: 7, textAlign: 'center', fontWeight: 700, color: total >= 15 ? C.red : total >= 10 ? C.green : C.textMid }}>{total}h</td>
                  <td style={{ padding: '7px 10px', color: C.textDim, fontSize: 10 }}>{cls}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DeptsView() {
  // 부서별 색상 (App.jsx 의 DEPT_C 와 일관성)
  const DEPT_C = {
    '교무부':'#4f8cff','연구부':'#a78bfa','학생안전부':'#f472b6',
    '학생생활부':'#fb923c','진로부':'#22d3ee','정보부':'#34d399',
  };
  return (
    <div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 10 }}>
        부서 {DEPT.length}개 — 일정/업무 분류에 사용됨
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        {DEPT.map(d => {
          const color = DEPT_C[d] || C.textMid;
          return (
            <div key={d} style={{
              padding: '12px 14px', background: C.card, borderRadius: 10,
              border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color }}>{d}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
