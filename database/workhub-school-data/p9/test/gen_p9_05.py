"""T2-07의 생성기를 재사용해 P9 포함 통합 점검을 만든다. 운영 연결은 받지 않는다."""
import os,sys
from pathlib import Path
import psycopg2
ROOT=Path(__file__).resolve().parents[4]
P9=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"database/workhub-timetable/t2/test"))
os.environ["R0_PGHOST"]="127.0.0.1"
os.environ["R0_PG_PORT"]=os.environ.get("P9_TEST_PORT","55519")
import gen_t2_07 as t2
g=t2.g
def connection():
    # 이 데이터베이스는 run_p9.py가 새 임시 클러스터 안에 R0만 설치해 만든다.
    c=psycopg2.connect(host="127.0.0.1",port=int(os.environ["R0_PG_PORT"]),dbname="p9_manifest",user="postgres")
    c.autocommit=True
    return c
g.gm.conn=connection
g.T1_STAGES=g.T1_STAGES+[
 ("P9-01",["../../workhub-school-data/p9/P9-01_교사연결_모델과함수.sql"],["P1","P2"]),
 ("P9-02",["../../workhub-school-data/p9/P9-02_담당교사후보_분리.sql"],["P9-01","P5","P8-04"]),
]
g.T1_REC=",\n".join(f"  ('{stage}', 'workhub_private.{'p9' if stage.startswith('P9') else 't2' if stage.startswith('T2') else 't1'}_installs', ARRAY['{stage}'])" for stage,_,_ in g.T1_STAGES)
g.HEADER="""-- P9-05 통합 사후 점검: R0/R1/R1S/P1~P8/T1/T2/P9 설치 단계에 맞는 전체 함수·제약·트리거·권한 목록.
-- 읽기 전용. test/gen_p9_05.py로 격리 PostgreSQL 17에서 생성한다. 기존 T2-07 파일은 고치지 않는다.
-- P9 설치 뒤에는 이 파일을 사용한다. P9 승인 양식과 소속 연결 실행은 포함하지 않는다.
"""
def generate():
    text=g.render(g.build()).replace("'T1-06-","'P9-05-")
    target=P9/"P9-05_통합사후점검.sql"
    if os.environ.get("P9_WRITE_MANIFEST")=="1":
        target.write_text(text,encoding="utf-8",newline="\n")
    elif not target.exists() or target.read_text(encoding="utf-8")!=text:
        raise RuntimeError("P9-05 점검 기대값이 현재 SQL 원본과 다릅니다.")
    with connection() as c:
        with c.cursor() as cur:
            cur.execute(text);result=cur.fetchall()
    if any(row[2]=="FAIL" for row in result):raise RuntimeError(f"P9 통합 점검 실패: {result}")
    return text,result
