import type { Membership } from '../contracts'
import { canonical, ServiceError } from '../services/scoped-rpc'
import { documentKindLabels, libraryDocument, type LibraryDocument } from './contracts'
import type { DocumentsService } from './adapter'

export const documentStatusLabels = { draft: '작성 중 초안', confirmed: '내용 확인 완료', archived: '보관된 문서' }
export const DOCUMENT_PRINT_NOTICE = '저장한 본문을 읽기 쉽게 출력한 자료입니다. 학교의 검증된 HWPX 양식이나 공식 결재본이 아닙니다.'
export interface DocumentFieldChange { label: string; before: string; after: string }

// 최신 판 번호·수정 가능 여부는 현재 권한에 따라 달라진다. 저장판의 본문과 근거는 그대로여야 한다.
export function documentVersionFingerprint(value: LibraryDocument): string {
  const { latestVersion: _latest, canEdit: _canEdit, ...saved } = value
  return canonical(saved)
}

export async function readSavedDocument(service: DocumentsService, member: Membership, expected: LibraryDocument): Promise<LibraryDocument> {
  const current = libraryDocument(await service.get(member.id, expected.id, expected.version), member, expected.id, expected.version)
  if (documentVersionFingerprint(current) !== documentVersionFingerprint(expected)) throw new ServiceError('CONFLICT')
  return current
}

export function documentFieldChanges(before: LibraryDocument, after: LibraryDocument): DocumentFieldChange[] {
  if (before.id !== after.id || before.schoolId !== after.schoolId || before.ownerMemberId !== after.ownerMemberId || before.version >= after.version) throw new ServiceError('INVALID_INPUT')
  const sources = (value: LibraryDocument) => value.sources.map(source => `${source.kind} · ${source.sourceId} · v${source.sourceVersion}\n${source.locator}${source.quote ? '\n' + source.quote : ''}`).join('\n\n') || '연결한 근거 없음'
  const student = (value: LibraryDocument) => value.studentContext ? `학생 ${value.studentContext.studentId} · 수업 ${value.studentContext.courseId}\n` + value.studentContext.evidence.map(e => `${e.kind} · ${e.id} · 개정 ${e.revisionId}\n해시 ${e.sourceHash} · 세대 ${e.epoch} · 구간 ${e.start}–${e.end}`).join('\n') : '학생 근거 없음'
  const origin = (value: LibraryDocument) => value.origin ? `${value.origin.documentId} · v${value.origin.version}` : '사본 출처 없음'
  const fields: {label:string; value:(document:LibraryDocument)=>unknown; display:(document:LibraryDocument)=>string}[] = [
    {label:'제목',value:d=>d.title,display:d=>d.title},
    {label:'문서 종류',value:d=>d.kind,display:d=>documentKindLabels[d.kind]},
    {label:'기준일',value:d=>d.basisDate,display:d=>d.basisDate},
    {label:'공개 범위',value:d=>d.visibility,display:d=>d.visibility==='private'?'나만 보기':'학교 공유'},
    {label:'문서 상태',value:d=>d.status,display:d=>documentStatusLabels[d.status]},
    {label:'본문',value:d=>d.body,display:d=>d.body},
    {label:'연결한 근거',value:d=>d.sources,display:sources},
    {label:'학생 근거',value:d=>d.studentContext,display:student},
    {label:'사본 출처',value:d=>d.origin,display:origin},
  ]
  return fields.filter(field => canonical(field.value(before)) !== canonical(field.value(after))).map(field => ({label:field.label,before:field.display(before),after:field.display(after)}))
}

