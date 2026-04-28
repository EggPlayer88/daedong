// ═══════════════════════════════════════════════════════════════════
//  ChangeRequestForm.jsx — 변동 요청 작성 폼
//  4가지 type 분기 + 같은 학급 우선 정책 + 다른 학급 시 경고
// ═══════════════════════════════════════════════════════════════════

import { useState, useMemo } from 'react';
import { CLS, TCH, gT, gS, gC } from '../lib/timetableData';
import { slotKey, fmtDate, mergeChangesIntoTT } from '../lib/timetableEngine';
import { createChangeRequest } from '../lib/changesAPI';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
  warnBg:'#854d0e22', warnText:'#fbbf24',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

const TYPE_LABELS = {
  swap: '교환수업',
  substitute: '보강',
  self_study: '결강/자습',
  period_move: '시수변경',
};
const TYPE_DESC = {
  swap: '다른 시간 수업과 맞바꿈 (1:1, 1:1:1, 1:1:1:1 가능)',
  substitute: '다른 교사가 대신 들어가서 진도 진행',
  self_study: '자습 처리 (감독교사 지정 가능)',
  period_move: '같은 교사가 시간만 옮김 (빈 시간으로 이동)',
};


export default function ChangeRequestForm({
  sourceCell,         // { classId, day, period, sid, tid, date }
  currentUser,
  baseTT,
  approvedChanges,    // 그날의 다른 변동 (충돌 검증용)
  onSubmit,           // 제출 성공 시 콜백
  onCancel,
}) {
  const [type, setType] = useState(null);
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // type 별 추가 상태
  const [swapPartners, setSwapPartners] = useState([]); // [{classId, day, period, sid, tid}]
  const [swapSize, setSwapSize] = useState(2);
  const [substituteId, setSubstituteId] = useState('');
  const [supervisorId, setSupervisorId] = useState(''); // self_study용 (빈값 = 결강)
  const [moveTarget, setMoveTarget] = useState(null);   // {classId, day, period}

  const sourceLabel = `${gC(sourceCell.classId).name} ${sourceCell.day}요일 ${sourceCell.period}교시 · ${gS(sourceCell.sid)?.name} (${gT(sourceCell.tid)?.name})`;

  // 그날 시간표 (변동 반영된 상태) — 셀 picker 용
  const dayTT = useMemo(() => {
    return mergeChangesIntoTT(baseTT, approvedChanges, sourceCell.date);
  }, [baseTT, approvedChanges, sourceCell.date]);

  // 파트너 ID 수집 (승인 받아야 할 교사들)
  const partnerIds = useMemo(() => {
    if (type === 'swap') {
      return [...new Set(swapPartners.map(p => p.tid).filter(tid => tid && tid !== currentUser.id))];
    }
    if (type === 'substitute' && substituteId) return [substituteId];
    if (type === 'self_study' && supervisorId) return [supervisorId];
    return [];
  }, [type, swapPartners, substituteId, supervisorId, currentUser.id]);

  // 폼 검증
  const canSubmit = useMemo(() => {
    if (!type || !reason.trim()) return false;
    if (type === 'swap') return swapPartners.length === swapSize - 1;
    if (type === 'substitute') return !!substituteId;
    if (type === 'self_study') return true; // supervisorId 비워두면 결강
    if (type === 'period_move') return !!moveTarget;
    return false;
  }, [type, reason, swapPartners, swapSize, substituteId, supervisorId, moveTarget]);

  // 제출
  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let payload = {};
      if (type === 'swap') {
        payload = {
          partners: swapPartners.map(p => ({
            class_id: p.classId,
            day: p.day,
            period: p.period,
            teacher_id: p.tid,
            subject_id: p.sid,
          })),
        };
      } else if (type === 'substitute') {
        payload = { substitute_teacher_id: substituteId, ai_recommended: false };
      } else if (type === 'self_study') {
        payload = supervisorId ? { supervisor_teacher_id: supervisorId } : {};
      } else if (type === 'period_move') {
        payload = {
          target_class_id: moveTarget.classId,
          target_day: moveTarget.day,
          target_period: moveTarget.period,
        };
      }

      await createChangeRequest({
        type,
        sourceDate: sourceCell.date,
        sourceClassId: sourceCell.classId,
        sourceDay: sourceCell.day,
        sourcePeriod: sourceCell.period,
        sourceTeacherId: sourceCell.tid,
        sourceSubjectId: sourceCell.sid,
        payload,
        reason: reason.trim(),
        requesterId: currentUser.id,
        partnerIds,
      });

      onSubmit?.();
    } catch (err) {
      setError(err.message || '요청 제출에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: 20, fontFamily: font }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: C.text, flex: 1 }}>변동 요청 작성</h3>
        <button onClick={onCancel} style={btnStyle()}>취소</button>
      </div>

      {/* 원본 셀 */}
      <Section label="선택한 내 수업">
        <div style={{ fontSize: 13, color: C.text, padding: '8px 12px', background: C.bg, borderRadius: 8 }}>
          {sourceLabel}
        </div>
      </Section>

      {/* 변동 유형 */}
      <Section label="변동 유형">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          {Object.entries(TYPE_LABELS).map(([k, label]) => (
            <button
              key={k}
              onClick={() => { setType(k); setSwapPartners([]); setSwapSize(2); setMoveTarget(null); }}
              style={btnStyle({ active: type === k, block: true, align: 'left' })}
            >
              <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
              <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>{TYPE_DESC[k]}</div>
            </button>
          ))}
        </div>
      </Section>

      {/* type 별 추가 입력 */}
      {type === 'swap' && (
        <SwapPicker
          sourceCell={sourceCell}
          dayTT={dayTT}
          swapSize={swapSize}
          setSwapSize={setSwapSize}
          partners={swapPartners}
          setPartners={setSwapPartners}
        />
      )}
      {type === 'substitute' && (
        <SubstitutePicker
          sourceCell={sourceCell}
          currentUser={currentUser}
          dayTT={dayTT}
          value={substituteId}
          onChange={setSubstituteId}
        />
      )}
      {type === 'self_study' && (
        <SelfStudyPicker
          currentUser={currentUser}
          dayTT={dayTT}
          value={supervisorId}
          onChange={setSupervisorId}
        />
      )}
      {type === 'period_move' && (
        <PeriodMovePicker
          sourceCell={sourceCell}
          currentUser={currentUser}
          dayTT={dayTT}
          target={moveTarget}
          setTarget={setMoveTarget}
        />
      )}

      {/* 사유 */}
      {type && (
        <Section label="사유 (필수)">
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            placeholder="예: 출장, 연수, 외부 일정 등"
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              fontSize: 12, fontFamily: font, background: C.bg, color: C.text,
              border: `1px solid ${C.border}`, borderRadius: 6, resize: 'vertical',
            }}
          />
        </Section>
      )}

      {/* 승인 흐름 안내 */}
      {type && (
        <div style={{ fontSize: 11, color: C.textMid, padding: '10px 12px', background: C.bg, borderRadius: 6, marginBottom: 12 }}>
          제출 후: {getApprovalSummary(type, partnerIds)}
        </div>
      )}

      {error && (
        <div style={{ fontSize: 12, color: C.red, padding: '8px 10px', background: C.red + '15', borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button onClick={onCancel} style={btnStyle()}>취소</button>
        <button onClick={handleSubmit} disabled={!canSubmit || submitting} style={btnStyle({ primary: true, disabled: !canSubmit || submitting })}>
          {submitting ? '제출 중…' : '요청 제출'}
        </button>
      </div>
    </div>
  );
}


function getApprovalSummary(type, partnerIds) {
  if (partnerIds.length > 0) {
    const names = partnerIds.map(id => gT(id)?.name).join(', ');
    return `${names} 승인 → 시간표관리자 승인 → 적용`;
  }
  return `시간표관리자 승인 → 적용`;
}


// ───  Swap Picker ───
function SwapPicker({ sourceCell, dayTT, swapSize, setSwapSize, partners, setPartners }) {
  const [pickerClassId, setPickerClassId] = useState(sourceCell.classId);
  const need = swapSize - 1 - partners.length;

  // 같은 학급 셀들 vs 다른 학급 셀들
  const sameClass = pickerClassId === sourceCell.classId;
  const showWarning = !sameClass;

  const togglePartner = (cl, day, period) => {
    if (cl === sourceCell.classId && day === sourceCell.day && period === sourceCell.period) return;
    const exists = partners.findIndex(p => p.classId === cl && p.day === day && p.period === period);
    if (exists >= 0) {
      setPartners(partners.filter((_, i) => i !== exists));
      return;
    }
    if (need <= 0) return;
    const cell = dayTT[cl]?.[slotKey(day, period)];
    if (!cell || cell.type === 'special' || cell.type === 'self_study') return;
    setPartners([...partners, { classId: cl, day, period, sid: cell.sid, tid: cell.tid }]);
  };

  return (
    <>
      <Section label="교환 인원">
        <div style={{ display: 'flex', gap: 6 }}>
          {[2, 3, 4].map(n => (
            <button key={n}
              onClick={() => { setSwapSize(n); setPartners([]); }}
              style={btnStyle({ active: swapSize === n })}
            >
              {n === 2 ? '1:1' : n === 3 ? '1:1:1' : '1:1:1:1'}
            </button>
          ))}
          <span style={{ fontSize: 11, color: C.textMid, alignSelf: 'center', marginLeft: 8 }}>
            {swapSize >= 3 ? '순환 교환 (한 명이라도 거절 시 전체 반려)' : '두 수업 맞바꿈'}
          </span>
        </div>
      </Section>

      <Section label={`교환 상대 수업 (${partners.length} / ${swapSize - 1})`}>
        {partners.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            {partners.map((p, i) => (
              <span key={i} style={{ display: 'inline-flex', padding: '4px 10px', margin: '2px 4px 2px 0', background: C.accentSoft, color: C.accent, borderRadius: 6, fontSize: 12 }}>
                {gC(p.classId)?.name} {p.day}{p.period} · {gS(p.sid)?.name} ({gT(p.tid)?.name})
                <span onClick={() => setPartners(partners.filter((_, x) => x !== i))} style={{ marginLeft: 8, cursor: 'pointer', color: C.textDim }}>×</span>
              </span>
            ))}
          </div>
        )}

        {need > 0 && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: C.textMid }}>학급:</span>
              <select value={pickerClassId} onChange={e => setPickerClassId(e.target.value)} style={selectStyle()}>
                {CLS.map(c => <option key={c.id} value={c.id}>{c.name}{c.id === sourceCell.classId ? ' (같은 학급)' : ''}</option>)}
              </select>
            </div>

            {showWarning && (
              <div style={{ fontSize: 11, padding: '8px 10px', background: C.warnBg, color: C.warnText, borderRadius: 6, marginBottom: 8 }}>
                ⚠️ 같은 학급이 아닙니다. 가능하면 같은 학급 안에서 교환하는 것을 원칙으로 합니다. 부득이한 경우에만 다른 학급의 수업과 교환하세요.
              </div>
            )}

            <CellPicker
              classId={pickerClassId}
              dayTT={dayTT}
              sourceCell={sourceCell}
              partners={partners}
              onPick={(day, period) => togglePartner(pickerClassId, day, period)}
            />
          </>
        )}
      </Section>
    </>
  );
}


