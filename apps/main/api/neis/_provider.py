"""나이스 공개 자료 조회. 완전한 응답만 저장하며 비밀 키와 외부 오류 원문은 노출하지 않는다."""
import hashlib
import html
import http.client
import json
import re
import time
from datetime import date, timedelta
from pathlib import Path
from urllib.parse import urlencode
LIMITS = json.loads((Path(__file__).parent / "_assets/limits.json").read_text(encoding="utf-8"))
APIS = {"meals":"mealServiceDietInfo","schedule":"SchoolSchedule","timetable":"misTimetable","classes":"classInfo"}


class NeisError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def day(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}",value):
        raise NeisError("INVALID_INPUT")
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise NeisError("INVALID_INPUT") from None


def compact(value):
    if not isinstance(value,str) or not re.fullmatch(r"\d{8}",value):
        raise NeisError("INVALID_RESPONSE")
    try:
        return date(int(value[:4]),int(value[4:6]),int(value[6:])).isoformat()
    except ValueError:
        raise NeisError("INVALID_RESPONSE") from None


def text(value, maximum=4000, required=False):
    if value is None:
        value = ""
    if not isinstance(value,str) or len(value)>maximum:
        raise NeisError("INVALID_RESPONSE")
    value = html.unescape(re.sub(r"<br\s*/?>","\n",value,flags=re.I)).strip()
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ud800-\udfff]",value) or required and not value:
        raise NeisError("INVALID_RESPONSE")
    return value


def hash_value(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":")).encode()).hexdigest()


def query(kind,school,start,end,year):
    if kind not in APIS or not re.fullmatch(r"[A-Z]\d{2}",school["officeCode"]) or not re.fullmatch(r"\d{7}",school["schoolCode"]):
        raise NeisError("INVALID_INPUT")
    a,b = day(start),day(end)
    if type(year) is not int or not 2020<=year<=2100 or a>b:
        raise NeisError("INVALID_INPUT")
    if kind=="meals" and (b-a).days>=LIMITS["mealDays"] or kind=="timetable" and (b-a).days>=LIMITS["timetableDays"]:
        raise NeisError("INVALID_INPUT")
    if kind in ("schedule","classes") and (a!=date(year,3,1) or b!=date(year+1,3,1)-timedelta(days=1)):
        raise NeisError("INVALID_INPUT")
    args={"ATPT_OFCDC_SC_CODE":school["officeCode"],"SD_SCHUL_CODE":school["schoolCode"]}
    if kind=="meals":
        args.update(MLSV_FROM_YMD=a.strftime("%Y%m%d"),MLSV_TO_YMD=b.strftime("%Y%m%d"))
    else:
        args["AY"]=str(year)
        if kind=="schedule":
            args.update(AA_FROM_YMD=a.strftime("%Y%m%d"),AA_TO_YMD=b.strftime("%Y%m%d"))
        elif kind=="timetable":
            args.update(TI_FROM_YMD=a.strftime("%Y%m%d"),TI_TO_YMD=b.strftime("%Y%m%d"))
    return args


def normalize(kind,row,school,start,end,year):
    if not isinstance(row,dict) or row.get("ATPT_OFCDC_SC_CODE")!=school["officeCode"] or row.get("SD_SCHUL_CODE")!=school["schoolCode"]:
        raise NeisError("INVALID_RESPONSE")
    if kind!="meals" and str(row.get("AY"))!=str(year):
        raise NeisError("INVALID_RESPONSE")
    loaded=compact(row["LOAD_DTM"])
    if kind=="schedule":
        grades=[]
        for index,field in enumerate(("ONE_GRADE_EVENT_YN","TW_GRADE_EVENT_YN","THREE_GRADE_EVENT_YN","FR_GRADE_EVENT_YN","FIV_GRADE_EVENT_YN","SIX_GRADE_EVENT_YN"),1):
            value=row.get(field)
            if value not in ("Y","N","*"):
                raise NeisError("INVALID_RESPONSE")
            if value=="Y":
                grades.append(index)
        item={"date":compact(row["AA_YMD"]),"title":text(row["EVENT_NM"],200,True),"content":text(row.get("EVENT_CNTNT")),
              "grades":grades,"dayKind":text(row.get("SBTR_DD_SC_NM"),100),"course":text(row.get("SCHUL_CRSE_SC_NM"),100),"session":text(row.get("DGHT_CRSE_SC_NM"),100)}
        identity={k:item[k] for k in ("date","title","grades","course","session")}
    elif kind=="meals":
        code=str(row.get("MMEAL_SC_CODE"))
        if code not in ("1","2","3"):
            raise NeisError("INVALID_RESPONSE")
        item={"date":compact(row["MLSV_YMD"]),"mealCode":code,"mealName":text(row["MMEAL_SC_NM"],40,True),
              "menu":text(row["DDISH_NM"],8000,True),"calories":text(row.get("CAL_INFO"),100),"origins":text(row.get("ORPLC_INFO"),8000),"nutrition":text(row.get("NTR_INFO"),8000)}
        identity={k:item[k] for k in ("date","mealCode")}
    else:
        grade,class_name=str(row.get("GRADE")),text(row.get("CLASS_NM"),50,True)
        if grade not in ("1","2","3"):
            raise NeisError("INVALID_RESPONSE")
        item={"grade":int(grade),"className":class_name,"session":text(row.get("DGHT_CRSE_SC_NM"),100)}
        if kind=="timetable":
            period,semester=str(row.get("PERIO")),str(row.get("SEM"))
            if not re.fullmatch(r"[1-9]|1[0-6]",period) or semester not in ("1","2"):
                raise NeisError("INVALID_RESPONSE")
            item.update(date=compact(row["ALL_TI_YMD"]),period=int(period),semester=int(semester),subject=text(row.get("ITRT_CNTNT"),300,True))
            identity={k:item[k] for k in ("date","grade","className","session","period")}
        else:
            identity=dict(item)
    if "date" in item and not start<=item["date"]<=end:
        raise NeisError("INVALID_RESPONSE")
    return {**item,"identity":hash_value(identity),"contentHash":hash_value(item),"loadedOn":loaded}


