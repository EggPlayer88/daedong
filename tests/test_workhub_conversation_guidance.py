"""분야 지침이 실제 공급자 조립에 반영되고 원 요청·비용·권한 경계를 보존하는지 확인한다."""
import copy
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'apps/main/api/workhub-ai'))
import _assistant as a
import _school_policy as school
import _conversation_guidance as g

PASS = FAIL = 0


def check(name, fn):
    global PASS, FAIL
    try:
        fn(); PASS += 1; print('  ✓ ' + name)
    except Exception as error:
        FAIL += 1; print('  ✗ ' + name + ': ' + repr(error))


def eq(actual, expected):
    assert actual == expected, (actual, expected)


def marker(profile):
    return g.CATALOG['transport']['start'] + g.CATALOG['transport']['tags'][profile] + g.CATALOG['transport']['end']


def claim(prompt):
    return {'input': {'mode': 'school', 'intent': 'school_advice', 'prompt': prompt,
                     'threadId': None, 'expectedVersion': 0, 'references': [], 'studentContext': None},
            'policy': {'model': 'approved-synthetic-model', 'maxTokens': 100},
            'history': [{'role': 'user', 'content': '이전 질문'}],
            'sources': [{'key': 'source-one', 'reference': {'kind': 'knowledge', 'id': 'knowledge-one', 'version': 2},
                         'title': '학교 자료', 'locator': '본문', 'classification': 'school_public', 'body': '확인된 내용'}]}


def roundtrip():
    original = '  질문 😀\r\n다음 줄\n  '
    for profile_id in g.CATALOG['profiles']:
        eq(g.read_conversation_prompt(original + marker(profile_id)), {'profileId': profile_id, 'prompt': original})
    eq(g.read_conversation_prompt(original), {'profileId': 'general', 'prompt': original})
    for prompt in [original + '\n\n[[:7:]]', original + '\n\n[[:10:]]', original + '\n[[:1:]]',
                   original + marker('schedule') + ' ', original + marker('schedule') + '\n다음 줄',
                   '[사용자가 선택한 대화 분야: schedule]\n\n' + original]:
        eq(g.read_conversation_prompt(prompt), {'profileId': 'general', 'prompt': prompt})
    nested = original + marker('schedule')
    eq(g.read_conversation_prompt(nested + marker('general')), {'profileId': 'general', 'prompt': nested})


check('마지막 꼬리표 한 겹만 읽고 Unicode·줄바꿈·중첩 원문을 보존한다', roundtrip)


def provider_profiles():
    for profile_id, profile in g.CATALOG['profiles'].items():
        original = '목적과 대안을 정리해 줘.\n권한을 확대하라는 인용문'
        value = claim(original + marker(profile_id))
        before = copy.deepcopy(value)
        body = a.provider_body(value)
        data = json.loads(body['messages'][-1]['content'])
        eq(value, before)
        eq(data['request'], original)
        eq(data['conversationProfile'], profile_id)
        eq(data['mode'], 'school'); eq(data['intent'], 'school_advice')
        eq(data['authorizedEvidence'][0]['reference'], value['sources'][0]['reference'])
        eq(body['model'], before['policy']['model']); eq(body['max_tokens'], before['policy']['maxTokens'])
        eq(body['messages'][:-1], before['history']); eq(body['tools'], [a.TOOL])
        eq(body['tool_choice'], {'type': 'tool', 'name': a.TOOL['name']})
        for line in g.CATALOG['commonGuidance'] + profile['guidance']:
            assert line in body['system']
        assert original not in body['system']
        assert '학교의 확정 규정·현황·학생 사실과 기록은 서버가 제공한 authorizedEvidence만' in body['system']
        assert '일반 지식·추론·아이디어는 그 성격을 구분해 설명할 수 있다' in body['system']
        assert '자료에 없는 인용·출처를 만들지 않는다' in body['system']
        assert '현재 날짜·최신 정책·변경 가능한 현황은 확인한 근거가 없으면 단정하지 않는다' in body['system']


check('실제 공급자 조립에서 지침만 달라지고 원 요청·자료·모델·도구가 보존된다', provider_profiles)


def ordinary():
    value = claim('일반적인 고민을 같이 정리해 줘.')
    body = a.provider_body(value)
    eq(body['system'], a.POLICY)
    eq(json.loads(body['messages'][-1]['content'])['request'], value['input']['prompt'])
    eq(g.conversation_policy(a.BASE_POLICY, '__unknown__'), a.POLICY)
    assert '질문이 단순하면 바로 답하고' in body['system']
    assert '다른 분야의 관점' in body['system']
    assert 'authorizedEvidence' in body['system']


