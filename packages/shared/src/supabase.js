import { createClient } from '@supabase/supabase-js'

// ============================================================================
// P8: 이 파일이 v2 전체의 유일한 DB 접근점이다.
//   - 다른 곳에서 createClient 를 다시 호출하지 말 것 (세션이 갈라져 로그인이 깨진다)
//   - main / timetable 은 반드시 여기서 export 한 supabase 인스턴스를 쓴다
// ============================================================================

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  // 조용히 실패하면 "로그인 버튼이 아무 반응 없음" 으로 나타나 원인 추적이 어렵다.
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY 가 없습니다.\n' +
      'apps/main/.env.example 를 apps/main/.env 로 복사한 뒤 값을 채우고 dev 서버를 재시작하세요.'
  )
}

export const supabase = createClient(url, anonKey)
