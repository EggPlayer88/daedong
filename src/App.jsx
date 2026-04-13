import { useState, useEffect, useRef } from "react";
import { supabase } from './lib/supabase';
import TimetablePage from './pages/TimetablePage';

// ─── STATIC DATA (프로토타입용 — 나중에 DB로 대체) ───
const TASKS = [
  { id:1, name:"수행평가 계획", dept:"교무", type:"평가", period:"3월", priority:"높음", status:"공식" },
  { id:2, name:"출결 관리", dept:"교무", type:"학생지도", period:"상시", priority:"높음", status:"공식" },
  { id:3, name:"생활기록부 점검", dept:"교무", type:"보고", period:"학기말", priority:"높음", status:"검토중" },
  { id:4, name:"현장체험학습", dept:"행사", type:"행사", period:"5월", priority:"중간", status:"공식" },
  { id:5, name:"학교폭력 초기 대응", dept:"생활지도", type:"학생지도", period:"상시", priority:"높음", status:"공식" },
  { id:6, name:"학부모 총회", dept:"교무", type:"행사", period:"3월", priority:"중간", status:"초안" },
  { id:7, name:"교내 연수", dept:"연구", type:"회의/연수", period:"학기중", priority:"중간", status:"공식" },
  { id:8, name:"체육대회", dept:"행사", type:"행사", period:"5월", priority:"중간", status:"검토중" },
  { id:9, name:"학생 상담 관리", dept:"생활지도", type:"학생지도", period:"상시", priority:"중간", status:"공식" },
  { id:10, name:"수업공개", dept:"연구", type:"정기업무", period:"학기중", priority:"중간", status:"공식" },
];

const DOCS = [
  { id:1, name:"수행평가 계획서 (2026)", type:"계획서", taskId:1, year:"2026", dept:"교무", latest:true },
  { id:2, name:"수행평가 가정통신문", type:"가정통신문", taskId:1, year:"2026", dept:"교무", latest:true },
  { id:3, name:"현장체험학습 계획서", type:"계획서", taskId:4, year:"2026", dept:"행사", latest:true },
  { id:4, name:"현장체험학습 동의서", type:"동의서", taskId:4, year:"2026", dept:"행사", latest:true },
  { id:5, name:"학교폭력 사안처리 체크리스트", type:"체크리스트", taskId:5, year:"2026", dept:"생활지도", latest:true },
  { id:8, name:"교내 연수 계획서", type:"계획서", taskId:7, year:"2026", dept:"연구", latest:true },
  { id:9, name:"학부모 총회 안내문", type:"가정통신문", taskId:6, year:"2026", dept:"교무", latest:true },
  { id:10, name:"생활기록부 점검 체크리스트", type:"체크리스트", taskId:3, year:"2026", dept:"교무", latest:true },
];

const TASK_DETAILS = {
  1: { overview:"학기 초 각 교과별 수행평가 계획을 수립하고 학생·학부모에게 안내하는 핵심 업무", steps:["전년도 계획서 검토 및 교과 협의","수행평가 계획서 초안 작성","교과 부장 검토 → 교무부장 확인","관리자 결재","학생·학부모 안내(가정통신문)","평가 실시 및 결과 정리"], cautions:["평가 기준 사전 공개 필수","학년 협의 내용 반영","특수교육 대상 학생 평가 조정 확인"] },
  5: { overview:"학교폭력 사안 발생 시 초기 대응 및 처리 절차", steps:["사안 인지 및 접수","피해·가해 학생 분리","즉시 관리자 보고","사안조사 실시","학교폭력대책심의위원회 요청 검토","결과 통보 및 후속 조치"], cautions:["24시간 이내 초기 대응 필수","조사 시 반드시 2인 이상 참여","보호자 통보 기록 보관"] },
};

const SCHEDULE_THIS_WEEK = [
  { day:"월", items:[{task:"수행평가 계획서 교과별 취합",priority:"높음"},{task:"학부모 총회 안내문 발송",priority:"중간"}] },
  { day:"화", items:[{task:"교과 부장 회의 (수행평가 검토)",priority:"높음"}] },
  { day:"수", items:[{task:"수행평가 계획서 교무부장 결재",priority:"높음"},{task:"교내 연수 일정 확정",priority:"중간"}] },
  { day:"목", items:[{task:"수행평가 가정통신문 최종 검토",priority:"중간"}] },
  { day:"금", items:[{task:"주간 업무 정리 및 차주 계획",priority:"낮음"}] },
];