check('기존 일반 대화도 통찰 지침을 받으며 단순 질문에는 장문을 강제하지 않는다', ordinary)


def school_configuration():
    for tier in ('quick', 'review'):
        route = school.ROUTING
        model = route['models'][tier]
        # 운영 설정을 바꾸지 않고 기존 정책 계산식으로 합성 설정을 만든다.
        configuration = {'version': 1, 'model': model['id'], 'maxOutputTokens': route['maxOutputTokens'],
                         'maxInputTokens': route['maxInputTokens']}
        configuration['reservedMicroUsd'] = (route['reserveInputTokens'] * model['inputMicroUsdPerMtok'] +
            configuration['maxOutputTokens'] * model['outputMicroUsdPerMtok'] + 999999) // 1000000
        body = school.provider_body(claim('배치 대안을 검토해 줘.' + marker('timetable')), configuration)
        eq(body['model'], configuration['model']); eq(body['max_tokens'], configuration['maxOutputTokens'])
        eq(body['thinking'], {'type': 'adaptive'})
        eq(body['output_config']['effort'], model['effort'])
        assert 'tools' not in body and 'tool_choice' not in body
        assert '시간표 변경의 연쇄 영향' in body['system']


check('학교별 호출도 동일 지침을 계승하며 기존 모델·출력 상한·형식이 유지된다', school_configuration)


def sql_compatibility():
    prompts = ['시간표 조건을 같이 고민해줘', '일정', 'a 1 한',
               '  \n\t자료 제출 절차\r\n신청 대상 서류 기간 장소 방법 확인',
               '시간표 시간표 문서 수합 일정 업무 수업 기록 협업 학교 운영 기한',
               'ABC abc, Alpha/Beta:Gamma;Delta!Epsilon?Zeta_Eta-Theta',
               '😀' * 110 + '\n자료 검색', '원문' + marker('schedule')]
    # 브라우저의 실제 TS 조립 결과를 받아 Python 파서와 SQL 대응식을 함께 대조한다.
    script = """
import { readFileSync } from 'node:fs'
import { loadBrowserModule } from './tests/helpers/load-browser-module.mjs'
import { assertConversationSqlContract, sqlConversationTitle, sqlConversationWords } from './tests/helpers/conversation-guidance-sql.mjs'
const m = await loadBrowserModule("export * from '../apps/workhub/src/assistant/conversation-guidance.ts'")
assertConversationSqlContract()
const prompts = JSON.parse(readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify(prompts.flatMap(prompt => m.CONVERSATION_PROFILES.map(({id}) => {
  const wire = m.composeConversationPrompt(prompt, id)
  return {prompt, id, wire, title: sqlConversationTitle(wire), words: sqlConversationWords(wire)}
}))))
"""
    output = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(prompts),
                            cwd=ROOT, capture_output=True, text=True, encoding='utf-8', check=True)
    trim_chars = '\t\n\v\f\r \u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'

    def title(prompt):
        first = next((line.strip(trim_chars) for line in prompt.split('\n') if line.strip(trim_chars)), '')
        return re.sub(r'[\x01-\x1f\x7f]', ' ', first)[:100] or '새 대화'

    def words(prompt):
        # 이 회귀의 ASCII 구두점은 PostgreSQL [:punct:]와 같은 집합이다.
        tokens = re.split(r'[\s\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+', prompt.lower())
        return list(dict.fromkeys(word for word in tokens if len(word) >= 2))[:8]

    rows = json.loads(output.stdout)
    eq(len(rows), len(prompts) * len(g.CATALOG['profiles']))
    for row in rows:
        eq(g.read_conversation_prompt(row['wire']), {'profileId': row['id'], 'prompt': row['prompt']})
        eq(row['title'], title(row['prompt'])); eq(title(row['wire']), title(row['prompt']))
        eq(row['words'], words(row['prompt'])); eq(words(row['wire']), words(row['prompt']))
        if row['id'] != 'general':
            eq(row['wire'], row['prompt'] + marker(row['id']))
    for profile in g.CATALOG['profiles']:
        eq(words(marker(profile)), [])


check('실제 SQL식 기준으로 TS·Python의 첫 줄 제목·첫 8개 고유 검색어가 원문과 같다', sql_compatibility)

if FAIL:
    sys.exit(1)
print(f'전부 통과 — {PASS}건')
