import { useState, useEffect, useRef } from "react";
import { supabase } from './lib/supabase'
import TimetablePage from './pages/TimetablePage'

// ─── DATA ───
const TEACHERS = [
  { id: 1, name: "김영수", dept: "교무", role: "교무부장", tasks: [1,2,3,6] },
  { id: 2, name: "이지현", dept: "생활지도", role: "생활지도부장", tasks: [5,9] },
  { id: 3, name: "박준호", dept: "연구", role: "연구부장", tasks: [7,10] },
  { id: 4, name: "최미래", dept: "행사", role: "행사담당", tasks: [4,8] },
];

const TASKS = [
  { id:1, name:"수행평가 계획", dept:"교무", type:"평가", period:"3월", priority:"높음", status:"공식", assignee:1 },
  { id:2, name:"출결 관리", dept:"교무", type:"학생지도", period:"상시", priority:"높음", status:"공식", assignee:1 },
  { id:3, name:"생활기록부 점검", dept:"교무", type:"보고", period:"학기말", priority:"높음", status:"검토중", assignee:1 },
  { id:4, name:"현장체험학습", dept:"행사", type:"행사", period:"5월", priority:"중간", status:"공식", assignee:4 },
  { id:5, name:"학교폭력 초기 대응", dept:"생활지도", type:"학생지도", period:"상시", priority:"높음", status:"공식", assignee:2 },
  { id:6, name:"학부모 총회", dept:"교무", type:"행사", period:"3월", priority:"중간", status:"초안", assignee:1 },
  { id:7, name:"교내 연수", dept:"연구", type:"회의/연수", period:"학기중", priority:"중간", status:"공식", assignee:3 },
  { id:8, name:"체육대회", dept:"행사", type:"행사", period:"5월", priority:"중간", status:"검토중", assignee:4 },
  { id:9, name:"학생 상담 관리", dept:"생활지도", type:"학생지도", period:"상시", priority:"중간", status:"공식", assignee:2 },
  { id:10, name:"수업공개", dept:"연구", type:"정기업무", period:"학기중", priority:"중간", status:"공식", assignee:3 },
];

const DOCS = [
  { id:1, name:"수행평가 계획서 (2026)", type:"계획서", taskId:1, year:"2026", dept:"교무", latest:true, content:"2026학년도 1학기 수행평가 계획서\n\n1. 목적\n교과별 수행평가의 체계적 운영\n\n2. 방침\n- 성취기준에 근거하여 평가\n- 평가 기준 사전 공개\n- 교과협의회 심의 후 시행" },
  { id:2, name:"수행평가 가정통신문", type:"가정통신문", taskId:1, year:"2026", dept:"교무", latest:true, content:"학부모님께 안내드립니다.\n2026학년도 1학기 수행평가 일정을 안내합니다." },
  { id:3, name:"현장체험학습 계획서", type:"계획서", taskId:4, year:"2026", dept:"행사", latest:true, content:"2026학년도 현장체험학습 운영 계획\n\n1. 목적\n다양한 현장체험을 통한 학습 기회 제공" },
  { id:4, name:"현장체험학습 동의서", type:"동의서", taskId:4, year:"2026", dept:"행사", latest:true, content:"학부모 동의서 양식" },
  { id:5, name:"학교폭력 사안처리 체크리스트", type:"체크리스트", taskId:5, year:"2026", dept:"생활지도", latest:true, content:"학교폭력 사안 발생 시 24시간 이내 처리 절차" },
  { id:6, name:"출결 관리 매뉴얼", type:"계획서", taskId:2, year:"2025", dept:"교무", latest:false, content:"출결 관리 절차 안내" },
  { id:7, name:"체육대회 결과보고서", type:"결과보고서", taskId:8, year:"2025", dept:"행사", latest:false, content:"2025 체육대회 결과보고" },
  { id:8, name:"교내 연수 계획서", type:"계획서", taskId:7, year:"2026", dept:"연구", latest:true, content:"2026학년도 교내 연수 운영 계획" },
  { id:9, name:"학부모 총회 안내문", type:"가정통신문", taskId:6, year:"2026", dept:"교무", latest:true, content:"학부모 총회 안내" },
  { id:10, name:"생활기록부 점검 체크리스트", type:"체크리스트", taskId:3, year:"2026", dept:"교무", latest:true, content:"학기말 생활기록부 점검 항목" },
];

const TASK_DETAILS = {
  1: { overview:"학기 초 각 교과별 수행평가 계획을 수립하고 학생·학부모에게 안내하는 핵심 업무", steps:["전년도 계획서 검토 및 교과 협의","수행평가 계획서 초안 작성","교과 부장 검토 → 교무부장 확인","관리자 결재","학생·학부모 안내(가정통신문)","평가 실시 및 결과 정리"], cautions:["평가 기준 사전 공개 필수","학년 협의 내용 반영","특수교육 대상 학생 평가 조정 확인"], handover:"3월 첫째 주까지 초안 완료 필수. 작년 체육과 계획서 지연으로 전체 일정 밀림. 미리 독촉할 것." },
  2: { overview:"학생 출결 관리 및 특기사항 기록", steps:["일일 출결 확인","결석 사유 확인 및 증빙 수합","출결 특기사항 입력","월말 출결 통계 정리"], cautions:["무단결석 3일 이상 시 즉시 보고","질병결석 증빙서류 기한 확인"], handover:"나이스 출결 입력은 담임이 하지만 통계는 교무부에서 취합합니다." },
  4: { overview:"학생 현장체험학습 전체 운영 업무", steps:["장소 선정 및 답사","계획서 작성 및 결재","가정통신문·동의서 배부","안전교육 실시","행사 당일 운영","결과보고서 작성 및 정산"], cautions:["안전교육 기록 반드시 보관","우천 시 대안 계획 수립","버스 업체 보험 확인"], handover:"버스 업체는 '한빛관광'이 작년 평가 좋았음. 식당은 최소 3주 전 예약해야 함." },
  5: { overview:"학교폭력 사안 발생 시 초기 대응 및 처리 절차", steps:["사안 인지 및 접수","피해·가해 학생 분리","즉시 관리자 보고","사안조사 실시","학교폭력대책심의위원회 요청 검토","결과 통보 및 후속 조치"], cautions:["24시간 이내 초기 대응 필수","조사 시 반드시 2인 이상 참여","보호자 통보 기록 보관"], handover:"사안 접수 즉시 교감 선생님께 1차 보고. 가해·피해 진술서 양식은 문서함에 있음." },
};

