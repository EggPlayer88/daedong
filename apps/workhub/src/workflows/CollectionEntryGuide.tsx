import type { CollectionInput } from './types'
import type { CollectionEntryGuide as Guide, EntryCheck } from './entry-guide'

export function EntryChecklist({ checks, label }: { checks: EntryCheck[]; label: string }) {
  return <section className="wf-entry-checklist" aria-label={label}><h4>{label}</h4><ul>{checks.map((check, index) => <li key={`${index}:${check.label}`} className={check.ready ? 'is-ready' : 'needs-input'}><span aria-hidden="true">{check.ready ? '✓' : '○'}</span><div><strong>{check.label}<small>{check.ready ? '확인됨' : '확인 필요'}</small></strong><p>{check.detail}</p></div></li>)}</ul></section>
}

export function CollectionRequestPreview({ input, guide, beforePublish = false }: { input: CollectionInput; guide: Guide; beforePublish?: boolean }) {
  return <section className="wf-request-preview" aria-label={beforePublish ? '게시할 수합 미리보기' : '작성 중인 수합 미리보기'}>
    <div className="wf-section-title"><h4>{beforePublish ? '게시할 내용' : '교사가 받게 될 요청'}</h4><span>{guide.unitCount}부 수합 · 작성 교사 {guide.memberCount}명</span></div>
    <h5>{input.title.trim() || '수합 제목을 입력해 주세요'}</h5><p className="wf-preserve">{input.instructions.trim() || '추가 안내 없음'}</p>
    <dl><div><dt>마감</dt><dd>{input.dueDate || '마감일 미입력'}</dd></div><div><dt>완료 방식</dt><dd>{input.reviewMode === 'required' ? `${guide.reviewerName || '검토자 지정 필요'} · 검토 후 완료` : '제출 즉시 완료 · 사람 검토 없음'}</dd></div></dl>
    <ul className="wf-question-preview">{input.textLabel.trim() && <li><span>글</span><strong>{input.textLabel}</strong><small>{input.textRequired ? '필수' : '선택'}</small></li>}{input.numberLabel.trim() && <li><span>숫자</span><strong>{input.numberLabel}</strong><small>{input.numberRequired ? '필수' : '선택'}</small></li>}{!input.textLabel.trim() && !input.numberLabel.trim() && <li>받을 응답 문항을 입력해 주세요.</li>}</ul>
    <details className="wf-recipient-preview"><summary>제출 대상 확인 · {guide.unitCount}부</summary><ul>{guide.units.map((unit, index) => <li key={index}><strong>{unit.label}</strong><p>최종 제출: {unit.responsible}{unit.contributors.length > 0 ? ` · 공동 작성: ${unit.contributors.join(', ')}` : ' · 혼자 작성'}</p></li>)}</ul></details>
  </section>
}

export function EntryIssues({ guide }: { guide: Pick<Guide, 'issues' | 'warnings'> }) {
  return <>{guide.issues.length > 0 && <div className="wf-entry-issues" aria-label="입력 확인 안내"><p>다음 항목을 확인해 주세요.</p><ul>{guide.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul></div>}{guide.warnings.map(warning => <p className="wf-warning" key={warning}>{warning}</p>)}</>
}
