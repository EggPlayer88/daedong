// 역할·권한 상수 (P5: DB 가 진실. 여기 있는 것은 UI 표시용 + 계층 순서 정의뿐)

/** users.role CHECK 제약과 1:1 (001) */
export const ROLES = {
  SUPERADMIN: 'superadmin',
  ADMIN: 'admin',
  DEPARTMENT_HEAD: 'department_head',
  TEACHER: 'teacher',
}

/**
 * 역할 계층 (D7: 상위가 하위를 포함). 숫자가 클수록 상위.
 * ⚠ DB 헬퍼 함수(is_admin / is_dept_head_or_above)는 "포함 관계"를 명시적 IN 목록으로
 *   표현한다. 여기의 서열도 그 IN 목록과 결과가 같아야 한다 (permissions.js 주석 참조).
 */
export const ROLE_RANK = {
  [ROLES.TEACHER]: 0,
  [ROLES.DEPARTMENT_HEAD]: 1,
  [ROLES.ADMIN]: 2,
  [ROLES.SUPERADMIN]: 3,
}

/** 화면 표기용 (P5: 표시 전용) */
export const ROLE_LABELS = {
  [ROLES.SUPERADMIN]: '슈퍼관리자',
  [ROLES.ADMIN]: '관리자',
  [ROLES.DEPARTMENT_HEAD]: '부장',
  [ROLES.TEACHER]: '교사',
}

export const ROLE_COLORS = {
  [ROLES.SUPERADMIN]: '#f87171',
  [ROLES.ADMIN]: '#a78bfa',
  [ROLES.DEPARTMENT_HEAD]: '#fbbf24',
  [ROLES.TEACHER]: '#34d399',
}

/**
 * extra_permissions 에 넣을 수 있는 값 (D7: 계층과 무관한 추가 권한).
 * 스키마 변경 없이 늘어나므로, 여기 없는 값이 DB 에 있어도 오류가 아니다.
 */
export const EXTRA_PERMISSIONS = {
  TIMETABLE_MANAGE: 'timetable_manage',
}

export const EXTRA_PERMISSION_LABELS = {
  [EXTRA_PERMISSIONS.TIMETABLE_MANAGE]: '시간표 관리',
}
