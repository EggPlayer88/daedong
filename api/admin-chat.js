// ═══════════════════════════════════════════════════════════════════
//  api/admin-chat.js — 관리자 AI 비서 (tool use 기반)
// ═══════════════════════════════════════════════════════════════════
//
//  요청: { messages, currentUser, weekStart, weekEnd, allTeachers, allSubjects, allClasses }
//  응답: { content, toolCalls?, proposals?, contextUsed }
//
//  처리 흐름:
//   1. messages + 시스템 프롬프트로 Claude 호출 (tools 포함)
//   2. Claude 응답이 tool_use 면 → 도구 실행 → 결과를 tool_result 로 다시 Claude 에 전달
//   3. 최종 text 답변까지 루프 (max 5 회)
//   4. propose_change 호출은 별도로 응답에 포함 (UI 가 카드로 표시)
// ═══════════════════════════════════════════════════════════════════

import { ADMIN_TOOLS, executeAdminTool } from './_adminTools.js';

const SYSTEM_PROMPT = `당신은 대동여중 시간표관리자 전용 AI 비서입니다. 학교 전체 시간표 운영을 돕는 강력한 도구입니다.

[당신이 도와줄 수 있는 일 — 도구 사용]
1. **시간표 검증** — validate_timetable 도구로 시수 정확성, 동시간 충돌 등 진단
2. **변동 통계 조회** — query_change_stats 로 기간/교사/유형별 통계
3. **보강 부담 분석** — analyze_substitute_load 로 교사별 누적 보강 횟수 비교
4. **빈 교사 찾기** — find_available_teachers 로 특정 시간 보강 가능한 교사 탐색
5. **변동 제안** — propose_change 로 사용자 의도를 구조화된 제안으로 변환 (UI가 카드로 표시 → 사용자가 확정 클릭)

[중요한 원칙]
- **시간표를 직접 수정하지 마세요.** 변동은 항상 propose_change 도구로 "제안" 만 하고, 실제 적용은 관리자가 UI 에서 확정해야 합니다.
- **사실만 말하기.** 도구 결과에 없는 내용은 추측하지 마세요. 데이터가 부족하면 "데이터 부족" 이라고 말하세요.
- **명확한 의도 파악.** 사용자가 모호한 요청을 하면 (예: "이번 주 좀 봐줘") 추가 정보를 묻거나 가능한 옵션을 제시하세요.
- **변동 제안 전 확인.** "X 교사 화요일 3교시를 자습으로" 같은 명확한 변동 요청에 대해서는 propose_change 후, 사용자가 확정하기 전에 도구 결과를 자연어로 요약해서 보여주세요.

[자유 질의 — 도구 없이 답변]
- 시간표 시스템 사용법 질문 ("어떻게 캘린더 추가해?")
- 변동 유형 차이 설명 ("교환수업이랑 보강이랑 뭐가 달라?")
- 운영 가이드 ("학기 초에 뭐 설정해야 해?")

[응답 스타일]
- 한국어, 공손하지만 전문적
- 도구 결과를 단순 나열하지 말고 의미를 해석해서 보고
  예: "변동 12건 중 보강 8건이 박영어T 한 명에게 몰려있어요. 평균 대비 4배입니다."
- 마크다운 표·리스트 적극 활용
- 문제가 발견되면 우선순위 매겨서 제시 (긴급/중요)`;


export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    messages, currentUser,
    allTeachers = [], allSubjects = [], allClasses = [],
  } = req.body;

  if (!messages || messages.length === 0) {
    return res.status(400).json({ error: 'messages required' });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다' });
  }

  // 도구 실행에 필요한 컨텍스트 (TCH/SUBJ/CLS)
  const toolContext = {
    teachers: allTeachers,
    subjects: allSubjects,
    classes: allClasses,
    currentUser,
  };

  try {
    // tool use 루프
    const conversation = [...messages]; // role 'user' 메시지 + (필요 시 assistant 메시지) 누적
    const proposals = [];               // propose_change 결과 모음
    const toolCallsLog = [];            // UI 로깅용
    let finalText = '';
    let stopReason = null;

    for (let iter = 0; iter < 5; iter++) {
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
          system: SYSTEM_PROMPT,
          tools: ADMIN_TOOLS,
          messages: conversation,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return res.status(response.status).json({
          error: err.error?.message || `Claude API 오류 (${response.status})`,
        });
      }

      const data = await response.json();
      stopReason = data.stop_reason;

      // assistant 메시지를 conversation 에 추가 (tool use 흐름 유지에 필수)
      conversation.push({ role: 'assistant', content: data.content });

      // text 블록과 tool_use 블록 분리
      const textBlocks = data.content.filter(b => b.type === 'text');
      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');

      // text 누적
      for (const tb of textBlocks) {
        if (tb.text) finalText += (finalText ? '\n\n' : '') + tb.text;
      }

      // tool_use 가 없으면 종료
      if (toolUseBlocks.length === 0) break;

      // 모든 tool_use 실행하고 tool_result 로 응답
      const toolResults = [];
      for (const tu of toolUseBlocks) {
        toolCallsLog.push({ name: tu.name, input: tu.input });
        let result;
        try {
          result = await executeAdminTool(tu.name, tu.input, toolContext);
        } catch (e) {
          result = { error: `도구 실행 오류: ${e.message}` };
        }

        // propose_change 는 별도로 모아서 UI 에 전달
        if (tu.name === 'propose_change' && result?.proposal) {
          proposals.push(result.proposal);
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: tu.id,
          content: JSON.stringify(result),
        });
      }

      // tool_result 메시지 추가하고 다음 루프
      conversation.push({ role: 'user', content: toolResults });

      // stop_reason 이 'end_turn' 이면 종료 (방어적)
      if (stopReason === 'end_turn') break;
    }

    return res.status(200).json({
      content: finalText || '(응답 없음)',
      tool_calls: toolCallsLog,
      proposals,
      stop_reason: stopReason,
    });

  } catch (e) {
    console.error('admin-chat error:', e);
    return res.status(500).json({ error: e.message });
  }
}
