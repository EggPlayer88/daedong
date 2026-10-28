import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs'
import {resolve,join,dirname} from 'node:path'
import {loadSecrets,connectSandbox,assertMarker} from './environment.mjs'

// 계정 비밀번호만 사용자 전달 폴더에 넣고 DB·API·암호화 키는 복사하지 않는다.
const input=process.argv[2],directory=dirname(input),output=resolve('private-sandbox/연간시험_전달자료')
const people=JSON.parse(readFileSync(join(directory,'accounts.json'),'utf8'))
const roster=JSON.parse(readFileSync(new URL('../../sandbox/school-year/roster.json',import.meta.url),'utf8'))
assert.equal(people.length,22)
const c=await connectSandbox(loadSecrets(input))
let expiry
try{await assertMarker(c);expiry=(await c.query('select min(expires_at) expires from sandbox_private.cohort')).rows[0].expires.toISOString()}finally{await c.end()}
mkdirSync(output,{recursive:true})
const labels={administrator_teacher:'관리자 겸 교사',timetable_manager_teacher:'시간표 담당 겸 교사',teacher:'일반 교사'}
const rows=people.map(p=>{
 const teacher=roster.teachers.find(t=>t.id===p.teacherId)
 const role=labels[p.role]??(p.teacherId==='T01'?'시간표 담당 겸 교사':null)
 assert.ok(role)
 return `| ${p.teacherId} | ${teacher.name} | ${role} | ${p.email} | ${p.password} |`
})
writeFileSync(join(output,'01_시험계정_비공개.md'),[
 '# 연간 시험 임시 계정 — 비공개',
 '',
 '로그인: https://daedong-year-sandbox.vercel.app/?login=email',
 '',
 `계정 사용 만료(UTC): ${expiry}. 가상 시계와 별개로 만료합니다.`,
 '',
 '이 파일은 비밀번호가 있으므로 공개 PR·공개 보고서에 올리지 않습니다. 사용자가 지정한 Claude 시험 작업에만 전달하세요. 실제 학교 회원과 관계없는 가명 계정입니다. API 키·DB 비밀번호·서버 암호화 키는 포함하지 않습니다.',
 '',
 '| 번호 | 화면 이름 | 시험 역할 | 이메일 | 임시 비밀번호 |',
 '|---|---|---|---|---|',...rows,
 '',
 'T09부터 로그인합니다. 일반 교사를 시험할 때는 로그아웃 후 해당 교사로 로그인하거나 별도 브라우저 프로필을 사용합니다. 같은 프로필의 탭은 로그인 상태를 공유할 수 있습니다.',
 '',
 'T01은 일반 회원 역할 teacher와 시간표 담당 year.manage만 가집니다. T09만 superadmin입니다. 일반 교사에게 관리자 권한을 주지 않습니다.',
 '',
].join('\n'),{mode:0o600})
copyFileSync('sandbox/school-year/Claude_연간시험_전달문.md',join(output,'02_Claude_연간시험_전달문.md'))
copyFileSync('sandbox/school-year/README.md',join(output,'03_환경과_검증_안내.md'))
copyFileSync('examples/예시_2026학년도_2학기_3학년_수학_평가계획서.hwpx',join(output,'04_시험용_평가계획서.hwpx'))
writeFileSync(join(output,'00_시작하기.md'),[
 '# 가상 학교 연간 시험 시작',
 '',
 '사이트: https://daedong-year-sandbox.vercel.app',
 '',
 '1. 01_시험계정_비공개.md에서 T09 계정으로 로그인합니다.',
 '2. 노란 가상 학교 표시, 2027-03-01 일시정지, AI 누적 상한 $9를 확인합니다.',
 '3. Claude에게 02_Claude_연간시험_전달문.md와 계정표, 시험 HWPX를 전달합니다.',
 '4. 시계 시작은 Claude가 시험 준비를 마친 뒤 합니다. 실제 진행 시간 1시간이면 가상 1년이며, 역할 전환·기록 중에는 일시정지할 수 있습니다.',
 '5. 2월 말에 결과를 내보낸 후 마지막으로 학년도 종료를 확인합니다. 끝까지 진행하면 그 학년도 소속도 만료합니다.',
 '',
 '운영 사이트 주소 daedong-school.vercel.app에서는 시험하지 않습니다. 전용 키는 이미 서버에 암호화 연결되어 있어 Claude에게 키를 전달할 필요가 없습니다.',
 '',
 '원본 교사별 시수표를 중복 없이 세면 22명입니다. 관리자 겸 교사 1명 + 시간표 담당 겸 교사 1명 + 일반 교사 20명으로 구성했습니다.',
 '',
 '2026학년도 2학기 시수표로 합성한 2027학년도 시험입니다. 실제 2027학년도 1학기 시간표와 공휴일·방학을 재현했다고 가정하지 않습니다.',
 '',
].join('\n'),{mode:0o600})
console.log('비공개 전달자료 준비 완료: '+output+' (계정 22개, 서버 비밀값 제외)')