// ─── STYLES ───
const C = {
  bg:"#0c0f1a", card:"#141929", cardHover:"#1a2038", border:"#232940", borderLight:"#2d3555",
  accent:"#4f8cff", accentSoft:"#4f8cff18",
  text:"#e8ecf4", textMid:"#8b95ad", textDim:"#5a6480",
  green:"#34d399", yellow:"#fbbf24", red:"#f87171",
  purple:"#a78bfa", pink:"#f472b6",
};
const PRIORITY_C = { "높음":C.red, "중간":C.yellow, "낮음":C.green };
const STATUS_C   = { "공식":C.green, "검토중":C.yellow, "초안":C.textDim };
const DEPT_C     = { "교무":"#4f8cff","연구":"#a78bfa","생활지도":"#f472b6","행사":"#fb923c","정보":"#38bdf8","보건":"#34d399" };
const ROLE_LABEL = { super_admin:"슈퍼관리자", timetable_admin:"시간표관리자", teacher:"교사" };
const ROLE_COLOR = { super_admin:C.red, timetable_admin:C.purple, teacher:C.green };

const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

function Badge({ label, color, small }) {
  return <span style={{ display:"inline-block", padding:small?"1px 7px":"3px 10px", borderRadius:6, fontSize:small?10:11, fontWeight:600, background:color+"15", color, border:`1px solid ${color}25`, fontFamily:font }}>{label}</span>;
}
function Card({ children, style, hover, onClick }) {
  const [h,setH]=useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:h&&hover?C.cardHover:C.card, border:`1px solid ${h&&hover?C.borderLight:C.border}`, borderRadius:14, transition:"all .2s", cursor:onClick?"pointer":"default", ...style }}>{children}</div>;
}

// ─── 권한별 메뉴 ───
function getMenuItems(role) {
  const common = [
    { id:"dashboard", icon:"🏠", label:"대시보드" },
    { id:"chat",      icon:"🤖", label:"AI 업무 비서" },
    { id:"tasks",     icon:"📋", label:"업무 문서 총정리" },
    { id:"docs",      icon:"📝", label:"문서 작성 AI" },
    { id:"schedule",  icon:"📅", label:"나의 할 일" },
    { id:"handover",  icon:"🤝", label:"업무 인수인계" },
    { id:"record",    icon:"📒", label:"생활기록부 도우미" },
  ];
  const adminMenus = [{ id:"timetable", icon:"🗓️", label:"시간표 관리" }];
  const superMenus = [
    { id:"users",    icon:"👥", label:"사용자 관리" },
    { id:"settings", icon:"⚙️", label:"학교 설정" },
  ];
  if(role==='super_admin')     return [...common, ...adminMenus, ...superMenus];
  if(role==='timetable_admin') return [...common, ...adminMenus];
  return common;
}

