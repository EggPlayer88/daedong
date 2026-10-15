"""HWPX 수합의 기본 형식 확인. 문서 내용·악성코드·매크로 검사는 하지 않는다."""
import base64
import hashlib
import http.client
import io
import json
import os
import re
import stat
import time
import zipfile
import zlib
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote, urlsplit
from uuid import UUID

LIMITS = json.loads((Path(__file__).parent / "_assets/hwpx-basic.json").read_text(encoding="utf-8-sig"))
PROFILE = LIMITS["profile"]
BUCKET = "workhub-collection-files"
REQUEST_LIMIT = 16 * 1024
JSON_LIMIT = 256 * 1024
TOTAL_SECONDS = 45
HTTP_SECONDS = 12
IDENTIFIER = re.compile(r"[A-Za-z0-9_-]{1,100}")
SHA256 = re.compile(r"[0-9a-f]{64}")
BUSINESS_CODES = frozenset(("NOT_READY", "INVALID_INPUT", "FORBIDDEN", "INACTIVE_MEMBERSHIP", "NOT_FOUND", "CONFLICT", "IDEMPOTENCY_CONFLICT", "FILE_NOT_READY", "FILE_FAILED"))


class CheckError(Exception):
    """원문·경로·비밀 키를 담지 않는 공개 오류."""
    def __init__(self, code, status=503):
        self.code, self.status = code, status
        super().__init__(code)


class FileRejected(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def parse_json(raw, code="INVALID_RESPONSE", status=502):
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs,
                          parse_constant=lambda _: (_ for _ in ()).throw(ValueError()))
    except (UnicodeError, ValueError, TypeError, RecursionError):
        raise CheckError(code, status) from None


def _id(value):
    return isinstance(value, str) and IDENTIFIER.fullmatch(value) is not None


def validate_request(payload):
    if not isinstance(payload, dict) or set(payload) != {"memberId", "fileId", "requestKey"}:
        raise CheckError("INVALID_INPUT", 400)
    key = payload["requestKey"]
    if not _id(payload["memberId"]) or not _id(payload["fileId"]) or not isinstance(key, str) or not 8 <= len(key) <= 200 or not key.strip() or re.search(r"[\x00-\x1f\x7f]", key):
        raise CheckError("INVALID_INPUT", 400)
    return payload


def _token(authorization):
    if not isinstance(authorization, str) or re.fullmatch(r"Bearer [A-Za-z0-9_.-]{20,8192}", authorization) is None:
        raise CheckError("UNAUTHENTICATED", 401)
    return authorization


def _service_headers(key):
    if not isinstance(key, str) or re.fullmatch(r"[A-Za-z0-9_.-]{20,8192}", key) is None:
        raise CheckError("NOT_READY")
    if key.startswith("sb_secret_"):
        return {"apikey": key}
    try:
        pieces = key.split(".")
        if len(pieces) != 3 or not all(pieces):
            raise ValueError()
        claims = parse_json(base64.urlsafe_b64decode(pieces[1] + "=" * (-len(pieces[1]) % 4)))
        if not isinstance(claims, dict) or claims.get("role") != "service_role" or claims.get("sub") not in (None, ""):
            raise ValueError()
    except (ValueError, TypeError, CheckError):
        raise CheckError("NOT_READY") from None
    return {"apikey": key, "Authorization": "Bearer " + key}


