import type { CalendarEvent, EventDraft } from '../contracts'
export const BATCH_CONTRACT='calendar-batch.v1'
// 한 번의 원자 커밋 처리 상한. 학교별 일정 정책을 대신하지 않는다.
export const BATCH_LIMIT=50
export type BatchState='new'|'duplicate'|'changed'|'conflict'|'held'
export type BatchRow={key:string;line:number;sourceId:string;sourceHash:string;draft:EventDraft}
export type BatchInput={sourceKey:string;sourceLabel:string;fileHash:string;omittedColumns:string[];rows:BatchRow[]}
export interface BatchPreviewRow {key:string;line:number;sourceId:string;sourceHash:string;state:BatchState;reason:string;incoming:EventDraft;eventId:string|null;expectedVersion:number|null;baseline:EventDraft|null;current:CalendarEvent|null}
export interface BatchPreview {prepareId:string;previewHash:string;sourceKey:string;fileHash:string;expiresAt:string;rows:BatchPreviewRow[]}
export type BatchSelection={key:string;sourceId:string;sourceHash:string;eventId:string|null;expectedVersion:number|null;decision:'create'|'update'|'replace_conflict'}
export type BatchCommit={kind:'calendar_batch_commit';prepareId:string;previewHash:string;selections:BatchSelection[]}
export interface BatchReceipt {requestKey:string;prepareId:string;previewHash:string;outcome:'applied'|'replayed';appliedAt:string;items:{key:string;sourceId:string;eventId:string;version:number}[]}
export interface CalendarBatchAdapter {prepare(memberId:string,input:BatchInput):Promise<BatchPreview>;commit(memberId:string,command:BatchCommit,key:string):Promise<BatchReceipt>}
export const batchStateLabels:Record<BatchState,string>={new:'신규',duplicate:'중복 · 변경 없음',changed:'원본 변경',conflict:'사이트 변경과 충돌',held:'보류'}
