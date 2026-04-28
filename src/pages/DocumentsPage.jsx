import { useState, useEffect, useRef } from 'react';
import { supabase } from '../lib/supabase';

const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171', purple:'#a78bfa',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

const CATEGORIES = [
  { id:'수행평가',   color:'#4f8cff', icon:'📝' },
  { id:'학교폭력',   color:'#f87171', icon:'🛡️' },
  { id:'현장체험',   color:'#fb923c', icon:'🚌' },
  { id:'생활기록부', color:'#34d399', icon:'📒' },
  { id:'회의록',     color:'#2dd4bf', icon:'💬' },
  { id:'가정통신문', color:'#a78bfa', icon:'✉️' },
  { id:'연수',       color:'#fbbf24', icon:'📖' },
  { id:'기타',       color:'#8b95ad', icon:'📁' },
];

const getCat = id => CATEGORIES.find(c=>c.id===id)||CATEGORIES[7];

const formatSize = bytes => {
  if(!bytes) return '-';
  if(bytes<1024) return bytes+'B';
  if(bytes<1024*1024) return (bytes/1024).toFixed(1)+'KB';
  return (bytes/1024/1024).toFixed(1)+'MB';
};

function Badge({ label, color, small }) {
  return <span style={{ display:'inline-flex', alignItems:'center', gap:3, padding:small?'1px 7px':'3px 10px', borderRadius:20, fontSize:small?10:11, fontWeight:600, background:color+'18', color, border:`1px solid ${color}25` }}>{label}</span>;
}

function Card({ children, style, onClick }) {
  const [h,setH]=useState(false);
  return <div onClick={onClick} onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
    style={{ background:h&&onClick?C.cardHover:C.card, border:`1px solid ${h&&onClick?C.borderLight:C.border}`, borderRadius:12, transition:'all .2s', cursor:onClick?'pointer':'default', ...style }}>{children}</div>;
}

