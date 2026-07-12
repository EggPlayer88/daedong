// ═══════════════════════════════════════════════════════════════════
//  TimetableViewer.jsx — Phase 2 시간표 + 변동 요청 통합
// ═══════════════════════════════════════════════════════════════════
//  탭 4개:
//   - 시간표 (보기 + 셀 클릭으로 변동 요청 시작)
//   - 알림
//   - 내 요청
//   - 승인 대기 [관리자만]
//
//  폴링 30초, 사이드바 빨간 점은 window 이벤트로 dispatch
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { DAYS, CLS, TCH, gS, gC, gT, CLR, isV, getSP } from '../lib/timetableData';
import {
  toTeacherView, getWeekDates, fmtDate, fmtDateShort, resolveDayState, slotKey,
} from '../lib/timetableEngine';
import {
  fetchMyRequests, fetchAdminQueue, fetchApprovedChanges,
  fetchNotifications, fetchUnreadCount,
} from '../lib/changesAPI';
import ChangeRequestForm from './ChangeRequestForm';
import { NotificationsTab, MyRequestsTab, AdminQueueTab } from './ChangeTabPanels';
import TimetableAIPanel, { TimetableAIToggleButton } from './TimetableAIPanel';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
  exam:'#7c2d12', examBg:'#7c2d1218',
  holiday:'#dc2626', holidayBg:'#dc262618',
  event:'#ca8a04', eventBg:'#ca8a0418',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";
const POLL_INTERVAL_MS = 30 * 1000;

function dispatchUnreadCount(count) {
  window.dispatchEvent(new CustomEvent('timetable:unread-count', { detail: { count } }));
}


