import {createPilotState,applyPilotCommand,closePilotRequest,parsePilotState,pilotDigest} from './operations'
import {getPilotFixture,type PilotFixture} from './fixture'
import {PilotOperationError,type PilotCommandResult,type PilotEnvelope,type PilotState} from './operations-contracts'
import {gzipSync,Gunzip} from 'fflate'

const FILE_SCHEMA='timetable.pilot.backup.v1'
export const PILOT_BACKUP_MAX_BYTES=24*1024*1024
export const PILOT_STORAGE_PREFIX='workhub-pilot-gzip-v1:'
export const PILOT_STORAGE_COMPRESSED_MAX_BYTES=8*1024*1024
export interface PilotStorage {getItem(key:string):string|null;setItem(key:string,value:string):void}
export interface PilotLocks {request<T>(name:string,callback:()=>Promise<T>):Promise<T>}
export interface PilotStoreOptions {
  fixture:PilotFixture
  /** 실제 학교·계정 식별자는 이 해시 입력 외에 자료 본문이나 파일에 넣지 않는다. */
  scope:string|{schoolId:string;accountId:string}
  storage?:PilotStorage
  locks?:PilotLocks|null
  isCurrentScope?:()=>boolean
}
export interface PilotStore {
  snapshot():PilotState
  transact(envelope:PilotEnvelope):Promise<PilotCommandResult>
  close(envelope:PilotEnvelope):Promise<PilotCommandResult>
  exportFile():Promise<string>
  restoreFile(contents:string):Promise<PilotState>
  /** 다른 탭의 변경을 읽는다. 손상된 자료를 덮어쓰지 않는다. */
  reload():Promise<PilotState>
  /** 로그아웃·학교·계정 전환 때 호출한다. 이전 핸들의 조회·저장을 즉시 막는다. */
  dispose():void
  readonly persistent:boolean
}
const fail=(code:ConstructorParameters<typeof PilotOperationError>[0],message:string):never=>{throw new PilotOperationError(code,message)}
const crcTable=Uint32Array.from({length:256},(_,index)=>{
  let value=index
  for(let bit=0;bit<8;bit++)value=value&1?0xedb88320^(value>>>1):value>>>1
  return value>>>0
})
const toBase64=(bytes:Uint8Array):string=>{
  const chunks:string[]=[]
  for(let index=0;index<bytes.length;index+=32768)chunks.push(String.fromCharCode(...bytes.subarray(index,index+32768)))
  return btoa(chunks.join(''))
}
function compressStorage(contents:string):string {
  const input=new TextEncoder().encode(contents)
  if(input.length>PILOT_BACKUP_MAX_BYTES)fail('CAPACITY_EXCEEDED','연습 자료가 저장 한도를 초과했습니다.')
  // 같은 내용은 같은 저장 문자열이 되도록 시각 필드를 고정한다. CAS는 이 문자열 전체를 비교한다.
  const compressed=gzipSync(input,{level:6,mtime:0})
  if(compressed.length>PILOT_STORAGE_COMPRESSED_MAX_BYTES)fail('CAPACITY_EXCEEDED','압축한 연습 자료가 저장 한도를 초과했습니다.')
  return PILOT_STORAGE_PREFIX+toBase64(compressed)
}
function expandStorage(contents:string):string {
  // 이전 버전의 JSON 저장도 기존 SHA-256 및 자료 검증을 그대로 거친다.
  if(!contents.startsWith(PILOT_STORAGE_PREFIX))return contents
  const base64=contents.slice(PILOT_STORAGE_PREFIX.length)
  if(!base64.length||base64.length>Math.ceil(PILOT_STORAGE_COMPRESSED_MAX_BYTES/3)*4||base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))fail('INVALID_INPUT','압축 저장 자료의 크기 또는 형식이 잘못되었습니다.')
  try{
    const binary=atob(base64)
    if(binary.length>PILOT_STORAGE_COMPRESSED_MAX_BYTES||btoa(binary)!==base64)fail('INVALID_INPUT','압축 저장 자료가 손상됐습니다.')
    const compressed=Uint8Array.from(binary,character=>character.charCodeAt(0))
    // 이 저장 형식은 선택 헤더·연결된 gzip을 만들지 않는다. 긴 헤더를 반복 해석하는 경로도 받지 않는다.
    if(compressed.length<18||compressed[0]!==0x1f||compressed[1]!==0x8b||compressed[2]!==8||compressed[3]!==0)fail('INVALID_INPUT','지원하지 않는 압축 저장 형식입니다.')
    const trailer=new DataView(compressed.buffer,compressed.byteOffset+compressed.length-8,8)
    const expectedCrc=trailer.getUint32(0,true),expectedLength=trailer.getUint32(4,true)
    if(expectedLength>PILOT_BACKUP_MAX_BYTES)fail('INVALID_INPUT','해제한 연습 자료는 24MB를 초과할 수 없습니다.')
    let size=0,crc=0xffffffff
    const chunks:string[]=[],decoder=new TextDecoder('utf-8',{fatal:true})
    const stream=new Gunzip((chunk)=>{
      size+=chunk.length
      // gzip의 길이 선언을 믿지 않고 실제 출력 누계로 다시 막는다.
      if(size>PILOT_BACKUP_MAX_BYTES)fail('INVALID_INPUT','해제한 연습 자료는 24MB를 초과할 수 없습니다.')
      for(const byte of chunk)crc=crcTable[(crc^byte)&255]^(crc>>>8)
      chunks.push(decoder.decode(chunk,{stream:true}))
    })
    stream.onmember=()=>fail('INVALID_INPUT','여러 압축 문서를 연결한 저장 자료는 지원하지 않습니다.')
    // 한 번에 크게 확장하지 않도록 작은 입력 단위로 해제한다.
    for(let index=0;index<compressed.length;index+=1024)stream.push(compressed.subarray(index,index+1024),index+1024>=compressed.length)
    chunks.push(decoder.decode())
    if(size!==expectedLength||((crc^0xffffffff)>>>0)!==expectedCrc)fail('INVALID_INPUT','압축 저장 자료의 길이 또는 검사값이 일치하지 않습니다.')
    return chunks.join('')
  }catch(error){
    if(error instanceof PilotOperationError)throw error
    return fail('INVALID_INPUT','압축 저장 자료를 읽지 못했습니다. 원본을 보존한 채 다시 확인해 주세요.')
  }
}
function parseFileText(contents:string):Record<string,unknown> {
  if(typeof contents!=='string'||contents.length>PILOT_BACKUP_MAX_BYTES||new TextEncoder().encode(contents).length>PILOT_BACKUP_MAX_BYTES)fail('INVALID_INPUT','연습 파일은 24MB 이내여야 합니다.')
  let value:unknown
  try{value=JSON.parse(contents)}catch{return fail('INVALID_INPUT','연습 파일을 읽을 수 없습니다. 원본 파일을 보존하고 다시 확인해 주세요.')}
  if(!value||typeof value!=='object'||Array.isArray(value))return fail('INVALID_INPUT','연습 파일 형식이 다릅니다.')
  return value as Record<string,unknown>
}
function assertSynthetic(state:PilotState):void {
  const original=getPilotFixture(),roles=new Map(original.teachers.map(item=>[item.id,item]))
  // 가입 명단 매핑은 별도 메모리 계층이다. 파일에 실명·회원 ID를 섞는 실수를 막는다.
  for(const fixture of [state.fixture,...state.timetableVersions.map(row=>row.previousFixture)]){
    if(fixture.teachers.some(item=>item.kind!=='virtual'||roles.get(item.id)?.label!==item.label)||fixture.teachers.length!==original.teachers.length)fail('INVALID_INPUT','실제 교사 연결 자료는 연습 저장 파일에 포함할 수 없습니다.')
  }
}
async function encode(state:PilotState,scopeHash:string):Promise<string> {
  assertSynthetic(state)
  const payload={schema:FILE_SCHEMA,scopeHash,state}
  const result=JSON.stringify({...payload,checksum:await pilotDigest(payload)})
  if(new TextEncoder().encode(result).length>PILOT_BACKUP_MAX_BYTES)fail('CAPACITY_EXCEEDED','연습 파일이 저장 한도를 초과했습니다.')
  return result
}
async function decode(contents:string,scopeHash:string):Promise<PilotState> {
  const value=parseFileText(contents)
  if(Object.keys(value).sort().join(',')!=='checksum,schema,scopeHash,state'||value.schema!==FILE_SCHEMA||typeof value.checksum!=='string')fail('INVALID_INPUT','지원하지 않는 연습 파일입니다.')
  if(value.scopeHash!==scopeHash)fail('SCOPE_CHANGED','현재 학교·계정에서 만든 연습 파일만 복원할 수 있습니다.')
  if(await pilotDigest({schema:value.schema,scopeHash:value.scopeHash,state:value.state})!==value.checksum)fail('INVALID_INPUT','파일 내용이 달라졌습니다. 손상되지 않은 원본을 선택해 주세요.')
  const state=parsePilotState(value.state)
  assertSynthetic(state)
  return state
}
export async function createPilotStore(options:PilotStoreOptions):Promise<PilotStore> {
  if(typeof options.scope==='string'?!options.scope.trim():!options.scope.schoolId||!options.scope.accountId)fail('INVALID_INPUT','현재 학교·계정 연결을 확인해 주세요.')
  const scopeHash=await pilotDigest({purpose:'timetable-pilot-storage',scope:options.scope})
  const key=`workhub:timetable-pilot:v1:${scopeHash}`
  let storage:PilotStorage|undefined
  try{storage=options.storage??(typeof window!=='undefined'?window.localStorage:undefined)}catch{return fail('STORAGE_UNAVAILABLE','브라우저 저장소 접근이 차단됐습니다. 설정을 확인한 뒤 다시 열어 주세요.')}
  const locks=options.locks===null?undefined:options.locks??(typeof navigator!=='undefined'&&navigator.locks?{request:<T>(name:string,callback:()=>Promise<T>)=>navigator.locks.request(name,callback)}:undefined)
  let active=true,state=createPilotState(options.fixture),lastRaw:string|null=null
  const current=()=>{if(!active||options.isCurrentScope&&!options.isCurrentScope())fail('SCOPE_CHANGED','학교 또는 계정이 바뀌었습니다. 현재 계정에서 연습 화면을 다시 열어 주세요.')}
  const read=()=>{try{return storage?.getItem(key)??null}catch{return fail('STORAGE_UNAVAILABLE','브라우저 저장소를 읽지 못했습니다. 기존 연습 자료를 지우지 않습니다.')}}
  const write=(value:string)=>{try{storage!.setItem(key,value)}catch{return fail('STORAGE_UNAVAILABLE','저장 공간이 부족하거나 저장이 차단됐습니다. 작업은 반영되지 않았습니다. 내보내기로 현재 자료를 보관해 주세요.')}}
  current()
  lastRaw=read()
  if(lastRaw!==null)state=await decode(expandStorage(lastRaw),scopeHash)
  current()
  let chain:Promise<unknown>=Promise.resolve()
  const exclusive=<T>(action:()=>Promise<T>,checkRevision=true):Promise<T>=>{
    const run=async()=>{
      current()
      const checked=async()=>{current();if(checkRevision&&storage&&read()!==lastRaw)fail('STORAGE_CONFLICT','다른 탭에서 연습 자료를 바꿨습니다. 새로 읽은 뒤 다시 처리해 주세요.');return action()}
      if(!storage)return checked()
      if(!locks)fail('STORAGE_LOCK_UNAVAILABLE','이 브라우저에서 안전한 탭 간 저장을 지원하지 않습니다. 최신 Chrome 또는 Edge에서 열어 주세요.')
      return locks!.request(key,checked)
    }
    const result=chain.then(run,run);chain=result.catch(()=>undefined);return result
  }
  const commit=async(next:PilotState)=>{
    const encoded=await encode(next,scopeHash)
    const stored=storage?compressStorage(encoded):null
    current()
    if(storage)write(stored!)
    // 저장 성공 전에는 메모리의 현재 자료를 교체하지 않는다.
    lastRaw=stored;state=structuredClone(next)
  }
  return{
    persistent:!!storage,
    snapshot(){current();return structuredClone(state)},
    transact(input){return exclusive(async()=>{
      const result=await applyPilotCommand(state,input)
      if(!result.duplicate)await commit(result.state)
      current();return{...result,state:structuredClone(state)}
    })},
    close(input){return exclusive(async()=>{
      const result=await closePilotRequest(state,input)
      if(!result.duplicate)await commit(result.state)
      current();return{...result,state:structuredClone(state)}
    })},
    async exportFile(){current();const encoded=await encode(state,scopeHash);current();return encoded},
    restoreFile(contents){return exclusive(async()=>{
      const restored=await decode(contents,scopeHash);current()
      // 이력이 있는 현재 세션보다 오래된 사본은 접수 번호를 부활시킬 수 있어 거부한다.
      if(restored.revision<state.revision)fail('CONFLICT','현재 연습보다 오래된 파일입니다. 최신 접수 이력을 지우는 복원은 허용하지 않습니다.')
      if(state.receipts.some(receipt=>!restored.receipts.some(row=>row.requestId===receipt.requestId&&row.commandHash===receipt.commandHash&&row.status===receipt.status)))fail('CONFLICT','현재 요청 이력을 보존하지 않는 파일입니다.')
      await commit(restored);return structuredClone(state)
    })},
    reload(){return exclusive(async()=>{
      const raw=read()
      if(raw===null&&lastRaw!==null)fail('STORAGE_CONFLICT','기존 저장 자료가 없어졌습니다. 현재 메모리를 내보내기로 보관한 뒤 다시 열어 주세요.')
      const next=raw===null?createPilotState(options.fixture):await decode(expandStorage(raw),scopeHash)
      current();state=next;lastRaw=raw;return structuredClone(state)
    },false)},
    dispose(){active=false},
  }
}