class SupabaseClient:
    """설정된 Supabase 한 호스트만 접속하며 리디렉션을 따라가지 않는다."""
    def __init__(self, environ=None, connection_factory=http.client.HTTPSConnection, clock=time.monotonic):
        env = os.environ if environ is None else environ
        raw = env.get("SUPABASE_URL") or env.get("VITE_SUPABASE_URL")
        try:
            parsed = urlsplit(raw)
            if (not isinstance(raw, str) or re.search(r"[\x00-\x20\x7f]", raw) or parsed.scheme != "https" or
                parsed.username is not None or parsed.password is not None or parsed.query or parsed.fragment or parsed.path not in ("", "/") or
                parsed.port not in (None, 443) or not parsed.hostname or not re.fullmatch(r"[a-z0-9]{20}\.supabase\.co", parsed.hostname)):
                raise ValueError()
            other = env.get("VITE_SUPABASE_URL")
            if other and raw.rstrip("/") != other.rstrip("/"):
                raise ValueError()
        except (ValueError, TypeError, AttributeError):
            raise CheckError("NOT_READY") from None
        self.host, self.headers = parsed.hostname, _service_headers(env.get("SUPABASE_SERVICE_ROLE_KEY"))
        self.connection_factory, self.clock = connection_factory, clock
        self.deadline = clock() + TOTAL_SECONDS

    def _remaining(self):
        remaining = self.deadline - self.clock()
        if remaining <= 0:
            raise CheckError("RESULT_UNKNOWN")
        return min(HTTP_SECONDS, remaining)

    def _request(self, method, path, body=None, authorization=None, maximum=JSON_LIMIT, file_request=False):
        connection = None
        try:
            headers = dict(self.headers)
            headers["Accept-Encoding"] = "identity"
            if authorization is not None:
                headers["Authorization"] = authorization
            raw_body = None if body is None else json.dumps(body, ensure_ascii=False, allow_nan=False).encode("utf-8")
            if raw_body is not None:
                headers["Content-Type"] = "application/json"
            connection = self.connection_factory(self.host, 443, timeout=self._remaining())
            connection.request(method, path, body=raw_body, headers=headers)
            if connection.sock:
                connection.sock.settimeout(self._remaining())
            response = connection.getresponse()
            # 오류 본문은 토큰·DB 세부사항을 포함할 수 있으므로 읽어 공개하지 않는다.
            if response.status < 200 or response.status >= 300:
                if response.status in (401, 403):
                    raise CheckError("UNAUTHENTICATED" if authorization else "FORBIDDEN", response.status)
                if response.status == 404 and path.startswith("/rest/v1/rpc/"):
                    raise CheckError("NOT_READY")
                if response.status == 409:
                    raise CheckError("CONFLICT", 409)
                raise CheckError("RESULT_UNKNOWN")
            if response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise CheckError("INVALID_RESPONSE", 502)
            length = response.getheader("Content-Length")
            if length is not None:
                try:
                    size = int(length)
                    if size < 0:
                        raise ValueError()
                except ValueError:
                    raise CheckError("INVALID_RESPONSE", 502) from None
                if size > maximum:
                    if file_request:
                        raise FileRejected("FILE_SIZE_LIMIT")
                    raise CheckError("INVALID_RESPONSE", 502)
            chunks, size = [], 0
            while True:
                if connection.sock:
                    connection.sock.settimeout(self._remaining())
                else:
                    self._remaining()
                chunk = response.read1(min(64 * 1024, maximum + 1 - size))
                if not chunk:
                    break
                size += len(chunk)
                if size > maximum:
                    if file_request:
                        raise FileRejected("FILE_SIZE_LIMIT")
                    raise CheckError("INVALID_RESPONSE", 502)
                chunks.append(chunk)
            if length is not None and size != int(length):
                raise CheckError("RESULT_UNKNOWN")
            return b"".join(chunks)
        except (OSError, TimeoutError, http.client.HTTPException):
            raise CheckError("RESULT_UNKNOWN") from None
        finally:
            if connection is not None:
                connection.close()

    def user(self, authorization):
        value = parse_json(self._request("GET", "/auth/v1/user", authorization=authorization))
        try:
            actor = value["id"]
            if not isinstance(actor, str) or str(UUID(actor)) != actor:
                raise ValueError()
        except (ValueError, TypeError, KeyError):
            raise CheckError("UNAUTHENTICATED", 401) from None
        return actor

    def rpc(self, name, args):
        if name not in ("workhub_file_basic_claim", "workhub_file_basic_finish"):
            raise CheckError("INVALID_INPUT", 400)
        return parse_json(self._request("POST", "/rest/v1/rpc/" + name, args))

    def download(self, bucket, path, maximum):
        # 호출 전에 DB 응답의 학교·파일·버킷을 엄격하게 검증한다.
        return self._request("GET", "/storage/v1/object/authenticated/" + quote(bucket, safe="") + "/" + quote(path, safe="/"), maximum=maximum, file_request=True)


