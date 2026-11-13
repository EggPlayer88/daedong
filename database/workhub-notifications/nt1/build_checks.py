"""운영 DSN 없이 새 localhost PG17의 현재 전체 기준 위에서 NT1·INT-15를 검증한다."""
from pathlib import Path
import os,sys,json,importlib.util,hashlib
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
WRITE=sys.argv[1:]==['--write']
if sys.argv[1:] and not WRITE:raise SystemExit('지원 인자: --write 또는 생략')
sys.argv=[sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55841')
spec=importlib.util.spec_from_file_location('nt1_int14',ROOT/'database/workhub-teacher-pilot/tp1/build_checks.py')
B=importlib.util.module_from_spec(spec);spec.loader.exec_module(B);I=B.I;H=I.H
TARGET=HERE/'INT-15_알림연결포함_통합점검.sql'
q=I.run

def assemble(base,delta):
 packed=json.loads(base.split('$int14data$')[1])
 attrs=[None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
 rows=[[packed['s'][s],packed['t'][t],packed['k'][k],attrs[a]] for s,t,k,a in packed['r']]+delta
 payload=json.dumps(B.B.B.B.MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=base.split('$int14data$')[2].replace('INT-14-','INT-15-').replace('52단계','53단계')
 tail=B.replace_once(tail,"('TP1-02',51,'TP1-01')","('TP1-02',51,'TP1-01'),\n ('NT1-01',52,'TP1-02')")
 tail=B.replace_once(tail,"WHEN s.stage = 'TP1-01' THEN","WHEN s.stage = 'NT1-01' THEN (to_regclass('workhub_private.nt1_installs') IS NOT NULL)::int + (to_regprocedure('workhub_private.nt1_message_notice()') IS NOT NULL)::int\n              WHEN s.stage = 'TP1-01' THEN")
 tail=B.replace_once(tail,"'TP1-01','TP1-02')","'TP1-01','TP1-02','NT1-01')")
 return '-- INT-15: 기존 INT-14 + 메시지·수합 공개 알림 NT1. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int15data$'+payload+'$int15data$'+tail

def tests():
 B.tests()
 sys.path.insert(0,str(HERE/'test'));import notification_cases as N
 N.configure(I)
 N.before()
 import gen_int_05 as G
 catalog=B.scoped(B.B.scoped(B.B.B.scoped(B.B.B.B.scoped(G.g.gm.CATALOG_SQL))))
 snapshot=lambda:{(kind,key):attrs for kind,key,attrs,_ in q(catalog)}
 original=snapshot();pre=q((HERE/'NT1-00_전후점검.sql').read_text('utf-8'))
 install=(HERE/'NT1-01_메시지_수합공개_알림.sql').read_text('utf-8')
 N.guard_tests(install)
 q(install)
 after=snapshot();delta=[['NT1-01',kind,key,after.get((kind,key))] for kind,key in sorted(set(original)|set(after)) if original.get((kind,key))!=after.get((kind,key))]
 H.check('NT1 기존 함수 정의·권한 보존',all(key.startswith('workhub_private.nt1_') or key.endswith('.nt1_message_notice') or key.endswith('.nt1_collection_notice') for _,_,key,_ in delta))
 post=q((HERE/'NT1-00_전후점검.sql').read_text('utf-8'));H.check('NT1 설치 전후 기존 메시지·수합·알림·권한 지문 동일',[r for r in pre if r[0].startswith('F')]==[r for r in post if r[0].startswith('F')])
 trigger_hash=q("SELECT md5(pg_get_triggerdef(oid)) FROM pg_trigger WHERE tgrelid='workhub.collections'::regclass AND tgname='nt1_collection_notice'")[0][0]
 postcheck=(HERE/'test/postcheck.template.sql').read_text('utf-8').replace('__COLLECTION_TRIGGER_HASH__',trigger_hash)
 candidate=assemble(B.read(B.TARGET),delta)
 for label,source,total in [('NT1-02',postcheck,7),('INT-15',candidate,18)]:
  rows=q(source);H.check(label+' 사후점검 FAIL 0',len(rows)==total and all(r[2]!='FAIL' for r in rows))
 for label,mutation,suffix in [('수합 트리거 중지','ALTER TABLE workhub.collections DISABLE TRIGGER nt1_collection_notice','06'),('메시지 트리거 중지','ALTER TABLE workhub.messages DISABLE TRIGGER nt1_message_notice','05'),('내부 실행권한 확대','GRANT EXECUTE ON FUNCTION workhub_private.nt1_message_notice() TO authenticated','04')]:
  with H.connect(db=I.DB) as c:
   with c.cursor() as cur:
    cur.execute('BEGIN');cur.execute(mutation);cur.execute(postcheck);rows=cur.fetchall();H.check(label+' 사후점검 훼손 검출',next(r for r in rows if r[0]=='NT1-02-'+suffix)[2]=='FAIL');cur.execute(candidate);H.check(label+' 통합점검 훼손 검출',any(r[2]=='FAIL' for r in cur.fetchall()));cur.execute('ROLLBACK')
 if WRITE:
  TARGET.write_text(candidate,encoding='utf-8',newline='\n');(HERE/'NT1-02_사후점검.sql').write_text(postcheck,encoding='utf-8',newline='\n')
 else:
  H.check('INT-15 재생성 일치',B.read(TARGET)==candidate);H.check('NT1-02 재생성 일치',B.read(HERE/'NT1-02_사후점검.sql')==postcheck)
 manifest={'postcheck':'INT-15','baseline':'INT-14 + NT1-01','rows':18,'source':TARGET.relative_to(ROOT).as_posix(),'bytes':len(candidate.encode()),'sha256':hashlib.sha256(candidate.encode()).hexdigest(),'deltaObjects':len(delta)}
 if WRITE:(HERE/'checks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 else:H.check('INT-15 해시 일치',json.loads(B.read(HERE/'checks.json'))==manifest)
 N.after()
 print('NT1 및 전체 기준 PASS',H.PASS,'FAIL 0',flush=True)
I.H.tests=tests
if __name__=='__main__':I.H.main()
