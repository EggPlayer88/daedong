"""새 localhost PG17에 확정 SQL을 설치해 증분 사후 점검을 생성한다. 운영 연결 인자를 받지 않는다."""
from pathlib import Path
import os,sys,json
ROOT=Path(__file__).resolve().parents[3];HERE=Path(__file__).resolve().parent
if len(sys.argv)!=1:raise RuntimeError('인자를 받지 않습니다.')
if any(v and (k.upper().startswith('PG') or k in ['DATABASE_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) for k,v in os.environ.items()):raise RuntimeError('외부 접속 환경을 허용하지 않습니다.')
sys.path.insert(0,str(ROOT/'database/workhub-deployment/integration/test'))
import run_integrated as I
from build import build

def compile_catalog():
 import gen_int_05 as G
 # 사전 설치만 수행한다. 실제 업무·파일·메시지·AI 요청은 실행하지 않는다.
 I.Q('create database '+I.DB+' owner postgres template p9_manifest',user='supabase_admin',db='postgres')
 for stage,files,deps in G.g.gm.STAGES[1:]:
  for name in files:I.apply(Path(G.g.gm.WH)/name,name.endswith('P7-05_R1_P2_보강_별도승인.sql'))
 for stage,files,deps in G.g.T1_STAGES:
  for name in files:I.apply(Path(G.g.T1)/name)
 for folder,prefix in [('workhub-storage-download/s1','S1-01'),('workhub-storage-download/s2','S2-01'),('workhub-storage-download/s3','S3-01'),('workhub-messaging-pilot/mp1','MP1-01')]:
  I.apply(next((ROOT/'database'/folder).glob(prefix+'_*.sql')))
 before={(k,key):a for k,key,a,_ in I.run(G.g.gm.CATALOG_SQL)}
 gates=I.run("select proname,prosrc,proacl from pg_proc where proname in ('legacy_gate','member_actor','p2_member_reachable') order by proname")
 I.run(build())
 assert gates==I.run("select proname,prosrc,proacl from pg_proc where proname in ('legacy_gate','member_actor','p2_member_reachable') order by proname")
 after={(k,key):a for k,key,a,_ in I.run(G.g.gm.CATALOG_SQL)}
 delta=[[k,key,after.get((k,key))] for k,key in sorted(set(before)|set(after)) if before.get((k,key))!=after.get((k,key))]
 sys.path.insert(0,str(ROOT/'database/workhub-messaging-pilot/mp1/test'))
 import build_checks as MP
 base=MP.build(json.loads((ROOT/'database/workhub-messaging-pilot/mp1/test/catalog_delta.json').read_text(encoding='utf-8')))
 packed=json.loads(base.split('$mp1data$')[1]);attrs=[None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
 rows=[[packed['s'][s],packed['t'][t],packed['k'][k],attrs[a]] for s,t,k,a in packed['r']]
 rows += [['OP1-01',k,key,value] for k,key,value in delta]
 payload=json.dumps(MP.S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=base.split('$mp1data$')[2].replace("('MP1-01', 40, 'P3 P9-02 M1-01')","('MP1-01', 40, 'P3 P9-02 M1-01'),\n ('OP1-01',41,'MP1-01 P8-03 T3-03')")
 tail=tail.replace("('MP1-01', 'workhub_private.mp1_installs', ARRAY['MP1-01'])","('MP1-01', 'workhub_private.mp1_installs', ARRAY['MP1-01']),\n ('OP1-01','workhub_private.op1_installs',ARRAY['OP1-01'])")
 sql='-- INT-10: OP1 이후 읽기 전용 전체 구조 점검. 업무 동작 시험은 별도입니다.\nWITH packed(v) AS (VALUES ($op1data$'+payload+'$op1data$'+tail.replace('INT-09-','INT-10-')
 result=I.run(sql);assert len(result)==18 and all(r[2]!='FAIL' for r in result),result
 post=MP.postcheck(delta,G.g.gm.CATALOG_SQL).replace('MP1-02','OP1-02').replace('메신저 한정 함수 19개','업무 참여 진입점').replace('workhub.messaging_pilot_grants','workhub.participant_grants').replace('시험 계정 허용 상태','업무 참여 허용 상태')
 post=post.replace("('05','index','인덱스'))","('05','index','인덱스'),('08','trigger','원장 보호 트리거'))")
 post=post.replace('01~06 ok, 07 info(허용 상태).','01~06·08 ok, 07 info(등록·기간 내 활성 수).')
 result=I.run(post);assert len(result)==8 and all(r[2]!='FAIL' for r in result),result
 (HERE/'OP1-02_사후점검.sql').write_text(post,encoding='utf-8',newline='\n')
 (HERE/'INT-10_SQL편집기용_통합점검.sql').write_text(sql,encoding='utf-8',newline='\n')
 (HERE/'catalog-delta.json').write_text(json.dumps(delta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 print('OP1 오프라인 설치·점검 생성 완료',len(delta),'객체 변경 · 일반 계정 허용 0명',flush=True)
I.H.tests=compile_catalog
if __name__=='__main__':I.H.main()
