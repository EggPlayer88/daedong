"""새 임시 PostgreSQL 17에만 설치하는 K1 읽기 계약 회귀. 운영 DSN은 받지 않는다."""
from pathlib import Path
import os, sys, json, subprocess, importlib.util

ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parents[1]
os.environ["P9_PG_BIN"]=os.environ["K1_PG_BIN"]
os.environ["P9_TEST_PORT"]=os.environ.get("K1_TEST_PORT","55579")
spec=importlib.util.spec_from_file_location("k1_fixture",ROOT/"database/workhub-school-data/p9/test/run_p9.py")
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)
captures=[]

def tests():
    school,member,account=f.q("select m.school_id,m.id,m.account_id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s",(f.ADMIN,))[0]
    def functions():
        return f.q("select p.oid,md5(pg_get_functiondef(p.oid)),p.proacl::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workhub_private','workhub_storage') and p.prokind='f' order by p.oid")
    before=functions()
    f.file(HERE/"K1-01_학교자료_판별조회.sql")
    after={x[0]:x[1:] for x in functions()}
    f.check("기존 함수 본문·권한 전부 보존",all(after[x[0]]==x[1:] for x in before))
    f.check("새 공개 함수 2개만 추가",len(after)==len(before)+2)
    f.check("K1 사후 점검 4행 통과",len(f.file(HERE/"K1-02_사후점검.sql"))==4 and all(r[2]=="ok" for r in f.file(HERE/"K1-02_사후점검.sql")))
    try:f.file(HERE/"K1-01_학교자료_판별조회.sql")
    except Exception as ex:f.check("재실행은 기존 함수 덮어쓰기 없이 중단","같은 이름" in str(ex))
    else:raise AssertionError("K1 재설치 허용")
    f.check("함수 소유자·search_path·definer",f.count("select count(*) from pg_proc where oid in('public.workhub_knowledge_get(text,text,integer)'::regprocedure,'public.workhub_knowledge_history(text,text,integer)'::regprocedure) and proowner='postgres'::regrole and prosecdef and proconfig=array['search_path=\"\"']")==2)
    f.check("authenticated만 실행",f.count("select count(*) from pg_proc where oid in('public.workhub_knowledge_get(text,text,integer)'::regprocedure,'public.workhub_knowledge_history(text,text,integer)'::regprocedure) and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute')")==2)
    def call(kind,source,number=None,who=member,uid=f.ADMIN):
        name="workhub_knowledge_"+kind
        result=f.rpc(name,(who,source,number),uid)
        if "data" in result:
            captures.append({"name":str(len(captures))+" "+kind,"kind":kind,"raw":result,"memberId":who,"schoolId":result["schoolId"],"sourceId":source,"version":number,"before":number})
        return result
    f.check("미활성 get은 NOT_READY",call("get","absent",1)["error"]["code"]=="NOT_READY")
    f.check("미활성 history도 NOT_READY",call("history","absent")["error"]["code"]=="NOT_READY")
    f.q("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values(%s,'knowledge','active',%s,'합성 K1 시험')",(school,member))
    def mutate(c,k):
        r=f.rpc("workhub_knowledge_mutate",(member,json.dumps(c,ensure_ascii=False),k))
        if "data" not in r:raise AssertionError(r)
        return r["data"]
    inp={"title":"규정 첫판","kind":"regulation","body":"첫판 내용","locator":"제1조","effectiveFrom":"2026-03-01","effectiveThrough":""}
    first=mutate({"kind":"create","input":inp},"k1-source-create");sid=first["id"]
    for version in range(1,55):
        mutate({"kind":"update","id":sid,"expectedVersion":version,"input":{**inp,"title":"규정 "+str(version+1),"body":"본문 "+str(version+1)}},"k1-update-"+str(version))
    mutate({"kind":"publish","id":sid,"expectedVersion":55,"reason":"합성 게시"},"k1-publish")
    mutate({"kind":"retire","id":sid,"expectedVersion":56,"reason":"합성 종료"},"k1-retire")
    old=call("get",sid,1)["data"];latest=call("get",sid,57)["data"]
    f.check("과거 제목·본문·상태를 최신으로 대체하지 않음",old["source"]["title"]=="규정 첫판" and old["source"]["body"]=="첫판 내용" and old["source"]["status"]=="draft" and old["isCurrent"] is False)
    f.check("종료된 최신판 정확 조회",latest["source"]["version"]==57 and latest["source"]["status"]=="retired" and latest["isCurrent"] is True)
    page1=call("history",sid)["data"];page2=call("history",sid,page1["nextBeforeVersion"])["data"]
    f.check("50판+7판 내림차순 무누락",len(page1["items"])==50 and page1["nextBeforeVersion"]==8 and [x["version"] for x in page1["items"]+page2["items"]]==list(range(57,0,-1)) and page2["nextBeforeVersion"] is None)
    f.check("첫 페이지 최신판만 현재 표시",sum(x["isCurrent"] for x in page1["items"]+page2["items"])==1)
    for n in (0,-1,None):
        f.check("잘못된 판 거부 "+str(n),call("get",sid,n)["error"]["code"]=="INVALID_INPUT")
    f.check("없는 판 NOT_FOUND",call("get",sid,999)["error"]["code"]=="NOT_FOUND")
    f.check("없는 자료 NOT_FOUND",call("history","absent")["error"]["code"]=="NOT_FOUND")
    f.check("잘못된 커서 INVALID_INPUT",call("history",sid,0)["error"]["code"]=="INVALID_INPUT")
    # 실제 회원과 무관한 격리 자료: 기존 superadmin 게이트를 통과하되 지식 관리 역할이 없는 독자를 만든다.
    f.q("update public.users set role='superadmin' where id=%s",(f.TEACHER,))
    f.q("insert into workhub.accounts(id,auth_user_id,display_name,status,legacy_approval_state) values('k1-reader',%s,'합성 독자','active','approved')",(f.TEACHER,))
    f.q("insert into workhub.memberships(id,school_id,account_id,status,valid_from,decided_at) values('k1-reader-member',%s,'k1-reader','active','2020-01-01',now())",(school,))
    reader="k1-reader-member"
    f.check("다른 작성자 초안 NOT_FOUND",call("get",sid,1,reader,f.TEACHER)["error"]["code"]=="NOT_FOUND")
    readhist=call("history",sid,None,reader,f.TEACHER)["data"]
    f.check("초안 제목은 이력에도 없음",[x["version"] for x in readhist["items"]]==[57,56] and readhist["canManage"] is False)
    f.check("과거 게시판은 역할없는 독자도 기존권한대로 읽음",call("get",sid,56,reader,f.TEACHER)["data"]["source"]["status"]=="published")
    f.check("원본파일 접근도 같은 과거판을 사용",f.rpc("workhub_knowledge_original_access",(reader,sid,56),f.TEACHER)["data"]=={"available":False})
    f.check("초안 원본파일 역시 거절",f.rpc("workhub_knowledge_original_access",(reader,sid,1),f.TEACHER)["error"]["code"]=="NOT_FOUND")
    try:call("get",sid,56,member,f.TEACHER)
    except Exception as ex:f.check("타인 소속번호 거부","INACTIVE_MEMBERSHIP" in str(ex))
    else:raise AssertionError("타인 소속 번호 허용")
    f.q("insert into workhub.schools(id,code,name,school_level,grade_count,status) values('k1-other','k1-other','다른 학교','middle',3,'active')")
    f.q("insert into workhub.memberships(id,school_id,account_id,status,valid_from,decided_at) values('k1-other-member','k1-other',%s,'active','2020-01-01',now())",(account,))
    f.q("insert into workhub.module_activations(school_id,module,state,approved_by_membership_id,approval_ref) values('k1-other','knowledge','active','k1-other-member','합성 시험')")
    f.check("다른 학교 자료 get 비노출",call("get",sid,56,"k1-other-member")["error"]["code"]=="NOT_FOUND")
    f.check("다른 학교 이력 비노출",call("history",sid,None,"k1-other-member")["error"]["code"]=="NOT_FOUND")
    snapshot=f.q("select md5(string_agg(row_to_json(r)::text,'' order by source_id,version)) from workhub.knowledge_source_revisions r")[0][0]
    call("history",sid);call("get",sid,1)
    f.check("읽기로 불변판·기존함수 변경 없음",snapshot==f.q("select md5(string_agg(row_to_json(r)::text,'' order by source_id,version)) from workhub.knowledge_source_revisions r")[0][0] and functions()==list((oid,*values) for oid,values in after.items()))
    f.q("update workhub.module_activations set state='stopped' where school_id=%s and module='knowledge'",(school,))
    f.check("모듈 중지 후 과거 원문도 차단",call("get",sid,1)["error"]["code"]=="NOT_READY")
    f.check("모듈 중지 후 이력도 차단",call("history",sid)["error"]["code"]=="NOT_READY")
    out=f.WORK/"k1-captures.json";out.write_text(json.dumps(captures,ensure_ascii=False,indent=2),encoding="utf-8")
    env={**os.environ,"KNOWLEDGE_HISTORY_CAPTURE":str(out)}
    f.run("node",ROOT/"tests/test_workhub_knowledge_history.mjs",cwd=ROOT,env=env)
    f.check("실제 SQL 응답 모두 앱 parser 일치",True)
    print("CAPTURES",out,flush=True)

