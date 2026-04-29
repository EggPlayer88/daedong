// ═══════════════════════════════════════════════════════════════════
//  SchoolCalendarPage.jsx — 학사일정 관리 (관리자 전용)
// ═══════════════════════════════════════════════════════════════════
//  schoo_calendar 테이블 CRUD
//  type 5가지: normal / exam / holiday / event / no_school
//  affected_classes: NULL = 전교, 배열 = 특정 학급
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { CLS } from '../lib/timetableData';
import { fmtDate, fmtDateShort } from '../lib/timetableEngine';

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

const TYPE_OPTIONS = [
  { v: 'holiday', l: '휴일', desc: '공휴일/임시휴교 (수업 없음)', color: C.holiday, bg: C.holidayBg },
  { v: 'no_school', l: '재량휴업일', desc: '재량휴업/방학 (수업 없음)', color: C.holiday, bg: C.holidayBg },
  { v: 'exam', l: '시험', desc: '정기고사 (정규 수업 없음)', color: C.exam, bg: C.examBg },
  { v: 'event', l: '행사', desc: '체육대회·체험학습 등 (정규 수업 없음, 일부 학급만 가능)', color: C.event, bg: C.eventBg },
];


export default function SchoolCalendarPage({ currentUser }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  // 필터: 표시 범위
  const [rangeStart, setRangeStart] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return fmtDate(d);
  });
  const [rangeEnd, setRangeEnd] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return fmtDate(d);
  });

  const refresh = async () => {
    setError(null);
    try {
      const { data, error } = await supabase
        .from('school_calendar')
        .select('*')
        .gte('date', rangeStart)
        .lte('date', rangeEnd)
        .order('date');
      if (error) throw error;
      setEntries(data || []);
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    setLoading(true);
    refresh().finally(() => setLoading(false));
  }, [rangeStart, rangeEnd]);

  const handleDelete = async (date) => {
    if (!window.confirm(`${date} 일정을 삭제할까요?`)) return;
    try {
      const { error } = await supabase.from('school_calendar').delete().eq('date', date);
      if (error) throw error;
      await refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const handleEdit = (entry) => {
    setEditTarget(entry);
    setShowForm(true);
  };

  const handleNew = () => {
    setEditTarget(null);
    setShowForm(true);
  };

  const handleSave = async () => {
    setShowForm(false);
    setEditTarget(null);
    await refresh();
  };

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: font, minHeight: '100vh', padding: '24px 32px' }}>
      {/* 헤더 */}
      <div style={{ marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>📆 학사일정 관리</h2>
        <div style={{ fontSize: 12, color: C.textMid, marginTop: 4 }}>
          학교의 휴일·시험·행사 등 학사 운영상 특이일을 관리합니다. 시간표 시스템에 반영되어 그날의 정규 수업 여부가 결정됩니다.
        </div>
      </div>

      {/* 컨트롤 바 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: C.textDim }}>조회 범위:</span>
        <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} style={inputStyle()} />
        <span style={{ color: C.textDim }}>~</span>
        <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} style={inputStyle()} />
        <button onClick={handleNew} style={btnStyle({ primary: true })}>+ 새 일정 추가</button>
      </div>

      {/* 폼 */}
      {showForm && (
        <CalendarEntryForm
          target={editTarget}
          onCancel={() => { setShowForm(false); setEditTarget(null); }}
          onSave={handleSave}
        />
      )}

      {/* 목록 */}
      {loading && <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13 }}>불러오는 중...</div>}
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {!loading && !error && (
        entries.length === 0 ? (
          <Empty>이 기간에 등록된 학사일정이 없습니다.</Empty>
        ) : (
          <div>
            {entries.map(e => (
              <EntryRow key={e.date} entry={e} onEdit={handleEdit} onDelete={handleDelete} />
            ))}
          </div>
        )
      )}
    </div>
  );
}


// ─── 단일 일정 행 ───
function EntryRow({ entry, onEdit, onDelete }) {
  const typeInfo = TYPE_OPTIONS.find(t => t.v === entry.type) || TYPE_OPTIONS[0];
  const isPartial = entry.affected_classes && entry.affected_classes.length > 0;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderLeft: `4px solid ${typeInfo.color}`,
      borderRadius: 8, padding: '12px 14px', marginBottom: 8,
      display: 'flex', alignItems: 'center', gap: 12,
    }}>
      <div style={{ minWidth: 90 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>{fmtDateShort(entry.date)}</div>
        <div style={{ fontSize: 10, color: C.textDim }}>{entry.date}</div>
      </div>

      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            background: typeInfo.bg, color: typeInfo.color,
          }}>{typeInfo.l}</span>
          {isPartial && (
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 4,
              background: C.purple + '20', color: C.purple,
            }}>일부 학급 ({entry.affected_classes.map(c => CLS.find(x => x.id === c)?.name).filter(Boolean).join(', ')})</span>
          )}
        </div>
        <div style={{ fontSize: 13, color: C.text }}>{entry.note || '(설명 없음)'}</div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={() => onEdit(entry)} style={btnStyle({ small: true })}>수정</button>
        <button onClick={() => onDelete(entry.date)} style={btnStyle({ small: true, danger: true })}>삭제</button>
      </div>
    </div>
  );
}


