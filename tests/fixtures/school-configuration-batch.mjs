export function schoolBatchFixture() {
  return { configuration: { draftId:'year-one', schoolName:'합성 중학교',schoolCode:'synthetic-middle',schoolType:'middle',gradeCount:'3',schoolYear:'2026',startsOn:'2026-03-01',lastDay:'2027-02-28',
    terms:[{id:'term-one',termNo:'1',name:'1학기',startsOn:'2026-03-01',lastDay:'2026-08-12'},{id:'term-two',termNo:'2',name:'2학기',startsOn:'2026-08-13',lastDay:'2027-02-28'}],
    departments:[{id:'dept-one',name:'교육과정부'}], classes:[{id:'class-one',grade:'1',classNo:'1',name:'1학년 1반',kind:'regular'}] }, subjects:[{id:'subject-one',name:'도덕'}] }
}
