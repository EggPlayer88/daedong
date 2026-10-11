// 실제 JSX를 렌더해 확인 범위와 개인정보 없는 표시 계약을 검사한다.
import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { renderInitial, renderReport } = await loadBrowserModule(`
  import { renderToStaticMarkup } from 'react-dom/server'
  import { ConnectionReadinessPanel, ReadinessReportView } from '../apps/workhub/src/app/ConnectionReadinessPanel.tsx'
  export function renderInitial(runCheck, expectedUserId) { return renderToStaticMarkup(<ConnectionReadinessPanel runCheck={runCheck} expectedUserId={expectedUserId}/>) }
  export function renderReport(report) { return renderToStaticMarkup(<ReadinessReportView report={report}/>) }
`)
let passed = 0, failed = 0
function test(name, action) { try { action(); passed++; console.log(`  ✓ ${name}`) } catch(error) { failed++; console.log(`  ✗ ${name}: ${error.stack || error}`) } }
const checkedAt = '2026-10-11T01:00:00.000Z'
const report = (stage, code, count=0) => ({stage,code,checkedAt,readySchoolCount:count})
test('초기 화면은 자동 진단 없이 명시적인 확인 버튼만 제공한다', () => {
  let calls=0
  const html=renderInitial(()=>{calls++;throw new Error('렌더 중 실행 금지')}, 'SECRET-USER-ID')
  assert.equal(calls,0);assert.match(html,/아직 확인하지 않았습니다/);assert.match(html,/>연결 상태 확인<\/button>/)
  assert(!html.includes('SECRET-USER-ID'));assert(!html.includes('>지원용 진단 파일 내려받기</button>'))
  assert(!html.includes('>로그인</button>'));assert(!html.includes('>SQL 실행</button>'))
})
test('학교 소속 조회 성공은 실제 OAuth·일정 조회저장·자료보존 전체 검증으로 표시하지 않는다', () => {
  const initial=renderInitial(async()=>report('ready','CONTEXT_READY',2))
  assert.match(initial,/일정 목록 조회·저장/);assert.match(initial,/실제 Google 로그인 절차/);assert.match(initial,/보존 여부는 이 진단으로 검증하지 않습니다/)
  const html=renderReport(report('ready','CONTEXT_READY',2))
  assert.match(html,/학교 소속 조회까지 확인했습니다/);assert.match(html,/<strong>2곳<\/strong>/)
  assert.equal((html.match(/data-check-state="confirmed"/g)||[]).length,4)
})
test('미로그인·미승인·권한거부·학교소속없음은 서로 다른 안내를 제공한다', () => {
  for(const [stage,code,text,count] of [['logged_out','SESSION_ABSENT','로그인 상태를 먼저',0],['pending','APPROVAL_PENDING','가입 승인이 아직',1],['forbidden','SUPERADMIN_REQUIRED','이용 권한을 확인',2],['no_membership','NO_ACTIVE_MEMBERSHIP','현재 이용할 학교 소속이 없습니다',3]]) {
    const html=renderReport(report(stage,code));assert(html.includes(text));assert.equal((html.match(/data-check-state="confirmed"/g)||[]).length,count)
  }
})
test('조회 기능 부재는 SQL 미실행으로 단정하지 않고 등록·갱신 가능성을 안내한다', () => {
  const html=renderReport(report('foundation_missing','CONTEXT_FUNCTION_MISSING'))
  assert.match(html,/학교 조회 기능의 준비 상태/);assert.match(html,/설정 정보가 갱신되지 않았을 수/);assert.match(html,/SQL 미실행으로 단정하지 않습니다/)
  assert.match(html,/<details[^>]*><summary>관리자용 진단 정보/);assert(!html.includes('<details open'))
})
test('연결 설정 미비·오프라인·시간 초과·계정 변경을 구분한다', () => {
  for(const [stage,code,text] of [['invalid_configuration','INVALID_CONFIGURATION','사이트 연결 설정'],['unavailable','NETWORK_OFFLINE','오프라인 상태여서'],['unavailable','TIMEOUT','확인에 시간이 오래'],['unavailable','SESSION_CHANGED','이전 계정의 진단 결과를 표시하지 않습니다']]) assert(renderReport(report(stage,code)).includes(text))
})
test('지원 화면은 화이트리스트 외 계정·학교·오류 원문을 버린다', () => {
  const html=renderReport({...report('ready','CONTEXT_READY',1),userId:'SECRET-UID',email:'PRIVATE@example.invalid',schoolName:'SECRET-SCHOOL',message:'SECRET-ERROR',access_token:'SECRET-TOKEN'})
  for(const secret of ['SECRET-UID','PRIVATE@example.invalid','SECRET-SCHOOL','SECRET-ERROR','SECRET-TOKEN']) assert(!html.includes(secret))
})
test('깨진 보고서 입력은 화면을 깨거나 성공처럼 표시하지 않는다', () => {
  for(const input of [null,[],{},'bad',{...report('ready','CONTEXT_READY',1),checkedAt:'<script>unsafe</script>'},{...report('ready','CONTEXT_READY',1),readySchoolCount:-1}]) {
    const html=renderReport(input);assert.match(html,/data-readiness-stage="unavailable"/);assert(!html.includes('학교 소속 조회까지 확인했습니다'));assert(!html.includes('<script>'))
  }
})
console.log(`진단 UI ${passed}개 통과`)
if(failed)process.exit(1)
