"""격리 PostgreSQL 17 시험. 운영 DSN을 받지 않고 새 임시 DB를 localhost에만 연다."""
from pathlib import Path
import os, sys, subprocess, tempfile, json, datetime, hashlib, concurrent.futures
import psycopg2
ROOT = Path(__file__).resolve().parents[4]
W = ROOT / "database/workhub"
P9 = Path(__file__).resolve().parents[1]
PG = Path(os.environ["P9_PG_BIN"]).resolve()
# CI의 내장 PostgreSQL은 bin 옆 lib를 사용한다. 시스템 PostgreSQL에는 영향이 없다.
if os.name != "nt" and (PG.parent / "lib").is_dir():
    os.environ["LD_LIBRARY_PATH"] = str(PG.parent / "lib") + (os.pathsep + os.environ["LD_LIBRARY_PATH"] if os.environ.get("LD_LIBRARY_PATH") else "")
WORK = Path(tempfile.mkdtemp(prefix="workhub-p9-pg17-")).resolve()
DATA = WORK / "data"
PORT = int(os.environ.get("P9_TEST_PORT", "55519"))
if not 49152 <= PORT <= 65535:
    raise RuntimeError("시험용 높은 포트만 허용합니다.")
sys.stdout.reconfigure(encoding="utf-8")
CAPTURES = []
PASS = 0
def run(*args, **kw):
    return subprocess.run([str(x) for x in args], check=True,
        creationflags=subprocess.CREATE_NO_WINDOW if os.name=="nt" else 0, **kw)
def connect(user="postgres",db="r0"):
    c=psycopg2.connect(host="127.0.0.1",port=PORT,user=user,dbname=db,connect_timeout=5)
    c.autocommit=True
    return c
def q(sql,args=None,user="postgres",db="r0"):
    c=connect(user,db)
    try:
        with c.cursor() as cur:
            cur.execute(sql,args)
            return cur.fetchall() if cur.description else []
    finally:c.close()
def file(p,user="postgres"):
    return q(Path(p).read_text(encoding="utf-8"),user=user)
def check(name,condition):
    global PASS
    if not condition: raise AssertionError(name)
    PASS+=1; print("PASS",name,flush=True)
ADMIN="00000000-0000-0000-0000-000000000001"
TEACHER="00000000-0000-0000-0000-000000000002"
PENDING="00000000-0000-0000-0000-000000000003"
OTHER="00000000-0000-0000-0000-000000000006"
def rpc(name,args=(),uid=ADMIN):
    with connect() as c:
        with c.cursor() as cur:
            cur.execute("set role authenticated")
            cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(uid,))
            cur.execute("select public."+name+"("+",".join(["%s"]*len(args))+")",args)
            return cur.fetchone()[0]
def count(sql): return q(sql)[0][0]
def setup():
    q("create database r0",user="supabase_admin",db="postgres")
    file(W/"r0/test/mock_supabase.sql","supabase_admin")
    for p in sorted((ROOT/"migrations").glob("00[1-7]_*.sql")): file(p)
    file(W/"r0/test/seed.sql","supabase_admin")
    file(W/"r1/test/mock_storage_r1.sql","supabase_admin")
    inp=WORK/"inputs";inp.mkdir()
    run(sys.executable,W/"r0/test/gen_inputs.py",W/"r0/R0-03_학교초기설정.sql",inp,stdout=subprocess.DEVNULL)
    for p in [W/"r0/R0-01_B01_기반.sql",W/"r0/R0-02_B02_일정업무.sql",inp/"R0-03_filled.sql"]: file(p)
    q("create database p9_manifest owner postgres template r0",user="supabase_admin",db="postgres")
    for n in ("01","02","03"): file(next((W/"r1").glob("R1-"+n+"_*.sql")))
    for batch in ("p1","p2","p3","p4","p5","p7"):
        for n in ("01","02"): file(next((W/batch).glob(batch.upper()+"-"+n+"_*.sql")))
    for n in ("01","02","03","04"): file(next((W/"p8").glob("P8-"+n+"_*.sql")))
