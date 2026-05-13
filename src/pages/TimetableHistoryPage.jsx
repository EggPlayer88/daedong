// ═══════════════════════════════════════════════════════════════════
//  TimetableHistoryPage.jsx — 시간표 편집 이력 보기 (Phase 4C-3)
// ═══════════════════════════════════════════════════════════════════
//  edit_log.events 를 사용자가 볼 수 있게 시간 역순으로 나열.
//  - 같은 ts + 같은 location 의 cell_clear → cell_edit 페어는 "교환" 한 줄로 통합
//  - 날짜가 바뀌면 날짜 헤더 구분선 표시
//  - events 없으면 안내 카드 (4C-1 이전 시간표 또는 편집 안 한 드래프트)
//  - 활성/드래프트/이전 시간표 모두 조회 가능 (읽기 전용)
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { getTimetable } from '../lib/timetablesAPI';
import { gS, gT, gC } from '../lib/timetableData';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";


export default function TimetableHistoryPage({ timetableId, onDone }) {
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const tt = await getTimetable(timetableId);
        if (cancelled) return;
        setMeta(tt);
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timetableId]);

  // ── raw events → swap 통합 → 시간 역순 ──
  const displayEvents = useMemo(() => {
    const raw = Array.isArray(meta?.edit_log?.events) ? meta.edit_log.events : [];
    if (raw.length === 0) return [];

    // 1) ts 오름차순 정렬 (같은 ts 면 원본 순서 유지)
    const sorted = raw
      .map((e, i) => ({ ...e, _idx: i }))
      .sort((a, b) => {
        if (a.ts === b.ts) return a._idx - b._idx;
        return a.ts < b.ts ? -1 : 1;
      });

    // 2) 인접한 cell_clear → cell_edit (같은 ts + 같은 location) 를 swap 으로 통합
    const merged = [];
    let i = 0;
    while (i < sorted.length) {
      const cur = sorted[i];
      const nxt = sorted[i + 1];
      if (
        cur.type === 'cell_clear' &&
        nxt && nxt.type === 'cell_edit' &&
        cur.ts === nxt.ts &&
        sameLocation(cur.location, nxt.location) &&
        cur.before && nxt.after
      ) {
        merged.push({
          type: 'swap',
          ts: cur.ts,
          user: cur.user,
          location: cur.location,
          removed: cur.before,
          added: nxt.after,
        });
        i += 2;
      } else {
        merged.push(cur);
        i += 1;
      }
    }

    // 3) 시간 역순 (최근이 위로)
    return merged.reverse();
  }, [meta]);

  return (
    <PageShell>
      <Header meta={meta} loading={loading} count={displayEvents.length} onDone={onDone} />

      {loading && (
        <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>
      )}

      {error && (
        <div style={{ padding: '12px 14px', background: '#f8717115', color: C.red, borderRadius: 8, fontSize: 13 }}>
          오류: {error}
        </div>
      )}

      {!loading && !error && (
        displayEvents.length === 0
          ? <EmptyHistory />
          : <EventList events={displayEvents} />
      )}
    </PageShell>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  헤더
// ═══════════════════════════════════════════════════════════════════
function Header({ meta, loading, count, onDone }) {
  const status = meta?.status;
  const isActive = meta?.is_active;
  let badgeLabel = status, badgeColor = C.textDim;
  if (isActive) { badgeLabel = '활성'; badgeColor = C.green; }
  else if (status === 'draft') { badgeLabel = '드래프트'; badgeColor = C.yellow; }
  else if (status === 'superseded') { badgeLabel = '이전'; badgeColor = C.textDim; }
  else if (status === 'rolled_back') { badgeLabel = '롤백됨'; badgeColor = C.red; }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <button onClick={onDone} style={backBtnStyle()}>← 목록으로</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
          📜 {meta?.name || '편집 이력'}
        </h2>
        {meta && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 4,
            background: badgeColor + '25', color: badgeColor,
          }}>{badgeLabel}</span>
        )}
      </div>
      <div style={{ fontSize: 12, color: C.textMid }}>
        {meta?.effective_from && (
          <>
            발효: {meta.effective_from}
            {meta.effective_until && ` ~ ${meta.effective_until}`}
            <span style={{ margin: '0 8px', color: C.textDim }}>·</span>
          </>
        )}
        편집 이력 {loading ? '...' : `총 ${count}건`} {!loading && count > 0 && '(시간 역순)'}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  빈 이력
// ═══════════════════════════════════════════════════════════════════
function EmptyHistory() {
  return (
    <div style={{
      padding: '40px 24px', background: C.card, borderRadius: 12,
      border: `1px dashed ${C.border}`, textAlign: 'center',
      color: C.textDim, lineHeight: 1.7,
    }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>📜</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: C.text, marginBottom: 6 }}>이력 없음</div>
      <div style={{ fontSize: 12 }}>
        이 시간표는 편집 이력이 없습니다.<br/>
        (Phase 4C-1 이전에 만들어진 시간표이거나, 아직 한 번도 편집하지 않은 드래프트일 수 있습니다)
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  이벤트 목록 (날짜 헤더 + 이벤트 카드)
// ═══════════════════════════════════════════════════════════════════
function EventList({ events }) {
  // 날짜별로 묶어서 헤더 표시 — events 는 이미 시간 역순 정렬됨
  const groups = [];
  let curKey = null;
  events.forEach(e => {
    const key = fmtDateKey(e.ts);
    if (key !== curKey) {
      groups.push({ key, label: fmtDateLabel(e.ts), items: [] });
      curKey = key;
    }
    groups[groups.length - 1].items.push(e);
  });

  return (
    <div>
      {groups.map(g => (
        <div key={g.key} style={{ marginBottom: 18 }}>
          <DateDivider label={g.label} />
          {g.items.map((e, i) => <EventCard key={`${g.key}-${i}`} ev={e} />)}
        </div>
      ))}
    </div>
  );
}


function DateDivider({ label }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      margin: '8px 0 10px 0',
    }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: C.textDim,
        textTransform: 'uppercase', letterSpacing: 0.4,
        padding: '3px 10px', borderRadius: 4,
        background: C.card, border: `1px solid ${C.border}`,
      }}>
        📅 {label}
      </div>
      <div style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );
}