// ─── SIDEBAR ───
function Sidebar({ active, onNav, teacher, onLogout }) {
  const menuItems = getMenuItems(teacher.role);
  const roleColor = ROLE_COLOR[teacher.role]||C.green;
  const roleLabel = ROLE_LABEL[teacher.role]||'교사';
  return (
    <nav style={{ width:240, minWidth:240, background:"#080b14", display:"flex", flexDirection:"column", borderRight:`1px solid ${C.border}`, fontFamily:font }}>
      <div style={{ padding:"24px 20px 16px" }}>
        <div style={{ fontSize:15, fontWeight:800, color:C.text, letterSpacing:-.5 }}>🏫 대동여중 업무 시스템</div>
        <div style={{ fontSize:10, color:C.textDim, marginTop:3, letterSpacing:.5, textTransform:"uppercase" }}>AI-Powered Task Management</div>
      </div>
      <div style={{ padding:"0 12px 16px", borderBottom:`1px solid ${C.border}` }}>
        <div style={{ padding:"10px 12px", borderRadius:10, border:`1px solid ${C.border}`, background:C.card }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.text, marginBottom:4 }}>👤 {teacher.name}</div>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <span style={{ fontSize:10, padding:"1px 7px", borderRadius:20, background:roleColor+"20", color:roleColor, fontWeight:600, border:`1px solid ${roleColor}30` }}>{roleLabel}</span>
          </div>
        </div>
      </div>
      <div style={{ flex:1, padding:"12px 0", display:"flex", flexDirection:"column", gap:2, overflowY:"auto" }}>
        {menuItems.map(s=>(
          <button key={s.id} onClick={()=>onNav(s.id)} style={{
            display:"flex", alignItems:"center", gap:10, padding:"10px 20px",
            background:active===s.id?C.accentSoft:"transparent",
            border:"none", color:active===s.id?C.accent:C.textMid,
            fontSize:13, fontWeight:active===s.id?700:500,
            cursor:"pointer", borderRight:active===s.id?`3px solid ${C.accent}`:"3px solid transparent",
            fontFamily:font, textAlign:"left", transition:"all .15s",
          }}><span style={{ fontSize:15 }}>{s.icon}</span>{s.label}</button>
        ))}
      </div>
      <div style={{ padding:"16px 20px", borderTop:`1px solid ${C.border}` }}>
        <button onClick={onLogout} style={{ width:"100%", padding:"8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textDim, fontSize:12, cursor:"pointer", fontFamily:font }}>로그아웃</button>
      </div>
    </nav>
  );
}

// ─── DASHBOARD ───
function DashboardView({ teacher }) {
  const todayItems = SCHEDULE_THIS_WEEK[0]?.items||[];
  const urgentTasks = TASKS.filter(t=>t.priority==="높음");
  return (
    <div style={{ padding:32, overflowY:"auto", height:"100%" }}>
      <div style={{ marginBottom:28 }}>
        <h1 style={{ margin:0, fontSize:22, fontWeight:800, color:C.text }}>{teacher.name} 선생님, 좋은 아침입니다 ☀️</h1>
        <p style={{ margin:"6px 0 0", fontSize:13, color:C.textMid }}>{ROLE_LABEL[teacher.role]} · 오늘 할 일 {todayItems.length}건</p>
      </div>
      {teacher.role==='super_admin'&&<div style={{padding:"12px 16px",borderRadius:10,background:C.red+"10",border:`1px solid ${C.red}20`,marginBottom:20,fontSize:12,color:C.red}}>🔑 슈퍼관리자 계정입니다. 사용자 관리 및 학교 설정에 접근할 수 있습니다.</div>}
      {teacher.role==='timetable_admin'&&<div style={{padding:"12px 16px",borderRadius:10,background:C.purple+"10",border:`1px solid ${C.purple}20`,marginBottom:20,fontSize:12,color:C.purple}}>🗓️ 시간표관리자 계정입니다. 시간표 생성 및 관리에 접근할 수 있습니다.</div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:28 }}>
        {[
          { label:"오늘 할 일",  value:todayItems.length,  icon:"📅", color:C.accent },
          { label:"긴급 업무",   value:urgentTasks.length, icon:"🔴", color:C.red },
          { label:"관련 문서",   value:DOCS.length,        icon:"📄", color:C.purple },
          { label:"이번 주 일정",value:SCHEDULE_THIS_WEEK.length, icon:"📋", color:C.green },
        ].map((s,i)=>(
          <Card key={i} style={{ padding:"18px 20px" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div><div style={{ fontSize:11, color:C.textMid, marginBottom:6 }}>{s.label}</div><div style={{ fontSize:28, fontWeight:800, color:s.color }}>{s.value}</div></div>
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
                <div style={{ width:8, height:8, borderRadius:"50%", background:PRIORITY_C[item.priority], flexShrink:0 }}/>
                <span style={{ fontSize:13, color:C.text, flex:1 }}>{item.task}</span>
                <Badge label={item.priority} color={PRIORITY_C[item.priority]} small/>
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
                <Badge label={t.dept} color={DEPT_C[t.dept]||C.textDim} small/>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── AI CHAT ───
function ChatView({ teacher }) {
  const [messages, setMessages] = useState([{ role:"ai", text:`${teacher.name} 선생님, 안녕하세요! 학교 업무 AI 비서입니다.\n\n업무 절차, 학교 규정, 필요 문서 등 무엇이든 질문하세요.` }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const endRef = useRef(null);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[messages]);
  const examples = ["수행평가 업무 절차와 필요 문서 알려줘","학교폭력 발생 시 24시간 내 처리 절차는?","수행평가 가정통신문 초안 작성해줘"];
  const reply = (q) => {
    if(q.includes("수행평가")&&!q.includes("가정통신문")) return `**[업무 요약]**\n수행평가 계획은 3월 초 계획 수립과 결재가 핵심입니다.\n\n**[절차]**\n1. 전년도 계획서 검토 및 교과 협의\n2. 수행평가 계획서 초안 작성\n3. 교과 부장 검토 → 교무부장 확인\n4. 관리자 결재\n5. 학생·학부모 안내\n6. 평가 실시 및 결과 정리`;
    if(q.includes("학교폭력")) return `**[학교폭력 초기 대응]**\n\n1. 피해·가해 학생 분리\n2. 관리자 즉시 보고\n3. 보호자 양측 통보\n4. 사안조사 (2인 이상)\n5. 심의위 요청 여부 검토`;
    if(q.includes("가정통신문")) return `**[수행평가 가정통신문 초안]**\n\n학부모님께,\n\n2026학년도 1학기 수행평가 계획을 안내드립니다.\n\n1. 평가 기간: 4월~6월\n2. 평가 기준은 사전 안내됩니다\n3. 결시 시 사전 연락 필수\n\n2026. 3. 대동여중 교장`;
    return `질문을 분석 중입니다.\n\n추천: "수행평가 절차 알려줘" / "학교폭력 대응" / "가정통신문 작성"`;
  };
  const send = () => {
    if(!input.trim()) return;
    setMessages(m=>[...m,{role:"user",text:input.trim()}]);
    const q=input.trim(); setInput(""); setLoading(true);
    setTimeout(()=>{ setMessages(m=>[...m,{role:"ai",text:reply(q)}]); setLoading(false); },1200);
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", height:"100%", fontFamily:font }}>
      <div style={{ padding:"20px 28px 14px", borderBottom:`1px solid ${C.border}` }}>
        <h2 style={{ margin:0, fontSize:17, fontWeight:800, color:C.text }}>🤖 AI 업무 비서</h2>
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
          {examples.map((ex,i)=><button key={i} onClick={()=>setInput(ex)} style={{ padding:"5px 12px", borderRadius:8, border:`1px solid ${C.border}`, background:C.card, color:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font }}>{ex}</button>)}
        </div>
      </div>
      <div style={{ padding:"0 28px 20px", display:"flex", gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&send()} placeholder="무엇이든 질문하세요..." style={{ flex:1, padding:"12px 16px", borderRadius:12, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:13, outline:"none", fontFamily:font }} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
        <button onClick={send} style={{ padding:"12px 22px", borderRadius:12, border:"none", background:C.accent, color:"#fff", fontSize:13, fontWeight:700, cursor:"pointer", fontFamily:font }}>전송</button>
      </div>
      <style>{`@keyframes bounce{to{transform:translateY(-5px);opacity:.3}}`}</style>
    </div>
  );
}

// ─── TASKS ───
function TasksView() {
  const [filter,setFilter]=useState("전체");
  const [sel,setSel]=useState(null);
  const depts=["전체",...new Set(TASKS.map(t=>t.dept))];
  const filtered=filter==="전체"?TASKS:TASKS.filter(t=>t.dept===filter);
  if(sel){
    const detail=TASK_DETAILS[sel.id];
    const relDocs=DOCS.filter(d=>d.taskId===sel.id);
    return (
      <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
        <button onClick={()=>setSel(null)} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0, fontFamily:font, fontWeight:600, marginBottom:16 }}>← 목록으로</button>
        <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
          <h2 style={{ margin:0, fontSize:20, fontWeight:800, color:C.text }}>{sel.name}</h2>
          <Badge label={sel.priority} color={PRIORITY_C[sel.priority]}/><Badge label={sel.status} color={STATUS_C[sel.status]}/>
        </div>
        {detail?(
          <div style={{ display:"flex", flexDirection:"column", gap:16, marginTop:16 }}>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📌 업무 개요</h3><p style={{margin:0,color:C.textMid,fontSize:13,lineHeight:1.7}}>{detail.overview}</p></Card>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📋 절차</h3><ol style={{margin:0,paddingLeft:20,color:C.textMid,fontSize:13,lineHeight:2}}>{detail.steps.map((s,i)=><li key={i}>{s}</li>)}</ol></Card>
            <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>⚠️ 주의사항</h3><ul style={{margin:0,paddingLeft:20,color:C.yellow,fontSize:13,lineHeight:2}}>{detail.cautions.map((c,i)=><li key={i}>{c}</li>)}</ul></Card>
            {relDocs.length>0&&<Card style={{padding:18}}><h3 style={{margin:"0 0 10px",fontSize:13,fontWeight:700,color:C.text}}>📂 연결 문서</h3>{relDocs.map(d=><div key={d.id} style={{display:"flex",justifyContent:"space-between",padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:6}}><span style={{fontSize:12,color:C.text}}>📄 {d.name}</span><Badge label={d.type} color={C.textDim} small/></div>)}</Card>}
          </div>
        ):(<Card style={{padding:40,textAlign:"center"}}><p style={{color:C.textDim}}>상세 매뉴얼 준비 중입니다.</p></Card>)}
      </div>
    );
  }
  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📋 업무 문서 총정리</h2>
      <p style={{ margin:"0 0 18px", fontSize:11, color:C.textDim }}>학교 전체 업무와 관련 문서를 한 곳에서 관리합니다.</p>
      <div style={{ display:"flex", gap:6, marginBottom:18, flexWrap:"wrap" }}>
        {depts.map(d=><button key={d} onClick={()=>setFilter(d)} style={{ padding:"5px 14px", borderRadius:8, border:`1px solid ${filter===d?C.accent:C.border}`, background:filter===d?C.accentSoft:"transparent", color:filter===d?C.accent:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font }}>{d}</button>)}
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.map(task=>{
          const docCount=DOCS.filter(d=>d.taskId===task.id).length;
          return (
            <Card key={task.id} hover onClick={()=>setSel(task)} style={{ padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{task.name}</span>
                  {docCount>0&&<span style={{ fontSize:10, color:C.accent }}>📄 {docCount}</span>}
                </div>
                <div style={{ display:"flex", gap:5 }}><Badge label={task.dept} color={DEPT_C[task.dept]||C.textDim} small/><Badge label={task.period} color={C.accent} small/></div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <Badge label={task.priority} color={PRIORITY_C[task.priority]}/><Badge label={task.status} color={STATUS_C[task.status]}/>
                <span style={{ color:C.textDim }}>→</span>
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
  const [result,setResult]=useState(null);
  const [generating,setGenerating]=useState(false);
  const types=["가정통신문","계획서","결과보고서","안내문","동의서","회의록"];
  const task=TASKS.find(t=>t.id===taskRef);
  const generate=()=>{
    setGenerating(true);setResult(null);
    setTimeout(()=>{
      const templates={
        "가정통신문":`2026학년도 ${task?.name||""} 안내\n\n학부모님께,\n\n안녕하십니까? ${task?.name||""} 관련 사항을 안내드립니다.\n\n1. 기간: 2026년 해당 시기\n2. 대상: 본교 재학생\n3. 유의사항: 관련 사항 기재\n\n2026. 3. 대동여중 교장`,
        "계획서":`2026학년도 ${task?.name||""} 계획(안)\n\n1. 목적: ${task?.name||""} 체계적 운영\n2. 방침\n   - 관련 규정 준수\n   - 사전 안내 철저\n3. 추진 일정\n   - 3월: 계획 수립\n   - 4~6월: 실행\n   - 7월: 결과 정리`,
      };
      setResult(templates[docType]||templates["가정통신문"]);
      setGenerating(false);
    },1500);
  };
  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📝 문서 작성 AI</h2>
      <p style={{ margin:"0 0 22px", fontSize:11, color:C.textDim }}>업무 데이터를 바탕으로 문서 초안을 자동 생성합니다</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{padding:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8,display:"block"}}>문서 종류</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{types.map(t=><button key={t} onClick={()=>setDocType(t)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${docType===t?C.accent:C.border}`,background:docType===t?C.accentSoft:"transparent",color:docType===t?C.accent:C.textMid,fontSize:12,cursor:"pointer",fontFamily:font}}>{t}</button>)}</div>
          </Card>
          <Card style={{padding:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8,display:"block"}}>관련 업무</label>
            <select value={taskRef} onChange={e=>setTaskRef(+e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none"}}>
              {TASKS.map(t=><option key={t.id} value={t.id}>{t.name} ({t.dept})</option>)}
            </select>
          </Card>
          <button onClick={generate} disabled={generating} style={{padding:"14px",borderRadius:12,border:"none",background:generating?C.textDim:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:generating?"wait":"pointer",fontFamily:font}}>{generating?"✍️ 생성 중...":"✨ 문서 초안 생성"}</button>
        </div>
        <Card style={{padding:20,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{margin:0,fontSize:13,fontWeight:700,color:C.text}}>생성된 문서</h3>
            {result&&<button onClick={()=>navigator.clipboard?.writeText(result)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${C.accent}30`,background:C.accentSoft,color:C.accent,fontSize:11,cursor:"pointer",fontFamily:font}}>📋 복사</button>}
          </div>
          <div style={{flex:1,padding:16,background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,overflowY:"auto",minHeight:280}}>
            {result?<pre style={{margin:0,whiteSpace:"pre-wrap",fontSize:12,color:C.text,lineHeight:1.8,fontFamily:font}}>{result}</pre>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,fontSize:12}}>문서 종류와 업무를 선택 후 생성해주세요</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── SCHEDULE ───
function ScheduleView({ teacher }) {
  const [tab,setTab]=useState("week");
  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📅 {teacher.name} 선생님의 할 일</h2>
      <div style={{ display:"flex", gap:6, marginBottom:22, marginTop:16 }}>
        {[{id:"week",label:"이번 주"},{id:"month",label:"이번 달"}].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"7px 18px",borderRadius:8,border:`1px solid ${tab===t.id?C.accent:C.border}`,background:tab===t.id?C.accentSoft:"transparent",color:tab===t.id?C.accent:C.textMid,fontSize:12,cursor:"pointer",fontFamily:font}}>{t.label}</button>
        ))}
      </div>
      {tab==="week"&&(
        <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
          {SCHEDULE_THIS_WEEK.map((day,i)=>(
            <Card key={i} style={{padding:"14px 18px"}}>
              <div style={{fontSize:12,fontWeight:700,color:C.accent,marginBottom:10}}>{day.day}요일</div>
              <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {day.items.map((item,j)=>(
                  <div key={j} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:C.bg,borderRadius:8}}>
                    <div style={{width:6,height:6,borderRadius:"50%",background:PRIORITY_C[item.priority]}}/>
                    <span style={{fontSize:12,color:C.text,flex:1}}>{item.task}</span>
                    <Badge label={item.priority} color={PRIORITY_C[item.priority]} small/>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
      {tab==="month"&&(
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {TASKS.slice(0,5).map(t=>(
            <Card key={t.id} style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:C.text}}>{t.name}</div>
                <div style={{display:"flex",gap:5,marginTop:5}}><Badge label={t.dept} color={DEPT_C[t.dept]||C.textDim} small/><Badge label={t.period} color={C.accent} small/></div>
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
function HandoverView() {
  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <h2 style={{margin:"0 0 22px",fontSize:17,fontWeight:800,color:C.text}}>🤝 업무 인수인계</h2>
      <Card style={{padding:40,textAlign:"center"}}><div style={{fontSize:32,marginBottom:12}}>📋</div><div style={{fontSize:14,color:C.textDim}}>인수인계 기록이 없습니다</div></Card>
    </div>
  );
}

// ─── 생활기록부 ───
function RecordView() {
  const [category,setCategory]=useState("세부능력및특기사항");
  const [subject,setSubject]=useState("국어");
  const [keywords,setKeywords]=useState("");
  const [result,setResult]=useState(null);
  const [generating,setGenerating]=useState(false);
  const categories=["세부능력및특기사항","행동특성및종합의견","창의적체험활동","자유학기활동","독서활동"];
  const subjects=["국어","수학","영어","사회","과학","기술·가정","체육","음악","미술","도덕","정보"];
  const generate=()=>{
    setGenerating(true);setResult(null);
    setTimeout(()=>{
      const base={"세부능력및특기사항":`${subject} 교과에서 수업에 적극 참여하며 토론 활동에서 논리적 근거로 자신의 의견을 명확히 표현함. 모둠 활동 시 협력적 태도로 구성원 의견을 경청하고 조율하는 리더십을 발휘함.`,"행동특성및종합의견":`밝고 긍정적인 성격으로 교우관계가 원만하며 학급 내 갈등 상황에서 중재자 역할을 수행함. 자기주도적 학습 습관이 형성되어 있으며 꾸준한 노력으로 학업 성취도가 향상됨.`,"창의적체험활동":`(자율) 학급 회의에 적극 참여함. (동아리) 탐구 능력을 신장함. (봉사) 지역사회 봉사활동에 성실히 참여함. (진로) 직업 체험으로 적성을 탐색함.`,"자유학기활동":`주제선택 프로그램에 참여하여 깊이 있는 이해를 보여줌. 조별 프로젝트에서 우수한 결과를 도출함.`,"독서활동":`다양한 분야의 독서를 통해 폭넓은 교양을 쌓고 독서 감상문으로 자신의 생각을 체계적으로 표현함.`};
      let output=base[category]||base["세부능력및특기사항"];
      if(keywords.trim()) output+=`\n\n[키워드: ${keywords}]`;
      setResult(output);setGenerating(false);
    },1300);
  };
  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:800,color:C.text}}>📒 생활기록부 작성 도우미</h2>
      <p style={{margin:"0 0 22px",fontSize:11,color:C.textDim}}>영역·교과를 선택하고 키워드를 입력하면 문구 초안을 생성합니다</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div style={{display:"flex",flexDirection:"column",gap:14}}>
          <Card style={{padding:20}}><label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:10,display:"block"}}>기록 영역</label><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{categories.map(c=><button key={c} onClick={()=>setCategory(c)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${category===c?C.accent:C.border}`,background:category===c?C.accentSoft:"transparent",color:category===c?C.accent:C.textMid,fontSize:11,cursor:"pointer",fontFamily:font}}>{c}</button>)}</div></Card>
          {category==="세부능력및특기사항"&&(<Card style={{padding:20}}><label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:10,display:"block"}}>교과</label><div style={{display:"flex",flexWrap:"wrap",gap:6}}>{subjects.map(s=><button key={s} onClick={()=>setSubject(s)} style={{padding:"5px 12px",borderRadius:8,border:`1px solid ${subject===s?C.accent:C.border}`,background:subject===s?C.accentSoft:"transparent",color:subject===s?C.accent:C.textMid,fontSize:11,cursor:"pointer",fontFamily:font}}>{s}</button>)}</div></Card>)}
          <Card style={{padding:20}}><label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:10,display:"block"}}>키워드 (선택)</label><textarea value={keywords} onChange={e=>setKeywords(e.target.value)} placeholder="예: 리더십, 발표력 우수..." rows={3} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none",resize:"vertical",boxSizing:"border-box"}}/></Card>
          <button onClick={generate} disabled={generating} style={{padding:"14px",borderRadius:12,border:"none",background:generating?C.textDim:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:generating?"wait":"pointer",fontFamily:font}}>{generating?"✍️ 생성 중...":"✨ 문구 생성"}</button>
        </div>
        <Card style={{padding:20,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <h3 style={{margin:0,fontSize:13,fontWeight:700,color:C.text}}>생성된 문구</h3>
            {result&&<button onClick={()=>navigator.clipboard?.writeText(result)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${C.accent}30`,background:C.accentSoft,color:C.accent,fontSize:11,cursor:"pointer",fontFamily:font}}>📋 복사</button>}
          </div>
          <div style={{flex:1,padding:16,background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,overflowY:"auto",minHeight:300}}>
            {result?<pre style={{margin:0,whiteSpace:"pre-wrap",fontSize:13,color:C.text,lineHeight:2,fontFamily:font}}>{result}</pre>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",color:C.textDim,fontSize:12}}>조건 선택 후 생성해주세요</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── 사용자 관리 (슈퍼관리자 전용) ───
function UsersView() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(()=>{
    supabase.from('teachers').select('*').order('created_at')
      .then(({data})=>{ if(data) setUsers(data); setLoading(false); });
  },[]);
  const updateRole = async (id, role) => {
    await supabase.from('teachers').update({role}).eq('id',id);
    setUsers(prev=>prev.map(u=>u.id===id?{...u,role}:u));
  };
  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:800,color:C.text}}>👥 사용자 관리</h2>
      <p style={{margin:"0 0 20px",fontSize:11,color:C.textDim}}>Google 로그인한 교사 계정의 권한을 관리합니다</p>
      {loading?<div style={{color:C.textDim,textAlign:"center",padding:40}}>로딩 중...</div>:(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {users.map(u=>(
            <Card key={u.id} style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:C.text}}>{u.name}</div>
                <div style={{fontSize:11,color:C.textDim,marginTop:3}}>{u.email||'이메일 미등록'}</div>
              </div>
              <select value={u.role} onChange={e=>updateRole(u.id,e.target.value)} style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:ROLE_COLOR[u.role]||C.text,fontSize:12,fontFamily:font,outline:"none",fontWeight:600}}>
                <option value="teacher">교사</option>
                <option value="timetable_admin">시간표관리자</option>
                <option value="super_admin">슈퍼관리자</option>
              </select>
            </Card>
          ))}
          {users.length===0&&<div style={{color:C.textDim,textAlign:"center",padding:40}}>등록된 사용자가 없습니다</div>}
        </div>
      )}
    </div>
  );
}

// ─── 학교 설정 ───
function SettingsView() {
  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:800,color:C.text}}>⚙️ 학교 설정</h2>
      <p style={{margin:"0 0 20px",fontSize:11,color:C.textDim}}>학교 기본 정보, 교사·학급·과목 데이터를 관리합니다</p>
      <Card style={{padding:40,textAlign:"center"}}>
        <div style={{fontSize:32,marginBottom:12}}>🚧</div>
        <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:8}}>초기설정 UI 개발 예정</div>
        <div style={{fontSize:12,color:C.textDim,lineHeight:1.8}}>교사 등록, 과목·학급 설정, 교사-학급-시수 배정을<br/>웹에서 직접 입력할 수 있는 기능이 추가될 예정입니다</div>
      </Card>
    </div>
  );
}

// ─── 권한 없음 ───
function NoAccessView() {
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:12,fontFamily:font}}>
      <div style={{fontSize:40}}>🔒</div>
      <div style={{fontSize:16,fontWeight:700,color:C.text}}>접근 권한이 없습니다</div>
      <div style={{fontSize:13,color:C.textDim}}>이 페이지는 관리자만 접근할 수 있습니다</div>
    </div>
  );
}

