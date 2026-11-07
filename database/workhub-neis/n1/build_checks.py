"""기존 INT-11을 보존하고 새 localhost PG17에서 N1 포함 INT-12를 생성·검증한다."""
from pathlib import Path
import os,sys,json,importlib.util,hashlib
ROOT=Path(__file__).resolve().parents[3]
HERE=Path(__file__).resolve().parent
WRITE=sys.argv[1:]==['--write']
if sys.argv[1:] and not WRITE:raise SystemExit('지원 인자: --write 또는 생략')
sys.argv=[sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55679')
spec=importlib.util.spec_from_file_location('int11_base',ROOT/'database/workhub-current/int11/build_checks.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
I=B.I
TARGET=HERE/'INT-12_나이스포함_통합점검.sql'
def scoped(s):return s.replace("'site_presentation')","'site_presentation','neis_private')")
def assemble(base,delta):
    p=json.loads(base.split('$int11data$')[1]);attrs=[None if ids is None else dict(p['p'][i] for i in ids) for ids in p['a']]
    rows=[[p['s'][s],p['t'][t],p['k'][k],attrs[a]] for s,t,k,a in p['r']]+delta
    payload=json.dumps(B.MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
    tail=scoped(base.split('$int11data$')[2]).replace('INT-11-','INT-12-').replace('48단계','49단계')
    tail=B.replace_once(tail,"('SP1',47,'AF2-01')","('SP1',47,'AF2-01'),\n ('N1',48,'SP1')")
    tail=B.replace_once(tail,"WHEN s.stage = 'SP1' THEN","WHEN s.stage = 'N1' THEN (to_regnamespace('neis_private') IS NOT NULL)::int + (to_regprocedure('public.workhub_neis_apply(text,jsonb,text)') IS NOT NULL)::int\n              WHEN s.stage = 'SP1' THEN")
    tail=B.replace_once(tail,"s.stage IN ('R0','K1','AF2-01','SP1')","s.stage IN ('R0','K1','AF2-01','SP1','N1')")
    return '-- INT-12: 기존 INT-11 + 나이스 N1. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int12data$'+payload+'$int12data$'+tail
def tests():
    B.test()
    import gen_int_05 as G
    catalog=scoped(B.scoped(G.g.gm.CATALOG_SQL))
    snapshot=lambda:{(k,key):a for k,key,a,_ in I.run(catalog)}
    before=snapshot()
    protected=['public.users','auth.users','workhub.memberships','workhub.membership_roles','workhub.events','workhub.module_activations','workhub.ai_gateway_requests']
    original=I.preserve(protected)
    I.apply(HERE/'N1-01_나이스연결_모델과함수.sql')
    after=snapshot()
    delta=[['N1',k,key,after.get((k,key))] for k,key in sorted(set(before)|set(after)) if before.get((k,key))!=after.get((k,key))]
    I.H.check('N1은 새 neis 객체만 추가',all(key=='neis_private' or key.startswith('neis_private.') or key.startswith('public.workhub_neis_') for _,_,key,_ in delta))
    base=B.read(B.TARGET);candidate=assemble(base,delta)
    I.H.check('이전 INT-11은 N1 추가 함수를 검출',any(r[2]=='FAIL' for r in I.run(base)))
    rows=I.run(candidate);I.H.check('INT-12 18행 FAIL 0',len(rows)==18 and all(r[2]!='FAIL' for r in rows))
    rows=I.run(B.read(HERE/'N1-02_사후점검.sql'));I.H.check('N1-02 9행 FAIL 0',len(rows)==9 and all(r[2]!='FAIL' for r in rows))
    I.H.check('기존 회원·권한·일정·AI 원장 보존',original==I.preserve(protected))
    for label,mutation,suffix in [
      ('RLS','ALTER TABLE neis_private.datasets DISABLE ROW LEVEL SECURITY','14'),
      ('추가 열','ALTER TABLE neis_private.receipts ADD COLUMN extra text','15'),
      ('익명 실행','GRANT EXECUTE ON FUNCTION public.workhub_neis_apply(text,jsonb,text) TO anon','04'),
      ('소유자','ALTER FUNCTION public.workhub_neis_status(text,text,integer,date,date) OWNER TO supabase_admin','08'),
      ('함수 누락','DROP FUNCTION public.workhub_neis_close(text,jsonb,text)','02')]:
        with I.H.connect(user='supabase_admin',db=I.DB) as c:
            with c.cursor() as cur:
                cur.execute('BEGIN');cur.execute(mutation);cur.execute(candidate);result=cur.fetchall()
                I.H.check(label+' 훼손 검출',next(r for r in result if r[0]=='INT-12-'+suffix)[2]=='FAIL');cur.execute('ROLLBACK')
    if WRITE:TARGET.write_text(candidate,encoding='utf-8',newline='\n')
    else:I.H.check('INT-12 재생성 일치',B.read(TARGET)==candidate)
    manifest={'postcheck':'INT-12','baseline':'INT-11 + N1','rows':18,'source':TARGET.relative_to(ROOT).as_posix(),'bytes':len(candidate.encode()),'sha256':hashlib.sha256(candidate.encode()).hexdigest(),'deltaObjects':len(delta)}
    if WRITE:(HERE/'checks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
    else:I.H.check('INT-12 해시 일치',json.loads(B.read(HERE/'checks.json'))==manifest)
    print('INT-12',len(delta),'추가 객체',len(candidate.encode()),'bytes',flush=True)
I.H.tests=tests
if __name__=='__main__':I.H.main()
