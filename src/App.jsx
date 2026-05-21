import { useState, useEffect } from "react";
import { supabase } from './lib/supabase';
import { DEPT } from './lib/timetableData';
// 정리 2-C: TimetablePage 라우팅 폐지 (솔버는 TimetablesListPage 의 SolverModal 로 흡수)
//   파일 자체는 deprecated stub 으로 보존 (src/pages/TimetablePage.jsx).
import TimetableViewer from './pages/TimetableViewer';
import TimetablesListPage from './pages/TimetablesListPage';
import TimetableEditPage from './pages/TimetableEditPage';
import TimetableHistoryPage from './pages/TimetableHistoryPage';
import SchoolCalendarPage from './pages/SchoolCalendarPage';
import SchedulePage from './pages/SchedulePage';
import DocumentsPage from './pages/DocumentsPage';
import DashboardPage from './pages/DashboardPage';
import ChatView from './components/ChatView';

// 정리 작업 2-A: 부서 목록은 timetableData.js 의 DEPT 로 통합 (SBJ/TCH/CLS 와 같은 출처)

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
const DEPT_C     = { "교무부":"#4f8cff","연구부":"#a78bfa","학생안전부":"#f472b6","학생생활부":"#fb923c","진로부":"#22d3ee","정보부":"#34d399" };
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
  // 정리 2-C: 시간표 메뉴 재구성
  //   - 📅 시간표 (TimetableViewer) 가 commonMenus 로 이동 — 일반 교사도 변동 요청 시작 가능
  //   - 🗂️ 시간표 관리 (TimetablesListPage) 는 adminMenus 유지 — 드래프트/활성화 행정 작업
  //   - 기존 "🗓️ 시간표 관리"(TimetablePage 솔버 페이지) 폐지 — 솔버는 시간표 관리의 모달로 흡수
  const common = [
    { id:"dashboard",     icon:"🏠", label:"대시보드" },
    { id:"timetable_v2",  icon:"📅", label:"시간표" },
    { id:"schedule",      icon:"🗓️", label:"일정 관리" },
    { id:"documents",     icon:"📂", label:"문서 관리" },
    { id:"chat",          icon:"🤖", label:"AI 업무 비서" },
    { id:"tasks",         icon:"📋", label:"업무 문서 총정리" },
    { id:"docs",          icon:"📝", label:"문서 작성 AI" },
    { id:"mytasks",       icon:"✅", label:"나의 할 일" },
    { id:"handover",      icon:"🤝", label:"업무 인수인계", beta:true },
    { id:"record",        icon:"📒", label:"생활기록부 도우미", beta:true },
  ];
  const adminMenus = [
    { id:"timetables_list", icon:"🗂️", label:"시간표 관리" },
    { id:"school_calendar", icon:"📆", label:"학사일정" },
  ];
  const superMenus = [
    { id:"users",    icon:"👥", label:"사용자 관리" },
    // 정리 작업 1: 학교 설정 메뉴 임시 비활성화 — Phase 5 + 데이터 입력 UI 와 함께 부활 예정
    // { id:"settings", icon:"⚙️", label:"학교 설정" },
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

  // 시간표 미확인 알림 카운트 (TimetableViewer 가 window 이벤트로 dispatch)
  const [ttUnread, setTtUnread] = useState(0);
  useEffect(() => {
    const handler = (e) => setTtUnread(e.detail?.count || 0);
    window.addEventListener('timetable:unread-count', handler);
    return () => window.removeEventListener('timetable:unread-count', handler);
  }, []);

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
        {menuItems.map(s=>{
          const showDot = s.id === 'timetable_v2' && ttUnread > 0 && active !== s.id;
          return (
            <button key={s.id} onClick={()=>onNav(s.id)} style={{
              display:"flex", alignItems:"center", gap:10, padding:"10px 20px",
              background:active===s.id?C.accentSoft:"transparent",
              border:"none", color:active===s.id?C.accent:C.textMid,
              fontSize:13, fontWeight:active===s.id?700:500,
              cursor:"pointer", borderRight:active===s.id?`3px solid ${C.accent}`:"3px solid transparent",
              fontFamily:font, textAlign:"left", transition:"all .15s", position:"relative",
            }}>
              <span style={{ fontSize:15 }}>{s.icon}</span>
              {s.label}
              {s.beta && (
                <span style={{ fontSize:10, color:C.textDim, marginLeft:4, fontWeight:500 }}>(베타)</span>
              )}
              {showDot && (
                <span style={{
                  marginLeft: 'auto', minWidth: 18, height: 18, padding: '0 5px',
                  borderRadius: 9, background: C.red, color: '#fff',
                  fontSize: 10, fontWeight: 700, display: 'inline-flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>{ttUnread > 99 ? '99+' : ttUnread}</span>
              )}
            </button>
          );
        })}
      </div>
      <div style={{ padding:"16px 20px", borderTop:`1px solid ${C.border}` }}>
        <button onClick={onLogout} style={{ width:"100%", padding:"8px", borderRadius:8, border:`1px solid ${C.border}`, background:"transparent", color:C.textDim, fontSize:12, cursor:"pointer", fontFamily:font }}>로그아웃</button>
      </div>
    </nav>
  );
}

// ─── DASHBOARD / CHAT ───
// 정리 작업 2-B: DashboardView 와 ChatView 를 별도 파일로 분리.
//   DashboardView → src/pages/DashboardPage.jsx
//   ChatView      → src/components/ChatView.jsx (대시보드 임베드 + 사이드바 양쪽에서 사용)

// ─── TASKS (Supabase 연동) ───
function TasksView({ teacher }) {
  const [tasks, setTasks] = useState([]);
  const [filter, setFilter] = useState("전체");
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({ name:"", dept:"교무부", area:"", type:"정기업무", period:"상시", priority:"중간", status:"초안", overview:"", steps:[""], cautions:[""], required_docs:[""] });

  const fetchTasks = async () => {
    setLoading(true);
    const { data } = await supabase.from('tasks').select('*').order('created_at', { ascending: false });
    if (data) setTasks(data);
    setLoading(false);
  };

  useEffect(() => { fetchTasks(); }, []);

  const depts = ["전체", ...DEPT];
  const filtered = filter === "전체" ? tasks : tasks.filter(t => t.dept === filter);

  const resetForm = () => setForm({ name:"", dept:"교무부", area:"", type:"정기업무", period:"상시", priority:"중간", status:"초안", overview:"", steps:[""], cautions:[""], required_docs:[""] });

  const handleSave = async () => {
    if (!form.name.trim()) return;
    const payload = {
      ...form,
      steps: JSON.stringify(form.steps.filter(s => s.trim())),
      cautions: JSON.stringify(form.cautions.filter(c => c.trim())),
      required_docs: JSON.stringify(form.required_docs.filter(d => d.trim())),
      created_by: teacher?.id,
    };

    if (editMode && sel) {
      await supabase.from('tasks').update(payload).eq('id', sel.id);
    } else {
      await supabase.from('tasks').insert([payload]);
    }
    setShowAdd(false); setEditMode(false); setSel(null); resetForm(); fetchTasks();
  };

  const handleDelete = async (id) => {
    if (!confirm('이 업무를 삭제하시겠습니까?')) return;
    await supabase.from('tasks').delete().eq('id', id);
    setSel(null); fetchTasks();
  };

  const startEdit = (task) => {
    const steps = Array.isArray(task.steps) ? task.steps : JSON.parse(task.steps || '[]');
    const cautions = Array.isArray(task.cautions) ? task.cautions : JSON.parse(task.cautions || '[]');
    const docs = Array.isArray(task.required_docs) ? task.required_docs : JSON.parse(task.required_docs || '[]');
    setForm({ name:task.name, dept:task.dept, area:task.area||"", type:task.type||"", period:task.period||"", priority:task.priority||"중간", status:task.status||"초안", overview:task.overview||"", steps:steps.length?steps:[""], cautions:cautions.length?cautions:[""], required_docs:docs.length?docs:[""] });
    setEditMode(true); setShowAdd(true);
  };

  const updateList = (key, idx, val) => { const arr = [...form[key]]; arr[idx] = val; setForm({...form, [key]: arr}); };
  const addListItem = (key) => setForm({...form, [key]: [...form[key], ""]});
  const removeListItem = (key, idx) => { const arr = form[key].filter((_,i)=>i!==idx); setForm({...form, [key]: arr.length?arr:[""]}); };

  // ─── 업무 추가/수정 폼 ───
  if (showAdd) {
    return (
      <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
        <button onClick={()=>{setShowAdd(false);setEditMode(false);resetForm()}} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0, fontFamily:font, fontWeight:600, marginBottom:16 }}>← 목록으로</button>
        <h2 style={{ margin:"0 0 20px", fontSize:17, fontWeight:800, color:C.text }}>{editMode?"📝 업무 수정":"➕ 업무 추가"}</h2>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16, marginBottom:16 }}>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>업무명 *</label><input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:13,fontFamily:font,outline:"none",boxSizing:"border-box"}} /></div>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>부서</label><select value={form.dept} onChange={e=>setForm({...form,dept:e.target.value})} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none"}}>{DEPT.map(d=> <option key={d} value={d}>{d}</option>)}</select></div>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>세부 영역</label><input value={form.area} onChange={e=>setForm({...form,area:e.target.value})} placeholder="예: 성적, 학적, 학생안전..." style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none",boxSizing:"border-box"}} /></div>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>시행 시기</label><select value={form.period} onChange={e=>setForm({...form,period:e.target.value})} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none"}}>{["3월","4월","5월","6월","7월","8월","9월","10월","11월","12월","1월","2월","학기초","학기중","학기말","상시","수시"].map(p=> <option key={p} value={p}>{p}</option>)}</select></div>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>중요도</label><div style={{display:"flex",gap:6}}>{["높음","중간","낮음"].map(p=> <button key={p} onClick={()=>setForm({...form,priority:p})} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${form.priority===p?PRIORITY_C[p]:C.border}`,background:form.priority===p?PRIORITY_C[p]+"18":"transparent",color:form.priority===p?PRIORITY_C[p]:C.textMid,fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:form.priority===p?700:500}}>{p}</button>)}</div></div>
          <div><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>상태</label><div style={{display:"flex",gap:6}}>{["초안","검토중","공식"].map(s=> <button key={s} onClick={()=>setForm({...form,status:s})} style={{flex:1,padding:"8px",borderRadius:8,border:`1px solid ${form.status===s?STATUS_C[s]:C.border}`,background:form.status===s?STATUS_C[s]+"18":"transparent",color:form.status===s?STATUS_C[s]:C.textMid,fontSize:12,cursor:"pointer",fontFamily:font,fontWeight:form.status===s?700:500}}>{s}</button>)}</div></div>
        </div>
        <div style={{marginBottom:16}}><label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>업무 개요</label><textarea value={form.overview} onChange={e=>setForm({...form,overview:e.target.value})} placeholder="이 업무가 무엇인지 간단히 설명해주세요" rows={3} style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none",resize:"vertical",boxSizing:"border-box"}} /></div>

        {[{key:"steps",label:"📋 업무 절차",ph:"1단계: ..."},{key:"cautions",label:"⚠️ 주의사항",ph:"주의할 점"},{key:"required_docs",label:"📂 필요 문서",ph:"문서명"}].map(({key,label,ph})=>(
          <div key={key} style={{marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:600,color:C.textMid,display:"block",marginBottom:6}}>{label}</label>
            {form[key].map((item,idx)=> <div key={idx} style={{display:"flex",gap:6,marginBottom:4}}>
              <input value={item} onChange={e=>updateList(key,idx,e.target.value)} placeholder={ph} style={{flex:1,padding:"8px 10px",borderRadius:6,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none"}} />
              <button onClick={()=>removeListItem(key,idx)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.red,fontSize:12,cursor:"pointer",fontFamily:font}}>✕</button>
            </div>)}
            <button onClick={()=>addListItem(key)} style={{padding:"6px 12px",borderRadius:6,border:`1px dashed ${C.border}`,background:"transparent",color:C.textMid,fontSize:11,cursor:"pointer",fontFamily:font,marginTop:4}}>+ 항목 추가</button>
          </div>
        ))}

        <div style={{display:"flex",gap:8,marginTop:8}}>
          <button onClick={()=>{setShowAdd(false);setEditMode(false);resetForm()}} style={{flex:1,padding:"12px",borderRadius:10,border:`1px solid ${C.border}`,background:"transparent",color:C.textMid,fontSize:13,cursor:"pointer",fontFamily:font}}>취소</button>
          <button onClick={handleSave} style={{flex:2,padding:"12px",borderRadius:10,border:"none",background:C.accent,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",fontFamily:font}}>{editMode?"수정 완료":"업무 등록"}</button>
        </div>
      </div>
    );
  }

  // ─── 업무 상세 ───
  if (sel) {
    const steps = Array.isArray(sel.steps) ? sel.steps : JSON.parse(sel.steps || '[]');
    const cautions = Array.isArray(sel.cautions) ? sel.cautions : JSON.parse(sel.cautions || '[]');
    const docs = Array.isArray(sel.required_docs) ? sel.required_docs : JSON.parse(sel.required_docs || '[]');
    const canEdit = teacher?.role === 'super_admin' || true;

    return (
      <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
        <button onClick={()=>setSel(null)} style={{ background:"none", border:"none", color:C.accent, fontSize:12, cursor:"pointer", padding:0, fontFamily:font, fontWeight:600, marginBottom:16 }}>← 목록으로</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
          <div>
            <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:6 }}>
              <h2 style={{ margin:0, fontSize:20, fontWeight:800, color:C.text }}>{sel.name}</h2>
              <Badge label={sel.priority} color={PRIORITY_C[sel.priority]}/><Badge label={sel.status} color={STATUS_C[sel.status]}/>
            </div>
            <div style={{ display:"flex", gap:5 }}><Badge label={sel.dept} color={DEPT_C[sel.dept]||C.textDim} small/>{sel.area&&<Badge label={sel.area} color={C.textDim} small/>}<Badge label={sel.period} color={C.accent} small/></div>
          </div>
          {canEdit && <div style={{display:"flex",gap:6}}>
            <button onClick={()=>startEdit(sel)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${C.accent}40`,background:C.accentSoft,color:C.accent,fontSize:11,cursor:"pointer",fontFamily:font}}>✏️ 수정</button>
            <button onClick={()=>handleDelete(sel.id)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${C.red}40`,background:C.red+"10",color:C.red,fontSize:11,cursor:"pointer",fontFamily:font}}>🗑 삭제</button>
          </div>}
        </div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          {sel.overview && <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📌 업무 개요</h3><p style={{margin:0,color:C.textMid,fontSize:13,lineHeight:1.7}}>{sel.overview}</p></Card>}
          {steps.length>0 && <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📋 업무 절차</h3><ol style={{margin:0,paddingLeft:20,color:C.textMid,fontSize:13,lineHeight:2.1}}>{steps.map((s,i)=> <li key={i}>{s}</li>)}</ol></Card>}
          {cautions.length>0 && <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>⚠️ 주의사항</h3><ul style={{margin:0,paddingLeft:20,color:C.yellow,fontSize:13,lineHeight:2}}>{cautions.map((c,i)=> <li key={i}>{c}</li>)}</ul></Card>}
          {docs.length>0 && <Card style={{padding:18}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.text}}>📂 필요 문서</h3>{docs.map((d,i)=> <div key={i} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:4}}><span style={{color:C.accent}}>📄</span><span style={{fontSize:12,color:C.text}}>{d}</span></div>)}</Card>}
          {sel.handover_note && <Card style={{padding:18,borderColor:C.accent+"30"}}><h3 style={{margin:"0 0 8px",fontSize:13,fontWeight:700,color:C.accent}}>🤝 인수인계 메모</h3><p style={{margin:0,color:C.textMid,fontSize:13,lineHeight:1.7,fontStyle:"italic"}}>"{sel.handover_note}"</p></Card>}
        </div>
      </div>
    );
  }

  // ─── 업무 목록 ───
  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
        <div>
          <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📋 업무 문서 총정리</h2>
          <p style={{ margin:0, fontSize:11, color:C.textDim }}>학교 전체 업무를 관리합니다 · 업무를 클릭하면 상세 매뉴얼을 볼 수 있습니다</p>
        </div>
        <button onClick={()=>{resetForm();setShowAdd(true)}} style={{padding:"8px 16px",borderRadius:8,border:"none",background:C.accent,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font}}>+ 업무 추가</button>
      </div>
      <div style={{ display:"flex", gap:6, marginBottom:16, flexWrap:"wrap" }}>
        {depts.map(d=> <button key={d} onClick={()=>setFilter(d)} style={{ padding:"5px 14px", borderRadius:8, border:`1px solid ${filter===d?C.accent:C.border}`, background:filter===d?C.accentSoft:"transparent", color:filter===d?C.accent:C.textMid, fontSize:11, cursor:"pointer", fontFamily:font }}>{d}</button>)}
      </div>
      {loading ? <div style={{textAlign:"center",padding:40,color:C.textDim}}>불러오는 중...</div> : (
        <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
          {filtered.length === 0 && <Card style={{padding:40,textAlign:"center"}}><p style={{color:C.textDim,fontSize:13}}>등록된 업무가 없습니다. 업무를 추가해 주세요.</p></Card>}
          {filtered.map(task => (
            <Card key={task.id} hover onClick={()=>setSel(task)} style={{ padding:"14px 18px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
                <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{task.name}</span>
                <div style={{ display:"flex", gap:5 }}><Badge label={task.dept} color={DEPT_C[task.dept]||C.textDim} small/>{task.area&&<Badge label={task.area} color={C.textDim} small/>}<Badge label={task.period} color={C.accent} small/></div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <Badge label={task.priority} color={PRIORITY_C[task.priority]}/><Badge label={task.status} color={STATUS_C[task.status]}/>
                <span style={{ color:C.textDim }}>→</span>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── DOC WRITER (Claude API 연동) ───
function DocWriterView({ teacher }) {
  const [docType,setDocType]=useState("가정통신문");
  const [tasks,setTasks]=useState([]);
  const [taskRef,setTaskRef]=useState("");
  const [extra,setExtra]=useState("");
  const [result,setResult]=useState(null);
  const [generating,setGenerating]=useState(false);
  const types=["가정통신문","계획서","결과보고서","안내문","동의서","회의록","문자메시지"];

  useEffect(()=>{ supabase.from('tasks').select('id,name,dept,area,overview').order('name').then(({data})=>{ if(data){setTasks(data);if(data[0])setTaskRef(data[0].id)} }); },[]);

  const task = tasks.find(t=>t.id===taskRef);

  const generate = async () => {
    setGenerating(true); setResult(null);
    try {
      const res = await fetch('/api/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          messages:[{ role:'user', content:`"${docType}" 문서를 작성해주세요.\n\n관련 업무: ${task?.name||'미지정'} (${task?.dept||''})\n업무 개요: ${task?.overview||'없음'}\n\n추가 요청: ${extra||'없음'}\n\n완성본에 가까운 초안을 작성해주세요. 대동여중 명의로 작성하세요.` }],
          teacher,
          systemPrompt: `당신은 대동여중의 문서 작성 전문 AI입니다.\n사용자가 요청한 문서 유형에 맞는 완성도 높은 초안을 작성합니다.\n- 학교명은 "대동여자중학교" 또는 "대동여중"을 사용합니다\n- 날짜, 장소 등 확인 필요한 부분은 [   ]로 표시합니다\n- 공문서 형식에 맞게 작성합니다\n- 바로 사용할 수 있을 수준으로 작성합니다`,
          useContext: true,
        }),
      });
      const data = await res.json();
      setResult(data.content || '문서 생성에 실패했습니다.');
    } catch(e) { setResult('오류: '+e.message); }
    setGenerating(false);
  };

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>📝 문서 작성 AI</h2>
      <p style={{ margin:"0 0 22px", fontSize:11, color:C.textDim }}>업무 데이터를 바탕으로 Claude AI가 문서 초안을 작성합니다</p>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <Card style={{padding:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8,display:"block"}}>문서 종류</label>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>{types.map(t=> <button key={t} onClick={()=>setDocType(t)} style={{padding:"6px 14px",borderRadius:8,border:`1px solid ${docType===t?C.accent:C.border}`,background:docType===t?C.accentSoft:"transparent",color:docType===t?C.accent:C.textMid,fontSize:12,cursor:"pointer",fontFamily:font}}>{t}</button>)}</div>
          </Card>
          <Card style={{padding:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8,display:"block"}}>관련 업무</label>
            <select value={taskRef} onChange={e=>setTaskRef(e.target.value)} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none"}}>
              {tasks.map(t=> <option key={t.id} value={t.id}>{t.name} ({t.dept})</option>)}
            </select>
          </Card>
          <Card style={{padding:20}}>
            <label style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:8,display:"block"}}>추가 요청사항</label>
            <textarea value={extra} onChange={e=>setExtra(e.target.value)} placeholder="예: 날짜를 4월 15일로, 장소를 강당으로, 3학년 대상으로..." rows={3} style={{width:"100%",padding:"10px 12px",borderRadius:10,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:"none",resize:"vertical",boxSizing:"border-box"}} />
          </Card>
          <button onClick={generate} disabled={generating} style={{padding:"14px",borderRadius:12,border:"none",background:generating?C.textDim:C.accent,color:"#fff",fontSize:14,fontWeight:700,cursor:generating?"wait":"pointer",fontFamily:font}}>{generating?"✍️ AI가 작성 중...":"✨ 문서 초안 생성"}</button>
        </div>
        <Card style={{padding:20,display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <h3 style={{margin:0,fontSize:13,fontWeight:700,color:C.text}}>생성된 문서</h3>
            {result&&<button onClick={()=>navigator.clipboard?.writeText(result)} style={{padding:"4px 12px",borderRadius:6,border:`1px solid ${C.accent}30`,background:C.accentSoft,color:C.accent,fontSize:11,cursor:"pointer",fontFamily:font}}>📋 복사</button>}
          </div>
          <div style={{flex:1,padding:16,background:C.bg,borderRadius:10,border:`1px solid ${C.border}`,overflowY:"auto",minHeight:280}}>
            {result? <pre style={{margin:0,whiteSpace:"pre-wrap",fontSize:12,color:C.text,lineHeight:1.8,fontFamily:font}}>{result}</pre>:<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100%",flexDirection:"column",gap:10,color:C.textDim,fontSize:12}}><span style={{fontSize:28}}>📝</span>문서 종류와 업무를 선택 후 생성해주세요</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── SCHEDULE (나의 할 일) ───
function MyScheduleView({ teacher }) {
  const [schedules, setSchedules] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    const load = async () => {
      setLoading(true);
      // 이번 달 일정
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
      const end = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().split('T')[0];
      // 정리 작업 1: schedules → events 로 통일. date 컬럼은 start_date 로 매핑.
      const { data: schData } = await supabase.from('events').select('*').gte('start_date',start).lte('start_date',end).order('start_date');
      if(schData) setSchedules(schData);
      // 내 부서 업무
      const { data: taskData } = await supabase.from('tasks').select('*').order('priority');
      if(taskData) setTasks(taskData);
      setLoading(false);
    };
    load();
  },[]);

  const isHomeroom = !!teacher.homeroom;
  const mySchedules = schedules.filter(e=>{
    // 정리 작업 1: visibility → scope
    if(e.scope==='personal' && e.created_by!==teacher.id) return false;
    const tags = Array.isArray(e.tags)?e.tags:[];
    if(tags.includes('전체')) return true;
    if(tags.includes('담임') && isHomeroom) return true;
    if(tags.includes('교과')) return true;
    // 정리 1 보강: e.dept 와 teacher.dept 가 둘 다 NULL 이면 모든 일정이 매칭되므로 양쪽 truthy 일 때만 비교
    if(e.dept && e.dept===teacher.dept) return true;
    if(e.created_by===teacher.id) return true;
    return false;
  });
  const myTasks = tasks.filter(t=>t.dept===teacher.dept);
  const urgentTasks = myTasks.filter(t=>t.priority==='높음');

  const today = new Date().toISOString().split('T')[0];
  // 정리 작업 1: date → start_date
  const todaySchedules = mySchedules.filter(e=>e.start_date===today);
  const thisWeek = mySchedules.filter(e=>{const d=new Date(e.start_date);const diff=(d-new Date())/(1000*60*60*24);return diff>=0&&diff<7;});

  if(loading) return <div style={{padding:40,textAlign:"center",color:C.textDim,fontFamily:font}}>불러오는 중...</div>;

  return (
    <div style={{ padding:28, overflowY:"auto", height:"100%", fontFamily:font }}>
      <h2 style={{ margin:"0 0 4px", fontSize:17, fontWeight:800, color:C.text }}>✅ {teacher.name} 선생님의 할 일</h2>
      <p style={{ margin:"0 0 20px", fontSize:11, color:C.textDim }}>{teacher.dept} · {teacher.area||''} · {isHomeroom?`${teacher.homeroom} 담임`:'비담임'}</p>

      <div style={{display:"flex",flexDirection:"column",gap:16}}>
        <Card style={{padding:18}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700,color:C.red}}>🔴 오늘 ({todaySchedules.length}건)</h3>
          {todaySchedules.length===0?<div style={{fontSize:12,color:C.textDim,padding:8}}>오늘 등록된 일정이 없습니다</div>:
          todaySchedules.map(e=> <div key={e.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:4}}><div style={{width:6,height:6,borderRadius:"50%",background:PRIORITY_C[e.priority]||C.yellow}}/><span style={{fontSize:12,color:C.text,flex:1}}>{e.title}</span><Badge label={e.category||'일정'} color={C.accent} small/></div>)}
        </Card>

        <Card style={{padding:18}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700,color:C.yellow}}>🟡 이번 주 ({thisWeek.length}건)</h3>
          {thisWeek.length===0?<div style={{fontSize:12,color:C.textDim,padding:8}}>이번 주 일정이 없습니다</div>:
          thisWeek.map(e=> <div key={e.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:4}}><div style={{width:6,height:6,borderRadius:"50%",background:PRIORITY_C[e.priority]||C.yellow}}/><div style={{flex:1}}><div style={{fontSize:12,color:C.text}}>{e.title}</div><div style={{fontSize:10,color:C.textDim}}>{e.start_date?.slice(5)}</div></div><Badge label={e.priority||'보통'} color={PRIORITY_C[e.priority]||C.textDim} small/></div>)}
        </Card>

        <Card style={{padding:18}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700,color:C.accent}}>📋 내 부서 업무 ({myTasks.length}건)</h3>
          {myTasks.length===0?<div style={{fontSize:12,color:C.textDim,padding:8}}>등록된 업무가 없습니다</div>:
          myTasks.map(t=> <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:C.bg,borderRadius:8,marginBottom:4}}><span style={{fontSize:12,color:C.text,flex:1}}>{t.name}</span><Badge label={t.period} color={C.accent} small/><Badge label={t.priority} color={PRIORITY_C[t.priority]} small/></div>)}
        </Card>

        {urgentTasks.length>0&&<Card style={{padding:18,borderColor:C.red+"30"}}>
          <h3 style={{margin:"0 0 12px",fontSize:14,fontWeight:700,color:C.red}}>⚡ 긴급 업무</h3>
          {urgentTasks.map(t=> <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",background:C.red+"08",borderRadius:8,marginBottom:4}}><span style={{fontSize:12,color:C.text,flex:1}}>{t.name}</span><Badge label={t.dept} color={DEPT_C[t.dept]||C.textDim} small/></div>)}
        </Card>}
      </div>
    </div>
  );
}

