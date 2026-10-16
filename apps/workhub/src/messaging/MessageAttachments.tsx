import { useEffect, useId, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import { recoveryScope, usePendingRequest } from '../app/pending-requests'
import type { MessageAttachment } from './contracts'
import { MessagingError } from './contracts'
import { newMessageKey } from './composer'
import { MessageFileReservationEndedError, type MessageFileReadiness, type MessageFileServer, type MessageFileStatus } from './files'
import type { FilePolicy } from '../files/contracts'

interface UploadAttempt { file: File; prepareKey: string; completeKey: string; policy: FilePolicy; fileId?: string }
export interface MessageAttachmentsProps {
  server: MessageFileServer; member: Membership; enabled: boolean; disabled: boolean
  files: MessageAttachment[]; onChange: (files: MessageAttachment[]) => void; onLockChange: (locked: boolean) => void
}
function restoredUpload(raw: unknown): UploadAttempt | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Partial<UploadAttempt>
  if (!(value.file instanceof Blob) || typeof value.file.name !== 'string' || typeof value.prepareKey !== 'string' || typeof value.completeKey !== 'string' || !value.policy) return null
  if (value.fileId !== undefined && (typeof value.fileId !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.fileId))) return null
  return value as UploadAttempt
}
export function MessageAttachments({ server, member, enabled, disabled, files, onChange, onLockChange }: MessageAttachmentsProps) {
  const recovery = usePendingRequest(member, 'messagingFile')
  const [pending, setPending] = useState<UploadAttempt | null>(() => restoredUpload(recovery.request?.command))
  const [readiness, setReadiness] = useState<MessageFileReadiness | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [attempt, setAttempt] = useState(0)
  const alive = useRef(true), inFlight = useRef(false), id = useId(), currentFiles = useRef(files)
  const currentScope = useRef(recoveryScope(member))
  currentScope.current = recoveryScope(member)
  currentFiles.current = files
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => { onLockChange(busy || Boolean(pending)); return () => onLockChange(false) }, [busy, pending, onLockChange])
  useEffect(() => {
    let current = true
    setReadiness(null)
    if (!enabled) return
    void Promise.resolve().then(() => server.readiness(member.id)).then(value => { if (current) { setReadiness(value); setError('') } }).catch(() => { if (current) setError('첨부 파일 연결을 확인하지 못했습니다. 메시지 내용은 그대로 남아 있습니다.') })
    return () => { current = false }
  }, [server, member.id, enabled, attempt])
  async function upload(uploadAttempt: UploadAttempt, recovering = false) {
    if (inFlight.current || ((!readiness?.available || !readiness.policy) && !recovering)) return
    const readOnly = !readiness?.available || !readiness.policy
    const startedScope = recoveryScope(member), current = () => alive.current && currentScope.current === startedScope
    let stage: 'prepare' | 'status' | 'complete' | 'upload' = recovering && uploadAttempt.fileId ? 'status' : 'prepare'
    inFlight.current = true; setBusy(true); setError(''); setNotice('')
    setPending(uploadAttempt); recovery.put({ key: uploadAttempt.prepareKey, command: uploadAttempt })
    try {
      // 확인한 파일 ID를 먼저 조회한다. 거절된 예약을 prepare로 다시 열어 반복 충돌하는 일을 막는다.
      let status: MessageFileStatus | undefined = recovering && uploadAttempt.fileId
        ? await server.status(member.id, uploadAttempt.fileId, { file: uploadAttempt.file, policy: uploadAttempt.policy }) : undefined
      if (!current()) return
      if (!status || (status.state !== 'ready' && status.state !== 'rejected' && !readOnly)) {
        stage = 'prepare'
        const reservation = await server.prepare(member.id, uploadAttempt.file, uploadAttempt.policy, uploadAttempt.prepareKey, { replayOnly: Boolean(uploadAttempt.fileId) || readOnly })
        if (!current()) return
        if (uploadAttempt.fileId && uploadAttempt.fileId !== reservation.fileId) throw new MessagingError('RESULT_UNKNOWN')
        const identified = { ...uploadAttempt, fileId: reservation.fileId }
        recovery.put({ key: identified.prepareKey, command: identified })
        setPending(identified)
        stage = readOnly ? 'status' : 'complete'
        status = readOnly ? await server.status(member.id, reservation.fileId, { file: uploadAttempt.file, policy: uploadAttempt.policy }) : await server.complete(member.id, reservation.fileId, uploadAttempt.completeKey)
        if (!current()) return
        if (status.state === 'awaiting_upload' && !readOnly) {
          stage = 'upload'
          await server.upload(member.id, reservation, uploadAttempt.file)
          if (!current()) return
          stage = 'complete'
          status = await server.complete(member.id, reservation.fileId, uploadAttempt.completeKey)
        }
      }
      if (!current()) return
      if (status.state === 'ready' && status.file) {
        const current = currentFiles.current
        if (!current.some(item => item.id === status.file!.id)) onChange([...current, status.file])
        recovery.remove(uploadAttempt.prepareKey); setPending(null); setNotice('HWPX 파일의 기본 확인을 마쳤습니다. 메시지를 보내기 전까지 상대방에게 전달되지 않습니다.')
      } else if (status.state === 'rejected') {
        recovery.remove(uploadAttempt.prepareKey); setPending(null); setError('이 첨부는 확인에서 거절되었거나 업로드 기한이 지났습니다. 원본을 확인한 뒤 다시 선택해 주세요.')
      } else setError('파일 확인이 아직 끝나지 않았습니다. 같은 파일과 요청 번호로 다시 확인해 주세요.')
    } catch (failure) {
      if (!current()) return
      const problem = failure instanceof MessagingError ? failure : new MessagingError('RESULT_UNKNOWN')
      setError(problem.message)
      // 전송 실패·잘못된 응답·계정 갱신은 저장 여부를 뜻하지 않는다. 원본과 키를 보관한다.
      // 접수 뒤 권한·상태 조회가 실패한 경우에도 결과를 추정해 원본과 키를 지우지 않는다.
      if (problem instanceof MessageFileReservationEndedError || (!recovering && !uploadAttempt.fileId && stage === 'prepare' && problem.code === 'INVALID_INPUT')) { setPending(null); recovery.remove(uploadAttempt.prepareKey) }
    } finally { inFlight.current = false; if (current()) setBusy(false) }
  }
  function select(file?: File) {
    if (!file || !readiness?.policy) return
    if (files.length >= readiness.policy.maxFiles || files.some(item => item.name.normalize('NFC').toLowerCase() === file.name.normalize('NFC').toLowerCase())) { setError('첨부 개수 또는 같은 이름의 파일을 확인해 주세요.'); return }
    void upload({ file, prepareKey: newMessageKey(), completeKey: newMessageKey(), policy: structuredClone(readiness.policy) })
  }
  const available = enabled && readiness?.available && readiness.policy
  return <section className="messaging-attachments" aria-label="메시지 HWPX 첨부"><h4>HWPX 파일 첨부</h4>
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    {available ? <><label htmlFor={`${id}-file`}>첨부할 HWPX 파일<input id={`${id}-file`} type="file" accept=".hwpx" aria-describedby={`${id}-policy`} disabled={disabled || busy || Boolean(pending) || files.length >= readiness.policy!.maxFiles} onChange={event => { select(event.target.files?.[0]); event.currentTarget.value = '' }} /></label><p id={`${id}-policy`} className="messaging-muted">HWPX · 파일당 {(readiness.policy!.maxFileBytes / 1024 / 1024).toLocaleString()}MB 이하 · 최대 {readiness.policy!.maxFiles}개. 기본 형식만 확인합니다.</p></> : <p className="messaging-muted">메신저 전용 파일 보관 연결을 준비하고 있습니다. 파일 첨부 없이 메시지를 보낼 수 있습니다.</p>}
    {enabled && !available && <button type="button" disabled={busy} onClick={() => setAttempt(value => value + 1)}>첨부 연결 다시 확인</button>}
    {pending && <div className="messaging-status messaging-recovery"><p>{pending.file.name} 파일의 결과를 확인해야 합니다. 입력과 파일 원본은 현재 탭에만 보관됩니다. 연결 준비 전에는 이미 접수된 파일 상태만 조회합니다.</p><button type="button" disabled={busy || disabled} onClick={() => void upload(pending, true)}>{busy ? '파일 확인 중…' : '같은 파일 확인 계속하기'}</button></div>}
    {files.length > 0 && <ul>{files.map(file => <li key={file.id}><span>{file.name} · {file.bytes.toLocaleString()}바이트</span> <button type="button" disabled={disabled || busy || Boolean(pending)} onClick={() => onChange(files.filter(item => item.id !== file.id))} aria-label={`${file.name} 첨부에서 제외`}>제외</button></li>)}</ul>}
  </section>
}
