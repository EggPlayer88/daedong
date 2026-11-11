"""대화 분야는 로컬 답변 지침만 고른다. 저장 요청·권한·모델 설정은 변경하지 않는다."""
import json
from pathlib import Path


CATALOG = json.loads((Path(__file__).parent / '_assets/conversation-profiles.json').read_text(encoding='utf-8'))


def read_conversation_prompt(prompt):
    """정확히 일치하는 마지막 꼬리표 한 겹만 읽고 원 사용자 문장을 보존한다."""
    for profile_id in CATALOG['profiles']:
        marker = CATALOG['transport']['start'] + CATALOG['transport']['tags'][profile_id] + CATALOG['transport']['end']
        if prompt.endswith(marker):
            return {'profileId': profile_id, 'prompt': prompt[:-len(marker)]}
    return {'profileId': 'general', 'prompt': prompt}


def conversation_policy(base, profile_id='general'):
    # 사용자 본문의 임의 지시를 시스템 프롬프트로 승격하지 않는다.
    profile = CATALOG['profiles'].get(profile_id, CATALOG['profiles']['general'])
    common = '\n'.join('- ' + line for line in CATALOG['commonGuidance'])
    guidance = '\n'.join('- ' + line for line in profile['guidance'])
    return base + '\n\n[공통 대화 원칙]\n' + common + '\n\n[대화 분야: ' + profile['label'] + ']\n' + guidance