// ─── 공통 베타 안내 배너 (정리 작업 1) ───
function BetaBanner({ message }) {
  return (
    <div style={{
      padding:'10px 14px', marginBottom:16,
      background:C.yellow+'15', color:C.yellow,
      border:`1px solid ${C.yellow}40`, borderRadius:8,
      fontSize:12, fontFamily:font, lineHeight:1.6,
    }}>
      ⚠️ {message}
    </div>
  );
}

// ─── HANDOVER (준비중) ───
function HandoverView() {
  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <BetaBanner message="이 기능은 아직 개발 중입니다. 일부 기능이 동작하지 않을 수 있어요. 운영 안정화 후 정식 릴리즈 예정입니다." />
      <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:'calc(100% - 60px)'}}>
      <Card style={{padding:"60px 48px",textAlign:"center",maxWidth:400}}>
        <div style={{fontSize:48,marginBottom:16}}>🚧</div>
        <h2 style={{margin:"0 0 10px",fontSize:20,fontWeight:800,color:C.text}}>업무 인수인계</h2>
        <p style={{margin:"0 0 8px",fontSize:14,color:C.yellow,fontWeight:600}}>준비중입니다</p>
        <p style={{margin:0,fontSize:12,color:C.textDim,lineHeight:1.7}}>인수인계 기능은 현재 설계 중입니다.<br/>더 나은 형태로 곧 찾아뵙겠습니다.</p>
      </Card>
      </div>
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
      <p style={{margin:"0 0 14px",fontSize:11,color:C.textDim}}>영역·교과를 선택하고 키워드를 입력하면 문구 초안을 생성합니다</p>
      <BetaBanner message="이 기능은 실제 AI 호출 없이 샘플 문구를 보여주는 베타 버전입니다. 실제 AI 기반 생성은 추후 정식 릴리즈에서 제공됩니다." />
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

