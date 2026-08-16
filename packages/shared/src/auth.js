import { supabase } from './supabase.js'

// ============================================================================
// 인증 헬퍼. auth 세션(auth.users)과 프로필(public.users)은 다른 것이다:
//   - 세션    : 로그인 여부. supabase.auth 가 관리
//   - 프로필  : role / extra_permissions / department_id. public.users 행.
//               001 의 handle_new_user 트리거가 첫 로그인 때 자동 생성 (role='teacher')
// 권한 판정은 항상 "프로필" 로 한다 (permissions.js).
// ============================================================================

/**
 * Google 로그인 시작.
 * redirectTo 는 window.location.origin — 로컬(http://localhost:5175)과 배포 도메인을
 * 코드 수정 없이 겸용하기 위함. 단, 그 origin 들이 Supabase 의
 * Authentication → URL Configuration → Additional Redirect URLs 에
 * 와일드카드(`http://localhost:5175/**`)로 등록돼 있어야 한다 (v1 교훈 1).
 */
export async function signInWithGoogle() {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin },
  })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

/** 현재 세션 (없으면 null) */
export async function getSession() {
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  return data.session
}

/**
 * 세션 변화 구독. 반환값을 호출하면 구독 해제.
 * 사용: useEffect(() => onAuthStateChange((s) => setSession(s)), [])
 */
export function onAuthStateChange(callback) {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
  return () => data.subscription.unsubscribe()
}

/**
 * 로그인한 사용자의 public.users 행을 가져온다.
 * 행이 없으면 null — 이 경우는 정상이 아니며 보통 다음 둘 중 하나다:
 *   (1) 001 의 on_auth_user_created 트리거 미적용
 *   (2) auth.users 에 이미 있던 계정이라 INSERT 가 안 일어남 (000 [D] 누락)
 * 호출부에서 이 상황을 사용자에게 드러내야 한다 (조용히 넘기지 말 것).
 */
export async function fetchMyProfile(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('users')
    .select('id, email, name, role, extra_permissions, department_id, is_active, created_at')
    .eq('id', userId)
    .maybeSingle()
  if (error) throw error
  return data
}
