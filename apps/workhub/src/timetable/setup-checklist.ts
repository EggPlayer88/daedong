import type { SetupSnapshot, SetupFinding } from './setup'

export interface SetupAction { kind: 'space' | 'course'; id: string; label: string }
export interface SetupCheckItem { id: string; group: 'connection' | 'capacity' | 'official'; message: string; target: string; blocksConfirm: boolean; actions: SetupAction[]; needsSchoolAdmin: boolean }
export interface SetupChecklist { activeCourses: number; connectedCourses: number; spacesUsed: number; spacesReady: number; items: SetupCheckItem[] }

/** 서버 진단을 실제 수정 대상에 연결한다. 숫자는 연결 현황이며 편성 완료율이 아니다. */
export function setupChecklist(source: SetupSnapshot): SetupChecklist {
  const active = source.courses.filter(course => course.inTimetable)
  const validConnection = (course: SetupSnapshot['courses'][number]) => Boolean(course.link && (course.link.studentGroup || course.link.classIds.length > 0) && course.link.classIds.every(id => source.classes.some(row => row.id === id)))
  const used = new Set(active.flatMap(course => course.link?.spaceIds ?? []))
  const spaces = source.spaces.filter(row => used.has(row.id))
  const findings: SetupFinding[] = [...source.findings]
  // 합성 미리보기나 이전 서버 자료에서도 비어 있는 연결을 준비 완료로 표시하지 않는다.
  for (const course of active) if (!validConnection(course) && !findings.some(item => item.targetId === course.id && ['COURSE_LINK_MISSING', 'LINK_CLASS_REMOVED'].includes(item.code))) findings.push({ code: 'COURSE_LINK_MISSING', targetId: course.id, message: `${course.label}: 학생 집단 연결을 확인해 주세요.`, blocksConfirm: false })
  for (const space of spaces) if (space.capacity === null && !findings.some(item => item.code === 'SPACE_CAPACITY_MISSING' && item.targetId === space.id)) findings.push({ code: 'SPACE_CAPACITY_MISSING', targetId: space.id, message: `${space.label}: 동시에 열 수 있는 수업 수를 입력해 주세요.`, blocksConfirm: true })
  const items = findings.map((finding, index): SetupCheckItem => {
    const group = finding.code === 'SPACE_CAPACITY_MISSING' ? 'capacity' : ['COURSE_LINK_MISSING', 'LINK_CLASS_REMOVED', 'LINK_SPACE_REMOVED', 'STUDENT_OVERLAP'].includes(finding.code) ? 'connection' : 'official'
    const ids = finding.code === 'STUDENT_OVERLAP' ? finding.targetId.split('/') : [finding.targetId]
    const actions: SetupAction[] = group === 'capacity' ? source.spaces.filter(row => row.id === finding.targetId).map(row => ({ kind: 'space', id: row.id, label: row.label })) : group === 'connection' ? ids.flatMap(id => { const row = source.courses.find(course => course.id === id); return row ? [{ kind: 'course' as const, id: row.id, label: row.label }] : [] }) : []
    return { id: `${finding.code}:${finding.targetId}:${index}`, group, message: finding.message, target: finding.targetId, blocksConfirm: finding.blocksConfirm, actions, needsSchoolAdmin: group === 'official' || !actions.length }
  })
  return { activeCourses: active.length, connectedCourses: active.filter(validConnection).length, spacesUsed: used.size, spacesReady: spaces.filter(row => row.capacity !== null).length, items }
}

export function setupChecklistText(source: SetupSnapshot): string {
  const result = setupChecklist(source)
  return ['시간표 준비 점검표', `학기: ${source.termLabel} (${source.firstDay} ~ ${source.lastDay})`, `담당·수강 관계 기준일: ${source.referenceDay}`, `자료 판: ${source.sourceRevision}`, `연결 확인: ${result.connectedCourses}/${result.activeCourses}개 수업`, `사용 공간 정원 입력: ${result.spacesReady}/${result.spacesUsed}개`, '', '이 문서는 현재 준비 자료의 점검용입니다. 시수·일과·필수조건 검사나 학기 시간표 확정을 증명하지 않습니다.', '', ...(result.items.length ? result.items.map((item, index) => `${index + 1}. ${item.message}\n   대상: ${item.target}\n   다음 작업: ${item.needsSchoolAdmin ? '학교 관리에서 공식 학기·배정·관계 확인' : item.group === 'capacity' ? '공간의 동시 수업 수 입력' : '수업의 학급·수강집단·공간 연결 확인'}`) : ['표시할 연결 진단이 없습니다. 시수·일과를 확인하고 편성 기준판 검사를 이어가세요.']), '', '학생 이름·개인 상담 사유는 포함하지 않습니다. 교사·수업 정보가 있을 수 있으므로 학교가 허용한 위치에 보관하세요.'].join('\n')
}
