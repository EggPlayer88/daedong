// 모듈 공개 범위 — 메뉴와 라우트가 **같은 표**를 본다.
//
// 왜 필요한가: 교사들이 평가계획서를 실사용하는 중에 개발 중 모듈이 눈에 띄면
// 다들 그것부터 눌러 본다. 미완성 화면이 실사용 화면과 나란히 있으면 "이게 되는
// 건가 안 되는 건가" 를 각자 판단하게 되고, 그 판단은 대개 문의로 돌아온다.
//
// ⚠ **신규 모듈의 기본값은 'superadmin' 이다.** 공개 전환은 계란님 승인 시에만.
//    새 화면을 추가할 때 visibility 를 빼먹으면 아무에게도 안 보이는 쪽으로
//    실패한다 — 실수로 전체 공개되는 것보다 낫다.
//
// ⚠ 이것은 **보안 장치가 아니라 노출 범위**다. 데이터를 막는 것은 언제나 RLS 다.
//    다만 "메뉴만 숨기기" 로는 주소를 아는 사람이 들어오므로, 라우트도 함께 막는다.

import { atLeast, can } from '@daedong/shared'

/** 공개 범위 — 'all'(로그인한 승인 사용자 전원) | 'admin' | 'superadmin' */
export const VISIBILITY = ['all', 'admin', 'superadmin']

/** 새 모듈을 등록할 때 visibility 를 생략하면 이 값이 된다 */
export const DEFAULT_VISIBILITY = 'superadmin'

export const MODULES = [
  { key: 'dashboard', to: '/', label: '대시보드', end: true, visibility: 'all' },
  { key: 'doc-ai', to: '/doc-ai', label: '문서 작성 AI', visibility: 'all' },
  { key: 'submissions', to: '/submissions', label: '평가계획 제출', visibility: 'all' },
  // 모듈 C-1 — 실운영 전. 당분간 계란님만 보고 다듬는다
  { key: 'calendar', to: '/calendar', label: '학사일정·캘린더', visibility: 'superadmin' },
  {
    key: 'admin-users', to: '/admin/users', label: '사용자 관리',
    visibility: 'admin', action: 'users.manage',
  },
]

/** 이 사용자가 그 모듈을 볼 수 있는가 (메뉴 노출 + 라우트 등록의 유일한 판정) */
export function isVisible(profile, mod) {
  if (!mod) return false
  const scope = mod.visibility || DEFAULT_VISIBILITY
  if (scope === 'admin' && !atLeast(profile, 'admin')) return false
  if (scope === 'superadmin' && !atLeast(profile, 'superadmin')) return false
  // 기존 action 판정도 함께 만족해야 한다 (둘 다 있으면 둘 다)
  if (mod.action && !can(profile, mod.action)) return false
  return true
}

export const visibleModules = (profile) => MODULES.filter((m) => isVisible(profile, m))
