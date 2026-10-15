"""SQL 확정안과 분리한 내부 작업 계약. 입력/예외의 민감한 원문은 오류에 넣지 않는다."""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import re


class WorkerError(Exception):
    def __init__(self, code):
        self.code = code
        super().__init__(code)


def exact(raw, fields):
    if not isinstance(raw, dict) or set(raw) != set(fields):
        raise WorkerError("INVALID_CONTRACT")
    return raw


def identifier(value):
    if not isinstance(value, str) or re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value) is None:
        raise WorkerError("INVALID_CONTRACT")
    return value


def opaque(value):
    if not isinstance(value, str) or not 1 <= len(value) <= 256 or any(ord(c) < 33 or ord(c) > 126 for c in value):
        raise WorkerError("INVALID_CONTRACT")
    return value


def positive(value, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise WorkerError("INVALID_CONTRACT")
    return value


def instant(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", value):
        raise WorkerError("INVALID_CONTRACT")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise WorkerError("INVALID_CONTRACT") from None


def utc_now(now):
    value = now()
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise WorkerError("INVALID_CLOCK")
    return value.astimezone(timezone.utc)


def checked_ref(raw):
    value = exact(raw, ("school_id", "file_id", "bucket", "path", "identity"))
    school, file_id = identifier(value["school_id"]), identifier(value["file_id"])
    if value["bucket"] != "workhub-collection-files" or not isinstance(value["path"], str):
        raise WorkerError("INVALID_OBJECT")
    parts = value["path"].split("/")
    if len(parts) != 3 or parts[:2] != [school, file_id] or re.fullmatch(r"[A-Za-z0-9_-]{16,100}", parts[2]) is None:
        raise WorkerError("INVALID_OBJECT")
    opaque(value["identity"])
    return deepcopy(value)


def checked_lease(raw, now):
    value = exact(raw, ("job_id", "run_id", "lease_token", "expires_at", "object", "policy_version"))
    identifier(value["job_id"]); identifier(value["run_id"]); opaque(value["lease_token"])
    identifier(value["policy_version"]); checked_ref(value["object"])
    if instant(value["expires_at"]) <= utc_now(now):
        raise WorkerError("LEASE_EXPIRED")
    return deepcopy(value)


def check_guard(lease, now, cancel):
    if cancel():
        raise WorkerError("CANCELLED")
    checked_lease(lease, now)


def canonical_hash(value):
    try:
        data = json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
        return hashlib.sha256(data).hexdigest()
    except (TypeError, ValueError, UnicodeError):
        raise WorkerError("INVALID_CONTRACT") from None
