// ═══════════════════════════════════════════════════════════════════
//  DashboardPage — 정리 작업 2-B 대시보드 재설계
// ═══════════════════════════════════════════════════════════════════
//  레이아웃 (결정 1): 좌우 분할
//    ┌─────────────────┬─────────┐
//    │ 오늘 내 수업       │ 메모장   │
//    ├─────────────────┤         │
//    │ 내 일정          │         │
//    │                 ├─────────┤
//    │                 │ AI 비서  │
//    └─────────────────┴─────────┘
//  좁은 화면 (< 900px) 에서는 위아래 스택으로 자동 전환.
//
//  Props:
//    - teacher: 현재 사용자 (teachers 테이블 row + Google fallback)
//    - onNavigate(pageId): 다른 페이지 이동 콜백 (AI 큰 화면 등)
// ═══════════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { getNote, saveNote } from '../lib/notesAPI';
import { DAYS, gS, gC } from '../lib/timetableData';
import ChatView from '../components/ChatView';

// ─── 스타일 (SchedulePage 와 동일 팔레트) ───
const C = {
  bg:'#0c0f1a', card:'#141929', cardHover:'#1a2038',
  border:'#232940', borderLight:'#2d3555',
  accent:'#4f8cff', accentSoft:'#4f8cff18',
  text:'#e8ecf4', textMid:'#8b95ad', textDim:'#5a6480',
  green:'#34d399', yellow:'#fbbf24', red:'#f87171',
  purple:'#a78bfa', orange:'#fb923c', pink:'#f472b6', teal:'#2dd4bf',
};
const font = "'Pretendard','Noto Sans KR',-apple-system,sans-serif";

const PRIORITY_C = { '높음': C.red, '중간': C.yellow, '낮음': C.green };
const ROLE_LABEL = { super_admin: '슈퍼관리자', timetable_admin: '시간표관리자', teacher: '교사' };

// 카테고리 (SchedulePage 와 동일 — 일정 카드 색)
const CATEGORIES = {
  '수업':  { color: '#4f8cff', icon: '📚' },
  '행사':  { color: '#fb923c', icon: '🎉' },
  '연수':  { color: '#a78bfa', icon: '📖' },
  '회의':  { color: '#2dd4bf', icon: '💬' },
  '평가':  { color: '#f87171', icon: '📝' },
  '행정':  { color: '#8b95ad', icon: '📋' },
  '기타':  { color: '#fbbf24', icon: '📌' },
};
const getCat = (id) => CATEGORIES[id] || CATEGORIES['기타'];

// 한국 요일 인덱스: Date.getDay() → '월'..'금' 또는 null (주말)
function todayKorDay() {
  const d = new Date().getDay(); // 일=0, 월=1, ..., 토=6
  if (d === 0 || d === 6) return null;
  return DAYS[d - 1]; // DAYS = ['월','화','수','목','금']
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ─── 공용 Badge ───
function Badge({ label, color, small }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 3,
      padding: small ? '1px 7px' : '3px 10px',
      borderRadius: 20, fontSize: small ? 10 : 11, fontWeight: 600,
      background: color + '18', color, border: `1px solid ${color}25`,
    }}>{label}</span>
  );
}

// ─── 공용 패널 래퍼 (카드) ───
function Panel({ title, subtitle, children, contentPadding = 14, headerExtra = null }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
      display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
    }}>
      <div style={{
        padding: '12px 16px', borderBottom: `1px solid ${C.border}`, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>{subtitle}</div>}
        </div>
        {headerExtra}
      </div>
      <div style={{ padding: contentPadding, overflowY: 'auto', flex: 1, minHeight: 0 }}>
        {children}
      </div>
    </div>
  );
}

