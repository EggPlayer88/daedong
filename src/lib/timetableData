import { useState, useCallback } from 'react';
import {
  DAYS, DP, DAILY, CLR, SBJ, CLS, TCH,
  gS, gC, gT, getHR, isV, getSP, TIMES
} from '../lib/timetableData';
import {
  buildLessons, cpSolve, buildTTfromCP,
  calcTotalPenalty, localSearch
} from '../lib/solver';

// ─── 색상 ───
const C = {
  bg:'#0c0f1a', card:'#141929', border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

function Badge({ label, color, small }) {
  return (
    <span style={{
      display:'inline-block', padding:small?'1px 7px':'3px 10px',
      borderRadius:6, fontSize:small?10:11, fontWeight:600,
      background:color+'15', color, border:`1px solid ${color}25`,
    }}>{label}</span>
  );
}

// ─── 시간표 그리드 ───
function TTGrid({ tt, viewMode, entityId, onCellClick }) {
  if(!tt) return <div style={{color:C.textDim,textAlign:'center',padding:40}}>시간표를 생성해주세요</div>;

  const rows = [];
  for(let p=1; p<=7; p++){
    const cells = DAYS.map((d,di) => {
      if(!isV(d,p)) return <td key={d} style={{background:'#080b14',opacity:.3,border:`1px solid ${C.border}`,height:52,minWidth:80}}/>;

      const sl = `${d}-${p}`;
      const sp = getSP(d,p);
      let entry=null, eid=entityId;

      if(viewMode==='class'){
        entry = tt[entityId]?.[sl];
      } else {
        CLS.forEach(c => {
          const x = tt[c.id]?.[sl];
          if(x && x.tid===entityId){ entry=x; eid=c.id; }
        });
      }

      if(sp && entry?.type==='special'){
        const lbl = viewMode==='class' ? gT(entry.tid)?.name : gC(eid)?.name;
        return (
          <td key={d} style={{border:`1px solid ${C.border}`,background:'#1a1530',textAlign:'center',height:52}}>
            <div style={{fontSize:10,color:'#a78bfa',fontWeight:700}}>창체</div>
            <div style={{fontSize:9,color:'#7c6fcc'}}>{lbl}</div>
          </td>
        );
      }
      if(sp && !entry){
        return <td key={d} style={{border:`1px solid ${C.border}`,background:'#1a1530',textAlign:'center',height:52,opacity:.4}}>
          <div style={{fontSize:9,color:'#7c6fcc'}}>창체</div>
        </td>;
      }
      if(entry && !entry.type){
        const s = gS(entry.sid);
        const clr = CLR[s?.ci||0];
        const lbl = viewMode==='class' ? gT(entry.tid)?.name : gC(eid)?.name;
        const hl = {t3:'#2a1f00',ti:'#001a10',t22:'#0d1a00'}[entry.tid];
        return (
          <td key={d}
            onClick={() => onCellClick && onCellClick(sl, eid, entry)}
            style={{
              border:`1px solid ${C.border}`, height:52, minWidth:80,
              background:hl||clr.bg+'22', cursor:'pointer',
              borderLeft:`3px solid ${clr.bg}`,
              transition:'filter .1s',
            }}
            onMouseEnter={e=>e.currentTarget.style.filter='brightness(1.3)'}
            onMouseLeave={e=>e.currentTarget.style.filter=''}
          >
            <div style={{textAlign:'center',padding:'4px 2px'}}>
              <div style={{fontSize:11,fontWeight:700,color:clr.bg}}>{s?.name}</div>
              <div style={{fontSize:10,color:clr.bg,opacity:.8}}>{lbl}</div>
            </div>
          </td>
        );
      }
      return (
        <td key={d} style={{border:`1px solid ${C.border}`,height:52,background:'#1a0000',textAlign:'center'}}>
          <span style={{fontSize:9,color:C.red}}>빈칸</span>
        </td>
      );
    });

    if(p===5) rows.push(<tr key="lunch"><td colSpan={6} style={{height:2,background:C.border,padding:0}}/></tr>);
    rows.push(
      <tr key={p}>
        <td style={{
          padding:'4px 8px', background:'#0d1020', border:`1px solid ${C.border}`,
          textAlign:'center', minWidth:52, whiteSpace:'nowrap',
        }}>
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
            {DAYS.map((d,di) => (
              <th key={d} style={{padding:'8px',background:'#0d1020',border:`1px solid ${C.border}`,fontSize:11,color:C.textMid,minWidth:80}}>
                {d}요일<br/><span style={{fontSize:9,opacity:.6}}>{DP[d]}교시</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}

// ─── 메인 컴포넌트 ───
export default function TimetablePage() {
  const [phase, setPhase]   = useState('idle'); // idle | running | done
  const [attempt, setAttempt] = useState(0);
  const [maxDepth, setMaxDepth] = useState(0);
  const [logs, setLogs]     = useState([]);
  const [result, setResult] = useState(null); // { tt, placed, penalty, penaltyBefore, lsImproved, attempts }
  const [viewMode, setViewMode] = useState('class');
  const [entityId, setEntityId] = useState('c1');
  const [subtab, setSubtab] = useState('timetable'); // timetable | stats

  const addLog = useCallback((msg) => {
    setLogs(prev => [...prev.slice(-24), msg]);
  }, []);

  const startGenerate = async () => {
    setPhase('running');
    setLogs([]);
    setAttempt(0);
    setMaxDepth(0);
    setResult(null);

    const lessons = buildLessons();
    addLog(`수업 카드 ${lessons.length}장 생성`);
    addLog('CP-SAT 백트래킹 시작...');
    await new Promise(r=>setTimeout(r,30));

    let found = false;
    let finalAsgn = null;

    for(let a=1; a<=50 && !found; a++){
      setAttempt(a);
      await new Promise(r=>setTimeout(r,0));

      const res = cpSolve(lessons, 120000);
      if(res.success){
        finalAsgn = res.asgn;
        const penBefore = calcTotalPenalty(lessons, res.asgn);
        addLog(`✅ ${a}번째 시도 성공! (${res.nodes.toLocaleString()} 노드) | 초기 페널티 ${penBefore}`);

        addLog('🔧 로컬 서치 최적화 중...');
        await new Promise(r=>setTimeout(r,0));
        const ls = localSearch(lessons, res.asgn, 4000);
        const penFinal = calcTotalPenalty(lessons, res.asgn);
        addLog(`완료 — 페널티 ${penBefore} → ${penFinal} (${ls.improved}회 개선)`);

        const tt = buildTTfromCP(lessons, res.asgn);
        setResult({ tt, placed:279, penalty:penFinal, penaltyBefore:penBefore, lsImproved:ls.improved, attempts:a });
        found = true;
      } else {
        setMaxDepth(prev => Math.max(prev, res.maxD));
        if(a%5===0) addLog(`시도 ${a}: 최대 ${res.maxD}/279 (${res.nodes.toLocaleString()} 노드)`);
      }
    }

    if(!found) addLog('⚠️ 50회 내 완전 배정 실패. 재시도해주세요.');
    setPhase('done');
  };

  const penColor = result ? (result.penalty===0?C.green:result.penalty<30?C.yellow:C.red) : C.textDim;

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',fontFamily:font,color:C.text}}>
      {/* 헤더 */}
      <div style={{padding:'16px 24px',borderBottom:`1px solid ${C.border}`,display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
        <div>
          <h2 style={{margin:0,fontSize:17,fontWeight:800,color:C.text}}>📅 시간표 자동 생성</h2>
          <p style={{margin:'3px 0 0',fontSize:11,color:C.textDim}}>CP-SAT 백트래킹 · 9학급 · 24교사 · 279수업</p>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          {result && <Badge label={`페널티 ${result.penalty}`} color={penColor}/>}
          {result && <Badge label={`✅ ${result.placed}/279`} color={C.green}/>}
          <button
            onClick={startGenerate}
            disabled={phase==='running'}
            style={{
              padding:'9px 20px',borderRadius:10,border:'none',fontFamily:font,
              background:phase==='running'?C.textDim:C.accent,
              color:'#fff',fontSize:13,fontWeight:700,cursor:phase==='running'?'not-allowed':'pointer',
            }}
          >
            {phase==='running'?'⏳ 생성 중...':'✨ 생성 시작'}
          </button>
        </div>
      </div>

      {/* 진행 상황 */}
      {phase==='running' && (
        <div style={{padding:'12px 24px',borderBottom:`1px solid ${C.border}`,background:'#0d1020'}}>
          <div style={{display:'flex',gap:24,marginBottom:8}}>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:18,fontWeight:800,color:C.accent}}>{attempt}</div>
              <div style={{fontSize:10,color:C.textDim}}>시도</div>
            </div>
            <div style={{textAlign:'center'}}>
              <div style={{fontSize:18,fontWeight:800,color:C.yellow}}>{maxDepth}</div>
              <div style={{fontSize:10,color:C.textDim}}>최대 깊이</div>
            </div>
          </div>
          <div style={{
            background:'#080b14',borderRadius:8,padding:'8px 12px',
            fontFamily:'monospace',fontSize:11,color:'#00e676',
            height:80,overflowY:'auto',lineHeight:1.7,
          }}>
            {logs.map((l,i)=><div key={i}>&gt; {l}</div>)}
          </div>
        </div>
      )}

      {/* 완료 로그 */}
      {phase==='done' && result && (
        <div style={{padding:'12px 24px',borderBottom:`1px solid ${C.border}`,background:'#080b14'}}>
          <div style={{
            fontFamily:'monospace',fontSize:11,color:'#00e676',
            height:70,overflowY:'auto',lineHeight:1.7,
          }}>
            {logs.map((l,i)=><div key={i}>&gt; {l}</div>)}
          </div>
        </div>
      )}

      {/* 서브탭 */}
      {result && (
        <div style={{display:'flex',gap:0,borderBottom:`1px solid ${C.border}`,background:C.card}}>
          {[['timetable','📅 시간표'],['stats','📊 통계']].map(([id,lbl])=>(
            <button key={id} onClick={()=>setSubtab(id)} style={{
              padding:'10px 20px',border:'none',background:'transparent',
              borderBottom:`2px solid ${subtab===id?C.accent:'transparent'}`,
              color:subtab===id?C.accent:C.textMid,fontSize:12,fontWeight:subtab===id?700:500,
              cursor:'pointer',fontFamily:font,
            }}>{lbl}</button>
          ))}
        </div>
      )}

      {/* 시간표 뷰 */}
      {result && subtab==='timetable' && (
        <div style={{flex:1,overflowY:'auto',padding:20}}>
          {/* 뷰 선택 */}
          <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap',alignItems:'center'}}>
            <div style={{display:'flex',border:`1px solid ${C.border}`,borderRadius:8,overflow:'hidden'}}>
              {[['class','학급별'],['teacher','교사별']].map(([v,lbl])=>(
                <button key={v} onClick={()=>{setViewMode(v);setEntityId(v==='class'?'c1':'t1');}} style={{
                  padding:'7px 16px',border:'none',fontFamily:font,
                  background:viewMode===v?C.accent:'transparent',
                  color:viewMode===v?'#fff':C.textMid,fontSize:12,fontWeight:viewMode===v?700:500,cursor:'pointer',
                }}>{lbl}</button>
              ))}
            </div>
            <select
              value={entityId}
              onChange={e=>setEntityId(e.target.value)}
              style={{padding:'7px 12px',borderRadius:8,border:`1px solid ${C.border}`,background:C.card,color:C.text,fontSize:12,fontFamily:font,outline:'none'}}
            >
              {viewMode==='class'
                ? CLS.map(c=><option key={c.id} value={c.id}>{c.name}</option>)
                : TCH.map(t=><option key={t.id} value={t.id}>{t.name}</option>)
              }
            </select>
          </div>
          <TTGrid tt={result.tt} viewMode={viewMode} entityId={entityId} />
        </div>
      )}

      {/* 통계 뷰 */}
      {result && subtab==='stats' && (
        <div style={{flex:1,overflowY:'auto',padding:20}}>
          <div style={{marginBottom:20}}>
            <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:12}}>교사별 배치 현황</div>
            <div style={{overflowX:'auto'}}>
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
                  {TCH.map(t => {
                    const target = t.as.reduce((s,a)=>s+a.h,0);
                    const dayCnt = DAYS.map(d => {
                      let cnt=0;
                      CLS.forEach(c=>{
                        Object.entries(result.tt[c.id]||{}).forEach(([sl,e])=>{
                          if(e&&!e.type&&e.tid===t.id&&sl.startsWith(d+'-')) cnt++;
                        });
                      });
                      return cnt;
                    });
                    const total = dayCnt.reduce((s,v)=>s+v,0);
                    const ok = total===target;
                    return (
                      <tr key={t.id} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:'7px 10px',color:C.text,fontWeight:600}}>{t.name}</td>
                        <td style={{padding:'7px',textAlign:'center',color:C.textDim}}>{target}</td>
                        {dayCnt.map((cnt,i)=>(
                          <td key={i} style={{padding:'7px',textAlign:'center',color:cnt>0?C.text:C.textDim}}>{cnt||'-'}</td>
                        ))}
                        <td style={{padding:'7px',textAlign:'center',fontWeight:700,color:ok?C.green:C.red}}>{total}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
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
                    const clr = CLR[s.ci];
                    return (
                      <tr key={s.id} style={{borderBottom:`1px solid ${C.border}`}}>
                        <td style={{padding:'7px 10px'}}>
                          <span style={{background:clr.bg+'22',color:clr.bg,padding:'2px 7px',borderRadius:5,fontSize:10,fontWeight:600}}>{s.name}</span>
                        </td>
                        {CLS.map(c=>{
                          let cnt=0;
                          Object.values(result.tt[c.id]||{}).forEach(e=>{
                            if(e&&!e.type&&e.sid===s.id) cnt++;
                          });
                          const exp = s.gh[c.g]||0;
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
        </div>
      )}

      {/* 초기 상태 */}
      {phase==='idle' && (
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:12,color:C.textDim}}>
          <div style={{fontSize:40}}>📅</div>
          <div style={{fontSize:13}}>생성 버튼을 눌러 시간표를 만들어주세요</div>
        </div>
      )}
    </div>
  );
}
