"""로컬에 받은 공개 나이스 자료를 검증하고 키 없는 초기 적재 파일·CSV를 만든다. DB 접속 없음."""
import json,sys,hashlib,csv
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'apps/main/api/neis'))
from _provider import normalize,query
def main():
 if len(sys.argv)!=3:raise SystemExit('사용법: python scripts/prepare-neis-reference.py 공개자료.json 출력폴더')
 source=Path(sys.argv[1]);out=Path(sys.argv[2]);out.mkdir(parents=True,exist_ok=True)
 raw=json.loads(source.read_text('utf-8'));school={'officeCode':'K10','schoolCode':'7892043','schoolName':'대동여자중학교'}
 configs=[('schedule','SchoolSchedule','2026-03-01','2027-02-28'),('timetable','misTimetable','2026-11-02','2026-11-15'),('classes','classInfo','2026-03-01','2027-02-28'),('meals','mealServiceDietInfo','2026-11-01','2026-12-31')]
 result={'source':school,'academicYear':2026,'productionApplied':False,'datasets':[]}
 for index,(kind,api,a,b) in enumerate(configs,1):
  query(kind,school,a,b,2026)
  rows=[normalize(kind,r,school,a,b,2026) for r in raw[api]]
  received=len(rows);unique={}
  for r in rows:
   if r['identity'] in unique and unique[r['identity']]['contentHash']!=r['contentHash']:raise ValueError('충돌하는 중복 원본 '+kind)
   unique[r['identity']]=r
  rows=list(unique.values())
  if kind=='timetable' and any(r['semester']!=2 for r in rows):raise ValueError('2학기 외 자료')
  text=json.dumps(rows,ensure_ascii=False,separators=(',',':'))
  if '$neisdata$' in text:raise ValueError('SQL 구분자 충돌')
  (out/(kind+'.json')).write_text(text+'\n',encoding='utf-8',newline='\n')
  if kind=='schedule':columns=['date','title','content','grades','dayKind','loadedOn']
  elif kind=='timetable':columns=['date','grade','className','period','semester','subject','session','loadedOn']
  elif kind=='meals':columns=['date','mealName','menu','calories','loadedOn']
  else:columns=['grade','className','session','loadedOn']
  def cell(v):
   s='·'.join(map(str,v)) if isinstance(v,list) else str(v)
   s=chr(10).join(line.rstrip() for line in s.split(chr(10)))
   return "'"+s if s.lstrip().startswith(('=','+','-','@')) else s
  with (out/(kind+'.csv')).open('w',encoding='utf-8-sig',newline='') as f:
   writer=csv.writer(f);writer.writerow(columns);writer.writerows([[cell(r[k]) for k in columns] for r in rows])
  # 아직 데이터가 없는 정확한 범위만 준비한다. 재실행·운영 최신 자료 덮어쓰기는 거부한다.
  statement="""-- 공개 원본만 초기 캐시에 적재. 기존 일정·운영 시간표에는 쓰지 않는다. N1-03 다음, 파일별 한 번.
BEGIN;
DO $$
DECLARE sid text; n integer; claim jsonb;
BEGIN
 SELECT count(*),min(school_id) INTO n,sid FROM neis_private.connections WHERE active AND office_code='K10' AND school_code='7892043' AND school_name='대동여자중학교';
 IF n<>1 THEN RAISE EXCEPTION '나이스 연결 학교를 확인하세요'; END IF;
 IF EXISTS(SELECT 1 FROM neis_private.datasets WHERE school_id=sid AND kind='KIND' AND school_year=2026 AND from_date='FROM_DATE' AND to_date='TO_DATE') THEN RAISE EXCEPTION '이 범위의 자료가 이미 있습니다. 최신 가져오기를 사용하세요'; END IF;
 claim:=public.workhub_neis_claim(sid,'KIND',2026,'FROM_DATE','TO_DATE');
 PERFORM public.workhub_neis_finish(sid,'KIND',2026,'FROM_DATE','TO_DATE',(claim->>'leaseId')::uuid,$neisdata$DATA$neisdata$::jsonb,NULL);
END $$;
COMMIT;
SELECT '나이스 KIND 초기 원본 준비 완료' AS result;
"""
  for old,new in [('KIND',kind),('FROM_DATE',a),('TO_DATE',b),('DATA',text)]:statement=statement.replace(old,new)
  file='N1-10-'+str(index)+'_'+kind+'_초기원본.sql';(out/file).write_text(statement,encoding='utf-8',newline='\n')
  result['datasets'].append({'kind':kind,'from':a,'to':b,'rawRows':received,'rows':len(rows),'jsonSha256':hashlib.sha256((text+'\n').encode()).hexdigest(),'sqlFile':file,'sqlBytes':len(statement.encode())})
 (out/'manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 print(json.dumps(result,ensure_ascii=False,indent=2))
if __name__=='__main__':main()
