# T2-07 통합 사후 점검(INT-03 + T1-01~03 + T1-07 + T2-01~06)을 시험 DB 에서 기계로 만든다.
#   T1-09 생성기(gen_t1_09.py → gen_t1_int.py → INT-03 의 gen_manifest.py)를 그대로 쓰고 단계 목록에 T2 여섯 묶음을 더한다.
#   T2-02 는 P8-02 의 알림 출처 CHECK 를 바꾸므로, T2-02 적용 기록이 있으면 T2-02 판으로, 없으면 P8-02 판으로 대조한다.
#   INT-03 · T1-06 · T1-09 원본은 고치지 않는다. T2 전 DB 에서도 T1-09 와 같은 판정(FAIL 0)이어야 한다.
#
# 사용: python3 gen_t2_07.py write|check      (R0 만 적용된 시험 DB 에서 — run_all.sh 가 준비한다)
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
T2 = os.path.abspath(os.path.join(HERE, '..'))
sys.path.insert(0, os.path.join(T2, '..', 't1', 'test'))
import gen_t1_09 as g9   # noqa: E402  (gen_t1_int 의 단계 목록에 T1-07 을 더해 둔 상태)
g = g9.g

OUTFILE = os.path.join(T2, 'T2-07_통합사후점검.sql')
T2_STAGES = [
    ('T2-01', ['../t2/T2-01_운영_모델.sql'],          ['T1-07']),
    ('T2-02', ['../t2/T2-02_알림출처_시간표.sql'],    ['T2-01', 'P8-02']),
    ('T2-03', ['../t2/T2-03_조회_공개.sql'],          ['T2-01']),
    ('T2-04', ['../t2/T2-04_교환_요청.sql'],          ['T2-03']),
    ('T2-05', ['../t2/T2-05_학사변경.sql'],           ['T2-04']),
    ('T2-06', ['../t2/T2-06_실시기록.sql'],           ['T2-05']),
]
g.T1_STAGES = g.T1_STAGES + T2_STAGES
g.T1_REC = ",\n".join(f"  ('{st}', 'workhub_private.{'t2' if st.startswith('T2') else 't1'}_installs', ARRAY['{st}'])" for st, _, _ in g.T1_STAGES)
g.HEADER = """-- ============================================================================
-- T2-07  통합 사후 점검(1~8단계 + T1-01~03 + T1-07 + T2-01~06) — 읽기 전용. 아무것도 바꾸지 않는다. 언제 실행해도 된다.
--
-- ▣ T1-09 에 T2(시간표 운영)를 더한 판이다. T2 는 새 표 · 함수를 만들고, T2-02 는 알림 출처 CHECK(P8-02 판)를 넓힌다.
--   그래서 T2 뒤에는 T1-09 의 03(목록에 없는 함수) · 09~10(제약) 행과 T1-08 의 개수 행이 FAIL 로 나온다. T2 뒤에는 T1-09 대신 이 파일을 본다.
--     - T2 객체: 이름 · 인자 · 반환형 · 권한 · search_path · 본문 지문 · 트리거 정의와 켜짐 상태 · 제약 정의를 "승인된 목록"과 정확히 비교
--       (T2-02 가 바꾼 알림 출처 CHECK 는 T2-02 적용 기록이 있으면 T2-02 의 정의로, 없으면 P8-02 의 정의로 비교한다)
--     - 기존 객체: 1~8단계 · T1 목록과 정확히 비교
--   그래서 status 가 FAIL 인 행이 하나도 없어야 한다(T2 전 · T2 일부만 적용한 DB 에서도 같은 판정).
-- ▣ 이 아래는 INT-03 과 같은 본문이고, 행 번호만 T2-07-NN 이다. 단계 조합(01)에 T1 네 묶음과 T2 여섯 묶음이 더해진다.
--   목록은 t2/test/gen_t2_07.py 가 만든다(손으로 고치지 않는다). INT-03 · T1 · T2 가 바뀌면 이 파일도 다시 만든다.
-- ============================================================================
"""


def render(manifest):
    return g.render(manifest).replace("'T1-06-", "'T2-07-")


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    out = render(g.build())
    if mode == 'write':
        open(OUTFILE, 'w', encoding='utf-8', newline='\n').write(out); print(f'T2-07 작성: {out.count(chr(10))} 줄')
    else:
        same = os.path.exists(OUTFILE) and open(OUTFILE, encoding='utf-8').read() == out
        print(('PASS' if same else 'FAIL') + ' T2-07 의 예상 목록 = 지금 1~8단계 · T1 · T1-07 · T2 SQL 파일을 차례로 적용해 만든 목록(손으로 고친 곳 · 낡은 목록 없음)')
        if not same: open(OUTFILE + '.new', 'w', encoding='utf-8', newline='\n').write(out)
        sys.exit(0 if same else 1)