// ─── MAIN APP ───
function MainApp({ session, onLogout }) {
  const [page, setPage] = useState("dashboard");
  const [teacher, setTeacher] = useState(null);
  const [loadingTeacher, setLoadingTeacher] = useState(true);

  useEffect(()=>{
    supabase.from('teachers').select('*').eq('user_id', session.user.id).single()
      .then(({data})=>{
        setTeacher(data || {
          user_id: session.user.id,
          name: session.user.user_metadata?.full_name || session.user.email,
          email: session.user.email,
          role: 'teacher',
        });
        setLoadingTeacher(false);
      });
  },[session]);

  if(loadingTeacher) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,color:C.text,fontFamily:font}}>
      사용자 정보 로딩 중...
    </div>
  );

  const canAccess = (pageId) => {
    if(['timetable'].includes(pageId)) return ['super_admin','timetable_admin'].includes(teacher.role);
    if(['users','settings'].includes(pageId)) return teacher.role==='super_admin';
    return true;
  };

  const renderContent = () => {
    if(!canAccess(page)) return <NoAccessView/>;
    switch(page){
      case "dashboard": return <DashboardView teacher={teacher}/>;
      case "chat":      return <ChatView teacher={teacher}/>;
      case "tasks":     return <TasksView/>;
      case "docs":      return <DocWriterView/>;
      case "schedule":  return <ScheduleView teacher={teacher}/>;
      case "handover":  return <HandoverView/>;
      case "record":    return <RecordView/>;
      case "timetable": return <TimetablePage/>;
      case "users":     return <UsersView/>;
      case "settings":  return <SettingsView/>;
      default:          return <DashboardView teacher={teacher}/>;
    }
  };

  return (
    <div style={{display:"flex",height:"100vh",width:"100vw",fontFamily:font,background:C.bg,color:C.text}}>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
      <Sidebar active={page} onNav={setPage} teacher={teacher} onLogout={onLogout}/>
      <div style={{flex:1,overflow:"hidden"}}>{renderContent()}</div>
    </div>
  );
}

