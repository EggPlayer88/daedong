"""나이스 API·서버는 합성 HTTP/DB로 검증한다. 실제 키·운영 DB를 사용하지 않는다."""
import sys,json,unittest
from pathlib import Path
from datetime import date
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"apps/main/api/neis"))
from _provider import Provider,NeisError,query,normalize,LIMITS
from _service import execute,cron,CheckError
school={"officeCode":"K10","schoolCode":"7892043"}
def schedule(**patch):
    return {"ATPT_OFCDC_SC_CODE":"K10","SD_SCHUL_CODE":"7892043","AY":"2026","LOAD_DTM":"20261108","AA_YMD":"20261120","EVENT_NM":"행사","EVENT_CNTNT":"안내<br/>다음 줄","SBTR_DD_SC_NM":"해당없음","DGHT_CRSE_SC_NM":"주간","SCHUL_CRSE_SC_NM":"중학교",**{k:"Y" if i<3 else "*" for i,k in enumerate(["ONE_GRADE_EVENT_YN","TW_GRADE_EVENT_YN","THREE_GRADE_EVENT_YN","FR_GRADE_EVENT_YN","FIV_GRADE_EVENT_YN","SIX_GRADE_EVENT_YN"])},**patch}
def page(rows,total=None):
    return {"SchoolSchedule":[{"head":[{"list_total_count":total if total is not None else len(rows)},{"RESULT":{"CODE":"INFO-000"}}]},{"row":rows}]}
class Response:
    status=200
    def __init__(self,data,headers=None):
        self.data=json.dumps(data,ensure_ascii=True).encode();self.headers=headers or {}
    def read(self,size):return self.data[:size]
    def getheader(self,key,default=None):return self.headers.get(key,default)
class Connection:
    def __init__(self,response):self.response=response
    def request(self,*args,**kw):
        assert kw['headers']['Accept']=='*/*'  # 실제 나이스는 application/json Accept를 HTTP 500으로 거절함
        assert kw['headers']['Accept-Encoding']=='identity'
    def getresponse(self):return self.response
    def close(self):pass
def provider(*responses):
    queue=list(responses)
    return Provider("test-key-only-123456789",lambda host,port,timeout:Connection(queue.pop(0)))
class NeisTests(unittest.TestCase):
    def read(self,p):return p.read("schedule",school,"2026-03-01","2027-02-28",2026)
    def test_normalization(self):
        r=self.read(provider(Response(page([schedule()]))))[0]
        self.assertEqual(r["content"],"안내\n다음 줄");self.assertEqual(r["grades"],[1,2,3])
        newer=normalize("schedule",schedule(LOAD_DTM="20261109"),school,"2026-03-01","2027-02-28",2026)
        self.assertEqual(r["identity"],newer["identity"]);self.assertEqual(r["contentHash"],newer["contentHash"])
    def test_scope_and_ranges(self):
        for bad in [schedule(SD_SCHUL_CODE="9999999"),schedule(AY="2025"),schedule(AA_YMD="20260230"),schedule(ONE_GRADE_EVENT_YN="?")]:
            with self.assertRaises(NeisError):self.read(provider(Response(page([bad]))))
        for args in [("timetable","2026-03-01","2026-03-15"),("meals","2026-01-01","2026-03-31"),("schedule","2026-03-02","2027-02-28")]:
            with self.assertRaises(NeisError):query(args[0],school,args[1],args[2],2026)
    def test_empty_vs_error(self):
        self.assertEqual(self.read(provider(Response({"RESULT":{"CODE":"INFO-200"}}))),[])
        with self.assertRaisesRegex(NeisError,"PROVIDER_REJECTED"):self.read(provider(Response({"RESULT":{"CODE":"ERROR-300","MESSAGE":"secret text"}})))
    def test_truncated_duplicate_changed(self):
        for response in [Response(page([schedule()],2)),Response(page([schedule(),schedule(EVENT_CNTNT='충돌')])),Response(page([schedule()]),{"Content-Length":"999999"})]:
            with self.assertRaises(NeisError):self.read(provider(response))
        old=LIMITS["pageSize"];LIMITS["pageSize"]=1
        try:
            with self.assertRaisesRegex(NeisError,"UPSTREAM_CHANGED"):self.read(provider(Response(page([schedule()],2)),Response(page([schedule(EVENT_NM="둘째")],3))))
            with self.assertRaisesRegex(NeisError,"PROVIDER_REJECTED"):self.read(provider(Response(page([schedule()],2)),Response({"RESULT":{"CODE":"INFO-200"}})))
            self.assertEqual(len(self.read(provider(Response(page([schedule()],2)),Response(page([schedule(EVENT_NM="둘째")],2))))),2)
        finally:LIMITS["pageSize"]=old
    def test_identical_duplicate(self):
        self.assertEqual(len(self.read(provider(Response(page([schedule(),schedule()]))))),1)
    def test_input_text(self):
        for value in ["bad\x00value","bad\ud800value",["list"]]:
            with self.assertRaises(NeisError):self.read(provider(Response(page([schedule(EVENT_NM=value)]))))
    def test_budget_deadline_key_and_host(self):
        with self.assertRaisesRegex(NeisError,"KEY_MISSING"):Provider("")
        calls=[]
        p=Provider("test-key-only-123456789",lambda *a,**kw:(calls.append(a) or Connection(Response(page([schedule()])))))
        self.read(p);self.assertEqual(calls,[("open.neis.go.kr",443)])
        p.deadline=0
        with self.assertRaisesRegex(NeisError,"UPSTREAM_UNAVAILABLE"):self.read(p)
