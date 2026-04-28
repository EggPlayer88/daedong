// ═══════════════════════════════════════════════════════════════════
//  ChangeTabPanels.jsx
//  4개 탭 패널: 알림 / 내 요청 / 관리자 승인 대기
// ═══════════════════════════════════════════════════════════════════

import { useState } from 'react';
import { CLS, TCH, gS, gC, gT } from '../lib/timetableData';
import { fmtDateShort } from '../lib/timetableEngine';
import {
  respondAsPartner, respondAsAdmin, cancelRequest, markNotificationRead, markAllRead,
} from '../lib/changesAPI';

const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  green:'#34d399', greenSoft:'#34d39922',
  yellow:'#fbbf24', yellowSoft:'#fbbf2422',
  red:'#f87171', redSoft:'#f8717122',
  purple:'#a78bfa', purpleSoft:'#a78bfa22',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

// 공통 라벨
const TYPE_LABEL = {
  swap: '교환수업', substitute: '보강',
  self_study: '결강/자습', period_move: '시수변경',
};
const STATUS_LABEL = {
  pending: { label: '대기', color: C.textMid },
  awaiting_partners: { label: '교사 승인 대기', color: C.yellow },
  awaiting_admin: { label: '관리자 승인 대기', color: C.yellow },
  approved: { label: '승인 완료', color: C.green },
  rejected: { label: '반려', color: C.red },
  cancelled: { label: '취소됨', color: C.textDim },
};
const KIND_TITLE = {
  partner_request: '응답 요청을 받았습니다',
  admin_review: '관리자 승인 대기 중인 요청입니다',
  approved: '내 요청이 최종 승인되었습니다',
  rejected: '내 요청이 반려되었습니다',
  admin_notice: '시간표관리자 직권 변경 통보',
};

// ═══════════════════════════════════════════════════════════════════
// 1) 알림 탭
// ═══════════════════════════════════════════════════════════════════

