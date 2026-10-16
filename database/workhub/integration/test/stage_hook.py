# 통합 회귀(IV): 한 단계의 시험(run_pN.py · run_r1s.py)을 "뒷 단계가 모두 설치된 DB"에서 돌린다. 시험 파일은 고치지 않는다.
#   그 시험이 자기 단계를 설치하고 "다시 실행 → 멈춤"을 확인한 바로 뒤(=그 단계의 -02 재실행 시험 직후)에
#   뒷 단계 SQL(P(N+1)~P7, P7-05)을 운영 순서대로 적용하고 INT-03 이 FAIL 없는지 확인한 다음, 나머지 시험을 그대로 이어 간다.
#   단계 시험 안의 "설치 전후 구조 지문 같음" 비교는, 뒷 단계를 설치한 직후 지문과 같으면(= 그 뒤 시험 동작이 구조를 바꾸지 않았으면)
#   설치 직후 지문으로 읽어 비교한다. 시험 동작이 구조를 바꾸면 그대로 다르게 나와 FAIL 이 된다.
#
# 사용: python3 stage_hook.py <단계 시험 파일> <트리거 SQL 파일(그 단계 -02)> <뒷 단계 파일 ...>
import importlib.util, os, subprocess, sys
import psycopg2

HERE = os.path.dirname(os.path.abspath(__file__))
WH = os.path.abspath(os.path.join(HERE, '..', '..'))
suite, trigger, later = sys.argv[1], sys.argv[2], sys.argv[3:]
sys.argv = [suite] + (['legacy'] if suite.endswith('run_r1s.py') else [])
sys.path.insert(0, os.path.dirname(suite))
spec = importlib.util.spec_from_file_location('stage_suite', suite)
mod = importlib.util.module_from_spec(spec); sys.modules['stage_suite'] = mod; spec.loader.exec_module(mod)

trigger_text = open(os.path.join(WH, trigger), encoding='utf-8').read()
orig_sqlerr, orig_fp = mod.sqlerr, mod.fingerprint
st = {'hooked': False, 'last': None, 'hook': None}

def admin():
    c = psycopg2.connect(host=os.environ['R0_PGHOST'], port=int(os.environ.get('R0_PG_PORT', '55433')), dbname='r0', user='postgres')
    c.autocommit = True; return c

def run_file(path):
    text = open(os.path.join(WH, path), encoding='utf-8').read()
    if path.endswith('P7-05_R1_P2_보강_별도승인.sql'):
        text = text.replace('"<승인한 사람(예: 계란)>"', '"통합 시험"').replace('"<승인 근거(날짜 · 대화 · 문서)>"', '"통합 회귀(시험 DB)"')
    c = admin(); cur = c.cursor(); cur.execute(text); r = cur.fetchall() if cur.description else []; c.close(); return r

def subst(cur, hook, last):
    if isinstance(cur, tuple): return tuple(subst(c, h, l) for c, h, l in zip(cur, hook, last))
    if isinstance(cur, list) and len(cur) == len(hook) == len(last): return [l if c == h else c for c, h, l in zip(cur, hook, last)]
    return cur

def fingerprint(*a, **k):
    cur = orig_fp(*a, **k)
    if not st['hooked']: st['last'] = cur; return cur
    return subst(cur, st['hook'], st['last'])

def sqlerr(text, *a, **k):
    r = orig_sqlerr(text, *a, **k)
    if not st['hooked'] and text == trigger_text:
        for f in later: run_file(f)
        st['hooked'] = True; st['hook'] = orig_fp()
        rows = run_file('integration/INT-03_통합사후점검.sql')
        bad = [x for x in rows if x[2] == 'FAIL']
        mod.check(f'Z00 통합: 이 단계 설치 직후 뒷 단계 {len(later)}개 파일 적용 · INT-03 FAIL 없음({rows[0][3]})', not bad and len(rows) == 13, bad)
    return r

mod.sqlerr, mod.fingerprint = sqlerr, fingerprint
try:
    rc = mod.main()
except SystemExit as e:
    rc = e.code
if not st['hooked']:
    print('FAIL Z99 통합: 뒷 단계를 설치할 지점(그 단계 -02 재실행 시험)을 지나지 않았습니다'); rc = 1
sys.exit(rc or 0)
