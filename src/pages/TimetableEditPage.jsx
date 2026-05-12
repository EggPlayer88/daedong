// ═══════════════════════════════════════════════════════════════════
//  TimetableEditPage.jsx — 드래프트 시간표 편집 (Phase 4C-1, 카드 바구니 방식)
// ═══════════════════════════════════════════════════════════════════
//  메탈 모델: 시간표 = 서랍, 학급-과목-교사 묶음 = 카드
//
//  인터랙션 5가지 (handleCellClick 라우터):
//   ① [점유된 셀 + 카드 미선택] → 카드를 바구니로 빼냄
//   ② [빈 셀 + 카드 선택] → 그 자리에 배치 (바구니에서 제거)
//   ③ [점유된 셀 + 카드 선택] → 자동 교환 (기존 카드가 바구니로, 선택 카드가 자리로)
//   ④ [빈 셀 + 카드 미선택] → "+ 새 카드 추가" 메뉴 → NewCardModal
//   ⑤ [특별활동 셀] → 차단
//
//  저장 시 바구니가 비어있어야만 가능. dirty 판정에 바구니도 포함.
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo, useRef } from 'react';
import { getTimetable, updateTimetableData } from '../lib/timetablesAPI';
import {
  DAYS, CLS, SBJ, TCH, CLR, gS, gT, gC, getSP, isV,
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

// 슬롯 비교 — 일반 슬롯은 sid+tid, special 은 name+tid, 둘 다 없으면 같다
function slotsEqual(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if (a.type === 'special') return a.name === b.name && (a.tid || null) === (b.tid || null);
  return a.sid === b.sid && a.tid === b.tid;
}


export default function TimetableEditPage({ timetableId, currentUser, onDone }) {
  // ── 로드 상태 ──
  const [meta, setMeta] = useState(null);
  const [originalData, setOriginalData] = useState(null);
  const [editedData, setEditedData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // ── 편집 상태 ──
  const [selectedClassId, setSelectedClassId] = useState('c1');
  const [basket, setBasket] = useState([]);              // [{ id, sid, tid, origin }]
  const [selectedCardId, setSelectedCardId] = useState(null);
  const [pendingEvents, setPendingEvents] = useState([]); // edit_log.events 누적 후보
  const [emptyCellMenu, setEmptyCellMenu] = useState(null); // { classId, day, period, anchor }
  const [newCardModal, setNewCardModal] = useState(null);   // { classId, day, period }

  // ── 저장 상태 ──
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [savedFlash, setSavedFlash] = useState(false);

  // 카드 임시 ID 발급기 (단조 증가, 세션 내에서만 유효)
  const cardIdRef = useRef(0);
  const genCardId = () => `card-${++cardIdRef.current}`;

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

  // ── 변경된 셀 키 집합 (originalData 와 editedData 비교) ──
  const changedKeys = useMemo(() => {
    if (!originalData || !editedData) return new Set();
    const set = new Set();
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

  // dirty 판정: 변경 셀이 있거나, 바구니에 카드가 있으면 더러움
  const dirty = changedKeys.size > 0 || basket.length > 0;

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

  // ── 충돌/시수 경고 ──
  const warnings = useMemo(() => {
    if (!editedData) return { teacherCollisions: [], hourDeltas: [] };
    return computeWarnings(editedData);
  }, [editedData]);

  // ── 이벤트 push 헬퍼 ──
  const pushEvent = (event) => setPendingEvents(prev => [...prev, event]);
  const userId = currentUser?.id || 'unknown';

  // ────────── 5가지 셀 클릭 액션 ──────────

  // ① 점유된 셀 → 바구니로 이동 (카드 미선택일 때)
  const moveCellToBasket = (classId, day, period, slot) => {
    const k = cellKey(day, period);
    setEditedData(prev => {
      const next = { ...prev };
      const cls = { ...(next[classId] || {}) };
      delete cls[k];
      next[classId] = cls;
      return next;
    });
    setBasket(prev => [...prev, {
      id: genCardId(),
      sid: slot.sid, tid: slot.tid,
      origin: { classId, day, period },
    }]);
    pushEvent({
      ts: new Date().toISOString(), user: userId,
      type: 'cell_clear',
      before: { sid: slot.sid ?? null, tid: slot.tid ?? null },
      after: null,
      location: { class: classId, day, period },
    });
  };

  // ② 빈 셀 → 선택된 카드 배치
  const placeCardOnCell = (classId, day, period, cardId) => {
    const card = basket.find(c => c.id === cardId);
    if (!card) return;
    const k = cellKey(day, period);
    setEditedData(prev => {
      const next = { ...prev };
      const cls = { ...(next[classId] || {}) };
      cls[k] = { sid: card.sid, tid: card.tid };
      next[classId] = cls;
      return next;
    });
    setBasket(prev => prev.filter(c => c.id !== cardId));
    setSelectedCardId(null);
    pushEvent({
      ts: new Date().toISOString(), user: userId,
      type: 'cell_edit',
      before: null,
      after: { sid: card.sid, tid: card.tid },
      location: { class: classId, day, period },
    });
  };

  // ③ 점유된 셀 → 자동 교환 (기존 카드가 바구니로, 선택 카드가 자리로)
  const swapCardOnCell = (classId, day, period, oldSlot, cardId) => {
    const card = basket.find(c => c.id === cardId);
    if (!card) return;
    const k = cellKey(day, period);
    // 데이터: 그 자리에 선택 카드의 내용 배치
    setEditedData(prev => {
      const next = { ...prev };
      const cls = { ...(next[classId] || {}) };
      cls[k] = { sid: card.sid, tid: card.tid };
      next[classId] = cls;
      return next;
    });
    // 바구니: 선택 카드 제거 + 기존 슬롯을 새 카드로 추가
    setBasket(prev => [
      ...prev.filter(c => c.id !== cardId),
      {
        id: genCardId(),
        sid: oldSlot.sid, tid: oldSlot.tid,
        origin: { classId, day, period },
      },
    ]);
    setSelectedCardId(null);
    // edit_log: clear + edit 2건을 같은 타임스탬프로 push
    const ts = new Date().toISOString();
    setPendingEvents(prev => [
      ...prev,
      {
        ts, user: userId, type: 'cell_clear',
        before: { sid: oldSlot.sid ?? null, tid: oldSlot.tid ?? null },
        after: null,
        location: { class: classId, day, period },
      },
      {
        ts, user: userId, type: 'cell_edit',
        before: null,
        after: { sid: card.sid, tid: card.tid },
        location: { class: classId, day, period },
      },
    ]);
  };

  // ④ 새 카드 추가 (모달에서 확정 시 호출)
  const addNewCard = (classId, day, period, sid, tid) => {
    const k = cellKey(day, period);
    setEditedData(prev => {
      const next = { ...prev };
      const cls = { ...(next[classId] || {}) };
      cls[k] = { sid, tid };
      next[classId] = cls;
      return next;
    });
    pushEvent({
      ts: new Date().toISOString(), user: userId,
      type: 'cell_edit',
      before: null,
      after: { sid, tid },
      location: { class: classId, day, period },
    });
    setNewCardModal(null);
  };

  // ── 셀 클릭 라우터 ──
  const handleCellClick = (day, period, slot, mouseEvent) => {
    if (slot && slot.type === 'special') return;  // ⑤ 특별활동 차단
    const classId = selectedClassId;

    // 빈 셀 메뉴가 떠있으면 먼저 닫기 (다른 셀 클릭 시 이전 메뉴 정리)
    setEmptyCellMenu(null);

    if (selectedCardId) {
      if (slot) {
        swapCardOnCell(classId, day, period, slot, selectedCardId);
      } else {
        placeCardOnCell(classId, day, period, selectedCardId);
      }
    } else {
      if (slot) {
        moveCellToBasket(classId, day, period, slot);
      } else {
        // 빈 셀 + 카드 미선택 → 작은 메뉴 띄우기
        const rect = mouseEvent.currentTarget.getBoundingClientRect();
        setEmptyCellMenu({
          classId, day, period,
          anchor: {
            top: rect.top + window.scrollY,
            left: rect.right + 8 + window.scrollX,
          },
        });
      }
    }
  };

  // ── 카드 클릭 (선택/해제) ──
  const handleCardClick = (cardId) => {
    setSelectedCardId(prev => prev === cardId ? null : cardId);
  };

  // ── 학급 변경 ──
  //   카드 선택은 유지 (다른 학급으로 이동 가능해야 함)
  const changeClass = (cid) => {
    setEmptyCellMenu(null);
    setSelectedClassId(cid);
  };

  // ── 저장 ──
  const handleSave = async () => {
    if (basket.length > 0) {
      setSaveError(`바구니에 ${basket.length}장의 카드가 있습니다. 모두 시간표에 배치한 후 저장해주세요.`);
      return;
    }
    if (changedKeys.size === 0 || saving) return;
    setSaving(true); setSaveError(null);
    try {
      const updated = await updateTimetableData(timetableId, editedData, pendingEvents);
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
      const parts = [];
      if (changedKeys.size > 0) parts.push(`저장하지 않은 변경 ${changedKeys.size}개`);
      if (basket.length > 0) parts.push(`바구니에 ${basket.length}장의 카드`);
      const msg = `${parts.join('와 ')}가 있습니다.\n정말 나가시겠습니까?`;
      if (!window.confirm(msg)) return;
    }
    onDone?.();
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
  const counterText = (() => {
    const parts = [];
    parts.push(changedKeys.size > 0 ? `변경 사항 ${changedKeys.size}개` : '변경 없음');
    if (basket.length > 0) parts.push(`바구니 ${basket.length}장`);
    return parts.join(' · ');
  })();
  const saveBlockedByBasket = basket.length > 0;
  const saveDisabled = saving || saveBlockedByBasket || changedKeys.size === 0;

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
            <span style={{ marginLeft: 10 }}>· 셀 클릭 = 카드를 바구니로 빼냄 · 바구니 카드 선택 후 빈 셀 클릭 = 배치 · 점유된 셀 클릭 = 자동 교환</span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            fontSize: 12,
            color: dirty ? (basket.length > 0 ? C.yellow : C.yellow) : C.textDim,
          }}>
            {counterText}
          </span>
          <button
            onClick={handleSave}
            disabled={saveDisabled}
            title={saveBlockedByBasket ? '바구니를 모두 비운 후 저장할 수 있습니다' : ''}
            style={saveBtnStyle(saveDisabled)}
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
        slots={slotsForClass}
        originalSlots={(originalData && originalData[selectedClassId]) || {}}
        hasSelectedCard={!!selectedCardId}
        onCellClick={handleCellClick}
      />

      <div style={{ fontSize: 11, color: C.textMid, marginTop: 10, lineHeight: 1.6 }}>
        💡 노란 테두리 = 변경된 셀 · 회색 음영 = 비활성 교시 · 보라색 "창체" 셀은 편집 불가
      </div>

      {/* 카드 바구니 */}
      <CardBasket
        cards={basket}
        selectedCardId={selectedCardId}
        onCardClick={handleCardClick}
      />

      {/* 빈 셀 메뉴 */}
      {emptyCellMenu && (
        <EmptyCellMenu
          anchor={emptyCellMenu.anchor}
          onAdd={() => {
            setNewCardModal({
              classId: emptyCellMenu.classId,
              day: emptyCellMenu.day,
              period: emptyCellMenu.period,
            });
            setEmptyCellMenu(null);
          }}
          onClose={() => setEmptyCellMenu(null)}
        />
      )}

      {/* 새 카드 모달 */}
      {newCardModal && (
        <NewCardModal
          target={newCardModal}
          onAdd={(sid, tid) => addNewCard(newCardModal.classId, newCardModal.day, newCardModal.period, sid, tid)}
          onClose={() => setNewCardModal(null)}
        />
      )}
    </PageShell>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  편집 가능한 그리드
// ═══════════════════════════════════════════════════════════════════
function EditableGrid({ slots, originalSlots, hasSelectedCard, onCellClick }) {
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
                  hasSelectedCard={hasSelectedCard}
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


function EditableCell({ day, period, slot, originalSlot, hasSelectedCard, onClick }) {
  const base = {
    padding: '6px', borderBottom: `1px solid ${C.border}`,
    borderLeft: `1px solid ${C.border}`, height: 56, verticalAlign: 'middle',
    textAlign: 'center', position: 'relative',
  };

  // 비활성 교시
  if (!isV(day, period)) {
    return <td style={{ ...base, background: '#080b14', opacity: 0.25 }} />;
  }

  const sp = getSP(day, period);
  const isSpecial = sp && (!slot || slot.type === 'special');
  const changed = !slotsEqual(slot, originalSlot);

  // 특별활동 — 편집 불가
  if (isSpecial) {
    return (
      <td style={{ ...base, background: '#1a1530', cursor: 'not-allowed' }} title="특별활동 슬롯은 편집할 수 없습니다">
        <div style={{ fontSize: 10, color: C.purple, fontWeight: 600 }}>창체</div>
      </td>
    );
  }

  // hover 색상: 카드 선택 + 점유 셀이면 노란 (교환 의미), 그 외 액센트
  const hoverColor = (slot && hasSelectedCard) ? C.yellow : C.accent;

  // 빈 슬롯
  if (!slot) {
    return (
      <td
        style={{
          ...base,
          background: hasSelectedCard ? C.accentSoft : 'transparent',
          cursor: 'pointer',
          ...(changed ? { boxShadow: `inset 0 0 0 2px ${C.yellow}` } : {}),
        }}
        onClick={(e) => onClick(day, period, null, e)}
        onMouseEnter={e => { e.currentTarget.style.outline = `1px solid ${hoverColor}`; }}
        onMouseLeave={e => { e.currentTarget.style.outline = 'none'; }}
      >
        <div style={{ fontSize: 10, color: hasSelectedCard ? C.accent : C.textDim }}>
          {hasSelectedCard ? '↓ 여기에 배치' : '＋ 비어있음'}
        </div>
        {changed && <ChangedDot />}
      </td>
    );
  }

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
      onMouseEnter={e => { e.currentTarget.style.outline = `1px solid ${hoverColor}`; }}
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
//  카드 바구니
// ═══════════════════════════════════════════════════════════════════
function CardBasket({ cards, selectedCardId, onCardClick }) {
  return (
    <div style={{
      marginTop: 16,
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
      padding: '12px 14px',
    }}>
      <div style={{
        fontSize: 12, color: C.textMid, fontWeight: 600,
        marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        🪣 카드 바구니 ({cards.length}장)
      </div>

      {cards.length === 0 ? (
        <div style={{
          padding: '14px 16px',
          background: C.bg,
          borderRadius: 8,
          color: C.textDim, fontSize: 12, lineHeight: 1.6,
          border: `1px dashed ${C.border}`,
        }}>
          🪣 빈 바구니 — 셀을 클릭해 카드를 꺼내거나, 빈 셀에 새 카드를 추가하세요.
        </div>
      ) : (
        <div style={{
          display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6,
        }}>
          {cards.map(card => (
            <BasketCard
              key={card.id}
              card={card}
              selected={selectedCardId === card.id}
              onClick={() => onCardClick(card.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}


function BasketCard({ card, selected, onClick }) {
  const subj = gS(card.sid);
  const clr = CLR[subj?.ci ?? 0] || { bg: '#888', tx: '#fff' };
  const teacher = gT(card.tid);
  const isNew = !card.origin;
  const originText = card.origin
    ? `${gC(card.origin.classId)?.name || '?'} / ${card.origin.day}${card.origin.period}`
    : '신규 카드';

  return (
    <div
      onClick={onClick}
      style={{
        minWidth: 150, flex: '0 0 auto',
        background: selected ? C.accentSoft : C.bg,
        border: `1.5px solid ${selected ? C.accent : C.border}`,
        borderRadius: 8, padding: '10px 12px',
        cursor: 'pointer', transition: 'all 0.1s',
        fontFamily: font,
      }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = C.borderLight; }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = C.border; }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, color: clr.bg, marginBottom: 3 }}>
        {subj?.name || '?'}
      </div>
      <div style={{ fontSize: 11, color: C.text, marginBottom: 8 }}>
        {teacher?.name || '?'}
      </div>
      <div style={{ fontSize: 9, color: isNew ? C.purple : C.textDim }}>
        원래: {originText}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  빈 셀 메뉴 (작은 인라인 메뉴 — "+ 새 카드 추가")
// ═══════════════════════════════════════════════════════════════════
function EmptyCellMenu({ anchor, onAdd, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose();
    };
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    const t = setTimeout(() => document.addEventListener('mousedown', onDocClick), 0);
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const W = 160;
  let left = anchor.left;
  if (typeof window !== 'undefined' && left + W > window.innerWidth - 12) {
    left = Math.max(12, anchor.left - W - 16);
  }

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute', top: anchor.top, left, width: W,
        background: C.card, border: `1px solid ${C.borderLight}`,
        borderRadius: 8, padding: 8, zIndex: 1000,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        fontFamily: font,
      }}
    >
      <button
        onClick={onAdd}
        style={{
          width: '100%', padding: '8px 12px',
          fontSize: 12, fontFamily: font, fontWeight: 600,
          background: C.accent, color: '#fff',
          border: 'none', borderRadius: 6, cursor: 'pointer',
        }}
      >
        + 새 카드 추가
      </button>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  새 카드 모달
// ═══════════════════════════════════════════════════════════════════
function NewCardModal({ target, onAdd, onClose }) {
  const [sid, setSid] = useState('');
  const [tid, setTid] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const canAdd = !!(sid && tid);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.6)', zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: font,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: 320, background: C.card,
          border: `1px solid ${C.borderLight}`, borderRadius: 12, padding: 18,
          color: C.text,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>+ 새 카드 추가</div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: C.textDim,
            fontSize: 14, cursor: 'pointer', padding: '2px 6px',
          }}>✕</button>
        </div>
        <div style={{ fontSize: 11, color: C.textMid, marginBottom: 14 }}>
          {gC(target.classId)?.name} · {target.day} {target.period}교시
        </div>

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
          <button onClick={() => onAdd(sid, tid)} disabled={!canAdd} style={popBtnStyle({ primary: true, disabled: !canAdd })}>
            추가
          </button>
          <button onClick={onClose} style={popBtnStyle()}>
            취소
          </button>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
//  경고 배너 — 충돌 + 시수 편차 (모두 경고만)
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


function computeWarnings(data) {
  const slotMap = new Map();       // 'day-period|tid' → classIds[]
  const teacherHours = new Map();  // tid → 시수

  for (const cid of Object.keys(data)) {
    const cls = data[cid] || {};
    for (const k of Object.keys(cls)) {
      const slot = cls[k];
      if (!slot || slot.type === 'special') continue;
      const tid = slot.tid;
      if (!tid) continue;
      teacherHours.set(tid, (teacherHours.get(tid) || 0) + 1);
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
    background: disabled ? C.border : C.accent,
    color: disabled ? C.textDim : '#fff',
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

function popBtnStyle({ primary = false, disabled = false } = {}) {
  return {
    flex: 1,
    padding: '7px 10px', fontSize: 12, fontFamily: font, fontWeight: 500,
    background: primary ? C.accent : 'transparent',
    color: primary ? '#fff' : C.text,
    border: `1px solid ${primary ? C.accent : C.border}`,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}


function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