export function NotificationsTab({ notifications, currentUser, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (!notifications || notifications.length === 0) {
    return <Empty>받은 알림이 없습니다</Empty>;
  }

  const handlePartnerResponse = async (notif, decision) => {
    if (busyId) return;
    setBusyId(notif.id);
    setError(null);
    try {
      let reason = null;
      if (decision === 'rejected') {
        reason = window.prompt('반려 사유 (선택사항):') || null;
      }
      await respondAsPartner(notif.request_id, currentUser.id, decision, reason);
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkRead = async (notif) => {
    if (notif.read) return;
    try {
      await markNotificationRead(notif.id);
      onChange?.();
    } catch (err) { console.error(err); }
  };

  const handleMarkAllRead = async () => {
    try { await markAllRead(currentUser.id); onChange?.(); }
    catch (err) { setError(err.message); }
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: C.text, flex: 1 }}>
          알림 {unreadCount > 0 && <span style={{ fontSize: 11, color: C.textMid, fontWeight: 400 }}>({unreadCount}개 미확인)</span>}
        </h3>
        {unreadCount > 0 && (
          <button onClick={handleMarkAllRead} style={btnSmall()}>모두 읽음 처리</button>
        )}
      </div>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      <div>
        {notifications.map(n => {
          const r = n.timetable_changes;
          if (!r) return null;
          const needAction = n.kind === 'partner_request'
            && r.status === 'awaiting_partners'
            && r.partner_status?.[currentUser.id] === 'pending';

          return (
            <div
              key={n.id}
              onClick={() => handleMarkRead(n)}
              style={{
                background: n.read ? C.card : C.accentSoft,
                border: `1px solid ${n.read ? C.border : C.accent + '40'}`,
                borderRadius: 8, padding: '12px 14px', marginBottom: 8,
                cursor: n.read ? 'default' : 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {KIND_TITLE[n.kind]}
                    {!n.read && <span style={{ marginLeft: 6, color: C.accent, fontSize: 9 }}>● 새 알림</span>}
                  </div>
                  <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>
                    {TYPE_LABEL[r.type]} · {fmtDateShort(r.source_date)} · 요청자: {gT(r.requester_id)?.name || '?'}
                  </div>
                </div>
                {needAction && (
                  <div onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 6 }}>
                    <button onClick={() => handlePartnerResponse(n, 'approved')} disabled={busyId === n.id} style={btnSmall({ primary: true })}>승인</button>
                    <button onClick={() => handlePartnerResponse(n, 'rejected')} disabled={busyId === n.id} style={btnSmall({ danger: true })}>반려</button>
                  </div>
                )}
                {!needAction && (
                  <Pill color={STATUS_LABEL[r.status]?.color}>{STATUS_LABEL[r.status]?.label}</Pill>
                )}
              </div>

              <RequestSummary req={r} compact />

              {r.reason && (
                <div style={{ fontSize: 11, color: C.textMid, marginTop: 6 }}>사유: {r.reason}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// 2) 내 요청 탭
// ═══════════════════════════════════════════════════════════════════

export function MyRequestsTab({ requests, currentUser, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (!requests || requests.length === 0) {
    return <Empty>제출한 변동 요청이 없습니다. 시간표 탭에서 내 수업 셀을 클릭하여 시작하세요.</Empty>;
  }

  const handleCancel = async (req) => {
    if (!window.confirm('이 요청을 취소할까요?')) return;
    setBusyId(req.id);
    setError(null);
    try {
      await cancelRequest(req.id, currentUser.id);
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: C.text }}>내가 제출한 요청 ({requests.length}건)</h3>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {requests.map(r => (
        <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {TYPE_LABEL[r.type]}
                {r.type === 'swap' && r.payload?.partners && (
                  <span style={{ marginLeft: 6, fontSize: 11, color: C.textMid }}>· {r.payload.partners.length + 1}자</span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>
                {fmtDateShort(r.source_date)} · 작성: {new Date(r.created_at).toLocaleString('ko-KR')}
              </div>
            </div>
            <Pill color={STATUS_LABEL[r.status]?.color}>{STATUS_LABEL[r.status]?.label}</Pill>
          </div>

          <RequestSummary req={r} />

          {/* 승인 진행상황 */}
          {(r.status === 'awaiting_partners' || r.status === 'awaiting_admin') && (
            <ApprovalProgress req={r} />
          )}

          {r.reason && (
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 6 }}>사유: {r.reason}</div>
          )}
          {r.rejected_by && (
            <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>
              반려: {gT(r.rejected_by)?.name || '관리자'}{r.rejection_reason ? ` — ${r.rejection_reason}` : ''}
            </div>
          )}

          {(r.status === 'awaiting_partners' || r.status === 'awaiting_admin') && (
            <div style={{ marginTop: 8, textAlign: 'right' }}>
              <button onClick={() => handleCancel(r)} disabled={busyId === r.id} style={btnSmall({ danger: true })}>요청 취소</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// 3) 관리자 승인 대기 탭
// ═══════════════════════════════════════════════════════════════════

export function AdminQueueTab({ queue, currentUser, onChange }) {
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  if (!queue || queue.length === 0) {
    return <Empty>관리자 승인 대기 중인 요청이 없습니다</Empty>;
  }

  const handleAdminResponse = async (req, decision) => {
    if (busyId) return;
    let reason = null;
    if (decision === 'rejected') {
      reason = window.prompt('반려 사유 (선택사항):') || null;
    } else if (!window.confirm(`이 요청을 승인하시겠습니까?\n승인 즉시 시간표에 반영됩니다.`)) {
      return;
    }
    setBusyId(req.id);
    setError(null);
    try {
      await respondAsAdmin(req.id, currentUser.id, decision, reason);
      onChange?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: C.text }}>관리자 승인 대기 ({queue.length}건)</h3>
      {error && <ErrorBanner>{error}</ErrorBanner>}

      {queue.map(r => (
        <div key={r.id} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: '12px 14px', marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {TYPE_LABEL[r.type]} · 요청자 {gT(r.requester_id)?.name || '?'}
              </div>
              <div style={{ fontSize: 11, color: C.textMid, marginTop: 3 }}>
                {fmtDateShort(r.source_date)} · 작성: {new Date(r.created_at).toLocaleString('ko-KR')}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => handleAdminResponse(r, 'approved')} disabled={busyId === r.id} style={btnSmall({ primary: true })}>승인</button>
              <button onClick={() => handleAdminResponse(r, 'rejected')} disabled={busyId === r.id} style={btnSmall({ danger: true })}>반려</button>
            </div>
          </div>

          <RequestSummary req={r} />
          {r.reason && (
            <div style={{ fontSize: 11, color: C.textMid, marginTop: 6 }}>사유: {r.reason}</div>
          )}

          {/* 파트너 승인 이력 */}
          {r.partner_status && Object.keys(r.partner_status).length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: C.textMid }}>
              파트너 승인:{' '}
              {Object.entries(r.partner_status).map(([tid, s]) => (
                <span key={tid} style={{ marginRight: 8, color: s === 'approved' ? C.green : s === 'rejected' ? C.red : C.textMid }}>
                  {gT(tid)?.name}: {s === 'approved' ? '✓' : s === 'rejected' ? '✗' : '대기'}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════
// 공통 부품
// ═══════════════════════════════════════════════════════════════════

function RequestSummary({ req, compact }) {
  const sCls = gC(req.source_class_id)?.name || '?';
  const summary = formatRequestSummary(req);
  return (
    <div style={{ fontSize: compact ? 11 : 12, color: C.text, padding: '6px 10px', background: C.bg, borderRadius: 6 }}>
      <strong>{sCls}</strong> {req.source_day}{req.source_period}교시 ({gS(req.source_subject_id)?.name}) {summary}
    </div>
  );
}

function formatRequestSummary(r) {
  if (r.type === 'swap') {
    const parts = (r.payload?.partners || []).map(p => `${gC(p.class_id)?.name} ${p.day}${p.period}`);
    return `↔ ${parts.join(' ↔ ')}`;
  }
  if (r.type === 'substitute') {
    return `→ 보강: ${gT(r.payload?.substitute_teacher_id)?.name || '?'}`;
  }
  if (r.type === 'self_study') {
    return r.payload?.supervisor_teacher_id
      ? `→ 자습 (감독: ${gT(r.payload.supervisor_teacher_id)?.name})`
      : '→ 결강 (자습, 감독 없음)';
  }
  if (r.type === 'period_move') {
    return `→ ${gC(r.payload?.target_class_id)?.name} ${r.payload?.target_day}${r.payload?.target_period}`;
  }
  return '';
}

function ApprovalProgress({ req }) {
  const partners = Object.entries(req.partner_status || {});
  return (
    <div style={{ marginTop: 8 }}>
      {partners.map(([tid, s]) => (
        <Pill key={tid} color={s === 'approved' ? C.green : s === 'rejected' ? C.red : C.yellow} small>
          {gT(tid)?.name}: {s === 'approved' ? '승인' : s === 'rejected' ? '반려' : '대기'}
        </Pill>
      ))}
      <Pill color={req.status === 'awaiting_admin' ? C.yellow : C.textDim} small>
        시간표관리자: {req.status === 'awaiting_admin' ? '대기' : '...'}
      </Pill>
    </div>
  );
}

function Pill({ color, children, small }) {
  return (
    <span style={{
      display: 'inline-block',
      padding: small ? '2px 8px' : '3px 10px',
      borderRadius: 10, fontSize: small ? 10 : 11, fontWeight: 600,
      background: color + '20', color, border: `1px solid ${color}30`,
      marginRight: 6, marginTop: 2,
    }}>{children}</span>
  );
}

function Empty({ children }) {
  return (
    <div style={{ textAlign: 'center', padding: 60, color: C.textDim, fontSize: 13 }}>
      {children}
    </div>
  );
}

function ErrorBanner({ children }) {
  return (
    <div style={{ fontSize: 12, color: C.red, padding: '8px 10px', background: C.redSoft, borderRadius: 6, marginBottom: 10 }}>
      {children}
    </div>
  );
}

function btnSmall({ primary = false, danger = false } = {}) {
  const color = primary ? C.accent : danger ? C.red : C.text;
  return {
    padding: '4px 10px', fontSize: 11, fontFamily: font,
    border: `1px solid ${color}40`,
    background: primary ? C.accent : 'transparent',
    color: primary ? '#fff' : color,
    borderRadius: 5, cursor: 'pointer',
  };
}