// ─── Substitute Picker (보강 들어갈 교사 선택) ───
function SubstitutePicker({ sourceCell, currentUser, dayTT, value, onChange }) {
  // 그 시간 빈 교사 + 그 외 교사 분리
  const sKey = slotKey(sourceCell.day, sourceCell.period);
  const busyTeacherIds = new Set();
  for (const cl of CLS) {
    const slot = dayTT[cl.id]?.[sKey];
    if (slot?.tid) busyTeacherIds.add(slot.tid);
  }

  const candidates = TCH.filter(t => t.id !== currentUser.id);
  const free = candidates.filter(t => !busyTeacherIds.has(t.id));
  const busy = candidates.filter(t => busyTeacherIds.has(t.id));

  return (
    <Section label="보강 들어갈 교사">
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle({ wide: true })}>
        <option value="">-- 선택 --</option>
        <optgroup label={`해당 시간 빈 교사 (${free.length}명)`}>
          {free.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </optgroup>
        <optgroup label={`이미 수업 중인 교사 (${busy.length}명, 권장 안 함)`}>
          {busy.map(t => <option key={t.id} value={t.id}>{t.name} (수업중)</option>)}
        </optgroup>
      </select>
      <div style={{ fontSize: 11, color: C.textMid, marginTop: 6 }}>
        같은 시간에 수업이 있는 교사를 보강 교사로 지정하면 충돌이 발생합니다. 빈 교사 중에서 선택하는 것을 권장합니다.
      </div>
    </Section>
  );
}