function EventCard({ ev }) {
  const kind = classifyEvent(ev);  // { icon, label, color }
  const locText = fmtLocation(ev.location);
  const change = fmtChange(ev);
  const timeText = fmtTime(ev.ts);
  // TODO(Phase 6): ev.user 는 페르소나 ID 문자열 (예: 'admin', 't2').
  //   인증 통합 후 실제 사용자명으로 갱신 필요.
  const userText = ev.user || '?';

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${kind.color}`,
      borderRadius: 8, padding: '12px 16px', marginBottom: 6,
      display: 'flex', alignItems: 'center', gap: 14,
      fontFamily: font,
    }}>
      {/* 좌: 타입 아이콘 + 라벨 */}
      <div style={{
        minWidth: 88, display: 'flex', alignItems: 'center', gap: 6,
        fontSize: 12, fontWeight: 700, color: kind.color,
      }}>
        <span style={{ fontSize: 14 }}>{kind.icon}</span>
        <span>{kind.label}</span>
      </div>

      {/* 가운데: 위치 + 변경 내용 */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 3 }}>
          {locText}
        </div>
        <div style={{ fontSize: 12, color: C.textMid, lineHeight: 1.5 }}>
          {change}
        </div>
      </div>

      {/* 우: 사용자 + 시각 */}
      <div style={{
        minWidth: 140, textAlign: 'right',
        fontSize: 11, color: C.textDim, lineHeight: 1.5,
      }}>
        <div style={{ color: C.textMid, fontWeight: 500 }}>{userText}</div>
        <div>{timeText}</div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  포맷터 / 분류기
// ═══════════════════════════════════════════════════════════════════

function classifyEvent(ev) {
  if (ev.type === 'swap') {
    return { icon: '🔄', label: '교환', color: C.purple };
  }
  if (ev.type === 'cell_clear') {
    return { icon: '➖', label: '비우기', color: C.yellow };
  }
  if (ev.type === 'cell_edit') {
    // before 가 null/없음 → 추가, 그 외 → 변경
    if (!ev.before) {
      return { icon: '➕', label: '추가', color: C.green };
    }
    return { icon: '✏️', label: '변경', color: C.green };
  }
  return { icon: '·', label: ev.type || '?', color: C.textDim };
}


function fmtLocation(loc) {
  if (!loc) return '?';
  const cName = gC(loc.class)?.name || loc.class || '?';
  const day = loc.day || '?';
  const period = loc.period ?? '?';
  return `${cName}반 ${day}${period}교시`;
}


function fmtSlot(slot) {
  if (!slot) return '(비어있음)';
  if (slot.type === 'special') {
    const tName = slot.tid ? (gT(slot.tid)?.name || slot.tid) : null;
    return tName ? `${slot.name || '특별활동'} / ${tName}` : (slot.name || '특별활동');
  }
  const sName = slot.sid ? (gS(slot.sid)?.name || slot.sid) : null;
  const tName = slot.tid ? (gT(slot.tid)?.name || slot.tid) : null;
  if (!sName && !tName) return '(비어있음)';
  return `${sName || '?'} / ${tName || '?'}`;
}


function fmtChange(ev) {
  if (ev.type === 'swap') {
    return `${fmtSlot(ev.removed)} ⇄ ${fmtSlot(ev.added)}`;
  }
  return `${fmtSlot(ev.before)} → ${fmtSlot(ev.after)}`;
}


function sameLocation(a, b) {
  if (!a || !b) return false;
  return a.class === b.class && a.day === b.day && a.period === b.period;
}


// 사용자 로컬 타임존 기준 — 그룹 키 (YYYY-MM-DD)
function fmtDateKey(ts) {
  try {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  } catch {
    return ts;
  }
}


// 사용자 로컬 타임존 기준 — 헤더용 한국어 라벨
function fmtDateLabel(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  } catch {
    return ts;
  }
}


// 사용자 로컬 타임존 기준 — 카드 우측 시각 (HH:mm)
function fmtTime(ts) {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}


// ═══════════════════════════════════════════════════════════════════
//  셸 / 버튼
// ═══════════════════════════════════════════════════════════════════
function PageShell({ children }) {
  return (
    <div style={{
      background: C.bg, color: C.text, fontFamily: font,
      minHeight: '100vh', padding: '24px 32px',
    }}>
      {children}
    </div>
  );
}

function backBtnStyle() {
  return {
    padding: '7px 14px', fontSize: 12, fontFamily: font, fontWeight: 500,
    background: 'transparent', color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 6, cursor: 'pointer',
  };
}
