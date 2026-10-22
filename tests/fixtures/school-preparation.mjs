export const preparationMember = {id:'admin-one',schoolId:'school-one',userId:'user-one',name:'관리자',role:'school_admin',active:true,validFrom:'2020-01-01',validThrough:'2100-12-31',departmentIds:[],gradeIds:[],subjectIds:[]}
export function schoolPreparationFixture() {
  const source={sourceRevision:1,sourceFingerprint:'a'.repeat(64),schoolId:'school-one',schoolLevel:'middle',termId:'term-one',termLabel:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-20',canEdit:true,canConfirm:true,
    resources:[{id:'teacher-one',kind:'teacher',label:'기존 교사',capacity:1},{id:'class-one',kind:'class',label:'1학년 1반',capacity:1}],
    courses:[{id:'course-one',label:'1반 국어',requiredPeriods:null,resourceIds:['teacher-one','class-one']}],unsupportedFeatures:[],
    savedDraft:{id:'draft-one',revision:1,sourceFingerprint:'a'.repeat(64),draft:{title:'1학기',slots:[{id:'mon-1',day:1,label:'1교시',startMinute:540,endMinute:585,periods:1}],plans:[{courseId:'course-one',weeklyPeriods:1,blocks:[{id:'lesson-one',periods:1,allowedSlotIds:['mon-1']}]}]}}}
  return {
    roster:{available:true,reason:null,version:1,asOfDate:'2026-10-21',candidates:[{legacyUserId:'00000000-0000-0000-0000-000000000001',name:'기존 교사 비공개 이름',memberId:'teacher-one',state:'linked'}],teachers:[{id:'teacher-one',label:'기존 교사 비공개 이름'}]},
    target:{termId:'term-one',automaticTermId:null,selectedTermId:'term-one',version:1,terms:[{id:'term-one',schoolYear:2027,label:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-20',state:'planning',hasBasis:false,hasPreparationDraft:true}]},
    school:{version:1,asOfDate:'2026-10-21',availableYears:[2027],configuration:{draftId:'year-one',schoolName:'시험 학교',schoolCode:'test',schoolType:'middle',gradeCount:'3',schoolYear:'2027',startsOn:'2027-03-01',lastDay:'2028-02-29',terms:[{id:'term-one',termNo:'1',name:'1학기',startsOn:'2027-03-01',lastDay:'2027-07-20'}],departments:[],classes:[{id:'class-one',grade:'1',classNo:'1',name:'1반',kind:'regular'}]},subjects:[{id:'subject-one',name:'국어'}],memberships:[],assignments:[],capabilities:{configuration:true,memberships:true,assignments:true}},
    teaching:{contractVersion:'teaching.v1',schoolId:'school-one',memberId:'admin-one',ownerUserId:'user-one',courses:[{id:'course-one',schoolId:'school-one',version:1,label:'1반 국어',termId:'term-one',subjectId:'subject-one',assignmentId:null,validFrom:'2027-03-01',validThrough:'2027-07-20',canRecord:false,canCounsel:false,canManageRoster:true}],terms:[{id:'term-one',schoolId:'school-one',version:1,label:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-20'}],subjects:[{id:'subject-one',label:'국어'}],approvedTeachers:[{id:'teacher-one',label:'기존 교사'}],canManageCourses:true},
    setup:{termId:'term-one',termLabel:'1학기',firstDay:'2027-03-01',lastDay:'2027-07-20',referenceDay:'2027-03-01',sourceRevision:1,sourceFingerprint:'a'.repeat(64),canEdit:true,spaces:[],classes:[{id:'class-one',label:'1학년 1반',grade:1}],courses:[{id:'course-one',label:'1반 국어',inTimetable:true,teacherLabels:['기존 교사'],studentCount:27,link:{version:1,studentGroup:false,classIds:['class-one'],spaceIds:[]}}],findings:[]},
    preparation:source,imported:structuredClone(source),
  }
}
export function schoolPreparationEnvelope(name, data, member=preparationMember) {
  if(name==='workhub_teaching_catalog')return data
  if(name==='workhub_school_admin_get')return {kind:'workhub-school-admin',schemaVersion:1,schoolId:member.schoolId,memberId:member.id,data}
  const contracts={workhub_school_roster_get:'school-roster.v1',workhub_timetable_target_get:'timetable.target.v1',workhub_timetable_setup_get:'timetable.setup.v1',workhub_timetable_preparation_get:'timetable.preparation.v1',workhub_timetable_import_get:'timetable-import.v1'}
  return {contract:contracts[name],schoolId:member.schoolId,memberId:member.id,data}
}
export const preparationRpcKeys={workhub_school_roster_get:'roster',workhub_school_admin_get:'school',workhub_teaching_catalog:'teaching',workhub_timetable_target_get:'target',workhub_timetable_setup_get:'setup',workhub_timetable_preparation_get:'preparation',workhub_timetable_import_get:'imported'}