def main():
    exe=".exe" if os.name=="nt" else ""
    version=subprocess.check_output([str(f.PG/("postgres"+exe)),"--version"],text=True)
    if " 17." not in version:raise RuntimeError("PostgreSQL 17만 지원합니다.")
    log=(f.WORK/"k1-run.log").open("w",encoding="utf-8");started=False
    try:
        f.run(f.PG/("initdb"+exe),"-D",f.DATA,"-U","supabase_admin","--encoding=UTF8","--no-locale","-A","trust",stdout=log,stderr=log)
        f.run(f.PG/("pg_ctl"+exe),"-D",f.DATA,"-l",f.WORK/"server.log","-o",f"-h 127.0.0.1 -p {f.PORT}","-w","start",stdout=log,stderr=log);started=True
        f.check("서버는 새 임시 폴더",Path(f.q("show data_directory",user="supabase_admin",db="postgres")[0][0]).resolve()==f.DATA)
        f.setup();tests();print(f"K1 합계 PASS {f.PASS} · FAIL 0",flush=True)
    finally:
        if started:f.run(f.PG/("pg_ctl"+exe),"-D",f.DATA,"-m","fast","-w","stop",stdout=log,stderr=log)
        log.close();print("격리 시험 파일",f.WORK,flush=True)
if __name__=="__main__":main()
