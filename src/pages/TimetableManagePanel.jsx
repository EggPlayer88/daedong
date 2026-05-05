// ═══════════════════════════════════════════════════════════════════
//  TimetableManagePanel.jsx
//  관리자 모드 시간표 관리 패널 — 드래프트/활성/이전 시간표 목록
// ═══════════════════════════════════════════════════════════════════
//  - 모든 timetables row 조회
//  - draft 활성화 버튼
//  - draft 삭제 버튼
//  - 이전 시간표 정보 표시
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect } from 'react';
import {
  listTimetables, activateTimetable, deleteDraftTimetable,
} from '../lib/timetablesAPI';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', greenSoft:'#34d39920',
  yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";


export default function TimetableManagePanel({ onActivated }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

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
      onActivated?.();
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

  if (loading) return <div style={{ padding: 30, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>;

  const drafts = items.filter(i => i.status === 'draft');
  const active = items.find(i => i.is_active);
  const superseded = items.filter(i => i.status === 'superseded' || i.status === 'rolled_back');

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 18, fontFamily: font }}>
      <h3 style={{ margin: '0 0 14px', fontSize: 14, fontWeight: 600, color: C.text }}>
        🗂️ 시간표 관리 ({items.length}개)
      </h3>

      {error && (
        <div style={{ padding: '8px 10px', background: '#f8717115', color: C.red, borderRadius: 6, fontSize: 12, marginBottom: 12 }}>
          오류: {error}
        </div>
      )}

      {/* 활성 */}
      <Section title="현재 활성 시간표" emoji="✅">
        {active ? (
          <ItemRow item={active} kind="active" busy={busyId === active.id} />
        ) : (
          <Empty>활성 시간표가 없습니다.</Empty>
        )}
      </Section>

      {/* 드래프트 */}
      <Section title={`드래프트 (${drafts.length}개)`} emoji="📝">
        {drafts.length === 0 ? (
          <Empty>드래프트가 없습니다. "시간표 관리(구)" 페이지에서 솔버를 돌려 새 시간표를 만든 뒤 "Supabase 에 저장" 버튼으로 드래프트를 생성하세요.</Empty>
        ) : (
          drafts.map(d => (
            <ItemRow key={d.id} item={d} kind="draft" busy={busyId === d.id}
              onActivate={() => handleActivate(d)}
              onDelete={() => handleDelete(d)}
            />
          ))
        )}
      </Section>

      {/* 이전 시간표 */}
      {superseded.length > 0 && (
        <Section title={`이전 시간표 (${superseded.length}개)`} emoji="📚">
          {superseded.slice(0, 5).map(i => (
            <ItemRow key={i.id} item={i} kind="superseded" busy={busyId === i.id} />
          ))}
          {superseded.length > 5 && (
            <div style={{ fontSize: 11, color: C.textDim, padding: '6px 0', textAlign: 'center' }}>
              ...외 {superseded.length - 5}개 (Phase 7 이후 보관 정책 추가 예정)
            </div>
          )}
        </Section>
      )}
    </div>
  );
}


// ─── 항목 한 줄 ───
function ItemRow({ item, kind, busy, onActivate, onDelete }) {
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
      background: C.bg, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 6, padding: '10px 12px', marginBottom: 6,
      display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{item.name}</span>
          <span style={{
            fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
            background: color + '25', color,
          }}>{labelByKind[kind]}</span>
        </div>
        <div style={{ fontSize: 11, color: C.textMid }}>
          발효: {item.effective_from || '?'}
          {item.effective_until && ` ~ ${item.effective_until}`}
          <span style={{ marginLeft: 8 }}>· 작성: {new Date(item.created_at).toLocaleDateString('ko-KR')}</span>
        </div>
      </div>

      {kind === 'draft' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={onActivate} disabled={busy} style={btnStyle({ primary: true })}>
            {busy ? '...' : '활성화'}
          </button>
          <button onClick={onDelete} disabled={busy} style={btnStyle({ danger: true })}>
            삭제
          </button>
        </div>
      )}
    </div>
  );
}


function Section({ title, emoji, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: C.textDim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {emoji} {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <div style={{ padding: '14px 12px', background: C.bg, borderRadius: 6, color: C.textDim, fontSize: 11, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

function btnStyle({ primary = false, danger = false } = {}) {
  return {
    padding: '5px 10px', fontSize: 11, fontFamily: font, fontWeight: 500,
    background: primary ? C.accent : 'transparent',
    color: primary ? '#fff' : danger ? C.red : C.text,
    border: `1px solid ${primary ? C.accent : danger ? C.red : C.border}`,
    borderRadius: 5, cursor: 'pointer',
  };
}
