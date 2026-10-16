"""권한을 확인한 원본과 서버가 고정한 매핑·응답만 읽는 HWPX 생성 경로."""
import hashlib
import http.client
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _guided_hwpx import basic, inspect_template, fill_template, MappingError

BUCKET = "workhub-document-files"
CONTRACT = "guided.v1"
RPCS = {"workhub_template_inspect_claim", "workhub_template_inspect_finish", "workhub_template_render_claim", "workhub_template_render_finish"}


class GuidedClient(basic.SupabaseClient):
    def rpc(self, name, args):
        if name not in RPCS:
            raise basic.CheckError("INVALID_INPUT", 400)
        return basic.parse_json(self._request("POST", "/rest/v1/rpc/" + name, args, maximum=4 * 1024 * 1024))

    def upload(self, path, raw):
        connection = None
        try:
            headers = {**self.headers, "Content-Type": "application/hwp+zip", "x-upsert": "false", "Cache-Control": "no-store"}
            connection = self.connection_factory(self.host, 443, timeout=self._remaining())
            connection.request("POST", "/storage/v1/object/" + BUCKET + "/" + quote(path, safe="/"), body=raw, headers=headers)
            response = connection.getresponse()
            if response.status in (400, 409):
                # 응답 유실 뒤 재시도는 같은 결과물만 재사용한다. 덮어쓰지 않는다.
                existing = self.download(BUCKET, path, len(raw))
                if existing != raw:
                    raise basic.CheckError("CONFLICT", 409)
            elif not 200 <= response.status < 300:
                raise basic.CheckError("RESULT_UNKNOWN")
        except (OSError, TimeoutError, http.client.HTTPException):
            raise basic.CheckError("RESULT_UNKNOWN") from None
        finally:
            if connection is not None:
                connection.close()


def envelope(raw, member, school=None):
    if not isinstance(raw, dict) or raw.get("contract") != CONTRACT or raw.get("memberId") != member or not basic._id(raw.get("schoolId")) or (school is not None and raw["schoolId"] != school):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    if "error" in raw:
        if set(raw) != {"contract", "schoolId", "memberId", "error"} or not isinstance(raw["error"], dict) or set(raw["error"]) != {"code"} or raw["error"]["code"] not in basic.BUSINESS_CODES:
            raise basic.CheckError("INVALID_RESPONSE", 502)
        code = raw["error"]["code"]
        raise basic.CheckError(code, 403 if code in ("FORBIDDEN", "INACTIVE_MEMBERSHIP") else 409 if code in ("CONFLICT", "IDEMPOTENCY_CONFLICT") else 503)
    if set(raw) != {"contract", "schoolId", "memberId", "data"} or not isinstance(raw["data"], dict):
        raise basic.CheckError("INVALID_RESPONSE", 502)
    return raw["data"]


def request(payload):
    if not isinstance(payload, dict) or set(payload) != {"action", "memberId", "templateId", "templateVersion", "responseId", "responseVersion", "requestKey"}:
        raise basic.CheckError("INVALID_INPUT", 400)
    if (payload["action"] not in ("inspect", "render") or not basic._id(payload["memberId"]) or not basic._id(payload["templateId"]) or
        type(payload["templateVersion"]) is not int or payload["templateVersion"] < 1 or not basic._id(payload["requestKey"]) or len(payload["requestKey"]) < 8):
        raise basic.CheckError("INVALID_INPUT", 400)
    if payload["action"] == "inspect":
        if payload["responseId"] is not None or payload["responseVersion"] is not None:
            raise basic.CheckError("INVALID_INPUT", 400)
    elif not basic._id(payload["responseId"]) or type(payload["responseVersion"]) is not int or payload["responseVersion"] < 1:
        raise basic.CheckError("INVALID_INPUT", 400)
    return payload


def run(payload, authorization, client=None):
    payload = request(payload)
    token = basic._token(authorization)
    client = GuidedClient() if client is None else client
    actor = client.user(token)
    args = {"p_actor_user_id": actor, "p_member_id": payload["memberId"], "p_template_id": payload["templateId"], "p_template_version": payload["templateVersion"], "p_response_id": payload["responseId"], "p_response_version": payload["responseVersion"], "p_request_key": payload["requestKey"]}
    prefix = "workhub_template_" + payload["action"]
    claimed = client.rpc(prefix + "_claim", args)
    data = envelope(claimed, payload["memberId"])
    if data.get("state") == "completed":
        if set(data) != {"state", "result"} or not isinstance(data["result"], dict):
            raise basic.CheckError("INVALID_RESPONSE", 502)
        return {**claimed, "data": data["result"]}
    if data.get("state") == "pending":
        raise basic.CheckError("RESULT_UNKNOWN")
    try:
        source = data["source"]
        expires = datetime.fromisoformat(data["leaseExpiresAt"].replace("Z", "+00:00"))
        if (data["state"] != "leased" or not isinstance(data["leaseToken"], str) or basic.re.fullmatch(r"[A-Za-z0-9_-]{16,200}", data["leaseToken"]) is None or expires.tzinfo is None or expires <= datetime.now(timezone.utc) or
            source["bucket"] != BUCKET or not basic._id(source["ownerMemberId"]) or source["path"] != f'{claimed["schoolId"]}/{source["ownerMemberId"]}/{payload["templateId"]}/source.hwpx' or
            type(source["bytes"]) is not int or not 0 < source["bytes"] <= basic.LIMITS["maxFileBytes"] or not isinstance(source["sha256"], str) or not basic.SHA256.fullmatch(source["sha256"]) or str(UUID(source["storageObjectId"])) != source["storageObjectId"]):
            raise ValueError()
        if payload["action"] == "inspect" and source["ownerMemberId"] != payload["memberId"]:
            raise ValueError()
    except (KeyError, ValueError, TypeError, AttributeError):
        raise basic.CheckError("INVALID_RESPONSE", 502) from None
    raw = client.download(BUCKET, source["path"], source["bytes"])
    if len(raw) != source["bytes"] or hashlib.sha256(raw).hexdigest() != source["sha256"]:
        raise basic.CheckError("CONFLICT", 409)
    try:
        if payload["action"] == "inspect":
            result = {"templateId": payload["templateId"], "templateVersion": payload["templateVersion"], "inspection": inspect_template(raw)}
        else:
            target = data["target"]
            if not basic._id(target["artifactId"]) or target["bucket"] != BUCKET or target["path"] != f'{claimed["schoolId"]}/{payload["memberId"]}/{target["artifactId"]}/output.hwpx':
                raise basic.CheckError("INVALID_RESPONSE", 502)
            output = fill_template(raw, data["mapping"], data["answers"])
            client.upload(target["path"], output)
            result = {"artifactId": target["artifactId"], "templateId": payload["templateId"], "templateVersion": payload["templateVersion"], "responseId": payload["responseId"], "responseVersion": payload["responseVersion"], "bytes": len(output), "sha256": hashlib.sha256(output).hexdigest()}
    except (MappingError, basic.FileRejected) as error:
        # 원본이나 답변을 실패 문자열에 싣지 않는다.
        raise basic.CheckError("CONFLICT" if error.code == "CONFLICT" else "INVALID_INPUT", 409 if error.code == "CONFLICT" else 400) from None
    finished = client.rpc(prefix + "_finish", {**args, "p_lease_token": data["leaseToken"], "p_source_object_id": source["storageObjectId"], "p_result": result})
    confirmed = envelope(finished, payload["memberId"], claimed["schoolId"])
    if confirmed != result:
        raise basic.CheckError("INVALID_RESPONSE", 502)
    return finished