// ─── 오늘 내 수업 ───
function TodayClasses({ teacher }) {
  const [activeTT, setActiveTT] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // 활성 시간표 직접 조회 — TimetableViewer 와 동일 패턴
    supabase.from('timetables').select('id, data').eq('is_active', true).maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else setActiveTT(data || null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const todayDay = todayKorDay();

  // 본인 수업 추출 — data[classId]['day-period'] 의 tid 가 teacher.id 인 슬롯
  const myClasses = useMemo(() => {
    if (!activeTT?.data || !todayDay || !teacher?.id) return [];
    const result = [];
    const data = activeTT.data;
    for (const [classId, classSlots] of Object.entries(data)) {
      for (const [key, slot] of Object.entries(classSlots)) {
        const [day, periodStr] = key.split('-');
        if (day !== todayDay) continue;
        const period = parseInt(periodStr, 10);
        // 일반 슬롯: { sid, tid }, 특별활동: { type:'special', name, tid:담임 }
        if (slot && slot.tid === teacher.id) {
          result.push({
            period,
            classId,
            sid: slot.sid || null,
            name: slot.type === 'special' ? (slot.name || '특별활동') : null,
            special: slot.type === 'special',
          });
        }
      }
    }
    return result.sort((a, b) => a.period - b.period);
  }, [activeTT, todayDay, teacher?.id]);

  if (loading) {
    return <div style={{ padding: 12, fontSize: 12, color: C.textDim }}>불러오는 중...</div>;
  }
  if (error) {
    return <div style={{ padding: 12, fontSize: 12, color: C.red }}>⚠️ {error}</div>;
  }

  if (!activeTT) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: C.textDim, fontSize: 12, lineHeight: 1.6 }}>
        활성 시간표가 없습니다.
        <div style={{ fontSize: 11, marginTop: 4, color: C.textDim }}>
          시간표 관리자가 시간표를 활성화하면 이곳에 표시됩니다.
        </div>
      </div>
    );
  }
  if (!todayDay) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
        🌙 오늘은 주말입니다.
      </div>
    );
  }
  if (myClasses.length === 0) {
    return (
      <div style={{ padding: '16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
        🎉 오늘은 수업이 없습니다.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {myClasses.map((c, i) => {
        const cls = gC(c.classId);
        const sub = c.sid ? gS(c.sid) : null;
        const labelLeft = c.special ? c.name : (sub?.name || '?');
        return (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 12px', background: C.bg, borderRadius: 8,
            border: `1px solid ${C.border}`,
          }}>
            <div style={{
              minWidth: 44, textAlign: 'center',
              fontSize: 11, fontWeight: 700, color: C.accent,
              background: C.accentSoft, padding: '4px 8px', borderRadius: 6,
            }}>
              {c.period}교시
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                {labelLeft}
                {c.special && <span style={{ marginLeft: 6, fontSize: 10, color: C.purple }}>· 특별활동</span>}
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                {cls?.name || c.classId}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── 내 일정 (오늘 + 이번 주) ───
function MySchedules({ teacher }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const today = todayISO();
    const weekEnd = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    })();
    supabase.from('events').select('*').gte('start_date', today).lte('start_date', weekEnd).order('start_date')
      .then(({ data }) => {
        if (cancelled) return;
        setEvents(data || []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [teacher?.id, teacher?.dept]);

  // 본인 관련 필터링 — App.jsx 의 DashboardView 와 동일 규칙 (정리 1·2-A)
  const isHomeroom = !!teacher?.homeroom;
  const myEvents = useMemo(() => events.filter(e => {
    const tags = Array.isArray(e.tags) ? e.tags : [];
    const isPrivate = tags.length === 0;
    if (isPrivate) return e.created_by === teacher?.id;
    if (tags.includes('전체')) return true;
    if (tags.includes('담임') && isHomeroom) return true;
    if (tags.includes('교과')) return true;
    if (e.dept && e.dept === teacher?.dept) return true;
    if (e.created_by === teacher?.id) return true;
    return false;
  }), [events, teacher?.id, teacher?.dept, isHomeroom]);

  const today = todayISO();
  const todayEvents = myEvents.filter(e => e.start_date === today);
  const weekEvents = myEvents.filter(e => e.start_date > today);

  if (loading) {
    return <div style={{ padding: 12, fontSize: 12, color: C.textDim }}>불러오는 중...</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Section title={`오늘 (${todayEvents.length}건)`} accent={C.red}>
        {todayEvents.length === 0
          ? <EmptyHint text="오늘 일정 없음"/>
          : todayEvents.map(e => <EventRow key={e.id} ev={e}/>)
        }
      </Section>
      <Section title={`이번 주 (${weekEvents.length}건)`} accent={C.yellow}>
        {weekEvents.length === 0
          ? <EmptyHint text="이번 주 일정 없음"/>
          : weekEvents.map(e => <EventRow key={e.id} ev={e} showDate/>)
        }
      </Section>
    </div>
  );
}

function Section({ title, accent, children }) {
  return (
    <div>
      <div style={{
        fontSize: 11, fontWeight: 700, color: accent,
        marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>
  );
}

function EmptyHint({ text }) {
  return (
    <div style={{
      padding: '10px 12px', borderRadius: 8,
      border: `1px dashed ${C.border}`,
      fontSize: 11, color: C.textDim,
    }}>{text}</div>
  );
}

function EventRow({ ev, showDate }) {
  const cat = getCat(ev.category);
  const tags = Array.isArray(ev.tags) ? ev.tags : [];
  const isPrivate = tags.length === 0;
  const prColor = PRIORITY_C[ev.priority] || C.textDim;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', background: C.bg, borderRadius: 8,
      border: `1px solid ${C.border}`, borderLeft: `3px solid ${cat.color}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {ev.priority && (
            <span title={`우선순위: ${ev.priority}`} style={{
              width: 7, height: 7, borderRadius: '50%', background: prColor, flexShrink: 0,
            }}/>
          )}
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.title}
          </span>
          {showDate && (
            <span style={{ fontSize: 10, color: C.textDim, flexShrink: 0 }}>
              · {ev.start_date?.slice(5).replace('-','/')}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
          <Badge label={`${cat.icon} ${cat.id || ev.category || '기타'}`} color={cat.color} small/>
          {isPrivate && <Badge label="🔒 개인" color={C.purple} small/>}
          {tags.map(t => <Badge key={t} label={t} color={C.accent} small/>)}
          {ev.dept && <Badge label={ev.dept} color={C.teal} small/>}
        </div>
      </div>
    </div>
  );
}

// ─── 메모장 ───
function NotePanel({ teacher }) {
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');  // 마지막으로 저장된 내용
  const [updatedAt, setUpdatedAt] = useState(null);
  const [status, setStatus] = useState('idle'); // 'idle' | 'loading' | 'saving' | 'saved' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const initializedRef = useRef(false);
  const saveTimerRef = useRef(null);

  // 마운트 시 기존 메모 로드
  useEffect(() => {
    let cancelled = false;
    if (!teacher?.id) return;
    setStatus('loading');
    getNote(teacher.id)
      .then(note => {
        if (cancelled) return;
        setContent(note.content || '');
        setSavedContent(note.content || '');
        setUpdatedAt(note.updated_at);
        initializedRef.current = true;
        setStatus('idle');
      })
      .catch(err => {
        if (cancelled) return;
        setErrorMsg(err.message || '메모 로드 실패');
        setStatus('error');
        initializedRef.current = true; // 빈 메모로 시작
      });
    return () => { cancelled = true; };
  }, [teacher?.id]);

  // debounce 자동 저장 (1.5초)
  useEffect(() => {
    if (!initializedRef.current) return;
    if (content === savedContent) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      setStatus('saving');
      saveNote(teacher.id, content)
        .then(saved => {
          setSavedContent(content);
          setUpdatedAt(saved?.updated_at || new Date().toISOString());
          setStatus('saved');
        })
        .catch(err => {
          setErrorMsg(err.message || '저장 실패');
          setStatus('error');
        });
    }, 1500);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [content, savedContent, teacher?.id]);

  // 상태 라벨
  const statusLabel = (() => {
    if (status === 'loading') return '불러오는 중...';
    if (status === 'saving') return '저장 중...';
    if (status === 'error') return `⚠️ ${errorMsg || '저장 실패'}`;
    if (status === 'saved' || updatedAt) {
      return `✓ ${formatRelative(updatedAt)} 저장됨`;
    }
    return '';
  })();
  const statusColor = status === 'error' ? C.red : C.textDim;

  return (
    <Panel
      title="📝 메모장"
      contentPadding={0}
      headerExtra={
        <span style={{ fontSize: 10, color: statusColor }}>{statusLabel}</span>
      }
    >
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="여기에 자유롭게 메모를 적으세요. 자동으로 저장됩니다."
        style={{
          width: '100%', height: '100%', minHeight: 120, padding: 14,
          background: 'transparent', border: 'none', resize: 'none', outline: 'none',
          color: C.text, fontSize: 13, fontFamily: font, lineHeight: 1.7,
          boxSizing: 'border-box',
        }}
      />
    </Panel>
  );
}

// 상대 시간 표시 (방금 / N분 전 / N시간 전 / 날짜)
function formatRelative(iso) {
  if (!iso) return '저장 안 됨';
  const t = new Date(iso).getTime();
  const diff = Math.max(0, Date.now() - t);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return '방금';
  if (sec < 60) return `${sec}초 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  return iso.slice(0, 10);
}

// ─── 메인 ───
export default function DashboardPage({ teacher, onNavigate }) {
  // 반응형: 좁은 화면 (< 900px) 에서는 위아래 스택
  const [narrow, setNarrow] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = (e) => setNarrow(e.matches);
    // 브라우저 호환: addEventListener 가 있으면 그걸 쓰고, 아니면 addListener
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', handler);
      else mq.removeListener(handler);
    };
  }, []);

  // 메모 영역의 "1분 전 저장됨" 라벨을 주기적으로 갱신 (1분마다 rerender 트리거)
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const roleLabel = ROLE_LABEL[teacher?.role] || '교사';

  return (
    <div style={{
      height: '100%', overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
      padding: 20, gap: 16,
      fontFamily: font, color: C.text, boxSizing: 'border-box',
    }}>
      {/* 헤더 (인사말) */}
      <div style={{ flexShrink: 0 }}>
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: C.text }}>
          {teacher?.name || '선생님'} 선생님, 좋은 하루입니다 ☀️
        </h1>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: C.textMid }}>
          {roleLabel}{teacher?.dept ? ` · ${teacher.dept}` : ''}
          {teacher?.homeroom ? ` · ${teacher.homeroom} 담임` : ''}
        </p>
      </div>

      {/* 본문 — 좌우 분할 또는 위아래 스택 */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'grid',
        gridTemplateColumns: narrow ? '1fr' : 'minmax(0, 1.6fr) minmax(0, 1fr)',
        gridTemplateRows: narrow ? 'auto auto auto auto' : '1fr',
        gap: 14,
        overflowY: narrow ? 'auto' : 'hidden',
      }}>
        {/* 왼쪽 컬럼 */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 14,
          minHeight: narrow ? 'auto' : 0,
        }}>
          <div style={{ flex: narrow ? '0 0 auto' : '0 0 auto', minHeight: narrow ? 'auto' : 180, maxHeight: narrow ? 'none' : '45%', display: 'flex', flexDirection: 'column' }}>
            <Panel title="📚 오늘 내 수업" subtitle={todayKorDay() ? `${todayKorDay()}요일` : '주말'}>
              <TodayClasses teacher={teacher}/>
            </Panel>
          </div>
          <div style={{ flex: narrow ? '0 0 auto' : '1 1 auto', minHeight: narrow ? 'auto' : 180, display: 'flex', flexDirection: 'column' }}>
            <Panel title="📅 내 일정" subtitle="오늘 + 이번 주 (본인 관련 일정)">
              <MySchedules teacher={teacher}/>
            </Panel>
          </div>
        </div>

        {/* 오른쪽 컬럼 */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: 14,
          minHeight: narrow ? 'auto' : 0,
        }}>
          <div style={{ flex: narrow ? '0 0 auto' : '0 0 auto', minHeight: narrow ? 200 : 180, maxHeight: narrow ? 'none' : '40%', display: 'flex', flexDirection: 'column' }}>
            <NotePanel teacher={teacher}/>
          </div>
          <div style={{ flex: narrow ? '0 0 auto' : '1 1 auto', minHeight: narrow ? 320 : 220, display: 'flex', flexDirection: 'column' }}>
            <div style={{
              background: C.card, border: `1px solid ${C.border}`, borderRadius: 14,
              display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden',
              height: '100%',
            }}>
              <ChatView teacher={teacher} compact onOpenFull={onNavigate ? () => onNavigate('chat') : undefined}/>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
