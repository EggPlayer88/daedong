# T1-09 통합 사후 점검(INT-03 + T1-01~03 + T1-07)을 시험 DB 에서 기계로 만든다.
#   T1-06 생성기(gen_t1_int.py)를 그대로 쓰고 단계 목록에 T1-07 하나를 더한다. T1-06 · INT-03 원본은 고치지 않는다.
#   T1-07 이 바꾼 것(t1_term 본문 · 넓힌 제약 2개)과 새로 만든 것(표 · 함수)이 "T1-07 단계"로 목록에 들어가므로,
#   T1-07 전 DB 에서는 T1-06 과 같은 판정, T1-07 뒤에는 새 정의 기준으로 FAIL 0 이어야 한다.
#
# 사용: python3 gen_t1_09.py write|check      (R0 만 적용된 시험 DB 에서 — run_all_t1_07.sh 가 준비한다)
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import gen_t1_int as g   # noqa: E402

OUTFILE = os.path.join(g.T1, 'T1-09_통합사후점검.sql')
g.T1_STAGES = g.T1_STAGES + [('T1-07', ['T1-07_대상학기_선택.sql'], ['T1-03'])]
g.T1_REC = ",\n".join(f"  ('{st}', 'workhub_private.t1_installs', ARRAY['{st}'])" for st, _, _ in g.T1_STAGES)
g.HEADER = """-- ============================================================================
-- T1-09  통합 사후 점검(1~8단계 + T1-01~03 + T1-07) — 읽기 전용. 아무것도 바꾸지 않는다. 언제 실행해도 된다.
--
-- ▣ T1-06 에 T1-07(준비 대상 학기 고르기)을 더한 판이다. T1-07 은 T1 객체 몇 개를 바꾸므로(t1_term 본문 · t1_installs 와
--   timetable_requests 의 제약) T1-07 뒤에는 T1-06 의 그 행들이 FAIL 로 나온다. T1-07 뒤에는 T1-06 대신 이 파일을 본다.
--     - T1 · T1-07 객체: 이름 · 인자 · 반환형 · 권한 · search_path · 본문 지문 · 트리거 정의와 켜짐 상태 · 제약 정의를 "승인된 목록"과 정확히 비교
--       (T1-07 이 바꾼 객체는 T1-07 적용 기록이 있으면 T1-07 의 정의로, 없으면 T1-01 의 정의로 비교한다)
--     - 기존 객체: 1~8단계 목록과 정확히 비교. 차이로 허용하는 것은 T1-02 의 학기 제약 교체 하나뿐
--   그래서 status 가 FAIL 인 행이 하나도 없어야 한다(T1-07 전 · T1 전 DB 에서도 같은 판정).
-- ▣ 이 아래는 INT-03 과 같은 본문이고, 행 번호만 T1-09-NN 이다. 단계 조합(01)에 T1-01 · T1-02 · T1-03 · T1-07 이 더해진다.
--   목록은 t1/test/gen_t1_09.py 가 만든다(손으로 고치지 않는다). INT-03 · T1 · T1-07 이 바뀌면 이 파일도 다시 만든다.
-- ============================================================================
"""


def render(manifest):
    return g.render(manifest).replace("'T1-06-", "'T1-09-")


if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
    out = render(g.build())
    if mode == 'write':
        open(OUTFILE, 'w', encoding='utf-8', newline='\n').write(out); print(f'T1-09 작성: {out.count(chr(10))} 줄')
    else:
        same = os.path.exists(OUTFILE) and open(OUTFILE, encoding='utf-8').read() == out
        print(('PASS' if same else 'FAIL') + ' T1-09 의 예상 목록 = 지금 1~8단계 · T1 · T1-07 SQL 파일을 차례로 적용해 만든 목록(손으로 고친 곳 · 낡은 목록 없음)')
        if not same: open(OUTFILE + '.new', 'w', encoding='utf-8', newline='\n').write(out)
        sys.exit(0 if same else 1)
