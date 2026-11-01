import type { GeneratedDocument } from '../documents/guided-contracts'
import type { CollectionOperationsServer } from './operations'
import { useEffect, useLayoutEffect } from 'react'
import type { Membership } from '../contracts'
import { FileError, type FilePolicy } from '../files/contracts'
import type {
  AnswerInput,
  CollectionDraft,
  CollectionInput,
  CollectionRequest,
} from '../workflows/types'
import {
  CollectionServerError,
  type CollectionServer,
  type CollectionFileParent,
  type CollectionUpload,
} from './contracts'
import { type StagedTemplate } from './template-staging'
export interface CollectionServerPanelProps {
  server: CollectionServer
  operations?: CollectionOperationsServer
  incomingFile?: GeneratedDocument
  onIncomingFileConsumed?: () => void
  member: Membership
  members: Membership[]
  date: string
  revision?: number
  openRequest?: { key: string; id: string }
  onNavigationLockChange?: (locked: boolean) => void
}
export type Editor = {
  original?: CollectionRequest
  input: CollectionInput
  staged?: StagedTemplate[]
  saving?: boolean
  createdId?: string
  createdVersion?: number
}
export type Answer = {
  requestId: string
  unitId: string
  original: CollectionDraft | null
  input: AnswerInput
  reason: string
  correctionRequestId: string
  confirmedVersion?: number
  confirmedInput?: AnswerInput
}
export type Upload = {
  stagedId?: string
  file: File
  parent: CollectionFileParent
  policy: FilePolicy
  prepareKey: string
  completeKey: string
  intent?: CollectionUpload
  phase: 'prepare' | 'upload' | 'complete' | 'status'
  rejected?: boolean
  cancelable?: boolean
}
export type Review = {
  unitId: string
  submissionId: string
  expectedVersion: number
  note: string
  dueDate: string
}
export type Management = {
  kind: 'withdraw' | 'open_correction'
  unitId: string
  submissionId: string | null
  expectedVersion: number
  reason: string
  dueDate: string
  confirmed: boolean
}
export type Session = {
  selectedId?: string
  editor?: Editor
  answer?: Answer
  upload?: Upload
  review?: Review
  management?: Management
  conflict?: boolean
  parked?: boolean
  recoveryConflict?: boolean
}
export type FocusTarget = {
  name: string
  key?: string
  field?: number
  start?: number | null
  end?: number | null
}
export const blank = (): CollectionInput => ({
  title: '',
  instructions: '',
  dueDate: '',
  reviewMode: 'none',
  reviewerMemberId: '',
  textLabel: '',
  textRequired: false,
  numberLabel: '',
  numberRequired: false,
  units: [],
})
export const inputOf = ({
  title,
  instructions,
  dueDate,
  reviewMode,
  reviewerMemberId,
  textLabel,
  textRequired,
  numberLabel,
  numberRequired,
  units,
  fileCollection,
}: CollectionRequest): CollectionInput => ({
  title,
  instructions,
  dueDate,
  reviewMode,
  reviewerMemberId,
  textLabel,
  textRequired,
  numberLabel,
  numberRequired,
  units,
  fileCollection,
})
export const knownRejection = (failure: unknown) =>
  failure instanceof CollectionServerError &&
  [
    'INVALID_INPUT',
    'FORBIDDEN',
    'INACTIVE_MEMBERSHIP',
    'NOT_FOUND',
    'CONFLICT',
    'FILE_NOT_READY',
    'FILE_FAILED',
  ].includes(failure.code)
export const accessDenied = (failure: unknown) =>
  failure instanceof CollectionServerError &&
  ['FORBIDDEN', 'INACTIVE_MEMBERSHIP', 'NOT_FOUND'].includes(failure.code)
export const failureMessage = (failure: unknown) =>
  failure instanceof FileError
    ? failure.message
    : failure instanceof CollectionServerError && failure.code === 'NOT_READY'
      ? '현재 파일 확인 연결을 준비 중이거나 요청이 많습니다. 입력과 기존 요청 번호를 보관했습니다. 잠시 뒤 다시 확인해 주세요.'
      : failure instanceof CollectionServerError && failure.code === 'IDEMPOTENCY_CONFLICT'
        ? '저장 요청이 서버의 기존 기록과 일치하지 않습니다. 입력과 요청 번호는 보관했습니다. 새 요청으로 다시 저장하지 말고 관리자에게 확인해 주세요.'
        : failure instanceof CollectionServerError && failure.code === 'CONFLICT'
          ? '다른 곳에서 먼저 변경했습니다. 내 입력은 유지했습니다. 최신 원본을 다시 확인한 뒤 편집해 주세요.'
          : knownRejection(failure)
            ? '서버가 이 작업을 허용하지 않았습니다. 현재 권한, 기한, 파일과 입력을 확인해 주세요. 입력은 유지했습니다.'
            : '처리 결과를 확인하지 못했습니다. 입력과 요청 번호를 보관했습니다. 같은 요청으로 다시 확인해 주세요.'
export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
export const layoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
