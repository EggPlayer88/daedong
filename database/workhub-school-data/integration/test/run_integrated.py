"""새 로컬 PG17에서 전체 설치 및 통합 점검의 훼손 검출을 확인한다. 운영 DSN은 받지 않는다."""
from pathlib import Path
import os,sys
ROOT=Path(__file__).resolve().parents[4]
os.environ["P9_TEST_PORT"]=os.environ.get("WORKHUB_INT_TEST_PORT","55559")
sys.path.insert(0,str(ROOT/"database/workhub-school-data/p9/test"))
import run_p9 as pg
def tests():
    import gen_int_04
    db="p9_manifest"
    before=pg.q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u",db=db)[0][0]
    manifest=gen_int_04.generate()
    def report():return pg.q(manifest,db=db)
    result=report()
    pg.check("R0부터 P10·T3·T4 전체 설치 후 통합 점검 FAIL 0",len(result)==13 and all(r[2]!="FAIL" for r in result))
    pg.check("전체 설치 중 기존 회원 내용 보존",pg.q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u",db=db)[0][0]==before)
    pg.check("설치만으로 정정 정책 활성화 안 됨",pg.q("select count(*) from workhub.school_data_policies where active",db=db)[0][0]==0)
    pg.check("설치만으로 시간표 운영 시범 정책 활성화 안 됨",pg.q("select count(*) from workhub.timetable_intervention_policies where active",db=db)[0][0]==0)
    pg.q("alter table workhub.timetable_import_requests disable trigger timetable_import_request_immutable",db=db)
    pg.check("전체 점검이 새 요청 원장 보호 해제를 검출",any(r[2]=="FAIL" for r in report()))
    pg.q("alter table workhub.timetable_import_requests enable trigger timetable_import_request_immutable",db=db)
    pg.q("grant execute on function public.workhub_timetable_import_get(text) to anon",db=db)
    pg.check("전체 점검이 익명 함수 권한 추가를 검출",any(r[2]=="FAIL" for r in report()))
    pg.q("revoke execute on function public.workhub_timetable_import_get(text) from anon",db=db)
    pg.check("훼손 복구 후 전체 점검 FAIL 0",all(r[2]!="FAIL" for r in report()))
    print("INT04",[(r[0],r[2]) for r in report()],flush=True)
pg.tests=tests
if __name__=="__main__":pg.main()
