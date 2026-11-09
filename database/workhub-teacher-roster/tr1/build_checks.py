"""운영 연결 없이 새 PG17에 전체 확정 SQL을 올려 TR1 포함 INT-13을 생성/대조한다."""
from pathlib import Path
import os,sys,json,importlib.util,hashlib
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
WRITE=sys.argv[1:]==['--write']
if sys.argv[1:] and not WRITE:raise SystemExit('지원 인자: --write 또는 생략')
sys.argv=[sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55791')
spec=importlib.util.spec_from_file_location('int12_base',ROOT/'database/workhub-neis/n1/build_checks.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B)
I=B.I;TARGET=HERE/'INT-13_교사명부포함_통합점검.sql'
def scoped(s):return s.replace("'site_presentation','neis_private')","'site_presentation','neis_private','teacher_roster')")
def assemble(base,delta):
 p=json.loads(base.split('$int12data$')[1]);attrs=[None if ids is None else dict(p['p'][i] for i in ids) for ids in p['a']]
 rows=[[p['s'][s],p['t'][t],p['k'][k],attrs[a]] for s,t,k,a in p['r']]+delta
 payload=json.dumps(B.B.MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=scoped(base.split('$int12data$')[2]).replace('INT-12-','INT-13-').replace('49단계','50단계')
 tail=B.B.replace_once(tail,"('N1',48,'SP1')","('N1',48,'SP1'),\n ('TR1',49,'N1')")
 tail=B.B.replace_once(tail,"WHEN s.stage = 'N1' THEN","WHEN s.stage = 'TR1' THEN (to_regnamespace('teacher_roster') IS NOT NULL)::int + (to_regprocedure('public.workhub_teacher_roster_published(text,text)') IS NOT NULL)::int\n              WHEN s.stage = 'N1' THEN")
 tail=B.B.replace_once(tail,"s.stage IN ('R0','K1','AF2-01','SP1','N1')","s.stage IN ('R0','K1','AF2-01','SP1','N1','TR1')")
 return '-- INT-13: 기존 INT-12 + 교사 명부 TR1. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int13data$'+payload+'$int13data$'+tail
def tests():
 B.tests()
 import gen_int_05 as G
 catalog=scoped(B.scoped(B.B.scoped(G.g.gm.CATALOG_SQL)))
 snapshot=lambda:{(k,key):a for k,key,a,_ in I.run(catalog)}
 before=snapshot();f_before=I.run(B.B.read(HERE/'TR1-00_전후점검.sql'))
 for n in ['01','02']:I.apply(next(HERE.glob('TR1-'+n+'_*.sql')))
 after=snapshot();delta=[['TR1',k,key,after.get((k,key))] for k,key in sorted(set(before)|set(after)) if before.get((k,key))!=after.get((k,key))]
 I.H.check('TR1은 별도 명부 객체만 추가',all(key=='teacher_roster' or key.startswith('teacher_roster.') or key.startswith('public.workhub_teacher_roster_') for _,_,key,_ in delta))
 f_after=I.run(B.B.read(HERE/'TR1-00_전후점검.sql'));I.H.check('기존 계정·권한·수업·시간표 설치 전후 보존',[r for r in f_before if r[0].startswith('F')]==[r for r in f_after if r[0].startswith('F')])
 candidate=assemble(B.B.read(B.TARGET),delta)
 rows=I.run(candidate);I.H.check('INT-13 18행 FAIL 0',len(rows)==18 and all(r[2]!='FAIL' for r in rows))
 rows=I.run(B.B.read(HERE/'TR1-03_사후점검.sql'));I.H.check('TR1-03 9행 FAIL 0',len(rows)==9 and all(r[2]!='FAIL' for r in rows))
 mid=I.run('SELECT m.id FROM workhub.memberships m JOIN workhub.accounts a ON a.id=m.account_id WHERE a.auth_user_id=%s ORDER BY m.id LIMIT 1',(I.H.ADMIN,))[0][0]
 with I.H.connect(db=I.DB) as c:
  with c.cursor() as cur:
   cur.execute('SET ROLE authenticated');cur.execute("SELECT set_config('request.jwt.claim.sub',%s,false)",(I.H.ADMIN,));cur.execute("SELECT public.workhub_teacher_roster_published(%s,'2026-11-16')",(mid,));v=cur.fetchone()[0]
   I.H.check('현재 OP1 접근 게이트로 명부 조회',v['contract']=='teacher-roster.v1' and v['memberId']==mid and v['data']['plans']==[])
 for label,mutation,suffix in [('RLS','ALTER TABLE teacher_roster.links DISABLE ROW LEVEL SECURITY','14'),('추가 열','ALTER TABLE teacher_roster.plans ADD COLUMN unexpected text','15'),('익명 실행','GRANT EXECUTE ON FUNCTION public.workhub_teacher_roster_commit(text,jsonb,text) TO anon','04'),('소유자','ALTER FUNCTION public.workhub_teacher_roster_get(text) OWNER TO supabase_admin','08')]:
  with I.H.connect(user='supabase_admin',db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('BEGIN');cur.execute(mutation);cur.execute(candidate);result=cur.fetchall();I.H.check(label+' 훼손 검출',next(r for r in result if r[0]=='INT-13-'+suffix)[2]=='FAIL');cur.execute('ROLLBACK')
 if WRITE:TARGET.write_text(candidate,encoding='utf-8',newline='\n')
 else:I.H.check('INT-13 재생성 일치',B.B.read(TARGET)==candidate)
 manifest={'postcheck':'INT-13','baseline':'INT-12 + TR1','rows':18,'source':TARGET.relative_to(ROOT).as_posix(),'bytes':len(candidate.encode()),'sha256':hashlib.sha256(candidate.encode()).hexdigest(),'deltaObjects':len(delta)}
 if WRITE:(HERE/'checks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 else:I.H.check('INT-13 해시 일치',json.loads(B.B.read(HERE/'checks.json'))==manifest)
I.H.tests=tests
if __name__=='__main__':I.H.main()
