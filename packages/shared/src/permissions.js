import { ROLES, ROLE_RANK } from './constants.js'

// ============================================================================
// 권한 판정 — 001/002 의 SECURITY DEFINER 헬퍼 함수와 "같은 의미" 로 구현한다 (D15).
//
// ⚠ 여기 있는 함수는 보안 장치가 아니라 UI 표시용이다.
//    실제 차단은 RLS 와 트리거가 한다. 이 파일은 "버튼을 보여줄지" 를 정할 뿐이며,
//    이것만 통과시켜도 서버가 막으면 막힌다. 반대로 여기서 막아도 서버가 진실이다.
//
// DB 대응표 (한쪽을 고치면 반드시 다른 쪽도 고칠 것):
//   get_my_role()            ↔ getRole(user)
//   is_admin()               ↔ isAdmin(user)
//   is_dept_head_or_above()  ↔ isDeptHeadOrAbove(user)
//   my_department_id()       ↔ myDepartmentId(user)
//   has_extra_permission(p)  ↔ hasExtraPermission(user, p)
//   can_assign_task(target)  ↔ (미구현 — tasks UI 가 생기는 Phase 1 에서 추가. P1)
//
// user 인자 = public.users 행 (auth 세션이 아니다). 비로그인/프로필 없음 = null.
// ⚠ DB 헬퍼는 is_active 를 보지 않는다 → 여기서도 보지 않는다 (같은 의미 유지).
//   퇴직자 차단이 필요해지면 DB 헬퍼와 이 파일을 함께 고친다.
// ============================================================================

/** get_my_role() — 역할 문자열 또는 null */
export function getRole(user) {
  return user?.role ?? null
}

/** is_admin() — role IN ('admin','superadmin') */
export function isAdmin(user) {
  const role = getRole(user)
  return role === ROLES.ADMIN || role === ROLES.SUPERADMIN
}

/** is_dept_head_or_above() — role IN ('department_head','admin','superadmin') */
export function isDeptHeadOrAbove(user) {
  const role = getRole(user)
  return role === ROLES.DEPARTMENT_HEAD || role === ROLES.ADMIN || role === ROLES.SUPERADMIN
}

/** my_department_id() */
export function myDepartmentId(user) {
  return user?.department_id ?? null
}

/**
 * has_extra_permission(perm) — admin+ 는 모든 추가 권한을 자동 보유한다.
 * (001 의 정의가 `is_admin() OR extra_permissions ? perm` 이므로 순서까지 동일하게)
 */
export function hasExtraPermission(user, perm) {
  if (isAdmin(user)) return true
  const list = user?.extra_permissions
  return Array.isArray(list) && list.includes(perm)
}

/**
 * 역할 계층 비교 — "이 역할 이상인가" (D7 상위가 하위 포함).
 * 위의 is_* 함수들과 결과가 같아야 한다: atLeast(u, 'admin') === isAdmin(u)
 */
export function atLeast(user, role) {
  const mine = ROLE_RANK[getRole(user)]
  const need = ROLE_RANK[role]
  if (mine === undefined || need === undefined) return false
  return mine >= need
}

// ----------------------------------------------------------------------------
// 액션 판정 — can(user, 'action')
//
// P1: 지금 존재하는 테이블(001, 002)에 대한 것만 등록한다. 기능이 생길 때 추가.
// 행 소유권 판정(내가 만든 일정인가 등)은 여기 넣지 않는다 — RLS 가 행 단위로 이미
// 강제하며, 여기에 복제하면 두 곳이 어긋난다. 필요한 화면에서 행과 함께 판단할 것.
// ----------------------------------------------------------------------------
const ACTIONS = {
  // users (001) — users_select 는 USING(true): 로그인만 하면 전원 조회 가능
  'users.view': (user) => !!user,
  // role / extra_permissions / is_active 변경. RLS 가 아니라 트리거가 강제 (D16)
  'users.manage': isAdmin,

  // departments (001) — 조회 전체, 편집 admin+
  'departments.view': (user) => !!user,
  'departments.manage': isAdmin,

  // schedules (002) — 조회 전체, 생성은 로그인 사용자 본인 명의로
  'schedules.view': (user) => !!user,
  'schedules.create': (user) => !!user,

  // 시간표 관리 (Phase 2) — 계층과 무관한 추가 권한 (D7)
  'timetable.manage': (user) => hasExtraPermission(user, 'timetable_manage'),
}

/**
 * can(user, action) — 등록되지 않은 action 은 false + 경고.
 * (오타를 조용히 통과시키면 권한 구멍이 된다)
 */
export function can(user, action) {
  const check = ACTIONS[action]
  if (!check) {
    console.warn(`[permissions] 알 수 없는 action: "${action}"`)
    return false
  }
  return check(user)
}

/** 등록된 action 목록 (디버깅/테스트용) */
export const KNOWN_ACTIONS = Object.keys(ACTIONS)
