"""INT-05의 판정식·목록을 보존하고 S1·S2 함수 지문 두 개만 교체한다."""
from pathlib import Path
import json,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'database/workhub-storage-download/s1/test'))
import build_check as S1
OLD='43c7e6cd7a65a6685b20bd92a6c377a5'
NEW='626c7b65dca171d673cdea98db7e07a6'

def build():
    rows,tail=S1.parse(S1.SOURCE.read_text(encoding='utf-8'))
    for key,old,new in [('workhub_storage.object_readable(p_name text)',S1.OLD,S1.NEW),
                        ('workhub_storage.document_readable(p_name text, p_object uuid)',OLD,NEW)]:
        target=[r for r in rows if r[1:3]==['function',key]]
        assert len(target)==1 and target[0][3]['body']==old
        target[0][3]['body']=new
    payload=json.dumps(S1.encode(rows),ensure_ascii=False,separators=(',',':'))
    assert '$s2data$' not in payload
    # 이미 시험된 무손실 사전 복원 CTE를 사용한다. 판정식은 INT-05 그대로다.
    base=S1.build()
    start=base.index('WITH packed')
    suffix=base.index("$s1data$::jsonb)),",start)+len('$s1data$')
    sql=('-- INT-07: S1·S2 적용 후 전체 통합 점검. 읽기 전용. 18행, 12·13 info, 나머지 ok.\n'
         '-- INT-05와 판정식이 같고 승인된 함수 본문 지문 두 개만 다릅니다.\n'
         '-- 생성: database/workhub-storage-download/s2/test/build_s2_check.py\n'
         'WITH packed(v) AS (VALUES ($s2data$'+payload+'$s2data$'+base[suffix:])
    sql=sql.replace("'INT-06-","'INT-07-")
    assert sql.endswith(tail.replace("'INT-05-","'INT-07-"))
    assert len(sql.encode())<750000
    return sql

if __name__=='__main__':
    sql=build();target=HERE/'INT-07_SQL편집기용_통합점검.sql'
    if sys.argv[1:]==['write']:target.write_text(sql,encoding='utf-8',newline='\n')
    else:assert target.read_text(encoding='utf-8')==sql,'점검 생성본 불일치'
    print('PASS INT-07 무손실 목록 생성: '+str(len(sql.encode()))+' bytes')
