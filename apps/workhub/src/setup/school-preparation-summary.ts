import type { SchoolAdminSnapshot } from './school-admin-contract'
import type { SchoolRosterSnapshot } from './school-roster-contracts'
import type { TeachingCatalog } from '../teaching/contracts'
import type { TargetSnapshot } from '../timetable/target'
import type { SetupSnapshot } from '../timetable/setup'
import { compilePreparation, initialPreparationDraft, type PreparationSource } from '../timetable/preparation'
import { preparationProgress } from '../timetable/preparation-progress'

export type SchoolPreparationDestination = 'roster' | 'school' | 'teaching' | 'target' | 'setup' | 'preparation' | 'import'
export type PreparationRead<T> = { ok: true; value: T } | { ok: false; code: string }
export interface SchoolPreparationEvidence {
  roster: PreparationRead<SchoolRosterSnapshot>
  target: PreparationRead<TargetSnapshot>
  school: PreparationRead<SchoolAdminSnapshot>
  teaching: PreparationRead<TeachingCatalog>
  setup: PreparationRead<SetupSnapshot>
  preparation: PreparationRead<PreparationSource>
  imported: PreparationRead<PreparationSource>
}
export interface SchoolPreparationStep {
  id: SchoolPreparationDestination; title: string
  state: 'present' | 'action' | 'blocked' | 'unavailable' | 'unknown'
  summary: string; details: string[]; action: string
}
export interface SchoolPreparationReport {
  checkedAt: string; termLabel: string | null; steps: SchoolPreparationStep[]
  next: SchoolPreparationDestination | null; needsAttention: number; unknownCount: number
}
const titles: Record<SchoolPreparationDestination, [string, string]> = {
  roster: ['교사 연결', '가입 교사 연결하기'], target: ['준비할 학기', '대상 학기 선택하기'],
  school: ['학급·교과', '학교 구성 입력하기'], teaching: ['수업·학생', '수업·학생 입력하기'],
  setup: ['공간·수업 연결', '공간·학급 연결하기'], preparation: ['시수·일과', '시수·일과 입력하기'],
  import: ['실제 시간표', '시간표 파일 확인하기'],
}
function step(id: SchoolPreparationDestination, state: SchoolPreparationStep['state'], summary: string, details: string[] = []): SchoolPreparationStep {
  return { id, title: titles[id][0], state, summary, details, action: titles[id][1] }
}
function failure(id: SchoolPreparationDestination, code: string): SchoolPreparationStep {
  if (['NOT_READY', 'UNAVAILABLE', 'not_configured', 'not_installed'].includes(code)) return step(id, 'unavailable', '이 기능의 서버 준비 또는 활성화를 확인해 주세요.')
  if (['FORBIDDEN', 'forbidden', 'INACTIVE_MEMBERSHIP'].includes(code)) return step(id, 'unavailable', '현재 계정의 관리 권한과 학교 소속을 확인해 주세요.')
  return step(id, 'unknown', code === 'CONFLICT' ? '조회 중 대상 학기나 원본이 바뀌었습니다. 다시 확인해 주세요.' : '자료를 확인하지 못했습니다. 비어 있거나 완료된 것으로 판단하지 않습니다.')
}
const value = <T,>(read: PreparationRead<T>): T | null => read.ok ? read.value : null
const periodMatches = (source: { termId: string; firstDay: string; lastDay: string }, term: { id: string; firstDay: string; lastDay: string }) =>
  source.termId === term.id && source.firstDay === term.firstDay && source.lastDay === term.lastDay