// ─── 업로드 모달 ───
function UploadModal({ teacher, onClose, onUploaded }) {
  const [files, setFiles]       = useState([]);
  const [category, setCategory] = useState('기타');
  const [description, setDesc]  = useState('');
  const [isShared, setShared]   = useState(true);
  const [year, setYear]         = useState(new Date().getFullYear());
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState([]);
  const [error, setError]         = useState('');
  const inputRef = useRef();

  const handleDrop = e => {
    e.preventDefault();
    const dropped = Array.from(e.dataTransfer.files);
    setFiles(prev=>[...prev, ...dropped]);
  };

  const handleUpload = async () => {
    if(!files.length){ setError('파일을 선택해주세요'); return; }
    setUploading(true); setError('');
    const results = [];

    for(let i=0; i<files.length; i++){
      const file = files[i];
      setProgress(prev=>{const n=[...prev]; n[i]='uploading'; return n;});

      try {
        // Storage 업로드
        const ext = file.name.split('.').pop();
        const path = `${teacher.id}/${Date.now()}_${file.name}`;
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(path, file, { upsert: false });

        if(upErr) throw upErr;

        // DB에 메타데이터 저장
        const { data: docData, error: dbErr } = await supabase.from('documents').insert([{
          name: file.name.replace(`.${ext}`,''),
          file_path: path,
          file_size: file.size,
          file_type: ext.toLowerCase(),
          category,
          description,
          uploaded_by: teacher.id,
          uploaded_by_name: teacher.name,
          is_shared: isShared,
          year,
          extracted_text: null,
          parse_status: 'pending',
        }]).select().single();

        if(dbErr) throw dbErr;

        // 텍스트 추출 (HWP, HWPX, PDF, DOCX)
        const parseable = ['hwp','hwpx','pdf','docx','doc','txt','md'];
        if(parseable.includes(ext.toLowerCase())) {
          setProgress(prev=>{const n=[...prev]; n[i]='extracting'; return n;});
          try {
            const parseRes = await fetch('/api/parse-document', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: path, fileType: ext.toLowerCase() }),
            });
            const parseData = await parseRes.json();

            if(parseData.text) {
              await supabase.from('documents')
                .update({ extracted_text: parseData.text, parse_status: 'done' })
                .eq('id', docData.id);
            } else {
              await supabase.from('documents')
                .update({ parse_status: 'no_text' })
                .eq('id', docData.id);
            }
          } catch(parseErr) {
            console.error('Text extraction failed:', parseErr);
            await supabase.from('documents')
              .update({ parse_status: 'failed' })
              .eq('id', docData.id);
          }
        }

        setProgress(prev=>{const n=[...prev]; n[i]='done'; return n;});
        results.push(file.name);
      } catch(e) {
        setProgress(prev=>{const n=[...prev]; n[i]='error'; return n;});
        setError(`${file.name} 업로드 실패: ${e.message}`);
      }
    }

    setUploading(false);
    if(results.length) { onUploaded(); setTimeout(onClose, 800); }
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', fontFamily:font }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text }}>📤 문서 업로드</h3>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textDim, fontSize:18, cursor:'pointer' }}>✕</button>
        </div>

        {error && <div style={{ padding:'8px 12px', background:C.red+'15', border:`1px solid ${C.red}30`, borderRadius:8, color:C.red, fontSize:12, marginBottom:12 }}>{error}</div>}

        {/* 드래그 앤 드롭 영역 */}
        <div
          onDrop={handleDrop}
          onDragOver={e=>e.preventDefault()}
          onClick={()=>inputRef.current.click()}
          style={{ border:`2px dashed ${C.border}`, borderRadius:10, padding:32, textAlign:'center', cursor:'pointer', marginBottom:16, transition:'border-color .15s' }}
          onMouseEnter={e=>e.currentTarget.style.borderColor=C.accent}
          onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}
        >
          <div style={{ fontSize:32, marginBottom:8 }}>📁</div>
          <div style={{ fontSize:13, fontWeight:600, color:C.text, marginBottom:4 }}>클릭하거나 파일을 드래그하세요</div>
          <div style={{ fontSize:11, color:C.textDim }}>PDF, HWP, DOCX, XLSX, JPG, PNG 등 모든 파일 지원</div>
          <input ref={inputRef} type="file" multiple style={{ display:'none' }} onChange={e=>setFiles(prev=>[...prev,...Array.from(e.target.files)])}/>
        </div>

        {/* 선택된 파일 목록 */}
        {files.length>0 && (
          <div style={{ marginBottom:16 }}>
            {files.map((f,i)=>(
              <div key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 10px', background:C.bg, borderRadius:8, marginBottom:4 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:16 }}>📄</span>
                  <div>
                    <div style={{ fontSize:12, color:C.text }}>{f.name}</div>
                    <div style={{ fontSize:10, color:C.textDim }}>{formatSize(f.size)}</div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  {progress[i]==='uploading'&&<span style={{ fontSize:11, color:C.yellow }}>업로드 중...</span>}
                  {progress[i]==='extracting'&&<span style={{ fontSize:11, color:C.purple }}>📄 텍스트 추출 중...</span>}
                  {progress[i]==='done'&&<span style={{ fontSize:11, color:C.green }}>✅ 완료</span>}
                  {progress[i]==='error'&&<span style={{ fontSize:11, color:C.red }}>❌ 실패</span>}
                  {!progress[i]&&<button onClick={()=>setFiles(prev=>prev.filter((_,j)=>j!==i))} style={{ background:'none', border:'none', color:C.textDim, cursor:'pointer', fontSize:14 }}>✕</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 카테고리 */}
        <div style={{ marginBottom:14 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>카테고리</label>
          <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
            {CATEGORIES.map(cat=>(
              <button key={cat.id} onClick={()=>setCategory(cat.id)} style={{ padding:'5px 12px', borderRadius:20, border:`1px solid ${category===cat.id?cat.color:C.border}`, background:category===cat.id?cat.color+'18':'transparent', color:category===cat.id?cat.color:C.textMid, fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:font }}>
                {cat.icon} {cat.id}
              </button>
            ))}
          </div>
        </div>

        {/* 연도 + 공개범위 */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14 }}>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>연도</label>
            <select value={year} onChange={e=>setYear(+e.target.value)} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none' }}>
              {[2023,2024,2025,2026].map(y=><option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>공개 범위</label>
            <div style={{ display:'flex', gap:4 }}>
              {[['all','🏫 전체'],['personal','🔒 나만']].map(([val,lbl])=>(
                <button key={val} onClick={()=>setShared(val==='all')} style={{ flex:1, padding:'8px', borderRadius:8, border:`1px solid ${(isShared&&val==='all')||(!isShared&&val==='personal')?C.accent:C.border}`, background:(isShared&&val==='all')||(!isShared&&val==='personal')?C.accentSoft:'transparent', color:(isShared&&val==='all')||(!isShared&&val==='personal')?C.accent:C.textMid, fontSize:11, cursor:'pointer', fontFamily:font }}>{lbl}</button>
              ))}
            </div>
          </div>
        </div>

        {/* 설명 */}
        <div style={{ marginBottom:20 }}>
          <label style={{ fontSize:11, fontWeight:600, color:C.textMid, display:'block', marginBottom:6 }}>설명 (선택)</label>
          <textarea value={description} onChange={e=>setDesc(e.target.value)} placeholder="문서에 대한 간단한 설명" rows={2} style={{ width:'100%', padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none', resize:'none', boxSizing:'border-box' }}/>
        </div>

        <div style={{ display:'flex', gap:8 }}>
          <button onClick={onClose} style={{ flex:1, padding:'11px', borderRadius:10, border:`1px solid ${C.border}`, background:'transparent', color:C.textMid, fontSize:13, cursor:'pointer', fontFamily:font }}>취소</button>
          <button onClick={handleUpload} disabled={uploading||!files.length} style={{ flex:2, padding:'11px', borderRadius:10, border:'none', background:uploading||!files.length?C.textDim:C.accent, color:'#fff', fontSize:13, fontWeight:700, cursor:uploading||!files.length?'not-allowed':'pointer', fontFamily:font }}>
            {uploading?'업로드 중...':'업로드'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── 문서 상세 모달 ───
function DocDetailModal({ doc, teacher, onClose, onDelete }) {
  const [downloading, setDownloading] = useState(false);
  const [asking, setAsking]           = useState(false);
  const [question, setQuestion]       = useState('');
  const [answer, setAnswer]           = useState('');

  const cat = getCat(doc.category);

  const handleDownload = async () => {
    setDownloading(true);
    const { data } = await supabase.storage.from('documents').createSignedUrl(doc.file_path, 60);
    if(data?.signedUrl) window.open(data.signedUrl, '_blank');
    setDownloading(false);
  };

  const handleAsk = async () => {
    if(!question.trim()) return;
    setAsking(true); setAnswer('');
    try {
      const docContent = doc.extracted_text
        ? `\n\n문서 본문 내용:\n${doc.extracted_text.slice(0, 8000)}`
        : '\n\n(문서 본문 텍스트가 추출되지 않았습니다. 파일명과 카테고리 기반으로 답변합니다.)';

      const res = await fetch('/api/chat', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({
          messages:[{ role:'user', content: question }],
          systemPrompt: `당신은 학교 업무 AI 비서입니다.\n\n현재 사용자가 "${doc.name}" 문서에 대해 질문하고 있습니다.\n문서 정보:\n- 파일명: ${doc.name}\n- 카테고리: ${doc.category}\n- 설명: ${doc.description||'없음'}\n- 업로더: ${doc.uploaded_by_name}\n- 연도: ${doc.year}${docContent}\n\n문서 내용을 바탕으로 정확하게 답변해주세요. 문서에 없는 내용은 추측하지 마세요.`,
        }),
      });
      const data = await res.json();
      setAnswer(data.content || '답변을 받지 못했습니다.');
    } catch(e) {
      setAnswer('오류가 발생했습니다: '+e.message);
    }
    setAsking(false);
  };

  const canDelete = teacher?.id === doc.uploaded_by || ['super_admin'].includes(teacher?.role);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,.75)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16 }}>
      <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:16, padding:28, width:'100%', maxWidth:520, maxHeight:'90vh', overflowY:'auto', fontFamily:font }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
              <span style={{ fontSize:24 }}>{cat.icon}</span>
              <h3 style={{ margin:0, fontSize:16, fontWeight:800, color:C.text }}>{doc.name}</h3>
            </div>
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              <Badge label={cat.id} color={cat.color} small/>
              <Badge label={`${doc.year}년`} color={C.accent} small/>
              <Badge label={doc.file_type?.toUpperCase()||'FILE'} color={C.textMid} small/>
              <Badge label={formatSize(doc.file_size)} color={C.textDim} small/>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'none', border:'none', color:C.textDim, fontSize:18, cursor:'pointer' }}>✕</button>
        </div>

        {doc.description && (
          <div style={{ padding:'10px 14px', background:C.bg, borderRadius:8, fontSize:12, color:C.textMid, marginBottom:16, lineHeight:1.7 }}>
            {doc.description}
          </div>
        )}

        <div style={{ fontSize:11, color:C.textDim, marginBottom:12 }}>
          업로드: {doc.uploaded_by_name} · {new Date(doc.created_at).toLocaleDateString('ko-KR')}
        </div>

        {/* 텍스트 추출 상태 */}
        <div style={{ padding:'10px 14px', borderRadius:8, marginBottom:16, fontSize:12, background: doc.parse_status==='done'?C.green+'10':doc.parse_status==='failed'?C.red+'10':C.bg, border:`1px solid ${doc.parse_status==='done'?C.green+'25':doc.parse_status==='failed'?C.red+'25':C.border}` }}>
          {doc.parse_status==='done' && <span style={{color:C.green}}>✅ 텍스트 추출 완료 — AI가 이 문서 내용을 읽을 수 있습니다 ({doc.extracted_text?.length?.toLocaleString()||0}자)</span>}
          {doc.parse_status==='failed' && <span style={{color:C.red}}>⚠️ 텍스트 추출 실패 — 파일은 정상 저장되었습니다</span>}
          {doc.parse_status==='no_text' && <span style={{color:C.yellow}}>📄 텍스트를 추출할 수 없는 파일입니다</span>}
          {doc.parse_status==='pending' && <span style={{color:C.yellow}}>⏳ 텍스트 추출 대기 중</span>}
          {!doc.parse_status && <span style={{color:C.textDim}}>📎 텍스트 추출 미지원 파일</span>}
        </div>

        {/* 추출된 텍스트 미리보기 */}
        {doc.extracted_text && (
          <details style={{ marginBottom:16 }}>
            <summary style={{ fontSize:12, fontWeight:600, color:C.accent, cursor:'pointer', marginBottom:8 }}>📖 추출된 텍스트 미리보기</summary>
            <div style={{ padding:'12px 14px', background:C.bg, borderRadius:8, border:`1px solid ${C.border}`, maxHeight:200, overflowY:'auto', fontSize:11, color:C.textMid, lineHeight:1.7, whiteSpace:'pre-wrap' }}>
              {doc.extracted_text.slice(0, 2000)}{doc.extracted_text.length > 2000 ? '\n\n... (이하 생략)' : ''}
            </div>
          </details>
        )}

        {/* 다운로드 */}
        <button onClick={handleDownload} disabled={downloading} style={{ width:'100%', padding:'11px', borderRadius:10, border:'none', background:C.accent, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:font, marginBottom:16 }}>
          {downloading?'준비 중...':'📥 다운로드'}
        </button>

        {/* AI 질문 */}
        <div style={{ borderTop:`1px solid ${C.border}`, paddingTop:16, marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:C.text, marginBottom:8 }}>🤖 이 문서에 대해 질문하기</div>
          <div style={{ display:'flex', gap:6, marginBottom:8 }}>
            <input value={question} onChange={e=>setQuestion(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleAsk()} placeholder="이 문서 관련 업무 질문..." style={{ flex:1, padding:'9px 12px', borderRadius:8, border:`1px solid ${C.border}`, background:C.bg, color:C.text, fontSize:12, fontFamily:font, outline:'none' }} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
            <button onClick={handleAsk} disabled={asking||!question.trim()} style={{ padding:'9px 16px', borderRadius:8, border:'none', background:asking?C.textDim:C.accent, color:'#fff', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:font }}>
              {asking?'..':'질문'}
            </button>
          </div>
          {answer && (
            <div style={{ padding:'12px 14px', background:C.bg, borderRadius:8, fontSize:12, color:C.text, lineHeight:1.8, whiteSpace:'pre-wrap' }}>
              {answer}
            </div>
          )}
        </div>

        {/* 삭제 */}
        {canDelete && (
          <button onClick={()=>onDelete(doc)} style={{ width:'100%', padding:'9px', borderRadius:10, border:`1px solid ${C.red}30`, background:'transparent', color:C.red, fontSize:12, cursor:'pointer', fontFamily:font }}>
            삭제
          </button>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════
//  메인 컴포넌트
// ══════════════════════════════════════════════════════
export default function DocumentsPage({ teacher }) {
  const [docs, setDocs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [showUpload, setUpload] = useState(false);
  const [selected, setSelected] = useState(null);
  const [filterCat, setFilter]  = useState('전체');
  const [filterYear, setYear]   = useState('전체');
  const [search, setSearch]     = useState('');
  const [viewMode, setView]     = useState('grid'); // grid | list

  const fetchDocs = async () => {
    setLoading(true);
    const { data } = await supabase.from('documents').select('*').order('created_at', { ascending:false });
    if(data) setDocs(data);
    setLoading(false);
  };
  useEffect(()=>{ fetchDocs(); },[]);

  const handleDelete = async (doc) => {
    if(!confirm(`"${doc.name}" 을 삭제하시겠습니까?`)) return;
    await supabase.storage.from('documents').remove([doc.file_path]);
    await supabase.from('documents').delete().eq('id', doc.id);
    await fetchDocs();
    setSelected(null);
  };

  // 필터
  const filtered = docs.filter(d => {
    if(filterCat!=='전체' && d.category!==filterCat) return false;
    if(filterYear!=='전체' && String(d.year)!==filterYear) return false;
    if(search && !d.name.toLowerCase().includes(search.toLowerCase()) && !d.description?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const years = ['전체', ...new Set(docs.map(d=>String(d.year)))].sort((a,b)=>b.localeCompare(a));

  return (
    <div style={{ display:'flex', height:'100%', fontFamily:font, color:C.text, overflow:'hidden' }}>

      {/* ─── 사이드바 ─── */}
      <div style={{ width:200, minWidth:200, background:'#080b14', borderRight:`1px solid ${C.border}`, display:'flex', flexDirection:'column', padding:16, gap:12, overflowY:'auto' }}>
        <button onClick={()=>setUpload(true)} style={{ width:'100%', padding:'10px', borderRadius:10, border:'none', background:C.accent, color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:font }}>
          + 문서 업로드
        </button>

        {/* 카테고리 필터 */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:C.textDim, marginBottom:6 }}>카테고리</div>
          {['전체',...CATEGORIES.map(c=>c.id)].map(cat=>{
            const c = getCat(cat);
            const cnt = cat==='전체'?docs.length:docs.filter(d=>d.category===cat).length;
            return (
              <button key={cat} onClick={()=>setFilter(cat)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', width:'100%', padding:'6px 8px', borderRadius:6, border:'none', background:filterCat===cat?(cat==='전체'?C.accentSoft:c.color+'18'):'transparent', color:filterCat===cat?(cat==='전체'?C.accent:c.color):C.textMid, fontSize:12, cursor:'pointer', fontFamily:font, textAlign:'left', marginBottom:2 }}>
                <span>{cat==='전체'?'📂':c.icon} {cat}</span>
                <span style={{ fontSize:10, opacity:.7 }}>{cnt}</span>
              </button>
            );
          })}
        </div>

        {/* 연도 필터 */}
        <div>
          <div style={{ fontSize:11, fontWeight:600, color:C.textDim, marginBottom:6 }}>연도</div>
          {years.map(y=>(
            <button key={y} onClick={()=>setYear(y)} style={{ display:'block', width:'100%', padding:'6px 8px', borderRadius:6, border:'none', background:filterYear===y?C.accentSoft:'transparent', color:filterYear===y?C.accent:C.textMid, fontSize:12, cursor:'pointer', fontFamily:font, textAlign:'left', marginBottom:2 }}>
              {y==='전체'?'전체 연도':y+'년'}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 메인 ─── */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        {/* 헤더 */}
        <div style={{ padding:'12px 20px', borderBottom:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 문서 검색..." style={{ flex:1, minWidth:180, padding:'8px 14px', borderRadius:8, border:`1px solid ${C.border}`, background:C.card, color:C.text, fontSize:12, fontFamily:font, outline:'none' }} onFocus={e=>e.target.style.borderColor=C.accent} onBlur={e=>e.target.style.borderColor=C.border}/>
          <div style={{ fontSize:11, color:C.textDim }}>{filtered.length}개 문서</div>
          <div style={{ display:'flex', border:`1px solid ${C.border}`, borderRadius:6, overflow:'hidden' }}>
            {[['grid','▦'],['list','≡']].map(([v,lbl])=>(
              <button key={v} onClick={()=>setView(v)} style={{ padding:'6px 12px', border:'none', background:viewMode===v?C.accent:'transparent', color:viewMode===v?'#fff':C.textMid, fontSize:13, cursor:'pointer' }}>{lbl}</button>
            ))}
          </div>
        </div>

        {/* 문서 목록 */}
        <div style={{ flex:1, overflowY:'auto', padding:16 }}>
          {loading ? (
            <div style={{ textAlign:'center', padding:60, color:C.textDim }}>로딩 중...</div>
          ) : filtered.length===0 ? (
            <div style={{ textAlign:'center', padding:60, color:C.textDim }}>
              <div style={{ fontSize:40, marginBottom:12 }}>📂</div>
              <div style={{ fontSize:13 }}>
                {docs.length===0?'아직 업로드된 문서가 없습니다':'검색 결과가 없습니다'}
              </div>
              {docs.length===0&&<button onClick={()=>setUpload(true)} style={{ marginTop:16, padding:'9px 20px', borderRadius:10, border:'none', background:C.accent, color:'#fff', fontSize:13, cursor:'pointer', fontFamily:font }}>첫 문서 업로드</button>}
            </div>
          ) : viewMode==='grid' ? (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
              {filtered.map(doc=>{
                const cat=getCat(doc.category);
                return (
                  <Card key={doc.id} onClick={()=>setSelected(doc)} style={{ padding:16, display:'flex', flexDirection:'column', gap:8 }}>
                    <div style={{ fontSize:28, textAlign:'center' }}>{cat.icon}</div>
                    <div style={{ fontSize:12, fontWeight:700, color:C.text, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.name}</div>
                    <div style={{ display:'flex', justifyContent:'center', gap:4, flexWrap:'wrap' }}>
                      <Badge label={cat.id} color={cat.color} small/>
                      <Badge label={doc.file_type?.toUpperCase()||'FILE'} color={C.textDim} small/>
                      {doc.parse_status==='done'&&<Badge label="AI 읽기 가능" color={C.green} small/>}
                    </div>
                    <div style={{ fontSize:10, color:C.textDim, textAlign:'center' }}>{doc.uploaded_by_name} · {doc.year}년</div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
              {filtered.map(doc=>{
                const cat=getCat(doc.category);
                return (
                  <Card key={doc.id} onClick={()=>setSelected(doc)} style={{ padding:'12px 16px', display:'flex', alignItems:'center', gap:12 }}>
                    <span style={{ fontSize:20 }}>{cat.icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:C.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.name}</div>
                      {doc.description&&<div style={{ fontSize:11, color:C.textDim, marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{doc.description}</div>}
                    </div>
                    <div style={{ display:'flex', gap:6, alignItems:'center', flexShrink:0 }}>
                      <Badge label={cat.id} color={cat.color} small/>
                      <Badge label={doc.file_type?.toUpperCase()||'FILE'} color={C.textDim} small/>
                      {doc.parse_status==='done'&&<Badge label="AI" color={C.green} small/>}
                      <span style={{ fontSize:11, color:C.textDim }}>{doc.year}년</span>
                      <span style={{ fontSize:11, color:C.textDim }}>{formatSize(doc.file_size)}</span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 모달들 */}
      {showUpload && <UploadModal teacher={teacher} onClose={()=>setUpload(false)} onUploaded={fetchDocs}/>}
      {selected   && <DocDetailModal doc={selected} teacher={teacher} onClose={()=>setSelected(null)} onDelete={handleDelete}/>}
    </div>
  );
}
