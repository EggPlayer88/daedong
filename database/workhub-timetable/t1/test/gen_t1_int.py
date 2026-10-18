# T1-06 통합 사후 점검(INT-03 + T1)을 시험 DB 에서 기계로 만든다.
#   INT-03 원본(1~8단계 목록)은 고치지 않는다. INT-03 의 생성기(gen_manifest.py)로 R0 → … → P8-04 를 적용해 같은 목록을 만들고,
#   이어서 T1-01 → T1-02 → T1-03 을 한 파일씩 적용하며 T1 이 새로 만든 것 · 바꾼 것 · 없앤 것(T1-02 가 지우는 R0 학기 제약)을 덧붙인다.
#   그래서 T1-06 은 "T1 승인 목록(이름 · 정의 · 권한 · 켜짐 상태)"과 "기존 객체는 승인된 학기 제약 교체 외 차이 0"을 한 번에 본다.
#   --check 는 다시 만들어 저장소의 T1-06 과 한 글자라도 다르면 실패(목록이 SQL 파일과 어긋날 수 없게).
#
# 사용: python3 gen_t1_int.py write|check      (R0 만 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
T1 = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, os.path.abspath(os.path.join(HERE, '..', '..', '..', 'workhub', 'integration', 'test')))
import gen_manifest as gm   # noqa: E402  (INT-03 생성기 그대로 — 목록 범위 · 비교 방식이 INT-03 과 같다)

OUTFILE = os.path.join(T1, 'T1-06_통합사후점검.sql')
T1_STAGES = [
    ('T1-01', ['T1-01_편성기반_모델.sql'],             ['P1', 'P2', 'P5', 'P7', 'P8-01', 'P8-04']),
    ('T1-02', ['T1-02_R0증분_학기기준판_제약.sql'],     ['T1-01']),
    ('T1-03', ['T1-03_편성기반_공개함수.sql'],          ['T1-02']),
]
T1_REC = ",\n".join(f"  ('{st}', 'workhub_private.t1_installs', ARRAY['{st}'])" for st, _, _ in T1_STAGES)
HEADER = """-- ============================================================================
-- T1-06  통합 사후 점검(1~8단계 + T1) — 읽기 전용. 아무것도 바꾸지 않는다. 언제 실행해도 된다.
--
-- ▣ INT-03(1~8단계)은 T1 을 모르므로 T1 설치 뒤 03 · 09 · 10 행이 FAIL 로 나온다. INT-03 원본은 고치지 않고,
--   같은 방식(gen_manifest.py)으로 만든 목록에 T1-01 · T1-02 · T1-03 이 만든 · 바꾼 · 없앤 객체를 덧붙인 것이 이 파일이다.
--     - T1 객체: 이름 · 인자 · 반환형 · 권한 · search_path · 본문 지문 · 트리거 정의와 켜짐 상태 · 제약 정의를 "승인된 목록"과 정확히 비교
--     - 기존 객체: 1~8단계 목록과 정확히 비교. 차이로 허용하는 것은 T1-02 의 학기 제약 교체(R0 CHECK 없앰 · 같은 학기 FK 추가) 하나뿐
--   그래서 status 가 FAIL 인 행이 하나도 없어야 한다(T1 설치 전 DB 에서도 같은 판정 — T1 단계는 적용 기록이 없으면 목록에서 빠진다).
-- ▣ 이 아래는 INT-03 과 같은 본문이고, 행 번호만 T1-06-NN 이다. 단계 조합(01)에 T1-01 · T1-02 · T1-03 이 더해진다.
--   목록은 t1/test/gen_t1_int.py 가 만든다(손으로 고치지 않는다). INT-03 이 바뀌면 이 파일도 다시 만든다(run_all.sh 가 확인).
-- ============================================================================
"""


def apply_t1(name):
    c = gm.conn(); c.cursor().execute(open(os.path.join(T1, name), encoding='utf-8').read()); c.close()


def build():
    manifest = gm.build()                     # R0 → … → P8-04 (INT-03 과 같은 목록)
    prev = gm.snapshot()
    outside0 = set(r[0] for r in gm.rows(gm.OUTSIDE_SQL))
    for stage, files, _ in T1_STAGES:
        for f in files: apply_t1(f)
        cur = gm.snapshot()
        outside = set(r[0] for r in gm.rows(gm.OUTSIDE_SQL)) - outside0
        if outside: sys.exit(f'중단: {stage} 가 점검 범위 밖에 함수를 만들었습니다: {sorted(outside)}')
        for k in sorted(set(prev) | set(cur)):
            if prev.get(k) != cur.get(k): manifest.append((stage, k[0], k[1], cur.get(k)))
        prev = cur
    return manifest


def render(manifest):
    stages0 = gm.STAGES
    gm.STAGES = stages0 + T1_STAGES
    try:
        out = gm.render(manifest)
    finally:
        gm.STAGES = stages0
    last_rec = "  ('P8-04', 'workhub_private.p8_installs', ARRAY['P8-04'])\n"
    if out.count(last_rec) != 1: sys.exit('중단: INT-03 틀의 적용 기록 표(rec) 모양이 바뀌었습니다 — 생성기를 확인해 주세요.')
    out = out.replace(last_rec, last_rec.rstrip('\n') + ',\n' + T1_REC + '\n')
    out = out.replace("'INT-03-' || k.no", "'T1-06-' || k.no").replace("'INT-03-", "'T1-06-")
    return HEADER + out


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    out = render(build())
    if mode == 'write':
        open(OUTFILE, 'w', encoding='utf-8', newline='\n').write(out); print(f'T1-06 작성: {out.count(chr(10))} 줄')
    else:
        same = os.path.exists(OUTFILE) and open(OUTFILE, encoding='utf-8').read() == out
        print(('PASS' if same else 'FAIL') + ' T1-06 의 예상 목록 = 지금 1~8단계 · T1 SQL 파일을 차례로 적용해 만든 목록(손으로 고친 곳 · 낡은 목록 없음)')
        if not same: open(OUTFILE + '.new', 'w', encoding='utf-8', newline='\n').write(out)
        sys.exit(0 if same else 1)
