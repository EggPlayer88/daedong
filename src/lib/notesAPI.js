// ═══════════════════════════════════════════════════════════════════
//  notesAPI.js — 대시보드 메모장 (사용자당 1개)
// ═══════════════════════════════════════════════════════════════════
//  - getNote(userId): 메모 조회. 없으면 { content:'', updated_at:null }
//  - saveNote(userId, content): upsert. 사용자당 1행 보장 (user_id PK)
//
//  스키마: migrations/007_create_notes.sql
// ═══════════════════════════════════════════════════════════════════

import { supabase } from './supabase';

// ─── 사용자의 메모 조회 ───
//   없으면 빈 메모 객체로 fallback (UI 가 textarea 를 빈 채로 시작)
export async function getNote(userId) {
  if (!userId) throw new Error('userId 가 필요합니다');
  const { data, error } = await supabase
    .from('notes')
    .select('content, updated_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return data || { content: '', updated_at: null };
}

// ─── 메모 저장 (upsert) ───
//   같은 user_id 가 있으면 update, 없으면 insert
export async function saveNote(userId, content) {
  if (!userId) throw new Error('userId 가 필요합니다');
  const payload = {
    user_id: userId,
    content: content ?? '',
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await supabase
    .from('notes')
    .upsert(payload, { onConflict: 'user_id' })
    .select()
    .single();
  if (error) throw error;
  return data;
}
