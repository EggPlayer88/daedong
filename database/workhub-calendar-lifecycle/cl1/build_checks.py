"""새 localhost PostgreSQL17에서 CL1과 INT-16을 검증한다. 운영 DSN을 받지 않는다."""
from pathlib import Path
import os,sys,json,importlib.util,hashlib
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
WRITE=sys.argv[1:]==['--write']
if sys.argv[1:] and not WRITE:raise SystemExit('지원 인자: --write 또는 생략')
sys.argv=[sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55843')
spec=importlib.util.spec_from_file_location('cl1_int15',ROOT/'database/workhub-notifications/nt1/build_checks.py')
N=importlib.util.module_from_spec(spec);spec.loader.exec_module(N);I=N.I;H=N.H;B=N.B;q=I.run
TARGET=HERE/'INT-16_일정취소포함_통합점검.sql'

def assemble(base,delta):
 packed=json.loads(base.split('$int15data$')[1])
 attrs=[None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
 rows=[[packed['s'][s],packed['t'][t],packed['k'][k],attrs[a]] for s,t,k,a in packed['r']]+delta
 payload=json.dumps(B.B.B.B.MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=base.split('$int15data$')[2].replace('INT-15-','INT-16-').replace('53단계','54단계')
 tail=B.replace_once(tail,"('NT1-01',52,'TP1-02')","('NT1-01',52,'TP1-02'),\n ('CL1-01',53,'NT1-01')")
 tail=B.replace_once(tail,"WHEN s.stage = 'NT1-01' THEN","WHEN s.stage = 'CL1-01' THEN (to_regclass('workhub_private.cl1_installs') IS NOT NULL)::int + (to_regprocedure('public.workhub_calendar_cancel(text,jsonb,text,boolean)') IS NOT NULL)::int\n              WHEN s.stage = 'NT1-01' THEN")
 tail=B.replace_once(tail,"'TP1-02','NT1-01')","'TP1-02','NT1-01','CL1-01')")
 return '-- INT-16: 기존 INT-15 + 일정 취소 CL1. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int16data$'+payload+'$int16data$'+tail

def postcheck():
 rows=q("SELECT n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',md5(replace(p.prosrc,E'\\r\\n',E'\\n')),p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE (n.nspname='workhub_private' AND p.proname LIKE 'cl1_%') OR (n.nspname='public' AND p.proname IN('workhub_calendar_list','workhub_calendar_get','workhub_calendar_save','workhub_calendar_cancel','workhub_calendar_cancelled_list')) ORDER BY 1")
 vals=',\n'.join("('%s','%s',%s)"%(s,h,str(sd).lower()) for s,h,sd in rows)
 trigger=q("SELECT md5(pg_get_triggerdef(oid)) FROM pg_trigger WHERE tgname='cl1_cancelled_guard' AND tgrelid='workhub.events'::regclass")[0][0]
 return (HERE/'test/postcheck.template.sql').read_text('utf-8').replace('__FUNCTIONS__',vals).replace('__TRIGGER_HASH__',trigger)

def tests():
 N.tests()
 sys.path.insert(0,str(HERE/'test'));import lifecycle_cases as C;C.configure(I)
 import gen_int_05 as G
 catalog=B.scoped(B.B.scoped(B.B.B.scoped(B.B.B.B.scoped(G.g.gm.CATALOG_SQL))))
 snapshot=lambda:{(kind,key):attrs for kind,key,attrs,_ in q(catalog)}
 pre=q((HERE/'CL1-00_전후점검.sql').read_text('utf-8'));original=snapshot()
 install=(HERE/'CL1-01_일정취소_조회와원키복구.sql').read_text('utf-8')
 C.guard_tests(install);q(install)
 after=snapshot();delta=[['CL1-01',kind,key,after.get((kind,key))] for kind,key in sorted(set(original)|set(after)) if original.get((kind,key))!=after.get((kind,key))]
 allowed={'public.workhub_calendar_list(text)','public.workhub_calendar_get(text,text)','public.workhub_calendar_save(text,jsonb)','public.workhub_calendar_cancel(text,jsonb,text,boolean)','public.workhub_calendar_cancelled_list(text)'}
 H.check('CL1 변경은 일정 조회·저장 응답과 새 취소 객체만',all('cl1_' in key or key.split('(')[0] in {a.split('(')[0] for a in allowed} for _,_,key,_ in delta))
 post=q((HERE/'CL1-00_전후점검.sql').read_text('utf-8'));H.check('CL1 기존 자료·권한·비용 F1~F5 그대로',pre[2:]==post[2:])
 check=postcheck();candidate=assemble(B.read(N.TARGET),delta)
 for label,source,total in [('CL1-02',check,7),('INT-16',candidate,18)]:
  rows=q(source);H.check(label+' FAIL 0',len(rows)==total and all(r[2]!='FAIL' for r in rows))
 for label,mutation in [('취소 보호 중지','ALTER TABLE workhub.events DISABLE TRIGGER cl1_cancelled_guard'),('내부 권한 누출','GRANT EXECUTE ON FUNCTION workhub_private.cl1_cancelled_guard() TO authenticated')]:
  with H.connect(db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('BEGIN');cur.execute(mutation);cur.execute(check);H.check(label+' 사후점검 검출',any(r[2]=='FAIL' for r in cur.fetchall()));cur.execute(candidate);H.check(label+' 통합점검 검출',any(r[2]=='FAIL' for r in cur.fetchall()));cur.execute('ROLLBACK')
 if WRITE:
  TARGET.write_text(candidate,encoding='utf-8',newline='\n');(HERE/'CL1-02_사후점검.sql').write_text(check,encoding='utf-8',newline='\n')
 else:
  H.check('INT-16 재생성 일치',B.read(TARGET)==candidate);H.check('CL1-02 재생성 일치',B.read(HERE/'CL1-02_사후점검.sql')==check)
 manifest={'postcheck':'INT-16','baseline':'INT-15 + CL1-01','rows':18,'source':TARGET.relative_to(ROOT).as_posix(),'bytes':len(candidate.encode()),'sha256':hashlib.sha256(candidate.encode()).hexdigest(),'deltaObjects':len(delta)}
 if WRITE:(HERE/'checks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 else:H.check('INT-16 해시 일치',json.loads(B.read(HERE/'checks.json'))==manifest)
 C.tests();print('CL1 및 전체 기준 PASS',H.PASS,'FAIL 0',flush=True)
I.H.tests=tests
if __name__=='__main__':I.H.main()