const HANDOVER_RECORDS = [
  { id:1, taskId:1, from:"정민호", to:"김영수", date:"2026-03-01", summary:"수행평가 계획 수립 업무 인계", notes:"체육과·미술과는 실기 비중이 높아 별도 협의 필요. 작년 학부모 민원 2건 발생(평가 기준 사전 미공개). 올해는 반드시 사전 공개 철저히.", issues:"교과별 계획서 양식이 통일되어 있지 않아 취합 시 재작업 발생. 양식 통일 추진 필요." },
  { id:2, taskId:5, from:"한수진", to:"이지현", date:"2026-03-01", summary:"학교폭력 업무 인계", notes:"작년 사안 3건 처리. 2건은 심의위 회부, 1건은 자체 해결. 관련 파일은 보안 캐비닛에 보관. 비밀번호는 별도 전달.", issues:"사안조사 시 CCTV 확인 절차가 명확하지 않음. 행정실과 협의 필요." },
  { id:3, taskId:4, from:"윤서연", to:"최미래", date:"2026-03-01", summary:"현장체험학습 업무 인계", notes:"작년 2학년 제주도 체험학습 운영. 올해는 예산 삭감으로 1박 2일로 축소 가능성. 사전 답사는 4월 초에 진행해야 함.", issues:"학부모 동의서 회수율이 낮았음. 올해는 전자동의서 도입 검토." },
];

const SCHEDULE_THIS_WEEK = [
  { day:"월", items:[{task:"수행평가 계획서 교과별 취합",priority:"높음"},{task:"학부모 총회 안내문 발송",priority:"중간"}] },
  { day:"화", items:[{task:"교과 부장 회의 (수행평가 검토)",priority:"높음"}] },
  { day:"수", items:[{task:"수행평가 계획서 교무부장 결재",priority:"높음"},{task:"교내 연수 일정 확정",priority:"중간"}] },
  { day:"목", items:[{task:"수행평가 가정통신문 최종 검토",priority:"중간"}] },
  { day:"금", items:[{task:"주간 업무 정리 및 차주 계획",priority:"낮음"}] },
];

// ─── STYLES ───
const C = {
  bg: "#0c0f1a", card: "#141929", cardHover: "#1a2038", border: "#232940", borderLight: "#2d3555",
  accent: "#4f8cff", accentSoft: "#4f8cff18", accentGlow: "#4f8cff40",
  text: "#e8ecf4", textMid: "#8b95ad", textDim: "#5a6480",
  green: "#34d399", yellow: "#fbbf24", red: "#f87171", orange: "#fb923c",
  purple: "#a78bfa", pink: "#f472b6",
};

const PRIORITY_C = { "높음": C.red, "중간": C.yellow, "낮음": C.green };
const STATUS_C = { "공식": C.green, "검토중": C.yellow, "초안": C.textDim, "구버전": C.textDim };
const DEPT_C = { "교무":"#4f8cff", "연구":"#a78bfa", "생활지도":"#f472b6", "교육과정":"#2dd4bf", "행사":"#fb923c", "정보":"#38bdf8", "보건":"#34d399", "안전":"#f87171" };

const font = "'Pretendard', 'Noto Sans KR', -apple-system, sans-serif";

function Badge({ label, color, small }) {
  return <span style={{ display:"inline-block", padding:small?"1px 7px":"3px 10px", borderRadius:6, fontSize:small?10:11, fontWeight:600, background:color+"15", color, border:`1px solid ${color}25`, letterSpacing:.2, fontFamily:font }}>{label}</span>;
}

function Card({ children, style, hover, onClick }) {
  const [h,setH]=useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:h&&hover?C.cardHover:C.card, border:`1px solid ${h&&hover?C.borderLight:C.border}`, borderRadius:14, transition:"all .2s", cursor:onClick?"pointer":"default", ...style }}>{children}</div>;
}

