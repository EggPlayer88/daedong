# R0-03 시험 입력 생성: 저장소의 R0-03_학교초기설정.sql 의 <...> 칸을 합성 시험 값으로 채운다.
# 운영 초기값이 아니다. 날짜는 실행하는 날(서울 기준)이 속한 학년도(3/1~다음 해 2월 말)로 계산해
# 언제 돌려도 "오늘이 학년도 안" 조건을 만족하게 한다.
# 사용: python3 gen_inputs.py <R0-03 원본> <출력 폴더>
import datetime, json, re, sys
from zoneinfo import ZoneInfo

src, out = sys.argv[1], sys.argv[2]
text = open(src, encoding='utf-8').read()
today = datetime.datetime.now(ZoneInfo('Asia/Seoul')).date()
y = today.year if today.month >= 3 else today.year - 1
first, last = datetime.date(y, 3, 1), datetime.date(y + 1, 3, 1) - datetime.timedelta(days=1)
values = {
    'admin_user_id': '00000000-0000-0000-0000-000000000001',
    'approval_ref': '시험 승인(합성 값)',
    'school_code': 'daedong-ms',
    'school_name': '시험용 대동여자중학교',
    'school_level': 'middle',
    'grade_count': '3',
    'school_year': str(y),
    'year_first_day': first.isoformat(),
    'year_last_day': last.isoformat(),
}
terms = [(1, first, datetime.date(y, 8, 15)), (2, datetime.date(y, 8, 16), last)]

def fill(adm=None, year_last=None):
    v = dict(values)
    if adm: v['admin_user_id'] = adm
    if year_last: v['year_last_day'] = year_last
    s = text
    for k, val in v.items():
        s, n = re.subn(r'("%s":\s*)"<[^"]*>"' % k, lambda m: m.group(1) + json.dumps(val, ensure_ascii=False), s)
        assert n == 1, f'R0-03 의 {k} 칸을 찾지 못함'
    for no, a, b in terms:
        s, n = re.subn(r'(\{"term_no": %d, [^\n]*"first_day": )"<[^"]*>", "last_day": "<[^"]*>"' % no,
                       lambda m: m.group(1) + f'"{a.isoformat()}", "last_day": "{b.isoformat()}"', s)
        assert n == 1, f'R0-03 의 {no}학기 칸을 찾지 못함'
    left = re.findall(r'"<[^"]*>"', s.split('[3단계]')[0].split('[2단계]')[1])
    assert not left, f'채우지 못한 칸: {left}'
    return s

files = {
    'R0-03_filled.sql': fill(),
    'x_teacher.sql': fill(adm='00000000-0000-0000-0000-000000000002'),   # 일반 교사를 첫 관리자로
    'x_pending.sql': fill(adm='00000000-0000-0000-0000-000000000005'),   # 승인 대기 superadmin
    'x_baddate.sql': fill(year_last=datetime.date(y, 2, 28).isoformat()),  # 학년도 마지막 날이 첫날보다 앞
}
for name, body in files.items():
    open(f'{out}/{name}', 'w', encoding='utf-8').write(body)
print(f'R0-03 시험 입력 {len(files)}개 생성 (학년도 {y}: {first} ~ {last})')
