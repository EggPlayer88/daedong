import {useState} from 'react'
import {GUIDED_LIMITS,type Inspection,type Question} from './guided-contracts'

// 빈 문단은 후보일 뿐이다. 질문과 치환 위치는 담당자가 직접 확인한다.
export function blankAnchorCandidates(inspection:Inspection,questions:Question[]){
 const linked=new Set(questions.map(question=>question.anchorId))
 return inspection.anchors.filter(anchor=>!anchor.sourceText.trim()&&!linked.has(anchor.id))
}

export function GuidedAnchorPicker({inspection,questions,locked,onAdd}:{inspection:Inspection;questions:Question[];locked:boolean;onAdd:(id:string)=>void}){
 const candidates=blankAnchorCandidates(inspection,questions)
 const[onlyBlank,setOnlyBlank]=useState(()=>candidates.length>0)
 const linked=new Set(questions.map(question=>question.anchorId))
 const anchors=onlyBlank?candidates:inspection.anchors
 return <details><summary>원본의 입력 가능한 위치 보기 ({inspection.anchors.length}개)</summary>
  <p className="documents-muted" role="status">아직 연결하지 않은 빈 문단 {candidates.length}개</p>
  <p className="documents-muted">빈 문단이 모두 입력란인 것은 아닙니다. 원본 위치를 확인하고 필요한 곳만 연결해 주세요.</p>
  <label className="documents-check"><input type="checkbox" checked={onlyBlank} onChange={event=>setOnlyBlank(event.target.checked)}/>빈 문단 후보만 보기</label>
  {onlyBlank&&!anchors.length&&<p className="documents-muted">남은 빈 문단 후보가 없습니다. 전체 위치를 보려면 위 선택을 해제해 주세요.</p>}
  <div className="guided-anchor-list">{anchors.map(anchor=><div className="guided-anchor" key={anchor.id}>
   <strong>{anchor.cell?`표 셀 ${Number(anchor.cell.row)+1}행 ${Number(anchor.cell.column)+1}열`:'본문 문단'} · {anchor.paragraph+1}번째</strong><details className="documents-muted"><summary>원본 위치 상세</summary><code>{anchor.id}</code></details>
   <p className="documents-body">{anchor.sourceText||'(빈 칸)'}</p>
   {linked.has(anchor.id)&&<span className="documents-muted">질문 연결됨</span>}
   <button type="button" disabled={locked||linked.has(anchor.id)||questions.length>=GUIDED_LIMITS.maxQuestions} onClick={()=>onAdd(anchor.id)}>이 위치에 질문 연결</button>
  </div>)}</div>
 </details>
}
