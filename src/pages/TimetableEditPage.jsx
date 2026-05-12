// ═══════════════════════════════════════════════════════════════════
//  TimetableEditPage.jsx — 드래프트 시간표 단일 셀 편집 (Phase 4C-1)
// ═══════════════════════════════════════════════════════════════════
//  - 드래프트 시간표만 편집 가능 (활성/이전은 진입 불가)
//  - 학급 뷰 그리드 + 인라인 팝오버 (셀 옆 작은 팝업)
//  - 변경사항은 클라이언트 state 에 보관 → 저장 버튼 클릭 시 일괄 반영
//  - 저장 시 timetables.data + edit_log.events 함께 업데이트
//  - 충돌(같은 교사 동시간) / 시수 편차는 경고만 (강제 차단 X — 4C-2 에서)
//  - 특별활동(type:'special') 슬롯은 편집 대상 제외
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from 'react';
import { getTimetable, updateTimetableData } from '../lib/timetablesAPI';
import {
  DAYS, DP, CLS, SBJ, TCH, CLR, gS, gT, gC, getSP, isV,
} from '../lib/timetableData';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', yellow:'#fbbf24', yellowSoft:'#fbbf2415',
  red:'#f87171', purple:'#a78bfa', purpleSoft:'#a78bfa15',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

const PERIODS = [1, 2, 3, 4, 5, 6, 7];
const cellKey = (day, period) => `${day}-${period}`;
const changeKey = (cid, day, period) => `${cid}|${day}-${period}`;

// 슬롯 비교: 둘 다 일반 슬롯이면 sid+tid 동일 여부, 그 외엔 깊은 비교(간단화)
function slotsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'special') return a.name === b.name && (a.tid || null) === (b.tid || null);
  // 일반 슬롯
  return a.sid === b.sid && a.tid === b.tid;
}