// ─── SIDEBAR ───
function Sidebar({ active, onNav, user, onUserChange, onLogout }) {
  const sections = [
    { id:"dashboard", icon:"🏠", label:"대시보드" },
    { id:"chat", icon:"🤖", label:"AI 업무 비서" },
    { id:"tasks", icon:"📋", label:"업무 문서 총정리" },
    { id:"docs", icon:"📝", label:"문서 작성 AI" },
    { id:"schedule", icon:"📅", label:"나의 할 일" },
    { id:"handover", icon:"🤝", label:"업무 인수인계" },
    { id:"record", icon:"📒", label:"생활기록부 도우미" },
    { id:"timetable", icon:"📅", label:"시간표 관리" },
  ];
  return (
    <nav style={{ width:240, minWidth:240, background:"#080b14", display:"flex", flexDirection:"column", borderRight:`1px solid ${C.border}`, fontFamily:font }}>
      <div style={{ padding:"24px 20px 20px" }}>
        <div style={{ fontSize:15, fontWeight:800, color:C.text, letterSpacing:-.5 }}>🏫 대동여중 업무 시스템</div>
        <div style={{ fontSize:10, color:C.textDim, marginTop:3, letterSpacing:.5, textTransform:"uppercase" }}>AI-Powered Task Management</div>
      </div>
      <div style={{ padding:"0 12px 16px", borderBottom:`1px solid ${C.border}` }}>
        <select value={user.id} onChange={e=>onUserChange(TEACHERS.find(t=>t.id===+e.target.value))} style={{ width:"100%", padding:"8px 10px", borderRadius:10, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:12, fontFamily:font, outline:"none" }}>
          {TEACHERS.map(t=><option key={t.id} value={t.id}>{t.name} ({t.role})</option>)}
        </select>
      </div>
      <div style={{ flex:1, padding:"12px 0", display:"flex", flexDirection:"column", gap:2 }}>
        {sections.map(s=>(
          <button key={s.id} onClick={()=>onNav(s.id)} style={{
            display:"flex", alignItems:"center", gap:10, padding:"10px 20px", background:active===s.id?C.accentSoft:"transparent",
            border:"none", color:active===s.id?C.accent:C.textMid, fontSize:13, fontWeight:active===s.id?700:500,
            cursor:"pointer", borderRight:active===s.id?`3px solid ${C.accent}`:"3px solid transparent", fontFamily:font, textAlign:"left", transition:"all .15s",
          }}><span style={{ fontSize:15 }}>{s.icon}</span>{s.label}</button>
        ))}
      </div>
      <div style={{ padding:"16px 20px", borderTop:`1px solid ${C.border}` }}>
        <button onClick={onLogout} style={{ width:"100%", padding:"8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textDim, fontSize:12, cursor:"pointer", fontFamily:font }}>
          로그아웃
        </button>
      </div>
    </nav>
  );
}

// ─── DASHBOARD ───
function DashboardView({ user }) {
  const myTasks = TASKS.filter(t=>user.tasks.includes(t.id));
  const urgentTasks = myTasks.filter(t=>t.priority==="높음");
  const myDocs = DOCS.filter(d=>user.tasks.includes(d.taskId)&&d.latest);
  const myHandovers = HANDOVER_RECORDS.filter(h=>user.tasks.includes(h.taskId));
  const todayItems = SCHEDULE_THIS_WEEK[0]?.items||[];

  return (
    <div style={{ padding:32, overflowY:"auto", height:"100%" }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:800, color:C.text }}>{user.name} 선생님, 좋은 아침입니다 ☀️</h1>
        <p style={{ margin:"6px 0 0", fontSize:13, color:C.textMid }}>{user.role} · 담당 업무 {myTasks.length}건 · 오늘 할 일 {todayItems.length}건</p>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
        {[
          { label:"담당 업무", value:myTasks.length, icon:"📋", color:C.accent },
          { label:"긴급 업무", value:urgentTasks.length, icon:"🔴", color:C.red },
          { label:"관련 문서", value:myDocs.length, icon:"📄", color:C.purple },
          { label:"인수인계", value:myHandovers.length, icon:"🤝", color:C.green },
        ].map((s,i)=>(
          <Card key={i} style={{ padding:"18px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:11, color:C.textMid, marginBottom:6 }}>{s.label}</div>
                <div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.value}</div>
              </div>
              <span style={{ fontSize:24 }}>{s.icon}</span>
            </div>
          </Card>
        ))}
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <Card style={{ padding:22 }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700, color:C.text }}>📅 오늘 할 일</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {todayItems.map((item,i)=>(
              <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:C.bg, borderRadius:10 }}>
                <div style={{ width:8, height:8, borderRadius:"50%", background:PRIORITY_C[item.priority], flexShrink:0 }} />
                <span style={{ fontSize:13, color:C.text, flex:1 }}>{item.task}</span>
                <Badge label={item.priority} color={PRIORITY_C[item.priority]} small />
              </div>
            ))}
          </div>
        </Card>
        <Card style={{ padding:22 }}>
          <h3 style={{ margin:"0 0 14px", fontSize:14, fontWeight:700, color:C.text }}>⚡ 긴급 업무</h3>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {urgentTasks.map(t=>(
              <div key={t.id} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 12px", background:C.bg, borderRadius:10 }}>
                <span style={{ fontSize:13, color:C.text, flex:1 }}>{t.name}</span>
                <Badge label={t.dept} color={DEPT_C[t.dept]||C.textDim} small />
              </div>
            ))}
            {urgentTasks.length===0&&<div style={{ color:C.textDim, fontSize:12, padding:10 }}>긴급 업무가 없습니다 🎉</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── AI CHAT ───
function ChatView({ user }) {
  const [messages, setMessages] = useState([
    { role:"ai", text:`${user.name} 선생님, 안녕하세요! 학교 업무 AI 비서입니다.\n\n업무 절차, 학교 규정, 필요 문서 등 무엇이든 질문하세요.\n문서 작성도 도와드릴 수 있습니다.` }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(()=>{endRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);

  const examples = ["수행평가 업무 절차와 필요 문서 알려줘","학교폭력 발생 시 24시간 내 처리 절차는?","현장체험학습 안전교육 관련 규정 알려줘","수행평가 가정통신문 초안 작성해줘","이번 달 내 업무 정리해줘"];

  const reply = (q) => {
    if(q.includes("수행평가")&&!q.includes("가정통신문")) return `**[업무 요약]**\n수행평가 계획은 3월 초 계획 수립과 결재가 핵심입니다.\n\n**[절차]**\n1. 전년도 계획서 검토 및 교과 협의\n2. 수행평가 계획서 초안 작성\n3. 교과 부장 검토 → 교무부장 확인\n4. 관리자 결재\n5. 학생·학부모 안내 (가정통신문 발송)\n6. 평가 실시 및 결과 정리\n\n**[필요 문서]**\n• 수행평가 계획서\n• 가정통신문\n• 결과보고서\n\n**[주의사항]**\n• 평가 기준 사전 공개 필수\n• 학년 협의 내용 반영\n• 특수교육 대상 학생 평가 조정 확인`;
    if(q.includes("학교폭력")) return `**[학교폭력 초기 대응 절차]**\n\n**24시간 이내 필수 처리:**\n1. 사안 인지 즉시 → 피해·가해 학생 분리\n2. 관리자(교감) 즉시 보고\n3. 보호자 양측 통보\n4. 사안조사 실시 (반드시 2인 이상)\n5. 학교폭력대책심의위 요청 여부 검토\n\n**[주의사항]**\n• 조사 시 CCTV 확인 절차 필요 (행정실 협조)\n• 모든 과정 기록·보관 필수\n• 비밀 유지 의무`;
    if(q.includes("현장체험")&&q.includes("규정")) return `**[현장체험학습 안전 관련 규정]**\n\n**근거 법령:** 학교 안전사고 예방 및 보상에 관한 법률\n\n**주요 내용:**\n1. 사전 안전교육 필수 실시 및 기록 보관\n2. 인솔교사 학생 비율 기준 준수\n3. 교통수단 보험 가입 확인\n4. 비상연락망 구축 및 비상시 행동요령 사전 안내\n5. 우천 등 비상 시 대체 계획 수립`;
    if(q.includes("가정통신문")&&q.includes("작성")) return `**[📝 수행평가 안내 가정통신문]**\n\n━━━━━━━━━━━━━━━━━━\n\n2026학년도 1학기 수행평가 안내\n\n학부모님께,\n\n안녕하십니까? 본교 교육활동에 관심을 가져 주셔서 감사합니다.\n\n2026학년도 1학기 수행평가 계획을 다음과 같이 안내드립니다.\n\n1. 평가 기간: 2026년 4월 ~ 6월\n2. 평가 교과: 국어, 수학, 영어, 사회, 과학 외\n3. 유의사항\n   - 평가 기준은 사전에 학생에게 안내됩니다\n   - 결시 시 사전 연락 필수\n\n2026. 3.\n대동여중 교장\n\n━━━━━━━━━━━━━━━━━━\n\n✅ 학교 상황에 맞게 수정하여 사용하세요.`;
    if(q.includes("이번 달")||q.includes("내 업무")) return `**[${user.name} 선생님 3월 업무 안내]**\n\n**이번 주:**\n• 수행평가 계획서 교과별 취합 (월)\n• 교과 부장 회의 참석 (화)\n• 계획서 교무부장 결재 (수)\n• 가정통신문 최종 검토 (목)\n\n**이번 달 핵심 업무:**\n1. 수행평가 계획 수립 및 결재 — 높음\n2. 학부모 총회 준비 — 중간\n3. 출결 관리 시스템 점검 — 상시`;
    return `질문을 분석하고 있습니다.\n\n**추천 질문:**\n• "수행평가 업무 절차 알려줘"\n• "학교폭력 초기 대응 절차"\n• "가정통신문 작성해줘"`;
  };

  const send = ()=>{
    if(!input.trim())return;
    setMessages(m=>[...m,{role:"user",text:input.trim()}]);
    const q=input.trim(); setInput(""); setLoading(true);
    setTimeout(()=>{ setMessages(m=>[...m,{role:"ai",text:reply(q)}]); setLoading(false); },1200);
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:font }}>
      <div style={{ padding:"20px 28px 14px", borderBottom:`1px solid ${C.border}` }}>
        <h2 style={{ margin:0, fontSize:17, fontWeight:800, color:C.text }}>🤖 AI 업무 비서</h2>
        <p style={{ margin:"3px 0 0", fontSize:11, color:C.textDim }}>업무 절차 · 학교 규정 · 문서 작성 · 인수인계 정보까지 한 번에</p>
      </div>
      <div style={{ flex:1, overflowY:"auto", padding:"20px 28px", display:"flex", flexDirection:"column", gap:14 }}>
        {messages.map((m,i)=>(
          <div key={i} style={{ display:"flex", justifyContent:m.role==="user"?"flex-end":"flex-start" }}>
            <div style={{ maxWidth:"82%", padding:"12px 16px", borderRadius:m.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px", background:m.role==="user"?C.accent:C.card, color:C.text, fontSize:13, lineHeight:1.75, whiteSpace:"pre-wrap", fontFamily:font, border:m.role==="user"?"none":`1px solid ${C.border}` }}>
              {m.text.split(/(\*\*.*?\*\*)/).map((p,j)=> p.startsWith("**")&&p.endsWith("**")?<strong key={j} style={{color:m.role==="user"?"#dbeafe":C.accent}}>{p.slice(2,-2)}</strong>:<span key={j}>{p}</span>)}
            </div>
          </div>
        ))}
        {loading&&<div style={{display:"flex",gap:5,padding:12}}>{[0,1,2].map(i=><div key={i} style={{width:7,height:7,borderRadius:"50%",background:C.accent,animation:`bounce .6s ${i*.15}s infinite alternate`}}/>)}</div>}
        <div ref={endRef}/>
      </div>
      <div style={{ padding:"8px 28px" }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:10 }}>
          {examples.map((ex,i)=><button key={i} onClick={()=>setInput(ex)} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:C.card, color:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font }} onMouseEnter={e=>{e.target.style.borderColor=C.accent;e.target.style.color=C.text}} onMouseLeave={e=>{e.target.style.borderColor=C.border;e.target.style.color=C.textMid}}>{ex}</button>)}
        </div>
      </div>
      <div style={{ padding:"0 28px 20px", display:"flex", gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="업무, 규정, 문서 작성 등 무엇이든 질문하세요..." style={{ flex:1, padding:"12px 16px", borderRadius:12, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:13, outline:"none", fontFamily:font }} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border} />
        <button onClick={send} style={{ padding:"12px 22px", borderRadius:12, border:"none", background:C.accent, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:font }}>전송</button>
      </div>
      <style>{`@keyframes bounce{to{transform:translateY(-5px);opacity:.3}}`}</style>
    </div>
  );
}

// ─── TASKS ───
function TasksView({ user }) {
  const [filter,setFilter]=useState("전체");
  const [sel,setSel]=useState(null);
  const depts=["전체",...new Set(TASKS.map(t=>t.dept))];
  const filtered=filter==="전체"?TASKS:TASKS.filter(t=>t.dept===filter);

  if(sel) {
    const detail=TASK_DETAILS[sel.id];
    const relDocs=DOCS.filter(d=>d.taskId===sel.id);
    const ho=HANDOVER_RECORDS.find(h=>h.taskId===sel.id);
    return (
      <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
        <button onClick={()=>setSel(null)} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0, fontFamily:font, fontWeight:600, marginBottom:16 }}>← 목록으로</button>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginBottom:6 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, color:C.text }}>{sel.name}</h2>
          <Badge label={sel.priority} color={PRIORITY_C[sel.priority]}/><Badge label={sel.status} color={STATUS_C[sel.status]}/>
        </div>
        <div style={{ display:"flex", gap:6, marginBottom:24 }}><Badge label={sel.dept} color={DEPT_C[sel.dept]||C.textDim}/><Badge label={sel.type} color={C.textDim}/><Badge label={sel.period} color={C.accent}/></div>
        {detail?(
          <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📌 업무 개요</h3><p style={{margin:0,color:C.textMid,fontSize:13,lineHeight:1.7}}>{detail.overview}</p></Card>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📋 업무 절차</h3><ol style={{margin:0,paddingLeft:20,color:C.textMid,fontSize:13,lineHeight:2.1}}>{detail.steps.map((s,i)=><li key={i}>{s}</li>)}</ol></Card>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>⚠️ 주의사항</h3><ul style={{margin:0,paddingLeft:20,color:C.yellow,fontSize:13,lineHeight:2}}>{detail.cautions.map((c,i)=><li key={i}>{c}</li>)}</ul></Card>
            {relDocs.length>0&&<Card style={{padding:18}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:C.text}}>📂 연결 문서 ({relDocs.length}건)</h3>{relDocs.map(d=><div key={d.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:6}}><span style={{fontSize:12,color:C.text}}>📄 {d.name}</span><div style={{display:"flex",gap:4}}><Badge label={d.type} color={C.textDim} small/>{d.latest&&<Badge label="최신" color={C.green} small/>}</div></div>)}</Card>}
            {ho&&<Card style={{padding:18,borderColor:C.accent+"30"}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:C.accent}}>🤝 인수인계 기록</h3><div style={{fontSize:12,color:C.textMid,lineHeight:1.8}}><div style={{marginBottom:8}}><span style={{color:C.textDim}}>인계:</span> {ho.from} → {ho.to} ({ho.date})</div><div style={{padding:10,background:C.bg,borderRadius:8,marginBottom:8,fontStyle:"italic",color:C.text}}>"{ho.notes}"</div>{ho.issues&&<div style={{padding:10,background:C.red+"10",borderRadius:8,border:`1px solid ${C.red}20`}}><span style={{color:C.red,fontWeight:600}}>⚠ 미해결:</span> <span style={{color:C.textMid}}>{ho.issues}</span></div>}</div></Card>}
          </div>
        ):(<Card style={{padding:40,textAlign:"center"}}><p style={{color:C.textDim,fontSize:13}}>아직 상세 매뉴얼이 작성되지 않았습니다.</p></Card>)}
      </div>
    );
  }

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📋 업무 문서 총정리</h2>
      <p style={{ margin:"0 0 18px", fontSize:11, color:C.textDim }}>학교 전체 업무와 관련 문서를 한 곳에서 관리합니다.</p>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {depts.map(d=><button key={d} onClick={()=>setFilter(d)} style={{ padding:"5px 14px", borderRadius:8, border:`1px solid ${filter===d?C.accent:C.border}`, background:filter===d?C.accentSoft:"transparent", color:filter===d?C.accent:C.textMid, fontSize:11, cursor:"pointer", fontWeight:filter===d?700:500, fontFamily:font }}>{d}</button>)}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.map(task=>{
          const docCount=DOCS.filter(d=>d.taskId===task.id).length;
          const assignee=TEACHERS.find(t=>t.id===task.assignee);
          return (
            <Card key={task.id} hover onClick={()=>setSel(task)} style={{ padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{task.name}</span>
                  {docCount>0&&<span style={{ fontSize:10, color:C.accent, fontWeight:600 }}>📄 {docCount}</span>}
                </div>
                <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                  <Badge label={task.dept} color={DEPT_C[task.dept]||C.textDim} small/>
                  <Badge label={task.period} color={C.accent} small/>
                  {assignee&&<Badge label={assignee.name} color={C.textDim} small/>}
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center", flexShrink:0 }}>
                <Badge label={task.priority} color={PRIORITY_C[task.priority]}/>
                <Badge label={task.status} color={STATUS_C[task.status]}/>
                <span style={{ color:C.textDim, fontSize:14 }}>→</span>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ─── DOC WRITER ───
function DocWriterView() {
  const [docType,setDocType]=useState("가정통신문");
  const [taskRef,setTaskRef]=useState(1);
  const [extra,setExtra]=useState("");
  const [result,setResult]=useState(null);
  const [generating,setGenerating]=useState(false);

  const types=["가정통신문","계획서","결과보고서","안내문","동의서","회의록"];
  const task=TASKS.find(t=>t.id===taskRef);

  const generate=()=>{
    setGenerating(true); setResult(null);
    setTimeout(()=>{
      const templates={
        "가정통신문":`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n2026학년도 ${task?.name||""} 안내\n\n학부모님께,\n\n안녕하십니까? 본교 교육활동에 항상 관심을 가져 주셔서 감사합니다.\n\n${task?.name||""} 관련 사항을 다음과 같이 안내드립니다.\n\n1. 목적: ${task?.name||""} 관련 학부모 안내\n2. 기간: 2026년 해당 시기\n3. 대상: 본교 재학생\n4. 세부 내용:\n   - 관련 사항 기재\n   - 유의사항 기재\n\n자세한 사항은 담임선생님께 문의 바랍니다.\n\n2026. 3.\n대동여중 교장\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        "계획서":`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n2026학년도 ${task?.name||""} 계획(안)\n\n1. 목적\n   ${task?.name||""} 의 체계적 운영\n\n2. 방침\n   가. 관련 규정에 근거하여 운영\n   나. 사전 안내 철저\n   다. 결과 환류\n\n3. 세부 계획\n   가. 추진 일정\n      - 3월: 계획 수립\n      - 4~6월: 실행\n      - 7월: 결과 정리\n   나. 역할 분담\n      - 담당: ${task?.dept||""}\n\n4. 기대 효과\n   - 업무의 체계적 운영\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        "결과보고서":`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n2026학년도 ${task?.name||""} 결과 보고\n\n1. 사업명: ${task?.name||""}\n2. 기간: 2026년 해당 기간\n3. 추진 경과\n   - 계획 수립 및 결재\n   - 실행\n   - 결과 정리\n4. 성과 및 개선점\n   가. 성과: 기재\n   나. 개선점: 기재\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      };
      setResult(templates[docType]||templates["가정통신문"]);
      setGenerating(false);
    },1500);
  };

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📝 문서 작성 AI</h2>
      <p style={{ margin:"0 0 22px", fontSize:11, color:C.textDim }}>업무 데이터를 바탕으로 계획서, 보고서, 가정통신문 등 문서 초안을 자동 생성합니다</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:8, display:"block" }}>문서 종류</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {types.map(t=><button key={t} onClick={()=>setDocType(t)} style={{ padding:"6px 14px", borderRadius:8, border:`1px solid ${docType===t?C.accent:C.border}`, background:docType===t?C.accentSoft:"transparent", color:docType===t?C.accent:C.textMid, fontSize:12, cursor:"pointer", fontFamily:font, fontWeight:docType===t?700:500 }}>{t}</button>)}
            </div>
          </Card>
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:8, display:"block" }}>관련 업무</label>
            <select value={taskRef} onChange={e=>setTaskRef(+e.target.value)} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:"none" }}>
              {TASKS.map(t=><option key={t.id} value={t.id}>{t.name} ({t.dept})</option>)}
            </select>
          </Card>
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:8, display:"block" }}>추가 요청사항 (선택)</label>
            <textarea value={extra} onChange={e=>setExtra(e.target.value)} placeholder="예: 날짜를 4월 15일로, 장소를 강당으로..." rows={3} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:"none", resize:"vertical", boxSizing:"border-box" }} />
          </Card>
          <button onClick={generate} disabled={generating} style={{ padding:"14px", borderRadius:12, border:"none", background:generating?C.textDim:C.accent, color:"#fff", fontSize:14, fontWeight:700, cursor:generating?"wait":"pointer", fontFamily:font }}>
            {generating?"✍️ 문서 생성 중...":"✨ 문서 초안 생성"}
          </button>
        </div>
        <Card style={{ padding:20, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <h3 style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>생성된 문서</h3>
            {result&&<button onClick={()=>{navigator.clipboard?.writeText(result)}} style={{ padding:"4px 12px", borderRadius:6, border:`1px solid ${C.accent}30`, background:C.accentSoft, color:C.accent, fontSize:11, cursor:"pointer", fontFamily:font }}>📋 복사</button>}
          </div>
          <div style={{ flex:1, padding:16, background:C.bg, borderRadius:10, border:`1px solid ${C.border}`, overflowY:"auto", minHeight:300 }}>
            {result?<pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:12, color:C.text, lineHeight:1.8, fontFamily:font }}>{result}</pre>:<div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", color:C.textDim, fontSize:12 }}>왼쪽에서 문서 종류와 업무를 선택 후 생성 버튼을 눌러주세요</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── SCHEDULE ───
function ScheduleView({ user }) {
  const myTasks=TASKS.filter(t=>user.tasks.includes(t.id));
  const [tab,setTab]=useState("week");
  const tabs=[{id:"today",label:"오늘"},{id:"week",label:"이번 주"},{id:"month",label:"이번 달"}];

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📅 {user.name} 선생님의 할 일</h2>
      <p style={{ margin:"0 0 18px", fontSize:11, color:C.textDim }}>등록된 업무와 일정을 기반으로 오늘, 이번 주, 이번 달 할 일을 안내합니다</p>
      <div style={{ display:"flex", gap:6, marginBottom:22 }}>
        {tabs.map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{ padding:"7px 18px", borderRadius:8, border:`1px solid ${tab===t.id?C.accent:C.border}`, background:tab===t.id?C.accentSoft:"transparent", color:tab===t.id?C.accent:C.textMid, fontSize:12, cursor:"pointer", fontWeight:tab===t.id?700:500, fontFamily:font }}>{t.label}</button>)}
      </div>
      {tab==="today"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          <Card style={{ padding:"14px 18px", borderLeft:`3px solid ${C.red}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div><div style={{ fontSize:13, fontWeight:700, color:C.text }}>수행평가 계획서 교과별 취합</div><div style={{ fontSize:11, color:C.textDim, marginTop:3 }}>교과 부장들에게 계획서 제출 요청</div></div>
              <Badge label="높음" color={C.red}/>
            </div>
          </Card>
          <Card style={{ padding:"14px 18px", borderLeft:`3px solid ${C.yellow}` }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <div><div style={{ fontSize:13, fontWeight:700, color:C.text }}>학부모 총회 안내문 발송</div><div style={{ fontSize:11, color:C.textDim, marginTop:3 }}>가정통신문 최종 검토 후 발송</div></div>
              <Badge label="중간" color={C.yellow}/>
            </div>
          </Card>
        </div>
      )}
      {tab==="week"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {SCHEDULE_THIS_WEEK.map((day,i)=>(
            <Card key={i} style={{ padding:"14px 18px" }}>
              <div style={{ fontSize:12, fontWeight:700, color:C.accent, marginBottom:10 }}>{day.day}요일</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {day.items.map((item,j)=>(
                  <div key={j} style={{ display:"flex", alignItems:"center", gap:10, padding:"8px 10px", background:C.bg, borderRadius:8 }}>
                    <div style={{ width:6, height:6, borderRadius:"50%", background:PRIORITY_C[item.priority] }}/>
                    <span style={{ fontSize:12, color:C.text, flex:1 }}>{item.task}</span>
                    <Badge label={item.priority} color={PRIORITY_C[item.priority]} small/>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab==="month"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:10 }}>
          {myTasks.map((t)=>(
            <Card key={t.id} style={{ padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div>
                <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{t.name}</div>
                <div style={{ display:"flex", gap:5, marginTop:5 }}><Badge label={t.dept} color={DEPT_C[t.dept]||C.textDim} small/><Badge label={t.period} color={C.accent} small/></div>
              </div>
              <Badge label={t.priority} color={PRIORITY_C[t.priority]}/>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── HANDOVER ───
function HandoverView({ user }) {
  const records=HANDOVER_RECORDS.filter(h=>user.tasks.includes(h.taskId));
  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>🤝 업무 인수인계</h2>
      <p style={{ margin:"0 0 22px", fontSize:11, color:C.textDim }}>담당 업무의 인수인계 기록을 확인하고 관리합니다.</p>
      {records.length===0?(
        <Card style={{ padding:40, textAlign:"center" }}><p style={{ color:C.textDim, fontSize:13 }}>등록된 인수인계 기록이 없습니다.</p></Card>
      ):(
        <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
          {records.map(r=>{
            const task=TASKS.find(t=>t.id===r.taskId);
            return (
              <Card key={r.id} style={{ padding:22, borderLeft:`3px solid ${C.accent}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
                  <div>
                    <h3 style={{ margin:"0 0 4px", fontSize:15, fontWeight:700, color:C.text }}>{task?.name||"업무"}</h3>
                    <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                      <span style={{ fontSize:12, color:C.textMid }}>{r.from}</span>
                      <span style={{ fontSize:12, color:C.accent }}>→</span>
                      <span style={{ fontSize:12, color:C.text, fontWeight:600 }}>{r.to}</span>
                      <span style={{ fontSize:11, color:C.textDim }}>({r.date})</span>
                    </div>
                  </div>
                  {task&&<Badge label={task.dept} color={DEPT_C[task.dept]||C.textDim}/>}
                </div>
                <div style={{ padding:14, background:C.bg, borderRadius:10, marginBottom:12 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:C.accent, marginBottom:6 }}>💬 전임자 메모</div>
                  <p style={{ margin:0, fontSize:12, color:C.text, lineHeight:1.8 }}>{r.notes}</p>
                </div>
                {r.issues&&(
                  <div style={{ padding:14, background:C.red+"08", borderRadius:10, border:`1px solid ${C.red}18` }}>
                    <div style={{ fontSize:11, fontWeight:600, color:C.red, marginBottom:6 }}>⚠️ 미해결 / 개선 필요</div>
                    <p style={{ margin:0, fontSize:12, color:C.textMid, lineHeight:1.8 }}>{r.issues}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 생활기록부 ───
function RecordView() {
  const [category,setCategory]=useState("세부능력및특기사항");
  const [subject,setSubject]=useState("국어");
  const [grade,setGrade]=useState("1학년");
  const [keywords,setKeywords]=useState("");
  const [result,setResult]=useState(null);
  const [generating,setGenerating]=useState(false);

  const categories=["세부능력및특기사항","행동특성및종합의견","창의적체험활동","자유학기활동","독서활동"];
  const subjects=["국어","수학","영어","사회","과학","기술·가정","체육","음악","미술","도덕","정보"];
  const grades=["1학년","2학년","3학년"];

  const generate=()=>{
    setGenerating(true); setResult(null);
    setTimeout(()=>{
      const base = {
        "세부능력및특기사항":`${subject} 교과에서 수업에 적극적으로 참여하며, 토론 활동에서 논리적인 근거를 바탕으로 자신의 의견을 명확하게 표현하는 능력이 뛰어남. 모둠 활동 시 협력적 태도로 구성원들의 의견을 경청하고 조율하는 리더십을 발휘함.`,
        "행동특성및종합의견":`밝고 긍정적인 성격으로 교우관계가 원만하며, 학급 내 갈등 상황에서 중재자 역할을 자연스럽게 수행함. 자기주도적 학습 습관이 형성되어 있으며, 꾸준한 노력으로 학업 성취도가 향상되는 추세를 보임.`,
        "창의적체험활동":`(자율활동) 학급 회의에 적극적으로 참여하여 건설적인 의견을 제시함.\n(동아리활동) 동아리 활동에서 탐구 능력을 신장함.\n(봉사활동) 지역사회 봉사활동에 성실하게 참여함.\n(진로활동) 직업 체험 활동을 통해 자신의 적성과 흥미를 탐색함.`,
        "자유학기활동":`주제선택 프로그램에 참여하여 깊이 있는 이해를 보여줌. 조별 프로젝트에서 자료 수집과 발표를 담당하여 우수한 결과를 도출함.`,
        "독서활동":`다양한 분야의 독서를 통해 폭넓은 교양을 쌓고, 독서 감상문 작성을 통해 자신의 생각을 체계적으로 표현함.`,
      };
      let output = base[category] || base["세부능력및특기사항"];
      if(keywords.trim()) output += `\n\n[키워드 반영: ${keywords}]`;
      setResult(output);
      setGenerating(false);
    },1300);
  };

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📒 생활기록부 작성 도우미</h2>
      <p style={{ margin:"0 0 22px", fontSize:11, color:C.textDim }}>영역·교과·학년을 선택하고 키워드를 입력하면 생활기록부 문구 초안을 생성합니다</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:10, display:"block" }}>기록 영역</label>
            <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
              {categories.map(c=><button key={c} onClick={()=>setCategory(c)} style={{ padding:"6px 12px", borderRadius:8, border:`1px solid ${category===c?C.accent:C.border}`, background:category===c?C.accentSoft:"transparent", color:category===c?C.accent:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font, fontWeight:category===c?700:500 }}>{c}</button>)}
            </div>
          </Card>
          {category==="세부능력및특기사항"&&(
            <Card style={{ padding:20 }}>
              <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:10, display:"block" }}>교과 선택</label>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {subjects.map(s=><button key={s} onClick={()=>setSubject(s)} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${subject===s?C.accent:C.border}`, background:subject===s?C.accentSoft:"transparent", color:subject===s?C.accent:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font, fontWeight:subject===s?700:500 }}>{s}</button>)}
              </div>
            </Card>
          )}
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:10, display:"block" }}>학년</label>
            <div style={{ display:"flex", gap:6 }}>
              {grades.map(g=><button key={g} onClick={()=>setGrade(g)} style={{ padding:"6px 16px", borderRadius:8, border:`1px solid ${grade===g?C.accent:C.border}`, background:grade===g?C.accentSoft:"transparent", color:grade===g?C.accent:C.textMid, fontSize:12, cursor:"pointer", fontFamily:font, fontWeight:grade===g?700:500 }}>{g}</button>)}
            </div>
          </Card>
          <Card style={{ padding:20 }}>
            <label style={{ fontSize:12, fontWeight:600, color:C.textMid, marginBottom:10, display:"block" }}>학생 특성 키워드 (선택)</label>
            <textarea value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="예: 리더십, 발표력 우수, 모둠활동 적극적..." rows={3} style={{ width:"100%", padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:"none", resize:"vertical", boxSizing:"border-box" }} />
          </Card>
          <button onClick={generate} disabled={generating} style={{ padding:"14px", borderRadius:12, border:"none", background:generating?C.textDim:C.accent, color:"#fff", fontSize:14, fontWeight:700, cursor:generating?"wait":"pointer", fontFamily:font }}>
            {generating?"✍️ 문구 생성 중...":"✨ 생활기록부 문구 생성"}
          </button>
        </div>
        <Card style={{ padding:20, display:"flex", flexDirection:"column" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
            <div>
              <h3 style={{ margin:0, fontSize:13, fontWeight:700, color:C.text }}>생성된 문구</h3>
              <div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>{category} {category==="세부능력및특기사항"?`· ${subject}`:""} · {grade}</div>
            </div>
            {result&&<button onClick={()=>{navigator.clipboard?.writeText(result)}} style={{ padding:"4px 12px", borderRadius:6, border:`1px solid ${C.accent}30`, background:C.accentSoft, color:C.accent, fontSize:11, cursor:"pointer", fontFamily:font }}>📋 복사</button>}
          </div>
          <div style={{ flex:1, padding:16, background:C.bg, borderRadius:10, border:`1px solid ${C.border}`, overflowY:"auto", minHeight:350 }}>
            {result?(
              <pre style={{ margin:0, whiteSpace:"pre-wrap", fontSize:13, color:C.text, lineHeight:2, fontFamily:font }}>{result}</pre>
            ):(
              <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", flexDirection:"column", gap:12 }}>
                <span style={{ fontSize:36 }}>📒</span>
                <div style={{ color:C.textDim, fontSize:12, textAlign:"center", lineHeight:1.7 }}>왼쪽에서 영역과 조건을 선택한 후<br/>생성 버튼을 눌러주세요</div>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── MAIN APP (로그인 후) ───
function MainApp({ onLogout }) {
  const [page,setPage]=useState("dashboard");
  const [user,setUser]=useState(TEACHERS[0]);

  const renderContent=()=>{
    switch(page){
      case "dashboard": return <DashboardView user={user}/>;
      case "chat":      return <ChatView user={user}/>;
      case "tasks":     return <TasksView user={user}/>;
      case "docs":      return <DocWriterView/>;
      case "schedule":  return <ScheduleView user={user}/>;
      case "handover":  return <HandoverView user={user}/>;
      case "record":    return <RecordView/>;
      case "timetable": return <TimetablePage/>;
      default:          return <DashboardView user={user}/>;
    }
  };

  return (
    <div style={{ display:"flex", height:"100vh", width:"100vw", fontFamily:font, background:C.bg, color:C.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
      <Sidebar active={page} onNav={setPage} user={user} onUserChange={setUser} onLogout={onLogout}/>
      <div style={{ flex:1, overflow:"hidden" }}>{renderContent()}</div>
    </div>
  );
}

// ─── APP (인증 래퍼) ───
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:C.bg, color:C.text, fontFamily:font }}>
      로딩 중...
    </div>
  );

  if (!session) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:C.bg, fontFamily:font }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:"48px 40px", textAlign:"center", minWidth:300 }}>
        <div style={{ fontSize:32, marginBottom:12 }}>🏫</div>
        <h1 style={{ margin:"0 0 6px", fontSize:22, fontWeight:800, color:C.text }}>대동여중</h1>
        <p style={{ margin:"0 0 32px", fontSize:13, color:C.textMid }}>업무시스템</p>
        <button onClick={handleLogin} style={{ background:C.accent, color:"#fff", border:"none", borderRadius:10, padding:"13px 28px", fontSize:14, fontWeight:600, cursor:"pointer", width:"100%", fontFamily:font }}>
          Google 계정으로 로그인
        </button>
      </div>
    </div>
  );

  return <MainApp onLogout={handleLogout} />;
}