def inspect_hwpx(raw):
    """본문 압축 해제·XML 해석 없이 ZIP 목록과 HWPX 표시만 확인한다."""
    if not raw or not raw.startswith(b"PK\x03\x04"):
        raise FileRejected("FILE_SIGNATURE_MISMATCH")
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = archive.infolist()
            if not entries or len(entries) > LIMITS["maxEntries"]:
                raise FileRejected("FILE_STRUCTURE_LIMIT")
            names, expanded = set(), 0
            for entry in entries:
                name = entry.filename
                pieces = name.rstrip("/").split("/")
                if (not name or name in names or entry.orig_filename != name or "\\" in name or ":" in name or name.startswith("/") or
                    any(part in ("", ".", "..") for part in pieces) or any(ord(c) < 32 or ord(c) == 127 for c in name)):
                    raise FileRejected("FILE_STRUCTURE_INVALID")
                names.add(name)
                if entry.flag_bits & 1:
                    raise FileRejected("FILE_ENCRYPTED")
                if stat.S_ISLNK(entry.external_attr >> 16):
                    raise FileRejected("FILE_STRUCTURE_INVALID")
                if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise FileRejected("FILE_STRUCTURE_UNSUPPORTED")
                expanded += entry.file_size
                if entry.file_size > LIMITS["maxEntryBytes"] or expanded > LIMITS["maxExpandedBytes"]:
                    raise FileRejected("FILE_STRUCTURE_LIMIT")
            required = ("mimetype", "Contents/content.hpf", "Contents/section0.xml", "META-INF/container.xml")
            if any(name not in names or archive.getinfo(name).is_dir() or archive.getinfo(name).file_size == 0 for name in required):
                raise FileRejected("FILE_HWPX_REQUIRED_PART")
            if archive.getinfo("mimetype").file_size > LIMITS["maxMimetypeBytes"]:
                raise FileRejected("FILE_SIGNATURE_MISMATCH")
            with archive.open("mimetype") as stream:
                if stream.read(LIMITS["maxMimetypeBytes"] + 1) != b"application/hwp+zip":
                    raise FileRejected("FILE_SIGNATURE_MISMATCH")
    except FileRejected:
        raise
    except (zipfile.BadZipFile, zlib.error, RuntimeError, NotImplementedError, EOFError, ValueError, OSError):
        raise FileRejected("FILE_STRUCTURE_INVALID") from None


def _envelope(value, member_id, school_id=None):
    if (not isinstance(value, dict) or set(value) not in ({"contractVersion", "schoolId", "memberId", "data"}, {"contractVersion", "schoolId", "memberId", "error"}) or
        type(value.get("contractVersion")) is not int or value["contractVersion"] != 1 or not _id(value.get("schoolId")) or
        value.get("memberId") != member_id or (school_id is not None and value["schoolId"] != school_id)):
        raise CheckError("INVALID_RESPONSE", 502)
    if "error" in value:
        error = value["error"]
        if not isinstance(error, dict) or set(error) != {"code"} or error["code"] not in BUSINESS_CODES:
            raise CheckError("INVALID_RESPONSE", 502)
        code = error["code"]
        status = 403 if code in ("FORBIDDEN", "INACTIVE_MEMBERSHIP") else 409 if code in ("CONFLICT", "IDEMPOTENCY_CONFLICT") else 404 if code == "NOT_FOUND" else 503 if code == "NOT_READY" else 422
        raise CheckError(code, status)
    if not isinstance(value["data"], dict):
        raise CheckError("INVALID_RESPONSE", 502)
    return value["data"]


def _public_status(envelope, data, file_id):
    state, file = data.get("state"), data.get("file")
    if data.get("fileId") != file_id or state not in ("ready", "rejected", "pending_verification"):
        raise CheckError("INVALID_RESPONSE", 502)
    if state == "ready":
        if (not isinstance(file, dict) or set(file) != {"id", "name", "extension", "bytes", "sha256"} or file["id"] != file_id or
            not isinstance(file["name"], str) or not file["name"].strip() or file["extension"] != "hwpx" or
            type(file["bytes"]) is not int or not 0 < file["bytes"] <= LIMITS["maxFileBytes"] or
            not isinstance(file["sha256"], str) or not SHA256.fullmatch(file["sha256"])):
            raise CheckError("INVALID_RESPONSE", 502)
    elif file is not None:
        raise CheckError("INVALID_RESPONSE", 502)
    # claim의 내부 경로·lease는 브라우저에 내보내지 않는다.
    return {"contractVersion": 1, "schoolId": envelope["schoolId"], "memberId": envelope["memberId"],
            "data": {"fileId": file_id, "state": state, "file": file}}


