import type { Membership } from '../contracts'
export const COOPERATION_CONTRACT='cooperation.v1'
export const COOPERATION_LIMITS={page:40,title:160,body:8000,reason:2000,catalog:500} as const
export type CooperationStatus='requested'|'accepted'|'declined'|'completion_requested'|'completed'|'cancelled'
export type CooperationAction='accept'|'decline'|'request_completion'|'confirm_completion'|'return_completion'|'retract_completion'|'cancel'
export type CooperationFilter={box:'received'|'sent';status:CooperationStatus|'all';query:string;cursor:string|null}
export interface CooperationRequest {id:string;schoolId:string;version:number;senderMemberId:string;recipientMemberId:string;senderName:string;recipientName:string;title:string;description:string;dueDate:string;status:CooperationStatus;createdAt:string;updatedAt:string;taskLink:{taskId:string;ownerUserId:string}|null}
export interface CooperationHistory {id:string;action:'create'|'handover'|CooperationAction;actorMemberId:string;comment:string;recordedAt:string;version:number;actorName?:string;recipientMemberId?:string;previousRecipientMemberId?:string|null}
export interface CooperationDetail {request:CooperationRequest;history:CooperationHistory[]}
export interface CooperationCatalog {recipients:{memberId:string;name:string;description:string}[];sourceTasks:{id:string;title:string;version:number}[];nextTaskCursor:string|null}
export type CooperationCommand={kind:'create';recipientMemberId:string;title:string;description:string;dueDate:string;sourceTask:{id:string;expectedVersion:number}|null}|{kind:'transition';requestId:string;expectedVersion:number;action:CooperationAction;comment:string}
export interface CooperationReceipt {requestKey:string;commandKind:CooperationCommand['kind'];entityId:string;version:number;outcome:'applied'|'replayed';appliedAt:string}
export interface CooperationAdapter {catalog(memberId:string,taskCursor?:string|null):Promise<CooperationCatalog>;list(memberId:string,filter:CooperationFilter):Promise<{items:CooperationRequest[];nextCursor:string|null}>;detail(memberId:string,id:string):Promise<CooperationDetail>;mutate(memberId:string,command:CooperationCommand,key:string):Promise<CooperationReceipt>}
export const statusLabels:Record<CooperationStatus,string>={requested:'응답 대기',accepted:'진행 중',declined:'반려',completion_requested:'완료 확인 대기',completed:'완료 확인됨',cancelled:'취소됨'}
export const actionLabels:Record<CooperationAction,string>={accept:'수락',decline:'반려',request_completion:'완료 확인 요청',confirm_completion:'완료 확인',return_completion:'보완 요청',retract_completion:'완료 요청 철회',cancel:'요청 취소'}
export function allowedActions(r:CooperationRequest,member:Pick<Membership,'id'|'schoolId'>):CooperationAction[]{if(r.schoolId!==member.schoolId)return [];if(r.recipientMemberId===member.id){if(r.status==='requested')return ['accept','decline'];if(r.status==='accepted')return ['request_completion'];if(r.status==='completion_requested')return ['retract_completion']}if(r.senderMemberId===member.id){if(r.status==='completion_requested')return ['confirm_completion','return_completion','cancel'];if(['requested','accepted'].includes(r.status))return ['cancel']}return []}

export function nextCooperationStatus(action:CooperationAction):CooperationStatus{return {accept:'accepted',decline:'declined',request_completion:'completion_requested',confirm_completion:'completed',return_completion:'accepted',retract_completion:'accepted',cancel:'cancelled'}[action] as CooperationStatus}

// 이력에는 인계를 표시하지만 협업 상태전환 명령에는 인계를 허용하지 않는다.
export const historyLabels:Record<CooperationHistory['action'],string>={create:'요청 작성',...actionLabels,handover:'담당 인계 수락'}
// 새 이력은 그 행의 처리자 이름을 쓴다. 구형 P2의 인계 없는 이력만 현재 당사자 이름으로 표시한다.
export function historyActorName(request:CooperationRequest,history:CooperationHistory):string{if(history.actorName!==undefined)return history.actorName;if(history.actorMemberId===request.senderMemberId)return request.senderName;if(history.actorMemberId===request.recipientMemberId)return request.recipientName;return '이름 확인 필요'}