export default function TimetableViewer({ currentUser }) {
  // 시드 시간표에 등장하는 교사를 기본값으로 (Phase 4 에서 currentUser.id 로 교체)
  const [persona, setPersona] = useState('t2');
  const [currentMode, setCurrentMode] = useState('teacher'); // 'teacher' | 'admin'
  const [tab, setTab] = useState('timetable');

  const [viewMode, setViewMode] = useState('class');
  const [entityId, setEntityId] = useState('c1');
  const [weekRef, setWeekRef] = useState(new Date());

  const [activeTimetable, setActiveTimetable] = useState(null);
  const [approvedChanges, setApprovedChanges] = useState([]);
  const [calendar, setCalendar] = useState({});
  const [myRequests, setMyRequests] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [adminQueue, setAdminQueue] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const [draftSourceCell, setDraftSourceCell] = useState(null);
  const [aiOpen, setAiOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const me = useMemo(() => {
    if (persona === 'admin') return { id: 'admin', name: '시간표관리자', isAdmin: true };
    const t = TCH.find(x => x.id === persona);
    return t ? { ...t, isAdmin: false } : { id: persona, name: '?', isAdmin: false };
  }, [persona]);

  const weekDates = useMemo(() => getWeekDates(weekRef), [weekRef]);
  const weekStart = fmtDate(weekDates[0]);
  const weekEnd = fmtDate(weekDates[4]);

  const refreshAll = useCallback(async () => {
    setError(null);
    try {
      const [ttRes, calRes, chRes, myReqRes, notifRes, adminRes, unreadRes] = await Promise.all([
        supabase.from('timetables').select('*').eq('is_active', true).maybeSingle(),
        supabase.from('school_calendar').select('*').gte('date', weekStart).lte('date', weekEnd),
        fetchApprovedChanges(weekStart, weekEnd),
        fetchMyRequests(me.id),
        fetchNotifications(me.id, { limit: 30 }),
        me.isAdmin ? fetchAdminQueue() : Promise.resolve([]),
        fetchUnreadCount(me.id),
      ]);
      if (ttRes.error) throw ttRes.error;
      if (calRes.error) throw calRes.error;

      setActiveTimetable(ttRes.data || null);
      const calMap = {};
      (calRes.data || []).forEach(e => { calMap[e.date] = e; });
      setCalendar(calMap);
      setApprovedChanges(chRes);
      setMyRequests(myReqRes);
      setNotifications(notifRes);
      setAdminQueue(adminRes);
      setUnreadCount(unreadRes);
      dispatchUnreadCount(unreadRes);
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [me.id, me.isAdmin, weekStart, weekEnd]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    refreshAll().finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshAll]);

  useEffect(() => {
    const tick = setInterval(() => { refreshAll().catch(() => {}); }, POLL_INTERVAL_MS);
    return () => clearInterval(tick);
  }, [refreshAll]);

  useEffect(() => {
    if (viewMode === 'teacher') {
      setEntityId(persona !== 'admin' ? persona : 't2');
    }
  }, [persona, viewMode]);

  // 페르소나가 일반 교사면 항상 teacher 모드, admin 페르소나일 때만 모드 자유
  useEffect(() => {
    if (persona !== 'admin' && currentMode !== 'teacher') {
      setCurrentMode('teacher');
    }
  }, [persona, currentMode]);

  useEffect(() => () => dispatchUnreadCount(0), []);

  const handleCellClick = (classId, day, period, slot, dateStr) => {
    if (!slot || slot.type === 'special' || slot.type === 'self_study') return;

    const isAdminMode = currentMode === 'admin' && persona === 'admin';

    // 교사 모드: 본인 수업만
    if (!isAdminMode && slot.tid !== me.id) {
      alert('내 수업 셀에서만 변동 요청을 시작할 수 있습니다.');
      return;
    }

    setDraftSourceCell({
      classId, day, period,
      sid: slot.sid, tid: slot.tid,
      date: dateStr,
    });
  };

  const handleFormSubmit = async () => {
    setDraftSourceCell(null);
    setTab('myrequests');
    await refreshAll();
  };

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px' }}>
      <PersonaSwitcher
        persona={persona}
        onChange={setPersona}
        currentMode={currentMode}
        onModeChange={setCurrentMode}
      />

      <Tabs
        tab={tab}
        onChange={setTab}
        unreadCount={unreadCount}
        myRequestCount={myRequests.length}
        adminQueueCount={me.isAdmin ? adminQueue.length : 0}
        isAdmin={me.isAdmin}
      />

      {loading && <Loading />}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!loading && !error && (
        <>
          {tab === 'timetable' && (
            draftSourceCell ? (
              <ChangeRequestForm
                sourceCell={draftSourceCell}
                currentUser={me}
                adminMode={currentMode === 'admin' && persona === 'admin'}
                baseTT={activeTimetable?.data}
                approvedChanges={approvedChanges}
                onSubmit={handleFormSubmit}
                onCancel={() => setDraftSourceCell(null)}
              />
            ) : (
              <TimetableSection
                activeTimetable={activeTimetable}
                approvedChanges={approvedChanges}
                calendar={calendar}
                weekDates={weekDates}
                weekRef={weekRef} setWeekRef={setWeekRef}
                viewMode={viewMode} setViewMode={setViewMode}
                entityId={entityId} setEntityId={setEntityId}
                onCellClick={handleCellClick}
                me={me}
                isAdminMode={currentMode === 'admin' && persona === 'admin'}
              />
            )
          )}

          {tab === 'notifications' && (
            <NotificationsTab notifications={notifications} currentUser={me} onChange={refreshAll} />
          )}
          {tab === 'myrequests' && (
            <MyRequestsTab requests={myRequests} currentUser={me} onChange={refreshAll} />
          )}
          {tab === 'admin' && me.isAdmin && (
            <AdminQueueTab queue={adminQueue} currentUser={me} onChange={refreshAll} />
          )}
        </>
      )}

      {/* 시간표 전용 AI 비서 — 토글 버튼 + 사이드 패널 */}
      <TimetableAIToggleButton
        open={aiOpen}
        onClick={() => setAiOpen(true)}
        isAdminMode={currentMode === 'admin' && persona === 'admin'}
      />
      <TimetableAIPanel
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        currentUser={me}
        weekDates={weekDates}
        isAdminMode={currentMode === 'admin' && persona === 'admin'}
        onProposalApplied={refreshAll}
      />
    </div>
  );
}