// ─── APP (인증 래퍼) ───
export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>{ setSession(session); setLoading(false); });
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,session)=>setSession(session));
    return ()=>subscription.unsubscribe();
  },[]);

  const handleLogin = async () => {
    await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo:window.location.origin } });
  };

  const handleLogout = async () => { await supabase.auth.signOut(); };

  if(loading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0c0f1a",color:"#e8ecf4",fontFamily:font}}>로딩 중...</div>
  );

  if(!session) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0c0f1a",fontFamily:font}}>
      <div style={{background:"#141929",border:"1px solid #232940",borderRadius:16,padding:"48px 40px",textAlign:"center",minWidth:300}}>
        <div style={{fontSize:32,marginBottom:12}}>🏫</div>
        <h1 style={{margin:"0 0 6px",fontSize:22,fontWeight:800,color:"#e8ecf4"}}>대동여중</h1>
        <p style={{margin:"0 0 32px",fontSize:13,color:"#8b95ad"}}>업무시스템</p>
        <button onClick={handleLogin} style={{background:"#4f8cff",color:"#fff",border:"none",borderRadius:10,padding:"13px 28px",fontSize:14,fontWeight:600,cursor:"pointer",width:"100%",fontFamily:font}}>
          Google 계정으로 로그인
        </button>
      </div>
    </div>
  );

  return <MainApp session={session} onLogout={handleLogout}/>;
}
