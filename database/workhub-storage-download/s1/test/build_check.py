"""INT-05의 판정식을 유지하고 S1 함수 지문 한 개만 새 원문으로 바꾼 편집기용 점검."""
from pathlib import Path
import hashlib,json,re,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'database/workhub-deployment/integration/INT-05_전체구축_통합점검.sql'
OLD='7a7e94587b550ee64cfdd04b6b21ed42'
NEW='082ef8d4160ba0577732deed0c6c2221'
START = "WITH m(stage, kind, key, attrs) AS (VALUES\n"
END = "\n),\ns(stage, ord, deps) AS (VALUES"
LITERAL = r"'(?:[^']|'')*'"
ROW = re.compile(r"\s*\((" + LITERAL + r"), (" + LITERAL + r"), (" + LITERAL + r"), (" + LITERAL + r"|NULL)\),?\s*")


def parse(text):
    if text.count(START) != 1 or text.count(END) != 1:
        raise ValueError("목록 경계가 달라졌습니다. 자동 변환하지 않습니다.")
    a = text.index(START) + len(START)
    b = text.index(END, a)
    rows = []
    for line in text[a:b].splitlines():
        match = ROW.fullmatch(line)
        if not match:
            raise ValueError("인식하지 못한 목록 행: " + line[:120])
        cells = [None if v == "NULL" else v[1:-1].replace("''", "'") for v in match.groups()]
        attrs = None if cells[3] is None else json.loads(cells[3])
        if cells[3] is not None and attrs is None:
            raise ValueError("SQL NULL과 JSON null을 구별할 별도 계약이 필요합니다.")
        rows.append(cells[:3] + [attrs])
    if len({tuple(row[:3]) for row in rows}) != len(rows):
        raise ValueError("단계별 객체 키가 중복됩니다.")
    return rows, text[b + len("\n),"):]


def encode(rows):
    values = {k: [] for k in ("s", "t", "k", "a")}
    lookup = {k: {} for k in values}
    encoded = []
    for row in rows:
        ids = []
        for key, value in zip(values, row):
            normalized = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if normalized not in lookup[key]:
                lookup[key][normalized] = len(values[key])
                values[key].append(value)
            ids.append(lookup[key][normalized])
        encoded.append(ids)
    values["r"] = encoded
    restored = [[values[k][i] for k, i in zip(("s", "t", "k", "a"), row)] for row in encoded]
    if restored != rows:
        raise AssertionError("목록의 무손실 복원 실패")
    # 속성 이름·값 조합도 한 번만 보관한다. JSON 타입과 SQL NULL은 그대로 유지한다.
    pairs, pair_lookup, attrs = [], {}, []
    for value in values["a"]:
        if value is None:
            attrs.append(None)
            continue
        if not isinstance(value, dict):
            raise ValueError("예상하지 못한 속성 타입")
        ids = []
        for name, field in value.items():
            pair = [name, field]
            token = json.dumps(pair, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            if token not in pair_lookup:
                pair_lookup[token] = len(pairs)
                pairs.append(pair)
            ids.append(pair_lookup[token])
        attrs.append(ids)
    if [None if ids is None else dict(pairs[i] for i in ids) for ids in attrs] != values["a"]:
        raise AssertionError("속성의 무손실 복원 실패")
    values["a"], values["p"] = attrs, pairs
    return values


def build():
    source=SOURCE.read_text(encoding='utf-8')
    rows,tail=parse(source)
    target=[r for r in rows if r[1:3]==['function','workhub_storage.object_readable(p_name text)']]
    assert len(target)==1 and target[0][3]['body']==OLD
    target[0][3]['body']=NEW
    payload=json.dumps(encode(rows),ensure_ascii=False,separators=(',',':'))
    assert '$s1data$' not in payload
    sql=(
      '-- INT-06: S1-01 적용 후 전체 통합 점검. 읽기 전용. 18행, 12·13 info, 나머지 ok.\n'
      '-- INT-05 원본의 판정식은 같고 object_readable 함수의 승인 지문 한 개만 다릅니다.\n'
      '-- 생성: database/workhub-storage-download/s1/test/build_check.py\n'
      'WITH packed(v) AS (VALUES ($s1data$'+payload+'$s1data$::jsonb)),\n'
      "attrs(id,body) AS MATERIALIZED (SELECT ord-1, CASE WHEN a='null'::jsonb THEN NULL ELSE "
      "(SELECT jsonb_object_agg(pair->>0,pair->1)::text FROM jsonb_array_elements(a) ids(i) "
      "CROSS JOIN LATERAL (SELECT v->'p'->(i::text::integer) AS pair) fields) END "
      "FROM packed CROSS JOIN LATERAL jsonb_array_elements(v->'a') WITH ORDINALITY items(a,ord)),\n"
      "m(stage,kind,key,attrs) AS (SELECT v->'s'->>((r->>0)::integer),v->'t'->>((r->>1)::integer),"
      "v->'k'->>((r->>2)::integer),body FROM packed CROSS JOIN LATERAL jsonb_array_elements(v->'r') rows(r) "
      "JOIN attrs ON id=(r->>3)::integer),"+tail.replace("'INT-05-","'INT-06-"))
    assert len(sql.encode())<750000
    return sql
if __name__=='__main__':
    sql=build();target=HERE/'INT-06_SQL편집기용_통합점검.sql'
    if sys.argv[1:]==['write']:target.write_text(sql,encoding='utf-8',newline='\n')
    else:assert target.read_text(encoding='utf-8')==sql,'점검 생성본 불일치'
    print('PASS INT-06 무손실 목록 생성: '+str(len(sql.encode()))+' bytes')