class Provider:
    def __init__(self,key,connection_factory=http.client.HTTPSConnection,clock=time.monotonic):
        if not isinstance(key,str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,128}",key):
            raise NeisError("KEY_MISSING")
        self.key,self.factory,self.clock=key,connection_factory,clock
        self.deadline=clock()+LIMITS["totalSeconds"]

    def read(self,kind,school,start,end,year):
        args=query(kind,school,start,end,year)
        rows,expected,seen,received=[],None,{},0
        for page in range(1,LIMITS["maxPages"]+1):
            remaining=self.deadline-self.clock()
            if remaining<=0:
                raise NeisError("UPSTREAM_UNAVAILABLE")
            connection=self.factory("open.neis.go.kr",443,timeout=min(remaining,LIMITS["httpSeconds"]))
            try:
                path="/hub/"+APIS[kind]+"?"+urlencode({**args,"KEY":self.key,"Type":"json","pIndex":page,"pSize":LIMITS["pageSize"]})
                # 실제 나이스는 Accept: application/json 요청을 HTTP 500으로 거절한다. 본문 JSON 검사는 유지한다.
                connection.request("GET",path,headers={"Accept":"*/*","Accept-Encoding":"identity"})
                response=connection.getresponse()
                if response.status!=200 or response.getheader("Content-Encoding","identity") not in ("identity",""):
                    raise NeisError("UPSTREAM_UNAVAILABLE")
                data=response.read(LIMITS["responseBytes"]+1)
                declared=response.getheader("Content-Length")
                if len(data)>LIMITS["responseBytes"] or declared is not None and (not declared.isdigit() or int(declared)!=len(data)):
                    raise NeisError("INVALID_RESPONSE")
                raw=json.loads(data.decode("utf-8"))
                if "RESULT" in raw:
                    if raw["RESULT"].get("CODE")=="INFO-200" and page==1:
                        return []
                    raise NeisError("PROVIDER_REJECTED")
                blocks=raw[APIS[kind]]
                head=next(b["head"] for b in blocks if "head" in b)
                count=next(h["list_total_count"] for h in head if "list_total_count" in h)
                result=next(h["RESULT"] for h in head if "RESULT" in h)
                batch=next(b["row"] for b in blocks if "row" in b)
                if type(count) is not int or not 1<=count<=LIMITS["maxRows"] or result.get("CODE")!="INFO-000" or not isinstance(batch,list) or not batch or len(batch)>LIMITS["pageSize"]:
                    raise NeisError("INVALID_RESPONSE")
                if expected is not None and expected!=count:
                    raise NeisError("UPSTREAM_CHANGED")
                expected=count
                page_ids=set()
                for row in batch:
                    value=normalize(kind,row,school,start,end,year)
                    identity=value["identity"]
                    if identity in seen:
                        if seen[identity]!=value["contentHash"]:
                            raise NeisError("AMBIGUOUS_SOURCE")
                        if identity not in page_ids:
                            raise NeisError("UPSTREAM_CHANGED")
                        # 한 페이지의 완전히 같은 원본 중복만 하나로 표시한다. 받은 행 수는 별도로 검증한다.
                        continue
                    page_ids.add(identity);seen[identity]=value["contentHash"];rows.append(value)
                received+=len(batch)
                if received>expected:
                    raise NeisError("INVALID_RESPONSE")
                if received==expected:
                    return rows
                if len(batch)!=LIMITS["pageSize"]:
                    raise NeisError("INCOMPLETE_RESPONSE")
            except NeisError:
                raise
            except (KeyError,ValueError,TypeError,UnicodeError,StopIteration):
                raise NeisError("INVALID_RESPONSE") from None
            except (OSError,TimeoutError,http.client.HTTPException):
                raise NeisError("UPSTREAM_UNAVAILABLE") from None
            finally:
                connection.close()
        raise NeisError("INCOMPLETE_RESPONSE")