def _claim(data, school_id, file_id):
    if data.get("fileId") != file_id or data.get("state") != "checking":
        raise CheckError("INVALID_RESPONSE", 502)
    if data.get("leaseToken") is None:
        return None
    token, expiry = data["leaseToken"], data.get("leaseExpiresAt")
    try:
        if not isinstance(token, str) or re.fullmatch(r"[A-Za-z0-9_-]{16,200}", token) is None or not isinstance(expiry, str):
            raise ValueError()
        instant = datetime.fromisoformat(expiry.replace("Z", "+00:00"))
        if instant.tzinfo is None or instant <= datetime.now(timezone.utc):
            raise ValueError()
        path = data["path"]
        if (data["bucket"] != BUCKET or not isinstance(path, str) or re.fullmatch(re.escape(school_id + "/" + file_id + "/") + r"[A-Za-z0-9_-]{16,100}", path) is None or
            not _id(data["storageObjectId"]) or data["extension"] != "hwpx" or not isinstance(data["name"], str) or
            not data["name"].lower().endswith(".hwpx") or type(data["claimedBytes"]) is not int or data["claimedBytes"] <= 0 or
            not isinstance(data["claimedSha256"], str) or SHA256.fullmatch(data["claimedSha256"]) is None or
            type(data["maxFileBytes"]) is not int or data["maxFileBytes"] <= 0):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise CheckError("INVALID_RESPONSE", 502) from None
    return data


def check_file(payload, authorization, client=None):
    request = validate_request(payload)
    authorization = _token(authorization)
    client = SupabaseClient() if client is None else client
    actor = client.user(authorization)
    args = {"p_actor_user_id": actor, "p_member_id": request["memberId"], "p_file_id": request["fileId"], "p_request_key": request["requestKey"]}
    envelope = client.rpc("workhub_file_basic_claim", args)
    data = _envelope(envelope, request["memberId"])
    if data.get("state") in ("ready", "rejected", "pending_verification"):
        return _public_status(envelope, data, request["fileId"])
    claim = _claim(data, envelope["schoolId"], request["fileId"])
    if claim is None:
        return _public_status(envelope, {"fileId": request["fileId"], "state": "pending_verification", "file": None}, request["fileId"])
    result = {"profile": PROFILE, "outcome": "rejected", "sizeBytes": None, "sha256": None,
              "rejectReason": None, "checks": {"size": False, "sha256": False, "hwpx": False}}
    try:
        maximum = min(claim["maxFileBytes"], LIMITS["maxFileBytes"])
        if claim["claimedBytes"] > maximum:
            raise FileRejected("FILE_SIZE_LIMIT")
        raw = client.download(claim["bucket"], claim["path"], maximum)
        result["sizeBytes"], result["sha256"] = len(raw), hashlib.sha256(raw).hexdigest()
        result["checks"]["size"] = len(raw) == claim["claimedBytes"] and 0 < len(raw) <= maximum
        result["checks"]["sha256"] = result["sha256"] == claim["claimedSha256"]
        if not result["checks"]["size"]:
            raise FileRejected("FILE_SIZE_MISMATCH")
        if not result["checks"]["sha256"]:
            raise FileRejected("FILE_HASH_MISMATCH")
        inspect_hwpx(raw)
        result["checks"]["hwpx"] = True
        result["outcome"] = "ready"
    except FileRejected as error:
        result["rejectReason"] = error.code
    finished = client.rpc("workhub_file_basic_finish", {**args, "p_lease_token": claim["leaseToken"], "p_storage_object_id": claim["storageObjectId"], "p_result": result})
    final_data = _envelope(finished, request["memberId"], envelope["schoolId"])
    if final_data.get("state") not in ("ready", "rejected") or final_data["state"] != result["outcome"]:
        raise CheckError("INVALID_RESPONSE", 502)
    public = _public_status(finished, final_data, request["fileId"])
    if result["outcome"] == "ready" and (public["data"]["file"]["sha256"] != result["sha256"] or public["data"]["file"]["bytes"] != result["sizeBytes"]):
        raise CheckError("INVALID_RESPONSE", 502)
    return public
