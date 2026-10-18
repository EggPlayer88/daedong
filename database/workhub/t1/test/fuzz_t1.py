# fuzz_t1.ts 가 만든 변형을 SQL 이식 함수에 넣어 앱 판정과 같은지 센다(run_t1.py 뒤, 같은 시험 DB).
#   basis      → cardinality(t1_basis_issues(b)) = 0            vs 앱 validateBasis(b).valid
#   placements → cardinality(t1_placement_issues(b, p)) = 0     vs 앱 validatePlacements(b, p).valid
#   foundation → t1_basis_issues 통과 AND t1_foundation_ready(b) vs 앱 reviewTimetableFoundation(b).ready
#   draft      → t1_draft_ok(d, src)                             vs 앱 preparationDraft(d, source) 성공
#   compile    → t1_compile(src, d, id, rev)                     vs 앱 compilePreparation(...).basis (정준형까지 같아야 함)
import json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'r1', 'test'))
from run_r1 import admin

cases = json.load(open(os.environ['T1_FUZZ'], encoding='utf-8'))
c = admin('postgres'); cur = c.cursor()
def q(sql, *args):
    cur.execute(sql, [json.dumps(a, ensure_ascii=False) if not isinstance(a, (str, int)) or isinstance(a, bool) else a for a in args]); return cur.fetchone()[0]
def canonical(v):
    if isinstance(v, list): return '[' + ','.join(canonical(x) for x in v) + ']'
    if isinstance(v, dict): return '{' + ','.join(json.dumps(k, ensure_ascii=False) + ':' + canonical(v[k]) for k in sorted(v)) + '}'
    return json.dumps(v, ensure_ascii=False)
diff = {}; agree = {}
for i, k in enumerate(cases):
    t = k['type']
    try:
        if t == 'basis': sql = q('select cardinality(workhub_private.t1_basis_issues(%s::jsonb)) = 0', k['value'])
        elif t == 'placements': sql = q('select cardinality(workhub_private.t1_placement_issues(%s::jsonb, %s::jsonb)) = 0', k['basis'], k['value'])
        elif t == 'foundation': sql = q('select cardinality(workhub_private.t1_basis_issues(%s::jsonb)) = 0 and workhub_private.t1_foundation_ready(%s::jsonb)', k['basis'], k['basis'])
        elif t == 'draft':
            src = dict(k['source'], courses=k['source']['courses'])
            sql = q('select workhub_private.t1_draft_ok(%s::jsonb, %s::jsonb)', k['value'], src)
        else:
            sql = q('select workhub_private.t1_compile(%s::jsonb, %s::jsonb, %s, %s)', k['source'], k['value'], k['id'], k['revision'])
    except Exception as e:  # SQL 이 판정 대신 예외를 내면 그 자체가 불일치(앱은 거절 · 통과 중 하나로 답한다)
        c.rollback() if not c.autocommit else None
        sql = 'EXC ' + str(e).split('\n')[0]
    if t == 'compile':
        same = (sql is None and k['app'] is None) or (sql is not None and k['app'] is not None and canonical(sql) == canonical(k['app']))
    else:
        same = sql is True and k['app'] is True or sql is False and k['app'] is False
    agree[t] = agree.get(t, 0) + (1 if same else 0)
    if not same: diff.setdefault(t, []).append((i, k['app'] if t != 'compile' else (k['app'] is not None), sql if t != 'compile' else (sql if isinstance(sql, str) else sql is not None)))
total = len(cases); bad = sum(len(v) for v in diff.values())
print('INFO ' + ' / '.join(f'{t} 일치 {agree.get(t, 0)}' + (f' · 불일치 {len(diff[t])}' if t in diff else '') for t in ('basis', 'placements', 'foundation', 'draft', 'compile')))
for t, rows in diff.items():
    for i, a, s in rows[:5]:
        print(f'  {t} #{i}: 앱 {a} · SQL {s} :: {json.dumps(cases[i].get("value", cases[i].get("basis")), ensure_ascii=False)[:300]}')
ok = bad == 0 and total > 0
print(('PASS' if ok else 'FAIL') + f' 무작위 변형 {total}건: 앱 검사 함수와 SQL 이식본의 통과/거절(확정은 기준판 본문까지) 일치')
sys.exit(0 if ok else 1)
