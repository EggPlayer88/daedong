"""검토/실행 SQL의 LF 정규화 SHA-256 목록. 운영 DB에는 연결하지 않는다."""
from pathlib import Path
import hashlib,json,sys
HERE=Path(__file__).resolve().parent
def inventory():
 return {'version':1,'encoding':'UTF-8, LF','baseline':'INT-09','postcheck':'INT-10',
  'files':[{'file':p.name,'bytes':len(p.read_text(encoding='utf-8').encode()),
   'sha256':hashlib.sha256(p.read_text(encoding='utf-8').encode()).hexdigest()} for p in sorted(HERE.glob('*.sql'))]}
if __name__=='__main__':
 result=inventory();target=HERE/'sql-package.json'
 if sys.argv[1:]==['write']:target.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
 elif sys.argv[1:]:raise SystemExit('지원 인자: write 또는 생략')
 elif json.loads(target.read_text(encoding='utf-8'))!=result:raise SystemExit('OP1 SQL 목록/해시가 다릅니다.')
 print('OP1 SQL files:',len(result['files']))
