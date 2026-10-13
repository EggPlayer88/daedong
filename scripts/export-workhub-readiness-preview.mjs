import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 연결 진단 UI만 시연한다. 기존 인증 클라이언트와 외부 서버를 포함하지 않는다.
const root = fileURLToPath(new URL('../', import.meta.url))
const destination = resolve(process.argv[2] || resolve(root, 'dist/workhub-readiness-preview.html'))
const source = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ConnectionReadinessPanel} from './apps/workhub/src/app/ConnectionReadinessPanel';
import {runReadinessCheck} from './apps/workhub/src/connection/readiness';
import {fixtureData,relationLabels} from './apps/workhub/src/preview/fixtures';
const choices=[['ready','학교 소속 조회 가능'],['foundation_missing','학교 조회 기능 미준비'],['no_membership','학교 소속 없음'],['pending','가입 승인 미확인'],['profile_missing','기존 가입 정보 연결 누락'],['logged_out','로그인 없음'],['forbidden','시험 화면 이용 권한 없음'],['unavailable','통신 실패']];
function Preview(){
  const [mode,setMode]=useState('foundation_missing');
  async function runCheck(){
    await new Promise(resolve=>setTimeout(resolve,250));
    const services={
      async getSession(){return mode==='logged_out'?null:{user:{id:'fixture-soyeon'}}},
      async fetchMyProfile(){return mode==='profile_missing'?null:{id:'fixture-soyeon',name:'합성 교사',email:'synthetic@example.invalid',role:mode==='forbidden'?'teacher':'superadmin',extra_permissions:[],department_id:null,is_active:mode!=='pending'}},
      async rpc(){if(mode==='unavailable')throw new Error('합성 통신 실패');if(mode==='foundation_missing')return {data:null,error:{code:'PGRST202'}};return {data:mode==='no_membership'?{schools:[],memberships:[],basisDate:fixtureData.basisDate,schoolLabels:{}}:{...fixtureData,schoolLabels:Object.fromEntries(fixtureData.schools.map(school=>[school.id,relationLabels]))},error:null}},
      onAuthStateChange(){return()=>{}},async signInWithGoogle(){throw new Error('지원하지 않는 시연 기능')},async signOut(){throw new Error('지원하지 않는 시연 기능')},
    };
    return runReadinessCheck(services);
  }
  return <main><header className="demo-heading"><p className="eyebrow">학교업무혁신시스템 · 3차 개발</p><h1>학교 연결을 확인하는 과정</h1><p>아래에서 시험할 상황을 선택하고 연결 상태 확인 버튼을 눌러 보세요.</p><p className="demo-notice"><strong>합성 결과 시연</strong>실제 로그인·학교 서버에 접속하지 않습니다. 여기서 내려받는 파일도 합성 진단 결과입니다.</p></header><label className="demo-scenario">시험할 상황<select value={mode} onChange={event=>setMode(event.target.value)}>{choices.map(([value,label])=><option value={value} key={value}>{label}</option>)}</select></label><ConnectionReadinessPanel key={mode} expectedUserId="synthetic-preview" runCheck={runCheck}/><footer>기존 계정을 이어 쓰는 신축 시스템 · 읽기 전용 연결 진단 시연</footer></main>;
}
createRoot(document.getElementById('root')).render(<Preview/>);
`
const result = await build({ absWorkingDir: root, stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, write: false, format: 'iife', jsx: 'automatic', minify: true, loader: { '.css': 'text' }, define: { 'process.env.NODE_ENV': '"production"' } })
const js = result.outputFiles[0].text
if (js.includes('signInWithOAuth') || js.includes('supabase.auth')) throw new Error('실제 인증 클라이언트가 시연에 포함되었습니다.')
const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>학교업무혁신시스템 · 연결 진단 시연</title><link rel="icon" href="data:,"><style>body{margin:0;background:#f1f5ee;color:#24443c;font:16px/1.7 'Malgun Gothic',sans-serif}*{box-sizing:border-box}main{max-width:850px;margin:40px auto;padding:0 24px}h1{font-size:clamp(24px,4vw,32px);line-height:1.4;margin:5px 0 14px}.eyebrow{font-size:12px;font-weight:bold;color:#417365}.demo-heading>p{font-size:14px}.demo-notice{padding:14px 18px;border:1px solid #bed1c1;border-radius:12px;background:#e7f0e6}.demo-notice strong{display:block}.demo-scenario{display:block;font-weight:bold;font-size:14px}.demo-scenario select{display:block;width:100%;font:inherit;min-height:44px;margin:8px 0 18px;padding:8px 12px;border:1px solid #aebfb5;border-radius:8px;background:white;color:inherit}footer{font-size:12px;color:#60796e;margin:26px 0 50px}@media(max-width:500px){main{margin:24px auto;padding:0 16px}}</style></head><body><div id="root"></div><script>${js.replaceAll('</script', '<\\/script')}</script></body></html>`
await mkdir(dirname(destination), { recursive: true })
await writeFile(destination, html, 'utf8')
console.log(`연결 진단 시연 저장: ${destination} (${Buffer.byteLength(html).toLocaleString()} bytes)`)
