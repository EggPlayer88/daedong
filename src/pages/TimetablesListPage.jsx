// ═══════════════════════════════════════════════════════════════════
//  TimetablesListPage.jsx — 시간표 목록 + 미리보기 (관리자 전용)
// ═══════════════════════════════════════════════════════════════════
//  Phase 4B-1: 목록 페이지
//  Phase 4B-2: 항목 클릭 시 그 시간표를 읽기 전용으로 미리보기
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import {
  listTimetables, getTimetable, activateTimetable, deleteDraftTimetable,
} from '../lib/timetablesAPI';
import { CLS, TCH, DAYS } from '../lib/timetableData';
import {
  fetchApprovedChanges,
} from '../lib/changesAPI';
import {
  getWeekDates, fmtDate, fmtDateShort,
} from '../lib/timetableEngine';
import { WeekGrid } from './TimetableViewer';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', greenSoft:'#34d39920',
  yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";


export default function TimetablesListPage({ currentUser }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [previewId, setPreviewId] = useState(null); // 미리보기 대상 ID

  const refresh = async () => {
    setError(null);
    try {
      const data = await listTimetables();
      setItems(data);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, []);

  const handleActivate = async (item) => {
    if (!window.confirm(`"${item.name}" 을 활성 시간표로 만들까요?\n\n현재 활성 시간표는 자동으로 비활성화(superseded)됩니다.`)) return;
    setBusyId(item.id);
    setError(null);
    try {
      await activateTimetable(item.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`"${item.name}" 드래프트를 삭제할까요? 되돌릴 수 없습니다.`)) return;
    setBusyId(item.id);
    setError(null);
    try {
      await deleteDraftTimetable(item.id);
      await refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  // 미리보기 모드
  if (previewId) {
    const item = items.find(i => i.id === previewId);
    return <PreviewMode timetableId={previewId} meta={item} onBack={() => setPreviewId(null)} />;
  }

  const drafts = items.filter(i => i.status === 'draft');
  const active = items.find(i => i.is_active);
  const superseded = items.filter(i => i.status === 'superseded' || i.status === 'rolled_back');

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px' }}>
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🗂️ 시간표 목록</h2>
        <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>
          드래프트와 활성 시간표를 관리합니다. 항목을 클릭하면 시간표를 미리 볼 수 있어요.
        </div>
      </div>

      {loading && <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>}
      {error && (
        <div style={{ padding: '12px 14px', background: '#f8717115', color: C.red, borderRadius: 8, fontSize: 12, marginBottom: 14 }}>
          오류: {error}
        </div>
      )}

      {!loading && (
        <>
          <Section title="현재 활성 시간표" emoji="✅">
            {active ? (
              <ItemRow item={active} kind="active" busy={busyId === active.id}
                onPreview={() => setPreviewId(active.id)}
              />
            ) : (
              <Empty>활성 시간표가 없습니다.</Empty>
            )}
          </Section>

          <Section title={`드래프트 (${drafts.length}개)`} emoji="📝">
            {drafts.length === 0 ? (
              <Empty>드래프트가 없습니다. <strong>🗓️ 시간표 관리(구)</strong> 페이지에서 솔버를 돌려 새 시간표를 만든 뒤 "📥 Supabase 에 저장" 버튼으로 드래프트를 생성하세요.</Empty>
            ) : (
              drafts.map(d => (
                <ItemRow key={d.id} item={d} kind="draft" busy={busyId === d.id}
                  onPreview={() => setPreviewId(d.id)}
                  onActivate={() => handleActivate(d)}
                  onDelete={() => handleDelete(d)}
                />
              ))
            )}
          </Section>

          {superseded.length > 0 && (
            <Section title={`이전 시간표 (${superseded.length}개)`} emoji="📚">
              {superseded.slice(0, 10).map(i => (
                <ItemRow key={i.id} item={i} kind="superseded" busy={busyId === i.id}
                  onPreview={() => setPreviewId(i.id)}
                />
              ))}
              {superseded.length > 10 && (
                <div style={{ fontSize: 11, color: C.textDim, padding: '8px 0', textAlign: 'center' }}>
                  ...외 {superseded.length - 10}개
                </div>
              )}
            </Section>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  미리보기 모드
// ═══════════════════════════════════════════════════════════════════
function PreviewMode({ timetableId, meta, onBack }) {
  const [timetable, setTimetable] = useState(null);
  const [approvedChanges, setApprovedChanges] = useState([]);
  const [calendar, setCalendar] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [viewMode, setViewMode] = useState('class');
  const [entityId, setEntityId] = useState('c1');
  const [weekRef, setWeekRef] = useState(new Date());

  const weekDates = useMemo(() => getWeekDates(weekRef), [weekRef]);
  const weekStart = fmtDate(weekDates[0]);
  const weekEnd = fmtDate(weekDates[4]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const tt = await getTimetable(timetableId);
        if (cancelled) return;
        setTimetable(tt);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timetableId]);

  // 활성 시간표면 그 주의 변동과 캘린더도 가져옴 (이전 시간표는 표시 안 함)
  useEffect(() => {
    if (!timetable?.is_active) {
      setApprovedChanges([]);
      setCalendar({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [chRes, calRes] = await Promise.all([
          fetchApprovedChanges(weekStart, weekEnd),
          supabase.from('school_calendar').select('*').gte('date', weekStart).lte('date', weekEnd),
        ]);
        if (cancelled) return;
        setApprovedChanges(chRes);
        const calMap = {};
        (calRes.data || []).forEach(e => { calMap[e.date] = e; });
        setCalendar(calMap);
      } catch (e) {
        // 부수 정보 실패는 무시
      }
    })();
    return () => { cancelled = true; };
  }, [timetable, weekStart, weekEnd]);

  const goWeek = (delta) => {
    const d = new Date(weekRef);
    d.setDate(d.getDate() + delta * 7);
    setWeekRef(d);
  };

  const entities = viewMode === 'class' ? CLS : TCH;
  const weekLabel = `${fmtDateShort(weekDates[0])} ~ ${fmtDateShort(weekDates[4])}`;

  // 읽기 전용이라 me 는 가짜로 — 어떤 셀도 본인 셀이 아니게 만들어서 hover 도 안 뜨게
  const fakeMe = { id: '__readonly__', isAdmin: false };

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px' }}>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{
          padding: '7px 14px', fontSize: 12, fontFamily: font, fontWeight: 500,
          background: 'transparent', color: C.text,
          border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
        }}>← 목록으로</button>
        <div style={{ flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{meta?.name || '시간표 미리보기'}</h2>
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>
            발효: {meta?.effective_from || '?'}{meta?.effective_until && ` ~ ${meta.effective_until}`}
            <span style={{ marginLeft: 10 }}>· 작성: {meta?.created_at ? new Date(meta.created_at).toLocaleString('ko-KR') : '?'}</span>
          </div>
        </div>
        <StatusBadge status={meta?.status} isActive={meta?.is_active} />
      </div>

      {/* 비활성 안내 배너 */}
      {!meta?.is_active && (
        <div style={{
          padding: '10px 14px', marginBottom: 14,
          background: meta?.status === 'draft' ? C.yellow + '15' : C.textDim + '15',
          color: meta?.status === 'draft' ? C.yellow : C.textMid,
          border: `1px solid ${meta?.status === 'draft' ? C.yellow + '40' : C.border}`,
          borderRadius: 8, fontSize: 12,
        }}>
          ℹ️ {meta?.status === 'draft'
            ? '드래프트 미리보기입니다. 아직 활성화되지 않아 학교에 적용되지 않습니다.'
            : '이전 시간표 미리보기입니다. 현재 활성 시간표이 아니므로 변동·캘린더 정보는 표시되지 않습니다.'}
        </div>
      )}

      {loading && <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>}
      {error && (
        <div style={{ padding: '12px 14px', background: '#f8717115', color: C.red, borderRadius: 8, fontSize: 12 }}>
          오류: {error}
        </div>
      )}

      {!loading && timetable && (
        <>
          {/* 컨트롤 바 */}
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 4, padding: 3, background: C.card, border: `1px solid ${C.border}`, borderRadius: 8 }}>
              <SegBtn active={viewMode === 'class'} onClick={() => setViewMode('class')}>학급 뷰</SegBtn>
              <SegBtn active={viewMode === 'teacher'} onClick={() => setViewMode('teacher')}>교사 뷰</SegBtn>
            </div>

            <select value={entityId} onChange={e => setEntityId(e.target.value)}
              style={{ background: C.card, color: C.text, border: `1px solid ${C.border}`, borderRadius: 8, padding: '7px 10px', fontSize: 12, fontFamily: font, minWidth: 140 }}>
              {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>

            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
              <SegBtn onClick={() => goWeek(-1)}>‹ 이전</SegBtn>
              <SegBtn onClick={() => setWeekRef(new Date())}>오늘</SegBtn>
              <SegBtn onClick={() => goWeek(1)}>다음 ›</SegBtn>
              <span style={{ fontSize: 13, fontWeight: 500, color: C.text, marginLeft: 10 }}>{weekLabel}</span>
            </div>
          </div>

          {/* WeekGrid 재사용 — onCellClick 을 빈 함수로 넘겨서 클릭 차단 */}
          <WeekGrid
            activeTimetable={timetable}
            approvedChanges={approvedChanges}
            calendar={calendar}
            weekDates={weekDates}
            viewMode={viewMode}
            entityId={entityId}
            onCellClick={() => {}}
            me={fakeMe}
            isAdminMode={false}
          />

          <div style={{ fontSize: 11, color: C.textMid, marginTop: 10 }}>
            🔒 읽기 전용 보기 — 셀 클릭이나 편집은 불가능합니다. 편집하려면 드래프트 편집 페이지를 이용하세요 (Phase 4C 예정).
          </div>
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  부품
// ═══════════════════════════════════════════════════════════════════
function ItemRow({ item, kind, busy, onPreview, onActivate, onDelete }) {
  const colorByKind = {
    active: C.green,
    draft: C.yellow,
    superseded: C.textDim,
  };
  const labelByKind = {
    active: '활성',
    draft: '드래프트',
    superseded: '이전',
  };
  const color = colorByKind[kind] || C.textDim;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8, padding: '14px 16px', marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 12,
      cursor: onPreview ? 'pointer' : 'default',
      transition: 'background 0.1s',
    }}
      onClick={() => onPreview?.()}
      onMouseEnter={e => { if (onPreview) e.currentTarget.style.background = '#1a2038'; }}
      onMouseLeave={e => { e.currentTarget.style.background = C.card; }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.name}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: color + '25', color,
          }}>{labelByKind[kind]}</span>
          {onPreview && <span style={{ fontSize: 10, color: C.textDim, marginLeft: 'auto' }}>클릭해서 미리보기 →</span>}
        </div>
        <div style={{ fontSize: 12, color: C.textMid }}>
          발효: {item.effective_from || '?'}
          {item.effective_until && ` ~ ${item.effective_until}`}
          <span style={{ marginLeft: 10 }}>· 작성: {new Date(item.created_at).toLocaleString('ko-KR')}</span>
        </div>
      </div>

      {kind === 'draft' && (
        <div style={{ display: 'flex', gap: 6 }} onClick={e => e.stopPropagation()}>
          <button onClick={onActivate} disabled={busy} style={btnStyle({ primary: true })}>
            {busy ? '처리 중...' : '활성화'}
          </button>
          <button onClick={onDelete} disabled={busy} style={btnStyle({ danger: true })}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
}


function StatusBadge({ status, isActive }) {
  let label = status, color = C.textDim;
  if (isActive) { label = '활성'; color = C.green; }
  else if (status === 'draft') { label = '드래프트'; color = C.yellow; }
  else if (status === 'superseded') { label = '이전'; color = C.textDim; }
  else if (status === 'rolled_back') { label = '롤백됨'; color = C.red; }
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 12,
      background: color + '25', color,
    }}>{label}</span>
  );
}


function Section({ title, emoji, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: C.textDim, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {emoji} {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: '20px 16px', background: C.card, borderRadius: 8, color: C.textDim, fontSize: 12, lineHeight: 1.6, border: `1px dashed ${C.border}` }}>
      {children}
    </div>
  );
}

function btnStyle({ primary = false, danger = false } = {}) {
  return {
    padding: '6px 12px', fontSize: 12, fontFamily: font, fontWeight: 500,
    background: primary ? C.accent : 'transparent',
    color: primary ? '#fff' : danger ? C.red : C.text,
    border: `1px solid ${primary ? C.accent : danger ? C.red : C.border}`,
    borderRadius: 6, cursor: 'pointer',
  };
}

function SegBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      padding: '7px 14px', border: `1px solid ${active ? C.accent : C.border}`,
      background: active ? C.accentSoft : 'transparent', color: active ? C.accent : C.textMid,
      borderRadius: 8, fontSize: 12, fontWeight: active ? 600 : 500, cursor: 'pointer', fontFamily: font,
    }}>{children}</button>
  );
}
