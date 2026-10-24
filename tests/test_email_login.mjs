import assert from 'node:assert/strict'
import { loadBrowserModule } from './helpers/load-browser-module.mjs'

const { render, login, client } = await loadBrowserModule(`
  import {renderToStaticMarkup} from 'react-dom/server';
  import {MemoryRouter} from 'react-router-dom';
  import LoginPage from '../apps/main/src/pages/LoginPage.jsx';
  import {signInWithEmailPassword, supabase} from '../packages/shared/src/index.js';
  export const client = supabase;
  export const login = signInWithEmailPassword;
  export const render = path => renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><LoginPage /></MemoryRouter>);
`, { env: { MODE:'test', VITE_SUPABASE_URL:'https://example.invalid', VITE_SUPABASE_ANON_KEY:'synthetic' } })

const normal = render('/')
assert(normal.includes('Google 로 로그인'))
assert(!normal.includes('type="password"'))
console.log('  ✓ 기존 로그인 주소의 Google 화면 유지')
const email = render('/?login=email')
assert(email.includes('이메일 계정 로그인') && email.includes('type="password"'))
assert(/autocomplete="username"/i.test(email) && /autocomplete="current-password"/i.test(email))
assert(email.includes('학교 소속 확인은 별도로 필요'))
assert(!email.includes('가입하기'))
console.log('  ✓ 별도 주소에서만 이메일 로그인 입력창 제공, 가입·승인과 구분')
assert(!render('/?login=other').includes('type="password"'))
console.log('  ✓ 다른 주소 값은 기존 로그인 화면으로 처리')
let request
const response = { user:{id:'synthetic-user'}, session:{user:{id:'synthetic-user'}} }
client.auth.signInWithPassword = async value => {request=value;return {data:response,error:null}}
assert.equal(await login(' synthetic@example.invalid ', ' synthetic-password '), response)
assert.deepEqual(request, {email:'synthetic@example.invalid',password:' synthetic-password '})
console.log('  ✓ 공통 Supabase 인증 사용, 이메일만 정리하고 비밀번호 원문 전달')
const failure = { code:'invalid_credentials', message:'synthetic' }
client.auth.signInWithPassword = async () => ({data:null,error:failure})
await assert.rejects(login('synthetic@example.invalid','wrong'), error => error === failure)
console.log('  ✓ 인증 거절을 성공으로 바꾸지 않음')
