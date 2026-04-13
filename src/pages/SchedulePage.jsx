import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

// ─── 스타일 ───
const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171',
  purple:'#a78bfa', orange:'#fb923c', pink:'#f472b6', teal:'#2dd4bf',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

const CATEGORIES = [
  { id:'수업',  color:'#4f8cff', icon:'📚' },
  { id:'행사',  color:'#fb923c', icon:'🎉' },
  { id:'연수',  color:'#a78bfa', icon:'📖' },
  { id:'회의',  color:'#2dd4bf', icon:'💬' },
  { id:'평가',  color:'#f87171', icon:'📝' },
  { id:'행정',  color:'#8b95ad', icon:'📋' },
  { id:'기타',  color:'#fbbf24', icon:'📌' },
];

const getCat = (id) => CATEGORIES.find(c=>c.id===id) || CATEGORIES[6];

const DAYS_KO = ['일','월','화','수','목','금','토'];
const MONTHS_KO = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

function Badge({ label, color, small }) {
  return <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:small?'1px 7px':'3px 10px', borderRadius:20, fontSize:small?10:11, fontWeight:600, background:color+'18', color, border:`1px solid ${color}25` }}>{label}</span>;
}

// ─── 일정 추가/수정 모달 ───
function EventModal({ event, teacher, onSave, onClose, onDelete }) {
  const [form, setForm] = useState({
    title: event?.title || '',
    description: event?.description || '',
    start_date: event?.start_date || new Date().toISOString().slice(0,10),
    end_date: event?.end_date || '',
    start_time: event?.start_time || '',
    end_time: event?.end_time || '',
    category: event?.category || '행사',
    scope: event?.scope || 'all',
    is_allday: event?.is_allday ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const update = (k, v) => setForm(f=>({...f, [k]:v}));

  const handleSave = async () => {
    if(!form.title.trim()) { setError('제목을 입력해주세요'); return; }
    if(!form.start_date)   { setError('시작일을 선택해주세요'); return; }
    setSaving(true); setError('');
    await onSave({ ...form, end_date: form.end_date || form.start_date });
    setSaving(false);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:'100%', maxWidth:480, maxHeight:'90vh', overflowY:'auto', fontFamily:font }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text }}>{event?'일정 수정':'새 일정 추가'}</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textDim, fontSize:18, cursor:'pointer' }}>✕</button>
        </div>

        {error && <div style={{ padding:'8px 12px', background:C.red+'15', border:`1px solid ${C.red}30`, borderRadius:8, color:C.red, fontSize:12, marginBottom:12 }}>{error}</div>}

        {/* 제목 */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>제목 *</label>
          <input value={form.title} onChange={e=>update('title',e.target.value)} placeholder="일정 제목" style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:13, fontFamily:font, outline:'none', boxSizing:'border-box' }} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
        </div>

        {/* 카테고리 */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>카테고리</label>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {CATEGORIES.map(cat=>(
              <button key={cat.id} onClick={()=>update('category',cat.id)} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${form.category===cat.id?cat.color:C.border}`, background:form.category===cat.id?cat.color+'18':'transparent', color:form.category===cat.id?cat.color:C.textMid, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:font }}>
                {cat.icon} {cat.id}
              </button>
            ))}
          </div>
        </div>

        {/* 날짜 */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>시작일 *</label>
            <input type="date" value={form.start_date} onChange={e=>update('start_date',e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', boxSizing:'border-box' }}/>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>종료일</label>
            <input type="date" value={form.end_date} onChange={e=>update('end_date',e.target.value)} min={form.start_date} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', boxSizing:'border-box' }}/>
          </div>
        </div>

        {/* 종일 여부 */}
        <div style={{ marginBottom:14, display:'flex', alignItems:'center', gap:8 }}>
          <input type="checkbox" id="allday" checked={form.is_allday} onChange={e=>update('is_allday',e.target.checked)} style={{ accentColor:C.accent }}/>
          <label htmlFor="allday" style={{ fontSize:12, color:C.textMid, cursor:'pointer' }}>종일</label>
        </div>

        {/* 시간 (종일 아닐 때) */}
        {!form.is_allday && (
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>시작 시간</label>
              <input type="time" value={form.start_time} onChange={e=>update('start_time',e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', boxSizing:'border-box' }}/>
            </div>
            <div>
              <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>종료 시간</label>
              <input type="time" value={form.end_time} onChange={e=>update('end_time',e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', boxSizing:'border-box' }}/>
            </div>
          </div>
        )}

        {/* 공개 범위 */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>공개 범위</label>
          <div style={{ display:'flex', gap:6 }}>
            {[['all','🏫 전체 공유'],['personal','🔒 나만 보기']].map(([val,lbl])=>(
              <button key={val} onClick={()=>update('scope',val)} style={{ flex:1, padding:'8px', borderRadius:8, border:`1px solid ${form.scope===val?C.accent:C.border}`, background:form.scope===val?C.accentSoft:'transparent', color:form.scope===val?C.accent:C.textMid, fontSize:12, cursor:'pointer', fontFamily:font, fontWeight:form.scope===val?700:400 }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* 설명 */}
        <div style={{ marginBottom:20 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>설명 (선택)</label>
          <textarea value={form.description} onChange={e=>update('description',e.target.value)} placeholder="일정에 대한 상세 내용" rows={3} style={{ width:'100%', padding:'10px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', resize:'vertical', boxSizing:'border-box' }}/>
        </div>

        {/* 버튼 */}
        <div style={{ display:'flex', gap:8 }}>
          {event && (
            <button onClick={()=>onDelete(event.id)} style={{ padding:'10px 16px', borderRadius:10, border:`1px solid ${C.red}40`, background:'transparent', color:C.red, fontSize:12, cursor:'pointer', fontFamily:font }}>삭제</button>
          )}
          <button onClick={onClose} style={{ flex:1, padding:'10px', borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textMid, fontSize:13, cursor:'pointer', fontFamily:font }}>취소</button>
          <button onClick={handleSave} disabled={saving} style={{ flex:2, padding:'10px', borderRadius:10, border:'none', background:saving?C.textDim:C.accent, color:'#fff', fontSize:13, fontWeight:700, cursor:saving?'not-allowed':'pointer', fontFamily:font }}>
            {saving?'저장 중...':'저장'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 월간 달력 ───
function MonthCalendar({ year, month, events, onDayClick, onEventClick }) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const today = new Date();

  const getEventsForDay = (day) => {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
    return events.filter(e => {
      const start = e.start_date;
      const end   = e.end_date || e.start_date;
      return dateStr >= start && dateStr <= end;
    });
  };

  const weeks = [];
  let cells = Array(firstDay).fill(null);
  for(let d=1; d<=daysInMonth; d++) cells.push(d);
  while(cells.length % 7 !== 0) cells.push(null);
  for(let i=0; i<cells.length; i+=7) weeks.push(cells.slice(i,i+7));

  return (
    <div style={{ flex:1 }}>
      {/* 요일 헤더 */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', marginBottom:2 }}>
        {DAYS_KO.map((d,i)=>(
          <div key={d} style={{ textAlign:'center', padding:'8px 0', fontSize:11, fontWeight:600, color:i===0?C.red:i===6?'#4f8cff':C.textMid }}>{d}</div>
        ))}
      </div>

      {/* 날짜 그리드 */}
      {weeks.map((week,wi)=>(
        <div key={wi} style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:2, marginBottom:2 }}>
          {week.map((day,di)=>{
            if(!day) return <div key={di} style={{ minHeight:90, background:'transparent' }}/>;
            const isToday = day===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
            const dayEvents = getEventsForDay(day);
            const isSun = di===0, isSat = di===6;
            return (
              <div key={di} onClick={()=>onDayClick(day)} style={{ minHeight:90, background:C.card, border:`1px solid ${C.border}`, borderRadius:8, padding:'6px', cursor:'pointer', transition:'border-color .15s' }}
                onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderLight}
                onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
              >
                <div style={{ width:24, height:24, borderRadius:'50%', background:isToday?C.accent:'transparent', display:'flex', alignItems:'center', justifyContent:'center', marginBottom:4 }}>
                  <span style={{ fontSize:12, fontWeight:isToday?700:500, color:isToday?'#fff':isSun?C.red:isSat?'#4f8cff':C.textMid }}>{day}</span>
                </div>
                <div style={{ display:'flex', flexDirection:'column', gap:2 }}>
                  {dayEvents.slice(0,3).map((ev,i)=>{
                    const cat = getCat(ev.category);
                    return (
                      <div key={i} onClick={e=>{e.stopPropagation();onEventClick(ev);}} style={{ padding:'1px 5px', borderRadius:4, background:cat.color+'25', color:cat.color, fontSize:10, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis', cursor:'pointer' }}>
                        {ev.title}
                      </div>
                    );
                  })}
                  {dayEvents.length>3&&<div style={{ fontSize:9, color:C.textDim, paddingLeft:4 }}>+{dayEvents.length-3}개</div>}
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ─── 주간 뷰 ───
function WeekView({ year, month, weekStart, events, onEventClick }) {
  const days = Array.from({length:7},(_,i)=>{
    const d = new Date(weekStart);
    d.setDate(d.getDate()+i);
    return d;
  });
  const today = new Date();

  return (
    <div style={{ flex:1, overflowX:'auto' }}>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:6 }}>
        {days.map((d,i)=>{
          const dateStr = d.toISOString().slice(0,10);
          const dayEvents = events.filter(e=>{
            const start=e.start_date, end=e.end_date||e.start_date;
            return dateStr>=start&&dateStr<=end;
          });
          const isToday = d.toDateString()===today.toDateString();
          return (
            <div key={i} style={{ minHeight:200 }}>
              <div style={{ textAlign:'center', padding:'8px 4px', marginBottom:6 }}>
                <div style={{ fontSize:10, color:i===0?C.red:i===6?'#4f8cff':C.textMid, marginBottom:3 }}>{DAYS_KO[d.getDay()]}</div>
                <div style={{ width:28, height:28, borderRadius:'50%', background:isToday?C.accent:'transparent', display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
                  <span style={{ fontSize:13, fontWeight:700, color:isToday?'#fff':C.text }}>{d.getDate()}</span>
                </div>
              </div>
              <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                {dayEvents.map((ev,j)=>{
                  const cat=getCat(ev.category);
                  return (
                    <div key={j} onClick={()=>onEventClick(ev)} style={{ padding:'6px 8px', borderRadius:6, background:cat.color+'20', border:`1px solid ${cat.color}30`, cursor:'pointer', transition:'all .15s' }}
                      onMouseEnter={e=>{e.currentTarget.style.background=cat.color+'35';}}
                      onMouseLeave={e=>{e.currentTarget.style.background=cat.color+'20';}}>
                      <div style={{ fontSize:11, fontWeight:700, color:cat.color }}>{cat.icon} {ev.title}</div>
                      {!ev.is_allday&&ev.start_time&&<div style={{ fontSize:10, color:C.textDim, marginTop:2 }}>{ev.start_time.slice(0,5)}{ev.end_time?` ~ ${ev.end_time.slice(0,5)}`:''}</div>}
                      <div style={{ fontSize:10, color:C.textDim, marginTop:1 }}>{ev.created_by_name}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 목록 뷰 ───
function ListView({ events, onEventClick }) {
  const sorted = [...events].sort((a,b)=>a.start_date.localeCompare(b.start_date));
  const grouped = {};
  sorted.forEach(e=>{
    const m = e.start_date.slice(0,7);
    if(!grouped[m]) grouped[m]=[];
    grouped[m].push(e);
  });

  return (
    <div style={{ flex:1, overflowY:'auto' }}>
      {Object.entries(grouped).map(([month,evs])=>(
        <div key={month} style={{ marginBottom:20 }}>
          <div style={{ fontSize:13, fontWeight:700, color:C.accent, marginBottom:10, paddingBottom:6, borderBottom:`1px solid ${C.border}` }}>
            {month.slice(0,4)}년 {parseInt(month.slice(5))}월
          </div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {evs.map(ev=>{
              const cat=getCat(ev.category);
              const isMulti = ev.end_date && ev.end_date !== ev.start_date;
              return (
                <div key={ev.id} onClick={()=>onEventClick(ev)} style={{ display:'flex', alignItems:'center', gap:12, padding:'12px 14px', background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${cat.color}`, borderRadius:8, cursor:'pointer', transition:'all .15s' }}
                  onMouseEnter={e=>e.currentTarget.style.borderColor=C.borderLight}
                  onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
                  <div style={{ textAlign:'center', minWidth:36 }}>
                    <div style={{ fontSize:18, fontWeight:800, color:C.text }}>{parseInt(ev.start_date.slice(8))}</div>
                    <div style={{ fontSize:9, color:C.textDim }}>{DAYS_KO[new Date(ev.start_date).getDay()]}요일</div>
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.text }}>{ev.title}</div>
                    <div style={{ display:'flex', gap:6, marginTop:4, flexWrap:'wrap' }}>
                      <Badge label={`${cat.icon} ${cat.id}`} color={cat.color} small/>
                      {isMulti&&<Badge label={`~${ev.end_date.slice(5).replace('-','/')}`} color={C.textMid} small/>}
                      {ev.scope==='personal'&&<Badge label="🔒 나만 보기" color={C.textDim} small/>}
                    </div>
                    {ev.description&&<div style={{ fontSize:11, color:C.textDim, marginTop:4 }}>{ev.description}</div>}
                  </div>
                  <div style={{ fontSize:11, color:C.textDim, whiteSpace:'nowrap' }}>{ev.created_by_name}</div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {events.length===0&&(
        <div style={{ textAlign:'center', padding:60, color:C.textDim, fontSize:13 }}>
          <div style={{ fontSize:36, marginBottom:12 }}>📅</div>
          등록된 일정이 없습니다
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════
export default function SchedulePage({ teacher }) {
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [viewMode, setViewMode] = useState('month'); // month | week | list
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [modal, setModal]       = useState(null); // null | 'new' | event객체
  const [filterCat, setFilterCat] = useState('전체');
  const [weekStart, setWeekStart] = useState(()=>{
    const d = new Date();
    d.setDate(d.getDate()-d.getDay());
    return d;
  });

  // 일정 불러오기
  const fetchEvents = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('start_date');
    if(data) setEvents(data);
    setLoading(false);
  };
  useEffect(()=>{ fetchEvents(); },[]);

  // 일정 저장
  const handleSave = async (form) => {
    const payload = {
      ...form,
      created_by: teacher?.id || null,
      created_by_name: teacher?.name || '익명',
    };
    if(modal && modal !== 'new') {
      await supabase.from('events').update(payload).eq('id', modal.id);
    } else {
      await supabase.from('events').insert([payload]);
    }
    await fetchEvents();
    setModal(null);
  };

  // 일정 삭제
  const handleDelete = async (id) => {
    if(!confirm('이 일정을 삭제하시겠습니까?')) return;
    await supabase.from('events').delete().eq('id', id);
    await fetchEvents();
    setModal(null);
  };

  // 필터된 이벤트
  const filtered = events.filter(e => filterCat==='전체' || e.category===filterCat);

  // 이번 달 이벤트
  const monthStr = `${year}-${String(month+1).padStart(2,'0')}`;
  const monthEvents = filtered.filter(e => {
    const start = e.start_date.slice(0,7);
    const end   = (e.end_date||e.start_date).slice(0,7);
    return start<=monthStr && end>=monthStr;
  });

  const prevMonth = () => { if(month===0){setYear(y=>y-1);setMonth(11);}else setMonth(m=>m-1); };
  const nextMonth = () => { if(month===11){setYear(y=>y+1);setMonth(0);}else setMonth(m=>m+1); };

  const prevWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()-7); setWeekStart(d); };
  const nextWeek = () => { const d=new Date(weekStart); d.setDate(d.getDate()+7); setWeekStart(d); };

  // 이번 달 다가오는 일정 (사이드바용)
  const upcoming = filtered
    .filter(e=>e.start_date>=today.toISOString().slice(0,10))
    .slice(0,5);

  return (
    <div style={{ display:'flex', height:'100%', fontFamily:font, color:C.text, overflow:'hidden' }}>

      {/* ─── 사이드바 ─── */}
      <div style={{ width:220, minWidth:220, background:'#080b14', borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', padding:16, gap:14, overflowY:'auto' }}>

        {/* 일정 추가 버튼 */}
        <button onClick={()=>setModal('new')} style={{ width:'100%', padding:'10px', borderRadius:10, border:'none', background:C.accent, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:font }}>
          + 일정 추가
        </button>

        {/* 미니 캘린더 네비 */}
        <div style={{ background:C.card, borderRadius:10, padding:'12px', border:`1px solid ${C.border}` }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <button onClick={prevMonth} style={{ background:'none', border:'none', color:C.textMid, cursor:'pointer', fontSize:14 }}>‹</button>
            <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{year}.{String(month+1).padStart(2,'0')}</span>
            <button onClick={nextMonth} style={{ background:'none', border:'none', color:C.textMid, cursor:'pointer', fontSize:14 }}>›</button>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:1 }}>
            {DAYS_KO.map((d,i)=><div key={d} style={{ textAlign:'center', fontSize:9, color:i===0?C.red:i===6?'#4f8cff':C.textDim, padding:'2px 0' }}>{d}</div>)}
            {Array(new Date(year,month,1).getDay()).fill(null).map((_,i)=><div key={i}/>)}
            {Array.from({length:new Date(year,month+1,0).getDate()},(_,i)=>i+1).map(d=>{
              const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
              const hasEv=filtered.some(e=>ds>=(e.start_date)&&ds<=(e.end_date||e.start_date));
              const isToday=d===today.getDate()&&month===today.getMonth()&&year===today.getFullYear();
              return (
                <div key={d} onClick={()=>{setViewMode('month');}} style={{ textAlign:'center', padding:'2px 0', borderRadius:4, background:isToday?C.accent:'transparent', position:'relative', cursor:'pointer' }}>
                  <span style={{ fontSize:10, color:isToday?'#fff':C.textMid }}>{d}</span>
                  {hasEv&&!isToday&&<div style={{ width:3, height:3, borderRadius:'50%', background:C.accent, margin:'1px auto 0' }}/>}
                </div>
              );
            })}
          </div>
        </div>

        {/* 카테고리 필터 */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:C.textDim, marginBottom:8 }}>카테고리</div>
          <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
            <button onClick={()=>setFilterCat('전체')} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:6, border:'none', background:filterCat==='전체'?C.accentSoft:'transparent', color:filterCat==='전체'?C.accent:C.textMid, fontSize:12, cursor:'pointer', fontFamily:font, textAlign:'left' }}>
              <div style={{ width:8, height:8, borderRadius:'50%', background:C.accent }}/> 전체 ({events.length})
            </button>
            {CATEGORIES.map(cat=>{
              const cnt=events.filter(e=>e.category===cat.id).length;
              return (
                <button key={cat.id} onClick={()=>setFilterCat(cat.id)} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 8px', borderRadius:6, border:'none', background:filterCat===cat.id?cat.color+'18':'transparent', color:filterCat===cat.id?cat.color:C.textMid, fontSize:12, cursor:'pointer', fontFamily:font, textAlign:'left' }}>
                  <div style={{ width:8, height:8, borderRadius:'50%', background:cat.color }}/> {cat.icon} {cat.id} ({cnt})
                </button>
              );
            })}
          </div>
        </div>

        {/* 다가오는 일정 */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:C.textDim, marginBottom:8 }}>다가오는 일정</div>
          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {upcoming.length===0
              ? <div style={{ fontSize:11, color:C.textDim }}>없음</div>
              : upcoming.map(ev=>{
                const cat=getCat(ev.category);
                return (
                  <div key={ev.id} onClick={()=>setModal(ev)} style={{ padding:'8px 10px', borderRadius:8, background:C.card, border:`1px solid ${C.border}`, borderLeft:`3px solid ${cat.color}`, cursor:'pointer' }}>
                    <div style={{ fontSize:11, fontWeight:600, color:C.text, marginBottom:2 }}>{ev.title}</div>
                    <div style={{ fontSize:10, color:C.textDim }}>{ev.start_date.slice(5).replace('-','/')}</div>
                  </div>
                );
              })
            }
          </div>
        </div>
      </div>

      {/* ─── 메인 영역 ─── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>

        {/* 헤더 */}
        <div style={{ padding:'12px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'space-between', flexWrap:'wrap', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ display:'flex', gap:4 }}>
              <button onClick={viewMode==='week'?prevWeek:prevMonth} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:'5px 10px', color:C.textMid, cursor:'pointer', fontSize:13 }}>‹</button>
              <button onClick={viewMode==='week'?nextWeek:nextMonth} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:6, padding:'5px 10px', color:C.textMid, cursor:'pointer', fontSize:13 }}>›</button>
            </div>
            <h2 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text }}>
              {viewMode==='week'
                ? `${weekStart.getMonth()+1}월 ${Math.ceil(weekStart.getDate()/7)}주`
                : `${year}년 ${MONTHS_KO[month]}`
              }
            </h2>
            <button onClick={()=>{setYear(today.getFullYear());setMonth(today.getMonth());}} style={{ padding:'4px 10px', borderRadius:6, border:`1px solid ${C.border}`, background:'transparent', color:C.textMid, fontSize:11, cursor:'pointer', fontFamily:font }}>오늘</button>
          </div>
          <div style={{ display:'flex', border:`1px solid ${C.border}`, borderRadius:8, overflow:'hidden' }}>
            {[['month','월간'],['week','주간'],['list','목록']].map(([v,lbl])=>(
              <button key={v} onClick={()=>setViewMode(v)} style={{ padding:'6px 14px', border:'none', background:viewMode===v?C.accent:'transparent', color:viewMode===v?'#fff':C.textMid, fontSize:12, fontWeight:viewMode===v?700:500, cursor:'pointer', fontFamily:font }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* 달력/목록 영역 */}
        <div style={{ flex:1, overflow:'auto', padding:16, display:'flex', flexDirection:'column' }}>
          {loading ? (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', flex:1, color:C.textDim }}>로딩 중...</div>
          ) : viewMode==='month' ? (
            <MonthCalendar year={year} month={month} events={monthEvents} onDayClick={()=>{}} onEventClick={ev=>setModal(ev)}/>
          ) : viewMode==='week' ? (
            <WeekView year={year} month={month} weekStart={weekStart} events={filtered} onEventClick={ev=>setModal(ev)}/>
          ) : (
            <ListView events={filtered} onEventClick={ev=>setModal(ev)}/>
          )}
        </div>
      </div>

      {/* ─── 모달 ─── */}
      {modal && (
        <EventModal
          event={modal==='new'?null:modal}
          teacher={teacher}
          onSave={handleSave}
          onClose={()=>setModal(null)}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