def candidate_newline_tests():
    # 운영 SQL Editor가 보존한 CRLF도 같은 원본으로 판정하되, 본문 변경은 허용하지 않는다.
    names=("p5_catalog","p5_course_create","p8_rel_snapshot","p8_rel_eval")
    old="workhub_private.p2_member_reachable"
    new="workhub_private.p9_teacher_assignable"
    select_defs="select proname,pg_get_functiondef(oid) from pg_proc where pronamespace='workhub_private'::regnamespace and proname=any(%s) order by proname"
    originals=dict(q(select_defs,(list(names),)))
    check("줄바꿈 회귀의 확정 LF 원본 4개",len(originals)==4 and all("\r" not in body for body in originals.values()))
    crlf={name:body.replace("\n","\r\n") for name,body in originals.items()}
    install=(P9/"P9-02_담당교사후보_분리.sql").read_text(encoding="utf-8").rstrip()
    if not install.endswith("COMMIT;"):
        raise AssertionError("P9-02의 마지막 COMMIT을 확인해 주세요.")
    # 실제 설치문의 마지막 COMMIT만 미룬다. 확인 후 전체를 롤백해 기존 LF 경로도 따로 시험한다.
    cx=connect()
    try:
        with cx.cursor() as cur:
            cur.execute("BEGIN")
            for name in names:cur.execute(crlf[name])
            cur.execute("select proname,prosrc from pg_proc where pronamespace='workhub_private'::regnamespace and proname=any(%s)",(list(names),))
            before=dict(cur.fetchall())
            check("실제 함수 본문에 CRLF 4개 준비",len(before)==4 and all("\r\n" in body for body in before.values()))
            cur.execute(install[:-len("COMMIT;")])
            cur.execute("select proname,prosrc from pg_proc where pronamespace='workhub_private'::regnamespace and proname=any(%s)",(list(names),))
            after=dict(cur.fetchall())
            check("CRLF 원본도 담당 후보 4개 교체",all(after[name].count(new)==1 and old not in after[name] for name in names))
            check("교체 후 CRLF 원문은 호출 한 곳 외 그대로",all(after[name]==before[name].replace(old,new) for name in names))
            cur.execute("select count(*) from workhub_private.p9_installs where batch='P9-02'")
            check("CRLF 교체와 설치 기록 원자적 추가",cur.fetchone()[0]==1)
    finally:
        with cx.cursor() as cur:cur.execute("ROLLBACK")
        cx.close()
    check("CRLF 성공 시험 롤백 뒤 LF 원본 복구",dict(q(select_defs,(list(names),)))==originals)
    check("CRLF 성공 시험 롤백 뒤 설치 기록 없음",count("select count(*) from workhub_private.p9_installs where batch='P9-02'")==0)
    # 마지막 함수에서 거부되어야 앞선 세 함수의 교체도 롤백되는지 검증할 수 있다.
    mutations=(
        ("본문 변조",lambda body:body.replace("DECLARE","DECLARE\r\n-- 줄바꿈 외 본문 변조\r\n",1)),
        ("호출 개수 변조",lambda body:body.replace("DECLARE","DECLARE\r\n-- "+old+"\r\n",1)),
        ("단독 CR",lambda body:body.replace("\r\nDECLARE","\rDECLARE",1)),
    )
    for label,mutate in mutations:
        changed=mutate(crlf["p8_rel_eval"])
        if changed==crlf["p8_rel_eval"]:raise AssertionError("변조 회귀가 실제 원문을 바꾸지 않았습니다: "+label)
        try:
            for name in names:q(changed if name=="p8_rel_eval" else crlf[name])
            fixture=dict(q(select_defs,(list(names),)))
            try:file(P9/"P9-02_담당교사후보_분리.sql")
            except psycopg2.Error as ex:
                check("CRLF + "+label+"는 마지막 함수에서 차단","원본과 다릅니다: p8_rel_eval" in str(ex))
            else:check("CRLF + "+label+"는 마지막 함수에서 차단",False)
            check("CRLF + "+label+" 뒤 앞선 교체도 롤백",dict(q(select_defs,(list(names),)))==fixture)
            check("CRLF + "+label+" 뒤 설치 기록 없음",count("select count(*) from workhub_private.p9_installs where batch='P9-02'")==0)
        finally:
            for name in names:q(originals[name])
    check("줄바꿈 회귀 종료 뒤 원본 4개 복구",dict(q(select_defs,(list(names),)))==originals)
