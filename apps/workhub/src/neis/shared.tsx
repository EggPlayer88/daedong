import {useMemo} from 'react'
import type {SupabaseConnection} from '../connection/supabase-connection'
import {createNeisServer,createNeisHttp} from './server'
import type {Snapshot} from './contracts'

export const message=(e:unknown)=>e instanceof Error?e.message:'자료를 확인하지 못했습니다.'
export function useServer(connection:SupabaseConnection){return useMemo(()=>createNeisServer(connection,createNeisHttp({getSession:async()=>(await import('../connection/legacy-client')).legacyServices.getSession()})),[connection])}
export function Updated({data}:{data:Snapshot}){return <p className="neis-meta">{data.fetchedAt?'확인 '+new Date(data.fetchedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'아직 가져온 자료가 없습니다.'}{data.errorCode&&' · 갱신하지 못해 마지막 확인 자료를 표시합니다.'}</p>}
