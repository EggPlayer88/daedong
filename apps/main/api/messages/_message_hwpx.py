"""메시지 전용 HWPX 최소 확인. 수합 권한·파일 원장과 분리한다."""
import hashlib
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "collections"))
import _hwpx_basic as basic

BUCKET = "workhub-message-files"
NAMES = ("workhub_message_file_basic_claim", "workhub_message_file_basic_finish")

class MessageClient(basic.SupabaseClient):
    def rpc(self, name, args):
        if name not in NAMES:
            raise basic.CheckError("INVALID_INPUT", 400)
        return basic.parse_json(self._request("POST", "/rest/v1/rpc/" + name, args))

def envelope(value, member, actor, school=None):
    if (not isinstance(value, dict) or type(value.get("contractVersion")) is not int or value["contractVersion"] != 1 or
        value.get("memberId") != member or value.get("userId") != actor or not basic._id(value.get("schoolId")) or
        (school is not None and value["schoolId"] != school) or type(value.get("ok")) is not bool):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    keys = {"contractVersion", "schoolId", "memberId", "userId", "ok", "data" if value["ok"] else "error"}
    if set(value) != keys:
        raise basic.CheckError("INVALID_RESPONSE", 502)
    if not value["ok"]:
        error = value["error"]
        if not isinstance(error, dict) or set(error) != {"code"} or error["code"] not in basic.BUSINESS_CODES:
            raise basic.CheckError("INVALID_RESPONSE", 502)
        code = error["code"]
        raise basic.CheckError(code, 403 if code in ("FORBIDDEN", "INACTIVE_MEMBERSHIP") else 409 if code in ("CONFLICT", "IDEMPOTENCY_CONFLICT") else 503)
    if not isinstance(value["data"], dict):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    return value["data"]

def object_id(value):
    try:
        if not isinstance(value, str) or str(UUID(value)) != value: raise ValueError()
    except (ValueError, TypeError):
        raise basic.CheckError("INVALID_RESPONSE", 502) from None
    return value

def status(source, data, file_id):
    if set(data) != {"fileId", "state", "storageObjectId", "file"} or data["fileId"] != file_id or data["state"] not in ("pending_basic", "ready", "rejected"):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    if data["storageObjectId"] is not None: object_id(data["storageObjectId"])
    file = data["file"]
    if data["state"] == "ready":
        if (data["storageObjectId"] is None or not isinstance(file, dict) or set(file) != {"id", "name", "bytes", "sha256", "profile"} or
            file["id"] != file_id or file["profile"] != basic.PROFILE or not isinstance(file["name"], str) or not file["name"].lower().endswith(".hwpx") or
            len(file["name"]) > 240 or any(ord(c) < 32 or c in '<>:"/\\|?*' for c in file["name"]) or
            type(file["bytes"]) is not int or not 0 < file["bytes"] <= basic.LIMITS["maxFileBytes"] or
            not isinstance(file["sha256"], str) or not basic.SHA256.fullmatch(file["sha256"])):
            raise basic.CheckError("INVALID_RESPONSE", 502)
    elif file is not None: raise basic.CheckError("INVALID_RESPONSE", 502)
    return {**{k:source[k] for k in ("contractVersion", "schoolId", "memberId", "userId", "ok")}, "data":data}

def check_file(payload, authorization, client=None):
    request = basic.validate_request(payload)
    token = basic._token(authorization)
    client = MessageClient() if client is None else client
    actor = client.user(token)
    args = {"p_actor_user_id":actor,"p_member_id":request["memberId"],"p_file_id":request["fileId"],"p_request_key":request["requestKey"]}
    response = client.rpc(NAMES[0], args)
    data = envelope(response, request["memberId"], actor)
    if data.get("state") in ("pending_basic", "ready", "rejected"):
        return status(response, data, request["fileId"])
    if data.get("state") != "checking" or data.get("fileId") != request["fileId"]:
        raise basic.CheckError("INVALID_RESPONSE", 502)
    if data.get("leaseToken") is None:
        return status(response, {"fileId":request["fileId"],"state":"pending_basic","storageObjectId":None,"file":None}, request["fileId"])
    try:
        expiry = datetime.fromisoformat(data["leaseExpiresAt"].replace("Z", "+00:00"))
        if (not isinstance(data["leaseToken"], str) or basic.re.fullmatch(r"[A-Za-z0-9_-]{16,200}", data["leaseToken"]) is None or
            expiry.tzinfo is None or expiry <= datetime.now(timezone.utc) or data["bucket"] != BUCKET or
            data["path"] != f'{response["schoolId"]}/{request["memberId"]}/{request["fileId"]}/original.hwpx' or
            not isinstance(data["name"], str) or not data["name"].lower().endswith(".hwpx") or
            type(data["claimedBytes"]) is not int or data["claimedBytes"] < 1 or
            type(data["maxFileBytes"]) is not int or data["maxFileBytes"] < 1 or
            not isinstance(data["claimedSha256"], str) or not basic.SHA256.fullmatch(data["claimedSha256"])): raise ValueError()
        object_id(data["storageObjectId"])
    except (KeyError, ValueError, TypeError, AttributeError):
        raise basic.CheckError("INVALID_RESPONSE", 502) from None
    result = {"profile":basic.PROFILE,"accepted":False,"actualBytes":None,"actualSha256":None,"reasonCode":None}
    try:
        maximum = min(data["maxFileBytes"], basic.LIMITS["maxFileBytes"])
        if data["claimedBytes"] > maximum: raise basic.FileRejected("FILE_SIZE_LIMIT")
        raw = client.download(BUCKET, data["path"], maximum)
        if len(raw) < data["claimedBytes"]: raise basic.CheckError("RESULT_UNKNOWN")
        result["actualBytes"], result["actualSha256"] = len(raw), hashlib.sha256(raw).hexdigest()
        if len(raw) != data["claimedBytes"]: raise basic.FileRejected("FILE_SIZE_MISMATCH")
        if result["actualSha256"] != data["claimedSha256"]: raise basic.FileRejected("FILE_HASH_MISMATCH")
        basic.inspect_hwpx(raw)
        result["accepted"] = True
    except basic.FileRejected as error:
        result["reasonCode"] = error.code
    finished = client.rpc(NAMES[1], {**args,"p_lease_token":data["leaseToken"],"p_storage_object_id":data["storageObjectId"],"p_result":result})
    final = envelope(finished, request["memberId"], actor, response["schoolId"])
    public = status(finished, final, request["fileId"])
    if final["state"] != ("ready" if result["accepted"] else "rejected") or final["storageObjectId"] != data["storageObjectId"]:
        raise basic.CheckError("INVALID_RESPONSE", 502)
    if result["accepted"] and (final["file"]["name"] != data["name"] or final["file"]["bytes"] != result["actualBytes"] or final["file"]["sha256"] != result["actualSha256"]):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    return public
