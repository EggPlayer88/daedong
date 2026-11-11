import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// 실제 SQL이 바뀌면 아래 대응식도 다시 검토하도록 원래 식부터 확인한다.
export function assertConversationSqlContract() {
  const p6 = readFileSync(new URL('../../database/workhub/p6/P6-02_비서_공개함수.sql', import.meta.url), 'utf8')
  const p10 = readFileSync(new URL('../../database/workhub-ai-policy/p10/P10-02_학교AI_공통실행.sql', import.meta.url), 'utf8')
  assert.ok(p6.includes("regexp_split_to_table(lower(v_in ->> 'prompt'), '[\\s[:punct:]]+') WITH ORDINALITY s(w, o)"))
  assert.match(p6, /WHERE length\(w\) >= 2 GROUP BY w ORDER BY 2 LIMIT 8/)
  for (const sql of [p6, p10]) assert.ok(sql.replace(/\s+/g, ' ').includes(
    "v_title := workhub_private.p6_label(workhub_private.js_trim( (SELECT l FROM regexp_split_to_table(r.input ->> 'prompt', E'\\n') WITH ORDINALITY q(l, o) WHERE workhub_private.js_trim(l) <> '' ORDER BY o LIMIT 1)), 100, '새 대화');"))
  assert.ok(p6.includes("left(regexp_replace(COALESCE(p, ''), '[\\x01-\\x1f\\x7f]', ' ', 'g'), p_max)"))
}

export function sqlConversationTitle(prompt) {
  const first = prompt.split('\n').find(line => line.trim())?.trim() ?? ''
  const label = Array.from(first.replace(/[\x01-\x1f\x7f]/g, ' ')).slice(0, 100).join('')
  return label.trim() ? label : '새 대화'
}

export function sqlConversationWords(prompt) {
  // 회귀 입력과 꼬리표는 ASCII 구두점만 쓴다. 해당 집합은 PostgreSQL [:punct:]와 일치한다.
  const tokens = prompt.toLowerCase().split(/[\s\u0021-\u002f\u003a-\u0040\u005b-\u0060\u007b-\u007e]+/u)
  return [...new Set(tokens.filter(word => Array.from(word).length >= 2))].slice(0, 8)
}
