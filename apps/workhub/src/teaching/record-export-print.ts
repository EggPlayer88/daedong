import { RecordExportError, RECORD_EXPORT_NOTICE, recordConfirmationLabel, recordReviewLabel, recordStateLabel, type RecordExportReport } from './record-export'

export interface RecordPrintSession { isOpen:()=>boolean; close:()=>void; print:(report:RecordExportReport)=>void }
export function openRecordPrintWindow():RecordPrintSession {
  // 클릭 이벤트 안에서 빈 창을 열고, 최신 자료 확인이 끝난 뒤에만 본문을 넣는다.
  const popup=window.open('about:blank','_blank','popup')
  if(!popup)throw new RecordExportError('POPUP','인쇄 창을 열지 못했습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.')
  const close=()=>{try{popup.document.body?.replaceChildren();popup.close()}catch{/* 이미 닫힌 인쇄 창은 다시 열지 않는다. */}}
  try {
    popup.opener=null
    popup.document.title='학생 기록 출력'
    popup.document.documentElement.lang='ko'
    popup.document.body.textContent='최신 기록과 조회 권한을 확인하고 있습니다. 확인 전에는 학생 자료를 표시하지 않습니다.'
    popup.addEventListener('afterprint',close,{once:true})
  } catch {close();throw new RecordExportError('POPUP','인쇄 창을 준비하지 못했습니다. 다시 시도해 주세요.')}
  return {isOpen:()=>!popup.closed,close,print(report){
    if(popup.closed)throw new RecordExportError('POPUP','인쇄 창이 닫혔습니다. 인쇄를 다시 눌러 주세요.')
    try {
      const doc=popup.document
      const node=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const el=doc.createElement(tag);if(text!==undefined)el.textContent=text;return el}
      const style=node('style','@page{size:auto;margin:16mm}body{font-family:system-ui,sans-serif;color:#18202b;font-size:11pt;line-height:1.6}h1{font-size:20pt}h2{font-size:13pt;margin:0}p{margin:.4em 0;overflow-wrap:anywhere;white-space:pre-wrap}.scope{border-bottom:1px solid #999;padding-bottom:12px}.record{margin:16px 0;border-bottom:1px solid #ccc;padding-bottom:12px;break-inside:avoid}.meta{font-size:10pt;color:#454b55}.notice{font-size:10pt}.review{font-weight:bold}ul{padding-left:24px}li{overflow-wrap:anywhere}')
      doc.head.replaceChildren(node('title','학생 기록 출력'),style)
      const root=node('main'),header=node('header');header.className='scope'
      header.append(node('h1','학생 관찰·평가 기록'),node('p',report.courseLabel+' · '+report.student.name+' · '+report.student.grade+'학년 '+report.student.classLabel+'반 '+report.student.seatNumber+'번'),node('p',report.selection.firstDay+' ~ '+report.selection.lastDay+' · '+report.rows.length+'건 · '+(report.selection.includeWithdrawn?'철회 기록 포함':'철회 기록 제외')))
      const notice=node('p',RECORD_EXPORT_NOTICE);notice.className='notice';header.append(notice,node('p','확인 시각: '+report.checkedAt+' · 이후 정정한 내용은 다시 출력해 주세요.'));root.append(header)
      for(const row of report.rows){
        const section=node('section');section.className='record'
        section.append(node('h2',row.occurredOn+' · '+(row.kind==='observation'?'관찰':'평가')),node('p',recordStateLabel(row)+' · 현재 기록 '+row.version+'판 · '+recordConfirmationLabel(row)))
        const review=node('p',recordReviewLabel(row));if(row.sourceReviewRequired)review.className='review';section.append(review,node('p',row.text||'의견 없음'))
        if(row.kind==='assessment'){
          section.append(node('p','평가 당시 기준: '+row.rubricLabel+' · 기준 '+row.rubricVersion+'판'))
          const list=node('ul');for(const score of row.scores)list.append(node('li',score));section.append(list,node('p',row.total===null?'합계 없음 · 항목별 상태 확인':'합계 '+row.total+'점'))
        }
        root.append(section)
      }
      // 교사가 쓴 문자열은 HTML로 해석하지 않고 텍스트 노드로만 출력한다.
      doc.body.replaceChildren(root);popup.focus();popup.print()
    }catch(f){close();if(f instanceof RecordExportError)throw f;throw new RecordExportError('POPUP','인쇄 창에 자료를 표시하지 못했습니다. 다시 시도해 주세요.')}
  }}
}