// ─── 승인 대기 / 거절 화면 ───
function PendingView({ onLogout, status }) {
  const isRejected = status === 'rejected';
  return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:C.bg,fontFamily:font}}>
      <div style={{background:C.card,border:`1px solid ${isRejected?C.red+'40':C.border}`,borderRadius:16,padding:"48px 40px",textAlign:"center",maxWidth:360}}>
        <div style={{fontSize:40,marginBottom:16}}>{isRejected?'❌':'⏳'}</div>
        <h2 style={{margin:"0 0 10px",fontSize:20,fontWeight:800,color:C.text}}>
          {isRejected?'가입이 거절되었습니다':'승인 대기 중'}
        </h2>
        <p style={{margin:"0 0 8px",fontSize:13,color:C.textMid,lineHeight:1.7}}>
          {isRejected
            ? '관리자에 의해 가입이 거절되었습니다.\n문의가 필요하시면 학교 관리자에게 연락해주세요.'
            : '가입 신청이 완료되었습니다.\n슈퍼관리자가 계정을 승인하면 이용하실 수 있습니다.'
          }
        </p>
        {!isRejected && <p style={{margin:"0 0 28px",fontSize:11,color:C.textDim}}>승인 후 다시 로그인해주세요.</p>}
        {isRejected && <div style={{height:28}}/>}
        <button onClick={onLogout} style={{background:"transparent",color:C.textDim,border:`1px solid ${C.border}`,borderRadius:10,padding:"10px 24px",fontSize:13,cursor:"pointer",fontFamily:font}}>
          로그아웃
        </button>
      </div>
    </div>
  );
}