export default function TimetableEditPage({ timetableId, currentUser, onDone }) {
  // ── 로드 상태 ──
  const [meta, setMeta] = useState(null);          // 시간표 row (data 제외 보존용)
  const [originalData, setOriginalData] = useState(null);  // 로드 시점 스냅샷 (변경 검출 기준)
  const [editedData, setEditedData] = useState(null);      // 현재 작업본
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── 편집 상태 ──
  const [selectedClassId, setSelectedClassId] = useState('c1');
  const [popover, setPopover] = useState(null);    // { classId, day, period, slot, anchor:{top,left} } | null
  const [pendingEvents, setPendingEvents] = useState([]);  // edit_log.events 에 누적할 후보
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // ── 초기 로드 ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true); setError(null);
      try {
        const tt = await getTimetable(timetableId);
        if (cancelled) return;
        if (tt.status !== 'draft') {
          setError('드래프트 시간표만 편집할 수 있습니다.');
          setLoading(false);
          return;
        }
        const data = tt.data || {};
        setMeta(tt);
        setOriginalData(deepClone(data));
        setEditedData(deepClone(data));
      } catch (e) {
        if (!cancelled) setError(e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [timetableId]);

  // ── 변경 여부 / 카운터 (변경된 셀 집합) ──
  const changedKeys = useMemo(() => {
    if (!originalData || !editedData) return new Set();
    const set = new Set();
    // 두 데이터의 모든 (classId, key) 합집합 순회
    const classIds = new Set([...Object.keys(originalData), ...Object.keys(editedData)]);
    classIds.forEach(cid => {
      const oCls = originalData[cid] || {};
      const eCls = editedData[cid] || {};
      const keys = new Set([...Object.keys(oCls), ...Object.keys(eCls)]);
      keys.forEach(k => {
        if (!slotsEqual(oCls[k], eCls[k])) {
          const [day, periodStr] = k.split('-');
          set.add(changeKey(cid, day, periodStr));
        }
      });
    });
    return set;
  }, [originalData, editedData]);

  const dirty = changedKeys.size > 0;

  // ── 이탈 보호 (브라우저 새로고침/닫기) ──
  useEffect(() => {
    if (!dirty) return;
    const handler = (e) => {
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  // ── 충돌/경고 계산 (memoize) ──
  const warnings = useMemo(() => {
    if (!editedData) return { teacherCollisions: [], hourDeltas: [] };
    return computeWarnings(editedData);
  }, [editedData]);

  // ── 셀 클릭 핸들러 ──
  const handleCellClick = (day, period, slot, mouseEvent) => {
    // 특별활동 셀은 편집 대상 제외 (4C-1)
    if (slot && slot.type === 'special') return;

    // 팝오버 위치 계산 (셀 옆에 띄움)
    const rect = mouseEvent.currentTarget.getBoundingClientRect();
    setPopover({
      classId: selectedClassId,
      day, period,
      slot: slot ? { ...slot } : null,
      anchor: { top: rect.top + window.scrollY, left: rect.right + 8 + window.scrollX, height: rect.height },
    });
  };

  // ── 셀 변경 적용 ──
  const applyChange = (newSlot) => {
    if (!popover) return;
    const { classId, day, period, slot: beforeSlot } = popover;
    const k = cellKey(day, period);

    setEditedData(prev => {
      const next = { ...prev };
      const cls = { ...(next[classId] || {}) };
      if (newSlot === null) {
        delete cls[k];
      } else {
        cls[k] = newSlot;
      }
      next[classId] = cls;
      return next;
    });

    // edit_log 후보에 누적
    const before = beforeSlot
      ? { sid: beforeSlot.sid ?? null, tid: beforeSlot.tid ?? null }
      : null;
    const after = newSlot
      ? { sid: newSlot.sid ?? null, tid: newSlot.tid ?? null }
      : null;
    setPendingEvents(prev => [
      ...prev,
      {
        ts: new Date().toISOString(),
        user: currentUser?.id || 'unknown',
        type: newSlot === null ? 'cell_clear' : 'cell_edit',
        before,
        after,
        location: { class: classId, day, period },
      },
    ]);

    setPopover(null);
  };

  // ── 저장 ──
  const handleSave = async () => {
    if (!dirty || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const updated = await updateTimetableData(timetableId, editedData, pendingEvents);
      // 성공: 새 스냅샷을 originalData 로 흡수
      setOriginalData(deepClone(updated.data || editedData));
      setEditedData(deepClone(updated.data || editedData));
      setPendingEvents([]);
      setMeta(updated);
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2200);
    } catch (e) {
      setSaveError(e.message);
    } finally {
      setSaving(false);
    }
  };

  // ── 뒤로가기 ──
  const handleBack = () => {
    if (dirty) {
      const ok = window.confirm(`저장하지 않은 변경 ${changedKeys.size}개가 있습니다.\n정말 나가시겠습니까?`);
      if (!ok) return;
    }
    onDone?.();
  };

  // ── 학급 변경 시 팝오버 닫기 ──
  const changeClass = (cid) => {
    setPopover(null);
    setSelectedClassId(cid);
  };

  // ─────────── 렌더 ───────────
  if (loading) {
    return (
      <PageShell>
        <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>
      </PageShell>
    );
  }

  if (error) {
    return (
      <PageShell>
        <div style={{ marginBottom: 14 }}>
          <button onClick={onDone} style={backBtnStyle()}>← 목록으로</button>
        </div>
        <div style={{ padding: '12px 14px', background: '#f8717115', color: C.red, borderRadius: 8, fontSize: 13 }}>
          오류: {error}
        </div>
      </PageShell>
    );
  }

  const slotsForClass = (editedData && editedData[selectedClassId]) || {};

  return (
    <PageShell>
      {/* 헤더 */}
      <div style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={handleBack} style={backBtnStyle()}>← 목록으로</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10 }}>
            ✏️ {meta?.name || '시간표 편집'}
            <span style={{
              fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
              background: C.yellow + '25', color: C.yellow,
            }}>드래프트</span>
          </h2>
          <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>
            발효: {meta?.effective_from || '?'}{meta?.effective_until && ` ~ ${meta.effective_until}`}
            <span style={{ marginLeft: 10 }}>· 셀을 클릭해 교사/과목을 변경하세요. 저장 전까지는 학교에 반영되지 않습니다.</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12, color: dirty ? C.yellow : C.textDim }}>
            {dirty ? `변경 사항 ${changedKeys.size}개` : '변경 없음'}
          </span>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            style={saveBtnStyle(!dirty || saving)}
          >
            {saving ? '저장 중...' : '💾 저장'}
          </button>
        </div>
      </div>

      {/* 저장 결과 */}
      {savedFlash && (
        <Banner color={C.green}>
          ✅ 저장되었습니다. (변경 이력 누적: {(meta?.edit_log?.events?.length) || 0}건)
        </Banner>
      )}
      {saveError && <Banner color={C.red}>❌ 저장 실패: {saveError}</Banner>}

      {/* 충돌/시수 경고 */}
      <WarningsBanner warnings={warnings} />

      {/* 학급 셀렉터 */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {CLS.map(c => (
          <button
            key={c.id}
            onClick={() => changeClass(c.id)}
            style={classChipStyle(selectedClassId === c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 그리드 */}
      <EditableGrid
        classId={selectedClassId}
        slots={slotsForClass}
        originalSlots={(originalData && originalData[selectedClassId]) || {}}
        onCellClick={handleCellClick}
      />

      <div style={{ fontSize: 11, color: C.textMid, marginTop: 10, lineHeight: 1.6 }}>
        💡 노란 테두리 = 변경된 셀 · 회색 음영 = 비활성 교시 · 보라색 "창체" 셀은 편집 불가 (4C-1 범위 외)
      </div>

      {/* 팝오버 */}
      {popover && (
        <CellPopover
          popover={popover}
          onApply={applyChange}
          onClose={() => setPopover(null)}
        />
      )}
    </PageShell>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  편집 가능한 그리드
// ═══════════════════════════════════════════════════════════════════
function EditableGrid({ classId, slots, originalSlots, onCellClick }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: C.bg }}>
            <th style={{ padding: '10px 8px', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontWeight: 500, width: 60 }}>교시</th>
            {DAYS.map(d => (
              <th key={d} style={{ padding: '10px 8px', borderBottom: `1px solid ${C.border}`, color: C.text, fontWeight: 600, minWidth: 100 }}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERIODS.map(p => (
            <tr key={p}>
              <td style={{ padding: '8px', textAlign: 'center', borderBottom: `1px solid ${C.border}`, color: C.textDim, fontSize: 11 }}>{p}</td>
              {DAYS.map(d => (
                <EditableCell
                  key={`${d}-${p}`}
                  day={d}
                  period={p}
                  slot={slots[cellKey(d, p)]}
                  originalSlot={originalSlots[cellKey(d, p)]}
                  onClick={onCellClick}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


function EditableCell({ day, period, slot, originalSlot, onClick }) {
  const base = {
    padding: '6px', borderBottom: `1px solid ${C.border}`,
    borderLeft: `1px solid ${C.border}`, height: 56, verticalAlign: 'middle',
    textAlign: 'center', position: 'relative',
  };

  // 비활성 교시 (요일별 최대 교시 초과)
  if (!isV(day, period)) {
    return <td style={{ ...base, background: '#080b14', opacity: 0.25 }} />;
  }

  const sp = getSP(day, period);
  const isSpecial = sp && (!slot || slot.type === 'special');
  const changed = !slotsEqual(slot, originalSlot);

  // 특별활동 — 편집 불가
  if (isSpecial) {
    return (
      <td style={{ ...base, background: '#1a1530', cursor: 'not-allowed' }} title="특별활동 슬롯은 편집할 수 없습니다 (4C-1 범위 외)">
        <div style={{ fontSize: 10, color: C.purple, fontWeight: 600 }}>창체</div>
      </td>
    );
  }

  // 빈 슬롯
  if (!slot) {
    return (
      <td
        style={{
          ...base,
          background: 'transparent',
          cursor: 'pointer',
          ...(changed ? { boxShadow: `inset 0 0 0 2px ${C.yellow}` } : {}),
        }}
        onClick={(e) => onClick(day, period, null, e)}
        onMouseEnter={e => { e.currentTarget.style.outline = `1px solid ${C.accent}`; }}
        onMouseLeave={e => { e.currentTarget.style.outline = 'none'; }}
      >
        <div style={{ fontSize: 10, color: C.textDim }}>＋ 비어있음</div>
        {changed && <ChangedDot />}
      </td>
    );
  }

  // self_study 등 type 가진 슬롯은 표시만 (편집은 type='special' 제외하고 가능)
  const subj = gS(slot.sid);
  const clr = CLR[subj?.ci ?? 0] || { bg: '#444', tx: '#fff' };
  const teacherName = gT(slot.tid)?.name;

  return (
    <td
      style={{
        ...base,
        background: clr.bg + '22',
        borderLeft: `3px solid ${clr.bg}`,
        cursor: 'pointer',
        ...(changed ? { boxShadow: `inset 0 0 0 2px ${C.yellow}` } : {}),
      }}
      onClick={(e) => onClick(day, period, slot, e)}
      onMouseEnter={e => { e.currentTarget.style.outline = `1px solid ${C.accent}`; }}
      onMouseLeave={e => { e.currentTarget.style.outline = 'none'; }}
    >
      <div style={{ fontSize: 11, fontWeight: 600, color: clr.bg }}>
        {subj?.name || '?'}
      </div>
      <div style={{ fontSize: 9, color: C.textDim, marginTop: 2 }}>{teacherName || '-'}</div>
      {changed && <ChangedDot />}
    </td>
  );
}


function ChangedDot() {
  return (
    <div style={{
      position: 'absolute', top: 3, right: 4,
      width: 7, height: 7, borderRadius: '50%',
      background: C.yellow,
    }} />
  );
}


// ═══════════════════════════════════════════════════════════════════
//  인라인 팝오버 — 셀 옆에 띄움
// ═══════════════════════════════════════════════════════════════════
function CellPopover({ popover, onApply, onClose }) {
  const { classId, day, period, slot, anchor } = popover;
  const [sid, setSid] = useState(slot?.sid || '');
  const [tid, setTid] = useState(slot?.tid || '');
  const popRef = useRef(null);

  // ESC 닫기 + 바깥 클릭 닫기
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const onDocClick = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // 같은 클릭 이벤트로 닫히지 않게 next tick 에 바인딩
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDocClick);
      clearTimeout(t);
    };
  }, [onClose]);

  // 화면 오른쪽 넘침 방지 — 셀 너비 + 팝오버 너비가 뷰포트 초과하면 왼쪽으로
  const POP_WIDTH = 320;
  let left = anchor.left;
  if (typeof window !== 'undefined' && left + POP_WIDTH > window.innerWidth - 12) {
    // 셀 왼쪽으로 띄움
    left = Math.max(12, anchor.left - POP_WIDTH - 16);
  }

  const canChange = (sid !== (slot?.sid || '') || tid !== (slot?.tid || '')) && sid && tid;
  const canClear = !!slot;

  const handleApply = () => {
    if (!canChange) return;
    onApply({ sid, tid });
  };
  const handleClear = () => {
    if (!canClear) return;
    onApply(null);
  };

  return (
    <div
      ref={popRef}
      style={{
        position: 'absolute',
        top: anchor.top,
        left,
        width: POP_WIDTH,
        background: C.card,
        border: `1px solid ${C.borderLight}`,
        borderRadius: 10,
        padding: 14,
        boxShadow: '0 12px 32px rgba(0,0,0,0.45)',
        zIndex: 1000,
        fontFamily: font, color: C.text,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {gC(classId)?.name} · {day} {period}교시
        </div>
        <button onClick={onClose} style={{
          background: 'transparent', border: 'none', color: C.textDim,
          fontSize: 14, cursor: 'pointer', padding: '2px 6px',
        }}>✕</button>
      </div>

      {slot ? (
        <div style={{ fontSize: 11, color: C.textMid, marginBottom: 10, lineHeight: 1.5 }}>
          현재: <span style={{ color: C.text, fontWeight: 600 }}>{gS(slot.sid)?.name || '?'}</span>
          {' / '}
          <span style={{ color: C.text, fontWeight: 600 }}>{gT(slot.tid)?.name || '?'}</span>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: C.textMid, marginBottom: 10 }}>
          현재: <span style={{ color: C.textDim }}>비어있음</span>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <label style={lblStyle()}>과목</label>
        <select value={sid} onChange={e => setSid(e.target.value)} style={selStyle()}>
          <option value="">— 과목 선택 —</option>
          {SBJ.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={lblStyle()}>교사</label>
        <select value={tid} onChange={e => setTid(e.target.value)} style={selStyle()}>
          <option value="">— 교사 선택 —</option>
          {TCH.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={handleApply} disabled={!canChange} style={popBtnStyle({ primary: true, disabled: !canChange })}>
          변경
        </button>
        <button onClick={handleClear} disabled={!canClear} style={popBtnStyle({ danger: true, disabled: !canClear })}>
          이 셀 비우기
        </button>
        <button onClick={onClose} style={popBtnStyle()}>
          닫기
        </button>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  경고 배너 — 충돌 + 시수 편차 (모두 경고만, 강제 차단 X)
// ═══════════════════════════════════════════════════════════════════
function WarningsBanner({ warnings }) {
  const { teacherCollisions, hourDeltas } = warnings;
  const total = teacherCollisions.length + hourDeltas.length;
  if (total === 0) return null;

  return (
    <div style={{
      padding: '10px 14px', marginBottom: 12,
      background: C.yellowSoft, border: `1px solid ${C.yellow}40`,
      borderRadius: 8, fontSize: 12, color: C.yellow, lineHeight: 1.6,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>⚠️ 경고 {total}건 (저장은 가능합니다)</div>
      {teacherCollisions.slice(0, 5).map((c, i) => (
        <div key={`col-${i}`}>
          • <strong>{gT(c.tid)?.name || c.tid}</strong> 가 {c.day} {c.period}교시에 {c.classes.length}개 학급에 동시 배정 (
          {c.classes.map(id => gC(id)?.name).filter(Boolean).join(', ')})
        </div>
      ))}
      {teacherCollisions.length > 5 && (
        <div style={{ color: C.textMid, marginTop: 2 }}>...외 충돌 {teacherCollisions.length - 5}건</div>
      )}
      {hourDeltas.slice(0, 5).map((h, i) => (
        <div key={`hr-${i}`}>
          • <strong>{gT(h.tid)?.name || h.tid}</strong> 총 시수 {h.actual}시간 (표준 {h.expected}시간, {h.delta > 0 ? '+' : ''}{h.delta})
        </div>
      ))}
      {hourDeltas.length > 5 && (
        <div style={{ color: C.textMid, marginTop: 2 }}>...외 시수 편차 {hourDeltas.length - 5}건</div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  경고 계산
// ═══════════════════════════════════════════════════════════════════
function computeWarnings(data) {
  // 1) 교사 동시간 중복: (day, period) -> tid -> [classIds]
  const slotMap = new Map();  // key: 'day-period|tid'  → classIds[]
  const teacherHours = new Map();  // tid → 시수

  for (const cid of Object.keys(data)) {
    const cls = data[cid] || {};
    for (const k of Object.keys(cls)) {
      const slot = cls[k];
      if (!slot || slot.type === 'special') continue;
      const tid = slot.tid;
      if (!tid) continue;

      // 시수 카운트
      teacherHours.set(tid, (teacherHours.get(tid) || 0) + 1);

      // 동시간 중복 추적
      const mapKey = `${k}|${tid}`;
      if (!slotMap.has(mapKey)) slotMap.set(mapKey, []);
      slotMap.get(mapKey).push(cid);
    }
  }

  const teacherCollisions = [];
  for (const [mapKey, classes] of slotMap.entries()) {
    if (classes.length >= 2) {
      const [k, tid] = mapKey.split('|');
      const [day, periodStr] = k.split('-');
      teacherCollisions.push({ day, period: Number(periodStr), tid, classes });
    }
  }

  // 2) 시수 편차: |actual - expected| >= 2
  const hourDeltas = [];
  TCH.forEach(t => {
    const expected = (t.as || []).reduce((sum, a) => sum + (a.h || 0), 0);
    const actual = teacherHours.get(t.id) || 0;
    const delta = actual - expected;
    if (Math.abs(delta) >= 2) {
      hourDeltas.push({ tid: t.id, expected, actual, delta });
    }
  });

  return { teacherCollisions, hourDeltas };
}


// ═══════════════════════════════════════════════════════════════════
//  보조 컴포넌트 / 스타일
// ═══════════════════════════════════════════════════════════════════
function PageShell({ children }) {
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px', position: 'relative' }}>
      {children}
    </div>
  );
}

function Banner({ color, children }) {
  return (
    <div style={{
      padding: '10px 14px', marginBottom: 12,
      background: color + '15', color, border: `1px solid ${color}40`,
      borderRadius: 8, fontSize: 12,
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

function saveBtnStyle(disabled) {
  return {
    padding: '8px 16px', fontSize: 13, fontFamily: font, fontWeight: 600,
    background: disabled ? C.border : C.accent, color: disabled ? C.textDim : '#fff',
    border: `1px solid ${disabled ? C.border : C.accent}`,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1,
  };
}

function classChipStyle(active) {
  return {
    padding: '6px 14px', fontSize: 12, fontFamily: font, fontWeight: active ? 700 : 500,
    background: active ? C.accentSoft : 'transparent',
    color: active ? C.accent : C.textMid,
    border: `1px solid ${active ? C.accent : C.border}`,
    borderRadius: 8, cursor: 'pointer',
  };
}

function lblStyle() {
  return { display: 'block', fontSize: 11, color: C.textDim, marginBottom: 4, fontWeight: 600 };
}

function selStyle() {
  return {
    width: '100%', background: C.bg, color: C.text,
    border: `1px solid ${C.border}`, borderRadius: 6,
    padding: '7px 10px', fontSize: 12, fontFamily: font,
  };
}

function popBtnStyle({ primary = false, danger = false, disabled = false } = {}) {
  const bg = primary ? C.accent : danger ? 'transparent' : 'transparent';
  const color = primary ? '#fff' : danger ? C.red : C.text;
  const border = primary ? C.accent : danger ? C.red : C.border;
  return {
    flex: 1,
    padding: '7px 10px', fontSize: 12, fontFamily: font, fontWeight: 500,
    background: bg, color, border: `1px solid ${border}`,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}


// ═══════════════════════════════════════════════════════════════════
//  유틸
// ═══════════════════════════════════════════════════════════════════
function deepClone(obj) {
  // 시간표 data 는 평탄한 객체라 JSON 충분
  return JSON.parse(JSON.stringify(obj));
}
