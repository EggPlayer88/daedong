import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ─── 관련 데이터 검색 ───
async function fetchContext(query, teacherId) {
  const results = { documents: [], schedules: [], tasks: [] };

  try {
    const keywords = query.replace(/[?.,!~\s]+/g, ' ').split(' ').filter(w => w.length > 1).slice(0, 5);

    if (keywords.length > 0) {
      // 1. 업무 검색
      const { data: taskData } = await supabase
        .from('tasks')
        .select('name, dept, area, type, period, priority, status, overview, steps, cautions, required_docs, handover_note')
        .or(keywords.map(k => `name.ilike.%${k}%,overview.ilike.%${k}%,dept.ilike.%${k}%,area.ilike.%${k}%`).join(','))
        .limit(5);
      if (taskData?.length) results.tasks = taskData;

      // 2. 문서 검색
      const { data: docs } = await supabase
        .from('documents')
        .select('name, category, description, file_type, year, uploaded_by_name, extracted_text, parse_status')
        .or(keywords.map(k => `name.ilike.%${k}%`).join(','))
        .limit(5);

      if (docs?.length) {
        results.documents = docs;
      } else {
        for (const kw of keywords.slice(0, 3)) {
          const { data: textDocs } = await supabase
            .from('documents')
            .select('name, category, description, file_type, year, uploaded_by_name, extracted_text, parse_status')
            .ilike('extracted_text', `%${kw}%`)
            .limit(3);
          if (textDocs?.length) {
            results.documents.push(...textDocs);
            break;
          }
        }
      }
    }

    // 3. 일정 검색
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
    const endDate = new Date(now.getFullYear(), now.getMonth() + 2, 0).toISOString().split('T')[0];

    const { data: schedules } = await supabase
      .from('schedules')
      .select('title, date, category, priority, visibility, tags, dept')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: true })
      .limit(20);

    if (schedules?.length) results.schedules = schedules;

  } catch (e) {
    console.error('Context fetch error:', e.message);
  }

  return results;
}

// ─── 시스템 프롬프트 조합 ───
function buildSystemPrompt(basePrompt, context, teacher) {
  let prompt = basePrompt;

  if (teacher) {
    prompt += `\n\n[현재 사용자 정보]
- 이름: ${teacher.name}
- 부서: ${teacher.dept || '미지정'}
- 담당 영역: ${teacher.area || '미지정'}
- 교과: ${teacher.subject || '미지정'}
- 역할: ${teacher.role || '교사'}
- 담임: ${teacher.homeroom || '비담임'}`;
  }

  if (context.tasks?.length) {
    prompt += '\n\n[관련 업무 데이터]';
    for (const t of context.tasks) {
      prompt += `\n\n--- 업무: ${t.name} (${t.dept}, ${t.area||''}) ---`;
      if (t.overview) prompt += `\n개요: ${t.overview}`;
      const steps = Array.isArray(t.steps) ? t.steps : JSON.parse(t.steps || '[]');
      if (steps.length) prompt += `\n절차:\n${steps.map((s,i)=>`${i+1}. ${s}`).join('\n')}`;
      const cautions = Array.isArray(t.cautions) ? t.cautions : JSON.parse(t.cautions || '[]');
      if (cautions.length) prompt += `\n주의사항:\n${cautions.map(c=>`- ${c}`).join('\n')}`;
      const docs = Array.isArray(t.required_docs) ? t.required_docs : JSON.parse(t.required_docs || '[]');
      if (docs.length) prompt += `\n필요문서: ${docs.join(', ')}`;
      if (t.handover_note) prompt += `\n인수인계: ${t.handover_note}`;
    }
  }

  if (context.documents?.length) {
    prompt += '\n\n[관련 문서 데이터]';
    for (const doc of context.documents) {
      prompt += `\n\n--- 문서: ${doc.name} (${doc.category}, ${doc.year}년, ${doc.file_type}) ---`;
      if (doc.description) prompt += `\n설명: ${doc.description}`;
      if (doc.extracted_text) {
        prompt += `\n본문:\n${doc.extracted_text.slice(0, 4000)}`;
        if (doc.extracted_text.length > 4000) prompt += '\n... (이하 생략)';
      }
    }
  }

  if (context.schedules?.length) {
    prompt += '\n\n[이번 달~다음 달 학교 일정]';
    for (const s of context.schedules) {
      const tags = Array.isArray(s.tags) ? s.tags.join(', ') : '';
      prompt += `\n- ${s.date} | ${s.title} | ${s.category || ''} | 중요도: ${s.priority || '보통'} | 대상: ${tags}`;
    }
  }

  return prompt;
}

