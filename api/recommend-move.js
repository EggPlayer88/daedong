// ═══════════════════════════════════════════════════════════════════
//  api/recommend-move.js
//  옮길 시간 추천 (시수변경/교환수업 폼의 "AI 추천받기" 버튼)
// ═══════════════════════════════════════════════════════════════════
//
//  요청: { sourceDate, sourceClassId, sourceDay, sourcePeriod,
//          sourceTeacherId, sourceSubjectId, allTeachers }
//  응답: { options: [
//    { type: 'period_move', target: {...}, score, reason, approval: 'admin_only' },
//    { type: 'swap', partner: {...}, score, reason, approval: 'partner_required' },
//    ...
//  ] }
//
//  분류 기준:
//   - 본인 빈 시간으로 이동 → period_move (관리자 승인만)
//   - 같은 학급의 다른 교사 셀과 교환 → swap (그 교사 + 관리자 승인)
//   - 다른 학급의 다른 교사 셀과 교환 → swap (경고 표시)
// ═══════════════════════════════════════════════════════════════════

import {
  fetchTimetableContext, expandTimetableData, toTeacherView,
  findFreeSlotsForTeacher, slotKey,
} from './_timetableContext';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    sourceDate, sourceClassId, sourceDay, sourcePeriod,
    sourceTeacherId, sourceSubjectId, allTeachers,
  } = req.body;

  if (!sourceDate || !sourceDay || !sourcePeriod || !sourceTeacherId) {
    return res.status(400).json({ error: 'sourceDate, sourceDay, sourcePeriod, sourceTeacherId required' });
  }

  try {
    const { activeTimetable } = await fetchTimetableContext(sourceDate, sourceDate);
    if (!activeTimetable) {
      return res.status(400).json({ error: '활성 시간표가 없습니다' });
    }

    const classTT = expandTimetableData(activeTimetable.data);
    const teacherTT = toTeacherView(classTT);
    const sourceKey = slotKey(sourceDay, sourcePeriod);

    // 1. 본인 빈 시간 (period_move 후보)
    const myFreeSlots = findFreeSlotsForTeacher(teacherTT, sourceTeacherId, sourceKey);

    // 2. 같은 학급의 다른 교사 셀 (1:1 swap 후보, 같은 학급 우선)
    const sameClassSlots = collectSameClassSwapCandidates({
      classTT, sourceClassId, sourceKey, sourceTeacherId,
    });

    // 3. 다른 학급의 다른 교사 셀 (1:1 swap 후보, 경고 대상)
    // — 너무 많으니 일단 같은 학년/같은 과목 정도로만 제한
    const otherClassSlots = collectOtherClassSwapCandidates({
      classTT, teacherTT, sourceClassId, sourceKey, sourceTeacherId, sourceSubjectId, allTeachers,
    });

    // 4. 옵션 점수 계산
    const options = [];

    // period_move 옵션 (최대 2개)
    myFreeSlots.slice(0, 5).forEach(slot => {
      const score = scoreMoveOption(slot, sourceDay, sourcePeriod);
      options.push({
        type: 'period_move',
        target: { classId: sourceClassId, day: slot.day, period: slot.period },
        score,
        approval: 'admin_only',
        sameClass: true,
      });
    });

    // 같은 학급 swap (최대 3개)
    sameClassSlots.slice(0, 5).forEach(s => {
      const score = scoreSwapOption(s, true);
      options.push({
        type: 'swap',
        partner: s,
        score,
        approval: 'partner_required',
        sameClass: true,
      });
    });

    // 다른 학급 swap (최대 2개, 경고)
    otherClassSlots.slice(0, 3).forEach(s => {
      const score = scoreSwapOption(s, false);
      options.push({
        type: 'swap',
        partner: s,
        score,
        approval: 'partner_required',
        sameClass: false,
      });
    });

    if (options.length === 0) {
      return res.status(200).json({
        options: [],
        message: '옮길 만한 시간을 찾을 수 없습니다. 보강이나 자습 처리를 고려해보세요.',
      });
    }

    // 5. 점수 정렬 후 상위 3개
    options.sort((a, b) => b.score - a.score);
    const top = options.slice(0, 3);

    // 6. Claude API 로 자연어 사유 생성
    const aiReasons = await generateMoveReasons({
      sourceClassId, sourceDay, sourcePeriod, sourceSubjectId, sourceTeacherId,
      options: top, allTeachers,
    });

    const recommendations = top.map((opt, i) => ({
      ...opt,
      reason: aiReasons[i] || defaultReason(opt),
    }));

    return res.status(200).json({ options: recommendations });

  } catch (e) {
    console.error('recommend-move error:', e);
    return res.status(500).json({ error: e.message });
  }
}


