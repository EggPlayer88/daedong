// ═══════════════════════════════════════════════════════════════════
//  timetablesAPI.js — timetables 테이블 CRUD
// ═══════════════════════════════════════════════════════════════════
//  - draft 저장 / active 활성화 / 목록 조회 / 단일 조회
//  - 활성화 시 기존 active 는 superseded 로 전환 (트랜잭션 보장)
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

// ─── 시간표 저장 (draft 또는 active) ───
//   - data: 솔버 결과 또는 편집된 TT 객체. 형식: { c1: { '월-1': {sid, tid}, ... }, ... }
//   - opts: { name, effective_from, effective_until?, asActive?, parent_id?, edit_log?, created_by? }
//
//   asActive=true 면 기존 active 를 superseded 로 전환하고 새 row 를 active 로 저장
//   asActive=false 면 status='draft' 로만 저장
export async function saveTimetable(data, opts = {}) {
  const {
    name,
    effective_from,
    effective_until = null,
    asActive = false,
    parent_id = null,
    edit_log = {},
    created_by = null,
  } = opts;

  if (!name || !effective_from) {
    throw new Error('name, effective_from 은 필수입니다');
  }
  if (!data || typeof data !== 'object') {
    throw new Error('시간표 데이터가 비어있습니다');
  }

  // 활성화 모드: 기존 active 를 먼저 superseded 로 전환
  if (asActive) {
    const { error: deactivateErr } = await supabase
      .from('timetables')
      .update({ is_active: false, status: 'superseded' })
      .eq('is_active', true);
    if (deactivateErr) throw deactivateErr;
  }

  const insertRow = {
    name,
    effective_from,
    effective_until,
    parent_id,
    edit_log,
    status: asActive ? 'active' : 'draft',
    is_active: asActive,
    data,
    created_by,
  };

  const { data: inserted, error } = await supabase
    .from('timetables')
    .insert(insertRow)
    .select()
    .single();
  if (error) throw error;
  return inserted;
}


// ─── 시간표 목록 조회 ───
//   - 모든 row (active, draft, superseded, rolled_back)
//   - 최신순
export async function listTimetables() {
  const { data, error } = await supabase
    .from('timetables')
    .select('id, name, status, is_active, effective_from, effective_until, parent_id, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}


// ─── 단일 시간표 조회 (data 포함) ───
export async function getTimetable(id) {
  const { data, error } = await supabase
    .from('timetables')
    .select('*')
    .eq('id', id)
    .single();
  if (error) throw error;
  return data;
}


// ─── 시간표 활성화 ───
//   draft 상태인 시간표를 active 로 전환
//   기존 active 는 superseded 로
export async function activateTimetable(id) {
  // 대상 시간표 정보 확인
  const { data: target, error: e1 } = await supabase
    .from('timetables')
    .select('id, status, is_active')
    .eq('id', id)
    .single();
  if (e1) throw e1;
  if (target.is_active) throw new Error('이미 활성화된 시간표입니다');
  if (target.status === 'rolled_back') throw new Error('롤백된 시간표는 활성화할 수 없습니다');

  // 기존 active 비활성화
  const { error: e2 } = await supabase
    .from('timetables')
    .update({ is_active: false, status: 'superseded' })
    .eq('is_active', true);
  if (e2) throw e2;

  // 대상을 active 로
  const { data: activated, error: e3 } = await supabase
    .from('timetables')
    .update({ is_active: true, status: 'active' })
    .eq('id', id)
    .select()
    .single();
  if (e3) throw e3;

  return activated;
}


// ─── draft 시간표 삭제 ───
//   active 또는 superseded 는 삭제 불가 (이력 보존)
export async function deleteDraftTimetable(id) {
  const { data: target, error: e1 } = await supabase
    .from('timetables')
    .select('status')
    .eq('id', id)
    .single();
  if (e1) throw e1;
  if (target.status !== 'draft') {
    throw new Error('draft 상태인 시간표만 삭제할 수 있습니다');
  }

  const { error } = await supabase.from('timetables').delete().eq('id', id);
  if (error) throw error;
}


// ─── 시간표 정보 수정 (이름, 발효일 등) ───
//   data 자체는 수정 불가 (편집은 새 row 생성)
export async function updateTimetableMeta(id, { name, effective_from, effective_until }) {
  const updates = {};
  if (name !== undefined) updates.name = name;
  if (effective_from !== undefined) updates.effective_from = effective_from;
  if (effective_until !== undefined) updates.effective_until = effective_until;

  if (Object.keys(updates).length === 0) return null;

  const { data, error } = await supabase
    .from('timetables')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  return data;
}
