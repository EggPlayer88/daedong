import assert from 'node:assert/strict'
import {loadBrowserModule} from './helpers/load-browser-module.mjs'

const {normalizeAppearancePreferences,readAppearancePreferences,writeAppearancePreferences,DEFAULT_APPEARANCE,APPEARANCE_STORAGE_KEY,renderPanel,renderDialog,renderPair,renderHook}=await loadBrowserModule(`
  import{renderToStaticMarkup}from'react-dom/server';import{AppearancePanel,AppearanceDialog}from'../apps/workhub/src/appearance/AppearancePanel';import{useAppearancePreferences}from'../apps/workhub/src/appearance/preferences';
  export{normalizeAppearancePreferences,readAppearancePreferences,writeAppearancePreferences,DEFAULT_APPEARANCE,APPEARANCE_STORAGE_KEY}from'../apps/workhub/src/appearance/preferences';
  export const renderPanel=props=>renderToStaticMarkup(<AppearancePanel {...props}/>),renderDialog=props=>renderToStaticMarkup(<AppearanceDialog {...props}/>),renderPair=props=>renderToStaticMarkup(<><AppearanceDialog {...props}/><AppearanceDialog {...props}/></>);
  function Hook(){const{preferences,persistenceError}=useAppearancePreferences();return <output>{JSON.stringify({preferences,persistenceError})}</output>}export const renderHook=()=>renderToStaticMarkup(<Hook/>);
`)
const defaults={theme:'light',density:'comfortable',textSize:'standard'},base={preferences:defaults,onChange(){},onReset(){},onClose(){}},custom={theme:'dark',density:'compact',textSize:'large'}
let passed=0,failed=0
function test(name,run){try{run();passed++;console.log('  ✓ '+name)}catch(error){failed++;console.error('  ✗ '+name,error)}}
const store=value=>({getItem(){return value}})

