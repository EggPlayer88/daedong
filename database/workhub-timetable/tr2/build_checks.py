"""현재 전체 설치와 CL1 위에 TR2를 더해 INT-17을 검증한다. 운영 DSN 없음."""
from pathlib import Path
import os,sys,json,importlib.util,hashlib
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
WRITE=sys.argv[1:]==['--write']
if sys.argv[1:] and not WRITE:raise SystemExit('지원 인자: --write 또는 생략')
sys.argv=[sys.argv[0]]
os.environ.setdefault('WORKHUB_DEPLOYMENT_TEST_PORT','55847')
spec=importlib.util.spec_from_file_location('tr2_int16',ROOT/'database/workhub-calendar-lifecycle/cl1/build_checks.py')
C=importlib.util.module_from_spec(spec);spec.loader.exec_module(C);I=C.I;H=C.H;B=C.B;q=I.run
# 이번 PR의 새 CL1·TR2 산출물만 함께 생성한다. 그 이전 확정 기준은 읽기 전용 대조다.
C.WRITE=WRITE
TARGET=HERE/'INT-17_명부시간표운영연결포함_통합점검.sql'

def scoped(source):return source.replace("'teacher_roster','teacher_pilot')","'teacher_roster','teacher_pilot','timetable_roster_bridge')")

