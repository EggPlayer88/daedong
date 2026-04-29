// ═══════════════════════════════════════════════════════════════════
//  api/timetable-chat.js
//  시간표 전용 일반 AI 비서 (시간표 페이지의 사이드 챗봇이 호출)
// ═══════════════════════════════════════════════════════════════════
//
//  요청: { messages, currentUser, weekStart, weekEnd, allTeachers }
//  응답: { content, contextUsed }
//
//  업무 AI 비서 (api/chat.js) 와 분리된 이유:
//   - 시스템 프롬프트가 시간표 도메인에 특화
//   - 시간표/변동/캘린더 컨텍스트만 주입
//   - 권한 분리: 일반 교사 권한 (관리자 권한은 Phase 3 의 admin-chat.js)
// ═══════════════════════════════════════════════════════════════════

import {
  fetchTimetableContext, expandTimetableData, toTeacherView,
  summarizeTeacherSchedule, slotKey, supabase,
} from './_timetableContext';

// 일반 교사용 시스템 프롬프트
const SYSTEM_PROMPT = `당신은 대동여중 시간표 전용 AI 비서입니다. 일반 교사가 시간표 페이지에서 시간표 관련 질문을 하면 도와줍니다.

[당신이 도와줄 수 있는 일]
1. 시간표 조회 — 본인/다른 교사 시간표 안내, 빈 시간 찾기
2. 변동 요청 흐름 안내 — 어떻게 보강 요청하는지, 승인 단계 설명
3. 변동 통계 — 본인 또는 학교 전체의 변동 횟수/유형 요약
4. 안내문 초안 — 본인 변동에 대한 학생/학부모 안내문 작성

[당신이 할 수 없는 일 — 명확히 거절]
- 시간표 직접 수정 (영구 변경) — "시간표관리자에게 문의해주세요"
- 다른 교사의 변동 요청을 대신 만들기 — "본인이 직접 작성해야 합니다"
- 시수 검증, 학교 전체 시간표 분석 — "관리자 AI 비서의 영역입니다"
- 시험기간 시간표 생성 — "관리자에게 문의해주세요"

[작성 원칙]
- 시간표 데이터에 없는 것 추측 금지. 모르면 "데이터에서 확인이 어렵습니다"
- 한국어로 공손하게, 간결하게
- 추천이나 제안 시 우선순위와 이유 함께 제시
- 학교 운영 흐름(수업·휴일·시험 등)을 자연스럽게 반영

답변할 때 마크다운 리스트나 표 적극 활용하세요.`;


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, currentUser, weekStart, weekEnd, allTeachers } = req.body;
  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다' });
  }

  try {
    // 1. 시간표 컨텍스트 조회 (이번 주 + 지난 주 정도)
    const ws = weekStart || new Date().toISOString().slice(0, 10);
    const we = weekEnd || ws;
    const { activeTimetable, approvedChanges, calendar } = await fetchTimetableContext(ws, we);

    // 2. 마지막 사용자 메시지에서 컨텍스트 단서 찾기
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user')?.content || '';

    // 3. 컨텍스트 텍스트 조립
    const contextText = await buildContextText({
      lastUserMsg, activeTimetable, approvedChanges, calendar,
      currentUser, allTeachers, weekStart: ws, weekEnd: we,
    });

    // 4. 시스템 프롬프트에 컨텍스트 추가
    const fullSystem = `${SYSTEM_PROMPT}

${contextText}`;

    // 5. Claude API 호출
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: fullSystem,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({
        error: err.error?.message || 'Claude API 오류',
      });
    }

    const data = await response.json();
    return res.status(200).json({
      content: data.content[0]?.text || '',
      contextUsed: {
        timetable: !!activeTimetable,
        changes: approvedChanges.length,
        calendar: Object.keys(calendar).length,
      },
    });

  } catch (e) {
    console.error('timetable-chat error:', e);
    return res.status(500).json({ error: e.message });
  }
}


// ─── 컨텍스트 텍스트 조립 ───
async function buildContextText({
  lastUserMsg, activeTimetable, approvedChanges, calendar,
  currentUser, allTeachers, weekStart, weekEnd,
}) {
  const parts = [];

  // 사용자 정보
  if (currentUser) {
    parts.push(`[현재 사용자]
- 이름: ${currentUser.name || '?'}
- ID: ${currentUser.id}
- 과목: ${currentUser.subject || '?'}
- 부서: ${currentUser.dept || '?'}`);
  }

  // 주차 정보
  parts.push(`[조회 주차]
${weekStart} ~ ${weekEnd}`);

  // 캘린더 정보
  if (Object.keys(calendar).length > 0) {
    const calLines = Object.entries(calendar).map(([date, e]) =>
      `- ${date}: ${e.type} (${e.note || '비고 없음'})`
    );
    parts.push(`[학사 캘린더 (이번 주)]\n${calLines.join('\n')}`);
  }

  // 활성 시간표 → 사용자 본인 + 질문에서 언급된 교사 시간표 요약
  if (activeTimetable) {
    const classTT = expandTimetableData(activeTimetable.data);
    const teacherTT = toTeacherView(classTT);

    // 학급/과목 매핑
    const subjectMap = {};
    const classMap = {};
    // allTeachers 에서 추출 가능한 정보 — 단순화: 클라이언트가 이름 매핑 등 제공
    (allTeachers || []).forEach(t => { /* placeholder */ });

    // 본인 시간표
    if (currentUser?.id) {
      const mySchedule = summarizeTeacherSchedule(currentUser.id, teacherTT, classMap, subjectMap);
      parts.push(`[본인 (${currentUser.name}) 주간 시간표]\n${mySchedule}`);
    }

    // 질문에서 언급된 다른 교사
    const mentioned = (allTeachers || []).filter(t =>
      t.id !== currentUser?.id && t.name && lastUserMsg.includes(t.name)
    );
    if (mentioned.length > 0) {
      mentioned.slice(0, 3).forEach(t => {
        const sched = summarizeTeacherSchedule(t.id, teacherTT, classMap, subjectMap);
        parts.push(`[${t.name} 주간 시간표]\n${sched}`);
      });
    }
  } else {
    parts.push(`[시간표] 활성 시간표 없음`);
  }

  // 변동 요약
  if (approvedChanges.length > 0) {
    parts.push(`[이번 주 승인된 변동 — ${approvedChanges.length}건]
${approvedChanges.map(c => `- ${c.source_date} ${c.source_class_id} ${c.source_day}${c.source_period} (${c.type})`).join('\n')}`);
  }

  // 사용자가 변동 통계를 물었는지 단서 검색
  if (/통계|얼마나|몇 건|몇번/.test(lastUserMsg)) {
    parts.push(await fetchChangeStats(currentUser?.id));
  }

  return parts.join('\n\n');
}


// ─── 변동 통계 (사용자가 통계 요청 시 호출) ───
async function fetchChangeStats(userId) {
  try {
    const { count: totalCount } = await supabase
      .from('timetable_changes')
      .select('id', { count: 'exact', head: true });

    const { count: approvedCount } = await supabase
      .from('timetable_changes')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved');

    let myCount = 0;
    if (userId) {
      const { count } = await supabase
        .from('timetable_changes')
        .select('id', { count: 'exact', head: true })
        .eq('requester_id', userId);
      myCount = count || 0;
    }

    return `[변동 통계 (전체 학기)]
- 전체 요청: ${totalCount || 0}건
- 승인 완료: ${approvedCount || 0}건
- 본인 요청: ${myCount}건`;
  } catch (e) {
    return `[변동 통계] 조회 실패`;
  }
}