test('기본 화면 값은 화이트·여유 간격·기본 글자이며 반환 객체는 분리된다',()=>{assert.deepEqual(DEFAULT_APPEARANCE,defaults);assert(Object.isFrozen(DEFAULT_APPEARANCE));const value=normalizeAppearancePreferences(null);value.theme='dark';assert.deepEqual(normalizeAppearancePreferences(null),defaults)})
test('세 스킨·두 간격·두 글자 크기의 모든 허용 조합을 보존한다',()=>{for(const theme of ['light','warm','dark'])for(const density of ['comfortable','compact'])for(const textSize of ['standard','large']){const value={theme,density,textSize};assert.deepEqual(normalizeAppearancePreferences(value),value)}})
test('null·배열·문자열·숫자·누락 입력을 기본 화면으로 처리한다',()=>{for(const value of [null,undefined,[],['dark'],'dark',22,false])assert.deepEqual(normalizeAppearancePreferences(value),defaults)})
test('잘못된 개별 필드는 기본값으로 정규화하고 지원하지 않는 값은 적용하지 않는다',()=>{assert.deepEqual(normalizeAppearancePreferences({theme:'javascript:alert(1)',density:'compact',textSize:['large']}),{...defaults,density:'compact'})})
test('정규화 결과에는 계정·학생·토큰 등 임의 필드가 남지 않는다',()=>{assert.deepEqual(normalizeAppearancePreferences({...custom,user:'사용자',student:'학생',token:'비밀',unknown:{nested:true}}),custom)})
test('저장소가 없거나 설정 키가 없으면 오류 없는 기본 화면이다',()=>{for(const storage of [null,store(null)])assert.deepEqual(readAppearancePreferences(storage),{preferences:defaults,persistenceError:''})})
test('읽기는 화면 설정 키 하나만 요청하고 정상 설정을 복원한다',()=>{const keys=[];const result=readAppearancePreferences({getItem(key){keys.push(key);return JSON.stringify(custom)}});assert.deepEqual(keys,[APPEARANCE_STORAGE_KEY]);assert.deepEqual(result,{preferences:custom,persistenceError:''})})
test('깨진 JSON·null·배열·문자열 저장 값은 기본 화면과 읽기 오류를 반환한다',()=>{for(const raw of ['{','null','[]','"dark"','']){const result=readAppearancePreferences(store(raw));assert.deepEqual(result.preferences,defaults);assert.match(result.persistenceError,/읽지 못해/)}})
test('일부만 있거나 잘못된 값이 섞인 저장 설정은 전체 기본값으로 복구한다',()=>{for(const value of [{theme:'dark'},{...custom,textSize:'huge'},{theme:[],density:null,textSize:'large'}]){const result=readAppearancePreferences(store(JSON.stringify(value)));assert.deepEqual(result.preferences,defaults);assert(result.persistenceError)}})
test('저장소 읽기가 차단되어도 예외를 노출하지 않고 기본 화면을 제공한다',()=>{const result=readAppearancePreferences({getItem(){throw new Error('차단')}});assert.deepEqual(result.preferences,defaults);assert(result.persistenceError)})
test('쓰기는 허용된 세 값만 정해진 키에 저장한다',()=>{const writes=[];const error=writeAppearancePreferences({setItem(key,value){writes.push({key,value})}},{...custom,studentId:'외부 자료'});assert.equal(error,'');assert.deepEqual(writes,[{key:APPEARANCE_STORAGE_KEY,value:JSON.stringify(custom)}])})
test('저장 공간 부족·차단은 현재 화면과 저장 여부를 구분하는 안내를 반환한다',()=>{const error=writeAppearancePreferences({setItem(){throw new Error('QuotaExceeded')}} ,custom);assert.match(error,/화면은 바뀌었지만/);assert.match(error,/저장하지 못했습니다/)})
test('쓸 저장소가 없어도 저장 성공으로 표시하지 않는다',()=>{assert.match(writeAppearancePreferences(null,custom),/저장하지 못했습니다/)})
test('브라우저가 없는 서버 렌더링에서도 훅은 기본값으로 렌더링한다',()=>{const html=renderHook();assert(html.includes('&quot;theme&quot;:&quot;light&quot;'));assert(html.includes('&quot;persistenceError&quot;:&quot;&quot;'))})
test('초기 화면에는 작은 설정 진입점만 있고 대화상자는 열리지 않는다',()=>{const html=renderPanel(base);assert(html.includes('aria-haspopup="dialog"'));assert(html.includes('화면 설정'));assert(!html.includes('<dialog'))})
test('설정 대화상자는 이름·설명·세 선택 그룹과 현재 선택값을 연결한다',()=>{const html=renderDialog(base);assert.equal((html.match(/type="radio"/g)||[]).length,7);assert.equal((html.match(/ checked=""/g)||[]).length,3);assert(html.includes('<legend>화면 색상</legend>'));assert(html.includes('<legend>정보 간격</legend>'));assert(html.includes('<legend>글자 크기</legend>'));const labelled=html.match(/aria-labelledby="([^"]+)"/)[1],described=html.match(/aria-describedby="([^"]+)"/)[1];assert(html.includes(`id="${labelled}"`));assert(html.includes(`id="${described}"`));assert(html.includes('기본 설정으로'));assert(html.includes('role="status"'))})
test('반복된 대화상자의 ID와 라디오 그룹은 서로 충돌하지 않는다',()=>{const html=renderPair(base),ids=[...html.matchAll(/\sid="([^"]+)"/g)].map(match=>match[1]),names=new Set([...html.matchAll(/\sname="([^"]+)"/g)].map(match=>match[1]));assert.equal(ids.length,new Set(ids).size);assert.equal(names.size,6)})
test('대화상자에 잘못된 설정 자료를 전달해도 기본 선택으로 표시한다',()=>{for(const preferences of [null,[], 'dark',{theme:null}]){const html=renderDialog({...base,preferences});assert.equal((html.match(/ checked=""/g)||[]).length,3);assert(html.includes('화이트 · 여유롭게 · 기본 글자 크기'))}})
test('저장 실패 안내는 접근 가능한 오류이고 HTML 문자열을 실행하지 않는다',()=>{const html=renderDialog({...base,persistenceError:'<script>차단</script>'});assert(html.includes('role="alert"'));assert(html.includes('&lt;script&gt;차단&lt;/script&gt;'));assert(!html.includes('<script>차단</script>'))})

console.log(`화면 설정: ${passed}개 통과, ${failed}개 실패`)
if(failed)process.exitCode=1