// ─── 기본 시스템 프롬프트 ───
const BASE_PROMPT = `당신은 대동여중(대동여자중학교)의 학교 업무 AI 비서입니다.
이름은 "대동 AI 비서"입니다.

[학교 기본 정보]
- 학교명: 대동여자중학교 (대동여중)
- 학급: 9개 (1~3학년 각 3반)
- 교직원: 약 25명
- 부서: 교무부, 연구부, 학생안전부, 학생생활부, 진로부, 정보부
- 교과: 국어과, 영어과, 수학과, 과학과, 체육과

[당신의 6가지 역할]

역할 1: 학교 업무 안내 비서
- 학교 업무 전반에 대해 누구든 질문하면 명확하게 안내합니다.
- 업무 절차, 담당 부서, 시기, 필요 서류 등을 구체적으로 설명합니다.
- 관련 규정이 있으면 함께 안내합니다.

역할 2: 업무 담당자 맞춤 비서
- 질문한 교사의 부서, 담당 영역, 담임 여부를 파악하고 그에 맞는 정보를 제공합니다.
- 업무 담당자로서 알아야 할 세부사항을 안내합니다.
- 관련자(협조 부서 등)로서 알아야 할 내용도 구분해서 안내합니다.

역할 3: 문서 작성 비서
- 계획서, 보고서, 가정통신문, 회의록, 동의서, 안내문, 문자메시지 등 다양한 문서 초안을 작성합니다.
- 기존에 업로드된 문서가 있으면 그 스타일과 형식을 참고하여 작성합니다.
- "대동여중" 이름과 학교 상황에 맞게 구체적으로 작성합니다.
- 완성본에 가까운 초안을 제공하되, 날짜나 장소 등 확인이 필요한 부분은 [   ]로 빈칸 표시합니다.

역할 4: 문서 검토 비서
- 사용자가 작성한 문서를 꼼꼼하게 검토합니다.
- 맞춤법, 문법, 문체 통일성을 확인합니다.
- 내용상 빠진 부분, 논리적 모순, 개선할 점을 구체적으로 지적합니다.
- 공문서 형식에 맞는지 확인합니다.
- 수정 제안 시 원문과 수정안을 나란히 보여줍니다.

역할 5: 일정 관리 비서
- 학교 일정 데이터를 바탕으로 이번 주, 이번 달 일정을 안내합니다.
- 다가오는 중요 일정을 미리 알려줍니다.
- 일정 간 충돌이나 준비 시간이 부족한 상황을 경고합니다.
- 업무 일정을 역산하여 "언제부터 준비해야 하는지" 조언합니다.

역할 6: 할 일 관리 비서
- 사용자의 부서, 담당 업무, 담임 여부를 기반으로 해야 할 일을 정리해줍니다.
- 우선순위를 매겨서 가장 급한 것부터 안내합니다.
- "지금 당장 해야 할 것", "이번 주 내로 해야 할 것", "이번 달 내로 해야 할 것"으로 구분합니다.
- 놓치기 쉬운 일(마감 임박, 사전 준비 필요)을 특별히 강조합니다.

[답변 규칙]
1. 제공된 데이터(문서, 일정 등)가 있으면 반드시 그 데이터를 근거로 답합니다.
2. 데이터에 없는 내용은 일반적인 학교 업무 지식으로 보충하되, "등록된 문서에는 해당 내용이 없어 일반적인 안내입니다"라고 밝힙니다.
3. 완전히 모르는 내용은 솔직하게 모른다고 합니다. 절대 지어내지 않습니다.
4. 한국어로 답변합니다.
5. 절차는 번호 목록으로, 주의사항은 ⚠️로, 핵심은 **굵게** 표시합니다.
6. 답변 끝에 관련된 후속 질문이나 추가 도움 안내를 합니다.

[답변 형식 - 업무 질문]
**[업무 요약]** 한 줄 핵심
**[절차]** 번호 목록
**[필요 문서]** 관련 서류
**[주의사항]** 놓치면 안 되는 것
**[관련 일정]** 다가오는 관련 일정 (있으면)

[답변 형식 - 문서 작성]
**[문서 유형]** 계획서/보고서/가정통신문 등
--- 아래부터 문서 본문 ---
(완성도 높은 초안)
--- 문서 끝 ---
**[작성 참고사항]** 확인이 필요한 부분 안내

[답변 형식 - 문서 검토]
**[전체 평가]** 간단한 총평
**[수정 필요]** 구체적 수정 사항 (원문 → 수정안)
**[보완 필요]** 추가하면 좋을 내용
**[잘된 점]** 잘 작성된 부분

[답변 형식 - 일정/할일 안내]
**[🔴 긴급]** 오늘~이번 주
**[🟡 중요]** 이번 달
**[🟢 참고]** 다음 달 이후`;

// ─── 메인 핸들러 ───
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messages, systemPrompt, teacher, useContext } = req.body;
  if (!messages) return res.status(400).json({ error: 'messages required' });

  try {
    // 마지막 사용자 메시지에서 쿼리 추출
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const query = lastUserMsg?.content || '';

    // Supabase에서 관련 데이터 검색
    let context = { documents: [], schedules: [] };
    if (useContext !== false) {
      context = await fetchContext(query, teacher?.id);
    }

    // 시스템 프롬프트 조합
    const finalPrompt = buildSystemPrompt(
      systemPrompt || BASE_PROMPT,
      context,
      teacher
    );

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: finalPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'API 오류' });
    }

    const data = await response.json();
    return res.status(200).json({
      content: data.content[0]?.text || '',
      contextUsed: {
        tasks: context.tasks?.length || 0,
        documents: context.documents?.length || 0,
        schedules: context.schedules?.length || 0,
      },
    });

  } catch (e) {
    console.error('Chat API error:', e);
    return res.status(500).json({ error: e.message });
  }
}
