// ═══════════════════════════════════════════════════════════════════
//  TimetablesListPage.jsx
//  시간표 목록 관리 페이지 (관리자 전용)
// ═══════════════════════════════════════════════════════════════════
//  Phase 4B-1: TimetableManagePanel 을 페이지로 승격
//  Phase 4B-2: 이전 시간표 클릭 시 읽기 전용 보기 (다음 단계)
//  Phase 4C: 드래프트 편집 진입점 (다음 단계)
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


export default function TimetablesListPage({ currentUser }) {
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

  const drafts = items.filter(i => i.status === 'draft');
  const active = items.find(i => i.is_active);
  const superseded = items.filter(i => i.status === 'superseded' || i.status === 'rolled_back');

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px' }}>
      {/* 페이지 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>🗂️ 시간표 목록</h2>
        <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>
          드래프트와 활성 시간표를 관리합니다. 새 시간표는 "🗓️ 시간표 관리" 페이지에서 솔버로 생성한 후 드래프트로 저장하세요.
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
          {/* 활성 시간표 */}
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
              <Empty>드래프트가 없습니다. <strong>🗓️ 시간표 관리(구)</strong> 페이지에서 솔버를 돌려 새 시간표를 만든 뒤 "📥 Supabase 에 저장" 버튼으로 드래프트를 생성하세요.</Empty>
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
              {superseded.slice(0, 10).map(i => (
                <ItemRow key={i.id} item={i} kind="superseded" busy={busyId === i.id} />
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
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8, padding: '14px 16px', marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{item.name}</span>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: color + '25', color,
          }}>{labelByKind[kind]}</span>
        </div>
        <div style={{ fontSize: 12, color: C.textMid }}>
          발효: {item.effective_from || '?'}
          {item.effective_until && ` ~ ${item.effective_until}`}
          <span style={{ marginLeft: 10 }}>· 작성: {new Date(item.created_at).toLocaleString('ko-KR')}</span>
        </div>
      </div>

      {kind === 'draft' && (
        <div style={{ display: 'flex', gap: 6 }}>
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