/** 각 모듈의 기존 검증기를 통과한 읽기 결과만 집계한다. 공개·설치·학교 전체 준비 완료를 추정하지 않는다. */
export function schoolPreparationSummary(evidence: SchoolPreparationEvidence, checkedAt: string): SchoolPreparationReport {
  const target = value(evidence.target), term = target?.terms.find(row => row.id === target.termId)
  const setup = value(evidence.setup), source = value(evidence.preparation), imported = value(evidence.imported)
  const setupMatches = !!term && !!setup && periodMatches(setup, term)
  const sourceMatches = !!term && !!source && periodMatches(source, term)
  const consistentSource = setupMatches && sourceMatches && setup.sourceRevision === source.sourceRevision && setup.sourceFingerprint === source.sourceFingerprint
  const steps: SchoolPreparationStep[] = []
  const roster = value(evidence.roster)
  if (!evidence.roster.ok) steps.push(failure('roster', evidence.roster.code))
  else if (!roster!.available) steps.push(failure('roster', roster!.reason ?? 'NOT_READY'))
  else steps.push(step('roster', roster!.teachers.length ? 'present' : 'action', `수업 담당 후보 ${roster!.teachers.length}명 · 연결된 가입 교사 ${roster!.candidates.filter(row => row.state === 'linked').length}명`, [
    '필요한 실제 교사가 모두 포함됐는지는 명단에서 확인해 주세요. 이름이 같아도 같은 회원으로 연결하지 않습니다.',
    `연결 전 후보 ${roster!.candidates.filter(row => row.state === 'unlinked').length}명 · 연결 조건 확인 ${roster!.candidates.filter(row => row.state === 'blocked').length}명`,
  ]))
  if (!evidence.target.ok) steps.push(failure('target', evidence.target.code))
  else if (!term) steps.push(step('target', target?.termId ? 'unknown' : 'action', target?.termId ? '대상 학기를 목록에서 확인하지 못했습니다. 학기 선택에서 다시 확인해 주세요.' : '준비할 학년도를 등록하고 대상 학기를 선택해 주세요.'))
  else steps.push(step('target', 'present', `${term.schoolYear}학년도 ${term.label}`, [
    `${term.firstDay} ~ ${term.lastDay}`, term.hasBasis ? '확정된 기준판이 있습니다. 현재 원본과 맞는지는 아래에서 다시 확인합니다.' : '확정된 기준판은 아직 없습니다.',
  ]))
  const school = value(evidence.school)
  if (!evidence.school.ok) steps.push(failure('school', evidence.school.code))
  else if (!school!.capabilities.configuration) steps.push(failure('school', 'FORBIDDEN'))
  else if (!term || Number(school!.configuration.schoolYear) !== term.schoolYear || !school!.configuration.terms.some(row => row.id === term.id && row.startsOn === term.firstDay && row.lastDay === term.lastDay)) steps.push(failure('school', 'CONFLICT'))
  else steps.push(step('school', school!.configuration.classes.length && school!.subjects.length ? 'present' : 'action', `학급 ${school!.configuration.classes.length}개 · 교과 ${school!.subjects.length}개`, [
    `${term.schoolYear}학년도 학교 구성입니다. 다른 학년도의 학급을 섞어 세지 않습니다.`,
    ...(!school!.configuration.classes.length ? ['학급 목록을 입력해 주세요.'] : []),
    ...(!school!.subjects.length ? ['교과 목록을 입력해 주세요.'] : []),
  ]))
  const catalog = value(evidence.teaching)
  if (!evidence.teaching.ok) steps.push(failure('teaching', evidence.teaching.code))
  else if (!catalog!.canManageCourses) steps.push(failure('teaching', 'FORBIDDEN'))
  else if (!term || !catalog!.terms.some(row => row.id === term.id && row.firstDay === term.firstDay && row.lastDay === term.lastDay)) steps.push(failure('teaching', 'CONFLICT'))
  else {
    const courses = catalog!.courses.filter(row => row.termId === term.id), details = ['선택한 학기의 수업만 집계합니다. 수업과 실제 담당 교사·수강 명부를 함께 확인해 주세요.']
    let teachingState: SchoolPreparationStep['state'] = courses.length ? 'present' : 'action'
    if (setupMatches) {
      const known = new Set(courses.map(row => row.id)), rows = setup.courses.filter(row => known.has(row.id))
      const withoutStudents = rows.filter(row => row.studentCount === 0).length
      if (withoutStudents || rows.length !== courses.length) teachingState = 'action'
      details.push(`시간표 준비 조회에서 확인한 수강 등록 합계 ${rows.reduce((n, row) => n + row.studentCount, 0)}건 — 여러 수업에 중복 등록된 학생을 포함합니다.`)
      if (withoutStudents) details.push(`학생 명부가 비어 있는 수업 ${withoutStudents}개. 학급형 시간표를 만들 수 있어도 학생 기록 사용 전에는 명부를 준비해 주세요.`)
      if (rows.length !== courses.length) details.push('수업 목록과 시간표 준비 대상 수업 수가 다릅니다. 보관·기간·연결 상태를 수업 화면에서 확인해 주세요.')
    } else { teachingState = 'unknown'; details.push('학생 명부 인원은 이번 조회에서 확인하지 못했습니다. 학생이 없는 것으로 처리하지 않습니다.') }
    steps.push(step('teaching', teachingState, `이 학기 수업 ${courses.length}개`, details))
  }
  if (!evidence.setup.ok) steps.push(failure('setup', evidence.setup.code))
  else if (!setupMatches) steps.push(failure('setup', 'CONFLICT'))
  else {
    const missingCapacity = setup.spaces.filter(row => row.capacity === null).length
    const missingLink = setup.courses.filter(row => !row.link || (!row.link.studentGroup && !row.link.classIds.length)).length
    const missingTeacher = setup.courses.filter(row => !row.teacherLabels.length).length
    const blockers = setup.findings.filter(row => row.blocksConfirm)
    steps.push(step('setup', blockers.length ? 'blocked' : missingCapacity || missingLink || missingTeacher || !setup.courses.length ? 'action' : 'present',
      `등록 공간 ${setup.spaces.length}개 · 시간표 연결 수업 ${setup.courses.filter(row => row.inTimetable).length}개`,
      [`동시 수업 수 미입력 ${missingCapacity}개 · 학급·수강 집단 연결 확인 ${missingLink}개 · 담당 교사 확인 ${missingTeacher}개`,
        ...blockers.slice(0, 3).map(row => row.message), ...(blockers.length > 3 ? [`추가 확인 항목 ${blockers.length - 3}개는 공간·학급 연결 화면에서 확인해 주세요.`] : []),
        '공간을 쓰지 않는 수업에 불필요한 공간을 임의로 등록하지 않습니다.']))
  }
  let preparationReady = false
  if (!evidence.preparation.ok) steps.push(failure('preparation', evidence.preparation.code))
  else if (!sourceMatches || !consistentSource) steps.push(failure('preparation', 'CONFLICT'))
  else if (!source.canEdit) steps.push(failure('preparation', 'FORBIDDEN'))
  else if (source.savedDraft && source.savedDraft.sourceFingerprint !== source.sourceFingerprint) steps.push(step('preparation', 'blocked', '학교 자료가 바뀌어 저장한 준비 초안을 다시 확인해야 합니다.', ['기존 초안과 입력은 유지됩니다. 준비 화면에서 현재 자료를 채택한 뒤 비교해 주세요.']))
  else {
    const draft = source.savedDraft?.draft ?? initialPreparationDraft(source), progress = preparationProgress(source, draft)
    const compiled = compilePreparation(source, draft)
    preparationReady = !!compiled.basis && !!source.savedDraft && source.canConfirm
    steps.push(step('preparation', preparationReady ? 'present' : 'action',
      `수업 ${progress.counts.all}개 중 기본 입력 ${progress.counts.ready}개 · 일과 ${draft.slots.length}개`,
      [source.savedDraft ? '서버에 저장한 초안을 기준으로 확인했습니다. 화면에만 작성한 미저장 입력은 포함하지 않습니다.' : '서버에 저장한 준비 초안이 아직 없습니다.',
        `시수 확인 ${progress.counts.hours}개 · 활동 구성 확인 ${progress.counts.activities}개 · 허용 시간대 확인 ${progress.counts.slots}개`,
        ...compiled.issues.slice(0, 2).map(row => row.message),
        ...(source.unsupportedFeatures.length ? ['지원하지 않는 학사 조건이 있습니다. 준비 화면의 차단 사유를 확인해 주세요.'] : []),
        ...(!source.canConfirm ? ['현재 계정은 기준판 확정 권한이 없습니다.'] : [])]))
  }
  if (!evidence.imported.ok) steps.push(failure('import', evidence.imported.code))
  else if (!term || !source || !periodMatches(imported!, term) || !consistentSource || imported!.sourceFingerprint !== source.sourceFingerprint || imported!.sourceRevision !== source.sourceRevision) steps.push(failure('import', 'CONFLICT'))
  else steps.push(step('import', 'action', preparationReady ? '현재 학교 자료로 실제 시간표 파일을 확인할 수 있습니다.' : '기초자료를 준비한 뒤 실제 시간표 파일을 연결해 주세요.', [
    '가져오기 화면에서 실제 교사·학급·수업 ID와 시간표를 대조하고 변경 내용을 확인합니다.',
    '가져오기 접수와 공개 시간표 확정 여부는 이 안내의 조회만으로 판단하지 않습니다. 기존 공개 시간표는 별도 확정 전까지 유지됩니다.',
  ]))
  return { checkedAt, termLabel: term ? `${term.schoolYear}학년도 ${term.label}` : null, steps,
    next: steps.find(row => row.state !== 'present')?.id ?? null,
    needsAttention: steps.filter(row => row.state === 'action' || row.state === 'blocked').length,
    unknownCount: steps.filter(row => row.state === 'unknown' || row.state === 'unavailable').length }
}