function PersonaSwitcher({ persona, onChange, currentMode, onModeChange }) {
  // 시드 시간표에 실제 등장하는 교사들 + admin
  const seedTeachers = ['t2', 't7', 't20', 't12', 't4', 't14'];
  const opts = [
    ...seedTeachers.map(id => {
      const t = TCH.find(x => x.id === id);
      return { id, label: t ? t.name : id };
    }),
    { id: 'admin', label: '시간표관리자' },
  ];
  const isAdmin = persona === 'admin';
  return (
    <div style={{ marginBottom: 16, padding: '10px 14px', background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, fontSize: 12, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
      <span style={{ color: C.textDim }}>페르소나:</span>
      <select value={persona} onChange={e => onChange(e.target.value)}
        style={{ background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 6, padding: '4px 8px', fontSize: 12, fontFamily: font }}>
        {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {isAdmin && (
        <>
          <div style={{ width: 1, height: 18, background: C.border }} />
          <span style={{ color: C.textDim, fontSize: 11 }}>모드:</span>
          <div style={{ display: 'flex', gap: 0, border: `1px solid ${C.border}`, borderRadius: 6, overflow: 'hidden' }}>
            <button onClick={() => onModeChange('teacher')} style={modeBtnStyle(currentMode === 'teacher', false)}>
              👤 교사 모드
            </button>
            <button onClick={() => onModeChange('admin')} style={modeBtnStyle(currentMode === 'admin', true)}>
              ⚙️ 관리자 모드
            </button>
          </div>
          {currentMode === 'admin' && (
            <span style={{ fontSize: 10, color: '#a78bfa', background: '#a78bfa15', padding: '3px 8px', borderRadius: 4 }}>
              직권 변경: 즉시 적용 + 사후 통보
            </span>
          )}
        </>
      )}
      <span style={{ color: C.textDim, marginLeft: 'auto', fontSize: 10 }}>
        시뮬레이션 페르소나 — 본격 인증 통합 후 본인 계정으로 자동 매핑됩니다
      </span>
    </div>
  );
}

function modeBtnStyle(active, isAdminMode) {
  return {
    padding: '4px 10px', fontSize: 11, fontFamily: font, fontWeight: active ? 600 : 500,
    border: 'none', cursor: 'pointer',
    background: active ? (isAdminMode ? '#a78bfa30' : '#34d39930') : 'transparent',
    color: active ? (isAdminMode ? '#a78bfa' : '#34d399') : C.textMid,
  };
}

function Tabs({ tab, onChange, unreadCount, myRequestCount, adminQueueCount, isAdmin }) {
  const items = [
    { id: 'timetable', label: '시간표' },
    { id: 'notifications', label: `알림${unreadCount ? ` (${unreadCount})` : ''}`, dot: unreadCount > 0 },
    { id: 'myrequests', label: `내 요청${myRequestCount ? ` (${myRequestCount})` : ''}` },
    ...(isAdmin ? [{ id: 'admin', label: `승인 대기${adminQueueCount ? ` (${adminQueueCount})` : ''}`, dot: adminQueueCount > 0 }] : []),
  ];
  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: `1px solid ${C.border}` }}>
      {items.map(it => (
        <button
          key={it.id}
          onClick={() => onChange(it.id)}
          style={{
            padding: '10px 16px', border: 'none', background: 'transparent',
            borderBottom: `2px solid ${tab === it.id ? C.accent : 'transparent'}`,
            color: tab === it.id ? C.accent : C.textMid,
            fontSize: 12, fontWeight: tab === it.id ? 700 : 500,
            cursor: 'pointer', fontFamily: font, position: 'relative',
          }}
        >
          {it.label}
          {it.dot && tab !== it.id && (
            <span style={{ position: 'absolute', top: 6, right: 4, width: 6, height: 6, borderRadius: '50%', background: C.red }} />
          )}
        </button>
      ))}
    </div>
  );
}

