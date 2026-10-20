"""T4 가져오기 원자성·원키 복구·닫기를 격리 PostgreSQL 17에서 실행한다."""
from pathlib import Path
import os, sys, json, copy, concurrent.futures
ROOT = Path(__file__).resolve().parents[4]
os.environ["P9_TEST_PORT"] = os.environ.get("T4_TEST_PORT", "55539")
sys.path.insert(0, str(ROOT / "database/workhub-school-data/p9/test"))
import run_p9 as pg
os.environ["R0_PGHOST"] = "127.0.0.1"
os.environ["R0_PG_PORT"] = str(pg.PORT)
os.environ["R1_DIR"] = str(ROOT / "database/workhub/r1")
sys.path.insert(0, str(ROOT / "database/workhub-timetable/t1/test"))
import run_t1 as t1
CAPTURES = []
HERE = Path(__file__).resolve().parents[1]

def tests():
    t1.fixtures()
    school, member = pg.q("select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s",(pg.ADMIN,))[0]
    year, term, first, until = pg.q("select t.academic_year_id,t.id,t.starts_on::text,(t.ends_on-1)::text from workhub.terms t where t.school_id=%s and t.term_no=2",(school,))[0]
    admin = t1.A(pg.ADMIN, member)
    for n in ("01", "02", "03", "07"):
        pg.file(next((ROOT/"database/workhub-timetable/t1").glob(f"T1-{n}_*.sql")))
    if os.environ.get("T4_WITH_OPERATIONS")=="1":
        # 같은 설치 묶음이 바꾼 T1/P5 보호 함수 위에서도 가져오기 전체 경로를 재검사한다.
        for folder,prefix,numbers in (
            ("database/workhub-timetable/t2","T2",("01","02","03","04","05","06")),
            ("database/workhub-school-data/p9","P9",("01","02")),
            ("database/workhub-school-data/p10","P10",("01","02")),
            ("database/workhub-timetable/t3","T3",("01","02","03")),
        ):
            for n in numbers:
                pg.file(next((ROOT/folder).glob(f"{prefix}-{n}_*.sql")))
        pg.check("P9·P10·T3 결합 상태에서 가져오기 검증",pg.count("select count(*) from workhub_private.t3_installs")==3)
    for folder, name, extra in (("p1","P1-04",{}),("p5","P5-04",{"counseling_scope":"course_teachers"})):
        pg.q(t1.fill_json(str(next((ROOT/"database/workhub"/folder).glob(name+"_*.sql"))), {"approver_user_id":pg.ADMIN,"approval_ref":"합성 시험 승인",**extra}))
    pg.q(t1.t105())
    pg.q("insert into workhub.year_subjects(id,school_id,academic_year_id,name,sort_order) values('import-subject',%s,%s,'시험교과',1)",(school,year))
    pg.q("insert into workhub.year_classes(id,school_id,academic_year_id,grade,class_no,name,kind,sort_order) values('import-class',%s,%s,1,1,'시험학급','regular',1)",(school,year))
    course_response = admin.tmut(t1.course_cmd("가져오기 수업",term,"import-subject",[member],first,until))
    course = course_response.get("entityId") or course_response.get("data",{}).get("entityId")
    pg.check("기존 P5 수업 생성",bool(course))
    pg.check("기존 T1 학급 연결",t1.ecode(admin.sx(t1.link(course,None,["import-class"]))) is None)
    pg.file(HERE/"T4-01_정식시간표_가져오기.sql")
    post=pg.q((HERE/"T4-02_가져오기_사후점검.sql").read_text(encoding="utf-8"))
    pg.check("사후 점검 전 행 ok "+str(post),len(post)==5 and all(row[-1]=="ok" for row in post))
    pg.check("신규 표 RLS 및 API 표 권한 없음",pg.count("select count(*) from pg_class where relnamespace='workhub'::regnamespace and relname like 'timetable_import_%' and relkind='r' and relrowsecurity")==2 and pg.count("select count(*) from information_schema.role_table_grants where table_schema='workhub' and table_name like 'timetable_import_%' and grantee in('anon','authenticated')")==0)
    pg.check("공개 함수 authenticated만",pg.q("select bool_and(has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')) from pg_proc where pronamespace='public'::regnamespace and proname like 'workhub_timetable_import_%'")[0][0])
    before = pg.q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]
    def rpc(name,*args,uid=pg.ADMIN,mid=member):
        raw = pg.rpc("workhub_timetable_import_"+name, (mid,*[json.dumps(a,ensure_ascii=False) if isinstance(a,(dict,list)) else a for a in args]),uid=uid)
        return raw
    def source():
        r=rpc("get");assert "data" in r,r;return r["data"]
    def inp():
        s=source()
        slot={"id":"slot-a","day":1,"label":"1교시","startMinute":540,"endMinute":585,"periods":1}
        return {"preparation":{"kind":"confirm","sourceRevision":s["sourceRevision"],"sourceFingerprint":s["sourceFingerprint"],"termId":s["termId"],
            "draftId":s["savedDraft"]["id"] if s["savedDraft"] else None,"expectedDraftRevision":s["savedDraft"]["revision"] if s["savedDraft"] else None,
            "draft":{"title":"가져온 시간표","slots":[slot],"plans":[{"courseId":course,"weeklyPeriods":1,"blocks":[{"id":"activity-a","periods":1,"allowedSlotIds":["slot-a"]}]}]}},
            "placements":[{"lessonId":"activity-a","slotId":"slot-a"}],"title":"가져온 시간표","fileHash":"a"*64}
    def preview(i=None):
        i=i or inp();r=rpc("preview",i);assert "data" in r,r
        p=r["data"];return {"previewId":p["previewId"],"fingerprint":p["fingerprint"],"input":i},r
    command, raw = preview()
    CAPTURES.append({"kind":"source","raw":rpc("get")})
    CAPTURES.append({"kind":"preview","raw":raw,"input":command["input"]})
    pg.check("미리보기는 기준판 저장 안 함",pg.count("select count(*) from workhub.timetable_basis_revisions")==0)
    result=rpc("commit",command,"import-key-001")
    pg.check("기준판과 편성 초안 함께 저장", "data" in result and pg.count("select count(*) from workhub.timetable_basis_revisions")==1 and pg.count("select count(*) from workhub.timetable_drafts")==1)
    CAPTURES.append({"kind":"receipt","raw":result,"command":command,"key":"import-key-001"})
    pg.check("원래 요청 동일 접수증",rpc("commit",command,"import-key-001")==result)
    def expire(preview_id):
        # 격리 시험에서만 시간을 훼손해 만료를 재현하고, 보호 트리거를 즉시 되켠다.
        with pg.connect() as con:
            with con.cursor() as cur:
                cur.execute("alter table workhub.timetable_import_previews disable trigger timetable_import_preview_immutable")
                cur.execute("update workhub.timetable_import_previews set expires_at=now()-interval '1 hour' where id=%s",(preview_id,))
                cur.execute("alter table workhub.timetable_import_previews enable trigger timetable_import_preview_immutable")
    expire(command["previewId"])
    pg.q("update workhub.module_activations set state='stopped' where school_id=%s and module='timetable'",(school,))
    pg.check("중지·만료 뒤 원접수증 복구",rpc("commit",command,"import-key-001")==result)
    applied=rpc("close",command,"import-key-001")
    pg.check("이미 반영된 요청 닫기는 원접수증",applied["data"]["outcome"]=="applied" and applied["data"]["receipt"]==result["data"])
    CAPTURES.append({"kind":"close","raw":applied,"command":command,"key":"import-key-001"})
    pg.q("update workhub.module_activations set state='active' where school_id=%s and module='timetable'",(school,))
    modified=copy.deepcopy(command);modified["input"]["title"]="다른 내용"
    pg.check("같은 번호 다른 명령 거부",rpc("commit",modified,"import-key-001")["error"]["code"]=="IDEMPOTENCY_CONFLICT")
    c,_=preview();expire(c["previewId"])
    closed=rpc("close",c,"import-close-001");pg.check("만료된 미처리 요청도 명시적 종료",closed["data"]["outcome"]=="closed")
    CAPTURES.append({"kind":"close","raw":closed,"command":c,"key":"import-close-001"})
    pg.check("닫기 뒤 늦은 저장 차단",rpc("commit",c,"import-close-001")["error"]["code"]=="CONFLICT")
    pg.check("닫기 재전송 동일 응답",rpc("close",c,"import-close-001")==closed)
    pg.check("다른 번호로 같은 미리보기 재사용 거부",rpc("commit",c,"different-key")["error"]["code"]=="CONFLICT")
    counts=lambda:pg.q("select (select count(*) from workhub.timetable_basis_revisions),(select count(*) from workhub.timetable_drafts),(select sum(revision) from workhub.timetable_prep_drafts)")[0]
    c,_=preview();old=counts()
    # 내부 두 번째 저장을 실패시켜 첫 기준판 저장도 같은 하위 트랜잭션에서 되돌아가는지 검증.
    pg.q("create function workhub_private.t4_test_failure() returns trigger language plpgsql as $$begin raise exception 'CONFLICT';end$$;create trigger t4_test_failure before insert on workhub.timetable_drafts for each row execute function workhub_private.t4_test_failure()")
    pg.check("두 번째 저장 실패 전체 원자 롤백",rpc("commit",c,"atomic-key-001")["error"]["code"]=="CONFLICT" and counts()==old)
    pg.q("drop trigger t4_test_failure on workhub.timetable_drafts;drop function workhub_private.t4_test_failure()")
    pg.check("동일 원번호로 다시 시도 성공","data" in rpc("commit",c,"atomic-key-001"))
    c,_=preview();old=counts()
    pg.q("update workhub.timetable_prep_drafts set revision=revision+1 where school_id=%s",(school,))
    pg.check("다른 관리자 초안 변경 충돌",rpc("commit",c,"stale-key-001")["error"]["code"]=="CONFLICT" and counts()[:2]==old[:2])
    for index, patch in enumerate([{"placements":[]},{"title":""},{"fileHash":"bad"},{"preparation":None}]):
        bad=inp();bad.update(patch)
        pg.check("깨진 입력 거부 "+str(index),rpc("preview",bad).get("error",{}).get("code")=="INVALID_INPUT")
    bad=inp();bad["placements"]=[{"lessonId":"activity-a","slotId":"missing"}]
    pg.check("참조 없는 배치 거부",rpc("preview",bad).get("error",{}).get("code")=="INVALID_INPUT")
    for index in range(3):
        c,_=preview();key="race-key-"+str(index)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            a=pool.submit(rpc,"commit",c,key);b=pool.submit(rpc,"close",c,key);a=a.result();b=b.result()
        outcome=b["data"]["outcome"]
        pg.check("동시 적용/닫기 한 가지 결과 "+str(index),outcome=="applied" and a.get("data")==b["data"]["receipt"] or outcome=="closed" and a.get("error",{}).get("code")=="CONFLICT")
    pg.check("교사 권한으로 학교 전체 가져오기 차단",rpc("get",uid=t1.T[21],mid=t1.M[21]).get("error",{}).get("code")=="FORBIDDEN")
    c,_=preview()
    try: r=rpc("close",c,"other-user-key",uid=t1.T[21])
    except Exception as ex:r=str(ex)
    pg.check("다른 사용자 소속 위조 차단",not isinstance(r,dict) or "data" not in r)
    pg.check("기존 가입 회원 보존",pg.q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]==before)
    for table in ("timetable_import_previews","timetable_import_requests"):
        try: pg.q("delete from workhub."+table);blocked=False
        except Exception: blocked=True
        pg.check("이력 삭제 차단 "+table,blocked)
    target=Path(os.environ.get("T4_CAPTURE",str(pg.WORK/"t4-captures.json")))
    target.write_text(json.dumps(CAPTURES,ensure_ascii=False,indent=2),encoding="utf-8");print("T4_CAPTURE",target)
pg.tests=tests
if __name__=="__main__":pg.main()
