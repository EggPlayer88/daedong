import { useState, useCallback } from 'react';
import {
  DAYS, DP, DAILY, CLR, SBJ, CLS, TCH,
  gS, gC, gT, getHR, isV, getSP, TIMES
} from '../lib/timetableData';
import {
  buildLessons, cpSolve, buildTTfromCP,
  calcTotalPenalty, localSearch
} from '../lib/solver';

// ─── 스타일 상수 ───
const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

function Badge({ label, color, small }) {
  return <span style={{ display:'inline-block', padding:small?'1px 7px':'3px 10px', borderRadius:6, fontSize:small?10:11, fontWeight:600, background:color+'15', color, border:`1px solid ${color}25` }}>{label}</span>;
}
function Card({ children, style, onClick }) {
  const [h, setH] = useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)} style={{ background:h&&onClick?C.cardHover:C.card, border:`1px solid ${h&&onClick?C.borderLight:C.border}`, borderRadius:12, transition:'all .2s', cursor:onClick?'pointer':'default', ...style }}>{children}</div>;
}
function TabBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding:'10px 18px', border:'none', background:'transparent', borderBottom:`2px solid ${active?C.accent:'transparent'}`, color:active?C.accent:C.textMid, fontSize:12, fontWeight:active?700:500, cursor:'pointer', fontFamily:font, whiteSpace:'nowrap' }}>{children}</button>;
}
function SegBtn({ active, onClick, children }) {
  return <button onClick={onClick} style={{ padding:'7px 16px', border:'none', background:active?C.accent:'transparent', color:active?'#fff':C.textMid, fontSize:12, fontWeight:active?700:500, cursor:'pointer', fontFamily:font }}>{children}</button>;
}