export class DocumentPrintError extends Error {
  constructor(message: string) { super(message); this.name = 'DocumentPrintError' }
}
export interface DocumentPrintSession { isOpen:()=>boolean; close:()=>void; print:(document:LibraryDocument)=>void }
export function assertDocumentPrintable(document: LibraryDocument) {
  if (document.studentContext || document.kind === 'student_record') throw new ServiceError('INVALID_INPUT')
}
export function openDocumentPrintWindow(): DocumentPrintSession {
  let popup: Window | null
  try { popup = window.open('about:blank', '_blank', 'popup') } catch { throw new DocumentPrintError('인쇄 창을 열지 못했습니다. 팝업을 허용하고 다시 시도해 주세요.') }
  if (!popup) throw new DocumentPrintError('인쇄 창을 열지 못했습니다. 팝업을 허용하고 다시 시도해 주세요.')
  const close = () => { try { popup.document.body?.replaceChildren() } catch { /* 닫힌 창도 닫기를 시도한다. */ } try { popup.close() } catch { /* 브라우저가 이미 닫은 창이다. */ } }
  try {
    popup.opener = null; popup.document.title = '저장 문서 인쇄'; popup.document.documentElement.lang = 'ko'
    popup.document.body.textContent = '선택한 저장판과 현재 조회 권한을 확인하고 있습니다.'
    popup.addEventListener('afterprint', close, {once:true})
  } catch { close(); throw new DocumentPrintError('인쇄 창을 준비하지 못했습니다. 다시 시도해 주세요.') }
  return {isOpen:()=>!popup.closed,close,print(document){
    assertDocumentPrintable(document)
    if (popup.closed) throw new DocumentPrintError('인쇄 창이 닫혔습니다. 다시 시도해 주세요.')
    try {
      const doc = popup.document
      const node = <K extends keyof HTMLElementTagNameMap>(tag:K,value?:string) => {const element=doc.createElement(tag);if(value!==undefined)element.textContent=value;return element}
      const policy=node('meta');policy.httpEquiv='Content-Security-Policy';policy.content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"
      const style=node('style','@page{size:auto;margin:18mm}body{font-family:system-ui,sans-serif;color:#17202a;line-height:1.7;font-size:11pt}h1{font-size:20pt;line-height:1.4}h2{font-size:13pt}p,li{white-space:pre-wrap;overflow-wrap:anywhere}.meta,.notice{font-size:10pt;color:#3d4650}.body{margin:1.5em 0}.source{border-top:1px solid #bbb;padding-top:.8em}header{border-bottom:1px solid #888;padding-bottom:1em}')
      doc.head.replaceChildren(node('title',document.title+' · v'+document.version),policy,style)
      const main=node('main'),header=node('header'),meta=node('p',`${documentKindLabels[document.kind]} · v${document.version} · ${documentStatusLabels[document.status]}\n기준일 ${document.basisDate} · 저장 시각 ${document.updatedAt}\n${document.visibility==='private'?'나만 보기':'학교 공유'}${document.version<document.latestVersion?' · 이전 저장판':''}`)
      meta.className='meta';header.append(node('h1',document.title),meta);main.append(header)
      const notice=node('p',DOCUMENT_PRINT_NOTICE);notice.className='notice';main.append(notice)
      const body=node('p',document.body);body.className='body';main.append(body)
      if(document.sources.length){const section=node('section');section.className='source';section.append(node('h2','저장판에 연결한 근거'));const list=node('ul');for(const source of document.sources)list.append(node('li',`${source.locator} · v${source.sourceVersion}\n${source.kind} · ${source.sourceId}${source.quote?'\n'+source.quote:''}`));section.append(list,node('p','근거의 현재 적용 여부와 문서의 날짜·수치는 별도로 확인해 주세요.'));main.append(section)}
      // 사용자 본문·제목·근거를 HTML로 해석하거나 외부 자원 주소로 연결하지 않는다.
      doc.body.replaceChildren(main);popup.focus();popup.print()
    } catch (failure) { close(); if(failure instanceof DocumentPrintError)throw failure;throw new DocumentPrintError('인쇄 창에 문서를 표시하지 못했습니다. 다시 시도해 주세요.') }
  }}
}