// ─── 사용자 관리 (슈퍼관리자 전용) ───
function UsersView() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('pending'); // pending | approved

  const fetchUsers = () => {
    supabase.from('teachers').select('*').order('created_at')
      .then(({data})=>{ if(data) setUsers(data); setLoading(false); });
  };
  useEffect(()=>{ fetchUsers(); },[]);

  const approve = async (id, role) => {
    await supabase.from('teachers').update({ status:'approved', role }).eq('id', id);
    fetchUsers();
  };
  const reject = async (id) => {
    if(!confirm('이 계정의 가입을 거절하시겠습니까?')) return;
    await supabase.from('teachers').update({ status:'rejected' }).eq('id', id);
    fetchUsers();
  };
  const updateRole = async (id, role) => {
    await supabase.from('teachers').update({ role }).eq('id', id);
    setUsers(prev=>prev.map(u=>u.id===id?{...u,role}:u));
  };

  const pending  = users.filter(u=>u.status==='pending');
  const approved = users.filter(u=>u.status==='approved');

  return (
    <div style={{padding:28,overflowY:"auto",height:"100%",fontFamily:font}}>
      <h2 style={{margin:"0 0 4px",fontSize:17,fontWeight:800,color:C.text}}>👥 사용자 관리</h2>
      <p style={{margin:"0 0 16px",fontSize:11,color:C.textDim}}>Google 계정으로 가입 신청한 교사를 승인하고 역할을 부여합니다</p>

      {/* 탭 */}
      <div style={{display:"flex",gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:20}}>
        {[['pending',`⏳ 승인 대기 (${pending.length})`],['approved',`✅ 승인된 계정 (${approved.length})`]].map(([id,lbl])=>(
          <button key={id} onClick={()=>setTab(id)} style={{padding:"10px 20px",border:"none",background:"transparent",borderBottom:`2px solid ${tab===id?C.accent:'transparent'}`,color:tab===id?C.accent:C.textMid,fontSize:12,fontWeight:tab===id?700:500,cursor:"pointer",fontFamily:font}}>{lbl}</button>
        ))}
      </div>

      {loading ? <div style={{color:C.textDim,textAlign:"center",padding:40}}>로딩 중...</div> : (
        <div style={{display:"flex",flexDirection:"column",gap:8}}>

          {/* 승인 대기 */}
          {tab==='pending' && (
            pending.length===0
              ? <div style={{color:C.textDim,textAlign:"center",padding:40}}>대기 중인 가입 신청이 없습니다 🎉</div>
              : pending.map(u=>(
                <Card key={u.id} style={{padding:"16px 18px"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:12}}>
                    <div>
                      <div style={{fontSize:14,fontWeight:700,color:C.text}}>{u.name}</div>
                      <div style={{fontSize:11,color:C.textDim,marginTop:3}}>{u.email||'이메일 미등록'}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <select id={`role-${u.id}`} defaultValue="teacher" style={{padding:"6px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,fontFamily:font,outline:"none"}}>
                        <option value="teacher">교사</option>
                        <option value="timetable_admin">시간표관리자</option>
                        <option value="super_admin">슈퍼관리자</option>
                      </select>
                      <button
                        onClick={()=>{
                          const role = document.getElementById(`role-${u.id}`).value;
                          approve(u.id, role);
                        }}
                        style={{padding:"7px 16px",borderRadius:8,border:"none",background:C.green,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer",fontFamily:font}}
                      >승인</button>
                      <button
                        onClick={()=>reject(u.id)}
                        style={{padding:"7px 14px",borderRadius:8,border:`1px solid ${C.red}40`,background:"transparent",color:C.red,fontSize:12,cursor:"pointer",fontFamily:font}}
                      >거절</button>
                    </div>
                  </div>
                </Card>
              ))
          )}

          {/* 승인된 계정 */}
          {tab==='approved' && (
            approved.length===0
              ? <div style={{color:C.textDim,textAlign:"center",padding:40}}>승인된 계정이 없습니다</div>
              : approved.map(u=>(
                <Card key={u.id} style={{padding:"14px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
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
              ))
          )}

        </div>
      )}
    </div>
  );
}

// ─── 학교 설정 ───
// 임시 비활성화 — 정리 작업 1 (Phase 5 + 데이터 입력 UI 와 함께 부활 예정)
// 메뉴에서 제거되어 현재 라우팅 안 됨. 본격 구현 시 메뉴 + 라우팅 부활.
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
  // 시간표 편집 진입 시 대상 ID (Phase 4C-1, 사이드바 메뉴 아닌 목록 페이지의 편집 버튼으로 진입)
  const [editTimetableId, setEditTimetableId] = useState(null);
  // 시간표 이력 진입 시 대상 ID (Phase 4C-3, 목록 페이지의 "📜 이력" 버튼으로 진입)
  const [historyTimetableId, setHistoryTimetableId] = useState(null);
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

  // 승인 대기 중이면 대기 화면 표시
  if(teacher.status === 'pending' || teacher.status === 'rejected') {
    return <PendingView onLogout={onLogout} status={teacher.status}/>;
  }

  const canAccess = (pageId) => {
    // 정리 작업 1: settings 는 메뉴에서 제거되어 현재 라우팅 안 됨 (Phase 5 와 함께 부활 예정)
    if(pageId === 'users') return teacher.role==='super_admin';
    return true; // 시간표 탭은 모두 접근 가능 (내부에서 권한 분기)
  };

  const renderContent = () => {
    if(!canAccess(page)) return <NoAccessView/>;
    switch(page){
      case "dashboard": return <DashboardPage teacher={teacher} onNavigate={setPage}/>;
      case "schedule":  return <SchedulePage teacher={teacher}/>;
      case "documents": return <DocumentsPage teacher={teacher}/>;
      case "chat":      return <ChatView teacher={teacher}/>;
      case "tasks":     return <TasksView teacher={teacher}/>;
      case "docs":      return <DocWriterView teacher={teacher}/>;
      case "mytasks":   return <MyScheduleView teacher={teacher}/>;
      case "handover":  return <HandoverView/>;
      case "record":    return <RecordView/>;
      // 정리 2-C: case "timetable" (TimetablePage 솔버 페이지) 폐지.
      //   기존 북마크/링크는 default 로 fallback 됨 (대시보드).
      case "timetable_v2":    return <TimetableViewer currentUser={teacher}/>;
      case "timetables_list": return <TimetablesListPage currentUser={teacher}
        onEditDraft={(id) => { setEditTimetableId(id); setPage("timetable_edit"); }}
        onShowHistory={(id) => { setHistoryTimetableId(id); setPage("timetable_history"); }}
      />;
      case "timetable_edit":  return <TimetableEditPage timetableId={editTimetableId} currentUser={teacher} onDone={() => { setEditTimetableId(null); setPage("timetables_list"); }}/>;
      case "timetable_history": return <TimetableHistoryPage timetableId={historyTimetableId} onDone={() => { setHistoryTimetableId(null); setPage("timetables_list"); }}/>;
      case "school_calendar": return <SchoolCalendarPage currentUser={teacher}/>;
      case "users":     return <UsersView/>;
      // 정리 작업 1: case "settings" 임시 비활성화 — 메뉴/라우팅 모두 제거, default 로 fallback
      default:          return <DashboardPage teacher={teacher} onNavigate={setPage}/>;
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