// ══════════════════════════════════════════════════════
//  시간표 그리드 컴포넌트
// ══════════════════════════════════════════════════════
function TTGrid({ tt, viewMode, entityId, onCellClick }) {
  if(!tt) return <div style={{color:C.textDim,textAlign:'center',padding:48,fontSize:13}}>시간표가 없습니다. 관리자가 생성하면 표시됩니다.</div>;

  const rows = [];
  for(let p=1; p<=7; p++){
    const cells = DAYS.map((d) => {
      if(!isV(d,p)) return <td key={d} style={{background:'#080b14',opacity:.25,border:`1px solid ${C.border}`,height:52,minWidth:72}}/>;
      const sl=`${d}-${p}`, sp=getSP(d,p);
      let entry=null, eid=entityId;
      if(viewMode==='class') entry=tt[entityId]?.[sl];
      else CLS.forEach(c=>{ const x=tt[c.id]?.[sl]; if(x&&x.tid===entityId){entry=x;eid=c.id;} });

      if(sp&&entry?.type==='special'){
        const lbl=viewMode==='class'?gT(entry.tid)?.name:gC(eid)?.name;
        return <td key={d} style={{border:`1px solid ${C.border}`,background:'#1a1530',textAlign:'center',height:52,minWidth:72}}>
          <div style={{fontSize:10,color:'#a78bfa',fontWeight:700}}>창체</div>
          <div style={{fontSize:9,color:'#7c6fcc'}}>{lbl}</div>
        </td>;
      }
      if(sp&&!entry) return <td key={d} style={{border:`1px solid ${C.border}`,background:'#1a1530',textAlign:'center',height:52,minWidth:72,opacity:.4}}><div style={{fontSize:9,color:'#7c6fcc'}}>창체</div></td>;

      if(entry&&!entry.type){
        const s=gS(entry.sid), clr=CLR[s?.ci||0];
        const lbl=viewMode==='class'?gT(entry.tid)?.name:gC(eid)?.name;
        const hl={t3:'#2a1f00',ti:'#001a10',t22:'#0d1a00'}[entry.tid];
        return <td key={d} onClick={()=>onCellClick&&onCellClick(sl,eid,entry)}
          style={{border:`1px solid ${C.border}`,height:52,minWidth:72,background:hl||clr.bg+'22',cursor:onCellClick?'pointer':'default',borderLeft:`3px solid ${clr.bg}`,transition:'filter .1s'}}
          onMouseEnter={e=>{if(onCellClick)e.currentTarget.style.filter='brightness(1.3)'}}
          onMouseLeave={e=>e.currentTarget.style.filter=''}>
          <div style={{textAlign:'center',padding:'3px 2px'}}>
            <div style={{fontSize:11,fontWeight:700,color:clr.bg}}>{s?.name}</div>
            <div style={{fontSize:10,color:clr.bg,opacity:.8}}>{lbl}</div>
          </div>
        </td>;
      }
      return <td key={d} style={{border:`1px solid ${C.border}`,height:52,minWidth:72,background:'#1a0000',textAlign:'center'}}><span style={{fontSize:9,color:C.red}}>빈칸</span></td>;
    });
    if(p===5) rows.push(<tr key="div"><td colSpan={6} style={{height:2,background:C.border,padding:0}}/></tr>);
    rows.push(
      <tr key={p}>
        <td style={{padding:'4px 8px',background:'#0d1020',border:`1px solid ${C.border}`,textAlign:'center',minWidth:52,whiteSpace:'nowrap'}}>
          <div style={{fontSize:11,fontWeight:600,color:C.textMid}}>{p}교시</div>
          <div style={{fontSize:9,color:C.textDim}}>{TIMES[p-1]}</div>
        </td>
        {cells}
      </tr>
    );
  }

  return (
    <div style={{overflowX:'auto'}}>
      <table style={{borderCollapse:'collapse',width:'100%',minWidth:480,fontFamily:font}}>
        <thead>
          <tr>
            <th style={{padding:'8px',background:'#0d1020',border:`1px solid ${C.border}`,fontSize:11,color:C.textDim}}>교시</th>
            {DAYS.map(d=><th key={d} style={{padding:'8px',background:'#0d1020',border:`1px solid ${C.border}`,fontSize:11,color:C.textMid,minWidth:72}}>{d}요일<br/><span style={{fontSize:9,opacity:.6}}>{DP[d]}교시</span></th>)}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 1: 시간표 보기 (전체 공개)
// ══════════════════════════════════════════════════════
function ViewTab({ tt, onRequestChange }) {
  const [viewMode, setViewMode] = useState('class');
  const [entityId, setEntityId] = useState('c1');

  const handleCell = (sl, eid, entry) => {
    if(onRequestChange) onRequestChange(sl, eid, entry);
  };

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap',alignItems:'center'}}>
        <div style={{display:'flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
          <SegBtn active={viewMode==='class'} onClick={()=>{setViewMode('class');setEntityId('c1');}}>학급별</SegBtn>
          <SegBtn active={viewMode==='teacher'} onClick={()=>{setViewMode('teacher');setEntityId('t1');}}>교사별</SegBtn>
        </div>
        <select value={entityId} onChange={e=>setEntityId(e.target.value)} style={{padding:'7px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,fontFamily:font,outline:'none'}}>
          {viewMode==='class'
            ? CLS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)
            : TCH.map(t=><option key={t.id} value={t.id}>{t.name}</option>)
          }
        </select>
        {tt && <span style={{fontSize:11,color:C.textDim,marginLeft:4}}>셀 클릭 → 교체 요청</span>}
      </div>
      <TTGrid tt={tt} viewMode={viewMode} entityId={entityId} onCellClick={handleCell}/>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 2: 교체 요청 (전체 공개)
// ══════════════════════════════════════════════════════
function ChangeRequestTab({ tt, teacher, requests, onSubmitRequest }) {
  const [selected, setSelected] = useState(null); // {sl, cid, entry}
  const [reason, setReason] = useState('');
  const [submitted, setSubmitted] = useState(false);

  // 시간표에서 클릭해서 넘어올 때
  const handleSelectFromTT = (sl, cid, entry) => {
    setSelected({sl, cid, entry});
    setSubmitted(false);
    setReason('');
  };

  const submit = () => {
    if(!selected) return;
    const [d,p] = selected.sl.split('-');
    const s = gS(selected.entry.sid);
    const t = gT(selected.entry.tid);
    const c = gC(selected.cid);
    onSubmitRequest({
      id: Date.now(),
      slot: selected.sl,
      cid: selected.cid,
      tid: selected.entry.tid,
      sid: selected.entry.sid,
      requester: teacher.name,
      reason: reason || '사유 없음',
      status: 'pending',
      createdAt: new Date().toLocaleString('ko-KR'),
      label: `${c?.name} ${d}요일 ${p}교시 ${s?.name} (${t?.name})`,
    });
    setSubmitted(true);
    setReason('');
    setSelected(null);
  };

  const myRequests = requests.filter(r => r.requester === teacher.name);

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
        {/* 왼쪽: 요청 폼 */}
        <div>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>📌 교체 요청 접수</div>

          {/* 시간표에서 선택 */}
          <Card style={{padding:16,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:8}}>교체할 수업 선택</div>
            {selected ? (
              <div style={{padding:'10px 14px',background:C.accent+'18',borderRadius:8,border:`1px solid ${C.accent}30`}}>
                <div style={{fontSize:13,fontWeight:700,color:C.accent}}>{selected.sl.replace('-','요일 ')}교시</div>
                <div style={{fontSize:12,color:C.textMid,marginTop:3}}>
                  {gC(selected.cid)?.name} · {gS(selected.entry.sid)?.name} · {gT(selected.entry.tid)?.name}
                </div>
                <button onClick={()=>setSelected(null)} style={{marginTop:8,background:'transparent',border:'none',color:C.textDim,fontSize:11,cursor:'pointer',padding:0}}>✕ 취소</button>
              </div>
            ) : (
              <div style={{padding:'14px',background:C.bg,borderRadius:8,textAlign:'center',color:C.textDim,fontSize:12}}>
                아래 시간표에서 교체할 수업 칸을 클릭해주세요
              </div>
            )}
          </Card>

          <Card style={{padding:16,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:C.textMid,marginBottom:8}}>교체 사유</div>
            <textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="예: 출장, 연수, 개인 사정 등" rows={3} style={{width:'100%',padding:'10px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.bg,color:C.text,fontSize:12,fontFamily:font,outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
          </Card>

          {submitted && <div style={{padding:'10px 14px',background:C.green+'15',border:`1px solid ${C.green}30`,borderRadius:8,marginBottom:12,fontSize:12,color:C.green}}>✅ 교체 요청이 접수되었습니다. 관리자 검토 후 승인됩니다.</div>}

          <button onClick={submit} disabled={!selected} style={{width:'100%',padding:'12px',borderRadius:10,border:'none',background:selected?C.accent:'#2a2f45',color:selected?'#fff':C.textDim,fontSize:13,fontWeight:700,cursor:selected?'pointer':'not-allowed',fontFamily:font}}>
            📨 교체 요청 제출
          </button>
        </div>

        {/* 오른쪽: 내 요청 현황 */}
        <div>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>📋 내 요청 현황</div>
          {myRequests.length===0
            ? <Card style={{padding:40,textAlign:'center'}}><div style={{color:C.textDim,fontSize:12}}>접수된 요청이 없습니다</div></Card>
            : myRequests.map(r=>(
              <Card key={r.id} style={{padding:'14px 16px',marginBottom:8}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.text}}>{r.label}</div>
                  <Badge label={r.status==='pending'?'검토중':r.status==='approved'?'승인':r.status==='rejected'?'반려':'처리됨'} color={r.status==='pending'?C.yellow:r.status==='approved'?C.green:C.red} small/>
                </div>
                <div style={{fontSize:11,color:C.textDim}}>사유: {r.reason}</div>
                <div style={{fontSize:10,color:C.textDim,marginTop:3}}>요청일: {r.createdAt}</div>
              </Card>
            ))
          }
        </div>
      </div>

      {/* 미니 시간표 (클릭용) */}
      <div style={{marginTop:20}}>
        <div style={{fontSize:12,fontWeight:600,color:C.textMid,marginBottom:10}}>시간표에서 교체할 수업을 클릭하세요</div>
        <div style={{display:'flex',gap:8,marginBottom:10,flexWrap:'wrap'}}>
          <select onChange={e=>{}} style={{padding:'6px 10px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,fontFamily:font,outline:'none'}}>
            {CLS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <TTGrid tt={tt} viewMode="class" entityId="c1" onCellClick={(sl,cid,entry)=>handleSelectFromTT(sl,cid,entry)}/>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 3: 시간표 생성 (관리자 전용)
// ══════════════════════════════════════════════════════
function GenerateTab({ onGenerated }) {
  const [phase, setPhase] = useState('idle');
  const [attempt, setAttempt] = useState(0);
  const [logs, setLogs] = useState([]);
  const [result, setResult] = useState(null);

  const addLog = useCallback((msg)=>{ setLogs(prev=>[...prev.slice(-24),msg]); },[]);

  const startGenerate = async () => {
    setPhase('running'); setLogs([]); setAttempt(0); setResult(null);
    const lessons = buildLessons();
    addLog(`수업 카드 ${lessons.length}장 생성`);
    addLog('CP-SAT 백트래킹 시작...');
    await new Promise(r=>setTimeout(r,30));

    let found=false;
    for(let a=1; a<=50&&!found; a++){
      setAttempt(a);
      await new Promise(r=>setTimeout(r,0));
      const res = cpSolve(lessons, 120000);
      if(res.success){
        const penBefore = calcTotalPenalty(lessons, res.asgn);
        addLog(`✅ ${a}번째 시도 성공! (${res.nodes.toLocaleString()} 노드) | 초기 페널티 ${penBefore}`);
        addLog('🔧 로컬 서치 최적화 중...');
        await new Promise(r=>setTimeout(r,0));
        const ls = localSearch(lessons, res.asgn, 4000);
        const penFinal = calcTotalPenalty(lessons, res.asgn);
        addLog(`완료 — 페널티 ${penBefore} → ${penFinal} (${ls.improved}회 개선)`);
        const tt = buildTTfromCP(lessons, res.asgn);
        const r2 = { tt, placed:279, penalty:penFinal, penaltyBefore:penBefore, lsImproved:ls.improved, attempts:a };
        setResult(r2);
        onGenerated(r2);
        found=true;
      } else {
        if(a%5===0) addLog(`시도 ${a}: 최대 ${res.maxD}/279`);
      }
    }
    if(!found) addLog('⚠️ 50회 내 완전 배정 실패. 재시도해주세요.');
    setPhase('done');
  };

  const penColor = result?(result.penalty===0?C.green:result.penalty<30?C.yellow:C.red):C.textDim;

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:16,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:14,fontWeight:700,color:C.text}}>CP-SAT 백트래킹 알고리즘</div>
          <div style={{fontSize:11,color:C.textDim,marginTop:2}}>9학급 · 24교사 · 279수업 · 최대 50회 재시작</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {result&&<Badge label={`페널티 ${result.penalty}`} color={penColor}/>}
          {result&&<Badge label="✅ 279/279" color={C.green}/>}
          <button onClick={startGenerate} disabled={phase==='running'} style={{padding:'9px 20px',borderRadius:10,border:'none',fontFamily:font,background:phase==='running'?C.textDim:C.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:phase==='running'?'not-allowed':'pointer'}}>
            {phase==='running'?'⏳ 생성 중...':'✨ 시간표 생성'}
          </button>
        </div>
      </div>

      {/* 진행 상황 */}
      {phase==='running'&&(
        <Card style={{padding:16,marginBottom:16,background:'#0d1020'}}>
          <div style={{display:'flex',gap:20,marginBottom:10}}>
            <div style={{textAlign:'center'}}><div style={{fontSize:20,fontWeight:800,color:C.accent}}>{attempt}</div><div style={{fontSize:10,color:C.textDim}}>시도 횟수</div></div>
          </div>
          <div style={{background:C.bg,borderRadius:8,padding:'8px 12px',fontFamily:'monospace',fontSize:11,color:'#00e676',height:90,overflowY:'auto',lineHeight:1.7}}>
            {logs.map((l,i)=><div key={i}>&gt; {l}</div>)}
          </div>
        </Card>
      )}

      {/* 완료 로그 */}
      {phase==='done'&&(
        <Card style={{padding:14,marginBottom:16,background:'#080b14'}}>
          <div style={{fontFamily:'monospace',fontSize:11,color:'#00e676',height:80,overflowY:'auto',lineHeight:1.7}}>
            {logs.map((l,i)=><div key={i}>&gt; {l}</div>)}
          </div>
        </Card>
      )}

      {/* 결과 요약 */}
      {result&&(
        <Card style={{padding:16,borderColor:C.green+'30'}}>
          <div style={{fontSize:13,fontWeight:700,color:C.green,marginBottom:12}}>✅ 시간표 생성 완료</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12}}>
            {[
              {label:'배정 완료',value:'279/279',color:C.green},
              {label:'소프트 페널티',value:result.penalty,color:penColor},
              {label:'로컬서치 개선',value:`${result.lsImproved}회`,color:C.accent},
              {label:'시도 횟수',value:`${result.attempts}회`,color:C.textMid},
            ].map((s,i)=>(
              <div key={i} style={{textAlign:'center',padding:'12px',background:C.bg,borderRadius:8}}>
                <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.value}</div>
                <div style={{fontSize:10,color:C.textDim,marginTop:3}}>{s.label}</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 소프트 제약 안내 */}
      <Card style={{padding:16,marginTop:16}}>
        <div style={{fontSize:12,fontWeight:700,color:C.text,marginBottom:10}}>⚖️ 적용된 소프트 제약</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
          {[
            {label:'S1 같은과목 하루1회',color:C.red},
            {label:'S2 오전/오후 균형',color:C.yellow},
            {label:'S3 요일별 분산',color:C.accent},
            {label:'S4 교사 연강 방지',color:C.purple},
            {label:'S5 교사 일별 분산',color:C.green},
          ].map((s,i)=><Badge key={i} label={s.label} color={s.color} small/>)}
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 4: 교체 요청 관리 (관리자 전용)
// ══════════════════════════════════════════════════════
function ManageChangesTab({ requests, onUpdateRequest }) {
  const [tab, setTab] = useState('pending');
  const pending  = requests.filter(r=>r.status==='pending');
  const resolved = requests.filter(r=>r.status!=='pending');

  const approve = (id) => onUpdateRequest(id, 'approved');
  const reject  = (id) => onUpdateRequest(id, 'rejected');

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:16}}>🔄 수업 교체 요청 관리</div>

      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
        <TabBtn active={tab==='pending'} onClick={()=>setTab('pending')}>⏳ 대기 중 ({pending.length})</TabBtn>
        <TabBtn active={tab==='resolved'} onClick={()=>setTab('resolved')}>✅ 처리 완료 ({resolved.length})</TabBtn>
      </div>

      {tab==='pending'&&(
        pending.length===0
          ? <Card style={{padding:40,textAlign:'center'}}><div style={{color:C.textDim,fontSize:12}}>대기 중인 요청이 없습니다</div></Card>
          : pending.map(r=>(
            <Card key={r.id} style={{padding:'16px 18px',marginBottom:10}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:4}}>{r.label}</div>
                  <div style={{fontSize:11,color:C.textMid}}>요청자: {r.requester}</div>
                  <div style={{fontSize:11,color:C.textMid,marginTop:2}}>사유: {r.reason}</div>
                  <div style={{fontSize:10,color:C.textDim,marginTop:2}}>{r.createdAt}</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={()=>approve(r.id)} style={{padding:'8px 18px',borderRadius:8,border:'none',background:C.green,color:'#fff',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:font}}>승인</button>
                  <button onClick={()=>reject(r.id)}  style={{padding:'8px 16px',borderRadius:8,border:`1px solid ${C.red}40`,background:'transparent',color:C.red,fontSize:12,cursor:'pointer',fontFamily:font}}>반려</button>
                </div>
              </div>
            </Card>
          ))
      )}

      {tab==='resolved'&&(
        resolved.length===0
          ? <Card style={{padding:40,textAlign:'center'}}><div style={{color:C.textDim,fontSize:12}}>처리된 요청이 없습니다</div></Card>
          : resolved.map(r=>(
            <Card key={r.id} style={{padding:'14px 18px',marginBottom:8}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <div>
                  <div style={{fontSize:12,fontWeight:700,color:C.text}}>{r.label}</div>
                  <div style={{fontSize:11,color:C.textDim,marginTop:2}}>요청자: {r.requester} · {r.createdAt}</div>
                </div>
                <Badge label={r.status==='approved'?'승인':'반려'} color={r.status==='approved'?C.green:C.red}/>
              </div>
            </Card>
          ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 5: 통계 (관리자 전용)
// ══════════════════════════════════════════════════════
function StatsTab({ result }) {
  if(!result) return <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',color:C.textDim,fontSize:13}}>시간표를 먼저 생성해주세요</div>;

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      {/* 교사별 */}
      <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>교사별 배치 현황</div>
      <div style={{overflowX:'auto',marginBottom:24}}>
        <table style={{borderCollapse:'collapse',width:'100%',fontSize:11,fontFamily:font}}>
          <thead>
            <tr style={{background:'#0d1020'}}>
              <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>교사</th>
              <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>목표</th>
              {DAYS.map(d=><th key={d} style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>{d}</th>)}
              <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>합계</th>
            </tr>
          </thead>
          <tbody>
            {TCH.map(t=>{
              const target=t.as.reduce((s,a)=>s+a.h,0);
              const dayCnt=DAYS.map(d=>{
                let cnt=0;
                CLS.forEach(c=>{Object.entries(result.tt[c.id]||{}).forEach(([sl,e])=>{if(e&&!e.type&&e.tid===t.id&&sl.startsWith(d+'-'))cnt++;});});
                return cnt;
              });
              const total=dayCnt.reduce((s,v)=>s+v,0);
              return (
                <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:'7px 10px',color:C.text,fontWeight:600}}>{t.name}</td>
                  <td style={{padding:'7px',textAlign:'center',color:C.textDim}}>{target}</td>
                  {dayCnt.map((cnt,i)=><td key={i} style={{padding:'7px',textAlign:'center',color:cnt>0?C.text:C.textDim}}>{cnt||'-'}</td>)}
                  <td style={{padding:'7px',textAlign:'center',fontWeight:700,color:total===target?C.green:C.red}}>{total}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 학급별 */}
      <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>학급별 과목 시수</div>
      <div style={{overflowX:'auto'}}>
        <table style={{borderCollapse:'collapse',fontSize:11,fontFamily:font}}>
          <thead>
            <tr style={{background:'#0d1020'}}>
              <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>과목</th>
              {CLS.map(c=><th key={c.id} style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {SBJ.filter(s=>Object.values(s.gh).some(v=>v>0)).map(s=>{
              const clr=CLR[s.ci];
              return (
                <tr key={s.id} style={{borderBottom:`1px solid ${C.border}`}}>
                  <td style={{padding:'7px 10px'}}><span style={{background:clr.bg+'22',color:clr.bg,padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600}}>{s.name}</span></td>
                  {CLS.map(c=>{
                    let cnt=0;
                    Object.values(result.tt[c.id]||{}).forEach(e=>{if(e&&!e.type&&e.sid===s.id)cnt++;});
                    const exp=s.gh[c.g]||0;
                    if(!exp&&!cnt) return <td key={c.id} style={{padding:'7px',textAlign:'center',color:C.textDim,border:`1px solid ${C.border}`}}>-</td>;
                    return <td key={c.id} style={{padding:'7px',textAlign:'center',fontWeight:cnt===exp?400:700,color:cnt===exp?C.green:C.red,border:`1px solid ${C.border}`}}>{cnt}</td>;
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  탭 6: 초기설정 (관리자 전용)
// ══════════════════════════════════════════════════════
function InitSettingsTab() {
  const [subtab, setSubtab] = useState('subjects');

  return (
    <div style={{flex:1,overflowY:'auto',padding:20}}>
      <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:16}}>⚙️ 초기설정</div>

      <div style={{display:'flex',gap:0,borderBottom:`1px solid ${C.border}`,marginBottom:16}}>
        {[['subjects','과목·시수'],['classes','학급'],['teachers','교사배정']].map(([id,lbl])=>(
          <TabBtn key={id} active={subtab===id} onClick={()=>setSubtab(id)}>{lbl}</TabBtn>
        ))}
      </div>

      {subtab==='subjects'&&(
        <div>
          <div style={{fontSize:12,color:C.textDim,marginBottom:12}}>현재 설정된 과목별 학년별 주간시수</div>
          <div style={{overflowX:'auto'}}>
            <table style={{borderCollapse:'collapse',width:'100%',fontSize:12,fontFamily:font}}>
              <thead>
                <tr style={{background:'#0d1020'}}>
                  <th style={{padding:'8px 12px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>과목</th>
                  <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'center'}}>1학년</th>
                  <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'center'}}>2학년</th>
                  <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'center'}}>3학년</th>
                  <th style={{padding:'8px 12px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>담당 교사</th>
                </tr>
              </thead>
              <tbody>
                {SBJ.map(s=>{
                  const clr=CLR[s.ci];
                  const teachers=TCH.filter(t=>t.as.some(a=>a.s===s.id));
                  return (
                    <tr key={s.id} style={{borderBottom:`1px solid ${C.border}`}}>
                      <td style={{padding:'8px 12px'}}><span style={{background:clr.bg+'22',color:clr.bg,padding:'2px 8px',borderRadius:5,fontSize:11,fontWeight:600}}>{s.name}</span></td>
                      <td style={{padding:'8px',textAlign:'center',color:s.gh[1]?C.text:C.textDim}}>{s.gh[1]||'-'}</td>
                      <td style={{padding:'8px',textAlign:'center',color:s.gh[2]?C.text:C.textDim}}>{s.gh[2]||'-'}</td>
                      <td style={{padding:'8px',textAlign:'center',color:s.gh[3]?C.text:C.textDim}}>{s.gh[3]||'-'}</td>
                      <td style={{padding:'8px 12px',fontSize:11,color:C.textMid}}>{teachers.map(t=>t.name).join(', ')||'-'}</td>
                    </tr>
                  );
                })}
                <tr style={{background:'#0d1020',fontWeight:700}}>
                  <td style={{padding:'8px 12px',color:C.text}}>합계 (창체 포함)</td>
                  {[1,2,3].map(g=><td key={g} style={{padding:'8px',textAlign:'center',color:C.green}}>{SBJ.reduce((s,sub)=>s+(sub.gh[g]||0),0)+1}</td>)}
                  <td style={{padding:'8px 12px',fontSize:11,color:C.textDim}}>목7 창체 고정</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div style={{marginTop:12,padding:'10px 14px',background:C.yellow+'10',border:`1px solid ${C.yellow}20`,borderRadius:8,fontSize:11,color:C.yellow}}>
            ⚠️ 과목·시수 수정 기능은 다음 업데이트에서 제공됩니다. 현재는 조회만 가능합니다.
          </div>
        </div>
      )}

      {subtab==='classes'&&(
        <div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
            {CLS.map(c=>{
              const hr=getHR(c.id);
              return (
                <Card key={c.id} style={{padding:'14px 16px'}}>
                  <div style={{fontSize:14,fontWeight:700,color:C.text,marginBottom:4}}>{c.name}</div>
                  <div style={{fontSize:11,color:C.textDim}}>담임: {hr?.name||'미배정'}</div>
                  <div style={{fontSize:11,color:C.textDim,marginTop:2}}>{c.g}학년</div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {subtab==='teachers'&&(
        <div style={{overflowX:'auto'}}>
          <table style={{borderCollapse:'collapse',width:'100%',fontSize:11,fontFamily:font}}>
            <thead>
              <tr style={{background:'#0d1020'}}>
                <th style={{padding:'8px 10px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>교사</th>
                <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>담임</th>
                <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>요일제한</th>
                <th style={{padding:'8px',border:`1px solid ${C.border}`,color:C.textMid}}>총시수</th>
                <th style={{padding:'8px 10px',border:`1px solid ${C.border}`,color:C.textMid,textAlign:'left'}}>담당 학급</th>
              </tr>
            </thead>
            <tbody>
              {TCH.map(t=>{
                const total=t.as.reduce((s,a)=>s+a.h,0);
                const dr=t.al?t.al.map(d=>DAYS[d]).join('·')+'만':'제한없음';
                const cls=t.as.map(a=>gC(a.c)?.name).join(', ');
                return (
                  <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`}}>
                    <td style={{padding:'7px 10px',color:C.text,fontWeight:600}}>{t.name}</td>
                    <td style={{padding:'7px',textAlign:'center',color:t.hr?C.green:C.textDim}}>{t.hr?gC(t.hc)?.name:'—'}</td>
                    <td style={{padding:'7px',textAlign:'center',color:t.al?C.yellow:C.textDim,fontSize:10}}>{dr}</td>
                    <td style={{padding:'7px',textAlign:'center',fontWeight:700,color:total>=15?C.red:total>=10?C.green:C.textMid}}>{total}h</td>
                    <td style={{padding:'7px 10px',color:C.textDim,fontSize:10}}>{cls}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════
export default function TimetablePage({ teacher }) {
  const [activeTab, setActiveTab] = useState('view');
  const [ttResult, setTTResult] = useState(null);
  const [requests, setRequests] = useState([]);

  const isAdmin = teacher && ['super_admin','timetable_admin'].includes(teacher.role);

  // 관리자 탭 목록
  const adminTabs = [
    { id:'init',    label:'⚙️ 초기설정' },
    { id:'generate',label:'✨ 시간표 생성' },
    { id:'stats',   label:'📊 통계' },
    { id:'manage',  label:'🔄 교체 관리' },
  ];
  const commonTabs = [
    { id:'view',    label:'📅 시간표 보기' },
    { id:'request', label:'🔄 교체 요청' },
  ];

  const handleGenerated = (result) => {
    setTTResult(result);
    setActiveTab('view');
  };

  const handleSubmitRequest = (req) => {
    setRequests(prev=>[req,...prev]);
  };

  const handleUpdateRequest = (id, status) => {
    setRequests(prev=>prev.map(r=>r.id===id?{...r,status}:r));
  };

  const renderTab = () => {
    switch(activeTab){
      case 'view':     return <ViewTab tt={ttResult?.tt} onRequestChange={(sl,cid,entry)=>{setActiveTab('request');}}/>;
      case 'request':  return <ChangeRequestTab tt={ttResult?.tt} teacher={teacher||{name:'사용자'}} requests={requests} onSubmitRequest={handleSubmitRequest}/>;
      case 'init':     return isAdmin?<InitSettingsTab/>:null;
      case 'generate': return isAdmin?<GenerateTab onGenerated={handleGenerated}/>:null;
      case 'stats':    return isAdmin?<StatsTab result={ttResult}/>:null;
      case 'manage':   return isAdmin?<ManageChangesTab requests={requests} onUpdateRequest={handleUpdateRequest}/>:null;
      default:         return null;
    }
  };

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',fontFamily:font,color:C.text}}>
      {/* 헤더 */}
      <div style={{padding:'14px 20px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:16,fontWeight:800,color:C.text}}>🗓️ 시간표 관리</div>
          <div style={{fontSize:11,color:C.textDim,marginTop:2}}>대동여중 · 2025학년도 1학기</div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {ttResult&&<Badge label="✅ 시간표 있음" color={C.green} small/>}
          {requests.filter(r=>r.status==='pending').length>0&&<Badge label={`교체 요청 ${requests.filter(r=>r.status==='pending').length}건`} color={C.yellow} small/>}
        </div>
      </div>

      {/* 탭 바 */}
      <div style={{display:'flex',borderBottom:`1px solid ${C.border}`,background:C.card,overflowX:'auto'}}>
        {/* 공통 탭 */}
        {commonTabs.map(t=><TabBtn key={t.id} active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}>{t.label}</TabBtn>)}

        {/* 관리자 탭 구분선 */}
        {isAdmin&&(
          <>
            <div style={{width:1,background:C.border,margin:'8px 4px'}}/>
            <span style={{padding:'10px 8px',fontSize:10,color:C.textDim,whiteSpace:'nowrap',alignSelf:'center'}}>관리자</span>
            {adminTabs.map(t=><TabBtn key={t.id} active={activeTab===t.id} onClick={()=>setActiveTab(t.id)}>{t.label}</TabBtn>)}
          </>
        )}
      </div>

      {/* 탭 내용 */}
      <div style={{flex:1,overflow:'hidden',display:'flex',flexDirection:'column'}}>
        {renderTab()}
      </div>
    </div>
  );
}