def tests():
    global CAPTURES
    school,member=q("select m.school_id,m.id from workhub.memberships m join workhub.accounts a on a.id=m.account_id where a.auth_user_id=%s",(ADMIN,))[0]
    before=q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]
    auth_before=count("select count(*) from auth.users")
    gate_before=q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]
    file(P9/"P9-01_교사연결_모델과함수.sql")
    check("신규 4표 RLS",count("select count(*) from pg_class where relnamespace='workhub'::regnamespace and relname like 'school_roster_%' and relkind='r' and relrowsecurity")==4)
    check("표 authenticated 권한 0",count("select count(*) from information_schema.role_table_grants where grantee='authenticated' and table_schema='workhub' and table_name like 'school_roster_%'")==0)
    get=rpc("workhub_school_roster_get",(member,));check("기본 비활성 및 후보 비노출",get["data"]["reason"]=="not_configured" and get["data"]["candidates"]==[])
    CAPTURES.append({"kind":"get","raw":get,"schoolId":school,"memberId":member})
    q("insert into workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) values(%s,%s,'시험 승인','active')",(school,member))
    q("insert into workhub.school_roster_policies(school_id,active,allowed_user_ids,approved_by_membership_id,approval_ref) values(%s,true,%s::uuid[],%s,'시험 승인')",(school,[ADMIN,TEACHER,PENDING],member))
    today=q("select workhub_private.today_in('Asia/Seoul')::text")[0][0]
    start=today[:4]+"-03-01"
    if today[5:]<"03-01":start=str(int(today[:4])-1)+"-03-01"
    def intent(ids,rev=None):
        return {"expectedVersion":rev or count("select revision from workhub.school_roster_policies"),"targetUserIds":sorted(ids),"startsOn":start,"lastDay":None,"reason":"기존 가입 교사 소속 연결 확인"}
    def preview(i):return rpc("workhub_school_roster_preview",(member,json.dumps(i,ensure_ascii=False)))
    def command(p):return {k:p[k] for k in ("previewId","fingerprint","intent")}
    def commit(c,key):return rpc("workhub_school_roster_commit",(member,json.dumps(c,ensure_ascii=False),key))
    def close(c,key):return rpc("workhub_school_roster_close",(member,json.dumps(c,ensure_ascii=False),key))
    for bad in (None,[],{},{"targetUserIds":{}},{**intent([TEACHER]),"targetUserIds":None},{**intent([TEACHER]),"reason":"\u0085"}):
        check("깨진 입력은 확정 입력 오류",preview(bad).get("error",{}).get("code")=="INVALID_INPUT")
    get=rpc("workhub_school_roster_get",(member,));data=get["data"]
    check("허용 UID 3명만 후보",sorted(x["legacyUserId"] for x in data["candidates"])==sorted([ADMIN,TEACHER,PENDING]))
    check("비활성 교사 차단",next(x for x in data["candidates"] if x["legacyUserId"]==PENDING)["state"]=="blocked")
    check("허용 목록 밖 UID 차단",preview(intent([OTHER]))["error"]["code"]=="NOT_FOUND")
    check("대기 회원은 원자적 차단 미리보기",preview(intent([TEACHER,PENDING]))["data"]["allowed"]==False)
    mixed=preview(intent([TEACHER,PENDING]))["data"]
    check("차단 미리보기 반영 거절",commit(command(mixed),"blocked-request")["error"]["code"]=="CONFLICT")
    check("부분 연결 없음",count("select count(*) from workhub.accounts")==1)
    i=intent([TEACHER]);p=preview(i)["data"];check("활성 교사 미리보기 허용",p["allowed"] and p["items"][0]["outcome"]=="link")
    CAPTURES.append({"kind":"preview","raw":{"contract":"school-roster.v1","schoolId":school,"memberId":member,"data":p},"intent":i,"schoolId":school,"memberId":member})
    expired=q("insert into workhub.school_roster_previews(school_id,membership_id,intent,fingerprint,items,allowed,expires_at) select school_id,membership_id,intent,fingerprint,items,allowed,now()-interval '1 second' from workhub.school_roster_previews where id=%s returning id",(p["previewId"],))[0][0]
    expired_command={**command(p),"previewId":expired}
    check("만료된 미리보기 신규 확정 차단",commit(expired_command,"expired-request")["error"]["code"]=="CONFLICT")
    q("update workhub.school_roster_policies set active=false")
    q("update workhub.school_admin_activations set state='stopped'")
    closed=close(expired_command,"expired-request")
    check("미리보기 만료·정책·모듈 중지 뒤 명시 닫기",closed["data"]=={"requestKey":"expired-request","outcome":"closed","receipt":None})
    check("닫기 응답 유실 후 같은 번호 동일 결과",close(expired_command,"expired-request")==closed)
    check("닫기 뒤 늦은 원요청 반영 금지",commit(expired_command,"expired-request")["error"]["code"]=="CONFLICT")
    check("닫기만으로 계정·소속 연결 없음",count("select count(*) from workhub.accounts")==1 and count("select count(*) from workhub.school_roster_links")==0)
    changed_closed=json.loads(json.dumps(expired_command));changed_closed["intent"]["reason"]="다른 명령"
    check("닫힌 번호 다른 명령 거부",close(changed_closed,"expired-request")["error"]["code"]=="IDEMPOTENCY_CONFLICT" and commit(changed_closed,"expired-request")["error"]["code"]=="IDEMPOTENCY_CONFLICT")
    CAPTURES.append({"kind":"close","raw":closed,"command":expired_command,"key":"expired-request","schoolId":school,"memberId":member})
    q("update workhub.school_roster_policies set active=true")
    q("update workhub.school_admin_activations set state='active'")
    check("모듈 재개 뒤에도 취소 장벽 유지",commit(expired_command,"expired-request")["error"]["code"]=="CONFLICT")
    for patch in ({"startsOn":"2099-01-01"},{"lastDay":"2020-01-01"}):
        check("현재 유효하지 않은 소속 기간 차단",preview({**i,**patch}).get("error",{}).get("code")=="INVALID_INPUT")
    q("update public.users set is_active=false where id=%s",(TEACHER,))
    check("미리보기 뒤 승인 회수 감지",commit(command(p),"stale-request")["error"]["code"]=="CONFLICT")
    q("update public.users set is_active=true where id=%s",(TEACHER,))
    p=preview(i)["data"];c=command(p);r=commit(c,"same-request")
    check("기존 회원과 정확한 UID 연결",r.get("data",{}).get("items",[{}])[0].get("legacyUserId")==TEACHER)
    receipt=r["data"];mid=receipt["items"][0]["memberId"]
    CAPTURES.append({"kind":"receipt","raw":r,"command":c,"key":"same-request","schoolId":school,"memberId":member})
    check("로그인 계정 생성 없음",count("select count(*) from auth.users")==auth_before)
    check("회원 자료 보존",q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]==before)
    check("교사 역할 자동부여 없음",q("select count(*) from workhub.membership_roles where membership_id=%s",(mid,))[0][0]==0)
    check("같은 번호 원래 접수증",commit(c,"same-request")==r)
    applied=close(c,"same-request")
    check("적용된 요청 닫기는 원래 접수증 반환",applied["data"]=={"requestKey":"same-request","outcome":"applied","receipt":receipt})
    check("적용된 요청 닫기 멱등",close(c,"same-request")==applied)
    CAPTURES.append({"kind":"close","raw":applied,"command":c,"key":"same-request","schoolId":school,"memberId":member})
    check("같은 미리보기 다른 번호 닫기로 결과 오인 금지",close(c,"other-request")["error"]["code"]=="CONFLICT")
    check("새 번호로 같은 미리보기 재사용 거절",commit(c,"other-request")["error"]["code"]=="CONFLICT")
    changed=json.loads(json.dumps(c));changed["intent"]["reason"]="내용 변경"
    check("같은 번호 다른 원문 거절",commit(changed,"same-request")["error"]["code"]=="IDEMPOTENCY_CONFLICT")
    q("update workhub.school_roster_policies set active=false")
    check("중지 뒤 기존 결과 복구",commit(c,"same-request")==r)
    check("중지 뒤 닫기에도 적용 결과 반환",close(c,"same-request")==applied)
    check("중지 뒤 새 작업 거절",preview(intent([ADMIN]))["error"]["code"]=="NOT_READY")
    q("update workhub.school_roster_policies set active=true")
    p=preview(intent([TEACHER]))["data"]
    check("기존 연결 건너뛰기",p["items"][0]["outcome"]=="already_linked")
    rr=commit(command(p),"skip-request")
    check("중복 소속 만들지 않음",rr["data"]["items"][0]["memberId"]==mid and q("select count(*) from workhub.memberships where account_id=(select id from workhub.accounts where auth_user_id=%s)",(TEACHER,))[0][0]==1)
    check("수업 후보가 일반 교사를 포함",any(x["id"]==mid for x in rpc("workhub_school_roster_get",(member,))["data"]["teachers"]))
    check("메시지 수신 자격은 그대로",q("select workhub_private.p2_member_reachable(%s,%s)",(school,mid))[0][0]==False)
    try:rpc("workhub_school_roster_get",(mid,),uid=TEACHER)
    except psycopg2.Error as ex:check("일반 교사 업무실 접근 유지",str(ex).startswith("FORBIDDEN"))
    else:check("일반 교사 업무실 접근 유지",False)
    try:rpc("workhub_school_roster_get",(member,),uid=TEACHER)
    except psycopg2.Error:check("다른 회원 ID 위조 거절",True)
    else:check("다른 회원 ID 위조 거절",False)
    check("legacy_gate 본문 보존",q("select md5(pg_get_functiondef('workhub_private.legacy_gate(boolean)'::regprocedure))")[0][0]==gate_before)
    # 공개 API 두 연결이 경합해도 적용과 닫기 중 정확히 하나만 원장에 남는다.
    for attempt in range(6):
        race_command=command(preview(intent([TEACHER]))["data"]);race_key=f"race-close-{attempt}"
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            apply_future=pool.submit(commit,race_command,race_key)
            close_future=pool.submit(close,race_command,race_key)
            apply_result,close_result=apply_future.result(),close_future.result()
        final_close=close_result["data"]
        expected_applied=final_close["outcome"]=="applied"
        check(f"반영·닫기 동시 경합 {attempt+1} 단일 결과",
            (apply_result.get("data")==final_close["receipt"] if expected_applied else apply_result.get("error",{}).get("code")=="CONFLICT")
            and close(race_command,race_key)==close_result
            and q("select count(*) from workhub.school_roster_requests where school_id=%s and membership_id=%s and request_key=%s",(school,member,race_key))[0][0]==1
            and q("select count(*) from workhub.school_roster_links where school_id=%s and actor_membership_id=%s and request_key=%s",(school,member,race_key))[0][0]==int(expected_applied))
    # 마지막 전송을 두 연결에서 동시에 실행해 한 계정/소속/접수증만 남는지 확인한다.
    q("update workhub.school_roster_policies set allowed_user_ids=array_append(allowed_user_ids,%s::uuid),revision=revision+1",(OTHER,))
    p=preview(intent([OTHER]))["data"];c=command(p)
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:commit(c,"parallel-key"),range(2)))
    check("동시 같은 요청 접수증 일치",results[0]==results[1] and "data" in results[0])
    check("동시 연결 계정 1개",q("select count(*) from workhub.accounts where auth_user_id=%s",(OTHER,))[0][0]==1)
    check("P1 판도 전진",count("select revision from workhub.school_admin_activations")>1)
    # 학교를 두 개 만든 관리자라도 허용된 현재 학교 후보와 접수증만 본다.
    q("insert into workhub.schools(id,code,name,school_level,grade_count,status) values('other-school','other-school','다른 학교','middle',3,'active')")
    q("insert into workhub.memberships(id,school_id,account_id,status,valid_from,decided_at) select 'other-admin','other-school',account_id,'active',valid_from,now() from workhub.memberships where id=%s",(member,))
    q("insert into workhub.membership_roles(school_id,membership_id,role_code,valid_from) values('other-school','other-admin','school_admin',%s)",(start,))
    q("insert into workhub.school_admin_activations(school_id,approved_by_membership_id,approval_ref,state) values('other-school','other-admin','시험','active')")
    q("insert into workhub.school_roster_policies(school_id,active,allowed_user_ids,approved_by_membership_id,approval_ref) values('other-school',true,%s::uuid[],'other-admin','시험')",([OTHER],))
    foreign=rpc("workhub_school_roster_get",("other-admin",))["data"]
    check("다른 학교 허용 목록을 섞지 않음",[x["legacyUserId"] for x in foreign["candidates"]]==[OTHER])
    check("다른 학교 소속 ID를 후보로 노출하지 않음",foreign["candidates"][0]["memberId"] is None and foreign["teachers"][0]["id"]=="other-admin")
    wrong=rpc("workhub_school_roster_commit",("other-admin",json.dumps(c),"parallel-key"))
    check("다른 학교에서 동일 요청 번호 접수증 비노출",wrong.get("error",{}).get("code")=="NOT_FOUND")
    check("다른 학교 닫기에 접수증·취소 장벽 비노출",rpc("workhub_school_roster_close",("other-admin",json.dumps(c),"parallel-key")).get("error",{}).get("code")=="NOT_FOUND")
    try:rpc("workhub_school_roster_close",(member,json.dumps(c),"parallel-key"),uid=TEACHER)
    except psycopg2.Error:check("다른 회원 소속 번호로 닫기 거부",True)
    else:check("다른 회원 소속 번호로 닫기 거부",False)
    q("update workhub.school_admin_activations set state='stopped' where school_id=%s",(school,))
    q("update workhub.membership_roles set revoked_at=now(),revoke_reason='닫기 권한 회수 시험' where membership_id=%s",(member,))
    check("모듈 중지 뒤에도 현재 관리 권한 회수는 닫기 거부",close(c,"parallel-key").get("error",{}).get("code")=="FORBIDDEN")
    q("insert into workhub.membership_roles(school_id,membership_id,role_code,valid_from) values(%s,%s,'school_admin',%s)",(school,member,start))
    q("update workhub.school_admin_activations set state='active' where school_id=%s",(school,))
    q("update workhub.membership_roles set revoked_at=now(),revoke_reason='시험' where membership_id='other-admin'")
    check("관리 권한 없는 소속은 목록 비노출",rpc("workhub_school_roster_get",("other-admin",))["data"]["reason"]=="forbidden")
    # 기존 담당 후보 4곳만 바꾸고 메뉴 접근/메시지 대상은 유지한다.
    candidate_newline_tests()
    original=q("select pg_get_functiondef(oid) from pg_proc where pronamespace='workhub_private'::regnamespace and proname='p8_rel_eval'")[0][0]
    q(original.replace("DECLARE","DECLARE\n-- 합성 훼손 시험\n",1))
    try:file(P9/"P9-02_담당교사후보_분리.sql")
    except psycopg2.Error as ex:check("확정 P8 원본 지문이 다르면 보강 중단","원본과 다릅니다" in str(ex))
    else:check("확정 P8 원본 지문이 다르면 보강 중단",False)
    check("중간 함수 교체까지 전부 롤백",count("select count(*) from pg_proc where pronamespace='workhub_private'::regnamespace and proname in('p5_catalog','p5_course_create','p8_rel_snapshot') and pg_get_functiondef(oid) like '%workhub_private.p9_teacher_assignable%'")==0)
    q(original)
    file(P9/"P9-02_담당교사후보_분리.sql")
    check("담당 후보 함수 네 곳만 분리",count("select count(*) from pg_proc where pronamespace='workhub_private'::regnamespace and proname in('p5_catalog','p5_course_create','p8_rel_snapshot','p8_rel_eval') and pg_get_functiondef(oid) like '%workhub_private.p9_teacher_assignable%'")==4)
    with connect() as cx:
        with cx.cursor() as cur:
            cur.execute("select set_config('request.jwt.claim.sub',%s,false)",(ADMIN,))
            cur.execute("select workhub_private.p5_catalog(workhub_private.member_actor(%s,false))",(member,))
            catalog=cur.fetchone()[0]
    check("기존 수업 카탈로그에 연결 교사 표시",any(t["id"]==mid for t in catalog["approvedTeachers"]))
    check("연결 허용 뒤에도 메시지 자격 유지",q("select workhub_private.p2_member_reachable(%s,%s)",(school,mid))[0][0]==False)
    check("P9 사후 점검 FAIL 0",all(row[2]=="ok" for row in file(P9/"P9-04_사후점검.sql")))
    try:file(P9/"P9-03_교사연결_승인양식.sql","supabase_admin")
    except psycopg2.Error as ex:check("승인 양식 빈칸은 실행 차단","직접 채우세요" in str(ex))
    else:check("승인 양식 빈칸은 실행 차단",False)
    check("최종 회원 원본 보존",q("select md5(string_agg(row_to_json(u)::text,'' order by id)) from public.users u")[0][0]==before)
    CAPTURES.append({"kind":"get","raw":rpc("workhub_school_roster_get",(member,)),"schoolId":school,"memberId":member})
    functions=q("select proname,md5(pg_get_functiondef(oid)) from pg_proc where pronamespace='workhub_private'::regnamespace and proname in('p5_catalog','p5_course_create','p8_rel_snapshot','p8_rel_eval') order by proname")
    print("담당 후보 보강 후 함수 지문",json.dumps(functions,ensure_ascii=False),flush=True)
    target=Path(os.environ.get("P9_CAPTURE",str(WORK/"captures.json")))
    target.parent.mkdir(parents=True,exist_ok=True);target.write_text(json.dumps(CAPTURES,ensure_ascii=False,indent=2),encoding="utf-8")
    print("CAPTURES",target,flush=True)
    import gen_p9_05
    manifest,results=gen_p9_05.generate()
    check("R0부터 T2/P9 전체 통합 점검 13행 FAIL 0",len(results)==13 and all(row[2]!="FAIL" for row in results))
    q("alter table workhub.school_roster_links disable trigger roster_link_immutable",db="p9_manifest")
    check("통합 점검이 원장 보호 트리거 훼손 탐지",any(row[2]=="FAIL" for row in q(manifest,db="p9_manifest")))
    q("alter table workhub.school_roster_links enable trigger roster_link_immutable",db="p9_manifest")
    check("통합 점검 보호 복구 확인",all(row[2]!="FAIL" for row in q(manifest,db="p9_manifest")))
def main():
    exe=".exe" if os.name=="nt" else ""
    version=subprocess.check_output([str(PG/("postgres"+exe)),"--version"],text=True)
    if " 17." not in version:raise RuntimeError("PostgreSQL 17만 지원합니다.")
    log=(WORK/"run.log").open("w",encoding="utf-8")
    started=False
    try:
        run(PG/("initdb"+exe),"-D",DATA,"-U","supabase_admin","--encoding=UTF8","--no-locale","-A","trust",stdout=log,stderr=log)
        run(PG/("pg_ctl"+exe),"-D",DATA,"-l",WORK/"server.log","-o",f"-h 127.0.0.1 -p {PORT}","-w","start",stdout=log,stderr=log);started=True
        check("시험 서버 경로 확인",Path(q("show data_directory",user="supabase_admin",db="postgres")[0][0]).resolve()==DATA)
        setup();tests()
        print(f"합계 PASS {PASS} · FAIL 0",flush=True)
    finally:
        if started:run(PG/("pg_ctl"+exe),"-D",DATA,"-m","fast","-w","stop",stdout=log,stderr=log)
        log.close()
        print("격리 시험 파일",WORK,flush=True)
if __name__=="__main__":main()
