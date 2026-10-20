import { lazy, Suspense, useCallback, useMemo, useRef, useState } from 'react'
import type { Membership } from '../contracts'
import type { SupabaseConnection } from '../connection/supabase-connection'
import { createSchoolDataMaintenanceServer } from '../teaching/school-data-maintenance-server'
import { createTeachingRelationsAdapter } from '../teaching/relations-adapter'
import { createTimetableSetupServer } from './setup-server'
import teachingStyles from '../teaching/teaching.css?inline'
import setupStyles from './timetable-setup.css?inline'
import setupBatchStyles from './timetable-setup-batch.css?inline'
import { usePendingRequest } from '../app/pending-requests'
import type { RelationCommit } from '../teaching/relations-contracts'

const SchoolAdminPanel = lazy(() => import('../setup/SchoolAdminPanel').then(m => ({ default: m.SchoolAdminPanel })))
const MaintenancePanel = lazy(() => import('../teaching/SchoolDataMaintenancePanel').then(m => ({ default: m.SchoolDataMaintenancePanel })))
const RelationsPanel = lazy(() => import('../teaching/RelationsPanel').then(m => ({ default: m.RelationsPanel })))
const SetupPanel = lazy(() => import('./TimetableSetupPanel').then(m => ({ default: m.TimetableSetupPanel })))

export type ImportCorrectionTarget = { kind: 'school' } | { kind: 'setup'; termId: string }
  | { kind: 'course' | 'relations'; courseId: string }
export interface ImportCorrectionContext { connection: SupabaseConnection; date: string; revision?: number }
interface Props extends ImportCorrectionContext {
  target: ImportCorrectionTarget; member: Membership; onClose: () => void
}
const labels = { school: '교과·학급·학교 자료', setup: '공간·수업과 학급 연결', course: '수업 자료', relations: '담당·수강 관계' }

/** 가져오기 입력은 상위에 보관한다. 하위 화면의 원래 저장·복구 경로를 그대로 사용한다. */
export function TimetableImportCorrectionPanel({ connection, date, revision, member, target, onClose }: Props) {
  const relationRecovery = usePendingRequest(member, 'teachingRelations')
  const originalRelation = relationRecovery.request?.command as RelationCommit | undefined
  const [relationCourseId] = useState(() => target.kind === 'relations' ? originalRelation?.intent?.courseId ?? target.courseId : '')
  const maintenance = useMemo(() => createSchoolDataMaintenanceServer(connection), [connection])
  const relations = useMemo(() => createTeachingRelationsAdapter(connection), [connection])
  const setup = useMemo(() => createTimetableSetupServer(connection), [connection])
  const [locked, setLocked] = useState(true), [saved, setSaved] = useState(false)
  const lockRef = useRef(true)
  const notifyLock = useCallback((value: boolean) => { lockRef.current = value; setLocked(value) }, [])
  const notifySaved = useCallback(() => setSaved(true), [])
  const close = () => { if (!lockRef.current) onClose() }
  return <section aria-label="시간표 가져오기 자료 정정">
    <style>{teachingStyles + setupStyles + setupBatchStyles}</style>
    <h2 tabIndex={-1} ref={node => { if (node && node.dataset.focused !== 'true') { node.dataset.focused = 'true'; node.focus(); node.scrollIntoView({ block: 'start' }) } }}>{labels[target.kind]} 정정</h2>
    <p>시간표 제목과 파일에서 읽은 입력은 이 탭에 보관했습니다. 정정을 마치고 돌아가면 최신 학교 자료를 다시 확인합니다.</p>
    {saved && <p role="status">정정 결과를 서버에서 확인했습니다. 돌아간 뒤 시간표 배치를 다시 비교해 주세요.</p>}
    {target.kind === 'school' || target.kind === 'setup' ? <div className="timetable-actions">
      <button type="button" className="secondary" disabled={locked} onClick={close}>시간표 입력으로 돌아가기</button>
      {locked && <span role="status">작성 중인 정정을 마치거나 취소하고, 처리 중인 요청의 결과를 확인해 주세요.</span>}
    </div> : null}
    <Suspense fallback={<p role="status">자료 정정 화면을 준비하는 중…</p>}>
      {target.kind === 'school' ? <SchoolAdminPanel connection={connection} member={member} date={date} revision={revision} onNavigationLockChange={notifyLock} onUpdated={notifySaved} />
        : target.kind === 'setup' ? <SetupPanel server={setup} member={member} disabled={false} expectedTermId={target.termId} refreshRevision={revision} initialOpen onLockChange={notifyLock} onSaved={notifySaved} />
        : <div className="teaching-workspace">{target.kind === 'course'
          ? <MaintenancePanel server={maintenance} member={member} courseId={target.courseId} closeLabel="시간표 입력으로 돌아가기" onClose={onClose} onSaved={notifySaved} />
          : <>{relationCourseId !== target.courseId && <p role="status">다른 수업 [{relationCourseId}]에서 처리 중이던 관계 변경을 먼저 확인합니다. 원래 요청 번호를 유지합니다.</p>}<RelationsPanel adapter={relations} member={member} courseId={relationCourseId} revision={revision} closeLabel="시간표 입력으로 돌아가기" onClose={onClose} onSaved={notifySaved} /></>}</div>}
    </Suspense>
  </section>
}
