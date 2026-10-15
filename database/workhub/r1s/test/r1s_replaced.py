# R1S-01 이 교체하는 R1-03 함수 5개를 R1-03 원문에서 만들어 낸다(차이 = 아래 DELTAS 뿐임을 기계로 보장).
# 사용: python3 r1s_replaced.py            → 교체 묶음을 출력
#       python3 r1s_replaced.py --check    → R1S-01 파일 안의 묶음이 R1-03 원문 + DELTAS 와 같은지 확인(같으면 exit 0)
import hashlib, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
R1 = os.path.join(HERE, '..', '..', 'r1', 'R1-03_공개함수_Storage.sql')
R1S01 = os.path.join(HERE, '..', 'R1S-01_모델_쓰기게이트.sql')
BEGIN, END = '-- >>> R1-03 함수 교체 묶음 시작', '-- <<< R1-03 함수 교체 묶음 끝'

# (함수 이름, [(원문 조각, 바꿀 조각)]) — 조각마다 원문에 정확히 1번 있어야 한다.
DELTAS = [
  ('c_require', [(
"""  IF p_level = 'write' THEN
    r := workhub_private.c_readiness(p_ctx.school_id, p_ctx.school_today);""",
"""  IF p_level = 'write' THEN
    -- R1S: 기본 확인 프로필을 켠 학교는 그 프로필의 준비 상태로 쓰기를 판정한다(검증 작업자 heartbeat 를 보지 않는다).
    --      켠 학교에서 프로필 조건이 깨지면 기존 작업자 경로로 넘어가지 않고 닫는다(NOT_READY).
    IF workhub_private.c_basic_mode(p_ctx.school_id) THEN
      r := workhub_private.c_basic_readiness(p_ctx.school_id, p_ctx.school_today);
      IF NOT (r ->> 'available')::boolean THEN RAISE EXCEPTION 'NOT_READY'; END IF;
      RETURN workhub_private.c_basic_effective(p_ctx.school_id, p_ctx.school_today);
    END IF;
    r := workhub_private.c_readiness(p_ctx.school_id, p_ctx.school_today);""")]),
  ('c_file_problem', [(
"""  IF f.scan_state = 'not_scanned' AND NOT ((p_eff ->> 'allowUnscanned')::boolean""",
"""  -- R1S: 기본 확인(hwpx_basic_v1)으로 확정된 파일은 그 프로필이 지금 쓰기 정책일 때만 새로 붙일 수 있다.
  --      allowUnscanned 와는 별개 경로이고, 악성 검사를 한 것으로 보지 않는다(scan_state 는 not_scanned 그대로).
  IF f.scan_state = 'not_scanned'
     AND NOT (p_eff ->> 'basicProfile' IS NOT NULL AND f.verification ->> 'profile' = p_eff ->> 'basicProfile'
              AND workhub_private.c_basic_evidence_ok(f))
     AND NOT ((p_eff ->> 'allowUnscanned')::boolean""")]),
  ('c_parent_resolve', [(
"""  v_code := workhub_private.c_file_problem(f, p_eff, s.file_policy);""",
"""  -- R1S: 읽기(목록 파일 내려받기·ZIP·Storage 읽기)는 쓰기와 다른 판정을 쓴다. 지금 쓰기 정책이 HWPX 로 줄어도
  --      이미 받은 PDF 등 과거 파일을 막지 않는다(요청서 42 '보존 1'). 상태·정리 원장·요청 정책·미검사 판정은 그대로.
  v_code := workhub_private.c_file_read_problem(f, p_eff, s.file_policy);""")]),
  ('c_prepare', [(
"""      's:' || p_ctx.school_id, eff ->> 'uploadPolicyId', eff ->> 'commonPolicyId')
  RETURNING * INTO f;
""",
"""      's:' || p_ctx.school_id, eff ->> 'uploadPolicyId', eff ->> 'commonPolicyId')
  RETURNING * INTO f;
  -- R1S: 기본 확인 프로필로 받은 예약이면 그 사실을 같은 트랜잭션에 고정한다(검증 작업 대기열에 넣지 않는 근거).
  IF eff ->> 'basicProfile' IS NOT NULL THEN
    INSERT INTO workhub.file_basic_checks (file_id, school_id, profile, activation_id)
    VALUES (f.id, f.school_id, eff ->> 'basicProfile', eff ->> 'basicActivationId');
  END IF;
""")]),
  ('c_complete', [(
"""        INSERT INTO workhub.file_verification_jobs (school_id, file_id) VALUES (f.school_id, f.id) ON CONFLICT (file_id) DO NOTHING;""",
"""        -- R1S: 기본 확인 프로필 파일은 검증 작업자 대기열에 넣지 않는다(서버 API 의 claim/finish 가 확인한다).
        IF NOT EXISTS (SELECT 1 FROM workhub.file_basic_checks b WHERE b.file_id = f.id) THEN
          INSERT INTO workhub.file_verification_jobs (school_id, file_id) VALUES (f.school_id, f.id) ON CONFLICT (file_id) DO NOTHING;
        END IF;""")]),
]

