import type { Audience, CalendarEvent, PreviewData } from '../contracts'

const everyone: Audience = { all: true, groups: [], includeMemberIds: [], excludeMemberIds: [] }
const secondGrade: Audience = { all: false, groups: [{ departmentIds: [], gradeIds: ['2'], subjectIds: [] }], includeMemberIds: [], excludeMemberIds: [] }
const research: Audience = { all: false, groups: [{ departmentIds: ['research'], gradeIds: [], subjectIds: [] }], includeMemberIds: [], excludeMemberIds: [] }
const base = { description: '', location: '', endDate: '2026-10-19', allDay: false, startTime: '15:30', endTime: '16:20', visibility: 'school' as const, audience: everyone, version: 1, updatedAt: '2026-10-16T09:00:00+09:00' }
const event = (overrides: Partial<CalendarEvent> & Pick<CalendarEvent, 'id' | 'title' | 'schoolId' | 'authorMemberId' | 'startDate'>): CalendarEvent => ({ ...base, ...overrides })

// 실제 학교·교사·학생과 무관한 합성 자료다. 개발 모드에서만 동적으로 불러온다.
export const fixtureData: PreviewData = {
  basisDate: '2026-10-19',
  schools: [{ id: 'fixture-school-gaon', name: '가온가상중학교' }, { id: 'fixture-school-nuri', name: '누리가상중학교' }],
  memberships: [
    { id: 'gaon-soyeon', schoolId: 'fixture-school-gaon', userId: 'fixture-soyeon', name: '한소연', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: ['curriculum'], gradeIds: ['2'], subjectIds: ['math'] },
    { id: 'gaon-minjun', schoolId: 'fixture-school-gaon', userId: 'fixture-minjun', name: '이민준', role: 'calendar_manager', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: ['curriculum'], gradeIds: ['1'], subjectIds: ['korean'] },
    { id: 'gaon-seojin', schoolId: 'fixture-school-gaon', userId: 'fixture-seojin', name: '김서진', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: ['research'], gradeIds: ['3'], subjectIds: ['science'] },
    { id: 'gaon-ended', schoolId: 'fixture-school-gaon', userId: 'fixture-ended', name: '전출 교사', role: 'teacher', active: false, validFrom: '2026-03-01', validThrough: '2026-08-31', departmentIds: ['research'], gradeIds: ['2'], subjectIds: ['science'] },
    { id: 'nuri-soyeon', schoolId: 'fixture-school-nuri', userId: 'fixture-soyeon', name: '한소연 (겸임)', role: 'teacher', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: ['research'], gradeIds: ['1'], subjectIds: ['math'] },
    { id: 'nuri-harin', schoolId: 'fixture-school-nuri', userId: 'fixture-harin', name: '윤하린', role: 'calendar_manager', active: true, validFrom: '2026-03-01', validThrough: '2027-02-28', departmentIds: ['curriculum'], gradeIds: ['2'], subjectIds: ['korean'] },
  ],
  events: [
    event({ id: 'fixture-event-morning', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-minjun', title: '함께 여는 월요일 · 교직원 협의', description: '이번 주 학교 일정과 협조 사항을 함께 확인합니다.\n필요한 내용은 미리 메모해 오세요.', startDate: '2026-10-19', startTime: '08:30', endTime: '08:50', location: '교무실' }),
    event({ id: 'fixture-event-grade', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-minjun', title: '2학년 체험학습 준비 협의', description: '학급별 사전 안내와 준비 사항을 확인합니다.', startDate: '2026-10-19', audience: secondGrade, location: '2학년 연구실', version: 3 }),
    event({ id: 'fixture-event-my', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-soyeon', title: '수업 자료 정리', description: '이번 주 수업에 사용할 활동지를 점검합니다.', startDate: '2026-10-19', startTime: '16:30', endTime: '17:00', visibility: 'private', location: '내 자리' }),
    event({ id: 'fixture-event-ongoing', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-minjun', title: '도서관 독서 주간', startDate: '2026-10-16', endDate: '2026-10-23', allDay: true, startTime: '', endTime: '', location: '도서관' }),
    event({ id: 'fixture-event-next', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-minjun', title: '교육과정 운영 돌아보기', startDate: '2026-10-21', endDate: '2026-10-21', location: '회의실' }),
    event({ id: 'fixture-event-research', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-seojin', title: '연구부 자료 검토', startDate: '2026-10-20', endDate: '2026-10-20', audience: research, description: '학교 공개 일정이지만 연구부 교사에게만 홈에서 추천합니다.' }),
    event({ id: 'fixture-event-restricted', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-seojin', title: '연구부 내부 협의', startDate: '2026-10-22', endDate: '2026-10-22', audience: research, visibility: 'audience' }),
    event({ id: 'fixture-event-private', schoolId: 'fixture-school-gaon', authorMemberId: 'gaon-seojin', title: '서진의 개인 준비', startDate: '2026-10-19', visibility: 'private' }),
    event({ id: 'fixture-event-nuri', schoolId: 'fixture-school-nuri', authorMemberId: 'nuri-harin', title: '누리학교 교육과정 협의', startDate: '2026-10-19', location: '누리 회의실' }),
  ],
}

export const relationLabels = {
  departmentIds: [{ id: 'curriculum', name: '교무부' }, { id: 'research', name: '연구부' }],
  gradeIds: [{ id: '1', name: '1학년' }, { id: '2', name: '2학년' }, { id: '3', name: '3학년' }],
  subjectIds: [{ id: 'math', name: '수학' }, { id: 'korean', name: '국어' }, { id: 'science', name: '과학' }],
}