function TimetableSection({
  activeTimetable, approvedChanges, calendar, weekDates,
  weekRef, setWeekRef, viewMode, setViewMode, entityId, setEntityId,
  onCellClick, me, isAdminMode,
}) {
  const goWeek = (delta) => {
    const d = new Date(weekRef);
    d.setDate(d.getDate() + delta * 7);
    setWeekRef(d);
  };

  const entities = viewMode === 'class' ? CLS : TCH;
  const weekLabel = `${fmtDateShort(weekDates[0])} ~ ${fmtDateShort(weekDates[4])}`;

  if (!activeTimetable) {
    return (
      <Empty>
        📭 활성 시간표가 없습니다.<br/>
        사이드바의 "🗓️ 시간표 관리" 에서 시간표를 생성하고 활성화해주세요.
      </Empty>
    );
  }

  return (
    <>
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

      <WeekGrid
        activeTimetable={activeTimetable}
        approvedChanges={approvedChanges}
        calendar={calendar}
        weekDates={weekDates}
        viewMode={viewMode}
        entityId={entityId}
        onCellClick={onCellClick}
        me={me}
        isAdminMode={isAdminMode}
      />

      <div style={{ fontSize: 11, color: C.textMid, marginTop: 10 }}>
        <span style={{ display: 'inline-block', width: 10, height: 10, background: C.green, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />
        변동 적용된 셀은 초록색으로 표시.
        {isAdminMode
          ? ' 관리자 모드: 모든 셀 클릭 시 직권 변경 폼이 열립니다.'
          : ' 본인 수업 셀을 클릭하면 변동 요청을 시작할 수 있습니다.'}
      </div>
    </>
  );
}


export function WeekGrid({ activeTimetable, approvedChanges, calendar, weekDates, viewMode, entityId, onCellClick, me, isAdminMode }) {
  const dayStates = weekDates.map(date => {
    const dateStr = fmtDate(date);
    const calEntry = calendar[dateStr];
    const classIdForCalCheck = viewMode === 'class' ? entityId : null;
    const state = resolveDayState(date, activeTimetable.data, calEntry, approvedChanges, classIdForCalCheck);
    return { date, dateStr, state };
  });

  const dayCells = dayStates.map(({ date, dateStr, state }) => {
    if (state.kind !== 'normal') return { date, dateStr, state, slots: null };
    const slots = viewMode === 'class'
      ? state.tt[entityId] || {}
      : (toTeacherView(state.tt)[entityId] || {});
    return { date, dateStr, state, slots };
  });

  const periods = [1, 2, 3, 4, 5, 6, 7];

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.bg }}>
            <th style={{ padding: '10px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 500, width: 60 }}>교시</th>
            {dayCells.map(({ date, dateStr, state }) => (
              <th key={dateStr} style={{
                padding: '10px 8px', borderBottom: `1px solid ${C.border}`,
                color: dayHeaderColor(state), fontWeight: 600, minWidth: 90,
              }}>
                <div style={{ fontSize: 13 }}>{DAYS[date.getDay() - 1]}</div>
                <div style={{ fontSize: 10, color: C.textDim, fontWeight: 400, marginTop: 2 }}>
                  {date.getMonth() + 1}/{date.getDate()}
                </div>
                {state.kind !== 'normal' && (
                  <div style={{
                    fontSize: 9, marginTop: 3, padding: '1px 6px', borderRadius: 4,
                    background: dayHeaderBg(state), color: dayHeaderColor(state), display: 'inline-block',
                  }}>{dayHeaderLabel(state)}</div>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map(p => (
            <tr key={p}>
              <td style={{ padding: '8px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontSize: 11 }}>{p}</td>
              {dayCells.map(({ date, dateStr, state, slots }) => (
                <SlotCell
                  key={dateStr}
                  state={state}
                  period={p}
                  day={DAYS[date.getDay() - 1]}
                  dateStr={dateStr}
                  slots={slots}
                  viewMode={viewMode}
                  entityId={entityId}
                  onCellClick={onCellClick}
                  me={me}
                  isAdminMode={isAdminMode}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


export function SlotCell({ state, period, day, dateStr, slots, viewMode, entityId, onCellClick, me, isAdminMode }) {
  const cellBase = {
    padding: '6px', borderBottom: `1px solid ${C.border}`,
    borderLeft: `1px solid ${C.border}`, height: 54, verticalAlign: 'middle',
    textAlign: 'center',
  };

  if (state.kind === 'weekend') return <td style={{ ...cellBase, background: '#080b14', opacity: 0.3 }} />;
  if (state.kind === 'no_school') return <td style={{ ...cellBase, background: C.holidayBg, opacity: 0.5 }} />;
  if (state.kind === 'exam') return <td style={{ ...cellBase, background: C.examBg, opacity: 0.5 }} />;
  if (state.kind === 'event') return <td style={{ ...cellBase, background: C.eventBg, opacity: 0.5 }} />;

  if (viewMode === 'class' && !isV(day, period)) {
    return <td style={{ ...cellBase, background: '#080b14', opacity: 0.25 }} />;
  }

  const sKey = slotKey(day, period);
  const slot = slots?.[sKey];
  const sp = getSP(day, period);

  if (sp && (!slot || slot.type === 'special')) {
    return (
      <td style={{ ...cellBase, background: '#1a1530' }}>
        <div style={{ fontSize: 10, color: C.purple, fontWeight: 600 }}>창체</div>
      </td>
    );
  }

  if (!slot) {
    return (
      <td style={{ ...cellBase, background: 'transparent' }}>
        {viewMode === 'teacher' && <span style={{ fontSize: 9, color: C.textDim }}>공강</span>}
      </td>
    );
  }

  const subj = gS(slot.sid);
  const clr = CLR[subj?.ci ?? 0] || { bg: '#444', tx: '#fff' };
  const otherEntity = viewMode === 'class' ? gT(slot.tid)?.name : gC(slot.cid)?.name;
  const isChanged = !!slot._changed;

  // 관리자 모드에서는 모든 셀 클릭 가능, 그 외엔 본인 셀만
  const isOwnSlot = slot.tid === me.id;
  const clickable = (isAdminMode || isOwnSlot) && state.kind === 'normal' && !slot.type;

  // 관리자 모드에서 다른 사람 셀이 클릭 가능할 때 시각적 hint
  const adminHint = isAdminMode && !isOwnSlot;

  const classId = viewMode === 'class' ? entityId : slot.cid;

  return (
    <td style={{
      ...cellBase,
      background: isChanged ? '#0c5443' : clr.bg + '22',
      borderLeft: `3px solid ${isChanged ? C.green : clr.bg}`,
      position: 'relative',
      cursor: clickable ? 'pointer' : 'default',
    }}
      onClick={() => clickable && onCellClick(classId, day, period, slot, dateStr)}
      onMouseEnter={e => { if (clickable) e.currentTarget.style.outline = `1px solid ${adminHint ? C.purple : C.accent}`; }}
      onMouseLeave={e => { e.currentTarget.style.outline = 'none'; }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: isChanged ? C.green : clr.bg }}>
        {slot.type === 'self_study' ? '자습' : (subj?.name || '?')}
      </div>
      <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{otherEntity || '-'}</div>
      {isChanged && (
        <div style={{ position: 'absolute', top: 2, right: 3, fontSize: 8, color: C.green, fontWeight: 600 }}>
          {changedLabel(slot._changed.type)}
        </div>
      )}
    </td>
  );
}


function dayHeaderColor(state) {
  if (state.kind === 'no_school') return C.holiday;
  if (state.kind === 'exam') return C.exam;
  if (state.kind === 'event') return C.event;
  return C.text;
}
function dayHeaderBg(state) {
  if (state.kind === 'no_school') return C.holidayBg;
  if (state.kind === 'exam') return C.examBg;
  if (state.kind === 'event') return C.eventBg;
  return 'transparent';
}
function dayHeaderLabel(state) {
  if (state.kind === 'no_school') return state.note || '휴일';
  if (state.kind === 'exam') return '시험';
  if (state.kind === 'event') return state.partial ? '일부 행사' : '행사';
  return '';
}
function changedLabel(type) {
  if (type === 'swap') return '교환';
  if (type === 'substitute') return '보강';
  if (type === 'self_study') return '자습';
  if (type === 'period_move_to' || type === 'period_move_from') return '이동';
  return '변동';
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

function Loading() {
  return <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중…</div>;
}

function Empty({ children }) {
  return <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>{children}</div>;
}

function ErrorBanner({ children }) {
  return <div style={{ padding: 24, color: C.red, fontSize: 12, fontFamily: 'monospace', background: '#f8717115', border: `1px solid ${C.red}40`, borderRadius: 8, marginBottom: 16 }}>오류: {children}</div>;
}