// ─── 같은 학급 안에서 swap 후보 수집 ───
function collectSameClassSwapCandidates({ classTT, sourceClassId, sourceKey, sourceTeacherId }) {
  const cls = classTT[sourceClassId] || {};
  const candidates = [];
  for (const [k, slot] of Object.entries(cls)) {
    if (k === sourceKey) continue;
    if (!slot?.tid || slot.tid === sourceTeacherId) continue;
    if (slot.type) continue; // 창체/자습 등
    const [day, p] = k.split('-');
    candidates.push({
      classId: sourceClassId,
      day,
      period: parseInt(p, 10),
      sid: slot.sid,
      tid: slot.tid,
    });
  }
  return candidates;
}

// ─── 다른 학급에서 swap 후보 수집 (제한적) ───
function collectOtherClassSwapCandidates({
  classTT, teacherTT, sourceClassId, sourceKey, sourceTeacherId, sourceSubjectId, allTeachers,
}) {
  const candidates = [];
  for (const [cid, cls] of Object.entries(classTT)) {
    if (cid === sourceClassId) continue;
    for (const [k, slot] of Object.entries(cls)) {
      if (k === sourceKey) continue;
      if (!slot?.tid || slot.tid === sourceTeacherId) continue;
      if (slot.type) continue;
      // 같은 과목인 경우만 (다른 과목까지 추천하면 노이즈)
      if (slot.sid !== sourceSubjectId) continue;
      const [day, p] = k.split('-');
      candidates.push({
        classId: cid,
        day,
        period: parseInt(p, 10),
        sid: slot.sid,
        tid: slot.tid,
      });
    }
  }
  return candidates;
}

// ─── 점수 계산 ───
function scoreMoveOption(slot, sourceDay, sourcePeriod) {
  // 본인 빈 시간 = 가장 깔끔. 기본 점수 100.
  let score = 100;
  // 같은 요일 우선
  if (slot.day === sourceDay) score += 20;
  // 너무 이른/늦은 교시 감점
  if (slot.period === 1 || slot.period === 7) score -= 10;
  return score;
}

function scoreSwapOption(slot, sameClass) {
  let score = sameClass ? 80 : 40; // 같은 학급이 우선
  // 너무 늦은 교시 감점
  if (slot.period === 7) score -= 10;
  return score;
}

function defaultReason(opt) {
  if (opt.type === 'period_move') return `본인 빈 시간 (${opt.target.day}${opt.target.period})`;
  if (opt.type === 'swap' && opt.sameClass) return `같은 학급 ${opt.partner.day}${opt.partner.period} 교환`;
  return `다른 학급 교환 (경고)`;
}


// ─── Claude API: 옵션별 자연어 사유 ───
async function generateMoveReasons({
  sourceClassId, sourceDay, sourcePeriod, sourceSubjectId, sourceTeacherId,
  options, allTeachers,
}) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return options.map(defaultReason);
  }

  const teacherMap = {};
  (allTeachers || []).forEach(t => { teacherMap[t.id] = t; });
  const tname = (id) => teacherMap[id]?.name || id;

  const systemPrompt = `당신은 학교 시간표 변동 추천 도우미입니다.
시간 이동 옵션 목록이 주어지면, 각 옵션이 왜 좋은 선택인지 한 줄(25자 이내)로 추천 사유를 작성합니다.

규칙:
- period_move: 본인 빈 시간으로 이동 → "관리자 승인만 필요"라는 점 강조
- swap (같은 학급): 같은 학급 안 교환 → 자연스러움 강조
- swap (다른 학급): 다른 학급 → "교환 가능하지만 같은 학급 우선 권장" 강조
- 한국어 자연스럽게, 공손한 어조`;

  const userPrompt = `원본 수업: ${sourceClassId} ${sourceDay}요일 ${sourcePeriod}교시 (${tname(sourceTeacherId)})

옵션 목록:
${options.map((o, i) => {
  if (o.type === 'period_move') {
    return `${i+1}. [본인 빈 시간 이동] ${o.target.day}요일 ${o.target.period}교시로 이동 (승인: 관리자만)`;
  }
  if (o.type === 'swap' && o.sameClass) {
    return `${i+1}. [같은 학급 교환] ${o.partner.day}요일 ${o.partner.period}교시 ${tname(o.partner.tid)}선생님 수업과 교환`;
  }
  return `${i+1}. [다른 학급 교환] ${o.partner.classId} ${o.partner.day}요일 ${o.partner.period}교시 ${tname(o.partner.tid)}선생님 수업과 교환 (경고: 같은 학급이 아님)`;
}).join('\n')}

각 옵션별로 추천 사유를 한 줄씩:
1. [사유]
2. [사유]
...`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) return options.map(defaultReason);
    const data = await response.json();
    const text = data.content[0]?.text || '';
    const lines = text.split('\n').filter(l => /^\d+\./.test(l.trim()));
    const reasons = lines.map(l => l.replace(/^\d+\.\s*/, '').trim());
    return options.map((o, i) => reasons[i] || defaultReason(o));
  } catch (e) {
    return options.map(defaultReason);
  }
}
