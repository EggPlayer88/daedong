"""격리 DB에서 얻은 MP1 차이만 INT-08에 더한다. 기존 판정식을 완화하지 않는다."""
import json
from build_mp1 import HERE, S3

def build(delta):
 base=S3.build(); tag='$s3data$'; packed=json.loads(base.split(tag)[1])
 attrs=[None if ids is None else dict(packed['p'][i] for i in ids) for ids in packed['a']]
 rows=[[packed['s'][s],packed['t'][t],packed['k'][k],attrs[a]] for s,t,k,a in packed['r']]
 rows += [['MP1-01',kind,key,value] for kind,key,value in delta]
 payload=json.dumps(S3.S2.S1.encode(rows),ensure_ascii=False,separators=(',',':'))
 tail=base.split(tag)[2]
 tail=tail.replace("('M1-01', 39, 'P6')", "('M1-01', 39, 'P6'),\n  ('MP1-01', 40, 'P3 P9-02 M1-01')")
 tail=tail.replace("('M1-01', 'workhub_private.m1_installs', ARRAY['M1-01'])", "('M1-01', 'workhub_private.m1_installs', ARRAY['M1-01']),\n  ('MP1-01', 'workhub_private.mp1_installs', ARRAY['MP1-01'])")
 sql='-- INT-09: S1·S2·S3·MP1 이후 읽기 전용 전체 점검. 18행, 12·13 info, 나머지 ok.\nWITH packed(v) AS (VALUES ($mp1data$'+payload+'$mp1data$'+tail.replace('INT-08-','INT-09-')
 assert len(sql.encode())<750000
 return sql

def postcheck(delta,catalog):
 # 통합 목록과 독립적으로 MP1이 건드린 객체의 속성을 직접 대조한다.
 payload=json.dumps(delta,ensure_ascii=False,separators=(',',':'))
 return """-- MP1-02 읽기 전용 사후 점검. 01~06 ok, 07 info(허용 상태).
WITH expected(kind,key,attrs) AS (
 SELECT x->>0,x->>1,x->2 FROM jsonb_array_elements($mp1$"""+payload+"""$mp1$::jsonb) x
), actual(kind,key,attrs,owner) AS ("""+catalog+"""), differences AS (
 SELECT e.kind,e.key FROM expected e LEFT JOIN actual a USING(kind,key)
 WHERE a.attrs IS DISTINCT FROM e.attrs
), groups(no,kind,item) AS (VALUES ('01','function','메신저 한정 함수 19개 원문·실효 권한'),
 ('02','table','표·RLS·소유자·실효 권한'),('03','column','열·기본값·실효 권한'),
 ('04','constraint','허용 인원·소속·학교 제약'),('05','index','인덱스'))
SELECT 'MP1-02-'||g.no AS no,g.item,
 CASE WHEN EXISTS(SELECT 1 FROM differences d WHERE d.kind=g.kind) THEN 'FAIL' ELSE 'ok' END AS status,
 coalesce((SELECT string_agg(d.key,', ' ORDER BY d.key) FROM differences d WHERE d.kind=g.kind),'') AS value
FROM groups g
UNION ALL SELECT 'MP1-02-06','함수 소유자 postgres',CASE WHEN EXISTS(
 SELECT 1 FROM expected e LEFT JOIN actual a USING(kind,key) WHERE e.kind='function' AND a.owner IS DISTINCT FROM 'postgres') THEN 'FAIL' ELSE 'ok' END,''
UNION ALL SELECT 'MP1-02-07','시험 계정 허용 상태','info',
 jsonb_build_object('registered',count(*),'active',count(*) FILTER(WHERE active AND expires_at>clock_timestamp()))::text
 FROM workhub.messaging_pilot_grants
ORDER BY no;
"""

def save_or_check(delta,catalog,write=False):
 target=HERE/'test/catalog_delta.json'; value=json.dumps(delta,ensure_ascii=False,indent=2)+'\n'
 sql=build(delta); check=HERE/'INT-09_SQL편집기용_통합점검.sql'
 post=postcheck(delta,catalog);postpath=HERE/'MP1-02_사후점검.sql'
 if write:
  target.write_text(value,encoding='utf-8',newline='\n');check.write_text(sql,encoding='utf-8',newline='\n')
  postpath.write_text(post,encoding='utf-8',newline='\n')
 else:
  assert target.read_text(encoding='utf-8')==value,'MP1 실제 DB 목록이 다릅니다.'
  assert check.read_text(encoding='utf-8')==sql,'INT-09 재생성 결과가 다릅니다.'
  assert postpath.read_text(encoding='utf-8')==post,'MP1-02 재생성 결과가 다릅니다.'
 return sql