// ─── Self Study Picker ───
function SelfStudyPicker({ currentUser, dayTT, value, onChange }) {
  const candidates = TCH.filter(t => t.id !== currentUser.id);
  return (
    <Section label="자습 감독 교사 (선택, 없으면 결강 처리)">
      <select value={value} onChange={e => onChange(e.target.value)} style={selectStyle({ wide: true })}>
        <option value="">결강 처리 (감독 없음)</option>
        {candidates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </Section>
  );
}


// ─── Period Move Picker ───
function PeriodMovePicker({ sourceCell, currentUser, dayTT, target, setTarget }) {
  const [pickerClassId, setPickerClassId] = useState(sourceCell.classId);

  return (
    <Section label="옮길 위치 선택 (본인 빈 시간 또는 본인 다른 수업)">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.textMid }}>학급:</span>
        <select value={pickerClassId} onChange={e => setPickerClassId(e.target.value)} style={selectStyle()}>
          {CLS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {target && (
        <div style={{ marginBottom: 8 }}>
          <span style={{ display: 'inline-flex', padding: '4px 10px', background: C.accentSoft, color: C.accent, borderRadius: 6, fontSize: 12 }}>
            대상: {gC(target.classId)?.name} {target.day}{target.period}
            <span onClick={() => setTarget(null)} style={{ marginLeft: 8, cursor: 'pointer', color: C.textDim }}>×</span>
          </span>
        </div>
      )}

      {!target && (
        <CellPicker
          classId={pickerClassId}
          dayTT={dayTT}
          sourceCell={sourceCell}
          partners={[]}
          onPick={(day, period) => setTarget({ classId: pickerClassId, day, period })}
        />
      )}
    </Section>
  );
}


