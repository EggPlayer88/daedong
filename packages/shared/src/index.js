// @daedong/shared 공개 API (P8: 최하층 — 내부 패키지를 import 하지 않는다)
//
// main / timetable 은 반드시 이 진입점을 통해서만 shared 를 쓴다.
//   import { supabase, can, ROLE_LABELS } from '@daedong/shared'

export { supabase } from './supabase.js'

export {
  signInWithGoogle,
  signOut,
  getSession,
  onAuthStateChange,
  fetchMyProfile,
} from './auth.js'

export {
  can,
  getRole,
  isAdmin,
  isDeptHeadOrAbove,
  myDepartmentId,
  hasExtraPermission,
  atLeast,
  KNOWN_ACTIONS,
} from './permissions.js'

export {
  ROLES,
  ROLE_RANK,
  ROLE_LABELS,
  ROLE_COLORS,
  EXTRA_PERMISSIONS,
  EXTRA_PERMISSION_LABELS,
} from './constants.js'