def assemble(base,delta):
 packed=json.loads(base.split('$int16data$')[1])
 attrs=[None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
 rows=[[packed['s'][s],packed['t'][t],packed['k'][k],attrs[a]] for s,t,k,a in packed['r']]+delta
 payload=json.dumps(B.B.B.B.MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=scoped(base.split('$int16data$')[2]).replace('INT-16-','INT-17-').replace('54단계','55단계')
 tail=B.replace_once(tail,"('CL1-01',53,'NT1-01')","('CL1-01',53,'NT1-01'),\n ('TR2-01',54,'CL1-01')")
 tail=B.replace_once(tail,"WHEN s.stage = 'CL1-01' THEN","WHEN s.stage = 'TR2-01' THEN (to_regnamespace('timetable_roster_bridge') IS NOT NULL)::int + (to_regprocedure('public.workhub_timetable_roster_bridge_commit(text,jsonb,text,boolean)') IS NOT NULL)::int\n              WHEN s.stage = 'CL1-01' THEN")
 tail=B.replace_once(tail,"'NT1-01','CL1-01')","'NT1-01','CL1-01','TR2-01')")
 return '-- INT-17: 기존 INT-16 + 명부 시간표 운영 연결 TR2. 읽기 전용 18행, 12·13 info.\nWITH packed(v) AS (VALUES ($int17data$'+payload+'$int17data$'+tail

def postcheck():
 rows=q("SELECT n.nspname||'.'||p.proname||'('||oidvectortypes(p.proargtypes)||')',md5(replace(p.prosrc,E'\\r\\n',E'\\n')),p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='timetable_roster_bridge' OR (n.nspname='public' AND p.proname LIKE 'workhub_timetable_roster_bridge_%') ORDER BY 1")
 vals=',\n'.join("('%s','%s',%s)"%(s,h,str(sd).lower()) for s,h,sd in rows)
 triggers=q("SELECT t.tgname,md5(pg_get_triggerdef(t.oid)),t.tgrelid::regclass::text FROM pg_trigger t JOIN pg_proc f ON f.oid=t.tgfoid WHERE NOT t.tgisinternal AND (t.tgrelid IN('timetable_roster_bridge.sources'::regclass,'timetable_roster_bridge.requests'::regclass) OR f.pronamespace='timetable_roster_bridge'::regnamespace) ORDER BY 1")
 trigger_vals=',\n'.join("('%s','%s','%s')"%(name,h,rel) for name,h,rel in triggers)
 constraints=q("SELECT conname,md5(pg_get_constraintdef(oid)) FROM pg_constraint WHERE conrelid='workhub.timetable_basis_revisions'::regclass AND conname IN('timetable_basis_origin_check','timetable_basis_roster_origin_fkey') ORDER BY 1")
 constraint_vals=',\n'.join("('%s','%s')"%(n,h) for n,h in constraints)
 return (HERE/'test/postcheck.template.sql').read_text('utf-8').replace('__FUNCTIONS__',vals).replace('__TRIGGERS__',trigger_vals).replace('__CONSTRAINTS__',constraint_vals)

def guard_tests(install):
 signature='workhub_private.t2_publish_plan(workhub_private.actor_context,jsonb,text,timestamp with time zone)'
 for label,mutation in [('함수 원문',None),('함수 소유자','ALTER FUNCTION '+signature+' OWNER TO supabase_admin'),('기준판 RLS','ALTER TABLE workhub.timetable_basis_revisions DISABLE ROW LEVEL SECURITY'),('기준판 제약','ALTER TABLE workhub.timetable_basis_revisions DROP CONSTRAINT timetable_basis_revisions_body_check')]:
  with H.connect(user='supabase_admin',db=I.DB) as connection:
   with connection.cursor() as cur:
    cur.execute('BEGIN')
    if mutation:cur.execute(mutation)
    else:
     cur.execute('SELECT pg_get_functiondef(%s::regprocedure)',(signature,));source=cur.fetchone()[0];changed=source.replace('BEGIN','BEGIN\n -- TR2 실패 주입',1)
     if changed==source:raise AssertionError('원문 실패 주입 위치 없음')
     cur.execute(changed)
    cur.execute('SET LOCAL ROLE postgres');cur.execute('SAVEPOINT guard')
    try:cur.execute(install);raise AssertionError('TR2 훼손 전신 설치 허용')
    except H.psycopg2.Error as error:H.check('TR2 '+label+' 설치 가드',any(message in str(error) for message in ['predecessor mismatch','basis provenance mismatch','basis protection mismatch']))
    cur.execute('ROLLBACK TO guard');cur.execute("SELECT to_regnamespace('timetable_roster_bridge')");H.check('TR2 '+label+' 거절 후 새 객체 없음',cur.fetchone()[0] is None);cur.execute('ROLLBACK')

def tests():
 C.tests()
 import gen_int_05 as G
 catalog=scoped(B.scoped(B.B.scoped(B.B.B.scoped(B.B.B.B.scoped(G.g.gm.CATALOG_SQL)))))
 snapshot=lambda:{(kind,key):attrs for kind,key,attrs,_ in q(catalog)}
 tables=[r[0] for r in q("SELECT quote_ident(n.nspname)||'.'||quote_ident(c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND n.nspname IN('public','auth','storage','workhub','workhub_private','workhub_storage','site_presentation','neis_private','teacher_roster','teacher_pilot') ORDER BY 1")]
 def data():
  result={}
  for table in tables:
   body="to_jsonb(t)-'roster_source_id'" if table=='workhub.timetable_basis_revisions' else 'to_jsonb(t)'
   result[table]=q('SELECT md5(coalesce(string_agg(v::text,chr(10) ORDER BY v::text),\'\')),count(*) FROM (SELECT '+body+' v FROM '+table+' t) x')[0]
  return result
 original=snapshot();before=data();precheck=(HERE/'TR2-00_전후점검.sql').read_text('utf-8');pre=q(precheck)
 H.check('TR2-00 설치 전 6행·FAIL 0',len(pre)==6 and all(row[2]!='FAIL' for row in pre))
 install=(HERE/'TR2-01_명부시간표_운영연결.sql').read_text('utf-8')
 # 아직 적용하지 않은 새 파일의 전신 가드를 작성자가 현재 전체 기준과 대조한다.
 # 조회 결과만 보관하며 가드 자체를 자동 완화하거나 바꾸지 않는다.
 predecessors=[]
 for row in json.loads(install.split('$expected$')[1]):
  meta=q("SELECT md5(replace(pg_get_functiondef(oid),E'\\r\\n',E'\\n')),pg_get_userbyid(proowner),prosecdef,proconfig FROM pg_proc WHERE oid=to_regprocedure(%s)",(row[0],))
  if not meta:raise AssertionError('TR2 전신 함수 누락: '+row[0])
  predecessors.append([row[0],*meta[0]])
 (ROOT/'.tmp-tr2-current-predecessors.json').write_text(json.dumps(predecessors,ensure_ascii=False),encoding='utf-8')
 constraints=q("SELECT conname,pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='workhub.timetable_basis_revisions'::regclass ORDER BY conname")
 (ROOT/'.tmp-tr2-current-basis-constraints.json').write_text(json.dumps(constraints,ensure_ascii=False),encoding='utf-8')
 H.check('TR2 설치 가드는 현재 CL1 포함 전신과 동일',predecessors==json.loads(install.split('$expected$')[1]) and [list(r) for r in constraints]==json.loads(install.split('$constraints$')[1]))
 guard_tests(install)
 q(install)
 post=q(precheck);H.check('TR2-00 설치 전후 F1~F4 지문 동일',[r for r in pre if r[0].startswith('F')]==[r for r in post if r[0].startswith('F')])
 after=snapshot();delta=[['TR2-01',kind,key,after.get((kind,key))] for kind,key in sorted(set(original)|set(after)) if original.get((kind,key))!=after.get((kind,key))]
 H.check('TR2 설치는 기존 모든 표의 행·원문·권한·비용 보존',data()==before)
 H.check('TR2 기존 함수 원문·권한 모두 보존',all(original[k]==after.get(k) for k in original if k[0]=='function'))
 H.check('TR2 객체 변화는 새 연결 스키마·RPC·기준판 출처만',all('timetable_roster_bridge' in key or 'timetable_basis_revisions' in key for _,_,key,_ in delta))
 check=postcheck();candidate=assemble(B.read(C.TARGET),delta)
 for label,source,total in [('TR2-02',check,8),('INT-17',candidate,18)]:
  rows=q(source);H.check(label+' FAIL 0',len(rows)==total and all(r[2]!='FAIL' for r in rows))
 for label,mutation in [('원본 불변 트리거 중지','ALTER TABLE timetable_roster_bridge.sources DISABLE TRIGGER tr2_sources_immutable'),('원본 RLS 중지','ALTER TABLE timetable_roster_bridge.sources DISABLE ROW LEVEL SECURITY'),('기준판 계보 제약 제거','ALTER TABLE workhub.timetable_basis_revisions DROP CONSTRAINT timetable_basis_origin_check'),('내부 함수 실행 누출','GRANT EXECUTE ON FUNCTION timetable_roster_bridge.actor(text,boolean) TO authenticated')]:
  with H.connect(db=I.DB) as connection:
   with connection.cursor() as cur:
    cur.execute('BEGIN');cur.execute(mutation);cur.execute(check);H.check(label+' 사후점검 검출',any(r[2]=='FAIL' for r in cur.fetchall()));cur.execute(candidate);H.check(label+' 통합점검 검출',any(r[2]=='FAIL' for r in cur.fetchall()));cur.execute('ROLLBACK')
 if WRITE:
  TARGET.write_text(candidate,encoding='utf-8',newline='\n');(HERE/'TR2-02_사후점검.sql').write_text(check,encoding='utf-8',newline='\n')
 else:
  H.check('INT-17 재생성 일치',B.read(TARGET)==candidate);H.check('TR2-02 재생성 일치',B.read(HERE/'TR2-02_사후점검.sql')==check)
 manifest={'postcheck':'INT-17','baseline':'INT-16 + TR2-01','rows':18,'source':TARGET.relative_to(ROOT).as_posix(),'bytes':len(candidate.encode()),'sha256':hashlib.sha256(candidate.encode()).hexdigest(),'deltaObjects':len(delta)}
 if WRITE:(HERE/'checks.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 else:H.check('INT-17 해시 일치',json.loads(B.read(HERE/'checks.json'))==manifest)
 # 최신 설치 기준에서 실제 TR1 22명·9학급·288교시를 만들어 날짜별 운영까지 검증한다.
 # 합성 자료는 점검 산출물을 고정한 뒤에만 생성한다.
 sys.path.insert(0,str(HERE/'test'));import bridge_cases
 bridge_cases.configure(I);bridge_cases.tests()
 print('CL1·TR2 전체 기준 PASS',H.PASS,'FAIL 0',flush=True)
I.H.tests=tests
if __name__=='__main__':I.H.main()
