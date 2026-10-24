"""INT-07의 판정식과 목록을 보존하고 학교 원문 읽기 함수 지문만 바꾼다."""
from pathlib import Path
import json, sys
ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'database/workhub-storage-download/s2/test'))
import build_s2_check as S2
OLD = '72e0136b120d4ee5ec38993b67d1d4c0'
NEW = '8bc5e3e6ef6762573f8230127b0dd70d'

def build():
    rows, tail = S2.S1.parse(S2.S1.SOURCE.read_text(encoding='utf-8'))
    for key, old, new in [
        ('workhub_storage.object_readable(p_name text)', S2.S1.OLD, S2.S1.NEW),
        ('workhub_storage.document_readable(p_name text, p_object uuid)', S2.OLD, S2.NEW),
        ('workhub_storage.knowledge_readable(p_name text, p_object uuid)', OLD, NEW),
    ]:
        target = [r for r in rows if r[1:3] == ['function', key]]
        assert len(target) == 1 and target[0][3]['body'] == old
        target[0][3]['body'] = new
    payload = json.dumps(S2.S1.encode(rows), ensure_ascii=False, separators=(',', ':'))
    assert '$s3data$' not in payload
    base = S2.build()
    suffix = base.index('$s2data$::jsonb)),') + len('$s2data$')
    sql = ('-- INT-08: S1·S2·S3 이후 읽기 전용 전체 점검. 18행, 12·13 info, 나머지 ok.\n'
           '-- INT-05와 판정식은 같고 승인할 다운로드 함수 지문 세 개만 다릅니다.\n'
           '-- 생성: database/workhub-storage-download/s3/test/build_s3_check.py\n'
           'WITH packed(v) AS (VALUES ($s3data$' + payload + '$s3data$' + base[suffix:])
    sql = sql.replace("'INT-07-", "'INT-08-")
    assert sql.endswith(tail.replace("'INT-05-", "'INT-08-"))
    assert len(sql.encode()) < 750000
    return sql

if __name__ == '__main__':
    sql = build()
    target = HERE / 'INT-08_SQL편집기용_통합점검.sql'
    if sys.argv[1:] == ['write']:
        target.write_text(sql, encoding='utf-8', newline='\n')
    else:
        assert target.read_text(encoding='utf-8') == sql
    print('PASS INT-08 무손실 목록 생성: ' + str(len(sql.encode())) + ' bytes')
