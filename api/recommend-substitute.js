// ═══════════════════════════════════════════════════════════════════
//  api/recommend-substitute.js
//  보강 가능 교사 추천 (변동 요청 폼의 "AI 추천받기" 버튼이 호출)
// ═══════════════════════════════════════════════════════════════════
//
//  요청: { sourceDate, sourceClassId, sourceDay, sourcePeriod,
//          sourceTeacherId, sourceSubjectId, allTeachers }
//  응답: { recommendations: [{ teacherId, teacherName, score, reason }, ...] }
// ═══════════════════════════════════════════════════════════════════

import {
  fetchTimetableContext, expandTimetableData, toTeacherView, findFreeTeachersAt,
  slotKey, supabase,
} from './_timetableContext.js';

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
    // 1. 그 날짜의 시간표 컨텍스트 조회
    const { activeTimetable, approvedChanges } = await fetchTimetableContext(sourceDate, sourceDate);
    if (!activeTimetable) {
      return res.status(400).json({ error: '활성 시간표가 없습니다' });
    }

    // 2. 학급별 → 교사별 뷰로 트랜스포즈
    const classTT = expandTimetableData(activeTimetable.data);
    const teacherTT = toTeacherView(classTT);

    // 3. 그 시간 빈 교사 찾기
    const allTeacherIds = (allTeachers || []).map(t => t.id);
    const freeTeacherIds = findFreeTeachersAt(allTeacherIds, teacherTT, sourceDay, sourcePeriod)
      .filter(id => id !== sourceTeacherId); // 요청자 본인 제외

    if (freeTeacherIds.length === 0) {
      return res.status(200).json({
        recommendations: [],
        message: '해당 시간에 빈 교사가 없습니다. 다른 시간으로 변경하거나 자습 처리를 고려해보세요.',
      });
    }

    // 4. 교사 정보 조회 (과목 매칭용)
    const teacherInfoMap = {};
    (allTeachers || []).forEach(t => { teacherInfoMap[t.id] = t; });

    // 요청자 교사 정보
    const sourceTeacher = teacherInfoMap[sourceTeacherId];
    const sourceSubjectName = req.body.sourceSubjectName || sourceSubjectId;

    // 5. 각 후보 교사의 컨텍스트 수집
    const candidates = freeTeacherIds.map(tid => {
      const t = teacherInfoMap[tid] || {};
      const totalHours = Object.keys(teacherTT[tid] || {}).length;
      const sameSubject = t.subject === sourceTeacher?.subject;
      const sameDept = t.dept && sourceTeacher?.dept && t.dept === sourceTeacher.dept;
      return {
        id: tid,
        name: t.name || tid,
        subject: t.subject,
        dept: t.dept,
        totalHours,
        sameSubject,
        sameDept,
      };
    });

    // 6. 점수 계산 (Phase 2B 는 단순 휴리스틱, Phase 3 에서 더 정교화)
    candidates.forEach(c => {
      let score = 0;
      const reasons = [];
      if (c.sameSubject) { score += 50; reasons.push('같은 과목'); }
      if (c.sameDept) { score += 20; reasons.push('같은 부서'); }
      if (c.totalHours <= 18) { score += 15; reasons.push('주당 시수 적음'); }
      else if (c.totalHours >= 22) { score -= 10; reasons.push('주당 시수 많음'); }
      score += Math.max(0, 30 - c.totalHours); // 시수 적을수록 가산
      c.score = score;
      c.heuristicReason = reasons.join(', ') || '해당 시간 빈 교사';
    });

    // 7. 점수순 정렬, 상위 5개만 Claude 에게
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, Math.min(5, candidates.length));

    // 8. Claude API 로 자연어 추천 사유 생성
    const aiReasons = await generateRecommendReasons({
      sourceTeacher: sourceTeacher,
      sourceSubject: sourceSubjectName,
      sourceDay, sourcePeriod, sourceClassId,
      candidates: top,
    });

    // 9. 최종 추천 (상위 3개)
    const recommendations = top.slice(0, 3).map((c, i) => ({
      teacherId: c.id,
      teacherName: c.name,
      score: c.score,
      reason: aiReasons[i] || c.heuristicReason,
      sameSubject: c.sameSubject,
      sameDept: c.sameDept,
      totalHours: c.totalHours,
    }));

    return res.status(200).json({ recommendations });

  } catch (e) {
    console.error('recommend-substitute error:', e);
    return res.status(500).json({ error: e.message });
  }
}


// ─── Claude 호출: 후보별 추천 사유 생성 ───
async function generateRecommendReasons({ sourceTeacher, sourceSubject, sourceDay, sourcePeriod, sourceClassId, candidates }) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Claude 키 없을 때는 휴리스틱 사유만 반환
    return candidates.map(c => c.heuristicReason);
  }

  const systemPrompt = `당신은 학교 시간표 보강 교사 추천 도우미입니다.
보강 후보 교사 목록과 그들의 정보가 주어지면, 각 교사가 왜 이 보강에 적합한지 한 줄(20자 이내)로 추천 사유를 작성합니다.

규칙:
- 사실 기반으로만 작성. 데이터에 없는 것 추측 금지
- 같은 과목 > 같은 부서 > 시수 적음 순으로 강조
- 한국어 자연스럽게, 공손한 어조`;

  const userPrompt = `보강 정보:
- 요청자: ${sourceTeacher?.name || '?'} (${sourceTeacher?.subject || '?'})
- 시간: ${sourceDay}요일 ${sourcePeriod}교시, ${sourceClassId}
- 과목: ${sourceSubject}

후보 교사 (위에서부터 점수 높은 순):
${candidates.map((c, i) => `${i+1}. ${c.name} - 과목: ${c.subject || '?'}, 부서: ${c.dept || '?'}, 주당 시수: ${c.totalHours}, 같은 과목: ${c.sameSubject ? '예' : '아니오'}, 같은 부서: ${c.sameDept ? '예' : '아니오'}`).join('\n')}

각 후보별로 추천 사유를 한 줄씩 작성해주세요. 형식:
1. [사유]
2. [사유]
3. [사유]
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

    if (!response.ok) {
      console.warn('Claude API 호출 실패, 휴리스틱 사유 사용:', response.status);
      return candidates.map(c => c.heuristicReason);
    }

    const data = await response.json();
    const text = data.content[0]?.text || '';

    // "1. xxx", "2. xxx" 식으로 파싱
    const lines = text.split('\n').filter(l => /^\d+\./.test(l.trim()));
    const reasons = lines.map(l => l.replace(/^\d+\.\s*/, '').trim());

    // 후보 수만큼 매칭, 부족하면 휴리스틱으로 채움
    return candidates.map((c, i) => reasons[i] || c.heuristicReason);
  } catch (e) {
    console.warn('Claude 호출 예외:', e.message);
    return candidates.map(c => c.heuristicReason);
  }
}