// ─── 일정 생성/수정 폼 ───
function CalendarEntryForm({ target, onCancel, onSave }) {
  const isEdit = !!target;
  const [date, setDate] = useState(target?.date || fmtDate(new Date()));
  const [type, setType] = useState(target?.type || 'holiday');
  const [note, setNote] = useState(target?.note || '');
  const [affectedClasses, setAffectedClasses] = useState(target?.affected_classes || []);
  const [partial, setPartial] = useState(!!(target?.affected_classes && target.affected_classes.length > 0));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const toggleClass = (cid) => {
    if (affectedClasses.includes(cid)) {
      setAffectedClasses(affectedClasses.filter(x => x !== cid));
    } else {
      setAffectedClasses([...affectedClasses, cid]);
    }
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        date,
        type,
        note: note.trim() || null,
        affected_classes: partial && affectedClasses.length > 0 ? affectedClasses : null,
      };

      if (isEdit) {
        const { error } = await supabase
          .from('school_calendar')
          .update(payload)
          .eq('date', target.date);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('school_calendar').insert(payload);
        if (error) throw error;
      }

      onSave();
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.purple}40`, borderRadius: 12, padding: 20, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 16px', fontSize: 14, fontWeight: 600, color: C.text }}>
        {isEdit ? `학사일정 수정 — ${target.date}` : '새 학사일정 추가'}
      </h3>

      <Section label="날짜">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          disabled={isEdit}
          style={{ ...inputStyle(), opacity: isEdit ? 0.5 : 1 }} />
        {isEdit && <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>날짜는 수정할 수 없습니다. 다른 날로 옮기려면 삭제 후 새로 추가해주세요.</div>}
      </Section>

      <Section label="유형">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {TYPE_OPTIONS.map(o => (
            <button key={o.v} onClick={() => setType(o.v)}
              style={{
                padding: '10px 12px', textAlign: 'left',
                border: `1px solid ${type === o.v ? o.color : C.border}`,
                background: type === o.v ? o.bg : 'transparent',
                color: type === o.v ? o.color : C.text,
                borderRadius: 6, cursor: 'pointer', fontFamily: font,
              }}>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{o.l}</div>
              <div style={{ fontSize: 10, color: C.textMid, marginTop: 3 }}>{o.desc}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section label="설명 (예: '근로자의 날', '1학기 중간고사 1일차')">
        <input value={note} onChange={e => setNote(e.target.value)}
          placeholder="간단한 설명을 입력해주세요"
          style={{ ...inputStyle(), width: '100%', boxSizing: 'border-box' }} />
      </Section>

      {/* 행사 type 일 때만 일부 학급 옵션 노출 */}
      {type === 'event' && (
        <Section label="영향 범위">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 8 }}>
            <input type="checkbox" checked={partial} onChange={e => setPartial(e.target.checked)} />
            <span>특정 학급만 영향받음 (체크 안 하면 전교 적용)</span>
          </label>
          {partial && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
              {CLS.map(c => (
                <label key={c.id} style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 10px', fontSize: 12,
                  background: affectedClasses.includes(c.id) ? C.accentSoft : C.bg,
                  color: affectedClasses.includes(c.id) ? C.accent : C.text,
                  border: `1px solid ${affectedClasses.includes(c.id) ? C.accent : C.border}`,
                  borderRadius: 6, cursor: 'pointer',
                }}>
                  <input type="checkbox" checked={affectedClasses.includes(c.id)}
                    onChange={() => toggleClass(c.id)} />
                  {c.name}
                </label>
              ))}
            </div>
          )}
        </Section>
      )}

      {error && (
        <div style={{ fontSize: 12, color: C.red, padding: '8px 10px', background: C.red + '15', borderRadius: 6, marginBottom: 10 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={btnStyle()}>취소</button>
        <button onClick={handleSubmit} disabled={submitting || !date}
          style={btnStyle({ primary: true, disabled: submitting || !date })}>
          {submitting ? '저장 중...' : (isEdit ? '저장' : '추가')}
        </button>
      </div>
    </div>
  );
}


// ─── 작은 부품들 ───
function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function btnStyle({ primary = false, danger = false, disabled = false, small = false } = {}) {
  return {
    padding: small ? '4px 10px' : '7px 14px',
    fontSize: small ? 11 : 12, fontFamily: font, fontWeight: 500,
    border: `1px solid ${primary ? C.accent : danger ? C.red : C.border}`,
    background: primary ? C.accent : 'transparent',
    color: primary ? '#fff' : danger ? C.red : C.text,
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

function inputStyle() {
  return {
    background: C.bg, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: font,
  };
}

function Empty({ children }) {
  return <div style={{ padding: 60, textAlign: 'center', color: C.textDim, fontSize: 13, background: C.card, border: `1px solid ${C.border}`, borderRadius: 12 }}>{children}</div>;
}

function ErrorBanner({ children }) {
  return <div style={{ padding: 16, color: C.red, fontSize: 12, background: C.red + '15', border: `1px solid ${C.red}40`, borderRadius: 8, marginBottom: 16 }}>오류: {children}</div>;
}
