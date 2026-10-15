"""학교자료 전용 원본 추출. 기존 문서·수합 저장소 ID를 공유하지 않는다."""
import hashlib
from datetime import datetime, timezone
from uuid import UUID
from _guided_hwpx import basic, MappingError
from _knowledge_text import extract_text

BUCKET="workhub-knowledge-files"
CONTRACT="knowledge-import.v1"
CLAIM="workhub_knowledge_file_extract_claim"
FINISH="workhub_knowledge_file_extract_finish"


class KnowledgeClient(basic.SupabaseClient):
    def rpc(self,name,args):
        if name not in (CLAIM,FINISH):
            raise basic.CheckError("INVALID_INPUT",400)
        return basic.parse_json(self._request("POST","/rest/v1/rpc/"+name,args,maximum=2*1024*1024))


def envelope(raw,member,school=None):
    if not isinstance(raw,dict) or raw.get("contract")!=CONTRACT or raw.get("memberId")!=member or not basic._id(raw.get("schoolId")) or school is not None and raw["schoolId"]!=school:
        raise basic.CheckError("INVALID_RESPONSE",502)
    if "error" in raw:
        if set(raw)!={"contract","schoolId","memberId","error"} or not isinstance(raw["error"],dict) or set(raw["error"])!={"code"} or raw["error"]["code"] not in basic.BUSINESS_CODES:
            raise basic.CheckError("INVALID_RESPONSE",502)
        code=raw["error"]["code"]
        raise basic.CheckError(code,403 if code in ("FORBIDDEN","INACTIVE_MEMBERSHIP") else 409 if code in ("CONFLICT","IDEMPOTENCY_CONFLICT") else 503)
    if set(raw)!={"contract","schoolId","memberId","data"} or not isinstance(raw["data"],dict):
        raise basic.CheckError("INVALID_RESPONSE",502)
    return raw["data"]


def run(payload,authorization,client=None):
    if not isinstance(payload,dict) or set(payload)!={"memberId","fileId","requestKey"}:
        raise basic.CheckError("INVALID_INPUT",400)
    request=basic.validate_request(payload)
    token=basic._token(authorization)
    client=KnowledgeClient() if client is None else client
    actor=client.user(token)
    args={"p_actor_user_id":actor,"p_member_id":request["memberId"],"p_file_id":request["fileId"],"p_request_key":request["requestKey"]}
    claimed=client.rpc(CLAIM,args)
    data=envelope(claimed,request["memberId"])
    if data.get("state")=="completed":
        if set(data)!={"state","result"} or not isinstance(data["result"],dict):
            raise basic.CheckError("INVALID_RESPONSE",502)
        return {**claimed,"data":data["result"]}
    if data.get("state")=="pending":
        raise basic.CheckError("RESULT_UNKNOWN")
    try:
        expiry=datetime.fromisoformat(data["leaseExpiresAt"].replace("Z","+00:00"))
        if (data["state"]!="leased" or not isinstance(data["leaseToken"],str) or basic.re.fullmatch(r"[A-Za-z0-9_-]{16,200}",data["leaseToken"]) is None or expiry.tzinfo is None or expiry<=datetime.now(timezone.utc) or
            data["bucket"]!=BUCKET or data["path"]!=f'{claimed["schoolId"]}/{request["memberId"]}/{request["fileId"]}/original.hwpx' or
            type(data["fileVersion"]) is not int or data["fileVersion"]<1 or type(data["bytes"]) is not int or not 0<data["bytes"]<=basic.LIMITS["maxFileBytes"] or
            not isinstance(data["sha256"],str) or not basic.SHA256.fullmatch(data["sha256"]) or str(UUID(data["storageObjectId"]))!=data["storageObjectId"] or
            not isinstance(data["name"],str) or not data["name"].lower().endswith(".hwpx") or len(data["name"])>240 or basic.re.search(r'[<>:"/\\|?*\x00-\x1f]',data["name"])):
            raise ValueError()
    except (KeyError,ValueError,TypeError,AttributeError):
        raise basic.CheckError("INVALID_RESPONSE",502) from None
    raw=client.download(BUCKET,data["path"],data["bytes"])
    if len(raw)!=data["bytes"] or hashlib.sha256(raw).hexdigest()!=data["sha256"]:
        raise basic.CheckError("CONFLICT",409)
    try:
        extraction=extract_text(raw)
    except (MappingError,basic.FileRejected):
        raise basic.CheckError("INVALID_INPUT",400) from None
    result={"fileId":request["fileId"],"fileVersion":data["fileVersion"],"name":data["name"],"extraction":extraction}
    finished=client.rpc(FINISH,{**args,"p_lease_token":data["leaseToken"],"p_storage_object_id":data["storageObjectId"],"p_result":result})
    checked=envelope(finished,request["memberId"],claimed["schoolId"])
    if checked!=result:
        raise basic.CheckError("INVALID_RESPONSE",502)
    return finished
