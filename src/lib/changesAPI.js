// ═══════════════════════════════════════════════════════════════════
//  changesAPI.js
//  변동 요청 + 알림 관련 Supabase 데이터 액세스
//  UI 와 분리해서 재사용 가능 (AI 비서가 호출할 때도 같은 함수 사용)
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

// ─── 변동 요청 조회 ───

// 특정 사용자가 만든 요청
export async function fetchMyRequests(userId) {
  const { data, error } = await supabase
    .from('timetable_changes')
    .select('*')
    .eq('requester_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// 관리자 승인 대기열
export async function fetchAdminQueue() {
  const { data, error } = await supabase
    .from('timetable_changes')
    .select('*')
    .eq('status', 'awaiting_admin')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data || [];
}

// 특정 날짜 범위의 approved 변동 (시간표 그릴 때 사용)
export async function fetchApprovedChanges(startDate, endDate) {
  const { data, error } = await supabase
    .from('timetable_changes')
    .select('*')
    .gte('source_date', startDate)
    .lte('source_date', endDate)
    .eq('status', 'approved');
  if (error) throw error;
  return data || [];
}


// ─── 변동 요청 생성 ───

// 다양한 type 의 요청을 통일된 인터페이스로 등록
// payload 는 호출자가 type 에 맞게 구성해서 전달 (timetableEngine.js 의 적용 로직과 매핑됨)
export async function createChangeRequest({
  type,                    // 'swap' | 'substitute' | 'self_study' | 'period_move'
  sourceDate,              // 'YYYY-MM-DD'
  sourceClassId,
  sourceDay,               // '월'~'금'
  sourcePeriod,
  sourceTeacherId,
  sourceSubjectId,
  payload,                 // type 별 구조 (changesAPI.md 참조)
  reason,
  requesterId,
  partnerIds,              // 승인 받아야 할 파트너 교사 ID 배열
  isAdminDirect = false,
}) {
  const partnerStatus = {};
  partnerIds.forEach(id => { partnerStatus[id] = 'pending'; });

  // 파트너가 있으면 awaiting_partners, 없으면 바로 awaiting_admin (또는 관리자 직권이면 approved)
  const status = isAdminDirect ? 'approved'
                : partnerIds.length > 0 ? 'awaiting_partners'
                : 'awaiting_admin';

  const { data, error } = await supabase
    .from('timetable_changes')
    .insert({
      type,
      status,
      source_date: sourceDate,
      source_class_id: sourceClassId,
      source_day: sourceDay,
      source_period: sourcePeriod,
      source_teacher_id: sourceTeacherId,
      source_subject_id: sourceSubjectId,
      payload,
      partner_status: partnerStatus,
      requester_id: requesterId,
      reason,
      is_admin_direct: isAdminDirect,
    })
    .select()
    .single();
  if (error) throw error;

  // 알림 발송
  const change = data;
  if (isAdminDirect) {
    // 관리자 직권 — 영향받는 교사들에게 사후 통보
    const noticeTargets = [...new Set(partnerIds.filter(id => id !== requesterId))];
    if (noticeTargets.length > 0) {
      await createNotifications(
        noticeTargets,
        { request_id: change.id, kind: 'admin_notice' }
      );
    }
  } else if (status === 'awaiting_partners') {
    // 파트너에게 응답 요청 알림
    await createNotifications(
      partnerIds,
      { request_id: change.id, kind: 'partner_request' }
    );
  } else {
    // awaiting_admin — 관리자에게 승인 요청 알림
    await notifyAdmins({ request_id: change.id, kind: 'admin_review' });
  }

  return change;
}


// ─── 파트너 응답 (승인/반려) ───
export async function respondAsPartner(requestId, userId, decision /* 'approved'|'rejected' */, rejectionReason = null) {
  // 현재 row 가져오기
  const { data: current, error: e1 } = await supabase
    .from('timetable_changes')
    .select('*')
    .eq('id', requestId)
    .single();
  if (e1) throw e1;
  if (current.status !== 'awaiting_partners') {
    throw new Error(`파트너 응답할 수 없는 상태입니다: ${current.status}`);
  }

  // partner_status 업데이트
  const newPartnerStatus = { ...current.partner_status, [userId]: decision };

  let nextStatus;
  let updates = { partner_status: newPartnerStatus };

  if (decision === 'rejected') {
    // 한 명이라도 거절하면 전체 반려
    nextStatus = 'rejected';
    updates.rejected_by = userId;
    updates.rejection_reason = rejectionReason;
  } else {
    // 모든 파트너가 승인했는지 확인
    const allApproved = Object.values(newPartnerStatus).every(s => s === 'approved');
    nextStatus = allApproved ? 'awaiting_admin' : 'awaiting_partners';
  }
  updates.status = nextStatus;

  const { data: updated, error: e2 } = await supabase
    .from('timetable_changes')
    .update(updates)
    .eq('id', requestId)
    .select()
    .single();
  if (e2) throw e2;

  // 내가 받은 알림은 읽음 처리
  await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('request_id', requestId)
    .eq('user_id', userId);

  // 후속 알림
  if (nextStatus === 'rejected') {
    await createNotifications(
      [current.requester_id],
      { request_id: requestId, kind: 'rejected' }
    );
  } else if (nextStatus === 'awaiting_admin') {
    await notifyAdmins({ request_id: requestId, kind: 'admin_review' });
  }

  return updated;
}


// ─── 관리자 응답 ───
export async function respondAsAdmin(requestId, adminUserId, decision, rejectionReason = null) {
  const { data: current, error: e1 } = await supabase
    .from('timetable_changes')
    .select('*')
    .eq('id', requestId)
    .single();
  if (e1) throw e1;
  if (current.status !== 'awaiting_admin') {
    throw new Error(`관리자 승인할 수 없는 상태입니다: ${current.status}`);
  }

  const updates = {
    status: decision === 'approved' ? 'approved' : 'rejected',
    approver_id: adminUserId,
    approved_at: decision === 'approved' ? new Date().toISOString() : null,
    rejected_by: decision === 'rejected' ? adminUserId : null,
    rejection_reason: rejectionReason,
  };

  const { data: updated, error: e2 } = await supabase
    .from('timetable_changes')
    .update(updates)
    .eq('id', requestId)
    .select()
    .single();
  if (e2) throw e2;

  // 관리자 받은 알림 읽음 처리
  await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('request_id', requestId)
    .eq('user_id', adminUserId);

  // 요청자에게 결과 통보
  await createNotifications(
    [current.requester_id],
    { request_id: requestId, kind: decision === 'approved' ? 'approved' : 'rejected' }
  );

  // 승인된 경우 — 파트너들에게도 최종 승인 통보 (선택사항)
  if (decision === 'approved') {
    const partnerIds = Object.keys(current.partner_status || {});
    if (partnerIds.length > 0) {
      await createNotifications(
        partnerIds,
        { request_id: requestId, kind: 'approved' }
      );
    }
  }

  return updated;
}


// ─── 요청 취소 (요청자 본인이 awaiting 상태에서) ───
export async function cancelRequest(requestId, userId) {
  const { data, error } = await supabase
    .from('timetable_changes')
    .update({ status: 'cancelled' })
    .eq('id', requestId)
    .eq('requester_id', userId)
    .in('status', ['awaiting_partners', 'awaiting_admin'])
    .select()
    .single();
  if (error) throw error;
  return data;
}


// ═══════════════════════════════════════════════════════════════════
//  알림 ─────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export async function fetchNotifications(userId, { onlyUnread = false, limit = 50 } = {}) {
  let q = supabase
    .from('notifications')
    .select('*, timetable_changes(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (onlyUnread) q = q.eq('read', false);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function fetchUnreadCount(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationRead(notifId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('id', notifId);
  if (error) throw error;
}

export async function markAllRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read: true, read_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('read', false);
  if (error) throw error;
}

// 내부 헬퍼 — 여러 사용자에게 같은 알림 동시 발송
async function createNotifications(userIds, { request_id, kind, message = null }) {
  if (!userIds || userIds.length === 0) return;
  const rows = userIds.map(uid => ({ user_id: uid, request_id, kind, message }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('알림 발송 실패:', error);
}

// 관리자(들)에게 알림
// 시뮬레이션 단계: teachers 테이블의 진짜 admin + 페르소나 'admin' 문자열 모두에 발송
// Phase 4 (인증 통합) 시: teachers 테이블만 사용
async function notifyAdmins({ request_id, kind, message = null }) {
  const adminIds = new Set();

  // 1) 진짜 admin 계정 (teachers 테이블)
  try {
    const { data: admins, error } = await supabase
      .from('teachers')
      .select('id')
      .in('role', ['timetable_admin', 'super_admin'])
      .eq('status', 'approved');
    if (!error && admins) {
      admins.forEach(a => adminIds.add(a.id));
    }
  } catch (e) {
    console.warn('admin 조회 실패 (시뮬레이션 모드일 수 있음):', e.message);
  }

  // 2) 시뮬레이션 페르소나 'admin' 항상 추가 (Phase 4 에서 제거)
  adminIds.add('admin');

  await createNotifications(Array.from(adminIds), { request_id, kind, message });
}
