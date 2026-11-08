"""승인된 학교 소속과 공개 범위를 재사용하는 나이스 서버 연결."""
import hmac
import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
sys.path.insert(0,str(Path(__file__).resolve().parent.parent/"collections"))
from _hwpx_basic import SupabaseClient, CheckError, parse_json, _token
from _provider import Provider, NeisError, query


class Client(SupabaseClient):
    def public_rpc(self,name,args,authorization):
        if name!="workhub_neis_status":
            raise CheckError("INVALID_INPUT",400)
        return parse_json(self._request("POST","/rest/v1/rpc/"+name,args,authorization=authorization,maximum=4000000))

    def server_rpc(self,name,args):
        if name not in ("workhub_neis_refresh_targets","workhub_neis_claim","workhub_neis_finish"):
            raise CheckError("INVALID_INPUT",400)
        return parse_json(self._request("POST","/rest/v1/rpc/"+name,args,maximum=4000000))


def refresh(client,provider,school_id,kind,year,start,end):
    args={"p_school_id":school_id,"p_kind":kind,"p_year":year,"p_from":start,"p_to":end}
    claim=client.server_rpc("workhub_neis_claim",args)
    if not claim.get("leaseId"):
        return {"status":claim.get("reason","recent")}
    try:
        items=provider.read(kind,claim["source"],start,end,year)
    except NeisError as error:
        client.server_rpc("workhub_neis_finish",{**args,"p_lease_id":claim["leaseId"],"p_items":None,"p_error":error.code})
        return {"status":"kept","errorCode":error.code}
    return client.server_rpc("workhub_neis_finish",{**args,"p_lease_id":claim["leaseId"],"p_items":items,"p_error":None})


def execute(payload,authorization,client=None,provider=None,environ=None):
    env=os.environ if environ is None else environ
    if not isinstance(payload,dict) or set(payload)!={"memberId","kind","year","from","to"}:
        raise NeisError("INVALID_INPUT")
    if not isinstance(payload["memberId"],str) or not 1<=len(payload["memberId"])<=100:
        raise NeisError("INVALID_INPUT")
    authorization=_token(authorization)
    client=client or Client()
    args={"p_member_id":payload["memberId"],"p_kind":payload["kind"],"p_year":payload["year"],"p_from":payload["from"],"p_to":payload["to"]}
    before=client.public_rpc("workhub_neis_status",args,authorization)
    if before.get("contract")!="neis.v1" or before.get("memberId")!=payload["memberId"] or not before.get("configured"):
        raise NeisError("NOT_READY")
    if payload["kind"]!="meals" and before.get("canManage") is not True:
        raise CheckError("FORBIDDEN",403)
    query(payload["kind"],before["source"],payload["from"],payload["to"],payload["year"])
    provider=provider or Provider(env.get("NEIS_API_KEY"))
    refreshed=refresh(client,provider,before["schoolId"],payload["kind"],payload["year"],payload["from"],payload["to"])
    # 외부 조회가 끝난 뒤에도 같은 로그인·현재 소속이어야 결과를 보여 준다.
    after=client.public_rpc("workhub_neis_status",args,authorization)
    if before["schoolId"]!=after.get("schoolId") or before["memberId"]!=after.get("memberId"):
        raise CheckError("FORBIDDEN",403)
    return {"data":after,"refresh":refreshed}


def cron(authorization,client=None,provider=None,environ=None,today=None):
    env=os.environ if environ is None else environ
    secret=env.get("CRON_SECRET","")
    if len(secret)<32 or not isinstance(authorization,str) or not hmac.compare_digest(authorization,"Bearer "+secret):
        raise CheckError("FORBIDDEN",403)
    client=client or Client()
    provider=provider or Provider(env.get("NEIS_API_KEY"))
    today=today or datetime.now(ZoneInfo("Asia/Seoul")).date()
    year=today.year if today.month>=3 else today.year-1
    year_start,year_end=date(year,3,1),date(year+1,3,1)-timedelta(days=1)
    month_start=today.replace(day=1)
    next_month=(month_start+timedelta(days=32)).replace(day=1)
    end_month=(next_month+timedelta(days=32)).replace(day=1)-timedelta(days=1)
    week=today-timedelta(days=today.weekday())
    targets=client.server_rpc("workhub_neis_refresh_targets",{})
    if not isinstance(targets,list) or len(targets)>1:
        raise NeisError("INVALID_RESPONSE")
    results=[]
    for school in targets:
        for kind,a,b in (("meals",month_start,end_month),("schedule",year_start,year_end),("classes",year_start,year_end),("timetable",week,week+timedelta(days=13))):
            try:
                result=refresh(client,provider,school["schoolId"],kind,year,a.isoformat(),b.isoformat())
                results.append({"kind":kind,**result})
            except (CheckError,NeisError):
                results.append({"kind":kind,"status":"failed"})
    return {"status":"completed" if all(r["status"] not in ("failed","kept") for r in results) else "partial","results":results}