// ─── 셀 picker (작은 시간표 그리드) ───
function CellPicker({ classId, dayTT, sourceCell, partners, onPick }) {
  const days = ['월', '화', '수', '목', '금'];
  const dayPeriods = { 월: 6, 화: 7, 수: 6, 목: 7, 금: 6 };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '32px repeat(5, 1fr)', gap: 2, fontSize: 11 }}>
      <div></div>
      {days.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 11, color: C.textDim, padding: 4 }}>{d}</div>)}
      {[1, 2, 3, 4, 5, 6, 7].map(p => (
        <>
          <div key={`p${p}`} style={{ textAlign: 'center', fontSize: 10, color: C.textDim, padding: 4 }}>{p}</div>
          {days.map(d => {
            const valid = p <= dayPeriods[d];
            if (!valid) return <div key={`${d}-${p}`} style={{ background: '#080b14', opacity: 0.3, borderRadius: 4 }} />;
            const slot = dayTT[classId]?.[slotKey(d, p)];
            const isSource = classId === sourceCell.classId && d === sourceCell.day && p === sourceCell.period;
            const isPicked = partners.some(x => x.classId === classId && x.day === d && x.period === p);
            return (
              <div
                key={`${d}-${p}`}
                onClick={() => !isSource && onPick(d, p)}
                style={{
                  background: isSource ? '#1a1530' : isPicked ? C.accent : (slot ? C.bg : '#080b14'),
                  color: isPicked ? '#fff' : C.text,
                  padding: '6px 4px', borderRadius: 4, cursor: isSource ? 'not-allowed' : 'pointer',
                  textAlign: 'center', fontSize: 10, opacity: isSource ? 0.5 : 1,
                  border: isPicked ? `1px solid ${C.accent}` : `1px solid transparent`,
                  minHeight: 36,
                }}
              >
                {slot ? (
                  <>
                    <div style={{ fontWeight: 600, fontSize: 10 }}>{gS(slot.sid)?.name || ''}</div>
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>{gT(slot.tid)?.name || ''}</div>
                  </>
                ) : (
                  <div style={{ color: C.textDim, fontSize: 9 }}>빈 시간</div>
                )}
              </div>
            );
          })}
        </>
      ))}
    </div>
  );
}


// ─── 작은 부품 ───
function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: C.textDim, marginBottom: 6, fontWeight: 500 }}>{label}</div>
      {children}
    </div>
  );
}

function btnStyle({ active = false, primary = false, disabled = false, block = false, align = 'center' } = {}) {
  return {
    padding: block ? '10px 12px' : '7px 14px',
    fontSize: 12, fontFamily: font,
    border: `1px solid ${primary ? C.accent : (active ? C.accent : C.border)}`,
    background: primary ? C.accent : (active ? C.accentSoft : 'transparent'),
    color: primary ? '#fff' : (active ? C.accent : C.text),
    borderRadius: 6, cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    width: block ? '100%' : 'auto',
    textAlign: align,
  };
}

function selectStyle({ wide = false } = {}) {
  return {
    background: C.bg, color: C.text, border: `1px solid ${C.border}`,
    borderRadius: 6, padding: '6px 10px', fontSize: 12, fontFamily: font,
    width: wide ? '100%' : 'auto',
  };
}
