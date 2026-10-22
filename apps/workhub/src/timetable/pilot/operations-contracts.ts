import type {PilotFixture} from './fixture'
import type {TimetableReplacementPreview} from './timetable-replacement'

// 이 계약은 브라우저 안의 운영 연습이다. 실제 동의·승인·서버 접수증으로 전송하지 않는다.
export const PILOT_OPERATIONS_SCHEMA = 'timetable.pilot.operations.v1' as const
export const PILOT_MANAGER_IDS = ['pilot-manager-1', 'pilot-manager-2'] as const
export type PilotErrorCode = 'INVALID_INPUT' | 'CONFLICT' | 'REQUEST_CLOSED' | 'NOT_FOUND' | 'FORBIDDEN' |
  'CONSENT_REQUIRED' | 'SELF_APPROVAL' | 'RESOURCE_CONFLICT' | 'SCHOOL_CLOSED' | 'LESSON_CHANGED' |
  'ALREADY_PERFORMED' | 'MAKEUP_EXISTS' | 'PARTIAL_CLOSURE' | 'STORAGE_UNAVAILABLE' |
  'STORAGE_CONFLICT' | 'SCOPE_CHANGED' | 'STORAGE_LOCK_UNAVAILABLE' | 'CAPACITY_EXCEEDED'
export class PilotOperationError extends Error {
  constructor(readonly code:PilotErrorCode, message:string) {super(message);this.name='PilotOperationError'}
}
export interface PilotLesson {
  id:string; templateId:string; originLessonId:string|null; date:string; period:number
  startTime:string; endTime:string; teacherId:string; classIds:string[]; roomId:string; subject:string
  status:'scheduled'|'cancelled'|'performed'; cancellation:'school_day'|'requested'|null; version:number
}
export interface PilotEdit {
  /** 새 보강(before=null)의 기대판은 originLessonId가 가리키는 원수업의 판이다. */
  lessonId:string; expectedVersion:number; before:PilotLesson|null; after:PilotLesson
}
export type PilotProposalKind = 'swap'|'move'|'substitute'|'cancel'|'makeup'
export interface PilotProposal {
  id:string; kind:PilotProposalKind; requesterId:string; reason:string
  status:'awaiting_consent'|'awaiting_approval'|'approved'|'rejected'|'withdrawn'
  edits:PilotEdit[]; requiredTeacherIds:string[]
  consents:{teacherId:string;decision:'accepted'|'rejected';revision:number}[]
  approvedBy:string|null; createdRevision:number; resolvedRevision:number|null
}
export interface PilotNotification {
  id:string; recipientId:string; kind:'request'|'decision'|'changed'|'school_day'
  title:string; proposalId:string|null; lessonIds:string[]; revision:number; read:boolean
}
export interface PilotHistory {
  revision:number; actorId:string; requestId:string; kind:PilotCommand['type']
  summary:string; lessonIds:string[]; simulated:true
}
export interface PilotRecord {lessonId:string;teacherId:string;lessonVersion:number;note:string;revision:number}
export interface PilotReceipt {
  requestId:string; commandHash:string; actorId:string; revision:number
  status:'applied'|'closed'; entityId:string|null; simulated:true
}
export type PilotCommand =
  | {type:'propose';kind:PilotProposalKind;lessonIds:string[];targetDate?:string;targetPeriod?:number;substituteTeacherId?:string;reason:string}
  | {type:'consent';proposalId:string;decision:'accepted'|'rejected'}
  | {type:'approve';proposalId:string}
  | {type:'reject';proposalId:string;reason:string}
  | {type:'withdraw';proposalId:string}
  | {type:'school_day';date:string;classIds:string[];closed:boolean;reason:string}
  | {type:'special_day';date:string;classIds:string[];slots:{period:number;startTime:string;endTime:string}[];reason:string}
  | {type:'record';lessonId:string;expectedLessonVersion:number;note:string}
  | {type:'read_notification';id:string}
  | {type:'replace_timetable';preview:TimetableReplacementPreview;reviewDate:string;reason:string}
export interface PilotEnvelope {requestId:string;actorId:string;expectedRevision:number;command:PilotCommand}
export interface PilotState {
  schema:typeof PILOT_OPERATIONS_SCHEMA; simulated:true; fixture:PilotFixture; revision:number
  lessons:PilotLesson[]; proposals:PilotProposal[]; notifications:PilotNotification[]; history:PilotHistory[]
  records:PilotRecord[]; receipts:PilotReceipt[]
  closedDays:{date:string;classIds:string[];reason:string}[]
  specialDays:{date:string;classIds:string[];slots:{period:number;startTime:string;endTime:string}[];reason:string}[]
  timetableVersions:{revision:number;effectiveFrom:string;previewFingerprint:string;previousFixture:PilotFixture}[]
}
export interface PilotCommandResult {state:PilotState;receipt:PilotReceipt;duplicate:boolean}
export interface PilotSwapRecommendation {lessonId:string;date:string;period:number;teacherId:string;subject:string;reason:string}