class Client:
    def __init__(self,manage=True):
        self.calls=[];self.manage=manage;self.after_school="s";self.public_count=0
    def public_rpc(self,name,args,authorization):
        self.public_count+=1
        return {"contract":"neis.v1","memberId":"m","schoolId":"s" if self.public_count==1 else self.after_school,"configured":True,"canManage":self.manage,"source":school}
    def server_rpc(self,name,args):
        self.calls.append((name,args))
        if name.endswith("targets"):return [{"schoolId":"s",**school}]
        if name.endswith("claim"):return {"leaseId":"00000000-0000-4000-8000-000000000001","source":school}
        return {"status":"kept" if args.get("p_error") else "updated"}
class Fixed:
    def __init__(self,error=None):self.error=error;self.calls=[]
    def read(self,*args):
        self.calls.append(args)
        if self.error:raise NeisError(self.error)
        return []
class ServerTests(unittest.TestCase):
    payload={"memberId":"m","kind":"schedule","year":2026,"from":"2026-03-01","to":"2027-02-28"}
    token="Bearer "+"a"*30+"."+"b"*30+"."+"c"*30
    def test_no_refresh_without_scope(self):
        c=Client(False);p=Fixed()
        with self.assertRaises(CheckError):execute(self.payload,self.token,c,p)
        self.assertEqual(p.calls,[]);self.assertEqual(c.calls,[])
    def test_failure_retains_and_auth_rechecked(self):
        c=Client();p=Fixed("UPSTREAM_UNAVAILABLE")
        result=execute(self.payload,self.token,c,p)
        self.assertEqual(result["refresh"]["status"],"kept");self.assertEqual(c.calls[-1][1]["p_items"],None);self.assertEqual(c.public_count,2)
        c=Client();c.after_school="other"
        with self.assertRaises(CheckError):execute(self.payload,self.token,c,Fixed())
    def test_cron_authorization(self):
        c=Client();p=Fixed();env={"CRON_SECRET":"s"*32}
        for authorization in [None,"Bearer bad","Bearer "+"x"*32]:
            with self.assertRaises(CheckError):cron(authorization,c,p,env)
        self.assertEqual(c.calls,[])
        result=cron("Bearer "+"s"*32,c,p,env,date(2026,11,8))
        self.assertEqual(result["status"],"completed");self.assertEqual(len(p.calls),4)
        self.assertEqual(p.calls[0][2:4],("2026-11-01","2026-12-31"))
    def test_extra_parameters_rejected(self):
        with self.assertRaises(NeisError):execute({**self.payload,"schoolId":"other"},self.token,Client(),Fixed())
class Result(unittest.TextTestResult):
    def addSuccess(self,test):
        super().addSuccess(test)
        print("  ✓ "+test.id().rsplit(".",1)[-1])
if __name__=="__main__":unittest.main(testRunner=unittest.TextTestRunner(resultclass=Result))