def original(src, name):
    m = re.search(r'^CREATE FUNCTION workhub_private\.' + name + r'\(.*?^END \$\$;\n', src, re.S | re.M)
    assert m, name
    return m.group(0)

def build():
    src = open(R1, encoding='utf-8').read()
    out = [BEGIN + ' (자동 생성: test/r1s_replaced.py — R1-03 원문에서 아래 표시한 R1S 부분만 다르다)\n']
    for name, deltas in DELTAS:
        body = original(src, name)
        for old, new in deltas:
            assert body.count(old) == 1, (name, old[:60])
            body = body.replace(old, new)
        out.append(body.replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION', 1) + '\n')
    out.append(END + '\n')
    return ''.join(out)

def body_md5(sql):
    # pg_proc.prosrc = $$ 와 $$ 사이 본문. md5(prosrc) 를 파일만으로 계산한다(R1S-00·01·03 의 판 지문).
    return {m.group(1): hashlib.md5(m.group(2).encode('utf-8')).hexdigest()
            for m in re.finditer(r'FUNCTION workhub_private\.(\w+)\(.*?AS \$\$(.*?)\$\$;', sql, re.S)}

if __name__ == '__main__':
    block = build()
    if '--check' in sys.argv:
        ok = True
        text = open(R1S01, encoding='utf-8').read()
        i, j = text.find(BEGIN), text.find(END)
        assert i >= 0 and j > i, 'R1S-01 에 교체 묶음 표시가 없습니다'
        got = text[i:j + len(END) + 1]
        ok &= got == block
        print('PASS R1S-01 교체 함수 5개 = R1-03 원문 + R1S 표시 부분' if got == block else 'FAIL R1S-01 교체 묶음이 R1-03 원문과 다릅니다')
        src = open(R1, encoding='utf-8').read()
        orig = body_md5(''.join(original(src, n) for n, _ in DELTAS))
        new = body_md5(block)
        miss = [n for n, h in orig.items() if f"('{n}', '{h}')" not in text]
        ok &= not miss
        print('PASS R1S-01 시작 점검의 R1-03 원문 지문 5개' if not miss else f'FAIL R1S-01 원문 지문 불일치 {miss}')
        for f in ('R1S-00_사전점검_지문.sql', 'R1S-03_사후점검.sql'):
            t = open(os.path.join(HERE, '..', f), encoding='utf-8').read()
            miss = [n for n, h in new.items() if f"('{n}','{h}')" not in t]
            if f.startswith('R1S-00'):
                miss += [n for n, h in orig.items() if f"('{n}','{h}')" not in t]
            ok &= not miss
            print(f'PASS {f} 의 함수 판 지문' if not miss else f'FAIL {f} 함수 판 지문 불일치 {miss}')
        sys.exit(0 if ok else 1)
    sys.stdout.write(block)
