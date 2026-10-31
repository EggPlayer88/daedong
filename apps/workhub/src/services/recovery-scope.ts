import type { Membership } from '../contracts'

// 권한 범위 식별은 React 화면과 독립적으로 공유한다. 값과 정렬 규칙은 유지한다.
export const recoveryScope = (member: Membership) =>
  JSON.stringify([
    member.userId,
    member.schoolId,
    member.id,
    member.active,
    member.validFrom,
    member.validThrough,
    member.role,
    [...(member.departmentIds ?? [])].sort(),
    [...(member.gradeIds ?? [])].sort(),
    [...(member.subjectIds ?? [])].sort(),
  ])
