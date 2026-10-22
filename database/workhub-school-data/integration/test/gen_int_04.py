"""적용 SQL 원본은 바꾸지 않고 P9/P10/T3/T4까지 포함한 읽기 전용 전체 점검을 생성한다."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/"database/workhub-school-data/p9/test"))
import gen_p9_05 as base
g=base.g
def stage_file(folder,prefix):
    files=list((ROOT/folder).glob(prefix+"_*.sql"))
    if len(files)!=1:raise RuntimeError(f"단계 파일이 하나여야 합니다: {folder}/{prefix}: {files}")
    return os.path.relpath(files[0],ROOT/"database/workhub-timetable/t1").replace("\\","/")
for prefix,deps,folder in [
 ("P10-01",["P9-02","T2-06"],"database/workhub-school-data/p10"),
 ("P10-02",["P10-01"],"database/workhub-school-data/p10"),
 ("T3-01",["T2-06","P10-02"],"database/workhub-timetable/t3"),
 ("T3-02",["T3-01"],"database/workhub-timetable/t3"),
 ("T3-03",["T3-02"],"database/workhub-timetable/t3"),
 ("T4-01",["T1-07"],"database/workhub-timetable/t4"),
]:
    g.T1_STAGES.append((prefix,[stage_file(folder,prefix)],deps))
def table(stage):
    return "workhub_private."+stage.split("-")[0].lower()+"_installs"
g.T1_REC=",\n".join(f"  ('{stage}', '{table(stage)}', ARRAY['{stage}'])" for stage,_,_ in g.T1_STAGES)
g.HEADER="""-- INT-04 통합 사후점검. R0/R1/R1S/P1~P8/T1/T2/P9/P10/T3/T4의 적용 단계별 실제 정의를 비교한다.
-- 읽기 전용이다. 운영 적용·활성화·자료 변경을 하지 않는다.
-- test/gen_int_04.py가 격리 PostgreSQL17에서 원본 SQL을 순서대로 적용하여 생성한다.
-- 기존 INT-03/T2-07/P9-05를 수정하지 않는다. 신규 운영 확장 설치 뒤에는 이 파일로 전체를 점검한다.
"""
def generate():
    result=g.render(g.build()).replace("'T1-06-","'INT-04-")
    target=HERE/"INT-04_운영확장_통합점검.sql"
    if os.environ.get("WORKHUB_WRITE_INT04")=="1":target.write_text(result,encoding="utf-8",newline="\n")
    elif not target.exists() or target.read_text(encoding="utf-8")!=result:raise RuntimeError("INT-04 예상 목록이 현재 SQL과 다릅니다.")
    return result
