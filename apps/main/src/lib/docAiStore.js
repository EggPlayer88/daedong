// 문서작성 AI 대화 저장 (004_doc_ai_conversations).
//
// 저장은 **보조 기능**이다 — 실패해도 대화는 계속돼야 한다. 그래서 모든 함수가
// 던지지 않고 { error } 를 돌려주고, 호출부가 조용히 넘길지 알릴지 정한다.
// (작성 중이던 내용이 저장 실패 하나로 날아가는 것이 가장 나쁜 결과다)
//
// RLS 는 personal 패턴이라 본인 행만 보인다. 프론트에서 user_id 로 다시 거르지
// 않는다 — 두 곳에서 거르면 한쪽이 바뀔 때 조용히 어긋난다 (DB 가 진실).

import { supabase } from '@daedong/shared'

const TABLE = 'doc_ai_conversations'
const LIST_COLUMNS = 'id, title, subject, grade, status, updated_at'

/** 새 대화 id — 서버 기본값 대신 클라이언트가 만든다 (첫 저장부터 upsert 하기 위해) */
export function newConversationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // randomUUID 가 없는 환경(구형 브라우저·테스트)용 대체
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/** 내 대화 목록 (최근 수정 순). 본문(messages)은 싣지 않는다 — 목록이 무거워진다 */
export async function listConversations(limit = 30) {
  const { data, error } = await supabase
    .from(TABLE)
    .select(LIST_COLUMNS)
    .order('updated_at', { ascending: false })
    .limit(limit)
  return { rows: data ?? [], error }
}

/** 한 대화 전문 */
export async function loadConversation(id) {
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, title, subject, grade, status, messages, updated_at')
    .eq('id', id)
    .single()
  return { row: data ?? null, error }
}

/**
 * 매 교환 후 자동 저장. id 를 클라이언트가 쥐고 있으므로 insert/update 를 나누지 않는다.
 * user_id 를 함께 넣는 이유: RLS 의 WITH CHECK 가 auth.uid() 와 대조한다.
 */
export async function saveConversation({ id, userId, messages, subject, grade, title, status }) {
  if (!id || !userId) return { error: new Error('id 와 userId 가 필요합니다.') }
  const row = {
    id,
    user_id: userId,
    messages: messages ?? [],
    subject: subject || null,
    grade: Number.isInteger(grade) ? grade : null,
    title: title || null,
    status: status || 'active',
  }
  const { error } = await supabase.from(TABLE).upsert(row, { onConflict: 'id' })
  return { error }
}

/** 문서 생성까지 끝난 대화 표시 — 목록에서 "완료"로 구분해 보여주기 위함 */
export async function markCompleted(id) {
  if (!id) return { error: null }
  const { error } = await supabase.from(TABLE).update({ status: 'completed' }).eq('id', id)
  return { error }
}

export async function deleteConversation(id) {
  const { error } = await supabase.from(TABLE).delete().eq('id', id)
  return { error }
}
